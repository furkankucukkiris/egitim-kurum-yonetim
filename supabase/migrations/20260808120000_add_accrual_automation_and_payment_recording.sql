-- Kayıt anında otomatik tahakkuk, aylık tahakkuk üretimi ve tek işlemde
-- ödeme kaydı + tahsilat dağıtımı.

create or replace function public.tr_month_name(p_month integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select (array[
    'Ocak','Şubat','Mart','Nisan','Mayıs','Haziran',
    'Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'
  ])[p_month];
$$;

-- 1) Yeni ders kaydı oluşturulduğunda, kaydın başladığı ay için
--    otomatik olarak "ödenmedi" (open) durumunda bir tahakkuk oluşturur.

create or replace function public.create_initial_accrual_for_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start date :=
    pg_catalog.date_trunc('month', new.starts_on::timestamp)::date;
  v_month_end date :=
    (
      pg_catalog.date_trunc('month', new.starts_on::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;
  v_due_date date;
begin
  v_due_date := least(
    (v_period_start + ((new.due_day - 1) || ' days')::interval)::date,
    v_month_end
  );

  insert into public.accruals (
    organization_id,
    enrollment_id,
    student_id,
    period_start,
    due_date,
    description,
    gross_amount,
    discount_amount,
    net_amount,
    status
  )
  values (
    new.organization_id,
    new.id,
    new.student_id,
    v_period_start,
    v_due_date,
    public.tr_month_name(extract(month from v_period_start)::integer)
      || ' ' || extract(year from v_period_start)::text || ' aidatı',
    new.list_monthly_fee,
    new.list_monthly_fee - new.net_monthly_fee,
    new.net_monthly_fee,
    'open'::public.accrual_status
  )
  on conflict (enrollment_id, period_start) do nothing;

  return new;
end;
$$;

drop trigger if exists enrollments_create_initial_accrual on public.enrollments;

create trigger enrollments_create_initial_accrual
after insert on public.enrollments
for each row execute function public.create_initial_accrual_for_enrollment();

-- 2) Seçilen ay için, o ay hâlâ aktif olan tüm kayıtların tahakkukunu
--    oluşturur. Aynı işlem tekrar çalıştırılırsa mükerrer tahakkuk oluşmaz.

create or replace function public.generate_monthly_accruals(
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
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Aylık tahakkuk oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_month_start is null then
    raise exception
      'Tahakkukların oluşturulacağı ay seçilmelidir.';
  end if;

  v_month_start :=
    pg_catalog.date_trunc('month', p_month_start::timestamp)::date;

  v_month_end :=
    (
      pg_catalog.date_trunc('month', p_month_start::timestamp)
      + interval '1 month'
      - interval '1 day'
    )::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':accrual:' || v_month_start::text,
      2026080812
    )
  );

  select count(*)::integer
  into v_expected_count
  from public.enrollments e
  where e.organization_id = v_organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= v_month_end
    and (e.ends_on is null or e.ends_on >= v_month_start);

  with inserted as (
    insert into public.accruals (
      organization_id,
      enrollment_id,
      student_id,
      period_start,
      due_date,
      description,
      gross_amount,
      discount_amount,
      net_amount,
      status
    )
    select
      e.organization_id,
      e.id,
      e.student_id,
      v_month_start,
      least(
        (v_month_start + ((e.due_day - 1) || ' days')::interval)::date,
        v_month_end
      ),
      public.tr_month_name(extract(month from v_month_start)::integer)
        || ' ' || extract(year from v_month_start)::text || ' aidatı',
      e.list_monthly_fee,
      e.list_monthly_fee - e.net_monthly_fee,
      e.net_monthly_fee,
      'open'::public.accrual_status
    from public.enrollments e
    where e.organization_id = v_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_month_end
      and (e.ends_on is null or e.ends_on >= v_month_start)
    on conflict (enrollment_id, period_start) do nothing
    returning 1
  )
  select count(*)::integer into v_created_count from inserted;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'accruals', v_month_start::text,
    'generate_month', null,
    pg_catalog.jsonb_build_object(
      'month_start', v_month_start,
      'month_end', v_month_end,
      'created_count', v_created_count,
      'existing_count', greatest(v_expected_count - v_created_count, 0)
    )
  );

  return query
  select v_created_count, greatest(v_expected_count - v_created_count, 0);
end;
$$;

-- 3) Bir öğrencinin belirli bir dersteki bekleyen tahakkuklarına, en eski
--    dönemden başlayarak girilen tutarı dağıtır ve ödeme kaydı oluşturur.
--    Girilen tutar bekleyenden az ise dönem "kısmi" kalır; fazla ise
--    kalan tutar sıradaki bekleyen döneme aktarılır.

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
      'unallocated_remainder', v_remaining
    )
  );

  return v_payment_id;
end;
$$;

-- Tahakkuk ve ödeme tabloları yalnızca kontrollü fonksiyonlar üzerinden
-- yazılabilsin (ders kayıtlarındaki mevcut desenle aynı).

revoke insert, update, delete on public.accruals from authenticated;
grant select on public.accruals to authenticated;

revoke insert, update, delete on public.payments from authenticated;
grant select on public.payments to authenticated;

revoke insert, update, delete on public.payment_allocations from authenticated;
grant select on public.payment_allocations to authenticated;

revoke all on function public.generate_monthly_accruals(date)
from public, anon;
grant execute on function public.generate_monthly_accruals(date)
to authenticated;

revoke all on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text)
from public, anon;
grant execute on function
  public.record_payment_for_course(uuid, uuid, numeric, text, text)
to authenticated;

notify pgrst, 'reload schema';
