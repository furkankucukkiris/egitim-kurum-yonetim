-- Masraf yönetimi ve net kârlılık modülü. Mevcut expense_categories /
-- expenses tabloları (20260725103000) şimdiye kadar hiç kullanılmıyordu
-- — bu migration onları gerçek bir yaşam döngüsüne (planlı → ödendi /
-- iptal) bağlıyor. Kasa & Banka modülüyle (20260812130000) aynı
-- prensipler: nakit ödenen masraflar cash_movements'a bağlanır, hiçbir
-- şey fiziksel silinmez, düzeltme ters kayıtla yapılır.
--
-- Tasarım özeti:
--   1) Tekrarlayan masraflar için ayrı bir "şablon" tablosu
--      (recurring_expense_templates) var — enrollments/accruals ve
--      class_groups/lesson_sessions ile AYNI desen: şablon tekil bir
--      tanımdır, generate_monthly_expenses() her ay şablonlardan
--      GERÇEK expenses satırları üretir. Dönem bazlı idempotency key
--      expenses(template_id, period_start) üzerindeki KISMİ tekil
--      indekstir (yalnızca template_id dolu satırlarda) — accruals'daki
--      (enrollment_id, period_start) ile birebir aynı fikir.
--   2) Nakit ödenen bir masraf, record_expense_payment() içinde AYNI
--      transaction'da bir cash_out (direction=-1) hareketi oluşturur
--      ve expenses.cash_movement_id ile ona bağlanır — kasa/banka
--      modülündeki record_payment_for_course()'un cash_in tarafındaki
--      simetriği.
--   3) cancel_expense() bir masrafı SİLMEZ; status='cancelled' yapar
--      VE (varsa) bağlı cash_movement'ı reverse_cash_movement() ile
--      ters kayıtla düzeltir — kasa bakiyesi her zaman gerçek
--      hareketlerle tutarlı kalır. Tutar/kategori DÜZELTMESİ istenirse
--      (yanlış girilmiş bir masraf) desen aynı: iptal et (ters kayıt
--      otomatik oluşur) + doğrusunu yeni bir masraf olarak ekle —
--      ödenmiş bir masrafın tutarı asla yerinde değiştirilmez.
--   4) expenses select'i ve mutasyonu (accruals gibi) yalnızca admin —
--      teacher hiçbir şekilde erişemez. expense_categories basit bir
--      tanım tablosu (cash_accounts gibi) — doğrudan admin RLS yeterli.
--      recurring_expense_templates ise expense_categories/courses'a
--      referans verdiği için (çapraz-organizasyon FK riski) RPC
--      üzerinden yazılıyor, doğrudan RLS insert değil.

-- ---------------------------------------------------------------
-- 1) Şema eklemeleri
-- ---------------------------------------------------------------

create table public.recurring_expense_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid not null references public.expense_categories(id),
  course_id uuid references public.courses(id),
  vendor_name text,
  amount numeric(12,2) not null check (amount > 0),
  due_day smallint not null default 1 check (due_day between 1 and 28),
  payment_method public.payment_method,
  note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger recurring_expense_templates_set_updated_at
before update on public.recurring_expense_templates
for each row execute function public.set_updated_at();

alter table public.expenses
add column if not exists cash_movement_id uuid
  references public.cash_movements(id);

alter table public.expenses
add column if not exists cancelled_at timestamptz;

alter table public.expenses
add column if not exists cancel_reason text;

alter table public.expenses
add column if not exists template_id uuid
  references public.recurring_expense_templates(id);

alter table public.expenses
add column if not exists period_start date;

-- Dönem bazlı idempotency key: aynı şablon aynı ay için birden fazla
-- kez üretilemez. Tek seferlik (template_id null) masrafları etkilemez.
create unique index if not exists
expenses_template_period_unique
on public.expenses (template_id, period_start)
where template_id is not null;

create index if not exists
expenses_org_status_date_idx
on public.expenses (organization_id, status, expense_date);

create index if not exists
expenses_course_idx
on public.expenses (course_id)
where course_id is not null;

-- ---------------------------------------------------------------
-- 2) RLS
-- ---------------------------------------------------------------

drop policy if exists expense_categories_finance on public.expense_categories;

create policy expense_categories_admin_manage
on public.expense_categories
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

drop policy if exists expenses_finance on public.expenses;

create policy expenses_select_admin
on public.expenses
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.expenses
from authenticated;

grant select
on public.expenses
to authenticated;

alter table public.recurring_expense_templates enable row level security;

create policy recurring_expense_templates_select_admin
on public.recurring_expense_templates
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete
on public.recurring_expense_templates
from authenticated;

grant select
on public.recurring_expense_templates
to authenticated;

-- ---------------------------------------------------------------
-- 3) Masraf CRUD (RPC üzerinden)
-- ---------------------------------------------------------------

create or replace function public.create_expense(
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_due_date date default null,
  p_course_id uuid default null,
  p_vendor_name text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_expense_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Masraf ekleme yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  if p_expense_date is null then
    raise exception 'Masraf tarihi seçilmelidir.';
  end if;

  if not exists (
    select 1 from public.expense_categories
    where id = p_category_id and organization_id = v_organization_id
  ) then
    raise exception 'Masraf kategorisi bulunamadı.';
  end if;

  if p_course_id is not null and not exists (
    select 1 from public.courses
    where id = p_course_id and organization_id = v_organization_id
  ) then
    raise exception 'Ders bulunamadı.';
  end if;

  insert into public.expenses (
    organization_id, category_id, course_id, expense_date, due_date,
    amount, status, vendor_name, note, recorded_by
  )
  values (
    v_organization_id, p_category_id, p_course_id, p_expense_date, p_due_date,
    p_amount, 'planned'::public.expense_status,
    nullif(pg_catalog.btrim(coalesce(p_vendor_name, '')), ''),
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    v_user_id
  )
  returning id into v_expense_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', v_expense_id::text, 'create', null,
    pg_catalog.jsonb_build_object(
      'category_id', p_category_id, 'amount', p_amount, 'course_id', p_course_id
    )
  );

  return v_expense_id;
end;
$$;

revoke all on function
  public.create_expense(uuid, numeric, date, date, uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.create_expense(uuid, numeric, date, date, uuid, text, text)
to authenticated;

create or replace function public.update_expense_details(
  p_expense_id uuid,
  p_category_id uuid,
  p_amount numeric,
  p_expense_date date,
  p_due_date date default null,
  p_course_id uuid default null,
  p_vendor_name text default null,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_expense record;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Masraf düzenleme yetkiniz bulunmuyor.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Masraf kaydı bulunamadı.';
  end if;

  if v_expense.status <> 'planned'::public.expense_status then
    raise exception 'Yalnızca ödenmemiş (planlı) masraflar düzenlenebilir.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  if p_expense_date is null then
    raise exception 'Masraf tarihi seçilmelidir.';
  end if;

  if not exists (
    select 1 from public.expense_categories
    where id = p_category_id and organization_id = v_organization_id
  ) then
    raise exception 'Masraf kategorisi bulunamadı.';
  end if;

  if p_course_id is not null and not exists (
    select 1 from public.courses
    where id = p_course_id and organization_id = v_organization_id
  ) then
    raise exception 'Ders bulunamadı.';
  end if;

  update public.expenses
  set category_id = p_category_id,
      course_id = p_course_id,
      amount = p_amount,
      expense_date = p_expense_date,
      due_date = p_due_date,
      vendor_name = nullif(pg_catalog.btrim(coalesce(p_vendor_name, '')), ''),
      note = nullif(pg_catalog.btrim(coalesce(p_note, '')), '')
  where id = p_expense_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', p_expense_id::text, 'update',
    pg_catalog.jsonb_build_object('amount', v_expense.amount, 'category_id', v_expense.category_id),
    pg_catalog.jsonb_build_object('amount', p_amount, 'category_id', p_category_id)
  );
end;
$$;

revoke all on function
  public.update_expense_details(uuid, uuid, numeric, date, date, uuid, text, text)
from public, anon, authenticated;
grant execute on function
  public.update_expense_details(uuid, uuid, numeric, date, date, uuid, text, text)
to authenticated;

create or replace function public.record_expense_payment(
  p_expense_id uuid,
  p_paid_at timestamptz,
  p_payment_method text,
  p_cash_account_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_expense record;
  v_cash_movement_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Masraf ödemesi kaydetme yetkiniz bulunmuyor.';
  end if;

  if p_payment_method not in
    ('cash', 'bank_transfer', 'card', 'online', 'other') then
    raise exception 'Geçerli bir ödeme yöntemi seçilmelidir.';
  end if;

  if p_paid_at is null then
    raise exception 'Ödeme tarihi seçilmelidir.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Masraf kaydı bulunamadı.';
  end if;

  if v_expense.status <> 'planned'::public.expense_status then
    raise exception 'Yalnızca planlı masraflar ödenmiş olarak işaretlenebilir.';
  end if;

  if p_payment_method = 'cash' then
    if p_cash_account_id is null then
      raise exception 'Nakit ödeme için bir kasa hesabı seçilmelidir.';
    end if;

    if not exists (
      select 1 from public.cash_accounts
      where id = p_cash_account_id
        and organization_id = v_organization_id
        and is_active = true
    ) then
      raise exception 'Kasa hesabı bulunamadı.';
    end if;

    insert into public.cash_movements (
      organization_id, cash_account_id, movement_type, amount, direction,
      occurred_at, note, recorded_by
    )
    values (
      v_organization_id, p_cash_account_id, 'cash_out'::public.cash_movement_type,
      v_expense.amount, -1, p_paid_at,
      'Masraf ödemesi' || case
        when v_expense.vendor_name is not null then ': ' || v_expense.vendor_name
        else ''
      end,
      v_user_id
    )
    returning id into v_cash_movement_id;
  end if;

  update public.expenses
  set status = 'paid'::public.expense_status,
      paid_at = p_paid_at,
      payment_method = p_payment_method::public.payment_method,
      cash_movement_id = v_cash_movement_id
  where id = p_expense_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', p_expense_id::text, 'record_payment',
    pg_catalog.jsonb_build_object('status', v_expense.status),
    pg_catalog.jsonb_build_object(
      'paid_at', p_paid_at, 'payment_method', p_payment_method,
      'cash_movement_id', v_cash_movement_id
    )
  );
end;
$$;

revoke all on function
  public.record_expense_payment(uuid, timestamptz, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.record_expense_payment(uuid, timestamptz, text, uuid)
to authenticated;

create or replace function public.cancel_expense(
  p_expense_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_expense record;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Masraf iptal etme yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'İptal için bir açıklama girilmelidir.';
  end if;

  select * into v_expense
  from public.expenses
  where id = p_expense_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Masraf kaydı bulunamadı.';
  end if;

  if v_expense.status = 'cancelled'::public.expense_status then
    raise exception 'Bu masraf zaten iptal edilmiş.';
  end if;

  if v_expense.cash_movement_id is not null then
    perform public.reverse_cash_movement(
      v_expense.cash_movement_id,
      'Masraf iptali: ' || v_reason
    );
  end if;

  update public.expenses
  set status = 'cancelled'::public.expense_status,
      cancelled_at = pg_catalog.now(),
      cancel_reason = v_reason
  where id = p_expense_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', p_expense_id::text, 'cancel',
    pg_catalog.jsonb_build_object('status', v_expense.status),
    pg_catalog.jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke all on function
  public.cancel_expense(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.cancel_expense(uuid, text)
to authenticated;

create or replace function public.set_expense_document(
  p_expense_id uuid,
  p_document_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_document_path text := nullif(pg_catalog.btrim(coalesce(p_document_path, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Belge ekleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.expenses
    where id = p_expense_id and organization_id = v_organization_id
  ) then
    raise exception 'Masraf kaydı bulunamadı.';
  end if;

  update public.expenses
  set document_path = v_document_path
  where id = p_expense_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', p_expense_id::text, 'set_document',
    null, pg_catalog.jsonb_build_object('document_path', v_document_path)
  );
end;
$$;

revoke all on function
  public.set_expense_document(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.set_expense_document(uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 4) Tekrarlayan masraf şablonları (RPC üzerinden — courses/
-- expense_categories'e çapraz-organizasyon FK riski nedeniyle
-- doğrudan RLS insert yerine burada da kurum/kategori/ders eşleşmesi
-- açıkça doğrulanıyor).
-- ---------------------------------------------------------------

create or replace function public.create_recurring_expense_template(
  p_category_id uuid,
  p_amount numeric,
  p_due_day integer,
  p_course_id uuid default null,
  p_vendor_name text default null,
  p_payment_method text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_template_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Tekrarlayan masraf şablonu oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  if p_due_day is null or p_due_day < 1 or p_due_day > 28 then
    raise exception 'Vade günü 1 ile 28 arasında olmalıdır.';
  end if;

  if p_payment_method is not null
     and p_payment_method not in ('cash', 'bank_transfer', 'card', 'online', 'other') then
    raise exception 'Geçerli bir ödeme yöntemi seçilmelidir.';
  end if;

  if not exists (
    select 1 from public.expense_categories
    where id = p_category_id and organization_id = v_organization_id
  ) then
    raise exception 'Masraf kategorisi bulunamadı.';
  end if;

  if p_course_id is not null and not exists (
    select 1 from public.courses
    where id = p_course_id and organization_id = v_organization_id
  ) then
    raise exception 'Ders bulunamadı.';
  end if;

  insert into public.recurring_expense_templates (
    organization_id, category_id, course_id, vendor_name, amount, due_day,
    payment_method, note
  )
  values (
    v_organization_id, p_category_id, p_course_id,
    nullif(pg_catalog.btrim(coalesce(p_vendor_name, '')), ''),
    p_amount, p_due_day,
    p_payment_method::public.payment_method,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), '')
  )
  returning id into v_template_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'recurring_expense_templates', v_template_id::text,
    'create', null,
    pg_catalog.jsonb_build_object('category_id', p_category_id, 'amount', p_amount)
  );

  return v_template_id;
end;
$$;

revoke all on function
  public.create_recurring_expense_template(uuid, numeric, integer, uuid, text, text, text)
from public, anon, authenticated;
grant execute on function
  public.create_recurring_expense_template(uuid, numeric, integer, uuid, text, text, text)
to authenticated;

create or replace function public.set_recurring_expense_template_active(
  p_template_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Şablon durumu değiştirme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.recurring_expense_templates
    where id = p_template_id and organization_id = v_organization_id
  ) then
    raise exception 'Şablon bulunamadı.';
  end if;

  update public.recurring_expense_templates
  set is_active = p_is_active
  where id = p_template_id and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'recurring_expense_templates', p_template_id::text,
    'set_active', null, pg_catalog.jsonb_build_object('is_active', p_is_active)
  );
end;
$$;

revoke all on function
  public.set_recurring_expense_template_active(uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.set_recurring_expense_template_active(uuid, boolean)
to authenticated;

-- Şablonlardan seçilen ay için gerçek masraf satırları üretir. Aynı
-- şablon aynı dönem için tekrar çalıştırılırsa mükerrer satır
-- oluşmaz (expenses_template_period_unique).

create or replace function public.generate_monthly_expenses(
  p_month_start date
)
returns table (
  created_count integer,
  existing_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_month_end date;
  v_expected_count integer := 0;
  v_created_count integer := 0;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Aylık masraf oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_month_start is null then
    raise exception 'Masrafların oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start := pg_catalog.date_trunc('month', p_month_start::timestamp)::date;
  v_month_end := (
    pg_catalog.date_trunc('month', p_month_start::timestamp)
    + interval '1 month' - interval '1 day'
  )::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':expenses:' || v_month_start::text, 2026081401
    )
  );

  select count(*)::integer
  into v_expected_count
  from public.recurring_expense_templates t
  where t.organization_id = v_organization_id
    and t.is_active = true;

  with inserted as (
    insert into public.expenses (
      organization_id, category_id, course_id, template_id, period_start,
      expense_date, due_date, amount, status, vendor_name, payment_method,
      note, is_recurring, recorded_by
    )
    select
      t.organization_id, t.category_id, t.course_id, t.id, v_month_start,
      v_month_start,
      least((v_month_start + ((t.due_day - 1) || ' days')::interval)::date, v_month_end),
      t.amount, 'planned'::public.expense_status, t.vendor_name, t.payment_method,
      t.note, true, v_user_id
    from public.recurring_expense_templates t
    where t.organization_id = v_organization_id
      and t.is_active = true
    on conflict (template_id, period_start) where template_id is not null do nothing
    returning 1
  )
  select count(*)::integer into v_created_count from inserted;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'expenses', v_month_start::text, 'generate_month', null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'created_count', v_created_count,
      'existing_count', greatest(v_expected_count - v_created_count, 0)
    )
  );

  return query
  select v_created_count, greatest(v_expected_count - v_created_count, 0);
end;
$$;

revoke all on function public.generate_monthly_expenses(date)
from public, anon, authenticated;
grant execute on function public.generate_monthly_expenses(date)
to authenticated;

-- ---------------------------------------------------------------
-- 5) Raporlama — gelir tahakkuk raporuyla AYNI filtre mantığını
-- kullanır (get_dashboard_financial_summary/get_dashboard_course_performance
-- ile tutarlı kalması için), masraf tarafını ekler.
-- ---------------------------------------------------------------

create or replace function public.get_monthly_profitability_summary(
  p_month_start date default null
)
returns table (
  revenue_accrued numeric,
  direct_expenses numeric,
  indirect_expenses numeric,
  total_expenses numeric,
  expenses_paid_cash numeric,
  gross_result numeric,
  net_result numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_next_month_start date;
  v_revenue numeric(12,2);
  v_direct numeric(12,2);
  v_indirect numeric(12,2);
  v_paid_cash numeric(12,2);
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  select coalesce(sum(a.net_amount), 0)
  into v_revenue
  from public.accruals a
  where a.organization_id = v_organization_id
    and a.period_start = v_month_start
    and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status);

  select coalesce(sum(ex.amount), 0)
  into v_direct
  from public.expenses ex
  where ex.organization_id = v_organization_id
    and ex.course_id is not null
    and ex.status <> 'cancelled'::public.expense_status
    and ex.expense_date >= v_month_start
    and ex.expense_date < v_next_month_start;

  select coalesce(sum(ex.amount), 0)
  into v_indirect
  from public.expenses ex
  where ex.organization_id = v_organization_id
    and ex.course_id is null
    and ex.status <> 'cancelled'::public.expense_status
    and ex.expense_date >= v_month_start
    and ex.expense_date < v_next_month_start;

  select coalesce(sum(ex.amount), 0)
  into v_paid_cash
  from public.expenses ex
  where ex.organization_id = v_organization_id
    and ex.status = 'paid'::public.expense_status
    and ex.paid_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
    and ex.paid_at < (v_next_month_start::timestamp at time zone 'Europe/Istanbul');

  return query
  select
    v_revenue,
    v_direct,
    v_indirect,
    v_direct + v_indirect,
    v_paid_cash,
    v_revenue - v_direct,
    v_revenue - (v_direct + v_indirect);
end;
$$;

revoke all on function public.get_monthly_profitability_summary(date)
from public, anon, authenticated;
grant execute on function public.get_monthly_profitability_summary(date)
to authenticated;

create or replace function public.get_course_contribution_margins(
  p_month_start date default null
)
returns table (
  course_id uuid,
  course_name text,
  revenue numeric,
  direct_expenses numeric,
  contribution_margin numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_next_month_start date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  return query
  with revenue as (
    select e.course_id as cid, sum(a.net_amount) as amount
    from public.enrollments e
    inner join public.accruals a on a.enrollment_id = e.id
    where e.organization_id = v_organization_id
      and a.organization_id = v_organization_id
      and a.period_start = v_month_start
      and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    group by e.course_id
  ),
  direct_costs as (
    select ex.course_id as cid, sum(ex.amount) as amount
    from public.expenses ex
    where ex.organization_id = v_organization_id
      and ex.course_id is not null
      and ex.status <> 'cancelled'::public.expense_status
      and ex.expense_date >= v_month_start
      and ex.expense_date < v_next_month_start
    group by ex.course_id
  )
  select
    c.id,
    c.name,
    coalesce(revenue.amount, 0),
    coalesce(direct_costs.amount, 0),
    coalesce(revenue.amount, 0) - coalesce(direct_costs.amount, 0)
  from public.courses c
  left join revenue on revenue.cid = c.id
  left join direct_costs on direct_costs.cid = c.id
  where c.organization_id = v_organization_id
    and (revenue.cid is not null or direct_costs.cid is not null)
  order by (coalesce(revenue.amount, 0) - coalesce(direct_costs.amount, 0)) desc;
end;
$$;

revoke all on function public.get_course_contribution_margins(date)
from public, anon, authenticated;
grant execute on function public.get_course_contribution_margins(date)
to authenticated;

create or replace function public.get_monthly_expenses_by_category(
  p_month_start date default null
)
returns table (
  category_id uuid,
  category_name text,
  planned_amount numeric,
  paid_amount numeric,
  cancelled_amount numeric,
  total_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
  v_next_month_start date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  return query
  select
    ec.id,
    ec.name,
    coalesce(sum(ex.amount) filter (where ex.status = 'planned'::public.expense_status), 0),
    coalesce(sum(ex.amount) filter (where ex.status = 'paid'::public.expense_status), 0),
    coalesce(sum(ex.amount) filter (where ex.status = 'cancelled'::public.expense_status), 0),
    count(ex.id)::integer
  from public.expense_categories ec
  inner join public.expenses ex
    on ex.category_id = ec.id
    and ex.organization_id = v_organization_id
    and ex.expense_date >= v_month_start
    and ex.expense_date < v_next_month_start
  where ec.organization_id = v_organization_id
  group by ec.id, ec.name
  order by sum(ex.amount) desc;
end;
$$;

revoke all on function public.get_monthly_expenses_by_category(date)
from public, anon, authenticated;
grant execute on function public.get_monthly_expenses_by_category(date)
to authenticated;

-- ---------------------------------------------------------------
-- 6) Belge deposu (makbuz/fatura) — özel (private), yalnızca admin.
-- ---------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('expense-documents', 'expense-documents', false)
on conflict (id) do nothing;

drop policy if exists "expense_documents_admin_access" on storage.objects;

create policy "expense_documents_admin_access"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'expense-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.is_admin()
)
with check (
  bucket_id = 'expense-documents'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.is_admin()
);

notify pgrst, 'reload schema';
