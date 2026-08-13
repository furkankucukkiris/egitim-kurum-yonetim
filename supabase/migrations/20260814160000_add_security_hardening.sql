-- Güvenlik ve veri yaşam döngüsü paketi:
--   1) Giriş rate-limit / başarısız deneme izleme
--   2) Admin MFA kurtarma kodu (TOTP'un kendisi Supabase Auth'ta,
--      auth.mfa_factors'ta yönetiliyor — burada yalnızca kurtarma
--      kodu için destek tablosu/fonksiyonları var)
--   3) KVKK veri sahibi talepleri: dışa aktarma + anonimleştirme

-- =========================================================
-- 1. Giriş rate-limit
-- =========================================================

create table public.login_attempts (
  id bigint generated always as identity primary key,
  email text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create index login_attempts_email_idx on public.login_attempts (email, created_at desc);

alter table public.login_attempts enable row level security;

create policy login_attempts_admin_select
on public.login_attempts
for select
to authenticated
using (public.is_admin());

create or replace function public.check_login_rate_limit(
  p_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
  v_failed_count integer;
begin
  if v_email = '' then
    return;
  end if;

  select pg_catalog.count(*)
  into v_failed_count
  from public.login_attempts
  where email = v_email
    and succeeded = false
    and created_at >= pg_catalog.now() - interval '15 minutes';

  if v_failed_count >= 5 then
    raise exception 'Çok fazla başarısız giriş denemesi yapıldı. Lütfen 15 dakika sonra tekrar deneyin.';
  end if;
end;
$$;

revoke all on function public.check_login_rate_limit(text) from public;
grant execute on function public.check_login_rate_limit(text) to anon, authenticated;

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
begin
  if v_email = '' then
    return;
  end if;

  insert into public.login_attempts (email, succeeded)
  values (v_email, coalesce(p_succeeded, false));

  -- Eski kayıtları sınırsız büyümesin diye periyodik temizle.
  delete from public.login_attempts
  where email = v_email
    and created_at < pg_catalog.now() - interval '30 days';
end;
$$;

revoke all on function public.record_login_attempt(text, boolean) from public;
grant execute on function public.record_login_attempt(text, boolean) to anon, authenticated;

-- =========================================================
-- 2. Admin MFA kurtarma kodu
-- =========================================================

create table public.admin_mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index admin_mfa_recovery_codes_profile_idx
on public.admin_mfa_recovery_codes (profile_id);

alter table public.admin_mfa_recovery_codes enable row level security;
-- Kasıtlı olarak hiçbir select/insert policy yok — tüm erişim
-- aşağıdaki security definer fonksiyonlar üzerinden (RLS'i atlarlar).

create or replace function public.store_admin_mfa_recovery_code(
  p_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := pg_catalog.btrim(coalesce(p_code, ''));
begin
  if v_user_id is null then
    raise exception 'Aktif kullanıcı bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu işlem yalnızca yöneticiler için geçerlidir.';
  end if;

  if pg_catalog.char_length(v_code) < 10 then
    raise exception 'Kurtarma kodu geçersiz.';
  end if;

  -- Yeniden kurulumda önceki kullanılmamış kodlar geçersizleşir —
  -- aynı anda yalnızca bir geçerli kurtarma kodu olabilir.
  delete from public.admin_mfa_recovery_codes
  where profile_id = v_user_id
    and used_at is null;

  insert into public.admin_mfa_recovery_codes (profile_id, code_hash)
  values (
    v_user_id,
    extensions.crypt(v_code, extensions.gen_salt('bf'))
  );
end;
$$;

revoke all on function public.store_admin_mfa_recovery_code(text) from public;
grant execute on function public.store_admin_mfa_recovery_code(text) to authenticated;

create or replace function public.verify_and_consume_admin_recovery_code(
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := pg_catalog.btrim(coalesce(p_code, ''));
  v_id uuid;
  v_code_hash text;
begin
  if v_user_id is null then
    raise exception 'Aktif kullanıcı bulunamadı.';
  end if;

  select c.id, c.code_hash
  into v_id, v_code_hash
  from public.admin_mfa_recovery_codes c
  where c.profile_id = v_user_id
    and c.used_at is null
  order by c.created_at desc
  limit 1;

  if v_id is null then
    return false;
  end if;

  if v_code_hash <> extensions.crypt(v_code, v_code_hash) then
    return false;
  end if;

  update public.admin_mfa_recovery_codes
  set used_at = pg_catalog.now()
  where id = v_id;

  return true;
end;
$$;

revoke all on function public.verify_and_consume_admin_recovery_code(text) from public;
grant execute on function public.verify_and_consume_admin_recovery_code(text) to authenticated;

-- =========================================================
-- 3. KVKK: anonimleştirme için NOT NULL gevşetmesi
--
-- Anonimleştirilmiş bir öğrenci/velinin TC kimlik no'su ve telefonu
-- artık bilinmediği için null olabilmeli. `is_valid_tckn` STRICT bir
-- fonksiyon olduğu için null girişte kontrolü otomatik geçer (check
-- constraint ihlal olmaz) — sadece NOT NULL kısıtını kaldırmak
-- yeterli. Unique index null'ları çarpışma saymaz.
-- =========================================================

alter table public.students alter column identity_number drop not null;
alter table public.guardians alter column identity_number drop not null;
alter table public.guardians alter column phone drop not null;

-- =========================================================
-- 4. KVKK: kişisel veri paketini dışa aktarma
-- =========================================================

create or replace function public.export_student_personal_data(
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_result jsonb;
begin
  if v_organization_id is null or not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz bulunmuyor.';
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.organization_id = v_organization_id
  ) then
    raise exception 'Öğrenci bulunamadı.';
  end if;

  select pg_catalog.jsonb_build_object(
    'export_generated_at', pg_catalog.now(),
    'student', (
      select pg_catalog.to_jsonb(s) - 'organization_id' - 'created_by'
      from public.students s
      where s.id = p_student_id
    ),
    'guardians', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(g) || pg_catalog.jsonb_build_object(
          'relationship', sg.relationship,
          'is_primary', sg.is_primary
        )
      ), '[]'::jsonb)
      from public.student_guardians sg
      join public.guardians g on g.id = sg.guardian_id
      where sg.student_id = p_student_id
    ),
    'enrollments', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(
        pg_catalog.to_jsonb(e) || pg_catalog.jsonb_build_object(
          'course_name', c.name
        )
      ), '[]'::jsonb)
      from public.enrollments e
      left join public.courses c on c.id = e.course_id
      where e.student_id = p_student_id
    ),
    'payments', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p)), '[]'::jsonb)
      from public.payments p
      where p.student_id = p_student_id
    ),
    'attendance', (
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'lesson_date', ls.starts_at,
        'status', a.status,
        'note', a.note
      )), '[]'::jsonb)
      from public.attendance a
      join public.lesson_sessions ls on ls.id = a.lesson_session_id
      where a.student_id = p_student_id
    )
  )
  into v_result;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, auth.uid(), 'students', p_student_id::text, 'export_personal_data', null, null
  );

  return v_result;
end;
$$;

revoke all on function public.export_student_personal_data(uuid) from public;
revoke all on function public.export_student_personal_data(uuid) from anon;
grant execute on function public.export_student_personal_data(uuid) to authenticated;

-- =========================================================
-- 5. KVKK: anonimleştirme (geri alınamaz)
-- =========================================================

create or replace function public.anonymize_student(
  p_student_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
  v_user_id uuid := auth.uid();
  v_status public.record_status;
  v_old_data jsonb;
  v_guardian_id uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if v_organization_id is null or not public.is_admin() then
    raise exception 'Bu işlem için yetkiniz bulunmuyor.';
  end if;

  if pg_catalog.char_length(v_reason) < 3 then
    raise exception 'Anonimleştirme nedeni belirtilmelidir.';
  end if;

  select s.status into v_status
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_status is null then
    raise exception 'Öğrenci bulunamadı.';
  end if;

  if v_status <> 'archived'::public.record_status then
    raise exception 'Yalnızca arşivlenmiş öğrenciler anonimleştirilebilir. Önce öğrenciyi arşivleyin.';
  end if;

  select pg_catalog.to_jsonb(s) into v_old_data
  from public.students s
  where s.id = p_student_id;

  update public.students
  set
    first_name = 'Anonim',
    last_name = 'Öğrenci',
    identity_number = null,
    birth_date = null,
    home_address = null,
    emergency_contact_name = null,
    emergency_contact_phone = null,
    health_notes = null,
    notes = null,
    photo_path = null,
    exit_reason = pg_catalog.coalesce(exit_reason, '') || ' [Anonimleştirildi: ' || v_reason || ']'
  where id = p_student_id
    and organization_id = v_organization_id;

  -- Bu öğrencinin dışında hiçbir bağlantısı olmayan veliler de
  -- anonimleştirilir (başka bir öğrencinin hâlâ ihtiyaç duyduğu
  -- veli kaydına dokunulmaz).
  for v_guardian_id in
    select sg.guardian_id
    from public.student_guardians sg
    where sg.student_id = p_student_id
  loop
    if not exists (
      select 1 from public.student_guardians other
      where other.guardian_id = v_guardian_id
        and other.student_id <> p_student_id
    ) then
      update public.guardians
      set
        full_name = 'Anonim Veli',
        identity_number = null,
        phone = null,
        secondary_phone = null,
        email = null,
        invoice_title = null,
        tax_or_identity_number = null,
        invoice_address = null
      where id = v_guardian_id
        and organization_id = v_organization_id;
    end if;
  end loop;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id, action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'students', p_student_id::text, 'anonymize',
    v_old_data,
    pg_catalog.jsonb_build_object('reason', v_reason, 'anonymized_at', pg_catalog.now())
  );
end;
$$;

revoke all on function public.anonymize_student(uuid, text) from public;
revoke all on function public.anonymize_student(uuid, text) from anon;
grant execute on function public.anonymize_student(uuid, text) to authenticated;

notify pgrst, 'reload schema';
