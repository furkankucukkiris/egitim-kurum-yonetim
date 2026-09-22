"use client";

import { useMemo, useState } from "react";
import { RosterTable, type RosterRow } from "./roster-table";

export function ExcludedRosterFilter({ rows }: { rows: RosterRow[] }) {
  const [search, setSearch] = useState("");

  const filteredRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("tr-TR");

    if (!term) {
      return rows;
    }

    return rows.filter(
      (row) =>
        row.student_full_name.toLocaleLowerCase("tr-TR").includes(term) ||
        row.course_name.toLocaleLowerCase("tr-TR").includes(term) ||
        (row.teacher_full_name ?? "").toLocaleLowerCase("tr-TR").includes(term) ||
        (row.compliance_reason ?? "").toLocaleLowerCase("tr-TR").includes(term),
    );
  }, [rows, search]);

  return (
    <>
      <label className="print:hidden mb-4 block max-w-sm text-sm font-medium">
        Öğrenci, ders, öğretmen veya eksiklik nedeninde ara
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Ara..."
          className="mt-2 w-full rounded-xl border border-border bg-surface px-4 py-3 text-sm"
        />
      </label>

      <RosterTable rows={filteredRows} included={false} />
    </>
  );
}
