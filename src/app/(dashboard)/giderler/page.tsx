import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import {
  createExpenseCategory,
  createRecurringExpenseTemplate,
  generateMonthlyExpenses,
  setRecurringExpenseTemplateActive,
} from "./actions";

type ExpensesPageProps = {
  searchParams: Promise<{
    month?: string;
    success?: string;
    error?: string;
  }>;
};

type Category = {
  id: string;
  name: string;
  is_direct_course_cost: boolean;
};

type Course = {
  id: string;
  name: string;
};

type Template = {
  id: string;
  amount: number;
  due_day: number;
  vendor_name: string | null;
  is_active: boolean;
  expense_categories: { name: string } | null;
  courses: { name: string } | null;
};

type ExpenseRow = {
  id: string;
  expense_date: string;
  vendor_name: string | null;
  amount: number;
  status: "planned" | "paid" | "cancelled";
  expense_categories: { name: string } | null;
  courses: { name: string } | null;
};

type CategoryBreakdownRow = {
  category_id: string;
  category_name: string;
  planned_amount: number;
  paid_amount: number;
  cancelled_amount: number;
  total_count: number;
};

type ProfitabilitySummary = {
  revenue_accrued: number;
  direct_expenses: number;
  indirect_expenses: number;
  total_expenses: number;
  expenses_paid_cash: number;
  gross_result: number;
  net_result: number;
};

const statusLabels: Record<ExpenseRow["status"], string> = {
  planned: "Planlı",
  paid: "Ödendi",
  cancelled: "İptal",
};

const statusTones: Record<ExpenseRow["status"], BadgeTone> = {
  planned: "warning",
  paid: "success",
  cancelled: "danger",
};

export default async function ExpensesPage({ searchParams }: ExpensesPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const month = isMonthValue(params.month ?? "") ? params.month! : getCurrentMonthInIstanbul();
  const monthStart = `${month}-01`;

  const supabase = await createClient();

  const [
    { data: summaryData, error: summaryError },
    { data: categoryBreakdown, error: breakdownError },
    { data: expenses, error: expensesError },
    { data: categories, error: categoriesError },
    { data: templates, error: templatesError },
    { data: courses, error: coursesError },
  ] = await Promise.all([
    supabase.rpc("get_monthly_profitability_summary", { p_month_start: monthStart }),
    supabase.rpc("get_monthly_expenses_by_category", { p_month_start: monthStart }),
    supabase
      .from("expenses")
      .select(
        "id, expense_date, vendor_name, amount, status, expense_categories(name), courses(name)",
      )
      .eq("organization_id", profile.organizationId)
      .gte("expense_date", monthStart)
      .lt("expense_date", nextMonthStart(monthStart))
      .order("expense_date", { ascending: false }),
    supabase.from("expense_categories").select("id, name, is_direct_course_cost").order("name"),
    supabase
      .from("recurring_expense_templates")
      .select(
        "id, amount, due_day, vendor_name, is_active, expense_categories(name), courses(name)",
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("courses")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .order("name"),
  ]);

  if (summaryError) console.error("Kârlılık özeti alınamadı:", summaryError);
  if (breakdownError) console.error("Kategori dağılımı alınamadı:", breakdownError);
  if (expensesError) console.error("Masraflar alınamadı:", expensesError);
  if (categoriesError) console.error("Kategoriler alınamadı:", categoriesError);
  if (templatesError) console.error("Şablonlar alınamadı:", templatesError);
  if (coursesError) console.error("Dersler alınamadı:", coursesError);

  const summary = ((summaryData ?? []) as unknown as ProfitabilitySummary[])[0];
  const breakdown = (categoryBreakdown ?? []) as unknown as CategoryBreakdownRow[];
  const expenseRows = (expenses ?? []) as unknown as ExpenseRow[];
  const categoryList = (categories ?? []) as Category[];
  const templateList = (templates ?? []) as unknown as Template[];
  const courseList = (courses ?? []) as Course[];

  return (
    <>
      <PageHeader
        title="Giderler"
        description="Masraf kategorileri, tekrarlayan masraflar ve aylık kârlılık."
      />

      <SettingsAlert success={params.success} error={params.error} />

      <form method="get" className="mb-6 flex items-end gap-3">
        <label className="text-xs font-medium text-text-secondary">
          Ay
          <input
            name="month"
            type="month"
            defaultValue={month}
            className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
          />
        </label>

        <button
          type="submit"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
        >
          Görüntüle
        </button>

        <Link
          href="/giderler/yeni"
          className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
        >
          Yeni masraf
        </Link>
      </form>

      {summary && (
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="p-5">
            <p className="text-sm font-medium text-text-secondary">Gelir (tahakkuk)</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-text-primary">
              {formatTry(summary.revenue_accrued)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-text-secondary">Toplam gider</p>
            <p className="mt-3 text-2xl font-bold tracking-tight text-text-primary">
              {formatTry(summary.total_expenses)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-text-secondary">Brüt sonuç</p>
            <p
              className={`mt-3 text-2xl font-bold tracking-tight ${
                summary.gross_result >= 0 ? "text-success" : "text-danger"
              }`}
            >
              {formatTry(summary.gross_result)}
            </p>
          </Card>

          <Card className="p-5">
            <p className="text-sm font-medium text-text-secondary">Net sonuç</p>
            <p
              className={`mt-3 text-2xl font-bold tracking-tight ${
                summary.net_result >= 0 ? "text-success" : "text-danger"
              }`}
            >
              {formatTry(summary.net_result)}
            </p>
          </Card>
        </div>
      )}

      {summary && (
        <p className="mb-6 text-xs text-text-secondary">
          Doğrudan ders gideri: {formatTry(summary.direct_expenses)} · Dolaylı (genel) gider:{" "}
          {formatTry(summary.indirect_expenses)} · Bu ay nakit ödenen:{" "}
          {formatTry(summary.expenses_paid_cash)}
        </p>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold text-text-primary">Kategori dağılımı</h2>

          {breakdown.length === 0 ? (
            <p className="text-sm text-text-secondary">Bu ay için masraf kaydı yok.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-3">Kategori</th>
                  <th className="py-2 pr-3 text-right">Planlı</th>
                  <th className="py-2 pr-3 text-right">Ödendi</th>
                  <th className="py-2 text-right">İptal</th>
                </tr>
              </thead>

              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.category_id} className="border-b border-border/60">
                    <td className="py-2 pr-3">{row.category_name}</td>
                    <td className="py-2 pr-3 text-right text-accent-strong">
                      {formatTry(row.planned_amount)}
                    </td>
                    <td className="py-2 pr-3 text-right text-success">
                      {formatTry(row.paid_amount)}
                    </td>
                    <td className="py-2 text-right text-text-secondary">
                      {formatTry(row.cancelled_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-text-primary">Masraf kategorileri</h2>

          {categoryList.length === 0 ? (
            <p className="mb-4 text-sm text-text-secondary">Henüz kategori yok.</p>
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {categoryList.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span>{category.name}</span>
                  {category.is_direct_course_cost && (
                    <StatusBadge label="Ders maliyeti" tone="neutral" />
                  )}
                </li>
              ))}
            </ul>
          )}

          <form action={createExpenseCategory} className="flex items-end gap-2">
            <label className="flex-1 text-xs font-medium text-text-secondary">
              Yeni kategori
              <input
                name="name"
                type="text"
                required
                minLength={2}
                placeholder="Ör. Kira"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="flex items-center gap-1.5 pb-2.5 text-xs text-text-secondary">
              <input type="checkbox" name="isDirectCourseCost" />
              Ders maliyeti
            </label>

            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
            >
              Ekle
            </button>
          </form>
        </Card>
      </div>

      <Card className="mb-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-text-primary">Tekrarlayan masraflar</h2>

        <p className="mb-4 text-xs leading-5 text-text-secondary">
          Her ay aynı tutarla tekrar eden masraflar (kira, abonelik vb.) için şablon tanımlayın;
          seçili ay için masrafları tek seferde oluşturun.
        </p>

        {templateList.length === 0 ? (
          <p className="mb-4 text-sm text-text-secondary">Henüz şablon yok.</p>
        ) : (
          <ul className="mb-4 divide-y divide-line">
            {templateList.map((template) => (
              <li
                key={template.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium text-text-primary">
                    {template.expense_categories?.name ?? "—"}
                    {template.vendor_name ? ` — ${template.vendor_name}` : ""}
                    {template.courses ? ` (${template.courses.name})` : ""}
                  </span>

                  <span className="ml-2 text-xs text-text-secondary">
                    {formatTry(template.amount)} · her ayın {template.due_day}. günü
                  </span>

                  {!template.is_active && <StatusBadge label="Pasif" tone="neutral" />}
                </div>

                <form action={setRecurringExpenseTemplateActive}>
                  <input type="hidden" name="templateId" value={template.id} />
                  <input type="hidden" name="isActive" value={(!template.is_active).toString()} />

                  <button
                    type="submit"
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                  >
                    {template.is_active ? "Pasife al" : "Aktifleştir"}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}

        <details className="mb-4">
          <summary className="cursor-pointer text-xs font-medium text-primary text-primary">
            Yeni şablon ekle
          </summary>

          <form action={createRecurringExpenseTemplate} className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium text-text-secondary">
              Kategori
              <select
                name="categoryId"
                required
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">Seçin</option>
                {categoryList.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Ders (opsiyonel — doğrudan ders maliyeti)
              <select
                name="courseId"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">—</option>
                {courseList.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Tutar
              <input
                name="amount"
                type="text"
                required
                placeholder="0.00"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Vade günü
              <input
                name="dueDay"
                type="number"
                min={1}
                max={28}
                required
                defaultValue={1}
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Tedarikçi
              <input
                name="vendorName"
                type="text"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="text-xs font-medium text-text-secondary">
              Ödeme yöntemi (opsiyonel)
              <select
                name="paymentMethod"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              >
                <option value="">—</option>
                <option value="cash">Nakit</option>
                <option value="bank_transfer">Havale</option>
                <option value="card">Kart</option>
                <option value="online">Online</option>
                <option value="other">Diğer</option>
              </select>
            </label>

            <div className="sm:col-span-2">
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
              >
                Şablon ekle
              </button>
            </div>
          </form>
        </details>

        <form
          action={generateMonthlyExpenses}
          className="flex items-end gap-2 border-t border-border pt-4"
        >
          <input type="hidden" name="month" value={month} />

          <p className="flex-1 text-xs leading-5 text-text-secondary">
            {month} ayı için aktif şablonlardan masraf oluştur. Aynı şablon için bu ay zaten
            oluşturulduysa mükerrer kayıt eklenmez.
          </p>

          <button
            type="submit"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
          >
            Bu ayın masraflarını oluştur
          </button>
        </form>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-text-primary">{month} masrafları</h2>

        {expenseRows.length === 0 ? (
          <p className="text-sm text-text-secondary">Bu ay için masraf kaydı yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4">Tarih</th>
                  <th className="py-2 pr-4">Kategori</th>
                  <th className="py-2 pr-4">Tedarikçi</th>
                  <th className="py-2 pr-4">Ders</th>
                  <th className="py-2 pr-4 text-right">Tutar</th>
                  <th className="py-2">Durum</th>
                </tr>
              </thead>

              <tbody>
                {expenseRows.map((expense) => (
                  <tr key={expense.id} className="border-b border-border/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-text-secondary">
                      {formatDate(expense.expense_date)}
                    </td>

                    <td className="py-3 pr-4">
                      <Link
                        href={`/giderler/${expense.id}`}
                        className="font-medium text-text-primary hover:underline"
                      >
                        {expense.expense_categories?.name ?? "—"}
                      </Link>
                    </td>

                    <td className="py-3 pr-4 text-text-secondary">{expense.vendor_name ?? "—"}</td>
                    <td className="py-3 pr-4 text-text-secondary">
                      {expense.courses?.name ?? "—"}
                    </td>

                    <td className="py-3 pr-4 text-right font-semibold text-text-primary">
                      {formatTry(expense.amount)}
                    </td>

                    <td className="py-3">
                      <StatusBadge
                        label={statusLabels[expense.status]}
                        tone={statusTones[expense.status]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function nextMonthStart(monthStart: string) {
  const [year, month] = monthStart.split("-").map(Number);
  const next =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return next;
}

function isMonthValue(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function getCurrentMonthInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .replace("/", "-");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00.000Z`));
}
