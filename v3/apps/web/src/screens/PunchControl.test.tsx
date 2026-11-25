import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { PunchControl } from './PunchControl';

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
            <ConfirmProvider>
                <ToastProvider>
                    <PunchControl />
                </ToastProvider>
            </ConfirmProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('مركز التحكم بالبصمة والحضور', () => {
    it('يعرض الأجهزة وقراءات البصمة الذاتية', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/attendance/portal/attempts')) {
                    return json({
                        attempts: [],
                        summary: { accepted_24h: 5, rejected_24h: 2, out_of_range_7d: 7, device_mismatch_7d: 1 },
                    });
                }
                if (url.includes('/api/attendance/portal/settings-admin')) {
                    return json({
                        values: { punch_portal_enabled: 'true', punch_face_enabled: 'true', punch_radius_meters: '120' },
                        fields: [],
                    });
                }
                if (url.includes('/api/attendance/portal/punch-devices')) {
                    return json([]);
                }
                if (url.includes('/api/attendance/portal/face/list') || url.includes('/face/list')) {
                    return json([]);
                }
                if (url.includes('/api/employees')) {
                    return json({ data: [{ id: 7, name: 'موظف تجريبي', status: 'active' }], total: 1, from: '', to: '' });
                }
                if (url.includes('/api/attendance/range')) {
                    return json({ data: [], total: 0, from: '2026-11-17', to: '2026-11-17' });
                }
                if (url.includes('/api/zkteco/status') || url.includes('/api/zkteco/overview') || url.includes('/zkteco')) {
                    return json({
                        running: true,
                        devices: [
                            {
                                id: '1',
                                name: 'جهاز البوابة',
                                ipAddress: '192.168.1.100',
                                port: 4370,
                                status: 'متصل',
                                enabled: true,
                                lastSyncAt: '2026-11-17 07:00:00',
                                lastError: null,
                                totalSynced: 1234,
                                live: { online: true },
                            },
                        ],
                        totals: { logs: 1000, unmapped: 0, today: 42, employees: 100, linkedEmployees: 99, unlinkedEmployees: 1 },
                    });
                }
                return json({ error: 'NOT_FOUND' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('مركز التحكم بالبصمة والحضور')).toBeTruthy();
        expect(await screen.findByText(/أجهزة متصلة/)).toBeTruthy();
        expect(await screen.findByText(/تصحيح أي بصمة — أي موظف، أي يوم/)).toBeTruthy();
    });
});
