-- Genel Bakış (dashboard) ekranındaki finans göstergelerini
-- muhasebesel olarak doğru, tek bir yerde (bu RPC'ler) hesaplar.
--
-- Önceki istemci tarafı hesaplamanın (src/app/(dashboard)/page.tsx)
-- düzeltilen sorunları:
--   1. "Tahakkuk ayı" (period_start) ile "ödeme tarihi" (received_at)
--      karıştırılıyordu — tek bir "Bekleyen Ödeme" rakamı hem bu ayın
--      tahsilatını hem geçmiş dönemden kalan borcu hem de nakit akışını
--      aynı sayıya karıştırıyordu. Şimdi dört ayrı, net tanımlı alan
--      var: monthly_collected (bu ayın tahakkuklarından tahsis
--      edilen — ödeme tarihi ne olursa olsun), monthly_cash_received
--      (bu ay received_at'i düşen tüm ödemeler — hangi döneme
--      tahsis edildiği önemli değil), prior_period_carryover (yalnızca
--      bu aydan ÖNCEKİ dönemlerin kapanmamış bakiyesi) ve
--      total_open_receivable (bugüne kadarki tüm açık bakiye).
--   2. "Bekleyen dönem" sayısı course_id + period_start'ı anahtar
--      yaparak sayılıyordu — aynı derste birden çok öğrencinin
--      borcu tek satıra düşüyordu. accruals(enrollment_id, period_start)
--      zaten tekil olduğundan, artık doğrudan satır sayısı (count(*))
--      kullanılıyor; her öğrencinin her dönemi kendi satırı.
--   3. Öğrenci avans/bakiyesi hiç hesaplanmıyordu. Bir ödeme, o
--      öğrencinin/dersin o anda açık olan tahakkuklarından fazlaysa
--      (record_payment_for_course, 20260808120000) kalan tutar hiçbir
--      yere yazılmıyor, yalnızca payment_allocations'ın toplamı
--      payments.amount'tan az kalıyor. student_advance_balance bunu
--      (ödeme tutarı − dağıtılan tutar) olarak toplar; bu tutar hiçbir
--      zaman "tahsil edilen"e karışmaz (accruals.allocated_amount zaten
--      net_amount'ı aşamıyor — check kısıtı).
--   4. cancelled/refunded tahakkuklar ve is_refunded ödemeler her
--      sorguda tutarlı biçimde dışlanıyor.
--   5. Tüm tarih karşılaştırmaları Europe/Istanbul'a göre yapılıyor.
--
-- Not: payments.is_refunded alanı şemada var ama bunu true yapan
-- hiçbir RPC yok (iade özelliği henüz uygulanmadı) — bu iki fonksiyon
-- ileride bir iade akışı eklendiğinde otomatik doğru davranacak
-- şekilde şimdiden is_refunded/'refunded' durumunu dışlıyor.

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
        and p.is_refunded = false
        and p.received_at >= (v_month_start::timestamp at time zone 'Europe/Istanbul')
        and p.received_at < (v_next_month_start::timestamp at time zone 'Europe/Istanbul')
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
      select coalesce(sum(greatest(p.amount - coalesce(alloc.allocated_total, 0), 0)), 0)
      from public.payments p
      left join (
        select pa.payment_id, sum(pa.amount) as allocated_total
        from public.payment_allocations pa
        group by pa.payment_id
      ) alloc on alloc.payment_id = p.id
      where p.organization_id = v_organization_id
        and p.is_refunded = false
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

revoke all on function public.get_dashboard_financial_summary(date) from public, anon;
grant execute on function public.get_dashboard_financial_summary(date) to authenticated;

create or replace function public.get_dashboard_course_performance(
  p_month_start date default null
)
returns table (
  course_id uuid,
  course_name text,
  active_student_count integer,
  month_net numeric,
  month_collected numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_month_start date;
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu özeti görüntüleme yetkiniz bulunmuyor.';
  end if;

  v_month_start := pg_catalog.date_trunc(
    'month',
    coalesce(p_month_start, (pg_catalog.now() at time zone 'Europe/Istanbul')::date)::timestamp
  )::date;

  return query
  select
    c.id,
    c.name,
    (
      select count(*)::integer
      from public.enrollments e2
      where e2.course_id = c.id
        and e2.organization_id = v_organization_id
        and e2.status = 'active'::public.enrollment_status
    ),
    coalesce(sum(a.net_amount), 0),
    coalesce(sum(a.allocated_amount), 0)
  from public.courses c
  inner join public.enrollments e on e.course_id = c.id
  inner join public.accruals a on a.enrollment_id = e.id
  where c.organization_id = v_organization_id
    and a.organization_id = v_organization_id
    and a.period_start = v_month_start
    and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
  group by c.id, c.name
  order by sum(a.net_amount) desc;
end;
$$;

revoke all on function public.get_dashboard_course_performance(date) from public, anon;
grant execute on function public.get_dashboard_course_performance(date) to authenticated;

notify pgrst, 'reload schema';
