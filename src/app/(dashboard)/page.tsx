import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Card } from "@/components/ui/Card";
import { TodaySessionsList } from "@/components/dashboard/TodaySessionsList";
import { Calendar } from "@/components/dashboard/Calendar";
import { getHolidaysForYearRange } from "@/lib/holidays";
import { formatTry } from "@/lib/utils";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type AccrualRow = {
  net_amount: number;
  allocated_amount: number;
  period_start: string;
  enrollment: {
    course: { id: string; name: string } | null;
  } | null;
};

type EnrollmentCountRow = {
  course_id: string;
};

type PaymentRow = {
  id: string;
  amount: number;
  received_at: string;
  student: { first_name: string; last_name: string } | null;
  payment_allocations: {
    accrual: {
      enrollment: {
        course: { name: string } | null;
      } | null;
    } | null;
  }[];
};

type SessionRow = {
  starts_at: string;
  ends_at: string;
  room_name: string | null;
  is_makeup: boolean;
  cancelled_at: string | null;
  course: { name: string } | null;
  teacher: { full_name: string } | null;
};

export default async function DashboardPage() {
  const profile = await requireProfile();

  if (profile.role === "teacher") {
    redirect("/ogretmen-paneli");
  }

  if (profile.role !== "admin") {
    redirect("/yetkisiz");
  }

  const supabase = await createClient();

  const today = getTodayInIstanbul();
  const monthStart = `${today.slice(0, 7)}-01`;
  const tomorrow = addDays(today, 1);
  const currentYear = Number(today.slice(0, 4));
  const holidays = getHolidaysForYearRange(currentYear - 1, currentYear + 6);

  const [
    studentCountResult,
    accrualsResult,
    enrollmentsResult,
    paymentsResult,
    sessionsResult,
  ] = await Promise.all([
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organizationId)
      .eq("status", "active"),
    supabase
      .from("accruals")
      .select(`
        net_amount,
        allocated_amount,
        period_start,
        enrollment:enrollments!inner (
          course:courses!inner ( id, name )
        )
      `)
      .eq("organization_id", profile.organizationId)
      .not("status", "in", "(cancelled,refunded)")
      .lte("period_start", monthStart),
    supabase
      .from("enrollments")
      .select("course_id")
      .eq("organization_id", profile.organizationId)
      .eq("status", "active"),
    supabase
      .from("payments")
      .select(`
        id, amount, received_at,
        student:students ( first_name, last_name ),
        payment_allocations (
          accrual:accruals (
            enrollment:enrollments (
              course:courses ( name )
            )
          )
        )
      `)
      .eq("organization_id", profile.organizationId)
      .eq("is_refunded", false)
      .order("received_at", { ascending: false })
      .limit(5),
    supabase
      .from("lesson_sessions")
      .select(`
        starts_at, ends_at, room_name, is_makeup, cancelled_at,
        course:courses ( name ),
        teacher:profiles ( full_name )
      `)
      .eq("organization_id", profile.organizationId)
      .gte("starts_at", `${today}T00:00:00+03:00`)
      .lt("starts_at", `${tomorrow}T00:00:00+03:00`)
      .order("starts_at", { ascending: true }),
  ]);

  if (accrualsResult.error) {
    console.error("Tahakkuk özeti alınamadı:", accrualsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Kayıt özeti alınamadı:", enrollmentsResult.error);
  }

  if (paymentsResult.error) {
    console.error("Son ödemeler alınamadı:", paymentsResult.error);
  }

  if (sessionsResult.error) {
    console.error("Bugünün ders akışı alınamadı:", sessionsResult.error);
  }

  const activeStudentCount = studentCountResult.count ?? 0;
  const accruals = (accrualsResult.data ?? []) as unknown as AccrualRow[];
  const enrollmentCounts = (enrollmentsResult.data ?? []) as unknown as EnrollmentCountRow[];
  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[];
  const sessions = (sessionsResult.data ?? []) as unknown as SessionRow[];

  const activeStudentsByCourse = new Map<string, number>();

  for (const enrollment of enrollmentCounts) {
    activeStudentsByCourse.set(
      enrollment.course_id,
      (activeStudentsByCourse.get(enrollment.course_id) ?? 0) + 1,
    );
  }

  let monthlyAccrued = 0;
  let totalPending = 0;
  const pendingStudentPeriods = new Set<string>();

  type CoursePerformance = {
    id: string;
    name: string;
    monthNet: number;
    monthCollected: number;
  };

  const courseMap = new Map<string, CoursePerformance>();

  for (const accrual of accruals) {
    const course = accrual.enrollment?.course;

    if (!course) {
      continue;
    }

    const netAmount = Number(accrual.net_amount);
    const allocatedAmount = Number(accrual.allocated_amount);
    const pending = Math.max(0, netAmount - allocatedAmount);

    totalPending += pending;

    if (pending > 0.01) {
      pendingStudentPeriods.add(`${course.id}:${accrual.period_start}`);
    }

    const isThisMonth = accrual.period_start === monthStart;

    if (isThisMonth) {
      monthlyAccrued += netAmount;

      const entry = courseMap.get(course.id) ?? {
        id: course.id,
        name: course.name,
        monthNet: 0,
        monthCollected: 0,
      };

      entry.monthNet += netAmount;
      entry.monthCollected += allocatedAmount;
      courseMap.set(course.id, entry);
    }
  }

  const coursePerformance = Array.from(courseMap.values())
    .map((course) => ({
      ...course,
      studentCount: activeStudentsByCourse.get(course.id) ?? 0,
      collectionRate:
        course.monthNet > 0
          ? Math.round((course.monthCollected / course.monthNet) * 100)
          : 0,
    }))
    .sort((a, b) => b.monthNet - a.monthNet);

  const overallCollectionRate =
    monthlyAccrued > 0
      ? Math.round(
          (Array.from(courseMap.values()).reduce(
            (sum, course) => sum + course.monthCollected,
            0,
          ) /
            monthlyAccrued) *
            100,
        )
      : 0;

  const todaySessions = sessions.map((session) => ({
    time: formatTime(session.starts_at),
    course: session.course?.name ?? "Ders bilgisi yok",
    teacher: session.teacher?.full_name ?? "Atanmamış",
    room: session.room_name ?? "Belirtilmedi",
    status: session.cancelled_at
      ? "İptal"
      : session.is_makeup
        ? "Telafi"
        : "Planlandı",
  }));

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description="Öğrenci, tahsilat ve ders performansının güncel özeti."
        action={
          <Link
            href="/ogrenciler/yeni"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
          >
            + Yeni öğrenci
          </Link>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aktif Öğrenci"
          value={String(activeStudentCount)}
          detail="Şu an kayıtlı"
          icon="◎"
        />

        <StatCard
          label="Aylık Tahakkuk"
          value={formatTry(monthlyAccrued)}
          detail={`%${overallCollectionRate} tahsil edildi`}
          icon="₺"
        />

        <StatCard
          label="Bekleyen Ödeme"
          value={formatTry(totalPending)}
          detail={`${pendingStudentPeriods.size} bekleyen dönem`}
          icon="!"
        />

        <StatCard
          label="Bugünkü Ders"
          value={String(todaySessions.length)}
          detail={`${todaySessions.filter((s) => s.status === "Planlandı").length} planlı`}
          icon="↗"
        />
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-5 py-4">
            <h3 className="font-semibold text-ink">Son ödemeler</h3>
            <p className="mt-1 text-sm text-muted">Tahsilatların son hareketleri</p>
          </div>

          {payments.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              Henüz kayıtlı bir tahsilat yok.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-fill text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-5 py-3">Öğrenci</th>
                    <th className="px-5 py-3">Ders</th>
                    <th className="px-5 py-3">Tarih</th>
                    <th className="px-5 py-3">Tutar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {payments.map((payment) => {
                    const courseNames = Array.from(
                      new Set(
                        payment.payment_allocations
                          .map((item) => item.accrual?.enrollment?.course?.name)
                          .filter((name): name is string => Boolean(name)),
                      ),
                    );

                    return (
                      <tr key={payment.id} className="hover:bg-fill/50">
                        <td className="px-5 py-4 font-medium text-ink">
                          {payment.student
                            ? `${payment.student.first_name} ${payment.student.last_name}`
                            : "Bilinmiyor"}
                        </td>
                        <td className="px-5 py-4 text-muted">
                          {courseNames.length > 0 ? courseNames.join(", ") : "—"}
                        </td>
                        <td className="px-5 py-4 text-muted">
                          {formatDate(payment.received_at)}
                        </td>
                        <td className="px-5 py-4 font-semibold text-ink">
                          {formatTry(payment.amount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h3 className="font-semibold text-ink">Ders performansı</h3>
            <p className="mt-1 text-sm text-muted">Bu ayın tahakkuku ve tahsilat oranı</p>

            {coursePerformance.length === 0 ? (
              <p className="mt-5 text-sm text-muted">
                Bu ay için henüz tahakkuk oluşturulmadı.
              </p>
            ) : (
              <div className="mt-5 space-y-5">
                {coursePerformance.map((course) => (
                  <div key={course.id}>
                    <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                      <div>
                        <span className="font-semibold text-ink">{course.name}</span>
                        <span className="ml-2 text-muted">
                          {course.studentCount} öğrenci
                        </span>
                      </div>
                      <span className="font-semibold text-ink">
                        {formatTry(course.monthCollected)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-fill">
                      <div
                        className="h-2 rounded-full bg-terra-500"
                        style={{ width: `${Math.min(100, course.collectionRate)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Calendar
            todayKey={today}
            holidays={holidays}
            canNavigateToSchedule={profile.role === "admin"}
          />
        </div>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 font-semibold text-ink">Bugünün ders akışı</h3>
        <TodaySessionsList sessions={todaySessions} />
      </section>
    </>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
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

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
