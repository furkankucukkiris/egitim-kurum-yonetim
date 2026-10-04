import type { CSSProperties, ReactNode } from "react";

// Sidebar navigasyon ikonları. Hareketler globals.css'teki `.nav-*`
// sınıflarıyla, üst Link'in (`.group`) hover/focus durumunda tetiklenir.

export type NavIconName =
  | "overview"
  | "calendar"
  | "students"
  | "candidates"
  | "courses"
  | "waitlist"
  | "collections"
  | "expenses"
  | "attendance"
  | "requests"
  | "notifications"
  | "earnings"
  | "teachers"
  | "reports"
  | "mebAttendance"
  | "meb"
  | "settings";

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

// 8 dişli çark: dış/iç yarıçap arasında gidip gelen kapalı bir çokgen.
const gearPath = (() => {
  const teeth = 8;
  const points: string[] = [];

  for (let i = 0; i < teeth; i += 1) {
    const base = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;

    for (const [offset, radius] of [
      [0.08, 9.5],
      [0.32, 9.5],
      [0.45, 7.2],
      [0.95, 7.2],
    ] as const) {
      const angle = base + step * offset;
      points.push(
        `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`,
      );
    }
  }

  return `M${points.join("L")}Z`;
})();

const icons: Record<NavIconName, { className?: string; content: ReactNode }> = {
  overview: {
    content: (
      <>
        <path d="M3.5 16a8.5 8.5 0 1 1 17 0" />
        <path d="M6.2 10.2l1.2 1M12 7.5V9M17.8 10.2l-1.2 1" />
        <path className="nav-needle" d="M12 16l3.2-4.2" />
        <circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none" />
      </>
    ),
  },
  calendar: {
    content: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 10h17" />
        <path className="nav-bob" d="M8 3v4M16 3v4" />
        {[
          [8, 13.8],
          [12, 13.8],
          [16, 13.8],
          [8, 17.2],
          [12, 17.2],
        ].map(([cx, cy], index) => (
          <circle
            key={`${cx}-${cy}`}
            className="nav-pop"
            style={delay(index * 50)}
            cx={cx}
            cy={cy}
            r="1"
            fill="currentColor"
            stroke="none"
          />
        ))}
      </>
    ),
  },
  students: {
    content: (
      <>
        <path className="nav-bob" d="M2.5 9.5 12 5l9.5 4.5L12 14z" />
        <path d="M6.5 11.7V16c0 1.4 2.5 3 5.5 3s5.5-1.6 5.5-3v-4.3" />
        <path className="nav-swing" d="M21.5 9.5v5" />
      </>
    ),
  },
  candidates: {
    content: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
        <path className="nav-turn" d="M19 8v6M16 11h6" />
      </>
    ),
  },
  courses: {
    content: (
      <>
        <path d="M12 6.5C10.5 5.2 8.3 4.5 6 4.5H3v13h3c2.3 0 4.5.7 6 2" />
        <path className="nav-page" d="M12 6.5c1.5-1.3 3.7-2 6-2h3v13h-3c-2.3 0-4.5.7-6 2" />
        <path d="M12 6.5v13" />
      </>
    ),
  },
  waitlist: {
    className: "nav-flip",
    content: (
      <>
        <path d="M6 3.5h12M6 20.5h12" />
        <path d="M7.5 3.5c0 4 4.5 5.5 4.5 8.5s-4.5 4.5-4.5 8.5M16.5 3.5c0 4-4.5 5.5-4.5 8.5s4.5 4.5 4.5 8.5" />
        <path d="M9.6 18.6h4.8L12 16z" fill="currentColor" />
      </>
    ),
  },
  collections: {
    className: "nav-coin",
    content: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M10.5 6.8v10c2.6 0 4.6-1.8 4.6-4.3" />
        <path d="M8 11.4l5-2.2M8 14.4l5-2.2" />
      </>
    ),
  },
  expenses: {
    content: (
      <>
        <path d="M5.5 3.5h13v17l-2.2-1.5-2.1 1.5-2.2-1.5-2.2 1.5-2.1-1.5-2.2 1.5z" />
        {["M9 8.5h6", "M9 12h6", "M9 15.5h3.5"].map((d, index) => (
          <path key={d} className="nav-draw" style={delay(index * 90)} pathLength={1} d={d} />
        ))}
      </>
    ),
  },
  attendance: {
    content: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5" />
        <path className="nav-draw" pathLength={1} d="M15.5 11.5l2 2 4-4.5" />
      </>
    ),
  },
  requests: {
    content: (
      <>
        <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-9l-5 3.5v-3.5H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z" />
        {[8, 12, 16].map((cx, index) => (
          <circle
            key={cx}
            className="nav-bob"
            style={delay(index * 120)}
            cx={cx}
            cy="11.5"
            r="1.1"
            fill="currentColor"
            stroke="none"
          />
        ))}
      </>
    ),
  },
  notifications: {
    content: (
      <>
        <path className="nav-ring" d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15zM12 3v2" />
        <path className="nav-clapper" d="M10 20.5a2 2 0 0 0 4 0" />
      </>
    ),
  },
  earnings: {
    className: "nav-slide",
    content: (
      <>
        <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 10v4M18 10v4" />
      </>
    ),
  },
  teachers: {
    content: (
      <>
        <path d="M2.5 4.5h19" />
        <rect x="4" y="4.5" width="16" height="10.5" rx="1" />
        <path d="M12 15v3.5M8.5 21l3.5-2.5 3.5 2.5" />
        <path className="nav-draw" pathLength={1} d="M7.5 12l3-3 2 2 4-4" />
      </>
    ),
  },
  reports: {
    content: (
      <>
        <path d="M3 20.5h18" />
        {[
          [5.5, 13, 7.5],
          [10.5, 8, 12.5],
          [15.5, 4, 16.5],
        ].map(([x, y, height], index) => (
          <rect
            key={x}
            className="nav-grow"
            style={delay(index * 80)}
            x={x}
            y={y}
            width="3"
            height={height}
            rx="0.8"
          />
        ))}
      </>
    ),
  },
  mebAttendance: {
    content: (
      <>
        <rect x="4.5" y="4.5" width="15" height="16.5" rx="2" />
        <rect x="8.5" y="2.5" width="7" height="4" rx="1" />
        <path className="nav-draw" pathLength={1} d="M8.5 13.5l2.5 2.5 4.5-5" />
      </>
    ),
  },
  meb: {
    content: (
      <>
        <path className="nav-bob" d="M3 9.5 12 4l9 5.5z" />
        <path d="M5.5 10.5v7M9.8 10.5v7M14.2 10.5v7M18.5 10.5v7" />
        <path d="M3 20.5h18" />
      </>
    ),
  },
  settings: {
    content: (
      <g className="nav-spin">
        <path d={gearPath} />
        <circle cx="12" cy="12" r="3" />
      </g>
    ),
  },
};

export function NavIcon({ name }: { name: NavIconName }) {
  const icon = icons[name];

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`nav-icon h-[18px] w-[18px] ${icon.className ?? ""}`}
    >
      {icon.content}
    </svg>
  );
}
