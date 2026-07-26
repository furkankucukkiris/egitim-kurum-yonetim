-- Öğrenci kayıtlarındaki tarih kontrollerini
-- veritabanının UTC tarihinden bağımsız olarak
-- Europe/Istanbul saat dilimine göre gerçekleştirir.

create or replace function public.create_student_with_guardian(
  p_student_identity_number text,
  p_student_first_name text,
  p_student_last_name text,

  p_guardian_identity_number text,
  p_guardian_full_name text,
  p_guardian_phone text,

  p_birth_date date default null,
  p_registration_date date default null,
  p_student_notes text default null,
  p_guardian_secondary_phone text default null,
  p_guardian_email text default null,
  p_relationship text default 'Veli'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;

  -- Supabase veritabanının UTC tarihini değil,
  -- İstanbul'daki gerçek takvim tarihini kullanır.
  v_today date :=
    (pg_catalog.now() at time zone 'Europe/Istanbul')::date;

  v_student_id uuid;
  v_guardian_id uuid;

  v_student_identity_number text;
  v_guardian_identity_number text;

  v_student_first_name text;
  v_student_last_name text;

  v_guardian_full_name text;
  v_guardian_phone text;
  v_guardian_secondary_phone text;
  v_guardian_email text;

  v_student_notes text;
  v_relationship text;
begin
  v_organization_id :=
    public.current_organization_id();

  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci kaydı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_student_identity_number :=
    pg_catalog.regexp_replace(
      coalesce(p_student_identity_number, ''),
      '[^0-9]',
      '',
      'g'
    );

  v_guardian_identity_number :=
    pg_catalog.regexp_replace(
      coalesce(p_guardian_identity_number, ''),
      '[^0-9]',
      '',
      'g'
    );

  v_student_first_name :=
    pg_catalog.btrim(
      coalesce(p_student_first_name, '')
    );

  v_student_last_name :=
    pg_catalog.btrim(
      coalesce(p_student_last_name, '')
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

  v_student_notes :=
    pg_catalog.btrim(
      coalesce(p_student_notes, '')
    );

  v_relationship :=
    pg_catalog.btrim(
      coalesce(p_relationship, 'Veli')
    );

  if not public.is_valid_tckn(
    v_student_identity_number
  ) then
    raise exception
      'Öğrencinin T.C. kimlik numarası geçerli değil.';
  end if;

  if not public.is_valid_tckn(
    v_guardian_identity_number
  ) then
    raise exception
      'Velinin T.C. kimlik numarası geçerli değil.';
  end if;

  if v_student_identity_number =
     v_guardian_identity_number then
    raise exception
      'Öğrenci ve veli T.C. kimlik numaraları aynı olamaz.';
  end if;

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

  /*
   * Doğum tarihi ve kayıt tarihi artık
   * İstanbul'daki bugünün tarihiyle karşılaştırılır.
   */

  if p_birth_date is not null
     and p_birth_date > v_today then
    raise exception
      'Doğum tarihi gelecekte olamaz.';
  end if;

  if p_registration_date is not null
     and p_registration_date > v_today then
    raise exception
      'Kayıt tarihi gelecekte olamaz.';
  end if;

  if exists (
    select 1
    from public.students
    where organization_id = v_organization_id
      and identity_number =
        v_student_identity_number
  ) then
    raise exception
      'Bu T.C. kimlik numarasıyla kayıtlı bir öğrenci zaten var.';
  end if;

  /*
   * Veli T.C. kimlik numarasına göre bulunur.
   * Veli mevcutsa iletişim bilgileri güncellenir.
   */

  insert into public.guardians as existing_guardian (
    organization_id,
    identity_number,
    full_name,
    phone,
    secondary_phone,
    email
  )
  values (
    v_organization_id,
    v_guardian_identity_number,
    v_guardian_full_name,
    v_guardian_phone,
    nullif(v_guardian_secondary_phone, ''),
    nullif(v_guardian_email, '')
  )
  on conflict (
    organization_id,
    identity_number
  )
  do update set
    full_name = excluded.full_name,
    phone = excluded.phone,

    secondary_phone = coalesce(
      nullif(excluded.secondary_phone, ''),
      existing_guardian.secondary_phone
    ),

    email = coalesce(
      nullif(excluded.email, ''),
      existing_guardian.email
    ),

    updated_at = pg_catalog.now()
  returning id into v_guardian_id;

  insert into public.students (
    organization_id,
    identity_number,
    first_name,
    last_name,
    birth_date,
    registration_date,
    status,
    notes,
    created_by
  )
  values (
    v_organization_id,
    v_student_identity_number,
    v_student_first_name,
    v_student_last_name,
    p_birth_date,

    -- Tarih boş gelirse İstanbul'daki bugünün tarihini kullanır.
    coalesce(p_registration_date, v_today),

    'active'::public.record_status,
    nullif(v_student_notes, ''),
    v_user_id
  )
  returning id into v_student_id;

  insert into public.student_guardians (
    student_id,
    guardian_id,
    relationship,
    is_primary,
    may_receive_financial_messages
  )
  values (
    v_student_id,
    v_guardian_id,

    coalesce(
      nullif(v_relationship, ''),
      'Veli'
    ),

    true,
    true
  );

  return v_student_id;
end;
$$;

revoke all
on function public.create_student_with_guardian(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text
)
from public;

revoke all
on function public.create_student_with_guardian(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text
)
from anon;

grant execute
on function public.create_student_with_guardian(
  text,
  text,
  text,
  text,
  text,
  text,
  date,
  date,
  text,
  text,
  text,
  text
)
to authenticated;

notify pgrst, 'reload schema';