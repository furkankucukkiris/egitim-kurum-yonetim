-- organizations tablosuna istemciden (authenticated rolüyle) doğrudan
-- insert/delete yapılamadığını doğrular. Admin dahil hiç kimse yeni
-- kurum satırı ekleyemez ya da silemez; bu yalnızca
-- bootstrap_first_admin() güvenlik tanımlı fonksiyonundan geçer.
--
-- Çalıştırma: `npx supabase start` sonrasında `npx supabase test db`.

begin;

select plan(2);

insert into auth.users (
  id, instance_id, aud, role, email,
  encrypted_password, email_confirmed_at,
  created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values (
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'admin-dene@ornek.test',
  'x', now(), now(), now(),
  '{"provider":"email","providers":["email"]}', '{}'
)
on conflict (id) do nothing;

select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '33333333-3333-3333-3333-333333333333',
    'role', 'authenticated'
  )::text,
  true
);
set local role authenticated;

select throws_ok(
  $$ insert into public.organizations (name) values ('Sahte Kurum') $$,
  '42501',
  'İstemci (authenticated) organizations tablosuna doğrudan insert yapamaz'
);

select throws_ok(
  $$ delete from public.organizations $$,
  '42501',
  'İstemci (authenticated) organizations tablosundan doğrudan delete yapamaz'
);

reset role;

select * from finish();

rollback;
