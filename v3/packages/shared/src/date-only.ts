/**
 * التواريخ — `DATE` يُخزَّن ويُنقل كنص `YYYY-MM-DD`، والمرجع توقيت الرياض (ADR-05).
 *
 * `dateOnlyToLegacyIso` تُنتج الشكل الذي يُصدره القديم فعلًا: pg يحوّل عمود
 * `DATE` إلى كائن `Date` عند منتصف ليل الرياض، فيسلسله JSON كـ
 * «YYYY-MM-DDT21:00:00.000Z» (الرياض ثابتة على +03:00 بلا توقيت صيفي).
 * تكافؤ G4 يحتاج هذا الشكل نفسه؛ لا يُستخدم لإجراء حساب.
 */

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const RIYADH_TIME_ZONE = 'Asia/Riyadh';
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function isDateOnly(value: unknown): value is string {
    if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
        return false;
    }
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    const probe = new Date(Date.UTC(year, month - 1, day));
    return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

const riyadhFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** تاريخ الرياض لِلحظةٍ ما — لا `toISOString().slice(0, 10)` (ينزلق يومًا). */
export function riyadhToday(now: Date = new Date()): string {
    return riyadhFormatter.format(now);
}

/** «2026-11-06» ← «2026-11-06T21:00:00.000Z» — شكل القديم حرفيًا. */
export function dateOnlyToLegacyIso(dateOnly: string): string {
    if (!isDateOnly(dateOnly)) {
        throw new RangeError(`تاريخ غير صالح «${dateOnly}» — المطلوب YYYY-MM-DD حقيقي`);
    }
    const utcMidnight = Date.parse(`${dateOnly}T00:00:00.000Z`);
    return new Date(utcMidnight - RIYADH_OFFSET_MS).toISOString();
}

/** تاريخ الرياض الذي تنتمي إليه لحظةٌ بتوقيت ISO. */
export function dateOnlyFromIso(iso: string): string {
    const instant = Date.parse(iso);
    if (Number.isNaN(instant)) {
        throw new RangeError(`توقيت غير صالح «${iso}»`);
    }
    return riyadhFormatter.format(new Date(instant));
}
