import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../ui/Toast';
import { AiAssistant } from './AiAssistant';

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const analyticsPayload = {
    range: 'week',
    rangeLabel: 'آخر 7 أيام كاملة مقابل الـ7 السابقة',
    days: 7,
    alertPct: 0,
    current: { from: '2026-11-07', to: '2026-11-13' },
    previous: { from: '2026-10-31', to: '2026-11-06' },
    generatedAt: '2026-11-14T00:00:00.000Z',
    coverage: {
        sales: { mode: 'total', curDays: 7, prevDays: 7, windowDays: 7 },
        revenues: { mode: 'total', curDays: 7, prevDays: 7, windowDays: 7 },
        expenses: { mode: 'total', curDays: 7, prevDays: 7, windowDays: 7 },
        ledger: { mode: 'total', curDays: 7, prevDays: 7, windowDays: 7 },
        dispatches: { mode: 'total', curDays: 7, prevDays: 7, windowDays: 7 },
    },
    fairNotes: [],
    metrics: {
        sales: { current: 430467.13, previous: 498231.55, delta: -67764.42, deltaPct: -13.6, unit: 'ر.س', lowerIsBetter: false, label: 'صافي المبيعات', sub: '6100 فاتورة', basis: 'total' },
        avgTicket: { current: 61.68, previous: 65.2, delta: -3.52, deltaPct: -5.4, unit: 'ر.س', lowerIsBetter: false, label: 'متوسط الفاتورة', sub: '', basis: 'total' },
        expenses: { current: 139850.35, previous: 175849.91, delta: -35999.56, deltaPct: -20.5, unit: 'ر.س', lowerIsBetter: true, label: 'المصروفات', sub: '180 بند صرف', basis: 'total' },
        materials: { current: 139850.35, previous: 175849.91, delta: -35999.56, deltaPct: -20.5, unit: 'ر.س', lowerIsBetter: true, label: 'مواد خام (كوست)', sub: '', basis: 'total' },
        warehouseOut: { current: 171281.17, previous: 220581.15, delta: -49299.98, deltaPct: -22.4, unit: 'ر.س', lowerIsBetter: true, label: 'صرف المخزن (تكلفة)', sub: '210 حركة', basis: 'total' },
        dispatches: { current: 79, previous: 91, delta: -12, deltaPct: -13.2, unit: 'إذن', lowerIsBetter: true, label: 'أذونات الصرف', sub: '70 مستلم · 2 معلّق', basis: 'total' },
    },
    sales: {
        curRevenue: 430467.13, prevRevenue: 498231.55,
        curInvoices: 6100, prevInvoices: 6635,
        curAvgTicket: 61.68, prevAvgTicket: 65.2,
        curCash: 180000, prevCash: 210000, curCard: 250000, prevCard: 280000,
        curAvgPerDay: 61495.3, prevAvgPerDay: 71175.94, basis: 'total',
        revenueDeltaPct: -13.6, invoicesDeltaPct: -8.1, avgTicketDeltaPct: -5.4,
        daily: [{ day: '2026-11-13', invoices: 900, revenue: 70000 }],
    },
    accounting: { curRevenue: 699190.04, prevRevenue: 772054.65, curEntries: 120, prevEntries: 130, deltaPct: -9.4 },
    expenses: {
        curTotal: 139850.35, prevTotal: 175849.91, curEntries: 180, prevEntries: 220,
        deltaPct: -20.5, curAvgPerDay: 19978.62, prevAvgPerDay: 25121.42, basis: 'total',
    },
    expenseCategories: [
        { category: 'مواد خام', current: 139850.35, previous: 175849.91, delta: -35999.56, deltaPct: -20.5 },
    ],
    expenseDepts: [{ dept: 'kitchen', current: 82631.27, previous: 97500, delta: -14868.73, deltaPct: -15.2 }],
    warehouse: {
        curOutMoves: 210, prevOutMoves: 280, curOutValue: 171281.17, prevOutValue: 220581.15,
        curTransferValue: 171281.17, prevTransferValue: 220581.15,
        curTransferQty: 5200, prevTransferQty: 6100,
        curDispatchValue: 171281.17, prevDispatchValue: 220581.15,
        curCorrectionValue: 0, prevCorrectionValue: 5000,
        curOutQty: 5200, prevOutQty: 6100,
        outValueDeltaPct: -22.4, transferDeltaPct: -22.4, correctionDeltaPct: -100, dispatchValueDeltaPct: -22.4, basis: 'total',
    },
    inbound: { curMoves: 60, prevMoves: 70, curValue: 169104.42, prevValue: 182745.12, deltaPct: -7.5 },
    dispatches: {
        curRequests: 79, prevRequests: 91, curReceived: 70, prevReceived: 80,
        curAwaiting: 2, prevAwaiting: 3, curRejected: 1, prevRejected: 2,
        curItems: 871, prevItems: 950, requestsDeltaPct: -13.2, basis: 'total',
        byDept: [{ dept: 'المطبخ', requests: 33, previous: 40, items: 380, deltaPct: -17.5 }],
    },
    alerts: [
        {
            id: 'sales-drop', severity: 'high', area: 'المبيعات', direction: 'down',
            title: 'انخفاض المبيعات 13.6%',
            detail: 'المبيعات 430,467.13 ر.س مقابل 498,231.55 ر.س',
            current: 430467.13, previous: 498231.55, deltaPct: -13.6,
            action: 'راجع أسباب التراجع مع مشرفي الأقسام',
        },
    ],
    reductionTargets: [],
    dataGaps: [],
};

function stubAnalytics() {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.includes('/api/ai-assistant/analytics/explain')) {
            return jsonResponse({
                text: '(1) الحقيقة: المبيعات انخفضت 13.6%. (2) راقب مواد خام. (3) قراران.',
                model: 'qwen2.5:3b-instruct', ms: 26000, fallback: false,
                range: 'week', days: 7, alertPct: 0,
            });
        }
        if (url.includes('/api/ai-assistant/analytics')) {
            return jsonResponse(analyticsPayload);
        }
        return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls };
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <AiAssistant />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('المساعد الذكي', () => {
    it('يعرض المؤشرات الستة والتنبيهات من الخادم', async () => {
        stubAnalytics();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('صافي المبيعات')).toBeTruthy();
        });
        expect(screen.getByText('انخفاض المبيعات 13.6%')).toBeTruthy();
        expect(screen.getByText('المطبخ')).toBeTruthy();
        expect(screen.getByText('مواد خام')).toBeTruthy();
        expect(screen.getByRole('button', { name: /طباعة ورقة رسمية/ })).toBeTruthy();
    });

    it('زر الشرح يستدعي النموذج المحلي ويعرض النتيجة', async () => {
        const { calls } = stubAnalytics();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('انخفاض المبيعات 13.6%')).toBeTruthy();
        });
        screen.getByRole('button', { name: /اشرح الصورة/ }).click();
        await waitFor(() => {
            expect(screen.getByText(/المبيعات انخفضت 13\.6%/)).toBeTruthy();
        });
        expect(calls.some((c) => c.includes('POST /api/ai-assistant/analytics/explain'))).toBe(true);
        expect(screen.getByText(/qwen2\.5:3b-instruct/)).toBeTruthy();
    });

    it('التبديل إلى «هذا الشهر» يعيد طلب التحليل بفترة شهر', async () => {
        const { calls } = stubAnalytics();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('صافي المبيعات')).toBeTruthy();
        });
        screen.getByRole('tab', { name: /هذا الشهر/ }).click();
        await waitFor(() => {
            expect(calls.some((c) => c.includes('range=month'))).toBe(true);
        });
    });
});
