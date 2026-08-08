-- Profili olmayan bir kullanıcı için sistemde hiç kurum var mı diye
-- kontrol eder. RLS, profili olmayan kullanıcılar için organizations
-- tablosunu her zaman boş döndürür (current_organization_id() null
-- olduğundan) — bu yüzden bu kontrol RLS'i atlayan ayrı bir
-- security definer fonksiyon olarak yazılmalı. Hiçbir hassas veri
-- döndürmez, yalnızca boolean.

create or replace function public.has_any_organization()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.organizations);
$$;

revoke all on function public.has_any_organization() from public;
grant execute on function public.has_any_organization() to authenticated;

notify pgrst, 'reload schema';
