import Link from "next/link";

export type ReportCourseOption = {
  id: string;
  name: string;
};

const STUDENT_STATUS_OPTIONS = [
  { value: "active", label: "Aktif" },
  { value: "frozen", label: "Donduruldu" },
  { value: "left", label: "Ayrıldı" },
  { value: "archived", label: "Arşivlendi" },
];

const METHOD_OPTIONS = [
  { value: "cash", label: "Nakit" },
  { value: "bank_transfer", label: "Havale" },
  { value: "card", label: "Kart" },
  { value: "online", label: "Online" },
  { value: "other", label: "Diğer" },
];

export function ReportFilters({
  view,
  range,
  startMonth,
  endMonth,
  courseId,
  studentStatus,
  method,
  courseOptions,
  showMethodFilter,
}: {
  view: string;
  range: string;
  startMonth: string;
  endMonth: string;
  courseId: string;
  studentStatus: string;
  method: string;
  courseOptions: ReportCourseOption[];
  showMethodFilter: boolean;
}) {
  const hasActiveFilter = courseId || studentStatus || (showMethodFilter && method);

  return (
    <div className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-secondary">Aralık:</span>

        <Link
          href={`/raporlar?view=${view}&range=last6`}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            range === "last6"
              ? "bg-primary text-on-primary shadow-sm"
              : "border border-border text-text-primary hover:bg-surface-muted"
          }`}
        >
          Son 6 ay
        </Link>

        <Link
          href={`/raporlar?view=${view}&range=last12`}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            range === "last12"
              ? "bg-primary text-on-primary shadow-sm"
              : "border border-border text-text-primary hover:bg-surface-muted"
          }`}
        >
          Son 12 ay
        </Link>

        {range === "custom" && (
          <span className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm font-semibold text-accent-strong bg-accent-soft">
            Özel aralık
          </span>
        )}
      </div>

      <form
        method="get"
        action="/raporlar"
        className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr_1fr_auto]"
      >
        <input type="hidden" name="view" value={view} />

        <label className="text-xs font-medium text-text-secondary">
          Başlangıç ayı
          <input
            type="month"
            name="start"
            defaultValue={startMonth}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
        </label>

        <label className="text-xs font-medium text-text-secondary">
          Bitiş ayı
          <input
            type="month"
            name="end"
            defaultValue={endMonth}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
        </label>

        <label className="text-xs font-medium text-text-secondary">
          Ders
          <select
            name="course"
            defaultValue={courseId}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          >
            <option value="">Tümü</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-text-secondary">
          Öğrenci durumu
          <select
            name="status"
            defaultValue={studentStatus}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          >
            <option value="">Tümü</option>
            {STUDENT_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {showMethodFilter ? (
          <label className="text-xs font-medium text-text-secondary">
            Ödeme yöntemi
            <select
              name="method"
              defaultValue={method}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            >
              <option value="">Tümü</option>
              {METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
          >
            Filtrele
          </button>

          {(hasActiveFilter || range === "custom") && (
            <Link
              href={`/raporlar?view=${view}&range=last6`}
              className="rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted"
            >
              Temizle
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
