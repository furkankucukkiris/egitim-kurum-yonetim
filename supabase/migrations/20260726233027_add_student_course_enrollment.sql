-- Öğrenciyi ders seansına kaydeder.
-- Ücret, indirim, kontenjan ve MEB kaydını tek işlemde oluşturur.

-- Aynı öğrencinin aynı derste aynı anda yalnızca
-- bir aktif veya dondurulmuş kaydı olabilir.

create unique index if not exists
enrollments_one_open_course_per_student
on public.enrollments (
  organization_id,
  student_id,
  course_id
)
where status in (
  'active'::public.enrollment_status,
  'frozen'::public.enrollment_status
);

create or replace function
public.create_enrollment_with_meb_registration(
  p_student_id uuid,
  p_course_id uuid,
  p_class_group_id uuid,

  p_starts_on date,
  p_ends_on date,

  p_list_monthly_fee numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_due_day integer,
  p_notes text,

  p_meb_status text,
  p_meb_registration_number text,
  p_meb_valid_from date,
  p_meb_valid_until date,
  p_meb_non_registration_reason text,
  p_meb_note text
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

  v_student_status public.record_status;

  v_group_course_id uuid;
  v_group_teacher_id uuid;
  v_group_capacity integer;
  v_group_is_active boolean;
  v_group_starts_on date;
  v_group_ends_on date;

  v_course_is_active boolean;

  v_current_student_count bigint;

  v_enrollment_id uuid;
  v_meb_registration_id uuid;

  v_discount_type text;
  v_discount_value numeric(12,2);
  v_net_monthly_fee numeric(12,2);

  v_notes text;

  v_meb_registration_number text;
  v_meb_non_registration_reason text;
  v_meb_note text;

  v_meb_valid_from date;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if not public.can_manage_finance() then
    raise exception
      'Öğrenciyi derse kaydetme yetkiniz bulunmuyor.';
  end if;

  select s.status
  into v_student_status
  from public.students s
  where s.id = p_student_id
    and s.organization_id =
      v_organization_id;

  if v_student_status is null then
    raise exception
      'Öğrenci kaydı bulunamadı.';
  end if;

  if v_student_status <>
     'active'::public.record_status then
    raise exception
      'Yalnızca aktif öğrenciler yeni bir derse kaydedilebilir.';
  end if;

  if p_class_group_id is null then
    raise exception
      'Ders seansı seçilmelidir.';
  end if;

  /*
   * Seans satırı kilitlenir. Aynı anda iki kayıt
   * yapılırsa kontenjanın aşılması engellenir.
   */

  select
    cg.course_id,
    cg.teacher_profile_id,
    cg.capacity,
    cg.is_active,
    cg.starts_on,
    cg.ends_on,
    c.is_active
  into
    v_group_course_id,
    v_group_teacher_id,
    v_group_capacity,
    v_group_is_active,
    v_group_starts_on,
    v_group_ends_on,
    v_course_is_active
  from public.class_groups cg
  inner join public.courses c
    on c.id = cg.course_id
  where cg.id = p_class_group_id
    and cg.organization_id =
      v_organization_id
  for update of cg;

  if v_group_course_id is null then
    raise exception
      'Ders seansı bulunamadı.';
  end if;

  if v_group_course_id <> p_course_id then
    raise exception
      'Seçilen seans bu derse ait değil.';
  end if;

  if not v_course_is_active then
    raise exception
      'Pasif bir derse öğrenci kaydedilemez.';
  end if;

  if not v_group_is_active then
    raise exception
      'Pasif bir ders seansına öğrenci kaydedilemez.';
  end if;

  if p_starts_on is null then
    raise exception
      'Ders kayıt başlangıç tarihi zorunludur.';
  end if;

  if p_ends_on is not null
     and p_ends_on < p_starts_on then
    raise exception
      'Bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  if v_group_starts_on is not null
     and p_starts_on < v_group_starts_on then
    raise exception
      'Öğrenci kayıt tarihi seansın başlangıç tarihinden önce olamaz.';
  end if;

  if v_group_ends_on is not null
     and p_starts_on > v_group_ends_on then
    raise exception
      'Öğrenci kayıt tarihi seansın bitiş tarihinden sonra olamaz.';
  end if;

  if v_group_ends_on is not null
     and p_ends_on is not null
     and p_ends_on > v_group_ends_on then
    raise exception
      'Öğrenci bitiş tarihi seansın bitiş tarihinden sonra olamaz.';
  end if;

  if exists (
    select 1
    from public.enrollments e
    where e.organization_id =
      v_organization_id
      and e.student_id = p_student_id
      and e.course_id = p_course_id
      and e.status in (
        'active'::public.enrollment_status,
        'frozen'::public.enrollment_status
      )
  ) then
    raise exception
      'Öğrencinin bu derste zaten aktif veya dondurulmuş bir kaydı bulunuyor.';
  end if;

  select count(*)
  into v_current_student_count
  from public.enrollments e
  where e.organization_id =
    v_organization_id
    and e.class_group_id =
      p_class_group_id
    and e.status in (
      'active'::public.enrollment_status,
      'frozen'::public.enrollment_status
    );

  if v_group_capacity is null then
    raise exception
      'Seans kapasitesi tanımlanmamış.';
  end if;

  if v_current_student_count >=
     v_group_capacity then
    raise exception
      'Seçilen ders seansında boş kontenjan bulunmuyor.';
  end if;

  if p_list_monthly_fee is null
     or p_list_monthly_fee < 0 then
    raise exception
      'Liste ücreti sıfırdan küçük olamaz.';
  end if;

  v_discount_type :=
    coalesce(
      nullif(
        pg_catalog.btrim(
          coalesce(p_discount_type, '')
        ),
        ''
      ),
      'none'
    );

  if v_discount_type not in (
    'none',
    'percent',
    'fixed'
  ) then
    raise exception
      'Geçerli bir indirim türü seçilmelidir.';
  end if;

  v_discount_value :=
    coalesce(p_discount_value, 0);

  if v_discount_value < 0 then
    raise exception
      'İndirim değeri sıfırdan küçük olamaz.';
  end if;

  if v_discount_type = 'none' then
    v_discount_value := 0;

    v_net_monthly_fee :=
      round(p_list_monthly_fee, 2);

  elsif v_discount_type = 'percent' then
    if v_discount_value > 100 then
      raise exception
        'Yüzde indirim 100 değerinden büyük olamaz.';
    end if;

    v_net_monthly_fee :=
      round(
        p_list_monthly_fee
        -
        (
          p_list_monthly_fee
          *
          v_discount_value
          /
          100
        ),
        2
      );

  else
    if v_discount_value >
       p_list_monthly_fee then
      raise exception
        'Sabit indirim liste ücretinden büyük olamaz.';
    end if;

    v_net_monthly_fee :=
      round(
        p_list_monthly_fee
        -
        v_discount_value,
        2
      );
  end if;

  if p_due_day is null
     or p_due_day < 1
     or p_due_day > 28 then
    raise exception
      'Ödeme günü 1 ile 28 arasında olmalıdır.';
  end if;

  if p_meb_status not in (
    'registered',
    'pending',
    'not_registered',
    'not_eligible',
    'rejected',
    'ended',
    'unchecked'
  ) then
    raise exception
      'Geçerli bir öğrenci MEB durumu seçilmelidir.';
  end if;

  if p_meb_valid_until is not null
     and p_meb_valid_from is not null
     and p_meb_valid_until <
       p_meb_valid_from then
    raise exception
      'MEB geçerlilik bitiş tarihi başlangıç tarihinden önce olamaz.';
  end if;

  v_meb_non_registration_reason :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          p_meb_non_registration_reason,
          ''
        )
      ),
      ''
    );

  if p_meb_status in (
    'not_registered',
    'not_eligible',
    'rejected'
  )
  and (
    v_meb_non_registration_reason
      is null
    or pg_catalog.char_length(
      v_meb_non_registration_reason
    ) < 3
  ) then
    raise exception
      'MEB kayıt eksikliği için açıklama girilmelidir.';
  end if;

  v_notes :=
    nullif(
      pg_catalog.btrim(
        coalesce(p_notes, '')
      ),
      ''
    );

  v_meb_registration_number :=
    nullif(
      pg_catalog.btrim(
        coalesce(
          p_meb_registration_number,
          ''
        )
      ),
      ''
    );

  v_meb_note :=
    nullif(
      pg_catalog.btrim(
        coalesce(p_meb_note, '')
      ),
      ''
    );

  v_meb_valid_from :=
    case
      when p_meb_status = 'registered'
      then coalesce(
        p_meb_valid_from,
        p_starts_on
      )
      else p_meb_valid_from
    end;

  insert into public.enrollments (
    organization_id,
    student_id,
    course_id,
    class_group_id,
    teacher_profile_id,

    starts_on,
    ends_on,
    status,

    list_monthly_fee,
    discount_type,
    discount_value,
    net_monthly_fee,
    due_day,
    notes
  )
  values (
    v_organization_id,
    p_student_id,
    p_course_id,
    p_class_group_id,
    v_group_teacher_id,

    p_starts_on,
    p_ends_on,
    'active'::public.enrollment_status,

    round(p_list_monthly_fee, 2),
    v_discount_type,
    round(v_discount_value, 2),
    v_net_monthly_fee,
    p_due_day,
    v_notes
  )
  returning id into v_enrollment_id;

  insert into public.enrollment_meb_registrations (
    organization_id,
    enrollment_id,
    student_id,
    course_id,

    status,
    registration_number,
    valid_from,
    valid_until,

    non_registration_reason,
    note,

    checked_at,
    checked_by
  )
  values (
    v_organization_id,
    v_enrollment_id,
    p_student_id,
    p_course_id,

    p_meb_status,
    v_meb_registration_number,
    v_meb_valid_from,
    p_meb_valid_until,

    v_meb_non_registration_reason,
    v_meb_note,

    pg_catalog.now(),
    v_user_id
  )
  returning id
  into v_meb_registration_id;

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
    'enrollments',
    v_enrollment_id::text,
    'create',
    null,
    pg_catalog.jsonb_build_object(
      'student_id', p_student_id,
      'course_id', p_course_id,
      'class_group_id',
        p_class_group_id,
      'teacher_profile_id',
        v_group_teacher_id,
      'starts_on', p_starts_on,
      'ends_on', p_ends_on,
      'status', 'active',
      'list_monthly_fee',
        p_list_monthly_fee,
      'discount_type',
        v_discount_type,
      'discount_value',
        v_discount_value,
      'net_monthly_fee',
        v_net_monthly_fee,
      'due_day', p_due_day
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
    'enrollment_meb_registrations',
    v_meb_registration_id::text,
    'create',
    null,
    pg_catalog.jsonb_build_object(
      'enrollment_id',
        v_enrollment_id,
      'status', p_meb_status,
      'registration_number',
        v_meb_registration_number,
      'valid_from',
        v_meb_valid_from,
      'valid_until',
        p_meb_valid_until,
      'non_registration_reason',
        v_meb_non_registration_reason
    )
  );

  return v_enrollment_id;

exception
  when unique_violation then
    raise exception
      'Öğrencinin bu derste zaten açık bir kaydı bulunuyor.'
      using errcode = '23505';
end;
$$;

-- Ders kayıtları yalnızca kontrollü RPC üzerinden oluşturulsun.

revoke insert, update, delete
on public.enrollments
from authenticated;

grant select
on public.enrollments
to authenticated;

revoke all
on function
public.create_enrollment_with_meb_registration(
  uuid,
  uuid,
  uuid,
  date,
  date,
  numeric,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  date,
  date,
  text,
  text
)
from public, anon;

grant execute
on function
public.create_enrollment_with_meb_registration(
  uuid,
  uuid,
  uuid,
  date,
  date,
  numeric,
  text,
  numeric,
  integer,
  text,
  text,
  text,
  date,
  date,
  text,
  text
)
to authenticated;

notify pgrst, 'reload schema';