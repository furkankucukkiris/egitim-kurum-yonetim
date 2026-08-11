import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatTry } from "@/lib/utils";
import {
  createBankAccount,
  createCashAccount,
  setBankAccountActive,
  setCashAccountActive,
} from "./actions";

type CashBankPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type CashAccount = {
  id: string;
  name: string;
  is_active: boolean;
};

type BankAccount = {
  id: string;
  bank_name: string;
  account_name: string | null;
  iban: string | null;
  is_active: boolean;
};

type BankDepositRow = {
  id: string;
  deposited_at: string;
  amount: number;
  receipt_path: string | null;
  cash_accounts: { name: string } | null;
  bank_accounts: { bank_name: string; account_name: string | null } | null;
};

export default async function CashBankSettingsPage({
  searchParams,
}: CashBankPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const [
    { data: cashAccounts, error: cashAccountsError },
    { data: bankAccounts, error: bankAccountsError },
    { data: recentDeposits, error: depositsError },
  ] = await Promise.all([
    supabase
      .from("cash_accounts")
      .select("id, name, is_active")
      .order("name"),
    supabase
      .from("bank_accounts")
      .select("id, bank_name, account_name, iban, is_active")
      .order("bank_name"),
    supabase
      .from("bank_deposits")
      .select(
        "id, deposited_at, amount, receipt_path, cash_accounts(name), bank_accounts(bank_name, account_name)",
      )
      .order("deposited_at", { ascending: false })
      .limit(10),
  ]);

  if (cashAccountsError) console.error("Kasa hesapları alınamadı:", cashAccountsError);
  if (bankAccountsError) console.error("Banka hesapları alınamadı:", bankAccountsError);
  if (depositsError) console.error("Yatırımlar alınamadı:", depositsError);

  const accounts = (cashAccounts ?? []) as CashAccount[];
  const banks = (bankAccounts ?? []) as BankAccount[];
  const deposits = (recentDeposits ?? []) as unknown as BankDepositRow[];

  const balances = await Promise.all(
    accounts.map(async (account) => {
      const [{ data: balance }, { data: undeposited }] = await Promise.all([
        supabase.rpc("get_cash_account_balance", { p_cash_account_id: account.id }),
        supabase.rpc("get_undeposited_cash_movements", { p_cash_account_id: account.id }),
      ]);

      const undepositedTotal = ((undeposited ?? []) as { amount: number }[]).reduce(
        (sum, row) => sum + Number(row.amount),
        0,
      );

      return {
        accountId: account.id,
        balance: Number(balance ?? 0),
        undepositedTotal,
      };
    }),
  );

  const receiptUrls = await getReceiptUrls(
    supabase,
    deposits.map((deposit) => deposit.receipt_path),
  );

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Kasa Hesapları</h2>

          {accounts.length === 0 ? (
            <p className="mb-4 text-sm text-muted">Henüz kasa hesabı yok.</p>
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {accounts.map((account) => {
                const info = balances.find((b) => b.accountId === account.id);

                return (
                  <li key={account.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <Link
                        href={`/kurum-ayarlari/kasa-banka/${account.id}`}
                        className="font-medium text-ink hover:underline"
                      >
                        {account.name}
                      </Link>

                      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                        <span>Bakiye: {formatTry(info?.balance ?? 0)}</span>

                        {info && info.undepositedTotal > 0 && (
                          <span className="text-honey-700 dark:text-honey-500">
                            · Yatırılmayı bekleyen: {formatTry(info.undepositedTotal)}
                          </span>
                        )}

                        {!account.is_active && <StatusBadge label="Pasif" tone="neutral" />}
                      </div>
                    </div>

                    <form action={setCashAccountActive}>
                      <input type="hidden" name="cashAccountId" value={account.id} />
                      <input type="hidden" name="isActive" value={(!account.is_active).toString()} />

                      <button
                        type="submit"
                        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                      >
                        {account.is_active ? "Pasife al" : "Aktifleştir"}
                      </button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}

          <form action={createCashAccount} className="flex items-end gap-2">
            <label className="flex-1 text-xs font-medium text-muted">
              Yeni kasa hesabı
              <input
                name="name"
                type="text"
                required
                minLength={2}
                placeholder="Ör. Ana Kasa"
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
              />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
            >
              Ekle
            </button>
          </form>
        </Card>

        <Card className="p-6">
          <h2 className="mb-4 text-base font-semibold text-ink">Banka Hesapları</h2>

          {banks.length === 0 ? (
            <p className="mb-4 text-sm text-muted">Henüz banka hesabı yok.</p>
          ) : (
            <ul className="mb-4 divide-y divide-line">
              {banks.map((bank) => (
                <li key={bank.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium text-ink">
                      {bank.bank_name}
                      {bank.account_name ? ` — ${bank.account_name}` : ""}
                    </p>

                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      {bank.iban && <span className="font-mono">{bank.iban}</span>}
                      {!bank.is_active && <StatusBadge label="Pasif" tone="neutral" />}
                    </div>
                  </div>

                  <form action={setBankAccountActive}>
                    <input type="hidden" name="bankAccountId" value={bank.id} />
                    <input type="hidden" name="isActive" value={(!bank.is_active).toString()} />

                    <button
                      type="submit"
                      className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-fill"
                    >
                      {bank.is_active ? "Pasife al" : "Aktifleştir"}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={createBankAccount} className="space-y-2">
            <div className="flex gap-2">
              <label className="flex-1 text-xs font-medium text-muted">
                Banka adı
                <input
                  name="bankName"
                  type="text"
                  required
                  minLength={2}
                  placeholder="Ör. Ziraat Bankası"
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>

              <label className="flex-1 text-xs font-medium text-muted">
                Hesap adı
                <input
                  name="accountName"
                  type="text"
                  placeholder="Ör. Kurum Cari"
                  className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none transition focus:border-terra-500"
                />
              </label>
            </div>

            <label className="block text-xs font-medium text-muted">
              IBAN
              <input
                name="iban"
                type="text"
                placeholder="TR.."
                className="mt-1 block w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm font-mono outline-none transition focus:border-terra-500"
              />
            </label>

            <button
              type="submit"
              className="rounded-lg bg-terra-700 px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-terra-700/20 transition hover:bg-terra-700/90"
            >
              Ekle
            </button>
          </form>
        </Card>
      </div>

      <Card className="mt-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-ink">Son Banka Yatırımları</h2>

        <p className="mb-4 text-xs leading-5 text-muted">
          Yeni yatırım oluşturmak için kasa hesabının detay sayfasına gidin.
        </p>

        {deposits.length === 0 ? (
          <p className="text-sm text-muted">Henüz bir yatırım kaydı yok.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-4">Tarih</th>
                  <th className="py-2 pr-4">Kasa</th>
                  <th className="py-2 pr-4">Banka</th>
                  <th className="py-2 pr-4">Tutar</th>
                  <th className="py-2 pr-4">Makbuz</th>
                </tr>
              </thead>

              <tbody>
                {deposits.map((deposit) => (
                  <tr key={deposit.id} className="border-b border-line/60">
                    <td className="py-3 pr-4 whitespace-nowrap text-xs text-muted">
                      {formatDate(deposit.deposited_at)}
                    </td>

                    <td className="py-3 pr-4">{deposit.cash_accounts?.name ?? "—"}</td>

                    <td className="py-3 pr-4">
                      {deposit.bank_accounts?.bank_name}
                      {deposit.bank_accounts?.account_name
                        ? ` — ${deposit.bank_accounts.account_name}`
                        : ""}
                    </td>

                    <td className="py-3 pr-4 font-semibold text-ink">
                      {formatTry(deposit.amount)}
                    </td>

                    <td className="py-3 pr-4">
                      {deposit.receipt_path && receiptUrls[deposit.receipt_path] ? (
                        <a
                          href={receiptUrls[deposit.receipt_path]}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-brand-700 hover:underline dark:text-brand-100"
                        >
                          Görüntüle
                        </a>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        Kurum: {profile.organizationName} — kasa hareketleri ve sayım/düzeltme
        için bir kasa hesabına tıklayın.
      </p>
    </>
  );
}

async function getReceiptUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: (string | null)[],
) {
  const uniquePaths = [...new Set(paths.filter((path): path is string => Boolean(path)))];

  if (uniquePaths.length === 0) {
    return {};
  }

  const urls: Record<string, string> = {};

  await Promise.all(
    uniquePaths.map(async (path) => {
      const { data } = await supabase.storage
        .from("bank-deposit-receipts")
        .createSignedUrl(path, 60 * 10);

      if (data?.signedUrl) {
        urls[path] = data.signedUrl;
      }
    }),
  );

  return urls;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "medium",
  }).format(new Date(value));
}
