import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { DeptEmployees } from './DeptEmployees';

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
            <ToastProvider>
                <DeptEmployees />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('موظفو القسم', () => {
    it('يعرض السجل والنطاق ويبحث بالاسم والرقم الوظيفي', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/hr/dept-employees')) {
                    return json({
                        depts: ['KITCHEN', 'SALADS'],
                        employees: [
                            {
                                id: 1,
                                name: 'أحمد صالح',
                                employeeId: 'EMP-001',
                                position: 'طاهٍ',
                                phone: '0500000001',
                                status: 'active',
                            },
                            {
                                id: 2,
                                name: 'سارة علي',
                                employeeId: 'EMP-002',
                                position: 'مساعدة',
                                phone: '0500000002',
                                status: 'inactive',
                            },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أحمد صالح')).toBeTruthy();
        expect(screen.getByText('KITCHEN + SALADS')).toBeTruthy();
        expect(screen.getByText('نشط')).toBeTruthy();
        expect(screen.getByText('موقوف')).toBeTruthy();
        expect(screen.getByText('2 من 2 موظفًا')).toBeTruthy();

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'EMP-002' } });
        await waitFor(() => {
            expect(screen.getByText('سارة علي')).toBeTruthy();
            expect(screen.queryByText('أحمد صالح')).toBeNull();
        });
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'DEPT_EMP_FAILED', message: 'تعذّر جلب موظفي القسم' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText('تعذّر جلب موظفي القسم')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
