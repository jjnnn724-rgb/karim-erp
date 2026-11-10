import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WarehouseDashboard } from './WarehouseDashboard';

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
            <WarehouseDashboard />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة المخزن', () => {
    it('تميّز النافد من تحت الحد وتعرض طوابير القرار', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory')) {
                    return json({
                        data: [
                            { id: 1, name: 'طماطم', qty: 0, minQty: 10, unit: 'كجم' },
                            { id: 2, name: 'زيت', qty: 3, minQty: 8, unit: 'لتر' },
                            { id: 3, name: 'أرز', qty: 50, minQty: 10, unit: 'كجم' },
                        ],
                    });
                }
                if (url.includes('/api/dispatches')) {
                    return json({
                        data: [
                            { id: 10, status: 'pending', needsChefApproval: true },
                            { id: 11, status: 'chef_approved', needsChefApproval: false },
                        ],
                    });
                }
                if (url.includes('/api/warehouse/purchase-requests')) {
                    return json({ data: [{ id: 20, status: 'pending' }, { id: 21, status: 'received' }] });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أصناف نافدة')).toBeTruthy();
        expect(screen.getByText('طماطم')).toBeTruthy();
        expect(screen.getByText('زيت')).toBeTruthy();
        expect(screen.getAllByText('نافد').length).toBeGreaterThan(0);
        expect(screen.getAllByText('تحت الحد').length).toBeGreaterThan(0);
        expect(screen.getByText('بانتظار اعتماد الشيف')).toBeTruthy();
    });

    it('تصفية الأصناف النافدة بنص البحث من الواجهة الأمامية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/inventory')) {
                    return json({
                        data: [
                            { id: 1, name: 'طماطم', qty: 0, minQty: 10, unit: 'كجم' },
                            { id: 2, name: 'زيت', qty: 3, minQty: 8, unit: 'لتر' },
                            { id: 3, name: 'أرز', qty: 50, minQty: 10, unit: 'كجم' },
                        ],
                    });
                }
                if (url.includes('/api/dispatches')) {
                    return json({
                        data: [
                            { id: 10, status: 'pending', needsChefApproval: true },
                            { id: 11, status: 'chef_approved', needsChefApproval: false },
                        ],
                    });
                }
                if (url.includes('/api/warehouse/purchase-requests')) {
                    return json({ data: [{ id: 20, status: 'pending' }, { id: 21, status: 'received' }] });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        await screen.findByText('طماطم');
        await screen.findByText('زيت');

        const search = screen.getByTestId('warehouse-filter-bar');
        fireEvent.input(search, { target: { value: 'زيت' } });

        await screen.findByText('زيت');
        expect(screen.queryByText('طماطم')).toBeNull();
    });
});
