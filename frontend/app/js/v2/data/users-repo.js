/**
 * V2 — Users repository (الباب الوحيد لأبواب المستخدمين)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   POST /users                        → إنشاء (admin/manager ينشئ، وتعيين
 *     الدور للأدمن وحده ROLE_ASSIGNMENT_FORBIDDEN، وكلمة المرور إجبارية
 *     قوية 8+ حرف+رقم، وربط dept_head يُتحقق منه — server.js:1684-1695)
 *   PUT  /users/:id                    → تعديل (اسم المستخدم ثابت، وكلمة
 *     المرور اختيارية تُخزَّن وتُشترط القوة عند إرسالها)
 *   DELETE /users/:id                  → حذف (ليس الحساب الحالي — قاعدة
 *     الواجهة features/settings-users.js:707، والخادم يعيد الفحص)
 *   PUT  /users/:id/employee {employeeId} → ربط موظف (admin/manager —
 *     server.js:1349)
 *   GET  /users/:id/password           → خزنة كلمات المرور (admin —
 *     ops-inspect-routes.js:17)
 *   POST /auth/forgot-password/request-code {username} → رمز استعادة
 *     (10 دقائق، استخدام واحد — features/auth-navigation.js:85-94)
 */

import { apiFetch } from '../../core/api.js?v=4.9.193';
import { fetchEmployees, fetchDepartments as fetchHrDepartments } from './employees-repo.js?v=4.9.193';
import { fetchDepartments as fetchOperationalDepartments } from './finance-repo.js?v=4.9.193';

/** الإنشاء/الكتابة: admin يمنح الأدوار؛ manager ينشئ بلا تعيين دور (الخادم يحسم). */
export const USERS_WRITE_ROLES = ['admin', 'manager'];

/** قوة كلمة المرور — مرآة jwt-middleware.js:87 حرفًا بحرف. */
export function isStrongPasswordV2(value) {
    return typeof value === 'string' && value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

/**
 * فحص الإرسال — مرآة رسائل الخادم والقديم.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateUserForm(f = {}, { isEdit = false } = {}) {
    const errors = [];
    const name = String(f.name || '').trim();
    const username = String(f.username || '').trim();
    if (!name) {errors.push('أكمل الاسم');}
    if (!isEdit && !username) {errors.push('أكمل اسم المستخدم');}
    if (!isEdit) {
        if (!String(f.password || '')) {errors.push('كلمة المرور مطلوبة');}
        else if (!isStrongPasswordV2(String(f.password))) {errors.push('كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم');}
    } else if (f.password && !isStrongPasswordV2(String(f.password))) {
        errors.push('كلمة المرور ضعيفة: 8 حروف على الأقل مع حرف ورقم');
    }
    if (!f.role) {errors.push('حدد الدور');}
    if (f.role === 'dept_head') {
        const codes = String(f.dept_code || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!codes.length) {errors.push('اختر قسمًا واحدًا على الأقل لرئيس القسم');}
    }
    return { ok: errors.length === 0, errors };
}

export async function createUser(payload) {
    return apiFetch('/users', { method: 'POST', body: JSON.stringify(payload) });
}

export async function updateUser(id, payload) {
    return apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export async function deleteUser(id) {
    return apiFetch(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function linkUserEmployee(userId, employeeId) {
    return apiFetch(`/users/${encodeURIComponent(userId)}/employee`, {
        method: 'PUT', body: JSON.stringify({ employeeId: employeeId || null }),
    });
}

export async function fetchUserPassword(id) {
    return apiFetch(`/users/${encodeURIComponent(id)}/password`);
}

export async function issueUserResetCode(username) {
    return apiFetch('/auth/forgot-password/request-code', {
        method: 'POST', body: JSON.stringify({ username }),
    });
}

/** الموظفون والأقسام لقوائم الربط — hr أولًا ثم التشغيلية (مرآة القديم). */
export async function fetchUserLinkData() {
    const [employees, hr, ops] = await Promise.all([
        fetchEmployees(), fetchHrDepartments(), fetchOperationalDepartments().catch(() => []),
    ]);
    const departments = (Array.isArray(hr) && hr.length ? hr : [])
        .concat(Array.isArray(ops) && !(Array.isArray(hr) && hr.length) ? ops : []);
    return {
        employees: Array.isArray(employees) ? employees : [],
        departments,
    };
}
