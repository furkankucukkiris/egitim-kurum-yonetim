-- /raporlar ekranını iki ayrı, muhasebesel olarak doğru rapora böler:
--
--   Rapor A — Tahakkuk performansı (get_accrual_report_monthly,
--   get_accrual_report_by_course): "hangi ay ne kadar tahakkuk etti,
--   bunun ne kadarı (bugüne kadar) tahsil edildi" sorusuna cevap
--   verir. period_start esas alınır, ödeme tarihi (received_at) hiç
--   karışmaz — Temmuz'un tahakkuku Ağustos'ta ödense bile Temmuz
--   ayının rakamı olarak kalır (tıpkı get_dashboard_financial_summary
--   ve /odemeler ekranının zaten yaptığı gibi).
--
--   Rapor B — Nakit akışı (get_cash_flow_report_monthly,
--   get_cash_flow_report_by_method): "bu ay kasaya gerçekten ne kadar
--   para girdi/çıktı" sorusuna cevap verir. received_at / iade
--   created_at / gider paid_at esas alınır — hangi döneme ait
--   olduğu önemli değil, paranın gerçekten hareket ettiği ay sayılır.
--   Bu, get_dashboard_financial_summary'nin monthly_cash_received
--   metriğiyle birebir aynı mantık (20260811130000).
--
-- Her iki rapor da ders, öğrenci durumu (students.status) filtresi
-- alır; nakit akışı ayrıca ödeme yöntemi filtresi de alır — bir
-- tahakkuk satırı tek bir ödeme yöntemine bağlı olmadığından (birden
-- fazla kısmi ödemeyle farklı yöntemlerle kapanabilir), yöntem
-- filtresi yalnızca nakit tarafında anlamlı.
--
-- Ay aralığı generate_series ile dolduruluyor ki veri olmayan aylar
-- da grafikte/sıfır satır olarak görünsün (sessizce atlanmasın).

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

  if (v_end - v_start) > interval '36 months' then
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

revoke all on function public.get_accrual_report_monthly(date, date, uuid, text) from public, anon;
grant execute on function public.get_accrual_report_monthly(date, date, uuid, text) to authenticated;

create or replace function public.get_accrual_report_by_course(
  p_start_month date,
  p_end_month date,
  p_course_id uuid default null,
  p_student_status text default null
)
returns table (
  course_id uuid,
  course_name text,
  accrued numeric,
  collected numeric,
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
  v_end_exclusive date;
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
  v_end_exclusive := (v_end + interval '1 month')::date;

  if v_start > v_end then
    raise exception 'Başlangıç ayı bitiş ayından sonra olamaz.';
  end if;

  return query
  select
    c.id,
    c.name,
    coalesce(sum(a.net_amount), 0),
    coalesce(sum(a.allocated_amount), 0),
    count(*) filter (where a.status = 'open'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'partial'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'overdue'::public.accrual_status)::integer,
    count(*) filter (where a.status = 'paid'::public.accrual_status)::integer
  from public.courses c
  inner join public.enrollments e
    on e.course_id = c.id and e.organization_id = v_organization_id
  inner join public.accruals a
    on a.enrollment_id = e.id and a.organization_id = v_organization_id
  inner join public.students s on s.id = a.student_id
  where c.organization_id = v_organization_id
    and a.period_start >= v_start
    and a.period_start < v_end_exclusive
    and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
    and (p_course_id is null or c.id = p_course_id)
    and (p_student_status is null or s.status = p_student_status::public.record_status)
  group by c.id, c.name
  order by sum(a.net_amount) desc;
end;
$$;

revoke all on function public.get_accrual_report_by_course(date, date, uuid, text) from public, anon;
grant execute on function public.get_accrual_report_by_course(date, date, uuid, text) to authenticated;

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

  if (v_end - v_start) > interval '36 months' then
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

revoke all on function public.get_cash_flow_report_monthly(date, date, uuid, text, text) from public, anon;
grant execute on function public.get_cash_flow_report_monthly(date, date, uuid, text, text) to authenticated;

create or replace function public.get_cash_flow_report_by_method(
  p_start_month date,
  p_end_month date,
  p_course_id uuid default null,
  p_student_status text default null
)
returns table (
  method public.payment_method,
  cash_in numeric,
  refunds numeric,
  net_cash numeric,
  payment_count integer
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

  return query
  with cash as (
    select
      p.method,
      sum(p.amount) as amount,
      count(*) as cnt
    from public.payments p
    where p.organization_id = v_organization_id
      and p.received_at >= (v_start::timestamp at time zone 'Europe/Istanbul')
      and p.received_at < (v_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (p_course_id is null or p.course_id = p_course_id)
      and (
        p_student_status is null
        or exists (
          select 1 from public.students s
          where s.id = p.student_id and s.status = p_student_status::public.record_status
        )
      )
    group by p.method
  ),
  refund as (
    select
      p.method,
      sum(pr.amount) as amount
    from public.payment_refunds pr
    inner join public.payments p on p.id = pr.payment_id
    where pr.organization_id = v_organization_id
      and pr.created_at >= (v_start::timestamp at time zone 'Europe/Istanbul')
      and pr.created_at < (v_end_exclusive::timestamp at time zone 'Europe/Istanbul')
      and (p_course_id is null or p.course_id = p_course_id)
      and (
        p_student_status is null
        or exists (
          select 1 from public.students s
          where s.id = p.student_id and s.status = p_student_status::public.record_status
        )
      )
    group by p.method
  )
  select
    coalesce(c.method, r.method),
    coalesce(c.amount, 0),
    coalesce(r.amount, 0),
    coalesce(c.amount, 0) - coalesce(r.amount, 0),
    coalesce(c.cnt, 0)::integer
  from cash c
  full outer join refund r on r.method = c.method
  order by coalesce(c.amount, 0) desc;
end;
$$;

revoke all on function public.get_cash_flow_report_by_method(date, date, uuid, text) from public, anon;
grant execute on function public.get_cash_flow_report_by_method(date, date, uuid, text) to authenticated;

notify pgrst, 'reload schema';
