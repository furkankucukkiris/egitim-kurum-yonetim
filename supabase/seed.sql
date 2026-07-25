insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'Demo Eğitim Kurumu')
on conflict (id) do nothing;

insert into public.courses (organization_id, name, code, course_type, default_monthly_fee)
values
  ('00000000-0000-0000-0000-000000000001', 'Piyano', 'PIY', 'individual', 4400),
  ('00000000-0000-0000-0000-000000000001', 'Resim', 'RES', 'group', 3960),
  ('00000000-0000-0000-0000-000000000001', 'Yaratıcı Drama', 'DRA', 'group', 3960),
  ('00000000-0000-0000-0000-000000000001', 'Gitar', 'GIT', 'individual', 4400),
  ('00000000-0000-0000-0000-000000000001', 'İngilizce', 'ING', 'group', 4400)
on conflict do nothing;
