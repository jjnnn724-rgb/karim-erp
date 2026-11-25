import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../ui/Toast';
import { DepartmentCost } from './DepartmentCost';

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

const issuesPayload = {
    department: 'المطبخ',
    from: '2026-11-01',
    to: '2026-11-14',
    totals: { items: 2, moves: 15, dispatches: 6, cost: 1250.5, grams: 10000, weight_items: 1, packed_items: 1 },
    items: [
        { item_id: '11', name: 'بيض كرتون', unit: 'كرتون', category: 'عام', qty: 5, grams: null, cost: 600, moves: 10, dispatches: 3, share: 48 },
        { item_id: '22', name: 'عدس أحمر-كيس', unit: 'كيس', category: 'عام', qty: 10, grams: 10000, cost: 650.5, moves: 5, dispatches: 3, share: 52 },
    ],
    veg: { requests: 3, items_count: 4, qty_kg: 1200 },
};

const breakfastPayload = {
    from: '2026-11-01',
    to: '2026-11-14',
    previous: { from: '2026-09-01', to: '2026-09-30' },
    revenue: 162878.09,
    revenue_entries: 2207,
    revenue_ys: 142012.12,
    previous_revenue: 0,
    revenue_delta_pct: 0,
    total_cost: 15249.76,
    cost_pct: 9.4,
    verdict: { tone: 'success', text: 'ممتاز — هامش مريح' },
    full_cost: 15249.76,
    full_cost_pct: 9.4,
    full_verdict: { tone: 'success', text: 'ممتاز — هامش مريح' },
    groups: [
        { group: 'بيض', items: [{ item_id: '11', name: 'بيض كرتون', unit: 'كرتون', qty: 56, grams: null, cost: 6710.11, moves: 26 }], cost: 6710.11, kg: 0, share: 44 },
        { group: 'فول', items: [{ item_id: '33', name: 'فول مدمس-كرتون', unit: 'كرتون', qty: 53, grams: null, cost: 1805.79, moves: 25 }], cost: 1805.79, kg: 0, share: 12 },
    ],
    top_items: [],
    veg: { requests: 3, items_count: 4, qty_kg: 1200 },
    notes: ['notes from server'],
};

function stubFetch() {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes('/api/pos/reports/issue-departments')) {
            return jsonResponse({ departments: [{ dept: 'المطبخ', code: 'kitchen', requests: 176, received: 170 }] });
        }
        if (url.includes('/api/pos/reports/department-issues')) {
            return jsonResponse(issuesPayload);
        }
        if (url.includes('/api/pos/reports/breakfast-cost')) {
            return jsonResponse(breakfastPayload);
        }
        return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);
    return { calls, fetchMock };
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <DepartmentCost />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('وضع القسم', () => {
    it('تبويب تحليل الفطار يعرض أرقام الخادم', async () => {
        const { calls } = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('162,878.09')).toBeTruthy();
        });
        expect(screen.getByText('9.4%')).toBeTruthy();
        expect(screen.getByRole('button', { name: /A4/ })).toBeTruthy();
        expect(screen.getAllByRole('tab').length).toBe(2);
        expect(calls.some((c) => c.includes('/api/pos/reports/breakfast-cost'))).toBe(true);
    });

    it('التبديل لتبويب «وضع القسم» يجلب الحركات للقسم المختار', async () => {
        const { calls } = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByText('162,878.09')).toBeTruthy();
        });
        const departmentTab = screen.getAllByRole('tab')[1];
        expect(departmentTab).toBeTruthy();
        departmentTab!.click();
        await waitFor(() => {
            expect(calls.some((c) => c.includes('/api/pos/reports/department-issues'))).toBe(true);
        });
        expect(screen.getByRole('button', { name: /A4/ })).toBeTruthy();
    });
});
