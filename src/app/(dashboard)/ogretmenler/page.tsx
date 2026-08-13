import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { TeacherAccountForm } from "./teacher-account-form";
import { TeacherAccessControls } from "./teacher-access-controls";

type PageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type TeacherRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  must_change_password: boolean;
};

type GroupRow = {
  id: string;
  teacher_profile_id: string | null;
  is_active: boolean;
  course: {
    name: string;
  } | null;
};

type EnrollmentRow = {
  student_id: string;
  teacher_profile_id: string | null;
  class_group_id: string | null;
};

export default async function TeachersPage({ searchParams }: PageProps) {
  await requireRole(["admin"]);

  const messages = await searchParams;
  const supabase = await createClient();

  const [teachersResult, groupsResult, enrollmentsResult] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        `
          id,
          full_name,
          email,
          phone,
          is_active,
          must_change_password
        `,
      )
      .eq("role", "teacher")
      .order("is_active", {
        ascending: false,
      })
      .order("full_name"),

    supabase.from("class_groups").select(`
      id,
      teacher_profile_id,
      is_active,
      course:courses (
        name
      )
    `),

    supabase
      .from("enrollments")
      .select(
        `
          student_id,
          teacher_profile_id,
          class_group_id
        `,
      )
      .in("status", ["active", "frozen"]),
  ]);

  if (teachersResult.error) {
    console.error("Öğretmenler alınamadı:", teachersResult.error);
  }

  if (groupsResult.error) {
    console.error("Öğretmen programları alınamadı:", groupsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Öğretmen öğrenci sayıları alınamadı:", enrollmentsResult.error);
  }

  const teachers = (teachersResult.data ?? []) as TeacherRow[];

  const groups = (groupsResult.data ?? []) as unknown as GroupRow[];

  const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];

  const groupById = new Map(groups.map((group) => [group.id, group]));

  return (
    <>
      <PageHeader
        title="Öğretmenler"
        description="Gerçek öğretmen hesaplarını oluşturun, erişimlerini yönetin ve atanmış programlarını izleyin."
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

      <TeacherAccountForm />

      {teachers.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center shadow-sm">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-surface-muted text-2xl">
            ◇
          </div>

          <h2 className="mt-5 text-lg font-bold">Henüz öğretmen hesabı yok</h2>

          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-secondary">
            Yukarıdaki formdan ilk öğretmen hesabını oluşturabilirsiniz.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {teachers.map((teacher) => {
            const teacherGroups = groups.filter((group) => group.teacher_profile_id === teacher.id);

            const activeGroups = teacherGroups.filter((group) => group.is_active);

            const courseNames = Array.from(
              new Set(
                activeGroups
                  .map((group) => group.course?.name)
                  .filter((name): name is string => Boolean(name)),
              ),
            );

            const studentIds = new Set(
              enrollments
                .filter((enrollment) => {
                  const group = enrollment.class_group_id
                    ? groupById.get(enrollment.class_group_id)
                    : null;

                  return (
                    enrollment.teacher_profile_id === teacher.id ||
                    group?.teacher_profile_id === teacher.id
                  );
                })
                .map((enrollment) => enrollment.student_id),
            );

            return (
              <article
                key={teacher.id}
                className={`rounded-2xl border bg-surface p-5 shadow-sm ${
                  teacher.is_active ? "border-border" : "border-border opacity-65"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sidebar font-bold text-on-primary">
                      {getInitials(teacher.full_name)}
                    </div>

                    <div className="min-w-0">
                      <h3 className="truncate font-bold">{teacher.full_name}</h3>

                      <p className="mt-1 truncate text-sm text-text-secondary">
                        {teacher.email ?? "E-posta tanımlı değil"}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${
                      teacher.is_active
                        ? "bg-success-soft text-success"
                        : "bg-surface-muted text-text-secondary"
                    }`}
                  >
                    {teacher.is_active ? "Aktif" : "Pasif"}
                  </span>
                </div>

                {teacher.must_change_password && (
                  <div className="mt-4 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-strong">
                    İlk giriş ve parola belirleme bekleniyor
                  </div>
                )}

                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Aktif öğrenci</dt>
                    <dd className="mt-1 text-lg font-bold">{studentIds.size}</dd>
                  </div>

                  <div className="rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Aktif seans</dt>
                    <dd className="mt-1 text-lg font-bold">{activeGroups.length}</dd>
                  </div>

                  <div className="col-span-2 rounded-xl bg-surface-muted p-3">
                    <dt className="text-text-secondary">Dersler</dt>
                    <dd className="mt-1 font-semibold">
                      {courseNames.length > 0 ? courseNames.join(", ") : "Henüz ders atanmamış"}
                    </dd>
                  </div>

                  {teacher.phone && (
                    <div className="col-span-2 rounded-xl bg-surface-muted p-3">
                      <dt className="text-text-secondary">Telefon</dt>
                      <dd className="mt-1 font-semibold">{teacher.phone}</dd>
                    </div>
                  )}
                </dl>

                <TeacherAccessControls teacherId={teacher.id} isActive={teacher.is_active} />
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

function getInitials(fullName: string) {
  const names = fullName.trim().split(/\s+/).filter(Boolean);

  if (names.length === 0) {
    return "Ö";
  }

  if (names.length === 1) {
    return names[0].slice(0, 2).toLocaleUpperCase("tr-TR");
  }

  return `${names[0][0]}${names[names.length - 1][0]}`.toLocaleUpperCase("tr-TR");
}
