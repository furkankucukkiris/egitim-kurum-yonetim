-- Önceki migration (20260814180000) organization_id'yi
-- `profiles.email` üzerinden eşleştiriyordu — ama bu sütun admin
-- hesapları için hiç doldurulmuyor (bootstrap_first_admin bunu set
-- etmiyor; gerçek e-posta yalnızca auth.users'ta var). Sonuç: hiçbir
-- admin girişi kendi organization_id'sini alamıyordu. Kaynağı
-- auth.users.email'e çeviriyoruz — bu her zaman dolu.

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
  from auth.users u
  join public.profiles p on p.id = u.id
  where pg_catalog.lower(u.email) = v_email
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
