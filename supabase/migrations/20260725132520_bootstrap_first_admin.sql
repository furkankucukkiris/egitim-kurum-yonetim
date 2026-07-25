-- İlk kurum ve ilk yönetici hesabını güvenli biçimde oluşturur.
-- Yalnızca giriş yapmış bir kullanıcı tarafından ve yalnızca sistem boşken çalışabilir.

create or replace function public.bootstrap_first_admin(
  p_organization_name text,
  p_full_name text
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

  -- Aynı anda iki kurulum isteğinin çalışmasını engeller.
  perform pg_catalog.pg_advisory_xact_lock(2026072501);

  -- Kullanıcının profili daha önce oluşturulduysa mevcut kurumunu döndür.
  select organization_id
  into v_organization_id
  from public.profiles
  where id = v_user_id;

  if v_organization_id is not null then
    return v_organization_id;
  end if;

  -- Bu fonksiyon yalnızca ilk kurulumda çalışabilir.
  if exists (select 1 from public.organizations)
     or exists (select 1 from public.profiles) then
    raise exception 'İlk kurum kurulumu daha önce tamamlanmış.';
  end if;

  insert into public.organizations (
    name,
    legal_name,
    timezone,
    currency_code
  )
  values (
    v_organization_name,
    v_organization_name,
    'Europe/Istanbul',
    'TRY'
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

-- Fonksiyonu anonim kullanıcıların çalıştırmasını engelle.
revoke all
on function public.bootstrap_first_admin(text, text)
from public;

revoke all
on function public.bootstrap_first_admin(text, text)
from anon;

-- Yalnızca giriş yapmış kullanıcı çalıştırabilir.
grant execute
on function public.bootstrap_first_admin(text, text)
to authenticated;