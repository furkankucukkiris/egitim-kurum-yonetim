"use client";

import { useMemo, useState } from "react";

type RosterRow = {
  enrollment_id: string;
  student_full_name: string;
  course_name: string;
  teacher_full_name: string | null;
  compliance_reason: string | null;
};

export function ExcludedRosterFilter<T extends RosterRow>({
  rows,
  children,
}: {
  rows: T[];
  children: (filteredRows: T[]) => React.ReactNode;
}) {
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

      {children(filteredRows)}
    </>
  );
}
