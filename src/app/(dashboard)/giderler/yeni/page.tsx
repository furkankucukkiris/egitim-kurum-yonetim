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
          <p className="text-sm text-muted">
            Önce Giderler sayfasından en az bir masraf kategorisi ekleyin.
          </p>
        ) : (
          <form action={createExpense} className="space-y-4">
            <label className="block text-xs font-medium text-muted">
              Kategori
              <select
                name="categoryId"
                required
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              >
                <option value="">Seçin</option>
                {categoryList.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-muted">
              Ders (opsiyonel — doğrudan ders maliyeti)
              <select
                name="courseId"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              >
                <option value="">—</option>
                {courseList.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-muted">
              Tutar
              <input
                name="amount"
                type="text"
                required
                placeholder="0.00"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs font-medium text-muted">
                Masraf tarihi
                <input
                  name="expenseDate"
                  type="date"
                  required
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>

              <label className="block text-xs font-medium text-muted">
                Vade tarihi (opsiyonel)
                <input
                  name="dueDate"
                  type="date"
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-muted">
              Tedarikçi
              <input
                name="vendorName"
                type="text"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <label className="block text-xs font-medium text-muted">
              Not
              <textarea
                name="note"
                rows={3}
                className="mt-1 block w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <button
              type="submit"
              className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
            >
              Masrafı oluştur
            </button>
          </form>
        )}
      </Card>
    </>
  );
}
