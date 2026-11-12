import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { InventoryAuditStudio } from './InventoryAuditStudio';

/**
 * استوديو الجرد — حارس أعلى فجوة V2→V3:
 * القائمة تُقرأ من `/api/warehouse/inventory/audits`، والجلسة تعرض بنودها،
 * والإرسال بلا توقيع يُرفض محليًّا بنفس رسالة الخادم بدل طلبٍ فاشل.
 */

const mocks = vi.hoisted(() => ({ role: 'warehouse' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '2', name: 'أمين المخزن', username: 'wh', role: mocks.role },
    }),
}));

const list = [
    {
        id: '9',
        audit_number: 'AUD-20261110120000-0009',
        status: 'draft',
        warehouse_scope: 'MAIN-WAREHOUSE',
        location_name: 'المخزن الرئيسي',
        total_items: 2,
        counted_items: 1,
        period_start: '2026-11-01',
        period_end: '2026-11-10',
    },
    {
        id: '10',
        audit_number: 'AUD-20261109120000-0010',
        status: 'submitted',
        location_name: 'مخزن المطبخ',
        total_items: 5,
        counted_items: 5,
        period_start: '2026-11-09',
        period_end: '2026-11-09',
    },
];

const detail = {
    audit: list[0],
    items: [
        {
            id: 1,
            item_id: 101,
            item_name: 'أرز',
            unit: 'كجم',
            system_qty: 10,
            counted_qty: 10,
            variance_qty: 0,
            avg_cost: 5,
            variance_value: 0,
            is_counted: false,
        },
        {
            id: 2,
            item_id: 102,
            item_name: 'زيت',
            unit: 'لتر',
            system_qty: 4,
            counted_qty: 3,
            variance_qty: -1,
            avg_cost: 20,
            variance_value: -20,
            is_counted: true,
            notes: 'نقص تالف',
        },
    ],
    progress: { total: 2, counted: 1, remaining: 1, percent: 50 },
    summary: { items_with_variance: 1, shortage_items: 1, surplus_items: 0, projected_variance_value: -20, stale_items: 0 },
    events: [],
    location_name: 'المخزن الرئيسي',
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderStudio() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <InventoryAuditStudio open onOpenChange={() => undefined} />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    mocks.role = 'warehouse';
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/inventory/audits/9')) {
                return json(detail);
            }
            if (url.includes('/inventory/audits')) {
                return json(list);
            }
            if (url.includes('/inventory/locations')) {
                return json([{ id: '1', code: 'MAIN-WAREHOUSE', name_ar: 'المخزن الرئيسي', items_count: 2 }]);
            }
            return json([]);
        }),
    );
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('استوديو الجرد الفعلي', () => {
    it('يعرض جلسات الجرد وحالتها من الخادم', async () => {
        renderStudio();

        expect(await screen.findByText('AUD-20261110120000-0009')).toBeTruthy();
        expect(screen.getByText('مسودة — قيد العدّ')).toBeTruthy();
        expect(screen.getByText('مُرسل للمراجعة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'بدء جلسة جرد' })).toBeTruthy();
    });

    it('يفتح الجلسة ويعرض بنودها وفرقها', async () => {
        renderStudio();
        fireEvent.click(await screen.findByRole('button', { name: 'متابعة العدّ' }));

        expect(await screen.findByLabelText('العدد الفعلي — أرز')).toBeTruthy();
        expect(screen.getByText('عجز 1')).toBeTruthy();
        expect(screen.getByText('إجمالي الأصناف')).toBeTruthy();
        expect(screen.getByText('2')).toBeTruthy();
    });

    it('إرسال بلا توقيع يُرفض برسالة صريحة ولا يرسل طلبًا', async () => {
        renderStudio();
        fireEvent.click(await screen.findByRole('button', { name: 'متابعة العدّ' }));
        await screen.findByLabelText('العدد الفعلي — أرز');

        fireEvent.click(screen.getByRole('button', { name: 'إرسال للمراجعة' }));

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('التوقيع');
        });
        const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
        expect(calls.some((call) => String(call[0]).includes('/submit'))).toBe(false);
    });

    it('حفظ العدّ يرسل الصفوف غير المعدودة فقط', async () => {
        renderStudio();
        fireEvent.click(await screen.findByRole('button', { name: 'متابعة العدّ' }));
        const input = await screen.findByLabelText('العدد الفعلي — أرز');
        fireEvent.change(input, { target: { value: '9' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ العدّ' }));

        await waitFor(() => {
            const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
            expect(calls.some((call) => String(call[0]).includes('/counts'))).toBe(true);
        });
    });

    it('المحاسب يقرأ ولا يرى أزرار الكتابة', async () => {
        mocks.role = 'accountant';
        renderStudio();
        await screen.findByText('AUD-20261110120000-0009');

        expect(screen.queryByRole('button', { name: 'بدء جلسة جرد' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'عرض التفاصيل' }).length).toBe(2);
    });
});
