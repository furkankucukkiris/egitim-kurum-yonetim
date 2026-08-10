import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  PendingPaymentsByCourse,
} from "@/components/payments/PendingPaymentsByCourse";
import { StudentBalanceTable } from "@/components/payments/StudentBalanceTable";
import type {
  StudentBalanceRow,
  CourseOption,
} from "@/components/payments/StudentBalanceTable";
import type {
  CoursePaymentGroup,
  StudentPaymentStatus,
  OpenAccrualItem,
} from "@/components/payments/CoursePaymentCard";
import { generateMonthlyAccruals } from "./actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";

// Bu sayfadaki tüm tahakkuk/tahsilat/nakit rakamları
// get_dashboard_financial_summary() RPC'sinden gelir — Genel Bakış
// (/) ekranıyla AYNI kaynak, iki ekran asla birbirinden farklı sayı
// göstermez (supabase/migrations/20260811110000_add_dashboard_financial_summary.sql).
type FinancialSummaryRow = {
  monthly_accrued: number | string;
  monthly_collected: number | string;
  monthly_cash_received: number | string;
  prior_period_carryover: number | string;
  prior_period_carryover_count: number;
  total_open_receivable: number | string;
  total_open_receivable_count: number;
};

type MonthAccrualRow = {
  id: string;
  net_amount: number;
  allocated_amount: number;
  status: string;
  description: string;
  due_date: string;
  period_start: string;
  enrollment: {
    student_id: string;
    course_id: string;
    student: { first_name: string; last_name: string } | null;
    course: { id: string; name: string } | null;
  } | null;
};

// Bu ayla sınırlı olmayan, hâlâ açık (open/partial/overdue) tüm
// dönemler — ödeme önizlemesi record_payment_for_course()'un gerçek
// dağıtım sırasıyla (en eski dönemden başlayarak) birebir eşleşsin
// diye yalnızca bu ayı değil öğrencinin o dersteki TÜM açık
// bakiyesini bilmesi gerekiyor.
type OpenAccrualRow = {
  id: string;
  net_amount: number;
  allocated_amount: number;
  due_date: string;
  period_start: string;
  student_id: string;
  enrollment: { course_id: string } | null;
};

type EnrollmentRow = {
  student_id: string;
  course: { name: string } | null;
};

type PaymentRow = {
  id: string;
  amount: number;
  method: string;
  received_at: string;
  note: string | null;
  student: { first_name: string; last_name: string } | null;
};

const methodLabels: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale",
  card: "Kart",
  online: "Online",
  other: "Diğer",
};

const PAGE_SIZE = 20;

type PaymentsPageProps = {
  searchParams: Promise<{
    month?: string;
    success?: string;
    error?: string;
    search?: string;
    course?: string;
    status?: string;
    page?: string;
  }>;
};

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const profile = await requireRole(["admin"]);

  const params = await searchParams;

  const currentMonth = getCurrentMonthInIstanbul();
  const selectedMonth = isMonthValue(params.month) ? params.month! : currentMonth;
  const monthStart = `${selectedMonth}-01`;
  const nextMonthStart = addMonths(selectedMonth, 1) + "-01";
  const previousMonth = addMonths(selectedMonth, -1);
  const nextMonth = addMonths(selectedMonth, 1);

  const balanceSearch = (params.search ?? "").trim();
  const balanceCourse = params.course ?? "";
  const balanceStatus = params.status ?? "";
  const balancePage = Math.max(1, Number(params.page ?? "1") || 1);

  const supabase = await createClient();

  const [
    summaryResult,
    monthAccrualsResult,
    openAccrualsResult,
    enrollmentsResult,
    paymentsResult,
    coursesResult,
    balancesResult,
  ] = await Promise.all([
    supabase.rpc("get_dashboard_financial_summary", {
      p_month_start: monthStart,
    }),
    supabase
      .from("accruals")
      .select(`
        id,
        net_amount,
        allocated_amount,
        status,
        description,
        due_date,
        period_start,
        enrollment:enrollments!inner (
          student_id,
          course_id,
          student:students!inner ( first_name, last_name ),
          course:courses!inner ( id, name )
        )
      `)
      .eq("organization_id", profile.organizationId)
      .eq("period_start", monthStart)
      .not("status", "in", "(cancelled,refunded)"),
    supabase
      .from("accruals")
      .select(`
        id, net_amount, allocated_amount, due_date, period_start,
        student_id,
        enrollment:enrollments!inner ( course_id )
      `)
      .eq("organization_id", profile.organizationId)
      .in("status", ["open", "partial", "overdue"])
      .order("period_start", { ascending: true }),
    supabase
      .from("enrollments")
      .select(`student_id, course:courses ( name )`)
      .eq("organization_id", profile.organizationId)
      .eq("status", "active"),
    supabase
      .from("payments")
      .select(`
        id, amount, method, received_at, note,
        student:students ( first_name, last_name )
      `)
      .eq("organization_id", profile.organizationId)
      .eq("is_refunded", false)
      .gte("received_at", `${monthStart}T00:00:00+03:00`)
      .lt("received_at", `${nextMonthStart}T00:00:00+03:00`)
      .order("received_at", { ascending: false }),
    supabase
      .from("courses")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .order("name"),
    supabase.rpc("get_student_balances", {
      p_search: balanceSearch || null,
      p_course_id: balanceCourse || null,
      p_status: balanceStatus || null,
      p_limit: PAGE_SIZE,
      p_offset: (balancePage - 1) * PAGE_SIZE,
    }),
  ]);

  if (summaryResult.error) {
    console.error("Finans özeti alınamadı:", summaryResult.error);
  }

  if (monthAccrualsResult.error) {
    console.error("Bu ayın tahakkukları alınamadı:", monthAccrualsResult.error);
  }

  if (openAccrualsResult.error) {
    console.error("Açık tahakkuklar alınamadı:", openAccrualsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Kayıt bilgileri alınamadı:", enrollmentsResult.error);
  }

  if (paymentsResult.error) {
    console.error("Ödeme kayıtları alınamadı:", paymentsResult.error);
  }

  if (coursesResult.error) {
    console.error("Ders listesi alınamadı:", coursesResult.error);
  }

  if (balancesResult.error) {
    console.error("Öğrenci bakiyeleri alınamadı:", balancesResult.error);
  }

  const summaryRow = ((summaryResult.data ?? []) as unknown as FinancialSummaryRow[])[0];

  const summary = summaryRow
    ? {
        monthlyAccrued: Number(summaryRow.monthly_accrued),
        monthlyCollected: Number(summaryRow.monthly_collected),
        monthlyCashReceived: Number(summaryRow.monthly_cash_received),
        priorPeriodCarryover: Number(summaryRow.prior_period_carryover),
        priorPeriodCarryoverCount: summaryRow.prior_period_carryover_count,
        totalOpenReceivable: Number(summaryRow.total_open_receivable),
        totalOpenReceivableCount: summaryRow.total_open_receivable_count,
      }
    : null;

  const summaryFailed = Boolean(summaryResult.error) || !summary;

  const monthAccruals = (monthAccrualsResult.data ?? []) as unknown as MonthAccrualRow[];
  const openAccruals = (openAccrualsResult.data ?? []) as unknown as OpenAccrualRow[];
  const enrollments = (enrollmentsResult.data ?? []) as unknown as EnrollmentRow[];
  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[];
  const courseOptions = (coursesResult.data ?? []) as unknown as CourseOption[];
  const balanceRows = (balancesResult.data ?? []) as unknown as StudentBalanceRow[];
  const balanceTotalCount = balanceRows[0]?.total_count ?? 0;

  const otherCoursesByStudent = new Map<string, Set<string>>();

  for (const enrollment of enrollments) {
    if (!enrollment.course) {
      continue;
    }

    const set = otherCoursesByStudent.get(enrollment.student_id) ?? new Set<string>();
    set.add(enrollment.course.name);
    otherCoursesByStudent.set(enrollment.student_id, set);
  }

  // studentId:courseId -> bu derste hâlâ açık olan TÜM dönemler
  // (yalnızca bu ay değil), en eski dönemden başlayarak sıralı.
  // Ödeme önizlemesi bunu kullanır çünkü record_payment_for_course()
  // ödemeyi tam olarak bu sırayla dağıtır.
  const openAccrualsByStudentCourse = new Map<string, OpenAccrualItem[]>();

  for (const accrual of openAccruals) {
    const courseId = accrual.enrollment?.course_id;

    if (!courseId) {
      continue;
    }

    const key = `${accrual.student_id}:${courseId}`;
    const list = openAccrualsByStudentCourse.get(key) ?? [];

    list.push({
      accrualId: accrual.id,
      periodLabel: formatMonthYear(accrual.period_start),
      pending: Math.max(0, Number(accrual.net_amount) - Number(accrual.allocated_amount)),
      overdue: accrual.due_date < getTodayInIstanbul(),
    });

    openAccrualsByStudentCourse.set(key, list);
  }

  type CourseAccumulator = {
    courseId: string;
    courseName: string;
    totals: { pending: number; received: number; total: number };
    studentAccruals: Map<
      string,
      { studentName: string; netSum: number; allocatedSum: number }
    >;
  };

  const courseMap = new Map<string, CourseAccumulator>();

  for (const accrual of monthAccruals) {
    const enrollment = accrual.enrollment;

    if (!enrollment?.course || !enrollment.student) {
      continue;
    }

    const courseId = enrollment.course.id;

    let course = courseMap.get(courseId);

    if (!course) {
      course = {
        courseId,
        courseName: enrollment.course.name,
        totals: { pending: 0, received: 0, total: 0 },
        studentAccruals: new Map(),
      };
      courseMap.set(courseId, course);
    }

    const netAmount = Number(accrual.net_amount);
    const allocatedAmount = Number(accrual.allocated_amount);
    const pendingAmount = Math.max(0, netAmount - allocatedAmount);

    course.totals.total += netAmount;
    course.totals.received += allocatedAmount;
    course.totals.pending += pendingAmount;

    const studentId = enrollment.student_id;
    const studentName = `${enrollment.student.first_name} ${enrollment.student.last_name}`;

    const entry = course.studentAccruals.get(studentId) ?? {
      studentName,
      netSum: 0,
      allocatedSum: 0,
    };

    entry.netSum += netAmount;
    entry.allocatedSum += allocatedAmount;

    course.studentAccruals.set(studentId, entry);
  }

  const groups: CoursePaymentGroup[] = Array.from(courseMap.values())
    .map((course) => {
      const rows = Array.from(course.studentAccruals.entries())
        .map(([studentId, entry]) => {
          const pending = Math.max(0, entry.netSum - entry.allocatedSum);

          const status: StudentPaymentStatus =
            pending <= 0.01 ? "paid" : entry.allocatedSum > 0 ? "partial" : "pending";

          const otherCourses = Array.from(
            otherCoursesByStudent.get(studentId) ?? [],
          ).filter((name) => name !== course.courseName);

          const openForCourse =
            openAccrualsByStudentCourse.get(`${studentId}:${course.courseId}`) ?? [];

          const totalOpenAcrossPeriods = openForCourse.reduce(
            (sum, item) => sum + item.pending,
            0,
          );

          return {
            studentId,
            studentName: entry.studentName,
            status,
            monthNet: entry.netSum,
            monthAllocated: entry.allocatedSum,
            monthPending: pending,
            otherCourses,
            openAccruals: openForCourse,
            totalOpenAcrossPeriods,
          };
        })
        .sort((a, b) => a.studentName.localeCompare(b.studentName, "tr-TR"));

      return {
        courseId: course.courseId,
        courseName: course.courseName,
        rows,
        totals: course.totals,
      };
    })
    .sort((a, b) => a.courseName.localeCompare(b.courseName, "tr-TR"));

  // Ders kartı toplamlarının genel toplamla birebir eşleşmesi:
  // ikisi de AYNI monthAccruals veri kümesinden türetiliyor (RPC'nin
  // monthly_accrued/monthly_collected'ı ile aynı filtre — organization
  // + period_start = monthStart + status not in cancelled/refunded).
  const groupsTotal = groups.reduce(
    (acc, group) => ({
      total: acc.total + group.totals.total,
      received: acc.received + group.totals.received,
    }),
    { total: 0, received: 0 },
  );

  const balancePageCount = Math.max(1, Math.ceil(balanceTotalCount / PAGE_SIZE));

  const balanceFilterQuery = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({
      month: selectedMonth,
      ...(balanceSearch ? { search: balanceSearch } : {}),
      ...(balanceCourse ? { course: balanceCourse } : {}),
      ...(balanceStatus ? { status: balanceStatus } : {}),
      page: "1",
      ...overrides,
    });

    for (const [key, value] of Array.from(next.entries())) {
      if (!value) {
        next.delete(key);
      }
    }

    return `/odemeler?${next.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Ödemeler"
        description="Seçili ayın tahakkuku ve geçmiş dönem borcu ayrı gösterilir."
        action={
          <a
            href={`/odemeler/export?month=${selectedMonth}`}
            className="rounded-xl border border-line bg-panel px-4 py-3 text-sm font-semibold text-brand-700 shadow-sm transition hover:bg-fill dark:text-brand-100"
          >
            CSV olarak dışa aktar
          </a>
        }
      />

      {params.success && (
        <div className="mb-5 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          {params.success}
        </div>
      )}

      {params.error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          {params.error}
        </div>
      )}

      {summaryFailed && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          Finans özeti alınamadı. Aşağıdaki rakamlar güncel olmayabilir.
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-line bg-panel p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
          <Link
            href={`/odemeler?month=${previousMonth}`}
            className="rounded-xl border border-line bg-panel px-4 py-3 text-center text-sm font-semibold text-ink transition hover:bg-fill"
          >
            ← Önceki ay
          </Link>

          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-muted">Görüntülenen ay</p>
            <h2 className="text-lg font-bold text-ink">{formatMonthYearFromKey(selectedMonth)}</h2>
          </div>

          <Link
            href={`/odemeler?month=${nextMonth}`}
            className="rounded-xl border border-line bg-panel px-4 py-3 text-center text-sm font-semibold text-ink transition hover:bg-fill"
          >
            Sonraki ay →
          </Link>
        </div>

        {selectedMonth !== currentMonth && (
          <Link
            href={`/odemeler?month=${currentMonth}`}
            className="mt-3 block rounded-xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 px-4 py-2.5 text-center text-sm font-semibold text-honey-700 dark:text-honey-500"
          >
            Bu aya dön
          </Link>
        )}

        <form
          action={generateMonthlyAccruals}
          className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4"
        >
          <input type="hidden" name="month" value={selectedMonth} />
          <p className="flex-1 text-sm text-muted">
            Aktif kayıtlı öğrenciler için {formatMonthYearFromKey(selectedMonth)} tahakkuklarını
            oluşturun. Zaten oluşturulmuş olanlar tekrar oluşturulmaz.
          </p>
          <button
            type="submit"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
          >
            Bu ayın tahakkuklarını oluştur
          </button>
        </form>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="Seçili Ay Tahakkuku"
          value={summary ? formatTry(summary.monthlyAccrued) : "—"}
          detail={`${groups.length} ders`}
        />

        <StatCard
          label="Seçili Ay Tahsil Edilen"
          value={summary ? formatTry(summary.monthlyCollected) : "—"}
          detail={
            summary && summary.monthlyAccrued > 0
              ? `%${Math.round((summary.monthlyCollected / summary.monthlyAccrued) * 100)} tahsilat oranı`
              : "Veri yok"
          }
        />

        <StatCard
          label="Bu Ay Alınan Gerçek Ödeme"
          value={summary ? formatTry(summary.monthlyCashReceived) : "—"}
          detail="Ödeme tarihi bu ay olan tüm tahsilat"
        />

        <StatCard
          label="Önceki Dönem Borcu"
          value={summary ? formatTry(summary.priorPeriodCarryover) : "—"}
          detail={
            summary ? `${summary.priorPeriodCarryoverCount} bekleyen dönem` : "Veri yok"
          }
        />

        <StatCard
          label="Toplam Açık Alacak"
          value={summary ? formatTry(summary.totalOpenReceivable) : "—"}
          detail={
            summary
              ? `${summary.totalOpenReceivableCount} bekleyen dönem (devreden dahil)`
              : "Veri yok"
          }
        />

        <StatCard
          label="Bu Ayki Tahsilat Hareketi"
          value={String(payments.length)}
          detail="Ödeme tarihi bu ay olan işlem"
        />
      </div>

      <h3 className="mb-3 mt-6 font-semibold text-ink">
        Ders bazlı gelir ve tahsilat oranı — {formatMonthYearFromKey(selectedMonth)}
      </h3>

      <PendingPaymentsByCourse groups={groups} month={selectedMonth} />

      {groups.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Ders kartları toplamı: {formatTry(groupsTotal.total)} tahakkuk,{" "}
          {formatTry(groupsTotal.received)} tahsil edildi — üstteki &ldquo;Seçili Ay Tahakkuku&rdquo;/
          &ldquo;Seçili Ay Tahsil Edilen&rdquo; ile aynı kaynaktan (bu ayın tahakkukları), birebir eşleşir.
        </p>
      )}

      <h3 className="mb-3 mt-8 font-semibold text-ink">Öğrenci bazlı bakiye</h3>

      <StudentBalanceTable
        rows={balanceRows}
        courseOptions={courseOptions}
        month={selectedMonth}
        search={balanceSearch}
        courseFilter={balanceCourse}
        statusFilter={balanceStatus}
        page={balancePage}
        pageSize={PAGE_SIZE}
        pageCount={balancePageCount}
        totalCount={balanceTotalCount}
        buildQuery={balanceFilterQuery}
      />

      <h3 className="mb-3 mt-8 font-semibold text-ink">
        Bu ayki tahsilat hareketleri
      </h3>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {payments.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {formatMonthYearFromKey(selectedMonth)} içinde kayıtlı bir tahsilat yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="bg-fill text-xs uppercase text-muted">
                <tr>
                  <th className="px-5 py-3">Öğrenci</th>
                  <th className="px-5 py-3">Tarih</th>
                  <th className="px-5 py-3">Yöntem</th>
                  <th className="px-5 py-3">Tutar</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {payments.map((payment) => (
                  <tr key={payment.id} className="hover:bg-fill">
                    <td className="px-5 py-4 font-semibold text-ink">
                      <Link
                        href={`/odemeler/${payment.id}`}
                        className="hover:underline"
                      >
                        {payment.student
                          ? `${payment.student.first_name} ${payment.student.last_name}`
                          : "Bilinmiyor"}
                      </Link>
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {formatDate(payment.received_at)}
                    </td>
                    <td className="px-5 py-4 text-muted">
                      {methodLabels[payment.method] ?? payment.method}
                    </td>
                    <td className="px-5 py-4 font-semibold text-ink">
                      {formatTry(payment.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function formatMonthYear(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatMonthYearFromKey(monthKey: string) {
  return formatMonthYear(`${monthKey}-01`);
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

function getCurrentMonthInIstanbul() {
  return getTodayInIstanbul().slice(0, 7);
}

function isMonthValue(value: string | undefined): value is string {
  return !!value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function addMonths(monthKey: string, amount: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
