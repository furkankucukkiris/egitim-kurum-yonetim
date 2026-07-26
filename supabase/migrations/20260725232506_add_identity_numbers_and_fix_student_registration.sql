-- Öğrenci ve velileri T.C. kimlik numarasıyla tanımlama.
-- Eski telefon tabanlı kayıt fonksiyonunu düzeltme.

-- =========================================================
-- 1. T.C. kimlik numarası kontrol fonksiyonu
-- =========================================================

create or replace function public.is_valid_tckn(
  p_value text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_value text := pg_catalog.btrim(p_value);

  d1 integer;
  d2 integer;
  d3 integer;
  d4 integer;
  d5 integer;
  d6 integer;
  d7 integer;
  d8 integer;
  d9 integer;
  d10 integer;
  d11 integer;

  v_expected_10 integer;
  v_expected_11 integer;
begin
  if v_value !~ '^[1-9][0-9]{10}$' then
    return false;
  end if;

  d1 := pg_catalog.substr(v_value, 1, 1)::integer;
  d2 := pg_catalog.substr(v_value, 2, 1)::integer;
  d3 := pg_catalog.substr(v_value, 3, 1)::integer;
  d4 := pg_catalog.substr(v_value, 4, 1)::integer;
  d5 := pg_catalog.substr(v_value, 5, 1)::integer;
  d6 := pg_catalog.substr(v_value, 6, 1)::integer;
  d7 := pg_catalog.substr(v_value, 7, 1)::integer;
  d8 := pg_catalog.substr(v_value, 8, 1)::integer;
  d9 := pg_catalog.substr(v_value, 9, 1)::integer;
  d10 := pg_catalog.substr(v_value, 10, 1)::integer;
  d11 := pg_catalog.substr(v_value, 11, 1)::integer;

  v_expected_10 :=
    (
      (
        (
          (d1 + d3 + d5 + d7 + d9) * 7
          - (d2 + d4 + d6 + d8)
        ) % 10
      ) + 10
    ) % 10;

  v_expected_11 :=
    (
      d1 + d2 + d3 + d4 + d5
      + d6 + d7 + d8 + d9 + d10
    ) % 10;

  return
    d10 = v_expected_10
    and d11 = v_expected_11;
end;
$$;

revoke all
on function public.is_valid_tckn(text)
from public;

-- =========================================================
-- 2. Kimlik numarası sütunları
-- =========================================================

alter table public.students
add column if not exists identity_number text;

alter table public.guardians
add column if not exists identity_number text;

-- Bu aşamada tabloların boş olması bekleniyor.
-- Eski kayıt varsa migration sessizce eksik kimlik bırakmasın.

do $$
begin
  if exists (
    select 1
    from public.students
    where identity_number is null
  ) then
    raise exception
      'Mevcut öğrenci kayıtlarında T.C. kimlik numarası eksik.';
  end if;

  if exists (
    select 1
    from public.guardians
    where identity_number is null
  ) then
    raise exception
      'Mevcut veli kayıtlarında T.C. kimlik numarası eksik.';
  end if;
end;
$$;

alter table public.students
alter column identity_number set not null;

alter table public.guardians
alter column identity_number set not null;

alter table public.students
add constraint students_identity_number_valid_check
check (public.is_valid_tckn(identity_number));

alter table public.guardians
add constraint guardians_identity_number_valid_check
check (public.is_valid_tckn(identity_number));

-- Aynı kurumda aynı T.C. kimlik numarası yalnızca bir kez bulunabilir.

create unique index students_org_identity_number_unique
on public.students (
  organization_id,
  identity_number
);

create unique index guardians_org_identity_number_unique
on public.guardians (
  organization_id,
  identity_number
);

-- =========================================================
-- 3. Eski telefon tabanlı fonksiyonu kaldır
-- =========================================================

drop function if exists public.create_student_with_guardian(
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
);

-- =========================================================
-- 4. Yeni T.C. kimlik tabanlı kayıt fonksiyonu
-- =========================================================

create or replace function public.create_student_with_guardian(
  p_student_identity_number text,
  p_student_first_name text,
  p_student_last_name text,

  p_guardian_identity_number text,
  p_guardian_full_name text,
  p_guardian_phone text,

  p_birth_date date default null,
  p_registration_date date default current_date,
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
  v_organization_id := public.current_organization_id();

  if v_user_id is null or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenci kaydı oluşturma yetkiniz bulunmuyor.';
  end if;

  -- Formda boşluk veya ayraç girilse bile yalnızca rakamları alır.

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

  if pg_catalog.char_length(v_student_first_name) < 2 then
    raise exception
      'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_student_last_name) < 2 then
    raise exception
      'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_full_name) < 2 then
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
     and p_birth_date > current_date then
    raise exception
      'Doğum tarihi gelecekte olamaz.';
  end if;

  if p_registration_date is not null
     and p_registration_date > current_date then
    raise exception
      'Kayıt tarihi gelecekte olamaz.';
  end if;

  if exists (
    select 1
    from public.students
    where organization_id = v_organization_id
      and identity_number = v_student_identity_number
  ) then
    raise exception
      'Bu T.C. kimlik numarasıyla kayıtlı bir öğrenci zaten var.';
  end if;

  /*
   * Veli T.C. kimlik numarasına göre bulunur.
   * Aynı veli yeniden girilirse telefonu ve adı güncellenir.
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
    coalesce(p_registration_date, current_date),
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

-- =========================================================
-- 5. Fonksiyon izinleri
-- =========================================================

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

-- =========================================================
-- 6. T.C. kimlik sütunlarını doğrudan API okumalarından koru
-- =========================================================

revoke all
on public.students
from authenticated;

grant select (
  id,
  organization_id,
  first_name,
  last_name,
  birth_date,
  registration_date,
  status,
  exit_date,
  exit_reason,
  notes,
  created_by,
  created_at,
  updated_at
)
on public.students
to authenticated;

revoke all
on public.guardians
from authenticated;

grant select (
  id,
  organization_id,
  full_name,
  phone,
  secondary_phone,
  email,
  invoice_title,
  invoice_address,
  created_at,
  updated_at
)
on public.guardians
to authenticated;

revoke all
on public.student_guardians
from authenticated;

grant select
on public.student_guardians
to authenticated;

-- PostgREST fonksiyon ve sütun listesini yeniden okusun.

notify pgrst, 'reload schema';