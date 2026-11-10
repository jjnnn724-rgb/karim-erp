/**
 * نوافذ الزمن — أدوات تاريخ محلية مشتركة بين شاشات التقارير واللوحات.
 *
 * الأساس: **يوم الرياض المحلي** كما في V2 (`todayLocal` في مستودعات
 * `frontend/app/js/v2/data/*-repo.js`): `YYYY-MM-DD` من تقويم الجهاز، فلا
 * تُنقل التواريخ إلى منطقة زمنية أخرى ولا يظهر فرق يوم بين الخادم والمتصفح.
 *
 * المرساة عند الظهيرة في حساب `shiftDay` كي لا تُزيح إضافةُ يومٍ صيفًا/شتاءً
 * الطابعَ الزمني. النطاق من الأقدم إلى الأحدث شاملًا الطرفين.
 */

/** يوم الجهاز المحلي بصيغة `YYYY-MM-DD` — فارغٌ إن كان التاريخ غير صالح. */
export function todayLocal(date: Date = new Date()): string {
    const value = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(value.getTime())) {
        return '';
    }
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

/** يوم الجهاز المحلي بصيغة `YYYY-MM-DD` من تاريخٍ أو نصّي `YYYY-MM-DD`. */
export function toDay(value: string | Date): string {
    if (value instanceof Date) {
        return todayLocal(value);
    }
    const raw = String(value ?? '').slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

/** إزاحة يومٍ عددد — مرساةً الظهيرة كي لا يزاح التوقيت الصيفي. */
export function shiftDay(day: string, delta: number): string {
    const base = new Date(`${toDay(day)}T12:00:00`);
    if (Number.isNaN(base.getTime())) {
        return toDay(day);
    }
    base.setDate(base.getDate() + Number(delta || 0));
    return todayLocal(base);
}

/** نافذة `count` يومًا منتهيةً بـ`day` — الأقدم أولًا. */
export function lastNDays(day: string, count = 7): string[] {
    const days = Math.max(1, Math.floor(Number(count) || 7));
    return Array.from({ length: days }, (_unused, index) => shiftDay(day, index - (days - 1)));
}

/** أول يوم الشهر وارتفاعه — مفتاح الشهر `YYYY-MM`. */
export function monthBounds(day: string): { key: string; start: string; end: string } {
    const base = new Date(`${toDay(day)}T12:00:00`);
    if (Number.isNaN(base.getTime())) {
        const key = toDay(day).slice(0, 7);
        return { key, start: `${key}-01`, end: `${key}-01` };
    }
    const key = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
    const start = new Date(base.getFullYear(), base.getMonth(), 1, 12);
    const end = new Date(base.getFullYear(), base.getMonth() + 1, 0, 12);
    return { key, start: todayLocal(start), end: todayLocal(end) };
}

/** الشهر السابق لمفتاح شهر `YYYY-MM`. */
export function previousMonthKey(key: string): string {
    const raw = String(key ?? '').slice(0, 7);
    const parts = raw.split('-');
    const year = Number(parts[0] ?? NaN);
    const month = Number(parts[1] ?? NaN);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return raw;
    }
    const previous = new Date(year, month - 2, 1, 12);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, '0')}`;
}

/** أيام الشهر `YYYY-MM` — من الأول إلى الأخير. */
export function daysInMonth(key: string): string[] {
    const parts = String(key ?? '')
        .slice(0, 7)
        .split('-');
    const year = Number(parts[0] ?? NaN);
    const month = Number(parts[1] ?? NaN);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return [];
    }
    const last = new Date(year, month, 0, 12);
    const total = last.getDate();
    return Array.from({ length: total }, (_unused, index) => `${key}-${String(index + 1).padStart(2, '0')}`);
}
