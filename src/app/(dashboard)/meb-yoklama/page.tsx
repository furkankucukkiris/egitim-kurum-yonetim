import { PageHeader } from "@/components/page-header";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

  compliance_status:
    | "compliant"
    | "pending"
    | "non_compliant";

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

export default async function MebRosterPage({
  searchParams,
}: PageProps) {
  await requireRole(["admin", "teacher"]);

  const params = await searchParams;

  const month =
    isMonthValue(params.month)
      ? params.month
      : getCurrentMonthInIstanbul();

  const monthStart = `${month}-01`;

  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "get_meb_monthly_roster",
    {
      p_month_start: monthStart,
    },
  );

  if (error) {
    console.error(
      "MEB yoklama listesi alınamadı:",
      error,
    );
  }

  const rows =
    (data ?? []) as RosterRow[];

  const included = rows.filter(
    (row) => row.include_in_meb_register,
  );

  const excluded = rows.filter(
    (row) => !row.include_in_meb_register,
  );

  return (
    <>
      <PageHeader
        title="MEB Yoklama Kontrolü"
        description="Kurum içi programdaki öğrenciler ile MEB yoklama defterine eklenebilecek öğrencileri karşılaştırın."
      />

      <form
        method="get"
        className="mb-6 flex flex-col gap-3 rounded-2xl border border-line bg-panel p-4 sm:flex-row sm:items-end"
      >
        <label className="block flex-1 text-sm font-medium">
          Kontrol ayı

          <input
            type="month"
            name="month"
            defaultValue={month}
            className="mt-2 w-full rounded-xl border border-line px-4 py-3 text-sm"
          />
        </label>

        <button
          type="submit"
          className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white"
        >
          Ayı kontrol et
        </button>
      </form>

      {error && (
        <div className="mb-5 rounded-2xl border border-rose-200 dark:border-rose-800/40 bg-rose-50 dark:bg-rose-500/10 p-4 text-sm text-rose-700 dark:text-rose-400">
          MEB kontrol listesi alınamadı.
        </div>
      )}

      <section>
        <div className="mb-4">
          <h2 className="text-xl font-bold text-emerald-800 dark:text-emerald-400">
            MEB yoklama defterine eklenebilir
          </h2>

          <p className="mt-1 text-sm text-muted">
            Ders, öğretmen çalışma izni ve öğrencinin ders bazlı MEB kaydı uygun olanlar.
          </p>
        </div>

        {included.length === 0 ? (
          <EmptyState>
            Bu ay için MEB açısından tamamen uygun bir öğrenci kaydı bulunmuyor.
          </EmptyState>
        ) : (
          <RosterTable
            rows={included}
            included
          />
        )}
      </section>

      <section className="mt-10">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-rose-800 dark:text-rose-400">
            Kurum programında var, MEB defterine eklenmemeli
          </h2>

          <p className="mt-1 text-sm text-muted">
            Bu öğrenciler gerçek ders programında kalır; ancak eksiklik giderilmeden MEB yoklama listesine alınmamalıdır.
          </p>
        </div>

        {excluded.length === 0 ? (
          <EmptyState>
            MEB açısından eksik görünen öğrenci bulunmuyor.
          </EmptyState>
        ) : (
          <RosterTable
            rows={excluded}
            included={false}
          />
        )}
      </section>
    </>
  );
}

function RosterTable({
  rows,
  included,
}: {
  rows: RosterRow[];
  included: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-fill">
            <tr>
              <th className="px-4 py-3">
                Öğrenci
              </th>

              <th className="px-4 py-3">
                Program
              </th>

              <th className="px-4 py-3">
                Öğretmen
              </th>

              <th className="px-4 py-3">
                MEB durumu
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-brand-50">
            {rows.map((row) => (
              <tr key={row.enrollment_id}>
                <td className="px-4 py-4">
                  <p className="font-semibold">
                    {row.student_full_name}
                  </p>

                  {!included && (
                    <span className="mt-2 inline-block rounded-full bg-rose-100 dark:bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-800 dark:text-rose-400">
                      MEB defterine ekleme
                    </span>
                  )}
                </td>

                <td className="px-4 py-4">
                  <p className="font-semibold">
                    {row.course_name}
                  </p>

                  <p className="mt-1 text-xs text-muted">
                    {row.class_group_name ??
                      "Seans belirtilmedi"}

                    {row.weekday
                      ? ` • ${
                          weekdayLabels[
                            row.weekday
                          ]
                        }`
                      : ""}

                    {row.start_time
                      ? ` ${row.start_time.slice(
                          0,
                          5,
                        )}`
                      : ""}
                  </p>
                </td>

                <td className="px-4 py-4">
                  {row.teacher_full_name ??
                    "Öğretmen atanmamış"}
                </td>

                <td className="px-4 py-4">
                  <StatusBadge
                    status={
                      row.compliance_status
                    }
                  />

                  {!included &&
                    row.compliance_reason && (
                      <p className="mt-2 max-w-md text-xs leading-5 text-rose-700 dark:text-rose-400">
                        {
                          row.compliance_reason
                        }
                      </p>
                    )}

                  {row.student_meb_valid_until && (
                    <p className="mt-2 text-xs text-muted">
                      Öğrenci MEB bitişi:{" "}
                      {
                        row.student_meb_valid_until
                      }
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

function StatusBadge({
  status,
}: {
  status: RosterRow["compliance_status"];
}) {
  if (status === "compliant") {
    return (
      <span className="rounded-full bg-emerald-100 dark:bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-800 dark:text-emerald-400">
        MEB uyumlu
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className="rounded-full bg-honey-100 dark:bg-honey-500/15 px-3 py-1 text-xs font-bold text-honey-700 dark:text-honey-500">
        Kontrol/bekleme gerekli
      </span>
    );
  }

  return (
    <span className="rounded-full bg-rose-100 dark:bg-rose-500/15 px-3 py-1 text-xs font-bold text-rose-800 dark:text-rose-400">
      MEB uygun değil
    </span>
  );
}

function EmptyState({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-line bg-panel p-8 text-center text-sm text-muted">
      {children}
    </div>
  );
}

function isMonthValue(
  value: string | undefined,
) {
  return Boolean(
    value &&
      /^\d{4}-\d{2}$/.test(value),
  );
}

function getCurrentMonthInIstanbul() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
    },
  ).format(new Date());
}