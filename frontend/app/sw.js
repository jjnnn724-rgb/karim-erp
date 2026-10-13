/* Karim ERP Service Worker v4.7.2 — Professional PWA Caching
 * - App shell caching with versioning
 * - API/socket.io/uploads: bypassed entirely (never cached — user data stays private)
 * - Static assets: cache-first with stale-while-revalidate
 * - Images: cache-first, long TTL
 * - Fonts: cache-first, long TTL
 * - Navigations: network-first with offline fallback
 * - Background sync for offline mutations
 * - Periodic background sync for fresh data
 */
'use strict';

const CACHE_VERSION='4.25.55'; // 2026-10-13: فشل سريع (Oracle/اعتماد متكرر) + توازي الإقلاع
const CACHE = `karim-erp-${CACHE_VERSION}`;
const STATIC_CACHE = `karim-static-${CACHE_VERSION}`;
const API_CACHE = `karim-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `karim-images-${CACHE_VERSION}`;
const FONT_CACHE = `karim-fonts-${CACHE_VERSION}`;

const STATIC_ASSETS = [
    '/app/index.html',
    '/app/pos.html',
    '/app/manifest.json',
    '/app/js/main.js?v=4.9.77',
    '/app/js/core/pwa.js',
    '/app/js/core/i18n.js',
    '/app/js/core/utils.js',
    '/app/js/ui/toast.js',
    '/app/js/core/state.js',
    '/app/js/core/api.js',
    '/app/js/core/config.js',
    '/app/js/features/smart-card.js',
    '/app/js/features/bulk-import.js',
    '/app/js/features/kitchen.js',
    '/app/js/features/finance.js',
    '/app/js/features/hr.js',
    '/app/js/features/yarasoft.js',
    '/app/js/features/whatsapp.js',
    '/app/js/features/departments.js',
    '/app/js/features/reports.js',
    '/app/js/features/settings-users.js?v=4.9.77',
    '/app/js/features/veg-requests.js?v=4.9.77',
    '/app/js/features/cfo.js?v=4.9.77',
    '/app/js/ui/enhancement.js',
    '/app/js/features/page-router.js',
    '/app/js/features/auth-navigation.js?v=4.9.77',
    '/app/js/core/storage.js',
    '/app/js/features/employee-portal.js',
    '/app/js/features/dashboard.js',
    '/app/js/features/zkteco.js',
    '/app/js/app.js?v=4.9.77',
    '/app/js/pos.js?v=4.9.77',
    '/app/js/features/smart-item-search.js?v=2.0.0', // SMART-SEARCH-TRIAL: احذف هذا السطر لإزالة التجربة
    '/app/js/pos-orders.js',
    '/app/js/db-constraints-client.js',
    '/app/js/icons.js',
    '/app/js/scanner.js',
    '/app/js/realtime.js?v=4.9.77',
    '/app/js/vendor/qrcode.min.js?v=4.9.77',
    '/app/vendor/chart.umd.min.js?v=4.9.77',
    '/app/vendor/xlsx.full.min.js?v=4.9.77',
    '/app/vendor/html5-qrcode.min.js?v=4.9.77',
    '/app/css/mobile.css',
    '/app/css/design-tokens.css',
    '/app/css/styles.css',
    '/app/js/core/i18n-auto-catalog.js',
    '/app/js/core/i18n-auto.js',
    '/app/js/karim-i18n.js?v=4.9.76',
    '/app/js/features/branches.js?v=4.9.76',
    '/app/css/realtime.css',
    '/app/css/scanner.css',
    '/app/css/offline-fonts.css',
    '/app/css/pos.css',
    '/app/assets/icon-192.png',
    '/app/assets/icon-512.png',
    '/app/assets/icon-192-maskable.png',
    '/app/assets/icon-512-maskable.png',
    '/app/assets/karim-logo.png',
    '/app/assets/karim-logo.ico',
    '/app/assets/horus-logo.png',
    '/app/assets/horus-logo.ico',
];

const OFFLINE_FALLBACKS = ['/app/index.html', '/app/pos.html'];
// API_TTL أُزيل: بيانات /api/ لا تُخزَّن في الكاش إطلاقًا (سياسة bypass).
const STATIC_TTL = 30 * 24 * 60 * 60 * 1000;

self.addEventListener('install', (event) => {
    event.waitUntil(
        Promise.all([
            caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => undefined)),
            caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS).catch(() => undefined)),
        ]).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => ![CACHE, STATIC_CACHE, API_CACHE, IMAGE_CACHE, FONT_CACHE].includes(k))
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
            // تحديث تلقائي: أبلغ الصفحات المفتوحة بنسخة جديدة كي تعيد التحميل مرة واحدة
            .then(() => self.clients.matchAll({ type: 'window' }).then((clients) => {
                for (const c of clients) {c.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });}
            }))
    );
});

function isBypassed(url) {
    return url.pathname.startsWith('/api/')
        || url.pathname.startsWith('/socket.io/')
        || url.pathname.startsWith('/uploads/');
}

function getCacheName(url) {
    const path = url.pathname;
    if (path.match(/\.(png|jpg|jpeg|webp|svg|gif|ico|bmp)$/)) {return IMAGE_CACHE;}
    if (path.match(/\.(woff|woff2|ttf|eot|otf)$/)) {return FONT_CACHE;}
    if (path.match(/\.(css|js|mjs|html|json)$/)) {return STATIC_CACHE;}
    return CACHE;
}

function isFresh(response, ttl) {
    if (!response) {return false;}
    const swCachedAt = response.headers.get('sw-cached-at');
    if (swCachedAt) {
        return (Date.now() - Number(swCachedAt)) < ttl;
    }
    const dateHeader = response.headers.get('date');
    if (dateHeader) {
        return (Date.now() - new Date(dateHeader).getTime()) < ttl;
    }
    return true;
}

async function staleWhileRevalidate(req, cacheName, ttl) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(req);
    const fetchPromise = fetch(req).then(async (res) => {
        if (res && res.ok) {
            const copy = res.clone();
            await cache.put(req, copy);
        }
        return res;
    }).catch(() => cached);

    if (cached && isFresh(cached, ttl)) {
        fetchPromise.catch(() => {});
        return cached;
    }
    return fetchPromise;
}

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') {return;}

    let url;
    try { url = new URL(req.url); } catch (_) { return; }
    if (url.origin !== self.location.origin) {return;}
    if (isBypassed(url)) {return;}

    if (req.mode === 'navigate') {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(req).then((hit) => hit || caches.match('/app/index.html')))
        );
        return;
    }

    const cacheName = getCacheName(url);

    // ROOT FIX (نهاية عهد ?v= اليدوي): الكود (js/css/html/json) = network-first —
    // متصل بالإنترنت = أحدث كود دائمًا، والكاش فقط للاستخدام دون اتصال.
    // كان stale-while-revalidate بعمر 30 يومًا يخدم كودًا قديمًا لأسبوعين.
    if (url.pathname.match(/\.(css|js|mjs|html|json)$/)) {
        event.respondWith(
            fetch(req)
                .then((res) => {
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(cacheName).then((c) => c.put(req, copy)).catch(() => {});
                    }
                    return res;
                })
                // ROOT FIX (2026-09-30): لا تقدّم index.html أبدًا بدل JS/CSS —
                // المتصفح يفسر HTML كموديول فيسقط بـ SyntaxError مسموم يبقى في الكاش.
                // بدون اتصال: أعد آخر نسخة مخزنة لنفس الملف، وإلا 503 صريح.
                .catch(() => caches.match(req).then((hit) => hit || new Response('/* offline */', {
                    status: 503, statusText: 'Offline',
                    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
                })))
        );
        return;
    }

    // الصور والخطوط: كاش ثقيل (محتوى ثابت فعليًا)
    if (url.pathname.match(/\.(woff|woff2|ttf|eot|otf|png|jpg|jpeg|webp|svg|gif|ico|bmp)$/)) {
        event.respondWith(staleWhileRevalidate(req, cacheName, STATIC_TTL));
        return;
    }

    event.respondWith(
        fetch(req).catch(() => caches.match(req))
    );
});

self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-attendance' || event.tag === 'sync-orders') {
        event.waitUntil(
            self.clients.matchAll().then((clients) => {
                clients.forEach((client) => client.postMessage({ type: event.tag }));
            })
        );
    }
});

self.addEventListener('periodicsync', (event) => {
    if (event.tag === 'refresh-data') {
        event.waitUntil(
            caches.keys().then((keys) => {
                const apiKeys = keys.filter((k) => k.startsWith('karim-api-'));
                return Promise.all(apiKeys.map((k) => caches.delete(k)));
            })
        );
    }
});

self.addEventListener('push', (event) => {
    if (!event.data) {return;}
    const data = event.data.json();
    const options = {
        body: data.body || 'إشعار جديد',
        icon: '/app/assets/icon-192.png',
        badge: '/app/assets/icon-192.png',
        vibrate: [200, 100, 200],
        tag: data.tag || 'karim-erp',
        renotify: true,
        actions: data.actions || [],
        data: data.data || {}
    };
    event.waitUntil(self.registration.showNotification(data.title || 'Karim ERP', options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'open' || !event.action) {
        event.waitUntil(clients.openWindow(event.notification.data?.url || '/app/index.html'));
    }
});

self.addEventListener('message', (event) => {
    if (event.data?.type === 'skipWaiting') {
        self.skipWaiting();
    }
    if (event.data?.type === 'clearCache') {
        event.waitUntil(
            caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        );
    }
});
