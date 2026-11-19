import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeptHeadDashboard } from './DeptHeadDashboard';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <DeptHeadDashboard />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة رئيس القسم', () => {
    it('تعرض القسم ومصروفاته بحسب المصدر وأذونه بالحالة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/warehouse/dept-panel')) {
                    return json({
                        scope: { deptCode: 'KITCHEN', role: 'dept_head' },
                        department: { code: 'KITCHEN', name: 'المطبخ' },
                        subDepartments: [{ code: 'GRILL', name: 'المشويات' }],
                        expenses: {
                            total: 1250.5,
                            count: 4,
                            bySource: { dispatch: { total: 1000, count: 3 }, manual: { total: 250.5, count: 1 } },
                            labels: { dispatch: 'صرف مخزني', manual: 'يدوي' },
                        },
                        dispatches: { total: 3, byStatus: { pending: 2, received: 1 } },
                    });
                }
                if (url.includes('/api/dispatches')) {
                    return json({
                        data: [
                            { id: 1, deptCode: 'KITCHEN', status: 'pending' },
                            { id: 2, deptCode: 'KITCHEN', status: 'received' },
                            { id: 3, deptCode: 'SALADS', status: 'pending' },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('المطبخ')).toBeTruthy();
        expect(screen.getByText('صرف مخزني')).toBeTruthy();
        expect(screen.getByText('1,250.50 SAR')).toBeTruthy();
        expect(screen.getByText('المشويات')).toBeTruthy();
        expect(screen.getAllByText('معلّق').length).toBeGreaterThan(0);
    });

    it('تصفية المصروفات والأذون بنص البحث من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/warehouse/dept-panel')) {
                    return json({
                        scope: { deptCode: 'KITCHEN', role: 'dept_head' },
                        department: { code: 'KITCHEN', name: 'المطبخ' },
                        subDepartments: [{ code: 'GRILL', name: 'المشويات' }],
                        expenses: {
                            total: 1250.5,
                            count: 4,
                            bySource: { dispatch: { total: 1000, count: 3 }, manual: { total: 250.5, count: 1 } },
                            labels: { dispatch: 'صرف مخزني', manual: 'يدوي' },
                        },
                        dispatches: { total: 3, byStatus: { pending: 2, received: 1 } },
                    });
                }
                if (url.includes('/api/dispatches')) {
                    return json({
                        data: [
                            { id: 1, deptCode: 'KITCHEN', status: 'pending' },
                            { id: 2, deptCode: 'KITCHEN', status: 'received' },
                            { id: 3, deptCode: 'SALADS', status: 'pending' },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        await screen.findByText('المطبخ');
        await screen.findByText('صرف مخزني');
        await screen.findByText('يدوي');

        const search = screen.getByTestId('dept-head-filter-bar');
        fireEvent.input(search, { target: { value: 'يدوي' } });

        await screen.findByText('يدوي');
        expect(screen.queryByText('صرف مخزني')).toBeNull();
    });
});
