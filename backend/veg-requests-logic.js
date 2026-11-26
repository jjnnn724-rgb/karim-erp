/**
 * veg-requests-logic.js — منطق نقي لطلبات شراء الخضار (بلا DB ولا Express)
 * ────────────────────────────────────────────────────────────────────────────
 * كتالوج الخضار + قائمة الوحدات + تنقية/تحقق الأصناف — يُختبَر 100% معزولًا
 * (نفس فلسفة punch-portal-logic.js)، ومسار Express مجرد توصيل.
 */
'use strict';

/** الوحدات المسموحة (قائمة سماح — أي شيء آخر يُستبدل بـ «وحدة») */
const UNITS = ['كجم', 'جرام', 'طن', 'كرتونة', 'ربطة', 'حبة', 'صندوق', 'كيس', 'شيكارة', 'لتر', 'جالون'];

/** كتالوج الخضار الافتراضي — مصدر الحقيقة على السيرفر (الواجهة تعرضه كما هو) */
const VEG_CATALOG = [
  {
    key: 'leafy',
    label: 'ورقيات',
    items: [
      { name: 'ملوخية', unit: 'كجم' },
      { name: 'سبانخ', unit: 'كجم' },
      { name: 'بقدونس', unit: 'ربطة' },
      { name: 'كزبرة خضراء', unit: 'ربطة' },
      { name: 'خس', unit: 'حبة' },
      { name: 'كرنب (ملفوف)', unit: 'كجم' },
      { name: 'جرجير', unit: 'ربطة' },
      { name: 'سلق', unit: 'ربطة' },
    ],
  },
  {
    key: 'fruit',
    label: 'خضار ثمارية',
    items: [
      { name: 'طماطم', unit: 'كجم' },
      { name: 'بطاطس', unit: 'كجم' },
      { name: 'بصل', unit: 'كجم' },
      { name: 'ثوم', unit: 'كجم' },
      { name: 'جزر', unit: 'كجم' },
      { name: 'كوسة', unit: 'كجم' },
      { name: 'باذنجان', unit: 'كجم' },
      { name: 'فلفل أخضر', unit: 'كجم' },
      { name: 'فلفل ملون (أحمر/أصفر)', unit: 'كجم' },
      { name: 'خيار', unit: 'كجم' },
      { name: 'بامية', unit: 'كجم' },
      { name: 'قرنبيط', unit: 'كجم' },
      { name: 'طماطم كرزية', unit: 'كجم' },
    ],
  },
  {
    key: 'aromatic',
    label: 'أعشاب ولمسات',
    items: [
      { name: 'ليمون', unit: 'كجم' },
      { name: 'نعناع', unit: 'ربطة' },
      { name: 'شمر', unit: 'ربطة' },
      { name: 'بصل أخضر', unit: 'ربطة' },
      { name: 'حرج (فجل أحمر)', unit: 'ربطة' },
      { name: 'فلفل حار', unit: 'كجم' },
      { name: 'زنجبيل', unit: 'كجم' },
    ],
  },
  {
    key: 'legume',
    label: 'بقوليات وأصناف مميزة',
    items: [
      { name: 'فاصوليا خضراء', unit: 'كجم' },
      { name: 'بسلة', unit: 'كجم' },
      { name: 'بازلاء', unit: 'كجم' },
      { name: 'ذرة', unit: 'كجم' },
      { name: 'خرشوف', unit: 'حبة' },
      { name: 'كرفس', unit: 'ربطة' },
      { name: 'فطر (مشروم)', unit: 'كجم' },
      { name: 'فلفل رومي', unit: 'كجم' },
    ],
  },
];

/** تنظيف نص حر: بلا <> ومسافات مضغوطة وقصّ طول
 *  @param {unknown} v القيمة الخام (نص/رقم/null).
 *  @param {number} [max] أقصى طول مسموح.
 */
function cleanText(v, max = 120) {
  return String(v ?? '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * تحقق وتنقية أصناف الطلب القادمة من الواجهة.
 * @param {unknown} raw items كما وصلت في الطلب
 * @returns {{ok: boolean, items?: Array<{name: string, qty: number, unit: string, note: string|null}>, error?: string}}
 */
function validateItems(raw) {
  if (!Array.isArray(raw) || raw.length < 1) {
    return { ok: false, error: 'لا توجد أصناف في الطلب — اكتب كمية صنف واحد على الأقل' };
  }
  if (raw.length > 80) {
    return { ok: false, error: 'عدد الأصناف كبير جدًا (الحد 80 صنفًا)' };
  }
  const seen = new Set();
  const items = [];
  for (const r of raw) {
    const name = cleanText(r?.name, 80);
    const rawQty = r?.qty;
    const qty = rawQty === '' || rawQty == null ? 0 : Number(rawQty);
    if (!name) {
      return { ok: false, error: 'يوجد صنف بلا اسم — أكمل البيانات' };
    }
    // الصفر / الخانة الفاضية تعني «بلا كمية» وتُقبل في أي تعديل.
    if (!Number.isFinite(qty) || qty < 0 || qty > 99999) {
      return { ok: false, error: `كمية غير سليمة للصنف «${name}» — صفر يعني بلا كمية` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `الصنف «${name}» مكرر في الطلب` };
    }
    seen.add(key);
    let unit = cleanText(r?.unit, 20) || 'وحدة';
    if (!UNITS.includes(unit)) {
      unit = 'وحدة';
    }
    const note = cleanText(r?.note, 120) || null;
    items.push({ name, qty: Math.round(qty * 1000) / 1000, unit, note });
  }
  return { ok: true, items };
}

/**
 * Validate and apply the actual quantities entered at receipt time.
 * A missing value is not the same as zero: every accepted item must be
 * explicitly counted so the requested quantity can never masquerade as received.
 */
function applyReceivedQuantities(items, rawQuantities, rawRejections) {
  if (!Array.isArray(items) || items.length < 1) {
    return { ok: false, error: 'لا توجد أصناف لاستلامها' };
  }
  if (!Array.isArray(rawQuantities) || !Array.isArray(rawRejections)) {
    return { ok: false, error: 'أدخل الكمية المستلمة لكل صنف وحدد الأصناف المرفوضة' };
  }

  const itemsByName = new Map(items.map(item => [cleanText(item?.name, 80).toLowerCase(), item]));
  const rejected = new Set();
  for (const rawName of rawRejections) {
    const name = cleanText(rawName, 80).toLowerCase();
    if (!name || !itemsByName.has(name)) {
      return { ok: false, error: `اسم صنف مرفوض غير صالح: ${name || 'فارغ'}` };
    }
    rejected.add(name);
  }

  const quantitiesByName = new Map();
  for (const entry of rawQuantities) {
    const name = cleanText(entry?.name, 80).toLowerCase();
    if (!name || !itemsByName.has(name)) {
      return { ok: false, error: `اسم صنف الاستلام غير صالح: ${name || 'فارغ'}` };
    }
    if (quantitiesByName.has(name)) {
      return { ok: false, error: `كمية استلام مكررة للصنف «${itemsByName.get(name).name}»` };
    }
    if (rejected.has(name)) {
      quantitiesByName.set(name, null);
      continue;
    }
    const rawQty = entry?.receivedQty ?? entry?.qty;
    if (rawQty === '' || rawQty === undefined || rawQty === null) {
      return { ok: false, error: `أدخل الكمية المستلمة للصنف «${itemsByName.get(name).name}» — اكتب صفرًا إذا لم تستلم منه` };
    }
    const qty = typeof rawQty === 'string' ? Number(rawQty.trim().replace(',', '.')) : Number(rawQty);
    if (!Number.isFinite(qty) || qty < 0 || qty > 1000000) {
      return { ok: false, error: `كمية الاستلام غير صالحة للصنف «${itemsByName.get(name).name}»` };
    }
    quantitiesByName.set(name, Math.round(qty * 1000) / 1000);
  }

  const receivedItems = [];
  for (const item of items) {
    const name = cleanText(item?.name, 80).toLowerCase();
    if (rejected.has(name)) {
      receivedItems.push({ ...item, rejected: true });
      continue;
    }
    if (!quantitiesByName.has(name)) {
      return { ok: false, error: `أدخل الكمية المستلمة للصنف «${item.name}» — اكتب صفرًا إذا لم تستلم منه` };
    }
    const qty = quantitiesByName.get(name);
    const asked = Number(item.qty) || 0;
    receivedItems.push({
      ...item,
      qty,
      spoiledQty: qty < asked ? Math.round((asked - qty) * 1000) / 1000 : 0,
      overQty: qty > asked ? Math.round((qty - asked) * 1000) / 1000 : 0,
    });
  }
  return { ok: true, items: receivedItems };
}

/**
 * تنقية وتطبيق تسعير المخزن على أصناف طلب مستلَم.
 * الأصناف المرفوضة (rejected) لا تُسعَّر ولا تدخل في الإجمالي (طلب المالك 2026-10-04:
 * المرفوض لا يرجع للمخزن للتسعير). كل صنف مقبول لازم سعر وحدة ≥ 0 — الناقص يرفض بذكر اسمه.
 * @param {Array<{name: string, qty: number, unit: string, note: string|null, rejected?: boolean}>} items أصناف الطلب
 * @param {unknown} rawPrices [{name, unitPrice}] كما وصلت من الواجهة
 * @returns {{ok: boolean, items?: Array<any>, total?: number, error?: string}}
 */
function applyPrices(items, rawPrices) {
  const accepted = items.filter(it => !it.rejected);
  if (!accepted.length) {
    return { ok: false, error: 'كل الأصناف مرفوضة — لا يوجد ما يُسعَّر (الطلب يُغلق بلا مصروف)' };
  }
  if (!Array.isArray(rawPrices) || rawPrices.length < 1) {
    return { ok: false, error: 'لا توجد أسعار — سعّر كل صنف مقبول قبل التأكيد' };
  }
  const byKey = new Map();
  for (const p of rawPrices) {
    const name = cleanText(p?.name, 80).toLowerCase();
    // v3 يرسل `price`، v2 يرسل `unitPrice` — كلاهما مقبول الآن.
    const rawPrice = p?.unitPrice ?? p?.price;
    const unitPrice = typeof rawPrice === 'string' && rawPrice.trim() ? Number(rawPrice.replace(',', '.')) : Number(rawPrice);
    if (!name) {continue;}
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000) {
      return { ok: false, error: `سعر غير سليم للصنف «${name}» — اكتب رقمًا ≥ صفر` };
    }
    // تعديل الوزن اختياري، ويخضع لتحقق السيرفر (لا ثقة في إجمالي العميل).
    let qty = null;
    if (p?.qty !== undefined && p?.qty !== null) {
      const rawQty = p.qty === '' ? 0 : (typeof p.qty === 'string' && p.qty.trim() ? Number(p.qty.replace(',', '.')) : Number(p.qty));
      if (!Number.isFinite(rawQty) || rawQty < 0 || rawQty > 100000) {
        return { ok: false, error: `وزن غير سليم للصنف «${name}» — صفر يعني بلا كمية` };
      }
      qty = Math.round(rawQty * 1000) / 1000;
    }
    byKey.set(name, { price: Math.round(unitPrice * 100) / 100, qty });
  }
  const out = [];
  let total = 0;
  for (const it of items) {
    const key = cleanText(it.name, 80).toLowerCase();
    if (it.rejected) {
      out.push({ ...it, price: null, lineTotal: null });
      continue;
    }
    if (!byKey.has(key)) {
      return { ok: false, error: `الصنف «${it.name}» بلا سعر — سعّر كل الأصناف المقبولة` };
    }
    const { price, qty } = byKey.get(key);
    const effectiveQty = qty ?? (Number(it.qty) || 0);
    const asked = Number(it.qty) || 0;
    const spoiled = effectiveQty < asked ? Math.round((asked - effectiveQty) * 1000) / 1000 : 0;
    const lineTotal = Math.round(effectiveQty * price * 100) / 100;
    total += lineTotal;
    out.push({ ...it, qty: effectiveQty, price, lineTotal, spoiledQty: spoiled,
      ...(effectiveQty > asked ? { overQty: Math.round((effectiveQty - asked) * 1000) / 1000 } : {}) });
  }
  return { ok: true, items: out, total: Math.round(total * 100) / 100 };
}

module.exports = { cleanText, validateItems, applyReceivedQuantities, applyPrices, UNITS, VEG_CATALOG };
