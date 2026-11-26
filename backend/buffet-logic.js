'use strict';

/**
 * buffet-logic.js — حسابات كوست أصناف بوفيه الشرفة (صافية، بلا I/O).
 *
 * مبادئ:
 *  • التكلفة تُحسب **حيًّا من أسعار المخزن** (inventory.avgCost) وقت الطلب —
 *    لا تُخزَّن أي أرقام محسوبة في الداتابيس (مصدر واحد للحقيقة).
 *  • أي مكوّن بلا ربط بأصناف المخزن أو بوحدة غير قابلة للتحويل يظهر
 *    بـ«بدون تسعير» — **لا تخمين لأي رقم** بأي شكل.
 *  • «ملعقة كبيرة/صغيرة» تتحول عبر العائلة الحجمية (لتر/مل) فقط — الوزن
 *    يتطلب كثافة لكل صنف ولا تُفترض أرقام.
 *  • تعبئة الكيلو في اسم الصنف («ملح ناعم 50 كيلو-كيس») تُستخرج آليًا
 *    (parsePackKg) وتحوّل سعر الكيس لسعر الكيلو — مثال محسوبة «تقديري»
 *    وموسومة linewise بـ packUsed.
 *  • parsing لعائد السفنديش («تكفي 35–40 شخص») لاستخراج حدّين للحصة
 *    الشخصية — النتيجة موسومة «تقديري» في الواجهة والطباعة.
 */

/* ─── تطبيع أسماء العناصر للربط ─────────────────────────────────── */

const HARAKAT = /[ً-ٰٟـ]/g;          // التشكيل والتطويل
const ALEF = /[إأآا]/g;
const YA = /ى/g;

function normalizeName(s) {
    return String(s ?? '')
        .toLowerCase()
        .replace(HARAKAT, '')
        .replace(ALEF, 'ا')
        .replace(/ة/g, 'ه')
        .replace(YA, 'ي')
        .replace(/[^ء-يa-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const PREP_WORDS = [
    'شرائح', 'مكعبات', 'صغيره', 'كبيره', 'مفروم', 'طازج', 'طازجه', 'مجفف',
    'عند الحاجه', 'حسب الرغبه', 'للتزيين', 'للتقديم', 'للطهي', 'ناعم', 'خشن',
    'وسط', 'منقوع', 'مصفي', 'مطبوخ', 'مسلوق', 'مشوي', 'مقطع', 'مبشور', 'اه',
    'صغيرة', 'كبيرة', 'مفرومة', 'مغسول', 'محمص', 'زهرات', 'زهيرات',
    'رفيعة', 'رفيعه', 'رفيع', 'عريضة', 'عريضه', 'عريض', 'مقطعه',
];

function stripPrep(s) {
    let out = ` ${normalizeName(s)} `;
    for (const w of PREP_WORDS) {
        out = out.split(` ${w} `).join(' ');
        out = out.split(` ${w}`).join(' ');
    }
    return out.replace(/\s+/g, ' ').trim();
}

/** أعلام المصنّع/النصف مصنّع — لا نطابقها على مكوّن خام */
const FACTORY_MARKERS = ['بودر', 'مجفف', 'مطحون', 'مسحوق', 'بودره'];

/** يستخرج عدد كيلوجرامات التعبئة من اسم الصنف: «ملح ناعم 50 كيلو-كيس» → 50 */
function parsePackKg(inventoryName) {
    const m = String(inventoryName ?? '').match(/(\d+(?:[\.,]\d+)?)\s*كيلو/);
    if (!m) {return null;}
    const n = Number(m[1].replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : null;
}

/* ─── عائد الوعاء («تكفي 35–40 شخص») ────────────────────────────── */

function parseYieldGuests(yields) {
    const text = String(yields ?? '');
    if (!text) {return null;}
    const range = text.match(/(\d+)\s*[-–—]\s*(\d+)\s*(?:شخص|نفر)/);
    if (range) {
        const low = Number(range[1]);
        const high = Number(range[2]);
        if (Number.isFinite(low) && Number.isFinite(high) && low >= 1 && high >= low) {
            return { low, high };
        }
    }
    const single = text.match(/(\d+)\s*(?:شخص|نفر)/);
    if (single) {
        const n = Number(single[1]);
        if (Number.isFinite(n) && n >= 1) {return { low: n, high: n };}
    }
    return null;
}

/* ─── تحويل الوحدات داخل العائلات فقط ────────────────────────────── */

const FAMILY_KG = new Set(['kg', 'كيلو', 'كيلو جرام', 'كيلوجرام', 'كيلوغرام', 'كيلو غرام']);
const FAMILY_G = new Set(['g', 'جرام', 'جم', 'غرام']);
const FAMILY_MG = 'mg';
const FAMILY_L = new Set(['l', 'لتر', 'litre', 'liter']);
const FAMILY_ML = new Set(['ml', 'مل', 'ملي', 'مليلتر', 'ميليلتر']);
const FAMILY_H2O = new Set(['كوب', 'cup']);
const FAMILY_TBSP = new Set(['ملعقة كبيرة', 'ملعقه كبيره', 'tbsp', 'ملعقه كبيره tbsp']);
const FAMILY_TSP = new Set(['ملعقة صغيرة', 'ملعقه صغيره', 'tsp', 'ملعقه صغيره tsp']);
const FAMILY_COUNT = new Set(['عدد / حبة', 'عدد حبه', 'عدد', 'حبة', 'حبه', 'piece', 'pc', 'قطعه', 'قطعة', 'واحد', 'واحده']);

const normUnit = (u) => normalizeName(u).replace(/\s+/g, ' ').trim();
const isKgFamily = (u) => {
    const n = normUnit(u);
    return FAMILY_KG.has(n) || FAMILY_G.has(n) || n === 'mg';
};
const toKg = (qty, u) => {
    const n = normUnit(u);
    if (FAMILY_KG.has(n)) {return qty;}
    if (FAMILY_G.has(n)) {return qty / 1000;}
    if (n === 'mg') {return qty / 1e6;}
    return null;
};

/**
 * يحوّل كمية من وحدة لأخرى **داخل نفس العائلة فقط**.
 * @returns {number|null} الكمية بوحدة المخزن، أو null إن كان التحويل غير معروف.
 */
function convertQuantity(qty, fromUnit, toUnit) {
    const q = Number(qty);
    if (!Number.isFinite(q)) {return null;}
    const from = normUnit(fromUnit);
    const to = normUnit(toUnit);
    if (!from || !to) {return null;}
    if (from === to) {return q;}
    const isKg = (u) => FAMILY_KG.has(u);
    const isG = (u) => FAMILY_G.has(u);
    if (from === FAMILY_MG && to === FAMILY_MG) {return q;}
    if (from === FAMILY_MG && (isG(to))) {return q / 1000;}
    if (from === FAMILY_MG && (isKg(to))) {return q / 1e6;}
    if (isG(from) && to === FAMILY_MG) {return q * 1000;}
    if (isKg(from) && to === FAMILY_MG) {return q * 1e6;}
    if (FAMILY_KG.has(from) && FAMILY_KG.has(to)) {return q;}
    if (FAMILY_KG.has(from) && FAMILY_G.has(to)) {return q * 1000;}
    if (FAMILY_G.has(from) && FAMILY_KG.has(to)) {return q / 1000;}
    if (FAMILY_G.has(from) && FAMILY_G.has(to)) {return q;}
    if (FAMILY_L.has(from) && FAMILY_L.has(to)) {return q;}
    if (FAMILY_ML.has(from) && FAMILY_L.has(to)) {return q / 1000;}
    if (FAMILY_L.has(from) && FAMILY_ML.has(to)) {return q * 1000;}
    if (FAMILY_ML.has(from) && FAMILY_ML.has(to)) {return q;}
    if (FAMILY_H2O.has(from) && FAMILY_ML.has(to)) {return q * 240;}
    if (FAMILY_H2O.has(from) && FAMILY_L.has(to)) {return q * 0.24;}
    if (FAMILY_TBSP.has(from) && FAMILY_ML.has(to)) {return q * 15;}
    if (FAMILY_TBSP.has(from) && FAMILY_L.has(to)) {return q * 0.015;}
    if (FAMILY_TSP.has(from) && FAMILY_ML.has(to)) {return q * 5;}
    if (FAMILY_TSP.has(from) && FAMILY_L.has(to)) {return q * 0.005;}
    if (FAMILY_COUNT.has(from) && FAMILY_COUNT.has(to)) {return q;}
    // عند غياب تحويل معروف — لا نفترض (مثال: كرتون → كيس)
    return null;
}

/* ─── حساب كوست الصنف ────────────────────────────────────────────── */

/**
 * @param {{ingredients: Array<{id:any, name:string, qty:number, unit:string, inventoryId?:any, packKg?:number|string|null}>, yields?: string}} dish
 * @param {Map<string, {id:any, name:string, unit:string, avgCost:number|null}>} inventoryById — مفاتيح = String(id)
 */
function computeDishCost(dish, inventoryById) {
    const round = (n) => Math.round(Number(n || 0) * 100) / 100;
    const lines = [];
    let batchCost = 0;
    let pricedLines = 0;
    for (const ing of dish.ingredients || []) {
        const base = {
            id: ing.id ?? null,
            name: String(ing.name ?? ''),
            qty: Number(ing.qty) || 0,
            unit: String(ing.unit ?? ''),
            position: ing.position ?? 0,
        };
        const invId = ing.inventoryId ?? ing.inventory_id ?? null;
        const inv = invId != null ? inventoryById.get(String(invId)) : null;
        if (!inv) {
            lines.push({ ...base, state: 'unlinked', cost: null, inventoryId: null });
            continue;
        }
        const price = Number(inv.avgCost);
        if (!Number.isFinite(price) || price <= 0) {
            lines.push({ ...base, state: 'no_price', cost: null, inventoryId: inv.id, inventory: { id: inv.id, name: inv.name, unit: inv.unit } });
            continue;
        }
        let converted = convertQuantity(base.qty, base.unit, inv.unit);
        let unitPrice = price;
        let packUsed = false;
        const packKg = Number(ing.packKg ?? ing.pack_kg);
        if (converted == null && Number.isFinite(packKg) && packKg > 0 && isKgFamily(base.unit) && !isKgFamily(inv.unit)) {
            // تعبئة كيلو معلوم وزنها — سعر وحدة التعبئة ÷ كجم = السعر للكيلو «تقديري»
            converted = toKg(base.qty, base.unit);
            if (converted != null) {
                unitPrice = price / packKg;
                packUsed = true;
            }
        }
        if (converted == null) {
            lines.push({ ...base, state: 'unconvertible', cost: null, inventoryId: inv.id, inventory: { id: inv.id, name: inv.name, unit: inv.unit } });
            continue;
        }
        const cost = round(converted * unitPrice);
        batchCost += cost;
        pricedLines += 1;
        lines.push({
            ...base,
            state: 'ok',
            cost,
            packUsed,
            avgCost: round(unitPrice),
            packKg: packUsed ? Number(ing.packKg ?? ing.pack_kg) || null : null,
            inventoryId: inv.id,
            inventory: { id: inv.id, name: inv.name, unit: inv.unit, avgCost: round(unitPrice) },
        });
    }
    const totalLines = (dish.ingredients || []).length;
    const guests = parseYieldGuests(dish.yields);
    const perPerson = guests
        ? {
            low: round(batchCost / guests.high),
            high: round(batchCost / guests.low),
            guestsLow: guests.low,
            guestsHigh: guests.high,
        }
        : null;
    return {
        batchCost: round(batchCost),
        pricedLines,
        unpricedLines: totalLines - pricedLines,
        totalLines,
        perPerson,
        lines,
    };
}

/** ملخص أوسع — يغذّي مؤشرات الشاشة والتقرير الرسمي */
function summarizeDishes(dishesWithCosts) {
    const total = dishesWithCosts.length;
    let pricedFull = 0;
    let pricedPartial = 0;
    let unpriced = 0;
    let unpricedLineCount = 0;
    let batchCostSum = 0;
    for (const dish of dishesWithCosts) {
        if (dish.unpricedLines === 0 && dish.totalLines > 0) {pricedFull += 1;}
        else if (dish.pricedLines > 0) {pricedPartial += 1;}
        else {unpriced += 1;}
        unpricedLineCount += dish.unpricedLines;
        batchCostSum += dish.batchCost;
    }
    return { total, pricedFull, pricedPartial, unpriced, unpricedLineCount, batchCostSum: Math.round(batchCostSum * 100) / 100 };
}

module.exports = {
    normalizeName,
    stripPrep,
    parsePackKg,
    FACTORY_MARKERS,
    parseYieldGuests,
    convertQuantity,
    computeDishCost,
    summarizeDishes,
};
