import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayIso } from '../lib/attendance';
import { ToastProvider } from '../ui/Toast';
import { Attendance } from './Attendance';

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
                <Attendance />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الحضور والانصراف', () => {
    it('يعرض سجل الفترة ومؤشرات اليوم من أبواب القراءة فقط', async () => {
        const calls: { url: string; method: string | undefined }[] = [];
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, method: init?.method });
            if (url.includes('/api/attendance/range')) {
                return json({
                    data: [
                        {
                            id: 501,
                            employeeId: 7,
                            date: todayIso(),
                            checkIn: '08:00',
                            checkOut: '16:00',
                            source: 'device',
                            workMinutes: 480,
                            status: 'present',
                        },
                    ],
                    total: 1,
                });
            }
            if (url.includes('/api/employees')) {
                return json({
                    data: [{ id: 7, name: 'أحمد علي', employeeId: 'EMP-007', department: 'KITCHEN', status: 'active' }],
                    pagination: { totalPages: 1 },
                });
            }
            if (url.includes('/api/hrDepartments')) {
                return json({ data: [{ code: 'KITCHEN', name: 'المطبخ' }], pagination: { totalPages: 1 } });
            }
            if (url.includes('/api/hr/leave-workflow')) {
                return json([]);
            }
            return json({ error: 'NOT_FOUND' });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('أحمد علي')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getByText('متوسط العمل')).toBeTruthy();
        expect(calls.some((call) => call.url.includes('/api/attendance/range'))).toBe(true);
        expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(true);
    });

    it('يرفض نطاق تاريخ معكوس قبل طلبه', async () => {
        const urls: string[] = [];
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                urls.push(url);
                return json({ data: [], total: 0 });
            }),
        );
        renderScreen();
        await screen.findByText('إجمالي السجلات');

        const from = screen.getByLabelText('من');
        const to = screen.getByLabelText('إلى');
        fireEvent.change(from, { target: { value: '2026-11-20' } });
        fireEvent.change(to, { target: { value: '2026-11-01' } });
        const before = urls.filter((url) => url.includes('/api/attendance/range')).length;
        screen.getByRole('button', { name: 'عرض الفترة' }).click();
        expect(await screen.findByRole('alert')).toBeTruthy();
        expect(urls.filter((url) => url.includes('/api/attendance/range'))).toHaveLength(before);
    });
});
