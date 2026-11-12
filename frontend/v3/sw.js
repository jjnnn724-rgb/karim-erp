/**
 * Service Worker لكشك الكاشير — واجهة فقط، بلا أي بيانات أعمال.
 *
 * - التنقل: الشبكة أولًا، ثم نسخة الواجهة المخزّنة عند الانقطاع.
 * - أصول Vite المبصومة: من الكاش أولًا (اسم الملف هو مفتاح الإصدار).
 * - API والجلسة والمرفوعات: لا تُلمس ولا تُخزَّن إطلاقًا.
 *
 * INTENTIONALLY_VERSIONED: ارفع الرقم مع كل تغيير في استراتيجية الكاش فقط.
 * تحديث الواجهة اليومي لا يحتاج رفعه: التنقل شبكي أولًا، والأصول الجديدة
 * تأتي بأسماء جديدة، والقديمة تُنظَّف عند تفعيل إصدار كاش جديد.
 */
const CACHE_PREFIX = 'karim-pos-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SHELL_URL = self.registration.scope;
const ASSET_PATH = new URL('assets/', self.registration.scope).pathname;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => cache.add(SHELL_URL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) =>
                Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))),
            )
            .then(() => self.clients.claim()),
    );
});

async function navigationResponse(request) {
    try {
        const response = await fetch(request);
        const type = response.headers.get('content-type') || '';
        if (response.ok && response.type === 'basic' && type.includes('text/html')) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SHELL_URL, response.clone());
        }
        return response;
    } catch (_) {
        const cached = await caches.match(SHELL_URL);
        return cached || Response.error();
    }
}

async function assetResponse(request) {
    const cached = await caches.match(request);
    if (cached) {
        return cached;
    }
    try {
        const response = await fetch(request);
        if (response.ok && response.type === 'basic') {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(request, response.clone());
        }
        return response;
    } catch (_) {
        return Response.error();
    }
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') {
        return;
    }

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) {
        return;
    }
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/') || url.pathname.startsWith('/uploads/')) {
        return;
    }

    if (request.mode === 'navigate' && url.pathname.startsWith(SCOPE_PATH)) {
        event.respondWith(navigationResponse(request));
        return;
    }

    if (url.pathname.startsWith(ASSET_PATH)) {
        event.respondWith(assetResponse(request));
    }
});
