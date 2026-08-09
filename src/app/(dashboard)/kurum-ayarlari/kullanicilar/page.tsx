import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { requireRole } from "@/lib/auth";

export default async function UserAccountsSettingsPage() {
  await requireRole(["admin"]);

  return (
    <Card className="max-w-xl p-8 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-fill text-xl">
        ◇
      </div>

      <h2 className="mt-4 text-lg font-bold text-ink">Kullanıcı Hesapları</h2>

      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
        Sistemde yalnızca yönetici ve öğretmen rolleri kullanılır. Öğretmen
        hesapları{" "}
        <Link href="/ogretmenler" className="font-semibold text-brand-700 underline underline-offset-4 dark:text-brand-100">
          Öğretmenler
        </Link>{" "}
        sayfasından yönetilir; yeni yönetici hesabı yalnızca Supabase
        Dashboard üzerinden oluşturulabilir.
      </p>
    </Card>
  );
}
