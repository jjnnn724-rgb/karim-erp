import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Permissions } from './Permissions';

/**
 * شاشة الصلاحيات تقرأ الكتالوج وقائمة المستخدمين ثم منح المستخدم المختار
 * وسجل تدقيقه — بلا أي حفظ. دور admin يُعلن أنه يملك الكل ضمنيًا، ورفض
 * الخادم يظهر كما هو.
 */

const catalog = [
    {
        key: 'finance.view',
        ar: 'عرض المالية',
        group: 'المالية',
        menus: ['finance'],
        entitiesRead: ['invoices'],
        entitiesWrite: [],
    },
    {
        key: 'finance.edit',
        ar: 'تعديل المالية',
        group: 'المالية',
        menus: ['finance'],
        entitiesRead: ['invoices'],
        entitiesWrite: ['invoices'],
    },
    {
        key: 'hr.view',
        ar: 'عرض الموارد البشرية',
        group: 'الموارد البشرية',
        menus: ['hr', 'employees'],
        entitiesRead: ['employees'],
        entitiesWrite: [],
    },
];

const users = [
    { id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: true },
    { id: 2, username: 'head_salads', name: 'أحمد صالح', role: 'dept_head', active: true },
    { id: 3, username: 'keeper', name: null, role: 'warehouse', active: false },
];

const perms = {
    user: { id: 2, username: 'head_salads', name: 'أحمد صالح', role: 'dept_head', active: true },
    grants: ['finance.view'],
    denies: ['hr.view'],
    menus: ['finance'],
    audit: [
        {
            perm_key: 'finance.view',
            action: 'grant',
            acted_by: 'admin',
            reason: 'صلاحية مؤقتة',
            created_at: '2026-11-06T10:00:00.000Z',
        },
        {
            perm_key: 'hr.view',
            action: 'deny',
            acted_by: 'admin',
            reason: null,
            created_at: '2026-11-05T09:30:00.000Z',
        },
    ],
};

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail: 'bootstrap' | 'target' | null = null): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (target.includes('/api/permissions/catalog')) {
                if (fail === 'bootstrap') {
                    return json({ error: 'FORBIDDEN', message: 'لا صلاحية لعرض الصلاحيات' }, 403);
                }
                return json(catalog);
            }
            if (target.includes('/api/users')) {
                return json({ data: users, pagination: { totalPages: 1 } });
            }
            if (target.includes('/api/permissions/users/1')) {
                return json({
                    user: { id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: true },
                    grants: [],
                    denies: [],
                    menus: [],
                    audit: [],
                });
            }
            if (target.includes('/api/permissions/users/')) {
                if (fail === 'target') {
                    return json({ error: 'FAILED', message: 'تعذّر جلب صلاحيات المستخدم' }, 500);
                }
                return json(perms);
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
                <Permissions />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الصلاحيات', () => {
    it('يعرض مؤشرات الكتالوج وقائمة النشطين ويدعو للاختيار', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('اختر مستخدمًا')).toBeTruthy();
        expect(screen.getAllByText('3')).toHaveLength(2);
        expect(screen.getAllByText('2')).toHaveLength(2);
        expect(screen.getByRole('status').textContent).toContain('2 حسابًا نشطًا للاختيار من 3');
        expect(screen.getByLabelText('المستخدم')).toBeTruthy();
    });

    it('يعرض وضع كل صلاحية للمستخدم المختار وسجل تدقيقه', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('اختر مستخدمًا');

        fireEvent.change(screen.getByLabelText('المستخدم'), { target: { value: '2' } });
        expect(await screen.findByText('تعديل المالية')).toBeTruthy();
        expect(screen.getByText('عرض المالية')).toBeTruthy();
        expect(screen.getByText('1 منح')).toBeTruthy();
        expect(screen.getByText('1 سحب')).toBeTruthy();
        expect(screen.getByText('1 وراثة')).toBeTruthy();
        expect(screen.getByText('صلاحية مؤقتة')).toBeTruthy();
        expect(screen.getByText('2026-11-06 10:00:00')).toBeTruthy();
        expect(screen.getAllByText('منح').length).toBeGreaterThan(0);
        expect(screen.getAllByText('سحب').length).toBeGreaterThan(0);
    });

    it('يعلن أن admin يملك الكل ضمنيًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('اختر مستخدمًا');

        fireEvent.change(screen.getByLabelText('المستخدم'), { target: { value: '1' } });
        expect(await screen.findByText(/دور admin يملك كل الصلاحيات ضمنيًا/)).toBeTruthy();
    });

    it('يبحث في الصلاحيات بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('اختر مستخدمًا');

        fireEvent.change(screen.getByLabelText('المستخدم'), { target: { value: '2' } });
        await screen.findByText('تعديل المالية');

        fireEvent.change(screen.getByLabelText('بحث في الصلاحيات'), { target: { value: 'الموارد البشريه' } });
        await waitFor(() => {
            expect(screen.queryByText('تعديل المالية')).toBeNull();
        });
        expect(screen.getByText('عرض الموارد البشرية')).toBeTruthy();
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('يعرض رفض الخادم للكتالوج مع إعادة المحاولة', async () => {
        stubFetch('bootstrap');
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('لا صلاحية لعرض الصلاحيات')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });

    it('يعرض خطأ صلاحيات المستخدم مع إعادة المحاولة', async () => {
        stubFetch('target');
        renderScreen();
        await screen.findByText('اختر مستخدمًا');

        fireEvent.change(screen.getByLabelText('المستخدم'), { target: { value: '2' } });
        await waitFor(() => {
            expect(screen.getByText('تعذّر جلب صلاحيات المستخدم')).toBeTruthy();
        });
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
