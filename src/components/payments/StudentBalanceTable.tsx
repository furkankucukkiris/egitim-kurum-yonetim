import Link from "next/link";
import { formatTry } from "@/lib/utils";

export type StudentBalanceRow = {
  student_id: string;
  student_name: string;
  course_names: string;
  total_net: number | string;
  total_allocated: number | string;
  total_pending: number | string;
  status: "paid" | "partial" | "pending";
  total_count: number;
};

export type CourseOption = {
  id: string;
  name: string;
};

const statusLabels: Record<StudentBalanceRow["status"], string> = {
  paid: "Ödendi",
  partial: "Kısmi",
  pending: "Bekliyor",
};

const statusClasses: Record<StudentBalanceRow["status"], string> = {
  paid: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  partial: "bg-honey-100 dark:bg-honey-500/15 text-honey-700 dark:text-honey-500",
  pending: "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

export function StudentBalanceTable({
  rows,
  courseOptions,
  month,
  search,
  courseFilter,
  statusFilter,
  page,
  pageSize,
  pageCount,
  totalCount,
  buildQuery,
}: {
  rows: StudentBalanceRow[];
  courseOptions: CourseOption[];
  month: string;
  search: string;
  courseFilter: string;
  statusFilter: string;
  page: number;
  pageSize: number;
  pageCount: number;
  totalCount: number;
  buildQuery: (overrides: Record<string, string>) => string;
}) {
  const rangeStart = totalCount > 0 ? (page - 1) * pageSize + 1 : 0;
  const rangeEnd = totalCount > 0 ? Math.min(page * pageSize, totalCount) : 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
      <form
        method="get"
        action="/odemeler"
        className="grid gap-3 border-b border-line p-4 sm:grid-cols-[1.5fr_1fr_1fr_auto]"
      >
        <input type="hidden" name="month" value={month} />

        <label className="text-xs font-medium text-muted">
          Öğrenci ara

          <input
            type="text"
            name="search"
            defaultValue={search}
            placeholder="Ad soyad…"
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          />
        </label>

        <label className="text-xs font-medium text-muted">
          Ders

          <select
            name="course"
            defaultValue={courseFilter}
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
          Durum

          <select
            name="status"
            defaultValue={statusFilter}
            className="mt-1 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          >
            <option value="">Tümü</option>
            <option value="paid">Ödendi</option>
            <option value="partial">Kısmi</option>
            <option value="pending">Bekliyor</option>
          </select>
        </label>

        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
          >
            Filtrele
          </button>

          {(search || courseFilter || statusFilter) && (
            <Link
              href={`/odemeler?month=${month}`}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-muted transition hover:bg-fill"
            >
              Temizle
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted">
          {search || courseFilter || statusFilter
            ? "Filtrelere uyan öğrenci bulunamadı."
            : "Açık ya da geçmiş bir tahakkuk kaydı bulunan öğrenci yok."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-fill text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-5 py-3">Öğrenci</th>
                <th className="px-5 py-3">Ders(ler)</th>
                <th className="px-5 py-3">Toplam tahakkuk</th>
                <th className="px-5 py-3">Tahsil edilen</th>
                <th className="px-5 py-3">Bekleyen bakiye</th>
                <th className="px-5 py-3">Durum</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {rows.map((row) => (
                <tr key={row.student_id}>
                  <td className="px-5 py-4 font-medium text-ink">{row.student_name}</td>
                  <td className="px-5 py-4 text-muted">{row.course_names}</td>
                  <td className="px-5 py-4 text-muted">{formatTry(Number(row.total_net))}</td>
                  <td className="px-5 py-4 text-muted">
                    {formatTry(Number(row.total_allocated))}
                  </td>
                  <td
                    className={`px-5 py-4 font-semibold ${
                      Number(row.total_pending) > 0.01
                        ? "text-rose-700 dark:text-rose-400"
                        : "text-ink"
                    }`}
                  >
                    {formatTry(Number(row.total_pending))}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses[row.status]}`}
                    >
                      {statusLabels[row.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
          <span>
            Toplam {totalCount} öğrenciden {rangeStart}–{rangeEnd} arası gösteriliyor
            {pageCount > 1 ? ` (sayfa ${page}/${pageCount})` : ""}
          </span>

          {pageCount > 1 && (
            <div className="flex gap-2">
              <Link
                href={buildQuery({ page: String(Math.max(1, page - 1)) })}
                aria-disabled={page <= 1}
                className={`rounded-lg border border-line px-3 py-1.5 font-semibold transition ${
                  page <= 1
                    ? "pointer-events-none opacity-40"
                    : "text-ink hover:bg-fill"
                }`}
              >
                ← Önceki
              </Link>

              <Link
                href={buildQuery({ page: String(Math.min(pageCount, page + 1)) })}
                aria-disabled={page >= pageCount}
                className={`rounded-lg border border-line px-3 py-1.5 font-semibold transition ${
                  page >= pageCount
                    ? "pointer-events-none opacity-40"
                    : "text-ink hover:bg-fill"
                }`}
              >
                Sonraki →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
