import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

import { ArchiveStudentForm } from "./archive-student-form";
import { GuardianManagement } from "./guardian-management";
import { KvkkActions } from "./kvkk-actions";
import { RegistrationDetailsManagement } from "./registration-details-management";
import { StudentEditForm } from "./student-edit-form";
import { StudentEnrollmentManagement } from "./student-enrollment-management";

type GuardianRow = {
  id: string;
  full_name: string;
  phone: string;
  secondary_phone: string | null;
  email: string | null;
};

type StudentGuardianRow = {
  guardian_id: string;
  relationship: string | null;
  is_primary: boolean;
  may_receive_financial_messages: boolean;
  guardian: GuardianRow | null;
};

type StudentRow = {
  id: string;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  registration_date: string;

  status: "active" | "frozen" | "left" | "archived";

  exit_date: string | null;
  exit_reason: string | null;
  notes: string | null;

  home_address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  health_notes: string | null;
  photo_video_consent: "izinli" | "sadece_kurum_ici" | "izinsiz";
  kvkk_consent_accepted: boolean;
  institution_rules_accepted: boolean;

  student_guardians: StudentGuardianRow[];
};

type ProfileOption = {
  id: string;
  full_name: string;
};

type CourseOptionRow = {
  id: string;
  name: string;

  default_monthly_fee: number | string;

  meb_status: string;
};

type GroupOptionRow = {
  id: string;
  course_id: string;
  name: string;
  capacity: number;
  weekday: number;
  start_time: string;

  teacher: {
    full_name: string;
  } | null;
};

type GroupEnrollmentCountRow = {
  class_group_id: string | null;
};

type EnrollmentMebRow = {
  status: string;

  registration_number: string | null;

  valid_from: string | null;
  valid_until: string | null;

  non_registration_reason: string | null;

  note: string | null;

  responsible_profile_id: string | null;
};

type EnrollmentRow = {
  id: string;
  course_id: string;
  class_group_id: string | null;

  starts_on: string;
  ends_on: string | null;
  status: string;

  list_monthly_fee: number | string;

  discount_type: string;

  discount_value: number | string;

  net_monthly_fee: number | string;

  due_day: number;
  notes: string | null;

  course: {
    name: string;
  } | null;

  class_group: {
    name: string;
    weekday: number;
    start_time: string;

    teacher: {
      full_name: string;
    } | null;
  } | null;

  enrollment_meb_registrations: EnrollmentMebRow[];
};

type StudentDetailPageProps = {
  params: Promise<{
    studentId: string;
  }>;

  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

const statusLabels: Record<StudentRow["status"], string> = {
  active: "Aktif",
  frozen: "Donduruldu",
  left: "Ayrıldı",
  archived: "Arşivlendi",
};

export default async function StudentDetailPage({ params, searchParams }: StudentDetailPageProps) {
  await requireRole(["admin"]);

  const { studentId } = await params;
  const messages = await searchParams;

  const supabase = await createClient();

  /*
   * Öğrencinin temel bilgileri ve
   * bağlı veli kayıtları alınır.
   */
  const studentResult = await supabase
    .from("students")
    .select(
      `
        id,
        first_name,
        last_name,
        birth_date,
        registration_date,
        status,
        exit_date,
        exit_reason,
        notes,

        home_address,
        emergency_contact_name,
        emergency_contact_phone,
        health_notes,
        photo_video_consent,
        kvkk_consent_accepted,
        institution_rules_accepted,

        student_guardians (
          guardian_id,
          relationship,
          is_primary,
          may_receive_financial_messages,

          guardian:guardians (
            id,
            full_name,
            phone,
            secondary_phone,
            email
          )
        )
      `,
    )
    .eq("id", studentId)
    .maybeSingle();

  if (studentResult.error) {
    console.error("Öğrenci detayı alınamadı:", studentResult.error);
  }

  if (!studentResult.data) {
    notFound();
  }

  const student = studentResult.data as unknown as StudentRow;

  const primaryRelationship =
    student.student_guardians.find((item) => item.is_primary) ?? student.student_guardians[0];

  const primaryGuardian = primaryRelationship?.guardian;

  /*
   * Öğrencinin bağlı velisi yoksa
   * düzenleme ekranını göstermiyoruz.
   */
  if (!primaryRelationship || !primaryGuardian) {
    return (
      <>
        <PageHeader
          title={`${student.first_name} ${student.last_name}`}
          description="Öğrenci kaydına bağlı birincil veli bulunamadı."
        />

        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-5 text-sm text-danger">
          Bu öğrencinin veli ilişkisinde eksiklik bulunuyor.
        </div>
      </>
    );
  }

  /*
   * Ders seçenekleri, aktif seanslar,
   * öğrencinin mevcut ders kayıtları ve
   * seans kontenjanları birlikte alınır.
   */
  const [coursesResult, groupsResult, enrollmentsResult, groupCountsResult, profilesResult] =
    await Promise.all([
      supabase
        .from("courses")
        .select(
          `
            id,
            name,
            default_monthly_fee,
            meb_status
          `,
        )
        .eq("is_active", true)
        .order("name", {
          ascending: true,
        }),

      supabase
        .from("class_groups")
        .select(
          `
            id,
            course_id,
            name,
            capacity,
            weekday,
            start_time,

            teacher:profiles (
              full_name
            )
          `,
        )
        .eq("is_active", true)
        .order("weekday", {
          ascending: true,
        })
        .order("start_time", {
          ascending: true,
        }),

      supabase
        .from("enrollments")
        .select(
          `
            id,
            course_id,
            class_group_id,
            starts_on,
            ends_on,
            status,
            list_monthly_fee,
            discount_type,
            discount_value,
            net_monthly_fee,
            due_day,
            notes,

            course:courses (
              name
            ),

            class_group:class_groups (
              name,
              weekday,
              start_time,

              teacher:profiles (
                full_name
              )
            ),

            enrollment_meb_registrations (
              status,
              registration_number,
              valid_from,
              valid_until,
              non_registration_reason,
              note,
              responsible_profile_id
            )
          `,
        )
        .eq("student_id", studentId)
        .order("created_at", {
          ascending: false,
        }),

      supabase
        .from("enrollments")
        .select("class_group_id")
        .in("status", ["active", "frozen"])
        .not("class_group_id", "is", null),

      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);

  if (coursesResult.error) {
    console.error("Ders seçenekleri alınamadı:", coursesResult.error);
  }

  if (groupsResult.error) {
    console.error("Ders seansları alınamadı:", groupsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Öğrencinin ders kayıtları alınamadı:", enrollmentsResult.error);
  }

  if (groupCountsResult.error) {
    console.error("Ders seansı kontenjanları alınamadı:", groupCountsResult.error);
  }

  const profiles = (profilesResult.data ?? []) as ProfileOption[];

  const courseOptions = (coursesResult.data ?? []) as CourseOptionRow[];

  const groupOptions = (groupsResult.data ?? []) as unknown as GroupOptionRow[];

  const enrollmentRows = (enrollmentsResult.data ?? []) as unknown as EnrollmentRow[];

  const countRows = (groupCountsResult.data ?? []) as GroupEnrollmentCountRow[];

  /*
   * Her seansın aktif veya dondurulmuş
   * öğrenci sayısı hesaplanır.
   */
  const groupCountMap = new Map<string, number>();

  for (const row of countRows) {
    if (!row.class_group_id) {
      continue;
    }

    const currentCount = groupCountMap.get(row.class_group_id) ?? 0;

    groupCountMap.set(row.class_group_id, currentCount + 1);
  }

  return (
    <>
      <PageHeader
        title={`${student.first_name} ${student.last_name}`}
        description={`Durum: ${statusLabels[student.status]}`}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/ogrenciler/${student.id}/kayit-formu`}
              className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted text-primary"
            >
              Kayıt formu
            </Link>

            <Link
              href="/ogrenciler"
              className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary transition hover:bg-surface-muted text-primary"
            >
              Öğrenci listesine dön
            </Link>
          </div>
        }
      />

      {messages.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {messages.success}
        </div>
      )}

      {messages.error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {messages.error}
        </div>
      )}

      {student.status === "archived" && (
        <div className="mb-6 rounded-2xl border border-accent/30 bg-accent-soft p-5">
          <p className="font-semibold text-accent-strong">
            Bu öğrenci arşivlenmiş durumda.
          </p>

          <p className="mt-2 text-sm text-accent-strong">
            Arşiv tarihi: {student.exit_date ? formatDate(student.exit_date) : "Belirtilmedi"}
          </p>

          {student.exit_reason && (
            <p className="mt-1 text-sm text-accent-strong">
              Neden: {student.exit_reason}
            </p>
          )}
        </div>
      )}

      <StudentEditForm
        student={{
          id: student.id,

          firstName: student.first_name,

          lastName: student.last_name,

          birthDate: student.birth_date ?? "",

          registrationDate: student.registration_date,

          notes: student.notes ?? "",
        }}
        guardian={{
          id: primaryGuardian.id,

          fullName: primaryGuardian.full_name,

          phone: primaryGuardian.phone,

          secondaryPhone: primaryGuardian.secondary_phone ?? "",

          email: primaryGuardian.email ?? "",

          relationship: primaryRelationship.relationship ?? "Veli",

          mayReceiveFinancialMessages: primaryRelationship.may_receive_financial_messages,
        }}
      />

      <StudentEnrollmentManagement
        studentId={student.id}
        isArchived={student.status === "archived"}
        courses={courseOptions.map((course) => ({
          id: course.id,

          name: course.name,

          defaultMonthlyFee: Number(course.default_monthly_fee),

          mebStatus: course.meb_status,
        }))}
        groups={groupOptions.map((group) => ({
          id: group.id,

          courseId: group.course_id,

          name: group.name,

          capacity: group.capacity,

          studentCount: groupCountMap.get(group.id) ?? 0,

          weekday: group.weekday,

          startTime: group.start_time.slice(0, 5),

          teacherName: group.teacher?.full_name ?? "Öğretmen atanmadı",
        }))}
        enrollments={enrollmentRows.map((enrollment) => {
          const mebRegistration = enrollment.enrollment_meb_registrations?.[0];

          return {
            id: enrollment.id,

            courseName: enrollment.course?.name ?? "Ders bulunamadı",

            groupName: enrollment.class_group?.name ?? "Seans bulunamadı",

            teacherName: enrollment.class_group?.teacher?.full_name ?? "Öğretmen atanmadı",

            weekday: enrollment.class_group?.weekday ?? null,

            startTime: enrollment.class_group?.start_time?.slice(0, 5) ?? "",

            startsOn: enrollment.starts_on,

            endsOn: enrollment.ends_on ?? "",

            status: enrollment.status,

            listMonthlyFee: Number(enrollment.list_monthly_fee),

            discountType: enrollment.discount_type,

            discountValue: Number(enrollment.discount_value),

            netMonthlyFee: Number(enrollment.net_monthly_fee),

            dueDay: enrollment.due_day,

            notes: enrollment.notes ?? "",

            mebStatus: mebRegistration?.status ?? "unchecked",

            mebRegistrationNumber: mebRegistration?.registration_number ?? "",

            mebValidFrom: mebRegistration?.valid_from ?? "",

            mebValidUntil: mebRegistration?.valid_until ?? "",

            mebNonRegistrationReason: mebRegistration?.non_registration_reason ?? "",

            mebNote: mebRegistration?.note ?? "",

            responsibleProfileId: mebRegistration?.responsible_profile_id ?? "",
          };
        })}
        profiles={profiles}
      />

      <GuardianManagement
        studentId={student.id}
        isArchived={student.status === "archived"}
        guardians={student.student_guardians
          .filter(
            (
              relationship,
            ): relationship is StudentGuardianRow & {
              guardian: GuardianRow;
            } => Boolean(relationship.guardian),
          )
          .map((relationship) => ({
            id: relationship.guardian.id,

            fullName: relationship.guardian.full_name,

            phone: relationship.guardian.phone,

            secondaryPhone: relationship.guardian.secondary_phone ?? "",

            email: relationship.guardian.email ?? "",

            relationship: relationship.relationship ?? "Veli",

            isPrimary: relationship.is_primary,

            mayReceiveFinancialMessages: relationship.may_receive_financial_messages,
          }))}
      />

      <RegistrationDetailsManagement
        studentId={student.id}
        details={{
          homeAddress: student.home_address ?? "",
          emergencyContactName: student.emergency_contact_name ?? "",
          emergencyContactPhone: student.emergency_contact_phone ?? "",
          healthNotes: student.health_notes ?? "",
          photoVideoConsent: student.photo_video_consent,
          kvkkConsentAccepted: student.kvkk_consent_accepted,
          institutionRulesAccepted: student.institution_rules_accepted,
        }}
      />

      {student.status !== "archived" && (
        <div className="mt-8 border-t border-border pt-8">
          <ArchiveStudentForm studentId={student.id} />
        </div>
      )}

      <KvkkActions
        studentId={student.id}
        fullName={`${student.first_name} ${student.last_name}`}
        isArchived={student.status === "archived"}
        isAlreadyAnonymized={student.first_name === "Anonim" && student.last_name === "Öğrenci"}
      />
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",

    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
