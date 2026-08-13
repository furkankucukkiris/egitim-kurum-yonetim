-- Gerçek yoklama alma modülü: kilit mekanizması, güvenli/idempotent
-- toplu işaretleme RPC'si, öğretmen kapsamlı roster RPC'si ve
-- yönetici için yoklaması alınmamış geçmiş oturum uyarısı.
--
-- attendance tablosu, attendance_status enum'u ve
-- attendance_select_scoped RLS politikası zaten mevcuttu (initial
-- schema + 20260727210000 + 20260810130000/150000) — bu migration
-- onları değiştirmez, yalnızca üzerine inşa eder.

-- =========================================================
-- 1. lesson_sessions: yoklama kilidi sütunları.
-- =========================================================

alter table public.lesson_sessions
  add column if not exists attendance_locked_at timestamptz,
  add column if not exists attendance_locked_by uuid references public.profiles(id);

-- =========================================================
-- 2. attendance: doğrudan istemci insert/update'i kapat. Tüm yazma
--    işlemleri mark_attendance() üzerinden geçmeli — böylece kilit
--    kontrolü, tarih bazlı roster doğrulaması ve audit log tek bir
--    yerde ve atlanamaz biçimde uygulanır (bu depoda profiles,
--    lesson_sessions, guardians vb. için de kullanılan desen).
-- =========================================================

revoke insert, update, delete
on public.attendance
from authenticated;

-- =========================================================
-- 3. get_attendance_roster: bir veya daha fazla ders oturumu için,
--    o oturumun tarihinde gerçekten aktif olan öğrenci listesini ve
--    (varsa) mevcut yoklama kaydını döner. Teacher yalnızca kendi
--    oturumlarını sorgulayabilir; başka oturum id'si verilirse o
--    oturum sonuçta yer almaz (sessizce filtrelenir, hata vermez —
--    çağıran taraf zaten yalnızca kendi gördüğü oturum id'lerini
--    gönderir).
-- =========================================================

create or replace function public.get_attendance_roster(
  p_lesson_session_ids uuid[]
)
returns table (
  lesson_session_id uuid,
  enrollment_id uuid,
  student_id uuid,
  student_first_name text,
  student_last_name text,
  attendance_id uuid,
  status public.attendance_status,
  note text,
  notified_at timestamptz
)
language plpgsql
stable
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

  return query
  select
    ls.id,
    e.id,
    s.id,
    s.first_name,
    s.last_name,
    a.id,
    a.status,
    a.note,
    a.notified_at
  from public.lesson_sessions ls
  inner join public.enrollments e
    on e.class_group_id = ls.class_group_id
    and e.organization_id = ls.organization_id
    and e.status = 'active'::public.enrollment_status
    and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
    and (
      e.ends_on is null
      or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date
    )
  inner join public.students s
    on s.id = e.student_id
  left join public.attendance a
    on a.lesson_session_id = ls.id
    and a.student_id = s.id
  where ls.id = any(p_lesson_session_ids)
    and ls.organization_id = v_organization_id
    and (
      public.is_admin()
      or (
        public.current_app_role() = 'teacher'::public.app_role
        and public.teacher_owns_session(ls.id)
      )
    )
  order by s.last_name, s.first_name;
end;
$$;

revoke all on function public.get_attendance_roster(uuid[]) from public, anon;
grant execute on function public.get_attendance_roster(uuid[]) to authenticated;

-- =========================================================
-- 4. mark_attendance: tek seferde birden çok öğrencinin yoklamasını
--    güvenli, idempotent biçimde işler (tek fonksiyon çağrısı = tek
--    transaction). Her giriş için:
--      - oturumun kilitli olmadığını,
--      - çağıranın bu oturum için yetkili olduğunu (admin veya
--        oturumun öğretmeni),
--      - öğrencinin bu oturum TARİHİNDE gerçekten bu programa aktif
--        kayıtlı olduğunu (sonradan kaydolan/önceden ayrılan öğrenci
--        reddedilir)
--    doğrular; ardından (lesson_session_id, student_id) tekil kısıtı
--    üzerinden upsert yapar ve değişen durumu audit_logs'a yazar.
-- =========================================================

create or replace function public.mark_attendance(
  p_lesson_session_id uuid,
  p_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid := public.current_organization_id();
  v_role public.app_role := public.current_app_role();
  v_session_id uuid;
  v_class_group_id uuid;
  v_starts_at timestamptz;
  v_cancelled_at timestamptz;
  v_locked_at timestamptz;
  v_session_date date;
  v_entry jsonb;
  v_student_id uuid;
  v_status text;
  v_note text;
  v_notify boolean;
  v_enrollment_id uuid;
  v_old_status public.attendance_status;
  v_old_note text;
  v_attendance_id uuid;
  v_entry_count integer := 0;
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  select ls.id, ls.class_group_id, ls.starts_at,
         ls.cancelled_at, ls.attendance_locked_at
  into v_session_id, v_class_group_id, v_starts_at,
       v_cancelled_at, v_locked_at
  from public.lesson_sessions ls
  where ls.id = p_lesson_session_id
    and ls.organization_id = v_organization_id;

  if v_session_id is null then
    raise exception 'Ders oturumu bulunamadı.';
  end if;

  if not (
    public.is_admin()
    or (
      v_role = 'teacher'::public.app_role
      and public.teacher_owns_session(v_session_id)
    )
  ) then
    raise exception 'Bu oturum için yoklama girme yetkiniz bulunmuyor.';
  end if;

  if v_locked_at is not null then
    raise exception 'Bu oturumun yoklaması kilitli; değişiklik için yönetici kilidi açmalıdır.';
  end if;

  if v_cancelled_at is not null then
    raise exception 'İptal edilmiş bir oturum için yoklama girilemez.';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'Geçersiz yoklama verisi.';
  end if;

  v_session_date := (v_starts_at at time zone 'Europe/Istanbul')::date;

  for v_entry in select * from jsonb_array_elements(p_entries)
  loop
    v_entry_count := v_entry_count + 1;

    v_student_id := nullif(v_entry->>'student_id', '')::uuid;
    v_status := v_entry->>'status';
    v_note := nullif(pg_catalog.btrim(coalesce(v_entry->>'note', '')), '');
    v_notify := coalesce((v_entry->>'notify_guardian')::boolean, false);

    if v_student_id is null then
      raise exception 'Öğrenci kimliği eksik.';
    end if;

    if v_status is null or v_status not in (
      'present', 'absent', 'excused',
      'makeup_due', 'makeup_completed', 'institution_cancelled'
    ) then
      raise exception 'Geçersiz yoklama durumu: %', coalesce(v_status, 'null');
    end if;

    select e.id
    into v_enrollment_id
    from public.enrollments e
    where e.student_id = v_student_id
      and e.class_group_id = v_class_group_id
      and e.organization_id = v_organization_id
      and e.status = 'active'::public.enrollment_status
      and e.starts_on <= v_session_date
      and (e.ends_on is null or e.ends_on >= v_session_date)
    limit 1;

    if v_enrollment_id is null then
      raise exception 'Öğrenci bu oturum tarihinde bu programa kayıtlı değil.';
    end if;

    select a.status, a.note
    into v_old_status, v_old_note
    from public.attendance a
    where a.lesson_session_id = p_lesson_session_id
      and a.student_id = v_student_id;

    insert into public.attendance as att (
      organization_id, lesson_session_id, enrollment_id, student_id,
      status, note, notified_at, marked_by, marked_at, updated_at
    )
    values (
      v_organization_id, p_lesson_session_id, v_enrollment_id, v_student_id,
      v_status::public.attendance_status, v_note,
      case when v_notify then pg_catalog.now() else null end,
      v_user_id, pg_catalog.now(), pg_catalog.now()
    )
    on conflict (lesson_session_id, student_id) do update
    set
      enrollment_id = excluded.enrollment_id,
      status = excluded.status,
      note = excluded.note,
      notified_at = case
        when v_notify then coalesce(att.notified_at, excluded.notified_at)
        else att.notified_at
      end,
      marked_by = excluded.marked_by,
      marked_at = excluded.marked_at,
      updated_at = excluded.updated_at
    returning att.id into v_attendance_id;

    if v_old_status is null
       or v_old_status is distinct from v_status::public.attendance_status
       or v_old_note is distinct from v_note then
      insert into public.audit_logs (
        organization_id, actor_profile_id, table_name, record_id,
        action, old_data, new_data
      )
      values (
        v_organization_id, v_user_id, 'attendance', v_attendance_id::text,
        'mark_attendance',
        case
          when v_old_status is null then null
          else jsonb_build_object('status', v_old_status, 'note', v_old_note)
        end,
        jsonb_build_object('status', v_status, 'note', v_note)
      );
    end if;
  end loop;

  if v_entry_count = 0 then
    raise exception 'En az bir öğrenci için yoklama girilmelidir.';
  end if;
end;
$$;

revoke all on function public.mark_attendance(uuid, jsonb) from public, anon;
grant execute on function public.mark_attendance(uuid, jsonb) to authenticated;

-- =========================================================
-- 5. lock_session_attendance / unlock_session_attendance: yalnızca
--    admin. Kilitliyken hem teacher hem admin mark_attendance()
--    çağıramaz; admin yalnızca gerekçe belirterek kilidi açabilir,
--    bu işlem audit_logs'a yazılır.
-- =========================================================

create or replace function public.lock_session_attendance(
  p_lesson_session_id uuid
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

  if not public.is_admin() then
    raise exception 'Yoklama kilitleme yetkiniz bulunmuyor.';
  end if;

  update public.lesson_sessions
  set attendance_locked_at = pg_catalog.now(),
      attendance_locked_by = v_user_id
  where id = p_lesson_session_id
    and organization_id = v_organization_id;

  if not found then
    raise exception 'Ders oturumu bulunamadı.';
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', p_lesson_session_id::text,
    'lock_attendance', null,
    jsonb_build_object('attendance_locked_at', pg_catalog.now())
  );
end;
$$;

create or replace function public.unlock_session_attendance(
  p_lesson_session_id uuid,
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
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Yoklama kilidini açma yetkiniz bulunmuyor.';
  end if;

  if v_reason is null then
    raise exception 'Kilidi açma gerekçesi zorunludur.';
  end if;

  update public.lesson_sessions
  set attendance_locked_at = null,
      attendance_locked_by = null
  where id = p_lesson_session_id
    and organization_id = v_organization_id
    and attendance_locked_at is not null;

  if not found then
    raise exception 'Ders oturumu bulunamadı ya da yoklaması zaten kilitli değil.';
  end if;

  insert into public.audit_logs (
    organization_id, actor_profile_id, table_name, record_id,
    action, old_data, new_data
  )
  values (
    v_organization_id, v_user_id, 'lesson_sessions', p_lesson_session_id::text,
    'unlock_attendance', null,
    jsonb_build_object('reason', v_reason)
  );
end;
$$;

revoke all on function public.lock_session_attendance(uuid) from public, anon;
grant execute on function public.lock_session_attendance(uuid) to authenticated;

revoke all on function public.unlock_session_attendance(uuid, text) from public, anon;
grant execute on function public.unlock_session_attendance(uuid, text) to authenticated;

-- =========================================================
-- 6. get_unmarked_past_sessions: admin panelinde uyarı olarak
--    gösterilecek, geçmişte kalmış ama hiç yoklama girilmemiş
--    oturumlar. İptal edilmiş oturumlar hariç tutulur.
-- =========================================================

create or replace function public.get_unmarked_past_sessions(
  p_limit integer default 20
)
returns table (
  lesson_session_id uuid,
  starts_at timestamptz,
  course_name text,
  class_group_name text,
  teacher_full_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid := public.current_organization_id();
begin
  if v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.is_admin() then
    raise exception 'Bu listeyi görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  select
    ls.id,
    ls.starts_at,
    c.name,
    cg.name,
    p.full_name
  from public.lesson_sessions ls
  inner join public.courses c on c.id = ls.course_id
  left join public.class_groups cg on cg.id = ls.class_group_id
  left join public.profiles p on p.id = ls.teacher_profile_id
  where ls.organization_id = v_organization_id
    and ls.cancelled_at is null
    and ls.starts_at < pg_catalog.now()
    and not exists (
      select 1 from public.attendance a
      where a.lesson_session_id = ls.id
    )
    and exists (
      select 1 from public.enrollments e
      where e.class_group_id = ls.class_group_id
        and e.organization_id = ls.organization_id
        and e.status = 'active'::public.enrollment_status
        and e.starts_on <= (ls.starts_at at time zone 'Europe/Istanbul')::date
        and (
          e.ends_on is null
          or e.ends_on >= (ls.starts_at at time zone 'Europe/Istanbul')::date
        )
    )
  order by ls.starts_at desc
  limit greatest(coalesce(p_limit, 20), 1);
end;
$$;

revoke all on function public.get_unmarked_past_sessions(integer) from public, anon;
grant execute on function public.get_unmarked_past_sessions(integer) to authenticated;

notify pgrst, 'reload schema';
