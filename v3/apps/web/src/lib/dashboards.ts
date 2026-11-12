import { z } from 'zod';
import { ApiError, fetchJson } from './api';
import { getAccessToken } from './auth';
import { dispatchSchema } from './dispatches';
import { fetchPnl, type PnlResponse } from './pnl';

/**
 * لوحات الأدوار الثلاث — كل لوحة تقرأ الأبواب نفسها التي تقرأها V2
 * (`dashboard-repo.js`)، ولا باب جديد ولا حساب في الواجهة:
 *
 *   المحاسب    /finance/pnl (بيان الخادم) + أحدث إيراد ومصروف + العملة
 *   المخزن     /inventory (أرصدة) + /dispatches + /warehouse/purchase-requests
 *   رئيس القسم /warehouse/dept-panel + /dispatches
 *
 * كل مصدرٍ فاشل يُسمّى في `failures` وتُعرض البقية — لا صفرٌ يبدو بيانات.
 */

const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));
const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();

const registerRowSchema = z
    .object({
        id: idValue,
        amount: numLike,
        date: text,
        source: text,
        desc: text,
        category: text,
    })
    .passthrough();

const registerPageSchema = z.object({ data: z.array(registerRowSchema) }).passthrough();

const currencySchema = z
    .union([
        z.object({ currency: z.string().nullable().optional() }).passthrough(),
        z.array(z.object({ currency: z.string().nullable().optional() }).passthrough()),
    ])
    .transform((body) => {
        const row = Array.isArray(body) ? body[0] : body;
        return row?.currency ? String(row.currency) : '';
    });

async function fetchLatest(entity: 'revenues' | 'expenses', signal?: AbortSignal) {
    const body = await fetchJson(
        registerPageSchema,
        `/api/${entity}?page=1&limit=6&sort=id&order=desc`,
        getAccessToken(),
        signal ? { signal } : {},
    );
    return body.data;
}

async function fetchCurrency(signal?: AbortSignal): Promise<string> {
    return fetchJson(currencySchema, '/api/settings/main_settings', getAccessToken(), signal ? { signal } : {});
}

function failureName(result: PromiseSettledResult<unknown>, name: string): string | null {
    if (result.status !== 'rejected') {
        return null;
    }
    // 401/403 = الدور لا يملك المصدر أصلًا (مصادر اللوحة مشتركة بين الأدوار)
    // — لا نلوّث اللوحة برسالة رفض متوقّعة؛ المصادر المرخّصة وحدها تُقرأ.
    if (result.reason instanceof ApiError && result.reason.isAuthProblem) {
        return null;
    }
    const reason = result.reason instanceof Error ? result.reason.message : 'لم يستجب';
    return `${name}: ${reason}`;
}

/* ── المحاسب ─────────────────────────────────────────────────────────────── */

export interface AccountantView {
    pnl: PnlResponse | null;
    latestRevenues: z.infer<typeof registerRowSchema>[];
    latestExpenses: z.infer<typeof registerRowSchema>[];
    currency: string;
    failures: string[];
}

export async function fetchAccountantSnapshot(signal?: AbortSignal): Promise<AccountantView> {
    const settled = await Promise.allSettled([
        fetchPnl('', '', signal),
        fetchLatest('revenues', signal),
        fetchLatest('expenses', signal),
        fetchCurrency(signal),
    ]);
    const [pnl, revenues, expenses, currency] = settled;
    return {
        pnl: pnl?.status === 'fulfilled' ? pnl.value : null,
        latestRevenues: revenues?.status === 'fulfilled' ? revenues.value : [],
        latestExpenses: expenses?.status === 'fulfilled' ? expenses.value : [],
        currency: currency?.status === 'fulfilled' ? currency.value : '',
        failures: [
            failureName(settled[0] ?? { status: 'rejected', reason: 'لم يستجب' }, 'قائمة الدخل'),
            failureName(settled[1] ?? { status: 'rejected', reason: 'لم يستجب' }, 'الإيرادات'),
            failureName(settled[2] ?? { status: 'rejected', reason: 'لم يستجب' }, 'المصروفات'),
            failureName(settled[3] ?? { status: 'rejected', reason: 'لم يستجب' }, 'العملة'),
        ].filter((value): value is string => Boolean(value)),
    };
}

/* ── المخزن ──────────────────────────────────────────────────────────────── */

const inventoryItemSchema = z
    .object({
        id: idValue,
        name: text,
        qty: numLike,
        minQty: numLike,
        unit: text,
    })
    .passthrough();

const inventoryPageSchema = z.object({ data: z.array(inventoryItemSchema) }).passthrough();
const dispatchPageSchema = z.object({ data: z.array(dispatchSchema) }).passthrough();

const purchaseRequestSchema = z
    .object({
        id: idValue,
        status: text,
        date: text,
    })
    .passthrough();
const purchaseRequestListSchema = z
    .union([z.array(purchaseRequestSchema), z.object({ data: z.array(purchaseRequestSchema) }).passthrough()])
    .transform((body) => (Array.isArray(body) ? body : body.data));

export interface WarehouseView {
    total: number;
    low: number;
    out: number;
    ok: number;
    lowRows: { id: string; name: string; qty: number; minQty: number; unit: string; state: string }[];
    queues: { chef: number; warehouse: number; purchase: number; dispatches: number; purchases: number };
    failures: string[];
}

function numOf(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

const PURCHASE_REQUEST_READ_ROLES = ['admin', 'manager', 'warehouse', 'kitchen', 'sous_chef', 'accountant'];

export async function fetchWarehouseSnapshot(signal?: AbortSignal, role = ''): Promise<WarehouseView> {
    const canReadRequests = role === '' || PURCHASE_REQUEST_READ_ROLES.includes(role);
    const settled = await Promise.allSettled([
        fetchJson(inventoryPageSchema, '/api/inventory?page=1&limit=1000&sort=id&order=asc', getAccessToken(), signal ? { signal } : {}),
        fetchJson(
            dispatchPageSchema,
            '/api/dispatches?page=1&limit=500&sort=id&order=desc&v2_period=month',
            getAccessToken(),
            signal ? { signal } : {},
        ),
        canReadRequests
            ? fetchJson(purchaseRequestListSchema, '/api/warehouse/purchase-requests', getAccessToken(), signal ? { signal } : {})
            : Promise.resolve([]),
    ]);
    const items = settled[0]?.status === 'fulfilled' ? settled[0].value.data : [];
    const dispatches = settled[1]?.status === 'fulfilled' ? settled[1].value.data : [];
    const requests = settled[2]?.status === 'fulfilled' ? settled[2].value : [];

    const outRows = items.filter((item) => numOf(item.qty) <= 0);
    const lowRows = items.filter((item) => numOf(item.qty) > 0 && numOf(item.qty) <= numOf(item.minQty));
    const sorted = [...outRows, ...lowRows]
        .map((item) => ({
            id: item.id,
            name: String(item.name ?? '') || `#${item.id}`,
            qty: numOf(item.qty),
            minQty: numOf(item.minQty),
            unit: String(item.unit ?? ''),
            state: numOf(item.qty) <= 0 ? 'نافد' : 'تحت الحد',
        }))
        .sort((a, b) => a.qty - b.qty)
        .slice(0, 6);

    return {
        total: items.length,
        low: lowRows.length,
        out: outRows.length,
        ok: Math.max(0, items.length - lowRows.length - outRows.length),
        lowRows: sorted,
        queues: {
            chef: dispatches.filter((row) => String(row.status ?? '') === 'pending' && row.needsChefApproval === true).length,
            warehouse: dispatches.filter(
                (row) =>
                    String(row.status ?? '') === 'chef_approved' ||
                    (String(row.status ?? '') === 'pending' && row.needsChefApproval !== true),
            ).length,
            purchase: requests.filter((row) => ['pending', 'chef_approved'].includes(String(row.status ?? ''))).length,
            dispatches: dispatches.length,
            purchases: requests.length,
        },
        failures: [
            failureName(settled[0] ?? { status: 'rejected', reason: 'لم يستجب' }, 'المخزون'),
            failureName(settled[1] ?? { status: 'rejected', reason: 'لم يستجب' }, 'أذونات الصرف'),
            failureName(settled[2] ?? { status: 'rejected', reason: 'لم يستجب' }, 'طلبات الشراء'),
        ].filter((value): value is string => Boolean(value)),
    };
}

/* ── رئيس القسم ──────────────────────────────────────────────────────────── */

const panelSchema = z
    .object({
        scope: z.object({ deptCode: text, role: text }).passthrough().optional(),
        department: z.object({ code: text, name: text }).passthrough().nullable().optional(),
        subDepartments: z.array(z.object({ code: text, name: text }).passthrough()).optional(),
        expenses: z
            .object({
                total: numLike,
                count: numLike,
                bySource: z.record(z.string(), z.object({ total: numLike, count: numLike }).passthrough()).optional(),
                labels: z.record(z.string(), z.string()).optional(),
            })
            .passthrough()
            .optional(),
        dispatches: z
            .object({
                total: numLike,
                byStatus: z.record(z.string(), numLike).optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

export interface DeptHeadView {
    deptCode: string;
    deptName: string;
    expensesTotal: number;
    expensesCount: number;
    sources: { key: string; label: string; total: number; count: number }[];
    subDepartments: string[];
    dispatchTotal: number;
    dispatchStatuses: { key: string; count: number }[];
    failures: string[];
}

export async function fetchDeptHeadSnapshot(signal?: AbortSignal): Promise<DeptHeadView> {
    const settled = await Promise.allSettled([
        fetchJson(panelSchema, '/api/warehouse/dept-panel', getAccessToken(), signal ? { signal } : {}),
        fetchJson(
            dispatchPageSchema,
            '/api/dispatches?page=1&limit=500&sort=id&order=desc&v2_period=month',
            getAccessToken(),
            signal ? { signal } : {},
        ),
    ]);
    const panel = settled[0]?.status === 'fulfilled' ? settled[0].value : null;
    const dispatches = settled[1]?.status === 'fulfilled' ? settled[1].value.data : [];
    const deptCode = String(panel?.department?.code ?? panel?.scope?.deptCode ?? '');
    const mine = deptCode
        ? dispatches.filter((row) => String(row.deptCode ?? '') === deptCode)
        : dispatches.filter((row) => String(row.deptName ?? '') === String(panel?.department?.name ?? '\u0000'));
    const labels = panel?.expenses?.labels ?? {};
    const bySource = panel?.expenses?.bySource ?? {};
    const statusCounts = new Map<string, number>();
    for (const row of mine) {
        const key = String(row.status ?? '') || 'unknown';
        statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
    }
    return {
        deptCode,
        deptName: String(panel?.department?.name ?? ''),
        expensesTotal: numOf(panel?.expenses?.total),
        expensesCount: numOf(panel?.expenses?.count),
        sources: Object.entries(bySource)
            .map(([key, value]) => ({
                key,
                label: String(labels[key] ?? key),
                total: numOf(value.total),
                count: numOf(value.count),
            }))
            .sort((a, b) => b.total - a.total),
        subDepartments: (panel?.subDepartments ?? []).map((row) => String(row.name ?? row.code ?? '')).filter(Boolean),
        dispatchTotal: numOf(panel?.dispatches?.total) || mine.length,
        dispatchStatuses: [...statusCounts.entries()].map(([key, count]) => ({ key, count })),
        failures: [
            failureName(settled[0] ?? { status: 'rejected', reason: 'لم يستجب' }, 'لوحة القسم'),
            failureName(settled[1] ?? { status: 'rejected', reason: 'لم يستجب' }, 'أذونات الصرف'),
        ].filter((value): value is string => Boolean(value)),
    };
}
