/**
 * PosEntry.cashier-view.test.tsx — عقد «واجهة الكاشير» لدور cashier.
 * ══════════════════════════════════════════════════════════════════════════════
 * المطلوب من المالك: موظف الكاشير يفتح الشاشة فيرى واجهة كاشير نظيفة فقط —
 * لا ترس ضبط، ولا تعديل سعر، ولا أزرار صور، ولا سجل فواتير، ولا إقفال يوم.
 * الأزرار الإدارية مخفية تمامًا (مش معطّلة): لأن الكاشير مش المفروض يشوفها أصلًا.
 * والأهم: اختفاؤها لا يترك فراغًا في الشكل — الشاشة تظل مكتملة واحترافية.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { installDomPolyfills } from '../ui/test-utils';
import { PosEntry } from './PosEntry';

installDomPolyfills();

const mocks = vi.hoisted(() => ({ role: 'cashier' }));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '9', name: 'موظف كاشير', username: 'cashier9', role: mocks.role, deptCode: 'K01' },
    }),
}));

const DEPARTMENT = {
    id: 7,
    code: 'K01',
    name_ar: 'الكاشير الرئيسي',
    name_en: 'Main Cashier',
    is_active: true,
    vat_number: '300000000000003',
};

const SHIFT = {
    id: '44',
    session_id: '44',
    department_id: '7',
    cashier_id: '9',
    status: 'open',
    opening_balance: 100,
    opened_at: new Date().toISOString(),
    dept_name: 'الكاشير الرئيسي',
    dept_code: 'K01',
};

const TEA = {
    id: 501,
    name_ar: 'شاي',
    name_en: 'Tea',
    barcode: '6281000000011',
    price: 10,
    cost_price: 3,
    stock_quantity: 40,
    vat_rate: 15,
    category: 'مشروبات',
    unit: 'كوب',
    department_id: 7,
    is_active: true,
    min_stock_level: 5,
    image_url: '/v3/img/pos/pos-juice.webp',
    ingredient_count: 0,
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function stubFetch() {
    const mock = vi.fn(async (input: RequestInfo | URL) => {
        const href = String(input);
        if (href.includes('/api/pos/departments')) { return json([DEPARTMENT]); }
        if (href.includes('/api/pos/shifts/active')) { return json(SHIFT); }
        if (href.includes('/api/pos/products')) { return json([TEA]); }
        if (href.includes('/api/pos/held-orders')) { return json([]); }
        if (href.includes('/api/sales')) { return json([]); }
        return json({ error: 'NOT_FOUND' }, 404);
    });
    vi.stubGlobal('fetch', mock);
    return mock;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <PosEntry />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    mocks.role = 'cashier';
});

describe('واجهة الكاشير — دور cashier فقط', () => {
    it('لا يظهر ترس الضبط ولا أدوات الأسعار ولا أزرار الصور', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /إضافة شاي إلى السلة/ })).toBeTruthy();
        });

        // ترس الضبط (إدارة الأصناف والأسعار) — مخفي تمامًا
        expect(screen.queryByRole('button', { name: /ترس الضبط/ })).toBeNull();
        // تعديل سعر الصنف من البطاقة
        expect(screen.queryByRole('button', { name: /تعديل سعر شاي/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /تغيير سعر شاي/ })).toBeNull();
        // أزرار رفع/حذف صورة المنتج
        expect(screen.queryByRole('button', { name: /رفع أو تغيير صورة/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /حذف صورة/ })).toBeNull();
    });

    it('الشاشة تظل مكتملة: الأصناف والبحث والفئات وزر الدفع موجودة', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /إضافة شاي إلى السلة/ })).toBeTruthy();
        });

        // البحث موجود (F2)
        expect(screen.getByPlaceholderText(/اسم الصنف أو الباركود/)).toBeTruthy();
        // زر إتمام البيع والدفع موجود — الكاشير لازم يقدر يبيع
        expect(screen.getByRole('button', { name: /إتمام البيع والدفع/ })).toBeTruthy();
        // الفئات (الأصناف الحقيقية) ظاهرة
        expect(screen.getByRole('button', { name: /مشروبات/ })).toBeTruthy();
    });

    it('زر الترس يظهر لمدير النظام — الفرق بالصلاحية مش بالاخفاء الكوني', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /إضافة شاي إلى السلة/ })).toBeTruthy();
        });

        expect(screen.getByRole('button', { name: /ترس الضبط/ })).toBeTruthy();
    });
});
