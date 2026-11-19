import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import type { AttendanceReport, ReportRecord } from './employee-card';

/**
 * قراءة بوابة الموظف كما في V2 (`employee-portal.js:614-666`): الربط، المؤشرات،
 * كشف الحضور منذ بداية العام، وتاريخ الإجازات — وكلها عرضٌ فقط. الأرقام
 * (ساعات/أيام) تصل من ملخّص الخادم ولا تُعاد حوسبتها هنا.
 */

/** مبدّل الموظف للإدارة — نفس `ADMIN_ROLES` في القديم (`employee-portal.js:44`). */
export const PORTAL_SWITCH_ROLES = ['admin', 'hr', 'manager'] as const;

export function canSwitchPortalEmployee(role: unknown): boolean {
    return PORTAL_SWITCH_ROLES.includes(String(role ?? '') as (typeof PORTAL_SWITCH_ROLES)[number]);
}

/** مدى شهر كامل `YYYY-MM`، أو `null` إن كان المُدخل غير صالح (لا شهر مخترع). */
export function portalMonthRange(month: unknown): { from: string; to: string } | null {
    const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ''));
    if (!match) {
        return null;
    }
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) {
        return null;
    }
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    return {
        from: `${match[1]}-${match[2]}-01`,
        to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
    };
}

export type PortalBadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';
export type PortalBadge = { label: string; tone: PortalBadgeTone };

/** ساعات اليوم من `workMinutes` التي حسبها الخادم — `null` إن غاب الرقم. */
export function portalRecordHours(record: ReportRecord | Record<string, unknown> | null | undefined): number | null {
    const raw = record?.workMinutes;
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0, value) / 60 : null;
}

/** حالة الصف — مرآة `statusBadge` في القديم (`employee-portal.js:300-309`). */
export function portalRecordState(record: ReportRecord | Record<string, unknown> | null | undefined): PortalBadge {
    const checkIn = String(record?.checkIn ?? '').trim();
    const checkOut = String(record?.checkOut ?? '').trim();
    if (!checkIn) {
        return { label: 'بلا حضور', tone: 'warning' };
    }
    if (!checkOut) {
        return { label: 'بلا انصراف', tone: 'warning' };
    }
    const late =
        Number(record?.lateMinutes ?? 0) > 0 ||
        Number(record?.arrivalLateRawMinutes ?? 0) > 0 ||
        Number(record?.earlyLeaveRawMinutes ?? 0) > 0;
    return late ? { label: 'متأخر', tone: 'warning' } : { label: 'في الوقت', tone: 'success' };
}

/** مصدر البصمة — تسميات `sourceBadge` في القديم (`employee-portal.js:294-298`). */
export function portalSourceBadge(source: unknown): PortalBadge {
    switch (String(source ?? '')) {
        case 'device':
            return { label: 'بصمة', tone: 'info' };
        case 'qr':
            return { label: 'QR', tone: 'success' };
        case 'portal':
            return { label: 'كاميرا التطبيق', tone: 'info' };
        case 'backfill':
            return { label: 'أرشيف', tone: 'neutral' };
        default:
            return { label: 'يدوي', tone: 'neutral' };
    }
}

/** حالة طلب الإجازة — كلمات `LEAVES` في القديم (`employee-portal.js:377`). */
export function portalLeaveBadge(status: unknown): PortalBadge {
    switch (String(status ?? '')) {
        case 'approved':
            return { label: 'معتمد', tone: 'success' };
        case 'rejected':
            return { label: 'مرفوض', tone: 'danger' };
        case 'returned':
            return { label: 'عاد للموظف للتعديل', tone: 'warning' };
        case 'pending':
            return { label: 'معلق', tone: 'warning' };
        default:
            return { label: String(status ?? '') || '—', tone: 'neutral' };
    }
}

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function hoursText(hours: number | null): string {
    return hours === null ? '—' : hours.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export interface PortalRegisterPrintOptions {
    title: string;
    employeeName: string;
    employeeId: string;
    from: string;
    to: string;
    report: AttendanceReport;
    brandName?: string;
    logoSrc?: string;
    generatedAt?: Date;
}

/**
 * ورقة كشف الحضور والانصراف — نفس محتوى طباعة القديم
 * (`employee-portal.js:385-422`) بنمط مستندات V3: صفٌّ لكل سجل، والحالة من
 * حقول السجل، والملخّص من `summary` الذي حسبه الخادم (`totalKarim` = الساعات).
 */
export function portalRegisterHtml(options: PortalRegisterPrintOptions): string {
    const { title, employeeName, employeeId, from, to, report } = options;
    const records = Array.isArray(report.records) ? report.records : [];
    const summary = report.summary ?? {};
    const generatedAt = options.generatedAt ?? new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    const stamp = `${pad(generatedAt.getDate())}/${pad(generatedAt.getMonth() + 1)}/${String(generatedAt.getFullYear())} ${pad(generatedAt.getHours())}:${pad(generatedAt.getMinutes())}`;
    const daysPresent = Number(summary.daysPresent ?? records.filter((row) => row.checkIn).length);
    const totalHours = Number(summary.totalKarim ?? 0);
    const body = records
        .map((record) => {
            const state = portalRecordState(record);
            const hours = record.checkIn && record.checkOut ? portalRecordHours(record) : null;
            return (
                `<tr><td class="c n">${escapeHtml(String(record.date ?? '').slice(0, 10))}</td>` +
                `<td class="c n">${escapeHtml(record.checkIn || '—')}</td>` +
                `<td class="c n">${escapeHtml(record.checkOut || '—')}</td>` +
                `<td class="c n">${escapeHtml(hoursText(hours))}</td>` +
                `<td class="c">${escapeHtml(state.label)}</td></tr>`
            );
        })
        .join('');
    const brand =
        options.brandName || options.logoSrc
            ? `<div class="brand">${options.logoSrc ? `<img src="${escapeHtml(options.logoSrc)}" alt="" width="46" height="46">` : ''}<span>${escapeHtml(options.brandName ?? '')}</span></div>`
            : '';

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#172b3b;background:#fff;margin:0;padding:28px;direction:rtl}
.sheet{max-width:900px;margin:auto}
.brand{display:flex;align-items:center;gap:10px;border-bottom:3px solid #0f766e;padding-bottom:12px;margin-bottom:14px;color:#0f766e;font-weight:700}
.brand img{width:46px;height:46px;object-fit:contain}
.head{text-align:center;margin-bottom:14px}
.head h1{margin:0 0 6px;color:#0f766e;font-size:21px}.head p{margin:3px 0;color:#596e80;font-size:13px}
.summary{display:flex;justify-content:center;gap:24px;margin:10px 0 14px;font-size:13px;color:#102a43}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #dce5ec;padding:6px;text-align:right;font-size:12px}
th{background:#eaf0f5;color:#102a43}td.c,th.c{text-align:center}td.n{direction:ltr;unicode-bidi:embed}
.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#0f766e;color:#fff}
.controls button.secondary{background:#31485a}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:11mm}}
</style></head><body>
<div class="controls"><button type="button" data-report-print>طباعة</button><button type="button" class="secondary" data-report-close>إغلاق</button></div>
<main class="sheet">${brand}<header class="head"><h1>${escapeHtml(title)}</h1>
<p>الموظف: ${escapeHtml(employeeName)} (${escapeHtml(employeeId)}) — الفترة: ${escapeHtml(from)} ← ${escapeHtml(to)}</p>
<p>تاريخ التقرير: ${escapeHtml(stamp)}</p></header>
<div class="summary"><span>أيام الحضور: ${escapeHtml(daysPresent.toLocaleString('en-US'))}</span><span>إجمالي الساعات: ${escapeHtml(hoursText(Number.isFinite(totalHours) ? totalHours : 0))}</span></div>
<table><thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead>
<tbody>${body || '<tr><td colspan="5">لا سجلات في هذه الفترة</td></tr>'}</tbody></table>
</main></body></html>`;
}

/**
 * بوابة الموظف — قراءة حالتها وبصماتي فقط:
 *   GET /api/attendance/portal/status  → ربط الحساب بالموظف، وحالة اليوم،
 *     وأعلام البوابة والموقع وقوالب الوجه (كما يرد من `attendance-portal-routes`).
 *   GET /api/zkteco/my-punches        → بصمات الحساب المرتبط (قد تكون غير مرتبطة).
 *
 * الكتابة (البصمة وتسجيل الرفض وتقوالب الوجه) في `portal-write.ts` بعقودها
 * نفسها. لا شيء هنا يُرسل POST.
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const boolLike = z.union([z.boolean(), z.string(), z.number()]).nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const portalStatusSchema = z
    .object({
        ok: boolLike,
        enabled: boolLike,
        geofence: boolLike,
        deviceBinding: boolLike,
        radiusMeters: numLike,
        hasEmployeeProfile: boolLike,
        employeeName: text,
        deviceBound: boolLike,
        faceEnabled: boolLike,
        faceEnrolled: boolLike,
        faceStrict: boolLike,
        faceMinSamples: numLike,
        geoStrictMultiFix: boolLike,
        faceV2: z.object({ enabled: boolLike, enrolled: boolLike }).passthrough().optional(),
        today: z.object({ checkIn: text, checkOut: text }).passthrough().optional(),
    })
    .passthrough();

export type PortalStatus = z.infer<typeof portalStatusSchema>;

const punchSchema = z
    .object({
        id: idValue,
        attendanceTime: text,
        punchTime: text,
        state: numLike,
        verifyType: numLike,
        deviceName: text,
    })
    .passthrough();

export const myPunchesSchema = z
    .object({
        linked: boolLike,
        punchCount: numLike,
        punches: z.array(punchSchema).optional(),
        error: text,
    })
    .passthrough();

export type MyPunches = z.infer<typeof myPunchesSchema>;

export interface PortalSnapshot {
    status: PortalStatus | null;
    punches: MyPunches | null;
    failures: string[];
}

export async function fetchPortalSnapshot(signal?: AbortSignal): Promise<PortalSnapshot> {
    const token = getAccessToken();
    const options = signal ? { signal } : {};
    const settled = await Promise.allSettled([
        fetchJson(portalStatusSchema, '/api/attendance/portal/status', token, options),
        fetchJson(myPunchesSchema, '/api/zkteco/my-punches', token, options),
    ]);
    const failures: string[] = [];
    settled.forEach((result, index) => {
        if (result.status === 'rejected') {
            const name = index === 0 ? 'حالة البوابة' : 'بصماتي';
            const reason = result.reason instanceof Error ? result.reason.message : 'لم يستجب';
            failures.push(`${name}: ${reason}`);
        }
    });
    return {
        status: settled[0]?.status === 'fulfilled' ? settled[0].value : null,
        punches: settled[1]?.status === 'fulfilled' ? settled[1].value : null,
        failures,
    };
}

/** تسميات حالات البصمة كما في `zkteco-repo.punchStateName`. */
const PUNCH_STATES = ['حضور', 'انصراف', 'خروج استراحة', 'عودة استراحة', 'دخول أوفر تايم', 'خروج أوفر تايم'];

export function punchStateName(state: unknown): string {
    if (state === null || state === undefined || state === '') {
        return 'غير محددة';
    }
    const value = Number(state);
    if (value === -1) {
        return 'غير محددة';
    }
    return PUNCH_STATES[value] ?? `حالة ${String(state)}`;
}

export function isOn(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

/** وقت البصمة كما ورد (تاريخ + وقت) بلا تحويل منطقة زمنية. */
export function punchTimeText(punch: z.infer<typeof punchSchema>): string {
    const raw = String(punch.attendanceTime ?? punch.punchTime ?? '');
    return raw ? raw.slice(0, 16).replace('T', ' ') : '—';
}
