import { addMoney, type V3JournalEntry } from '@karim/shared';

/**
 * تنسيق العرض — المال والتاريخ.
 *
 * المال: `NUMERIC(14,2)` نصٌّ (ADR-04) — يُعرض بأرقام لاتينية `en-US` وبجدولة
 * ثابتة (DESIGN.md: «المال والكميات وأرقام التعريف تُطبع لاتينية دائمًا»).
 * لا `Number()` ولا `parseFloat`: الحساب الصحيح في `@karim/shared`
 * (`addMoney` على المليم) والعرض فقط هنا.
 *
 * التاريخ: يُعرض كما يأتي (`YYYY-MM-DD`، ADR-05). توحيد عرض التواريخ قرار
 * منتج لم يُتخذ (DESIGN.md: «التواريخ قرار مفتوح») — فالعرض الحرفي لا
 * يفرض قرارًا ولا ينقل تاريخًا إلى منطقة زمنية ثانية.
 */

const MONEY_TEXT_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/**
 * مبلغ نصي → نص معروض. التجميع بالنصّ لا بـ`Intl`:
 * `Number()` يفقد المليم عند حدّ `NUMERIC(14,2)` (‏`99999999999999.99`
 * تُقرَّب إلى `…98`)، وADR-04 يمنع Float في أي خطوة — والعرض خطوة.
 */
export function formatMoney(value: string): string {
    const match = MONEY_TEXT_PATTERN.exec(value);
    if (!match) {
        return value;
    }
    const [, sign = '', integer = '0', fraction = ''] = match;
    const digits = integer.replace(/^0+(?=\d)/, '');
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${sign}${grouped}.${fraction.padEnd(2, '0')}`;
}

/** مجموع مدين — جمعٌ نصّي على المليم، بلا Float. */
export function totalDebit(entry: V3JournalEntry): string {
    return entry.lines.reduce((sum, line) => addMoney(sum, line.debit), '0.00');
}

/** مجموع دائن — جمعٌ نصّي على المليم، بلا Float. */
export function totalCredit(entry: V3JournalEntry): string {
    return entry.lines.reduce((sum, line) => addMoney(sum, line.credit), '0.00');
}

/** حالة القيد → تسمية عربية للعرض. */
export function statusLabel(status: string): string {
    switch (status) {
        case 'posted':
            return 'مرحّل';
        case 'draft':
            return 'مسوّدة';
        case 'void':
            return 'ملغى';
        default:
            return status;
    }
}

/** نوع الحساب → تسمية عربية للعرض. */
export function accountTypeLabel(type: string): string {
    switch (type) {
        case 'asset':
            return 'أصول';
        case 'liability':
            return 'التزامات';
        case 'equity':
            return 'حقوق ملكية';
        case 'revenue':
            return 'إيرادات';
        case 'cogs':
            return 'تكلفة مبيعات';
        case 'expense':
            return 'مصروفات';
        default:
            return type;
    }
}

/** تنسيق عدد صحيح بأرقام لاتينية وفواصل آلاف */
export function formatInt(value: number): string {
    return Number.isFinite(value) ? Math.floor(value).toLocaleString('en-US') : '0';
}

/** تنسيق قيمة مالية بالريال السعودي */
export function formatCurrency(value: number | string): string {
    const num = typeof value === 'number' ? value : Number.parseFloat(value);
    if (!Number.isFinite(num)) return '0.00 SAR';
    return `${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR`;
}
