import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '../components/ConfirmProvider';
import { ToastProvider } from '../ui/Toast';
import { Roster } from './Roster';

const days = Array.from({ length: 7 }, (_, index) => {
    const date = `2026-11-${String(index + 7).padStart(2, '0')}`;
    return { date, weekday: index, isPast: false, isToday: index === 0 };
});

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
                    <Roster />
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الدوام', () => {
    it('يعرض شبكة الأسبوع وسجل القراءة فقط من باب الدوام', async () => {
        const requestUrls: string[] = [];
        const fetchMock = vi.fn(async (url: string) => {
            requestUrls.push(url);
            return json({
                weekStart: days[0]?.date ?? '2026-11-07',
                days,
                grid: [
                    {
                        id: '7',
                        name: 'أحمد علي',
                        employeeId: 'EMP-007',
                        position: 'شيف',
                        department: 'KITCHEN',
                        cells: days.map(({ date }) => ({
                            date,
                            shift_start: '09:00',
                            shift_hours: 8,
                            day_off: null,
                        })),
                    },
                ],
                depts: ['KITCHEN'],
                fixed: true,
                today: days[0]?.date ?? '2026-11-07',
                validDepts: ['KITCHEN'],
                recentLog: [],
                approval: null,
            });
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect(await screen.findByText('أحمد علي')).toBeTruthy();
        expect(screen.getAllByText('09:00').length).toBeGreaterThan(0);
        expect(screen.getByText('الدوام')).toBeTruthy();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(requestUrls[0]).toContain('/api/hr/dept-roster-week');
    });
});
