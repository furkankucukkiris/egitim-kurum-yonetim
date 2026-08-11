-- get_accrual_report_monthly / get_cash_flow_report_monthly
-- (20260811140000) kullanılırken hata verdi: `date - date` Postgres'te
-- integer (gün farkı) döner, interval değil — "(v_end - v_start) >
-- interval '36 months'" karşılaştırması "operator does not exist:
-- integer > interval" hatasıyla patlıyordu. Ay farkını doğrudan
-- yıl/ay bileşenlerinden hesaplayan bir aralık kontrolüyle
-- değiştiriliyor.

create or replace function public.get_accrual_report_monthly(
  p_start_month date,
  p_end_month date,
  p_course_id uuid default null,
  p_student_status text default null
)
returns table (
  month_start date,
  accrued numeric,
  collected numeric,
  open_amount numeric,
  partial_amount numeric,
  overdue_amount numeric,
  paid_amount numeric,
  open_count integer,
  partial_count integer,
  overdue_count integer,
  paid_count integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_start date;
  v_end date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_student_status is not null
    and p_student_status not in ('active', 'frozen', 'left', 'archived') then
    raise exception 'Geçersiz öğrenci durumu filtresi.';
  end if;

  v_end := pg_catalog.date_trunc(
    'month',
    coalesce(p_end_month, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;
  v_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_start_month, v_end - interval '5 months')::timestamp
  )::date;

  if v_start > v_end then
    raise exception 'Başlangıç ayı bitiş ayından sonra olamaz.';
  end if;

  if (
    (extract(year from v_end) - extract(year from v_start)) * 12
    + (extract(month from v_end) - extract(month from v_start))
  ) > 35 then
    raise exception 'Rapor aralığı en fazla 36 ay olabilir.';
  end if;

  return query
  select
    m.month_start,
    coalesce(sum(a.net_amount), 0),
    coalesce(sum(a.allocated_amount), 0),
    coalesce(sum(a.net_amount - a.allocated_amount)
      filter (where a.status = 'open'::public.accrual_status), 0),
    coalesce(sum(a.net_amount - a.allocated_amount)
      filter (where a.status = 'partial'::public.accrual_status), 0),
    coalesce(sum(a.net_amount - a.allocated_amount)
      filter (where a.status = 'overdue'::public.accrual_status), 0),
    coalesce(sum(a.net_amount)
      filter (where a.status = 'paid'::public.accrual_status), 0),
    count(*) filter (where a.status = 'open'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'partial'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'overdue'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'paid'::public.accrual_status)::integer
  from (
    select generate_series(v_start, v_end, interval '1 month')::date as month_start
  ) m
  left join public.accruals a
    on a.period_start = m.month_start
    and a.organization_id = v_organization_id
    and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    and (
      p_course_id is null
      or exists (
        select 1 from public.enrollments e
        where e.id = a.enrollment_id and e.course_id = p_course_id
      )
    )
    and (
      p_student_status is null
      or exists (
        select 1 from public.students s
        where s.id = a.student_id and s.status = p_student_status::public.record_status
      )
    )
  group by m.month_start
  order by m.month_start;
end;
$$;

create or replace function public.get_cash_flow_report_monthly(
  p_start_month date,
  p_end_month date,
  p_course_id uuid default null,
  p_method text default null,
  p_student_status text default null
)
returns table (
  month_start date,
  cash_in numeric,
  refunds numeric,
  expenses_paid numeric,
  net_cash numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_start date;
  v_end date;
  v_end_exclusive date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu raporu görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_method is not null
    and p_method not in ('cash', 'bank_transfer', 'card', 'online', 'other') then
    raise exception 'Geçersiz ödeme yöntemi filtresi.';
  end if;

  if p_student_status is not null
    and p_student_status not in ('active', 'frozen', 'left', 'archived') then
    raise exception 'Geçersiz öğrenci durumu filtresi.';
  end if;

  v_end := pg_catalog.date_trunc(
    'month',
    coalesce(p_end_month, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;
  v_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_start_month, v_end - interval '5 months')::timestamp
  )::date;
  v_end_exclusive := (v_end + interval '1 month')::date;

  if v_start > v_end then
    raise exception 'Başlangıç ayı bitiş ayından sonra olamaz.';
  end if;

  if (
    (extract(year from v_end) - extract(year from v_start)) * 12
    + (extract(month from v_end) - extract(month from v_start))
  ) > 35 then
    raise exception 'Rapor aralığı en fazla 36 ay olabilir.';
  end if;

  return query
  with months as (
    select generate_series(v_start, v_end, interval '1 month')::date as month_start
  ),
  cash as (
    select
      pg_catalog.date_trunc('month', p.received_at at time zone 'Europe/Istanbul')::date as month_start,
      sum(p.amount) as amount
    from public.payments p
    where p.organization_id = v_organization_id
      and p.received_at >= (v_start::timestamp at time zone 'Europe/Istanbul')
      and p.received_at < (v_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (p_method is null or p.method = p_method::public.payment_method)
      and (p_course_id is null or p.course_id = p_course_id)
      and (
        p_student_status is null
        or exists (
          select 1 from public.students s
          where s.id = p.student_id and s.status = p_student_status::public.record_status
        )
      )
    group by 1
  ),
  refund as (
    select
      pg_catalog.date_trunc('month', pr.created_at at time zone 'Europe/Istanbul')::date as month_start,
      sum(pr.amount) as amount
    from public.payment_refunds pr
    inner join public.payments p on p.id = pr.payment_id
    where pr.organization_id = v_organization_id
      and pr.created_at >= (v_start::timestamp at time zone 'Europe/Istanbul')
      and pr.created_at < (v_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (p_method is null or p.method = p_method::public.payment_method)
      and (p_course_id is null or p.course_id = p_course_id)
      and (
        p_student_status is null
        or exists (
          select 1 from public.students s
          where s.id = p.student_id and s.status = p_student_status::public.record_status
        )
      )
    group by 1
  ),
  expense as (
    select
      pg_catalog.date_trunc('month', ex.paid_at at time zone 'Europe/Istanbul')::date as month_start,
      sum(ex.amount) as amount
    from public.expenses ex
    where ex.organization_id = v_organization_id
      and ex.status = 'paid'::public.expense_status
      and ex.paid_at is not null
      and ex.paid_at >= (v_start::timestamp at time zone 'Europe/Istanbul')
      and ex.paid_at < (v_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (p_course_id is null or ex.course_id = p_course_id)
    group by 1
  )
  select
    m.month_start,
    coalesce(c.amount, 0),
    coalesce(r.amount, 0),
    coalesce(ex.amount, 0),
    coalesce(c.amount, 0) - coalesce(r.amount, 0) - coalesce(ex.amount, 0)
  from months m
  left join cash c on c.month_start = m.month_start
  left join refund r on r.month_start = m.month_start
  left join expense ex on ex.month_start = m.month_start
  order by m.month_start;
end;
$$;

notify pgrst, 'reload schema';
