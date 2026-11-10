import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { arSearchKey } from './employees';

/**
 * فروع المنشأة — قراءة فقط من `/api/branches` (backend/branch-routes.js).
 *
 * القراءة متاحة لأي حساب مصادق، و`?all=1` يُظهر المعطّل للأدمن وحده؛
 * غير الأدمن يستلم القائمة النشطة بلا خطأ — الخادم هو الحاكم. الصفّ
 * يحمل بيانات الفرع الظاهرة في القديم: الكود والاسمين والعملة والمنطقة
 * والهاتف والعنوان. الإنشاء والتعديل والإيقاف والتفعيل تبقى في V2.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const optionalText = z.string().nullable().optional();
const activeValue = z
    .union([z.boolean(), z.string(), z.number()])
    .nullable()
    .optional()
    .transform((value) => !(value === false || value === 'false' || value === 0));

export const branchSchema = z
    .object({
        id: idValue,
        code: optionalText,
        name_ar: optionalText,
        name_en: optionalText,
        currency: optionalText,
        timezone: optionalText,
        phone: optionalText,
        address: optionalText,
        is_active: activeValue,
    })
    .passthrough();

export type Branch = z.infer<typeof branchSchema>;

const branchPageSchema = z
    .union([z.array(branchSchema), z.object({ data: z.array(branchSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export async function fetchBranches(signal?: AbortSignal): Promise<Branch[]> {
    return fetchJson(branchPageSchema, '/api/branches?all=1', getAccessToken(), signal ? { signal } : {});
}

const branchWriteResponse = z.object({ ok: z.boolean().optional(), data: branchSchema.optional() }).passthrough();
const branchCodePattern = /^[A-Za-z0-9_-]{1,20}$/;
const currencyPattern = /^[A-Za-z]{3}$/;
const clean = (value: unknown) => String(value ?? '').trim();
const nullableText = (value: unknown) => clean(value) || null;

export type BranchForm = Pick<Branch, 'code' | 'name_ar' | 'name_en' | 'currency' | 'timezone' | 'phone' | 'address'>;
export type BranchFormError = { field: string; message: string };

export function validateBranchForm(form: Partial<BranchForm>, editing = false): BranchFormError[] {
    const errors: BranchFormError[] = [];
    if (!editing && !branchCodePattern.test(clean(form.code))) {
        errors.push({ field: 'code', message: 'كود الفرع: من 1 إلى 20 حرفًا لاتينيًا أو رقمًا أو _ أو -' });
    }
    if (!clean(form.name_ar)) errors.push({ field: 'name_ar', message: 'اسم الفرع بالعربية مطلوب' });
    const currency = (clean(form.currency) || 'SAR').toUpperCase();
    if (!currencyPattern.test(currency)) errors.push({ field: 'currency', message: 'العملة رمز ISO من 3 حروف (SAR / EGP / AED)' });
    return errors;
}

export function normalizeBranchPayload(form: Partial<BranchForm>): Record<string, unknown> {
    return {
        code: clean(form.code), name_ar: clean(form.name_ar), name_en: nullableText(form.name_en),
        currency: (clean(form.currency) || 'SAR').toUpperCase(), timezone: clean(form.timezone) || 'Asia/Riyadh',
        phone: nullableText(form.phone), address: nullableText(form.address),
    };
}

export async function createBranch(form: Partial<BranchForm>): Promise<void> {
    await fetchJson(branchWriteResponse, '/api/branches', getAccessToken(), { method: 'POST', body: normalizeBranchPayload(form) });
}

export async function updateBranch(id: string, form: Partial<BranchForm>): Promise<void> {
    const payload = normalizeBranchPayload(form);
    delete payload.code;
    await fetchJson(branchWriteResponse, `/api/branches/${encodeURIComponent(id)}`, getAccessToken(), { method: 'PATCH' as 'PUT', body: payload });
}

export async function deactivateBranch(id: string): Promise<void> {
    await fetchJson(branchWriteResponse, `/api/branches/${encodeURIComponent(id)}`, getAccessToken(), { method: 'DELETE' });
}

export async function reactivateBranch(id: string): Promise<void> {
    await fetchJson(branchWriteResponse, `/api/branches/${encodeURIComponent(id)}`, getAccessToken(), { method: 'PATCH' as 'PUT', body: { is_active: true } });
}

/* ─── الصفّ ─────────────────────────────────────────────────────────────── */

export type BranchRow = {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    currency: string;
    timezone: string;
    phone: string;
    address: string;
    active: boolean;
    statusLabel: string;
};

/** `branches-repo.js:90-106` حرفيًا، مع تسمية `status.js` للفرع. */
export function branchToRow(branch: Branch): BranchRow {
    return {
        id: branch.id,
        code: branch.code ? String(branch.code) : '',
        nameAr: branch.name_ar ? String(branch.name_ar) : '',
        nameEn: branch.name_en ? String(branch.name_en) : '',
        currency: branch.currency ? String(branch.currency) : '',
        timezone: branch.timezone ? String(branch.timezone) : '',
        phone: branch.phone ? String(branch.phone) : '',
        address: branch.address ? String(branch.address) : '',
        active: branch.is_active,
        statusLabel: branch.is_active ? 'مفعّل' : 'موقوف',
    };
}

/* ─── البحث ────────────────────────────────────────────────────────────── */

function tokenScore(token: string, row: BranchRow): { score: number; folded: boolean } {
    const raw = token.toLowerCase();
    const key = arSearchKey(token);
    if (raw && row.code.toLowerCase() === raw) {
        return { score: 3, folded: false };
    }
    if (raw && (row.nameAr.toLowerCase().includes(raw) || row.nameEn.toLowerCase().includes(raw))) {
        return { score: 2, folded: false };
    }
    if (key && arSearchKey(row.nameAr).includes(key)) {
        return { score: 2, folded: true };
    }
    for (const field of [row.code, row.currency, row.timezone, row.phone, row.address]) {
        if (raw && field.toLowerCase().includes(raw)) {
            return { score: 1, folded: false };
        }
        if (key && arSearchKey(field).includes(key)) {
            return { score: 1, folded: true };
        }
    }
    return { score: 0, folded: false };
}

export type BranchSearch = {
    rows: BranchRow[];
    matched: boolean;
    exact: number;
    folded: boolean;
    hits: number;
};

export function searchBranches(rows: readonly BranchRow[], query: string): BranchSearch {
    const raw = String(query ?? '').trim();
    if (!raw) {
        return { rows: [...rows], matched: false, exact: 0, folded: false, hits: rows.length };
    }
    const tokens = raw.split(/\s+/).filter(Boolean);
    const scored: { row: BranchRow; score: number; folded: boolean }[] = [];
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

export type BranchTotals = {
    total: number;
    active: number;
    inactive: number;
    currencies: string[];
};

export function branchTotals(rows: readonly BranchRow[]): BranchTotals {
    const currencies = [...new Set(rows.map((row) => row.currency).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, 'en'),
    );
    return {
        total: rows.length,
        active: rows.filter((row) => row.active).length,
        inactive: rows.filter((row) => !row.active).length,
        currencies,
    };
}
