import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { courses, dashboardStats, recentPayments } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Genel Bakış"
        description="Öğrenci, tahsilat, kasa ve ders performansının güncel özeti. Şimdilik örnek veriler gösterilmektedir."
        action={<button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">+ Yeni öğrenci</button>}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboardStats.map((item, index) => (
          <StatCard key={item.label} label={item.label} value={item.value} detail={item.change} icon={["◎", "₺", "!", "↗"][index]} />
        ))}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h3 className="font-semibold">Son ödemeler</h3>
            <p className="mt-1 text-sm text-slate-500">Tahsilatların son hareketleri</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3">Öğrenci</th><th className="px-5 py-3">Ders</th><th className="px-5 py-3">Yöntem</th><th className="px-5 py-3">Tutar</th><th className="px-5 py-3">Durum</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentPayments.map((payment) => (
                  <tr key={payment.student} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-medium">{payment.student}</td>
                    <td className="px-5 py-4 text-slate-600">{payment.course}</td>
                    <td className="px-5 py-4 text-slate-600">{payment.method}</td>
                    <td className="px-5 py-4 font-semibold">{formatTry(payment.amount)}</td>
                    <td className="px-5 py-4"><span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">{payment.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="font-semibold">Ders performansı</h3>
          <p className="mt-1 text-sm text-slate-500">Aktif öğrenci ve aylık tahsilat</p>
          <div className="mt-5 space-y-5">
            {courses.map((course) => (
              <div key={course.name}>
                <div className="mb-2 flex items-center justify-between gap-4 text-sm">
                  <div><span className="font-semibold">{course.name}</span><span className="ml-2 text-slate-500">{course.students} öğrenci</span></div>
                  <span className="font-semibold">{formatTry(course.revenue)}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-900" style={{ width: `${Math.min(100, course.students * 2.4)}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
