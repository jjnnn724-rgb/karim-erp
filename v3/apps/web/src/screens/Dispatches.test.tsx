import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ApiError } from '../lib/api';
import { riyadhToday } from '../lib/finance';
import { ToastProvider } from '../ui/Toast';
import { Dispatches } from './Dispatches';

/**
 * أذون الصرف — القراءة بقواعد V2 كما كانت، والكتابة بدورتها الكاملة:
 * زر لكل عملية يظهر بقائمة الدور نفسه وبحالة الإذن وحدها، تأكيد/نجاح/خطأ
 * بنصوص V2، وتوقيع إلكتروني للقرارات الخمسة، وإبطال استعلام السجل بعد كل كتابة.
 */

const mocks = vi.hoisted(() => ({
    role: 'accountant',
    signerName: 'مستخدم اختبار',
    createDispatch: vi.fn(),
    editDispatch: vi.fn(),
    deleteDispatch: vi.fn(),
    chefApproveDispatch: vi.fn(),
    chefRejectDispatch: vi.fn(),
    approveDispatch: vi.fn(),
    rejectDispatch: vi.fn(),
    receiveDispatch: vi.fn(),
    reopenDispatch: vi.fn(),
}));

vi.mock('../lib/auth', () => ({
    getAccessToken: () => 'test-token',
    getAppKey: () => null,
    useAuthState: () => ({
        status: 'authenticated',
        token: 'test-token',
        user: { id: '7', name: mocks.signerName, username: 'test', role: mocks.role, deptCode: 'K01' },
    }),
}));

vi.mock('../lib/dispatches-write', async (importOriginal) => {
    const original = await importOriginal<typeof import('../lib/dispatches-write')>();
    return {
        ...original,
        createDispatch: mocks.createDispatch,
        editDispatch: mocks.editDispatch,
        deleteDispatch: mocks.deleteDispatch,
        chefApproveDispatch: mocks.chefApproveDispatch,
        chefRejectDispatch: mocks.chefRejectDispatch,
        approveDispatch: mocks.approveDispatch,
        rejectDispatch: mocks.rejectDispatch,
        receiveDispatch: mocks.receiveDispatch,
        reopenDispatch: mocks.reopenDispatch,
    };
});

const today = riyadhToday();

const dispatches = {
    data: [
        {
            id: 101,
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            items: [{ itemName: 'الدجاج', qty: '5', unit: 'كجم' }],
            status: 'pending',
            date: today,
            createdBy: 'أمين مخزن',
            needsChefApproval: true,
        },
        {
            id: 102,
            deptCode: 'K02',
            deptName: 'المخبز',
            items: [{ itemName: 'أرز', qty: '2', unit: 'كجم' }],
            status: 'pending',
            date: today,
            createdBy: 'رئيس القسم',
            needsChefApproval: false,
        },
        {
            id: 103,
            deptCode: 'K03',
            deptName: 'المشويات',
            items: [{ itemName: 'لحم', qty: '1.5', unit: 'كجم' }],
            approvedItems: [{ itemName: 'لحم', qty: '1.5', approvedQty: '1.5', unit: 'كجم' }],
            status: 'chef_approved',
            date: today,
            createdBy: 'أمين مخزن',
            needsChefApproval: true,
        },
        {
            id: 104,
            deptCode: 'K04',
            deptName: 'المطبخ البارد',
            items: [{ itemName: 'زيت', qty: '2', unit: 'لتر' }],
            approvedItems: [{ itemName: 'زيت', qty: '2', approvedQty: '2', unit: 'لتر' }],
            status: 'approved',
            date: today,
            createdBy: 'أمين مخزن',
            needsChefApproval: false,
        },
        {
            id: 105,
            deptCode: 'K05',
            deptName: 'المخزن',
            items: [{ itemName: 'زيت', qty: '2', unit: 'لتر' }],
            status: 'rejected',
            date: '2020-01-01',
            createdBy: 'أمين مخزن',
            needsChefApproval: false,
        },
    ],
    pagination: { totalPages: 1 },
};
const departments = {
    data: [
        { code: 'K01', name: 'المطبخ الرئيسي' },
        { code: 'K02', name: 'المخبز' },
    ],
};

const catalog = [
    { id: 1, name: 'دجاج', unit: 'كجم', qty: '20', mainQty: '20', category: 'لحوم' },
    { id: 2, name: 'أرز', unit: 'كجم', qty: '10', mainQty: '10', category: 'غلال' },
    { id: 3, name: 'زيت', unit: 'لتر', qty: '5', mainQty: '0', category: 'زيوت' },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail = false): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذر جلب الأذون' }, 500);
            }
            if (target.includes('/api/departments')) {
                return json(departments);
            }
            if (target.includes('/api/warehouse/inventory/search')) {
                return json({
                    data: catalog,
                    pagination: { page: 1, limit: 200, total: catalog.length, pages: 1 },
                    categories: ['لحوم', 'غلال', 'زيوت'],
                    fuzzy: false,
                });
            }
            if (target.includes('/api/dispatches')) {
                return json(dispatches);
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Dispatches />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
    return { client, invalidate };
}

function dataRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

function summaryLine(): string {
    return screen.getByRole('status').textContent ?? '';
}

function rowOf(id: string): HTMLElement {
    return screen.getByText(`#${id}`).closest('tr') as HTMLElement;
}

function clickRowAction(id: string, name: RegExp): void {
    fireEvent.click(within(rowOf(id)).getByRole('button', { name }));
}

function submitForm(id: string): void {
    const form = document.getElementById(id);
    if (!form) {
        throw new Error(`النموذج ${id} غير موجود`);
    }
    fireEvent.submit(form);
}

/** يرسم علامة توقيع على اللوحة (canvas مُستبدل بـtoDataURL ثابت). */
function sign(): void {
    fireEvent.pointerDown(screen.getByTestId('dispatch-signature'));
}

async function openCreate(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'طلب صرف جديد' }));
    await waitFor(() => {
        expect(screen.getByRole('option', { name: 'المطبخ الرئيسي' })).toBeTruthy();
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.role = 'accountant';
    mocks.signerName = 'مستخدم اختبار';
    mocks.createDispatch.mockResolvedValue(undefined);
    mocks.editDispatch.mockResolvedValue({ chefApprovalReset: false });
    mocks.deleteDispatch.mockResolvedValue(undefined);
    mocks.chefApproveDispatch.mockResolvedValue(undefined);
    mocks.chefRejectDispatch.mockResolvedValue(undefined);
    mocks.approveDispatch.mockResolvedValue({ totalValue: 50 });
    mocks.rejectDispatch.mockResolvedValue(undefined);
    mocks.receiveDispatch.mockResolvedValue(undefined);
    mocks.reopenDispatch.mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA');
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أذون الصرف — القراءة بقواعد V2', () => {
    it('يعرض الحالات ومراحل السلسلة وملخص الأصناف لنطاق الشهر', async () => {
        stubFetch();
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('أذون الصرف');
        expect(summaryLine()).toContain('4 إذنًا');
        expect(summaryLine()).toContain('بانتظار اعتماد المخزن 2');
        expect(summaryLine()).toContain('معتمد — بانتظار استلام المطبخ 1');
        expect(dataRows()).toHaveLength(4);

        const pending = rowOf('101');
        expect(within(pending).getByText('المطبخ الرئيسي')).toBeTruthy();
        expect(within(pending).getByText('بانتظار اعتماد المخزن')).toBeTruthy();
        expect(within(pending).getByText('بانتظار اعتماد الشيف العمومي')).toBeTruthy();
        expect(within(pending).getByText('الدجاج (5)')).toBeTruthy();

        const chefApproved = rowOf('103');
        expect(within(chefApproved).getByText('معتمد من الشيف — بانتظار المخازن')).toBeTruthy();
        expect(within(chefApproved).getByText('اعتمد الشيف — بانتظار صرف المخازن')).toBeTruthy();

        const approved = rowOf('104');
        expect(within(approved).getByText('معتمد — بانتظار استلام المطبخ')).toBeTruthy();
        expect(within(approved).getByText('صُرف من المخازن — بانتظار الاستلام')).toBeTruthy();
        expect(within(approved).getByText('زيت (2)')).toBeTruthy();
    });

    it('يترشّح بالحالة ويبحث بالصنف بتطبيع عربي ثم يوسّع الفترة', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'chef_approved' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(summaryLine()).toContain('1 إذنًا');

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'ALL' } });
        fireEvent.change(screen.getByLabelText('بحث بالصنف'), { target: { value: 'زيت' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(1);
        });
        expect(summaryLine()).toContain('نتائج «زيت»: 1 إذنًا');

        fireEvent.change(screen.getByLabelText('بحث بالصنف'), { target: { value: '' } });
        fireEvent.change(screen.getByLabelText('من'), { target: { value: '2020-01-01' } });
        await waitFor(() => {
            expect(dataRows()).toHaveLength(5);
        });
        expect(screen.getByText('#105')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(dataRows()).toHaveLength(5);
        });
    });

    it('نطاق «كل السجل» يقرأ بلا فلتر الفترة من الخادم', async () => {
        const urls = stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        expect(urls.some((url) => url.includes('v2_period=month'))).toBe(true);

        fireEvent.change(screen.getByLabelText('النطاق'), { target: { value: 'all' } });
        await waitFor(() => {
            expect(urls.some((url) => url.includes('/api/dispatches') && !url.includes('v2_period='))).toBe(true);
        });
        await waitFor(() => {
            expect(summaryLine()).toContain('كل السجل');
        });
    });

    it('يعرض خطأً قابلًا لإعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('يرفض فترة معكوسة قبل العرض', async () => {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        fireEvent.change(screen.getByLabelText('من'), { target: { value: '2999-01-01' } });
        fireEvent.change(screen.getByLabelText('إلى'), { target: { value: today } });

        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('بداية الفترة بعد نهايتها');
        });
        expect(screen.queryByRole('table')).toBeNull();
    });
});

describe('أذون الصرف — الأزرار حسب الدور والحالة (بوابة V2)', () => {
    async function ready(): Promise<void> {
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
    }

    it('محاسب: بلا زر إنشاء وبلا عمود إجراءات', async () => {
        await ready();
        expect(screen.queryByRole('button', { name: 'طلب صرف جديد' })).toBeNull();
        expect(screen.queryByText('إجراءات')).toBeNull();
        for (const id of ['101', '102', '103', '104']) {
            expect(within(rowOf(id)).queryAllByRole('button')).toHaveLength(0);
        }
    });

    it('مخزن: اعتماد/رفض/حذف الطلبات المعلّقة فقط، بلا قرار شيف أو استلام', async () => {
        mocks.role = 'warehouse';
        await ready();
        expect(screen.getByRole('button', { name: 'طلب صرف جديد' })).toBeTruthy();

        expect(within(rowOf('102')).getByRole('button', { name: /اعتماد وصرف/ })).toBeTruthy();
        expect(within(rowOf('102')).getByRole('button', { name: /رفض المخازن/ })).toBeTruthy();
        expect(within(rowOf('102')).getByRole('button', { name: /حذف/ })).toBeTruthy();
        expect(within(rowOf('103')).getByRole('button', { name: /اعتماد وصرف/ })).toBeTruthy();

        expect(within(rowOf('101')).queryByRole('button', { name: /اعتماد الشيف/ })).toBeNull();
        expect(within(rowOf('104')).queryByRole('button', { name: /استلام/ })).toBeNull();
        expect(within(rowOf('104')).queryByRole('button', { name: /حذف/ })).toBeNull();
        expect(within(rowOf('104')).queryByRole('button', { name: /إرجاع للمخازن للتعديل/ })).toBeNull();
    });

    it('شيف: قرار الشيف على المعلّق المحوَّل واستلام المعتمد، بلا قرار مخازن', async () => {
        mocks.role = 'kitchen';
        await ready();

        expect(within(rowOf('101')).getByRole('button', { name: /اعتماد الشيف/ })).toBeTruthy();
        expect(within(rowOf('101')).getByRole('button', { name: /رفض الشيف/ })).toBeTruthy();
        expect(within(rowOf('101')).getByRole('button', { name: /تعديل/ })).toBeTruthy();
        expect(within(rowOf('104')).getByRole('button', { name: /استلام/ })).toBeTruthy();
        expect(within(rowOf('104')).queryByRole('button', { name: /اعتماد وصرف/ })).toBeNull();
    });

    it('أدمن: كل الأزرار بما فيها الحذف النهائي لأي حالة', async () => {
        mocks.role = 'admin';
        await ready();
        expect(within(rowOf('101')).getByRole('button', { name: /اعتماد الشيف/ })).toBeTruthy();
        expect(within(rowOf('102')).getByRole('button', { name: /اعتماد وصرف/ })).toBeTruthy();
        expect(within(rowOf('104')).getByRole('button', { name: /استلام/ })).toBeTruthy();
        expect(within(rowOf('104')).getByRole('button', { name: /حذف/ })).toBeTruthy();
        expect(within(rowOf('104')).getByRole('button', { name: /إرجاع للمخازن للتعديل/ })).toBeTruthy();
    });

    it('المدير يستطيع إرجاع المعتمد قبل الاستلام مع تسجيل السبب', async () => {
        mocks.role = 'manager';
        await ready();
        expect(within(rowOf('104')).getByRole('button', { name: /إرجاع للمخازن للتعديل/ })).toBeTruthy();
        expect(within(rowOf('104')).queryByRole('button', { name: 'تعديل' })).toBeNull();
        clickRowAction('104', /إرجاع للمخازن للتعديل/);
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText(/سيُعكس خصم المخزون وتكلفة القسم/)).toBeTruthy();
        fireEvent.change(within(dialog).getByLabelText('سبب الإرجاع (إلزامي)'), {
            target: { value: 'تصحيح الكمية' },
        });
        submitForm('erp-dispatch-reopen-form');
        await waitFor(() => {
            expect(mocks.reopenDispatch).toHaveBeenCalledWith('104', 'تصحيح الكمية');
        });
    });

    it('رئيس قسم: إنشاء، وتعديل طلبه المعلّق فقط', async () => {
        mocks.role = 'dept_head';
        await ready();
        expect(screen.getByRole('button', { name: 'طلب صرف جديد' })).toBeTruthy();
        expect(within(rowOf('101')).getByRole('button', { name: /تعديل/ })).toBeTruthy();
        expect(within(rowOf('102')).queryByRole('button', { name: /تعديل/ })).toBeNull();
    });
});

describe('أذون الصرف — طلب صرف جديد', () => {
    it('يرسل أقسام المخزون والحمولة نفسها ويُظهر توست النجاح ويبطل السجل', async () => {
        mocks.role = 'manager';
        const urls = stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        await openCreate();
        expect(screen.getByRole('dialog')).toBeTruthy();
        expect(within(screen.getByRole('dialog')).getByText('طلب صرف جديد')).toBeTruthy();

        fireEvent.change(screen.getByLabelText(/القسم الطالب/), { target: { value: 'K01' } });
        fireEvent.change(screen.getByLabelText('إضافة صنف من المخزن'), { target: { value: 'دجاج' } });
        fireEvent.click(screen.getByRole('button', { name: /الدجاج|دجاج/ }));
        fireEvent.change(screen.getByLabelText('الكمية'), { target: { value: '5' } });

        submitForm('erp-dispatch-request-form');

        await waitFor(() => {
            expect(mocks.createDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.createDispatch.mock.calls[0]?.[0]).toEqual({
            deptCode: 'K01',
            deptName: 'المطبخ الرئيسي',
            items: [{ itemName: 'دجاج', qty: 5, unit: 'كجم' }],
            notes: '',
            status: 'pending',
            date: today,
        });
        await waitFor(() => {
            expect(screen.getByText('تم إرسال طلب الصرف')).toBeTruthy();
        });
        expect(screen.queryByRole('dialog')).toBeNull();
        expect(
            invalidate.mock.calls.some((call) => {
                const options = call[0] as { queryKey?: unknown[] } | undefined;
                return options?.queryKey?.[0] === 'dispatches';
            }),
        ).toBe(true);
        expect(urls.some((url) => url.includes('/api/departments'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/warehouse/inventory/search'))).toBe(true);
    });

    it('يرفض القسم الناقص ثم الأصناف الناقصة بنصوص V2 قبل الإرسال', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        await openCreate();

        submitForm('erp-dispatch-request-form');
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('حدد القسم الطالب');
        });

        fireEvent.change(screen.getByLabelText(/القسم الطالب/), { target: { value: 'K02' } });
        submitForm('erp-dispatch-request-form');
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('أضف صنفًا واحدًا على الأقل');
        });
        expect(mocks.createDispatch).not.toHaveBeenCalled();
    });

    it('يعرض رفض الرصيد من الخادم داخل النموذج ويُبقيه مفتوحًا', async () => {
        mocks.role = 'warehouse';
        mocks.createDispatch.mockRejectedValue(
            new ApiError(409, 'INSUFFICIENT_STOCK', 'لا يمكن قبول إذن الصرف — الرصيد غير كافٍ في المخزن'),
        );
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
        await openCreate();

        fireEvent.change(screen.getByLabelText(/القسم الطالب/), { target: { value: 'K01' } });
        fireEvent.change(screen.getByLabelText('إضافة صنف من المخزن'), { target: { value: 'دجاج' } });
        fireEvent.click(screen.getByRole('button', { name: /الدجاج|دجاج/ }));
        submitForm('erp-dispatch-request-form');

        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
            expect(screen.getByRole('alert').textContent).toContain('الرصيد غير كافٍ في المخزن');
        });
    });
});

describe('أذون الصرف — تعديل قبل الاعتماد', () => {
    it('يحفظ الأصناف والسبب بنفس حمولة V2 ويُظهر نص النجاح', async () => {
        mocks.role = 'kitchen';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('101', /تعديل/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText('تعديل إذن الصرف — المطبخ الرئيسي')).toBeTruthy();
        expect(screen.getByLabelText('سبب التعديل (يُوثَّق في سجل الطلب)')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('سبب التعديل (يُوثَّق في سجل الطلب)'), {
            target: { value: 'تعديل كميات بعد الجرد' },
        });
        submitForm('erp-dispatch-request-form');

        await waitFor(() => {
            expect(mocks.editDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.editDispatch.mock.calls[0]?.[0]).toBe('101');
        // V2 يرسل deptCode الحالي لأن القسم مُهيَّأ في النموذج (dispatch.js:743-748).
        expect(mocks.editDispatch.mock.calls[0]?.[1]).toEqual({
            items: [{ itemName: 'الدجاج', qty: 5, unit: 'كجم' }],
            deptCode: 'K01',
            reason: 'تعديل كميات بعد الجرد',
        });
        await waitFor(() => {
            expect(screen.getByText('تم تعديل الإذن بنجاح')).toBeTruthy();
        });
    });

    it('يعرض تحذير إلغاء اعتماد الشيف ونصّه عند إعادة الاعتماد', async () => {
        mocks.role = 'manager';
        mocks.editDispatch.mockResolvedValue({ chefApprovalReset: true });
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('103', /تعديل/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText(/الحفظ/).textContent).toContain('يلغي الاعتماد');

        submitForm('erp-dispatch-request-form');
        await waitFor(() => {
            expect(screen.getByText('تم التعديل — أُلغي اعتماد الشيف وأُعيد الطلب للمراجعة')).toBeTruthy();
        });
    });
});

describe('أذون الصرف — الحذف', () => {
    it('يطلب تأكيد V2 ثم يحذف بإبطال السجل والمخزون', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('102', /حذف/);
        const confirmDialog = await screen.findByRole('dialog');
        expect(within(confirmDialog).getByText(/حذف طلب الصرف المعلق نهائيًا/)).toBeTruthy();
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'تأكيد' }));

        await waitFor(() => {
            expect(mocks.deleteDispatch).toHaveBeenCalledWith('102');
        });
        await waitFor(() => {
            expect(screen.getByText('حُذف طلب الصرف المعلق')).toBeTruthy();
        });
        const keys = invalidate.mock.calls.map((call) => {
            const options = call[0] as { queryKey?: unknown[] } | undefined;
            return options?.queryKey?.[0];
        });
        expect(keys).toContain('dispatches');
        expect(keys).toContain('inventory');
    });

    it('إلغاء التأكيد لا يحذف', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('102', /حذف/);
        const confirmDialog = await screen.findByRole('dialog');
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'إلغاء' }));
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).toBeNull();
        });
        expect(mocks.deleteDispatch).not.toHaveBeenCalled();
    });

    it('فشل الحذف يظهر بنص الخادم أعلى الشاشة', async () => {
        mocks.role = 'warehouse';
        mocks.deleteDispatch.mockRejectedValue(new ApiError(409, 'DISPATCH_ALREADY_APPROVED', 'تم اعتماد الإذن'));
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('102', /حذف/);
        const confirmDialog = await screen.findByRole('dialog');
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'تأكيد' }));
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('تم اعتماد الإذن');
        });
    });
});

describe('أذون الصرف — القرارات الموقّعة', () => {
    async function readyAs(role: string): Promise<void> {
        mocks.role = role;
        stubFetch();
        renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });
    }

    it('اعتماد الشيف: يرفض بلا توقيع ثم يرسل التوقيع واسم الحساب', async () => {
        await readyAs('kitchen');
        clickRowAction('101', /اعتماد الشيف/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText('اعتماد الشيف العمومي — المطبخ الرئيسي')).toBeTruthy();

        submitForm('erp-dispatch-chef-approve-form');
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('تعذر رسم التوقيع');
        });
        expect(mocks.chefApproveDispatch).not.toHaveBeenCalled();

        sign();
        submitForm('erp-dispatch-chef-approve-form');
        await waitFor(() => {
            expect(mocks.chefApproveDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.chefApproveDispatch.mock.calls[0]?.[0]).toBe('101');
        expect(mocks.chefApproveDispatch.mock.calls[0]?.[1]).toEqual({
            notes: '',
            signatureData: 'data:image/png;base64,AAAA',
            signerName: 'مستخدم اختبار',
        });
        await waitFor(() => {
            expect(screen.getByText('تم اعتماد الطلب وإحالته للمخازن')).toBeTruthy();
        });
    });

    it('رفض الشيف: السبب إلزامي ثم يُرسل بنص V2', async () => {
        await readyAs('kitchen');
        clickRowAction('101', /رفض الشيف/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });

        submitForm('erp-dispatch-chef-reject-form');
        await waitFor(() => {
            expect(screen.getByRole('alert').textContent).toContain('أدخل سبب الرفض');
        });

        fireEvent.change(screen.getByLabelText('سبب الرفض'), { target: { value: 'الكمية كبيرة على احتياج القسم' } });
        sign();
        submitForm('erp-dispatch-chef-reject-form');
        await waitFor(() => {
            expect(mocks.chefRejectDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.chefRejectDispatch.mock.calls[0]?.[1]).toMatchObject({
            reason: 'الكمية كبيرة على احتياج القسم',
            signerName: 'مستخدم اختبار',
        });
        await waitFor(() => {
            expect(screen.getByText('تم رفض الطلب وسيظهر لرئيس القسم')).toBeTruthy();
        });
    });

    it('اعتماد المخازن: يرسل الكميات المعتمدة ويُظهر القيمة ويبطل المخزون والمصاريف', async () => {
        mocks.role = 'warehouse';
        stubFetch();
        const { invalidate } = renderScreen();
        await waitFor(() => {
            expect(screen.getByRole('table')).toBeTruthy();
        });

        clickRowAction('102', /اعتماد وصرف/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText('الموافقة على طلب صرف — المخبز')).toBeTruthy();
        expect((screen.getByLabelText('الكمية المعتمدة') as HTMLInputElement).value).toBe('2');

        sign();
        submitForm('erp-dispatch-approve-form');
        await waitFor(() => {
            expect(mocks.approveDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.approveDispatch.mock.calls[0]?.[0]).toBe('102');
        const body = mocks.approveDispatch.mock.calls[0]?.[1] as {
            approvedItems: Record<string, unknown>[];
            signerName: string;
        };
        expect(body.approvedItems[0]).toMatchObject({ itemName: 'أرز', approvedQty: 2, unit: 'كجم' });
        expect(body.signerName).toBe('مستخدم اختبار');
        await waitFor(() => {
            expect(screen.getByText('تمت الموافقة وحُسبت مصاريف القسم بقيمة 50.00')).toBeTruthy();
        });
        const keys = invalidate.mock.calls.map((call) => {
            const options = call[0] as { queryKey?: unknown[] } | undefined;
            return options?.queryKey?.[0];
        });
        expect(keys).toContain('inventory');
        expect(keys).toContain('expenses');
    });

    it('رفض المخازن: سبب + توقيع ثم نص V2', async () => {
        await readyAs('warehouse');
        clickRowAction('102', /رفض المخازن/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        fireEvent.change(screen.getByLabelText('سبب الرفض'), { target: { value: 'غير مطابق للطلب' } });
        sign();
        submitForm('erp-dispatch-reject-form');
        await waitFor(() => {
            expect(mocks.rejectDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.rejectDispatch.mock.calls[0]?.[1]).toMatchObject({ reason: 'غير مطابق للطلب' });
        await waitFor(() => {
            expect(screen.getByText('تم رفض الطلب')).toBeTruthy();
        });
    });

    it('استلام القسم: يرسل الكميات المستلمة والتوقيع ويطابق نص V2', async () => {
        await readyAs('kitchen');
        clickRowAction('104', /استلام/);
        await waitFor(() => {
            expect(screen.getByRole('dialog')).toBeTruthy();
        });
        expect(screen.getByText('استلام إذن الصرف — المطبخ البارد')).toBeTruthy();

        sign();
        submitForm('erp-dispatch-receive-form');
        await waitFor(() => {
            expect(mocks.receiveDispatch).toHaveBeenCalledTimes(1);
        });
        expect(mocks.receiveDispatch.mock.calls[0]?.[0]).toBe('104');
        expect(mocks.receiveDispatch.mock.calls[0]?.[1]).toMatchObject({
            items: [{ itemName: 'زيت', receivedQty: 2, notes: '' }],
            signerName: 'مستخدم اختبار',
        });
        await waitFor(() => {
            expect(screen.getByText('تم تسجيل استلام المطبخ بالتوقيع')).toBeTruthy();
        });
    });
});
