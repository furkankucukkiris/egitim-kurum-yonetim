-- Öğrenci ve birincil veli bilgilerini güvenli biçimde günceller.
-- Öğrencileri kalıcı olarak silmek yerine arşivler.

-- =========================================================
-- 1. Öğrenci ve birincil veli güncelleme
-- =========================================================

create or replace function public.update_student_and_primary_guardian(
  p_student_id uuid,
  p_primary_guardian_id uuid,

  p_student_first_name text,
  p_student_last_name text,
  p_birth_date date,
  p_registration_date date,
  p_student_notes text,

  p_guardian_full_name text,
  p_guardian_phone text,
  p_guardian_secondary_phone text,
  p_guardian_email text,
  p_relationship text,
  p_may_receive_financial_messages boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid :=
    public.current_organization_id();

  v_today date :=
    (pg_catalog.now() at time zone 'Europe/Istanbul')::date;

  v_student_first_name text;
  v_student_last_name text;
  v_student_notes text;

  v_guardian_full_name text;
  v_guardian_phone text;
  v_guardian_secondary_phone text;
  v_guardian_email text;
  v_relationship text;

  v_old_student_data jsonb;
  v_new_student_data jsonb;

  v_old_guardian_data jsonb;
  v_new_guardian_data jsonb;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci bilgilerini düzenleme yetkiniz bulunmuyor.';
  end if;

  v_student_first_name :=
    pg_catalog.btrim(
      coalesce(p_student_first_name, '')
    );

  v_student_last_name :=
    pg_catalog.btrim(
      coalesce(p_student_last_name, '')
    );

  v_student_notes :=
    pg_catalog.btrim(
      coalesce(p_student_notes, '')
    );

  v_guardian_full_name :=
    pg_catalog.btrim(
      coalesce(p_guardian_full_name, '')
    );

  v_guardian_phone :=
    pg_catalog.btrim(
      coalesce(p_guardian_phone, '')
    );

  v_guardian_secondary_phone :=
    pg_catalog.btrim(
      coalesce(p_guardian_secondary_phone, '')
    );

  v_guardian_email :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_guardian_email, '')
      )
    );

  v_relationship :=
    pg_catalog.btrim(
      coalesce(p_relationship, 'Veli')
    );

  if pg_catalog.char_length(
    v_student_first_name
  ) < 2 then
    raise exception
      'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(
    v_student_last_name
  ) < 2 then
    raise exception
      'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(
    v_guardian_full_name
  ) < 2 then
    raise exception
      'Veli adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(
    pg_catalog.regexp_replace(
      v_guardian_phone,
      '[^0-9]',
      '',
      'g'
    )
  ) < 10 then
    raise exception
      'Geçerli bir veli telefon numarası girilmelidir.';
  end if;

  if p_birth_date is not null
     and p_birth_date > v_today then
    raise exception
      'Doğum tarihi gelecekte olamaz.';
  end if;

  if p_registration_date is null then
    raise exception
      'Kayıt tarihi zorunludur.';
  end if;

  if p_registration_date > v_today then
    raise exception
      'Kayıt tarihi gelecekte olamaz.';
  end if;

  -- Öğrencinin kullanıcının kurumuna ait olduğunu doğrular.

  select pg_catalog.jsonb_build_object(
    'first_name', s.first_name,
    'last_name', s.last_name,
    'birth_date', s.birth_date,
    'registration_date', s.registration_date,
    'notes', s.notes,
    'status', s.status
  )
  into v_old_student_data
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_old_student_data is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  -- Velinin bu öğrenciye bağlı olduğunu doğrular.

  select pg_catalog.jsonb_build_object(
    'full_name', g.full_name,
    'phone', g.phone,
    'secondary_phone', g.secondary_phone,
    'email', g.email,
    'relationship', sg.relationship,
    'may_receive_financial_messages',
      sg.may_receive_financial_messages
  )
  into v_old_guardian_data
  from public.guardians g
  inner join public.student_guardians sg
    on sg.guardian_id = g.id
  where g.id = p_primary_guardian_id
    and g.organization_id = v_organization_id
    and sg.student_id = p_student_id;

  if v_old_guardian_data is null then
    raise exception
      'Öğrenciye bağlı veli kaydı bulunamadı.';
  end if;

  update public.students
  set
    first_name = v_student_first_name,
    last_name = v_student_last_name,
    birth_date = p_birth_date,
    registration_date = p_registration_date,
    notes = nullif(v_student_notes, '')
  where id = p_student_id
    and organization_id = v_organization_id;

  update public.guardians
  set
    full_name = v_guardian_full_name,
    phone = v_guardian_phone,
    secondary_phone =
      nullif(v_guardian_secondary_phone, ''),
    email = nullif(v_guardian_email, '')
  where id = p_primary_guardian_id
    and organization_id = v_organization_id;

  update public.student_guardians
  set
    relationship = coalesce(
      nullif(v_relationship, ''),
      'Veli'
    ),
    may_receive_financial_messages =
      coalesce(
        p_may_receive_financial_messages,
        false
      )
  where student_id = p_student_id
    and guardian_id = p_primary_guardian_id;

  v_new_student_data :=
    pg_catalog.jsonb_build_object(
      'first_name', v_student_first_name,
      'last_name', v_student_last_name,
      'birth_date', p_birth_date,
      'registration_date', p_registration_date,
      'notes', nullif(v_student_notes, '')
    );

  v_new_guardian_data :=
    pg_catalog.jsonb_build_object(
      'full_name', v_guardian_full_name,
      'phone', v_guardian_phone,
      'secondary_phone',
        nullif(v_guardian_secondary_phone, ''),
      'email',
        nullif(v_guardian_email, ''),
      'relationship',
        coalesce(
          nullif(v_relationship, ''),
          'Veli'
        ),
      'may_receive_financial_messages',
        coalesce(
          p_may_receive_financial_messages,
          false
        )
    );

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'students',
    p_student_id::text,
    'update',
    v_old_student_data,
    v_new_student_data
  );

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'guardians',
    p_primary_guardian_id::text,
    'update',
    v_old_guardian_data,
    v_new_guardian_data
  );
end;
$$;

-- =========================================================
-- 2. Öğrenciyi arşivleme
-- =========================================================

create or replace function public.archive_student(
  p_student_id uuid,
  p_exit_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid :=
    public.current_organization_id();

  v_today date :=
    (pg_catalog.now() at time zone 'Europe/Istanbul')::date;

  v_exit_reason text :=
    pg_catalog.btrim(
      coalesce(p_exit_reason, '')
    );

  v_old_data jsonb;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenciyi arşivleme yetkiniz bulunmuyor.';
  end if;

  if pg_catalog.char_length(v_exit_reason) < 3 then
    raise exception
      'Arşivleme nedeni en az 3 karakter olmalıdır.';
  end if;

  select pg_catalog.jsonb_build_object(
    'first_name', s.first_name,
    'last_name', s.last_name,
    'status', s.status,
    'exit_date', s.exit_date,
    'exit_reason', s.exit_reason
  )
  into v_old_data
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_old_data is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  update public.students
  set
    status = 'archived'::public.record_status,
    exit_date = v_today,
    exit_reason = v_exit_reason
  where id = p_student_id
    and organization_id = v_organization_id;

  -- Öğrencinin aktif veya dondurulmuş ders kayıtlarını kapatır.

  update public.enrollments
  set
    status =
      'cancelled'::public.enrollment_status,
    ends_on = coalesce(ends_on, v_today),
    notes = case
      when notes is null or notes = ''
        then 'Öğrenci arşivlendi: ' || v_exit_reason
      else
        notes || E'\nÖğrenci arşivlendi: ' ||
        v_exit_reason
    end
  where student_id = p_student_id
    and organization_id = v_organization_id
    and status in (
      'active'::public.enrollment_status,
      'frozen'::public.enrollment_status
    );

  insert into public.audit_logs (
    organization_id,
    actor_profile_id,
    table_name,
    record_id,
    action,
    old_data,
    new_data
  )
  values (
    v_organization_id,
    v_user_id,
    'students',
    p_student_id::text,
    'archive',
    v_old_data,
    pg_catalog.jsonb_build_object(
      'status', 'archived',
      'exit_date', v_today,
      'exit_reason', v_exit_reason
    )
  );
end;
$$;

-- =========================================================
-- 3. Fonksiyon izinleri
-- =========================================================

revoke all
on function public.update_student_and_primary_guardian(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
)
from public;

revoke all
on function public.update_student_and_primary_guardian(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
)
from anon;

grant execute
on function public.update_student_and_primary_guardian(
  uuid,
  uuid,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean
)
to authenticated;

revoke all
on function public.archive_student(
  uuid,
  text
)
from public;

revoke all
on function public.archive_student(
  uuid,
  text
)
from anon;

grant execute
on function public.archive_student(
  uuid,
  text
)
to authenticated;

notify pgrst, 'reload schema';