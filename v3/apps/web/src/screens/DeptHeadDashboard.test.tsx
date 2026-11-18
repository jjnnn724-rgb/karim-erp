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
                        dispatchExpenses: [
                            {
                                id: 'e1',
                                date: '2026-11-18',
                                desc: 'صرف مخزون - شحم بطن (20 كيلو)',
                                amount: 120,
                                adjustmentType: 'dispatch',
                                dispatchId: '1794955995791276',
                                notes: 'من طلب صرف #1794955995791276',
                            },
                            {
                                id: 'e2',
                                date: '2026-11-17',
                                desc: 'صرف مخزون - أرز بسمتي (50 كيلو)',
                                amount: 880.5,
                                adjustmentType: 'dispatch_return',
                                dispatchId: '1700000000000001',
                                notes: 'من طلب صرف #1700000000000001',
                            },
                        ],
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
        // جدول مصروفات أذون الصرف بالتفصيل
        expect(screen.getByText('صرف مخزون - شحم بطن (20 كيلو)')).toBeTruthy();
        expect(screen.getByText('صرف مخزون - أرز بسمتي (50 كيلو)')).toBeTruthy();
        expect(screen.getByText('#1794955995791276')).toBeTruthy();
        expect(screen.getByText('مرتجع (عكس)')).toBeTruthy();
        expect(screen.getByText('الإجمالي المعروض (2 حركة)')).toBeTruthy();
        expect(screen.getByText('1,000.50 SAR')).toBeTruthy();
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
                        dispatchExpenses: [
                            {
                                id: 'e1',
                                date: '2026-11-18',
                                desc: 'صرف مخزون - شحم بطن (20 كيلو)',
                                amount: 120,
                                adjustmentType: 'dispatch',
                                dispatchId: '1794955995791276',
                                notes: 'من طلب صرف #1794955995791276',
                            },
                            {
                                id: 'e2',
                                date: '2026-11-17',
                                desc: 'صرف مخزون - أرز بسمتي (50 كيلو)',
                                amount: 880.5,
                                adjustmentType: 'dispatch_return',
                                dispatchId: '1700000000000001',
                                notes: 'من طلب صرف #1700000000000001',
                            },
                        ],
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
        // البحث نفسه يرشّح صفوف جدول أذون الصرف
        expect(screen.queryByText('صرف مخزون - شحم بطن (20 كيلو)')).toBeNull();
    });

    it('البحث النصي يرشّح صفوف مصروفات أذون الصرف بالبيان أو رقم الإذن', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/warehouse/dept-panel')) {
                    return json({
                        scope: { deptCode: 'KITCHEN', role: 'dept_head' },
                        department: { code: 'KITCHEN', name: 'المطبخ' },
                        subDepartments: [],
                        expenses: { total: 1000.5, count: 2, bySource: { dispatch: { total: 1000.5, count: 2 } }, labels: { dispatch: 'صرف مخزني' } },
                        dispatches: { total: 1, byStatus: { approved: 1 } },
                        dispatchExpenses: [
                            {
                                id: 'e1',
                                date: '2026-11-18',
                                desc: 'صرف مخزون - شحم بطن (20 كيلو)',
                                amount: 120,
                                adjustmentType: 'dispatch',
                                dispatchId: '1794955995791276',
                                notes: 'من طلب صرف #1794955995791276',
                            },
                            {
                                id: 'e2',
                                date: '2026-11-17',
                                desc: 'صرف مخزون - أرز بسمتي (50 كيلو)',
                                amount: 880.5,
                                adjustmentType: 'dispatch_return',
                                dispatchId: '1700000000000001',
                                notes: 'من طلب صرف #1700000000000001',
                            },
                        ],
                    });
                }
                if (url.includes('/api/dispatches')) {
                    return json({ data: [{ id: 1, deptCode: 'KITCHEN', status: 'approved' }] });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        await screen.findByText('صرف مخزون - شحم بطن (20 كيلو)');
        const search = screen.getByTestId('dept-head-filter-bar');
        fireEvent.input(search, { target: { value: 'أرز' } });

        await screen.findByText('صرف مخزون - أرز بسمتي (50 كيلو)');
        expect(screen.queryByText('صرف مخزون - شحم بطن (20 كيلو)')).toBeNull();
        expect(screen.getByText('الإجمالي المعروض (1 حركة)')).toBeTruthy();
    });
});
