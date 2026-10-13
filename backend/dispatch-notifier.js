// ═══════════════════════════════════════════════════════════════════
// Karim ERP — مُشعِر سلسلة اعتماد طلبات الصرف (Dispatch Chain Notifier)
// ───────────────────────────────────────────────────────────────────
// Task 20: نصوص وأهداف إشعارات كل حدث في السلسلة:
//   رئيس قسم → الشيف العمومي → المخازن → الاستلام/الإرجاع
// كل إشعار يوجَّه لطرف الخطوة التالية (إجراء مطلوب) وللطرف صاحب الطلب
// (متابعة) ويُستثنى الفاعل نفسه — لا يُشعِر أحد نفسه بإجراءه.
// ═══════════════════════════════════════════════════════════════════
'use strict';

const { pool } = require('./shared-pool');
const { notifyBestEffort } = require('./notification-service');

let creatorSchemaReady = null;

/** عمود معرّف مقدم الطلب على الإذن — توجيه دقيق للإشعار حتى لو تغير الاسم لاحقًا. */
function ensureDispatchCreatorSchema() {
    if (creatorSchemaReady) {return creatorSchemaReady;}
    creatorSchemaReady = (async () => {
        await pool.query(`
            ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS "creatorUserId" BIGINT;
            CREATE INDEX IF NOT EXISTS idx_dispatches_creator_user ON dispatches ("creatorUserId");
        `);
    })().catch(error => { creatorSchemaReady = null; throw error; });
    return creatorSchemaReady;
}

/** نقية: بناء نص الإشعار وأهدافه لكل حدث في السلسلة. */
function buildChainNotification(dispatch, event, { reason = null, deptName = null } = {}) {
    const id = dispatch?.id ?? '?';
    const dept = deptName || dispatch?.deptName || dispatch?.deptCode || 'قسم';
    switch (event) {
        case 'created_pending_chef':
            return { type: 'info', targetRoles: ['kitchen', 'sous_chef'], title: 'طلب صرف جديد', message: `طلب صرف من ${dept} — بانتظار اعتماد الشيف العمومي` };
        case 'created_direct':
            return { type: 'info', targetRoles: ['warehouse'], title: 'طلب صرف جديد', message: `طلب صرف من ${dept} — بانتظار اعتماد المخازن` };
        case 'chef_approved':
            return { type: 'success', targetRoles: ['warehouse'], targetCreator: true, title: 'اعتماد الشيف العمومي', message: `إذن #${id} من ${dept} معتمد من الشيف — بانتظار صرف المخازن` };
        case 'chef_rejected':
            return { type: 'warning', targetCreator: true, title: 'رفض الشيف العمومي', message: `إذن #${id} من ${dept} مرفوض: ${reason || 'بدون سبب مسجل'}` };
        case 'warehouse_approved':
            return { type: 'success', targetRoles: ['kitchen', 'sous_chef'], targetCreator: true, title: 'تم صرف الطلب', message: `إذن #${id} من ${dept} صُرف من المخازن — بانتظار استلام القسم` };
        case 'warehouse_rejected':
            return { type: 'warning', targetCreator: true, title: 'رفض المخازن', message: `إذن #${id} من ${dept} مرفوض: ${reason || 'بدون سبب مسجل'}` };
        case 'received':
            return { type: 'success', targetRoles: ['warehouse', 'kitchen', 'sous_chef'], title: 'استلام القسم', message: `إذن #${id} من ${dept} تم استلامه وتوثيقه بالتوقيع` };
        case 'returned':
            return { type: 'info', targetRoles: ['warehouse', 'kitchen', 'sous_chef'], title: 'إرجاع للمخزن', message: `تم إرجاع أصناف من ${dept} على إذن #${id} وعكس مصروفها` };
        default:
            return null;
    }
}

/**
 * يطلق إشعار الحدث بعد نجاح العملية (best-effort — لا يُفشل العملية أبدًا).
 * الهدف: أدوار الحدث + مقدم الطلب (creatorUserId أو مطابقة createdBy) ما عدا الفاعل.
 */
async function notifyChainEvent(req, dispatch, event, { io = null, reason = null, deptName = null } = {}) {
    try {
        const spec = buildChainNotification(dispatch, event, { reason, deptName });
        if (!spec) {return 0;}
        await ensureDispatchCreatorSchema();
        const creatorUserId = Number(dispatch?.creatorUserId) || null;
        const notifyOpts = {
            type: spec.type,
            title: spec.title,
            message: spec.message,
            entity: 'dispatches',
            entityId: String(dispatch?.id ?? ''),
            link: 'dispatch',
            targetRoles: spec.targetRoles || [],
            targetUserIds: spec.targetCreator && creatorUserId ? [creatorUserId] : [],
            targetUsernames: spec.targetCreator && !creatorUserId ? [dispatch?.createdBy] : [],
            actorUserId: req.user?.id ?? null,
            io: io ?? req.io ?? null,
        };
        return await notifyBestEffort(pool, notifyOpts);
    } catch (error) {
        return 0;
    }
}

module.exports = { ensureDispatchCreatorSchema, buildChainNotification, notifyChainEvent };
