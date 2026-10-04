import { PageHeader } from "@/components/page-header";
import { PushDeviceControl } from "@/components/notifications/PushDeviceControl";
import { SubmitButton } from "@/components/submit-button";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveNotificationSettings } from "./actions";

type PageProps = {
  searchParams: Promise<{
    success?: string;
    error?: string;
  }>;
};

type SettingsRow = {
  lesson_reminder: boolean;
  attendance_reminder: boolean;
  request_updates: boolean;
};

type DeviceRow = {
  id: string;
  user_agent: string | null;
  created_at: string;
  last_success_at: string | null;
};

export default async function NotificationsPage({ searchParams }: PageProps) {
  const profile = await requireProfile();
  const params = await searchParams;
  const isTeacher = profile.role === "teacher";

  const supabase = await createClient();

  const [settingsResult, devicesResult] = await Promise.all([
    supabase
      .from("notification_settings")
      .select("lesson_reminder, attendance_reminder, request_updates")
      .eq("profile_id", profile.id)
      .maybeSingle(),
    supabase
      .from("push_subscriptions")
      .select("id, user_agent, created_at, last_success_at")
      .eq("profile_id", profile.id)
      .order("created_at", { ascending: false }),
  ]);

  if (settingsResult.error) {
    console.error("Bildirim tercihleri alınamadı:", settingsResult.error);
  }

  if (devicesResult.error) {
    console.error("Bildirim cihazları alınamadı:", devicesResult.error);
  }

  // Satır yoksa hepsi açık sayılır (veritabanındaki varsayılanla aynı).
  const settings: SettingsRow = (settingsResult.data as SettingsRow | null) ?? {
    lesson_reminder: true,
    attendance_reminder: true,
    request_updates: true,
  };

  const devices = (devicesResult.data ?? []) as DeviceRow[];

  const options = [
    ...(isTeacher
      ? [
          {
            name: "lessonReminder",
            checked: settings.lesson_reminder,
            label: "Ders hatırlatması",
            hint: "Dersiniz başlamadan 10 dakika önce.",
          },
          {
            name: "attendanceReminder",
            checked: settings.attendance_reminder,
            label: "Yoklama hatırlatması",
            hint: "Ders bitiminden 15 dakika sonra yoklama hâlâ alınmamışsa.",
          },
        ]
      : []),
    {
      name: "requestUpdates",
      checked: settings.request_updates,
      label: "Notlar & Talepler",
      hint: isTeacher
        ? "Yönetici notunuza yanıt verdiğinde veya notu kapattığında."
        : "Öğretmen yeni not yazdığında veya notuna ekleme yaptığında.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Bildirimler"
        description="Telefonunuza veya bilgisayarınıza gelecek bildirimleri yönetin."
      />

      {params.success && (
        <div className="mb-5 rounded-2xl border border-success/30 bg-success-soft p-4 text-sm text-success">
          {params.success}
        </div>
      )}

      {params.error && (
        <div className="mb-5 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
          {params.error}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-semibold text-text-primary">Bu cihaz</h3>
          <PushDeviceControl />

          <p className="mt-5 text-xs text-text-secondary">
            Bildirimler hesabınızda kayıtlı {devices.length} cihaza gönderilir
            {devices.length > 0 &&
              ` (son kayıt: ${formatDate(devices[0].created_at)}${
                devices[0].last_success_at
                  ? `, son başarılı gönderim: ${formatDate(devices[0].last_success_at)}`
                  : ""
              })`}
            . Her telefon veya tarayıcı için ayrı ayrı açmanız gerekir.
          </p>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-5">
          <h3 className="mb-3 font-semibold text-text-primary">Hangi bildirimler gelsin?</h3>

          <form action={saveNotificationSettings} className="space-y-3">
            {/* Yöneticide gösterilmeyen tercihler mevcut değeriyle korunur. */}
            {!isTeacher && settings.lesson_reminder && (
              <input type="hidden" name="lessonReminder" value="on" />
            )}
            {!isTeacher && settings.attendance_reminder && (
              <input type="hidden" name="attendanceReminder" value="on" />
            )}

            {options.map((option) => (
              <label
                key={option.name}
                className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-surface-hover"
              >
                <input
                  type="checkbox"
                  name={option.name}
                  defaultChecked={option.checked}
                  className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                />
                <span>
                  <span className="block text-sm font-medium text-text-primary">
                    {option.label}
                  </span>
                  <span className="block text-xs text-text-secondary">{option.hint}</span>
                </span>
              </label>
            ))}

            <SubmitButton>Kaydet</SubmitButton>
          </form>
        </section>
      </div>
    </>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
