/**
 * V2 — Dept employees repository (الباب الوحيد إلى /api/hr/dept-employees)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER (hr-routes.js:1733-1798), NOT INVENTED
 *   GET    /hr/dept-employees        → { depts[], employees[] }  (dept_head
 *     فقط، والنطاق نفسه المعتمد في rosterScope: dept_code بقائمة فواصل :1726)
 *   POST   /hr/dept-employees        → إضافة موظف لقسم المُعدِّل الأول (:1746)
 *   PUT    /hr/dept-employees/:id    → تعديل الاسم/الوظيفة/الهاتف فقط (:1769)
 *   DELETE /hr/dept-employees/:id    → تعطيل آمن يحفظ التاريخ (:1788)
 *
 * حقول آمنة فقط: الاسم/الرقم الوظيفي/الوظيفة/الهاتف — الراتب والحالة
 * والقسم والحسابات صلاحيات hr/admin (ترويسة الميزة القديمة حرفيًا).
 *
 * رسائل التحقق منطوقة من رفض الخادم نفسه (:1754-1757) — نفس الكلام
 * سواء جاء من هنا أو من هناك.
 */

import { apiFetch } from '../../core/api.js?v=4.9.146';

/** بوابة الكتابة مرآة للخادم: requireRole('dept_head') في الأبواب الأربعة. */
export const DEPT_EMP_WRITE_ROLES = ['dept_head'];

/** صف القسم → صف الجدول. Pure ومُصدَّرة — قابلة للاختبار بلا متصفح. */
export function deptEmpToRow(e = {}) {
    return {
        id: e.id,
        name: e.name ? String(e.name) : '',
        employeeId: e.employeeId ? String(e.employeeId) : '',
        position: e.position ? String(e.position) : '—',
        phone: e.phone ? String(e.phone) : '—',
        department: e.department ? String(e.department) : '',
        status: e.status ? String(e.status) : '',
    };
}

/** قراءة القسم كما يرد: { depts: ['CAF','SERVICE'], employees: [...] } */
export async function fetchDeptEmployees() {
    const res = await apiFetch('/hr/dept-employees');
    const o = res && typeof res === 'object' ? res : {};
    return {
        depts: Array.isArray(o.depts) ? o.depts.map(String) : [],
        employees: Array.isArray(o.employees) ? o.employees : [],
    };
}

/** عنوان الأقسام بنفس عبارات القديم: «المطبخ + الصالة». */
export function deptScopeLabel(depts) {
    return (depts || []).join(' + ');
}

/**
 * فحص الإرسال — مرآة حرفية لفحوص الخادم (:1754-1757).
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateDeptEmpForm(f = {}) {
    const name = String(f.name || '').trim();
    const employeeId = String(f.employeeId || '').trim();
    const errors = [];
    if (!name || !employeeId) {errors.push('الاسم والرقم الوظيفي إجباريان');}
    if (employeeId && !/^[A-Za-z0-9_-]{2,50}$/.test(employeeId)) {
        errors.push('الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)');
    }
    return { ok: errors.length === 0, errors };
}

/** الحقول المرسومة كما يقبلها الخادم: قصّ الأحرف نفسه (:1750-1753). */
export function normalizeDeptEmpForm(f = {}) {
    const cut = (v, n) => String(v || '').trim().slice(0, n);
    return {
        name: cut(f.name, 255),
        employeeId: cut(f.employeeId, 50),
        position: cut(f.position, 255) || null,
        phone: cut(f.phone, 50) || null,
    };
}

/** POST — إضافة موظف جديد للقسم (الخادم يضع القسم من نطاق المُعدِّل). */
export async function createDeptEmployee(f) {
    return apiFetch('/hr/dept-employees', { method: 'POST', body: JSON.stringify(normalizeDeptEmpForm(f)) });
}

/** PUT — تعديل موظف القسم (الرقم الوظيفي مقفل عند الخادم). */
export async function updateDeptEmployee(id, f) {
    return apiFetch(`/hr/dept-employees/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(normalizeDeptEmpForm(f)) });
}

/** DELETE — تعطيل آمن يحفظ التاريخ (ليس حذفًا نهائيًا — قرار الخادم :1795). */
export async function deactivateDeptEmployee(id) {
    return apiFetch(`/hr/dept-employees/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
