/**
 * V2 — سياسة تاريخ الصلاحية (مرآة backend/expiry-policy.js)
 * ═══════════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-19: لا يدخل صنف المخزن بلا تاريخ صلاحية.
 * الخادم هو الحكم دائمًا (422 EXPIRY_DATE_REQUIRED / INVALID_EXPIRY_DATE)،
 * وهذه الطبقة تعطي العامل الرسالة نفسها قبل الإرسال حتى لا ينتظر دورة شبكة.
 * الصيغة الوحيدة المقبولة YYYY-MM-DD — لا تاريخ يُخترع ولا يُعاد ترتيبه.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPIRY_KEYS = ['expiryDate', 'expiry_date', 'bestBefore', 'best_before'];

/** @returns {string|null} 'YYYY-MM-DD' صحيحة تقويميًا أو null */
export function normalizeExpiryDate(value) {
    if (value === null || value === undefined || value === '') {return null;}
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {return null;}
        const p = (n) => String(n).padStart(2, '0');
        return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
    }
    const m = DATE_RE.exec(String(value).trim().slice(0, 10));
    if (!m) {return null;}
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (year < 1900 || month < 1 || month > 12) {return null;}
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {return null;}
    return `${m[1]}-${m[2]}-${m[3]}`;
}

/** قراءة الحقل من أي تسمية (camelCase في الواجهة، snake_case في القاعدة). */
export function readExpiryField(source, keys = EXPIRY_KEYS) {
    const src = source && typeof source === 'object' ? source : {};
    for (const key of keys) {
        const v = src[key];
        if (v !== undefined && v !== null && String(v).trim() !== '') {return v;}
    }
    return null;
}

/**
 * فحص أسطر البضاعة الجديدة — نفس قرار الخادم ونفس نص الرسالة.
 * @returns {{ok:boolean, code?:string, message?:string, missing:string[], invalid:string[]}}
 */
export function checkExpiryOnLines(lines = [], nameOf = (line) => String(line?.itemName || line?.name || '')) {
    const missing = [];
    const invalid = [];
    for (const line of lines) {
        const raw = readExpiryField(line);
        if (normalizeExpiryDate(raw)) {continue;}
        (raw === null ? missing : invalid).push(nameOf(line));
    }
    if (missing.length) {
        return {
            ok: false,
            code: 'EXPIRY_DATE_REQUIRED',
            message: `تاريخ الصلاحية إلزامي لكل صنف يدخل المخزن — أضِف تاريخ الصلاحية للصنف ${missing.slice(0, 5).join('، ')}${missing.length > 5 ? ` (+${missing.length - 5} صنفًا)` : ''}`,
            missing, invalid,
        };
    }
    if (invalid.length) {
        return {
            ok: false,
            code: 'INVALID_EXPIRY_DATE',
            message: `تاريخ الصلاحية غير صحيح للصنف ${invalid.slice(0, 5).join('، ')} — الصيغة المطلوبة YYYY-MM-DD`,
            missing, invalid,
        };
    }
    return { ok: true, missing: [], invalid: [] };
}
