import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { applySession, logout } from '../lib/auth';
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
                <ConfirmProvider>
                    <EmployeePortal />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    window.localStorage.clear();
});

afterEach(() => {
    logout();
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

    it('تسجّل البصمة بنقرة واحدة وترسل معرّف الجهاز إلى الخادم', async () => {
        applySession({
            access_token: 'test-token',
            refresh_token: 'test-refresh',
            user: { id: '1', name: 'مدير', role: 'admin', username: 'admin' },
        });
        const calls: Array<{ url: string; init: RequestInit }> = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : input.toString();
                calls.push({ url, init: init ?? {} });
                if (url.includes('/api/attendance/portal/punch') && init?.method === 'POST') {
                    return json({
                        ok: true,
                        action: 'check_in',
                        decision: 'accepted',
                        record: null,
                        at: '2026-11-11T06:00:00.000Z',
                    });
                }
                if (url.includes('/api/attendance/portal/status')) {
                    return json({
                        ok: true,
                        enabled: true,
                        geofence: false,
                        hasEmployeeProfile: true,
                        employeeName: 'أحمد صالح',
                        faceEnabled: false,
                        faceEnrolled: false,
                        today: { checkIn: null, checkOut: null },
                    });
                }
                if (url.includes('/api/zkteco/my-punches')) {
                    return json({ linked: true, punchCount: 0, punches: [] });
                }
                if (url.includes('/api/employees')) {
                    return json({
                        data: [
                            {
                                id: '10',
                                userId: '1',
                                name: 'أحمد صالح',
                                employeeId: 'EMP-10',
                                position: 'كاشير',
                                department: 'الصالة',
                                salary: '5000',
                            },
                            { id: '11', userId: '', name: 'سارة', employeeId: 'EMP-11' },
                        ],
                    });
                }
                if (url.includes('/api/hr/attendance/report')) {
                    return json({
                        records: [
                            {
                                date: '2026-11-10',
                                checkIn: '08:00',
                                checkOut: '16:00',
                                workMinutes: 480,
                                source: 'device',
                            },
                        ],
                        summary: { daysPresent: 1, totalKarim: 8 },
                    });
                }
                if (url.includes('/api/hr/leave-workflow')) {
                    return json([
                        {
                            id: '500',
                            employeeId: '10',
                            leaveTypeId: '1',
                            startDate: '2026-11-01',
                            endDate: '2026-11-02',
                            status: 'approved',
                            leave_type_name: 'سنوية',
                        },
                    ]);
                }
                if (url.includes('/api/leaveTypes')) {
                    return json({ data: [{ id: '1', name: 'سنوية', paid: true }] });
                }
                if (url.includes('/api/settings/main_settings')) {
                    return json({ id: 'main_settings', currency: 'SAR' });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('تسجيل وجوه الموظفين')).toBeTruthy();
        expect(await screen.findByTestId('portal-employee')).toBeTruthy();
        expect(screen.getByTestId('portal-employee').textContent).toContain('أحمد صالح');
        expect(screen.getByText('5,000.00 SAR')).toBeTruthy();
        expect(await screen.findByText('سنوية')).toBeTruthy();
        expect(screen.getByText('معتمد')).toBeTruthy();
        expect(screen.getByText('2026-11-10')).toBeTruthy();
        fireEvent.click(screen.getByTestId('punch-button'));

        await waitFor(() => {
            expect(screen.getByTestId('punch-result').textContent).toContain('تم تسجيل الحضور');
        });
        const posted = calls.find((call) => call.url.includes('/api/attendance/portal/punch') && call.init.method === 'POST');
        if (!posted) {
            throw new Error('لم يُرسل طلب البصمة');
        }
        const payload = JSON.parse(String(posted.init.body)) as { deviceId?: unknown; location?: unknown };
        expect(typeof payload.deviceId).toBe('string');
        expect(String(payload.deviceId).length).toBeGreaterThan(10);
        expect(payload.location).toBeNull();
    });
});
