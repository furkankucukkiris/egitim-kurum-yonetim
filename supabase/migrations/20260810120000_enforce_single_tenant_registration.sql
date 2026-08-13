-- İş kuralı değişikliği: sistem tek kurumla sınırlıdır, dışarıdan
-- kimse kayıt olamaz ve kendi kendine yeni kurum oluşturamaz.
--
-- 20260808150000_allow_multi_tenant_onboarding.sql, /kurulum akışını
-- "kullanıcı bazlı ilk kurulum" haline getirerek, sistemde zaten bir
-- kurum varken bile profili olmayan herhangi bir authenticated
-- kullanıcının kendi kurumunu oluşturmasına izin vermişti. Bu,
-- istenen tek-kurum/davet kontrollü modelle çelişiyor: /kurulum
-- yalnızca sistemde hiçbir kurum ve profil yokken, gerçek ilk
-- kurulum için kullanılabilmeli. Bu migration önceki dosyayı
-- değiştirmeden davranışı geri alır.

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

  -- Sistem genelinde tek bir kilit: aynı anda gelen iki ilk-kurulum
  -- isteğinin ikisinin de kurum oluşturmasını engeller.
  perform pg_catalog.pg_advisory_xact_lock(2026072501);

  -- Bu kullanıcının zaten bir profili varsa (ör. aynı formun tekrar
  -- gönderilmesi), yeni kurum oluşturmadan mevcut kurumunu döndürür.
  select organization_id
  into v_organization_id
  from public.profiles
  where id = v_user_id;

  if v_organization_id is not null then
    return v_organization_id;
  end if;

  -- Bu fonksiyon yalnızca sistemde hiç kurum ve hiç profil yokken,
  -- yani gerçek ilk kurulumda çalışabilir. Mesaj kasıtlı olarak
  -- geneldir; sistemde başka kullanıcı/kurum bulunup bulunmadığını
  -- ifşa etmez.
  if exists (select 1 from public.organizations)
     or exists (select 1 from public.profiles) then
    raise exception 'Bu işlem şu anda kullanılamıyor.';
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

revoke all
on function public.bootstrap_first_admin(text, text, text)
from public;

revoke all
on function public.bootstrap_first_admin(text, text, text)
from anon;

grant execute
on function public.bootstrap_first_admin(text, text, text)
to authenticated;

-- current_user_profile_exists() yalnızca kullanıcı bazlı onboarding
-- yönlendirmesi için vardı; artık kullanılmıyor.
drop function if exists public.current_user_profile_exists();

-- Organizations tablosuna istemciden doğrudan insert/delete asla
-- yapılamaz (zaten insert/delete politikası olmadığı için RLS bunu
-- engelliyordu; burada açıkça revoke ederek savunmayı pekiştiriyoruz).
-- select/update yetkileri organizations_select_own ve
-- organizations_admin_update politikalarıyla korunmaya devam eder.
revoke insert, delete
on public.organizations
from authenticated;

notify pgrst, 'reload schema';
