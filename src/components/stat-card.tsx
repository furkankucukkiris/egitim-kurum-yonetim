import { ReactNode } from "react";

export function StatCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-text-secondary">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-text-primary">{value}</p>
          <p className="mt-2 text-xs text-text-secondary">{detail}</p>
        </div>
        {icon && (
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-surface-muted text-lg text-primary text-primary">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
