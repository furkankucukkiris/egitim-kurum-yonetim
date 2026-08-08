import { Card } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";

export default async function CashBankSettingsPage() {
  await requireRole(["admin"]);

  return (
    <Card className="max-w-xl p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-fill text-xl">
        ₺
      </div>

      <h2 className="mt-4 text-lg font-bold text-ink">Kasa &amp; Banka</h2>

      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
        Kasa ve banka hesap tanımları (nakit kasa, banka hesapları,
        yatırma kayıtları) yakında burada yönetilecek.
      </p>
    </Card>
  );
}
