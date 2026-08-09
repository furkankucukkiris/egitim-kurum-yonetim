import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import {
  PendingPaymentsByCourse,
} from "@/components/payments/PendingPaymentsByCourse";
import type {
  CoursePaymentGroup,
  StudentPaymentStatus,
} from "@/components/payments/CoursePaymentCard";
import { generateMonthlyAccruals } from "./actions";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";

type AccrualStatus =
  | "open"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled"
  | "refunded";

type AccrualRow = {
  id: string;
  net_amount: number;
  allocated_amount: number;
  status: AccrualStatus;
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

type PaymentsPageProps = {
  searchParams: Promise<{
    month?: string;
    success?: string;
    error?: string;
  }>;
};

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const profile = await requireRole(["admin"]);

  const params = await searchParams;

  const currentMonth = getCurrentMonthInIstanbul();
  const selectedMonth = isMonthValue(params.month) ? params.month! : currentMonth;
  const monthEnd = getMonthEnd(selectedMonth);
  const previousMonth = addMonths(selectedMonth, -1);
  const nextMonth = addMonths(selectedMonth, 1);

  const supabase = await createClient();

  const [accrualsResult, enrollmentsResult, paymentsResult] = await Promise.all([
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
      .not("status", "in", "(cancelled,refunded)")
      .lte("period_start", monthEnd),
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
      .order("received_at", { ascending: false })
      .limit(10),
  ]);

  if (accrualsResult.error) {
    console.error("Tahakkuk kayıtları alınamadı:", accrualsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Kayıt bilgileri alınamadı:", enrollmentsResult.error);
  }

  if (paymentsResult.error) {
    console.error("Ödeme kayıtları alınamadı:", paymentsResult.error);
  }

  const accruals = (accrualsResult.data ?? []) as unknown as AccrualRow[];
  const enrollments = (enrollmentsResult.data ?? []) as unknown as EnrollmentRow[];
  const payments = (paymentsResult.data ?? []) as unknown as PaymentRow[];

  const otherCoursesByStudent = new Map<string, Set<string>>();

  for (const enrollment of enrollments) {
    if (!enrollment.course) {
      continue;
    }

    const set = otherCoursesByStudent.get(enrollment.student_id) ?? new Set<string>();
    set.add(enrollment.course.name);
    otherCoursesByStudent.set(enrollment.student_id, set);
  }

  const today = getTodayInIstanbul();

  type CourseAccumulator = {
    courseId: string;
    courseName: string;
    totals: { pending: number; received: number; total: number };
    studentAccruals: Map<
      string,
      {
        studentName: string;
        netSum: number;
        allocatedSum: number;
        pendingDescriptions: { label: string; overdue: boolean }[];
      }
    >;
  };

  const courseMap = new Map<string, CourseAccumulator>();

  for (const accrual of accruals) {
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
      pendingDescriptions: [],
    };

    entry.netSum += netAmount;
    entry.allocatedSum += allocatedAmount;

    if (pendingAmount > 0.01) {
      entry.pendingDescriptions.push({
        label: `${formatMonthYear(accrual.period_start)} (${accrual.description})`,
        overdue: accrual.due_date < today,
      });
    }

    course.studentAccruals.set(studentId, entry);
  }

  const groups: CoursePaymentGroup[] = Array.from(courseMap.values())
    .map((course) => {
      const rows = Array.from(course.studentAccruals.entries())
        .map(([studentId, entry]) => {
          const pending = Math.max(0, entry.netSum - entry.allocatedSum);

          const status: StudentPaymentStatus =
            pending <= 0.01
              ? "paid"
              : entry.allocatedSum > 0
                ? "partial"
                : "pending";

          const otherCourses = Array.from(
            otherCoursesByStudent.get(studentId) ?? [],
          ).filter((name) => name !== course.courseName);

          const note = entry.pendingDescriptions
            .map((item) => (item.overdue ? `${item.label} — gecikmiş` : item.label))
            .join(" · ");

          return {
            studentId,
            studentName: entry.studentName,
            status,
            amount: status === "paid" ? entry.netSum : pending,
            otherCourses,
            note,
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

  const grandTotals = groups.reduce(
    (acc, group) => ({
      total: acc.total + group.totals.total,
      received: acc.received + group.totals.received,
      pending: acc.pending + group.totals.pending,
    }),
    { total: 0, received: 0, pending: 0 },
  );

  const pendingStudentCount = new Set(
    groups.flatMap((group) =>
      group.rows.filter((row) => row.status !== "paid").map((row) => row.studentId),
    ),
  ).size;

  const collectionRate =
    grandTotals.total > 0
      ? Math.round((grandTotals.received / grandTotals.total) * 100)
      : 0;

  return (
    <>
      <PageHeader
        title="Ödemeler"
        description="Tahakkuk, tahsilat ve ders bazlı ödeme durumu — ay bazında takip edilir."
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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Toplam tahakkuk"
          value={formatTry(grandTotals.total)}
          detail={`${groups.length} ders`}
        />

        <StatCard
          label="Tahsil edilen"
          value={formatTry(grandTotals.received)}
          detail={`%${collectionRate} tahsilat oranı`}
        />

        <StatCard
          label="Bekleyen alacak"
          value={formatTry(grandTotals.pending)}
          detail={`${pendingStudentCount} öğrenci`}
        />

        <StatCard
          label="Son ödemeler"
          value={String(payments.length)}
          detail="Son 10 hareket"
        />
      </div>

      <h3 className="mb-3 mt-6 font-semibold text-ink">
        Ders bazlı ödeme durumu
      </h3>

      <PendingPaymentsByCourse groups={groups} month={selectedMonth} />

      <h3 className="mb-3 mt-8 font-semibold text-ink">
        Son tahsilat hareketleri
      </h3>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {payments.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Henüz kayıtlı bir tahsilat yok.
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
                  <tr key={payment.id}>
                    <td className="px-5 py-4 font-semibold text-ink">
                      {payment.student
                        ? `${payment.student.first_name} ${payment.student.last_name}`
                        : "Bilinmiyor"}
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

function getMonthEnd(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

function addMonths(monthKey: string, amount: number) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}
