/**
 * بدائيات المال — حسابٌ عشري بالمليم صارم، بلا Float في أي خطوة (ADR-04).
 *
 * `MoneyString` قيمةٌ نصية منتهية بحانتين عشريتين على الأكثر، مطابقة لـ
 * `NUMERIC(14,2)` في قاعدة البيانات: 14 خانة صحيحة + 2 عشرية.
 *
 * ملاحظة تكافؤ: `roundHalfUp` هنا تقريبٌ حسابي قياسي (HALF_UP بعيدًا عن الصفر).
 * الدالة القديمة `round2` في `backend/tax-rule-service.js` تستخدم `Math.round`
 * فتُقرِّب «-1.005» إلى «-1.00» بينما هذه تُرجع «-1.01». هذا فرقٌ مقصود ومُوثَّق:
 * منطق الترحيل القديم لا يُعاد كتابته (ADR-07)، وهذه البدائية للقراءات الجديدة
 * فقط حتى تُثبت اختبارات الذهب أن أي مسار كتابة يستخدمها مطابق.
 */

export type MoneyString = string;

/** 14 خانة صحيحة + حتى حانتين عشريتين، بإشارة اختيارية. */
export const MONEY_PATTERN = /^-?\d{1,14}(?:\.\d{1,2})?$/;

const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const SCALE = 2;
const SCALE_FACTOR = 100n;

export class MoneyFormatError extends Error {
    constructor(value: string, reason: string) {
        super(`قيمة مالية غير صالحة «${value}»: ${reason}`);
        this.name = 'MoneyFormatError';
    }
}

export function isMoneyString(value: unknown): value is MoneyString {
    return typeof value === 'string' && MONEY_PATTERN.test(value);
}

function splitDecimal(value: string): { negative: boolean; integer: string; fraction: string } {
    if (typeof value !== 'string') {
        throw new MoneyFormatError(String(value), 'ليست نصًا');
    }
    const match = DECIMAL_PATTERN.exec(value.trim());
    if (!match) {
        throw new MoneyFormatError(value, 'صيغة عشرية غير مفهومة');
    }
    return {
        negative: match[1] === '-',
        integer: match[2] ?? '0',
        fraction: match[3] ?? '',
    };
}

/** يحوّل قيمة عشرية (حانتان على الأكثر) إلى عدد صحيح بالمليم. دقيقٌ بلا Float. */
export function toCents(value: string): bigint {
    if (!isMoneyString(value)) {
        throw new MoneyFormatError(value, 'تتجاوز الصيغة المالية المسموحة');
    }
    const { negative, integer, fraction } = splitDecimal(value);
    const cents = BigInt(integer) * SCALE_FACTOR + BigInt(fraction.padEnd(SCALE, '0'));
    return negative ? -cents : cents;
}

/** يعيد «123.45» من عدد المليم؛ دائمًا بحانتين عشريتين. */
export function fromCents(cents: bigint): MoneyString {
    const negative = cents < 0n;
    const magnitude = negative ? -cents : cents;
    const integer = magnitude / SCALE_FACTOR;
    const fraction = magnitude % SCALE_FACTOR;
    const text = `${integer}.${fraction.toString().padStart(SCALE, '0')}`;
    return negative ? `-${text}` : text;
}

/** جمعٌ دقيق لأي عدد من القيم المالية. */
export function addMoney(...values: readonly string[]): MoneyString {
    let total = 0n;
    for (const value of values) {
        total += toCents(value);
    }
    return fromCents(total);
}

export function sumMoney(values: readonly string[]): MoneyString {
    return addMoney(...values);
}

/**
 * تقريب HALF_UP بعيدًا عن الصفر إلى `decimals` خانة، بحساب نصّي.
 * يقبل كسورًا أطول من المطلوب (مثل «1.005» مع 2) ويقرّر بالخانة التالية.
 */
export function roundHalfUp(value: string, decimals = SCALE): string {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
        throw new MoneyFormatError(String(decimals), 'عدد الخانات العشرية خارج النطاق 0..8');
    }
    const { negative, integer, fraction } = splitDecimal(value);
    const kept = fraction.slice(0, decimals).padEnd(decimals, '0');
    const next = fraction.charAt(decimals);
    let scaled = BigInt(integer + kept);
    if (next >= '5') {
        scaled += 1n;
    }
    const digits = scaled.toString().padStart(decimals + 1, '0');
    const cut = digits.length - decimals;
    const head = digits.slice(0, cut);
    const tail = digits.slice(cut);
    const text = decimals === 0 ? head : `${head}.${tail}`;
    const isZero = scaled === 0n;
    return negative && !isZero ? `-${text}` : text;
}
