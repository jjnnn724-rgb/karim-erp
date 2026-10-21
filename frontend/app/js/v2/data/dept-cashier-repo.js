/**
 * V2 — روابط الأقسام ↔ الكاشير (طلب المالك 2026-10-19)
 * ═══════════════════════════════════════════════════════════════════════
 * «عايز أقدر أربط القسم بالكاشير المعين» — الربط كان خريطة ثابتة في الكود
 * (v2/data/dept-detail.js:18 وfeatures/departments.js:17)، والآن صار بيانات
 * في جدول 103_dept_cashier_links.
 *
 * الأبواب: باب CRUD العام القائم نفسه — GET/POST/PUT/DELETE
 * /api/dept_cashier_links (server.js: entities + schema-registry:270).
 * لا باب خادم جديد، ولا تغيير مسار. الأدوار حُكمها الخادم
 * (OPEN_ENTITY_WRITE_ROLES = admin|manager) وهذا العميل يعرض الأزرار فقط.
 * الكتابة كلها خلف علم v2deptcashier (ظاهرٌ افتراضيًا، و`=0` يُخفيه — طلب المالك: الأوبشن في الواجهة).
 *
 * تكافؤ الأرقام: جدول 103 مبذور بنفس الخريطة المكتوبة، فإذا غابت الروابط
 * (الميجريشن لم يُطبَّق بعد، أو قراءة غير متاحة) يرجع الحساب للخريطة كما في
 * القديم حرفيًا — لا يختفي إيراد الكاشير من البطاقة في أي حال.
 */

import { apiFetch } from '../../core/api.js?v=4.9.187';
import { fetchEntityNewest, deptWithChildren } from './finance-repo.js?v=4.9.187';
import { CASHIER_DEPT_MAP } from './dept-detail.js?v=4.9.187';

export const LINKS_ENTITY = 'dept_cashier_links';
export const DEPT_CASHIER_WRITE_ROLES = ['admin', 'manager'];

export const fetchDeptCashierLinks = () => fetchEntityNewest(LINKS_ENTITY);

/** رقم الكاشير: أرقام فقط (١..٩٩٩٩٩٩) — مرآة قيد CHECK في 103. */
export function normalizeCashierNo(value) {
    return String(value ?? '').trim();
}

export function isValidCashierNo(value) {
    return /^[0-9]{1,6}$/.test(normalizeCashierNo(value));
}

/**
 * @returns {{ok:boolean, message?:string, payload?:object}}
 * نفس قواعد الخادم (validateDeptCashierLink في server.js) — التحقق هنا
 * راحة مستخدم فقط، والخادم يرفض من جديد لا محالة.
 */
export function validateLinkForm(input = {}) {
    const deptCode = String(input.dept_code ?? '').trim();
    const cashierNo = normalizeCashierNo(input.cashier_no);
    if (!deptCode) {return {ok: false, message: 'اختر القسم أولًا'};}
    if (!cashierNo) {return {ok: false, message: 'رقم الكاشير مطلوب'};}
    if (!isValidCashierNo(cashierNo)) {return {ok: false, message: 'رقم الكاشير أرقام فقط (مثل 1 أو 9)'};}
    return {
        ok: true,
        payload: {
            dept_code: deptCode,
            cashier_no: cashierNo,
            is_primary: input.is_primary === true || input.is_primary === '1' || input.is_primary === 1,
            notes: String(input.notes ?? '').trim().slice(0, 255) || null,
        },
    };
}

export function createDeptCashierLink(payload) {
    return apiFetch(`/${LINKS_ENTITY}`, { method: 'POST', body: JSON.stringify(payload) });
}

export function updateDeptCashierLink(id, payload) {
    return apiFetch(`/${LINKS_ENTITY}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
}

export function deleteDeptCashierLink(id) {
    return apiFetch(`/${LINKS_ENTITY}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

const norm = (v) => String(v ?? '').trim();

/** روابط هذا القسم وأقسامه الفرعية — مع وراؤها لتمييزها في البطاقة. */
export function deptLinkRows(deptCode, links = [], departments = []) {
    const codes = deptWithChildren(departments, deptCode);
    const rows = (links || [])
        .filter((l) => codes.has(norm(l.dept_code)))
        .map((l) => ({
            id: l.id,
            cashierNo: norm(l.cashier_no),
            deptCode: norm(l.dept_code),
            isPrimary: l.is_primary === true || l.is_primary === 'true',
            notes: norm(l.notes),
            inherited: norm(l.dept_code) !== norm(deptCode),
        }));
    rows.sort((a, b) => (a.isPrimary === b.isPrimary ? a.cashierNo.localeCompare(b.cashierNo, 'ar', {numeric: true}) : (a.isPrimary ? -1 : 1)));
    return rows;
}

/**
 * أرقام كاشيرات القسم (مع الفروع) — المصدر الأساسي الروابط من القاعدة،
 * والخريطة المكتوبة احتياطًا حتى يُطبَّق جدول 103.
 * @returns {{nos:string[], source:'db'|'map'}}
 */
export function deptCashierNos(deptCode, {links = [], departments = []} = {}) {
    const codes = deptWithChildren(departments, deptCode);
    const fromDb = (links || [])
        .filter((l) => codes.has(norm(l.dept_code)))
        .map((l) => norm(l.cashier_no))
        .filter(Boolean);
    if (fromDb.length) {return {nos: [...new Set(fromDb)], source: 'db'};}
    const fromMap = Object.keys(CASHIER_DEPT_MAP).filter((no) => codes.has(norm(CASHIER_DEPT_MAP[no])));
    return {nos: fromMap, source: 'map'};
}

/** القسم الذي يملك الرابط مباشرة (للعرض في بطاقة الأب عند الوراثة). */
export function deptNameOf(code, departments = []) {
    const hit = (departments || []).find((d) => norm(d.code) === norm(code));
    return hit ? norm(hit.name) : norm(code);
}

/**
 * دليل كاشيرات يارا سوفت الحي — بند #8 من طلب المالك: «أربط القسم بالكاشير
 * المعين» بلا رقم يُكتب من الذاكرة.
 *
 * بابه GET /api/yara-reports/cashiers-live (yara-reports.js:37): صفوف
 * yarasoft_revenue_map حيث src_table='CC' — أي الكاشيرات المعتمدة فعليًا في
 * خريطة الإيراد، برقمها الخام واسمها العربي وإيراد اليوم. لا Oracle حيّ ولا
 * نداء خارجي: الباب يقرأ القاعدة نفسها، ومن لا يقرأه لا يفتح شاشة الأقسام أصلًا
 * (حرسه admin/manager/accountant/auditor وقائمة الأقسام admin/manager/accountant).
 *
 * الدليل قد يفشل (خريطة فارغة في بيئة جديدة): الشاشة تُكمل بالإدخال اليدوي،
 * ولا تُخترع أسماء لرقم غير معروف.
 */
export async function fetchYaraCashiers() {
    const data = await apiFetch('/yara-reports/cashiers-live');
    const list = Array.isArray(data && data.cashiers) ? data.cashiers : [];
    return list
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({
            no: normalizeCashierNo(c.cashier_no),
            name: norm(c.name) || null,
            deptCode: norm(c.dept_code) || null,
            invoices: Number(c.today_invoices || 0),
            total: Number(c.today_total || 0),
        }))
        .filter((c) => isValidCashierNo(c.no))
        .sort((a, b) => a.no.localeCompare(b.no, 'en', {numeric: true}));
}

/** رقم الكاشير → اسمه في الدليل، أو null لرقم لا يعرفه الدليل. */
export function cashierNameOf(no, directory = []) {
    const hit = (directory || []).find((c) => c.no === normalizeCashierNo(no));
    return hit ? hit.name : null;
}

/** «كاشير 1 — الكافيه» بلا اختراع اسم: الرقم يُعرض دائمًا. */
export function cashierLabel(no, directory = []) {
    const name = cashierNameOf(no, directory);
    return name ? `كاشير ${normalizeCashierNo(no)} — ${name}` : `كاشير ${normalizeCashierNo(no)}`;
}
