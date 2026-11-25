import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import type { InventoryLite, Shelf } from '../lib/shelves';
import { ToastProvider } from '../ui/Toast';
import { Shelves } from './Shelves';

const mocks = vi.hoisted(() => ({
    role: 'warehouse',
    fetchShelves: vi.fn(),
    fetchShelfInventory: vi.fn(),
    fetchCurrency: vi.fn(),
    createShelf: vi.fn(),
    updateShelf: vi.fn(),
    deleteShelf: vi.fn(),
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

vi.mock('../lib/finance', () => ({
    fetchCurrency: mocks.fetchCurrency,
}));

vi.mock('../lib/shelves', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/shelves')>();
    return {
        ...original,
        fetchShelves: mocks.fetchShelves,
        fetchShelfInventory: mocks.fetchShelfInventory,
        createShelf: mocks.createShelf,
        updateShelf: mocks.updateShelf,
        deleteShelf: mocks.deleteShelf,
    };
});

const shelf: Shelf = { id: '1', name: 'رف أ', code: 'A1', location: 'المخزن الرئيسي', capacity: 10 };
const item: InventoryLite = { id: '11', name: 'طماطم', unit: 'كجم', qty: 2, avgCost: 5, shelfId: '1' };

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Shelves />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function submitForm(): void {
    const form = document.getElementById('erp-shelf-form');
    if (!form) {
        throw new Error('نموذج الرف غير موجود');
    }
    fireEvent.submit(form);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'warehouse';
    mocks.fetchShelves.mockResolvedValue([shelf]);
    mocks.fetchShelfInventory.mockResolvedValue([item]);
    mocks.fetchCurrency.mockResolvedValue('SAR');
    mocks.createShelf.mockResolvedValue(undefined);
    mocks.updateShelf.mockResolvedValue(undefined);
    mocks.deleteShelf.mockResolvedValue(undefined);
});

describe('الرفوف — تكافؤ الكتابة مع V2', () => {
    it('يعرض إضافة/تعديل/حذف لدور مخوّل (warehouse)', async () => {
        renderScreen();
        expect(await screen.findByText('رف أ')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إضافة رف' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'تعديل الرف رف أ' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حذف الرف رف أ' })).toBeTruthy();
    });

    it('يخفي الكتابة عن دور غير مخوّل (accountant) — مثل بوابة V2', async () => {
        mocks.role = 'accountant';
        renderScreen();
        expect(await screen.findByText('رف أ')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'إضافة رف' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'تعديل الرف رف أ' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'حذف الرف رف أ' })).toBeNull();
    });

    it('التحقق يمنع الحفظ الفارغ برسالة V2 نفسها ويركّز على الحقل', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'إضافة رف' }));
        submitForm();
        expect(await screen.findByText('حقول مطلوبة ناقصة: name')).toBeTruthy();
        expect(document.activeElement?.getAttribute('name')).toBe('name');
        expect(mocks.createShelf).not.toHaveBeenCalled();
    });

    it('يرفض الكود المكرّر قبل بلوغ الخادم', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'إضافة رف' }));
        const form = document.getElementById('erp-shelf-form') as HTMLFormElement;
        fireEvent.input(form.querySelector('[name="name"]') as HTMLInputElement, { target: { value: 'رف ب' } });
        fireEvent.input(form.querySelector('[name="code"]') as HTMLInputElement, { target: { value: 'a1' } });
        submitForm();
        expect(await screen.findByText('الكود موجود بالفعل')).toBeTruthy();
        expect(mocks.createShelf).not.toHaveBeenCalled();
    });

    it('ينشئ رفًّا ويظهر توست V2 ثم يغلق النموذج', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'إضافة رف' }));
        const form = document.getElementById('erp-shelf-form') as HTMLFormElement;
        fireEvent.input(form.querySelector('[name="name"]') as HTMLInputElement, { target: { value: 'رف جديد' } });
        fireEvent.input(form.querySelector('[name="code"]') as HTMLInputElement, { target: { value: 'b2' } });
        fireEvent.input(form.querySelector('[name="location"]') as HTMLInputElement, { target: { value: 'مخزن 2' } });
        fireEvent.input(form.querySelector('[name="capacity"]') as HTMLInputElement, { target: { value: '25' } });
        submitForm();
        await waitFor(() => {
            expect(mocks.createShelf).toHaveBeenCalledTimes(1);
        });
        expect(mocks.createShelf.mock.calls[0]?.[0]).toMatchObject({
            name: 'رف جديد',
            code: 'b2',
            location: 'مخزن 2',
            capacity: '25',
        });
        expect(await screen.findByText('تمت إضافة الرف «رف جديد»')).toBeTruthy();
        expect(document.getElementById('erp-shelf-form')).toBeNull();
    });

    it('التعديل يفتح النموذج معطّل الكود ويحفظ بتحديث دون كود', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'تعديل الرف رف أ' }));
        const name = document.querySelector('[name="name"]') as HTMLInputElement;
        const code = document.querySelector('[name="code"]') as HTMLInputElement;
        expect(name.value).toBe('رف أ');
        expect(code.value).toBe('A1');
        expect(code.disabled).toBe(true);
        fireEvent.input(name, { target: { value: 'رف أ المعدّل' } });
        submitForm();
        await waitFor(() => {
            expect(mocks.updateShelf).toHaveBeenCalledTimes(1);
        });
        expect(mocks.updateShelf.mock.calls[0]?.[0]).toBe('1');
        expect(mocks.updateShelf.mock.calls[0]?.[1]).toMatchObject({ name: 'رف أ المعدّل' });
        expect(await screen.findByText('تم تحديث الرف «رف أ المعدّل»')).toBeTruthy();
    });

    it('الحذف يطلب تأكيد V2 بنصّ الأصناف ثم يحذف', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'حذف الرف رف أ' }));
        expect(await screen.findByText('حذف الرف «رف أ»؟ ستُزال تعيينات أصنافه (1 صنفًا) ولن تُحذف الأصناف نفسها.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
        await waitFor(() => {
            expect(mocks.deleteShelf).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('تم حذف الرف «رف أ»')).toBeTruthy();
    });

    it('إلغاء التأكيد لا يحذف', async () => {
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'حذف الرف رف أ' }));
        fireEvent.click(await screen.findByRole('button', { name: 'إلغاء' }));
        expect(mocks.deleteShelf).not.toHaveBeenCalled();
    });
});
