export type RosterRow = {
  enrollment_id: string;
  student_id: string;
  student_full_name: string;

  course_name: string;

  class_group_name: string | null;
  weekday: number | null;
  start_time: string | null;

  teacher_full_name: string | null;

  course_meb_status: string;
  teacher_meb_status: string;
  student_meb_status: string;

  student_meb_valid_from: string | null;
  student_meb_valid_until: string | null;

  compliance_status: "compliant" | "pending" | "non_compliant";

  include_in_meb_register: boolean;
  compliance_reason: string | null;
};

const weekdayLabels: Record<number, string> = {
  1: "Pazartesi",
  2: "Salı",
  3: "Çarşamba",
  4: "Perşembe",
  5: "Cuma",
  6: "Cumartesi",
  7: "Pazar",
};

export function RosterTable({ rows, included }: { rows: RosterRow[]; included: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-surface-muted">
            <tr>
              <th className="px-4 py-3">Öğrenci</th>

              <th className="px-4 py-3">Program</th>

              <th className="px-4 py-3">Öğretmen</th>

              <th className="px-4 py-3">MEB durumu</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-primary-soft">
            {rows.map((row) => (
              <tr key={row.enrollment_id}>
                <td className="px-4 py-4">
                  <p className="font-semibold">{row.student_full_name}</p>

                  {!included && (
                    <span className="mt-2 inline-block rounded-full bg-danger-soft px-2.5 py-1 text-xs font-bold text-danger text-danger">
                      MEB defterine ekleme
                    </span>
                  )}
                </td>

                <td className="px-4 py-4">
                  <p className="font-semibold">{row.course_name}</p>

                  <p className="mt-1 text-xs text-text-secondary">
                    {row.class_group_name ?? "Seans belirtilmedi"}

                    {row.weekday ? ` • ${weekdayLabels[row.weekday]}` : ""}

                    {row.start_time ? ` ${row.start_time.slice(0, 5)}` : ""}
                  </p>
                </td>

                <td className="px-4 py-4">{row.teacher_full_name ?? "Öğretmen atanmamış"}</td>

                <td className="px-4 py-4">
                  <StatusBadge status={row.compliance_status} />

                  {!included && row.compliance_reason && (
                    <p className="mt-2 max-w-md text-xs leading-5 text-danger">
                      {row.compliance_reason}
                    </p>
                  )}

                  {row.student_meb_valid_until && (
                    <p className="mt-2 text-xs text-text-secondary">
                      Öğrenci MEB bitişi: {row.student_meb_valid_until}
                    </p>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: RosterRow["compliance_status"] }) {
  if (status === "compliant") {
    return (
      <span className="rounded-full bg-success-soft px-3 py-1 text-xs font-bold text-success text-success">
        MEB uyumlu
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="rounded-full bg-accent-soft px-3 py-1 text-xs font-bold text-accent-strong">
        Kontrol/bekleme gerekli
      </span>
    );
  }

  return (
    <span className="rounded-full bg-danger-soft px-3 py-1 text-xs font-bold text-danger text-danger">
      MEB uygun değil
    </span>
  );
}
