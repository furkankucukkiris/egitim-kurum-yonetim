import { PageHeader } from "@/components/page-header";
import { PrintButton } from "@/components/students/PrintButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ExcludedRosterFilter } from "./excluded-roster-filter";
import { RosterTable, type RosterRow } from "./roster-table";

type PageProps = {
  searchParams: Promise<{
    month?: string;
  }>;
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
          className="rounded-xl bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition active:scale-[0.98]"
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
            <ExcludedRosterFilter rows={excluded} />
          )}
        </section>
      </div>
    </>
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
