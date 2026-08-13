import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createExpense } from "../actions";

type NewExpensePageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function NewExpensePage({ searchParams }: NewExpensePageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const [{ data: categories }, { data: courses }] = await Promise.all([
    supabase.from("expense_categories").select("id, name").order("name"),
    supabase
      .from("courses")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .order("name"),
  ]);

  const categoryList = (categories ?? []) as { id: string; name: string }[];
  const courseList = (courses ?? []) as { id: string; name: string }[];

  return (
    <>
      <PageHeader title="Yeni Masraf" description="Planlı bir masraf kaydı oluşturun." />

      <SettingsAlert error={params.error} />

      <Card className="max-w-xl p-6">
        {categoryList.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Önce Giderler sayfasından en az bir masraf kategorisi ekleyin.
          </p>
        ) : (
          <form action={createExpense} className="space-y-4">
            <label className="block text-xs font-medium text-text-secondary">
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

            <label className="block text-xs font-medium text-text-secondary">
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

            <label className="block text-xs font-medium text-text-secondary">
              Tutar
              <input
                name="amount"
                type="text"
                required
                placeholder="0.00"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-text-secondary">
                Masraf tarihi
                <input
                  name="expenseDate"
                  type="date"
                  required
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>

              <label className="block text-xs font-medium text-text-secondary">
                Vade tarihi (opsiyonel)
                <input
                  name="dueDate"
                  type="date"
                  className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-text-secondary">
              Tedarikçi
              <input
                name="vendorName"
                type="text"
                className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <label className="block text-xs font-medium text-text-secondary">
              Not
              <textarea
                name="note"
                rows={3}
                className="mt-1 block w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
              />
            </label>

            <button
              type="submit"
              className="rounded-xl bg-primary shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring px-5 py-3 text-sm font-semibold text-on-primary transition hover:bg-primary-hover"
            >
              Masrafı oluştur
            </button>
          </form>
        )}
      </Card>
    </>
  );
}
