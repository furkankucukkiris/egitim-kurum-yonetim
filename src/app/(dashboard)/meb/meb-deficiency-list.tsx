"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type DeficiencyRow = {
  entity_type: "course" | "teacher_course" | "enrollment";
  entity_id: string | null;
  display_label: string;
  status: string;
  valid_from: string | null;
  valid_until: string | null;
  reason: string | null;
  responsible_name: string | null;
  checked_at: string | null;
  checked_by_name: string | null;
  resolved_at: string | null;
  is_deficient: boolean;
  is_expiring_soon: boolean;
  is_expired: boolean;
  student_id: string | null;
  teacher_profile_id: string | null;
  course_id: string | null;
};

const entityTypeLabels: Record<DeficiencyRow["entity_type"], string> = {
  course: "Ders",
  teacher_course: "Öğretmen",
  enrollment: "Öğrenci",
};

const auditTableByEntityType: Record<DeficiencyRow["entity_type"], string> = {
  course: "courses",
  teacher_course: "teacher_course_meb_authorizations",
  enrollment: "enrollment_meb_registrations",
};

export function MebDeficiencyList({ rows }: { rows: DeficiencyRow[] }) {
  const [onlyDeficient, setOnlyDeficient] = useState(true);
  const [onlyExpiringSoon, setOnlyExpiringSoon] = useState(false);
  const [entityFilter, setEntityFilter] = useState<DeficiencyRow["entity_type"] | "all">("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");

    return rows.filter((row) => {
      if (onlyDeficient && !onlyExpiringSoon && !row.is_deficient) {
        return false;
      }

      if (onlyExpiringSoon && !onlyDeficient && !(row.is_expiring_soon || row.is_expired)) {
        return false;
      }

      if (
        onlyDeficient &&
        onlyExpiringSoon &&
        !(row.is_deficient || row.is_expiring_soon || row.is_expired)
      ) {
        return false;
      }

      if (entityFilter !== "all" && row.entity_type !== entityFilter) {
        return false;
      }

      if (
        term &&
        !row.display_label.toLocaleLowerCase("tr-TR").includes(term) &&
        !(row.reason ?? "").toLocaleLowerCase("tr-TR").includes(term)
      ) {
        return false;
      }

      return true;
    });
  }, [rows, onlyDeficient, onlyExpiringSoon, entityFilter, search]);

  return (
    <section className="mb-8 rounded-2xl border border-border bg-surface p-5 shadow-sm">
      <h2 className="text-xl font-bold">Eksik &amp; Süre Takibi</h2>

      <p className="mt-1 text-sm text-text-secondary">
        Ders, öğretmen ve öğrenci MEB kayıtlarındaki eksikleri ve yakında süresi dolacak kayıtları
        tek listede gör.
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={onlyDeficient}
            onChange={(event) => setOnlyDeficient(event.target.checked)}
            className="h-4 w-4"
          />
          Yalnızca eksikler
        </label>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={onlyExpiringSoon}
            onChange={(event) => setOnlyExpiringSoon(event.target.checked)}
            className="h-4 w-4"
          />
          Yalnızca süresi yaklaşanlar/dolanlar
        </label>

        <label className="block text-sm font-medium">
          Tür
          <select
            value={entityFilter}
            onChange={(event) =>
              setEntityFilter(event.target.value as DeficiencyRow["entity_type"] | "all")
            }
            className="mt-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="all">Tümü</option>
            <option value="course">Ders</option>
            <option value="teacher_course">Öğretmen</option>
            <option value="enrollment">Öğrenci</option>
          </select>
        </label>

        <label className="block flex-1 min-w-[200px] text-sm font-medium">
          Ara
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Ad veya eksiklik nedeni içinde ara"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </label>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-5 text-sm text-text-secondary">Bu filtrelerle eşleşen kayıt yok.</p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-surface-muted">
              <tr>
                <th className="px-3 py-2">Tür</th>
                <th className="px-3 py-2">Kayıt</th>
                <th className="px-3 py-2">Durum</th>
                <th className="px-3 py-2">Geçerlilik bitişi</th>
                <th className="px-3 py-2">Neden</th>
                <th className="px-3 py-2">Sorumlu</th>
                <th className="px-3 py-2">Son kontrol</th>
                <th className="px-3 py-2">Giderildi</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>

            <tbody className="divide-y divide-primary-soft">
              {filtered.map((row) => (
                <tr
                  key={`${row.entity_type}:${row.entity_id ?? `${row.teacher_profile_id}-${row.course_id}`}`}
                >
                  <td className="px-3 py-3 text-xs text-text-secondary">
                    {entityTypeLabels[row.entity_type]}
                  </td>

                  <td className="px-3 py-3 font-semibold">{row.display_label}</td>

                  <td className="px-3 py-3">
                    {row.is_expired ? (
                      <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-bold text-danger text-danger">
                        Süresi doldu
                      </span>
                    ) : row.is_deficient ? (
                      <span className="rounded-full bg-danger-soft px-2.5 py-1 text-xs font-bold text-danger text-danger">
                        Eksik
                      </span>
                    ) : row.is_expiring_soon ? (
                      <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-bold text-accent-strong">
                        Süresi yaklaşıyor
                      </span>
                    ) : (
                      <span className="rounded-full bg-success-soft px-2.5 py-1 text-xs font-bold text-success text-success">
                        Uygun
                      </span>
                    )}
                  </td>

                  <td className="px-3 py-3 text-xs">{row.valid_until ?? "—"}</td>

                  <td className="px-3 py-3 max-w-xs text-xs text-text-secondary">
                    {row.reason || "—"}
                  </td>

                  <td className="px-3 py-3 text-xs">{row.responsible_name ?? "—"}</td>

                  <td className="px-3 py-3 text-xs text-text-secondary">
                    {row.checked_at
                      ? `${formatDate(row.checked_at)}${
                          row.checked_by_name ? ` — ${row.checked_by_name}` : ""
                        }`
                      : "—"}
                  </td>

                  <td className="px-3 py-3 text-xs text-text-secondary">
                    {row.resolved_at ? formatDate(row.resolved_at) : "—"}
                  </td>

                  <td className="px-3 py-3 text-xs">
                    <div className="flex flex-col gap-1">
                      {row.entity_type === "enrollment" && row.student_id ? (
                        <Link
                          href={`/ogrenciler/${row.student_id}`}
                          className="font-semibold text-primary underline underline-offset-4 text-primary"
                        >
                          Öğrenciye git
                        </Link>
                      ) : (
                        <a
                          href={`#${
                            row.entity_type === "teacher_course"
                              ? `teacher_course-${row.teacher_profile_id}-${row.course_id}`
                              : `course-${row.entity_id}`
                          }`}
                          className="font-semibold text-primary underline underline-offset-4 text-primary"
                        >
                          Forma git
                        </a>
                      )}

                      {row.entity_id && (
                        <Link
                          href={`/kurum-ayarlari/denetim-kayitlari?table=${auditTableByEntityType[row.entity_type]}&search=${row.entity_id}`}
                          className="text-text-secondary underline underline-offset-4"
                        >
                          Tüm geçmiş
                        </Link>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
