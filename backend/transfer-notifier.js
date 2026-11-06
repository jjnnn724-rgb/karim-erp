// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مُشعِر سلسلة التحويلات الداخلية بين الأقسام (Transfer Notifier)
// ───────────────────────────────────────────────────────────────────
// نفس عقيدة dispatch-notifier حرفًا: نصوص وأهداف إشعارات كل حدث،
// كل إشعار يوجَّه لطرف الخطوة التالية (إجراء مطلوب) وللطرف صاحب الطلب
// (متابعة) ويُستثنى الفاعل نفسه — لا يُشعِر أحدٌ نفسه بإجراءه.
// الفئة 'transfers' تمنح المنادي والنغمة ذات الأولوية (notification-service).
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { pool } = require('./shared-pool');
const { notifyBestEffort } = require('./notification-service');

/** نقية: بناء نص الإشعار وأهدافه لكل حدث في سلسلة التحويلات.
 *  transfer: { id, transfer_number, requested_by } — أسماء الأقسام تُمرَّر
 *  مُحلولة من المسار (source/dest) كي تبقى الدالة بلا DB. */
function buildTransferNotification(transfer, event, { reason = null, fromName = null, toName = null, toDeptCode = null } = {}) {
    const num = transfer?.transfer_number || '?';
    const from = fromName || 'قسم';
    const to = toName || 'قسم';
    switch (event) {
        case 'created_pending_chef':
            return {
                type: 'info',
                targetRoles: ['kitchen', 'sous_chef'],
                targetCreator: true,
                title: 'طلب تحويل جديد',
                message: `طلب تحويل من ${from} إلى ${to} — بانتظار اعتماد الشيف`,
            };
        case 'approved':
            return {
                type: 'success',
                targetCreator: true,
                targetDeptCodes: toDeptCode ? [toDeptCode] : [],
                title: 'اعتماد التحويل',
                message: `تحويل #${num} من ${from} إلى ${to} معتمد ونُفِّذ — البضاعة أُضيفت لمخزن القسم المستلم بالتكلفة الفعلية`,
            };
        case 'rejected':
            return {
                type: 'warning',
                targetCreator: true,
                title: 'رفض التحويل',
                message: `تحويل #${num} من ${from} إلى ${to} مرفوض: ${reason || 'بدون سبب مسجل'}`,
            };
        case 'external_sale':
            return {
                type: 'info',
                targetRoles: ['admin', 'manager', 'warehouse'],
                title: 'تحويل للبيع الخارجي',
                message: `${from} حوّل بضاعة للبيع الخارجي — إذن #${num} بالتكلفة الفعلية (مسار مباشر بلا اعتماد)`,
            };
        default:
            return null;
    }
}

/** يطلق إشعار الحدث بعد نجاح العملية (best-effort — لا يُفشل العملية أبدًا).
 *  يُستدعى بعد COMMIT من المسارات، بمعامل pool — مستقل عن المعاملة الأم. */
async function notifyTransferEvent(transfer, event, {
    io = null, reason = null, fromName = null, toName = null,
    toDeptCode = null, actorUserId = null,
} = {}) {
    try {
        const spec = buildTransferNotification(transfer, event, { reason, fromName, toName, toDeptCode });
        if (!spec) {return 0;}
        const creatorUserId = Number(transfer?.requested_by) || null;
        return await notifyBestEffort(pool, {
            type: spec.type,
            title: spec.title,
            message: spec.message,
            entity: 'inventory-transfers',
            entityId: String(transfer?.id ?? ''),
            link: 'dept-transfers',
            category: 'transfers', // قناة الجرس المصنّفة + أولوية المنادي
            targetRoles: spec.targetRoles || [],
            targetDeptCodes: spec.targetDeptCodes || [],
            targetUserIds: spec.targetCreator && creatorUserId ? [creatorUserId] : [],
            actorUserId,
            io,
        });
    } catch (_) {
        return 0;
    }
}

module.exports = { buildTransferNotification, notifyTransferEvent };
