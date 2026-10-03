-- get_teacher_student_contacts(): öğretmenin, kendi aktif/dondurulmuş
-- kayıtlı öğrencilerinin velilerine gerektiğinde ulaşabilmesi için
-- yalnızca veli adı, yakınlığı ve telefon numaralarını döner.
-- guardians tablosu teacher'a RLS ile kapalı kalır (fatura unvanı,
-- vergi/TC no, adres, e-posta bu fonksiyondan da dönmez) — bkz.
-- 20260810130000_simplify_roles_to_admin_teacher.sql'deki not.

create or replace function public.get_teacher_student_contacts()
returns table (
  student_id uuid,
  guardian_full_name text,
  relationship text,
  phone text,
  secondary_phone text,
  is_primary boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sg.student_id,
    g.full_name,
    sg.relationship,
    g.phone,
    g.secondary_phone,
    sg.is_primary
  from public.student_guardians sg
  join public.guardians g
    on g.id = sg.guardian_id
  where g.organization_id = public.current_organization_id()
    and public.teacher_has_student(sg.student_id)
  order by sg.student_id, sg.is_primary desc, g.full_name
$$;

revoke all on function public.get_teacher_student_contacts() from public;
revoke all on function public.get_teacher_student_contacts() from anon;
grant execute on function public.get_teacher_student_contacts() to authenticated;

notify pgrst, 'reload schema';
