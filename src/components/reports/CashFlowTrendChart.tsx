export type CashFlowDatum = {
  monthLabel: string;
  cashIn: number;
  refunds: number;
  net: number;
};

const CASH_IN_COLOR = "#10b981";
const REFUND_COLOR = "#f43f5e";

const compactTry = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  notation: "compact",
  maximumFractionDigits: 1,
});

const fullTry = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 0,
});

export function CashFlowTrendChart({ data }: { data: CashFlowDatum[] }) {
  const barWidth = 12;
  const barGap = 4;
  const groupGap = 24;
  const chartHeight = 200;
  const paddingTop = 16;
  const paddingBottom = 40;
  const paddingLeft = 44;

  const groupWidth = barWidth * 2 + barGap;
  const width = paddingLeft + data.length * (groupWidth + groupGap);
  const height = paddingTop + chartHeight + paddingBottom;

  const maxValue = Math.max(1, ...data.map((item) => Math.max(item.cashIn, item.refunds)));
  const niceMax = niceCeiling(maxValue);
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];

  function barHeightFor(value: number) {
    return (value / niceMax) * chartHeight;
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <LegendSwatch color={CASH_IN_COLOR} label="Nakit girişi" />
        <LegendSwatch color={REFUND_COLOR} label="İade" />
      </div>

      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Henüz veri yok.</p>
      ) : (
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full"
          role="img"
          aria-label="Aylık nakit girişi ve iade grafiği"
        >
          {gridFractions.map((fraction) => {
            const value = Math.round(niceMax * fraction);
            const y = paddingTop + chartHeight - value / niceMax * chartHeight;

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
            const groupX = paddingLeft + index * (groupWidth + groupGap) + groupGap / 2;
            const cashInHeight = Math.max(0, barHeightFor(item.cashIn));
            const refundHeight = Math.max(0, barHeightFor(item.refunds));

            return (
              <g key={item.monthLabel}>
                <title>
                  {`${item.monthLabel}: Nakit girişi ${fullTry.format(item.cashIn)}, İade ${fullTry.format(
                    item.refunds,
                  )}, Net ${fullTry.format(item.net)}`}
                </title>

                {item.cashIn > 0 && (
                  <rect
                    x={groupX}
                    y={paddingTop + chartHeight - cashInHeight}
                    width={barWidth}
                    height={cashInHeight}
                    rx={3}
                    fill={CASH_IN_COLOR}
                  />
                )}

                {item.refunds > 0 && (
                  <rect
                    x={groupX + barWidth + barGap}
                    y={paddingTop + chartHeight - refundHeight}
                    width={barWidth}
                    height={refundHeight}
                    rx={3}
                    fill={REFUND_COLOR}
                  />
                )}

                <text
                  x={groupX + groupWidth / 2}
                  y={paddingTop + chartHeight + 16}
                  fontSize={10}
                  textAnchor="middle"
                  fill="var(--muted)"
                >
                  {item.monthLabel}
                </text>

                <text
                  x={groupX + groupWidth / 2}
                  y={paddingTop + chartHeight + 30}
                  fontSize={9}
                  fontWeight={600}
                  textAnchor="middle"
                  fill={item.net >= 0 ? "var(--ink)" : REFUND_COLOR}
                >
                  {compactTry.format(item.net)}
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
