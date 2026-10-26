/* Karim ERP Service Worker v4.7.2 — Professional PWA Caching
 * - App shell precache: derived from the pages' own src/href, never hand-listed
 * - API/socket.io/uploads: bypassed entirely (never cached — user data stays private)
 * - Static assets: cache-first with stale-while-revalidate
 * - Images: cache-first, long TTL
 * - Fonts: cache-first, long TTL
 * - Navigations: network-first with offline fallback
 * - Background sync for offline mutations
 * - Periodic background sync for fresh data
 */
'use strict';

const CACHE_VERSION='4.25.61'; // 2026-10-17: معاينة شاشة سامسونج الطولية بنسبة 9:16
const CACHE = `karim-erp-${CACHE_VERSION}`;
const STATIC_CACHE = `karim-static-${CACHE_VERSION}`;
const API_CACHE = `karim-api-${CACHE_VERSION}`;
const IMAGE_CACHE = `karim-images-${CACHE_VERSION}`;
const FONT_CACHE = `karim-fonts-${CACHE_VERSION}`;

/* الكاش المُسبق صار مُشتقًّا لا مُؤلَّفًا: الصفحة نفسها تُخبرنا بما تطلبه.
 * القائمة اليدوية القديمة كانت ٦١ مفتاحًا تُنزَّل مرّتين (كاشَين) = ٨٬٤١٢٬١٢٠ بايتًا،
 * ٢٨ منها لا يطابق أي طلبٍ حقيقي (مسارٌ بلا ?v= لوحداتٍ تُستدعى دائمًا بـ ?v=، أو مراجعةٌ
 * قديمة مثل pos.js?v=4.9.77 بينما الصفحة تطلب 4.9.33) = ٢٬٦٤٩٬٤٦٦ بايتًا لا تُقرأ أبدًا؛
 * وفي المقابل ١٢٥ أصلًا تطلبه الصفحات فعليًا لم يكن مخزَّنًا إطلاقًا. المصدر الآن:
 * وسوم src/href في الصفحات + ما تستورده وحداتُها.
 */
const SHELL_PAGES = [
    '/app/index.html',
    '/app/pos.html',
    '/app/v2.html',
    '/app/menu-board.html',
    '/app/menu-totem-dashboard.html',
    '/app/menu-admin.html',
];
// أيقوناتٌ يطلبها نظام التشغيل عبر manifest.json لا أي صفحة: لا يشتقها مسح الـ HTML.
const MANIFEST_ASSETS = [
    '/app/manifest.json',
    '/app/assets/icon-192.png',
    '/app/assets/icon-512.png',
    '/app/assets/icon-192-maskable.png',
    '/app/assets/icon-512-maskable.png',
];
const ASSET_RE = /\.(css|js|mjs|html|json|png|jpg|jpeg|webp|svg|gif|ico|bmp|woff2?|ttf|eot|otf)$/;
const MODULE_SPEC_RE = /['"](\.[^'"]*?\.(?:js|css|mjs|json)(?:\?v=[0-9.]+)?)['"]/g;
const PRECACHE_LIMIT = 200;
const MAX_REVISIONS_PER_PATH = 2;

/* صفحة تُعرض عند انقطاع الشبكة وعدم وجود نسخة صالحة في الكاش.
   الأهم: صفحة إخطار مفهومة بدل شاشة بيضاء (العميل يظن أن التطبيق مكسور). */
const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>لا يوجد اتصال</title>
<style>body{font-family:Tajawal,system-ui,sans-serif;background:#0f1115;color:#eee;display:grid;place-items:center;height:100vh;margin:0;text-align:center}main{max-width:420px;padding:24px}h1{font-size:22px;margin:0 0 10px}a{background:#c9a227;color:#111;border-radius:10px;padding:12px 22px;font-size:16px;text-decoration:none;display:inline-block}</style>
</head><body><main>
<h1>تعذّر الوصول إلى الخادم</h1>
<p>لا يوجد اتصال بالسيرفر، ولا توجد نسخة محفوظة من هذه الشاشة على هذا الجهاز.</p>
<p>اتصل بشبكة المطعم ثم أعد المحاولة.</p>
<a href="">إعادة المحاولة</a>
</main></body></html>`;

// API_TTL أُزيل: بيانات /api/ لا تُخزَّن في الكاش إطلاقًا (سياسة bypass).
const STATIC_TTL = 30 * 24 * 60 * 60 * 1000;

function assetKey(raw, baseUrl) {
    if (!raw || /^(data:|blob:|about:|#|javascript:|mailto:|tel:)/i.test(raw)) {return null;}
    let url;
    try { url = new URL(raw, baseUrl); } catch (_) {return null;}
    if (url.origin !== self.location.origin) {return null;}
    if (!url.pathname.startsWith('/app/')) {return null;}
    if (!ASSET_RE.test(url.pathname)) {return null;}
    // مفتاحُ الطلب هو المسارُ ومراجعةُ الكاش وحدها: استعلامٌ آخر («?live=1») لا يُطلب
    // بهذا الشكل، فاشتقاقه كان يخلق مفتاحًا ميتًا جديدًا بدل القديم.
    const rev = url.searchParams.get('v');
    return rev && /^\d[\w.-]*$/.test(rev) ? `${url.pathname}?v=${rev}` : url.pathname;
}

function refsInHtml(html, baseUrl) {
    const keys = [];
    for (const m of html.matchAll(/\b(?:src|href)="([^"]*)"/g)) {
        const key = assetKey(m[1], baseUrl);
        if (key) {keys.push(key);}
    }
    return keys;
}

function refsInModule(jsText, baseUrl) {
    const keys = [];
    for (const m of jsText.matchAll(MODULE_SPEC_RE)) {
        const key = assetKey(m[1], baseUrl);
        if (key) {keys.push(key);}
    }
    return keys;
}

function isVendored(pathname) {
    return pathname.includes('/vendor/') || pathname.endsWith('.min.js');
}

function hrefOf(key) {
    return new URL(key, self.location.origin).href;
}

function isImportedModule(key) {
    const path = key.split('?')[0];
    return path.endsWith('.js') && !isVendored(path);
}

/* الكاش المُسبق بمسحتين وطلبٍ واحد لكل أصل: الصفحةُ تُخزَّن وتُقرأ في رحلتها، ثم
   تُقرأ وحداتُها فيُضاف ما تستورده. لا addAll (رفضٌ واحد بأول مسارٍ كان يُسقط كل
   الكاش في صمتٍ لأن الـ catch يبتلعه)، ولا قائمة يدوية (كل مراجعة ?v= تترك خلفها
   مفتاحًا ميتًا لا يطابق أي طلب). */
async function precacheAll() {
    const stored = new Set();

    async function take(key, wantText) {
        const url = hrefOf(key);
        let res;
        try { res = await fetch(url, { cache: 'no-store' }); } catch (_) {return '';}
        if (!res || !res.ok) {return '';}
        try {
            // تخزينٌ مفرد: كل أصلٍ في كاشٍ واحد بحسب نوعه — القائمة القديمة خزَّنت
            // كل ملفٍ مرتين (STATIC_CACHE و CACHE) فتضاعف حجمُ التثبيت.
            const cache = await caches.open(getCacheName(new URL(url)));
            await cache.put(url, res.clone());
            stored.add(key);
        } catch (_) {/* تعذَّر التخزينُ؛ القراءةُ للمشتَقّ لا تزال ممكنة */}
        if (!wantText) {return '';}
        return res.text().catch(() => '');
    }

    const shellTexts = await Promise.all(SHELL_PAGES.map((page) => take(page, true)));
    const pageRefs = [];
    shellTexts.forEach((html, i) => {pageRefs.push(...refsInHtml(html, hrefOf(SHELL_PAGES[i])));});

    // الطبقة التالية: ما تستورده وحداتُ الصفحات مباشرةً. مكتبات البائع مستثناة:
    // نصُّها المصغَّر فيه سلاسلُ تشبه المسارات لكنها لا تُطلب أبدًا.
    const walkable = [...new Set(pageRefs)].filter((k) => isImportedModule(k) && !stored.has(k));
    const moduleTexts = await Promise.all(walkable.map((key) => take(key, true)));
    const importedRefs = [];
    moduleTexts.forEach((js, i) => {importedRefs.push(...refsInModule(js, hrefOf(walkable[i])));});

    // FIX (Enterprise 2026-10-21): الأصول الصريحة (manifest + الأيقونات) كانت
    // تُقصّ مع الترتيب الأبجدي عند بلوغ الحد — فيسقط manifest.json من الذيل
    // ويختفي التطبيق المثبَّت. الصريح الآن **أولًا دائمًا**، والباقي يملأ
    // ما تبقّى من الميزانية.
    const explicit = MANIFEST_ASSETS.filter((key) => !stored.has(key));
    const derived = [...new Set([...pageRefs, ...importedRefs])]
        .filter((key) => !stored.has(key) && !explicit.includes(key))
        .sort();
    const budget = Math.max(PRECACHE_LIMIT - stored.size - explicit.length, 0);
    const pending = [...explicit, ...derived.slice(0, budget)];
    await Promise.allSettled(pending.map((key) => take(key, false)));
    return [...stored];
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        precacheAll().catch(() => undefined).then(() => self.skipWaiting())
    );
});

async function pruneOldRevisions() {
    for (const name of [STATIC_CACHE, CACHE]) {
        const cache = await caches.open(name);
        const requests = await cache.keys();   // بترتيب الإضافة: الأحدثُ آخرًا
        const seen = new Map();
        for (let i = requests.length - 1; i >= 0; i--) {
            let url;
            try { url = new URL(requests[i].url); } catch (_) {continue;}
            if (!url.searchParams.get('v')) {continue;}   // مفتاحٌ بلا مراجعة = أصلي
            const n = (seen.get(url.pathname) || 0) + 1;
            seen.set(url.pathname, n);
            if (n > MAX_REVISIONS_PER_PATH) {await cache.delete(requests[i]);}
        }
    }
}

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => ![CACHE, STATIC_CACHE, API_CACHE, IMAGE_CACHE, FONT_CACHE].includes(k))
                    .map((k) => caches.delete(k))
            ))
            // تقليم المراجعات: كان كل ?v= جديدةٍ تترك نسخةً كاملة من الوحدة خلفها إلى
            // أبدِها؛ الآن مادتان أخيران لكل مسار، والأقدم تُحذف عند التنشيط.
            .then(() => pruneOldRevisions().catch(() => undefined))
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
                    // لا تُخزّن استجابة فارغة أو خطأ: كاش فاسد = صفحة بيضاء
                    // لكل العملاء (قِيس فعلاً: استجابة 200 فارغة أثناء إعادة
                    // تشغيل الخادم ⇒ الSW يخدمها لاحقًا عند انقطاع الشبكة).
                    if (res && res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
                    }
                    return res;
                })
                .catch(async () => {
                    // دون اتصال: نخدم نسخة مخزّنة **صالحة** فقط، وإلا صفحة
                    // إخطار مفهومة بدل شاشة بيضاء.
                    const hit = (await caches.match(req)) || (await caches.match('/app/index.html'));
                    if (hit && hit.ok) {
                        try {
                            const body = await hit.clone().text();
                            if (body && body.trim().length > 200) { return hit; }
                        } catch (_) { /* لا نقدر نقرأ ⇒ لا نخدمه */ }
                    }
                    return new Response(OFFLINE_PAGE, {
                        status: 503,
                        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
                    });
                })
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
