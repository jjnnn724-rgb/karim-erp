/**
 * V2 — Scan repo: باركود الأصناف — ربطٌ ثم دخول (البند ٩، الموجة الأولى)
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS (قيس، لا افتراض — ٢٠٢٦-١٠-١٦ على قاعدة karim_erp):
 *   356 صنفًا في `inventory` و**صفر** منها يحمل باركودًا (`barcode IS NOT
 *   NULL AND barcode <> ''` = 0)، و0 فاتورة و0 إذن صرف يذكران الباركود داخل
 *   `items`. فالماسح الذي «يبحث عن صنف بالباركود» وحده لن يقرأ شيئًا قبل حملة
 *   ربط؛ والشاشة التي لا تقيس التغطية لا تعرف متى تنتهي الحملة. لذا هذه
 *   الوحدة نموذجٌ خالص للربط + حلّ الكود + قياس التغطية، بلا DOM وبلا
 *   localStorage حتى تُختبر في node كما تُختبر في المتصفح.
 *
 * صفر خادم · صفر سكيمًا · صفر `ALTER` — كل باب هنا مسارٌ موجود:
 *   البحث (حلّ الكود)  GET  /warehouse/inventory/search   warehouse-routes.js:1722
 *       Projection عند :1778-1781 تُرجع `barcode` و`avgCost`؛ و ILIKE على
 *       الباركود في الحرفي (:1742) — أما طبقة «عائلات الحروف» فاسمٌ فقط
 *       (:1764 `i.name ~* $1`) فلا تُرجع صنفًا بباركودٍ مطابق خطأً.
 *   الربط (كتابة)     PUT  /api/inventory/:id            server.js:2029
 *       `barcode` في قائمة الحقول المسموحة (schema-registry.js:326) بحدّ 100
 *       (:348)، والأدوار admin/manager/warehouse (schema-registry.js:780).
 *       الـ`SET` يبنى من المفاتيح المُرسلة وحدها (server.js:2115-2129) —
 *       إرسال `{barcode}` لا يلمس `qty` ولا `name` ولا أي عمود آخر.
 *       الحارس 422 على `qty/avgCost` (server.js:2059) لا يُلمَس أصلاً.
 *   الوارد (كتابة)    POST /warehouse/inventory/:id/receipt  warehouse-routes.js:1584
 *       سببُ القيد في الخادم حرفيًا: «إضافة مخزون يدوية عبر المسح» (:1607)،
 *       والباب مُغَلَّفٌ في `inventory-repo.js:391 receiveInventoryItem` مع
 *       باني الحمولة `receiptPayload` (:384) — تُستعملان كما هما، لا نُقلّدهما.
 *
 * ما NOT هنا (قرارُ موجة، لا نسيان): الصادر (`dispatches`) يحتاج توقيعًا
 *   handwritten إلزاميًا وسلسلة اعتماد (warehouse-routes.js:365-382 و:621
 *   و:1076) فموجته مستقلة؛ ولا قيد UNIQUE على `barcode` في القاعدة،
 *   فالتفريد هنا فحصٌ في النموذج لا وهمٌ بقيد الخادم.
 */

import { apiFetch } from '../../core/api.js?v=4.9.197';
import { fetchInventory } from './inventory-repo.js?v=4.9.197';

/** سقوف الخادم: `barcode VARCHAR(100)` (010_inventory_barcode.sql:5) وmaxLength
 *  100 في السجل (schema-registry.js:348) — لا نرسل أطول مما يقبل. */
export const BARCODE_MAX = 100;

/* ── المفتاح (نموذجٌ خالص: الشاشة تقرأ window وتحمل له القيم) ─────────────
   العنوان يغلب المخزَّن، وغياب الاثنين يعني إطفاءً. لا جديد يعمل بلا قرار
   من المالك. واللقطة `#` مستبعدة من القيمة لأن callers يمرّرون أحيانًا
   عنوانًا كاملًا بوسمه. */

const FLAG_TRUE = new Set(['1', 'true', 'on']);

/** @returns {{enabled:boolean, source:'query'|'stored'|'default'}} من أين جاء القرار */
export function scanEnabledModel(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2scan=([^&#]*)/);
    if (match) {
        return { enabled: FLAG_TRUE.has(decodeURIComponent(match[1]).toLowerCase()), source: 'query' };
    }
    if (stored == null || stored === '') {return { enabled: false, source: 'default' };}
    return { enabled: FLAG_TRUE.has(String(stored).toLowerCase()), source: 'stored' };
}

/** @returns {boolean} */
export function scanEnabled(search, stored) {
    return scanEnabledModel(search, stored).enabled;
}
/** محارف التحكم التي يلحقها بعض القُرّاء (NUL/CR/LF/TAB) ليست جزءًا من الكود. */
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** Kord-منظّف: لا يُوحّد الحالة (Code128 قد يحمل أحرفًا كبيرة وصغيرة بمعنًى)،
 *  ولا يحذف مسافات داخلية — يقطع الأطراف ومحارف التحكم فقط. */
export function normalizeCode(raw) {
    return String(raw ?? '').replace(CONTROL, '').trim();
}

/** عائلة الكود — للرسالة لا للسلوك: لا نرفض كودًا لأنه ليس EAN. */
export function codeFamily(code) {
    const c = normalizeCode(code);
    if (!c) {return 'empty';}
    if (!/^[0-9]+$/.test(c)) {return 'alphanumeric';}
    if (c.length === 13) {return 'ean13';}
    if (c.length === 8) {return 'ean8';}
    if (c.length === 12) {return 'upc-a';}
    if (c.length === 14) {return 'gtin14';}
    if (c.length % 2 === 0 && c.length >= 6 && c.length <= 14) {return 'itf';}
    return 'numeric-other';
}

/** رقم التحقق GS1: من اليمين وزنٌ يبدأ 3 ويتبادل 1 و3، ثم (10 − باقٍ 10) مود 10. */
export function gtinCheckDigit(body) {
    const digits = String(body ?? '').replace(/\D/g, '');
    let sum = 0;
    for (let i = 0; i < digits.length; i += 1) {
        const weight = (digits.length - i) % 2 === 1 ? 3 : 1;
        sum += Number(digits[i]) * weight;
    }
    return (10 - (sum % 10)) % 10;
}

/**
 * فحص رقم التحقق للأطوال GS1 المعروفة (8 و12 و13 و14) فقط.
 * لا يرفض: كودٌ داخلي قصير أو أبجدي حقٌّ مشروع في مخزن؛ لكنه يَعلَم أن
 * 60% من أخطاء الكتابة تُنتج GTIN بطول صحيح وقيمة تحققٍ خاطئة، فتعرضه
 * الشاشة تحذيرًا يطلب تأكيدًا لا صمتًا (طلب المالك: «دقيق»).
 * @returns {{ok:boolean, checked:boolean, family:string, expected:number|null, reason:string}}
 */
export function validateGtin(code) {
    const c = normalizeCode(code);
    const family = codeFamily(c);
    if (c.length < 2) {
        return { ok: true, checked: false, family, expected: null, reason: 'كودٌ قصير — لا رقم تحقق له يُفحص' };
    }
    if (family === 'alphanumeric' || family === 'numeric-other' || family === 'itf' || family === 'empty') {
        return { ok: true, checked: false, family, expected: null, reason: 'ليس GTIN مقيسًا — لا فحص تحقق عليه' };
    }
    const body = c.slice(0, -1);
    const expected = gtinCheckDigit(body);
    const actual = Number(c.slice(-1));
    if (expected === actual) {
        return { ok: true, checked: true, family, expected, reason: 'رقم التحقق مطابق' };
    }
    return {
        ok: false, checked: true, family, expected,
        reason: `آخر خانة لا تطابق حساب GS1 (المتوقّع ${expected}) — تحقّق من الكود أو أكّد الربط يدويًا`,
    };
}

/** مطابقة تامّة بعد التنظيف، على الصفوف الخامّ التي يُرجعها بحث الخادم. */
export function exactBarcodeMatches(rows, code) {
    const c = normalizeCode(code);
    if (!c) {return [];}
    return (Array.isArray(rows) ? rows : []).filter((r) => r && normalizeCode(r.barcode) === c);
}

/**
 * حالة حلّ مسحٍ واحد: لا شيء · صنفٌ واحد · أكثر من صنف (خطرٌ حقيقي: لا
 * قيد تفريد في القاعدة) · لا مسح بعد (`empty`).
 * @returns {{state:'empty'|'unique'|'ambiguous'|'none', code:string, items:any[], validation:{ok:boolean,checked:boolean,family:string,reason:string}}}
 */
export function resolveScan(rows, code) {
    const c = normalizeCode(code);
    const validation = validateGtin(c);
    if (!c) {return { state: 'empty', code: '', items: [], validation };}
    const items = exactBarcodeMatches(rows, c);
    const state = items.length === 0 ? 'none' : (items.length === 1 ? 'unique' : 'ambiguous');
    return { state, code: c, items, validation };
}

/** مَن يحمل هذا الكود سواي — سؤالٌ يجب قبل كل ربط، لأن التفريد هنا فعلُ واجهة. */
export function barcodeHolders(rows, code, exceptId = null) {
    const c = normalizeCode(code);
    if (!c) {return [];}
    return (Array.isArray(rows) ? rows : []).filter((r) => {
        if (!r || normalizeCode(r.barcode) !== c) {return false;}
        return exceptId === null || String(r.id) !== String(exceptId);
    });
}

/**
 * حالة الربط قبل الإرسال — قرارٌ واحد يجمع ما رآه الماسح والبحث:
 *   bound      الكود مربوط بصنفٍ واحد ⇒ لا ربط، بل وارد
 *   taken      الكود مربوط بغير هذا الصنف ⇒ رفض (لا كتابة فوق رابطٍ حيّ)
 *   invalid    صنفٌ غير موجود في النتيجة ⇒ رفض
 *   duplicate  الصنف عنده كودٌ آخر ⇒ تأكيدٌ يستبدله صراحةً لا بصمت
 *   ready      لا تعارض ⇒ اربط
 *   suspect    رقم التحقق خاطئ ⇒ لا يُربط إلا بتأكيد صريح من المستخدم
 * @returns {{state:string, message:string, code:string, item:any|null, holders:any[], validation:object}}
 */
export function assignDecision(allRows, code, itemId) {
    const c = normalizeCode(code);
    const validation = validateGtin(c);
    const item = (Array.isArray(allRows) ? allRows : []).find((r) => r && String(r.id) === String(itemId)) || null;
    if (!c) {return { state: 'empty', message: 'لا كود — امسح الباركود أو اكتبه', code: c, item, holders: [], validation };}
    const holders = barcodeHolders(allRows, c, itemId);
    if (holders.length) {
        return {
            state: 'taken',
            message: `الكود مربوط بـ«${holders[0].name || holders[0].id}» — لا يُربط بصنفين`,
            code: c, item, holders, validation,
        };
    }
    if (!item) {
        return { state: 'invalid', message: 'الصنف غير موجود في نتيجة الخادم — أعد البحث', code: c, item, holders: [], validation };
    }
    if (!validation.ok) {
        return { state: 'suspect', message: validation.reason, code: c, item, holders: [], validation };
    }
    if (normalizeCode(item.barcode) && normalizeCode(item.barcode) !== c) {
        return {
            state: 'duplicate',
            message: `«${item.name}» مربوط بالفعل بـ${normalizeCode(item.barcode)} — الربط يستبدله`,
            code: c, item, holders: [], validation,
        };
    }
    return { state: 'ready', message: `يربط «${item.name || item.id}» بالكود ${c}`, code: c, item, holders: [], validation };
}

/**
 * تغطية الحملة — الأرقام التي تُنهي العمل لا التي تُطرب النظر:
 * assigned/unassigned/pct، وعدد Codes المكرّرة، وعدّة أكواد كسرَ فحصُها.
 */
export function coverage(rows) {
    const list = Array.isArray(rows) ? rows : [];
    let assigned = 0;
    const byCode = new Map();
    let suspect = 0;
    for (const r of list) {
        const code = normalizeCode(r && r.barcode);
        if (!code) {continue;}
        assigned += 1;
        byCode.set(code, (byCode.get(code) || 0) + 1);
        if (!validateGtin(code).ok) {suspect += 1;}
    }
    const total = list.length;
    const duplicates = [...byCode.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);
    return {
        total,
        assigned,
        unassigned: total - assigned,
        pct: total ? Math.round((assigned / total) * 100) : 0,
        distinct: byCode.size,
        duplicates: duplicates.map(([code, count]) => ({ code, count })),
        suspect,
    };
}

/** الأصناف بلا كود — قائمة العمل التي تُطوى عليها الحملة (مفرزة بالاسم كما يوردها الخادم). */
export function unassignedRows(rows, limit = 200) {
    return (Array.isArray(rows) ? rows : [])
        .filter((r) => r && !normalizeCode(r.barcode))
        .slice(0, Math.max(1, Number(limit) || 200));
}

/* ── جلسات الوارد (نموذجٌ خالص: لا شبكة، لا DOM) ─────────────────────────
   المسح المتكرر لنفس الكود يُدمج في سطرٍ واحد بعدًّا — لأن أمين المخزن
   يمسح كارتونةً بعشر مرات لا يمسح عشرة أصناف. */

/** @returns {Array} سطرٌ جديد أو موجود بكميةٍ مُجمَّعة (لا عدّ الصفر) */
export function bumpLine(lines, key, delta = 1) {
    const list = Array.isArray(lines) ? lines.slice() : [];
    const step = Number(delta) > 0 ? Number(delta) : 1;
    const at = list.findIndex((l) => l && String(l.key) === String(key));
    if (at === -1) {
        list.push({ key: String(key), count: step, qty: step });
        return list;
    }
    list[at] = { ...list[at], count: Number(list[at].count || 0) + step, qty: Number(list[at].qty || 0) + step };
    return list;
}

/** كمية سطرٍ يدويًا بعد المسح — تُقبل الكسور (كيلو/لتر) وتُرفض السالبة. */
export function setLineQty(lines, key, qtyRaw) {
    const n = Number(qtyRaw);
    const list = Array.isArray(lines) ? lines.slice() : [];
    return list.map((l, i) => (i === list.findIndex((x) => x && String(x.key) === String(key))
        ? { ...l, qty: Number.isFinite(n) && n > 0 ? n : l.qty }
        : l));
}

/**
 * سعر الوحدة على السطر — `null` تعني «اتركه للخادم»: receiptPayload يرجع إلى
 * `avgCost` عند الفراغ (inventory-repo.js:384-388)، وهذا بالضبط سلوك القديم.
 * تعيش على السطر لا في الحقل، لأن أيّ إعادة رسمٍ للجلسة كانت تمسح ما كتبه
 * أمين المخزن صامتةً — ثم يُسجَّل الوارد بمتوسط التكلفة بدل سعر المورد.
 */
export function setLinePrice(lines, key, priceRaw) {
    const raw = String(priceRaw ?? '').trim();
    const n = Number(raw);
    const price = !raw || !Number.isFinite(n) || n < 0 ? null : n;
    return (Array.isArray(lines) ? lines : []).map((l) => (String(l && l.key) === String(key) ? { ...l, price } : l));
}

export function dropLine(lines, key) {
    return (Array.isArray(lines) ? lines : []).filter((l) => l && String(l.key) !== String(key));
}

/**
 * تاريخ الصلاحية على السطر (سياسة 2026-10-20: اختياري، والغياب null).
 * يُخزَّن كما كتب أمين المخزن — والفساد وحده يرفضه الخادم 422،
 * ولا تاريخ يُخترع من اليوم.
 */
export function setLineExpiry(lines, key, expiryRaw) {
    const value = String(expiryRaw ?? '').trim();
    return (Array.isArray(lines) ? lines : [])
        .map((l) => (String(l && l.key) === String(key) ? { ...l, expiryDate: value || null } : l));
}

export function sessionTotals(lines) {
    const list = Array.isArray(lines) ? lines : [];
    return list.reduce((acc, l) => ({
        lines: acc.lines + 1,
        scans: acc.scans + Number(l.count || 0),
        qty: Math.round((acc.qty + Number(l.qty || 0)) * 1000) / 1000,
    }), { lines: 0, scans: 0, qty: 0 });
}

/* ── الأبواب ────────────────────────────────────────────────────────────── */

/**
 * بحثٌ الخادم هو من يقرر نتيجته (q على الاسم والباركود والفئة)، ثم تُصفَّى
 * المطابقة التامّة في النموذج — لا يطوى أيُّ «أقرب نتيجة» على أنها مطابقة.
 * @returns {Promise<{rows:any[],total:number,truncated:boolean,matches:any[],code:string}>}
 */
export async function lookupByCode(code) {
    const c = normalizeCode(code);
    if (!c) {return { rows: [], total: 0, truncated: false, matches: [], code: c };}
    const res = await fetchInventory({ q: c, maxPages: 10 });
    return {
        rows: res.rows,
        total: res.total,
        truncated: res.truncated,
        matches: exactBarcodeMatches(res.rows, c),
        code: c,
    };
}

/** قائمة عمل الحملة — أصنافٌ ببحثٍ مفتوح (q='' يرجع كل المخزن بحدّ المشي). */
export async function loadCampaign(limit = 2000) {
    const res = await fetchInventory({ q: '', maxPages: 10 });
    const rows = Number(limit) > 0 ? res.rows.slice(0, Number(limit)) : res.rows;
    return { rows, total: res.total, truncated: res.truncated };
}

/** بحثٌ بالاسم لاختيار الصنف عند كودٍ غير مربوط — نفس باب الجرد، لا بابٌ ثانٍ. */
export async function searchItems(term) {
    const q = String(term ?? '').trim().slice(0, 100);
    if (!q) {return [];}
    const res = await fetchInventory({ q, maxPages: 2 });
    return res.rows;
}

/**
 * ربط الكود بصنف — عمودٌ واحد يُرسَل، فيحدّث الخادم عمودًا واحدًا
 * (server.js:2115-2129 يبني SET من المفاتيح المرسلة فقط). لا يلمس qty ولا
 * avgCost، فلا يُكسر حارس server.js:2059 ولا إسقاط الدفتر.
 * @returns {Promise<any>} الصف المُحدَّث كما أرجعه الخادم
 */
export async function assignItemBarcode(itemId, barcode) {
    const code = normalizeCode(barcode).slice(0, BARCODE_MAX);
    if (!code) {throw new Error('لا يمكن ربط صنفٍ بكودٍ فارغ');}
    return apiFetch(`/inventory/${encodeURIComponent(String(itemId))}`, {
        method: 'PUT',
        body: JSON.stringify({ barcode: code }),
    });
}

/** تفريغ الكود — نفس الباب بحمولةٍ فارغة صريحة؛ الخادم يقبل السلسلة الفارغة
 *  (TYPES.STRING في schema-registry.js:340) ولا يمسّ سواها. */
export async function clearItemBarcode(itemId) {
    return apiFetch(`/inventory/${encodeURIComponent(String(itemId))}`, {
        method: 'PUT',
        body: JSON.stringify({ barcode: '' }),
    });
}
