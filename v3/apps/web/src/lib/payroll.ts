import { addMoney, roundHalfUp } from '@karim/shared';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey, type HrDepartment } from './employees';

/**
 * منظومة الرواتب — طبقة القراءة في v3 (لا كتابة إطلاقًا).
 *
 * الأبواب الثلاثة التي يقرأها القديم، منقولً من مستودعاته:
 *   1. `GET /api/payroll_runs?page&limit=1000&sort=id&order=desc`
 *      — `frontend/app/js/v2/data/hr-registers-repo.js:25` (`walk('payroll_runs')`،
 *      وت-behavior المشي في `:10-21`: حتى 8 صفحات، توقّف عند `totalPages` أو
 *      صفحة ناقصة). CRUD العام: `backend/server.js:1766-1856` (ردّ `{data, pagination}`).
 *      أعمدة الجدول حقيقيةٌ بـ`snake_case` (`database/migrations/048_hr_suite.sql:59-71`):
 *      `month, status, employee_count, total_basic, total_overtime, total_bonuses,
 *      total_penalties, total_advances, total_net`.
 *   2. `GET /api/employees?page&limit=1000&sort=id&order=asc`
 *      — `frontend/app/js/v2/data/employees-repo.js:100-107` و`fetchPaged:85-97`
 *      (5 × 1000، ترتيب `id asc`).
 *   3. `GET /api/attendance/range?from&to&limit=30000`
 *      — `frontend/app/js/v2/data/attendance-repo.js:340-352` (الحدّ الافتراضي 30000،
 *      والردّ `{data, total, from, to}`: `backend/server.js:1438-1478`).
 *
 * **أعمدة المسير**: `payrollRunToRow` في القديم (`hr-registers-repo.js:58-70`) يقرأ
 * أسماءً camelCase لم تكن في الجدول أبدًا (`basic`/`totalBasic`/`basic_total`)، فلم
 * يكن يعرض إلا `month` و`status` وبقيّته أصفارًا. هنا نقرأ الأعمدة الحقيقية
 * (`total_basic` …) كما في القديم الأول `frontend/app/js/features/hr.js:776`.
 *
 * **الراتب في كشف الموظفين**: `employees.salary` عمود `NUMERIC(10,2)`
 * (`database/migrations/001_schema.sql:34`) ويأتي نصًّا (ADR-04). والخادم يحذفه من
 * الصفّ لغير الأدوار المرتفعة (`backend/schema-registry.js:857-869`)، فغيابه عن
 * الاستجابة **قرارُ الخادم** لا تخمينٌ من الواجهة — فنُظهر «—» ونعلن ذلك.
 *
 * **الكتابة** (توليد المسير، تطبيق خصومات الالتزام، السلف، البنود، العقود،
 * التقييمات) كلها تبقى في V2: `frontend/app/js/v2/data/payroll-suite.js:65-108`.
 * لا `POST` ولا `PUT` ولا `DELETE` في هذا الملف.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();

/** عدّادٌ صحيح (INT) — العدّ ليس مالًا، فـ`Number` هنا آمن. */
const countValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => {
        const parsed = Number(value ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    });

/**
 * مبلغ `NUMERIC` — يأتي نصًّا من Postgres (ADR-04) فلا يُحوَّل إلى `Number`
 * أبدًا: يبقى نصًّا حتى العرض والجمع (`addMoney` على المليم).
 */
const moneyValue = z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => (value === null || value === undefined ? null : String(value)));

export const payrollRunSchema = z
    .object({
        id: idValue.optional(),
        month: z.string(),
        status: optionalText,
        employee_count: countValue,
        total_basic: moneyValue,
        total_overtime: moneyValue,
        total_bonuses: moneyValue,
        total_penalties: moneyValue,
        total_advances: moneyValue,
        total_net: moneyValue,
    })
    .passthrough();

export type PayrollRun = z.infer<typeof payrollRunSchema>;

export const payrollEmployeeSchema = z
    .object({
        id: idValue,
        employeeId: optionalText,
        name: optionalText,
        department: optionalText,
        position: optionalText,
        status: optionalText,
        /**
         * `undefined` = الخادم حذف الحقل (راتبٌ مخفيّ لهذا الدور) — و`null` =
         * الراتب فارغ في القاعدة. الفرقُ مقصود: الأول «لا يُعرض» والثاني «صفر».
         */
        salary: moneyValue,
    })
    .passthrough();

export type PayrollEmployee = z.infer<typeof payrollEmployeeSchema>;

export const attendanceRecordSchema = z
    .object({
        id: idValue.optional(),
        employeeId: idValue,
        date: optionalText,
        checkIn: optionalText,
        checkOut: optionalText,
    })
    .passthrough();

export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

const paginationSchema = z
    .object({
        page: countValue.optional(),
        limit: countValue.optional(),
        total: countValue.optional(),
        totalPages: countValue.optional(),
    })
    .passthrough();

const payrollRunPageSchema = z.union([
    z.array(payrollRunSchema),
    z.object({ data: z.array(payrollRunSchema), pagination: paginationSchema.optional() }).passthrough(),
]);

const payrollEmployeePageSchema = z.union([
    z.array(payrollEmployeeSchema),
    z.object({ data: z.array(payrollEmployeeSchema), pagination: paginationSchema.optional() }).passthrough(),
]);

const attendanceRangeSchema = z
    .object({
        data: z.array(attendanceRecordSchema),
        total: countValue.optional(),
        from: z.string().optional(),
        to: z.string().optional(),
    })
    .passthrough();

/* ─── الجلب ────────────────────────────────────────────────────────────── */

const PAGE_SIZE = 1000;
/** سقف المشي في `walk` القديم (`hr-registers-repo.js:10-21`). */
const MAX_PAGES = 8;
/** سقف `fetchPaged` القديم للموظفين (`employees-repo.js:84-97`). */
const MAX_EMPLOYEE_PAGES = 5;
/** حدّ الحضور الافتراضي في القديم (`attendance-repo.js:340`). */
const ATTENDANCE_LIMIT = 30000;

export function payrollRunsPath(page: number): string {
    return `/api/payroll_runs?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=desc`;
}

export function payrollEmployeesPath(page: number): string {
    return `/api/employees?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=asc`;
}

export function attendanceRangePath(from: string, to: string): string {
    return `/api/attendance/range?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=${String(
        ATTENDANCE_LIMIT,
    )}`;
}

/** `fetchPayrollRuns` — `hr-registers-repo.js:25` مع مشي `walk` نفسه. */
export async function fetchPayrollRuns(signal?: AbortSignal): Promise<PayrollRun[]> {
    const rows: PayrollRun[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            payrollRunPageSchema,
            payrollRunsPath(page),
            getAccessToken(),
            signal ? { signal } : {},
        );
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        const totalPages = Array.isArray(body) ? 0 : (body.pagination?.totalPages ?? 0);
        if (!batch.length || (totalPages > 0 && page >= totalPages) || batch.length < PAGE_SIZE) {
            break;
        }
    }
    return rows;
}

/** `fetchEmployees` — `employees-repo.js:100-107` (نفس السقف والترتيب). */
export async function fetchPayrollEmployees(signal?: AbortSignal): Promise<PayrollEmployee[]> {
    const rows: PayrollEmployee[] = [];
    for (let page = 1; page <= MAX_EMPLOYEE_PAGES; page += 1) {
        const body = await fetchJson(
            payrollEmployeePageSchema,
            payrollEmployeesPath(page),
            getAccessToken(),
            signal ? { signal } : {},
        );
        const batch = Array.isArray(body) ? body : body.data;
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) {
            break;
        }
    }
    return rows;
}

/** `fetchAttendanceRange` — `attendance-repo.js:340-352`. */
export async function fetchAttendanceRange(
    from: string,
    to: string,
    signal?: AbortSignal,
): Promise<AttendanceRecord[]> {
    const body = await fetchJson(
        attendanceRangeSchema,
        attendanceRangePath(from, to),
        getAccessToken(),
        signal ? { signal } : {},
    );
    return body.data;
}

/* ─── التواريخ (ADR-05) ─────────────────────────────────────────────────── */

/** الشهر الحالي `YYYY-MM` — `payroll.js:35-37` (`curMonth`). */
export function currentMonth(now: Date = new Date()): string {
    const date = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * آخر يوم في شهر `YYYY-MM` — حسابٌ تقويميٌّ نصّيّ بحساب `Date.UTC` على اليوم صفر
 * من الشهر التالي (عدد أيام الشهر) بلا تحويلٍ زمنيٍّ ولا `toISOString`.
 *
 * القديم `payroll-suite.js:50-53` كان يبني `new Date(y, m, 0).toISOString().slice(0,10)`
 * — أي منتصف الليل المحلي ثم تحويله إلى UTC، فينزل يومٌ واحدًا في توقيت الرياض
 * (UTC+3) وتضيع آخر أيام الشهر من نطاق الحضور. هنا لا يوجد تاريخٌ حقيقيٌّ يُنقل
 * بين المناطق، فالنتيجة واحدة في كل مكان (ADR-05).
 */
export function monthEndDate(monthIso: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthIso ?? '').trim());
    if (!match) {
        return '';
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (year < 1 || month < 1 || month > 12) {
        return '';
    }
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return `${String(year)}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
}

/** أول يوم في شهر `YYYY-MM` — نفس منطق `payroll-suite.js:30-31`. */
export function monthStartDate(monthIso: string): string {
    const month = String(monthIso ?? '').trim();
    return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : '';
}

/* ─── الكشف ────────────────────────────────────────────────────────────── */

export type PayrollSheet = {
    /** النشطون فقط — `payroll-suite.js:35`. */
    employees: PayrollEmployee[];
    /** عدّ أيام الحضور لكل موظف — `countByEmp` في `payroll-suite.js:55-63`. */
    monthDays: Map<string, number>;
};

/** عدّ الأيام بصمةً واحدة لكل موظف — `payroll-suite.js:55-63` حرفيًا. */
export function countByEmployee(rows: readonly AttendanceRecord[]): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        if (!row.checkIn) {
            continue;
        }
        const key = String(row.employeeId);
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
}

/**
 * كشف الرواتب — `fetchPayrollSheet` في `payroll-suite.js:27-40`: الموظفون
 * النشطون + عدّ حضور الشهر. الشهر الفارغ = الشهر الحالي (سلوك `:30-32`).
 */
export async function fetchPayrollSheet(monthIso: string, signal?: AbortSignal): Promise<PayrollSheet> {
    const month = /^\d{4}-\d{2}$/.test(String(monthIso ?? '').trim()) ? String(monthIso).trim() : currentMonth();
    const [employees, attendance] = await Promise.all([
        fetchPayrollEmployees(signal),
        fetchAttendanceRange(monthStartDate(month), monthEndDate(month), signal),
    ]);
    const active = employees.filter((employee) => employee.status === 'active');
    return { employees: active, monthDays: countByEmployee(attendance) };
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

/** مبلغ من الخادم → نصّ منتهٍ بحانتين — بلا Float (ADR-04). */
export function normalizeMoney(value: string | null | undefined): string {
    if (value === null || value === undefined || value === '') {
        return '0.00';
    }
    return roundHalfUp(String(value), 2);
}

export type PayrollRunRow = {
    id: string;
    month: string;
    status: string;
    count: number;
    basic: string;
    overtime: string;
    bonuses: string;
    penalties: string;
    advances: string;
    net: string;
};

/**
 * صفّ المسير — `payrollRunToRow` (`hr-registers-repo.js:58-70`) بأعمدته الحقيقية:
 * `total_basic`… بدل الأسماء التي لم تكن في الجدول.
 */
export function payrollRunToRow(run: PayrollRun): PayrollRunRow {
    return {
        id: run.id ?? run.month,
        month: run.month,
        status: run.status ? String(run.status) : '',
        count: run.employee_count,
        basic: normalizeMoney(run.total_basic),
        overtime: normalizeMoney(run.total_overtime),
        bonuses: normalizeMoney(run.total_bonuses),
        penalties: normalizeMoney(run.total_penalties),
        advances: normalizeMoney(run.total_advances),
        net: normalizeMoney(run.total_net),
    };
}

export type PayrollRunsSummary = {
    count: number;
    net: string;
    basic: string;
    employees: number;
};

/**
 * مجاميع لوحة المسيرات — `payroll.js:234-243` حرفيًا: `basic` و`net` و`count`
 * تُجمع، والعدد هو عدد المسيرات. الجمع نصّيٌّ على المليم (`addMoney`).
 */
export function runsSummary(rows: readonly PayrollRunRow[]): PayrollRunsSummary {
    return {
        count: rows.length,
        net: addMoney(...rows.map((row) => row.net)),
        basic: addMoney(...rows.map((row) => row.basic)),
        employees: rows.reduce((sum, row) => sum + row.count, 0),
    };
}

export type PayrollSheetRow = {
    id: string;
    name: string;
    dept: string;
    position: string;
    /** `null` = الراتب مخفيٌّ بقرار الخادم — لا يُجمع ولا يُعرض كمبلغ. */
    salary: string | null;
    days: number;
};

/**
 * صفّ الكشف — `payroll.js:148-153`: القسم من دليل HR بالـ`code` (وإلّا «—»)،
 * والمنصب «—» عند غيابه، والراتب بصيغته النصية إن أعطاه الخادم.
 */
export function sheetRow(
    employee: PayrollEmployee,
    deptByCode: ReadonlyMap<string, HrDepartment>,
    days: number,
): PayrollSheetRow {
    const deptCode = employee.department ? String(employee.department) : '';
    const dept = deptByCode.get(deptCode);
    return {
        id: employee.id,
        name: employee.name ? String(employee.name) : `#${employee.id}`,
        dept: dept?.name ? String(dept.name) : '—',
        position: employee.position ? String(employee.position) : '—',
        salary: employee.salary === null || employee.salary === undefined ? null : normalizeMoney(employee.salary),
        days,
    };
}

export type PayrollSheetSummary = {
    /** إجمالي الرواتب الظاهرة فقط — `payroll.js:146`. */
    total: string;
    shown: number;
    /** عدد الموظفين الذين أخفى الخادم رواتبهم. */
    hidden: number;
};

/**
 * إجمالي الكشف — `payroll.js:146` و`:155`: مجموع رواتب النتائج المعروضة.
 * الرواتب المخفيّة (قرار الخادم) لا تُجمع ولا تُخمَّن: تُحذَب من المجموع
 * ويُعلن عددها في الشاشة.
 */
export function sheetSummary(rows: readonly PayrollSheetRow[]): PayrollSheetSummary {
    const amounts = rows.flatMap((row) => (row.salary === null ? [] : [row.salary]));
    return {
        total: addMoney(...amounts),
        shown: amounts.length,
        hidden: rows.length - amounts.length,
    };
}

/* ─── البحث ─────────────────────────────────────────────────────────────── */

export type PayrollSearch = {
    rows: PayrollSheetRow[];
    matched: boolean;
    /** مطابقةٌ ظهرت بعد تطبيع الحروف العربية فقط. */
    folded: boolean;
    hits: number;
};

/**
 * بحث الكشف بالاسم — `payroll.js:142-145`: مطابقةٌ على الاسم بعد التطبيع
 * (`arSearchKey`)، فالنصُّ «احمد» يجد «أحمد». المطابقة الخامّة تُحسب بلا تطبيع،
 * والمطابقة التي لم تصِف إلا بالتطبيع تُعلَن للخدم.
 */
export function searchSheetRows(rows: readonly PayrollSheetRow[], query: string): PayrollSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, folded: false, hits: rows.length };
    }
    const key = arSearchKey(raw);
    const kept: { row: PayrollSheetRow; folded: boolean }[] = [];
    for (const row of rows) {
        if (row.name.toLowerCase().includes(raw.toLowerCase())) {
            kept.push({ row, folded: false });
            continue;
        }
        if (key && arSearchKey(row.name).includes(key)) {
            kept.push({ row, folded: true });
        }
    }
    return {
        rows: kept.map((item) => item.row),
        matched: true,
        folded: kept.some((item) => item.folded),
        hits: kept.length,
    };
}
