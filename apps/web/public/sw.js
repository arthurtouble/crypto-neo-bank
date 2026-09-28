// Aura's service worker: shows push notifications and opens the right page when one is clicked.
self.addEventListener("push", (event) => {
  let notice = { title: "Aura", body: "", link: "/app" };
  try { notice = { ...notice, ...event.data.json() }; } catch { /* keep the default */ }
  event.waitUntil(self.registration.showNotification(notice.title, { body: notice.body, tag: notice.id, data: { link: notice.link }, icon: "/icon.svg" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = new URL(event.notification.data?.link ?? "/app", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((client) => client.url.startsWith(self.location.origin));
    return open ? open.navigate(link).then((client) => client?.focus()) : self.clients.openWindow(link);
  }));
});
