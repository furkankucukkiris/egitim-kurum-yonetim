import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type GroupRow = {
  id: string;
  name: string;
  room_name: string | null;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  capacity: number;
  course: {
    name: string;
    course_type: "individual" | "group";
  } | null;
};

type MebRegistration = {
  status: string;
  valid_from: string | null;
  valid_until: string | null;
};

type EnrollmentRow = {
  id: string;
  student_id: string;
  class_group_id: string | null;
  status: "active" | "frozen";
  starts_on: string;
  ends_on: string | null;
  student: {
    first_name: string;
    last_name: string;
    status: string;
  } | null;
  course: {
    name: string;
  } | null;
  class_group: {
    name: string;
    weekday: number;
    start_time: string;
  } | null;
  meb_registration: MebRegistration | MebRegistration[] | null;
};

// get_teacher_enrollments() RPC'sinin döndüğü düz satır şekli.
// enrollments tablosuna doğrudan erişimin yerini alır; ücret/indirim
// gibi finansal sütunlar içermez (bkz. supabase/migrations/
// 20260810130000_simplify_roles_to_admin_teacher.sql).
type TeacherEnrollmentRpcRow = {
  id: string;
  student_id: string;
  class_group_id: string | null;
  status: "active" | "frozen";
  starts_on: string;
  ends_on: string | null;
  student_first_name: string;
  student_last_name: string;
  student_status: string;
  course_name: string | null;
  class_group_name: string | null;
  class_group_weekday: number | null;
  class_group_start_time: string | null;
  meb_status: string;
  meb_valid_from: string | null;
  meb_valid_until: string | null;
};

function toEnrollmentRow(row: TeacherEnrollmentRpcRow): EnrollmentRow {
  return {
    id: row.id,
    student_id: row.student_id,
    class_group_id: row.class_group_id,
    status: row.status,
    starts_on: row.starts_on,
    ends_on: row.ends_on,
    student: {
      first_name: row.student_first_name,
      last_name: row.student_last_name,
      status: row.student_status,
    },
    course: row.course_name ? { name: row.course_name } : null,
    class_group:
      row.class_group_name && row.class_group_weekday !== null && row.class_group_start_time
        ? {
            name: row.class_group_name,
            weekday: row.class_group_weekday,
            start_time: row.class_group_start_time,
          }
        : null,
    meb_registration: {
      status: row.meb_status,
      valid_from: row.meb_valid_from,
      valid_until: row.meb_valid_until,
    },
  };
}

const weekdayLabels: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

type TrialLessonRow = {
  lesson_session_id: string;
  starts_at: string;
  ends_at: string;
  room_name: string | null;
  course_name: string | null;
  prospect_student_name: string | null;
};

export default async function TeacherPanelPage() {
  const profile = await requireRole(["teacher"]);

  const supabase = await createClient();

  const today = getTodayInIstanbul();

  const [groupsResult, enrollmentsResult, trialLessonsResult] = await Promise.all([
    supabase
      .from("class_groups")
      .select(
        `
          id,
          name,
          room_name,
          weekday,
          start_time,
          duration_minutes,
          capacity,
          course:courses (
            name,
            course_type
          )
        `,
      )
      .eq("teacher_profile_id", profile.id)
      .eq("is_active", true)
      .order("weekday")
      .order("start_time"),

    supabase.rpc("get_teacher_enrollments").in("status", ["active", "frozen"]).order("starts_on"),

    supabase.rpc("get_teacher_trial_lessons", {
      p_from: today,
      p_to: today,
    }),
  ]);

  if (groupsResult.error) {
    console.error("Öğretmen programı alınamadı:", groupsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Öğretmen öğrencileri alınamadı:", enrollmentsResult.error);
  }

  if (trialLessonsResult.error) {
    console.error("Bugünkü deneme dersleri alınamadı:", trialLessonsResult.error);
  }

  const trialLessons = (trialLessonsResult.data ?? []) as unknown as TrialLessonRow[];

  const groups = (groupsResult.data ?? []) as unknown as GroupRow[];

  const enrollments = ((enrollmentsResult.data ?? []) as unknown as TeacherEnrollmentRpcRow[]).map(
    toEnrollmentRow,
  );

  const uniqueStudentCount = new Set(enrollments.map((enrollment) => enrollment.student_id)).size;

  const mebRegisteredEnrollments = enrollments.filter(
    (enrollment) => getMebRegistration(enrollment)?.status === "registered",
  );

  const enrollmentCountByGroup = new Map<string, number>();

  for (const enrollment of enrollments) {
    if (!enrollment.class_group_id) {
      continue;
    }

    enrollmentCountByGroup.set(
      enrollment.class_group_id,
      (enrollmentCountByGroup.get(enrollment.class_group_id) ?? 0) + 1,
    );
  }

  return (
    <>
      <PageHeader
        title={`Merhaba, ${getFirstName(profile.fullName)}`}
        description="Yalnızca size atanmış haftalık programı ve bu programlardaki öğrencileri görüntülüyorsunuz."
        action={
          <div className="flex gap-2">
            <Link
              href="/ogretmen-paneli/hakedisim"
              className="rounded-xl border border-border bg-surface shadow-sm px-4 py-3 text-center text-sm font-semibold text-text-primary transition hover:bg-surface-muted"
            >
              Hakedişim
            </Link>

            <Link
              href="/meb-yoklama"
              className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-center text-sm font-semibold text-on-primary"
            >
              Aylık MEB listem
            </Link>
          </div>
        }
      />

      {(groupsResult.error || enrollmentsResult.error || trialLessonsResult.error) && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          Öğretmen paneli verilerinin bir kısmı alınamadı.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Aktif seansım"
          value={String(groups.length)}
          detail="Haftalık programda"
          icon="◫"
        />

        <StatCard
          label="Öğrencim"
          value={String(uniqueStudentCount)}
          detail="Aktif ve dondurulmuş kayıt"
          icon="◎"
        />

        <StatCard
          label="MEB kayıtlı"
          value={String(mebRegisteredEnrollments.length)}
          detail="Ders bazlı öğrenci kaydı"
          icon="M"
        />
      </section>

      {trialLessons.length > 0 && (
        <section className="mt-8">
          <div className="mb-4">
            <h2 className="text-xl font-bold">Bugünkü deneme dersleriniz</h2>

            <p className="mt-1 text-sm text-text-secondary">
              Yalnızca aday öğrencinin adı gösterilir — telefon, veli ve diğer iletişim bilgileri bu
              ekranda yer almaz.
            </p>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            {trialLessons.map((lesson) => (
              <article
                key={lesson.lesson_session_id}
                className="rounded-2xl border border-accent/40 bg-accent-soft border-accent/40 bg-accent-soft p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">
                      {lesson.prospect_student_name ?? "Aday öğrenci"}
                    </h3>

                    <p className="mt-1 text-sm text-text-secondary">
                      {lesson.course_name ?? "Ders bilgisi yok"}
                    </p>
                  </div>

                  <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-on-accent">
                    Deneme
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Saat</dt>
                    <dd className="mt-1 font-bold">
                      {formatTime(lesson.starts_at)} – {formatTime(lesson.ends_at)}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Derslik</dt>
                    <dd className="mt-1 font-bold">{lesson.room_name ?? "Belirtilmedi"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold">Haftalık programım</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Ders günleri, saatleri ve kalıcı öğrenci sayıları.
          </p>
        </div>

        {groups.length === 0 ? (
          <EmptyState>Henüz size atanmış aktif bir ders seansı bulunmuyor.</EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => (
              <article
                key={group.id}
                className="rounded-2xl border border-border bg-surface p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">{group.name}</h3>

                    <p className="mt-1 text-sm text-text-secondary">
                      {group.course?.name ?? "Ders bilgisi yok"}
                    </p>
                  </div>

                  <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong">
                    {weekdayLabels[group.weekday]}
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Saat</dt>
                    <dd className="mt-1 font-bold">{group.start_time.slice(0, 5)}</dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Süre</dt>
                    <dd className="mt-1 font-bold">{group.duration_minutes} dakika</dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Öğrenci</dt>
                    <dd className="mt-1 font-bold">
                      {enrollmentCountByGroup.get(group.id) ?? 0}/{group.capacity}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Derslik</dt>
                    <dd className="mt-1 font-bold">{group.room_name ?? "Belirtilmedi"}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold">Öğrencilerim</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Öğrenciler ders kayıtlarıyla birlikte gösterilir; ücret ve veli bilgileri bu ekranda yer
            almaz.
          </p>
        </div>

        {enrollments.length === 0 ? (
          <EmptyState>Size atanmış aktif bir öğrenci kaydı bulunmuyor.</EmptyState>
        ) : (
          <EnrollmentTable enrollments={enrollments} />
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-success text-success">MEB kayıtlı öğrencilerim</h2>

          <p className="mt-1 text-sm text-text-secondary">
            Öğrencinin ilgili ders kaydındaki MEB durumu “kayıtlı” olanlar.
          </p>
        </div>

        {mebRegisteredEnrollments.length === 0 ? (
          <EmptyState>Ders bazında MEB kayıtlı görünen öğrenciniz bulunmuyor.</EmptyState>
        ) : (
          <EnrollmentTable enrollments={mebRegisteredEnrollments} mebOnly />
        )}
      </section>
    </>
  );
}

function EnrollmentTable({
  enrollments,
  mebOnly = false,
}: {
  enrollments: EnrollmentRow[];
  mebOnly?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-text-secondary">
            <tr>
              <th className="px-5 py-3">Öğrenci</th>
              <th className="px-5 py-3">Ders</th>
              <th className="px-5 py-3">Seans</th>
              <th className="px-5 py-3">MEB durumu</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-primary-soft">
            {enrollments.map((enrollment) => {
              const mebRegistration = getMebRegistration(enrollment);

              return (
                <tr key={enrollment.id} className="hover:bg-surface-muted">
                  <td className="px-5 py-4">
                    <p className="font-semibold">
                      {enrollment.student
                        ? `${enrollment.student.first_name} ${enrollment.student.last_name}`
                        : "Öğrenci bilgisi yok"}
                    </p>

                    {enrollment.status === "frozen" && (
                      <span className="mt-2 inline-block rounded-full bg-accent-soft px-2 py-1 text-xs font-semibold text-accent-strong">
                        Donduruldu
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-4 font-medium">
                    {enrollment.course?.name ?? "Ders bilgisi yok"}
                  </td>

                  <td className="px-5 py-4 text-text-secondary">
                    <p>{enrollment.class_group?.name ?? "Seans belirtilmedi"}</p>

                    {enrollment.class_group && (
                      <p className="mt-1 text-xs text-text-secondary">
                        {weekdayLabels[enrollment.class_group.weekday]}{" "}
                        {enrollment.class_group.start_time.slice(0, 5)}
                      </p>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <MebBadge status={mebRegistration?.status ?? "unchecked"} />

                    {mebOnly && mebRegistration?.valid_until && (
                      <p className="mt-2 text-xs text-text-secondary">
                        Geçerlilik sonu: {formatDate(mebRegistration.valid_until)}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MebBadge({ status }: { status: string }) {
  if (status === "registered") {
    return (
      <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success text-success">
        MEB kayıtlı
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent-strong">
        MEB kaydı bekliyor
      </span>
    );
  }

  return (
    <span className="rounded-full bg-surface-muted px-2.5 py-1 text-xs font-semibold text-text-secondary">
      MEB kayıtlı değil
    </span>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-text-secondary shadow-sm">
      {children}
    </div>
  );
}

function getMebRegistration(enrollment: EnrollmentRow) {
  if (Array.isArray(enrollment.meb_registration)) {
    return enrollment.meb_registration[0] ?? null;
  }

  return enrollment.meb_registration;
}

function getFirstName(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function getTodayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
