-- Sistem tek bir kurumla sınırlı kalmasın: "ilk kurulum" kısıtı
-- sistem genelinde değil, kullanıcı bazında olmalı. Böylece admin
-- yeni bir kurum için ayrı bir kullanıcı oluşturduğunda (Supabase
-- Dashboard üzerinden), o kullanıcı kendi profili olmadığı sürece
-- /kurulum üzerinden kendi kurumunu oluşturabilir — mevcut kurumlar
-- etkilenmeden.

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

  -- Aynı kullanıcının aynı anda iki kurum oluşturmasını engeller.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 2026072501)
  );

  -- Bu kullanıcının zaten (aktif ya da pasif) bir profili varsa,
  -- yeni kurum oluşturmak yerine mevcut kurumunu döndürür. Sistemde
  -- başka kurumların bulunması burayı etkilemez — her kullanıcı
  -- yalnızca kendi ilk kurulumu için bir kez bu yoldan geçer.
  select organization_id
  into v_organization_id
  from public.profiles
  where id = v_user_id;

  if v_organization_id is not null then
    return v_organization_id;
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

-- Bir kullanıcının (aktif/pasif fark etmeksizin) profili olup
-- olmadığını RLS'i atlayarak kontrol eder. RLS, current_organization_id()
-- kendi profiline bağlı olduğundan pasif/olmayan bir profili normal
-- sorgudan her zaman gizler; yönlendirme kararı için bu ayrım gerekir.

create or replace function public.current_user_profile_exists()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid()
  );
$$;

revoke all on function public.current_user_profile_exists() from public;
grant execute on function public.current_user_profile_exists() to authenticated;

notify pgrst, 'reload schema';
