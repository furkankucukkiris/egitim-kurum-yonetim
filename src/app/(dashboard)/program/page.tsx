import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { setClassGroupActive } from "./actions";

type GroupRow = {
  id: string;
  name: string;
  room_name: string | null;
  capacity: number;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;

  course: {
    name: string;
    course_type:
      | "individual"
      | "group";
  } | null;

  teacher: {
    full_name: string;
  } | null;
};

type EnrollmentRow = {
  class_group_id: string | null;
  status:
    | "active"
    | "frozen"
    | "cancelled"
    | "completed";
};

type ProgramPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
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

export default async function ProgramPage({
  searchParams,
}: ProgramPageProps) {
  await requireRole(["admin"]);

  const messages = await searchParams;
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
        capacity,
        weekday,
        start_time,
        duration_minutes,
        starts_on,
        ends_on,
        is_active,
        course:courses (
          name,
          course_type
        ),
        teacher:profiles (
          full_name
        )
      `)
      .order("is_active", {
        ascending: false,
      })
      .order("weekday", {
        ascending: true,
      })
      .order("start_time", {
        ascending: true,
      }),

    supabase
      .from("enrollments")
      .select(`
        class_group_id,
        status
      `)
      .in("status", [
        "active",
        "frozen",
      ])
      .not(
        "class_group_id",
        "is",
        null,
      ),
  ]);

  if (groupsResult.error) {
    console.error(
      "Program alınamadı:",
      groupsResult.error,
    );
  }

  if (enrollmentsResult.error) {
    console.error(
      "Kayıt sayıları alınamadı:",
      enrollmentsResult.error,
    );
  }

  const groups =
    (groupsResult.data ??
      []) as unknown as GroupRow[];

  const enrollments =
    (enrollmentsResult.data ??
      []) as EnrollmentRow[];

  const enrollmentCounts =
    new Map<string, number>();

  for (const enrollment of enrollments) {
    if (!enrollment.class_group_id) {
      continue;
    }

    enrollmentCounts.set(
      enrollment.class_group_id,
      (
        enrollmentCounts.get(
          enrollment.class_group_id,
        ) ?? 0
      ) + 1,
    );
  }

  return (
    <>
      <PageHeader
        title="Ders Programı"
        description="Birebir ders saatlerini ve grup derslerinin haftalık programını yönetin."
        action={
          <Link
            href="/program/yeni"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white"
          >
            + Seans ekle
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

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel px-6 py-16 text-center shadow-sm">
          <h2 className="text-lg font-bold">
            Henüz ders seansı yok
          </h2>

          <p className="mt-2 text-sm text-muted">
            Haftalık ders günlerini ve saatlerini oluşturarak programı başlatın.
          </p>

          <Link
            href="/program/yeni"
            className="mt-6 inline-block rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
          >
            İlk seansı oluştur
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const studentCount =
              enrollmentCounts.get(
                group.id,
              ) ?? 0;

            return (
              <article
                key={group.id}
                className={`rounded-2xl border bg-panel p-5 shadow-sm ${
                  group.is_active
                    ? "border-line"
                    : "border-line opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <Link
                      href={`/program/${group.id}`}
                      className="text-lg font-bold hover:underline"
                    >
                      {group.name}
                    </Link>

                    <p className="mt-1 text-sm text-muted">
                      {group.course?.name ??
                        "Ders bulunamadı"}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      group.is_active
                        ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-fill text-muted"
                    }`}
                  >
                    {group.is_active
                      ? "Aktif"
                      : "Pasif"}
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-muted">
                      Gün ve saat
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {
                        weekdayLabels[
                          group.weekday
                        ]
                      }{" "}
                      {group.start_time.slice(
                        0,
                        5,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted">
                      Süre
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {
                        group.duration_minutes
                      }{" "}
                      dakika
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted">
                      Öğretmen
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {group.teacher
                        ?.full_name ??
                        "Atanmadı"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted">
                      Derslik
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {group.room_name ??
                        "Belirtilmedi"}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted">
                      Kontenjan
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {studentCount}/
                      {group.capacity}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-muted">
                      Ders türü
                    </dt>

                    <dd className="mt-1 font-semibold">
                      {group.course
                        ?.course_type ===
                      "individual"
                        ? "Birebir"
                        : "Grup"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 flex gap-2 border-t border-brand-50 pt-4">
                  <Link
                    href={`/program/${group.id}`}
                    className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand-700"
                  >
                    Düzenle
                  </Link>

                  <form
                    action={
                      setClassGroupActive
                    }
                  >
                    <input
                      type="hidden"
                      name="groupId"
                      value={group.id}
                    />

                    <input
                      type="hidden"
                      name="isActive"
                      value={
                        group.is_active
                          ? "false"
                          : "true"
                      }
                    />

                    <button
                      type="submit"
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                        group.is_active
                          ? "border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
                          : "border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      }`}
                    >
                      {group.is_active
                        ? "Pasife al"
                        : "Aktifleştir"}
                    </button>
                  </form>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}