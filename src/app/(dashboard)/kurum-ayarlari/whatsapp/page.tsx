import { Card } from "@/components/ui/Card";
import { StatusBadge, type BadgeTone } from "@/components/ui/StatusBadge";
import { SettingsAlert } from "@/components/settings/SettingsAlert";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { updateWhatsappSettings } from "../actions";
import {
  approveMessage,
  cancelMessage,
  generateUpcomingPaymentReminders,
  retryMessage,
  sendMessage,
  updateMessageTemplate,
} from "./actions";

type WhatsappSettingsPageProps = {
  searchParams: Promise<{
    status?: string;
    success?: string;
    error?: string;
  }>;
};

type TemplateCode =
  | "payment_upcoming"
  | "payment_overdue"
  | "lesson_time_change"
  | "lesson_cancellation"
  | "makeup_scheduled"
  | "trial_reminder";

type Template = {
  id: string;
  code: TemplateCode;
  name: string;
  body_template: string;
  is_financial: boolean;
  is_active: boolean;
};

type MessageStatus = "pending_approval" | "approved" | "sending" | "sent" | "failed" | "cancelled";

type OutboundMessage = {
  id: string;
  event_type: TemplateCode;
  rendered_body: string;
  status: MessageStatus;
  created_at: string;
  cancellation_reason: string | null;
  students: { first_name: string; last_name: string } | null;
  guardians: { full_name: string } | null;
};

const templateOrder: TemplateCode[] = [
  "payment_upcoming",
  "payment_overdue",
  "lesson_time_change",
  "lesson_cancellation",
  "makeup_scheduled",
  "trial_reminder",
];

const eventTypeLabels: Record<TemplateCode, string> = {
  payment_upcoming: "Yaklaşan Ödeme",
  payment_overdue: "Gecikmiş Ödeme",
  lesson_time_change: "Ders Saati Değişikliği",
  lesson_cancellation: "Ders İptali",
  makeup_scheduled: "Telafi Dersi",
  trial_reminder: "Deneme Dersi",
};

const statusLabels: Record<MessageStatus, string> = {
  pending_approval: "Onay Bekliyor",
  approved: "Onaylandı",
  sending: "Gönderiliyor",
  sent: "Gönderildi",
  failed: "Başarısız",
  cancelled: "İptal",
};

const statusTones: Record<MessageStatus, BadgeTone> = {
  pending_approval: "warning",
  approved: "neutral",
  sending: "neutral",
  sent: "success",
  failed: "danger",
  cancelled: "neutral",
};

const statusFilters: { value: string; label: string }[] = [
  { value: "", label: "Tümü" },
  { value: "pending_approval", label: "Onay Bekliyor" },
  { value: "approved", label: "Onaylandı" },
  { value: "sent", label: "Gönderildi" },
  { value: "failed", label: "Başarısız" },
  { value: "cancelled", label: "İptal" },
];

export default async function WhatsappSettingsPage({ searchParams }: WhatsappSettingsPageProps) {
  const profile = await requireRole(["admin"]);
  const params = await searchParams;
  const status = params.status ?? "";

  const supabase = await createClient();

  const messagesQuery = supabase
    .from("outbound_messages")
    .select(
      "id, event_type, rendered_body, status, created_at, cancellation_reason, students(first_name, last_name), guardians(full_name)",
    )
    .eq("organization_id", profile.organizationId)
    .order("created_at", { ascending: false })
    .limit(50);

  const [
    { data: organization, error: organizationError },
    { data: templates, error: templatesError },
    { data: messages, error: messagesError },
  ] = await Promise.all([
    supabase
      .from("organizations")
      .select("whatsapp_reminder_day")
      .eq("id", profile.organizationId)
      .single(),
    supabase
      .from("message_templates")
      .select("id, code, name, body_template, is_financial, is_active")
      .eq("organization_id", profile.organizationId),
    status ? messagesQuery.eq("status", status) : messagesQuery,
  ]);

  if (organizationError) console.error("Kurum WhatsApp ayarları alınamadı:", organizationError);
  if (templatesError) console.error("Mesaj şablonları alınamadı:", templatesError);
  if (messagesError) console.error("Mesaj kuyruğu alınamadı:", messagesError);

  const templateList = ((templates ?? []) as unknown as Template[]).sort(
    (a, b) => templateOrder.indexOf(a.code) - templateOrder.indexOf(b.code),
  );
  const messageList = (messages ?? []) as unknown as OutboundMessage[];

  const currentMonth = getCurrentMonthInIstanbul();

  return (
    <>
      <SettingsAlert success={params.success} error={params.error} />

      <Card className="mb-6 max-w-xl p-6">
        <h2 className="mb-1 text-base font-semibold text-text-primary">Hatırlatma günü</h2>

        <p className="mb-5 text-xs leading-5 text-text-secondary">
          Aşağıdaki &quot;Taslak oluştur&quot; butonu şimdilik elle çalıştırılıyor; bu gün bilgisi
          ileride otomatik çalıştırma eklendiğinde kullanılacak.
        </p>

        <form action={updateWhatsappSettings} className="flex items-end gap-3">
          <label className="text-sm font-medium">
            Her ayın
            <input
              name="reminderDay"
              type="number"
              min={1}
              max={28}
              required
              defaultValue={organization?.whatsapp_reminder_day ?? 15}
              className="mx-2 w-20 rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
            günü
          </label>

          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary shadow-sm transition hover:bg-primary-hover"
          >
            Kaydet
          </button>
        </form>
      </Card>

      <Card className="mb-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-text-primary">Mesaj şablonları</h2>

        <p className="mb-5 text-xs leading-5 text-text-secondary">
          Her olay türü için gönderilecek mesaj metnini düzenleyin. Kullanılabilecek yer tutucular
          şablona göre değişir — örn. {"{veli_adi}"}, {"{ogrenci_adi}"}, {"{ay_yili}"}, {"{tutar}"},{" "}
          {"{kurum_adi}"}, {"{tarih}"}, {"{saat}"}.
        </p>

        <div className="space-y-4">
          {templateList.map((template) => (
            <details key={template.id} className="rounded-xl border border-border p-4">
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-text-primary">
                <span className="flex items-center gap-2">
                  {template.name}
                  <StatusBadge
                    label={template.is_financial ? "Finansal" : "Bilgilendirme"}
                    tone={template.is_financial ? "warning" : "neutral"}
                  />
                  {!template.is_active && <StatusBadge label="Pasif" tone="neutral" />}
                </span>
              </summary>

              <form action={updateMessageTemplate} className="mt-4 space-y-3">
                <input type="hidden" name="templateId" value={template.id} />

                <textarea
                  name="bodyTemplate"
                  rows={4}
                  required
                  minLength={10}
                  defaultValue={template.body_template}
                  className="w-full resize-y rounded-xl border border-border bg-surface px-4 py-3 text-sm outline-none transition focus:border-primary"
                />

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      name="isActive"
                      defaultChecked={template.is_active}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-focus-ring"
                    />
                    Aktif
                  </label>

                  <button
                    type="submit"
                    className="rounded-lg border border-border px-4 py-2 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                  >
                    Kaydet
                  </button>
                </div>
              </form>
            </details>
          ))}
        </div>
      </Card>

      <Card className="mb-6 p-6">
        <h2 className="mb-1 text-base font-semibold text-text-primary">
          Yaklaşan ödeme hatırlatmaları
        </h2>

        <p className="mb-4 text-xs leading-5 text-text-secondary">
          Seçilen ay için bekleyen aidat tahakkuku olan, finansal mesaj almayı kabul etmiş velilere
          taslak hatırlatma oluşturur. Hiçbir mesaj otomatik gönderilmez — önce burada onaylamanız,
          sonra göndermeniz gerekir.
        </p>

        <form action={generateUpcomingPaymentReminders} className="flex items-end gap-2">
          <label className="text-xs font-medium text-text-secondary">
            Ay
            <input
              name="month"
              type="month"
              defaultValue={currentMonth}
              className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition focus:border-primary"
            />
          </label>

          <button
            type="submit"
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-primary transition hover:bg-surface-muted"
          >
            Taslak oluştur
          </button>
        </form>
      </Card>

      <Card className="p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text-primary">Mesaj kuyruğu</h2>

          <div className="flex flex-wrap gap-2">
            {statusFilters.map((filter) => (
              <a
                key={filter.value}
                href={
                  filter.value
                    ? `/kurum-ayarlari/whatsapp?status=${filter.value}`
                    : "/kurum-ayarlari/whatsapp"
                }
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                  status === filter.value
                    ? "bg-primary text-on-primary"
                    : "border border-border text-text-primary hover:bg-surface-muted"
                }`}
              >
                {filter.label}
              </a>
            ))}
          </div>
        </div>

        {messageList.length === 0 ? (
          <p className="text-sm text-text-secondary">Bu filtrede mesaj yok.</p>
        ) : (
          <div className="space-y-3">
            {messageList.map((message) => (
              <details key={message.id} className="rounded-xl border border-border p-4">
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="font-medium text-text-primary">
                      {message.guardians?.full_name ?? "—"}
                    </span>{" "}
                    <span className="text-text-secondary">
                      (
                      {message.students
                        ? `${message.students.first_name} ${message.students.last_name}`
                        : "—"}
                      )
                    </span>{" "}
                    <span className="text-xs text-text-secondary">
                      · {eventTypeLabels[message.event_type]} · {formatDateTime(message.created_at)}
                    </span>
                  </span>

                  <StatusBadge
                    label={statusLabels[message.status]}
                    tone={statusTones[message.status]}
                  />
                </summary>

                <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface-muted p-3 text-xs text-text-primary">
                  {message.rendered_body}
                </p>

                {message.status === "cancelled" && message.cancellation_reason && (
                  <p className="mt-2 text-xs text-text-secondary">
                    Gerekçe: {message.cancellation_reason}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {message.status === "pending_approval" && (
                    <>
                      <form action={approveMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                        >
                          Onayla
                        </button>
                      </form>

                      <form action={cancelMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                        >
                          İptal et
                        </button>
                      </form>
                    </>
                  )}

                  {message.status === "approved" && (
                    <>
                      <form action={sendMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:bg-primary-hover"
                        >
                          Gönder
                        </button>
                      </form>

                      <form action={cancelMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                        >
                          İptal et
                        </button>
                      </form>
                    </>
                  )}

                  {message.status === "failed" && (
                    <>
                      <form action={retryMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                        >
                          Tekrar dene
                        </button>
                      </form>

                      <form action={cancelMessage}>
                        <input type="hidden" name="messageId" value={message.id} />
                        <input type="hidden" name="status" value={status} />
                        <button
                          type="submit"
                          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary transition hover:bg-surface-muted"
                        >
                          İptal et
                        </button>
                      </form>
                    </>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </Card>
    </>
  );
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}
