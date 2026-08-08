export type MonthlyDatum = {
  monthLabel: string;
  collected: number;
  pending: number;
};

const COLLECTED_COLOR = "#10b981";
const PENDING_COLOR = "#f43f5e";

const compactTry = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function MonthlyRevenueChart({ data }: { data: MonthlyDatum[] }) {
  const barWidth = 28;
  const gap = 28;
  const chartHeight = 200;
  const paddingTop = 16;
  const paddingBottom = 26;
  const paddingLeft = 44;

  const width = paddingLeft + data.length * (barWidth + gap);
  const height = paddingTop + chartHeight + paddingBottom;

  const maxTotal = Math.max(1, ...data.map((item) => item.collected + item.pending));
  const niceMax = niceCeiling(maxTotal);
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];

  function yFor(value: number) {
    return paddingTop + chartHeight - (value / niceMax) * chartHeight;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <LegendSwatch color={COLLECTED_COLOR} label="Tahsilat" />
        <LegendSwatch color={PENDING_COLOR} label="Bekleyen" />
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Henüz veri yok.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          role="img"
          aria-label="Aylık tahakkuk ve tahsilat grafiği"
        >
          {gridFractions.map((fraction) => {
            const value = Math.round(niceMax * fraction);
            const y = yFor(value);

            return (
              <g key={fraction}>
                <line
                  x1={paddingLeft}
                  x2={width}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={1}
                />
                <text x={0} y={y + 3} fontSize={9} fill="var(--muted)">
                  {compactTry.format(value)}
                </text>
              </g>
            );
          })}

          {data.map((item, index) => {
            const x = paddingLeft + index * (barWidth + gap) + gap / 2;
            const collectedHeight = (item.collected / niceMax) * chartHeight;
            const pendingHeight = (item.pending / niceMax) * chartHeight;
            const collectedY = paddingTop + chartHeight - collectedHeight;
            const segmentGap = item.collected > 0 && item.pending > 0 ? 2 : 0;
            const pendingY = collectedY - pendingHeight - segmentGap;

            return (
              <g key={item.monthLabel}>
                <title>
                  {`${item.monthLabel}: Tahsilat ${new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: "TRY",
                    maximumFractionDigits: 0,
                  }).format(item.collected)}, Bekleyen ${new Intl.NumberFormat("tr-TR", {
                    style: "currency",
                    currency: "TRY",
                    maximumFractionDigits: 0,
                  }).format(item.pending)}`}
                </title>

                {item.collected > 0 && (
                  <rect
                    x={x}
                    y={collectedY}
                    width={barWidth}
                    height={Math.max(0, collectedHeight)}
                    rx={4}
                    fill={COLLECTED_COLOR}
                  />
                )}

                {item.pending > 0 && (
                  <rect
                    x={x}
                    y={pendingY}
                    width={barWidth}
                    height={Math.max(0, pendingHeight)}
                    rx={4}
                    fill={PENDING_COLOR}
                  />
                )}

                <text
                  x={x + barWidth / 2}
                  y={height - 8}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--muted)"
                >
                  {item.monthLabel}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden
      />
      {label}
    </span>
  );
}

function niceCeiling(value: number) {
  if (value <= 0) {
    return 1000;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return niceNormalized * magnitude;
}
