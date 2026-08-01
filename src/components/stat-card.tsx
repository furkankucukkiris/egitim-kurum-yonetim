import { ReactNode } from "react";

export function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-gray-500">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-brand-900">{value}</p>
          <p className="mt-2 text-xs text-gray-500">{detail}</p>
        </div>
        {icon && <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-lg text-brand-700">{icon}</div>}
      </div>
    </div>
  );
}
