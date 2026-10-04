-- Telefon bildirimleri (Web Push).
--
--   1) push_subscriptions — kullanıcının bildirim izni verdiği her cihaz
--      (tarayıcının verdiği endpoint + şifreleme anahtarları).
--   2) notification_settings — kişi başına hangi bildirimleri almak
--      istediği. Satır yoksa hepsi açık sayılır.
--   3) notification_outbox — gönderilecek bildirim kuyruğu. dedupe_key
--      sayesinde aynı ders için hatırlatma iki kez kuyruğa girmez.
--
-- Kuyruğu dolduranlar:
--   * enqueue_scheduled_notifications(): pg_cron ile her dakika — ders
--     başlamadan 10 dk önce hatırlatma, ders bitiminden 15 dk sonra
--     yoklama hâlâ alınmamışsa uyarı.
--   * teacher_requests / teacher_request_replies tetikleyicileri — yeni
--     not (yöneticilere), yanıt (karşı tarafa), yanıtsız kapatma/yeniden
--     açma (öğretmene).
--
-- Gönderimi Next.js'teki /api/notifications/dispatch yapar (web-push
-- şifrelemesi ve VAPID imzası orada). pg_cron, kuyrukta bekleyen varsa
-- pg_net ile bu adrese istek atar; adres ve paylaşılan gizli anahtar
-- Supabase Vault'ta tutulur (notification_dispatch_url,
-- notification_dispatch_secret). Vault'ta yoksa (ör. dev) istek atılmaz,
-- kuyruk yine dolar.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  constraint push_subscriptions_profile_id_fkey
    foreign key (profile_id, organization_id)
    references public.profiles (id, organization_id) on delete cascade
);

create index push_subscriptions_profile_idx on public.push_subscriptions (profile_id);
create index push_subscriptions_organization_id_idx on public.push_subscriptions (organization_id);

create table public.notification_settings (
  profile_id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lesson_reminder boolean not null default true,
  attendance_reminder boolean not null default true,
  request_updates boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint notification_settings_profile_id_fkey
    foreign key (profile_id, organization_id)
    references public.profiles (id, organization_id) on delete cascade
);

create index notification_settings_organization_id_idx
on public.notification_settings (organization_id);

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id uuid not null,
  kind text not null check (kind in (
    'lesson_reminder', 'attendance_reminder',
    'request_new', 'request_reply', 'request_status', 'test'
  )),
  title text not null,
  body text not null,
  url text not null default '/',
  dedupe_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'expired')),
  attempts integer not null default 0,
  last_error text,
  -- Bu zamandan sonra gönderilmez (ör. ders başladıysa hatırlatma anlamsız).
  expires_at timestamptz not null default now() + interval '1 hour',
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  constraint notification_outbox_profile_id_fkey
    foreign key (profile_id, organization_id)
    references public.profiles (id, organization_id) on delete cascade
);

create index notification_outbox_pending_idx
on public.notification_outbox (created_at)
where status = 'pending';

create index notification_outbox_profile_id_idx on public.notification_outbox (profile_id);
create index notification_outbox_organization_id_idx on public.notification_outbox (organization_id);

alter table public.push_subscriptions enable row level security;
alter table public.notification_settings enable row level security;
alter table public.notification_outbox enable row level security;

-- Kullanıcı yalnızca kendi cihazlarını görür; yazma RPC'lerle.
create policy push_subscriptions_select_own
on public.push_subscriptions
for select
to authenticated
using (
  organization_id = (select public.current_organization_id())
  and profile_id = (select auth.uid())
);

create policy notification_settings_select_own
on public.notification_settings
for select
to authenticated
using (
  organization_id = (select public.current_organization_id())
  and profile_id = (select auth.uid())
);

revoke all on public.push_subscriptions from anon, authenticated;
revoke all on public.notification_settings from anon, authenticated;
revoke all on public.notification_outbox from anon, authenticated;

grant select on public.push_subscriptions to authenticated;
grant select on public.notification_settings to authenticated;
-- notification_outbox: yalnızca security definer fonksiyonlar ve
-- service_role (gönderici) erişir.

-- ---------------------------------------------------------------------
-- Kullanıcı RPC'leri
-- ---------------------------------------------------------------------
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if coalesce(p_endpoint, '') not like 'https://%'
    or coalesce(p_p256dh, '') = ''
    or coalesce(p_auth, '') = '' then
    raise exception 'Bildirim aboneliği geçersiz.';
  end if;

  -- Aynı tarayıcıda başka kullanıcı oturum açarsa cihaz yeni kullanıcıya
  -- geçer; önceki kullanıcıya o cihazdan bildirim gitmez.
  insert into public.push_subscriptions (
    organization_id, profile_id, endpoint, p256dh, auth, user_agent
  )
  values (
    v_organization_id, v_user_id, p_endpoint, p_p256dh, p_auth,
    pg_catalog.left(p_user_agent, 300)
  )
  on conflict (endpoint) do update
  set organization_id = excluded.organization_id,
      profile_id = excluded.profile_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint
    and profile_id = auth.uid()
$$;

create or replace function public.set_my_notification_settings(
  p_lesson_reminder boolean,
  p_attendance_reminder boolean,
  p_request_updates boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  insert into public.notification_settings (
    profile_id, organization_id, lesson_reminder, attendance_reminder, request_updates
  )
  values (
    v_user_id, v_organization_id,
    coalesce(p_lesson_reminder, true),
    coalesce(p_attendance_reminder, true),
    coalesce(p_request_updates, true)
  )
  on conflict (profile_id) do update
  set lesson_reminder = excluded.lesson_reminder,
      attendance_reminder = excluded.attendance_reminder,
      request_updates = excluded.request_updates,
      updated_at = pg_catalog.now();
end;
$$;

-- Kullanıcının kendine deneme bildirimi göndermesi (kurulum kontrolü).
create or replace function public.enqueue_test_notification()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not exists (select 1 from public.push_subscriptions where profile_id = v_user_id) then
    raise exception 'Bu hesap için bildirim açılmış bir cihaz yok.';
  end if;

  insert into public.notification_outbox (
    organization_id, profile_id, kind, title, body, url, dedupe_key, expires_at
  )
  values (
    v_organization_id, v_user_id, 'test',
    'Deneme bildirimi',
    'Bildirimler bu cihazda çalışıyor.',
    '/bildirimler',
    'test:' || gen_random_uuid()::text,
    pg_catalog.now() + interval '10 minutes'
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Kuyruğa ekleme yardımcısı: alıcının ilgili tercihi açıksa ve en az bir
-- cihazı varsa ekler. Tercih satırı yoksa hepsi açık sayılır.
-- ---------------------------------------------------------------------
create or replace function public.enqueue_notification(
  p_profile_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_dedupe_key text,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_enabled boolean;
begin
  select p.organization_id
  into v_organization_id
  from public.profiles p
  where p.id = p_profile_id
    and p.is_active;

  if not found then
    return;
  end if;

  select case p_kind
    when 'lesson_reminder' then coalesce(ns.lesson_reminder, true)
    when 'attendance_reminder' then coalesce(ns.attendance_reminder, true)
    else coalesce(ns.request_updates, true)
  end
  into v_enabled
  from (select 1) as one
  left join public.notification_settings ns on ns.profile_id = p_profile_id;

  if not v_enabled
    or not exists (select 1 from public.push_subscriptions ps where ps.profile_id = p_profile_id) then
    return;
  end if;

  insert into public.notification_outbox (
    organization_id, profile_id, kind, title, body, url, dedupe_key, expires_at
  )
  values (
    v_organization_id, p_profile_id, p_kind,
    pg_catalog.left(p_title, 120),
    pg_catalog.left(p_body, 240),
    coalesce(p_url, '/'),
    p_dedupe_key,
    coalesce(p_expires_at, pg_catalog.now() + interval '1 hour')
  )
  on conflict (dedupe_key) do nothing;
end;
$$;

-- ---------------------------------------------------------------------
-- Zamanlanmış hatırlatmalar (pg_cron, dakikada bir).
-- ---------------------------------------------------------------------
create or replace function public.enqueue_scheduled_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.now();
  v_before integer;
  v_after integer;
  r record;
begin
  select pg_catalog.count(*)::integer into v_before
  from public.notification_outbox where status = 'pending';

  -- Ders 10 dk içinde başlıyor. Ders saati değişirse (starts_at) yeni
  -- saat için yeniden hatırlatılır.
  for r in
    select
      ls.id,
      ls.starts_at,
      coalesce(ls.teacher_profile_id, cg.teacher_profile_id) as teacher_id,
      c.name as course_name,
      coalesce(ls.room_name, cg.room_name) as room_name
    from public.lesson_sessions ls
    join public.courses c on c.id = ls.course_id
    left join public.class_groups cg on cg.id = ls.class_group_id
    where ls.cancelled_at is null
      and ls.starts_at > v_now
      and ls.starts_at <= v_now + interval '10 minutes'
      and coalesce(ls.teacher_profile_id, cg.teacher_profile_id) is not null
  loop
    perform public.enqueue_notification(
      r.teacher_id,
      'lesson_reminder',
      r.course_name || ' dersiniz ' ||
        pg_catalog.to_char(r.starts_at at time zone 'Europe/Istanbul', 'HH24:MI') ||
        '''da başlıyor',
      case when r.room_name is not null
        then 'Derslik: ' || r.room_name || '. Yoklama almayı unutmayın.'
        else 'Yoklama almayı unutmayın.'
      end,
      '/yoklama?date=' || pg_catalog.to_char(r.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
      'lesson_reminder:' || r.id::text || ':' || extract(epoch from r.starts_at)::bigint::text,
      r.starts_at
    );
  end loop;

  -- Ders 15 dk önce bitti, yoklama hâlâ yok (get_unmarked_past_sessions
  -- ile aynı tanım). Yalnızca son 3 saatte bitenler — eski dersler için
  -- toplu bildirim yağmuru olmasın.
  for r in
    select
      ls.id,
      ls.starts_at,
      coalesce(ls.teacher_profile_id, cg.teacher_profile_id) as teacher_id,
      c.name as course_name
    from public.lesson_sessions ls
    join public.courses c on c.id = ls.course_id
    left join public.class_groups cg on cg.id = ls.class_group_id
    where ls.cancelled_at is null
      and ls.ends_at <= v_now - interval '15 minutes'
      and ls.ends_at > v_now - interval '3 hours'
      and coalesce(ls.teacher_profile_id, cg.teacher_profile_id) is not null
      and not exists (
        select 1 from public.attendance a where a.lesson_session_id = ls.id
      )
      and exists (
        select 1
        from public.enrollments e
        where e.class_group_id = ls.class_group_id
          and e.organization_id = ls.organization_id
          and e.status = 'active'::public.enrollment_status
          and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
          and (e.ends_on is null or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date)
      )
  loop
    perform public.enqueue_notification(
      r.teacher_id,
      'attendance_reminder',
      'Yoklama alınmadı',
      r.course_name || ' (' ||
        pg_catalog.to_char(r.starts_at at time zone 'Europe/Istanbul', 'HH24:MI') ||
        ') dersinin yoklamasını almayı unutmayın.',
      '/yoklama?date=' || pg_catalog.to_char(r.starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
      'attendance_reminder:' || r.id::text,
      v_now + interval '6 hours'
    );
  end loop;

  -- Süresi geçenleri kapat, eski kayıtları temizle.
  update public.notification_outbox
  set status = 'expired'
  where status = 'pending'
    and expires_at <= v_now;

  delete from public.notification_outbox
  where created_at < v_now - interval '30 days';

  select pg_catalog.count(*)::integer into v_after
  from public.notification_outbox where status = 'pending';

  return v_after;
end;
$$;

-- ---------------------------------------------------------------------
-- Not/talep bildirimleri (tetikleyiciler). Not metni kilit ekranında
-- görüneceği için kısaltılır.
-- ---------------------------------------------------------------------
create or replace function public.notify_teacher_request_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher_name text;
  v_admin record;
begin
  select p.full_name into v_teacher_name
  from public.profiles p where p.id = new.teacher_profile_id;

  for v_admin in
    select p.id
    from public.profiles p
    where p.organization_id = new.organization_id
      and p.role = 'admin'
      and p.is_active
      and p.id <> new.author_profile_id
  loop
    perform public.enqueue_notification(
      v_admin.id,
      'request_new',
      'Yeni not: ' || coalesce(v_teacher_name, 'Öğretmen'),
      pg_catalog.left(new.body, 140),
      '/talepler',
      'request_new:' || new.id::text || ':' || v_admin.id::text,
      pg_catalog.now() + interval '1 day'
    );
  end loop;

  return null;
end;
$$;

create or replace function public.notify_teacher_request_reply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.teacher_requests%rowtype;
  v_author_name text;
  v_recipient record;
begin
  select * into v_request
  from public.teacher_requests tr where tr.id = new.request_id;

  if not found then
    return null;
  end if;

  if new.author_profile_id = v_request.teacher_profile_id then
    -- Öğretmen yazdı → yöneticilere.
    select p.full_name into v_author_name
    from public.profiles p where p.id = new.author_profile_id;

    for v_recipient in
      select p.id
      from public.profiles p
      where p.organization_id = new.organization_id
        and p.role = 'admin'
        and p.is_active
    loop
      perform public.enqueue_notification(
        v_recipient.id,
        'request_reply',
        coalesce(v_author_name, 'Öğretmen') || ' notuna ekleme yaptı',
        pg_catalog.left(new.body, 140),
        '/talepler',
        'request_reply:' || new.id::text || ':' || v_recipient.id::text,
        pg_catalog.now() + interval '1 day'
      );
    end loop;
  else
    -- Yönetici yazdı → notun sahibi öğretmene.
    perform public.enqueue_notification(
      v_request.teacher_profile_id,
      'request_reply',
      'Yönetici notunuza yanıt verdi',
      pg_catalog.left(new.body, 140),
      '/talepler',
      'request_reply:' || new.id::text || ':' || v_request.teacher_profile_id::text,
      pg_catalog.now() + interval '1 day'
    );
  end if;

  return null;
end;
$$;

-- Yanıtsız kapatma / yeniden açma. Aynı transaction'da yanıt da
-- yazıldıysa (now() transaction boyunca sabittir) yanıt bildirimi
-- yeterli, ikinci bildirim gönderilmez.
create or replace function public.notify_teacher_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if exists (
    select 1 from public.teacher_request_replies r
    where r.request_id = new.id
      and r.created_at = pg_catalog.now()
  ) then
    return null;
  end if;

  perform public.enqueue_notification(
    new.teacher_profile_id,
    'request_status',
    case when new.status = 'resolved'
      then 'Notunuz kapatıldı'
      else 'Notunuz yeniden açıldı'
    end,
    pg_catalog.left(new.body, 140),
    '/talepler',
    'request_status:' || new.id::text || ':' || new.status || ':' ||
      extract(epoch from pg_catalog.now())::bigint::text,
    pg_catalog.now() + interval '1 day'
  );

  return null;
end;
$$;

create trigger teacher_requests_notify_created
after insert on public.teacher_requests
for each row execute function public.notify_teacher_request_created();

create trigger teacher_request_replies_notify
after insert on public.teacher_request_replies
for each row execute function public.notify_teacher_request_reply();

create trigger teacher_requests_notify_status
after update of status on public.teacher_requests
for each row execute function public.notify_teacher_request_status();

-- ---------------------------------------------------------------------
-- Gönderici (service_role) için: bekleyenleri al, sonucu yaz.
-- ---------------------------------------------------------------------
create or replace function public.claim_pending_notifications(p_limit integer default 50)
returns table (
  id uuid,
  title text,
  body text,
  url text,
  subscriptions jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with picked as (
    select o.id
    from public.notification_outbox o
    where o.status = 'pending'
      and o.expires_at > pg_catalog.now()
      -- Aynı anda çalışan iki gönderici aynı satırı almasın; başarısız
      -- denemeler 1 dk bekler.
      and (o.last_attempt_at is null or o.last_attempt_at < pg_catalog.now() - interval '1 minute')
    order by o.created_at
    limit greatest(coalesce(p_limit, 50), 1)
    for update skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set attempts = o.attempts + 1,
        last_attempt_at = pg_catalog.now()
    from picked
    where o.id = picked.id
    returning o.id, o.profile_id, o.title, o.body, o.url
  )
  select
    c.id, c.title, c.body, c.url,
    coalesce(
      (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'endpoint', ps.endpoint, 'p256dh', ps.p256dh, 'auth', ps.auth
        ))
        from public.push_subscriptions ps
        where ps.profile_id = c.profile_id
      ),
      '[]'::jsonb
    )
  from claimed c;
end;
$$;

create or replace function public.complete_notification(
  p_id uuid,
  p_delivered_endpoints text[],
  p_gone_endpoints text[],
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Tarayıcının iptal ettiği (404/410) abonelikler silinir.
  if coalesce(pg_catalog.cardinality(p_gone_endpoints), 0) > 0 then
    delete from public.push_subscriptions
    where endpoint = any (p_gone_endpoints);
  end if;

  if coalesce(pg_catalog.cardinality(p_delivered_endpoints), 0) > 0 then
    update public.push_subscriptions
    set last_success_at = pg_catalog.now()
    where endpoint = any (p_delivered_endpoints);
  end if;

  update public.notification_outbox o
  set status = case
        when coalesce(pg_catalog.cardinality(p_delivered_endpoints), 0) > 0 then 'sent'
        when p_error is null then 'failed' -- hiç geçerli cihaz kalmadı
        when o.attempts >= 3 then 'failed'
        else 'pending'
      end,
      sent_at = case
        when coalesce(pg_catalog.cardinality(p_delivered_endpoints), 0) > 0 then pg_catalog.now()
        else o.sent_at
      end,
      last_error = pg_catalog.left(p_error, 500)
  where o.id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- pg_cron: her dakika kuyruğu doldur; bekleyen varsa göndericiyi çağır.
-- ---------------------------------------------------------------------
create or replace function public.run_notification_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending integer;
  v_url text;
  v_secret text;
begin
  v_pending := public.enqueue_scheduled_notifications();

  if v_pending = 0 then
    return;
  end if;

  select ds.decrypted_secret into v_url
  from vault.decrypted_secrets ds where ds.name = 'notification_dispatch_url';

  select ds.decrypted_secret into v_secret
  from vault.decrypted_secrets ds where ds.name = 'notification_dispatch_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := pg_catalog.jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.set_my_notification_settings(boolean, boolean, boolean) from public, anon;
revoke all on function public.enqueue_test_notification() from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.set_my_notification_settings(boolean, boolean, boolean) to authenticated;
grant execute on function public.enqueue_test_notification() to authenticated;

revoke all on function public.enqueue_notification(uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.enqueue_scheduled_notifications() from public, anon, authenticated;
revoke all on function public.notify_teacher_request_created() from public, anon, authenticated;
revoke all on function public.notify_teacher_request_reply() from public, anon, authenticated;
revoke all on function public.notify_teacher_request_status() from public, anon, authenticated;
revoke all on function public.claim_pending_notifications(integer) from public, anon, authenticated;
revoke all on function public.complete_notification(uuid, text[], text[], text) from public, anon, authenticated;
revoke all on function public.run_notification_tick() from public, anon, authenticated;
grant execute on function public.claim_pending_notifications(integer) to service_role;
grant execute on function public.complete_notification(uuid, text[], text[], text) to service_role;
grant execute on function public.run_notification_tick() to service_role;

select cron.schedule(
  'notification-tick',
  '* * * * *',
  $$select public.run_notification_tick();$$
);

notify pgrst, 'reload schema';
