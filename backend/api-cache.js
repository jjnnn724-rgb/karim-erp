'use strict';

/**
 * api-cache.js — Shared GET response cache (extracted from server.js, no logic change).
 * ────────────────────────────────────────────────────────────────────────────
 * Key = session (Authorization header) + URL: one user's authorized response
 * is never served to another. TTL 30s, capped size.
 *
 * الإبطال عند الكتابة (2026-10-29): الكاش بلا إبطال عند الكتابة كان يخدع
 * المستخدم خداعًا مزدوجًا — الشاشة تعتمد إذن صرفٍ فعلًا (POST 200، والخصم
 * واقعًا في الدفتر)، ثم تُعيد تحميل قائمة الأذون فورًا فتنزل من الكاش نسخة
 * عمرها 30 ثانية بالحالة القديمة، فتمسح صفة «معتمد» من أمام عينيه. يظن أن
 * الاعتماد لم يتم فيضغط مرة ثانية ويصطدم بحارس الحالة «خرج من حالة الانتظار»،
 * ثم يريفّش الصفحة بعد نصف دقيقة فتظهر الحقيقة. المسار هنا: كل كتابة 2xx
 * تحت /api تُبطِل قراءات المورد الذي مسّته — لا مسحٌ شامل (كان يهدم كاش
 * التقارير الثقيلة مقابل كل فاتورة كاشير)، ولا تجاهل (كان يكذب على الشاشة).
 *
 * قاعدة التوجيه: مسار القراءة ومسار الكتابة «على غصن واحد» إذا كانت مجموعة
 * مقاطع أحدهما جزءًا من الآخر أو مساوية له. فـ
 *   GET  /api/dispatches            {dispatches}
 *   POST /api/warehouse/dispatches/7/approve  {warehouse, dispatches}
 * ⊆ → تُبطَل. و
 *   GET  /api/warehouse/inventory   {warehouse, inventory}
 * ⊉/⊄ → لا تُمس (إلا حين تمسها كتابةٌ بمسارها هو).
 *
 * invalidateAll() is still called after permission changes so revokes apply instantly.
 */

const _apiCache = new Map();
// PERF-4: TTL bumped 10s → 30s (expensive reports recompute ~6×/min at 10s)
const API_CACHE_TTL = 30_000;
const API_CACHE_MAX = 2000;

/* مقاطع لا تدل على مورد: أفعال القرارات والعمليات المساعدة والسياقات العامة.
   تُحذف من المجموعتين حتى لا يجعل «approve» كلَّ كتابةٍ موردًا، وحتى لا
   تتساوى قراءات لا relation بينها. */
const NON_RESOURCE_SEGMENTS = new Set([
    'api', 'v1', 'v2', 'public', 'internal', 'health', 'ready', 'live', 'startup', 'metrics',
    'status', 'state', 'info', 'me', 'options', 'config', 'settings', 'actions',
    'search', 'count', 'list', 'all', 'summary', 'overview', 'detail', 'details',
    'export', 'import', 'upload', 'download', 'template', 'templates', 'preview',
    'print', 'batch', 'bulk', 'sync', 'retry', 'reset', 'refresh', 'invalidate',
    'bump', 'start', 'stop', 'run', 'test', 'ping', 'verify', 'validate', 'check',
    'approve', 'approveall', 'reject', 'submit', 'receive', 'cancel', 'confirm',
    'close', 'open', 'edit', 'update', 'create', 'delete', 'remove', 'add', 'set',
    'get', 'post', 'put', 'patch', 'review', 'complete', 'undo', 'redo', 'toggle',
]);

/** مجموعة مقاطع المورد من رابط الطلب (بلا استعلام، بلا معرّفات، بلا أفعال). */
/** @param {*} rawUrl */
function resourceSegments(rawUrl) {
    const pathname = String(rawUrl || '').split('?')[0].split('#')[0];
    const out = new Set();
    for (const part of pathname.split('/')) {
        const seg = decodeSafe(part).toLowerCase();
        if (!seg) {continue;}
        if (NON_RESOURCE_SEGMENTS.has(seg)) {continue;}
        // معرّف رقمي أو uuid أو token طويل: ليس اسم مورد
        if (/^\d+$/.test(seg) || /^[0-9a-f-]{16,}$/i.test(seg)) {continue;}
        if (!/^[a-z][a-z0-9_-]*$/.test(seg)) {continue;}
        out.add(seg);
    }
    return out;
}

/** @param {string} segment */
function decodeSafe(segment) {
    try {return decodeURIComponent(segment);} catch (_) {return segment;}
}

/** هل الكتابة على غصن قراءةٍ ما؟ (إحدى المجموعتين جزء من الأخرى أو متساويتان) */
/**
 * @param {Set<string>} writeSet
 * @param {Set<string>} readSet
 */
function onSameBranch(writeSet, readSet) {
    if (!writeSet.size || !readSet.size) {return false;}
    const smaller = writeSet.size <= readSet.size ? writeSet : readSet;
    const larger = smaller === writeSet ? readSet : writeSet;
    for (const seg of smaller) {if (!larger.has(seg)) {return false;}}
    return true;
}

/**
 * كتابةٌ على غصنٍ ما تُقادم قراءات غصونه المتأثرة بها — لا يكتفي المسار
 * بالمقاطح الحرفية لأن الاعتماد يخصم مخزونًا ويولّد حركة ومصرفًا:
 *   اعتماد/رفض/استلام إذن  → قراءات المخزون وحركاته والمصاريف
 *   إنتاج/تحويل/جرد/شراء    → قراءات المخزون
 * بلا هذا كانت شاشة المخزن تبقى 30 ثانية على رصيدٍ صرفه الاعتماد للتو.
 */
const WRITE_EFFECTS = {
    dispatches: ['inventory', 'inventorytx', 'expenses'],
    production: ['inventory'],
    transfers: ['inventory'],
    transfer: ['inventory'],
    audits: ['inventory'],
    stocktaking: ['inventory'],
    procurement: ['inventory'],
    purchases: ['inventory'],
};

/** مجموعة مقاطع الكتابة موسّعة بمواردها المتأثرة. */
/** @param {Set<string>} writeSet */
function affectedSegments(writeSet) {
    const out = new Set(writeSet);
    for (const seg of writeSet) {
        for (const eff of (WRITE_EFFECTS[/** @type {any} */ (seg)] || [])) {out.add(eff);}
    }
    return out;
}

/**
 * يُبطل قراءات الموارد التي مسّتها كتابةٌ ناجحة.
 * @param {string} writeUrl مسار الكتابة (مثل /api/warehouse/dispatches/7/approve)
 * @returns {number} عدد المداخل المحذوفة
 */
function invalidateForResource(writeUrl) {
    const base = resourceSegments(writeUrl);
    if (!base.size) {return 0;}
    const writeSet = affectedSegments(base);
    let removed = 0;
    for (const [key, entry] of _apiCache) {
        if (onSameBranch(writeSet, entry.segments)) {
            _apiCache.delete(key);
            removed++;
        }
    }
    return removed;
}

/** @param {any} req @param {any} res @param {any} next */
function apiCacheMiddleware(req, res, next) {
    if (req.method !== 'GET') { return next(); }
    if (req.path === '/api/state' || req.path === '/state') { return next(); }
    /* «أعطني الآن» حرفيًا: الطلب الصريح بلايف (؟live=1) لا يُخدَم من كاشٍ عمره
       30 ثانية ولا يُخزَّن فيه — وإلا كان الزناد اللايف في شاشة المتابعة يجلب
       سحبًا من أوراكل ثم يُجيب القارئ بالنسخة القديمة نفسها. */
    if (String(req.query?.live || '') === '1') { return next(); }
    const key = `${req.headers.authorization || ''}|${req.originalUrl}`;
    const cached = _apiCache.get(key);
    if (cached && Date.now() - cached.ts < API_CACHE_TTL) {
        // LRU touch: re-insert so Map iteration order tracks recency
        _apiCache.delete(key);
        _apiCache.set(key, cached);
        res.set('X-Cache', 'HIT');
        return res.json(cached.data);
    }
    const origJson = res.json.bind(res);
    res.json = (/** @type {any} */ data) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        if (ok && data && !data.error) {
            // LRU eviction: delete oldest entry instead of full clear
            // (full clear causes cache stampede — all clients re-hit DB at once)
            if (_apiCache.size >= API_CACHE_MAX) {
                const firstKey = _apiCache.keys().next().value;
                if (firstKey !== undefined) { _apiCache.delete(firstKey); }
            }
            _apiCache.set(key, { data, ts: Date.now(), segments: resourceSegments(req.originalUrl) });
        }
        else { _apiCache.delete(key); }
        res.set('X-Cache', 'MISS');
        return origJson(data);
    };
    next();
}

/**
 * وسيط الكتابة: بعد كل POST/PUT/PATCH/DELETE ناجح (2xx) تحت /api يُبطل قراءات
 * المورد. يفهم من `res.on('finish')` لأن الكود النهائي قد يتغير في المسار.
 * لا شيء يُبطَل عند الفشل (4xx/5xx): الكتابة لم تغيّر شيئًا.
 */
/** @param {any} req @param {any} res @param {any} next */
function apiCacheInvalidator(req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') { return next(); }
    const url = req.originalUrl || req.url || '';
    if (url !== '/api' && !url.startsWith('/api/')) { return next(); }
    res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
            try { invalidateForResource(url); } catch (_) { /* الإبطال لا يكسر الطلب */ }
        }
    });
    next();
}

function invalidateAll() {
    _apiCache.clear();
}

/** للقياس والاختبار فقط: حجم الكاش الحالي */
function size() { return _apiCache.size; }

module.exports = {
    apiCacheMiddleware,
    apiCacheInvalidator,
    invalidateAll,
    invalidateForResource,
    resourceSegments,
    onSameBranch,
    size,
    API_CACHE_TTL,
    API_CACHE_MAX,
};
