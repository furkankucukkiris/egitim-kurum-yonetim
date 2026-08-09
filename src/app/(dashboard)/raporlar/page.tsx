import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { MonthlyRevenueChart, type MonthlyDatum } from "@/components/reports/MonthlyRevenueChart";
import { CourseDistributionPie } from "@/components/reports/CourseDistributionPie";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";

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

const monthFormatter = new Intl.DateTimeFormat("tr-TR", {
  timeZone: "Europe/Istanbul",
  month: "short",
  year: "2-digit",
});

export default async function ReportsPage() {
  const profile = await requireRole(["admin"]);

  const months = getLastMonths(6);
  const earliestMonth = months[0].key;

  const supabase = await createClient();

  const [accrualsResult, enrollmentsResult] = await Promise.all([
    supabase
      .from("accruals")
      .select(`
        net_amount, allocated_amount, period_start,
        enrollment:enrollments!inner (
          course:courses!inner ( id, name )
        )
      `)
      .eq("organization_id", profile.organizationId)
      .not("status", "in", "(cancelled,refunded)")
      .gte("period_start", `${earliestMonth}-01`),
    supabase
      .from("enrollments")
      .select("course_id")
      .eq("organization_id", profile.organizationId)
      .eq("status", "active"),
  ]);

  if (accrualsResult.error) {
    console.error("Rapor verisi alınamadı:", accrualsResult.error);
  }

  if (enrollmentsResult.error) {
    console.error("Kayıt özeti alınamadı:", enrollmentsResult.error);
  }

  const accruals = (accrualsResult.data ?? []) as unknown as AccrualRow[];
  const enrollments = (enrollmentsResult.data ?? []) as unknown as EnrollmentCountRow[];

  const activeStudentsByCourse = new Map<string, number>();

  for (const enrollment of enrollments) {
    activeStudentsByCourse.set(
      enrollment.course_id,
      (activeStudentsByCourse.get(enrollment.course_id) ?? 0) + 1,
    );
  }

  const monthlyTotals = new Map<string, { collected: number; pending: number }>();

  for (const month of months) {
    monthlyTotals.set(month.key, { collected: 0, pending: 0 });
  }

  type CourseTotals = {
    id: string;
    name: string;
    thisMonth: number;
    previousMonth: number;
    thisMonthCollected: number;
  };

  const courseMap = new Map<string, CourseTotals>();

  const currentMonthKey = months[months.length - 1].key;
  const previousMonthKey = months.length > 1 ? months[months.length - 2].key : null;

  for (const accrual of accruals) {
    const course = accrual.enrollment?.course;

    if (!course) {
      continue;
    }

    const monthKey = accrual.period_start.slice(0, 7);
    const netAmount = Number(accrual.net_amount);
    const allocatedAmount = Number(accrual.allocated_amount);
    const pendingAmount = Math.max(0, netAmount - allocatedAmount);

    const monthTotal = monthlyTotals.get(monthKey);

    if (monthTotal) {
      monthTotal.collected += allocatedAmount;
      monthTotal.pending += pendingAmount;
    }

    const courseTotals = courseMap.get(course.id) ?? {
      id: course.id,
      name: course.name,
      thisMonth: 0,
      previousMonth: 0,
      thisMonthCollected: 0,
    };

    if (monthKey === currentMonthKey) {
      courseTotals.thisMonth += netAmount;
      courseTotals.thisMonthCollected += allocatedAmount;
    } else if (previousMonthKey && monthKey === previousMonthKey) {
      courseTotals.previousMonth += netAmount;
    }

    courseMap.set(course.id, courseTotals);
  }

  const monthlyChartData: MonthlyDatum[] = months.map((month) => ({
    monthLabel: month.label,
    collected: monthlyTotals.get(month.key)?.collected ?? 0,
    pending: monthlyTotals.get(month.key)?.pending ?? 0,
  }));

  const courseRows = Array.from(courseMap.values())
    .filter((course) => course.thisMonth > 0 || course.previousMonth > 0)
    .map((course) => ({
      ...course,
      studentCount: activeStudentsByCourse.get(course.id) ?? 0,
      changePercent:
        course.previousMonth > 0
          ? Math.round(((course.thisMonth - course.previousMonth) / course.previousMonth) * 100)
          : course.thisMonth > 0
            ? 100
            : 0,
      collectionRate:
        course.thisMonth > 0
          ? Math.round((course.thisMonthCollected / course.thisMonth) * 100)
          : 0,
    }))
    .sort((a, b) => b.thisMonth - a.thisMonth);

  const distributionData = courseRows.map((course) => ({
    label: course.name,
    value: course.thisMonth,
  }));

  return (
    <>
      <PageHeader
        title="Raporlar"
        description="Aylık tahakkuk/tahsilat trendi ve ders bazlı gelir dağılımı."
      />

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <h3 className="font-semibold text-ink">Aylık tahakkuk / tahsilat</h3>
          <p className="mt-1 text-sm text-muted">Son 6 ay</p>
          <div className="mt-5">
            <MonthlyRevenueChart data={monthlyChartData} />
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-ink">Bu ayın ders dağılımı</h3>
          <p className="mt-1 text-sm text-muted">Tahakkuka göre pay</p>
          <div className="mt-5">
            <CourseDistributionPie data={distributionData} />
          </div>
        </Card>
      </div>

      <h3 className="mb-3 mt-6 font-semibold text-ink">Ders bazlı özet</h3>

      <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
        {courseRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            Bu ay için henüz tahakkuk kaydı yok.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead className="bg-fill text-xs uppercase text-muted">
                <tr>
                  <th className="px-5 py-3">Ders</th>
                  <th className="px-5 py-3">Aktif öğrenci</th>
                  <th className="px-5 py-3">Bu ay tahakkuk</th>
                  <th className="px-5 py-3">Değişim</th>
                  <th className="px-5 py-3">Tahsilat oranı</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {courseRows.map((course) => (
                  <tr key={course.id}>
                    <td className="px-5 py-4 font-semibold text-ink">{course.name}</td>
                    <td className="px-5 py-4 text-ink">{course.studentCount}</td>
                    <td className="px-5 py-4 font-semibold text-ink">
                      {formatTry(course.thisMonth)}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={
                          course.changePercent >= 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : "text-rose-700 dark:text-rose-400"
                        }
                      >
                        {course.changePercent > 0 ? `+${course.changePercent}` : course.changePercent}%
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="h-2 w-32 rounded-full bg-fill">
                        <div
                          className="h-2 rounded-full bg-terra-500"
                          style={{ width: `${Math.min(100, course.collectionRate)}%` }}
                        />
                      </div>
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

function getLastMonths(count: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const [year, month] = today.slice(0, 7).split("-").map(Number);

  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;

    return {
      key,
      label: monthFormatter.format(date),
    };
  });
}
