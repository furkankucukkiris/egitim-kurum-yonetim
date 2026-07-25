import { PageHeader } from "@/components/page-header";
import { students } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";

export default function StudentsPage() {
  return (
    <>
      <PageHeader title="Öğrenciler" description="Öğrenci, veli, ders kaydı ve kalan bakiye bilgileri." action={<button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">+ Öğrenci ekle</button>} />
      <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px]">
        <input className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400" placeholder="Öğrenci veya veli ara..." />
        <select className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm"><option>Tüm durumlar</option><option>Aktif</option><option>Donduruldu</option><option>Ayrıldı</option></select>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Öğrenci</th><th className="px-5 py-3">Veli</th><th className="px-5 py-3">Ders</th><th className="px-5 py-3">Telefon</th><th className="px-5 py-3">Bakiye</th><th className="px-5 py-3">Durum</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {students.map((student) => <tr key={student.name} className="hover:bg-slate-50"><td className="px-5 py-4 font-semibold">{student.name}</td><td className="px-5 py-4 text-slate-600">{student.guardian}</td><td className="px-5 py-4 text-slate-600">{student.course}</td><td className="px-5 py-4 text-slate-600">{student.phone}</td><td className="px-5 py-4 font-semibold">{formatTry(student.balance)}</td><td className="px-5 py-4"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold">{student.status}</span></td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
