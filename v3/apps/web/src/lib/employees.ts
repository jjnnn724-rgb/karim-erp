import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * دليل الموظفين — قراءة فقط من المسار القديم نفسه
 * (`/api/employees` و`/api/hrDepartments`، انظر
 * `frontend/app/js/v2/data/employees-repo.js`).
 *
 * قائمة المسموح — جوهر قرار الخصوصية في القديم: الصفّ يعرض كود الموظف
 * والاسم والقسم والوظيفة والهاتف والحالة فقط. الراتب ورقم الإقامة وبصمة
 * الجهاز تصل من الخادم في الصف الكامل، لكنها **لا تدخل الصفّ هنا** — ولا
 * حجبًا بـCSS، ولا في `title`. الشاشة القديمة تسمح بالراتب في البطاقات
 * وحدها (admin|manager|hr)؛ v3 لا تبني البطاقات أصلًا فتبقى خارج كل مسار.
 *
 * لا كتابة هنا: الإضافة والتعديل والحذف والاستيراد وكشف الموظف في V2.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();

export const employeeSchema = z
    .object({
        id: idValue,
        userId: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => (value === null || value === undefined ? '' : String(value))),
        employeeId: optionalText,
        name: optionalText,
        department: optionalText,
        position: optionalText,
        phone: optionalText,
        status: optionalText,
        // إضافات البطاقة فقط (مرآة `cardExtrasMap` في القديم): تصل من الخادم
        // في الصفّ الكامل — الراتب يُكتم في الخادم عن غير الأدوار المرتفعة
        // (schema-registry EMPLOYEE_SENSITIVE_FIELDS). لا تدخل `EmployeeRow`
        // أبدًا — تُقرأ من هذه الخريطة وحدها.
        salary: z.union([z.string(), z.number()]).nullable().optional(),
        photo: optionalText,
        deviceUserId: optionalText,
        shift_start: optionalText,
        shift_karim: z.union([z.string(), z.number()]).nullable().optional(),
        auto_checkout: z.union([z.boolean(), z.string(), z.number()]).nullable().optional(),
        auto_lock: z.union([z.boolean(), z.string(), z.number()]).nullable().optional(),
        day_off: z.union([z.string(), z.number()]).nullable().optional(),
        email: optionalText,
        joinDate: optionalText,
        iqamaExpiry: optionalText,
        healthCertExpiry: optionalText,
        healthEduExpiry: optionalText,
        cardId: optionalText,
    })
    .passthrough();

export type Employee = z.infer<typeof employeeSchema>;

export const hrDepartmentSchema = z
    .object({
        code: z
            .union([z.string(), z.number()])
            .nullable()
            .optional()
            .transform((value) => String(value ?? '')),
        name: optionalText,
    })
    .passthrough();

export type HrDepartment = z.infer<typeof hrDepartmentSchema>;

const paginationSchema = z
    .object({
        total: z.number().optional(),
        totalPages: z.number().optional(),
    })
    .passthrough();

function pageSchema<T extends z.ZodTypeAny>(row: T) {
    return z
        .union([
            z.array(row),
            z
                .object({
                    data: z.array(row),
                    pagination: paginationSchema.optional(),
                })
                .passthrough(),
        ])
        .transform((body) => (Array.isArray(body) ? body : body.data));
}

const employeePageSchema = pageSchema(employeeSchema);
const departmentPageSchema = pageSchema(hrDepartmentSchema);

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 5;

/** 5 × 1000 — نفس سقف `fetchPaged` في القديم، وترتيب `id asc` نفسه. */
async function fetchAll<T>(path: string, parse: z.ZodType<T[]>, signal?: AbortSignal): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            parse,
            `${path}?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=asc`,
            getAccessToken(),
            signal ? { signal } : {},
        );
        rows.push(...body);
        if (body.length < PAGE_SIZE) {
            break;
        }
    }
    return rows;
}

export function fetchEmployees(signal?: AbortSignal): Promise<Employee[]> {
    return fetchAll('/api/employees', employeePageSchema, signal);
}

export function fetchHrDepartments(signal?: AbortSignal): Promise<HrDepartment[]> {
    return fetchAll('/api/hrDepartments', departmentPageSchema, signal);
}

/* ─── الحالة ────────────────────────────────────────────────────────────── */

/** قاموس `status.js` نفسه — مفتاحٌ مجهول يُعرض كما هو، لا يُعاد تسميته. */
export const EMPLOYEE_STATUS_AR: Record<string, string> = {
    active: 'نشط',
    inactive: 'غير نشط',
    suspended: 'موقوف',
};

export type StatusPresentation = { label: string; known: boolean };

export function employeeStatus(status: string): StatusPresentation {
    if (!status) {
        return { label: 'غير محدد', known: true };
    }
    return Object.hasOwn(EMPLOYEE_STATUS_AR, status)
        ? { label: EMPLOYEE_STATUS_AR[status] ?? status, known: true }
        : { label: status, known: false };
}

/* ─── بطاقات الموظفين (مرآة `cardExtrasMap` في القديم) ─────────────────────
 * `id` → إضافات البطاقة وحدها (راتب، صورة، رقم البصمة، حقائق الوردية).
 * المسار الوحيد غير-الصفي: تغذي رسّام البطاقة مباشرة — لا تدخل `EmployeeRow`
 * أبدًا. الراتب لا يُعرض إلا للأدوار المرتفعة (admin/manager/hr) — نفس قاعدة
 * الخادم الذي يكتمه عن غيرهم أصلًا (`EMPLOYEE_SENSITIVE_FIELDS`).
 */

export type EmployeeExtras = {
    salary: number | null;
    photo: string;
    deviceUserId: string;
    shift_start: string;
    shift_karim: number;
    auto_checkout: boolean;
    auto_lock: boolean;
    day_off: number | null;
    email: string;
    joinDate: string;
    iqamaExpiry: string;
    healthCertExpiry: string;
    healthEduExpiry: string;
    cardId: string;
};

export function cardExtrasMap(employees: readonly Employee[]): Map<string, EmployeeExtras> {
    const map = new Map<string, EmployeeExtras>();
    for (const e of employees) {
        if (!e || e.id === undefined || e.id === null) {
            continue;
        }
        const raw = e.salary === null || e.salary === undefined || e.salary === '' ? null : Number(e.salary);
        map.set(String(e.id), {
            salary: Number.isFinite(raw) ? raw : null,
            photo: e.photo ? String(e.photo) : '',
            deviceUserId:
                e.deviceUserId !== undefined && e.deviceUserId !== null && String(e.deviceUserId) !== ''
                    ? String(e.deviceUserId)
                    : '',
            shift_start: e.shift_start ? String(e.shift_start) : '',
            shift_karim: Number(e.shift_karim) > 0 ? Number(e.shift_karim) : 0,
            auto_checkout: e.auto_checkout === true || String(e.auto_checkout) === 'true' || Number(e.auto_checkout) === 1,
            auto_lock: e.auto_lock === true || String(e.auto_lock) === 'true' || Number(e.auto_lock) === 1,
            day_off:
                e.day_off === undefined || e.day_off === null || e.day_off === '' ? null : Number(e.day_off),
            email: e.email ? String(e.email) : '',
            joinDate: e.joinDate ? String(e.joinDate) : '',
            iqamaExpiry: e.iqamaExpiry ? String(e.iqamaExpiry) : '',
            healthCertExpiry: e.healthCertExpiry ? String(e.healthCertExpiry) : '',
            healthEduExpiry: e.healthEduExpiry ? String(e.healthEduExpiry) : '',
            cardId: e.cardId ? String(e.cardId) : '',
        });
    }
    return map;
}

/** أول حرفين من أول كلمتين — أفاتار الاحتياط Legacy (عربي/لاتيني). */
export function initialsOf(name: string): string {
    return (
        String(name || '')
            .split(' ')
            .map((w) => w[0])
            .join('')
            .substring(0, 2) || '؟'
    );
}

/** مخططات صورة يقبلها عنصر البطاقة — غيرها يسقط للأحرف الأولى. */
export function validPhotoSrc(photo: string): string {
    const s = String(photo || '').trim();
    if (/^data:image\//i.test(s) || /^\//.test(s) || /^https?:\/\//i.test(s)) {
        return s;
    }
    return '';
}

/** حقائق الوردية لسطر البطاقة — مرآة `shiftSummary` في القديم. */
export function shiftSummary(emp: {
    shift_start?: string | null;
    shift_karim?: number | null;
    auto_checkout?: boolean;
    auto_lock?: boolean;
    day_off?: number | null;
}): { start: string; hours: string; overnight: boolean; auto: boolean; locked: boolean; off: string } {
    const st = String(emp.shift_start || '09:00');
    const hrs = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
    const m = st.match(/^(\d{1,2}):(\d{2})$/);
    let overnight = false;
    if (m && m[1] !== undefined && m[2] !== undefined) {
        const startMin = Number(m[1]) * 60 + Number(m[2]);
        const end = (startMin + Math.round(hrs * 60)) % (24 * 60);
        overnight = end <= startMin;
    }
    const offNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const offIdx = Number(emp.day_off);
    return {
        start: st,
        hours: String(hrs).replace(/\.0$/, ''),
        overnight,
        auto: Boolean(emp.auto_checkout),
        locked: Boolean(emp.auto_lock),
        off: (emp.day_off === 0 || emp.day_off) && offNames[offIdx] ? (offNames[offIdx] ?? '') : '',
    };
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type EmployeeRow = {
    id: string;
    code: string;
    name: string;
    dept: string;
    deptCode: string;
    deptResolved: boolean;
    position: string;
    phone: string;
    status: string;
    statusLabel: string;
    statusKnown: boolean;
};

/** `employees-repo.js:203-220` حرفيًا: الرمز '—'، ونصّ احتياطي `#id`،
 *  والقسم كوكبه الخام عند غياب الصلة بدليل HR. */
export function employeeToRow(
    employee: Employee,
    deptByCode: ReadonlyMap<string, HrDepartment> = new Map(),
): EmployeeRow {
    const deptCode = employee.department ? String(employee.department) : '';
    const dept = deptByCode.get(deptCode);
    const status = employee.status ? String(employee.status) : '';
    const presentation = employeeStatus(status);
    return {
        id: employee.id,
        code: employee.employeeId ? String(employee.employeeId) : '—',
        name: employee.name ? String(employee.name) : `#${employee.id}`,
        dept: dept?.name ? String(dept.name) : deptCode || '—',
        deptCode,
        deptResolved: Boolean(dept?.name),
        position: employee.position ? String(employee.position) : '—',
        phone: employee.phone ? String(employee.phone) : '—',
        status,
        statusLabel: presentation.label,
        statusKnown: presentation.known,
    };
}

export function departmentCodeMap(departments: readonly HrDepartment[]): Map<string, HrDepartment> {
    const map = new Map<string, HrDepartment>();
    for (const department of departments) {
        if (department.code) {
            map.set(department.code, department);
        }
    }
    return map;
}

/* ─── البحث ─────────────────────────────────────────────────────────────
 * `arSearchKey` جدول تطبيع `employees-repo.js:306-314` (وهو نفسه جدول
 * `core/utils.js`). البصمة مستثناة عمدًا: الصفّ لا يحمل `deviceUserId` في
 * v3، فالبحث فيها كان سيصل لمعلومة لا تعرضها الشاشة أصلًا.
 */

export function arSearchKey(value: string): string {
    return String(value || '')
        .toLowerCase()
        .replace(/[\u064B-\u065F\u0640]/g, '')
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/[ىئی]/g, 'ي')
        .replace(/ؤ/g, 'و')
        .replace(/ک/g, 'ك')
        .replace(/[ذز]/g, 'ز')
        .replace(/[ضص]/g, 'ص')
        .replace(/[ظط]/g, 'ط')
        .replace(/[شس]/g, 'س')
        .replace(/[ثت]/g, 'ت')
        .replace(/[خج]/g, 'ح')
        .replace(/[قف]/g, 'ف')
        .replace(/[غع]/g, 'ع')
        .replace(/\s+/g, ' ')
        .trim();
}

/** «007» و«7» رقمٌ واحد — نفس معادلة القديم (`features/employees.js:115`). */
function digitForm(value: string): string {
    const text = String(value ?? '').trim();
    return /^\d+$/.test(text) ? String(Number(text)) : '';
}

function tokenScore(token: string, row: EmployeeRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (/^\d+$/.test(raw)) {
        const digits = digitForm(raw);
        if (digits && digitForm(row.code) === digits) {
            return { score: 3, folded: false };
        }
    }
    if (raw && row.code.toLowerCase() === raw) {
        return { score: 3, folded: false };
    }
    if (raw && row.name.toLowerCase().includes(raw)) {
        return { score: 2, folded: false };
    }
    if (key && arSearchKey(row.name).includes(key)) {
        return { score: 2, folded: true };
    }
    for (const field of [row.code, row.position, row.dept, row.phone]) {
        if (raw && field.toLowerCase().includes(raw)) {
            return { score: 1, folded: false };
        }
        if (key && arSearchKey(field).includes(key)) {
            return { score: 1, folded: true };
        }
    }
    if (/^\d{3,}$/.test(raw)) {
        const digits = raw.replace(/\D/g, '');
        if (row.phone.replace(/\D/g, '').includes(digits) || row.code.replace(/\D/g, '').includes(digits)) {
            return { score: 1, folded: false };
        }
    }
    return { score: 0, folded: false };
}

export type EmployeeSearch = {
    rows: EmployeeRow[];
    matched: boolean;
    exact: number;
    folded: boolean;
    hits: number;
};

/** بحثٌ كل كلمة فيه لازم تلاقي موضعًا (AND)، ودرجة السطر أدنى درجات كلماته. */
export function searchEmployees(rows: readonly EmployeeRow[], query: string): EmployeeSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, exact: 0, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored: { row: EmployeeRow; score: number; folded: boolean }[] = [];
    for (const row of rows) {
        let score = 3;
        let folded = false;
        for (const token of tokens) {
            const hit = tokenScore(token, row);
            if (hit.score === 0) {
                score = 0;
                break;
            }
            if (hit.score < score) {
                score = hit.score;
            }
            if (hit.folded) {
                folded = true;
            }
        }
        if (score > 0) {
            scored.push({ row, score, folded });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return {
        rows: scored.map((item) => item.row),
        matched: true,
        exact: scored.filter((item) => item.score === 3).length,
        folded: scored.some((item) => item.folded),
        hits: scored.length,
    };
}

/* ─── المجاميع ──────────────────────────────────────────────────────────── */

export type CountEntry = { value: string; count: number };

export function countBy<T>(rows: readonly T[], pick: (row: T) => string): CountEntry[] {
    const map = new Map<string, number>();
    for (const row of rows) {
        const key = pick(row);
        map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'ar'));
}

/** الحالة كما هي مخزّنة، الأكثر أولًا — بما فيها '' (حقلٌ فارغ فعلًا). */
export function statusCounts(rows: readonly EmployeeRow[]): CountEntry[] {
    return countBy(rows, (row) => row.status);
}

export type DeptCount = { code: string; label: string; resolved: boolean; count: number };

/** التوزيع بمفتاح الكود المخزّن لا بالاسم — كودان بنفس الاسم يبقيان سطرين. */
export function deptCounts(rows: readonly EmployeeRow[]): DeptCount[] {
    const byCode = new Map<string, DeptCount>();
    for (const row of rows) {
        const hit = byCode.get(row.deptCode);
        if (hit) {
            hit.count += 1;
        } else {
            byCode.set(row.deptCode, {
                code: row.deptCode,
                label: row.dept || '—',
                resolved: row.deptResolved,
                count: 1,
            });
        }
    }
    return [...byCode.values()].sort(
        (a, b) => b.count - a.count || (a.label || '—').localeCompare(b.label || '—', 'ar'),
    );
}

export type EmployeeTotals = {
    total: number;
    departments: number;
    departmentsResolved: number;
    noPhone: number;
};

export function employeeTotals(rows: readonly EmployeeRow[]): EmployeeTotals {
    const departments = deptCounts(rows);
    return {
        total: rows.length,
        departments: departments.length,
        departmentsResolved: departments.filter((department) => department.resolved).length,
        noPhone: rows.filter((row) => row.phone === '—').length,
    };
}
