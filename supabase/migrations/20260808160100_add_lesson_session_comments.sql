-- Yoklama sayfasındaki ders oturumlarına öğretmen/yönetici yorumu.
-- Öğretmen kendi oturumuna, yönetici herhangi bir oturuma yorum
-- bırakabilir. Silme yalnızca yöneticiye açık.

create table public.lesson_session_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lesson_session_id uuid not null references public.lesson_sessions(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id),
  body text not null check (pg_catalog.char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index lesson_session_comments_session_idx
on public.lesson_session_comments (lesson_session_id, created_at);

alter table public.lesson_session_comments enable row level security;

-- Yönetici kurumdaki tüm oturumların yorumlarını görür; öğretmen
-- yalnızca kendi oturumlarının yorumlarını görür.
create policy comments_select
on public.lesson_session_comments
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or exists (
      select 1 from public.lesson_sessions ls
      where ls.id = lesson_session_id
        and ls.teacher_profile_id = auth.uid()
    )
  )
);

-- Yönetici herhangi bir oturuma, öğretmen yalnızca kendi oturumuna
-- yorum ekleyebilir; yazar olarak kendini göstermek zorunda.
create policy comments_insert
on public.lesson_session_comments
for insert
to authenticated
with check (
  organization_id = public.current_organization_id()
  and author_profile_id = auth.uid()
  and (
    public.is_admin()
    or exists (
      select 1 from public.lesson_sessions ls
      where ls.id = lesson_session_id
        and ls.teacher_profile_id = auth.uid()
    )
  )
);

-- Yalnızca yönetici silebilir (yorumu kim yazmış olursa olsun).
create policy comments_delete
on public.lesson_session_comments
for delete
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

grant select, insert, delete on public.lesson_session_comments to authenticated;

notify pgrst, 'reload schema';
