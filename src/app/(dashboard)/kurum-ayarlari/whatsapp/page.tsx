import { Card } from "@/components/ui/Card";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateWhatsappSettings } from "../actions";

type WhatsappSettingsPageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

export default async function WhatsappSettingsPage({
  searchParams,
}: WhatsappSettingsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;

  const supabase = await createClient();

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("whatsapp_reminder_day, whatsapp_reminder_template")
    .eq("id", profile.organizationId)
    .single();

  if (error) {
    console.error("WhatsApp ayarları alınamadı:", error);
  }

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <div className="mb-5 rounded-2xl border border-honey-100 bg-honey-50 dark:bg-honey-500/10 p-4 text-sm text-honey-700 dark:text-honey-500">
        Otomatik gönderim henüz aktif değil — burada sadece mesaj
        şablonunu ve gönderim gününü hazırlıyoruz. Gönderim özelliği
        ayrıca eklenecek.
      </div>

      <Card className="max-w-xl p-6">
        <form action={updateWhatsappSettings} className="space-y-5">
          <label className="block text-sm font-medium">
            Hatırlatmanın gönderileceği gün

            <input
              name="reminderDay"
              type="number"
              min={1}
              max={28}
              required
              defaultValue={organization?.whatsapp_reminder_day ?? 15}
              className="mt-2 w-32 rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />

            <span className="mt-2 block text-xs leading-5 text-muted">
              Her ayın bu gününde, bekleyen ödemesi olan velilere
              gönderilecek (1-28 arası).
            </span>
          </label>

          <label className="block text-sm font-medium">
            Mesaj şablonu

            <textarea
              name="template"
              rows={6}
              required
              defaultValue={organization?.whatsapp_reminder_template ?? ""}
              className="mt-2 w-full resize-y rounded-xl border border-line bg-panel px-4 py-3 text-sm outline-none transition focus:border-terra-500"
            />

            <span className="mt-2 block text-xs leading-5 text-muted">
              Kullanılabilecek yer tutucular: {"{veli_adi}"}, {"{ogrenci_adi}"},{" "}
              {"{ay_yili}"}, {"{tutar}"}, {"{kurum_adi}"}. Gönderim
              başladığında bu yer tutucular ilgili öğrenci/veli
              bilgileriyle otomatik doldurulacak.
            </span>
          </label>

          <button
            type="submit"
            className="rounded-xl bg-terra-700 shadow-sm shadow-terra-700/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-terra-500/50 px-5 py-3 text-sm font-semibold text-white transition hover:bg-terra-700/90"
          >
            Kaydet
          </button>
        </form>
      </Card>
    </>
  );
}
