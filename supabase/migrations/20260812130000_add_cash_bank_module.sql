-- Kasa & Banka modülü. Mevcut cash_accounts / bank_accounts /
-- cash_movements / bank_deposits / bank_deposit_items tabloları
-- (20260725103000) şimdiye kadar hiç kullanılmıyordu — bu migration
-- onları gerçek, RPC üzerinden yazılan bir defter haline getiriyor.
--
-- Tasarım özeti:
--   1) cash_movements.amount HER ZAMAN pozitif (mevcut CHECK zaten
--      böyle); yön yeni `direction` sütunuyla (+1/-1) ayrı tutulur.
--      Bakiye = sum(amount * direction) — her zaman hareketlerden
--      YENİDEN hesaplanır, hiçbir yerde ayrı/önbelleklenmiş bir
--      "bakiye" sütunu yok (dashboard finans göstergelerindeki eski
--      hataya düşmemek için bilinçli tercih).
--   2) "Hareketler asla fiziksel silinmez, düzeltme ters kayıtla
--      yapılır" kuralı iki yolla uygulanıyor: (a) cash_movements /
--      bank_deposits / bank_deposit_items üzerinde authenticated'a
--      insert/update/delete YOK — yalnızca bu dosyadaki security
--      definer RPC'ler yazabilir, hiçbiri UPDATE/DELETE yapmıyor,
--      hepsi INSERT-only; (b) reverse_cash_movement() bir hareketi
--      SİLMEK yerine ters yönlü YENİ bir 'correction' satırı ekler
--      (reverses_movement_id ile izlenebilir).
--   3) Bir kasa hareketi en fazla BİR yatırıma dahil olabilir —
--      bank_deposit_items(cash_movement_id) üzerindeki tekil indeks
--      bunu veritabanı seviyesinde garanti eder; create_bank_deposit()
--      ayrıca RPC seviyesinde de kontrol edip anlaşılır hata verir.
--   4) bank_deposits.amount, bank_deposit_items toplamıyla HER ZAMAN
--      eşittir çünkü create_bank_deposit() ikisini TEK transaction'da,
--      aynı sorgudan hesaplayıp yazar — ayrı bir CHECK/trigger yerine
--      "tek yazma yolu" ile garanti edilir (bu depodaki payment_allocations
--      toplamı ile aynı felsefe).
--   5) cash_accounts / bank_accounts birer "tanım" tablosu (courses/
--      class_groups gibi) — bunlar için doğrudan admin CRUD RLS'i
--      yeterli, RPC gerekmiyor.

-- ---------------------------------------------------------------
-- 1) Şema eklemeleri
-- ---------------------------------------------------------------

alter table public.cash_movements
add column if not exists direction smallint
  check (direction in (1, -1));

update public.cash_movements set direction = 1 where direction is null;

alter table public.cash_movements
alter column direction set not null;

alter table public.cash_movements
add column if not exists reverses_movement_id uuid
  references public.cash_movements(id);

alter table public.bank_deposits
add column if not exists cash_movement_id uuid
  references public.cash_movements(id);

-- Aynı kasa hareketi birden fazla yatırıma dahil edilemez.
create unique index if not exists
bank_deposit_items_cash_movement_unique
on public.bank_deposit_items (cash_movement_id);

create index if not exists
cash_movements_account_occurred_idx
on public.cash_movements (cash_account_id, occurred_at);

-- ---------------------------------------------------------------
-- 2) RLS — kasa/banka tanımları admin CRUD, hareketler/yatırımlar
-- yalnızca RPC üzerinden yazılabilir (select serbest, admin+kurum).
-- ---------------------------------------------------------------

drop policy if exists cash_accounts_finance on public.cash_accounts;

create policy cash_accounts_admin_manage
on public.cash_accounts
for all
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
)
with check (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

drop policy if exists bank_accounts_finance on public.bank_accounts;

create policy bank_accounts_admin_manage
on public.bank_accounts
for all
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
)
with check (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

drop policy if exists cash_movements_finance on public.cash_movements;

create policy cash_movements_select_admin
on public.cash_movements
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.cash_movements
from authenticated;

grant select
on public.cash_movements
to authenticated;

drop policy if exists deposits_finance on public.bank_deposits;

create policy bank_deposits_select_admin
on public.bank_deposits
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.bank_deposits
from authenticated;

grant select
on public.bank_deposits
to authenticated;

drop policy if exists deposit_items_finance on public.bank_deposit_items;

create policy bank_deposit_items_select_admin
on public.bank_deposit_items
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.bank_deposit_items
from authenticated;

grant select
on public.bank_deposit_items
to authenticated;

-- ---------------------------------------------------------------
-- 3) Nakit ödeme alındığında otomatik cash_in hareketi.
-- record_payment_for_course()'a p_cash_account_id eklendiği için
-- imza değişti — eski imzayı önce düşürmek gerekiyor, yoksa
-- create or replace yeni bir overload oluşturur (eskisi silinmez).
-- ---------------------------------------------------------------

drop function if exists
public.record_payment_for_course(uuid, uuid, numeric, text, text);

create or replace function public.record_payment_for_course(
  p_student_id uuid,
  p_course_id uuid,
  p_amount numeric,
  p_method text,
  p_note text,
  p_cash_account_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_payment_id uuid;
  v_cash_movement_id uuid;
  v_remaining numeric(12,2);
  v_accrual record;
  v_allocate numeric(12,2);
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Ödeme kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception
      'Geçerli bir tutar girilmelidir.';
  end if;

  if p_method not in
    ('cash', 'bank_transfer', 'card', 'online', 'other') then
    raise exception
      'Geçerli bir ödeme yöntemi seçilmelidir.';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.enrollments e
    where e.student_id = p_student_id
      and e.course_id = p_course_id
      and e.organization_id = v_organization_id
  ) then
    raise exception 'Öğrencinin bu derste kaydı bulunamadı.';
  end if;

  if p_method = 'cash' then
    if p_cash_account_id is null then
      raise exception
        'Nakit ödeme için bir kasa hesabı seçilmelidir.';
    end if;

    if not exists (
      select 1 from public.cash_accounts
      where id = p_cash_account_id
        and organization_id = v_organization_id
        and is_active = true
    ) then
      raise exception 'Kasa hesabı bulunamadı.';
    end if;
  end if;

  insert into public.payments (
    organization_id, student_id, received_at, amount, method,
    note, recorded_by
  )
  values (
    v_organization_id, p_student_id, pg_catalog.now(), p_amount,
    p_method::public.payment_method,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    v_user_id
  )
  returning id into v_payment_id;

  if p_method = 'cash' then
    insert into public.cash_movements (
      organization_id, cash_account_id, movement_type, amount, direction,
      occurred_at, payment_id, note, recorded_by
    )
    values (
      v_organization_id, p_cash_account_id, 'cash_in'::public.cash_movement_type,
      p_amount, 1, pg_catalog.now(), v_payment_id,
      nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_user_id
    )
    returning id into v_cash_movement_id;
  end if;

  v_remaining := p_amount;

  for v_accrual in
    select a.id, (a.net_amount - a.allocated_amount) as pending
    from public.accruals a
    inner join public.enrollments e on e.id = a.enrollment_id
    where a.organization_id = v_organization_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
      and a.status in (
        'open'::public.accrual_status,
        'partial'::public.accrual_status,
        'overdue'::public.accrual_status
      )
    order by a.period_start asc
    for update of a
  loop
    exit when v_remaining <= 0;

    v_allocate := least(v_remaining, v_accrual.pending);

    if v_allocate > 0 then
      insert into public.payment_allocations (
        organization_id, payment_id, accrual_id, amount
      )
      values (
        v_organization_id, v_payment_id, v_accrual.id, v_allocate
      );

      update public.accruals
      set allocated_amount = allocated_amount + v_allocate,
          status = case
            when allocated_amount + v_allocate >= net_amount
              then 'paid'::public.accrual_status
            else 'partial'::public.accrual_status
          end
      where id = v_accrual.id;

      v_remaining := v_remaining - v_allocate;
    end if;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'payments', v_payment_id::text,
    'create', null,
    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'course_id', p_course_id,
      'amount', p_amount,
      'method', p_method,
      'unallocated_remainder', v_remaining,
      'cash_movement_id', v_cash_movement_id
    )
  );

  return v_payment_id;
end;
$$;

revoke all on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid)
from public, anon;
grant execute on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text, uuid)
to authenticated;

-- ---------------------------------------------------------------
-- 4) Banka/ATM yatırımı oluşturma — seçilen kasa hareketlerini TEK
-- yatırıma bağlar, toplamı hesaplar, dengeleyici -amount hareketi
-- ekler. Seçilen hareketlerin kendisi asla değiştirilmez.
-- ---------------------------------------------------------------

create or replace function public.create_bank_deposit(
  p_cash_account_id uuid,
  p_bank_account_id uuid,
  p_deposited_at timestamptz,
  p_cash_movement_ids uuid[],
  p_note text default null,
  p_receipt_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_total numeric(12,2);
  v_matched_count integer;
  v_deposit_id uuid;
  v_movement_id uuid;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  v_receipt_path text := nullif(pg_catalog.btrim(coalesce(p_receipt_path, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Banka yatırımı oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_cash_movement_ids is null
     or cardinality(p_cash_movement_ids) = 0 then
    raise exception 'En az bir kasa hareketi seçilmelidir.';
  end if;

  if p_deposited_at is null then
    raise exception 'Yatırım tarihi seçilmelidir.';
  end if;

  if not exists (
    select 1 from public.cash_accounts
    where id = p_cash_account_id
      and organization_id = v_organization_id
      and is_active = true
  ) then
    raise exception 'Kasa hesabı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.bank_accounts
    where id = p_bank_account_id
      and organization_id = v_organization_id
      and is_active = true
  ) then
    raise exception 'Banka hesabı bulunamadı.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_cash_account_id::text || ':deposit', 2026081400
    )
  );

  -- Yalnızca bu kasaya ait, pozitif yönlü ve HENÜZ hiçbir yatırıma
  -- dahil edilmemiş hareketler kabul edilir. Eşleşen sayı, gönderilen
  -- dizinin (yinelenenler dahil sayılan) uzunluğundan azsa istekte
  -- geçersiz/mükerrer/uygun olmayan bir id vardır.
  select
    count(*)::integer,
    coalesce(sum(cm.amount), 0)
  into v_matched_count, v_total
  from public.cash_movements cm
  where cm.id = any(p_cash_movement_ids)
    and cm.organization_id = v_organization_id
    and cm.cash_account_id = p_cash_account_id
    and cm.direction = 1
    and not exists (
      select 1 from public.bank_deposit_items bdi
      where bdi.cash_movement_id = cm.id
    );

  if v_matched_count <> cardinality(p_cash_movement_ids) then
    raise exception
      'Seçilen hareketlerden biri artık uygun değil (başka kasaya ait, negatif yönlü veya zaten yatırılmış olabilir).';
  end if;

  insert into public.cash_movements (
    organization_id, cash_account_id, movement_type, amount, direction,
    occurred_at, note, recorded_by
  )
  values (
    v_organization_id, p_cash_account_id, 'bank_deposit'::public.cash_movement_type,
    v_total, -1, p_deposited_at, v_note, v_user_id
  )
  returning id into v_movement_id;

  insert into public.bank_deposits (
    organization_id, cash_account_id, bank_account_id, deposited_at,
    amount, receipt_path, note, deposited_by, cash_movement_id
  )
  values (
    v_organization_id, p_cash_account_id, p_bank_account_id, p_deposited_at,
    v_total, v_receipt_path, v_note, v_user_id, v_movement_id
  )
  returning id into v_deposit_id;

  insert into public.bank_deposit_items (
    organization_id, bank_deposit_id, cash_movement_id, amount
  )
  select v_organization_id, v_deposit_id, cm.id, cm.amount
  from public.cash_movements cm
  where cm.id = any(p_cash_movement_ids)
    and cm.organization_id = v_organization_id
    and cm.cash_account_id = p_cash_account_id
    and cm.direction = 1;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'bank_deposits', v_deposit_id::text,
    'create', null,
    pg_catalog.jsonb_build_object(
      'cash_account_id', p_cash_account_id,
      'bank_account_id', p_bank_account_id,
      'amount', v_total,
      'movement_count', v_matched_count,
      'cash_movement_id', v_movement_id
    )
  );

  return v_deposit_id;
end;
$$;

revoke all on function
  public.create_bank_deposit(uuid, uuid, timestamptz, uuid[], text, text)
from public, anon, authenticated;
grant execute on function
  public.create_bank_deposit(uuid, uuid, timestamptz, uuid[], text, text)
to authenticated;

-- Yatırım oluşturulduktan sonra makbuz eklemek/değiştirmek için.

create or replace function public.set_bank_deposit_receipt(
  p_bank_deposit_id uuid,
  p_receipt_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_receipt_path text := nullif(pg_catalog.btrim(coalesce(p_receipt_path, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Makbuz ekleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.bank_deposits
    where id = p_bank_deposit_id
      and organization_id = v_organization_id
  ) then
    raise exception 'Yatırım kaydı bulunamadı.';
  end if;

  update public.bank_deposits
  set receipt_path = v_receipt_path
  where id = p_bank_deposit_id
    and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'bank_deposits', p_bank_deposit_id::text,
    'set_receipt', null,
    pg_catalog.jsonb_build_object('receipt_path', v_receipt_path)
  );
end;
$$;

revoke all on function
  public.set_bank_deposit_receipt(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.set_bank_deposit_receipt(uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 5) Kasa sayımı / düzeltme. Fiziksel sayım defterden farklıysa fark
-- 'correction' hareketi olarak eklenir (yön farkın işaretinden gelir).
-- ---------------------------------------------------------------

create or replace function public.record_cash_count_adjustment(
  p_cash_account_id uuid,
  p_counted_amount numeric,
  p_reason text
)
returns table (
  movement_id uuid,
  previous_balance numeric,
  counted_amount numeric,
  delta numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_balance numeric(12,2);
  v_delta numeric(12,2);
  v_movement_id uuid;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Kasa sayımı kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'Geçerli bir sayım tutarı girilmelidir.';
  end if;

  if v_reason is null then
    raise exception 'Sayım farkı için bir açıklama girilmelidir.';
  end if;

  if not exists (
    select 1 from public.cash_accounts
    where id = p_cash_account_id
      and organization_id = v_organization_id
  ) then
    raise exception 'Kasa hesabı bulunamadı.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_cash_account_id::text || ':count', 2026081401
    )
  );

  select coalesce(sum(cm.amount * cm.direction), 0)
  into v_balance
  from public.cash_movements cm
  where cm.cash_account_id = p_cash_account_id
    and cm.organization_id = v_organization_id;

  v_delta := p_counted_amount - v_balance;

  if v_delta = 0 then
    return query
    select null::uuid, v_balance, p_counted_amount, 0::numeric;
    return;
  end if;

  insert into public.cash_movements (
    organization_id, cash_account_id, movement_type, amount, direction,
    note, recorded_by
  )
  values (
    v_organization_id, p_cash_account_id, 'correction'::public.cash_movement_type,
    abs(v_delta), (case when v_delta > 0 then 1 else -1 end)::smallint,
    v_reason, v_user_id
  )
  returning id into v_movement_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'cash_movements', v_movement_id::text,
    'cash_count_adjustment',
    pg_catalog.jsonb_build_object('previous_balance', v_balance),
    pg_catalog.jsonb_build_object(
      'counted_amount', p_counted_amount, 'delta', v_delta, 'reason', v_reason
    )
  );

  return query
  select v_movement_id, v_balance, p_counted_amount, v_delta;
end;
$$;

revoke all on function
  public.record_cash_count_adjustment(uuid, numeric, text)
from public, anon, authenticated;
grant execute on function
  public.record_cash_count_adjustment(uuid, numeric, text)
to authenticated;

-- ---------------------------------------------------------------
-- 6) Ters kayıt. Hiçbir hareket silinmez/güncellenmez — orijinalin
-- tam tersi yönde yeni bir 'correction' satırı eklenir.
-- ---------------------------------------------------------------

create or replace function public.reverse_cash_movement(
  p_movement_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_original record;
  v_new_id uuid;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Kasa hareketi ters kaydı oluşturma yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'Ters kayıt için bir açıklama girilmelidir.';
  end if;

  select * into v_original
  from public.cash_movements
  where id = p_movement_id
    and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Kasa hareketi bulunamadı.';
  end if;

  if exists (
    select 1 from public.cash_movements
    where reverses_movement_id = p_movement_id
  ) then
    raise exception
      'Bu hareket için zaten bir ters kayıt oluşturulmuş.';
  end if;

  insert into public.cash_movements (
    organization_id, cash_account_id, movement_type, amount, direction,
    note, recorded_by, reverses_movement_id
  )
  values (
    v_organization_id, v_original.cash_account_id, 'correction'::public.cash_movement_type,
    v_original.amount, -v_original.direction, v_reason, v_user_id, p_movement_id
  )
  returning id into v_new_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'cash_movements', v_new_id::text, 'reverse',
    pg_catalog.jsonb_build_object(
      'reverses_movement_id', p_movement_id,
      'original_amount', v_original.amount,
      'original_direction', v_original.direction
    ),
    pg_catalog.jsonb_build_object('reason', v_reason)
  );

  return v_new_id;
end;
$$;

revoke all on function
  public.reverse_cash_movement(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.reverse_cash_movement(uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 7) Okuma RPC'leri — hepsi hareketlerden CANLI hesaplanır, ayrı bir
-- bakiye sütunu hiçbir yerde tutulmaz.
-- ---------------------------------------------------------------

create or replace function public.get_cash_account_balance(
  p_cash_account_id uuid,
  p_as_of timestamptz default null
)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_balance numeric(12,2);
begin
  if v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Kasa bakiyesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  select coalesce(sum(cm.amount * cm.direction), 0)
  into v_balance
  from public.cash_movements cm
  where cm.cash_account_id = p_cash_account_id
    and cm.organization_id = v_organization_id
    and (p_as_of is null or cm.occurred_at <= p_as_of);

  return v_balance;
end;
$$;

revoke all on function
  public.get_cash_account_balance(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function
  public.get_cash_account_balance(uuid, timestamptz)
to authenticated;

create or replace function public.get_cash_daily_balances(
  p_cash_account_id uuid,
  p_start_date date,
  p_end_date date
)
returns table (
  balance_date date,
  day_in numeric,
  day_out numeric,
  day_net numeric,
  running_balance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_timezone text;
  v_opening_balance numeric(12,2);
begin
  if v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Kasa raporunu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_start_date is null or p_end_date is null
     or p_start_date > p_end_date then
    raise exception 'Geçerli bir tarih aralığı seçilmelidir.';
  end if;

  select coalesce(organization.timezone, 'Europe/Istanbul')
  into v_timezone
  from public.organizations organization
  where organization.id = v_organization_id;

  select coalesce(sum(cm.amount * cm.direction), 0)
  into v_opening_balance
  from public.cash_movements cm
  where cm.cash_account_id = p_cash_account_id
    and cm.organization_id = v_organization_id
    and cm.occurred_at < (p_start_date::timestamp at time zone v_timezone);

  return query
  with days as (
    select d::date as balance_date
    from pg_catalog.generate_series(
      p_start_date::timestamp, p_end_date::timestamp, interval '1 day'
    ) as d
  ),
  daily as (
    select
      (cm.occurred_at at time zone v_timezone)::date as balance_date,
      sum(case when cm.direction = 1 then cm.amount else 0 end) as day_in,
      sum(case when cm.direction = -1 then cm.amount else 0 end) as day_out,
      sum(cm.amount * cm.direction) as day_net
    from public.cash_movements cm
    where cm.cash_account_id = p_cash_account_id
      and cm.organization_id = v_organization_id
      and cm.occurred_at >= (p_start_date::timestamp at time zone v_timezone)
      and cm.occurred_at < ((p_end_date + 1)::timestamp at time zone v_timezone)
    group by (cm.occurred_at at time zone v_timezone)::date
  )
  select
    days.balance_date,
    coalesce(daily.day_in, 0),
    coalesce(daily.day_out, 0),
    coalesce(daily.day_net, 0),
    v_opening_balance
      + sum(coalesce(daily.day_net, 0))
        over (order by days.balance_date)
  from days
  left join daily on daily.balance_date = days.balance_date
  order by days.balance_date;
end;
$$;

revoke all on function
  public.get_cash_daily_balances(uuid, date, date)
from public, anon, authenticated;
grant execute on function
  public.get_cash_daily_balances(uuid, date, date)
to authenticated;

create or replace function public.get_undeposited_cash_movements(
  p_cash_account_id uuid
)
returns table (
  id uuid,
  movement_type public.cash_movement_type,
  amount numeric,
  occurred_at timestamptz,
  note text,
  payment_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu listeyi görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select cm.id, cm.movement_type, cm.amount, cm.occurred_at, cm.note, cm.payment_id
  from public.cash_movements cm
  where cm.cash_account_id = p_cash_account_id
    and cm.organization_id = v_organization_id
    and cm.direction = 1
    and not exists (
      select 1 from public.bank_deposit_items bdi
      where bdi.cash_movement_id = cm.id
    )
  order by cm.occurred_at asc;
end;
$$;

revoke all on function
  public.get_undeposited_cash_movements(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_undeposited_cash_movements(uuid)
to authenticated;

create or replace function public.get_cash_movements(
  p_cash_account_id uuid,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid,
  movement_type public.cash_movement_type,
  amount numeric,
  direction smallint,
  occurred_at timestamptz,
  note text,
  payment_id uuid,
  reverses_movement_id uuid,
  is_deposited boolean,
  running_balance numeric,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception
      'Kasa hareketlerini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  with movements as (
    select
      cm.id, cm.movement_type, cm.amount, cm.direction, cm.occurred_at, cm.note,
      cm.payment_id, cm.reverses_movement_id,
      exists (
        select 1 from public.bank_deposit_items bdi
        where bdi.cash_movement_id = cm.id
      ) as is_deposited,
      sum(cm.amount * cm.direction)
        over (order by cm.occurred_at, cm.id) as running_balance,
      count(*) over () as total_count
    from public.cash_movements cm
    where cm.cash_account_id = p_cash_account_id
      and cm.organization_id = v_organization_id
  )
  select
    movements.id, movements.movement_type, movements.amount, movements.direction,
    movements.occurred_at, movements.note, movements.payment_id,
    movements.reverses_movement_id, movements.is_deposited,
    movements.running_balance, movements.total_count
  from movements
  order by movements.occurred_at desc, movements.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function
  public.get_cash_movements(uuid, integer, integer)
from public, anon, authenticated;
grant execute on function
  public.get_cash_movements(uuid, integer, integer)
to authenticated;

create or replace function public.get_bank_account_summary(
  p_bank_account_id uuid
)
returns table (
  total_deposited numeric,
  deposit_count bigint,
  last_deposit_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu özeti görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    coalesce(sum(bd.amount), 0),
    count(*)::bigint,
    max(bd.deposited_at)
  from public.bank_deposits bd
  where bd.bank_account_id = p_bank_account_id
    and bd.organization_id = v_organization_id;
end;
$$;

revoke all on function
  public.get_bank_account_summary(uuid)
from public, anon, authenticated;
grant execute on function
  public.get_bank_account_summary(uuid)
to authenticated;

-- ---------------------------------------------------------------
-- 8) Yatırım makbuzu deposu — özel (private), yalnızca admin.
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('bank-deposit-receipts', 'bank-deposit-receipts', false)
on conflict (id) do nothing;

drop policy if exists "bank_deposit_receipts_admin_access" on storage.objects;

create policy "bank_deposit_receipts_admin_access"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'bank-deposit-receipts'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.is_admin()
)
with check (
  bucket_id = 'bank-deposit-receipts'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.is_admin()
);

notify pgrst, 'reload schema';
