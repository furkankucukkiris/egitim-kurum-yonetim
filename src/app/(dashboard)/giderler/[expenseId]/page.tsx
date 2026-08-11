import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import {
  cancelExpense,
  recordExpensePayment,
  updateExpenseDetails,
  uploadExpenseDocument,
} from "../actions";

const methodLabels: Record<string, string> = {
  cash: "Nakit",
  bank_transfer: "Havale",
  card: "Kart",
  online: "Online",
  other: "Diğer",
};

const statusLabels: Record<string, string> = {
  planned: "Planlı",
  paid: "Ödendi",
  cancelled: "İptal",
};

const statusTones: Record<string, BadgeTone> = {
  planned: "warning",
  paid: "success",
  cancelled: "danger",
};

type ExpenseDetail = {
  id: string;
  category_id: string;
  course_id: string | null;
  expense_date: string;
  due_date: string | null;
  paid_at: string | null;
  amount: number;
  status: "planned" | "paid" | "cancelled";
  vendor_name: string | null;
  payment_method: string | null;
  document_path: string | null;
  note: string | null;
  is_recurring: boolean;
  cancelled_at: string | null;
  cancel_reason: string | null;
  expense_categories: { name: string } | null;
  courses: { name: string } | null;
};

type PageProps = {
  params: Promise<{ expenseId: string }>;
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ExpenseDetailPage({ params, searchParams }: PageProps) {
  const profile = await requireRole(["admin"]);
  const { expenseId } = await params;
  const search = await searchParams;

  const supabase = await createClient();

  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .select(
      "id, category_id, course_id, expense_date, due_date, paid_at, amount, status, vendor_name, payment_method, document_path, note, is_recurring, cancelled_at, cancel_reason, expense_categories(name), courses(name)",
    )
    .eq("id", expenseId)
    .maybeSingle();

  if (expenseError) {
    console.error("Masraf alınamadı:", expenseError);
  }

  if (!expense) {
    notFound();
  }

  const expenseDetail = expense as unknown as ExpenseDetail;

  const [{ data: categories }, { data: courses }, { data: cashAccounts }] = await Promise.all([
    supabase.from("expense_categories").select("id, name").order("name"),
    supabase
      .from("courses")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .order("name"),
    supabase
      .from("cash_accounts")
      .select("id, name")
      .eq("organization_id", profile.organizationId)
      .eq("is_active", true)
      .order("name"),
  ]);

  const categoryList = (categories ?? []) as { id: string; name: string }[];
  const courseList = (courses ?? []) as { id: string; name: string }[];
  const cashAccountList = (cashAccounts ?? []) as { id: string; name: string }[];

  let documentUrl: string | null = null;

  if (expenseDetail.document_path) {
    const { data } = await supabase.storage
      .from("expense-documents")
      .createSignedUrl(expenseDetail.document_path, 60 * 10);

    documentUrl = data?.signedUrl ?? null;
  }

  return (
    <>
      <PageHeader
        title={expenseDetail.expense_categories?.name ?? "Masraf"}
        description={expenseDetail.vendor_name ?? "Masraf detayı"}
      />

      <div className="mb-6">
        <Link
          href="/giderler"
          className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-100"
        >
          ← Giderler
        </Link>
      </div>

      <SettingsAlert success={search.success} error={search.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-2xl font-bold text-ink">{formatTry(expenseDetail.amount)}</p>
            <StatusBadge label={statusLabels[expenseDetail.status]} tone={statusTones[expenseDetail.status]} />
          </div>

          <dl className="space-y-2 text-sm">
            <Row label="Kategori" value={expenseDetail.expense_categories?.name ?? "—"} />
            <Row label="Ders" value={expenseDetail.courses?.name ?? "—"} />
            <Row label="Tedarikçi" value={expenseDetail.vendor_name ?? "—"} />
            <Row label="Masraf tarihi" value={formatDate(expenseDetail.expense_date)} />
            <Row
              label="Vade tarihi"
              value={expenseDetail.due_date ? formatDate(expenseDetail.due_date) : "—"}
            />
            {expenseDetail.status === "paid" && (
              <>
                <Row label="Ödeme tarihi" value={formatDateTime(expenseDetail.paid_at!)} />
                <Row
                  label="Ödeme yöntemi"
                  value={
                    expenseDetail.payment_method
                      ? methodLabels[expenseDetail.payment_method] ?? expenseDetail.payment_method
                      : "—"
                  }
                />
              </>
            )}
            {expenseDetail.status === "cancelled" && (
              <>
                <Row label="İptal tarihi" value={formatDateTime(expenseDetail.cancelled_at!)} />
                <Row label="İptal gerekçesi" value={expenseDetail.cancel_reason ?? "—"} />
              </>
            )}
            {expenseDetail.is_recurring && <Row label="Kaynak" value="Tekrarlayan şablon" />}
            {expenseDetail.note && <Row label="Not" value={expenseDetail.note} />}
          </dl>

          <div className="mt-5 border-t border-line pt-4">
            <p className="mb-2 text-xs font-medium text-muted">Makbuz / fatura</p>

            {documentUrl && (
              <a
                href={documentUrl}
                target="_blank"
                rel="noreferrer"
                className="mb-2 inline-block text-xs font-medium text-brand-700 hover:underline dark:text-brand-100"
              >
                Mevcut belgeyi görüntüle
              </a>
            )}

            <form action={uploadExpenseDocument} encType="multipart/form-data" className="flex items-end gap-2">
              <input type="hidden" name="expenseId" value={expenseDetail.id} />

              <input
                name="document"
                type="file"
                accept="image/png,image/jpeg,image/webp,application/pdf"
                required
                className="block flex-1 text-xs text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-fill file:px-3 file:py-2 file:text-xs file:font-semibold file:text-brand-700 dark:file:text-brand-100"
              />

              <button
                type="submit"
                className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-ink transition hover:bg-fill"
              >
                Yükle
              </button>
            </form>
          </div>
        </Card>

        <div className="space-y-6">
          {expenseDetail.status === "planned" && (
            <>
              <Card className="p-6">
                <h2 className="mb-4 text-base font-semibold text-ink">Ödeme kaydet</h2>

                <form action={recordExpensePayment} className="space-y-4">
                  <input type="hidden" name="expenseId" value={expenseDetail.id} />

                  <label className="block text-xs font-medium text-muted">
                    Ödeme tarihi
                    <input
                      name="paidAt"
                      type="datetime-local"
                      required
                      defaultValue={new Date().toISOString().slice(0, 16)}
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <PaymentMethodField cashAccounts={cashAccountList} />

                  <button
                    type="submit"
                    className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
                  >
                    Ödemeyi kaydet
                  </button>
                </form>
              </Card>

              <Card className="p-6">
                <h2 className="mb-4 text-base font-semibold text-ink">Masrafı düzenle</h2>

                <form action={updateExpenseDetails} className="space-y-3">
                  <input type="hidden" name="expenseId" value={expenseDetail.id} />

                  <label className="block text-xs font-medium text-muted">
                    Kategori
                    <select
                      name="categoryId"
                      required
                      defaultValue={expenseDetail.category_id}
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    >
                      {categoryList.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-xs font-medium text-muted">
                    Ders (opsiyonel)
                    <select
                      name="courseId"
                      defaultValue={expenseDetail.course_id ?? ""}
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
                      defaultValue={expenseDetail.amount.toFixed(2)}
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
                        defaultValue={expenseDetail.expense_date}
                        className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                      />
                    </label>

                    <label className="block text-xs font-medium text-muted">
                      Vade tarihi
                      <input
                        name="dueDate"
                        type="date"
                        defaultValue={expenseDetail.due_date ?? ""}
                        className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                      />
                    </label>
                  </div>

                  <label className="block text-xs font-medium text-muted">
                    Tedarikçi
                    <input
                      name="vendorName"
                      type="text"
                      defaultValue={expenseDetail.vendor_name ?? ""}
                      className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <label className="block text-xs font-medium text-muted">
                    Not
                    <textarea
                      name="note"
                      rows={2}
                      defaultValue={expenseDetail.note ?? ""}
                      className="mt-1 block w-full resize-y rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                    />
                  </label>

                  <button
                    type="submit"
                    className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink transition hover:bg-fill"
                  >
                    Kaydet
                  </button>
                </form>
              </Card>
            </>
          )}

          {expenseDetail.status !== "cancelled" && (
            <Card className="p-6">
              <h2 className="mb-1 text-base font-semibold text-ink">Masrafı iptal et</h2>

              <p className="mb-4 text-xs leading-5 text-muted">
                {expenseDetail.status === "paid"
                  ? "Bu masraf ödenmiş — iptal edildiğinde bağlı kasa hareketi fiziksel olarak silinmez, ters yönlü yeni bir kayıtla dengelenir."
                  : "Bu masraf henüz ödenmedi."}
              </p>

              <form action={cancelExpense} className="space-y-3">
                <input type="hidden" name="expenseId" value={expenseDetail.id} />

                <label className="block text-xs font-medium text-muted">
                  Gerekçe
                  <input
                    name="reason"
                    type="text"
                    required
                    minLength={3}
                    className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                  />
                </label>

                <button
                  type="submit"
                  className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 transition hover:bg-rose-50 dark:border-rose-800/40 dark:text-rose-400 dark:hover:bg-rose-500/10"
                >
                  Masrafı iptal et
                </button>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function PaymentMethodField({ cashAccounts }: { cashAccounts: { id: string; name: string }[] }) {
  return (
    <>
      <label className="block text-xs font-medium text-muted">
        Ödeme yöntemi
        <select
          name="paymentMethod"
          required
          defaultValue="cash"
          className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
        >
          <option value="cash">Nakit</option>
          <option value="bank_transfer">Havale</option>
          <option value="card">Kart</option>
          <option value="online">Online</option>
          <option value="other">Diğer</option>
        </select>
      </label>

      {cashAccounts.length > 0 ? (
        <label className="block text-xs font-medium text-muted">
          Kasa hesabı (nakit ödemede zorunlu)
          <select
            name="cashAccountId"
            defaultValue=""
            className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
          >
            <option value="">—</option>
            {cashAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-xs text-rose-700 dark:text-rose-400">
          Nakit ödeme için önce Kurum Ayarları → Kasa &amp; Banka&apos;dan bir kasa
          hesabı ekleyin.
        </p>
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
