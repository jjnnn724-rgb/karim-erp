import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey, type Employee } from './employees';

/**
 * دليل حسابات الدخول — قراءة فقط من `/api/users` (القائمة العامة القديمة).
 *
 * قائمة المسموح: اسم المستخدم والاسم والدور والقسم وحالة الحساب وآخر دخول،
 * مع اسم الموظف المرتبط عبر `employees."userId"`. كلمة المرور و`password_vault`
 * والبريد والهاتف لا تدخل الصفّ أصلًا — الخادم يحذف الأوليين، والباقي خارج
 * قائمة العرض.
 *
 * القراءة نفسها محجوزة في القديم لأدوار admin|manager|accountant|auditor
 * (`sensitiveReadEntities` في `server.js`)؛ الشاشة لا تقرّر الصلاحية، بل
 * تعرض رفض الخادم كما هو. الإنشاء والتعديل والتعطيل ورموز الاستعادة في V2.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const activeValue = z
    .union([z.boolean(), z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => value === undefined || value === null || value === true || value === 1 || value === '1');

export const userSchema = z
    .object({
        id: idValue,
        username: optionalText,
        name: optionalText,
        role: optionalText,
        dept_code: optionalText,
        active: activeValue,
        last_login_at: optionalText,
    })
    .passthrough();

export type User = z.infer<typeof userSchema>;

const paginationSchema = z
    .object({
        total: z.number().optional(),
        totalPages: z.number().optional(),
    })
    .passthrough();

const userPageSchema = z
    .union([
        z.array(userSchema),
        z
            .object({
                data: z.array(userSchema),
                pagination: paginationSchema.optional(),
            })
            .passthrough(),
    ])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 5;

/** 5 × 1000 — نفس سقف القوائم في القديم وترتيب `id asc` نفسه. */
export async function fetchUsers(signal?: AbortSignal): Promise<User[]> {
    const rows: User[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
        const body = await fetchJson(
            userPageSchema,
            `/api/users?page=${String(page)}&limit=${String(PAGE_SIZE)}&sort=id&order=asc`,
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

/* ─── الأدوار ──────────────────────────────────────────────────────────── */

/** أسماء `ROLES` في `core/config.js`، مع `auditor` المسموح في السجل بلا اسم قديم. */
export const ROLE_LABELS: Record<string, string> = {
    owner: 'المالك',
    admin: 'مدير النظام',
    manager: 'مدير المطعم',
    auditor: 'مراجع',
    accountant: 'مدير الحسابات',
    hr: 'مدير الموارد البشرية',
    dept_head: 'رئيس قسم',
    warehouse: 'أمين المخزن',
    kitchen: 'الشيف العمومي',
    sous_chef: 'سو شيف',
    cashier: 'كاشير',
    employee: 'موظف',
};

export type RolePresentation = { label: string; known: boolean };

export function roleLabel(role: string): RolePresentation {
    if (!role) {
        return { label: 'بلا دور', known: true };
    }
    return Object.hasOwn(ROLE_LABELS, role) ? { label: ROLE_LABELS[role] ?? role, known: true } : { label: role, known: false };
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type UserRow = {
    id: string;
    username: string;
    name: string;
    role: string;
    roleLabel: string;
    roleKnown: boolean;
    deptCode: string;
    active: boolean;
    statusLabel: string;
    employeeName: string;
    employeeCode: string;
    linked: boolean;
    lastLogin: string;
};

/** `portal-repo.js:161-171` حرفيًا لاسم المستخدم والاسم والدور والحالة. */
export function userToRow(user: User, employeeByUserId: ReadonlyMap<string, Employee> = new Map()): UserRow {
    const username = user.username ? String(user.username) : '';
    const role = user.role ? String(user.role) : '';
    const presentation = roleLabel(role);
    const employee = employeeByUserId.get(user.id);
    const lastLogin = user.last_login_at ? String(user.last_login_at).slice(0, 10) : '';
    return {
        id: user.id,
        username,
        name: user.name ? String(user.name) : username || `#${user.id}`,
        role,
        roleLabel: presentation.label,
        roleKnown: presentation.known,
        deptCode: user.dept_code ? String(user.dept_code) : '',
        active: user.active,
        statusLabel: user.active ? 'نشط' : 'موقوف',
        employeeName: employee ? (employee.name ? String(employee.name) : `#${employee.id}`) : '',
        employeeCode: employee?.employeeId ? String(employee.employeeId) : '',
        linked: Boolean(employee),
        lastLogin,
    };
}

/** فهرس الموظفين بمفتاح `userId` — الحقل الوحيد الذي يربط الحساب بالسجل. */
export function employeeByUserMap(employees: readonly Employee[]): Map<string, Employee> {
    const map = new Map<string, Employee>();
    for (const employee of employees) {
        if (employee.userId) {
            map.set(employee.userId, employee);
        }
    }
    return map;
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

function tokenScore(token: string, row: UserRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (raw && row.username.toLowerCase() === raw) {
        return { score: 3, folded: false };
    }
    if (raw && row.name.toLowerCase().includes(raw)) {
        return { score: 2, folded: false };
    }
    if (key && arSearchKey(row.name).includes(key)) {
        return { score: 2, folded: true };
    }
    for (const field of [row.username, row.roleLabel, row.deptCode, row.employeeName, row.employeeCode]) {
        if (raw && field.toLowerCase().includes(raw)) {
            return { score: 1, folded: false };
        }
        if (key && arSearchKey(field).includes(key)) {
            return { score: 1, folded: true };
        }
    }
    return { score: 0, folded: false };
}

export type UserSearch = {
    rows: UserRow[];
    matched: boolean;
    exact: number;
    folded: boolean;
    hits: number;
};

/** بحثٌ كل كلمة فيه لازم تلاقي موضعًا (AND)، ودرجة السطر أدنى درجات كلماته. */
export function searchUsers(rows: readonly UserRow[], query: string): UserSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, exact: 0, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored: { row: UserRow; score: number; folded: boolean }[] = [];
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

export type RoleCount = { value: string; label: string; known: boolean; count: number };

export function roleCounts(rows: readonly UserRow[]): RoleCount[] {
    const byRole = new Map<string, RoleCount>();
    for (const row of rows) {
        const hit = byRole.get(row.role);
        if (hit) {
            hit.count += 1;
        } else {
            byRole.set(row.role, {
                value: row.role,
                label: row.roleLabel,
                known: row.roleKnown,
                count: 1,
            });
        }
    }
    return [...byRole.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar'));
}

export type UserTotals = {
    total: number;
    active: number;
    inactive: number;
    linked: number;
    unlinked: number;
    roles: number;
    headWithoutDept: number;
    neverLoggedIn: number;
};

export function userTotals(rows: readonly UserRow[]): UserTotals {
    const linked = rows.filter((row) => row.linked).length;
    return {
        total: rows.length,
        active: rows.filter((row) => row.active).length,
        inactive: rows.filter((row) => !row.active).length,
        linked,
        unlinked: rows.length - linked,
        roles: roleCounts(rows).length,
        headWithoutDept: rows.filter((row) => row.role === 'dept_head' && !row.deptCode).length,
        neverLoggedIn: rows.filter((row) => !row.lastLogin).length,
    };
}
