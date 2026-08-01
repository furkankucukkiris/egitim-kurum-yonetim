export type BadgeTone = "neutral" | "success" | "warning" | "danger";

interface StatusBadgeProps {
  label: string;
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-brand-50 text-brand-700",
  success: "bg-green-50 text-green-700",
  warning: "bg-honey-100 text-honey-700",
  danger: "bg-red-50 text-red-700",
};

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-medium ${toneClasses[tone]}`}
    >
      {label}
    </span>
  );
}