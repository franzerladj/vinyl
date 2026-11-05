// Push-Mitteilungen im Service Worker (wird vom generierten sw.js per importScripts geladen)
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Crate", {
      body: d.body || "",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      data: { url: d.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && "focus" in c) {
          c.navigate(url).catch(() => undefined);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// Abo vom Browser erneuert: neue Adresse beim Server hinterlegen, alte entfernen.
// Der öffentliche Schlüssel muss mit, sonst lehnt Chrome das neue Abo ab (gleicher Wert wie shared/pushKey.ts).
const VAPID_PUBLIC_KEY = "BEUsn7IPKab_31GQjjQWGI_PWG0EbMuL2KXdfnbjx1VBeMa-b5_85WOxbMYyMSNV1Egb5skuKFnUx3tJXdjwByA";
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4)), (c) => c.charCodeAt(0));
self.addEventListener("pushsubscriptionchange", (event) => {
  const post = (path, body) => fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) })
      .then(async (sub) => {
        await post("/api/push/subscribe", { subscription: sub.toJSON() });
        if (event.oldSubscription) await post("/api/push/unsubscribe", { endpoint: event.oldSubscription.endpoint });
      })
      .catch(() => undefined),
  );
});
