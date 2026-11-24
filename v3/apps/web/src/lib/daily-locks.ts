import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * لوحة التقفيل اليومي — عقدٌ واحد قرائي:
 *
 *   GET /api/yara-reports/daily-locks?date=YYYY-MM-DD
 *     { ok, date, total, locked, unlocked,
 *       rows:[{dept_code, dept_name, gross, refund, net, invoices, refunds,
 *              lock_count, last_lock}],
 *       totals:{gross, refund, net, invoices, refunds} }
 *
 * العقد مقروء من `backend/yarasoft/yara-reports.js` (موضع daily-locks) و
 * `frontend/app/js/v2/data/oracle-repo.js:47` — لا حقول مخترعة.
 *
 * الخادم يحسم الصلاحية (admin/manager/accountant...) والأرقام. الواجهة تعرض
 * فقط: لا تجميع مالي في المتصفح، وتوتالٌ غائب يُشتق **للعرض** من الصفوف نفسها
 * بنفس ما فعل القديم (`totalNet`/`totalInv` في `oracle-repo.js`).
 * لا مسار فتح/إغلاق في الخادم ولا في شاشة القديم — سجلٌّ قرائي مكتمل.
 */

const nullableText = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

export const dailyLockRowSchema = z
    .object({
        dept_code: nullableText,
        dept_name: nullableText,
        gross: numLike,
        refund: numLike,
        net: numLike,
        invoices: numLike,
        refunds: numLike,
        lock_count: numLike,
        last_lock: nullableText,
    })
    .passthrough();

const dailyLockTotalsSchema = z
    .object({
        gross: numLike,
        refund: numLike,
        net: numLike,
        invoices: numLike,
        refunds: numLike,
    })
    .passthrough();

export const dailyLocksSchema = z
    .object({
        ok: z.boolean().optional(),
        date: nullableText,
        total: numLike,
        locked: numLike,
        unlocked: numLike,
        rows: z.array(dailyLockRowSchema).optional(),
        totals: dailyLockTotalsSchema.optional(),
    })
    .passthrough();

export type DailyLockRow = z.infer<typeof dailyLockRowSchema>;
export type DailyLocksResponse = z.infer<typeof dailyLocksSchema>;

export async function fetchDailyLocks(date: string, signal?: AbortSignal): Promise<DailyLocksResponse> {
    return fetchJson(
        dailyLocksSchema,
        `/api/yara-reports/daily-locks?date=${encodeURIComponent(date)}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

/** قسم مقفّل = له حركة تقفيل (lock_count > 0)؛ غير ذلك مفتوح — حكم الخادم. */
export function isLocked(row: DailyLockRow): boolean {
    return Number(row.lock_count ?? 0) > 0;
}

/** صفوف العرض بعد ضمان العدد: الصفوف الواصلة فقط، بلا فلترة عميلة تكسر حكم الخادم. */
export function dailyLockRows(data: DailyLocksResponse | undefined): DailyLockRow[] {
    return data?.rows ?? [];
}

/**
 * توتال العرض: `totals` من الخادم إن وُجد، وإلا يُشتق من الصفوف كما في القديم
 * (يلزم للعرض فقط — لا يُرسل ولا يُكتب).
 */
export function displayTotals(data: DailyLocksResponse | undefined): {
    gross: number;
    refund: number;
    net: number;
    invoices: number;
    refunds: number;
} {
    const rows = data?.rows ?? [];
    const sum = (key: 'gross' | 'refund' | 'net' | 'invoices' | 'refunds'): number =>
        rows.reduce((total, row) => total + (Number(row[key] ?? 0) || 0), 0);
    const totals = data?.totals;
    return {
        gross: Number(totals?.gross ?? sum('gross')),
        refund: Number(totals?.refund ?? sum('refund')),
        net: Number(totals?.net ?? sum('net')),
        invoices: Number(totals?.invoices ?? sum('invoices')),
        refunds: Number(totals?.refunds ?? sum('refunds')),
    };
}
