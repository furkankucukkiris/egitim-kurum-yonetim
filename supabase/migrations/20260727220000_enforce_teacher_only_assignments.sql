-- Ders programı ve öğretmen MEB yetkilendirmelerinde
-- yalnızca aktif teacher rolündeki profiller kullanılabilir.

create or replace function
public.enforce_teacher_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.teacher_profile_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = new.teacher_profile_id
      and p.organization_id =
        new.organization_id
      and p.role =
        'teacher'::public.app_role
      and p.is_active = true
  ) then
    raise exception
      'Seçilen öğretmen bulunamadı veya aktif değil.';
  end if;

  return new;
end;
$$;

drop trigger if exists
class_groups_enforce_teacher_role
on public.class_groups;

create trigger
class_groups_enforce_teacher_role
before insert or update of
  teacher_profile_id,
  organization_id
on public.class_groups
for each row
execute function
public.enforce_teacher_profile_role();

drop trigger if exists
teacher_meb_authorizations_enforce_teacher_role
on public.teacher_course_meb_authorizations;

create trigger
teacher_meb_authorizations_enforce_teacher_role
before insert or update of
  teacher_profile_id,
  organization_id
on public.teacher_course_meb_authorizations
for each row
execute function
public.enforce_teacher_profile_role();

revoke all
on function
public.enforce_teacher_profile_role()
from public, anon, authenticated;

notify pgrst, 'reload schema';
