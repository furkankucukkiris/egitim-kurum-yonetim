"use client";

import { useEffect, useState } from "react";
import {
  deletePushSubscription,
  savePushSubscription,
  sendTestNotification,
} from "@/app/(dashboard)/bildirimler/actions";

type DeviceState =
  | "checking"
  | "unsupported"
  | "ios-install" // iPhone/iPad: önce Ana Ekrana Ekle gerekli
  | "denied"
  | "off"
  | "on";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function detectState(): Promise<DeviceState> {
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  if (!supported) {
    return isIos() && !isStandalone() ? "ios-install" : "unsupported";
  }

  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();

  return subscription ? "on" : "off";
}

// Bu cihazda bildirimleri açma/kapama. Abonelik tarayıcıya özeldir; aynı
// kişi telefonda ve bilgisayarda ayrı ayrı açabilir.
export function PushDeviceControl({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<DeviceState>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    detectState()
      .then(setState)
      .catch(() => setState("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);

    try {
      if (!vapidPublicKey) {
        throw new Error("Bildirim anahtarı tanımlı değil.");
      }

      const permission = await Notification.requestPermission();

      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;

      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));

      const json = subscription.toJSON();
      const result = await savePushSubscription({
        endpoint: subscription.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
        userAgent: navigator.userAgent,
      });

      if (!result.ok) {
        await subscription.unsubscribe();
        throw new Error(result.error);
      }

      setState("on");
      setMessage({ tone: "success", text: "Bu cihazda bildirimler açıldı." });
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Bildirimler açılamadı.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        await deletePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }

      setState("off");
      setMessage({ tone: "success", text: "Bu cihazda bildirimler kapatıldı." });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);

    try {
      const result = await sendTestNotification();
      setMessage(
        result.ok
          ? { tone: "success", text: "Deneme bildirimi gönderildi. Birkaç saniye içinde gelmeli." }
          : { tone: "error", text: result.error },
      );
    } finally {
      setBusy(false);
    }
  }

  // Öğretmen panelindeki kısa hatırlatma: yalnızca açılabilir durumdaysa.
  if (compact && state !== "off" && state !== "ios-install") {
    return null;
  }

  const buttonClass =
    "rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div
      className={
        compact
          ? "mb-6 flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent-soft p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
          : "space-y-3 text-sm"
      }
    >
      <div>
        {state === "checking" && <p className="text-text-secondary">Kontrol ediliyor…</p>}

        {state === "unsupported" && (
          <p className="text-text-secondary">
            Bu tarayıcı telefon bildirimlerini desteklemiyor. Android&apos;de Chrome, iPhone&apos;da
            Ana Ekrana eklenmiş uygulama kullanın.
          </p>
        )}

        {state === "ios-install" && (
          <div className="text-text-primary">
            <p className="font-semibold">iPhone&apos;da bildirim almak için:</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-text-secondary">
              <li>Bu sayfayı Safari&apos;de açın.</li>
              <li>Alttaki Paylaş düğmesine (kare ve yukarı ok) dokunun.</li>
              <li>&quot;Ana Ekrana Ekle&quot;yi seçin.</li>
              <li>Ana ekrandaki simgeden açıp buradan bildirimleri açın.</li>
            </ol>
          </div>
        )}

        {state === "denied" && (
          <p className="text-danger">
            Bu cihazda bildirim izni reddedilmiş. Tarayıcı veya telefon ayarlarından bu site için
            bildirim iznini açıp sayfayı yenileyin.
          </p>
        )}

        {state === "off" && (
          <p className="text-text-primary">
            {compact
              ? "Ders ve yoklama hatırlatmalarını telefonunuzda almak için bildirimleri açın."
              : "Bu cihazda bildirimler kapalı."}
          </p>
        )}

        {state === "on" && <p className="text-success">Bu cihazda bildirimler açık.</p>}

        {message && (
          <p className={message.tone === "success" ? "mt-2 text-success" : "mt-2 text-danger"}>
            {message.text}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {state === "off" && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className={`${buttonClass} bg-primary text-on-primary hover:bg-primary-hover`}
          >
            {busy ? "Açılıyor…" : "Bildirimleri aç"}
          </button>
        )}

        {state === "ios-install" && compact && (
          <a
            href="/bildirimler"
            className={`${buttonClass} border border-border bg-surface text-text-primary`}
          >
            Nasıl açılır?
          </a>
        )}

        {state === "on" && (
          <>
            <button
              type="button"
              onClick={test}
              disabled={busy}
              className={`${buttonClass} bg-primary text-on-primary hover:bg-primary-hover`}
            >
              Deneme bildirimi gönder
            </button>
            <button
              type="button"
              onClick={disable}
              disabled={busy}
              className={`${buttonClass} border border-border bg-surface text-text-secondary hover:bg-surface-hover`}
            >
              Bu cihazda kapat
            </button>
          </>
        )}
      </div>
    </div>
  );
}
