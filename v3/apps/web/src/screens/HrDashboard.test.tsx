import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIso } from '../lib/reporting';
import { ToastProvider } from '../ui/Toast';
import { HrDashboard } from './HrDashboard';

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
                <HrDashboard />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('لوحة الموارد البشرية', () => {
    it('تجمع الموظفين والحضور والإجازات والأقسام وتسمّي الفاشل', async () => {
        const today = todayIso();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/employees')) {
                    return json({
                        data: [
                            { id: 1, name: 'أحمد', status: 'active', salary: 5000, department: 'KITCHEN' },
                            { id: 2, name: 'سارة', status: 'active', salary: 4000, department: 'SALADS' },
                            { id: 3, name: 'خالد', status: 'inactive', salary: 0, department: 'KITCHEN' },
                        ],
                    });
                }
                if (url.includes('/api/attendance/range')) {
                    return json({
                        data: [
                            { id: 11, employeeId: 1, date: today, checkIn: '08:00', checkOut: '16:00' },
                            { id: 12, employeeId: 2, date: today, checkIn: '09:10', late: true, lateMinutes: 70 },
                        ],
                    });
                }
                if (url.includes('/api/hr/leave-workflow')) {
                    return json({
                        data: [
                            {
                                id: 21,
                                employeeId: 2,
                                status: 'pending',
                                employee_name: 'سارة',
                                startDate: '2027-01-05',
                                endDate: '2027-01-07',
                            },
                        ],
                    });
                }
                if (url.includes('/api/hrDepartments')) {
                    return json({
                        data: [
                            { code: 'KITCHEN', name: 'المطبخ' },
                            { code: 'SALADS', name: 'السلطات' },
                        ],
                    });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('الحاضرون اليوم')).toBeTruthy();
        expect(screen.getByText('متأخرون اليوم')).toBeTruthy();
        expect(screen.getByText('إجازات معلقة')).toBeTruthy();
        expect(screen.getByText('9,000.00 SAR')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('سارة').length).toBeGreaterThan(0);
        expect(screen.getByText('2027-01-05')).toBeTruthy();
    });

    it('يعرض خطأً عامًا حين تفشل كل المصادر', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'HR_FAILED', message: 'تعذّر جلب اللوحة' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText(/تعذّر قراءة:/)).toBeTruthy();
        expect(screen.getAllByText(/تعذّر جلب اللوحة/).length).toBeGreaterThan(0);
    });

    it('تصفية طلبات الإجازة باسم الموظف من الواجهة الأمامية', async () => {
        const today = todayIso();
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/employees')) {
                    return json({
                        data: [
                            { id: 1, name: 'أحمد', status: 'active', salary: 5000, department: 'KITCHEN' },
                            { id: 2, name: 'سارة', status: 'active', salary: 4000, department: 'SALADS' },
                            { id: 3, name: 'خالد', status: 'inactive', salary: 0, department: 'KITCHEN' },
                        ],
                    });
                }
                if (url.includes('/api/attendance/range')) {
                    return json({
                        data: [
                            { id: 11, employeeId: 1, date: today, checkIn: '08:00', checkOut: '16:00' },
                            { id: 12, employeeId: 2, date: today, checkIn: '09:10', late: true, lateMinutes: 70 },
                        ],
                    });
                }
                if (url.includes('/api/hr/leave-workflow')) {
                    return json({
                        data: [
                            {
                                id: 21,
                                employeeId: 2,
                                status: 'pending',
                                employee_name: 'سارة',
                                startDate: '2026-11-10',
                                endDate: '2026-11-12',
                            },
                            {
                                id: 22,
                                employeeId: 3,
                                status: 'pending',
                                employee_name: 'خالد',
                                startDate: '2026-11-11',
                                endDate: '2026-11-13',
                            },
                        ],
                    });
                }
                if (url.includes('/api/hrDepartments')) {
                    return json({
                        data: [
                            { code: 'KITCHEN', name: 'المطبخ' },
                            { code: 'SALADS', name: 'السلطات' },
                        ],
                    });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        await screen.findByText('سارة');
        await screen.findByText('خالد');

        const search = screen.getByTestId('hr-filter-bar');
        fireEvent.input(search, { target: { value: 'خالد' } });

        await screen.findByText('خالد');
        expect(screen.queryByText('سارة')).toBeNull();
    });
});
