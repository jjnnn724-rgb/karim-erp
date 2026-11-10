import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';
import { moneyOf, num, pctOf, textOf, type DisplayTone } from './reporting';

/**
 * الموجز التنفيذي — باب واحد إلى `GET /api/executive/summary?days=` كما في
 * القديم (`executive-repo.js`): الخادم يبني السلسلة والمؤشرات والنقد
 * والإنذارات في قراءة واحدة، والواجهة تعرض ولا تجمع.
 *
 * الصلاحية admin|owner على الخادم، ورفضه يُعرض كما هو.
 */

const numLike = z.union([z.string(), z.number()]).nullable().optional();

const kpiSchema = z
    .object({
        revenue: numLike,
        cogs: numLike,
        net: numLike,
        margin: numLike,
        cash: numLike,
        openShifts: numLike,
        negativeStock: numLike,
    })
    .passthrough();

const seriesRowSchema = z
    .object({
        day: z.string().optional(),
        revenue: numLike,
        cost: numLike,
        net: numLike,
    })
    .passthrough();

const alertActionSchema = z
    .object({
        label: z.string().nullable().optional(),
        screen: z.string().nullable().optional(),
    })
    .passthrough();

const alertSchema = z
    .object({
        severity: z.string().nullable().optional(),
        title: z.string().nullable().optional(),
        detail: z.string().nullable().optional(),
        action: alertActionSchema.nullable().optional(),
    })
    .passthrough();

export const executiveSummarySchema = z
    .object({
        day: z.string().nullable().optional(),
        postedToday: numLike,
        kpi: kpiSchema.optional(),
        series: z.array(seriesRowSchema).optional(),
        topDepts: z
            .array(z.object({ name: z.string().nullable().optional(), total: numLike }).passthrough())
            .optional(),
        topItems: z
            .array(
                z
                    .object({
                        name: z.string().nullable().optional(),
                        qty: numLike,
                        total: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
        cash: z
            .array(
                z
                    .object({
                        name: z.string().nullable().optional(),
                        code: z.string().nullable().optional(),
                        balance: numLike,
                    })
                    .passthrough(),
            )
            .optional(),
        alerts: z.array(alertSchema).optional(),
    })
    .passthrough();

export type ExecutiveSummary = z.infer<typeof executiveSummarySchema>;

/** المدى المسموح على الخادم: 7..31 يومًا — نطبّقه قبل الطلب. */
export function clampDays(days: number): number {
    const value = Math.round(Number(days) || 14);
    return Math.min(Math.max(value, 7), 31);
}

export async function fetchExecutiveSummary(days = 14, signal?: AbortSignal): Promise<ExecutiveSummary> {
    return fetchJson(
        executiveSummarySchema,
        `/api/executive/summary?days=${String(clampDays(days))}`,
        getAccessToken(),
        signal ? { signal } : {},
    );
}

export interface ExecutiveKpi {
    id: string;
    label: string;
    english: string;
    value: string;
    hint: string;
    tone: DisplayTone;
}

/** مؤشرات الشاشة — الثمانية التي يعرضها القديم (`buildLiveBoard`). */
export function buildExecutiveKpis(payload: ExecutiveSummary): ExecutiveKpi[] {
    const kpi = payload.kpi ?? {};
    const margin = kpi.margin === null || kpi.margin === undefined ? null : num(kpi.margin);
    const net = num(kpi.net);
    return [
        {
            id: 'revenue',
            label: 'إيراد اليوم',
            english: 'Revenue',
            value: moneyOf(kpi.revenue),
            hint: 'من دفتر القيود المُرحَّل',
            tone: 'neutral',
        },
        {
            id: 'cogs',
            label: 'تكلفة البضاعة',
            english: 'COGS',
            value: moneyOf(kpi.cogs),
            hint: 'قيود التكلفة المُرحَّلة',
            tone: 'neutral',
        },
        {
            id: 'net',
            label: 'الصافي',
            english: 'Net',
            value: moneyOf(net),
            hint: 'إيراد − تكلفة − مصروف',
            tone: net < 0 ? 'danger' : 'success',
        },
        {
            id: 'margin',
            label: 'الهامش',
            english: 'Margin',
            value: pctOf(margin),
            hint: 'نسبة الصافي من الإيراد',
            tone: margin !== null && margin < 0 ? 'danger' : 'neutral',
        },
        {
            id: 'cash',
            label: 'النقد في الدفاتر',
            english: 'Cash on books',
            value: moneyOf(kpi.cash),
            hint: 'أرصدة حسابات النقد',
            tone: 'neutral',
        },
        {
            id: 'posted',
            label: 'قيود مُرحَّلة اليوم',
            english: 'Posted today',
            value: textOf(num(payload.postedToday)),
            hint: 'من دفتر اليوم',
            tone: 'neutral',
        },
        {
            id: 'shifts',
            label: 'ورديات مفتوحة',
            english: 'Open shifts',
            value: textOf(num(kpi.openShifts)),
            hint: 'نقد لم يُقفل بعد',
            tone: num(kpi.openShifts) > 0 ? 'warning' : 'neutral',
        },
        {
            id: 'stock',
            label: 'أصناف رصيدها سالب',
            english: 'Negative stock',
            value: textOf(num(kpi.negativeStock)),
            hint: 'ثقة التكلفة',
            tone: num(kpi.negativeStock) > 0 ? 'danger' : 'success',
        },
    ];
}

export function alertTone(severity: string): DisplayTone {
    const key = severity.toLowerCase();
    if (key === 'high' || key === 'critical' || key === 'danger') {
        return 'danger';
    }
    if (key === 'medium' || key === 'warning' || key === 'warn') {
        return 'warning';
    }
    return 'neutral';
}

export const ALERT_SEVERITY_AR: Record<string, string> = {
    high: 'حرج',
    critical: 'حرج',
    medium: 'متوسط',
    low: 'منخفض',
};

export function severityLabel(severity: string): string {
    return ALERT_SEVERITY_AR[severity.toLowerCase()] ?? (severity || 'تنبيه');
}
