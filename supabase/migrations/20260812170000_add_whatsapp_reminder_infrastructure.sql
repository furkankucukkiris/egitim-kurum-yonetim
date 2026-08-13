-- WhatsApp hatırlatma altyapısı — Faz 1.
--
-- kurum-ayarlari/whatsapp ekranı şimdiye kadar tek bir hatırlatma
-- günü + tek bir şablon metni tutuyordu, gönderim tarafı ise hiç
-- yoktu ("Otomatik gönderim henüz aktif değil" uyarısı). Bu migration
-- bunu gerçek, izlenebilir, KVKK'ya uygun bir mesaj kuyruğuna
-- dönüştürüyor:
--
--   1) message_templates — kurum başına, olay türüne göre (6 sabit
--      kod) düzenlenebilir şablon metni. code/is_financial admin
--      tarafından değiştirilemez (yalnızca body_template/is_active) —
--      bir şablonun finansal olup olmadığı, aşağıdaki rıza kontrolünün
--      dayanağı olduğu için sabit tutuluyor.
--   2) outbound_messages — asıl kuyruk. authenticated'a hiç yazma
--      izni yok (cash_movements ile aynı desen), TÜM yazmalar bu
--      dosyadaki security definer RPC'ler üzerinden. Oluşturma anında
--      BEFORE INSERT trigger ile hem "veli gerçekten bu öğrencinin
--      velisi mi" hem (finansal şablonlarda) "rıza var mı" veritabanı
--      seviyesinde zorunlu kılınıyor — RPC'nin kendi kontrolünden
--      bağımsız ikinci bir savunma katmanı.
--   3) delivery_attempts — her gönderim denemesinin (başarılı/başarısız)
--      kalıcı kaydı. Gerçek sağlayıcı entegrasyonu YOK (bu depoda ilk
--      kez — src/lib/whatsapp/adapter.ts içindeki NullWhatsAppAdapter
--      HER ZAMAN 'provider_not_configured' ile başarısız döner) — bu
--      yüzden bir mesaj asla gerçek bir 'success' denemesi olmadan
--      'sent' durumuna geçemez (record_delivery_attempt() bunu
--      garanti eder).
--   4) Onay adımı: generate_upcoming_payment_reminders() (tek
--      bağlanan gerçek tetikleyici — bekleyen aidat tahakkukları)
--      dahil hiçbir yol mesajı doğrudan 'approved'/'sent' yapamaz,
--      hepsi 'pending_approval' ile başlar — admin approve_outbound_message()
--      ile gözden geçirip onaylamadan gönderim denemesi yapılamaz.
--
-- Diğer 5 şablon (payment_overdue, lesson_time_change,
-- lesson_cancellation, makeup_scheduled, trial_reminder) tohumlanıyor
-- ve create_outbound_message() üzerinden kullanılabilir durumda, ama
-- kendi gerçek tetikleyicilerine (iptal/yeniden planlama RPC'leri vb.)
-- bu migration'da BAĞLANMIYOR — trial_reminder için zaten bu şemada
-- bir "deneme dersi" kavramı yok. Bu, sonraki bir faz.

-- ---------------------------------------------------------------
-- 1) Enum'lar
-- ---------------------------------------------------------------

create type public.message_template_code as enum (
  'payment_upcoming',
  'payment_overdue',
  'lesson_time_change',
  'lesson_cancellation',
  'makeup_scheduled',
  'trial_reminder'
);

create type public.outbound_message_status as enum (
  'pending_approval',
  'approved',
  'sending',
  'sent',
  'failed',
  'cancelled'
);

create type public.delivery_attempt_status as enum (
  'success',
  'failed'
);

-- ---------------------------------------------------------------
-- 2) Tablolar
-- ---------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  code public.message_template_code not null,
  name text not null,
  body_template text not null,
  is_financial boolean not null,
  is_active boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, code)
);

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  template_id uuid not null references public.message_templates(id) on delete restrict,
  event_type public.message_template_code not null,
  student_id uuid not null references public.students(id),
  guardian_id uuid not null references public.guardians(id),
  is_financial boolean not null,
  recipient_phone text not null,
  rendered_body text not null,
  placeholders jsonb not null default '{}'::jsonb,
  related_record_type text,
  related_record_id uuid,
  idempotency_key text not null,
  status public.outbound_message_status not null default 'pending_approval',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  cancelled_by uuid references public.profiles(id),
  cancelled_at timestamptz,
  cancellation_reason text,
  sent_at timestamptz,
  updated_at timestamptz not null default pg_catalog.now(),
  unique (organization_id, idempotency_key)
);

create index outbound_messages_org_status_idx
on public.outbound_messages (organization_id, status, created_at desc);

create index outbound_messages_guardian_idx
on public.outbound_messages (guardian_id);

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.outbound_messages(id),
  organization_id uuid not null references public.organizations(id),
  attempted_at timestamptz not null default pg_catalog.now(),
  status public.delivery_attempt_status not null,
  provider text not null,
  provider_message_id text,
  error_code text,
  error_message text,
  attempted_by uuid references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now()
);

create index delivery_attempts_message_idx
on public.delivery_attempts (message_id, attempted_at desc);

create trigger message_templates_set_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

create trigger outbound_messages_set_updated_at
before update on public.outbound_messages
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- 3) Rıza / hedef doğrulama — INSERT anında, RPC'den bağımsız ikinci
-- savunma katmanı.
-- ---------------------------------------------------------------

create or replace function public.enforce_outbound_message_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_may_receive boolean;
begin
  select sg.may_receive_financial_messages
  into v_may_receive
  from public.student_guardians sg
  where sg.student_id = new.student_id
    and sg.guardian_id = new.guardian_id;

  if not found then
    raise exception 'Belirtilen veli, bu öğrencinin veli listesinde bulunamadı.';
  end if;

  if new.is_financial and coalesce(v_may_receive, false) = false then
    raise exception 'Bu veli finansal mesaj almayı kabul etmemiş.';
  end if;

  return new;
end;
$$;

create trigger outbound_messages_enforce_consent
before insert on public.outbound_messages
for each row execute function public.enforce_outbound_message_consent();

-- ---------------------------------------------------------------
-- 4) RLS — üçü de admin-only select, teacher için hiçbir politika yok
-- (kurum-ayarlari zaten tamamen admin'e kapalı, bu tam kilit onu
-- veritabanı seviyesinde de garanti ediyor). Yazma yalnızca RPC.
-- ---------------------------------------------------------------

alter table public.message_templates enable row level security;
alter table public.outbound_messages enable row level security;
alter table public.delivery_attempts enable row level security;

create policy message_templates_select_admin
on public.message_templates
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

create policy message_templates_update_admin
on public.message_templates
for update
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
)
with check (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, delete on public.message_templates from authenticated;
revoke update on public.message_templates from authenticated;
grant select on public.message_templates to authenticated;
grant update (body_template, is_active) on public.message_templates to authenticated;

create policy outbound_messages_select_admin
on public.outbound_messages
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete on public.outbound_messages from authenticated;
grant select on public.outbound_messages to authenticated;

create policy delivery_attempts_select_admin
on public.delivery_attempts
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

revoke insert, update, delete on public.delivery_attempts from authenticated;
grant select on public.delivery_attempts to authenticated;

-- ---------------------------------------------------------------
-- 5) Şablon güncellemesi denetimi — organizations ile aynı desen
-- (20260812160000): admin doğrudan .update() ile yazıyor, tek RPC
-- kapısı yok, bu yüzden AFTER UPDATE trigger izliyor.
-- ---------------------------------------------------------------

create or replace function public.audit_message_templates_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    new.organization_id, auth.uid(), 'message_templates', new.id::text, 'update',
    pg_catalog.jsonb_build_object(
      'body_template', old.body_template,
      'is_active', old.is_active
    ),
    pg_catalog.jsonb_build_object(
      'body_template', new.body_template,
      'is_active', new.is_active
    )
  );

  return new;
end;
$$;

create trigger message_templates_audit_update
after update on public.message_templates
for each row
when (
  old.body_template is distinct from new.body_template
  or old.is_active is distinct from new.is_active
)
execute function public.audit_message_templates_update();

-- ---------------------------------------------------------------
-- 6) Tohumlama — mevcut organizations.whatsapp_reminder_template
-- değeri payment_upcoming şablonuna aynen taşınıyor, sonra sütun
-- düşürülüyor (tek kaynak artık message_templates).
-- ---------------------------------------------------------------

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'payment_upcoming', 'Yaklaşan Ödeme Hatırlatması', o.whatsapp_reminder_template, true
from public.organizations o
on conflict (organization_id, code) do nothing;

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'payment_overdue', 'Gecikmiş Ödeme Bildirimi',
  'Merhaba {veli_adi}, {ogrenci_adi} için {ay_yili} ayına ait {tutar} tutarındaki ödemeniz vadesi geçmiş durumda. En kısa sürede tarafımıza ulaştırmanızı rica ederiz. {kurum_adi}',
  true
from public.organizations o
on conflict (organization_id, code) do nothing;

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'lesson_time_change', 'Ders Saati Değişikliği',
  'Merhaba {veli_adi}, {ogrenci_adi} öğrencimizin {ders_adi} dersinin saati değişmiştir. Yeni ders zamanı: {yeni_zaman}. Bilginize sunarız. {kurum_adi}',
  false
from public.organizations o
on conflict (organization_id, code) do nothing;

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'lesson_cancellation', 'Ders İptali Bildirimi',
  'Merhaba {veli_adi}, {ogrenci_adi} öğrencimizin {tarih} tarihindeki {ders_adi} dersi iptal edilmiştir. {kurum_adi}',
  false
from public.organizations o
on conflict (organization_id, code) do nothing;

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'makeup_scheduled', 'Telafi Dersi Planlandı',
  'Merhaba {veli_adi}, {ogrenci_adi} öğrencimizin telafi dersi {tarih} tarihinde, saat {saat} olarak planlanmıştır. {kurum_adi}',
  false
from public.organizations o
on conflict (organization_id, code) do nothing;

insert into public.message_templates (
  organization_id, code, name, body_template, is_financial
)
select
  o.id, 'trial_reminder', 'Deneme Dersi Hatırlatması',
  'Merhaba {veli_adi}, {ogrenci_adi} için deneme dersiniz {tarih} tarihinde, saat {saat} olarak planlanmıştır. Sizi aramızda görmekten mutluluk duyarız. {kurum_adi}',
  false
from public.organizations o
on conflict (organization_id, code) do nothing;

-- ---------------------------------------------------------------
-- 7) organizations.whatsapp_reminder_template artık gereksiz —
-- düşürülmeden önce ona referans veren audit trigger'ı güncellenmesi
-- gerekiyor (20260812160000'de tanımlanmıştı).
-- ---------------------------------------------------------------

drop trigger if exists organizations_audit_update on public.organizations;

alter table public.organizations drop column whatsapp_reminder_template;

create or replace function public.audit_organizations_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    new.id, auth.uid(), 'organizations', new.id::text, 'update',
    pg_catalog.jsonb_build_object(
      'name', old.name,
      'legal_name', old.legal_name,
      'tax_number', old.tax_number,
      'phone', old.phone,
      'email', old.email,
      'timezone', old.timezone,
      'logo_path', old.logo_path,
      'whatsapp_reminder_day', old.whatsapp_reminder_day,
      'monthly_automation_enabled', old.monthly_automation_enabled,
      'sessions_generation_day', old.sessions_generation_day,
      'accruals_generation_day', old.accruals_generation_day
    ),
    pg_catalog.jsonb_build_object(
      'name', new.name,
      'legal_name', new.legal_name,
      'tax_number', new.tax_number,
      'phone', new.phone,
      'email', new.email,
      'timezone', new.timezone,
      'logo_path', new.logo_path,
      'whatsapp_reminder_day', new.whatsapp_reminder_day,
      'monthly_automation_enabled', new.monthly_automation_enabled,
      'sessions_generation_day', new.sessions_generation_day,
      'accruals_generation_day', new.accruals_generation_day
    )
  );

  return new;
end;
$$;

create trigger organizations_audit_update
after update on public.organizations
for each row
when (
  old.name is distinct from new.name
  or old.legal_name is distinct from new.legal_name
  or old.tax_number is distinct from new.tax_number
  or old.phone is distinct from new.phone
  or old.email is distinct from new.email
  or old.timezone is distinct from new.timezone
  or old.logo_path is distinct from new.logo_path
  or old.whatsapp_reminder_day is distinct from new.whatsapp_reminder_day
  or old.monthly_automation_enabled is distinct from new.monthly_automation_enabled
  or old.sessions_generation_day is distinct from new.sessions_generation_day
  or old.accruals_generation_day is distinct from new.accruals_generation_day
)
execute function public.audit_organizations_update();

-- ---------------------------------------------------------------
-- 8) Şablon metni içindeki {anahtar} yer tutucularını doldurma.
-- ---------------------------------------------------------------

create or replace function public.render_message_template(
  p_body text,
  p_placeholders jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_body text := p_body;
  v_key text;
begin
  if p_placeholders is null then
    return v_body;
  end if;

  for v_key in select pg_catalog.jsonb_object_keys(p_placeholders)
  loop
    v_body := pg_catalog.replace(
      v_body,
      '{' || v_key || '}',
      coalesce(p_placeholders ->> v_key, '')
    );
  end loop;

  return v_body;
end;
$$;

-- ---------------------------------------------------------------
-- 9) Mesaj oluşturma — tek giriş kapısı. Şablon/hedef/rıza doğrulaması,
-- yer tutucu doldurma, idempotency-key ile tekrar-önleme, denetim
-- kaydı. Her zaman 'pending_approval' ile başlar.
-- ---------------------------------------------------------------

create or replace function public.create_outbound_message(
  p_template_code public.message_template_code,
  p_student_id uuid,
  p_guardian_id uuid,
  p_placeholders jsonb,
  p_related_record_type text default null,
  p_related_record_id uuid default null,
  p_idempotency_key text default null
)
returns table (message_id uuid, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_template public.message_templates%rowtype;
  v_guardian_phone text;
  v_body text;
  v_idempotency_key text;
  v_message_id uuid;
  v_created boolean := false;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Mesaj oluşturma yetkiniz bulunmuyor.';
  end if;

  select *
  into v_template
  from public.message_templates
  where organization_id = v_organization_id
    and code = p_template_code
    and is_active = true;

  if not found then
    raise exception 'Aktif bir mesaj şablonu bulunamadı.';
  end if;

  if not exists (
    select 1 from public.students
    where id = p_student_id and organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci kaydı bulunamadı.';
  end if;

  select g.phone
  into v_guardian_phone
  from public.guardians g
  where g.id = p_guardian_id and g.organization_id = v_organization_id;

  if v_guardian_phone is null then
    raise exception 'Veli kaydı bulunamadı.';
  end if;

  if not exists (
    select 1 from public.student_guardians sg
    where sg.student_id = p_student_id and sg.guardian_id = p_guardian_id
  ) then
    raise exception 'Belirtilen veli, bu öğrencinin veli listesinde bulunamadı.';
  end if;

  if v_template.is_financial and not exists (
    select 1 from public.student_guardians sg
    where sg.student_id = p_student_id
      and sg.guardian_id = p_guardian_id
      and sg.may_receive_financial_messages = true
  ) then
    raise exception 'Bu veli finansal mesaj almayı kabul etmemiş.';
  end if;

  v_body := public.render_message_template(v_template.body_template, p_placeholders);

  v_idempotency_key := coalesce(
    nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), ''),
    p_template_code::text || ':' || p_student_id::text || ':' || p_guardian_id::text
      || ':' || coalesce(p_related_record_id::text, '')
  );

  insert into public.outbound_messages (
    organization_id, template_id, event_type, student_id, guardian_id,
    is_financial, recipient_phone, rendered_body, placeholders,
    related_record_type, related_record_id, idempotency_key, created_by
  )
  values (
    v_organization_id, v_template.id, p_template_code, p_student_id, p_guardian_id,
    v_template.is_financial, v_guardian_phone, v_body, coalesce(p_placeholders, '{}'::jsonb),
    p_related_record_type, p_related_record_id, v_idempotency_key, v_user_id
  )
  on conflict (organization_id, idempotency_key) do nothing
  returning id into v_message_id;

  if v_message_id is not null then
    v_created := true;

    insert into public.audit_logs (
      organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
    )
    values (
      v_organization_id, v_user_id, 'outbound_messages', v_message_id::text, 'create', null,
      pg_catalog.jsonb_build_object(
        'event_type', p_template_code,
        'student_id', p_student_id,
        'guardian_id', p_guardian_id,
        'status', 'pending_approval'
      )
    );
  else
    select id into v_message_id
    from public.outbound_messages
    where organization_id = v_organization_id and idempotency_key = v_idempotency_key;
  end if;

  return query select v_message_id, v_created;
end;
$$;

revoke all on function
  public.create_outbound_message(public.message_template_code, uuid, uuid, jsonb, text, uuid, text)
from public, anon;
grant execute on function
  public.create_outbound_message(public.message_template_code, uuid, uuid, jsonb, text, uuid, text)
to authenticated;

-- ---------------------------------------------------------------
-- 10) Onay / iptal / tekrar deneme — durum makinesi.
-- ---------------------------------------------------------------

create or replace function public.approve_outbound_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.outbound_message_status;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Mesaj onaylama yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'Yalnızca onay bekleyen mesajlar onaylanabilir.';
  end if;

  update public.outbound_messages
  set status = 'approved',
      approved_by = v_user_id,
      approved_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_message_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'outbound_messages', p_message_id::text, 'approve',
    pg_catalog.jsonb_build_object('status', v_status),
    pg_catalog.jsonb_build_object('status', 'approved')
  );
end;
$$;

revoke all on function public.approve_outbound_message(uuid) from public, anon;
grant execute on function public.approve_outbound_message(uuid) to authenticated;

create or replace function public.cancel_outbound_message(
  p_message_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.outbound_message_status;
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Mesaj iptal etme yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_status not in ('pending_approval', 'approved', 'failed') then
    raise exception 'Bu durumdaki bir mesaj iptal edilemez.';
  end if;

  update public.outbound_messages
  set status = 'cancelled',
      cancelled_by = v_user_id,
      cancelled_at = pg_catalog.now(),
      cancellation_reason = v_reason,
      updated_at = pg_catalog.now()
  where id = p_message_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'outbound_messages', p_message_id::text, 'cancel',
    pg_catalog.jsonb_build_object('status', v_status),
    pg_catalog.jsonb_build_object('status', 'cancelled', 'reason', v_reason)
  );
end;
$$;

revoke all on function public.cancel_outbound_message(uuid, text) from public, anon;
grant execute on function public.cancel_outbound_message(uuid, text) to authenticated;

create or replace function public.retry_outbound_message(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.outbound_message_status;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Mesajı tekrar gönderme yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_status <> 'failed' then
    raise exception 'Yalnızca başarısız mesajlar tekrar denenebilir.';
  end if;

  update public.outbound_messages
  set status = 'approved', updated_at = pg_catalog.now()
  where id = p_message_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'outbound_messages', p_message_id::text, 'retry',
    pg_catalog.jsonb_build_object('status', 'failed'),
    pg_catalog.jsonb_build_object('status', 'approved')
  );
end;
$$;

revoke all on function public.retry_outbound_message(uuid) from public, anon;
grant execute on function public.retry_outbound_message(uuid) to authenticated;

-- ---------------------------------------------------------------
-- 11) Gönderim denemesi — adapter'ın (src/lib/whatsapp/adapter.ts)
-- sonucu buraya yazılır. 'sent' durumuna YALNIZCA p_status='success'
-- ile geçilebilir; gerçek sağlayıcı bağlanana kadar bu asla olmaz.
-- ---------------------------------------------------------------

create or replace function public.mark_outbound_message_sending(
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_status public.outbound_message_status;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Mesaj gönderme yetkiniz bulunmuyor.';
  end if;

  select status into v_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_status <> 'approved' then
    raise exception 'Yalnızca onaylanmış mesajlar gönderilebilir.';
  end if;

  update public.outbound_messages
  set status = 'sending', updated_at = pg_catalog.now()
  where id = p_message_id;
end;
$$;

revoke all on function public.mark_outbound_message_sending(uuid) from public, anon;
grant execute on function public.mark_outbound_message_sending(uuid) to authenticated;

create or replace function public.record_delivery_attempt(
  p_message_id uuid,
  p_status public.delivery_attempt_status,
  p_provider text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_message_status public.outbound_message_status;
  v_attempt_id uuid;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Gönderim denemesi kaydetme yetkiniz bulunmuyor.';
  end if;

  select status into v_message_status
  from public.outbound_messages
  where id = p_message_id and organization_id = v_organization_id
  for update;

  if not found then
    raise exception 'Mesaj kaydı bulunamadı.';
  end if;

  if v_message_status <> 'sending' then
    raise exception 'Yalnızca gönderim aşamasındaki mesajlar için deneme kaydedilebilir.';
  end if;

  insert into public.delivery_attempts (
    message_id, organization_id, status, provider, provider_message_id,
    error_code, error_message, attempted_by
  )
  values (
    p_message_id, v_organization_id, p_status, p_provider, p_provider_message_id,
    p_error_code, p_error_message, v_user_id
  )
  returning id into v_attempt_id;

  update public.outbound_messages
  set status = case
        when p_status = 'success' then 'sent'::public.outbound_message_status
        else 'failed'::public.outbound_message_status
      end,
      sent_at = case when p_status = 'success' then pg_catalog.now() else sent_at end,
      updated_at = pg_catalog.now()
  where id = p_message_id;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'outbound_messages', p_message_id::text,
    case when p_status = 'success' then 'send' else 'send_failed' end,
    pg_catalog.jsonb_build_object('status', 'sending'),
    pg_catalog.jsonb_build_object(
      'status', case when p_status = 'success' then 'sent' else 'failed' end,
      'provider', p_provider,
      'error_code', p_error_code
    )
  );

  return v_attempt_id;
end;
$$;

revoke all on function
  public.record_delivery_attempt(uuid, public.delivery_attempt_status, text, text, text, text)
from public, anon;
grant execute on function
  public.record_delivery_attempt(uuid, public.delivery_attempt_status, text, text, text, text)
to authenticated;

-- ---------------------------------------------------------------
-- 12) Tek bağlanan gerçek tetikleyici: bekleyen aidat hatırlatmaları.
-- Seçilen ay için 'open'/'partial' tahakkuku olan her (öğrenci, veli)
-- çifti için (rızası olan velilere) taslak mesaj oluşturur, hepsini
-- 'pending_approval' bırakır. Aynı (tahakkuk, veli) çifti için ikinci
-- çalıştırma idempotency-key sayesinde yeni satır YARATMAZ.
-- ---------------------------------------------------------------

create or replace function public.generate_upcoming_payment_reminders(
  p_period_start date
)
returns table (
  created_count integer,
  existing_count integer,
  skipped_no_consent_count integer,
  skipped_no_guardian_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_org_name text;
  v_row record;
  v_guardian_name text;
  v_placeholders jsonb;
  v_idempotency_key text;
  v_create_message_id uuid;
  v_create_created boolean;
  v_created_count integer := 0;
  v_existing_count integer := 0;
  v_skipped_no_consent_count integer := 0;
  v_skipped_no_guardian_count integer := 0;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Hatırlatma oluşturma yetkiniz bulunmuyor.';
  end if;

  if p_period_start is null
     or pg_catalog.date_trunc('month', p_period_start::timestamp)::date <> p_period_start then
    raise exception 'Geçerli bir ay başlangıcı seçilmelidir.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_organization_id::text || ':payment_upcoming:' || p_period_start::text, 2026081700
    )
  );

  select o.name into v_org_name
  from public.organizations o
  where o.id = v_organization_id;

  for v_row in
    select
      a.id as accrual_id,
      a.net_amount - a.allocated_amount as pending,
      s.id as student_id,
      s.first_name || ' ' || s.last_name as student_name,
      sg.guardian_id as guardian_id,
      sg.may_receive_financial_messages as may_receive
    from public.accruals a
    inner join public.students s on s.id = a.student_id
    left join public.student_guardians sg on sg.student_id = s.id
    where a.organization_id = v_organization_id
      and a.period_start = p_period_start
      and a.status in ('open'::public.accrual_status, 'partial'::public.accrual_status)
  loop
    if v_row.pending <= 0 then
      continue;
    end if;

    if v_row.guardian_id is null then
      v_skipped_no_guardian_count := v_skipped_no_guardian_count + 1;
      continue;
    end if;

    if not v_row.may_receive then
      v_skipped_no_consent_count := v_skipped_no_consent_count + 1;
      continue;
    end if;

    v_idempotency_key :=
      'payment_upcoming:' || v_row.accrual_id::text || ':' || v_row.guardian_id::text;

    select g.full_name into v_guardian_name
    from public.guardians g
    where g.id = v_row.guardian_id;

    v_placeholders := pg_catalog.jsonb_build_object(
      'veli_adi', v_guardian_name,
      'ogrenci_adi', v_row.student_name,
      'ay_yili',
        public.tr_month_name(extract(month from p_period_start)::integer)
          || ' ' || extract(year from p_period_start)::text,
      'tutar', pg_catalog.to_char(v_row.pending, 'FM999G999G999D00') || ' ₺',
      'kurum_adi', v_org_name
    );

    select cm.message_id, cm.created
    into v_create_message_id, v_create_created
    from public.create_outbound_message(
      'payment_upcoming'::public.message_template_code,
      v_row.student_id,
      v_row.guardian_id,
      v_placeholders,
      'accrual',
      v_row.accrual_id,
      v_idempotency_key
    ) as cm;

    if v_create_created then
      v_created_count := v_created_count + 1;
    else
      v_existing_count := v_existing_count + 1;
    end if;
  end loop;

  return query
  select v_created_count, v_existing_count, v_skipped_no_consent_count, v_skipped_no_guardian_count;
end;
$$;

revoke all on function public.generate_upcoming_payment_reminders(date) from public, anon;
grant execute on function public.generate_upcoming_payment_reminders(date) to authenticated;

notify pgrst, 'reload schema';
