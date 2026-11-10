import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScanItem } from '../lib/goods-scan';
import { GoodsScan } from './GoodsScan';

const mocks = vi.hoisted(() => ({
    role: 'warehouse',
    loadCampaign: vi.fn(),
    lookupByCode: vi.fn(),
    searchItems: vi.fn(),
    fetchScanDepartments: vi.fn(),
    assignItemBarcode: vi.fn(),
    receiveInventoryItem: vi.fn(),
    createDispatch: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '1', name: 'مستخدم اختبار', username: 'test', role: mocks.role },
    }),
}));

vi.mock('../lib/goods-scan', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/goods-scan')>();
    return {
        ...original,
        loadCampaign: mocks.loadCampaign,
        lookupByCode: mocks.lookupByCode,
        searchItems: mocks.searchItems,
        fetchScanDepartments: mocks.fetchScanDepartments,
        assignItemBarcode: mocks.assignItemBarcode,
        receiveInventoryItem: mocks.receiveInventoryItem,
        createDispatch: mocks.createDispatch,
    };
});

const rows: ScanItem[] = [
    {
        id: 1,
        name: 'أرز',
        category: 'غلال',
        unit: 'كيس',
        qty: 6,
        avgCost: 8,
        minQty: 2,
        mainQty: 6,
        weight: null,
        barcode: '4006381333931',
        shelfId: null,
    },
    {
        id: 2,
        name: 'سكر',
        category: 'غلال',
        unit: 'كيس',
        qty: 9,
        avgCost: 7,
        minQty: 2,
        mainQty: 9,
        weight: null,
        barcode: '96385074',
        shelfId: null,
    },
    {
        id: 3,
        name: 'ملح',
        category: 'توابل',
        unit: 'كيس',
        qty: 4,
        avgCost: 3,
        minQty: 1,
        mainQty: 4,
        weight: null,
        barcode: null,
        shelfId: null,
    },
];

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <GoodsScan />
        </QueryClientProvider>,
    );
}

async function scan(code: string) {
    fireEvent.change(screen.getByLabelText('الكود المقروء'), { target: { value: code } });
    fireEvent.click(screen.getByRole('button', { name: /حلّ الكود/ }));
    await waitFor(() => expect(mocks.lookupByCode).toHaveBeenCalledWith(code));
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'warehouse';
    mocks.loadCampaign.mockResolvedValue({ rows, total: rows.length, truncated: false });
    mocks.lookupByCode.mockImplementation(async (code: string) => ({
        rows,
        total: rows.length,
        truncated: false,
        matches: rows.filter((item) => item.barcode === code),
        code,
    }));
    mocks.searchItems.mockImplementation(async (query: string) => rows.filter((item) => item.name?.includes(query)));
    mocks.fetchScanDepartments.mockResolvedValue([{ code: 'KITCHEN', name: 'المطبخ' }]);
    mocks.assignItemBarcode.mockResolvedValue(undefined);
    mocks.receiveInventoryItem.mockResolvedValue(undefined);
    mocks.createDispatch.mockResolvedValue(undefined);
});

afterEach(() => {
    delete (window as Window & { Html5Qrcode?: unknown }).Html5Qrcode;
    delete (window as Window & { Html5QrcodeSupportedFormats?: unknown }).Html5QrcodeSupportedFormats;
    vi.unstubAllGlobals();
});

describe('مسح البضاعة', () => {
    it('يربط الكود غير المعياري بعد البحث، ولا يرسل إلا حقل الباركود', async () => {
        renderScreen();
        await screen.findByText(/2\/3 مربوط/);
        await scan('INTERNAL-77');

        const search = screen.getByLabelText('ابحث عن الصنف بالاسم');
        fireEvent.change(search, { target: { value: 'ملح' } });
        fireEvent.click(await screen.findByRole('button', { name: /ملح/ }));

        await waitFor(() => expect(mocks.assignItemBarcode).toHaveBeenCalledWith(3, 'INTERNAL-77'));
        expect(screen.getByRole('status').textContent).toContain('ربطٌ تمّ');
    });

    it('يسجل أسطر الوارد بالتتابع، ويبقي الفاشل لإعادة المحاولة', async () => {
        let releaseFirst: (() => void) | undefined;
        const firstReceipt = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const started: number[] = [];
        mocks.receiveInventoryItem.mockImplementation(async (id: number) => {
            started.push(id);
            if (id === 1) {
                await firstReceipt;
            } else {
                throw new Error('فشل الصنف الثاني');
            }
        });

        renderScreen();
        await screen.findByText(/2\/3 مربوط/);
        fireEvent.click(screen.getByRole('tab', { name: /وارد بالمسح/ }));
        await scan('4006381333931');
        await scan('96385074');
        fireEvent.click(screen.getByRole('button', { name: 'تسجيل الوارد' }));

        await waitFor(() => expect(mocks.receiveInventoryItem).toHaveBeenCalledTimes(1));
        expect(started).toEqual([1]);
        releaseFirst?.();
        await waitFor(() => expect(mocks.receiveInventoryItem).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.getByRole('status').textContent).toContain('فشل الصنف الثاني'));
        expect(started).toEqual([1, 2]);
    });

    it('ينشئ إذن صرف معلّقًا لأدوار الأقسام بعد اختيار القسم', async () => {
        mocks.role = 'kitchen';
        renderScreen();
        await screen.findByText(/2\/3 مربوط/);
        fireEvent.click(screen.getByRole('tab', { name: /صرف \(أذون\)/ }));
        await screen.findByRole('option', { name: 'المطبخ' });
        await scan('4006381333931');
        fireEvent.change(screen.getByLabelText('القسم الطالب *'), { target: { value: 'KITCHEN' } });
        fireEvent.click(screen.getByRole('button', { name: 'إرسال أذون الصرف' }));

        await waitFor(() => expect(mocks.createDispatch).toHaveBeenCalledOnce());
        expect(mocks.createDispatch.mock.calls[0]?.[0]).toMatchObject({
            deptCode: 'KITCHEN',
            status: 'pending',
            items: [{ itemName: 'أرز', qty: 1, unit: 'كيس' }],
        });
    });

    it('يمنع الربط والوارد عن دور القراءة فقط', async () => {
        mocks.role = 'accountant';
        renderScreen();
        await scan('INTERNAL-77');

        expect(screen.queryByLabelText('ابحث عن الصنف بالاسم')).toBeNull();
        expect(mocks.assignItemBarcode).not.toHaveBeenCalled();
        expect(screen.getByRole('status').textContent).toContain('لا يكتب');
    });

    it('يوقف الكتابة عندما تكون نتائج الباركود مقتطعة', async () => {
        mocks.lookupByCode.mockResolvedValueOnce({
            rows,
            total: 2500,
            truncated: true,
            matches: [rows[0]],
            code: '4006381333931',
        });
        renderScreen();
        await screen.findByText(/2\/3 مربوط/);
        fireEvent.click(screen.getByRole('tab', { name: /وارد بالمسح/ }));
        await scan('4006381333931');

        expect(screen.getByRole('status').textContent).toContain('أُوقفت الكتابة');
        expect(mocks.receiveInventoryItem).not.toHaveBeenCalled();
    });

    it('يشغّل قارئ الكاميرا المحلي ويوقفه عند الطلب', async () => {
        const start = vi.fn(async () => undefined);
        const stop = vi.fn(async () => undefined);
        Object.defineProperty(window, 'Html5Qrcode', {
            configurable: true,
            value: class {
                start = start;
                stop = stop;
            },
        });
        Object.defineProperty(window, 'Html5QrcodeSupportedFormats', {
            configurable: true,
            value: { EAN_13: 1, QR_CODE: 2 },
        });

        renderScreen();
        fireEvent.click(screen.getByRole('button', { name: 'كاميرا' }));
        await waitFor(() => expect(start).toHaveBeenCalledOnce());
        fireEvent.click(screen.getByRole('button', { name: 'إيقاف الكاميرا' }));
        await waitFor(() => expect(stop).toHaveBeenCalledWith(true));
    });
});
