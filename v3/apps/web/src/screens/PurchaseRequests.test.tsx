import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { PurchaseRequests } from './PurchaseRequests';

/**
 * طلبات الشراء — القراءة كما كانت، والكتابة بتكافؤ V2:
 *  • ظهور/إخفاء الأزرار السياقية حسب الدور والحالة (بوابات `pr-repo.js`).
 *  • نجاح/فشل كل عملية مع نص V2 نفسه للتوست.
 *  • تأكيد الإلغاء والحذف بنص V2.
 *  • لوحة الإنشاء: نواقص مختارة + صفوف يدوية + قسم طالب + توقيع للمطبخ.
 */

const mocks = vi.hoisted(() => ({
    role: 'warehouse',
    createPR: vi.fn(),
    chefApprovePR: vi.fn(),
    chefRejectPR: vi.fn(),
    gmApprovePR: vi.fn(),
    gmRejectPR: vi.fn(),
    cancelPR: vi.fn(),
    deletePR: vi.fn(),
    fetchDepartments: vi.fn(),
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
    fetchDepartments: mocks.fetchDepartments,
}));

vi.mock('../lib/purchase-requests-write', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/purchase-requests-write')>();
    return {
        ...original,
        createPR: mocks.createPR,
        chefApprovePR: mocks.chefApprovePR,
        chefRejectPR: mocks.chefRejectPR,
        gmApprovePR: mocks.gmApprovePR,
        gmRejectPR: mocks.gmRejectPR,
        cancelPR: mocks.cancelPR,
        deletePR: mocks.deletePR,
    };
});

const requests = [
    {
        id: 3,
        request_number: 'PR-1003',
        status: 'approved',
        items: [
            { itemName: 'لحم', requestedQty: '4' },
            { name: 'بهارات', qty: '1' },
        ],
        creator_name: 'أمين مخزن',
        chef_approved_name: 'الشيف العمومي',
        gm_approved_name: 'المدير العام',
        wh_received_name: null,
        created_at: '2026-11-05T10:00:00.000Z',
    },
    {
        id: 2,
        request_number: 'PR-1002',
        status: 'chef_approved',
        items: [{ itemName: 'دقيق', qty: '10' }],
        creator_name: 'أمين مخزن',
        chef_approved_name: 'الشيف العمومي',
        created_at: '2026-11-04T09:00:00.000Z',
    },
    {
        id: 1,
        request_number: 'PR-1001',
        status: 'pending',
        items: [
            { itemName: 'دجاج', requestedQty: '2' },
            { name: 'أرز', qty: '5' },
            { name: 'زيت', qty: '3' },
        ],
        creator_name: 'أمين مخزن',
        created_at: '2026-11-03T08:00:00.000Z',
    },
    {
        id: 4,
        request_number: 'PR-1004',
        status: 'rejected',
        items: [{ itemName: 'سكر', qty: '1' }],
        creator_name: 'رئيس القسم',
        rejected_name: 'الشيف',
        rejection_reason: 'كمية مبالغة',
        created_at: '2026-11-02T07:00:00.000Z',
    },
];

const shortages = [
    { itemId: 11, itemName: 'طماطم', unit: 'كجم', currentQty: 2, minQty: 8, suggestedQty: 6 },
    { itemId: 12, itemName: 'بصل', unit: 'كجم', currentQty: 0, minQty: 4, suggestedQty: 4 },
];

const departments = [
    { id: 1, code: 'K', name: 'المطبخ' },
    { id: 2, code: 'ys_1', name: 'مرآة' },
];

const SIGNATURE = 'data:image/png;base64,iVBORw0KGgo=';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(options: { fail?: boolean; shortagesFail?: boolean } = {}): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            urls.push(String(url));
            if (options.fail && String(url).includes('/api/warehouse/purchase-requests')) {
                return json({ error: 'FAILED', message: 'تعذر جلب طلبات الشراء' }, 500);
            }
            if (String(url).includes('/api/warehouse/purchase-requests/shortages')) {
                return options.shortagesFail
                    ? json({ error: 'FAILED', message: 'تعذر جلب النواقص' }, 500)
                    : json(shortages);
            }
            if (String(url).includes('/api/warehouse/purchase-requests')) {
                return json(requests);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <PurchaseRequests />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function requestRows(): HTMLElement[] {
    const region = screen.getByRole('region', { name: 'جدول طلبات الشراء' });
    return within(region).getAllByRole('row').slice(1) as HTMLElement[];
}

function summaryLine(): string {
    return screen.getByRole('status').textContent ?? '';
}

function submitForm(id: string): void {
    const form = document.getElementById(id);
    if (!form) {
        throw new Error(`النموذج ${id} غير موجود`);
    }
    fireEvent.submit(form);
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;

beforeAll(() => {
    const fakeContext = new Proxy({}, { get: () => () => undefined });
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: () => fakeContext,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        configurable: true,
        value: () => SIGNATURE,
    });
});

afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value: originalGetContext,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', {
        configurable: true,
        value: originalToDataURL,
    });
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'warehouse';
    mocks.createPR.mockResolvedValue({ requestNumber: 'PR-2000' });
    mocks.chefApprovePR.mockResolvedValue(undefined);
    mocks.chefRejectPR.mockResolvedValue(undefined);
    mocks.gmApprovePR.mockResolvedValue(undefined);
    mocks.gmRejectPR.mockResolvedValue(undefined);
    mocks.cancelPR.mockResolvedValue(undefined);
    mocks.deletePR.mockResolvedValue(undefined);
    mocks.fetchDepartments.mockResolvedValue(departments);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('طلبات شراء النواقص — القراءة', () => {
    it('يعرض الصفوف وتسميات الحالة وسلسلة التواقيع وملخص الأصناف', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(requestRows()).toHaveLength(4);
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('طلبات شراء النواقص');
        expect(summaryLine()).toContain('4 طلبًا (من 4)');
        expect(summaryLine()).toContain('معلقة 1');
        expect(summaryLine()).toContain('موقّعة 1');
        expect(summaryLine()).toContain('معتمدة 1');

        const pending = screen.getByText('PR-1001').closest('tr') as HTMLElement;
        expect(within(pending).getByText('دجاج (2)، أرز (5) +1')).toBeTruthy();
        expect(within(pending).getByText('بانتظار الشيف')).toBeTruthy();
        expect(within(pending).getAllByText('—')).toHaveLength(3);

        const approved = screen.getByText('PR-1003').closest('tr') as HTMLElement;
        expect(within(approved).getByText('معتمد نهائيًا')).toBeTruthy();
        expect(within(approved).getByText('الشيف العمومي')).toBeTruthy();
        expect(within(approved).getByText('المدير العام')).toBeTruthy();
        expect(within(approved).getAllByText('—')).toHaveLength(1);

        const rejected = screen.getByText('PR-1004').closest('tr') as HTMLElement;
        expect(within(rejected).getByText('مرفوض')).toBeTruthy();
    });

    it('يترشّح بشرائح الحالة كما في القديم', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(requestRows()).toHaveLength(4);
        });

        fireEvent.click(screen.getByRole('button', { name: 'مرفوض (1)' }));
        await waitFor(() => {
            expect(requestRows()).toHaveLength(1);
        });
        expect(requestRows()[0]?.textContent).toContain('PR-1004');
        expect(summaryLine()).toContain('1 طلبًا (من 4)');

        fireEvent.click(screen.getByRole('button', { name: 'موقّع من الشيف (1)' }));
        await waitFor(() => {
            expect(requestRows()).toHaveLength(1);
        });
        expect(requestRows()[0]?.textContent).toContain('PR-1002');

        fireEvent.click(screen.getByRole('button', { name: 'الكل (4)' }));
        await waitFor(() => {
            expect(requestRows()).toHaveLength(4);
        });
    });

    it('يرتّب برقم الطلب صعودًا ثم هبوطًا', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(requestRows()).toHaveLength(4);
        });

        fireEvent.click(screen.getByRole('button', { name: 'الطلب' }));
        await waitFor(() => {
            expect(requestRows()[0]?.textContent).toContain('PR-1001');
        });

        fireEvent.click(screen.getByRole('button', { name: 'الطلب' }));
        await waitFor(() => {
            expect(requestRows()[0]?.textContent).toContain('PR-1004');
        });
    });

    it('يعرض النواقص الاستشارية بالرصيد والحد الأدنى والعجز', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByText('طماطم')).toBeTruthy();
        });
        const region = screen.getByRole('region', { name: 'جدول النواقص الحالية' });
        expect(within(region).getAllByRole('row')).toHaveLength(3);
        expect(within(region).getByText('بصل')).toBeTruthy();
        expect(within(region).getAllByText('كجم')).toHaveLength(2);
        expect(screen.getByRole('heading', { name: /النواقص الحالية/ }).textContent).toContain('(2)');
    });

    it('فشل النواقص استشاري — الجدول يبقى كاملًا', async () => {
        stubFetch({ shortagesFail: true });
        renderScreen();

        await waitFor(() => {
            expect(requestRows()).toHaveLength(4);
        });
        expect(screen.getByText('لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى).')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch({ fail: true });
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});

describe('طلبات شراء النواقص — الأزرار حسب الدور والحالة', () => {
    it('warehouse: زر طلب جديد وإلغاء المعلّق والموقّع، بلا توقيع أو حذف', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await screen.findByText('PR-1001');

        expect(screen.getByRole('button', { name: 'طلب شراء جديد' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إلغاء PR-1001' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إلغاء PR-1002' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'توقيع الشيف PR-1001' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'اعتماد المدير العام PR-1002' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'حذف نهائي PR-1001' })).toBeNull();
    });

    it('kitchen: يوقّع ويرفض المعلّق فقط، ولا يحذف', async () => {
        mocks.role = 'kitchen';
        stubFetch();
        renderScreen();
        await screen.findByText('PR-1001');

        expect(screen.getByRole('button', { name: 'طلب شراء جديد' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'توقيع الشيف PR-1001' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'رفض الشيف PR-1001' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'اعتماد المدير العام PR-1002' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'حذف نهائي PR-1001' })).toBeNull();
    });

    it('admin: يوقّع ويعتمد ويحذف غير المعتمد، والحالات المحمية بلا حذف', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        await screen.findByText('PR-1001');

        expect(screen.getByRole('button', { name: 'توقيع الشيف PR-1001' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'اعتماد المدير العام PR-1002' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'رفض المدير العام PR-1002' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حذف نهائي PR-1001' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'حذف نهائي PR-1002' })).toBeTruthy();
        // المعتمد نهائيًا محمي بخادمه — لا زر حذف ولا إلغاء.
        expect(screen.queryByRole('button', { name: 'حذف نهائي PR-1003' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'إلغاء PR-1003' })).toBeNull();
    });

    it('accountant: يقرأ فقط — لا زر إنشاء ولا أزرار قرار', async () => {
        mocks.role = 'accountant';
        stubFetch();
        renderScreen();
        await screen.findByText('PR-1001');

        expect(screen.queryByRole('button', { name: 'طلب شراء جديد' })).toBeNull();
        expect(screen.queryByRole('button', { name: /توقيع الشيف/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /إلغاء PR-/ })).toBeNull();
    });
});

describe('طلبات شراء النواقص — قرارات V2', () => {
    it('توقيع الشيف: يرسل الملاحظات والتوقيع ويظهر توست V2', async () => {
        mocks.role = 'kitchen';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'توقيع الشيف PR-1001' }));

        expect(await screen.findByRole('dialog')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('ملاحظات الشيف (اختياري)'), { target: { value: ' تمّ ' } });
        submitForm('erp-pr-decision-form');

        await waitFor(() => {
            expect(mocks.chefApprovePR).toHaveBeenCalledTimes(1);
        });
        expect(mocks.chefApprovePR).toHaveBeenCalledWith('1', {
            notes: 'تمّ',
            signatureData: SIGNATURE,
            signerName: 'مستخدم اختبار',
        });
        expect(await screen.findByText('وقّع الشيف — الطلب الآن بانتظار المدير العام')).toBeTruthy();
    });

    it('رفض الشيف: سبب قصير يُرفض بنص V2، والصالح يُرسل', async () => {
        mocks.role = 'kitchen';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'رفض الشيف PR-1001' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('سبب الرفض'), { target: { value: 'لا' } });
        submitForm('erp-pr-decision-form');
        expect(await screen.findByText('سبب الرفض مطلوب (3 أحرف على الأقل)')).toBeTruthy();
        expect(mocks.chefRejectPR).not.toHaveBeenCalled();

        fireEvent.change(screen.getByLabelText('سبب الرفض'), { target: { value: ' كمية مبالغ فيها ' } });
        submitForm('erp-pr-decision-form');
        await waitFor(() => {
            expect(mocks.chefRejectPR).toHaveBeenCalledTimes(1);
        });
        expect(mocks.chefRejectPR).toHaveBeenCalledWith('1', {
            reason: 'كمية مبالغ فيها',
            signatureData: SIGNATURE,
            signerName: 'مستخدم اختبار',
        });
        expect(await screen.findByText('رفض الشيف الطلب')).toBeTruthy();
    });

    it('اعتماد المدير العام النهائي يعتمد الموقّع من الشيف', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'اعتماد المدير العام PR-1002' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        submitForm('erp-pr-decision-form');

        await waitFor(() => {
            expect(mocks.gmApprovePR).toHaveBeenCalledTimes(1);
        });
        expect(mocks.gmApprovePR).toHaveBeenCalledWith('2', {
            notes: '',
            signatureData: SIGNATURE,
            signerName: 'مستخدم اختبار',
        });
        expect(await screen.findByText('اعتمد المدير العام الطلب نهائيًا')).toBeTruthy();
    });

    it('فشل القرار يُبقي اللوحة مفتوحة ويظهر رسالة الخادم', async () => {
        mocks.role = 'kitchen';
        mocks.chefApprovePR.mockRejectedValueOnce(new Error('تعذر توقيع الشيف على طلب الشراء'));
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'توقيع الشيف PR-1001' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        submitForm('erp-pr-decision-form');

        await waitFor(() => {
            expect(mocks.chefApprovePR).toHaveBeenCalledTimes(1);
        });
        expect((await screen.findAllByText('تعذر توقيع الشيف على طلب الشراء')).length).toBeGreaterThan(0);
        expect(screen.getByRole('dialog')).toBeTruthy();
    });
});

describe('طلبات شراء النواقص — الإلغاء والحذف', () => {
    it('الإلغاء يطلب تأكيد V2 ثم يلغي ويظهر توست V2', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'إلغاء PR-1001' }));

        expect(await screen.findByText('إلغاء طلب الشراء المعلّق؟')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
        await waitFor(() => {
            expect(mocks.cancelPR).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('أُلغي طلب الشراء')).toBeTruthy();
    });

    it('إلغاء التأكيد لا يرسل شيئًا', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'إلغاء PR-1001' }));
        expect(await screen.findByText('إلغاء طلب الشراء المعلّق؟')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'إلغاء' }));
        expect(mocks.cancelPR).not.toHaveBeenCalled();
    });

    it('الحذف النهائي بتأكيد V2 الحرفي', async () => {
        mocks.role = 'admin';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'حذف نهائي PR-1001' }));

        expect(await screen.findByText('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'تأكيد' }));
        await waitFor(() => {
            expect(mocks.deletePR).toHaveBeenCalledWith('1');
        });
        expect(await screen.findByText('حُذف الطلب نهائيًا')).toBeTruthy();
    });
});

describe('طلبات شراء النواقص — لوحة الإنشاء', () => {
    it('warehouse: ينشئ من النواقص المختارة والصفوف اليدوية بنص V2', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'طلب شراء جديد' }));

        expect(await screen.findByRole('dialog')).toBeTruthy();
        expect(await screen.findByRole('option', { name: 'المطبخ' })).toBeTruthy();
        fireEvent.click(screen.getByLabelText('اختيار بصل'));
        fireEvent.click(screen.getByRole('button', { name: 'صف جديد' }));
        fireEvent.change(screen.getByLabelText('اسم الصنف اليدوي 1'), { target: { value: ' خضار ' } });
        fireEvent.change(screen.getByLabelText('الكمية المطلوبة للصنف اليدوي 1'), { target: { value: '3' } });
        submitForm('erp-pr-create-form');

        await waitFor(() => {
            expect(mocks.createPR).toHaveBeenCalledTimes(1);
        });
        expect(mocks.createPR.mock.calls[0]?.[0]).toEqual({
            items: [
                { itemId: 11, itemName: 'طماطم', unit: 'كجم', requestedQty: 6 },
                { itemId: null, itemName: 'خضار', unit: 'وحدة', requestedQty: 3 },
            ],
            notes: '',
            deptCode: 'K',
            signatureData: null,
            signerName: null,
        });
        expect(await screen.findByText('أُنشئ طلب الشراء PR-2000 — بانتظار توقيع الشيف')).toBeTruthy();
    });

    it('بلا أصناف مختارة يرفض بنص V2 ولا يرسل', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'طلب شراء جديد' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();

        fireEvent.click(screen.getByLabelText('تحديد كل النواقص'));
        submitForm('erp-pr-create-form');
        expect(await screen.findByText('اختر صنفًا واحدًا على الأقل بكمية موجبة')).toBeTruthy();
        expect(mocks.createPR).not.toHaveBeenCalled();
    });

    it('kitchen: إنشاء موقّع من الشيف نهائي ويحمل التوقيع', async () => {
        mocks.role = 'kitchen';
        stubFetch();
        renderScreen();
        fireEvent.click(await screen.findByRole('button', { name: 'طلب شراء جديد' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        submitForm('erp-pr-create-form');

        await waitFor(() => {
            expect(mocks.createPR).toHaveBeenCalledTimes(1);
        });
        const payload = mocks.createPR.mock.calls[0]?.[0] as { signatureData: string; signerName: string };
        expect(payload.signatureData).toBe(SIGNATURE);
        expect(payload.signerName).toBe('مستخدم اختبار');
        expect(await screen.findByText('أُنشئ طلب الشراء PR-2000 موقّعًا منك — نهائي ولدى المخزن مباشرة')).toBeTruthy();
    });
});
