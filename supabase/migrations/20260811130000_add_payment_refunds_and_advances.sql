-- Ödeme düzeltme, iade ve öğrenci avansı yönetimi.
--
-- Tasarım (kısa özet, ayrıntı README'de):
--   * payments / payment_allocations HİÇBİR ZAMAN silinmez veya
--     mutasyona uğratılmaz — iş kuralının "fiziksel delete yok"
--     talebini, geçmiş finansal kayıtları da hiç değiştirmeme
--     ilkesine genişletiyoruz. Bunun yerine YENİ, ekleme-yalnızca
--     (append-only) iki ledger tablosu: payment_refunds (bir ödemeye
--     karşı her iade/ters işlem OLAYI) ve payment_refund_allocations
--     (o iadenin, ödemenin hangi tahakkuk tahsislerini ne kadar geri
--     aldığı — payment_allocations'ın simetriği).
--   * accruals.allocated_amount/status CANLI durumdur (ledger'dan
--     türeyen, sürekli güncellenen bir özet) — iade olduğunda bu
--     GERİ HESAPLANIR, çünkü "İade sonrası tahakkuk tekrar doğru
--     açık/kısmi duruma döner" kabul kriteri tam olarak bunu istiyor.
--     Bu bir "silme" değil, güncel durumu doğru tutmaktır.
--   * Bir iade önce ödemenin DAĞITILMAMIŞ (avans) kısmından düşer;
--     yalnızca o yetmezse, EN YENİ dönemden başlayarak (en eski
--     borcu "tekrar açma" riskini en aza indirmek için) tahsisleri
--     geri alır. Bu sıralama kararı bilinçli ve README'de belgeli.
--   * Avans, yalnızca admin'in açıkça çağırdığı
--     allocate_student_advance() ile bir hedef tahakkuka uygulanır —
--     otomatik/arka planda kural bazlı dağıtım YOK; parayı sessizce
--     hareket ettiren bir arka plan işi, yanlış tahakkuka
--     uygulanırsa fark edilmesi zor bir hata sınıfı yaratır. "Admin
--     onayıyla" yolu seçildi, "tanımlı kural" yolu bilinçli olarak
--     uygulanmadı.
--   * Aynı ödeme için toplam iade asla ödeme tutarını aşamaz —
--     payments satırı FOR UPDATE kilitlenip mevcut toplam iade bu
--     kilit altında hesaplanarak kontrol edilir (eşzamanlı iki iade
--     çağrısı aynı satırda sıraya girer, ikincisi güncel toplamı
--     görür).
--   * Teacher bu tabloların/RPC'lerin hiçbirine erişemez — mevcut
--     payments/accruals/payment_allocations zaten yalnızca admin'e
--     açıktı (can_manage_finance() = is_admin(), 20260810130000);
--     yeni tablolar aynı deseni izliyor.

-- =========================================================
-- 1. Şema: enum, yeni sütunlar, ledger tabloları.
-- =========================================================

create type public.payment_refund_type as enum ('reversal', 'refund');

-- receipt_number: otomatik üretilen, kurum içi sıralı makbuz no
-- ("YYYY-000123"). Mevcut reference_number sütunundan farklı bir
-- amaca hizmet eder — reference_number banka/kart referansı gibi
-- serbest metin, receipt_number ise sistemin kendi ürettiği,
-- benzersiz makbuz numarasıdır.
alter table public.payments
  add column if not exists receipt_number text,
  add column if not exists course_id uuid references public.courses(id);

create unique index if not exists payments_receipt_number_unique
on public.payments (organization_id, receipt_number)
where receipt_number is not null;

alter table public.organizations
  add column if not exists next_receipt_number integer not null default 1;

create table public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  payment_id uuid not null references public.payments(id),
  amount numeric(12,2) not null check (amount > 0),
  refund_type public.payment_refund_type not null,
  reason text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index payment_refunds_payment_idx on public.payment_refunds (payment_id);
create index payment_refunds_org_idx on public.payment_refunds (organization_id, created_at);

create table public.payment_refund_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  refund_id uuid not null references public.payment_refunds(id),
  accrual_id uuid not null references public.accruals(id),
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index payment_refund_allocations_refund_idx on public.payment_refund_allocations (refund_id);
create index payment_refund_allocations_accrual_idx on public.payment_refund_allocations (accrual_id);

-- =========================================================
-- 2. RLS: mevcut payments/accruals/payment_allocations deseniyle
--    birebir aynı — yalnızca admin, doğrudan insert/update/delete
--    yok (tüm yazmalar aşağıdaki RPC'lerden geçer). Teacher hiçbir
--    şekilde erişemez.
-- =========================================================

alter table public.payment_refunds enable row level security;
alter table public.payment_refund_allocations enable row level security;

create policy payment_refunds_admin_select
on public.payment_refunds
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

create policy payment_refund_allocations_admin_select
on public.payment_refund_allocations
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete on public.payment_refunds from authenticated;
revoke insert, update, delete on public.payment_refund_allocations from authenticated;

-- =========================================================
-- 3. record_payment_for_course(): aynı davranış + artık receipt_number
--    ve course_id de yazıyor. (20260808120000'daki orijinali
--    değiştirilmedi, burada yeniden tanımlanıyor.)
-- =========================================================

create or replace function public.record_payment_for_course(
  p_student_id uuid,
  p_course_id uuid,
  p_amount numeric,
  p_method text,
  p_note text
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
  v_remaining numeric(12,2);
  v_accrual record;
  v_allocate numeric(12,2);
  v_receipt_counter integer;
  v_receipt_number text;
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

  update public.organizations
  set next_receipt_number = next_receipt_number + 1
  where id = v_organization_id
  returning next_receipt_number - 1 into v_receipt_counter;

  v_receipt_number :=
    to_char(pg_catalog.now() at time zone 'Europe/Istanbul', 'YYYY')
    || '-' || lpad(v_receipt_counter::text, 6, '0');

  insert into public.payments (
    organization_id, student_id, course_id, received_at, amount, method,
    note, recorded_by, receipt_number
  )
  values (
    v_organization_id, p_student_id, p_course_id, pg_catalog.now(), p_amount,
    p_method::public.payment_method,
    nullif(pg_catalog.btrim(coalesce(p_note, '')), ''),
    v_user_id, v_receipt_number
  )
  returning id into v_payment_id;

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
      'receipt_number', v_receipt_number,
      'unallocated_remainder', v_remaining
    )
  );

  return v_payment_id;
end;
$$;

-- =========================================================
-- 4. refund_payment(): tam/kısmi iade veya ters işlem. Önce avans
--    (dağıtılmamış) kısımdan düşer; kalan varsa en yeni dönemden
--    başlayarak tahsisleri geri alır ve accrual durumunu günceller.
-- =========================================================

create or replace function public.refund_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_refund_type text default 'refund'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_payment record;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_allocated_total numeric(12,2);
  v_refunded_total numeric(12,2);
  v_available_to_refund numeric(12,2);
  v_unallocated numeric(12,2);
  v_remaining numeric(12,2);
  v_refund_id uuid;
  v_alloc record;
  v_reverse numeric(12,2);
  v_current_allocated numeric(12,2);
  v_net_amount numeric(12,2);
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Ödeme iadesi/ters işlem yetkiniz bulunmuyor.';
  end if;

  if p_refund_type not in ('reversal', 'refund') then
    raise exception 'Geçersiz iade türü.';
  end if;

  if v_reason is null then
    raise exception 'İade/ters işlem gerekçesi zorunludur.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  -- Ödeme satırını kilitle: eşzamanlı iki iade çağrısı burada
  -- sıraya girer, ikincisi güncel (birincinin eklediği) toplam iade
  -- tutarını görür — "aynı ödeme için toplam iade, ödeme tutarını
  -- aşamaz" garantisi bu kilide dayanır.
  select p.id, p.amount
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.organization_id = v_organization_id
  for update;

  if v_payment.id is null then
    raise exception 'Ödeme kaydı bulunamadı.';
  end if;

  select coalesce(sum(amount), 0) into v_allocated_total
  from public.payment_allocations
  where payment_id = p_payment_id;

  select coalesce(sum(amount), 0) into v_refunded_total
  from public.payment_refunds
  where payment_id = p_payment_id;

  v_available_to_refund := v_payment.amount - v_refunded_total;

  if p_amount > v_available_to_refund + 0.01 then
    raise exception 'İade tutarı, ödemenin kalan iade edilebilir tutarını aşamaz.';
  end if;

  insert into public.payment_refunds (
    organization_id, payment_id, amount, refund_type, reason, created_by
  )
  values (
    v_organization_id, p_payment_id, p_amount,
    p_refund_type::public.payment_refund_type, v_reason, v_user_id
  )
  returning id into v_refund_id;

  v_unallocated := greatest(0, v_payment.amount - v_allocated_total - v_refunded_total);
  v_remaining := p_amount;

  if v_unallocated > 0 then
    v_remaining := v_remaining - least(v_remaining, v_unallocated);
  end if;

  if v_remaining > 0.01 then
    for v_alloc in
      select
        pa.accrual_id,
        a.period_start,
        sum(pa.amount) as total_allocated,
        coalesce((
          select sum(pra.amount)
          from public.payment_refund_allocations pra
          inner join public.payment_refunds pr on pr.id = pra.refund_id
          where pr.payment_id = p_payment_id
            and pra.accrual_id = pa.accrual_id
        ), 0) as already_reversed
      from public.payment_allocations pa
      inner join public.accruals a on a.id = pa.accrual_id
      where pa.payment_id = p_payment_id
      group by pa.accrual_id, a.period_start
      order by a.period_start desc
    loop
      exit when v_remaining <= 0.01;

      v_reverse := least(v_remaining, v_alloc.total_allocated - v_alloc.already_reversed);

      if v_reverse > 0.01 then
        insert into public.payment_refund_allocations (
          organization_id, refund_id, accrual_id, amount
        )
        values (
          v_organization_id, v_refund_id, v_alloc.accrual_id, v_reverse
        );

        select allocated_amount, net_amount
        into v_current_allocated, v_net_amount
        from public.accruals
        where id = v_alloc.accrual_id
        for update;

        v_current_allocated := greatest(0, v_current_allocated - v_reverse);

        update public.accruals
        set allocated_amount = v_current_allocated,
            status = case
              when v_current_allocated <= 0.01 then 'open'::public.accrual_status
              when v_current_allocated < v_net_amount then 'partial'::public.accrual_status
              else status
            end
        where id = v_alloc.accrual_id;

        v_remaining := v_remaining - v_reverse;
      end if;
    end loop;
  end if;

  if v_refunded_total + p_amount >= v_payment.amount - 0.01 then
    update public.payments set is_refunded = true where id = p_payment_id;
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'payments', p_payment_id::text,
    p_refund_type,
    jsonb_build_object('previously_refunded', v_refunded_total),
    jsonb_build_object('refund_id', v_refund_id, 'amount', p_amount, 'reason', v_reason)
  );

  return v_refund_id;
end;
$$;

-- =========================================================
-- 5. allocate_student_advance(): bir ödemenin dağıtılmamış (avans)
--    kısmını, admin'in seçtiği belirli bir tahakkuka uygular.
--    Otomatik/arka planda çalışan bir kural YOK — yalnızca bu
--    doğrudan admin çağrısı.
-- =========================================================

create or replace function public.allocate_student_advance(
  p_payment_id uuid,
  p_accrual_id uuid,
  p_amount numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_payment record;
  v_accrual record;
  v_allocated_total numeric(12,2);
  v_refunded_total numeric(12,2);
  v_available numeric(12,2);
  v_pending numeric(12,2);
  v_allocate numeric(12,2);
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Avans dağıtma yetkiniz bulunmuyor.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Geçerli bir tutar girilmelidir.';
  end if;

  select p.id, p.amount, p.student_id
  into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.organization_id = v_organization_id
  for update;

  if v_payment.id is null then
    raise exception 'Ödeme kaydı bulunamadı.';
  end if;

  select a.id, a.net_amount, a.allocated_amount, a.student_id
  into v_accrual
  from public.accruals a
  where a.id = p_accrual_id
    and a.organization_id = v_organization_id
  for update;

  if v_accrual.id is null then
    raise exception 'Tahakkuk kaydı bulunamadı.';
  end if;

  if v_accrual.student_id <> v_payment.student_id then
    raise exception 'Avans yalnızca aynı öğrencinin bir tahakkukuna uygulanabilir.';
  end if;

  select coalesce(sum(amount), 0) into v_allocated_total
  from public.payment_allocations where payment_id = p_payment_id;

  select coalesce(sum(amount), 0) into v_refunded_total
  from public.payment_refunds where payment_id = p_payment_id;

  v_available := v_payment.amount - v_allocated_total - v_refunded_total;

  if p_amount > v_available + 0.01 then
    raise exception 'Bu ödemenin dağıtılmamış (avans) tutarı yetersiz.';
  end if;

  v_pending := v_accrual.net_amount - v_accrual.allocated_amount;

  if v_pending <= 0.01 then
    raise exception 'Seçilen tahakkukta bekleyen bakiye yok.';
  end if;

  v_allocate := least(p_amount, v_pending);

  insert into public.payment_allocations (
    organization_id, payment_id, accrual_id, amount
  )
  values (
    v_organization_id, p_payment_id, p_accrual_id, v_allocate
  );

  update public.accruals
  set allocated_amount = allocated_amount + v_allocate,
      status = case
        when allocated_amount + v_allocate >= net_amount
          then 'paid'::public.accrual_status
        else 'partial'::public.accrual_status
      end
  where id = p_accrual_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'payment_allocations', p_payment_id::text,
    'allocate_advance', null,
    jsonb_build_object(
      'payment_id', p_payment_id,
      'accrual_id', p_accrual_id,
      'requested_amount', p_amount,
      'applied_amount', v_allocate
    )
  );

  return v_allocate;
end;
$$;

-- =========================================================
-- 6. Admin ödeme detay sayfası için üç dar RPC.
-- =========================================================

create or replace function public.get_payment_detail(p_payment_id uuid)
returns table (
  payment_id uuid,
  student_id uuid,
  student_name text,
  course_id uuid,
  course_name text,
  amount numeric,
  method public.payment_method,
  received_at timestamptz,
  note text,
  receipt_number text,
  recorded_by_name text,
  is_refunded boolean,
  allocated_total numeric,
  refunded_total numeric,
  unallocated_total numeric
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
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu ödeme detayını görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    p.id,
    p.student_id,
    s.first_name || ' ' || s.last_name,
    p.course_id,
    c.name,
    p.amount,
    p.method,
    p.received_at,
    p.note,
    p.receipt_number,
    rp.full_name,
    p.is_refunded,
    coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0),
    coalesce((select sum(pr.amount) from public.payment_refunds pr where pr.payment_id = p.id), 0),
    greatest(
      0,
      p.amount
        - coalesce((select sum(pa.amount) from public.payment_allocations pa where pa.payment_id = p.id), 0)
        - coalesce((select sum(pr.amount) from public.payment_refunds pr where pr.payment_id = p.id), 0)
    )
  from public.payments p
  inner join public.students s on s.id = p.student_id
  left join public.courses c on c.id = p.course_id
  left join public.profiles rp on rp.id = p.recorded_by
  where p.id = p_payment_id
    and p.organization_id = v_organization_id;
end;
$$;

create or replace function public.get_payment_allocations_detail(p_payment_id uuid)
returns table (
  allocation_id uuid,
  accrual_id uuid,
  period_start date,
  description text,
  amount numeric,
  reversed_amount numeric
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
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu ödeme detayını görüntüleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.payments p
    where p.id = p_payment_id and p.organization_id = v_organization_id
  ) then
    raise exception 'Ödeme kaydı bulunamadı.';
  end if;

  return query
  select
    pa.id,
    pa.accrual_id,
    a.period_start,
    a.description,
    pa.amount,
    coalesce((
      select sum(pra.amount)
      from public.payment_refund_allocations pra
      inner join public.payment_refunds pr on pr.id = pra.refund_id
      where pr.payment_id = p_payment_id
        and pra.accrual_id = pa.accrual_id
    ), 0)
  from public.payment_allocations pa
  inner join public.accruals a on a.id = pa.accrual_id
  where pa.payment_id = p_payment_id
  order by a.period_start asc;
end;
$$;

create or replace function public.get_payment_refunds_detail(p_payment_id uuid)
returns table (
  refund_id uuid,
  amount numeric,
  refund_type public.payment_refund_type,
  reason text,
  created_by_name text,
  created_at timestamptz
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
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu ödeme detayını görüntüleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.payments p
    where p.id = p_payment_id and p.organization_id = v_organization_id
  ) then
    raise exception 'Ödeme kaydı bulunamadı.';
  end if;

  return query
  select
    pr.id,
    pr.amount,
    pr.refund_type,
    pr.reason,
    prof.full_name,
    pr.created_at
  from public.payment_refunds pr
  left join public.profiles prof on prof.id = pr.created_by
  where pr.payment_id = p_payment_id
  order by pr.created_at asc;
end;
$$;

-- =========================================================
-- 7. get_dashboard_financial_summary(): iadeleri hesaba katacak
--    şekilde yeniden tanımlandı (20260811110000'deki orijinali
--    değiştirilmedi). monthly_cash_received artık gerçek nakit
--    akışı: bu ay alınan ödemeler EKSİ bu ay yapılan iadeler (hangi
--    aya ait ödemenin iade edildiğinden bağımsız — iade parası
--    kurumdan GERÇEKTEN çıktığı ayda nakit akışını düşürür).
--    student_advance_balance artık iade edilmiş kısmı da düşüyor.
-- =========================================================

create or replace function public.get_dashboard_financial_summary(
  p_month_start date default null
)
returns table (
  active_student_count integer,
  monthly_accrued numeric,
  monthly_collected numeric,
  monthly_cash_received numeric,
  prior_period_carryover numeric,
  prior_period_carryover_count integer,
  total_open_receivable numeric,
  total_open_receivable_count integer,
  student_advance_balance numeric,
  today_active_session_count integer,
  today_total_session_count integer
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
  v_today date;
  v_tomorrow date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu özeti görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_today := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_tomorrow := v_today + 1;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, v_today)::timestamp
  )::date;
  v_next_month_start := (v_month_start + interval '1 month')::date;

  return query
  select
    (
      select count(*)::integer
      from public.students s
      where s.organization_id = v_organization_id
        and s.status = 'active'::public.record_status
    ),
    (
      select coalesce(sum(a.net_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start = v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    ),
    (
      select coalesce(sum(a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start = v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    ),
    (
      select coalesce(sum(p.amount), 0)
      from public.payments p
      where p.organization_id = v_organization_id
        and p.received_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
        and p.received_at < (v_next_month_start::timestamp at time zone 'Europe/Istanbul')
    ) - (
      select coalesce(sum(pr.amount), 0)
      from public.payment_refunds pr
      where pr.organization_id = v_organization_id
        and pr.created_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
        and pr.created_at < (v_next_month_start::timestamp at time zone 'Europe/Istanbul')
    ),
    (
      select coalesce(sum(a.net_amount - a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start < v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select count(*)::integer
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start < v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select coalesce(sum(a.net_amount - a.allocated_amount), 0)
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start <= v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select count(*)::integer
      from public.accruals a
      where a.organization_id = v_organization_id
        and a.period_start <= v_month_start
        and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
        and (a.net_amount - a.allocated_amount) > 0.01
    ),
    (
      select coalesce(sum(
        greatest(
          p.amount
            - coalesce(alloc.allocated_total, 0)
            - coalesce(ref.refunded_total, 0),
          0
        )
      ), 0)
      from public.payments p
      left join (
        select pa.payment_id, sum(pa.amount) as allocated_total
        from public.payment_allocations pa
        group by pa.payment_id
      ) alloc on alloc.payment_id = p.id
      left join (
        select pr.payment_id, sum(pr.amount) as refunded_total
        from public.payment_refunds pr
        group by pr.payment_id
      ) ref on ref.payment_id = p.id
      where p.organization_id = v_organization_id
    ),
    (
      select count(*)::integer
      from public.lesson_sessions ls
      where ls.organization_id = v_organization_id
        and ls.starts_at >= (v_today::timestamp at time zone 'Europe/Istanbul')
        and ls.starts_at < (v_tomorrow::timestamp at time zone 'Europe/Istanbul')
        and ls.cancelled_at is null
    ),
    (
      select count(*)::integer
      from public.lesson_sessions ls
      where ls.organization_id = v_organization_id
        and ls.starts_at >= (v_today::timestamp at time zone 'Europe/Istanbul')
        and ls.starts_at < (v_tomorrow::timestamp at time zone 'Europe/Istanbul')
    );
end;
$$;

-- =========================================================
-- 8. Yetkiler.
-- =========================================================

revoke all on function public.record_payment_for_course(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.record_payment_for_course(uuid, uuid, numeric, text, text) to authenticated;

revoke all on function public.refund_payment(uuid, numeric, text, text) from public, anon;
grant execute on function public.refund_payment(uuid, numeric, text, text) to authenticated;

revoke all on function public.allocate_student_advance(uuid, uuid, numeric) from public, anon;
grant execute on function public.allocate_student_advance(uuid, uuid, numeric) to authenticated;

revoke all on function public.get_payment_detail(uuid) from public, anon;
grant execute on function public.get_payment_detail(uuid) to authenticated;

revoke all on function public.get_payment_allocations_detail(uuid) from public, anon;
grant execute on function public.get_payment_allocations_detail(uuid) to authenticated;

revoke all on function public.get_payment_refunds_detail(uuid) from public, anon;
grant execute on function public.get_payment_refunds_detail(uuid) to authenticated;

revoke all on function public.get_dashboard_financial_summary(date) from public, anon;
grant execute on function public.get_dashboard_financial_summary(date) to authenticated;

notify pgrst, 'reload schema';
