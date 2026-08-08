-- Kurum logosu: ilk kurulumda ve kurum ayarları sayfasında yüklenebilir.

alter table public.organizations
add column if not exists logo_path text;

-- İlk kurulum fonksiyonuna isteğe bağlı logo yolu parametresi eklenir.
-- Kurum henüz yokken yükleme kullanıcının kendi kimliği altına yapılır,
-- bu yüzden burada yalnızca metni saklıyoruz; depolama izinleri aşağıda.

create or replace function public.bootstrap_first_admin(
  p_organization_name text,
  p_full_name text,
  p_logo_path text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_organization_name text := pg_catalog.btrim(p_organization_name);
  v_full_name text := pg_catalog.btrim(p_full_name);
  v_logo_path text := nullif(pg_catalog.btrim(coalesce(p_logo_path, '')), '');
begin
  if v_user_id is null then
    raise exception 'Bu işlem için oturum açılması gerekiyor.';
  end if;

  if v_organization_name is null or v_organization_name = '' then
    raise exception 'Kurum adı boş bırakılamaz.';
  end if;

  if v_full_name is null or v_full_name = '' then
    raise exception 'Yönetici adı boş bırakılamaz.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(2026072501);

  select organization_id
  into v_organization_id
  from public.profiles
  where id = v_user_id;

  if v_organization_id is not null then
    return v_organization_id;
  end if;

  if exists (select 1 from public.organizations)
     or exists (select 1 from public.profiles) then
    raise exception 'İlk kurum kurulumu daha önce tamamlanmış.';
  end if;

  insert into public.organizations (
    name,
    legal_name,
    timezone,
    currency_code,
    logo_path
  )
  values (
    v_organization_name,
    v_organization_name,
    'Europe/Istanbul',
    'TRY',
    v_logo_path
  )
  returning id into v_organization_id;

  insert into public.profiles (
    id,
    organization_id,
    full_name,
    role,
    is_active
  )
  values (
    v_user_id,
    v_organization_id,
    v_full_name,
    'admin'::public.app_role,
    true
  );

  return v_organization_id;
end;
$$;

revoke all on function public.bootstrap_first_admin(text, text, text) from public;
revoke all on function public.bootstrap_first_admin(text, text, text) from anon;
grant execute on function public.bootstrap_first_admin(text, text, text) to authenticated;

-- Kurum logosu deposu. Herkese açık okunabilir (uygulama arayüzünde
-- oturumsuz gösterilebilmesi için), yazma yalnızca kendi kullanıcı
-- klasörüne izinlidir.

insert into storage.buckets (id, name, public)
values ('organization-logos', 'organization-logos', true)
on conflict (id) do nothing;

drop policy if exists "organization_logos_owner_write" on storage.objects;

create policy "organization_logos_owner_write"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'organization-logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';
