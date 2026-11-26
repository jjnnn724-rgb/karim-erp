// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مُشعِر سلسلة طلبات الشراء (Purchase Request Notifier)
// ───────────────────────────────────────────────────────────────────
// (2026-10-31) طلبات الشراء كانت تُبث بثًّا عامًّا عبر entity_changed فقط —
// لا صف دائم في الجرس ولا توجيه لشخص بعينه. هذا الملف يسد الفجوة بنفس
// معمارية dispatch-notifier حرفًا:
//   • إنشاء (عادي) → الشيف العمومي + مقدم الطلب (بانتظار توقيع الشيف)
//   • إنشاء (الشيف موقّعًا من نفسه = معتمد) → المخازن (بانتظار التوريد)
//   • توقيع الشيف → المدير العام + مقدم الطلب
//   • اعتماد المدير العام → المخازن + مقدم الطلب (نهاية الدورة — البضاعة
//     تدخل المخزون عبر فواتير المشتريات، مسار الاستلام مغلق بأمر المالك)
//   • رفض أي طرف → مقدم الطلب
// الإشعار لا يُفشل العملية الرئيسية أبدًا (best-effort بعد نجاحها)،
// والفاعل نفسه مستثنى دائمًا.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { pool } = require('./shared-pool');
const { notifyBestEffort } = require('./notification-service');

/** نقية: بناء نص الإشعار وأهدافه لكل حدث في السلسلة. */
function buildRequestNotification(pr, event, { reason = null } = {}) {
    const rn = pr?.request_number || `#${pr?.id ?? '?'}`;
    const creator = pr?.creator_name || 'مقدم الطلب';
    switch (event) {
        case 'created_pending_chef':
            return { type: 'info', targetRoles: ['kitchen', 'sous_chef'], targetCreator: true, title: 'طلب شراء جديد', message: `طلب شراء ${rn} من ${creator} — بانتظار توقيع الشيف العمومي` };
        case 'created_approved':
            return { type: 'info', targetRoles: ['warehouse'], title: 'طلب شراء جديد', message: `طلب شراء ${rn} من المطبخ موقَّع من الشيف — بانتظار توريد المخزن` };
        case 'chef_approved':
            return { type: 'success', targetRoles: ['admin', 'manager'], targetCreator: true, title: 'توقيع الشيف العمومي', message: `طلب شراء ${rn} معتمد من الشيف — بانتظار اعتماد المدير العام` };
        case 'chef_rejected':
            return { type: 'warning', targetCreator: true, title: 'رفض الشيف العمومي', message: `طلب شراء ${rn} مرفوض: ${reason || 'بدون سبب مسجل'}` };
        case 'gm_approved':
            return { type: 'success', targetRoles: ['warehouse'], targetCreator: true, title: 'اعتماد المدير العام', message: `طلب شراء ${rn} معتمد نهائيًا — بانتظار توريد المخزن` };
        case 'gm_rejected':
            return { type: 'warning', targetCreator: true, title: 'رفض المدير العام', message: `طلب شراء ${rn} مرفوض: ${reason || 'بدون سبب مسجل'}` };
        default:
            return null;
    }
}

/**
 * يطلق إشعار الحدث بعد نجاح العملية (best-effort — لا يُفشل العملية أبدًا).
 * الهدف: أدوار الحدث + مقدم الطلب (created_by) ما عدا الفاعل نفسه.
 */
async function notifyRequestEvent(req, pr, event, { io = null, reason = null } = {}) {
    try {
        const spec = buildRequestNotification(pr, event, { reason, finalStatus });
        if (!spec) {return 0;}
        const creatorUserId = Number(pr?.created_by) || null;
        return await notifyBestEffort(pool, {
            type: spec.type,
            title: spec.title,
            message: spec.message,
            entity: 'purchaseRequests',
            entityId: String(pr?.id ?? ''),
            link: 'wh-prs',
            category: 'procurement', // قناة الجرس المصنّف + أولوية المنادي
            targetRoles: spec.targetRoles || [],
            targetUserIds: spec.targetCreator && creatorUserId ? [creatorUserId] : [],
            targetUsernames: spec.targetCreator && !creatorUserId ? [pr?.creator_name] : [],
            actorUserId: req.user?.id ?? null,
            io: io ?? req.io ?? null,
        });
    } catch (_) {
        return 0;
    }
}

module.exports = { buildRequestNotification, notifyRequestEvent };
