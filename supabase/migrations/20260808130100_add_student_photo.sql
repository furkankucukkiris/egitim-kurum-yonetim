-- Öğrenci fotoğrafı: kayıt formunda çekilip arka planı kaldırılan
-- fotoğrafın öğrenci kaydına bağlanması.

alter table public.students
add column if not exists photo_path text;

grant select (photo_path) on public.students to authenticated;

create or replace function public.set_student_photo(
  p_student_id uuid,
  p_photo_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_photo_path text := nullif(pg_catalog.btrim(coalesce(p_photo_path, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci fotoğrafı ekleme yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  update public.students
  set photo_path = v_photo_path,
      updated_at = pg_catalog.now()
  where id = p_student_id
    and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'students', p_student_id::text,
    'set_photo', null,
    pg_catalog.jsonb_build_object('photo_path', v_photo_path)
  );
end;
$$;

revoke all on function public.set_student_photo(uuid, text) from public;
revoke all on function public.set_student_photo(uuid, text) from anon;
grant execute on function public.set_student_photo(uuid, text) to authenticated;

-- Öğrenci fotoğrafları deposu. Öğrenci verisi hassas kabul edildiği
-- için depoyu özel (private) tutuyoruz; okuma ve yazma yalnızca aynı
-- kurumun finans/yönetici rolündeki kullanıcılarına açık.

insert into storage.buckets (id, name, public)
values ('student-photos', 'student-photos', false)
on conflict (id) do nothing;

drop policy if exists "student_photos_org_access" on storage.objects;

create policy "student_photos_org_access"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_manage_finance()
)
with check (
  bucket_id = 'student-photos'
  and (storage.foldername(name))[1] = public.current_organization_id()::text
  and public.can_manage_finance()
);

notify pgrst, 'reload schema';
