-- /odemeler ekranındaki "Öğrenci bazlı bakiye" bölümü: arama, ders/
-- durum filtresi ve gerçek server-side sayfalama ile her öğrencinin
-- TÜM açık dönemler toplamındaki (ay ile sınırlı değil — bu bilinçli,
-- "bakiye" kavramı ay bazlı değil kümülatiftir) güncel durumunu
-- döner.

create or replace function public.get_student_balances(
  p_search text default null,
  p_course_id uuid default null,
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  student_id uuid,
  student_name text,
  course_names text,
  total_net numeric,
  total_allocated numeric,
  total_pending numeric,
  status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_search text := nullif(pg_catalog.btrim(coalesce(p_search, '')), '');
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu listeyi görüntüleme yetkiniz bulunmuyor.';
  end if;

  if p_status is not null and p_status not in ('paid', 'partial', 'pending') then
    raise exception 'Geçersiz durum filtresi.';
  end if;

  return query
  with balances as (
    select
      s.id as student_id,
      s.first_name || ' ' || s.last_name as student_name,
      string_agg(distinct c.name, ', ' order by c.name) as course_names,
      coalesce(sum(a.net_amount), 0) as total_net,
      coalesce(sum(a.allocated_amount), 0) as total_allocated,
      coalesce(sum(a.net_amount - a.allocated_amount), 0) as total_pending,
      bool_or(e.course_id = p_course_id) as matches_course
    from public.students s
    inner join public.accruals a on a.student_id = s.id
    inner join public.enrollments e on e.id = a.enrollment_id
    inner join public.courses c on c.id = e.course_id
    where s.organization_id = v_organization_id
      and a.organization_id = v_organization_id
      and a.status not in ('cancelled'::public.accrual_status, 'refunded'::public.accrual_status)
      and (
        v_search is null
        or (s.first_name || ' ' || s.last_name) ilike ('%' || v_search || '%')
      )
    group by s.id, s.first_name, s.last_name
  ),
  classified as (
    select
      b.*,
      case
        when b.total_pending <= 0.01 then 'paid'
        when b.total_allocated > 0 then 'partial'
        else 'pending'
      end as computed_status
    from balances b
  )
  select
    c.student_id,
    c.student_name,
    c.course_names,
    c.total_net,
    c.total_allocated,
    c.total_pending,
    c.computed_status,
    count(*) over ()
  from classified c
  where (p_course_id is null or c.matches_course)
    and (p_status is null or c.computed_status = p_status)
  order by c.total_pending desc, c.student_name asc
  limit greatest(coalesce(p_limit, 20), 1)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.get_student_balances(text, uuid, text, integer, integer) from public, anon;
grant execute on function public.get_student_balances(text, uuid, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
