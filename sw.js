// Service worker : garde l'appli disponible hors connexion.
// Changer VERSION à chaque mise en ligne pour que les téléphones prennent la nouvelle version.
const VERSION = "phenix-v2";
const SHELL = [
  "./", "index.html", "style.css", "app.js", "config.js", "manifest.webmanifest",
  "icons/logo-96.png", "icons/icon-192.png", "icons/apple-touch-icon.png",
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
