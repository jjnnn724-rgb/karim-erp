import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { EmployeeCard } from './EmployeeCard';

/**
 * عقد بطاقة الموظف الكاملة (2026-11-21):
 *  • بلا ?id ⇒ رسالة إرشادية تفتح من شاشة الموظفين.
 *  • ?id ⇒ رأس باسم الموظف وأقسام البيانات + أقسام HR المصفّاة على الموظف.
 *  • أزرار التحرير للصلاحية المسموحة فقط (admin|hr — قرار المالك).
 */

const authState = { user: { id: 1, role: 'admin', name: 'أدمن' } };

vi.mock('../lib/auth', () => ({
    useAuthState: () => authState,
    getAccessToken: () => 'test-token',
    getAppKey: () => 'test-key',
    logout: () => undefined,
}));

function renderCard({ id = '1790812565247459', role = 'admin' } = {}) {
    authState.user.role = role;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // بيئة المصادقة والطريق: window.location يقرأ ?id مباشرة في الشاشة.
    window.history.replaceState(null, '', `/employee-card?id=${id}`);
    vi.stubGlobal(
        'fetch',
        vi.fn((input: unknown) => {
            const url = String(input);
            if (url.includes('/api/employees')) {
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve([
                            {
                                id,
                                employeeId: 'EMP-7',
                                name: 'سالم تجريبي',
                                department: 'kitchen',
                                position: 'طباخ',
                                phone: '0555',
                                status: 'active',
                                salary: 3500,
                                iqamaNumber: '2234567890',
                                iqamaExpiry: '2027-01-01',
                            },
                        ]),
                });
            }
            if (url.includes('/api/hrDepartments')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([{ id: 1, code: 'kitchen', name: 'المطبخ' }]) });
            }
            if (url.includes('/api/hr/leave-workflow') || url.includes('/api/leaveTypes')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
            }
            if (url.includes('/api/hr/shift-schedule')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
            }
            if (url.includes('/api/hr/employees/')) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ qrAvailable: false, message: 'غير صادرة' }) });
            }
            return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
        }) as unknown as typeof fetch,
    );
    return render(
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <EmployeeCard />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('بطاقة الموظف الكاملة', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        window.history.replaceState(null, '', '/');
    });

    it('بلا ?id يعرض إرشاد الفتح من شاشة الموظفين', () => {
        renderCard({ id: '' });
        expect(screen.getByText(/افتح البطاقة من شاشة الموظفين/)).toBeTruthy();
    });

    it('يعرض بيانات الموظف وأقسام البطاقة كاملة', async () => {
        renderCard();
        await waitFor(() => expect(screen.getAllByText('سالم تجريبي').length).toBeGreaterThan(0));
        expect(screen.getByText('الهوية والاتصال')).toBeTruthy();
        expect(screen.getByText('الوثائق والانتهاءات')).toBeTruthy();
        expect(screen.getByText('البنك وWPS')).toBeTruthy();
        expect(screen.getByText('العمل والوردية')).toBeTruthy();
        expect(screen.getByText('كشف الحضور والانصراف')).toBeTruthy();
        expect(screen.getByText('آخر الإجازات')).toBeTruthy();
    });

    it('الأدمن يرى زر تحرير البيانات الشامل', async () => {
        renderCard({ role: 'admin' });
        await waitFor(() => expect(screen.getAllByText('سالم تجريبي').length).toBeGreaterThan(0));
        expect(screen.getByRole('button', { name: /تحرير البيانات/ })).toBeTruthy();
    });

    it('حساب بلا صلاحية كتابة (accountant) يرى البطاقة مقروءة بلا أزرار تحرير', async () => {
        renderCard({ role: 'accountant' });
        await waitFor(() => expect(screen.getAllByText('سالم تجريبي').length).toBeGreaterThan(0));
        expect(screen.queryByRole('button', { name: 'تحرير' })).toBeNull();
    });
});
