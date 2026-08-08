import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import { setCourseActive } from "./actions";

type CourseRow = {
  id: string;
  name: string;
  code: string | null;
  course_type: "individual" | "group";
  default_duration_minutes: number;
  default_monthly_fee: number | string;
  is_active: boolean;
};

type CoursesPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function CoursesPage({
  searchParams,
}: CoursesPageProps) {
  await requireRole(["admin"]);

  const messages = await searchParams;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("courses")
    .select(`
      id,
      name,
      code,
      course_type,
      default_duration_minutes,
      default_monthly_fee,
      is_active
    `)
    .order("is_active", {
      ascending: false,
    })
    .order("name", {
      ascending: true,
    });

  if (error) {
    console.error(
      "Ders listesi alınamadı:",
      error,
    );
  }

  const courses =
    (data ?? []) as CourseRow[];

  return (
    <>
      <PageHeader
        title="Dersler"
        description="Kurumda verilen birebir ve grup derslerinin temel tanımlarını yönetin."
        action={
          <Link
            href="/dersler/yeni"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white"
          >
            + Ders ekle
          </Link>
        }
      />

      {messages.success && (
        <div className="mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {messages.success}
        </div>
      )}

      {messages.error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          {messages.error}
        </div>
      )}

      {error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          Ders kayıtları alınamadı.
        </div>
      )}

      {courses.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel px-6 py-16 text-center shadow-sm">
          <h2 className="text-lg font-bold">
            Henüz ders tanımı yok
          </h2>

          <p className="mt-2 text-sm text-muted">
            İlk olarak piyano, resim veya drama gibi kurum derslerini oluşturun.
          </p>

          <Link
            href="/dersler/yeni"
            className="mt-6 inline-block rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
          >
            İlk dersi oluştur
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {courses.map((course) => (
            <article
              key={course.id}
              className={`rounded-2xl border bg-panel p-5 shadow-sm ${
                course.is_active
                  ? "border-line"
                  : "border-line opacity-65"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/dersler/${course.id}`}
                    className="text-lg font-bold hover:underline"
                  >
                    {course.name}
                  </Link>

                  <p className="mt-1 text-sm text-muted">
                    {course.code ||
                      "Ders kodu yok"}
                  </p>
                </div>

                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    course.is_active
                      ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-fill text-muted"
                  }`}
                >
                  {course.is_active
                    ? "Aktif"
                    : "Pasif"}
                </span>
              </div>

              <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-muted">
                    Ders türü
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {course.course_type ===
                    "individual"
                      ? "Birebir ders"
                      : "Grup dersi"}
                  </dd>
                </div>

                <div>
                  <dt className="text-muted">
                    Ders süresi
                  </dt>

                  <dd className="mt-1 font-semibold">
                    {
                      course.default_duration_minutes
                    }{" "}
                    dakika
                  </dd>
                </div>

                <div className="col-span-2">
                  <dt className="text-muted">
                    Varsayılan aylık ücret
                  </dt>

                  <dd className="mt-1 text-lg font-bold">
                    {formatTry(
                      Number(
                        course.default_monthly_fee,
                      ),
                    )}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-brand-50 pt-4">
                <Link
                  href={`/dersler/${course.id}`}
                  className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand-700"
                >
                  Düzenle
                </Link>

                <form action={setCourseActive}>
                  <input
                    type="hidden"
                    name="courseId"
                    value={course.id}
                  />

                  <input
                    type="hidden"
                    name="isActive"
                    value={
                      course.is_active
                        ? "false"
                        : "true"
                    }
                  />

                  <button
                    type="submit"
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                      course.is_active
                        ? "border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
                        : "border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    {course.is_active
                      ? "Pasife al"
                      : "Aktifleştir"}
                  </button>
                </form>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}