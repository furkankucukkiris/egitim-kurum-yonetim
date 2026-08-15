-- Tek kurum / davet kontrollü kayıt kuralının pgTAP testleri.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.
-- Bu dosya tek bir transaction içinde çalışır ve sonunda rollback
-- edilir; seed.sql tarafından eklenen demo kurum dahil hiçbir kalıcı
-- veri değişmez.

begin;

select plan(13);

-- ---------------------------------------------------------------
-- Fonksiyonların var olduğunu doğrula.
-- ---------------------------------------------------------------

select has_function(
  'public', 'bootstrap_first_admin', array['text', 'text', 'text'],
  'bootstrap_first_admin(text, text, text) fonksiyonu tanımlı olmalı'
);

select has_function(
  'public', 'has_any_organization', array[]::text[],
  'has_any_organization() fonksiyonu tanımlı olmalı'
);

-- ---------------------------------------------------------------
-- Testi izole bir ortamda çalıştırmak için mevcut kurum/profilleri
-- temizle (transaction sonunda geri alınır).
-- ---------------------------------------------------------------

delete from public.profiles;
delete from public.organizations;

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'ilk-admin@ornek.test',
  'x', now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
);

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'disaridan@ornek.test',
  'x', now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
);

-- ---------------------------------------------------------------
-- Senaryo 1: İlk kurulum — sistemde hiç kurum/profil yok.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  public.has_any_organization(),
  false,
  'Kurum yokken has_any_organization() false döner'
);

select lives_ok(
  $$ select public.bootstrap_first_admin('Test Kurumu', 'İlk Yönetici') $$,
  'Sistemde hiç kurum yokken ilk kurulum başarılı olmalı'
);

select is(
  (
    select role::text
    from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'
  ),
  'admin',
  'İlk kurulumu yapan kullanıcı admin rolüyle kaydedilir'
);

reset role;

select is(
  public.has_any_organization(),
  true,
  'İlk kurulum sonrası has_any_organization() true döner'
);

-- ---------------------------------------------------------------
-- Senaryo 2: Dış kullanıcı — sistemde zaten bir kurum var, profili
-- olmayan başka bir authenticated kullanıcı yeni kurum açamaz.
-- ---------------------------------------------------------------

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '22222222-2222-2222-2222-222222222222',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select throws_ok(
  $$ select public.bootstrap_first_admin('Başka Kurum', 'Dış Kullanıcı') $$,
  'P0001',
  'Bu işlem şu anda kullanılamıyor.',
  'Sistemde kurum varken profili olmayan dış kullanıcı yeni kurum oluşturamaz'
);

select is(
  (
    select count(*)::int
    from public.profiles
    where id = '22222222-2222-2222-2222-222222222222'
  ),
  0,
  'Reddedilen dış kullanıcı için profil oluşturulmaz'
);

select is(
  (select count(*)::int from public.organizations),
  0,
  'Profilsiz dış kullanıcı mevcut kurum satırını göremez'
);

reset role;

select is(
  (select count(*)::int from public.organizations),
  1,
  'Reddedilen dış kullanıcı sistemde ikinci bir kurum oluşturamaz'
);

-- ---------------------------------------------------------------
-- Senaryo 3: Pasif kullanıcı hiçbir kurum verisine erişemez.
-- ---------------------------------------------------------------

update public.profiles
set is_active = false
where id = '11111111-1111-1111-1111-111111111111';

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  public.current_organization_id(),
  null::uuid,
  'Pasif kullanıcı için current_organization_id() null döner'
);

select is(
  (select count(*)::int from public.organizations),
  0,
  'Pasif kullanıcı organizations tablosunda hiçbir satır göremez (RLS)'
);

reset role;

-- ---------------------------------------------------------------
-- Senaryo 4: Mevcut admin — aynı kullanıcı formu tekrar gönderirse
-- yeni kurum açmaz, mevcut kurumunu döner (idempotent).
-- ---------------------------------------------------------------

update public.profiles
set is_active = true
where id = '11111111-1111-1111-1111-111111111111';

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select is(
  (
    select public.bootstrap_first_admin(
      'Farklı İsim Denemesi', 'Tekrar Deneme'
    )
  ),
  (
    select organization_id
    from public.profiles
    where id = '11111111-1111-1111-1111-111111111111'
  ),
  'Zaten profili olan kullanıcı tekrar çağırırsa yeni kurum açmaz, mevcut kurumunu döner'
);

reset role;

select * from finish();

rollback;
