-- Runtime grant ve rol regresyonlarini duzeltir.
--
-- RLS bir satirin gorulup gorulemeyecegine karar verir; ancak Postgres'in
-- tablo izni de ayrica gerekir. Temiz Supabase kurulumunda authenticated
-- rolunun public tablolarinda SELECT izni bulunmadigi icin RLS'e ulasilmadan
-- "permission denied" aliniyordu. Tum public tablolarina SELECT vermek veri
-- acmaz: 40 public tablonun tamami RLS ile korunur ve RPC-only tablolarda
-- INSERT/UPDATE/DELETE izinleri kapali kalir.
grant select on all tables in schema public to authenticated;

-- Uygulamanin Server Action katmaninda dogrudan yazdigi az sayidaki tanim
-- tablosu/alan. Satir ve rol kapsami ilgili RLS policy'lerinde uygulanir.
grant update on public.organizations to authenticated;
grant update on public.students to authenticated;
grant insert, update on public.cash_accounts to authenticated;
grant insert, update on public.bank_accounts to authenticated;
grant insert, update on public.expense_categories to authenticated;

-- Logo parametresi eklenirken eski iki-parametreli overload dusurulmemisti.
-- Uc-parametreli surumun son parametresi default oldugu icin iki argumanli
-- cagri belirsizlesiyor ve PostgREST/SQL 42725 uretebiliyordu.
drop function if exists public.bootstrap_first_admin(text, text);

-- 20260814130000, get_meb_monthly_roster() fonksiyonunun eski govdesini
-- yeniden tanimlarken kaldirilmis finance rolunu yanlislikla geri getirdi.
-- Mevcut govdeyi ic implementasyon olarak saklayip admin/teacher disindaki
-- rolleri dis wrapper'da kesin olarak reddediyoruz.
alter function public.get_meb_monthly_roster(date)
rename to get_meb_monthly_roster_impl;

revoke all on function public.get_meb_monthly_roster_impl(date)
from public, anon, authenticated;

create function public.get_meb_monthly_roster(
  p_month_start date
)
returns table (
  enrollment_id uuid,
  student_id uuid,
  student_full_name text,
  course_id uuid,
  course_name text,
  class_group_id uuid,
  class_group_name text,
  weekday integer,
  start_time time,
  teacher_profile_id uuid,
  teacher_full_name text,
  enrollment_status text,
  course_meb_status text,
  teacher_meb_status text,
  student_meb_status text,
  student_meb_valid_from date,
  student_meb_valid_until date,
  compliance_status text,
  include_in_meb_register boolean,
  compliance_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role := public.current_app_role();
begin
  if v_role not in ('admin'::public.app_role, 'teacher'::public.app_role) then
    raise exception 'MEB yoklama listesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select *
  from public.get_meb_monthly_roster_impl(p_month_start);
end;
$$;

revoke all on function public.get_meb_monthly_roster(date) from public, anon;
grant execute on function public.get_meb_monthly_roster(date) to authenticated;

notify pgrst, 'reload schema';
