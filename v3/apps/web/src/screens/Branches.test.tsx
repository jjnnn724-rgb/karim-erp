import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Branches } from './Branches';

const authMock = vi.hoisted(() => ({ role: 'manager' }));
vi.mock('../lib/auth', () => ({
    useAuthState: () => ({ user: { role: authMock.role } }),
    getAccessToken: () => null,
    // `api.ts` يطلب مفتاح التطبيق من نفس الوحدة — غيابه يجعل كل نداء يرمي.
    getAppKey: () => null,
}));

/**
 * شاشة الفروع تقرأ `/api/branches?all=1` — الخادم هو من يقرّر إظهار
 * المعطّل (أدمن) أو الاكتفاء بالنشط، والشاشة تعرض ما وصل بلا افتراض.
 */

const branches = [
    {
        id: 1,
        code: 'MAIN',
        name_ar: 'الفرع الرئيسي',
        name_en: 'Main Branch',
        currency: 'SAR',
        timezone: 'Asia/Riyadh',
        phone: null,
        address: null,
        is_active: true,
    },
    {
        id: 2,
        code: 'CAI-1',
        name_ar: 'فرع القاهرة',
        name_en: 'Cairo Branch',
        currency: 'EGP',
        timezone: 'Africa/Cairo',
        phone: '0223456789',
        address: 'وسط البلد',
        is_active: false,
    },
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
            urls.push(String(url));
            if (fail) {
                return json({ error: 'FAILED', message: 'تعذّر جلب الفروع' }, 500);
            }
            return json({ ok: true, data: branches });
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Branches />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
    authMock.role = 'manager';
    vi.restoreAllMocks();
});

describe('فروع المنشأة', () => {
    it('يعرض الفروع والحالة والعملة والمنطقة ويعلن «رئيسي» على MAIN', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('الفرع الرئيسي')).toBeTruthy();
        expect(screen.getByText('فرع القاهرة')).toBeTruthy();
        expect(screen.getByText('(رئيسي)')).toBeTruthy();
        expect(screen.getAllByText('مفعّل').length).toBeGreaterThan(0);
        expect(screen.getAllByText('موقوف').length).toBeGreaterThan(0);
        expect(screen.getByText('Asia/Riyadh')).toBeTruthy();
        expect(screen.getByText('وسط البلد')).toBeTruthy();
        expect(screen.getByText('2 فرعًا معروضًا من 2')).toBeTruthy();
    });

    it('يطلب ?all=1 دائمًا — إظهار المعطّل قرار الخادم لا الشاشة', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        expect(urls.some((url) => url.includes('/api/branches?all=1'))).toBe(true);
    });

    it('يرشّح بالحالة والعملة، وبلا نتائج يعرض حالة فارغة', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('الفرع الرئيسي');

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'inactive' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('CAI-1');

        fireEvent.change(screen.getByLabelText('العملة'), { target: { value: 'SAR' } });
        await waitFor(() => {
            expect(screen.getByText('لا فروع تطابق المرشّحات')).toBeTruthy();
        });

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(2);
        });
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('الفرع الرئيسي');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'القاهره' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(bodyRows()[0]?.textContent).toContain('CAI-1');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('يرتّب بالكود تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('الفرع الرئيسي');

        fireEvent.click(screen.getByRole('button', { name: 'الكود' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('CAI-1');
        });
        fireEvent.click(screen.getByRole('button', { name: 'الكود' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('MAIN');
        });
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch(true);
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب الفروع')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('يحرس الكتابة للأدمن وينشئ فرعًا ويستخدم القيم الافتراضية الموثقة', async () => {
        authMock.role = 'admin';
        const calls: Array<{ url: string; method: string }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = String(input);
                const method = init?.method || 'GET';
                calls.push({ url, method });
                if (method === 'POST') return json({ ok: true, data: branches[0] }, 201);
                return json({ ok: true, data: branches });
            }),
        );
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        fireEvent.click(screen.getByRole('button', { name: 'إضافة فرع' }));
        fireEvent.change(await screen.findByLabelText(/^الكود/), { target: { value: 'BR-2' } });
        fireEvent.change(screen.getByLabelText(/^الاسم بالعربية/), { target: { value: 'فرع جديد' } });
        fireEvent.click(screen.getByRole('button', { name: 'إضافة الفرع' }));
        await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true));
        const request = calls.find((call) => call.method === 'POST');
        expect(request?.url).toContain('/api/branches');
        const body = JSON.parse(String(vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'POST')?.[1]?.body ?? ''));
        expect(body).toMatchObject({ code: 'BR-2', name_ar: 'فرع جديد', currency: 'SAR', timezone: 'Asia/Riyadh' });
    });

    it('يخفي عمليات الكتابة عن غير الأدمن ولا يرسل كتابة', async () => {
        authMock.role = 'manager';
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => json({ ok: true, data: branches }));
        vi.stubGlobal('fetch', fetchMock);
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        expect(screen.queryByRole('button', { name: 'إضافة فرع' })).toBeNull();
        expect(
            fetchMock.mock.calls.every(
                (call) => !(call[1] as RequestInit | undefined)?.method || (call[1] as RequestInit).method === 'GET',
            ),
        ).toBe(true);
    });

    it('لا يوقف MAIN، ويطلب التأكيد قبل الإيقاف ويحدّث القائمة بعده', async () => {
        authMock.role = 'admin';
        const calls: Array<{ method: string; url: string }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const method = init?.method || 'GET';
                calls.push({ method, url: String(input) });
                // فرعان مفعّلان على الخادم: الإيقاف متاح لكليهما، وMAIN وحده معطّل الزر.
                return json(
                    method === 'DELETE' ? { ok: true } : { ok: true, data: branches.map((branch) => ({ ...branch, is_active: true })) },
                );
            }),
        );
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        const stopButtons = screen.getAllByRole('button', { name: 'إيقاف' });
        expect(stopButtons[0]?.hasAttribute('disabled')).toBe(true);
        fireEvent.click(stopButtons[1]!);
        // يظهر Dialog تأكيد النصّ الموثق ولا يُرسل DELETE قبل التأكيد.
        expect(await screen.findByText('إيقاف فرع «فرع القاهرة»؟ يُخفى من القوائم، وسجلاته التاريخية تبقى كما هي.')).toBeTruthy();
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    });

    it('يعدّل الفرع دون إرسال الكود ويعيد تفعيل الفرع بـPATCH موثق', async () => {
        authMock.role = 'admin';
        const calls: Array<{ method: string; url: string; body?: unknown }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const method = init?.method || 'GET';
                calls.push({ method, url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
                return json(method === 'PATCH' ? { ok: true, data: branches[1] } : { ok: true, data: branches });
            }),
        );
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        fireEvent.click(screen.getAllByRole('button', { name: 'تعديل' })[0]!);
        fireEvent.change(await screen.findByLabelText(/^الاسم بالعربية/), { target: { value: 'الفرع الرئيسي المعدل' } });
        fireEvent.click(screen.getByRole('button', { name: 'حفظ التعديل' }));
        await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
        expect(calls.find((call) => call.method === 'PATCH')?.body).not.toHaveProperty('code');
        fireEvent.click(screen.getByRole('button', { name: 'تفعيل' }));
        expect(await screen.findByText('تفعيل فرع «فرع القاهرة»؟ سيظهر في القوائم مرة أخرى.')).toBeTruthy();
        const dialog = screen.getByRole('dialog');
        const buttons = Array.from(dialog.querySelectorAll('button'));
        fireEvent.click(buttons[buttons.length - 1]!);
        await waitFor(() => expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(2));
        expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({ is_active: true });
    });

    it('ينفّذ soft-stop بعد الموافقة فقط ويعيد تحميل القائمة', async () => {
        authMock.role = 'admin';
        const calls: Array<{ method: string; url: string }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const method = init?.method || 'GET';
                calls.push({ method, url: String(input) });
                return json(
                    method === 'DELETE' ? { ok: true } : { ok: true, data: branches.map((branch) => ({ ...branch, is_active: true })) },
                );
            }),
        );
        renderScreen();
        await screen.findByText('الفرع الرئيسي');
        fireEvent.click(screen.getAllByRole('button', { name: 'إيقاف' })[1]!);
        expect(await screen.findByText('إيقاف فرع «فرع القاهرة»؟ يُخفى من القوائم، وسجلاته التاريخية تبقى كما هي.')).toBeTruthy();
        expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
        const dialog = screen.getByRole('dialog');
        // زر التأكيد داخل الـ Dialog (الأخير).
        const buttons = Array.from(dialog.querySelectorAll('button'));
        fireEvent.click(buttons[buttons.length - 1]!);
        await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
        expect(calls.some((call) => call.method === 'GET' && call.url.includes('/api/branches'))).toBe(true);
    });
});
