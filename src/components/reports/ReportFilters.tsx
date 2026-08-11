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
    <div className="mb-6 rounded-2xl border border-line bg-panel p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted">Aralık:</span>

        <Link
          href={`/raporlar?view=${view}&range=last6`}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            range === "last6"
              ? "bg-terra-700 text-white shadow-sm shadow-terra-700/20"
              : "border border-line text-ink hover:bg-fill"
          }`}
        >
          Son 6 ay
        </Link>

        <Link
          href={`/raporlar?view=${view}&range=last12`}
          className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
            range === "last12"
              ? "bg-terra-700 text-white shadow-sm shadow-terra-700/20"
              : "border border-line text-ink hover:bg-fill"
          }`}
        >
          Son 12 ay
        </Link>

        {range === "custom" && (
          <span className="rounded-lg bg-honey-50 px-3 py-1.5 text-sm font-semibold text-honey-700 dark:bg-honey-500/10 dark:text-honey-500">
            Özel aralık
          </span>
        )}
      </div>

      <form
        method="get"
        action="/raporlar"
        className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr_1fr_1fr_auto]"
      >
        <input type="hidden" name="view" value={view} />

        <label className="text-xs font-medium text-muted">
          Başlangıç ayı

          <input
            type="month"
            name="start"
            defaultValue={startMonth}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          />
        </label>

        <label className="text-xs font-medium text-muted">
          Bitiş ayı

          <input
            type="month"
            name="end"
            defaultValue={endMonth}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          />
        </label>

        <label className="text-xs font-medium text-muted">
          Ders

          <select
            name="course"
            defaultValue={courseId}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          >
            <option value="">Tümü</option>
            {courseOptions.map((course) => (
              <option key={course.id} value={course.id}>
                {course.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-muted">
          Öğrenci durumu

          <select
            name="status"
            defaultValue={studentStatus}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
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
          <label className="text-xs font-medium text-muted">
            Ödeme yöntemi

            <select
              name="method"
              defaultValue={method}
              className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
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
            className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
          >
            Filtrele
          </button>

          {(hasActiveFilter || range === "custom") && (
            <Link
              href={`/raporlar?view=${view}&range=last6`}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:bg-fill"
            >
              Temizle
            </Link>
          )}
        </div>
      </form>
    </div>
  );
}
