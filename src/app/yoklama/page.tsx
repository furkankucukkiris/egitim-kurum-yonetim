import { PageHeader } from "@/components/page-header";

const sessions = [
  { time: "11:00", course: "Resim", teacher: "Nisa", count: 8, room: "Atölye 1" },
  { time: "12:00", course: "Piyano", teacher: "Latife Eda", count: 1, room: "Piyano 1" },
  { time: "13:00", course: "Yaratıcı Drama", teacher: "Seda Nur", count: 9, room: "Drama Salonu" },
  { time: "16:00", course: "Resim", teacher: "Nisa", count: 7, room: "Atölye 1" },
];

export default function AttendancePage() {
  return (
    <>
      <PageHeader title="Yoklama" description="Bugünkü dersleri açın, öğrenci katılımını ve telafi durumunu kaydedin." />
      <div className="mb-5 flex flex-wrap gap-2"><button className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Bugün</button><button className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">Dün</button><button className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm">Yarın</button></div>
      <div className="grid gap-4 md:grid-cols-2">{sessions.map((session)=><article key={`${session.time}-${session.course}`} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between"><div><span className="text-sm font-semibold text-amber-700">{session.time}</span><h3 className="mt-1 text-lg font-bold">{session.course}</h3><p className="mt-1 text-sm text-slate-500">{session.teacher} · {session.room}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{session.count} öğrenci</span></div><button className="mt-5 w-full rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">Yoklamayı aç</button></article>)}</div>
    </>
  );
}
