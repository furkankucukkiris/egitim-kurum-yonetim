import "server-only";

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

type ClaimedNotification = {
  id: string;
  title: string;
  body: string;
  url: string;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

export type DispatchResult = {
  claimed: number;
  delivered: number;
  failed: number;
};

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return true;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  // Push servisleri (Google/Apple) sorun olursa bu adrese bakar; kişisel
  // e-posta yerine uygulama adresi kullanılır.
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;

  return true;
}

// Kuyruktaki bildirimleri alıp cihazlara gönderir. pg_cron'un çağırdığı
// /api/notifications/dispatch ve anında gönderim isteyen server action'lar
// (ör. talep yanıtı) kullanır. VAPID anahtarları tanımlı değilse hiçbir
// şey yapmaz — kuyruk bekler.
export async function dispatchPendingNotifications(): Promise<DispatchResult> {
  const result: DispatchResult = { claimed: 0, delivered: 0, failed: 0 };

  if (!configureVapid()) {
    console.warn("Bildirim gönderilmedi: VAPID ortam değişkenleri eksik.");
    return result;
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_pending_notifications", { p_limit: 50 });

  if (error) {
    console.error("Bekleyen bildirimler alınamadı:", error);
    return result;
  }

  const notifications = (data ?? []) as ClaimedNotification[];
  result.claimed = notifications.length;

  await Promise.all(
    notifications.map(async (notification) => {
      const payload = JSON.stringify({
        title: notification.title,
        body: notification.body,
        url: notification.url,
        tag: notification.id,
      });

      const delivered: string[] = [];
      const gone: string[] = [];
      const errors: string[] = [];

      await Promise.all(
        notification.subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              payload,
              { TTL: 60 * 60, urgency: "high" },
            );
            delivered.push(subscription.endpoint);
          } catch (sendError) {
            const statusCode = (sendError as { statusCode?: number }).statusCode;

            // 404/410: kullanıcı izni kaldırdı veya cihaz aboneliği bitti.
            if (statusCode === 404 || statusCode === 410) {
              gone.push(subscription.endpoint);
            } else {
              const { code, message } = sendError as { code?: string; message?: string };
              errors.push(statusCode ? `HTTP ${statusCode}` : code || message || "bilinmeyen hata");
            }
          }
        }),
      );

      if (delivered.length > 0) result.delivered += 1;
      else result.failed += 1;

      const { error: completeError } = await supabase.rpc("complete_notification", {
        p_id: notification.id,
        p_delivered_endpoints: delivered,
        p_gone_endpoints: gone,
        p_error: errors.length > 0 ? errors.join(", ") : null,
      });

      if (completeError) {
        console.error("Bildirim sonucu kaydedilemedi:", completeError);
      }
    }),
  );

  return result;
}
