import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/Card";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import {
  createBankDeposit,
  recordCashCountAdjustment,
  reverseCashMovement,
} from "../actions";

const PAGE_SIZE = 20;

const movementTypeLabels: Record<string, string> = {
  cash_in: "Nakit Girişi",
  cash_out: "Nakit Çıkışı",
  bank_deposit: "Banka Yatırımı",
  correction: "Düzeltme",
};

type UndepositedMovement = {
  id: string;
  amount: number;
  occurred_at: string;
  note: string | null;
};

type BankAccount = {
  id: string;
  bank_name: string;
  account_name: string | null;
};

type LedgerRow = {
  id: string;
  movement_type: string;
  amount: number;
  direction: number;
  occurred_at: string;
  note: string | null;
  reverses_movement_id: string | null;
  is_deposited: boolean;
  running_balance: number;
  total_count: number;
};

type PageProps = {
  params: Promise<{ cashAccountId: string }>;
  searchParams: Promise<{
    success?: string;
    error?: string;
    page?: string;
  }>;
};

export default async function CashAccountDetailPage({ params, searchParams }: PageProps) {
  await requireRole(["admin"]);

  const { cashAccountId } = await params;
  const search = await searchParams;
  const page = Math.max(1, Number(search.page) || 1);

  const supabase = await createClient();

  const { data: cashAccount, error: cashAccountError } = await supabase
    .from("cash_accounts")
    .select("id, name, is_active")
    .eq("id", cashAccountId)
    .maybeSingle();

  if (cashAccountError) {
    console.error("Kasa hesabı alınamadı:", cashAccountError);
  }

  if (!cashAccount) {
    notFound();
  }

  const [
    { data: balance },
    { data: undeposited, error: undepositedError },
    { data: bankAccounts, error: bankAccountsError },
    { data: ledgerRows, error: ledgerError },
  ] = await Promise.all([
    supabase.rpc("get_cash_account_balance", { p_cash_account_id: cashAccountId }),
    supabase.rpc("get_undeposited_cash_movements", { p_cash_account_id: cashAccountId }),
    supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name")
      .eq("is_active", true)
      .order("bank_name"),
    supabase.rpc("get_cash_movements", {
      p_cash_account_id: cashAccountId,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
  ]);

  if (undepositedError) console.error("Bekleyen hareketler alınamadı:", undepositedError);
  if (bankAccountsError) console.error("Banka hesapları alınamadı:", bankAccountsError);
  if (ledgerError) console.error("Kasa hareketleri alınamadı:", ledgerError);

  const undepositedMovements = (undeposited ?? []) as UndepositedMovement[];
  const banks = (bankAccounts ?? []) as BankAccount[];
  const ledger = (ledgerRows ?? []) as LedgerRow[];
  const totalCount = ledger[0]?.total_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const undepositedTotal = undepositedMovements.reduce((sum, row) => sum + Number(row.amount), 0);

  return (
    <>
      <PageHeader
        title={cashAccount.name}
        description="Kasa hareketleri, banka yatırımı oluşturma ve sayım/düzeltme."
      />

      <div className="mb-6">
        <Link
          href="/kurum-ayarlari/kasa-banka"
          className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-100"
        >
          ← Kasa &amp; Banka
        </Link>
      </div>

      <SettingsAlert success={search.success} error={search.error} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs text-muted">Güncel bakiye</p>
          <p className="mt-1 text-2xl font-bold text-ink">{formatTry(Number(balance ?? 0))}</p>
        </Card>

        <Card className="p-5">
          <p className="text-xs text-muted">Yatırılmayı bekleyen nakit</p>
          <p className="mt-1 text-2xl font-bold text-honey-700 dark:text-honey-500">
            {formatTry(undepositedTotal)}
          </p>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-ink">Banka/ATM yatırımı oluştur</h2>

          <p className="mb-4 text-xs leading-5 text-muted">
            Yatırıma dahil edilecek hareketleri seçin — seçilen tutarların
            toplamı yatırım tutarı olur.
          </p>

          {banks.length === 0 ? (
            <p className="text-sm text-muted">
              Önce en az bir aktif banka hesabı ekleyin.
            </p>
          ) : undepositedMovements.length === 0 ? (
            <p className="text-sm text-muted">Yatırılmayı bekleyen nakit hareketi yok.</p>
          ) : (
            <form action={createBankDeposit} className="space-y-4" encType="multipart/form-data">
              <input type="hidden" name="cashAccountId" value={cashAccountId} />

              <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
                {undepositedMovements.map((movement) => (
                  <label
                    key={movement.id}
                    className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-sm last:border-b-0 hover:bg-fill"
                  >
                    <span className="flex items-center gap-2">
                      <input type="checkbox" name="movementIds" value={movement.id} />
                      <span>
                        {formatDate(movement.occurred_at)}
                        {movement.note ? ` — ${movement.note}` : ""}
                      </span>
                    </span>

                    <span className="font-semibold text-ink">{formatTry(movement.amount)}</span>
                  </label>
                ))}
              </div>

              <label className="block text-xs font-medium text-muted">
                Banka hesabı
                <select
                  name="bankAccountId"
                  required
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                >
                  {banks.map((bank) => (
                    <option key={bank.id} value={bank.id}>
                      {bank.bank_name}
                      {bank.account_name ? ` — ${bank.account_name}` : ""}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs font-medium text-muted">
                Yatırım tarihi
                <input
                  name="depositedAt"
                  type="datetime-local"
                  required
                  defaultValue={new Date().toISOString().slice(0, 16)}
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>

              <label className="block text-xs font-medium text-muted">
                Makbuz (opsiyonel)
                <input
                  name="receipt"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,application/pdf"
                  className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-fill file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 dark:file:text-brand-100"
                />
              </label>

              <label className="block text-xs font-medium text-muted">
                Not
                <input
                  name="note"
                  type="text"
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>

              <button
                type="submit"
                className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
              >
                Yatırımı kaydet
              </button>
            </form>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 text-base font-semibold text-ink">Kasa sayımı</h2>

          <p className="mb-4 text-xs leading-5 text-muted">
            Fiziksel sayım defterden farklıysa fark otomatik olarak düzeltme
            hareketi eklenir.
          </p>

          <form action={recordCashCountAdjustment} className="space-y-4">
            <input type="hidden" name="cashAccountId" value={cashAccountId} />

            <label className="block text-xs font-medium text-muted">
              Sayılan tutar
              <input
                name="countedAmount"
                type="text"
                required
                placeholder="0.00"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <label className="block text-xs font-medium text-muted">
              Açıklama
              <input
                name="reason"
                type="text"
                required
                minLength={3}
                placeholder="Ör. Aylık kasa sayımı"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
            >
              Sayımı kaydet
            </button>
          </form>
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-ink">Hareket geçmişi</h2>

        {ledger.length === 0 ? (
          <p className="text-sm text-muted">Henüz bir hareket yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Tarih</th>
                  <th className="py-2 pr-4">Tür</th>
                  <th className="py-2 pr-4">Not</th>
                  <th className="py-2 pr-4 text-right">Tutar</th>
                  <th className="py-2 pr-4 text-right">Bakiye</th>
                  <th className="py-2" />
                </tr>
              </thead>

              <tbody>
                {ledger.map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">
                      {formatDate(row.occurred_at)}
                    </td>

                    <td className="py-3 pr-4">
                      {movementTypeLabels[row.movement_type] ?? row.movement_type}
                      {row.is_deposited && (
                        <span className="ml-1.5 text-xs text-muted">(yatırıldı)</span>
                      )}
                      {row.reverses_movement_id && (
                        <span className="ml-1.5 text-xs text-muted">(ters kayıt)</span>
                      )}
                    </td>

                    <td className="py-3 pr-4 text-muted">{row.note ?? "—"}</td>

                    <td
                      className={`py-3 pr-4 text-right font-semibold ${
                        row.direction === 1
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {row.direction === 1 ? "+" : "-"}
                      {formatTry(row.amount)}
                    </td>

                    <td className="py-3 pr-4 text-right text-ink">
                      {formatTry(row.running_balance)}
                    </td>

                    <td className="py-3 text-right">
                      <form
                        action={reverseCashMovement}
                        className="flex items-center justify-end gap-1.5"
                      >
                        <input type="hidden" name="cashAccountId" value={cashAccountId} />
                        <input type="hidden" name="movementId" value={row.id} />

                        <input
                          name="reason"
                          type="text"
                          required
                          minLength={3}
                          placeholder="Gerekçe"
                          className="w-28 rounded-lg border border-line bg-panel px-2 py-1.5 text-xs outline-none transition focus:border-terra-500"
                        />

                        <button
                          type="submit"
                          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                        >
                          Ters kayıt
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted">
            <span>
              Sayfa {page} / {totalPages}
            </span>

            <div className="flex gap-2">
              {page > 1 && (
                <Link
                  href={`/kurum-ayarlari/kasa-banka/${cashAccountId}?page=${page - 1}`}
                  className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink transition hover:bg-fill"
                >
                  Önceki
                </Link>
              )}

              {page < totalPages && (
                <Link
                  href={`/kurum-ayarlari/kasa-banka/${cashAccountId}?page=${page + 1}`}
                  className="rounded-lg border border-line px-3 py-1.5 font-medium text-ink transition hover:bg-fill"
                >
                  Sonraki
                </Link>
              )}
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
