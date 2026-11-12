import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { parseAmountCents } from './cfo-write';
import { writeAck, writeJson } from './write';

/**
 * بقية أبواب CFO في V2 — بنك، أصول وإهلاك، ترحيل رواتب، موازنات، عهد، تنبيهات.
 *
 *   GET/POST /api/accounting/bank-statements          كشف بنكي (accounting-growth.js:144)
 *   GET      /api/accounting/bank-rec?account&from&to مطابقة (accounting-growth.js:167)
 *   POST     /api/accounting/bank-rec/auto-match       مطابقة تلقائية (:198)
 *   GET/POST /api/accounting/fixed-assets              أصول (:298/:311)
 *   POST     /api/accounting/fixed-assets/:id/dispose استبعاد (:332)
 *   POST     /api/accounting/depreciation/run          إهلاك شهري (:352)
 *   POST     /api/accounting/post-payroll              ترحيل رواتب (accounting-routes.js:884)
 *   GET/POST /api/accounting/budgets + DELETE/:id      موازنات (budget-alerts.js:37/49/70)
 *   GET      /api/accounting/cash-custody              عهد (:240)
 *   POST     /api/accounting/cash-custody/:id/ack      إقرار استلام (:280)
 *   POST     /api/accounting/alerts/run                تشغيل التنبيهات (budget-alerts.js:261)
 *
 * كل تحقق هنا استباقي فقط؛ الخادم يبقى الحكم (فترة مقفلة، تكرار قيد، صلاحية).
 */

const text = z.string().nullable().optional();
const numLike = z.union([z.string(), z.number()]).nullable().optional();
const flag = z.boolean().nullable().optional();
const idValue = z.union([z.string(), z.number()]).transform((value) => String(value));

export const bankRecSchema = z
    .object({
        ok: flag,
        account: text,
        from: text,
        to: text,
        book: numLike,
        statement: numLike,
        diff: numLike,
        unmatched: z
            .array(
                z
                    .object({
                        id: idValue,
                        stmt_date: text,
                        description: text,
                        amount: numLike,
                        matched: flag,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export type BankRec = z.infer<typeof bankRecSchema>;

export const assetSchema = z
    .object({
        id: idValue,
        name: text,
        category: text,
        purchase_date: text,
        cost: numLike,
        salvage: numLike,
        life_months: numLike,
        accumulated: numLike,
        last_month: text,
        status: text,
        monthly: numLike,
        remaining: numLike,
    })
    .passthrough();

export type FixedAsset = z.infer<typeof assetSchema>;

export const assetsSchema = z.object({ ok: flag, assets: z.array(assetSchema) }).passthrough();

export const budgetSchema = z
    .object({
        id: idValue,
        period: text,
        account_code: text,
        cost_center_code: text,
        label: text,
        amount: numLike,
        note: text,
        account_name: text,
    })
    .passthrough();

export type BudgetLine = z.infer<typeof budgetSchema>;
export const budgetsSchema = z.object({ ok: flag, period: text, budgets: z.array(budgetSchema) }).passthrough();

export const custodySchema = z
    .object({
        ok: flag,
        date: text,
        myPending: numLike,
        rows: z
            .array(
                z
                    .object({
                        id: idValue,
                        from_cashier: numLike,
                        to_cashier: numLike,
                        amount: numLike,
                        ack_at: text,
                        custody_date: text,
                        from_name: text,
                        to_name: text,
                        note: text,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

export type Custody = z.infer<typeof custodySchema>;

const ackSchema = z.object({ ok: flag, inserted: numLike, matched: numLike, scanned: numLike }).passthrough();

export const depreciationSchema = z.object({ ok: flag, month: text, posted: numLike, total: numLike }).passthrough();

export const payrollPostSchema = z.object({ total: numLike, count: numLike, entry: z.object({}).passthrough().optional() }).passthrough();

export const alertsRunSchema = z.object({ ok: flag, sent: z.array(z.string()).optional() }).passthrough();

/** تاريخ منطقي بصيغة `YYYY-MM-DD` — لا يعتمد على تحليل المتصفح الغامض. */
export function isValidDate(value: string): boolean {
    const raw = String(value ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return false;
    }
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(5, 7));
    const day = Number(raw.slice(8, 10));
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidMonth(value: string): boolean {
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value ?? '').trim());
}

/** مبلغ موقّع (كشف البنك قد يحمل حركة سالبة) — سنتات صحيحة. */
export function parseSignedCents(value: unknown): number | null {
    const raw = String(value ?? '')
        .trim()
        .replace(/,/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
        return null;
    }
    const negative = raw.startsWith('-');
    const cents = parseAmountCents(negative ? raw.slice(1) : raw);
    if (cents === null) {
        return null;
    }
    return negative ? -cents : cents;
}

export interface StatementPayload {
    account_code?: string;
    stmt_date: string;
    description: string;
    amount: number;
}

export type Validation<T> = { ok: true; payload: T } | { ok: false; error: string };

export function validateStatement(date: string, description: string, amount: string, account: string): Validation<StatementPayload> {
    if (!isValidDate(date)) {
        return { ok: false, error: 'تاريخ الكشف غير صالح' };
    }
    const cents = parseSignedCents(amount);
    if (cents === null || cents === 0) {
        return { ok: false, error: 'مبلغ الكشف مطلوب وغير صفري' };
    }
    const desc = String(description ?? '').trim();
    if (!desc) {
        return { ok: false, error: 'وصف الحركة مطلوب لمطابقة الكشف' };
    }
    const payload: StatementPayload = {
        stmt_date: String(date).trim(),
        description: desc.slice(0, 255),
        amount: cents / 100,
    };
    const code = String(account ?? '').trim();
    if (code) {
        payload.account_code = code.slice(0, 20);
    }
    return { ok: true, payload };
}

export interface AssetPayload {
    name: string;
    cost: number;
    life_months: number;
    category?: string;
    purchase_date?: string;
    salvage?: number;
}

export function validateAsset(name: string, cost: string, life: string, salvage: string): Validation<AssetPayload> {
    const cleanName = String(name ?? '').trim();
    if (!cleanName) {
        return { ok: false, error: 'اسم الأصل مطلوب' };
    }
    const costCents = parseAmountCents(cost);
    if (costCents === null || costCents <= 0) {
        return { ok: false, error: 'تكلفة الأصل يجب أن تكون أكبر من صفر' };
    }
    const lifeMonths = Number(String(life ?? '').trim());
    if (!Number.isInteger(lifeMonths) || lifeMonths <= 0) {
        return { ok: false, error: 'العمر بالشهور عدد صحيح أكبر من صفر' };
    }
    const salvageCents = parseAmountCents(salvage || '0');
    if (salvageCents === null || salvageCents < 0) {
        return { ok: false, error: 'القيمة التخريدية غير صالحة' };
    }
    if (salvageCents >= costCents) {
        return { ok: false, error: 'القيمة التخريدية يجب أن تكون أقل من التكلفة' };
    }
    return {
        ok: true,
        payload: {
            name: cleanName.slice(0, 255),
            cost: costCents / 100,
            life_months: lifeMonths,
            salvage: salvageCents / 100,
        },
    };
}

export interface BudgetPayload {
    period: string;
    amount: number;
    label?: string;
    account_code?: string;
}

export function validateBudget(period: string, label: string, account: string, amount: string): Validation<BudgetPayload> {
    const cleanPeriod = String(period ?? '').trim();
    if (!isValidMonth(cleanPeriod)) {
        return { ok: false, error: 'شهر الموازنة بصيغة YYYY-MM' };
    }
    const cents = parseAmountCents(amount);
    if (cents === null || cents < 0) {
        return { ok: false, error: 'مبلغ الموازنة مطلوب وغير سالب' };
    }
    const cleanLabel = String(label ?? '').trim();
    const cleanAccount = String(account ?? '').trim();
    if (!cleanLabel && !cleanAccount) {
        return { ok: false, error: 'أدخل بيانًا أو حسابًا للموازنة' };
    }
    const payload: BudgetPayload = { period: cleanPeriod, amount: cents / 100 };
    if (cleanLabel) {
        payload.label = cleanLabel.slice(0, 150);
    }
    if (cleanAccount) {
        payload.account_code = cleanAccount;
    }
    return { ok: true, payload };
}

function token(): string | null {
    return getAccessToken();
}

export async function fetchBankRec(account: string, from: string, to: string, signal?: AbortSignal): Promise<BankRec> {
    const query = `account=${encodeURIComponent(account)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return fetchJson(bankRecSchema, `/api/accounting/bank-rec?${query}`, token(), signal ? { signal } : {});
}

export async function addBankStatement(row: StatementPayload): Promise<number> {
    const body = await writeJson(ackSchema, '/api/accounting/bank-statements', 'POST', { rows: [row] });
    return Number(body.inserted ?? 0);
}

export async function autoMatchBank(account: string): Promise<{ matched: number; scanned: number }> {
    const body = await writeJson(ackSchema, '/api/accounting/bank-rec/auto-match', 'POST', { account });
    return { matched: Number(body.matched ?? 0), scanned: Number(body.scanned ?? 0) };
}

export async function fetchAssets(signal?: AbortSignal): Promise<FixedAsset[]> {
    const body = await fetchJson(assetsSchema, '/api/accounting/fixed-assets', token(), signal ? { signal } : {});
    return body.assets;
}

export async function createAsset(payload: AssetPayload, purchaseDate: string): Promise<void> {
    const body = purchaseDate ? { ...payload, purchase_date: purchaseDate } : payload;
    await writeJson(ackSchema, '/api/accounting/fixed-assets', 'POST', body);
}

export async function disposeAsset(id: string): Promise<void> {
    await writeJson(ackSchema, `/api/accounting/fixed-assets/${encodeURIComponent(id)}/dispose`, 'POST', {});
}

export async function runDepreciation(month: string): Promise<{ posted: number; total: number }> {
    const body = await writeJson(depreciationSchema, '/api/accounting/depreciation/run', 'POST', { month });
    return { posted: Number(body.posted ?? 0), total: Number(body.total ?? 0) };
}

export async function postPayroll(month: string): Promise<{ count: number; total: number }> {
    const body = await writeJson(payrollPostSchema, '/api/accounting/post-payroll', 'POST', { month });
    return { count: Number(body.count ?? 0), total: Number(body.total ?? 0) };
}

export async function fetchBudgets(period: string, signal?: AbortSignal): Promise<BudgetLine[]> {
    const body = await fetchJson(
        budgetsSchema,
        `/api/accounting/budgets?period=${encodeURIComponent(period)}`,
        token(),
        signal ? { signal } : {},
    );
    return body.budgets;
}

export async function createBudget(payload: BudgetPayload): Promise<void> {
    await writeJson(ackSchema, '/api/accounting/budgets', 'POST', payload);
}

export async function deleteBudget(id: string): Promise<void> {
    await writeAck(`/api/accounting/budgets/${encodeURIComponent(id)}`, 'DELETE');
}

export async function fetchCustody(date: string, signal?: AbortSignal): Promise<Custody> {
    return fetchJson(custodySchema, `/api/accounting/cash-custody?date=${encodeURIComponent(date)}`, token(), signal ? { signal } : {});
}

export async function ackCustody(id: string): Promise<void> {
    await writeJson(ackSchema, `/api/accounting/cash-custody/${encodeURIComponent(id)}/ack`, 'POST', {});
}

export async function runAlerts(): Promise<string[]> {
    const body = await writeJson(alertsRunSchema, '/api/accounting/alerts/run', 'POST', {});
    return body.sent ?? [];
}

export const CFO_OPS_TEXT = {
    title: 'مركز العمليات المالية',
    hint: 'البنك والأصول والرواتب والموازنات والعهد والتنبيهات — تنفيذ مباشر على دفتر الأستاذ.',
    bank: 'البنك',
    assets: 'الأصول',
    payroll: 'الرواتب',
    budgets: 'الموازنات',
    custody: 'العهد',
    alerts: 'التنبيهات',
    close: 'إغلاق',
    account: 'الحساب البنكي',
    from: 'من',
    to: 'إلى',
    book: 'رصيد الدفتر',
    statement: 'رصيد الكشف',
    diff: 'الفرق',
    unmatched: 'حركات كشف غير مطابقة',
    addStatement: 'إضافة حركة كشف',
    statementDate: 'تاريخ الحركة',
    statementDesc: 'وصف الحركة',
    statementAmount: 'المبلغ (سالب للمسح)',
    autoMatch: 'مطابقة تلقائية',
    matched: (n: number) => `طابقت ${n} حركة`,
    statementAdded: 'أُضيفت حركة الكشف',
    assetName: 'اسم الأصل',
    assetCost: 'التكلفة',
    assetLife: 'العمر بالشهور',
    assetSalvage: 'القيمة التخريدية',
    purchaseDate: 'تاريخ الشراء (اختياري)',
    addAsset: 'إضافة أصل',
    assetAdded: 'أُضيف الأصل',
    dispose: 'استبعاد',
    disposeConfirm: (name: string) => `استبعاد الأصل «${name}»؟ لا يمكن التراجع.`,
    disposed: 'استُبعد الأصل',
    depreciationMonth: 'شهر الإهلاك',
    runDepreciation: 'تشغيل الإهلاك',
    depreciationConfirm: (month: string) => `تشغيل إهلاك ${month} على كل الأصول النشطة؟`,
    depreciationDone: (posted: number, total: number) => `إهلاك ${posted} أصل بإجمالي ${total.toFixed(2)}`,
    payrollMonth: 'شهر الرواتب',
    postPayroll: 'ترحيل الرواتب',
    payrollConfirm: (month: string) => `ترحيل رواتب ${month} إلى الأستاذ؟`,
    payrollDone: (count: number, total: number) => `رُحّل ${count} موظفًا بإجمالي ${total.toFixed(2)}`,
    budgetPeriod: 'شهر الموازنة',
    budgetLabel: 'البيان',
    budgetAccount: 'الحساب (اختياري)',
    budgetAmount: 'المبلغ',
    addBudget: 'إضافة موازنة',
    budgetAdded: 'أُضيفت الموازنة',
    deleteBudget: 'حذف',
    deleteBudgetConfirm: (label: string) => `حذف موازنة «${label}»؟`,
    budgetDeleted: 'حُذفت الموازنة',
    custodyDate: 'تاريخ العهدة',
    custodyPending: 'عهد معلقة لك',
    ack: 'إقرار الاستلام',
    acked: 'أُقرّ استلام العهدة',
    noCustody: 'لا عهد في هذا اليوم.',
    runAlerts: 'تشغيل التنبيهات',
    alertsDone: (n: number) => `أُرسل ${n} تنبيهًا`,
    loadFailed: 'تعذر تحميل البيانات',
    failed: 'تعذر تنفيذ العملية',
} as const;
