/**
 * سياسة تاريخ الصلاحية — حرس دخول البضاعة للمخزن
 * ═══════════════════════════════════════════════════════════════════════
 * طلب المالك 2026-10-19: «عند إضافة أي فاتورة شراء لازم تاريخ الصلاحية —
 * لا تقبل بدون تاريخ صلاحيه دخول المنتج للمخزن»، والنطاق المختار:
 * **كل مداخل المخزون**.
 *
 * القواعد التي يقرها هذا الملف (لا يُخترع تاريخ أبداً):
 *   • مدخل بضاعة جديدة (فاتورة شراء/إضافة يدوية/استيراد/رصيد افتتاحي):
 *     تاريخ الصلاحية إلزامي لكل صنف — يُرفض الطلب 422 بلا استثناء.
 *   • حركة داخلية (صرف/استلام/إرجاع/تحويل/جرد): الصنف داخل النظام من قبل،
 *     فيُحمل تاريخ دُفعته المسجل في الدفتر (latestExpiryFor) ويُترك فارغًا
 *     إن لم يوجد — الرفض هناك كان يعطّل الجرد والمرتجعات بلا فائدة.
 *
 * الحكم النهائي للخادم دائمًا: الواجهة تتحقق للراحة فقط.
 */

/** أرقام ASCII فقط — نفس صرامة قيود 103 (لا أرقام عربية ولا مسافات). */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @returns {string|null} 'YYYY-MM-DD' صحيحة تقويميًا، أو null إن غاب أو فسد.
 */
function normalizeExpiryDate(value) {
    if (value === null || value === undefined || value === '') {return null;}
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {return null;}
        const y = value.getFullYear();
        const m = String(value.getMonth() + 1).padStart(2, '0');
        const d = String(value.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    const raw = String(value).trim();
    // يقبل ISO الكامل بالتوقيت (2026-11-05T00:00:00Z) والمختصر (2026-11-05).
    const m = DATE_RE.exec(raw.slice(0, 10));
    if (!m) {return null;}
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (year < 1900 || month < 1 || month > 12) {return null;}
    const date = new Date(Date.UTC(year, month - 1, day));
    // 2026-02-31 ← يتحول إلى 2026-03-03: رفضٌ صريح بدل تاريخ مخترع.
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {return null;}
    return `${m[1]}-${m[2]}-${m[3]}`;
}

/** القراءة من أي تسمية حقل (camelCase في الواجهة وsnake_case في القاعدة). */
function readExpiryField(source, keys = ['expiryDate', 'expiry_date', 'bestBefore', 'best_before']) {
    const src = source && typeof source === 'object' ? source : {};
    for (const key of keys) {
        if (src[key] !== undefined && src[key] !== null && String(src[key]).trim() !== '') {
            return src[key];
        }
    }
    return null;
}

/**
 * @param {Array} lines صفوف الطلب (أصناف فاتورة/استيراد…).
 * @param {(line)=>string} nameOf اسم الصنف لرسالة عربية مفيدة.
 * @returns {{ok:boolean, code?:string, message?:string, missing:string[], invalid:string[]}}
 * رسالة واحدة تحمل أسماء الأصناف الناقصة (أسلوب الخادم: عربي + اسم الصنف).
 */
function checkExpiryOnLines(lines = [], nameOf = (line) => String(line?.itemName || line?.name || '')) {
    const missing = [];
    const invalid = [];
    for (const line of lines) {
        const raw = readExpiryField(line);
        const normalized = normalizeExpiryDate(raw);
        if (!normalized) {
            (raw === null || raw === undefined || String(raw).trim() === '' ? missing : invalid).push(nameOf(line));
        }
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

/**
 * تاريخ دُفعة صنف مسجل سابقًا في الدفتر — للحركات الداخلية فقط.
 * الأحدث أولًا (sort بالمعرّف تنازليًا مثل بقية القراءة في V2).
 */
async function latestExpiryFor(client, inventoryId) {
    if (!Number.isFinite(Number(inventoryId))) {return null;}
    const hit = (await client.query(
        `SELECT expiry_date FROM inventory_ledger
          WHERE inventory_id = $1 AND expiry_date IS NOT NULL
          ORDER BY id DESC LIMIT 1`,
        [Number(inventoryId)]
    )).rows[0];
    return hit ? normalizeExpiryDate(hit.expiry_date) : null;
}

module.exports = { normalizeExpiryDate, readExpiryField, checkExpiryOnLines, latestExpiryFor };
