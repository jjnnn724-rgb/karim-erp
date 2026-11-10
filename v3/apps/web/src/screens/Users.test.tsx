import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Users } from './Users';

/**
 * دليل الحسابات يقرأ `/api/users` ويربط الموظف عبر `employees."userId"`،
 * ويبحث بتطبيع الحروف العربية — ولا يعرض كلمة مرور ولا خزنتها ولا بريدًا
 * ولا هاتفًا في أي خلية أو عنوان.
 */

const users = [
    {
        id: 1,
        username: 'admin',
        name: 'مدير النظام',
        role: 'admin',
        dept_code: null,
        active: true,
        last_login_at: '2026-11-06T18:48:25.164Z',
        password: 'hashed-secret',
        password_vault: 'vault-secret',
        email: 'admin@example.com',
        phone: '0500000000',
    },
    {
        id: 2,
        username: 'head_salads',
        name: 'أحمد صالح',
        role: 'dept_head',
        dept_code: 'salads',
        active: true,
        last_login_at: null,
    },
    {
        id: 3,
        username: 'keeper',
        name: 'أمين المخازن',
        role: 'warehouse',
        dept_code: 'WAREHOUSE',
        active: false,
        last_login_at: null,
    },
    {
        id: 4,
        username: 'emp-009',
        name: null,
        role: 'employee',
        dept_code: 'KITCHEN',
        active: true,
        last_login_at: null,
    },
];

const employees = [{ id: 501, userId: 1, employeeId: 'EMP-001', name: 'مدير النظام' }];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail: 'users' | null = null): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (target.includes('/api/users')) {
                if (fail === 'users') {
                    return json({ error: 'FAILED', message: 'تعذّر جلب المستخدمين' }, 500);
                }
                return json({ data: users, pagination: { totalPages: 1 } });
            }
            if (target.includes('/api/employees')) {
                return json({ data: employees, pagination: { totalPages: 1 } });
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
                <Users />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('دليل المستخدمين', () => {
    it('يعرض الحسابات ويربط الموظف ويعلن الأدوار والحالة وآخر دخول', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('@admin')).toBeTruthy();
        expect(screen.getByText('@head_salads')).toBeTruthy();
        expect(screen.getAllByText('مدير النظام').length).toBeGreaterThan(0);
        expect(screen.getAllByText('رئيس قسم').length).toBeGreaterThan(0);
        expect(screen.getAllByText('نشط').length).toBeGreaterThan(0);
        expect(screen.getAllByText('موقوف').length).toBeGreaterThan(0);
        expect(await screen.findByText(/EMP-001/)).toBeTruthy();
        expect(screen.getAllByText('2026-11-06').length).toBeGreaterThan(0);
        expect(screen.getAllByText('لم يسجّل الدخول').length).toBe(3);
        expect(screen.getByText('4 حسابًا معروضًا من 4')).toBeTruthy();
    });

    it('لا يعرض كلمة المرور ولا خزنتها ولا البريد ولا الهاتف', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('@admin');
        expect(screen.queryByText('hashed-secret')).toBeNull();
        expect(screen.queryByText('vault-secret')).toBeNull();
        expect(screen.queryByText('admin@example.com')).toBeNull();
        expect(screen.queryByText('0500000000')).toBeNull();
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع ويمسح المرشّحات', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('@admin');

        const search = screen.getByLabelText('بحث');
        fireEvent.change(search, { target: { value: 'احمد' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(4);
        });
    });

    it('يرشّح بالدور والحالة والربط، وبلا نتائج يعرض حالة فارغة', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('@admin');

        fireEvent.change(screen.getByLabelText('الدور'), { target: { value: 'dept_head' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'inactive' } });
        await waitFor(() => {
            expect(screen.getByText('لا حسابات تطابق المرشّحات')).toBeTruthy();
            expect(screen.queryByText('@head_salads')).toBeNull();
        });

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(4);
        });

        fireEvent.change(screen.getByLabelText('ربط الموظف'), { target: { value: 'linked' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        fireEvent.change(screen.getByLabelText('ربط الموظف'), { target: { value: 'unlinked' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(3);
        });
    });

    it('يرتّب باسم المستخدم تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('@admin');

        fireEvent.click(screen.getByRole('button', { name: 'اسم المستخدم' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('@admin');
        });
        fireEvent.click(screen.getByRole('button', { name: 'اسم المستخدم' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('@keeper');
        });
    });

    it('يطلب الصفحات بحدّ 1000 وترتيب id تصاعدي من الخادم', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('@admin');
        const userCall = urls.find((url) => url.includes('/api/users'));
        const employeeCall = urls.find((url) => url.includes('/api/employees'));
        expect(userCall).toContain('page=1');
        expect(userCall).toContain('limit=1000');
        expect(userCall).toContain('sort=id');
        expect(userCall).toContain('order=asc');
        expect(employeeCall).toContain('limit=1000');
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch('users');
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذّر جلب المستخدمين')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
