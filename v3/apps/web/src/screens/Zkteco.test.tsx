import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Zkteco } from './Zkteco';

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
            <Zkteco />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('أجهزة البصمة', () => {
    it('يعرض حالة المحرك والأجهزة والبصمات والربط', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (input: RequestInfo | URL) => {
                const url = typeof input === 'string' ? input : input.toString();
                if (url.includes('/api/zkteco/status')) {
                    return json({
                        running: true,
                        devices: [
                            {
                                id: 1,
                                name: 'بصمة المدخل',
                                ipAddress: '192.168.1.201',
                                port: 4370,
                                status: 'online',
                                enabled: true,
                                lastSyncAt: '2026-11-07T08:12:00.000Z',
                                totalSynced: 1520,
                                commKey: 12345,
                            },
                            {
                                id: 2,
                                name: 'بصمة المطبخ',
                                ipAddress: '192.168.1.202',
                                port: 4370,
                                status: 'offline',
                                enabled: false,
                                totalSynced: 0,
                                lastError: 'انتهت مهلة الاتصال',
                            },
                        ],
                        totals: {
                            logs: 9000,
                            unmapped: 12,
                            today: 84,
                            employees: 40,
                            linkedEmployees: 36,
                            unlinkedEmployees: 4,
                        },
                    });
                }
                return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
            }),
        );

        renderScreen();

        expect(await screen.findByText('بصمة المدخل')).toBeTruthy();
        expect(screen.getByText('192.168.1.201:4370')).toBeTruthy();
        expect(screen.getByText('يعمل')).toBeTruthy();
        expect(screen.getByText('1 / 2')).toBeTruthy();
        expect(screen.getByText('84')).toBeTruthy();
        expect(screen.getByText(/36/)).toBeTruthy();
        expect(screen.getByText(/انتهت مهلة الاتصال/)).toBeTruthy();
        expect(screen.queryByText(/12345/)).toBeNull();
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => json({ error: 'ZK_FAILED', message: 'تعذّر جلب أجهزة البصمة' }, 500)),
        );

        renderScreen();

        expect(await screen.findByText('تعذّر جلب أجهزة البصمة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
