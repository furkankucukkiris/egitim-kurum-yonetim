-- İş kuralı değişikliği: kurumun mevcut modelinde yalnızca admin ve
-- teacher kullanılıyor. finance ve viewer rolleri kullanımdan
-- kaldırılıyor.
--
-- public.app_role enum'undan 'finance'/'viewer' değerlerini SİLMİYORUZ:
-- Postgres'te enum değeri silmek (mevcut satırlar o değeri taşıyor
-- olabileceğinden) tehlikeli ve büyük bir dönüşüm gerektiren bir
-- işlemdir (yeni tip oluşturup tüm sütunları taşımak gibi). Bunun
-- yerine bu iki değeri veritabanında pasif bırakıp uygulama
-- katmanının tamamında (RLS, RPC, TypeScript) kullanılamaz hale
-- getiriyoruz:
--
--   * Hiçbir insert yolu (bootstrap_first_admin, create_teacher_profile)
--     'finance'/'viewer' rolüyle profil oluşturmuyor; ikisi de rolü
--     sabit olarak 'admin'/'teacher' yazıyor.
--   * profiles.role default'u ('viewer') kaldırılıyor; hiçbir insert
--     zaten default'a güvenmiyordu.
--   * can_manage_finance() artık yalnızca is_admin() ile eşdeğer;
--     bu fonksiyonu çağıran tüm eski migration'lardaki politika ve
--     RPC'ler (o dosyalar değiştirilmeden) otomatik olarak admin-only
--     hale gelir.
--   * current_app_role() sonucu 'finance' veya 'viewer' olan
--     profiller (varsa) hiçbir RLS politikasında artık ayrıcalıklı
--     bir dal eşleşmediği için organizasyon verisine erişemez —
--     admin'e veya teacher'a OTOMATİK YÜKSELTİLMEZ/düşürülmez,
--     sadece erişimsiz kalır. Böyle bir profil varsa, yönetici
--     Supabase Studio'dan rolünü elle admin/teacher olarak
--     güncellemelidir (uygulamada bunu yapan bir ekran yok, bilinçli
--     bir tercih — otomatik rol değişikliği güvenlik riski taşır).
--   * Zaten hiçbir authenticated kullanıcı profiles tablosuna
--     doğrudan insert/update/delete yapamıyor (20260727210000'de
--     revoke edilmiş); role sütununu değiştirebilecek tek yol yine
--     security definer fonksiyonlar, ve bunların hiçbiri rolü
--     dışarıdan parametre olarak almıyor.

-- =========================================================
-- 1. can_manage_finance(): finance rolünü artık tanımıyor.
-- =========================================================

create or replace function public.can_manage_finance()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
$$;

-- =========================================================
-- 2. profiles.role: 'viewer' default'u kaldırılıyor. Hiçbir insert
--    yolu default'a güvenmiyordu; bundan sonra rol her zaman açıkça
--    belirtilmek zorunda.
-- =========================================================

alter table public.profiles
  alter column role drop default;

-- =========================================================
-- 3. RLS politikaları: 'finance'/'viewer' için ayrıcalıklı dallar
--    kaldırılıyor, hepsi is_admin() üzerinden karar veriyor.
--    guardians ve enrollments tablolarında ayrıca teacher'ın
--    DOĞRUDAN tablo erişimi tamamen kapatılıyor (aşağıya bakınız).
-- =========================================================

drop policy if exists profiles_select_scoped on public.profiles;

create policy profiles_select_scoped
on public.profiles
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or id = auth.uid()
  )
);

drop policy if exists students_select_scoped on public.students;

create policy students_select_scoped
on public.students
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or public.teacher_has_student(id)
  )
);

-- guardians: veli finans/iletişim bilgileri (fatura unvanı, vergi/TC
-- no, fatura adresi) içerir. Hiçbir teacher ekranı bugün bu tabloyu
-- sorgulamıyor; bu yüzden teacher'a hiç row açmıyoruz — RLS/REST
-- üzerinden dolaylı erişimi de kapatmış oluyoruz. İleride teacher'a
-- yalnızca ad/telefon göstermek gerekirse, ayrı dar kapsamlı bir
-- security definer fonksiyon eklenmelidir.
drop policy if exists guardians_select_scoped on public.guardians;

create policy guardians_select_scoped
on public.guardians
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

drop policy if exists student_guardians_select_scoped on public.student_guardians;

create policy student_guardians_select_scoped
on public.student_guardians
for select
to authenticated
using (
  public.is_admin()
  or public.teacher_has_student(student_id)
);

drop policy if exists groups_select_scoped on public.class_groups;

create policy groups_select_scoped
on public.class_groups
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or teacher_profile_id = auth.uid()
  )
);

-- enrollments: ücret/indirim/net tutar sütunları (list_monthly_fee,
-- discount_type, discount_value, net_monthly_fee) içerir. Teacher bu
-- tabloya artık doğrudan erişemez; kendi programı/öğrencileri için
-- get_teacher_enrollments() RPC'sini kullanır (aşağıda tanımlı),
-- bu RPC yalnızca finansal olmayan sütunları döndürür.
drop policy if exists enrollments_select_scoped on public.enrollments;

create policy enrollments_select_scoped
on public.enrollments
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and public.is_admin()
);

drop policy if exists attendance_select_scoped on public.attendance;

create policy attendance_select_scoped
on public.attendance
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or public.teacher_owns_session(lesson_session_id)
  )
);

drop policy if exists teacher_course_meb_authorizations_select on public.teacher_course_meb_authorizations;

create policy teacher_course_meb_authorizations_select
on public.teacher_course_meb_authorizations
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or teacher_profile_id = auth.uid()
  )
);

drop policy if exists enrollment_meb_registrations_select on public.enrollment_meb_registrations;

create policy enrollment_meb_registrations_select
on public.enrollment_meb_registrations
for select
to authenticated
using (
  organization_id = public.current_organization_id()
  and (
    public.is_admin()
    or exists (
      select 1
      from public.enrollments e
      left join public.class_groups cg on cg.id = e.class_group_id
      where e.id = enrollment_id
        and coalesce(e.teacher_profile_id, cg.teacher_profile_id) = auth.uid()
    )
  )
);

-- =========================================================
-- 4. get_meb_monthly_roster: finance rolü kaldırıldı, admin/teacher
--    kaldı. Fonksiyonun geri kalanı (satır bazlı teacher kapsamı,
--    uygunluk hesaplama mantığı) değişmedi.
-- =========================================================

create or replace function public.get_meb_monthly_roster(
  p_month_start date
)
returns table (
  enrollment_id uuid,
  student_id uuid,
  student_full_name text,

  course_id uuid,
  course_name text,

  class_group_id uuid,
  class_group_name text,
  weekday integer,
  start_time time,

  teacher_profile_id uuid,
  teacher_full_name text,

  enrollment_status text,

  course_meb_status text,
  teacher_meb_status text,
  student_meb_status text,

  student_meb_valid_from date,
  student_meb_valid_until date,

  compliance_status text,
  include_in_meb_register boolean,
  compliance_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();

  v_organization_id uuid :=
    public.current_organization_id();

  v_role public.app_role :=
    public.current_app_role();

  v_month_start date :=
    pg_catalog.date_trunc(
      'month',
      p_month_start::timestamp
    )::date;

  v_month_end date :=
    (
      pg_catalog.date_trunc(
        'month',
        p_month_start::timestamp
      )
      + interval '1 month'
      - interval '1 day'
    )::date;
begin
  if v_user_id is null
     or v_organization_id is null then
    raise exception
      'Aktif kullanıcı veya kurum bilgisi bulunamadı.';
  end if;

  if v_role not in (
    'admin'::public.app_role,
    'teacher'::public.app_role
  ) then
    raise exception
      'MEB yoklama listesini görüntüleme yetkiniz bulunmuyor.';
  end if;

  return query
  with roster as (
    select
      e.id as enrollment_id,
      s.id as student_id,

      s.first_name || ' ' ||
        s.last_name as student_full_name,

      c.id as course_id,
      c.name as course_name,

      cg.id as class_group_id,
      cg.name as class_group_name,
      cg.weekday::integer as weekday,
      cg.start_time,

      coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      ) as teacher_profile_id,

      p.full_name as teacher_full_name,

      e.status::text as enrollment_status,

      c.meb_status as course_meb_status,

      coalesce(
        ta.status,
        'unchecked'
      ) as teacher_meb_status,

      coalesce(
        emr.status,
        'unchecked'
      ) as student_meb_status,

      emr.valid_from
        as student_meb_valid_from,

      emr.valid_until
        as student_meb_valid_until,

      (
        e.status =
          'active'::public.enrollment_status
        and e.starts_on <= v_month_end
        and (
          e.ends_on is null
          or e.ends_on >= v_month_start
        )
      ) as enrollment_active,

      (
        c.meb_status = 'approved'
        and (
          c.meb_valid_from is null
          or c.meb_valid_from <= v_month_end
        )
        and (
          c.meb_valid_until is null
          or c.meb_valid_until >= v_month_start
        )
      ) as course_ok,

      (
        coalesce(
          ta.status,
          'unchecked'
        ) = 'approved'
        and (
          ta.valid_from is null
          or ta.valid_from <= v_month_end
        )
        and (
          ta.valid_until is null
          or ta.valid_until >= v_month_start
        )
      ) as teacher_ok,

      (
        coalesce(
          emr.status,
          'unchecked'
        ) = 'registered'
        and (
          emr.valid_from is null
          or emr.valid_from <= v_month_end
        )
        and (
          emr.valid_until is null
          or emr.valid_until >= v_month_start
        )
      ) as student_ok

    from public.enrollments e

    inner join public.students s
      on s.id = e.student_id

    inner join public.courses c
      on c.id = e.course_id

    left join public.class_groups cg
      on cg.id = e.class_group_id

    left join public.profiles p
      on p.id = coalesce(
        e.teacher_profile_id,
        cg.teacher_profile_id
      )

    left join
      public.teacher_course_meb_authorizations ta
      on ta.organization_id =
        e.organization_id
      and ta.course_id = e.course_id
      and ta.teacher_profile_id =
        coalesce(
          e.teacher_profile_id,
          cg.teacher_profile_id
        )

    left join
      public.enrollment_meb_registrations emr
      on emr.enrollment_id = e.id

    where e.organization_id =
      v_organization_id

      and e.starts_on <= v_month_end

      and (
        e.ends_on is null
        or e.ends_on >= v_month_start
      )

      and (
        v_role = 'admin'::public.app_role
        or coalesce(
          e.teacher_profile_id,
          cg.teacher_profile_id
        ) = v_user_id
      )
  )

  select
    r.enrollment_id,
    r.student_id,
    r.student_full_name,

    r.course_id,
    r.course_name,

    r.class_group_id,
    r.class_group_name,
    r.weekday,
    r.start_time,

    r.teacher_profile_id,
    r.teacher_full_name,

    r.enrollment_status,

    r.course_meb_status,
    r.teacher_meb_status,
    r.student_meb_status,

    r.student_meb_valid_from,
    r.student_meb_valid_until,

    case
      when
        r.enrollment_active
        and r.course_ok
        and r.teacher_ok
        and r.student_ok
      then 'compliant'

      when
        r.course_meb_status in (
          'not_registered',
          'expired'
        )
        or r.teacher_profile_id is null
        or r.teacher_meb_status in (
          'not_registered',
          'expired'
        )
        or r.student_meb_status in (
          'not_registered',
          'not_eligible',
          'rejected',
          'ended'
        )
        or not r.enrollment_active
      then 'non_compliant'

      else 'pending'
    end as compliance_status,

    (
      r.enrollment_active
      and r.course_ok
      and r.teacher_ok
      and r.student_ok
    ) as include_in_meb_register,

    pg_catalog.concat_ws(
      '; ',

      case
        when not r.enrollment_active
        then
          'Kurum içi ders kaydı bu ay aktif değil'
      end,

      case
        when not r.course_ok
        then
          'Dersin MEB kaydı uygun değil'
      end,

      case
        when r.teacher_profile_id is null
        then
          'Derse öğretmen atanmamış'
      end,

      case
        when r.teacher_profile_id is not null
             and not r.teacher_ok
        then
          'Öğretmenin bu ders için MEB çalışma izni uygun değil'
      end,

      case
        when not r.student_ok
        then
          'Öğrencinin bu ders için MEB kaydı uygun değil'
      end
    ) as compliance_reason

  from roster r

  order by
    r.weekday,
    r.start_time,
    r.course_name,
    r.student_full_name;
end;
$$;

-- =========================================================
-- 5. get_teacher_enrollments(): teacher'ın kendi öğretmen paneli ve
--    yoklama ekranları için, ücret/indirim gibi finansal sütunlar
--    OLMADAN, kendi kayıtlarını döner. enrollments tablosuna
--    doğrudan erişimin yerini alır.
-- =========================================================

create or replace function public.get_teacher_enrollments()
returns table (
  id uuid,
  student_id uuid,
  class_group_id uuid,
  course_id uuid,
  status public.enrollment_status,
  starts_on date,
  ends_on date,
  student_first_name text,
  student_last_name text,
  student_status public.record_status,
  course_name text,
  class_group_name text,
  class_group_weekday smallint,
  class_group_start_time time,
  meb_status text,
  meb_valid_from date,
  meb_valid_until date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.student_id,
    e.class_group_id,
    e.course_id,
    e.status,
    e.starts_on,
    e.ends_on,
    s.first_name,
    s.last_name,
    s.status,
    c.name,
    cg.name,
    cg.weekday,
    cg.start_time,
    coalesce(mr.status, 'unchecked'),
    mr.valid_from,
    mr.valid_until
  from public.enrollments e
  join public.students s on s.id = e.student_id
  left join public.courses c on c.id = e.course_id
  left join public.class_groups cg on cg.id = e.class_group_id
  left join public.enrollment_meb_registrations mr on mr.enrollment_id = e.id
  where e.organization_id = public.current_organization_id()
    and coalesce(e.teacher_profile_id, cg.teacher_profile_id) = auth.uid()
$$;

revoke all
on function public.get_teacher_enrollments()
from public, anon;

grant execute
on function public.get_teacher_enrollments()
to authenticated;

notify pgrst, 'reload schema';
