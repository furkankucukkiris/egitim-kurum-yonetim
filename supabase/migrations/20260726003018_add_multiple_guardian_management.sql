-- Bir öğrenciye birden fazla veli bağlama,
-- birincil veli değiştirme ve veli bağlantısı kaldırma.

-- =========================================================
-- 1. Her öğrencide yalnızca bir birincil veli bulunabilir
-- =========================================================

create unique index if not exists
student_guardians_one_primary_per_student
on public.student_guardians (student_id)
where is_primary = true;

-- =========================================================
-- 2. Öğrenciye veli ekleme veya mevcut veliyi bağlama
-- =========================================================

create or replace function public.add_student_guardian(
  p_student_id uuid,
  p_guardian_identity_number text,
  p_guardian_full_name text,
  p_guardian_phone text,
  p_guardian_secondary_phone text,
  p_guardian_email text,
  p_relationship text,
  p_is_primary boolean,
  p_may_receive_financial_messages boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_guardian_id uuid;

  v_student_status public.record_status;

  v_relation_count bigint;

  v_should_be_primary boolean;

  v_guardian_identity_number text;

  v_guardian_full_name text;

  v_guardian_phone text;

  v_guardian_secondary_phone text;

  v_guardian_email text;

  v_relationship text;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Veli ekleme yetkiniz bulunmuyor.';
  end if;

  select s.status
  into v_student_status
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_student_status is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  if v_student_status =
     'archived'::public.record_status then
    raise exception
      'Arşivlenmiş öğrenciye yeni veli eklenemez.';
  end if;

  v_guardian_identity_number :=
    pg_catalog.regexp_replace(
      coalesce(p_guardian_identity_number, ''),
      '[^0-9]',
      '',
      'g'
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

  if not public.is_valid_tckn(
    v_guardian_identity_number
  ) then
    raise exception
      'Veli T.C. kimlik numarası 11 rakamdan oluşmalı ve sıfırla başlamamalıdır.';
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

  select pg_catalog.count(*)
  into v_relation_count
  from public.student_guardians sg
  where sg.student_id = p_student_id;

  v_should_be_primary :=
    coalesce(p_is_primary, false)
    or v_relation_count = 0;

  /*
   * Aynı kurumda aynı T.C. kimlik numaralı veli varsa
   * mevcut kayıt kullanılır ve iletişim bilgileri güncellenir.
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

  /*
   * Yeni veli birincil olacaksa mevcut birincil
   * veli bağlantıları önce pasif hâle getirilir.
   */

  if v_should_be_primary then
    update public.student_guardians
    set is_primary = false
    where student_id = p_student_id
      and is_primary = true;
  end if;

  insert into public.student_guardians (
    student_id,
    guardian_id,
    relationship,
    is_primary,
    may_receive_financial_messages
  )
  values (
    p_student_id,
    v_guardian_id,

    coalesce(
      nullif(v_relationship, ''),
      'Veli'
    ),

    v_should_be_primary,

    coalesce(
      p_may_receive_financial_messages,
      false
    )
  )
  on conflict (
    student_id,
    guardian_id
  )
  do update set
    relationship = excluded.relationship,

    is_primary = excluded.is_primary,

    may_receive_financial_messages =
      excluded.may_receive_financial_messages;

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
    'student_guardians',

    p_student_id::text || ':' ||
      v_guardian_id::text,

    'upsert',

    null,

    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'guardian_id', v_guardian_id,
      'relationship', v_relationship,
      'is_primary', v_should_be_primary,
      'may_receive_financial_messages',
        coalesce(
          p_may_receive_financial_messages,
          false
        )
    )
  );

  return v_guardian_id;
end;
$$;

-- =========================================================
-- 3. Veliyi birincil yapma
-- =========================================================

create or replace function public.set_primary_student_guardian(
  p_student_id uuid,
  p_guardian_id uuid
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

  v_student_status public.record_status;

  v_relationship_exists boolean;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Birincil veli değiştirme yetkiniz bulunmuyor.';
  end if;

  select s.status
  into v_student_status
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_student_status is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  if v_student_status =
     'archived'::public.record_status then
    raise exception
      'Arşivlenmiş öğrencinin birincil velisi değiştirilemez.';
  end if;

  select exists (
    select 1
    from public.student_guardians sg
    inner join public.guardians g
      on g.id = sg.guardian_id
    where sg.student_id = p_student_id
      and sg.guardian_id = p_guardian_id
      and g.organization_id = v_organization_id
  )
  into v_relationship_exists;

  if not v_relationship_exists then
    raise exception
      'Öğrenciye bağlı veli kaydı bulunamadı.';
  end if;

  update public.student_guardians
  set is_primary = false
  where student_id = p_student_id
    and is_primary = true;

  update public.student_guardians
  set is_primary = true
  where student_id = p_student_id
    and guardian_id = p_guardian_id;

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
    'student_guardians',

    p_student_id::text || ':' ||
      p_guardian_id::text,

    'set_primary',

    null,

    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'guardian_id', p_guardian_id,
      'is_primary', true
    )
  );
end;
$$;

-- =========================================================
-- 4. Veli bağlantısını kaldırma
-- =========================================================

create or replace function public.remove_student_guardian(
  p_student_id uuid,
  p_guardian_id uuid
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

  v_student_status public.record_status;

  v_relation_count bigint;

  v_was_primary boolean;

  v_next_guardian_id uuid;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Veli bağlantısını kaldırma yetkiniz bulunmuyor.';
  end if;

  select s.status
  into v_student_status
  from public.students s
  where s.id = p_student_id
    and s.organization_id = v_organization_id;

  if v_student_status is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  if v_student_status =
     'archived'::public.record_status then
    raise exception
      'Arşivlenmiş öğrencinin veli bağlantıları değiştirilemez.';
  end if;

  select pg_catalog.count(*)
  into v_relation_count
  from public.student_guardians sg
  where sg.student_id = p_student_id;

  if v_relation_count <= 1 then
    raise exception
      'Öğrencinin tek veli bağlantısı kaldırılamaz.';
  end if;

  select sg.is_primary
  into v_was_primary
  from public.student_guardians sg
  inner join public.guardians g
    on g.id = sg.guardian_id
  where sg.student_id = p_student_id
    and sg.guardian_id = p_guardian_id
    and g.organization_id = v_organization_id;

  if v_was_primary is null then
    raise exception
      'Öğrenciye bağlı veli kaydı bulunamadı.';
  end if;

  delete from public.student_guardians
  where student_id = p_student_id
    and guardian_id = p_guardian_id;

  /*
   * Kaldırılan veli birincil ise kalan velilerden biri
   * otomatik olarak birincil yapılır.
   */

  if v_was_primary then
    select sg.guardian_id
    into v_next_guardian_id
    from public.student_guardians sg
    where sg.student_id = p_student_id
    order by sg.guardian_id
    limit 1;

    update public.student_guardians
    set is_primary = true
    where student_id = p_student_id
      and guardian_id = v_next_guardian_id;
  end if;

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
    'student_guardians',

    p_student_id::text || ':' ||
      p_guardian_id::text,

    'remove',

    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'guardian_id', p_guardian_id,
      'was_primary', v_was_primary
    ),

    null
  );
end;
$$;

-- =========================================================
-- 5. Fonksiyon izinleri
-- =========================================================

revoke all
on function public.add_student_guardian(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean
)
from public;

revoke all
on function public.add_student_guardian(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean
)
from anon;

grant execute
on function public.add_student_guardian(
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  boolean
)
to authenticated;

revoke all
on function public.set_primary_student_guardian(
  uuid,
  uuid
)
from public;

revoke all
on function public.set_primary_student_guardian(
  uuid,
  uuid
)
from anon;

grant execute
on function public.set_primary_student_guardian(
  uuid,
  uuid
)
to authenticated;

revoke all
on function public.remove_student_guardian(
  uuid,
  uuid
)
from public;

revoke all
on function public.remove_student_guardian(
  uuid,
  uuid
)
from anon;

grant execute
on function public.remove_student_guardian(
  uuid,
  uuid
)
to authenticated;

notify pgrst, 'reload schema';