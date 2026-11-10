/**
 * حساب سلة الكاشير — نسخة مطابقة لـ`v2/data/pos-pricing.js` بالقرش لا بالعوم.
 *
 * الخادم هو الحاكم في الضريبة والخصم والإجمالي عند `/api/sales/complete`؛
 * هذه الحسابات **تقدير معروض على الشاشة** قبل الإتمام، ولذلك يجب أن تطابق
 * حساب V2 حرفيًّا حتى لا يرى الكاشير رقمًا ثم يُسجّل الخادم رقمًا آخر.
 *
 * الفروق الآمنة عن V2:
 *  • الضرب والقسمة على أعداد صحيحة (قرش/ملّي‑كمية) مع تقريب نصف‑لأعلى،
 *    فلا يظهر 0.30000000000000004 ولا يخسر المليم عند حدّ NUMERIC(14,2).
 *  • الكمية مقيسة بألفٍ (1000) لأن الكاشير قد يبيع أوزانًا عشرية.
 */

export type PosDiscountType = '' | 'percent' | 'fixed';

export interface PosDiscount {
    type: PosDiscountType;
    value: string;
}

export interface PosCartLine {
    id: string;
    name: string;
    /** سعر الوحدة كما أرسله الخادم (قد يكون نصًّا) — يُقرأ عددًا هنا للعرض فقط. */
    price: number;
    vatRate: number;
    quantity: number;
}

export interface PosTotalsLine extends PosCartLine {
    discount: number;
    subtotal: number;
    tax: number;
}

export interface PosTotals {
    valid: boolean;
    subtotalBeforeDiscount: number;
    discount: number;
    subtotal: number;
    tax: number;
    total: number;
    items: PosTotalsLine[];
}

export interface PosSaleItem {
    product_id: number;
    quantity: number;
    unit_price: number;
    discount: number;
}

const QUANTITY_SCALE = 1000;
const PERCENT_SCALE = 100 * 1000;

/** قسمة صحيحة بتقريب نصف‑لأعلى — بديل `Number(x.toFixed(2))` لموجب. */
function divHalfUp(numerator: number, denominator: number): number {
    if (denominator === 0) {
        return 0;
    }
    const sign = numerator < 0 ? -1 : 1;
    const magnitude = Math.abs(numerator);
    return sign * Math.floor((magnitude * 2 + denominator) / (denominator * 2));
}

function toCentsNumber(value: number): number {
    return Math.round(value * 100);
}

function toMilli(value: number): number {
    return Math.round(value * QUANTITY_SCALE);
}

/** مدخل مبلغ عربي/فارسي → عدد، أو NaN. نفس `parseMoneyInput` في V2 حرفيًّا. */
export function parsePosMoney(value: string | number | null | undefined): number {
    const normalized = String(value ?? '')
        .trim()
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٫]/g, '.')
        .replace(/[٬,\s]/g, '');
    if (!normalized) {
        return Number.NaN;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN;
}

/** مدخل خصم: النسبة أو المبلغ؛ الفارغ = NaN (وهو غير صالح عند وجود نوع خصم). */
function parseDiscountValue(value: string): number {
    const normalized = String(value ?? '')
        .trim()
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/[٫]/g, '.')
        .replace(/[٬,\s]/g, '');
    return normalized ? Number(normalized) : Number.NaN;
}

/**
 * ناتج السلة: قبل الخصم، الخصم، بعد الخصم، الضريبة، الإجمالي التقديري.
 * توزيع خصم الطلب على البنود تناسبيًّا، والباقي يُحمَّل على آخر بند مؤهّل،
 * والخصم لكل بند لا يتجاوز قيمته — نفس قواعد `calculatePosTotals` في V2.
 */
export function calculatePosTotals(cart: readonly PosCartLine[], discount: PosDiscount = { type: '', value: '0' }): PosTotals {
    const base = cart.map((row) => ({
        ...row,
        lineCents: divHalfUp(toMilli(row.quantity) * toCentsNumber(Number(row.price)), QUANTITY_SCALE),
        vatMilli: toMilli(Number(row.vatRate)),
    }));
    const subtotalBeforeCents = base.reduce((sum, row) => sum + row.lineCents, 0);

    const value = discount.type ? parseDiscountValue(discount.value) : 0;
    const valid =
        !discount.type ||
        (Number.isFinite(value) &&
            value >= 0 &&
            (discount.type !== 'percent' || value <= 100) &&
            (discount.type === 'percent' || discount.type === 'fixed'));

    const requestedCents = !valid
        ? 0
        : discount.type === 'percent'
          ? divHalfUp(subtotalBeforeCents * toMilli(value), PERCENT_SCALE)
          : discount.type === 'fixed'
            ? toCentsNumber(value)
            : 0;
    const discountCents = Math.min(subtotalBeforeCents, Math.max(0, requestedCents));

    const eligible = base.filter((row) => row.lineCents > 0);
    const lastEligible = eligible[eligible.length - 1];
    let remaining = discountCents;
    let subtotalCents = 0;
    let taxCents = 0;

    const items: PosTotalsLine[] = base.map((row) => {
        let lineDiscount = 0;
        if (row.lineCents > 0 && discountCents > 0 && subtotalBeforeCents > 0) {
            const share =
                row === lastEligible
                    ? remaining
                    : divHalfUp(row.lineCents * discountCents, subtotalBeforeCents);
            lineDiscount = Math.min(row.lineCents, remaining, share);
            remaining -= lineDiscount;
        }
        const net = row.lineCents - lineDiscount;
        const tax = divHalfUp(net * row.vatMilli, PERCENT_SCALE);
        subtotalCents += net;
        taxCents += tax;
        return {
            id: row.id,
            name: row.name,
            price: row.price,
            vatRate: row.vatRate,
            quantity: row.quantity,
            discount: lineDiscount / 100,
            subtotal: net / 100,
            tax: tax / 100,
        };
    });

    return {
        valid,
        subtotalBeforeDiscount: subtotalBeforeCents / 100,
        discount: discountCents / 100,
        subtotal: subtotalCents / 100,
        tax: taxCents / 100,
        total: (subtotalCents + taxCents) / 100,
        items,
    };
}

/** بنود الخادم لفاتورة البيع — بلا إعادة تسعير: نفس ناتج العرض. */
export function buildPosSaleItems(cart: readonly PosCartLine[], discount: PosDiscount): PosSaleItem[] {
    const totals = calculatePosTotals(cart, discount);
    if (!totals.valid) {
        throw new Error('قيمة الخصم غير صالحة');
    }
    return totals.items.map((row) => ({
        product_id: Number(row.id),
        quantity: row.quantity,
        unit_price: row.price,
        discount: row.discount,
    }));
}

/** تطبيع باركود القراءة: NFKC، أرقام لاتينية، وحذف الفراغات. */
export function normalizeBarcode(value: string | null | undefined): string {
    return String(value ?? '')
        .normalize('NFKC')
        .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
        .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
        .replace(/\s/g, '');
}

export type BarcodeMatch<T> =
    | { status: 'empty'; product: null }
    | { status: 'matched'; product: T }
    | { status: 'ambiguous'; product: null }
    | { status: 'not-found'; product: null };

/** مطابقة حرفية كاملة (لا جزئية) — الباركود مرتبط بأكثر من صنفٍ = رفض. */
export function matchPosBarcode<T extends { barcode?: string | null }>(products: readonly T[], value: string): BarcodeMatch<T> {
    const barcode = normalizeBarcode(value);
    if (!barcode) {
        return { status: 'empty', product: null };
    }
    const matches = products.filter((product) => normalizeBarcode(product.barcode) === barcode);
    if (matches.length === 1 && matches[0]) {
        return { status: 'matched', product: matches[0] };
    }
    return { status: matches.length ? 'ambiguous' : 'not-found', product: null };
}
