import { isDateOnly, riyadhToday } from './date-only.js';
import { addMoney, fromCents, type MoneyString, toCents } from './money.js';

/**
 * ضريبة القيمة المضافة — منطق `backend/accounting-routes.js` منقولًا بلا
 * إعادة كتابة (ADR-07): نفس معادلات `vatMovement` و`vatBalances` ودالة
 * `buildVatSettlementPlan` نفسها، ونفس الحسابات الافتراضية 2100/1150.
 *
 * لماذا بدائيات `@karim/shared/money` لا `round2` القديمة؟ القديم يقرأ
 * `NUMERIC` من PostgreSQL كـ`float` ثم يقرّب بـ`Math.round`: خطوتان تعتمدان
 * على تمثيل الفاصلة العائمة. هنا كل قيمة مالية جاءت من SQL مقرّبة إلى حانتين
 * (ROUND داخل الاستعلام، كما في القديم)، ثم تُجمع بالمليم كـ`BigInt` بلا Float
 * (ADR-04). لا تقريب ثانٍ يحدث، فلا يمكن أن ينحرف الرقم.
 *
 * ملاحظة إعادة التوازن: `roundHalfUp` في `money.ts` موثّقة الانحراف عن
 * `Math.round` عند نصف سالب، لكنها ليست على مسار هذه الوحدة — المدخلات
 * (نتائج SQL) بحانتين عشريتين بالفعل.
 */

/** الحسابان الافتراضيان — الثابتان القديمان حرفيًا (`tax.vat_return`). */
export const VAT_DEFAULT_ACCOUNTS = {
    payable_account: '2100',
    recoverable_account: '1150',
} as const;

export interface VatAccounts {
    payable_account: string;
    recoverable_account: string;
}

/** نصوص سطور التصفية — عقد قديم مرئي في القيود، لا يُصاغ من جديد. */
export const VAT_SETTLEMENT_MEMO_PAYABLE = 'تصفية ضريبة مخرجات مقابل مدخلات';
export const VAT_SETTLEMENT_MEMO_RECOVERABLE = 'تصفية ضريبة مدخلات';

export interface VatSettlementLine {
    account_code: string;
    debit: MoneyString;
    credit: MoneyString;
    memo: string;
}

export interface VatSettlementPlan {
    clearing: MoneyString;
    net_payable_after: MoneyString;
    carry_forward_after: MoneyString;
    lines: VatSettlementLine[];
}

/**
 * فصل صافي الإقرار إلى «مستحق» و«ترحيل» — فرعا `/vat-return` حرفيًا:
 * `net_payable = max(net, 0)` و`carry_forward_credit = max(-net, 0)`.
 */
export function splitVatNet(net: MoneyString): { net_payable: MoneyString; carry_forward_credit: MoneyString } {
    const cents = toCents(net);
    return {
        net_payable: fromCents(cents > 0n ? cents : 0n),
        carry_forward_credit: fromCents(cents < 0n ? -cents : 0n),
    };
}

/** صافي الحركة = مخرجات − مدخلات (نفس طرح `vatMovement` ثم `round2`). */
export function vatMovementNet(outputVat: MoneyString, inputVat: MoneyString): MoneyString {
    return addMoney(outputVat, fromCents(-toCents(inputVat)));
}

/**
 * خطة التصفية — دالة نقية، صورة `buildVatSettlementPlan` القديمة سطرًا بسطر:
 * الإطفاء = min(max(المستحق,0), max(القابل للاسترداد,0)).
 * لا سطر لصافي المستحق (يبقى على 2100) ولا لترحيل الرصيد (يبقى على 1150).
 */
export function buildVatSettlementPlan({
    payableBalance,
    recoverableBalance,
    accounts = {},
}: {
    payableBalance: MoneyString;
    recoverableBalance: MoneyString;
    accounts?: Partial<VatAccounts>;
}): VatSettlementPlan {
    const payableAcct = accounts.payable_account || VAT_DEFAULT_ACCOUNTS.payable_account;
    const recoverableAcct = accounts.recoverable_account || VAT_DEFAULT_ACCOUNTS.recoverable_account;
    const payable = toCents(payableBalance);
    const recoverable = toCents(recoverableBalance);
    const positivePayable = payable > 0n ? payable : 0n;
    const positiveRecoverable = recoverable > 0n ? recoverable : 0n;
    // `Math.min` لا يقبل BigInt؛ والحد الأدنى هنا هو تعريف الإطفاء نفسه.
    let clearing = positivePayable;
    if (positiveRecoverable < clearing) {
        clearing = positiveRecoverable;
    }

    const lines: VatSettlementLine[] =
        clearing > 0n
            ? [
                  {
                      account_code: payableAcct,
                      debit: fromCents(clearing),
                      credit: '0.00',
                      memo: VAT_SETTLEMENT_MEMO_PAYABLE,
                  },
                  {
                      account_code: recoverableAcct,
                      debit: '0.00',
                      credit: fromCents(clearing),
                      memo: VAT_SETTLEMENT_MEMO_RECOVERABLE,
                  },
              ]
            : [];

    return {
        clearing: fromCents(clearing),
        net_payable_after: fromCents(positivePayable - clearing),
        carry_forward_after: fromCents(positiveRecoverable - clearing),
        lines,
    };
}

/** `YYYY-MM` — شهر محاسبي كامل، لا تاريخ. */
export const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
    return typeof value === 'string' && MONTH_PATTERN.test(value);
}

/** أول وآخر يوم في الشهر — آخر يوم عبر UTC بلا Date محلي (لا توقيت صيفي في الرياض). */
export function monthPeriod(month: string): { from: string; to: string } {
    if (!isMonth(month)) {
        throw new RangeError(`شهر غير صالح «${String(month)}» — المطلوب YYYY-MM`);
    }
    const year = Number(month.slice(0, 4));
    const monthNumber = Number(month.slice(5, 7));
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

export type VatSettlementPeriodResult =
    | { ok: true; month: string; from: string; to: string }
    | { ok: false; status: 422 | 423; error: string; message: string };

/**
 * قواعد قبول شهر التصفية بالترتيب الذي ينفّذه القديم:
 *  1. الصيغة `YYYY-MM` → 422 `LEDGER_MONTH_INVALID`.
 *  2. الشهر لم ينتهِ بعد (`to > riyadhToday()`) → 422 `LEDGER_VAT_PERIOD_OPEN`.
 *  3. الفترة مقفولة → 423 `PERIOD_CLOSED` (نفس رسالة `accounting-periods`).
 *
 * `closed` يُمرَّر من الخارج: هذا عقدٌ نقي، وقراءة `accounting_periods` شأن
 * المستودع. تمرير `today` يجعل القاعدة قابلة للاختبار بلا ساعة نظام.
 */
export function validateVatSettlementPeriod({
    month,
    today = riyadhToday(),
    closed = false,
}: {
    month: unknown;
    today?: string;
    closed?: boolean;
}): VatSettlementPeriodResult {
    if (!isMonth(month)) {
        return { ok: false, status: 422, error: 'LEDGER_MONTH_INVALID', message: 'الشهر بصيغة YYYY-MM' };
    }
    if (!isDateOnly(today)) {
        throw new RangeError(`تاريخ غير صالح «${today}» — المطلوب YYYY-MM-DD حقيقي`);
    }
    const { from, to } = monthPeriod(month);
    if (to > today) {
        return { ok: false, status: 422, error: 'LEDGER_VAT_PERIOD_OPEN', message: 'لا تُصفّى فترة لم تنتهِ بعد' };
    }
    if (closed) {
        return {
            ok: false,
            status: 423,
            error: 'PERIOD_CLOSED',
            message: `الفترة ${month} مقفلة — افتحها أولًا من الإغلاق الشهري`,
        };
    }
    return { ok: true, month, from, to };
}

/** طلب `/vat-return` — نفس قواعد القديم: تاريخ حقيقي أو افتراضي الرياض. */
export function resolveVatReturnPeriod({
    from,
    to,
    today = riyadhToday(),
}: {
    from?: unknown;
    to?: unknown;
    today?: string;
}): { ok: true; from: string; to: string } | { ok: false; status: 422; error: string; message: string } {
    // القديم يقبل أي نص يطابق `\d{4}-\d{2}-\d{2}` بلا تحقق تقويمي؛ نرفض
    // التاريخ المستحيل (2026-02-31) لأنه لا يمكن أن يكون عمود DATE. هذا
    // التشديد لا يُقارن في shadow diff: المدخلات الصحيحة فقط هي العقد.
    const monthStart = `${today.slice(0, 7)}-01`;
    const resolvedFrom = isDateOnly(from) ? from : monthStart;
    const resolvedTo = isDateOnly(to) ? to : today;
    if (resolvedFrom > resolvedTo) {
        return { ok: false, status: 422, error: 'LEDGER_PERIOD_INVALID', message: 'بداية الفترة بعد نهايتها' };
    }
    return { ok: true, from: resolvedFrom, to: resolvedTo };
}
