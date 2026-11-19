import { addMoney, fromCents, roundHalfUp, toCents } from '@karim/shared';
import { formatInt, formatMoney } from './format';
import { formatQty, type InventoryItem } from './inventory-register';

/**
 * أسعار الأصناف — متوسط تكلفة الشراء لكل صنف (`inventory."avgCost"`).
 *
 * السعر هنا **مش متخزَّن في صفحة**: كل فاتورة/استلام شراء في
 * `backend/warehouse/inventory-routes.js` و`returns-routes.js` يعيد
 * احتساب المتوسط المرجح (moving average) فورًا، ومسار التعديل/العكس
 * بيحدّثه كمان. يعني الجدول ده بينعرض القيمة الحالية كما هي في قاعدة
 * البيانات — أي استلام جديد يغيّر الرقم من غير أي تدخل.
 *
 * الحسابات المالية كلها بـBigInt cents (ADR-04) — لا `Number` في جمع
 * المبالغ. الكمية تتقرأ حتى 3 كسور (NUMERIC(14,3)) وتتدرج كـmilli-qty.
 */

const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const QTY_DECIMAL = /^-?\d+(?:\.\d{1,3})?$/;
const SCALED_QTY = /^(-?)(\d+)(?:\.(\d{1,3}))?$/;

/** القيمة كما وصلت من pg (NUMERIC ⇒ string أو number) → MoneyString بمنزلتين. */
export function canonicalMoney(raw: unknown): string {
    const text = String(raw ?? '').trim();
    if (!DECIMAL.test(text)) {
        return '0.00';
    }
    try {
        return roundHalfUp(text, 2);
    } catch {
        return '0.00';
    }
}

function num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

/** الكمية كنص → عدد صحيح متدرج ×1000 (3 كسور). */
function scaledQuantity(qtyText: string): bigint {
    const match = SCALED_QTY.exec(qtyText.trim());
    if (!match) {
        return 0n;
    }
    const frac = (match[3] ?? '').padEnd(3, '0');
    const base = BigInt(`${match[2] ?? '0'}${frac}`);
    return match[1] === '-' ? -base : base;
}

/** قيمة المخزون للصنف: `qty × avgCost` مقربة لنصف سنت (HALF_UP) بـBigInt. */
export function stockValueText(qtyRaw: unknown, costRaw: unknown): string {
    const qtyText = String(qtyRaw ?? '').trim();
    if (!QTY_DECIMAL.test(qtyText)) {
        return '0.00';
    }
    const costText = canonicalMoney(costRaw);
    const product = scaledQuantity(qtyText) * toCents(costText); // ×1000 (qty) × cents
    const negative = product < 0n;
    const magnitude = negative ? -product : product;
    const cents = (magnitude + 500n) / 1000n;
    return fromCents(negative ? -cents : cents);
}

export interface PriceRow {
    id: string;
    name: string;
    nameResolved: boolean;
    category: string;
    unit: string;
    barcode: string;
    qty: number;
    qtyText: string;
    /** متوسط التكلفة بصيغة MoneyString (منزلتان). */
    costText: string;
    /** `qty × avgCost` بصيغة MoneyString. */
    valueText: string;
    zeroCost: boolean;
}

/** صف الخادم → صف الشاشة — قائمة سماح صريحة فقط. */
export function itemToPriceRow(item: InventoryItem): PriceRow {
    const qty = num(item.qty);
    const costText = canonicalMoney(item.avgCost);
    const name = item.name ? String(item.name) : `#${String(item.id)}`;
    return {
        id: String(item.id),
        name,
        nameResolved: Boolean(item.name),
        category: item.category ? String(item.category) : '',
        unit: item.unit ? String(item.unit) : '',
        barcode: item.barcode ? String(item.barcode) : '',
        qty,
        qtyText: formatQty(qty),
        costText,
        valueText: stockValueText(item.qty, costText),
        zeroCost: toCents(costText) === 0n,
    };
}

export interface PriceTotals {
    items: number;
    /** أصناف متكلفتها صفر — لسه ما اتسجلش عليها شراء بالتكلفة. */
    zeroCost: number;
    /** إجمالي قيمة المخزون بسعر التكلفة (MoneyString). */
    valueText: string;
    maxCostText: string;
    maxCostName: string;
}

/** مجاميع الشاشة: القيمة تُضاف بـcents، والحد الأعلى بالتكلفة للوحدة. */
export function priceTotals(rows: readonly PriceRow[]): PriceTotals {
    let value = '0.00';
    let zeroCost = 0;
    let maxCost = 0n;
    let maxCostText = '0.00';
    let maxCostName = '—';
    for (const row of rows) {
        value = addMoney(value, row.valueText);
        if (row.zeroCost) {
            zeroCost += 1;
        }
        const cents = toCents(row.costText);
        if (cents > maxCost) {
            maxCost = cents;
            maxCostText = row.costText;
            maxCostName = row.name;
        }
    }
    return { items: rows.length, zeroCost, valueText: value, maxCostText, maxCostName };
}

export const PRICE_SORTS = ['name-asc', 'cost-desc', 'cost-asc', 'value-desc', 'qty-desc'] as const;
export type PriceSort = (typeof PRICE_SORTS)[number];

export const PRICE_SORT_LABELS: Record<PriceSort, string> = {
    'name-asc': 'أبجدي (الاسم)',
    'cost-desc': 'التكلفة — من الأعلى',
    'cost-asc': 'التكلفة — من الأقل',
    'value-desc': 'قيمة المخزون — من الأعلى',
    'qty-desc': 'الكمية — من الأعلى',
};

/** فرز محلي على صفحة النتيجة — الفرز المالي على النصوص كأرقام، لا بجمع float. */
export function sortPriceRows(rows: readonly PriceRow[], sort: PriceSort): PriceRow[] {
    const copy = [...rows];
    switch (sort) {
        case 'cost-desc':
            return copy.sort((a, b) => Number(b.costText) - Number(a.costText) || a.name.localeCompare(b.name, 'ar'));
        case 'cost-asc':
            return copy.sort((a, b) => Number(a.costText) - Number(b.costText) || a.name.localeCompare(b.name, 'ar'));
        case 'value-desc':
            return copy.sort((a, b) => Number(b.valueText) - Number(a.valueText) || a.name.localeCompare(b.name, 'ar'));
        case 'qty-desc':
            return copy.sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ar'));
        default:
            return copy.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }
}

export const PRICE_PAGE_SIZE = 50;

/** «1,234.50» — نفس `formatInt` للأعداد، `formatMoney` للمبالغ (منزلتان). */
export function formatPriceInt(value: number): string {
    return formatInt(value);
}

export function formatCost(costText: string): string {
    return formatMoney(costText);
}
