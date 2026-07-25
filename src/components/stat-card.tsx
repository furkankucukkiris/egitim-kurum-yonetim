import { ReactNode } from "react";

export function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        {icon && <div className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-lg">{icon}</div>}
      </div>
    </div>
  );
}
