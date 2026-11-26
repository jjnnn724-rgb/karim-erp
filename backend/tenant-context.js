'use strict';
/**
 * tenant-context.js — سياق المستأجر في الخادم فقط (Stage 2 pilot).
 *
 * القواعد:
 *  · المستأجر يُحلّ من قاعدة البيانات عبر tenant_memberships النشطة، لا من أي حقل
 *    يرسله العميل (query/body/header).
 *  · عضويتين نشطتين أو أكثر = غموض ⇒ فشل مغلق.
 *  · وضع الانتقال (TENANT_ENFORCEMENT!=='true') يسمح بالمستأجر الافتراضي
 *    للحسابات القديمة بلا عضوية — ويُسجَّل تحذير. يُمنع هذا الوضع قبل تفعيل RLS.
 *  · setTenantLocal يضبط app.tenant_id داخل transaction فقط (SET LOCAL).
 *
 * A3.1/3.2: المنطق الفعلي انتقل إلى modules/tenant/resolution.js؛ هذا الملف
 * يبقى كواجهة توافقية بنفس التصدير (لا تغيير عقد).
 */
const { updateUserContext } = require('./middleware/correlation');
const { ENFORCE, resolveTenantForUser, setTenantLocal } = require('./modules/tenant/resolution');

/** Middleware اختياري: يثبّت tenant في req والسياق non-async للتتبع. */
function tenantContext(options = {}) {
    return async (req, res, next) => {
        const tenantId = await resolveTenantForUser(req.user, options);
        if (!tenantId) {
            return res.status(403).json({
                error: 'TENANT_CONTEXT_REQUIRED',
                message: 'تعذّر تحديد المستأجر — لا يمكن متابعة الطلب.',
            });
        }
        req.tenantId = tenantId;
        updateUserContext({ tenantId });
        return next();
    };
}

module.exports = { ENFORCE, resolveTenantForUser, tenantContext, setTenantLocal };
