import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { recentPayments } from "@/lib/mock-data";
import { formatTry } from "@/lib/utils";
import { requireRole } from "@/lib/auth";
export default async function PaymentsPage() {
  await requireRole(["admin", "finance"]);
  return (
    <>
      <PageHeader title="Ödemeler" description="Tahakkuk, tahsilat, açık borç ve kasaya alınan nakit hareketleri." action={<button className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-4 py-3 text-sm font-semibold text-white">+ Ödeme al</button>} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Bu ay tahakkuk" value="₺318.400" detail="104 aktif öğrenci"/><StatCard label="Tahsil edilen" value="₺261.150" detail="%82 tahsilat oranı"/><StatCard label="Açık alacak" value="₺57.250" detail="14 öğrenci"/><StatCard label="Nakit kasa" value="₺12.600" detail="Bankaya yatırılmadı"/></div>
      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel shadow-sm"><div className="border-b border-line px-5 py-4"><h3 className="font-semibold">Tahsilat hareketleri</h3></div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-fill text-xs uppercase text-muted"><tr><th className="px-5 py-3">Öğrenci</th><th className="px-5 py-3">Ders</th><th className="px-5 py-3">Yöntem</th><th className="px-5 py-3">Tutar</th><th className="px-5 py-3">İşlem</th></tr></thead><tbody className="divide-y divide-brand-50">{recentPayments.map((p)=><tr key={p.student}><td className="px-5 py-4 font-semibold">{p.student}</td><td className="px-5 py-4">{p.course}</td><td className="px-5 py-4">{p.method}</td><td className="px-5 py-4 font-semibold">{formatTry(p.amount)}</td><td className="px-5 py-4"><button className="text-sm font-semibold text-brand-700 underline underline-offset-4">Detay</button></td></tr>)}</tbody></table></div></div>
    </>
  );
}
