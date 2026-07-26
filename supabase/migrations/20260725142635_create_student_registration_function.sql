-- Öğrenci, veli ve öğrenci-veli ilişkisini tek işlemde oluşturur.

create or replace function public.create_student_with_guardian(
  p_student_first_name text,
  p_student_last_name text,
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
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_student_id uuid;
  v_guardian_id uuid;

  v_student_first_name text;
  v_student_last_name text;
  v_guardian_full_name text;
  v_guardian_phone text;
  v_guardian_phone_digits text;
  v_guardian_secondary_phone text;
  v_guardian_email text;
  v_student_notes text;
  v_relationship text;
begin
  v_organization_id := public.current_organization_id();

  if v_user_id is null or v_organization_id is null then
    raise exception 'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception 'Öğrenci kaydı oluşturma yetkiniz bulunmuyor.';
  end if;

  v_student_first_name :=
    pg_catalog.btrim(pg_catalog.coalesce(p_student_first_name, ''));

  v_student_last_name :=
    pg_catalog.btrim(pg_catalog.coalesce(p_student_last_name, ''));

  v_guardian_full_name :=
    pg_catalog.btrim(pg_catalog.coalesce(p_guardian_full_name, ''));

  v_guardian_phone :=
    pg_catalog.btrim(pg_catalog.coalesce(p_guardian_phone, ''));

  v_guardian_phone_digits :=
    pg_catalog.regexp_replace(v_guardian_phone, '[^0-9]', '', 'g');

  v_guardian_secondary_phone :=
    pg_catalog.btrim(
      pg_catalog.coalesce(p_guardian_secondary_phone, '')
    );

  v_guardian_email :=
    pg_catalog.lower(
      pg_catalog.btrim(
        pg_catalog.coalesce(p_guardian_email, '')
      )
    );

  v_student_notes :=
    pg_catalog.btrim(pg_catalog.coalesce(p_student_notes, ''));

  v_relationship :=
    pg_catalog.btrim(pg_catalog.coalesce(p_relationship, 'Veli'));

  if pg_catalog.char_length(v_student_first_name) < 2 then
    raise exception 'Öğrenci adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_student_last_name) < 2 then
    raise exception 'Öğrenci soyadı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_full_name) < 2 then
    raise exception 'Veli adı en az 2 karakter olmalıdır.';
  end if;

  if pg_catalog.char_length(v_guardian_phone_digits) < 10 then
    raise exception 'Geçerli bir veli telefon numarası girilmelidir.';
  end if;

  if p_birth_date is not null and p_birth_date > current_date then
    raise exception 'Doğum tarihi gelecekte olamaz.';
  end if;

  /*
   * Aynı kurumda aynı telefon numarasıyla kayıtlı veli varsa
   * yeni veli oluşturmak yerine mevcut veli kullanılır.
   * Bu yapı kardeş öğrenciler için gereklidir.
   */
  select g.id
  into v_guardian_id
  from public.guardians g
  where g.organization_id = v_organization_id
    and pg_catalog.regexp_replace(
      g.phone,
      '[^0-9]',
      '',
      'g'
    ) = v_guardian_phone_digits
  order by g.created_at asc
  limit 1;

  if v_guardian_id is null then
    insert into public.guardians (
      organization_id,
      full_name,
      phone,
      secondary_phone,
      email
    )
    values (
      v_organization_id,
      v_guardian_full_name,
      v_guardian_phone,
      pg_catalog.nullif(v_guardian_secondary_phone, ''),
      pg_catalog.nullif(v_guardian_email, '')
    )
    returning id into v_guardian_id;
  else
    /*
     * Mevcut veli kaydında boş olan iletişim alanlarını tamamlar.
     * Mevcut dolu bilgilerin üzerine yazmaz.
     */
    update public.guardians
    set
      secondary_phone = pg_catalog.coalesce(
        secondary_phone,
        pg_catalog.nullif(v_guardian_secondary_phone, '')
      ),
      email = pg_catalog.coalesce(
        email,
        pg_catalog.nullif(v_guardian_email, '')
      )
    where id = v_guardian_id;
  end if;

  insert into public.students (
    organization_id,
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
    v_student_first_name,
    v_student_last_name,
    p_birth_date,
    pg_catalog.coalesce(p_registration_date, current_date),
    'active'::public.record_status,
    pg_catalog.nullif(v_student_notes, ''),
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
    pg_catalog.coalesce(
      pg_catalog.nullif(v_relationship, ''),
      'Veli'
    ),
    true,
    true
  );

  return v_student_id;
end;
$$;

-- Data API tarafından gereken temel tablo yetkileri.
-- RLS politikaları erişimi kurum ve role göre sınırlamaya devam eder.

grant select, insert, update
on public.students
to authenticated;

grant select, insert, update
on public.guardians
to authenticated;

grant select, insert, update
on public.student_guardians
to authenticated;

-- Fonksiyonu anonim kullanıcılar çalıştıramaz.

revoke all
on function public.create_student_with_guardian(
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
  date,
  date,
  text,
  text,
  text,
  text
)
to authenticated;