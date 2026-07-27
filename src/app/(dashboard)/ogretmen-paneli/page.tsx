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
    course_type:
      | "individual"
      | "group";
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
  meb_registration:
    | MebRegistration
    | MebRegistration[]
    | null;
};

const weekdayLabels: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

export default async function TeacherPanelPage() {
  const profile =
    await requireRole(["teacher"]);

  const supabase = await createClient();

  const [
    groupsResult,
    enrollmentsResult,
  ] = await Promise.all([
    supabase
      .from("class_groups")
      .select(`
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
      `)
      .eq(
        "teacher_profile_id",
        profile.id,
      )
      .eq("is_active", true)
      .order("weekday")
      .order("start_time"),

    supabase
      .from("enrollments")
      .select(`
        id,
        student_id,
        class_group_id,
        status,
        starts_on,
        ends_on,
        student:students (
          first_name,
          last_name,
          status
        ),
        course:courses (
          name
        ),
        class_group:class_groups (
          name,
          weekday,
          start_time
        ),
        meb_registration:enrollment_meb_registrations (
          status,
          valid_from,
          valid_until
        )
      `)
      .in("status", [
        "active",
        "frozen",
      ])
      .order("starts_on"),
  ]);

  if (groupsResult.error) {
    console.error(
      "Öğretmen programı alınamadı:",
      groupsResult.error,
    );
  }

  if (enrollmentsResult.error) {
    console.error(
      "Öğretmen öğrencileri alınamadı:",
      enrollmentsResult.error,
    );
  }

  const groups =
    (groupsResult.data ??
      []) as unknown as GroupRow[];

  const enrollments =
    (enrollmentsResult.data ??
      []) as unknown as EnrollmentRow[];

  const uniqueStudentCount = new Set(
    enrollments.map(
      (enrollment) => enrollment.student_id,
    ),
  ).size;

  const mebRegisteredEnrollments =
    enrollments.filter(
      (enrollment) =>
        getMebRegistration(enrollment)
          ?.status === "registered",
    );

  const enrollmentCountByGroup =
    new Map<string, number>();

  for (const enrollment of enrollments) {
    if (!enrollment.class_group_id) {
      continue;
    }

    enrollmentCountByGroup.set(
      enrollment.class_group_id,
      (
        enrollmentCountByGroup.get(
          enrollment.class_group_id,
        ) ?? 0
      ) + 1,
    );
  }

  return (
    <>
      <PageHeader
        title={`Merhaba, ${getFirstName(
          profile.fullName,
        )}`}
        description="Yalnızca size atanmış haftalık programı ve bu programlardaki öğrencileri görüntülüyorsunuz."
        action={
          <Link
            href="/meb-yoklama"
            className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white"
          >
            Aylık MEB listem
          </Link>
        }
      />

      {(groupsResult.error ||
        enrollmentsResult.error) && (
        <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Öğretmen paneli verilerinin bir kısmı
          alınamadı.
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
          value={String(
            mebRegisteredEnrollments.length,
          )}
          detail="Ders bazlı öğrenci kaydı"
          icon="M"
        />
      </section>

      <section className="mt-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold">
            Haftalık programım
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Ders günleri, saatleri ve kalıcı öğrenci
            sayıları.
          </p>
        </div>

        {groups.length === 0 ? (
          <EmptyState>
            Henüz size atanmış aktif bir ders seansı
            bulunmuyor.
          </EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {groups.map((group) => (
              <article
                key={group.id}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold">
                      {group.name}
                    </h3>

                    <p className="mt-1 text-sm text-slate-500">
                      {group.course?.name ??
                        "Ders bilgisi yok"}
                    </p>
                  </div>

                  <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                    {
                      weekdayLabels[
                        group.weekday
                      ]
                    }
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-slate-500">
                      Saat
                    </dt>
                    <dd className="mt-1 font-bold">
                      {group.start_time.slice(
                        0,
                        5,
                      )}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-slate-500">
                      Süre
                    </dt>
                    <dd className="mt-1 font-bold">
                      {group.duration_minutes} dakika
                    </dd>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-slate-500">
                      Öğrenci
                    </dt>
                    <dd className="mt-1 font-bold">
                      {enrollmentCountByGroup.get(
                        group.id,
                      ) ?? 0}
                      /{group.capacity}
                    </dd>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3">
                    <dt className="text-slate-500">
                      Derslik
                    </dt>
                    <dd className="mt-1 font-bold">
                      {group.room_name ??
                        "Belirtilmedi"}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold">
            Öğrencilerim
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Öğrenciler ders kayıtlarıyla birlikte
            gösterilir; ücret ve veli bilgileri bu
            ekranda yer almaz.
          </p>
        </div>

        {enrollments.length === 0 ? (
          <EmptyState>
            Size atanmış aktif bir öğrenci kaydı
            bulunmuyor.
          </EmptyState>
        ) : (
          <EnrollmentTable
            enrollments={enrollments}
          />
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-emerald-800">
            MEB kayıtlı öğrencilerim
          </h2>

          <p className="mt-1 text-sm text-slate-500">
            Öğrencinin ilgili ders kaydındaki MEB
            durumu “kayıtlı” olanlar.
          </p>
        </div>

        {mebRegisteredEnrollments.length ===
        0 ? (
          <EmptyState>
            Ders bazında MEB kayıtlı görünen
            öğrenciniz bulunmuyor.
          </EmptyState>
        ) : (
          <EnrollmentTable
            enrollments={
              mebRegisteredEnrollments
            }
            mebOnly
          />
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
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3">
                Öğrenci
              </th>
              <th className="px-5 py-3">
                Ders
              </th>
              <th className="px-5 py-3">
                Seans
              </th>
              <th className="px-5 py-3">
                MEB durumu
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {enrollments.map((enrollment) => {
              const mebRegistration =
                getMebRegistration(enrollment);

              return (
                <tr
                  key={enrollment.id}
                  className="hover:bg-slate-50"
                >
                  <td className="px-5 py-4">
                    <p className="font-semibold">
                      {enrollment.student
                        ? `${enrollment.student.first_name} ${enrollment.student.last_name}`
                        : "Öğrenci bilgisi yok"}
                    </p>

                    {enrollment.status ===
                      "frozen" && (
                      <span className="mt-2 inline-block rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">
                        Donduruldu
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-4 font-medium">
                    {enrollment.course?.name ??
                      "Ders bilgisi yok"}
                  </td>

                  <td className="px-5 py-4 text-slate-600">
                    <p>
                      {enrollment.class_group?.name ??
                        "Seans belirtilmedi"}
                    </p>

                    {enrollment.class_group && (
                      <p className="mt-1 text-xs text-slate-400">
                        {
                          weekdayLabels[
                            enrollment.class_group
                              .weekday
                          ]
                        }{" "}
                        {enrollment.class_group.start_time.slice(
                          0,
                          5,
                        )}
                      </p>
                    )}
                  </td>

                  <td className="px-5 py-4">
                    <MebBadge
                      status={
                        mebRegistration?.status ??
                        "unchecked"
                      }
                    />

                    {mebOnly &&
                      mebRegistration
                        ?.valid_until && (
                        <p className="mt-2 text-xs text-slate-500">
                          Geçerlilik sonu:{" "}
                          {formatDate(
                            mebRegistration.valid_until,
                          )}
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

function MebBadge({
  status,
}: {
  status: string;
}) {
  if (status === "registered") {
    return (
      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800">
        MEB kayıtlı
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
        MEB kaydı bekliyor
      </span>
    );
  }

  return (
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
      MEB kayıtlı değil
    </span>
  );
}

function EmptyState({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-sm">
      {children}
    </div>
  );
}

function getMebRegistration(
  enrollment: EnrollmentRow,
) {
  if (
    Array.isArray(
      enrollment.meb_registration,
    )
  ) {
    return (
      enrollment.meb_registration[0] ?? null
    );
  }

  return enrollment.meb_registration;
}

function getFirstName(fullName: string) {
  return (
    fullName.trim().split(/\s+/)[0] ??
    fullName
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}
