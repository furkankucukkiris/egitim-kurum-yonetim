-- login_attempts (20260814160000) hiçbir organization_id taşımıyordu
-- ve select policy'si tüm adminlere TÜM kurumların giriş denemelerini
-- gösteriyordu — düşük hassasiyetli ama gerçek bir kurumlar arası
-- veri sızıntısı. E-posta, kayıtlı bir profile eşleşiyorsa o profilin
-- kurumuna damgalanıyor; eşleşmiyorsa (yanlış yazılmış/var olmayan
-- hesap denemesi) organization_id null kalır ve hiçbir adminin
-- ekranında görünmez (kimseye ait olmadığı için kimseye gösterilmez).

alter table public.login_attempts
add column if not exists organization_id uuid references public.organizations(id);

create index if not exists login_attempts_organization_idx
on public.login_attempts (organization_id, created_at desc);

drop policy if exists login_attempts_admin_select on public.login_attempts;

create policy login_attempts_admin_select
on public.login_attempts
for select
to authenticated
using (
  organization_id is not null
  and organization_id = public.current_organization_id()
  and public.is_admin()
);

create or replace function public.record_login_attempt(
  p_email text,
  p_succeeded boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_organization_id uuid;
begin
  if v_email = '' then
    return;
  end if;

  select p.organization_id
  into v_organization_id
  from public.profiles p
  where pg_catalog.lower(p.email) = v_email
  limit 1;

  insert into public.login_attempts (email, succeeded, organization_id)
  values (v_email, coalesce(p_succeeded, false), v_organization_id);

  delete from public.login_attempts
  where email = v_email
    and created_at < pg_catalog.now() - interval '30 days';
end;
$$;

revoke all on function public.record_login_attempt(text, boolean) from public;
grant execute on function public.record_login_attempt(text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
