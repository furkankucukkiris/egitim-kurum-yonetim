export type BadgeTone = "neutral" | "success" | "warning" | "danger";

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100",
  success: "bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400",
  warning: "bg-honey-100 text-honey-700 dark:bg-honey-500/15 dark:text-honey-500",
  danger: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}
