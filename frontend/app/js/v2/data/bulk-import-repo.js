/**
 * V2 — باب الاستيراد الجماعي الوحيد (26د)
 * ═══════════════════════════════════════════════════════════════════════
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   POST /users → users (server.js:1677-1695): كلمة المرور إجبارية قوية
 *     (8+ حرف ورقم)، وتعيين الدور للأدمن وحده، ورئيس القسم يحتاج
 *     `dept_code` صحيحًا (server.js:1132-1143).
 *   POST /employees → employees (server.js:1802-1829): الاسم والرقم
 *     الوظيفي إجباريان، و`department` إن أُرسل يجب أن يوجد في hrDepartments،
 *     و`userId` يربط الحساب بالسجل الوظيفي.
 *   DELETE /users/:id → تراجع أفضل-جهد عن الحساب إذا فشل إنشاء الموظف،
 *     فلا يبقى حساب يتيم بلا سجل وظيفي (القديم كان يتركه — انحراف معلن).
 *
 * الأدوار: admin وحدها. ليست سياسة جديدة: الخادم يمنع غير الأدمن من تعيين
 * `role` في أي حساب (ROLE_ASSIGNMENT_FORBIDDEN)، والقديم يرسل الدور دائمًا.
 * القراءة (users/employees/hrDepartments) تعود عبر أبوابها القائمة.
 */

import { fetchUsers } from './portal-repo.js?v=4.9.156';
import {
    fetchEmployees, fetchDepartments, createEmployee,
} from './employees-repo.js?v=4.9.156';
import { createUser, deleteUser } from './users-repo.js?v=4.9.156';

export const BULK_IMPORT_WRITE_ROLES = ['admin'];

/** الحساب الوظيفي والموظفون والأقسام اللازمة للتوليد ومنع التعارض. */
export async function loadBulkImportContext() {
    const [users, employees, departments] = await Promise.all([
        fetchUsers(), fetchEmployees(), fetchDepartments(),
    ]);
    return {
        usernames: (Array.isArray(users) ? users : [])
            .map((u) => (u && u.username ? String(u.username) : ''))
            .filter(Boolean),
        employees: Array.isArray(employees) ? employees : [],
        departments: Array.isArray(departments) ? departments : [],
    };
}

/** حمولة POST /users — الحقول الستة المسموحة، وdept_code لرئيس القسم فقط. */
export function bulkUserPayload(row = {}) {
    const payload = {
        username: String(row.username || '').trim(),
        password: String(row.password || ''),
        role: String(row.role || ''),
        name: String(row.name || '').trim(),
        active: true,
    };
    if (row.role === 'dept_head') {payload.dept_code = String(row.dept_code || '').trim();}
    return payload;
}

/**
 * حمولة POST /employees — حقول القديم نفسها (features/bulk-import.js:370-379)
 * بعد توسيع schema-registry: الرقم الوظيفي = رقم البصمة، والقسم الأول من
 * أقسام الموارد البشرية كما القديم، والمسمى اسم الدور.
 */
export function bulkEmployeePayload(row = {}, options = {}) {
    const fingerprint = String(row.fp || '').trim();
    return {
        name: String(row.name || '').trim(),
        employeeId: fingerprint,
        deviceUserId: fingerprint,
        department: String(options.department || '').trim(),
        position: String(options.position || '').trim(),
        phone: '',
        email: '',
        joinDate: options.joinDate || '',
        salary: 0,
        status: 'active',
        userId: options.userId,
        iqamaExpiry: null,
        healthCertExpiry: null,
        healthEduExpiry: null,
        photo: null,
        digitalFingerprint: null,
        cardId: null,
    };
}

/**
 * حساب + سجل وظيفي مرتبط. إن فشل الثاني يُحذف الأول (أفضل جهد) ويُرمى
 * الخطأ الأصلي؛ لا نُبقي حسابًا بلا موظف ولا ندّعي نجاحًا كاذبًا.
 * @param {object} row صف المعاينة
 * @param {{department?:string, position?:string, joinDate?:string}} options
 */
export async function createBulkAccount(row, options = {}) {
    const savedUser = await createUser(bulkUserPayload(row));
    try {
        const savedEmployee = await createEmployee(bulkEmployeePayload(row, {
            ...options, userId: savedUser && savedUser.id,
        }));
        return { user: savedUser, employee: savedEmployee };
    } catch (error) {
        try { await deleteUser(savedUser && savedUser.id); } catch (_) { /* rollback best effort */ }
        throw error;
    }
}
