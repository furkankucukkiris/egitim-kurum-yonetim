import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { TodaySessionsList } from "@/components/dashboard/TodaySessionsList";
import { courses, dashboardStats, recentPayments, todaySessions } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";
import { requireProfile } from "@/lib/auth";

const paymentStatusTone: Record<string, BadgeTone> = {
  Ödendi: "success",
  Kısmi: "warning",
};

export default async function DashboardPage() {
  const profile = await requireProfile();

  if (profile.role === "teacher") {
    redirect("/ogretmen-paneli");
  }

  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description="Öğrenci, tahsilat, kasa ve ders performansının güncel özeti. Şimdilik örnek veriler gösterilmektedir."
        action={<Button variant="primary">+ Yeni öğrenci</Button>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((item, index) => (
          <StatCard key={item.label} label={item.label} value={item.value} detail={item.change} icon={["◎", "₺", "!", "↗"][index]} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-brand-100 px-5 py-4">
            <h3 className="font-semibold text-brand-900">Son ödemeler</h3>
            <p className="mt-1 text-sm text-gray-500">Tahsilatların son hareketleri</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-brand-50 text-xs uppercase tracking-wide text-gray-500">
                <tr><th className="px-5 py-3">Öğrenci</th><th className="px-5 py-3">Ders</th><th className="px-5 py-3">Yöntem</th><th className="px-5 py-3">Tutar</th><th className="px-5 py-3">Durum</th></tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {recentPayments.map((payment) => (
                  <tr key={payment.student} className="hover:bg-brand-50/50">
                    <td className="px-5 py-4 font-medium text-brand-900">{payment.student}</td>
                    <td className="px-5 py-4 text-gray-600">{payment.course}</td>
                    <td className="px-5 py-4 text-gray-600">{payment.method}</td>
                    <td className="px-5 py-4 font-semibold text-brand-900">{formatTry(payment.amount)}</td>
                    <td className="px-5 py-4"><StatusBadge label={payment.status} tone={paymentStatusTone[payment.status] ?? "neutral"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-brand-900">Ders performansı</h3>
          <p className="mt-1 text-sm text-gray-500">Aktif öğrenci ve aylık tahsilat</p>
          <div className="mt-5 space-y-5">
            {courses.map((course) => (
              <div key={course.name}>
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <div><span className="font-semibold text-brand-900">{course.name}</span><span className="ml-2 text-gray-500">{course.students} öğrenci</span></div>
                  <span className="font-semibold text-brand-900">{formatTry(course.revenue)}</span>
                </div>
                <div className="h-2 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-terra-500" style={{ width: `${Math.min(100, course.students * 2.4)}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="mt-6">
        <h3 className="mb-3 font-semibold text-brand-900">Bugünün ders akışı</h3>
        <TodaySessionsList sessions={todaySessions.map((session) => ({ ...session }))} />
      </section>
    </>
  );
}
