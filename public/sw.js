// Telefon bildirimleri için servis çalışanı. Yalnızca push bildirimi
// gösterir ve tıklanınca ilgili sayfayı açar; önbellekleme yapmaz.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || "Bildirim", {
      body: data.body || "",
      icon: "/apple-icon.png",
      // Android durum çubuğu ikonu: yalnızca şekli (şeffaflık) kullanılır,
      // renkler yok sayılır. Yuvarlak logo burada düz daireye dönüşüyordu.
      badge: "/notification-badge.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.navigate(target).then((navigated) => (navigated || client).focus());
        }
      }

      return self.clients.openWindow(target);
    }),
  );
});
