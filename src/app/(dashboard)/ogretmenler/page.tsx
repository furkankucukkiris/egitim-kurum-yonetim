import { PageHeader } from "@/components/page-header";
import { teachers } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";
import { requireRole } from "@/lib/auth";
export default async function TeachersPage() {
  await requireRole(["admin"]);
  return (
    <>
      <PageHeader title="Öğretmenler" description="Planlanan ve yapılan dersler ile aylık hak ediş özeti." action={<button className="rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">+ Öğretmen ekle</button>} />
      <div className="grid gap-4 xl:grid-cols-3">{teachers.map((teacher)=><article key={teacher.name} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-4"><div className="grid h-12 w-12 place-items-center rounded-full bg-slate-900 font-bold text-white">{teacher.name.slice(0,1)}</div><div><h3 className="font-bold">{teacher.name}</h3><p className="text-sm text-slate-500">{teacher.branch}</p></div></div><dl className="mt-6 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Öğrenci</dt><dd className="mt-1 font-bold">{teacher.students}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Ders</dt><dd className="mt-1 font-bold">{teacher.completed}/{teacher.planned}</dd></div><div className="col-span-2 rounded-xl bg-slate-950 p-3 text-white"><dt className="text-slate-300">Tahmini hak ediş</dt><dd className="mt-1 text-lg font-bold">{formatTry(teacher.payment)}</dd></div></dl></article>)}</div>
    </>
  );
}
