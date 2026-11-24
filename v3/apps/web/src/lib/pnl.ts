import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * قائمة الأرباح والخسائر — `GET /api/finance/pnl` (admin|manager|accountant).
 *
 * العقد منسوخ من الخادم (`finance-routes.js`): `{period, previous_period,
 * statement, comparison, generated_at, generated_by}`. الخادم يبني البيان من
 * ستة جداول وفترتين، والواجهة تعرضه ولا تعيد حسابه — لا جمع ولا هامش هنا.
 *
 * التاريخان يُرسلان معًا أو لا يُرسلان: تاريخٌ وحده يرد 400 INVALID_PERIOD.
 */

const numLike = z.union([z.string(), z.number()]).nullable().optional();

const revenueSchema = z
    .object({
        pos_net: numLike,
        manual: numLike,
        total: numLike,
        pos_gross: numLike,
        vat_collected: numLike,
        pos_discounts: numLike,
        invoice_count: numLike,
        manual_count: numLike,
    })
    .passthrough();

const cogsSchema = z
    .object({
        dispatch: numLike,
        returns: numLike,
        net: numLike,
        count: numLike,
    })
    .passthrough();

const profitSchema = z
    .object({
        amount: numLike,
        margin_pct: numLike,
    })
    .passthrough();

const shrinkageSchema = z
    .object({
        amount: numLike,
        count: numLike,
        losses: numLike,
        gains: numLike,
    })
    .passthrough();

const operatingSchema = z
    .object({
        total: numLike,
        count: numLike,
        items: z
            .array(
                z
                    .object({
                        category: z.string().nullable().optional(),
                        amount: numLike,
                        count: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
    })
    .passthrough();

/** `months` عند الخادم قائمة مفاتيح `YYYY-MM` لا عددٌ — عرضها كرقم كان يطبع المصفوفة. */
const payrollSchema = z
    .object({
        total: numLike,
        count: numLike,
        months: z.array(z.string()).optional(),
    })
    .passthrough();

const subDepartmentSchema = z
    .object({
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        revenue: numLike,
        operating: numLike,
        net: numLike,
    })
    .passthrough();

const departmentSchema = z
    .object({
        code: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        revenue: numLike,
        manual: numLike,
        cogs: numLike,
        shrinkage: numLike,
        operating: numLike,
        net: numLike,
        margin_pct: numLike,
        /** صفٌّ رُحّل إلى أبيه — عرضه بجانب الأب يضاعف الرقم. */
        rolledUp: z.boolean().optional(),
        subDepartments: z.array(subDepartmentSchema).optional(),
    })
    .passthrough();

const dailySchema = z
    .object({
        date: z.string().nullable().optional(),
        revenue: numLike,
        cogs: numLike,
        opex: numLike,
    })
    .passthrough();

export const pnlStatementSchema = z
    .object({
        period: z
            .object({ from: z.string().nullable().optional(), to: z.string().nullable().optional() })
            .passthrough()
            .optional(),
        revenue: revenueSchema.optional(),
        cogs: cogsSchema.optional(),
        gross_profit: profitSchema.optional(),
        shrinkage: shrinkageSchema.optional(),
        operating: operatingSchema.optional(),
        internal_moves: z
            .object({
                amount: numLike,
                count: numLike,
            })
            .passthrough()
            .optional(),
        payroll: payrollSchema.optional(),
        net_profit: profitSchema.optional(),
        expense_row_count: numLike,
        by_department: z.array(departmentSchema).optional(),
        daily_series: z.array(dailySchema).optional(),
        checks: z.object({ balanced: z.boolean().nullable().optional() }).passthrough().optional(),
    })
    .passthrough();

export const pnlResponseSchema = z
    .object({
        period: z
            .object({ from: z.string().nullable().optional(), to: z.string().nullable().optional() })
            .passthrough()
            .optional(),
        previous_period: z
            .object({ from: z.string().nullable().optional(), to: z.string().nullable().optional() })
            .passthrough()
            .optional(),
        statement: pnlStatementSchema.optional(),
        comparison: z.record(z.string(), z.unknown()).optional(),
        generated_at: z.string().nullable().optional(),
        generated_by: z.string().nullable().optional(),
    })
    .passthrough();

export type PnlResponse = z.infer<typeof pnlResponseSchema>;
export type PnlStatement = z.infer<typeof pnlStatementSchema>;

/** التاريخان معًا أو لا شيء — نفس قاعدة الخادم، فلا طلب مرفوض أصلًا. */
export async function fetchPnl(from = '', to = '', signal?: AbortSignal): Promise<PnlResponse> {
    const params = new URLSearchParams();
    if (from && to) {
        params.set('from', from);
        params.set('to', to);
    }
    const query = params.toString();
    return fetchJson(
        pnlResponseSchema,
        `/api/finance/pnl${query ? `?${query}` : ''}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export interface PnlLine {
    id: string;
    label: string;
    english: string;
    value: number;
    tone: 'neutral' | 'success' | 'danger';
    hint: string;
}

/** سطور البيان الستة — الترتيب هو ترتيب القائمة المحاسبية، والأرقام كما وردت. */
export function buildPnlLines(statement: PnlStatement): PnlLine[] {
    const revenue = statement.revenue ?? {};
    const cogs = statement.cogs ?? {};
    const gross = statement.gross_profit ?? {};
    const shrinkage = statement.shrinkage ?? {};
    const operating = statement.operating ?? {};
    const payroll = statement.payroll ?? {};
    const net = statement.net_profit ?? {};
    const value = (input: unknown): number => {
        const parsed = Number(input ?? 0);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    return [
        {
            id: 'revenue',
            label: 'الإيراد',
            english: 'Revenue',
            value: value(revenue.total),
            tone: 'success',
            hint: `${String(value(revenue.invoice_count))} فاتورة كاشير · ${String(value(revenue.manual_count))} قيد يدوي`,
        },
        {
            id: 'cogs',
            label: 'تكلفة البضاعة',
            english: 'COGS',
            value: value(cogs.net),
            tone: 'danger',
            hint: `صرف ${String(value(cogs.dispatch))} — مرتجعات ${String(value(cogs.returns))}`,
        },
        {
            id: 'gross',
            label: 'الربح الإجمالي',
            english: 'Gross profit',
            value: value(gross.amount),
            tone: value(gross.amount) < 0 ? 'danger' : 'success',
            hint: 'إيراد − تكلفة البضاعة',
        },
        {
            id: 'operating',
            label: 'المصروفات التشغيلية',
            english: 'Operating',
            value: value(operating.total),
            tone: 'danger',
            hint: `${String(value(operating.count))} بندًا`,
        },
        {
            id: 'payroll',
            label: 'الرواتب',
            english: 'Payroll',
            value: value(payroll.total),
            tone: 'danger',
            hint: `${String(payroll.months?.length ?? 0)} شهرًا مرحّلًا`,
        },
        {
            id: 'shrinkage',
            label: 'الهدر والفروقات',
            english: 'Shrinkage',
            value: value(shrinkage.amount),
            tone: 'danger',
            hint: `${String(value(shrinkage.count))} حركة`,
        },
        {
            id: 'net',
            label: 'صافي الربح',
            english: 'Net profit',
            value: value(net.amount),
            tone: value(net.amount) < 0 ? 'danger' : 'success',
            hint: 'بعد التكلفة والتشغيل والرواتب',
        },
    ];
}
