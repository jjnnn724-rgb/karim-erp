/**
 * V2 — كتابة الأقسام (P1-3)
 * ═══════════════════════════════════════════════════════════════════════
 * الباب العام في الخادم قائم منذ البداية: POST/PUT/DELETE /api/departments
 * و/api/hrDepartments (server.js:1769/2021/2264) بحارس
 * getEntityWriteRoles = schema-registry:790/:787. هذا الملف واجهةٌ عميل
 * فقط — لا باب خادم جديد ولا تغيير مسار.
 *
 * الحمولات منقوشة من legacy:
 *   departments  — features/departments.js:317 (create) · :334 (update)
 *   hrDepartments — features/hr.js:695 (create) · :717 (update) · :725 (delete)
 * لا id ولا حقل نظامي يُرسَل؛ الخادم يولّده/يحميه.
 */

import { apiFetch } from '../../core/api.js?v=4.9.146';

export const DEPARTMENT_WRITE_ROLES = ['admin', 'manager'];
export const HR_DEPARTMENT_WRITE_ROLES = ['admin', 'manager', 'hr'];

export const DEPARTMENT_ICON_OPTIONS = [
    ['building', 'مبنى'], ['store', 'متجر'], ['chef-hat', 'مطبخ'],
    ['package', 'مخزن'], ['banknote', 'حسابات'], ['users', 'موظفون'],
    ['chart', 'تقارير'], ['utensils', 'مطعم'],
];

const clean = (v) => String(v == null ? '' : v).trim();

/** كود الموارد البشرية: لاتيني آمن، وإلا كود مولّد كما في legacy:694. */
export function safeHrCode(code, stamp) {
    const raw = clean(code).toUpperCase();
    if (raw && !/[^A-Za-z0-9_-]/.test(raw)) {return raw.slice(0, 20);}
    const seed = stamp === undefined ? Date.now() : stamp;
    return 'HRD-' + Number(seed).toString(36).toUpperCase().slice(-6);
}

/**
 * @returns {{ok:boolean, message?:string, payload?:object}}
 * قواعد legacy: الاسم والكود مطلوبان؛ التعديل لا يغيّر الكود.
 */
export function validateDepartmentForm(input = {}, editing = null) {
    const name = clean(input.name);
    const code = clean(input.code).toUpperCase();
    if (!name) {return {ok: false, message: 'اسم القسم مطلوب'};}
    if (name.length > 255) {return {ok: false, message: 'اسم القسم أطول من الحد المسموح'};}
    if (!editing && !code) {return {ok: false, message: 'كود القسم مطلوب'};}
    if (!editing && code.length > 3) {return {ok: false, message: 'كود القسم 3 أحرف كحد أقصى'};}
    const payload = editing
        ? {
            name,
            icon: clean(input.icon) || 'building',
            parent_code: clean(input.parent_code) || null,
        }
        : {
            code,
            name,
            icon: clean(input.icon) || 'building',
            color: clean(input.color) || '#009688',
            parent_code: clean(input.parent_code) || null,
        };
    return {ok: true, payload};
}

export function validateHrDepartmentForm(input = {}, editing = null) {
    const name = clean(input.name);
    const code = clean(input.code).toUpperCase();
    if (!name) {return {ok: false, message: 'اسم القسم مطلوب'};}
    if (name.length > 150) {return {ok: false, message: 'اسم القسم أطول من الحد المسموح'};}
    if (!editing && !code) {return {ok: false, message: 'كود القسم مطلوب'};}
    const payload = editing
        ? { name, manager: clean(input.manager) || null }
        : {
            name,
            code: safeHrCode(code, input.stamp),
            manager: clean(input.manager) || null,
        };
    return {ok: true, payload};
}

export function createDepartment(input) {
    return apiFetch('/departments', { method: 'POST', body: JSON.stringify(input) });
}

export function updateDepartment(id, input) {
    return apiFetch(`/departments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteDepartment(id) {
    return apiFetch(`/departments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function createHrDepartment(input) {
    return apiFetch('/hrDepartments', { method: 'POST', body: JSON.stringify(input) });
}

export function updateHrDepartment(id, input) {
    return apiFetch(`/hrDepartments/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteHrDepartment(id) {
    return apiFetch(`/hrDepartments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
