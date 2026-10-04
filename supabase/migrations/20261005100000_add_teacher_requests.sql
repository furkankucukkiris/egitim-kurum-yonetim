-- Öğretmen notları ve talepleri ("Notlar & Talepler").
--
-- Öğretmen yöneticiye not/talep yazar (ör. "X öğrenci için tuval
-- alınmalı"); isteğe bağlı olarak kendi öğrencisine veya kendi ders
-- oturumuna bağlar. Yönetici altına yanıt yazar ve konuyu kapatır.
-- Yoklama ekranındaki seans yorumlarının (lesson_session_comments)
-- yerini alır; mevcut yorumlar aşağıda bu tablolara taşınıp eski tablo
-- kaldırılır.
--
-- Tüm yazma işlemleri security definer RPC'lerle yapılır; tablolarda
-- authenticated rolüne yalnızca select açıktır.

create table public.teacher_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Konunun ait olduğu öğretmen (görünürlük buna göre). Öğretmenin
  -- kendi açtığı taleplerde yazar ile aynıdır.
  teacher_profile_id uuid not null,
  author_profile_id uuid not null,
  student_id uuid,
  lesson_session_id uuid,
  body text not null check (pg_catalog.char_length(body) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid,
  resolved_at timestamptz,
  -- Öğretmene "yeni yanıt var" göstermek için: yöneticinin son yanıt /
  -- durum değişikliği zamanı ve öğretmenin listeyi son görme zamanı.
  admin_activity_at timestamptz,
  teacher_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_requests_id_organization_id_key unique (id, organization_id),
  constraint teacher_requests_resolved_consistency check (
    (status = 'open' and resolved_at is null and resolved_by is null)
    or (status = 'resolved' and resolved_at is not null)
  ),
  constraint teacher_requests_teacher_profile_id_fkey
    foreign key (teacher_profile_id, organization_id)
    references public.profiles (id, organization_id),
  constraint teacher_requests_author_profile_id_fkey
    foreign key (author_profile_id, organization_id)
    references public.profiles (id, organization_id),
  constraint teacher_requests_resolved_by_fkey
    foreign key (resolved_by, organization_id)
    references public.profiles (id, organization_id),
  constraint teacher_requests_student_id_fkey
    foreign key (student_id, organization_id)
    references public.students (id, organization_id) on delete set null (student_id),
  constraint teacher_requests_lesson_session_id_fkey
    foreign key (lesson_session_id, organization_id)
    references public.lesson_sessions (id, organization_id) on delete set null (lesson_session_id)
);

create table public.teacher_request_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null,
  author_profile_id uuid not null,
  body text not null check (pg_catalog.char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint teacher_request_replies_request_id_fkey
    foreign key (request_id, organization_id)
    references public.teacher_requests (id, organization_id) on delete cascade,
  constraint teacher_request_replies_author_profile_id_fkey
    foreign key (author_profile_id, organization_id)
    references public.profiles (id, organization_id)
);

create index teacher_requests_org_status_idx
on public.teacher_requests (organization_id, status, created_at desc);

create index teacher_requests_teacher_idx
on public.teacher_requests (teacher_profile_id, created_at desc);

create index teacher_requests_author_profile_id_idx
on public.teacher_requests (author_profile_id);

create index teacher_requests_resolved_by_idx
on public.teacher_requests (resolved_by);

create index teacher_requests_student_id_idx
on public.teacher_requests (student_id);

create index teacher_requests_lesson_session_id_idx
on public.teacher_requests (lesson_session_id);

create index teacher_request_replies_request_idx
on public.teacher_request_replies (request_id, created_at);

create index teacher_request_replies_organization_id_idx
on public.teacher_request_replies (organization_id);

create index teacher_request_replies_author_profile_id_idx
on public.teacher_request_replies (author_profile_id);

alter table public.teacher_requests enable row level security;
alter table public.teacher_request_replies enable row level security;

-- Yönetici kurumdaki tüm talepleri, öğretmen yalnızca kendisine ait
-- olanları görür.
create policy teacher_requests_select
on public.teacher_requests
for select
to authenticated
using (
  organization_id = (select public.current_organization_id())
  and (
    (select public.is_admin())
    or teacher_profile_id = (select auth.uid())
  )
);

create policy teacher_request_replies_select
on public.teacher_request_replies
for select
to authenticated
using (
  organization_id = (select public.current_organization_id())
  and (
    (select public.is_admin())
    or exists (
      select 1
      from public.teacher_requests tr
      where tr.id = teacher_request_replies.request_id
        and tr.teacher_profile_id = (select auth.uid())
    )
  )
);

grant select on public.teacher_requests to authenticated;
grant select on public.teacher_request_replies to authenticated;

-- ---------------------------------------------------------------------
-- create_teacher_request: öğretmen yeni not/talep açar.
-- ---------------------------------------------------------------------
create or replace function public.create_teacher_request(
  p_body text,
  p_student_id uuid default null,
  p_lesson_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_request_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if public.current_app_role() is distinct from 'teacher' then
    raise exception 'Not ve talepleri yalnızca öğretmenler oluşturabilir.';
  end if;

  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception 'Not 1-2000 karakter arasında olmalıdır.';
  end if;

  if p_student_id is not null and not public.teacher_has_student(p_student_id) then
    raise exception 'Seçilen öğrenci size kayıtlı değil.';
  end if;

  if p_lesson_session_id is not null and not public.teacher_owns_session(p_lesson_session_id) then
    raise exception 'Seçilen ders oturumu size ait değil.';
  end if;

  insert into public.teacher_requests (
    organization_id, teacher_profile_id, author_profile_id,
    student_id, lesson_session_id, body
  )
  values (
    v_organization_id, v_user_id, v_user_id,
    p_student_id, p_lesson_session_id, v_body
  )
  returning id into v_request_id;

  -- Not metni audit'e yazılmaz (öğrenciyle ilgili serbest metin içerebilir).
  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_requests', v_request_id::text,
    'create', null,
    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'lesson_session_id', p_lesson_session_id
    )
  );

  return v_request_id;
end;
$$;

-- ---------------------------------------------------------------------
-- reply_teacher_request: yönetici veya talebin sahibi öğretmen yanıt
-- yazar. Yönetici isterse aynı anda konuyu kapatır. Öğretmen kapanmış
-- bir konuya yazarsa konu yeniden açılır.
-- ---------------------------------------------------------------------
create or replace function public.reply_teacher_request(
  p_request_id uuid,
  p_body text,
  p_resolve boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_is_admin boolean := public.is_admin();
  v_body text := pg_catalog.btrim(coalesce(p_body, ''));
  v_request public.teacher_requests%rowtype;
  v_new_status text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if pg_catalog.char_length(v_body) not between 1 and 2000 then
    raise exception 'Yanıt 1-2000 karakter arasında olmalıdır.';
  end if;

  select *
  into v_request
  from public.teacher_requests tr
  where tr.id = p_request_id
    and tr.organization_id = v_organization_id
  for update;

  if not found or (not v_is_admin and v_request.teacher_profile_id <> v_user_id) then
    raise exception 'Not veya talep bulunamadı.';
  end if;

  if coalesce(p_resolve, false) and not v_is_admin then
    raise exception 'Konuyu yalnızca yönetici kapatabilir.';
  end if;

  insert into public.teacher_request_replies (
    organization_id, request_id, author_profile_id, body
  )
  values (v_organization_id, p_request_id, v_user_id, v_body);

  v_new_status := case
    when coalesce(p_resolve, false) then 'resolved'
    when not v_is_admin then 'open'
    else v_request.status
  end;

  update public.teacher_requests
  set status = v_new_status,
      resolved_at = case
        when v_new_status = 'resolved' then coalesce(resolved_at, pg_catalog.now())
        else null
      end,
      resolved_by = case
        when v_new_status = 'resolved' then coalesce(resolved_by, v_user_id)
        else null
      end,
      admin_activity_at = case when v_is_admin then pg_catalog.now() else admin_activity_at end,
      updated_at = pg_catalog.now()
  where id = p_request_id
    and organization_id = v_organization_id;

  if v_new_status is distinct from v_request.status then
    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id,
      action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'teacher_requests', p_request_id::text,
      'set_status',
      pg_catalog.jsonb_build_object('status', v_request.status),
      pg_catalog.jsonb_build_object('status', v_new_status, 'via', 'reply')
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- set_teacher_request_status: yönetici yanıt yazmadan kapatır/yeniden açar.
-- ---------------------------------------------------------------------
create or replace function public.set_teacher_request_status(
  p_request_id uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_old_status text;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Konu durumunu yalnızca yönetici değiştirebilir.';
  end if;

  if p_status is null or p_status not in ('open', 'resolved') then
    raise exception 'Geçersiz durum.';
  end if;

  select tr.status
  into v_old_status
  from public.teacher_requests tr
  where tr.id = p_request_id
    and tr.organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Not veya talep bulunamadı.';
  end if;

  if v_old_status = p_status then
    return;
  end if;

  update public.teacher_requests
  set status = p_status,
      resolved_at = case when p_status = 'resolved' then pg_catalog.now() else null end,
      resolved_by = case when p_status = 'resolved' then v_user_id else null end,
      admin_activity_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_request_id
    and organization_id = v_organization_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'teacher_requests', p_request_id::text,
    'set_status',
    pg_catalog.jsonb_build_object('status', v_old_status),
    pg_catalog.jsonb_build_object('status', p_status)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- mark_teacher_requests_seen: öğretmen listeyi açtığında yönetici
-- yanıtlarını "görüldü" işaretler (menüdeki sayaç sıfırlanır).
-- ---------------------------------------------------------------------
create or replace function public.mark_teacher_requests_seen()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.teacher_requests
  set teacher_seen_at = pg_catalog.now()
  where organization_id = public.current_organization_id()
    and teacher_profile_id = auth.uid()
    and admin_activity_at is not null
    and admin_activity_at > coalesce(teacher_seen_at, '-infinity'::timestamptz)
$$;

-- ---------------------------------------------------------------------
-- teacher_request_badge_count: menüdeki sayaç.
-- Yönetici: açık konu sayısı. Öğretmen: görülmemiş yönetici yanıtı olan
-- konu sayısı.
-- ---------------------------------------------------------------------
create or replace function public.teacher_request_badge_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.is_admin() then (
      select pg_catalog.count(*)::integer
      from public.teacher_requests tr
      where tr.organization_id = public.current_organization_id()
        and tr.status = 'open'
    )
    else (
      select pg_catalog.count(*)::integer
      from public.teacher_requests tr
      where tr.organization_id = public.current_organization_id()
        and tr.teacher_profile_id = auth.uid()
        and tr.admin_activity_at is not null
        and tr.admin_activity_at > coalesce(tr.teacher_seen_at, '-infinity'::timestamptz)
    )
  end
$$;

revoke all on function public.create_teacher_request(text, uuid, uuid) from public;
revoke all on function public.create_teacher_request(text, uuid, uuid) from anon;
grant execute on function public.create_teacher_request(text, uuid, uuid) to authenticated;

revoke all on function public.reply_teacher_request(uuid, text, boolean) from public;
revoke all on function public.reply_teacher_request(uuid, text, boolean) from anon;
grant execute on function public.reply_teacher_request(uuid, text, boolean) to authenticated;

revoke all on function public.set_teacher_request_status(uuid, text) from public;
revoke all on function public.set_teacher_request_status(uuid, text) from anon;
grant execute on function public.set_teacher_request_status(uuid, text) to authenticated;

revoke all on function public.mark_teacher_requests_seen() from public;
revoke all on function public.mark_teacher_requests_seen() from anon;
grant execute on function public.mark_teacher_requests_seen() to authenticated;

revoke all on function public.teacher_request_badge_count() from public;
revoke all on function public.teacher_request_badge_count() from anon;
grant execute on function public.teacher_request_badge_count() to authenticated;

-- ---------------------------------------------------------------------
-- Eski seans yorumlarını taşı: her oturumun ilk yorumu konu metni,
-- sonrakiler yanıt olur. Konu, oturumun öğretmenine ait sayılır ve
-- geçmiş kayıt olduğu için "kapandı" olarak gelir (yönetici gerekirse
-- yeniden açar). Öğretmeni olmayan oturumlarda ilk yorumun yazarı
-- kullanılır.
-- ---------------------------------------------------------------------
with ranked as (
  select
    c.*,
    pg_catalog.row_number() over (
      partition by c.lesson_session_id order by c.created_at, c.id
    ) as rn,
    pg_catalog.max(c.created_at) over (partition by c.lesson_session_id) as last_at
  from public.lesson_session_comments c
),
firsts as (
  select
    r.*,
    coalesce(ls.teacher_profile_id, cg.teacher_profile_id, r.author_profile_id) as owner_id
  from ranked r
  join public.lesson_sessions ls on ls.id = r.lesson_session_id
  left join public.class_groups cg on cg.id = ls.class_group_id
  where r.rn = 1
)
insert into public.teacher_requests (
  id, organization_id, teacher_profile_id, author_profile_id,
  lesson_session_id, body, status, resolved_at, created_at, updated_at
)
select
  f.id, f.organization_id, f.owner_id, f.author_profile_id,
  f.lesson_session_id, f.body, 'resolved', f.last_at, f.created_at, f.last_at
from firsts f;

insert into public.teacher_request_replies (
  id, organization_id, request_id, author_profile_id, body, created_at
)
select c.id, c.organization_id, tr.id, c.author_profile_id, c.body, c.created_at
from public.lesson_session_comments c
join public.teacher_requests tr
  on tr.lesson_session_id = c.lesson_session_id
  and tr.id <> c.id
where tr.id in (select id from public.lesson_session_comments);

drop table public.lesson_session_comments;

notify pgrst, 'reload schema';
