/* MetaGallery service worker
 * - Network-first for the app shell (HTML/CSS/JS) so updates land immediately.
 * - Cache-first for vendored libs and icons (rarely change, big wins offline).
 */
const CACHE = 'metagallery-v18';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './metadata.js',
    './thumbs.js',
    './searchIndex.js',
    './bluesky.js',
    './oauth.js',
    './i18n.js',
    './manifest.webmanifest',
    './vendor/piexif.min.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(ASSETS).catch(err => {
            // Don't fail install if an icon is missing
            console.warn('Pre-cache: some assets missing', err);
        }))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const keys = await caches.keys();
        const hadOld = keys.some(k => k !== CACHE);
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        await self.clients.claim();
        // If we just replaced an older cache, tell every open page to reload
        // so the user immediately sees the new HTML/CSS/JS instead of being
        // stuck on assets the previous SW had already served.
        if (hadOld) {
            const clients = await self.clients.matchAll({ type: 'window' });
            for (const c of clients) c.postMessage({ type: 'SW_UPDATED', cache: CACHE });
        }
    })());
});

// Allow the page to ask the SW to step aside for a hard reload.
self.addEventListener('message', (e) => {
    if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

const APP_SHELL = /\.(?:html|css|js|webmanifest)$|\/$/i;

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    const isAppShell = APP_SHELL.test(url.pathname);

    if (isAppShell) {
        // Network-first: always try fresh, fall back to cache when offline.
        e.respondWith(
            fetch(req).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Cache-first for everything else (vendor, icons), revalidate in background.
    e.respondWith(
        caches.match(req).then(cached => {
            const fetchPromise = fetch(req).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(CACHE).then(c => c.put(req, copy));
                }
                return res;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
