import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * كشف أيام الحضور والانصراف داخل ملف الموظف — مرآة V2 حرفيًا
 * (`frontend/app/js/v2/data/employee-card-repo.js` + `employees.js:1341-1420`):
 *   • `GET /api/hr/attendance/report?employee_id=&from=&to=` — تقرير الموظف
 *     الواحد بنطاقٍ صريح؛ الخادم وحده يقرّر النطاق المسموح (غير الأدمن يُنطَّق
 *     بموظف حسابه).
 *   • صفٌّ لكل يوم في المدى (الأيام الغائبة تظهر «لم يحضر» فلا يخفي الجدول
 *     نصف المعلومة) + راحة أسبوعية لا تُتهم غيابًا.
 *   • الحالة تأتي من حقول السجل نفسه (`lateMinutes`/`needsReview`/الأوقات) —
 *     لا يُعاد اشتقاقها في المتصفح.
 */

/** سقف أيام الكشف — رقم القديم نفسه (`smart-card.js:758`)، لا سقفًا مُخترعًا. */
export const MAX_RANGE_DAYS = 62;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDay(value: string): boolean {
    return DATE_RE.test(String(value || ''));
}

/** أيام الفترة شاملة الطرفين بترتيب تصاعدي (T12:00 حتى لا يُزيح تحويل المنطقة). */
export function rangeDays(from: string, to: string, max = MAX_RANGE_DAYS): string[] {
    if (!isIsoDay(String(from || '')) || !isIsoDay(String(to || ''))) {
        return [];
    }
    const out: string[] = [];
    const end = new Date(`${String(to).slice(0, 10)}T12:00:00`);
    for (
        let d = new Date(`${String(from).slice(0, 10)}T12:00:00`);
        d <= end && out.length < max;
        d.setDate(d.getDate() + 1)
    ) {
        out.push(
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        );
    }
    return out;
}

/* ─── عقد الباب ──────────────────────────────────────────────────────────── */

const optionalText = z.string().nullable().optional();
const numericText = z.union([z.string(), z.number()]).nullable().optional();

export const attendanceReportSchema = z
    .object({
        employee: z
            .object({
                id: z.union([z.string(), z.number()]).nullable().optional(),
                name: optionalText,
                employeeId: optionalText,
                position: optionalText,
                shift_start: optionalText,
                shift_karim: numericText,
                day_off: numericText,
            })
            .passthrough()
            .nullable()
            .optional(),
        records: z
            .array(
                z
                    .object({
                        date: optionalText,
                        checkIn: optionalText,
                        checkOut: optionalText,
                        workMinutes: numericText,
                        lateMinutes: numericText,
                        arrivalLateRawMinutes: numericText,
                        earlyLeaveRawMinutes: numericText,
                        needsReview: z.boolean().nullable().optional(),
                    })
                    .passthrough(),
            )
            .nullable()
            .optional(),
        summary: z
            .object({
                from: optionalText,
                to: optionalText,
                daysPresent: numericText,
                completeDays: numericText,
                lateDays: numericText,
                rawLateDays: numericText,
                reviewDays: numericText,
                reviewMinutes: numericText,
                totalMinutes: numericText,
                totalLateMinutes: numericText,
                totalRawLateMinutes: numericText,
                totalKarim: numericText,
            })
            .passthrough()
            .nullable()
            .optional(),
    })
    .passthrough();

export type AttendanceReport = z.infer<typeof attendanceReportSchema>;
export type ReportRecord = NonNullable<AttendanceReport['records']>[number];

/** نفس باب القديم `fetchAttendanceReport({ employeeId, from, to })` — معامل
 *  الخادم `employee_id` (snake) كما في `hr-routes.js:175`. */
export async function fetchAttendanceReport(
    employeeId: string | number,
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<AttendanceReport> {
    const params = new URLSearchParams({
        employee_id: String(employeeId),
        from,
        to,
    });
    return fetchJson(attendanceReportSchema, `/api/hr/attendance/report?${params.toString()}`, getAccessToken(), signal ? { signal } : {});
}

/* ─── حالات الصفّ (ATT_STATE) ────────────────────────────────────────────── */

export type DayState = 'absent' | 'day-off' | 'review' | 'no-in' | 'no-out' | 'late' | 'within-grace' | 'in-time';

export const ATT_STATE: Record<DayState, { label: string; tone: string }> = {
    absent: { label: 'لم يحضر', tone: 'danger' },
    'day-off': { label: 'راحة أسبوعية', tone: 'neutral' },
    review: { label: 'يحتاج مراجعة', tone: 'warning' },
    'no-in': { label: 'بلا حضور', tone: 'warning' },
    'no-out': { label: 'بلا انصراف', tone: 'warning' },
    late: { label: 'تأخير', tone: 'danger' },
    'within-grace': { label: 'ضمن السماح', tone: 'info' },
    'in-time': { label: 'في الموعد', tone: 'success' },
};

/* ─── الصفوف ─────────────────────────────────────────────────────────────── */

export type RangeRow = {
    date: string;
    state: DayState;
    weeklyOff: boolean;
    checkIn: string;
    checkOut: string;
    minutes: number;
    lateMinutes: number;
    arrivalLateRaw: number;
    earlyLeaveRaw: number;
    withinGrace: boolean;
};

export type RangeSummary = {
    from: string;
    to: string;
    daysPresent: number;
    completeDays: number;
    rawLateDays: number;
    lateDays: number;
    reviewDays: number;
    reviewMinutes: number;
    totalRawLateMinutes: number;
    totalLateMinutes: number;
    totalKarim: number;
};

export type RangeModel = {
    rows: RangeRow[];
    truncated: boolean;
    summary: RangeSummary;
};

function int(value: unknown): number {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? Math.round(n) : 0;
}

/** راحة أسبوعية؟ — ترميز `day_off` في القديم: 0=الأحد…6=السبت. */
export function isWeeklyOff(dayOff: number | null | undefined, isoDate: string): boolean {
    if (dayOff === null || dayOff === undefined || !isIsoDay(isoDate)) {
        return false;
    }
    const dow = new Date(`${isoDate}T12:00:00`).getDay();
    return dow === dayOff;
}

/** كشف الفترة: صفٌّ لكل يوم في المدى + ملخّص من حقول الخادم وحدها.
 *  مرآة `rangeReportRows` في القديم حرفيًا (بما فيها إصلاحات الوثائق الثلاث). */
export function rangeReportRows(report: AttendanceReport, dayOff: number | null | undefined): RangeModel {
    const summary = report.summary ?? {};
    const records = Array.isArray(report.records) ? report.records : [];
    const byDate = new Map<string, ReportRecord>();
    for (const rec of records) {
        const key = String(rec?.date ?? '').slice(0, 10);
        if (isIsoDay(key)) {
            byDate.set(key, rec);
        }
    }
    const from = String(summary.from ?? '').slice(0, 10);
    const to = String(summary.to ?? '').slice(0, 10);
    let days = rangeDays(from, to);
    const truncated =
        days.length === MAX_RANGE_DAYS && rangeDays(from, to, MAX_RANGE_DAYS + 1).length > MAX_RANGE_DAYS;
    if (!days.length) {
        days = [...byDate.keys()].sort();
    }

    const rows: RangeRow[] = days.map((date) => {
        const off = isWeeklyOff(dayOff, date);
        const rec = byDate.get(date);
        if (!rec) {
            return {
                date,
                state: (off ? 'day-off' : 'absent') as DayState,
                weeklyOff: off,
                minutes: 0,
                lateMinutes: 0,
                arrivalLateRaw: 0,
                earlyLeaveRaw: 0,
                withinGrace: false,
                checkIn: '',
                checkOut: '',
            };
        }
        const checkIn = String(rec.checkIn || '').trim();
        const checkOut = String(rec.checkOut || '').trim();
        const lateMinutes = Math.max(0, int(rec.lateMinutes));
        const arrivalLateRaw = Math.max(0, int(rec.arrivalLateRawMinutes));
        const earlyLeaveRaw = Math.max(0, int(rec.earlyLeaveRawMinutes));
        let state: DayState;
        if (!checkIn && off) {
            state = 'day-off';
        } else if (rec.needsReview) {
            state = 'review';
        } else if (!checkIn) {
            state = 'no-in';
        } else if (!checkOut) {
            state = 'no-out';
        } else if (lateMinutes > 0) {
            state = 'late';
        } else if (arrivalLateRaw > 0 || earlyLeaveRaw > 0) {
            state = 'within-grace';
        } else {
            state = 'in-time';
        }
        return {
            date,
            state,
            checkIn,
            checkOut,
            weeklyOff: off,
            minutes: Math.max(0, int(rec.workMinutes)),
            lateMinutes,
            arrivalLateRaw,
            earlyLeaveRaw,
            withinGrace: state === 'within-grace',
        };
    });

    return {
        rows,
        truncated,
        summary: {
            from,
            to,
            daysPresent: int(summary.daysPresent),
            completeDays: int(summary.completeDays),
            rawLateDays: int(summary.rawLateDays),
            lateDays: int(summary.lateDays),
            reviewDays: int(summary.reviewDays),
            reviewMinutes: int(summary.reviewMinutes),
            totalRawLateMinutes: int(summary.totalRawLateMinutes),
            totalLateMinutes: int(summary.totalLateMinutes),
            totalKarim: Number(summary.totalKarim ?? 0),
        },
    };
}

/** «12 د» — الدقائق وحدها هي المقياس، لا التقريب لساعات. */
export function minutesCell(value: number): string {
    return `${value.toLocaleString('en-US')} د`;
}
