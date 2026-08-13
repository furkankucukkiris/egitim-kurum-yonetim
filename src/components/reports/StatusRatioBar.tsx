import { formatTry } from "@/lib/utils";

export type StatusRatioDatum = {
  key: "paid" | "partial" | "overdue" | "open";
  label: string;
  amount: number;
  count: number;
};

const SEGMENT_COLOR: Record<StatusRatioDatum["key"], string> = {
  paid: "#10b981",
  partial: "#FAB933",
  overdue: "#f43f5e",
  open: "#D69C8C",
};

/**
 * Tek bir yatay orantılı çubukla açık/kısmi/gecikmiş/ödenen dağılımı
 * — altında aynı sayıların metin/tablo karşılığı (ekran okuyucular
 * ve renk körlüğü için grafiğe bağımlı olmayan erişim).
 */
export function StatusRatioBar({ segments }: { segments: StatusRatioDatum[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.amount, 0);
  const nonZero = segments.filter((segment) => segment.amount > 0);

  return (
    <div>
      {total <= 0 ? (
        <p className="py-6 text-center text-sm text-text-secondary">
          Bu aralıkta tahakkuk kaydı yok.
        </p>
      ) : (
        <>
          <div
            className="flex h-4 w-full overflow-hidden rounded-full bg-surface-muted"
            role="img"
            aria-label={segments
              .map(
                (s) =>
                  `${s.label}: ${formatTry(s.amount)} (%${Math.round((s.amount / total) * 100)})`,
              )
              .join(", ")}
          >
            {nonZero.map((segment) => (
              <div
                key={segment.key}
                style={{
                  width: `${(segment.amount / total) * 100}%`,
                  backgroundColor: SEGMENT_COLOR[segment.key],
                }}
                title={`${segment.label}: ${formatTry(segment.amount)}`}
              />
            ))}
          </div>

          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-text-primary">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: SEGMENT_COLOR[segment.key] }}
                    aria-hidden
                  />
                  {segment.label}
                </span>
                <span className="text-text-secondary">
                  {formatTry(segment.amount)} · {segment.count} dönem
                  {total > 0 ? ` · %${Math.round((segment.amount / total) * 100)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
