/**
 * backend/realtime/router.js — موجّه الأحداث المركزي + حاسم التخويل
 * ────────────────────────────────────────────────────────────────────────────
 * التوجيه v7.1 §9: خدمات العمل تصف "ماذا حدث"؛ الموجّه يقرر "من يراه".
 * التخويل يُشتق من قاعدة البيانات (دور المستخدم/قسمه) — حقل target تلميح
 * يُتحقق منه فقط، ولا يُوثق أبدًا كما يرسله العميل (LAW 06/10).
 */
'use strict';

const { pool } = require('../shared-pool');

/** غرف البث للحدث: من routing_metadata.rooms (حُسبت خادميًا وقت الإدراج) */
function roomsForEvent(event) {
    const meta = event.routing_metadata || {};
    const rooms = Array.isArray(meta.rooms) ? meta.rooms.filter(r => typeof r === 'string' && r.length < 120) : [];
    return rooms.length ? rooms : ['erp:all'];
}

/**
 * هل يرى هذا المستخدم (موثق من DB) هذا الحدث؟ — نفس فلتر الحي يُطبق على الاستعادة (§13).
 * القواعد الأساسية للمرحلة G1:
 *  - لا routing_metadata ⇒ حدث عام يُسمع للجميع.
 *  - target.type='role'     ⇒ تطابق دور المستخدم.
 *  - target.type='department' ⇒ تطابق قسم المستخدم (users.dept_code) أو أدوار الإدارة.
 *  - target.type='user'     ⇒ تطابق معرف المستخدم.
 *  - target.type='permission' ⇒ أدوار الإدارة الممنوحة افتراضيًا + خريطة صلاحيات لاحقة في G3.
 */
const ADMIN_ROLES = new Set(['admin', 'manager', 'auditor']);
async function authorizeEventForUser(event, user) {
    if (!user) {return false;}
    const meta = event.routing_metadata || {};
    const target = meta.target || null;
    if (!target || !target.type) {return true;} // حدث عام
    const role = String(user.role || '');
    if (ADMIN_ROLES.has(role)) {return true;} // الإدارة ترى الكل (سياسة المرحلة G1 الموثقة)
    if (target.type === 'role') {return role === String(target.value);}
    if (target.type === 'user') {return String(user.id) === String(target.value);}
    if (target.type === 'department') {
        const deptCode = String(target.value || '');
        if (String(user.dept_code || '') === deptCode) {return true;}
        // تحقق من القسم من DB — الأدوار التشغيلية للقسم تُحدد من users.dept_code فقط
        const r = await pool.query(`SELECT dept_code FROM users WHERE id = $1 LIMIT 1`, [user.id]);
        return String(r.rows[0]?.dept_code || '') === deptCode;
    }
    if (target.type === 'permission') {
        // خريطة أولية محافظة: صلاحيات البيع/المخزون لأدوار التشغيل المعروفة
        // TASK 9: أُضيفت purchase/inventory/hr/expense لمنتجي الوحدات الجدد.
        const permRoles = {
            'sale.view': ['admin', 'manager', 'auditor', 'cashier', 'accountant'],
            'dispatch.view': ['admin', 'manager', 'auditor', 'warehouse', 'kitchen', 'sous_chef', 'dept_head'],
            'revenue.view': ['admin', 'manager', 'auditor', 'accountant', 'cashier'],
            'purchase.view': ['admin', 'manager', 'auditor', 'accountant', 'warehouse'],
            'inventory.view': ['admin', 'manager', 'auditor', 'accountant', 'warehouse', 'kitchen', 'sous_chef'],
            'hr.view': ['admin', 'manager', 'auditor', 'hr'],
            'expense.view': ['admin', 'manager', 'auditor', 'accountant'],
        };
        const allowed = permRoles[String(target.value)] || ['admin', 'manager', 'auditor'];
        return allowed.includes(role);
    }
    return false;
}

module.exports = { roomsForEvent, authorizeEventForUser };
