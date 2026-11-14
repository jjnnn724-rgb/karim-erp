import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * وضع القسم — تحليل الصرف من المخزن + تحليل الافطار
 * ═══════════════════════════════════════════════════════
 * «كوست الأصناف المسحوبة من المخزن لكل قسم في فترة» + «تحليل كوست
 * الافطار مقابل إيراداته» — كل الأرقام من /api/pos/reports/*.
 * الطلب المصدر الوحيد للحقيقة — لا حساب محلي.
 */

const numLike = z.union([z.string(), z.number()]);
const num = numLike.nullable().optional().transform((v) => Number(v ?? 0));
const text = z.string().nullable().optional();

/* ─── قائمة الأقسام من أذونات الصرف ─── */
export const issueDepartmentsSchema = z
    .object({
        departments: z.array(z.object({
            dept: text,
            code: text,
            requests: num,
            received: num,
        }).passthrough()),
    })
    .passthrough();

export type IssueDepartment = z.infer<typeof issueDepartmentsSchema>['departments'][number];

/** جلب الأقسام التي عليها أذونات صرف في الفترة. */
export async function fetchIssueDepartments(signal?: AbortSignal): Promise<IssueDepartment[]> {
    const token = getAccessToken();
    const data = await fetchJson(issueDepartmentsSchema, '/api/pos/reports/issue-departments', token, signal ? { signal } : {});
    return data.departments;
}

/* ─── وضع القسم: الحركات الفعلية ─── */
const issueItemSchema = z
    .object({
        item_id: text,
        name: text,
        unit: text,
        category: text,
        qty: num,
        grams: num.nullable(),
        cost: num,
        moves: num,
        dispatches: num,
        share: num,
    })
    .passthrough();

export const departmentIssuesSchema = z
    .object({
        department: text,
        from: text,
        to: text,
        totals: z.object({
            items: num,
            moves: num,
            dispatches: num,
            cost: num,
            grams: num,
            weight_items: num,
            packed_items: num,
        }).passthrough(),
        items: z.array(issueItemSchema),
        veg: z.object({
            requests: num,
            items_count: num,
            qty_kg: num,
        }).passthrough().nullable().optional(),
    })
    .passthrough();

export type DepartmentIssues = z.infer<typeof departmentIssuesSchema>;
export type IssueItem = z.infer<typeof issueItemSchema>;

/** حركات الصرف الفعلية لقسم ما في فترة — مرتبة من الأعلى تكلفة. */
export async function fetchDepartmentIssues(
    dept: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
): Promise<DepartmentIssues> {
    const qs = new URLSearchParams({ dept, from: range.from, to: range.to });
    const token = getAccessToken();
    return fetchJson(departmentIssuesSchema, `/api/pos/reports/department-issues?${qs}`, token, signal ? { signal } : {});
}

/* ─── تحليل الافطار ─── */
const basketItemSchema = z
    .object({
        item_id: text,
        name: text,
        unit: text,
        qty: num,
        grams: num.nullable(),
        cost: num,
        moves: num,
    })
    .passthrough();

const basketGroupSchema = z
    .object({
        group: text,
        items: z.array(basketItemSchema),
        cost: num,
        kg: num,
        share: num,
    })
    .passthrough();

export const breakfastCostSchema = z
    .object({
        from: text,
        to: text,
        previous: z.object({ from: text, to: text }).passthrough(),
        revenue: num,
        revenue_entries: num,
        revenue_ys: num,
        previous_revenue: num,
        revenue_delta_pct: num,
        total_cost: num,
        cost_pct: num,
        verdict: z.object({ tone: text, text: text }).passthrough(),
        groups: z.array(basketGroupSchema),
        top_items: z.array(z.object({
            item_id: text,
            name: text,
            unit: text,
            qty: num,
            grams: num.nullable(),
            cost: num,
        }).passthrough()),
        veg: z.object({
            requests: num,
            items_count: num,
            qty_kg: num,
        }).passthrough(),
        notes: z.array(z.string()),
    })
    .passthrough();

export type BreakfastCost = z.infer<typeof breakfastCostSchema>;

/** تحليل كوست الافطار: مكوّناته من أذونات المطبخ ÷ إيرادات كاشير 3. */
/* ─── بحث أصناف المخزن ─── */
export const searchItemsSchema = z
    .object({
        items: z.array(z.object({
            id: text,
            name: text,
            unit: text,
            category: text,
            qty: num,
            avg_cost: num,
            barcode: text,
        }).passthrough()),
    })
    .passthrough();

export type InventorySearchItem = z.infer<typeof searchItemsSchema>['items'][number];

/** بحث الأصناف بالاسم/الكود/الباركود — للإضافة اليدوية إلى التحليل. */
export async function fetchSearchItems(query: string, signal?: AbortSignal): Promise<InventorySearchItem[]> {
    const qs = new URLSearchParams({ q: query });
    const token = getAccessToken();
    const data = await fetchJson(searchItemsSchema, `/api/pos/reports/search-items?${qs}`, token, signal ? { signal } : {});
    return data.items;
}

export async function fetchBreakfastCost(
    range: { from: string; to: string },
    signal?: AbortSignal,
    extraIds?: readonly number[],
): Promise<BreakfastCost> {
    const qs = new URLSearchParams({ from: range.from, to: range.to });
    if (extraIds && extraIds.length) { qs.set('extra_ids', extraIds.join(',')); }
    const token = getAccessToken();
    return fetchJson(breakfastCostSchema, `/api/pos/reports/breakfast-cost?${qs}`, token, signal ? { signal } : {});
}
