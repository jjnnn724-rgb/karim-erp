/**
 * V2 — Inventory repository (الباب الوحيد إلى /api/warehouse/inventory/search + /api/shelves)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * CONTRACT COPIED FROM THE SERVER, NOT INVENTED
 *   GET /warehouse/inventory/search?q&category&stock&page&limit
 *     (warehouse-routes.js:1722 · read gate = admin|manager|warehouse|accountant, same line)
 *       q        ≤ 100 حرفًا، يطابق الاسم أو الباركود أو الفئة (ILIKE :1742)
 *       category قيمة مخزّنة حرفية أو 'all' (:1725,:1744)
 *       stock    كل قيمها المخزّنة: all | low | out | ok — غيرها 422 (:1727)
 *       limit    افتراضي 50 والسقف 200، والخادم يطبّقه مهما أرسل العميل (:1733-1734)
 *     الصفوف: id, name, category, unit, qty, avgCost, minQty, weight,
 *             barcode, shelfId, mainQty                 (:1780-1782)
 *     المغلّف: { data, pagination:{page,limit,total,pages}, categories, fuzzy } (:1795)
 *     `total` عدد السجل كله بالفلتر نفسه — لا عدد الصفحة (:1756,:1794)
 *     قاعدة الحالات كما هي في SQL، وهي المرجع هنا:
 *       out = qty<=0 · low = qty>0 AND qty<=minQty · ok = qty>minQty (:1748-1750)
 *       والـ minQty الغائب يُعامل كصفر بـ COALESCE (:1749)
 *   GET /shelves?page=&limit=&sort=id&order=asc → { data, pagination }
 *     (قائمة الكيانات العامة؛ أعمدة الرف code/name/location/capacity —
 *     schema-registry.js:307-319، وقراءة الرف لـ admin|manager|warehouse :782)
 *
 * DISPLAY ALLOWLIST — READ THIS BEFORE ADDING A COLUMN
 *   The server also returns `avgCost` on every row (:1780). inventoryToRow
 *   drops it. The register on this screen is quantitative: كم يوجد، وما الذي
 *   تحت الحد. A money column needs the restaurant's currency code
 *   (STATE.settings.currency, core/utils.js:25), and that setting is not part
 *   of this host — showing a number without its currency would be a guess.
 *   Cost stays out until the owner asks for a value view with the currency
 *   resolved. Everything the row carries is listed in `rowFields` below.
 *
 * THIS FILE WRITES ONLY THROUGH THE SIX NAMED DOORS (W1-6, below).
 * Until W1-6 it was read-only by construction; the owner's wave order opened
 * the six write paths, and every one of them is mirrored here verbatim —
 * door for door, role for role. Nothing else in this file may POST/PUT/DELETE.
 */

import { apiFetch } from '../../core/api.js?v=4.9.149';
import { formatMoney } from './reports-repo.js?v=4.9.149';

/** The server's own stock enum (warehouse-routes.js:1727) — nothing else is sent. */
export const STOCK_FILTERS = ['all', 'low', 'out', 'ok'];

/** 200 is the server's clamp (:1734); asking for more buys nothing but a silent rewrite. */
const PAGE_SIZE = 200;
/** Ceiling for one walk: 10 × 200 = 2,000 أصناف. Beyond it the screen says so. */
const MAX_PAGES = 10;

/** @returns {Promise<{rows:any[],total:number,categories:string[],fuzzy:boolean,truncated:boolean}>} */
export async function fetchInventory(opts = {}) {
    const q = String(opts.q ?? '').trim().slice(0, 100);        // server cap, same slice (:1724)
    const category = String(opts.category ?? 'all').trim().slice(0, 100);
    const stock = String(opts.stock ?? 'all').trim().toLowerCase();
    if (!STOCK_FILTERS.includes(stock)) {
        throw new Error('فلتر حالة المخزون غير معروف — القيم المتاحة: all، low، out، ok.');
    }
    const maxPages = Math.max(1, Math.min(Number(opts.maxPages) || MAX_PAGES, MAX_PAGES));

    const rows = [];
    let total = 0;
    let categories = [];
    let fuzzy = false;

    for (let page = 1; page <= maxPages; page += 1) {
        const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), stock, category, q });
        const res = await apiFetch(`/warehouse/inventory/search?${params.toString()}`);
        if (!res || typeof res !== 'object') {break;}
        const batch = Array.isArray(res.data) ? res.data : [];
        rows.push(...batch);
        total = Number(res.pagination && res.pagination.total) || 0;
        const pages = Number(res.pagination && res.pagination.pages) || 0;
        if (Array.isArray(res.categories)) {categories = res.categories;}
        fuzzy = Boolean(res.fuzzy);
        if (!batch.length || batch.length < PAGE_SIZE) {break;}   // last page arrived
        if (pages > 0 && page >= pages) {break;}                  // server counted the pages
        if (total > 0 && rows.length >= total) {break;}
    }

    return { rows, total, categories, fuzzy, truncated: total > rows.length };
}

/** Bounded walk of the shelves register — the join table for `shelfId`. */
export async function fetchShelves() {
    const rows = [];
    for (let page = 1; page <= 3; page += 1) {
        const res = await apiFetch(`/shelves?page=${page}&limit=1000&sort=id&order=asc`);
        const batch = res && Array.isArray(res.data) ? res.data
            : (Array.isArray(res) ? res : []);
        rows.push(...batch);
        const totalPages = Number(res && res.pagination && res.pagination.totalPages) || 0;
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < 1000) {break;}
    }
    return rows;
}

/** Keyed by the stored id as a string — `shelfId` arrives as a number or null. */
export function shelfMap(shelves = []) {
    const map = new Map();
    for (const s of shelves) {
        if (s && s.id !== undefined && s.id !== null) {map.set(String(s.id), s);}
    }
    return map;
}

/* ── Numbers ───────────────────────────────────────────────────────────── */

/** Latin digits + thousands grouping, the convention of every V2 screen
 *  (attendance-repo.js, briefing-repo.js, employees-repo.js). */
export function formatInt(v) {
    return Math.round(Number(v) || 0).toLocaleString('en-US');
}

/** Quantities are fractional (kg, l) — an integer format would lie about a
 *  2.5 kg line. Up to three decimals, trailing zeros dropped. */
export function formatQty(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) {return '0';}
    return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;      // COALESCE(...,0) is the server's own rule (:1749)
};

/**
 * The server's three states, computed the server computes them — so the
 * segmented control and the badge can never disagree with a `?stock=` query.
 * `untracked` is not a fourth server state: it is `ok` with no threshold set,
 * and the screen counts it separately instead of hiding it inside «متوفر».
 */
export function stockState(qty, minQty) {
    const q = num(qty);
    const m = num(minQty);
    if (q <= 0) {
        return { key: 'out', label: 'نفد', tone: 'danger', icon: 'circle-x', raw: `qty=${formatQty(q)}` };
    }
    if (q <= m) {
        return { key: 'low', label: 'تحت الحد', tone: 'warning', icon: 'alert-triangle',
            raw: `qty=${formatQty(q)} ≤ min=${formatQty(m)}` };
    }
    return {
        key: 'ok', label: 'متوفر', tone: 'success', icon: 'circle-check',
        raw: `qty=${formatQty(q)} > min=${formatQty(m)}`,
        untracked: !(m > 0),
    };
}

/**
 * Database row → table row. ALLOWLIST only (see header) — pure and exported
 * so it is testable without a browser.
 *
 * `mainQty` is the MAIN-WAREHOUSE balance the server joins in (:1782), `qty`
 * is the register total. What left the main store for department stores is
 * the difference — the same reading the legacy screen uses since the owner's
 * «إذن صرف 4 يعني الباقي 4» (features/warehouse.js:61-62), clamped at zero so
 * a balance above the total shows as a fact, not a negative number.
 */
export function inventoryToRow(raw = {}, shelfById = new Map()) {
    const qty = num(raw.qty);
    const minQty = raw.minQty === undefined || raw.minQty === null ? null : num(raw.minQty);
    const hasMain = raw.mainQty !== undefined && raw.mainQty !== null;
    const mainQty = hasMain ? num(raw.mainQty) : qty;
    const deptQty = Math.max(0, Math.round((qty - mainQty) * 1000) / 1000);
    const shelfId = raw.shelfId === undefined || raw.shelfId === null ? '' : String(raw.shelfId);
    const shelf = shelfById.get(shelfId);
    const state = stockState(qty, minQty);

    return {
        id: raw.id,
        name: raw.name ? String(raw.name) : `#${raw.id ?? '؟'}`,
        nameResolved: !!raw.name,
        category: raw.category ? String(raw.category) : '',
        unit: raw.unit ? String(raw.unit) : '',
        qty,
        mainQty,
        mainFromJoin: hasMain,
        deptQty,
        // A main balance above the register total is a fact about the data,
        // not a number to hide: deptQty is clamped, so the screen says why.
        mainOverTotal: hasMain && mainQty > qty,
        minQty,
        weight: raw.weight === undefined || raw.weight === null ? null : num(raw.weight),
        barcode: raw.barcode ? String(raw.barcode) : '',
        shelfId,
        shelf: shelf ? String(shelf.code || shelf.name || '') : shelfId,
        shelfName: shelf && shelf.name ? String(shelf.name) : '',
        shelfResolved: !!shelf,
        state,
        stateKey: state.key,
        untracked: !!state.untracked,
    };
}

/** What the allowlist hands the screen — pinned by the tests, not by memory. */
export const rowFields = ['id', 'name', 'nameResolved', 'category', 'unit', 'qty', 'mainQty',
    'mainFromJoin', 'deptQty', 'mainOverTotal', 'minQty', 'weight', 'barcode', 'shelfId', 'shelf',
    'shelfName', 'shelfResolved', 'state', 'stateKey', 'untracked'];

/* ── Derived layer (شاشة 03) ───────────────────────────────────────────── */

/** A share needs a real base: an empty result gets a stated dash, not "0%"
 *  of nothing. Mirrors rosterPill in employees-repo.js. */
export function stockPill(count, base, label) {
    if (!(base > 0)) {
        return { text: '—', on: false, aria: `لا أصناف في النتيجة — لا نسبة تُحسب لـ${label}` };
    }
    const pct = (count / base) * 100;
    return {
        text: `${pct.toFixed(1)}%`, on: true,
        aria: `${label}: ${formatInt(count)} من ${formatInt(base)} صنفًا (${pct.toFixed(1)}%)`,
    };
}

/** Counts by one stored field, most frequent first, '' kept as its own key
 *  (countBy in employees-repo.js). */
export function countBy(rows = [], pick = (r) => r) {
    const map = new Map();
    for (const r of rows) {
        const key = String(pick(r) ?? '');
        map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
}

/** Category distribution keyed by the STORED string — two spellings of a
 *  category stay two rows, because the register says they are two rows. */
export function categoryCounts(rows = []) {
    return countBy(rows, (r) => (r && r.category ? String(r.category) : ''));
}

/** How many items sit in each state, all four keys always present so a
 *  zero is displayed as a zero and never as a missing number. */
export function stateCounts(rows = []) {
    const out = { low: 0, out: 0, ok: 0, untracked: 0 };
    for (const r of rows) {
        const key = r && r.stateKey;
        if (key === 'low' || key === 'out' || key === 'ok') {out[key] += 1;}
        if (r && r.untracked) {out.untracked += 1;}
    }
    return out;
}

/**
 * The shortage list: what is under its threshold, biggest gap first.
 * `short` is `minQty − qty` for the rows the server calls `low`; a row with no
 * threshold is not a shortage (the server's own rule), so it never appears.
 */
export function shortageRows(rows = [], limit = 6) {
    return rows
        .filter((r) => r && (r.stateKey === 'low' || r.stateKey === 'out'))
        .map((r) => ({ ...r, short: Math.max(0, num(r.minQty) - num(r.qty)) }))
        .sort((a, b) => b.short - a.short
            || String(a.name).localeCompare(String(b.name), 'ar'))
        .slice(0, limit);
}

/**
 * The chips above the register. Every number is arithmetic over the rows the
 * screen holds; nothing here reads a second endpoint or invents a baseline.
 * @param {any[]} rows
 * @param {{scope?:string, registerTotal?:number, truncated?:boolean}} [opts]
 */
export function buildInventoryKpis(rows = [], opts = {}) {
    const total = rows.length;
    const scope = opts.scope || 'السجل كله';
    const registerTotal = Number(opts.registerTotal) || total;
    const pill = (n, label) => ({ ...stockPill(n, total, label), label });
    const c = stateCounts(rows);

    const chips = [{
        id: 'total', icon: 'package', tone: 'neutral', label: 'إجمالي الأصناف', en: 'Items',
        value: formatInt(total), unit: 'صنفًا',
        hint: opts.truncated
            ? `أول ${formatInt(total)} من ${formatInt(registerTotal)} بالسجل — سقف الجلب`
            : `${scope} · قاعدة الخادم نفسها في الاحتساب`,
        pill: { text: formatInt(registerTotal), on: registerTotal !== total, label: 'في السجل',
            aria: registerTotal
                ? `المجلد من الخادم بهذه الفلاتر: ${formatInt(registerTotal)} صنفًا، المعروض ${formatInt(total)}`
                : 'لا أصناف في السجل بهذه الفلاتر' },
    }];

    for (const spec of [
        { key: 'low', label: 'تحت الحد', en: 'Below minimum', tone: 'warning', icon: 'alert-triangle',
            hint: 'qty>0 و qty≤minQty — كما في الخادم (warehouse-routes.js:1749)' },
        { key: 'out', label: 'نفد', en: 'Out of stock', tone: 'danger', icon: 'circle-x',
            hint: 'qty≤0 — يشمل الأرصدة السالبة كما هي' },
        { key: 'ok', label: 'متوفر', en: 'In stock', tone: 'success', icon: 'circle-check',
            hint: 'qty>minQty — كل ما فوق الحد المسجّل' },
    ]) {
        chips.push({
            id: `state:${spec.key}`, icon: spec.icon, tone: spec.tone,
            label: spec.label, en: spec.en,
            value: formatInt(c[spec.key]), unit: 'صنفًا',
            hint: spec.hint, pill: pill(c[spec.key], spec.label),
        });
    }

    chips.push({
        id: 'untracked', icon: 'circle-help', tone: 'info',
        label: 'بلا حد أدنى', en: 'No minimum',
        value: formatInt(c.untracked), unit: 'صنفًا',
        hint: c.untracked
            ? 'minQty=0 أو غير مسجّل — «تحت الحد» لا ينطبق عليها وهي محسوبة ضمن «متوفر»'
            : (total ? 'كل صنف له حد أدنى مسجّل' : 'النتيجة فارغة — لا حدّ يُقاس عليه'),
        pill: pill(c.untracked, 'بلا حد أدنى'),
    });

    const noShelf = rows.filter((r) => !r || !r.shelfId).length;
    const unresolved = rows.filter((r) => r && r.shelfId && !r.shelfResolved).length;
    chips.push({
        id: 'no-shelf', icon: 'archive', tone: noShelf || unresolved ? 'warning' : 'neutral',
        label: 'بلا رف مسجّل', en: 'No shelf',
        value: formatInt(noShelf), unit: 'صنفًا',
        hint: unresolved
            ? `${formatInt(unresolved)} رفًّا برقمه لم يُحلّ اسمه من /api/shelves`
            : (noShelf ? 'حقل الرف فارغ في السجل'
                : (total ? 'كل صنف على رف باسمه' : 'النتيجة فارغة — لا رفّ يُعدّ')),
        pill: pill(noShelf, 'بلا رف'),
    });

    return chips;
}

/* ══════════════════════════════════════════════════════════════════════════
   W1-6 — الأبواب الستة (كتابات المخزون) — بأمر المالك «اعتمد الجرد وابدأ W1»
   ══════════════════════════════════════════════════════════════════════════
   كل باب هنا منسوخ من الخادم: نفس المسار، نفس الحمولة، نفس أدوار الفحص.
   الواجهة القديمة (features/warehouse.js) مرجع النصوص والسلوك، والخادم
   مرجع الصلاحيات والتحقق:

     1) وارد سريع        POST   /warehouse/inventory/:id/receipt   (warehouse-routes.js:1584)
     2) استيراد دفعي     POST   /warehouse/inventory/bulk-receipt  (:1637) — دفعات 20
     3) حذف              DELETE /inventory/:id                     (server.js:2286 + حارس الأرصدة :2306)
        وحذف نهائي       DELETE /warehouse/inventory/:id/force     (warehouse-routes.js:2423)
     4) تعديل مباشر      PUT    /warehouse/inventory/:id/direct    (:2480)
     5) دمج المكرر       POST   /warehouse/inventory/merge         (:2545)
     6) دورة الجرد        POST   /warehouse/inventory/audits        (inventory-control-routes.js:121)
        عدّ/إرسال/اعتماد/إلغاء + قراءات الاستوديو:
        (stocktaking-routes.js:290/:378/:413 · :199/:221 · :229/:254/:277)

   تحريفات معلنة (كالمعتاد في الموجة — لا اختراع):
   (أ) الاستيراد الدفعي شبكة يدوية لا ملف Excel: xlsx.full.min.js محمّل في
       index.html القديم فقط وليس في v2.html، فلا نضيف موردًا جديدًا للنطاق.
   (ب) لا window.confirm/prompt (CSP): الشاشة تستدعي confirmFn من المضيف
       بالنصوص نفسها التي كانت في الواجهة القديمة.
   (ج) حفظ العدّ بزر صريح لا حفظ تلقائي بعد 900ms — السابقة ذاتها في W1-2،
       وأسلم لعقد الاختبار وقابل للتراجع خطوة بخطوة.
   ══════════════════════════════════════════════════════════════════════ */

/** أدوار الخادم حرفيًا: استلام/استيراد/حذف عادي (warehouse-routes.js:1584,:1637 · schema-registry.js:783) */
export const INV_WRITE_ROLES = ['admin', 'manager', 'warehouse'];
/** الحذف النهائي (:2423) — أدمن ومخزن فقط، لا مدير */
export const INV_FORCE_ROLES = ['admin', 'warehouse'];
/** التعديل المباشر Absolutely (:2480) */
export const INV_DIRECT_ROLES = ['admin'];
/** دمج المكرر (:2545) */
export const INV_MERGE_ROLES = ['admin'];
/** دورة الجرد كتابةً (inventory-control-routes.js:11) وقراءةً (:10) */
export const AUDIT_WRITE_ROLES = ['admin', 'manager', 'warehouse'];
export const AUDIT_READ_ROLES = ['admin', 'manager', 'warehouse', 'accountant'];
/** دفعة الاستيراد: 20 صنفًا كما في القديم (warehouse.js:2525 — مهلة apiFetch 30s) */
export const BULK_CHUNK = 20;

function roleIn(role, list) {
    return list.includes(String(role ?? ''));
}

/** بوابات الظهور بنفس قوائم أدوار الخادم — زر لا يظهر لدور لن يقبله الخادم. */
export function invWriteVisible(role) {return roleIn(role, INV_WRITE_ROLES);}
export function invForceVisible(role) {return roleIn(role, INV_FORCE_ROLES);}
export function invDirectVisible(role) {return roleIn(role, INV_DIRECT_ROLES);}
export function invMergeVisible(role) {return roleIn(role, INV_MERGE_ROLES);}
export function auditWriteVisible(role) {return roleIn(role, AUDIT_WRITE_ROLES);}
export function auditReadVisible(role) {return roleIn(role, AUDIT_READ_ROLES);}

/* ── الباب 1: وارد سريع ───────────────────────────────────────────────────
   القديم (warehouse.js:1324-1345): الكمية من الحقل، والسعر الفارغ/غير الصالح
   (أو صفرًا) يرجع إلى متوسط التكلفة الحالي — `parseFloat(x) || item.avgCost`.
   الخادم يعيد فحص qty>0 و price>=0 ووحدة الصنف (UNIT_MISMATCH :1602). */

export function receiptPayload(item = {}, qtyRaw, priceRaw) {
    const qty = Number(qtyRaw) || 0;
    const parsedPrice = Number(priceRaw);
    const price = parsedPrice || (Number(item.avgCost) || 0);
    return { qty, price, unit: String(item.unit || '') };
}

export async function receiveInventoryItem(id, payload) {
    return apiFetch(`/warehouse/inventory/${encodeURIComponent(String(id))}/receipt`, {
        method: 'POST',
        body: JSON.stringify({
            qty: Number(payload?.qty) || 0,
            price: Number(payload?.price) || 0,
            unit: String(payload?.unit || ''),
        }),
    });
}

/* ── الباب 2: استيراد دفعي (شبكة يدوية) ───────────────────────────────────
   التخطيط منسوخ حرفيًا من القديم (warehouse.js:2515-2522) — نفس الافتراضات
   «عام»/«قطعة»/5 ونفس الفلتر name && qty>0 && price>=0. الخادم يعيد الفحص
   نفسه (warehouse-routes.js:1641-1645). الاتصال بالأسماء يمر بتطبيع الخادم
   (normItemName) فتطابق الأسماء المتشابهة شكلًا بدل إنشاء مكرر. */

export function bulkReceiptRows(rows = []) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
        name: String(row?.name || '').trim(),
        category: String(row?.category || '').trim() || 'عام',
        unit: String(row?.unit || '').trim() || 'قطعة',
        qty: Number(row?.qty) || 0,
        price: Number(row?.price) || 0,
        minQty: Number(row?.minQty) || 5,
    })).filter((row) => row.name && row.qty > 0 && row.price >= 0);
}

export async function bulkReceiveInventory(items) {
    return apiFetch('/warehouse/inventory/bulk-receipt', {
        method: 'POST',
        body: JSON.stringify({ items: Array.isArray(items) ? items : [] }),
    });
}

/* ── الباب 3: حذف عادي + حذف نهائي ────────────────────────────────────────
   الحذف العادي يمر على الحارس العام: صنف له حركات/أرصدة يرد 409
   INVENTORY_HAS_MOVEMENTS (server.js:2315-2319). القديم يفحص الرسالة كما هي
   (warehouse.js:1502) ثم يعرض الحذف النهائي — نفس الفحص هنا. */

export async function deleteInventoryItem(id) {
    return apiFetch(`/inventory/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
}

export async function forceDeleteInventoryItem(id) {
    return apiFetch(`/warehouse/inventory/${encodeURIComponent(String(id))}/force`, { method: 'DELETE' });
}

/** فحص القديم نفسه: الرمز أو نص الرسالة — والصيغة الحرفية 'حركات مخزون'. */
export function hasMovementsError(e) {
    return !!(e && (e.code === 'INVENTORY_HAS_MOVEMENTS' || /حركات مخزون/.test(String(e.message || ''))));
}

/* ── الباب 4: التعديل المباشر (أدمن فقط) ──────────────────────────────────
   القديم (warehouse.js:1445-1462): تحقق قبل الإرسال، ثم الحمولة
   {qty, avgCost, reason} والخادم يقيد الفرق count_correction في الدفتر. */

export function directEditError(qtyRaw, costRaw, reasonRaw) {
    const qty = parseFloat(qtyRaw);
    const cost = parseFloat(costRaw);
    if (!Number.isFinite(qty) || qty < 0) {return 'اكتب كمية صحيحة ≥ صفر';}
    if (!Number.isFinite(cost) || cost < 0) {return 'اكتب تكلفة صحيحة ≥ صفر';}
    if (!String(reasonRaw || '').trim()) {return 'اكتب سبب التعديل — يُوثَّق في الدفتر';}
    return '';
}

export function directEditPayload(qtyRaw, costRaw, reasonRaw) {
    return {
        qty: parseFloat(qtyRaw),
        avgCost: parseFloat(costRaw),
        reason: String(reasonRaw || '').trim(),
    };
}

export async function directEditInventoryItem(id, payload) {
    return apiFetch(`/warehouse/inventory/${encodeURIComponent(String(id))}/direct`, {
        method: 'PUT',
        body: JSON.stringify({
            qty: Number(payload?.qty),
            avgCost: Number(payload?.avgCost),
            reason: String(payload?.reason || '').trim(),
        }),
    });
}

/* ── الباب 5: دمج المكرر (أدمن فقط) ───────────────────────────────────────
   مفتاح الكشف منسوخ حرفيًا (warehouse.js:2199-2200): إزالة كل المسافات +
   توحيد الهمزات/التاء المربوطة/الألف المقصورة — التقاط متسامح عمدًا. */

export function mergeItemKey(name) {
    return String(name || '').toLowerCase().replace(/[\s\u00a0\t]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}

/**
 * مجموعات الأسماء المكررة — نفس منطق القديم (warehouse.js:2202-2210) مع
 * الافتراضي الذي كان يُقترح في الواجهة: الأكبر رصيدًا يبقى (keepIdx).
 * @param {any[]} rows صفوف السجل (تحمل name و qty و id)
 */
export function duplicateGroups(rows = []) {
    const groups = new Map();
    (Array.isArray(rows) ? rows : []).forEach((item) => {
        const key = mergeItemKey(item && item.name);
        if (!key) {return;}
        if (!groups.has(key)) {groups.set(key, []);}
        groups.get(key).push(item);
    });
    return [...groups.values()]
        .filter((items) => items.length > 1)
        .map((items) => ({
            key: mergeItemKey(items[0] && items[0].name),
            items,
            keepIdx: items.reduce((best, it, idx) => (Number(it && it.qty) > Number(items[best] && items[best].qty) ? idx : best), 0),
        }));
}

export async function mergeInventoryItems(keepId, dupIds) {
    return apiFetch('/warehouse/inventory/merge', {
        method: 'POST',
        body: JSON.stringify({
            keepId: Number(keepId),
            dupIds: (Array.isArray(dupIds) ? dupIds : []).map(Number),
        }),
    });
}

/* ── الباب 6: استوديو الجرد (جلسة/عدّ/اعتماد) ─────────────────────────────
   القراءات من stocktaking-routes.js (موصولة على /api/warehouse نفسه —
   server.js:553)، والكتابات من inventory-control-routes.js (:121,:199,:221).
   اللقطة تُبنى من رصيد المخزن المختار (location_id) لا من الإسقاط العالمي. */

export const AUDIT_PERIOD_TYPES = ['daily', 'weekly', 'monthly', 'custom', 'annual'];

/** مرآة normalizeScopeFilter في الخادم (stocktaking-routes.js:55-62) حرفيًا. */
export function scopeFilterOf(mode, category, search) {
    const m = ['all', 'category', 'search', 'in_stock'].includes(String(mode)) ? String(mode) : 'all';
    return {
        mode: m,
        category: String(category || '').slice(0, 120) || null,
        search: String(search || '').slice(0, 120) || null,
    };
}

/** تحقق نموذج البدء: التواريخ مطلوبة في النموذج، والقاعدة الحاكمة من الخادم (:173). */
export function auditPeriodError(periodStart, periodEnd) {
    const start = String(periodStart || '').trim();
    const end = String(periodEnd || '').trim();
    if (!start || !end) {return 'حدد بداية ونهاية فترة الجرد';}
    if (end < start) {return 'نهاية فترة الجرد لا يمكن أن تسبق بدايتها';}
    return '';
}

/** حمولة البدء — بنية القديم نفسها (warehouse.js:977-985) بحقول الحقول نفسها.
 *  datePart: حقل التاريخ يُقص لـ 10 أحرف أو null — لا String(null) اللامع. */
export function startAuditPayload(form = {}) {
    const datePart = (v) => (v ? String(v).trim().slice(0, 10) || null : null);
    const countedAt = datePart(form.countedAt);
    const periodType = AUDIT_PERIOD_TYPES.includes(String(form.periodType)) ? String(form.periodType) : 'custom';
    const periodStart = datePart(form.periodStart || countedAt);
    const periodEnd = datePart(form.periodEnd || periodStart);
    return {
        countedAt,
        periodType,
        periodStart,
        periodEnd,
        notes: String(form.notes || '').trim() || null,
        locationId: Number(form.locationId) || 0,
        scopeFilter: scopeFilterOf(form.scopeMode, form.scopeCategory, form.scopeSearch),
    };
}

/** مخازن الجرد (stocktaking-routes.js:229): مصفوفة مجردة مرتبة بالرئيسي أولًا.
 *  قيم on_hand_* تصل نصًا من numeric في PG — العرض يحوّلها بـ Number. */
export async function fetchAuditLocations() {
    const res = await apiFetch('/warehouse/inventory/locations');
    return Array.isArray(res) ? res : [];
}

/** معاينة النطاق (stocktaking-routes.js:254) → { items_count, on_hand_value, on_hand_qty }. */
export async function fetchAuditPreview(locationId, mode, category, search) {
    const scope = scopeFilterOf(mode, category, search);
    const params = new URLSearchParams({ mode: scope.mode });
    if (scope.category) {params.set('category', scope.category);}
    if (scope.search) {params.set('search', scope.search);}
    return apiFetch(`/warehouse/inventory/locations/${encodeURIComponent(String(locationId))}/preview?${params.toString()}`);
}

/** سجل الجلسات (inventory-control-routes.js:104) — مصفوفة، والخادم يحدّها بـ 100. */
export async function fetchAudits() {
    const res = await apiFetch('/warehouse/inventory/audits');
    return Array.isArray(res) ? res : [];
}

/** تفاصيل جلسة (stocktaking-routes.js:277): { audit, items, progress, summary, events, location_name }. */
export async function fetchAuditDetail(auditId) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}`);
}

export async function startAuditSession(payload) {
    return apiFetch('/warehouse/inventory/audits', {
        method: 'POST',
        body: JSON.stringify(payload || {}),
    });
}

/** حفظ عدّ صنف (stocktaking-routes.js:290) — بنية حمولة القديم نفسها (:1143). */
export async function saveAuditCount(auditId, itemId, countedQty, notes) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}/counts/${encodeURIComponent(String(itemId))}`, {
        method: 'PUT',
        body: JSON.stringify({ countedQty: Number(countedQty), notes: String(notes ?? '') }),
    });
}

/** مسح العد (stocktaking-routes.js:378) — إرجاع الصنف إلى «غير معدود». */
export async function clearAuditCount(auditId, itemId) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}/counts/${encodeURIComponent(String(itemId))}`, {
        method: 'DELETE',
    });
}

/** إرسال الجلسة (inventory-control-routes.js:199) — التوقيع إجباري والخادم يطابقه. */
export async function submitAuditSession(auditId, signatureData, signerName) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}/submit`, {
        method: 'POST',
        body: JSON.stringify({ signatureData, signerName }),
    });
}

/** اعتماد الجلسة (:221) — يطبق الفروقات على أرصدة المخزن المختار بحركات تصحيح موثقة. */
export async function approveAuditSession(auditId, signatureData, signerName) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}/approve`, {
        method: 'POST',
        body: JSON.stringify({ signatureData, signerName }),
    });
}

/** إلغاء الجلسة (:413) — مسودة أو مُرسلة فقط، بسبب موثق (3+ أحرف يفحصها الخادم). */
export async function cancelAuditSession(auditId, reason) {
    return apiFetch(`/warehouse/inventory/audits/${encodeURIComponent(String(auditId))}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: String(reason || '').trim() }),
    });
}

/* ── تحويلات نقية للاستوديو ───────────────────────────────────────────
   الحالات الأربع هي حالات الخادم نفسها (inventory-control-routes.js:91-93
   في التسميات، وstocktaking-routes.js في القفل: العد كتابة للمسودة فقط). */

export const AUDIT_STATUSES = ['draft', 'submitted', 'approved', 'cancelled'];

/** شارة الحالة — كلمات القديم حرفيًا (warehouse.js:831) على نغمات
 *  erp-badge المعلنة. تعيش هنا لا في status.js: ملف الحالات العام لا
 *  يعرف نطاق الجرد، واختراع مدخل فيه تخمين (نفس قاعدة شاشة 03). */
export function auditState(status) {
    const raw = String(status || '');
    const key = AUDIT_STATUSES.includes(raw) ? raw : 'draft';
    const map = {
        draft: { tone: 'warning', icon: 'pencil', label: 'مسودة قيد العد' },
        submitted: { tone: 'info', icon: 'clock', label: 'بانتظار الاعتماد' },
        approved: { tone: 'success', icon: 'circle-check', label: 'معتمد' },
        cancelled: { tone: 'danger', icon: 'circle-x', label: 'ملغاة' },
    };
    return { key, raw: raw || '—', tone: map[key].tone, icon: map[key].icon, label: map[key].label };
}

export function auditToRow(a = {}) {
    const raw = String(a.status || '');
    const status = ['draft', 'submitted', 'approved', 'cancelled'].includes(raw) ? raw : 'draft';
    return {
        id: a.id,
        number: a.audit_number ? String(a.audit_number) : '',
        status,
        scope: a.warehouse_scope ? String(a.warehouse_scope) : '',
        locationId: Number(a.location_id) || 0,
        countedAt: a.counted_at ? String(a.counted_at).slice(0, 10) : '',
        createdBy: a.created_by ? String(a.created_by) : '',
        totalItems: Number(a.total_items) || 0,
        itemCount: Number(a.item_count) || 0,
        countedItems: Number(a.counted_items) || 0,
        varianceValue: Number(a.total_variance_value) || 0,
    };
}

/** صف بند جرد — allowlist صريح؛ avg_cost يسقط كما يسقط avgCost في سجل الأصناف. */
export function auditItemToRow(raw = {}) {
    return {
        id: raw.id,
        itemId: raw.item_id,
        name: raw.item_name ? String(raw.item_name) : `#${raw.item_id ?? '؟'}`,
        unit: raw.unit ? String(raw.unit) : '',
        systemQty: Number(raw.system_qty) || 0,
        countedQty: Number(raw.counted_qty) || 0,
        varianceQty: Number(raw.variance_qty) || 0,
        varianceValue: Number(raw.variance_value) || 0,
        notes: raw.notes ? String(raw.notes) : '',
        isCounted: raw.counted_at != null || raw.is_counted === true,
        isStale: raw.is_stale === true,
    };
}

/**
 * ملخص الفروقات — نفس أرقام القديم (warehouse.js:848-857) ونفس قواعد الخادم
 * في loadDetail (stocktaking-routes.js:200-215): المحسوب على المعدود فقط.
 */
export function auditSummaryOf(items = []) {
    const list = Array.isArray(items) ? items : [];
    const counted = list.filter((i) => i && i.isCounted);
    const diff = counted.filter((i) => i.varianceQty !== 0);
    return {
        itemsWithVariance: diff.length,
        shortageItems: diff.filter((i) => i.varianceQty < 0).length,
        surplusItems: diff.filter((i) => i.varianceQty > 0).length,
        projectedVarianceValue: Math.round(diff.reduce((sum, i) => sum + (Number(i.varianceValue) || 0), 0) * 100) / 100,
        staleItems: list.filter((i) => i && i.isStale).length,
    };
}

/**
 * نص معاينة النطاق — كلمات القديم نفسها (warehouse.js:905) بلا وسوم.
 * العملة من إعدادات النظام (reports-repo.fetchCurrency)؛ غيابها ← رقم بلا
 * وحدة مع الإعلان الظاهر (نفس قاعدة شاشات V2 المالية).
 * @returns {string} '' عندما تعذرت المعاينة — الشاشة تقول نص الفشل المعروف.
 */
export function scopePreviewText(preview, currency) {
    if (!preview || typeof preview !== 'object') {return '';}
    const count = Number(preview.items_count);
    if (!Number.isFinite(count)) {return '';}
    const money = formatMoney(preview.on_hand_value, currency);
    const amount = money.hasUnit ? `${money.amount} ${money.unit}` : money.amount;
    return `سيُدرج ${formatQty(count)} صنف من مخزن الجرد المختار — رصيده المتوقع: ${formatQty(preview.on_hand_qty)} وحدة بقيمة ${amount}`;
}
