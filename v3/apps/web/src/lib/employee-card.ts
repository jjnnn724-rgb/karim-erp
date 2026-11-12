import { z } from 'zod';
import { fetchJson } from './api';
import { weekdayAr } from './attendance';
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
    for (let d = new Date(`${String(from).slice(0, 10)}T12:00:00`); d <= end && out.length < max; d.setDate(d.getDate() + 1)) {
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
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

export interface EmployeeAttendancePrintOptions {
    employeeName: string;
    employeeCode: string;
    department: string;
    position: string;
    report: RangeModel;
    generatedAt?: Date;
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function minutesToClock(value: number): string {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** ورقة كشف البطاقة: تطبع المدى المحمّل فقط، ولا تعيد احتساب ملخص الخادم. */
export function employeeAttendancePrintHtml(options: EmployeeAttendancePrintOptions): string {
    const { employeeName, employeeCode, department, position, report } = options;
    const { summary, rows } = report;
    const generatedAt = options.generatedAt ?? new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp = `${pad(generatedAt.getDate())}/${pad(generatedAt.getMonth() + 1)}/${generatedAt.getFullYear()} ${pad(generatedAt.getHours())}:${pad(generatedAt.getMinutes())}`;
    const stat = (label: string, value: string | number): string =>
        `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
    const body = rows
        .map((row) => {
            const state = ATT_STATE[row.state] ?? ATT_STATE.review;
            const delay = [
                row.arrivalLateRaw > 0 ? `دخول ${minutesCell(row.arrivalLateRaw)}` : '',
                row.earlyLeaveRaw > 0 ? `انصراف ${minutesCell(row.earlyLeaveRaw)}` : '',
            ]
                .filter(Boolean)
                .join(' · ');
            const counted =
                row.lateMinutes > 0 && row.lateMinutes !== row.arrivalLateRaw + row.earlyLeaveRaw
                    ? `محسَب ${minutesCell(row.lateMinutes)}`
                    : '';
            const delayDetails = [delay, counted].filter(Boolean).map(escapeHtml).join(' · ');
            return `<tr>
                <td class="numeric">${escapeHtml(row.date)}</td>
                <td>${escapeHtml(weekdayAr(row.date))}</td>
                <td class="numeric">${escapeHtml(row.checkIn || '—')}</td>
                <td class="numeric">${escapeHtml(row.checkOut || '—')}</td>
                <td class="numeric">${escapeHtml(minutesToClock(row.minutes))}</td>
                <td>${delayDetails || '—'}</td>
                <td>${escapeHtml(state.label)}</td>
            </tr>`;
        })
        .join('');
    const totalHours = Number.isFinite(summary.totalKarim) ? summary.totalKarim.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—';
    const title = `كشف حضور وانصراف — ${employeeName}`;

    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;color:#172b3b;background:#fff;font:14px 'Tajawal','Segoe UI',Tahoma,Arial,sans-serif}
.sheet{max-width:1100px;margin:auto}.head{border-bottom:3px solid #0f766e;padding-bottom:14px;margin-bottom:16px}
h1{margin:0 0 8px;color:#102a43;font-size:22px}.identity,.period,.stats{display:flex;flex-wrap:wrap;gap:8px 18px}
.identity{color:#596e80}.identity strong{color:#172b3b}.period{justify-content:center;margin:14px 0;color:#102a43;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));margin:12px 0}
.stat{display:flex;flex-direction:column;gap:3px;border:1px solid #dce5ec;border-radius:8px;padding:8px 10px;background:#f3f6fa}
.stat strong{font-size:17px;color:#102a43}.stat span{font-size:12px;color:#596e80}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #dce5ec;padding:7px 8px;text-align:right}
th{background:#102a43;color:#f0f6fa;white-space:nowrap}tbody tr:nth-child(even){background:#f3f6fa}.numeric{direction:ltr;unicode-bidi:embed;text-align:center}
.foot{margin-top:12px;color:#596e80;font-size:11px}.actions{margin:0 auto 16px;max-width:1100px}
.actions button{border:0;border-radius:6px;padding:9px 18px;background:#0f766e;color:#fff;font:inherit;cursor:pointer}
@media print{body{padding:0}.actions{display:none!important}.sheet{max-width:none}thead{display:table-header-group}tr{break-inside:avoid}}
</style></head><body>
<div class="actions"><button type="button" data-print>طباعة الكشف</button></div>
<main class="sheet"><header class="head"><h1>${escapeHtml(title)}</h1>
<div class="identity"><span>رقم الموظف: <strong>${escapeHtml(employeeCode || '—')}</strong></span>
<span>القسم: <strong>${escapeHtml(department || '—')}</strong></span><span>الوظيفة: <strong>${escapeHtml(position || '—')}</strong></span></div></header>
<div class="period">الفترة: <span class="numeric">${escapeHtml(summary.from)}</span> — <span class="numeric">${escapeHtml(summary.to)}</span></div>
<section class="stats" aria-label="ملخص الحضور">
${stat('أيام الحضور', summary.daysPresent)}${stat('أيام مكتملة', summary.completeDays)}
${stat('عليها تأخير', summary.rawLateDays)}${stat('أيام التأخير المحتسب', summary.lateDays)}
${stat('التأخير الفعلي', summary.totalRawLateMinutes > 0 ? minutesCell(summary.totalRawLateMinutes) : '—')}
${stat('التأخير المحتسب', summary.totalLateMinutes > 0 ? minutesCell(summary.totalLateMinutes) : '—')}
${stat('إجمالي الساعات', totalHours)}
</section>
<table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>التأخير</th><th>الحالة</th></tr></thead>
<tbody>${body || '<tr><td colspan="7">لا أيام في هذه الفترة</td></tr>'}</tbody></table>
<p class="foot">تاريخ إنشاء التقرير: ${escapeHtml(stamp)}${report.truncated ? ' · الكشف محدود بـ 62 يومًا' : ''}</p>
</main></body></html>`;
}

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
    const truncated = days.length === MAX_RANGE_DAYS && rangeDays(from, to, MAX_RANGE_DAYS + 1).length > MAX_RANGE_DAYS;
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
