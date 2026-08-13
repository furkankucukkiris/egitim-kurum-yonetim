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
    course_type: "individual" | "group";
  } | null;

  teacher: {
    full_name: string;
  } | null;
};

type EnrollmentRow = {
  class_group_id: string | null;
  status: "active" | "frozen" | "cancelled" | "completed";
};

type ProgramPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
    warning?: string;
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

export default async function ProgramPage({ searchParams }: ProgramPageProps) {
  await requireRole(["admin"]);

  const messages = await searchParams;
  const supabase = await createClient();

  const [groupsResult, enrollmentsResult, waitlistOpportunitiesResult] = await Promise.all([
    supabase
      .from("class_groups")
      .select(
        `
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
        `,
      )
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
      .select(
        `
          class_group_id,
          status
        `,
      )
      .in("status", ["active", "frozen"])
      .not("class_group_id", "is", null),

    supabase.rpc("get_waitlist_opportunities"),
  ]);

  if (groupsResult.error) {
    console.error("Program alınamadı:", groupsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Kayıt sayıları alınamadı:", enrollmentsResult.error);
  }

  if (waitlistOpportunitiesResult.error) {
    console.error("Bekleme listesi sayıları alınamadı:", waitlistOpportunitiesResult.error);
  }

  const groups = (groupsResult.data ?? []) as unknown as GroupRow[];

  const enrollments = (enrollmentsResult.data ?? []) as EnrollmentRow[];

  const waitingCountByGroup = new Map<string, number>();

  for (const item of (waitlistOpportunitiesResult.data ?? []) as {
    class_group_id: string;
    waiting_count: number;
  }[]) {
    waitingCountByGroup.set(item.class_group_id, item.waiting_count);
  }

  const enrollmentCounts = new Map<string, number>();

  for (const enrollment of enrollments) {
    if (!enrollment.class_group_id) {
      continue;
    }

    enrollmentCounts.set(
      enrollment.class_group_id,
      (enrollmentCounts.get(enrollment.class_group_id) ?? 0) + 1,
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
            className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-4 py-3 text-sm font-semibold text-on-primary"
          >
            + Seans ekle
          </Link>
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

      {messages.warning && (
        <div className="mb-5 rounded-2xl border border-accent/40 bg-accent-soft p-4 text-sm text-accent-strong">
          {messages.warning}
        </div>
      )}

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-16 text-center shadow-sm">
          <h2 className="text-lg font-bold">Henüz ders seansı yok</h2>

          <p className="mt-2 text-sm text-text-secondary">
            Haftalık ders günlerini ve saatlerini oluşturarak programı başlatın.
          </p>

          <Link
            href="/program/yeni"
            className="mt-6 inline-block rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
          >
            İlk seansı oluştur
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {groups.map((group) => {
            const studentCount = enrollmentCounts.get(group.id) ?? 0;

            const waitingCount = waitingCountByGroup.get(group.id) ?? 0;

            return (
              <article
                key={group.id}
                className={`rounded-2xl border bg-surface p-5 shadow-sm ${
                  group.is_active ? "border-border" : "border-border opacity-60"
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

                    <p className="mt-1 text-sm text-text-secondary">
                      {group.course?.name ?? "Ders bulunamadı"}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      group.is_active
                        ? "bg-success-soft text-success"
                        : "bg-surface-muted text-text-secondary"
                    }`}
                  >
                    {group.is_active ? "Aktif" : "Pasif"}
                  </span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-text-secondary">Gün ve saat</dt>

                    <dd className="mt-1 font-semibold">
                      {weekdayLabels[group.weekday]} {group.start_time.slice(0, 5)}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-text-secondary">Süre</dt>

                    <dd className="mt-1 font-semibold">{group.duration_minutes} dakika</dd>
                  </div>

                  <div>
                    <dt className="text-text-secondary">Öğretmen</dt>

                    <dd className="mt-1 font-semibold">{group.teacher?.full_name ?? "Atanmadı"}</dd>
                  </div>

                  <div>
                    <dt className="text-text-secondary">Derslik</dt>

                    <dd className="mt-1 font-semibold">{group.room_name ?? "Belirtilmedi"}</dd>
                  </div>

                  <div>
                    <dt className="text-text-secondary">Kontenjan</dt>

                    <dd className="mt-1 font-semibold">
                      {studentCount}/{group.capacity}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-text-secondary">Ders türü</dt>

                    <dd className="mt-1 font-semibold">
                      {group.course?.course_type === "individual" ? "Birebir" : "Grup"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 flex flex-wrap gap-2 border-t border-primary-soft pt-4">
                  <Link
                    href={`/program/${group.id}`}
                    className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-primary"
                  >
                    Düzenle
                  </Link>

                  {waitingCount > 0 && (
                    <Link
                      href={`/bekleme-listesi?classGroupId=${group.id}`}
                      className="rounded-lg border border-accent/40 bg-accent-soft px-3 py-2 text-xs font-semibold text-accent-strong border-accent/40 bg-accent-soft"
                    >
                      Bekleme listesi: {waitingCount}
                    </Link>
                  )}

                  <form action={setClassGroupActive}>
                    <input type="hidden" name="groupId" value={group.id} />

                    <input
                      type="hidden"
                      name="isActive"
                      value={group.is_active ? "false" : "true"}
                    />

                    <button
                      type="submit"
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
                        group.is_active
                          ? "border-danger/30 bg-danger-soft text-danger"
                          : "border-success/30 bg-success-soft text-success"
                      }`}
                    >
                      {group.is_active ? "Pasife al" : "Aktifleştir"}
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
