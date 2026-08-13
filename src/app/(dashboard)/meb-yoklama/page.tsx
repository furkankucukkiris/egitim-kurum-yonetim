import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/students/PrintButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ExcludedRosterFilter } from "./excluded-roster-filter";

type PageProps = {
  searchParams: Promise<{
    month?: string;
  }>;
};

type RosterRow = {
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

export default async function MebRosterPage({ searchParams }: PageProps) {
  await requireRole(["admin", "teacher"]);

  const params = await searchParams;

  const month = isMonthValue(params.month) ? params.month : getCurrentMonthInIstanbul();

  const monthStart = `${month}-01`;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_meb_monthly_roster", {
    p_month_start: monthStart,
  });

  if (error) {
    console.error("MEB yoklama listesi alınamadı:", error);
  }

  const rows = (data ?? []) as RosterRow[];

  const included = rows.filter((row) => row.include_in_meb_register);

  const excluded = rows.filter((row) => !row.include_in_meb_register);

  return (
    <>
      <PageHeader
        title="MEB Yoklama Kontrolü"
        description="Kurum içi programdaki öğrenciler ile MEB yoklama defterine eklenebilecek öğrencileri karşılaştırın."
        action={<PrintButton />}
      />

      <form
        method="get"
        className="print:hidden mb-6 flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end"
      >
        <label className="block flex-1 text-sm font-medium">
          Kontrol ayı
          <input
            type="month"
            name="month"
            defaultValue={month}
            className="mt-2 w-full rounded-xl border border-border px-4 py-3 text-sm"
          />
        </label>

        <button
          type="submit"
          className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary"
        >
          Ayı kontrol et
        </button>
      </form>

      {error && (
        <div className="print:hidden mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          MEB kontrol listesi alınamadı.
        </div>
      )}

      <div className="print-form print-meb-roster">
        <p className="mb-4 hidden text-sm font-semibold print:block">Kontrol ayı: {month}</p>

        <section>
          <div className="mb-4">
            <h2 className="text-xl font-bold text-success text-success">
              MEB yoklama defterine eklenebilir
            </h2>

            <p className="mt-1 text-sm text-text-secondary">
              Ders, öğretmen çalışma izni ve öğrencinin ders bazlı MEB kaydı uygun olanlar.
            </p>
          </div>

          {included.length === 0 ? (
            <EmptyState>
              Bu ay için MEB açısından tamamen uygun bir öğrenci kaydı bulunmuyor.
            </EmptyState>
          ) : (
            <RosterTable rows={included} included />
          )}
        </section>

        <section className="mt-10">
          <div className="mb-4">
            <h2 className="text-xl font-bold text-danger text-danger">
              Kurum programında var, MEB defterine eklenmemeli
            </h2>

            <p className="mt-1 text-sm text-text-secondary">
              Bu öğrenciler gerçek ders programında kalır; ancak eksiklik giderilmeden MEB yoklama
              listesine alınmamalıdır.
            </p>
          </div>

          {excluded.length === 0 ? (
            <EmptyState>MEB açısından eksik görünen öğrenci bulunmuyor.</EmptyState>
          ) : (
            <ExcludedRosterFilter rows={excluded}>
              {(filteredRows) => <RosterTable rows={filteredRows} included={false} />}
            </ExcludedRosterFilter>
          )}
        </section>
      </div>
    </>
  );
}

function RosterTable({ rows, included }: { rows: RosterRow[]; included: boolean }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-text-secondary">
      {children}
    </div>
  );
}

function isMonthValue(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}$/.test(value));
}

function getCurrentMonthInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}
