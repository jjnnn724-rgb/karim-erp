'use strict';

/**
 * user-authority.js — سلطة تعديل الحسابات (منطق خالص، بلا قاعدة بيانات)
 * ────────────────────────────────────────────────────────────────────────────
 * الثغرة التي يغلقها هذا الملف: مدير كان يستطيع `PUT /users/:id` على حساب
 * المالك/المسؤول العام (بما فيه كلمة المرور)، أو إصدار رمز استعادة له عبر
 * `/auth/forgot-password/request-code` ثم أخذه. الترتيب الهرمي هنا يمنع
 * الاستيلاء الأفقي (peer) والعمودي (upward) ويحوّل كل قرار إلى نتيجة قابلة
 * للاختبار بدل شروط متفرقة داخل مسارات CRUD.
 *
 * القواعد:
 *   • owner  ⇒ يدير كل الحسابات (عدا حماية آخر owner/آخر admin من الإقصاء).
 *   • admin  ⇒ يدير ما هو أدنى منه فقط (manager وأقل) — لا يدير admin آخر
 *              ولا owner (حماية من الاستيلاء الأفقي بين المسؤولين).
 *   • manager ⇒ يدير ما هو أدنى منه فقط (كاشير/مطبخ/مخزن/محاسب...) — لا
 *              يلمس admin/owner/auditor/manager آخر.
 *   • لا أحد يرقّي نفسه ولا يوقف نفسه ولا يحذف نفسه.
 *   • لا يُمنح دور owner أو admin إلا من owner.
 *   • آخر owner نشط محمي دائمًا؛ وآخر admin نشط محمي عندما لا يوجد owner نشط.
 */

/** @type {Readonly<Record<string, number>>} */
const ROLE_RANK = Object.freeze({
    owner: 100,
    admin: 90,
    auditor: 75,
    manager: 70,
    accountant: 50,
    hr: 50,
    dept_head: 40,
    warehouse: 35,
    kitchen: 35,
    sous_chef: 30,
    cashier: 20,
    employee: 10,
});

const MANAGING_ROLES = Object.freeze(['owner', 'admin', 'manager']);

/** @param {unknown} role @returns {string} */
function normalizeRole(role) {
    return String(role == null ? '' : role).trim().toLowerCase();
}

/** @param {unknown} role @returns {number} */
function rankOf(role) {
    return ROLE_RANK[normalizeRole(role)] ?? 0;
}

/** @param {unknown} role @returns {boolean} */
function isOwner(role) {
    return normalizeRole(role) === 'owner';
}

/** @param {unknown} role @returns {boolean} */
function isPrivilegedRole(role) {
    const r = normalizeRole(role);
    return r === 'owner' || r === 'admin';
}

/**
 * هل يستطيع actor إدارة حساب بدور target؟
 * owner يدير الجميع. غيره يدير الأدنى منه فقط (الصرامة تمنع الند للند).
 * @param {unknown} actorRole
 * @param {unknown} targetRole
 * @returns {boolean}
 */
function canManage(actorRole, targetRole) {
    const actor = normalizeRole(actorRole);
    const actorRank = rankOf(actor);
    const targetRank = rankOf(targetRole);
    if (!MANAGING_ROLES.includes(actor) || actorRank <= 0 || targetRank <= 0) {return false;}
    if (actor === 'owner') {return true;}
    return targetRank < actorRank;
}

/**
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @returns {{ok:false,status:number,code:string,message:string}}
 */
function deny(status, code, message) {
    return { ok: false, status, code, message };
}

const OK = Object.freeze({ ok: true });

/**
 * قرار تعديل/إنشاء/حذف/إصدار رمز لحساب.
 *
 * @param {object} [input]
 * @param {'create'|'update'|'delete'|'reset-code'} [input.operation]
 * @param {string} [input.actorRole]
 * @param {number|string} [input.actorId]
 * @param {number|string} [input.targetId]
 * @param {string} [input.targetRole]
 * @param {Record<string, any>} [input.patch] الحقول القادمة (create/update)
 * @returns {{ok:true}|{ok:false,status:number,code:string,message:string}}
 */
function evaluateUserMutation(input = {}) {
    const {
        operation,
        actorRole,
        actorId = null,
        targetId = null,
        targetRole = '',
        patch = {},
    } = input;

    const actor = normalizeRole(actorRole);
    if (!MANAGING_ROLES.includes(actor)) {
        return deny(403, 'USER_MANAGEMENT_FORBIDDEN', 'إدارة الحسابات متاحة للمالك أو المسؤول العام أو المدير فقط');
    }

    const self = actorId != null && targetId != null && String(actorId) === String(targetId);

    if (operation === 'create') {
        const requested = normalizeRole(patch.role);
        if (!requested) {
            return deny(422, 'ROLE_REQUIRED', 'حدد دور الحساب الجديد');
        }
        if (requested === 'owner' && actor !== 'owner') {
            return deny(403, 'OWNER_ASSIGNMENT_FORBIDDEN', 'إنشاء حساب مالك متاح للمالك فقط');
        }
        if (!canManage(actor, requested)) {
            return deny(403, 'ROLE_ASSIGNMENT_FORBIDDEN', 'لا يمكنك إنشاء حساب بدور مساوٍ أو أعلى من دورك');
        }
        return OK;
    }

    const currentRole = normalizeRole(targetRole);
    if (currentRole && !ROLE_RANK[currentRole]) {
        return deny(422, 'INVALID_TARGET_ROLE', 'دور الحساب المستهدف غير معروف — راجع بيانات المستخدم');
    }

    if (operation === 'update') {
        const nextRole = Object.prototype.hasOwnProperty.call(patch, 'role')
            ? normalizeRole(patch.role)
            : currentRole;
        const nextActive = Object.prototype.hasOwnProperty.call(patch, 'active')
            ? patch.active !== false
            : true;

        if (self) {
            if (nextRole && nextRole !== currentRole) {
                return deny(403, 'SELF_ROLE_CHANGE_FORBIDDEN', 'لا يمكنك تغيير دور حسابك بنفسك — يلزم مالك أو مسؤول أعلى');
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'active') && nextActive === false) {
                return deny(403, 'SELF_DEACTIVATE_FORBIDDEN', 'لا يمكنك إيقاف حسابك بنفسك');
            }
            return OK;
        }

        if (!canManage(actor, currentRole)) {
            return deny(403, 'TARGET_OUT_OF_SCOPE', 'هذا الحساب بدور مساوٍ أو أعلى من دورك — لا يمكنك تعديله');
        }
        if (nextRole !== currentRole) {
            if ((nextRole === 'owner' || nextRole === 'admin') && actor !== 'owner') {
                return deny(403, 'ROLE_ASSIGNMENT_FORBIDDEN', 'منح دور المالك أو المسؤول العام متاح للمالك فقط');
            }
            if (!canManage(actor, nextRole)) {
                return deny(403, 'ROLE_ASSIGNMENT_FORBIDDEN', 'لا يمكنك منح دور مساوٍ أو أعلى من دورك');
            }
        }
        return OK;
    }

    if (operation === 'delete') {
        if (self) {
            return deny(403, 'SELF_DELETE_FORBIDDEN', 'لا يمكنك تعطيل أو حذف حسابك بنفسك');
        }
        if (!canManage(actor, currentRole)) {
            return deny(403, 'TARGET_OUT_OF_SCOPE', 'هذا الحساب بدور مساوٍ أو أعلى من دورك — لا يمكنك تعطيله');
        }
        return OK;
    }

    if (operation === 'reset-code') {
        if (self) {
            return deny(403, 'SELF_RESET_CODE_FORBIDDEN', 'غيّر كلمة مرورك من صفحة كلمة المرور بدل رمز الاستعادة');
        }
        if (!canManage(actor, currentRole)) {
            return deny(403, 'RESET_TARGET_OUT_OF_SCOPE', 'لا يمكن إصدار رمز استعادة لحساب بدور مساوٍ أو أعلى من دورك');
        }
        return OK;
    }

    return deny(400, 'UNKNOWN_OPERATION', 'عملية غير معروفة على الحساب');
}

/**
 * حماية آخر حساب نشط رفيع الصلاحية من الإقصاء (تعطيل/حذف/تخفيض دور).
 * @param {object} [input]
 * @param {string} [input.targetRole] الدور الحالي
 * @param {string} [input.nextRole] الدور بعد التعديل (افتراضيًا نفسه)
 * @param {boolean} [input.nextActive] النشاط بعد التعديل
 * @param {number} [input.activeOwners] عدد المالكين النشطين قبل التعديل
 * @param {number} [input.activeAdmins] عدد المسؤولين النشطين قبل التعديل
 * @returns {null|{status:number,code:string,message:string}}
 */
function evaluateLastPrivileged(input = {}) {
    const {
        targetRole,
        nextRole = targetRole,
        nextActive = true,
        activeOwners = 0,
        activeAdmins = 0,
    } = input;

    const current = normalizeRole(targetRole);
    if (!isPrivilegedRole(current)) {return null;}

    const stays = normalizeRole(nextRole) === current && nextActive !== false;

    if (current === 'owner' && !stays && Number(activeOwners) <= 1) {
        return {
            status: 403,
            code: 'LAST_OWNER_FORBIDDEN',
            message: 'لا يمكن إقصاء آخر حساب مالك نشط — عيّن مالكًا آخر أولًا',
        };
    }
    if (current === 'admin' && !stays && Number(activeAdmins) <= 1 && Number(activeOwners) === 0) {
        return {
            status: 403,
            code: 'LAST_ADMIN_FORBIDDEN',
            message: 'لا يمكن إقصاء آخر مسؤول عام نشط في النظام',
        };
    }
    return null;
}

module.exports = {
    ROLE_RANK,
    MANAGING_ROLES,
    rankOf,
    isOwner,
    isPrivilegedRole,
    canManage,
    evaluateUserMutation,
    evaluateLastPrivileged,
};
