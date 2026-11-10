import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { EmployeePortal } from './EmployeePortal';

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
                <EmployeePortal />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('بوابة الموظف', () => {
    it('تعرض الربط وحالة اليوم وقوالب الوجه وسجل البصمات', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/attendance/portal/status')) {
                    return json({
                        ok: true,
                        enabled: true,
                        geofence: true,
                        hasEmployeeProfile: true,
                        employeeName: 'أحمد صالح',
                        faceEnabled: true,
                        faceEnrolled: true,
                        today: { checkIn: '08:02', checkOut: null },
                    });
                }
                if (url.includes('/api/zkteco/my-punches')) {
                    return json({
                        linked: true,
                        punchCount: 2,
                        punches: [
                            {
                                id: 1,
                                attendanceTime: '2026-11-07T08:02:00.000Z',
                                state: 0,
                                deviceName: 'بصمة المدخل',
                            },
                            { id: 2, attendanceTime: '2026-11-06T16:04:00.000Z', state: 1 },
                        ],
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('أحمد صالح')).toBeTruthy();
        expect(screen.getByText('08:02')).toBeTruthy();
        expect(screen.getByText('مسجل')).toBeTruthy();
        expect(screen.getByText('بصمة المدخل')).toBeTruthy();
        expect(screen.getByText('2 بصمة')).toBeTruthy();
    });
});
