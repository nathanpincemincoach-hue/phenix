// Service worker : garde l'appli disponible hors connexion.
// Changer VERSION à chaque mise en ligne pour que les téléphones prennent la nouvelle version.
const VERSION = "phenix-v16";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/logo-96.png", "icons/icon-192-v2.png", "icons/apple-touch-icon-v2.png",
  "fonts/bodoni-moda-latin-400-normal.woff2", "fonts/bodoni-moda-latin-400-italic.woff2",
  "fonts/manrope-latin-500-normal.woff2", "fonts/manrope-latin-700-normal.woff2"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

try { importScripts("config.js"); } catch (_) { /* hors connexion au premier lancement */ }

// Notification envoyée par le backend (sans contenu) : on demande au backend le texte prévu pour ce téléphone
// (rappel du matin ou atelier du dimanche). En cas d'échec, on affiche le rappel du matin.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let m = null;
    try { m = e.data ? e.data.json() : null; } catch (_) { /* pas de contenu */ }
    if (!m && self.PHENIX_API) {
      try {
        const sub = await self.registration.pushManager.getSubscription();
        if (sub) {
          const r = await fetch(`${self.PHENIX_API}?action=notif&e=${encodeURIComponent(sub.endpoint)}`, { cache: "no-store" });
          const j = await r.json();
          if (j && j.ok) m = j;
        }
      } catch (_) { /* réseau lent : texte par défaut */ }
    }
    m = m || {};
    await self.registration.showNotification(m.titre || "Phénix 🌿", {
      body: m.texte || "Après ta pesée, 30 secondes pour noter ta journée.",
      icon: "icons/icon-192-v2.png",
      tag: m.tag || "rappel-phenix",
      data: { url: m.url || "./" }
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  // lien externe (live de l'atelier) : on l'ouvre ; sinon on revient dans l'appli
  if (/^https?:\/\//.test(url) && !url.startsWith(self.location.origin)) {
    e.waitUntil(self.clients.openWindow(url));
    return;
  }
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
    for (const f of fenetres) if ("focus" in f) return f.focus();
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // l'API Google passe en direct
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors connexion.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
  );
});
