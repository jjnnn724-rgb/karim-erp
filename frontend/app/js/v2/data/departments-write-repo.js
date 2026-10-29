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

import { apiFetch } from '../../core/api.js?v=4.9.186';

export const DEPARTMENT_WRITE_ROLES = ['admin', 'manager'];
export const HR_DEPARTMENT_WRITE_ROLES = ['admin', 'manager', 'hr'];

export const DEPARTMENT_ICON_OPTIONS = [
    ['building', 'مبنى'], ['store', 'متجر'], ['chef-hat', 'مطبخ'],
    ['package', 'مخزن'], ['banknote', 'حسابات'], ['users', 'موظفون'],
    ['chart', 'تقارير'], ['utensils', 'مطعم'],
];

/* ── تطبيع أيقونة القسم: رمز تعبية قديم في القاعدة → مفتاح lucide ──────
 * القاعدة تحوي على رموز تعبية (🧾🧊🍽🍔🥩🚚🔥🥖) وُضعت قبل وحدة الرموز،
 * والقديم كان يعرض «building» لكل رمز تعبية (features/departments.js:9).
 * هنا نُحوّلها لأقرب مفتاح حقيقي في KARIM_ICONS فلا تختفي هوية الأقسام. */
const EMOJI_ICON_MAP = {
    '🧾': 'receipt', '🧊': 'package', '🍽': 'utensils', '🍽️': 'utensils',
    '🍔': 'cooking-pot', '🥩': 'beef', '🚚': 'external', '🔥': 'flame',
    '🥖': 'bread', '☕': 'coffee', '🍹': 'cup-soda', '🥤': 'cup-soda',
    '🥗': 'salad', '🍰': 'cake', '🎂': 'cake', '🐟': 'fish', '🍚': 'rice',
    '🥛': 'droplet', '🍳': 'cooking-pot', '🏭': 'building', '🏬': 'store',
    '🏪': 'store', '📦': 'package', '💰': 'banknote', '🧑‍🍳': 'chef-hat',
    '👨‍🍳': 'chef-hat', '👩‍🍳': 'chef-hat', '🥓': 'beef', '🍗': 'drumstick',
    '🍖': 'drumstick', '🥐': 'bread', '🍩': 'cake', '🍪': 'cake',
    '🍫': 'cake', '🍬': 'cake', '🍭': 'cake', '🧁': 'cake', '🍦': 'cake',
    '🍶': 'cup-soda', '🍺': 'cup-soda', '🍷': 'cup-soda', '🧃': 'cup-soda',
};

/** مفاتيح lucide المسموحة لأيقونات الأقسام — مرآة KARIM_ICONS وقت التشغيل. */
const ALLOWED_ICON_KEYS = new Set([
    ...DEPARTMENT_ICON_OPTIONS.map(([v]) => v),
    'receipt', 'flame', 'beef', 'bread', 'coffee', 'cup-soda', 'salad',
    'cooking-pot', 'external', 'fish', 'rice', 'cake', 'drumstick',
    'droplet', 'shopping-cart', 'barcode', 'banknote', 'chart', 'users',
    'package', 'store', 'building', 'chef-hat', 'utensils', 'scale',
    'archive', 'clipboard-list', 'leaf', 'tree', 'warehouse',
]);

/**
 * تحويل قيمة أيقونة القسم إلى مفتاح أيقونة صالح للعرض.
 * @param {*} value — اسم lucide أو رمز تعبية أو HTML قديم `data-i="..."`
 * @param {Set<string>} [known] — مفاتيح KARIM_ICONS الحقيقية (اختياري؛
 *   إن غابت يُتحقق على ALLOWED_ICON_KEYS — نفس منطق القديم).
 * @returns {string} مفتاح lucide، أو رمز تعبية غير معروف يُعرض كما هو.
 */
export function normalizeDepartmentIcon(value, known) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) {return 'building';}
    const m = raw.match(/data-i=["']?([a-z0-9-]+)/i);
    let key = m ? m[1] : raw;
    key = EMOJI_ICON_MAP[key] || key;
    if (/^[a-z0-9-]+$/.test(key)) {
        if (known) {return known.has(key) ? key : 'building';}
        return ALLOWED_ICON_KEYS.has(key) ? key : 'building';
    }
    return key; // رمز تعبية غير معروف — يُعرض كما هو (بيانات المستخدم مقدّسة)
}

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
