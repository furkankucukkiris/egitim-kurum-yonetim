import { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  detail,
  icon,
  href,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: ReactNode;
  href?: string;
}) {
  const className = cn(
    "block rounded-2xl border border-border bg-surface p-5 transition-colors duration-200 hover:border-border-strong",
    href && "hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
  );

  const content = (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        <p className="mt-3 text-[1.7rem] font-semibold tracking-tight tabular-nums text-text-primary">
          {value}
        </p>
        <p className="mt-2 text-xs text-text-secondary">{detail}</p>
      </div>
      {icon && (
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-muted text-lg text-primary">
          {icon}
        </div>
      )}
    </div>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
