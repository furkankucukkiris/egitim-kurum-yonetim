import { ReactNode } from "react";

export function StatCard({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-ink">{value}</p>
          <p className="mt-2 text-xs text-muted">{detail}</p>
        </div>
        {icon && <div className="grid h-11 w-11 place-items-center rounded-xl bg-fill text-lg text-brand-700 dark:text-brand-100">{icon}</div>}
      </div>
    </div>
  );
}
