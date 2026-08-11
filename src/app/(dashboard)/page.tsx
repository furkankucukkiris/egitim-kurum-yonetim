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

// get_dashboard_financial_summary()/get_dashboard_course_performance()
// (supabase/migrations/20260811110000_add_dashboard_financial_summary.sql)
// tüm tahakkuk/tahsilat hesaplarını merkezi olarak yapar — bu sayfa
// yalnızca sonucu biçimlendirir, kendi başına toplama/gruplama
// mantığı içermez.
type FinancialSummaryRow = {
  active_student_count: number;
  monthly_accrued: number | string;
  monthly_collected: number | string;
  monthly_cash_received: number | string;
  prior_period_carryover: number | string;
  prior_period_carryover_count: number;
  total_open_receivable: number | string;
  total_open_receivable_count: number;
  student_advance_balance: number | string;
  today_active_session_count: number;
  today_total_session_count: number;
};

type CoursePerformanceRow = {
  course_id: string;
  course_name: string;
  active_student_count: number;
  month_net: number | string;
  month_collected: number | string;
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
  is_trial: boolean;
  cancelled_at: string | null;
  course: { name: string } | null;
  teacher: { full_name: string } | null;
};

type ProspectFollowUpRow = {
  id: string;
  student_first_name: string;
  student_last_name: string;
  phone: string;
  next_follow_up_date: string;
  assigned: { full_name: string } | null;
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

  const nextWeek = addDays(today, 7);

  const [
    summaryResult,
    coursePerformanceResult,
    paymentsResult,
    sessionsResult,
    followUpTodayResult,
    followUpUpcomingResult,
    waitlistOpportunitiesResult,
  ] = await Promise.all([
    supabase.rpc("get_dashboard_financial_summary", {
      p_month_start: monthStart,
    }),
    supabase.rpc("get_dashboard_course_performance", {
      p_month_start: monthStart,
    }),
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
        starts_at, ends_at, room_name, is_makeup, is_trial, cancelled_at,
        course:courses ( name ),
        teacher:profiles!teacher_profile_id ( full_name )
      `)
      .eq("organization_id", profile.organizationId)
      .gte("starts_at", `${today}T00:00:00+03:00`)
      .lt("starts_at", `${tomorrow}T00:00:00+03:00`)
      .order("starts_at", { ascending: true }),
    supabase
      .from("prospects")
      .select("id, student_first_name, student_last_name, phone, next_follow_up_date, assigned:assigned_profile_id(full_name)")
      .eq("organization_id", profile.organizationId)
      .eq("next_follow_up_date", today)
      .order("student_last_name", { ascending: true }),
    supabase
      .from("prospects")
      .select("id, student_first_name, student_last_name, phone, next_follow_up_date, assigned:assigned_profile_id(full_name)")
      .eq("organization_id", profile.organizationId)
      .gt("next_follow_up_date", today)
      .lte("next_follow_up_date", nextWeek)
      .order("next_follow_up_date", { ascending: true }),
    supabase.rpc("get_waitlist_opportunities"),
  ]);

  if (summaryResult.error) {
    console.error("Finans özeti alınamadı:", summaryResult.error);
  }

  if (coursePerformanceResult.error) {
    console.error("Ders performansı alınamadı:", coursePerformanceResult.error);
  }

  if (paymentsResult.error) {
    console.error("Son ödemeler alınamadı:", paymentsResult.error);
  }

  if (sessionsResult.error) {
    console.error("Bugünün ders akışı alınamadı:", sessionsResult.error);
  }

  if (followUpTodayResult.error) {
    console.error("Bugünkü takip listesi alınamadı:", followUpTodayResult.error);
  }

  if (followUpUpcomingResult.error) {
    console.error("Yaklaşan takip listesi alınamadı:", followUpUpcomingResult.error);
  }

  if (waitlistOpportunitiesResult.error) {
    console.error("Bekleme listesi fırsatları alınamadı:", waitlistOpportunitiesResult.error);
  }

  const summaryRow = ((summaryResult.data ?? []) as unknown as FinancialSummaryRow[])[0];

  const summary = summaryRow
    ? {
        activeStudentCount: summaryRow.active_student_count,
        monthlyAccrued: Number(summaryRow.monthly_accrued),
        monthlyCollected: Number(summaryRow.monthly_collected),
        monthlyCashReceived: Number(summaryRow.monthly_cash_received),
        priorPeriodCarryover: Number(summaryRow.prior_period_carryover),
        priorPeriodCarryoverCount: summaryRow.prior_period_carryover_count,
        totalOpenReceivable: Number(summaryRow.total_open_receivable),
        totalOpenReceivableCount: summaryRow.total_open_receivable_count,
        studentAdvanceBalance: Number(summaryRow.student_advance_balance),
        todayActiveSessionCount: summaryRow.today_active_session_count,
        todayTotalSessionCount: summaryRow.today_total_session_count,
      }
    : null;

  const summaryFailed = Boolean(summaryResult.error) || !summary;

  const overallCollectionRate =
    summary && summary.monthlyAccrued > 0
      ? Math.round((summary.monthlyCollected / summary.monthlyAccrued) * 100)
      : 0;

  const coursePerformance = (
    (coursePerformanceResult.data ?? []) as unknown as CoursePerformanceRow[]
  ).map((row) => {
    const monthNet = Number(row.month_net);
    const monthCollected = Number(row.month_collected);

    return {
      id: row.course_id,
      name: row.course_name,
      studentCount: row.active_student_count,
      monthNet,
      monthCollected,
      collectionRate: monthNet > 0 ? Math.round((monthCollected / monthNet) * 100) : 0,
    };
  });

  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[];
  const sessions = (sessionsResult.data ?? []) as unknown as SessionRow[];
  const followUpToday = (followUpTodayResult.data ?? []) as unknown as ProspectFollowUpRow[];
  const followUpUpcoming = (followUpUpcomingResult.data ?? []) as unknown as ProspectFollowUpRow[];
  const openWaitlistOpportunityCount = (
    (waitlistOpportunitiesResult.data ?? []) as unknown as { available_seats: number }[]
  ).filter((item) => item.available_seats > 0).length;

  const todaySessions = sessions.map((session) => ({
    time: formatTime(session.starts_at),
    course: session.course?.name ?? "Ders bilgisi yok",
    teacher: session.teacher?.full_name ?? "Atanmamış",
    room: session.room_name ?? "Belirtilmedi",
    status: session.cancelled_at
      ? "İptal"
      : session.is_trial
        ? "Deneme"
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

      {summaryFailed && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          Finans özeti alınamadı. Aşağıdaki finans göstergeleri
          güncel olmayabilir — sayfayı yenileyin, sorun devam
          ederse teknik ekiple paylaşın.
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aktif Öğrenci"
          value={summary ? String(summary.activeStudentCount) : "—"}
          detail="Şu an kayıtlı"
          icon="◎"
        />

        <StatCard
          label="Bu Ay Tahakkuk"
          value={summary ? formatTry(summary.monthlyAccrued) : "—"}
          detail={
            summary
              ? `${formatLongMonth(monthStart)} dönemi toplam borç`
              : "Veri alınamadı"
          }
          icon="₺"
        />

        <StatCard
          label="Bu Ay Tahsil Edilen"
          value={summary ? formatTry(summary.monthlyCollected) : "—"}
          detail={summary ? `%${overallCollectionRate} tahsilat oranı` : "Veri alınamadı"}
          icon="✓"
        />

        <StatCard
          label="Bu Ay Kasaya Giren"
          value={summary ? formatTry(summary.monthlyCashReceived) : "—"}
          detail="Ödeme tarihi bu ay olan tüm tahsilat"
          icon="↓"
        />

        <StatCard
          label="Devreden Borç"
          value={summary ? formatTry(summary.priorPeriodCarryover) : "—"}
          detail={
            summary
              ? `${summary.priorPeriodCarryoverCount} önceki dönem`
              : "Veri alınamadı"
          }
          icon="!"
        />

        <StatCard
          label="Toplam Açık Alacak"
          value={summary ? formatTry(summary.totalOpenReceivable) : "—"}
          detail={
            summary
              ? `${summary.totalOpenReceivableCount} bekleyen dönem`
              : "Veri alınamadı"
          }
          icon="Σ"
        />

        <StatCard
          label="Öğrenci Avans/Bakiye"
          value={summary ? formatTry(summary.studentAdvanceBalance) : "—"}
          detail="Tahakkuka henüz işlenmemiş ödeme"
          icon="+"
        />

        <StatCard
          label="Bugünkü Aktif Ders"
          value={summary ? String(summary.todayActiveSessionCount) : "—"}
          detail={
            summary && summary.todayTotalSessionCount > summary.todayActiveSessionCount
              ? `${summary.todayTotalSessionCount - summary.todayActiveSessionCount} iptal hariç`
              : "İptaller hariç"
          }
          icon="↗"
        />

        <StatCard
          label="Bugün Aranacak Aday"
          value={String(followUpToday.length)}
          detail="Sonraki takip tarihi bugün"
          icon="☆"
        />

        <StatCard
          label="Yaklaşan Takip"
          value={String(followUpUpcoming.length)}
          detail="Önümüzdeki 7 gün"
          icon="◔"
        />

        <StatCard
          label="Kapasitesi Açılan Grup"
          value={String(openWaitlistOpportunityCount)}
          detail="Bekleme listesi olan, boş yeri açılan gruplar"
          icon="◷"
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
                          {courseNames.length > 0
                            ? courseNames.join(", ")
                            : "Avans / dağıtılmamış"}
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

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold text-ink">Bugün aranacak aday öğrenciler</h3>
          <Link href="/aday-ogrenciler" className="text-sm text-terra-700 hover:underline dark:text-terra-500">
            Tümünü gör →
          </Link>
        </div>

        {followUpToday.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted">
            Bugün için takip edilmesi gereken aday öğrenci yok.
          </Card>
        ) : (
          <div className="space-y-2.5">
            {followUpToday.map((prospect) => (
              <Link key={prospect.id} href={`/aday-ogrenciler/${prospect.id}`}>
                <Card className="flex items-center justify-between gap-4 p-3.5 transition hover:bg-fill">
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {prospect.student_first_name} {prospect.student_last_name}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {prospect.phone} · {prospect.assigned?.full_name ?? "Atanmamış"}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        )}
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

function formatLongMonth(monthStartValue: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${monthStartValue}T12:00:00+03:00`));
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
