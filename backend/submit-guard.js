// ─── حارس الضغط المكرر (Double-Submit Guard) ────────────────────────────────
// مشكلة واقعية 2026-10-08: الضغط المتكرر على «حفظ» كان يسجّل إذن الصرف أو
// الفاتورة عدة مرات. فحص قاعدة البيانات وحده لا يكفي: طلبان متزامنان
// يفحصان معًا قبل أن يُدرج أي منهما فيمرّان كلاهما (TOCTOU race).
//
// الحماية هنا على مستويين داخل العملية (Node أحادية الخيط ⇒ الفحص والحجز
// متزامنان بلا أي await بينهما، والسباق بين الطلبات المتزامنة يصبح مستحيلًا):
//   1) قفل «قيد التنفيذ»: نفس المستخدم + الكيان + المحتوى لا يُعالج مرتين.
//   2) ذاكرة «أُنشئ للتو»: لنافذة 90 ثانية بعد النجاح — تسبق أي فحص قاعدة.
// الفشل (رصيد غير كافٍ، تحقق مرفوض…) لا يحجز شيئًا: إعادة المحاولة فورية.

const { logger } = require('./logger');

// كيانات حركات/مالية — الإنشاء المكرر فيها خلال ثوانٍ هو دائمًا ضغط مزدوج
const DEDUP_ENTITIES = new Set([
    'dispatches', 'revenues', 'expenses', 'purchaseInvoices',
    'inventoryTx', 'kitchenReturns', 'salary_advances',
    'payroll_adjustments', 'payroll_runs', 'weightReadings',
    'recipes',
]);

// كيانات تُحمى من الطلبات المتزامنة فقط (نمط inflight) — بيع الكاشير مثلًا:
// الطلبان المتطابقان المتتاليان مشروعان، والمتزامنان (ضغط مزدوج) مرفوضان
const EXTRA_ENTITIES = new Set(['posOrders']);

// FIX 2026-10-11 (L5): reduced window from 90s to 10s — 90s blocked legitimate
// identical back-to-back entries (e.g., two identical dispatches for different
// dates). 10s still catches double-click without blocking real workflows.
const RECENT_WINDOW_MS = 10_000;   // نافذة «أُنشئ للتو»
const INFLIGHT_STALE_MS = 15_000;  // تنظيف أمان لأي قفل معلّق

const inflight = new Map();        // key -> { at }
const recent = new Map();          // key -> { at, id }

// حقول تقنية/زمنية تختلف بين الطلبات المتطابقة — تُستثنى من التوقيع
const VOLATILE_KEYS = new Set([
    'requestedAt', 'createdAt', 'updatedAt', 'id', 'requestId',
    'timestamp', '_t', 'clientId', 'nonce',
]);

function normalizeValue(v) {
    if (v === null || v === undefined) {return '';}
    if (Array.isArray(v)) {return v.map(normalizeValue);}
    if (typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v).sort()) {
            if (VOLATILE_KEYS.has(k)) {continue;}
            out[k] = normalizeValue(v[k]);
        }
        return out;
    }
    if (typeof v === 'string') {
        const s = v.trim();
        return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    }
    return v;
}

function signatureOf(body) {
    try { return JSON.stringify(normalizeValue(body ?? {})); } catch (_) { return null; }
}

function sweep() {
    const now = Date.now();
    for (const [k, v] of inflight) { if (now - v.at > INFLIGHT_STALE_MS) {inflight.delete(k);} }
    for (const [k, v] of recent) { if (now - v.at > RECENT_WINDOW_MS) {recent.delete(k);} }
}

/**
 * Middleware factory — يُركَّب على مساري POST الإنشاء:
 *   app.post(`/api/${entity}`, jwtAuth, …, crudLimiter, guardCreate(entity), handler)
 * يرفض فورًا الطلب المكرر (409)، وإلا يمرر ويحوّل القفل إلى «أُنشئ للتو»
 * فقط إذا نجح الإنشاء (2xx) — الفشل لا يترك أي أثر.
 *
 * mode 'window' (افتراضي): قيد التنفيذ + نافذة 90 ثانية بعد النجاح.
 *   للكيانات النموذجية (إذن صرف، إيراد، مصروف…) — تكرار المحتوى نفسه
 *   خلال الثواني هو دائمًا ضغط مزدوج.
 * mode 'inflight': قيد التنفيذ فقط، بلا نافذة لاحقة.
 *   للبيع في الكاشير — طلبان متطابقان متتاليان أمر واقعي، والقتال
 *   الحقيقي هو الطلبات المتزامنة الناتجة عن تكرار الضغط.
 */
function guardCreate(entity, { mode = 'window' } = {}) {
    return (req, res, next) => {
        if (!DEDUP_ENTITIES.has(entity) && !EXTRA_ENTITIES.has(entity)) {return next();}
        const sig = signatureOf(req.body);
        if (sig === null) {return next();}
        const key = `${entity}|${req.user?.id ?? '?'}|${sig}`;
        sweep();

        if (inflight.has(key)) {
            logger.warn({ event: 'submit_guard.rejected', entity, code: 'INFLIGHT', userId: req.user?.id, path: req.path });
            return res.status(409).json({
                ok: false,
                code: 'DUPLICATE_SUBMIT_INFLIGHT',
                message: 'نفس الطلب قيد التنفيذ الآن — توقف عن تكرار الضغط وانتظر النتيجة',
            });
        }
        if (mode === 'window') {
            const prev = recent.get(key);
            if (prev) {
                logger.warn({ event: 'submit_guard.rejected', entity, code: 'RECENT', userId: req.user?.id, path: req.path, duplicateOf: prev.id });
                return res.status(409).json({
                    ok: false,
                    code: 'DUPLICATE_SUBMIT_RECENT',
                    message: 'تم تسجيل هذا الطلب للتو — تحقق من القائمة قبل إعادة المحاولة',
                    duplicateOf: { id: prev.id ?? null },
                });
            }
        }

        inflight.set(key, { at: Date.now() });
        res.on('finish', () => {
            inflight.delete(key);
            if (mode === 'window' && res.statusCode >= 200 && res.statusCode < 300) {
                recent.set(key, { at: Date.now(), id: res.locals?.createdId ?? null });
            }
        });
        next();
    };
}

module.exports = { guardCreate };
