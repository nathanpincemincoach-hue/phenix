// Service worker : garde l'appli disponible hors connexion.
// Changer VERSION à chaque mise en ligne pour que les téléphones prennent la nouvelle version.
const VERSION = "phenix-v11";
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

// Rappel du matin envoyé par le backend (notification sans contenu : le texte est ici)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* pas de contenu */ }
  e.waitUntil(self.registration.showNotification(d.titre || "Phénix 🌿", {
    body: d.texte || "Après ta pesée, 30 secondes pour noter ta journée.",
    icon: "icons/icon-192-v2.png",
    tag: "rappel-phenix",
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((fenetres) => {
    for (const f of fenetres) if ("focus" in f) return f.focus();
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || "./");
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
