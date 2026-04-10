// Service worker — PWA installability + push notifications
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

// Push notification
self.addEventListener("push", (event) => {
  let data = { title: "Fluxy", body: "New message" };
  try {
    data = event.data.json();
  } catch {}

  event.waitUntil(
    self.registration.showNotification(data.title || "Fluxy", {
      body: data.body || "",
      icon: "/fluxy-icon-192.png",
      badge: "/fluxy-badge.png",
      vibrate: [100, 50, 100],
      tag: data.tag || "fluxy-default",
      data: { url: data.url || "/" },
    }),
  );
});

// Notification click — focus or open app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes("/fluxy") && "focus" in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
