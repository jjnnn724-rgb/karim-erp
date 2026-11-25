import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { currentMonth } from '../lib/payroll';
import { ToastProvider } from '../ui/Toast';
import { Payroll } from './Payroll';

function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <ConfirmProvider>
                    <Payroll />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الرواتب', () => {
    it('يعرض المسيرات والكشف من مصادره ولا يرسل أي كتابة', async () => {
        const calls: { url: string; method: string | undefined }[] = [];
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, method: init?.method });
            if (url.includes('/api/payroll_runs')) {
                return json({
                    data: [
                        {
                            id: 11,
                            month: '2026-10',
                            status: 'approved',
                            employee_count: 2,
                            total_basic: '10000.00',
                            total_overtime: '500.00',
                            total_bonuses: '250.00',
                            total_penalties: '50.00',
                            total_advances: '100.00',
                            total_net: '10600.00',
                        },
                    ],
                    pagination: { totalPages: 1 },
                });
            }
            if (url.includes('/api/employees')) {
                return json({
                    data: [
                        {
                            id: 7,
                            name: 'أحمد علي',
                            department: 'KITCHEN',
                            position: 'شيف',
                            status: 'active',
                            salary: '5000.00',
                        },
                        { id: 8, name: 'منى حسن', department: 'SERVICE', position: 'مضيفة', status: 'active' },
                    ],
                    pagination: { totalPages: 1 },
                });
            }
            if (url.includes('/api/attendance/range')) {
                return json({
                    data: [
                        { employeeId: 7, checkIn: '08:00' },
                        { employeeId: 8, checkIn: '09:00' },
                    ],
                });
            }
            if (url.includes('/api/hrDepartments')) {
                return json({
                    data: [
                        { code: 'KITCHEN', name: 'المطبخ' },
                        { code: 'SERVICE', name: 'الصالة' },
                    ],
                    pagination: { totalPages: 1 },
                });
            }
            return json({ error: 'NOT_FOUND' });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('أحمد علي')).toBeTruthy();
        expect(screen.getByText('2026-10')).toBeTruthy();
        expect(screen.getByText('المطبخ')).toBeTruthy();
        expect(screen.getAllByText('5000.00').length).toBeGreaterThan(0);
        expect(screen.getByText(/1 راتبًا مرئيًا/)).toBeTruthy();
        expect(screen.getByText(/1 مخفي بقرار الخادم/)).toBeTruthy();
        expect(calls.some((call) => call.url.includes('/api/payroll_runs'))).toBe(true);
        expect(calls.some((call) => call.url.includes(`/api/attendance/range?from=${currentMonth()}-01`))).toBe(true);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });
});
