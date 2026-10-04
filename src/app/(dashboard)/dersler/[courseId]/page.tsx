import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProfileBox,
  ProfileCard,
  ProfileFact,
  ProfileHeader,
  ProfileLayout,
  ProfileSection,
  ProfileStatusBadge,
  getNameInitials,
} from "@/components/profile/ProfileLayout";
import { requireRole } from "@/lib/auth";
import { buildCoursePinMap, coursePinClasses } from "@/lib/course-colors";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import { bulkAdjustCourseFees } from "../actions";
import { CourseForm } from "../course-form";

type CoursePageProps = {
  params: Promise<{
    courseId: string;
  }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type CourseRow = {
  id: string;
  name: string;
  code: string | null;
  course_type: "individual" | "group";
  default_duration_minutes: number;
  default_monthly_fee: number | string;
  is_active: boolean;
  meb_status: string;
  meb_approval_number: string | null;
  meb_valid_until: string | null;
};

type GroupRow = {
  id: string;
  name: string;
  weekday: number;
  start_time: string;
  room_name: string | null;
  capacity: number | null;
  is_active: boolean;
  teacher: { id: string; full_name: string } | null;
};

type EnrollmentRow = {
  id: string;
  student_id: string;
  class_group_id: string | null;
  status: "active" | "frozen";
  net_monthly_fee: number | string;
  student: { first_name: string; last_name: string } | null;
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

const mebStatusLabels: Record<string, string> = {
  approved: "MEB onaylı",
  pending: "Başvuru aşamasında",
  not_registered: "MEB kayıtlı değil",
  expired: "Süresi dolmuş",
  unchecked: "Kontrol edilmedi",
};

const profileTabs = [
  { href: "#seanslar", label: "Seanslar" },
  { href: "#ogrenciler", label: "Öğrenciler" },
  { href: "#bilgiler", label: "Ders bilgileri" },
  { href: "#zam", label: "Toplu ücret güncelleme" },
];

export default async function CourseDetailPage({ params, searchParams }: CoursePageProps) {
  await requireRole(["admin"]);

  const { courseId } = await params;
  const messages = await searchParams;
  const supabase = await createClient();

  const [courseResult, groupResult, enrollmentResult, courseOrderResult] = await Promise.all([
    supabase
      .from("courses")
      .select(
        `
          id,
          name,
          code,
          course_type,
          default_duration_minutes,
          default_monthly_fee,
          is_active,
          meb_status,
          meb_approval_number,
          meb_valid_until
        `,
      )
      .eq("id", courseId)
      .maybeSingle(),

    supabase
      .from("class_groups")
      .select(
        "id, name, weekday, start_time, room_name, capacity, is_active, teacher:profiles ( id, full_name )",
      )
      .eq("course_id", courseId)
      .order("weekday", { ascending: true })
      .order("start_time", { ascending: true }),

    supabase
      .from("enrollments")
      .select(
        "id, student_id, class_group_id, status, net_monthly_fee, student:students ( first_name, last_name )",
      )
      .eq("course_id", courseId)
      .in("status", ["active", "frozen"]),

    supabase
      .from("courses")
      .select("id")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (courseResult.error) {
    console.error("Ders bilgisi alınamadı:", courseResult.error);
  }

  if (!courseResult.data) {
    notFound();
  }

  if (groupResult.error) {
    console.error("Dersin seansları alınamadı:", groupResult.error);
  }

  if (enrollmentResult.error) {
    console.error("Dersin öğrencileri alınamadı:", enrollmentResult.error);
  }

  const course = courseResult.data as CourseRow;
  const groups = (groupResult.data ?? []) as unknown as GroupRow[];
  const enrollments = (enrollmentResult.data ?? []) as unknown as EnrollmentRow[];

  const coursePin =
    buildCoursePinMap(
      ((courseOrderResult.data ?? []) as { id: string }[]).map((item) => item.id),
    ).get(course.id) ?? coursePinClasses[0];

  const activeGroups = groups.filter((group) => group.is_active);
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const groupStudentCount = new Map<string, number>();

  for (const enrollment of enrollments) {
    if (enrollment.class_group_id) {
      groupStudentCount.set(
        enrollment.class_group_id,
        (groupStudentCount.get(enrollment.class_group_id) ?? 0) + 1,
      );
    }
  }

  const teachers = Array.from(
    new Map(
      activeGroups
        .filter((group) => group.teacher)
        .map((group) => [group.teacher!.id, group.teacher!]),
    ).values(),
  ).sort((a, b) => a.full_name.localeCompare(b.full_name, "tr-TR"));

  const students = [...enrollments].sort((a, b) =>
    studentName(a).localeCompare(studentName(b), "tr-TR"),
  );

  const activeStudentCount = enrollments.filter((item) => item.status === "active").length;
  const monthlyTotal = enrollments
    .filter((item) => item.status === "active")
    .reduce((total, item) => total + Number(item.net_monthly_fee), 0);

  const listedFee = Number(course.default_monthly_fee);

  return (
    <>
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

      <ProfileLayout
        aside={
          <>
            <div className="mx-auto w-56 sm:w-64 lg:w-full">
              <div
                className={`grid aspect-square w-full place-items-center rounded-2xl border-4 border-surface shadow-md ring-1 ring-border ${coursePin}`}
              >
                <span className="px-4 text-center">
                  <span className="block text-5xl font-semibold tracking-wide">
                    {getNameInitials(course.name)}
                  </span>
                  {course.code && (
                    <span className="mt-2 block text-sm font-semibold opacity-80">
                      {course.code}
                    </span>
                  )}
                </span>
              </div>
            </div>

            <ProfileBox title="Kısa bilgiler">
              <dl className="space-y-2 text-sm">
                <ProfileFact
                  label="Tür"
                  value={course.course_type === "group" ? "Grup dersi" : "Birebir ders"}
                />
                <ProfileFact label="Süre" value={`${course.default_duration_minutes} dakika`} />
                <ProfileFact label="İlan ücreti" value={formatTry(listedFee)} />
                <ProfileFact
                  label="MEB"
                  value={mebStatusLabels[course.meb_status] ?? course.meb_status}
                />
                {course.meb_approval_number && (
                  <ProfileFact label="Onay no" value={course.meb_approval_number} />
                )}
                {course.meb_valid_until && (
                  <ProfileFact label="Geçerlilik" value={formatDate(course.meb_valid_until)} />
                )}
              </dl>
            </ProfileBox>

            <ProfileBox title="Özet">
              <dl className="space-y-2 text-sm">
                <ProfileFact label="Aktif öğrenci" value={activeStudentCount} />
                <ProfileFact label="Dondurulmuş" value={enrollments.length - activeStudentCount} />
                <ProfileFact label="Aktif seans" value={activeGroups.length} />
                <ProfileFact label="Aylık tahakkuk" value={formatTry(monthlyTotal)} />
              </dl>
            </ProfileBox>

            <ProfileBox title={`Öğretmenler (${teachers.length})`}>
              {teachers.length === 0 ? (
                <p className="text-sm text-text-secondary">Atanmış öğretmen yok.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {teachers.map((teacher) => (
                    <li key={teacher.id}>
                      <Link
                        href={`/ogretmenler/${teacher.id}`}
                        className="font-semibold text-primary hover:underline"
                      >
                        {teacher.full_name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </ProfileBox>

            <Link
              href="/dersler"
              className="block rounded-xl px-4 py-2 text-center text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
            >
              ← Ders listesine dön
            </Link>
          </>
        }
      >
        <ProfileHeader
          title={course.name}
          badge={
            <ProfileStatusBadge
              label={course.is_active ? "Aktif" : "Pasif"}
              className={
                course.is_active
                  ? "bg-success-soft text-success"
                  : "bg-surface-muted text-text-secondary"
              }
            />
          }
          subtitle={[
            course.course_type === "group" ? "Grup dersi" : "Birebir ders",
            `${course.default_duration_minutes} dakika`,
            `${activeStudentCount} aktif öğrenci`,
            `${activeGroups.length} seans`,
          ].join(" · ")}
          tabs={profileTabs}
        />

        <ProfileSection id="seanslar">
          <ProfileCard
            title="Seanslar"
            description="Bu derse ait haftalık seanslar ve doluluk."
            action={
              <Link
                href="/program/yeni"
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-surface-hover"
              >
                + Seans ekle
              </Link>
            }
          >
            {groups.length === 0 ? (
              <p className="text-sm text-text-secondary">Bu ders için seans tanımlanmamış.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className={`h-3 w-3 rounded ${coursePin}`} />
                    Öğrencisi olan saat
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border border-dashed border-border-strong" />
                    Boş (müsait) saat
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-warning-soft ring-1 ring-warning" />
                    Kontenjan dolu
                  </span>
                </div>

                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {Array.from(new Set(groups.map((group) => group.weekday)))
                    .sort((a, b) => a - b)
                    .map((weekday) => (
                      <div
                        key={weekday}
                        className="grid gap-2 px-4 py-3 sm:grid-cols-[7rem_minmax(0,1fr)] sm:items-center"
                      >
                        <h3 className="text-sm font-semibold text-text-primary">
                          {weekdayLabels[weekday] ?? "Gün"}
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {groups
                            .filter((group) => group.weekday === weekday)
                            .map((group) => {
                              const count = groupStudentCount.get(group.id) ?? 0;
                              const full = group.capacity !== null && count >= group.capacity;

                              return (
                                <Link
                                  key={group.id}
                                  href={`/program/${group.id}`}
                                  title={[
                                    group.teacher?.full_name ?? "Öğretmen atanmadı",
                                    group.room_name,
                                    `${count}${group.capacity ? `/${group.capacity}` : ""} öğrenci`,
                                    group.is_active ? null : "pasif",
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition hover:ring-2 hover:ring-focus-ring/40 ${
                                    !group.is_active
                                      ? "bg-surface-muted text-text-secondary line-through"
                                      : full
                                        ? "bg-warning-soft text-warning ring-1 ring-warning"
                                        : count > 0
                                          ? coursePin
                                          : "border border-dashed border-border-strong text-text-secondary"
                                  }`}
                                >
                                  {group.start_time.slice(0, 5)}
                                  {count > 0 && teachers.length > 1 && group.teacher && (
                                    <span className="ml-1 font-normal">
                                      {getNameInitials(group.teacher.full_name)}
                                    </span>
                                  )}
                                </Link>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </ProfileCard>
        </ProfileSection>

        <ProfileSection id="ogrenciler">
          <ProfileCard
            title={`Öğrenciler (${students.length})`}
            description="Aktif veya dondurulmuş kaydı olan öğrenciler ve güncel aylık ücretleri."
          >
            {students.length === 0 ? (
              <p className="text-sm text-text-secondary">Bu derste kayıtlı öğrenci yok.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {students.map((enrollment) => {
                  const group = enrollment.class_group_id
                    ? groupById.get(enrollment.class_group_id)
                    : null;

                  return (
                    <li key={enrollment.id}>
                      <Link
                        href={`/ogrenciler/${enrollment.student_id}`}
                        className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:bg-surface-muted"
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-text-secondary">
                          {getNameInitials(studentName(enrollment))}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-text-primary">
                            {studentName(enrollment)}
                            {enrollment.status === "frozen" && (
                              <span className="ml-1.5 text-xs font-normal text-info">
                                Donduruldu
                              </span>
                            )}
                          </span>
                          <span className="block truncate text-xs text-text-secondary">
                            {group
                              ? `${weekdayLabels[group.weekday] ?? ""} ${group.start_time.slice(0, 5)}`
                              : "Seans yok"}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatTry(Number(enrollment.net_monthly_fee))}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </ProfileCard>
        </ProfileSection>

        <ProfileSection id="bilgiler">
          <CourseForm
            mode="edit"
            fullWidth
            course={{
              id: course.id,
              name: course.name,
              code: course.code ?? "",
              courseType: course.course_type,
              durationMinutes: course.default_duration_minutes,
              monthlyFee: listedFee,
            }}
          />
        </ProfileSection>

        <ProfileSection id="zam">
          <ProfileCard
            title="Toplu ücret güncelleme (zam)"
            description={`Bu dersteki ${enrollments.length} aktif/dondurulmuş öğrencinin her birinin kendi ücretine, seçilen aydan itibaren artış uygular. Öğrencilere özel indirimler korunur. Tek bir öğrencinin ücretini değiştirmek için öğrenci sayfasını kullanın.`}
          >
            <form action={bulkAdjustCourseFees} className="grid gap-4 md:grid-cols-4">
              <input type="hidden" name="courseId" value={course.id} />

              <label className="block text-sm font-medium">
                Geçerli olacağı ay
                <input
                  type="month"
                  name="effectiveMonth"
                  required
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium">
                Artış türü
                <select
                  name="adjustType"
                  defaultValue="percent"
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                >
                  <option value="percent">Yüzde (%)</option>
                  <option value="fixed">Sabit tutar (TL)</option>
                </select>
              </label>

              <label className="block text-sm font-medium">
                Artış değeri
                <input
                  name="adjustValue"
                  required
                  inputMode="decimal"
                  placeholder="Örn. 20"
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                />
              </label>

              <label className="block text-sm font-medium">
                Açıklama
                <input
                  name="note"
                  placeholder="Örn. Ocak zammı"
                  className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
                />
              </label>

              <div className="md:col-span-4">
                <button
                  type="submit"
                  className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring active:scale-[0.98]"
                >
                  Zammı uygula
                </button>
              </div>
            </form>
          </ProfileCard>
        </ProfileSection>
      </ProfileLayout>
    </>
  );
}

function studentName(enrollment: EnrollmentRow) {
  return enrollment.student
    ? `${enrollment.student.first_name} ${enrollment.student.last_name}`
    : "Öğrenci";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
