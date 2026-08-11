import { formatTry } from "@/lib/utils";

export type DistributionSlice = {
  label: string;
  value: number;
};

// Doğrulanmış kategorik palet (dataviz skill referans paleti) — sekiz slot,
// açık/koyu temada CVD ve kontrast kontrollerinin tamamını geçer.
const SLOT_VAR = [
  "--series-1",
  "--series-2",
  "--series-3",
  "--series-4",
  "--series-5",
  "--series-6",
  "--series-7",
  "--series-8",
];

export function CourseDistributionPie({
  data,
  ariaLabel = "Derse göre gelir dağılımı",
  centerLabel = "Toplam",
}: {
  data: DistributionSlice[];
  ariaLabel?: string;
  centerLabel?: string;
}) {
  const sorted = [...data].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, item) => sum + item.value, 0);

  const cx = 90;
  const cy = 90;
  const outerRadius = 80;
  const innerRadius = 46;

  const slices = sorted.reduce<Array<DistributionSlice & {
    fraction: number;
    startAngle: number;
    endAngle: number;
    colorVar: string;
  }>>((accumulated, item, index) => {
    const previous = accumulated[index - 1];
    const cumulativeAngle = previous ? previous.endAngle : 0;
    const fraction = total > 0 ? item.value / total : 0;
    const startAngle = cumulativeAngle;
    const endAngle = cumulativeAngle + fraction * 360;

    accumulated.push({
      ...item,
      fraction,
      startAngle,
      endAngle,
      colorVar: `var(${SLOT_VAR[index % SLOT_VAR.length]})`,
    });

    return accumulated;
  }, []);

  return (
    <div className="chart-categorical-slots flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <style>{`
        .chart-categorical-slots {
          --series-1: #2a78d6; --series-2: #eb6834; --series-3: #1baf7a; --series-4: #eda100;
          --series-5: #e87ba4; --series-6: #008300; --series-7: #4a3aa7; --series-8: #e34948;
        }
        :root.dark .chart-categorical-slots {
          --series-1: #3987e5; --series-2: #d95926; --series-3: #199e70; --series-4: #c98500;
          --series-5: #d55181; --series-6: #008300; --series-7: #9085e9; --series-8: #e66767;
        }
      `}</style>

      {sorted.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">Henüz veri yok.</p>
      ) : (
        <>
          <svg
            viewBox="0 0 180 180"
            className="h-44 w-44 shrink-0"
            role="img"
            aria-label={ariaLabel}
          >
            {slices.map((slice) => (
              <path
                key={slice.label}
                d={describeDonutSlice(cx, cy, innerRadius, outerRadius, slice.startAngle, slice.endAngle)}
                fill={slice.colorVar}
              >
                <title>
                  {`${slice.label}: ${formatTry(slice.value)} (%${Math.round(slice.fraction * 100)})`}
                </title>
              </path>
            ))}

            <text
              x={cx}
              y={cy - 4}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted)"
            >
              {centerLabel}
            </text>
            <text
              x={cx}
              y={cy + 14}
              textAnchor="middle"
              fontSize={13}
              fontWeight={700}
              fill="var(--ink)"
            >
              {formatTry(total)}
            </text>
          </svg>

          <ul className="w-full space-y-2 text-sm">
            {slices.map((slice) => (
              <li key={slice.label} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 text-ink">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: slice.colorVar }}
                    aria-hidden
                  />
                  <span className="truncate">{slice.label}</span>
                </span>

                <span className="shrink-0 text-muted">
                  %{Math.round(slice.fraction * 100)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeDonutSlice(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
) {
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

  const outerStart = polarToCartesian(cx, cy, outerR, endAngle);
  const outerEnd = polarToCartesian(cx, cy, outerR, startAngle);
  const innerStart = polarToCartesian(cx, cy, innerR, startAngle);
  const innerEnd = polarToCartesian(cx, cy, innerR, endAngle);

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 0 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerStart.x} ${innerStart.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 1 ${innerEnd.x} ${innerEnd.y}`,
    "Z",
  ].join(" ");
}
