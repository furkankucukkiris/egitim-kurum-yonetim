import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProfileAvatar,
  ProfileBox,
  ProfileCard,
  ProfileFact,
  ProfileHeader,
  ProfileLayout,
  ProfileSection,
  ProfileStatusBadge,
  getNameInitials,
} from "@/components/profile/ProfileLayout";
import { CopyButton } from "@/components/ui/CopyButton";
import { requireRole } from "@/lib/auth";
import { buildCoursePinMap, coursePinClasses } from "@/lib/course-colors";
import { createClient } from "@/lib/supabase/server";
import { TeacherAccessControls } from "../teacher-access-controls";

type PageProps = {
  params: Promise<{ teacherId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

type TeacherRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
};

type GroupRow = {
  id: string;
  course_id: string;
  name: string;
  room_name: string | null;
  capacity: number | null;
  weekday: number;
  start_time: string;
  duration_minutes: number | null;
  is_active: boolean;
  course: { name: string } | null;
};

type EnrollmentRow = {
  id: string;
  student_id: string;
  course_id: string;
  class_group_id: string | null;
  status: "active" | "frozen";
  student: { first_name: string; last_name: string } | null;
};

type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  room_name: string | null;
  course: { name: string } | null;
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

const profileTabs = [
  { href: "#program", label: "Haftalık program" },
  { href: "#yaklasan", label: "Yaklaşan dersler" },
  { href: "#ogrenciler", label: "Öğrenciler" },
  { href: "#islemler", label: "Hesap işlemleri" },
];

export default async function TeacherProfilePage({ params, searchParams }: PageProps) {
  await requireRole(["admin"]);

  const { teacherId } = await params;
  const messages = await searchParams;
  const supabase = await createClient();

  const { data: teacherData, error: teacherError } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, is_active, must_change_password, created_at")
    .eq("id", teacherId)
    .eq("role", "teacher")
    .maybeSingle();

  if (teacherError) {
    console.error("Öğretmen alınamadı:", teacherError);
  }

  if (!teacherData) {
    notFound();
  }

  const teacher = teacherData as TeacherRow;

  const { data: groupData, error: groupError } = await supabase
    .from("class_groups")
    .select(
      "id, course_id, name, room_name, capacity, weekday, start_time, duration_minutes, is_active, course:courses ( name )",
    )
    .eq("teacher_profile_id", teacherId)
    .order("weekday", { ascending: true })
    .order("start_time", { ascending: true });

  if (groupError) {
    console.error("Öğretmen seansları alınamadı:", groupError);
  }

  const groups = (groupData ?? []) as unknown as GroupRow[];
  const groupIds = groups.map((group) => group.id);

  // Öğretmenin oturumu: doğrudan atanmış veya seansı (grubu) ona ait olan.
  const sessionOwnerFilter =
    groupIds.length > 0
      ? `teacher_profile_id.eq.${teacherId},class_group_id.in.(${groupIds.join(",")})`
      : `teacher_profile_id.eq.${teacherId}`;

  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [enrollmentResult, sessionResult, requestResult, courseOrderResult] = await Promise.all([
    supabase
      .from("enrollments")
      .select(
        "id, student_id, course_id, class_group_id, status, student:students ( first_name, last_name )",
      )
      .in("status", ["active", "frozen"])
      .or(
        groupIds.length > 0
          ? `teacher_profile_id.eq.${teacherId},class_group_id.in.(${groupIds.join(",")})`
          : `teacher_profile_id.eq.${teacherId}`,
      ),

    supabase
      .from("lesson_sessions")
      .select("id, starts_at, ends_at, room_name, course:courses ( name )")
      .or(sessionOwnerFilter)
      .is("cancelled_at", null)
      .gte("starts_at", now.toISOString())
      .lt("starts_at", weekLater.toISOString())
      .order("starts_at", { ascending: true })
      .limit(12),

    supabase
      .from("teacher_requests")
      .select("id", { count: "exact", head: true })
      .eq("teacher_profile_id", teacherId)
      .eq("status", "open"),

    supabase
      .from("courses")
      .select("id")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  if (enrollmentResult.error) {
    console.error("Öğretmen öğrencileri alınamadı:", enrollmentResult.error);
  }

  if (sessionResult.error) {
    console.error("Yaklaşan dersler alınamadı:", sessionResult.error);
  }

  const enrollments = (enrollmentResult.data ?? []) as unknown as EnrollmentRow[];
  const upcomingSessions = (sessionResult.data ?? []) as unknown as SessionRow[];
  const openRequestCount = requestResult.count ?? 0;

  const coursePinById = buildCoursePinMap(
    ((courseOrderResult.data ?? []) as { id: string }[]).map((course) => course.id),
  );

  const activeGroups = groups.filter((group) => group.is_active);
  const groupById = new Map(groups.map((group) => [group.id, group]));

  const courses = Array.from(
    new Map(
      activeGroups.map((group) => [
        group.course_id,
        { id: group.course_id, name: group.course?.name ?? "Ders" },
      ]),
    ).values(),
  ).sort((a, b) => a.name.localeCompare(b.name, "tr-TR"));

  // Öğrenci başına tek satır; birden fazla dersi varsa hepsi listelenir.
  const studentMap = new Map<
    string,
    { id: string; name: string; courses: { id: string; name: string; frozen: boolean }[] }
  >();

  for (const enrollment of enrollments) {
    const entry = studentMap.get(enrollment.student_id) ?? {
      id: enrollment.student_id,
      name: enrollment.student
        ? `${enrollment.student.first_name} ${enrollment.student.last_name}`
        : "Öğrenci",
      courses: [],
    };

    const group = enrollment.class_group_id ? groupById.get(enrollment.class_group_id) : null;

    entry.courses.push({
      id: enrollment.course_id,
      name: group?.course?.name ?? "Ders",
      frozen: enrollment.status === "frozen",
    });
    studentMap.set(enrollment.student_id, entry);
  }

  const students = Array.from(studentMap.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "tr-TR"),
  );

  // Seans başına aktif/dondurulmuş öğrenci sayısı (kontenjan gösterimi).
  const groupStudentCount = new Map<string, number>();

  for (const enrollment of enrollments) {
    if (enrollment.class_group_id) {
      groupStudentCount.set(
        enrollment.class_group_id,
        (groupStudentCount.get(enrollment.class_group_id) ?? 0) + 1,
      );
    }
  }

  // Seansların çoğu müsait saat olarak açılıyor; yük hesabı yalnızca
  // öğrencisi olan seanslardan yapılır.
  const occupiedGroups = activeGroups.filter((group) => (groupStudentCount.get(group.id) ?? 0) > 0);
  const occupiedMinutes = occupiedGroups.reduce(
    (total, group) => total + (group.duration_minutes ?? 0),
    0,
  );

  const groupsByWeekday = new Map<number, GroupRow[]>();

  for (const group of activeGroups) {
    groupsByWeekday.set(group.weekday, [...(groupsByWeekday.get(group.weekday) ?? []), group]);
  }

  const returnTo = `/ogretmenler/${teacher.id}`;

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
              <ProfileAvatar initials={getNameInitials(teacher.full_name)} tone="brand" />
            </div>

            <ProfileBox title="İletişim">
              <dl className="space-y-2 text-sm">
                <ProfileFact
                  label="Telefon"
                  value={
                    teacher.phone ? (
                      <a href={`tel:${teacher.phone}`} className="text-primary hover:underline">
                        {teacher.phone}
                      </a>
                    ) : (
                      "Girilmedi"
                    )
                  }
                />
                <div className="space-y-1">
                  <dt className="text-text-secondary">E-posta</dt>
                  <dd className="flex items-center justify-between gap-2 font-medium text-text-primary">
                    <span className="min-w-0 break-all">{teacher.email ?? "Girilmedi"}</span>
                    {teacher.email && <CopyButton value={teacher.email} />}
                  </dd>
                </div>
              </dl>
            </ProfileBox>

            <ProfileBox title="Özet">
              <dl className="space-y-2 text-sm">
                <ProfileFact label="Aktif öğrenci" value={students.length} />
                <ProfileFact
                  label="Dolu saat"
                  value={`${occupiedGroups.length} / ${activeGroups.length}`}
                />
                <ProfileFact
                  label="Haftalık ders"
                  value={occupiedMinutes > 0 ? formatMinutes(occupiedMinutes) : "—"}
                />
                <ProfileFact
                  label="Açık not/talep"
                  value={
                    openRequestCount > 0 ? (
                      <Link href="/talepler" className="text-primary hover:underline">
                        {openRequestCount}
                      </Link>
                    ) : (
                      0
                    )
                  }
                />
                <ProfileFact label="Hesap açılışı" value={formatDate(teacher.created_at)} />
              </dl>
            </ProfileBox>

            <div className="grid gap-2">
              <Link
                href={`/hakedis/${teacher.id}`}
                className="rounded-xl border border-border bg-surface px-4 py-2.5 text-center text-sm font-semibold text-primary transition hover:bg-surface-muted"
              >
                Hakediş geçmişi
              </Link>

              <Link
                href="/ogretmenler"
                className="rounded-xl px-4 py-2 text-center text-sm font-medium text-text-secondary transition hover:bg-surface-muted"
              >
                ← Öğretmen listesine dön
              </Link>
            </div>
          </>
        }
      >
        <ProfileHeader
          title={teacher.full_name}
          badge={
            <ProfileStatusBadge
              label={teacher.is_active ? "Aktif" : "Pasif"}
              className={
                teacher.is_active
                  ? "bg-success-soft text-success"
                  : "bg-surface-muted text-text-secondary"
              }
            />
          }
          subtitle={[
            "Öğretmen",
            `${students.length} öğrenci`,
            `${occupiedGroups.length} dolu / ${activeGroups.length} açık saat`,
          ].join(" · ")}
          tabs={profileTabs}
        >
          <div className="flex flex-wrap gap-1.5">
            {courses.length === 0 ? (
              <span className="text-sm text-text-secondary">Henüz ders atanmamış.</span>
            ) : (
              courses.map((course) => (
                <span
                  key={course.id}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                    coursePinById.get(course.id) ?? coursePinClasses[0]
                  }`}
                >
                  {course.name}
                </span>
              ))
            )}
          </div>
        </ProfileHeader>

        {teacher.must_change_password && (
          <div className="mt-6 rounded-2xl border border-accent/30 bg-accent-soft p-4 text-sm font-semibold text-accent-strong">
            Öğretmen henüz ilk girişini yapıp parolasını belirlemedi.
          </div>
        )}

        <ProfileSection id="program">
          <ProfileCard
            title="Haftalık program"
            description="Saatin üzerine gelince ders, derslik ve doluluk görünür; tıklayınca seansı açar."
            action={
              <Link
                href="/program/yeni"
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-surface-hover"
              >
                + Seans ekle
              </Link>
            }
          >
            {activeGroups.length === 0 ? (
              <p className="text-sm text-text-secondary">Aktif seans yok.</p>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-text-secondary">
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded bg-violet-200 dark:bg-violet-900" />
                    Öğrencisi olan saat
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded border border-dashed border-border-strong" />
                    Boş (müsait) saat
                  </span>
                </div>

                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                  {Array.from(groupsByWeekday.keys())
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
                          {(groupsByWeekday.get(weekday) ?? []).map((group) => {
                            const count = groupStudentCount.get(group.id) ?? 0;

                            return (
                              <Link
                                key={group.id}
                                href={`/program/${group.id}`}
                                title={[
                                  group.course?.name ?? "Ders",
                                  group.duration_minutes ? `${group.duration_minutes} dk` : null,
                                  group.room_name,
                                  `${count}${group.capacity ? `/${group.capacity}` : ""} öğrenci`,
                                ]
                                  .filter(Boolean)
                                  .join(" · ")}
                                className={`rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums transition hover:ring-2 hover:ring-focus-ring/40 ${
                                  count > 0
                                    ? (coursePinById.get(group.course_id) ?? coursePinClasses[0])
                                    : "border border-dashed border-border-strong text-text-secondary"
                                }`}
                              >
                                {group.start_time.slice(0, 5)}
                                {count > 0 && courses.length > 1 && (
                                  <span className="ml-1 font-normal">{group.course?.name}</span>
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

        <ProfileSection id="yaklasan">
          <ProfileCard title="Yaklaşan dersler" description="Önümüzdeki 7 gün.">
            {upcomingSessions.length === 0 ? (
              <p className="text-sm text-text-secondary">Önümüzdeki 7 günde ders yok.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                {upcomingSessions.map((session) => (
                  <li key={session.id}>
                    <Link
                      href={`/yoklama?date=${istanbulDate(session.starts_at)}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm transition hover:bg-surface-muted"
                    >
                      <span className="font-medium">
                        {formatSessionDay(session.starts_at)}{" "}
                        <span className="tabular-nums text-text-secondary">
                          {formatTime(session.starts_at)}–{formatTime(session.ends_at)}
                        </span>
                      </span>
                      <span className="text-text-secondary">
                        {session.course?.name ?? "Ders"}
                        {session.room_name ? ` · ${session.room_name}` : ""}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ProfileCard>
        </ProfileSection>

        <ProfileSection id="ogrenciler">
          <ProfileCard
            title={`Öğrenciler (${students.length})`}
            description="Aktif veya dondurulmuş ders kaydı olan öğrenciler."
          >
            {students.length === 0 ? (
              <p className="text-sm text-text-secondary">Kayıtlı öğrenci yok.</p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2">
                {students.map((student) => (
                  <li key={student.id}>
                    <Link
                      href={`/ogrenciler/${student.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border p-3 transition hover:bg-surface-muted"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-xs font-semibold text-text-secondary">
                        {getNameInitials(student.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-text-primary">
                          {student.name}
                        </span>
                        <span className="block truncate text-xs text-text-secondary">
                          {student.courses
                            .map(
                              (course) => `${course.name}${course.frozen ? " (donduruldu)" : ""}`,
                            )
                            .join(", ")}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </ProfileCard>
        </ProfileSection>

        <ProfileSection id="islemler">
          <ProfileCard
            title="Hesap işlemleri"
            description="Hesabı pasife almak öğretmenin girişini kapatır; geçici parola ilk girişte değiştirilir."
          >
            <TeacherAccessControls
              teacherId={teacher.id}
              isActive={teacher.is_active}
              returnTo={returnTo}
            />
          </ProfileCard>
        </ProfileSection>
      </ProfileLayout>
    </>
  );
}

function formatMinutes(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest} dk`;
  return rest === 0 ? `${hours} saat` : `${hours} sa ${rest} dk`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSessionDay(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(value));
}

function istanbulDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(new Date(value));
}
