// ═══════════════════════════════════════════════════════════════════
// Karim ERP — خدمة إشعارات الـ Push الحقيقية (FCM · Firebase Cloud Messaging)
// ───────────────────────────────────────────────────────────────────
// (2026-10-31) قرار المالك: الإشعارات توصل شريط الهاتف **والتطبيق مقفول تمامًا**
// — هذه الطبقة تكمل الجرس والسوكت: كل إشعار موجَّه يمر أيضًا عبر FCM.
//
// المعمارية (عمدًا):
//   • هذا الملف **نقي بلا SQL ولا كائنات req** — كل تخزين/استعلام للتوكنات
//     يعيش في notification-service.js (نمط الدوال البحتة بمعاملات عادية).
//   • التهيئة كسولّة (lazy): لا يُحمَّل firebase-admin ولا يُقرأ ملف مفاتيح
//     الخدمة إلا عند أول إرسال، وغيابه يعني الخدمة مطفأة بهدوء — لا يكسر
//     أي شيء (نفس فلسفة GEMINI_API_KEY الاختيارية).
//   • التفعيل: ملف firebase-service-account.json بجذر المشروع + PUSH_ENABLED=true.
//
// رسائل FCM المستخدمة من نوع notification-message (لا data-only): نظام
// أندرويد نفسه يعرضها في شريط الإشعارات حتى **والعملية مقتولة** — بلا أي
// كود استقبال. النقر يفتح التطبيق عبر الـ launcher intent الافتراضي.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

/** قناة الإشعارات على أندرويد — تُنشأ في MainActivity.java بنفس الاسم. */
const ANDROID_CHANNEL_ID = 'karim_requests';

let messaging = null;          // firebase-admin messaging بعد التهيئة
let initAttempted = false;     // محاولة واحدة لكل عملية — لا إعادة قراءة متكررة

/** مسار مفتاح الخدمة: env أو جذر المشروع افتراضيًا. */
function serviceAccountPath() {
    const custom = String(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    if (custom) {
        return path.isAbsolute(custom) ? custom : path.join(process.cwd(), custom);
    }
    return path.join(__dirname, '..', 'firebase-service-account.json');
}

function pushEnabledFlag() {
    const v = String(process.env.PUSH_ENABLED || '').trim().toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'off';
}

/**
 * تهيئة كسولّة. true = جاهز للإرسال. لا يرمي أبدًا — غياب الملف أو
 * الحزمة يعني «مطفأة» وهو وضع مشروع لا خطأ.
 */
function ensurePushInit() {
    if (messaging) {return true;}
    if (initAttempted) {return false;}
    initAttempted = true;
    if (!pushEnabledFlag()) {
        logger.info('[push] PUSH_ENABLED غير مفعّل — إشعارات الهاتف مطفأة.');
        return false;
    }
    const keyPath = serviceAccountPath();
    if (!fs.existsSync(keyPath)) {
        logger.info(`[push] مفتاح خدمة Firebase غير موجود (${keyPath}) — إشعارات الهاتف مطفأة حتى توفره.`);
        return false;
    }
    let admin;
    try {
        admin = require('firebase-admin');
    } catch (error) {
        logger.warn('[push] حزمة firebase-admin غير مثبتة — إشعارات الهاتف مطفأة:', error.message);
        return false;
    }
    try {
        const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        if (!admin.apps.length) {
            admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
        }
        messaging = admin.messaging();
        logger.info(`[push] Firebase جاهز — مشروع ${serviceAccount.project_id || 'غير معروف'}.`);
        return true;
    } catch (error) {
        logger.warn('[push] فشل تهيئة Firebase:', error.message);
        messaging = null;
        return false;
    }
}

/** نقية: رسالة FCM لتوكن واحد — نوع notification ليظهر والتطبيق مقفول. */
function buildFcmMessage(token, notice) {
    const title = String((notice && notice.title) || 'إشعار جديد').slice(0, 120);
    const body = String((notice && notice.message) || '').slice(0, 300);
    const data = {};
    if (notice && notice.link) {data.link = String(notice.link).slice(0, 60);}
    if (notice && notice.category) {data.category = String(notice.category).slice(0, 40);}
    if (notice && notice.notificationId != null) {data.notificationId = String(notice.notificationId);}
    return {
        token,
        notification: { title, body: body || title },
        android: {
            priority: 'high',
            // قناة karim_requests تُنشأ في MainActivity — نظام أندرويد يعرضها
            // في الشريط بصوتها واهتزازها حتى والعملية مقتولة.
            notification: { channelId: ANDROID_CHANNEL_ID },
        },
        data,
    };
}

/** نقية: استخراج التوكنات المستحقة للحذف من أخطاء الإرسال. */
function staleTokensOf(responses, tokens) {
    const stale = [];
    (Array.isArray(responses) ? responses : []).forEach((r, i) => {
        const code = String((r && r.error && (r.error.code || r.error.errorInfo?.code)) || '');
        // registration-token-not-registered / requested-entity-too-large (توكن تالف)
        if (!r || (r.error && /not-registered|invalid-arguments|unregistered|ENTITY_NOT_FOUND/i.test(code + ' ' + String(r.error.message || '')))) {
            if (tokens[i]) {stale.push(tokens[i]);}
        }
    });
    return stale;
}

/**
 * إرسال إشعار FCM لمجموعة توكنات (best-effort). يعيد { sent, stale } —
 * لا يرمي أبدًا: فشل الـ Push لا يمس الجرس والسوكت أبدًا.
 */
async function sendToTokens(tokens, notice) {
    const list = (Array.isArray(tokens) ? tokens : []).filter(Boolean).slice(0, 500);
    if (!list.length) {return { sent: 0, stale: [] };}
    if (!ensurePushInit() || !messaging) {return { sent: 0, stale: [] };}
    try {
        const messages = list.map((t) => buildFcmMessage(t, notice));
        const response = await messaging.sendEach(messages);
        return { sent: response.successCount || 0, stale: staleTokensOf(response.responses, list) };
    } catch (error) {
        logger.warn('[push] فشل إرسال دفعة:', error.message);
        return { sent: 0, stale: [] };
    }
}

/** حالة الخدمة للفحص الصحي والتشخيص. */
function pushStatus() {
    return {
        enabled: pushEnabledFlag(),
        initialized: Boolean(messaging),
        keyPathExists: fs.existsSync(serviceAccountPath()),
        channel: ANDROID_CHANNEL_ID,
    };
}

module.exports = {
    ANDROID_CHANNEL_ID,
    ensurePushInit,
    buildFcmMessage,
    staleTokensOf,
    sendToTokens,
    pushStatus,
    serviceAccountPath,
};
