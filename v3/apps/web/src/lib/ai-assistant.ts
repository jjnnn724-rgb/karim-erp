import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * المساعد الذكي — «وين الزيادة؟»
 * ═══════════════════════════════════════════════════════════════════════
 * نفس مصدر الحقيقة للباك-إند (`backend/ai-assistant/analyzer.js`):
 * مقارنة أيام كاملة متكافئة، وإن كانت تغطية الفترة السابقة < 80% من الأيام
 * نقارن بمعدل اليوم (عدّل ذلك تلقائيًا — هنا فقط نعرض ما جاء من الخادم).
 *
 * الذكاء الاصطناعي هنا اختياري و**مجاني**: النموذج المحلي (Ollama على
 * 127.0.0.1) يُستدعى فقط عند زر «اشرح الصورة» — لا شيء في مسار العرض.
 */

const numLike = z.union([z.string(), z.number()]);
const num = numLike.nullable().optional().transform((v) => Number(v ?? 0));
const text = z.string().nullable().optional();
const bool = z.boolean().nullable().optional();

const windowSchema = z.object({ from: text, to: text }).passthrough();
const basisSchema = z
    .object({ mode: text, curDays: num, prevDays: num, windowDays: num })
    .passthrough();

const metricSchema = z
    .object({
        current: num,
        previous: num,
        delta: num,
        deltaPct: num,
        unit: text,
        lowerIsBetter: bool,
        label: text,
        sub: text,
        basis: text,
    })
    .passthrough();

const alertSchema = z
    .object({
        id: text,
        severity: text,
        area: text,
        direction: text,
        title: text,
        detail: text,
        current: num,
        previous: num,
        deltaPct: num,
        action: text,
    })
    .passthrough();

const categoryRowSchema = z
    .object({
        category: text,
        current: num,
        previous: num,
        delta: num,
        deltaPct: num,
    })
    .passthrough();

const deptExpenseSchema = z
    .object({
        dept: text,
        current: num,
        previous: num,
        delta: num,
        deltaPct: num,
    })
    .passthrough();

const deptDispatchSchema = z
    .object({
        dept: text,
        requests: num,
        previous: num,
        items: num,
        deltaPct: num,
    })
    .passthrough();

const salesSchema = z
    .object({
        curRevenue: num,
        prevRevenue: num,
        curInvoices: num,
        prevInvoices: num,
        curAvgTicket: num,
        prevAvgTicket: num,
        curCash: num,
        prevCash: num,
        curCard: num,
        prevCard: num,
        curAvgPerDay: num,
        prevAvgPerDay: num,
        basis: text,
        revenueDeltaPct: num,
        invoicesDeltaPct: num,
        avgTicketDeltaPct: num,
        daily: z
            .array(z.object({ day: text, invoices: num, revenue: num }).passthrough())
            .optional(),
    })
    .passthrough();

const accountingSchema = z
    .object({
        curRevenue: num,
        prevRevenue: num,
        curEntries: num,
        prevEntries: num,
        deltaPct: num,
    })
    .passthrough();

const expensesSchema = z
    .object({
        curTotal: num,
        prevTotal: num,
        curEntries: num,
        prevEntries: num,
        deltaPct: num,
        curAvgPerDay: num,
        prevAvgPerDay: num,
        basis: text,
    })
    .passthrough();

const warehouseSchema = z
    .object({
        curOutMoves: num,
        prevOutMoves: num,
        curOutValue: num,
        prevOutValue: num,
        curTransferValue: num,
        prevTransferValue: num,
        curTransferQty: num,
        prevTransferQty: num,
        curDispatchValue: num,
        prevDispatchValue: num,
        curCorrectionValue: num,
        prevCorrectionValue: num,
        curOutQty: num,
        prevOutQty: num,
        outValueDeltaPct: num,
        transferDeltaPct: num,
        correctionDeltaPct: num,
        dispatchValueDeltaPct: num,
        basis: text,
    })
    .passthrough();

const inboundSchema = z
    .object({
        curMoves: num,
        prevMoves: num,
        curValue: num,
        prevValue: num,
        deltaPct: num,
    })
    .passthrough();

const dispatchesSchema = z
    .object({
        curRequests: num,
        prevRequests: num,
        curReceived: num,
        prevReceived: num,
        curAwaiting: num,
        prevAwaiting: num,
        curRejected: num,
        prevRejected: num,
        curItems: num,
        prevItems: num,
        requestsDeltaPct: num,
        basis: text,
        byDept: z.array(deptDispatchSchema).optional(),
    })
    .passthrough();

const reductionTargetSchema = z
    .object({
        area: text,
        increase: num,
        increasePct: num,
        note: text,
    })
    .passthrough();

const purchaseSupplierSchema = z
    .object({ supplier: text, invoices: num, value: num })
    .passthrough();

const purchasesSchema = z
    .object({
        curInvoices: num,
        prevInvoices: num,
        curValue: num,
        prevValue: num,
        curVat: num,
        prevVat: num,
        deltaPct: num,
        basis: text,
        topSuppliers: z.array(purchaseSupplierSchema).optional(),
    })
    .passthrough();

const attendanceSchema = z
    .object({
        curRows: num,
        prevRows: num,
        curLate: num,
        prevLate: num,
        curMissingIn: num,
        prevMissingIn: num,
        curMissingOut: num,
        prevMissingOut: num,
        lateRateCur: num,
        lateRatePrev: num,
        missOutCur: num,
        missOutPrev: num,
        basis: text,
    })
    .passthrough();

const inventoryOnHandSchema = z
    .object({ items: num, value: num })
    .passthrough();

const pendingSnapshotSchema = z
    .object({
        dispatchesAwaiting: num,
        purchaseRequestsAwaiting: num,
        leavesAwaiting: num,
        openShifts: num,
        lastDayClose: text.nullable(),
        daysSinceClose: num.nullable(),
        negativeStockItems: num,
        belowMinItems: num,
    })
    .passthrough();

export const analyticsSchema = z
    .object({
        range: text,
        rangeLabel: text,
        days: num,
        alertPct: num,
        current: windowSchema,
        previous: windowSchema,
        generatedAt: text,
        coverage: z.object({
            sales: basisSchema.optional(),
            revenues: basisSchema.optional(),
            expenses: basisSchema.optional(),
            ledger: basisSchema.optional(),
            dispatches: basisSchema.optional(),
            purchases: basisSchema.optional(),
            attendance: basisSchema.optional(),
        }).passthrough().optional(),
        fairNotes: z.array(text).optional(),
        metrics: z.object({
            sales: metricSchema,
            avgTicket: metricSchema,
            expenses: metricSchema,
            materials: metricSchema,
            warehouseOut: metricSchema,
            dispatches: metricSchema,
            purchases: metricSchema,
            attendance: metricSchema,
        }).passthrough(),
        sales: salesSchema,
        accounting: accountingSchema,
        expenses: expensesSchema,
        purchases: purchasesSchema,
        attendance: attendanceSchema,
        inventoryOnHand: inventoryOnHandSchema.optional(),
        pending: pendingSnapshotSchema.nullable().optional(),
        expenseCategories: z.array(categoryRowSchema).optional(),
        expenseDepts: z.array(deptExpenseSchema).optional(),
        warehouse: warehouseSchema,
        inbound: inboundSchema,
        dispatches: dispatchesSchema,
        alerts: z.array(alertSchema).optional(),
        reductionTargets: z.array(reductionTargetSchema).optional(),
        dataGaps: z.array(text).optional(),
    })
    .passthrough();

export type AnalyticsReport = z.infer<typeof analyticsSchema>;

export const explainSchema = z
    .object({
        text: text,
        model: text.nullable(),
        ms: num,
        fallback: bool,
        range: text,
        days: num,
        alertPct: num,
    })
    .passthrough();

export type ExplainResult = z.infer<typeof explainSchema>;

export type AnalyticsRange = 'week' | 'month' | 'custom';

/** التحليل المقارن (حتمي من القاعدة — لا نموذج). */
export async function fetchAnalytics(
    range: AnalyticsRange,
    alertPct: number,
    signal?: AbortSignal,
    from?: string,
    to?: string,
): Promise<AnalyticsReport> {
    const qs = new URLSearchParams({ range, alertPct: String(alertPct) });
    if (range === 'custom' && from && to) {
        qs.set('from', from);
        qs.set('to', to);
    }
    const token = getAccessToken();
    const options = signal ? { signal } : {};
    return fetchJson(analyticsSchema, `/api/ai-assistant/analytics?${qs}`, token, options);
}

/** شرح الصورة بالنموذج المحلي المجاني (عند الطلب — أبطأ ~٢٠–٦٠ ثانية). */
export async function explainAnalytics(
    range: AnalyticsRange,
    alertPct: number,
    signal?: AbortSignal,
): Promise<ExplainResult> {
    const token = getAccessToken();
    return fetchJson(explainSchema, '/api/ai-assistant/analytics/explain', token, {
        method: 'POST',
        body: { range, alertPct },
        ...(signal ? { signal } : {}),
    });
}

/* ─── رادار النظام — يسأل نفسه كل دقيقة ─── */
export const radarAlertSchema = z
    .object({
        id: text,
        severity: text,
        area: text,
        title: text,
        detail: text,
        action: text,
    })
    .passthrough();

export const radarSchema = z
    .object({
        generatedAt: text,
        scanMs: num,
        items: z.array(radarAlertSchema),
        critical: num,
        high: num,
        total: num,
    })
    .passthrough();

export type RadarReport = z.infer<typeof radarSchema>;
export type RadarAlert = z.infer<typeof radarAlertSchema>;

/** الرادار: فحوصات حية للنظام — يُستدعى كل دقيقتين. */
export async function fetchRadar(signal?: AbortSignal): Promise<RadarReport> {
    const token = getAccessToken();
    return fetchJson(radarSchema, '/api/ai-assistant/radar', token, signal ? { signal } : {});
}

/* ─── بحث ذكي بكلمة (شاورما · مشويات · أي شيء) ─── */
const lookupBreakdownSchema = z
    .object({
        name: text,
        qty: num,
        revenue: num,
        invoices: num,
    })
    .passthrough();

const lookupIssueSchema = z
    .object({
        item_id: text,
        name: text,
        unit: text,
        qty: num,
        cost: num,
        moves: num,
    })
    .passthrough();

export const lookupSchema = z
    .object({
        keyword: text,
        from: text,
        to: text,
        sales: z.object({
            invoices: num,
            lines: num,
            qty: num,
            revenue: num,
            share_of_revenue: num,
        }).passthrough(),
        sales_breakdown: z.array(lookupBreakdownSchema).optional(),
        issues: z.array(lookupIssueSchema).optional(),
        issues_cost: num,
        inventory: z.object({ items: num, value: num }).passthrough(),
        notes: z.array(text).optional(),
    })
    .passthrough();

export type LookupReport = z.infer<typeof lookupSchema>;

/** بحث ذكي بكلمة: مبيعات + صرف + قيمة مخزنية لأي كلمة. */
export async function fetchLookup(
    keyword: string,
    range: { from: string; to: string },
    signal?: AbortSignal,
): Promise<LookupReport> {
    const qs = new URLSearchParams({ keyword, from: range.from, to: range.to });
    const token = getAccessToken();
    return fetchJson(lookupSchema, `/api/pos/reports/lookup?${qs}`, token, signal ? { signal } : {});
}
