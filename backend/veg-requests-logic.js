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
    const qty = Number(r?.qty);
    if (!name) {
      return { ok: false, error: 'يوجد صنف بلا اسم — أكمل البيانات' };
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 99999) {
      return { ok: false, error: `كمية غير سليمة للصنف «${name}» — اكتب رقمًا أكبر من صفر` };
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
    const unitPrice = Number(p?.unitPrice);
    if (!name) {
      continue;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000) {
      return { ok: false, error: `سعر غير سليم للصنف «${name}» — اكتب رقمًا ≥ صفر` };
    }
    byKey.set(name, Math.round(unitPrice * 100) / 100);
  }
  const out = [];
  let total = 0;
  for (const it of items) {
    if (it.rejected) {
      out.push({ ...it, price: null, lineTotal: null });
      continue;
    }
    const key = String(it.name).toLowerCase();
    if (!byKey.has(key)) {
      return { ok: false, error: `الصنف «${it.name}» بلا سعر — سعّر كل الأصناف المقبولة` };
    }
    const price = byKey.get(key);
    const lineTotal = Math.round(it.qty * price * 100) / 100;
    total += lineTotal;
    out.push({ ...it, price, lineTotal });
  }
  return { ok: true, items: out, total: Math.round(total * 100) / 100 };
}

module.exports = { cleanText, validateItems, applyPrices, UNITS, VEG_CATALOG };
