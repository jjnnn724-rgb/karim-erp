import { formatCurrency, formatInt } from './format';

/**
 * أدوات مشتركة لتقارير القراءة: مدى زمني، أرقام، وعرض.
 *
 * القواعد الموروثة (ADR-04/ADR-05): لا تحويل عملة ولا إعادة حساب مالي في
 * الواجهة — `moneyOf` يعرض ما وصله بعد تحويله عددًا للعرض فقط، وهو مقبول
 * لأن هذه المسارات (`/finance/*`, `/yara-reports/*`, `/cashier-*`) ترجع
 * أرقام JS صريحة لا `NUMERIC` نصيًّا. الشاشات المحاسبية (القيود/شجرة
 * الحسابات) تبقى على `formatMoney` النصّي.
 *
 * التواريخ نصوص `YYYY-MM-DD` تُحسب على أجزائها (UTC) — لا `new Date(نص)`
 * على تاريخ مخزَّن، فلا تنزاح يومًا في منطقة زمنية أخرى.
 */

export const MAX_SPAN_DAYS = 93;

export type Preset = 'today' | 'week' | 'month' | 'quarter' | 'year';

export type DisplayTone = 'neutral' | 'success' | 'warning' | 'danger';

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

/** اليوم على تقويم الجهاز — نفس أساس شاشات V2. */
export function todayIso(now: Date = new Date()): string {
    if (Number.isNaN(now.getTime())) {
        return '';
    }
    return `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** يوم بعد (أو قبل) يومًا — حساب على أجزاء UTC، فلا انزياح. */
export function shiftIsoDays(iso: string, days: number): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) {
        return '';
    }
    const [, year = '', month = '', day = ''] = match;
    const stamp = Date.UTC(Number(year), Number(month) - 1, Number(day)) + days * 86400000;
    const date = new Date(stamp);
    return `${String(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function presetRange(preset: Preset, now: Date = new Date()): { from: string; to: string; label: string } {
    const today = todayIso(now);
    if (preset === 'today') {
        return { from: today, to: today, label: 'اليوم' };
    }
    if (preset === 'week') {
        return { from: shiftIsoDays(today, -6), to: today, label: 'آخر ٧ أيام' };
    }
    if (preset === 'month') {
        return { from: `${today.slice(0, 8)}01`, to: today, label: 'هذا الشهر' };
    }
    return { from: `${today.slice(0, 4)}-01-01`, to: today, label: 'هذا العام' };
}

/** فرق أيام شامل الطرفين — نفس حساب الخادم. */
export function spanDays(from: string, to: string): number {
    const a = Date.parse(`${from}T12:00:00Z`);
    const b = Date.parse(`${to}T12:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) {
        return 0;
    }
    return Math.round((b - a) / 86400000) + 1;
}

function isValidIsoDay(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12) {
        return false;
    }

    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
}

/**
 * بوابة المدى المحلية — تمنع طلبًا يعرفه الخادم مرفوضًا أصلًا.
 * تُعيد `''` حين يكون المدى صالحًا.
 */
export function rangeProblem(from: string, to: string, maxSpan: number = MAX_SPAN_DAYS): string {
    if (!isValidIsoDay(from) || !isValidIsoDay(to)) {
        return 'التاريخان مطلوبان بصيغة YYYY-MM-DD';
    }
    if (from > to) {
        return 'المدى معكوس — «من» بعد «إلى»';
    }
    const span = spanDays(from, to);
    if (span > maxSpan) {
        return `الحد الأقصى ${String(maxSpan)} يومًا — طُلب ${String(span)} يومًا`;
    }
    return '';
}

/** قيمة عددية من أي شكل يرد به الخادم؛ غير الرقم = 0 بلا NaN. */
export function num(value: unknown): number {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : 0;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

export function textOf(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value);
}

/** مبلغ للعرض بعملة النظام — بلا رمز مخترع هنا. */
export function moneyOf(value: unknown): string {
    return formatCurrency(num(value));
}

export function intOf(value: unknown): string {
    return formatInt(num(value));
}

/** كمية بثلاث خانات كحد أقصى، بلا أصفار زائدة. */
export function qtyOf(value: unknown): string {
    const parsed = num(value);
    return parsed.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** نسبة من رقم جاهز من الخادم، أو «—» حين لا أساس. */
export function pctOf(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '—';
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return '—';
    }
    return `${parsed.toFixed(1)}%`;
}

/** نسبة مشتقة من جزء وكل؛ بلا مقام = null (تُعرض «—» لا صفرًا كاذبًا). */
export function shareOf(part: number, total: number): number | null {
    if (!(total > 0)) {
        return null;
    }
    return (part / total) * 100;
}

export function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return 'خطأ غير معروف';
}

export const PRESETS: { key: Preset; label: string }[] = [
    { key: 'today', label: 'اليوم' },
    { key: 'week', label: '٧ أيام' },
    { key: 'month', label: 'هذا الشهر' },
    { key: 'year', label: 'هذا العام' },
];

/** وسم نغمة بحسب نسبة أو حالة — للاستخدام في المؤشرات. */
export function toneForRatio(ratio: number | null): DisplayTone {
    if (ratio === null) {
        return 'neutral';
    }
    if (ratio > 0) {
        return 'success';
    }
    if (ratio < 0) {
        return 'danger';
    }
    return 'neutral';
}
