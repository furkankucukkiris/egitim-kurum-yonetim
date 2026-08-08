import { PageHeader } from "@/components/page-header";
import { courses } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";
import { requireRole } from "@/lib/auth";
export default async function ReportsPage() {
  await requireRole(["admin", "finance", "viewer"]);
  return (
    <>
      <PageHeader title="Aylık Raporlar" description="Ders bazlı öğrenci artışı, tahsilat ve yönetimsel gelir görünümü." action={<button className="rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold">Raporu dışa aktar</button>} />
      <div className="mb-5 flex flex-wrap gap-2"><select className="rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm"><option>Temmuz 2026</option><option>Haziran 2026</option></select><select className="rounded-xl border border-brand-100 bg-white px-4 py-3 text-sm"><option>Tüm dersler</option><option>Piyano</option><option>Resim</option></select></div>
      <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-brand-50 text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Ders</th><th className="px-5 py-3">Öğrenci</th><th className="px-5 py-3">Aylık gelir</th><th className="px-5 py-3">Değişim</th><th className="px-5 py-3">Doluluk</th></tr></thead><tbody className="divide-y divide-brand-50">{courses.map((course)=><tr key={course.name}><td className="px-5 py-4 font-semibold">{course.name}</td><td className="px-5 py-4">{course.students}</td><td className="px-5 py-4 font-semibold">{formatTry(course.revenue)}</td><td className="px-5 py-4"><span className={course.growth >= 0 ? "text-emerald-700" : "text-rose-700"}>{course.growth > 0 ? `+${course.growth}` : course.growth}</span></td><td className="px-5 py-4"><div className="h-2 w-32 rounded-full bg-brand-50"><div className="h-2 rounded-full bg-terra-500" style={{width:`${Math.min(100, course.students*2.5)}%`}}/></div></td></tr>)}</tbody></table></div></div>
    </>
  );
}
