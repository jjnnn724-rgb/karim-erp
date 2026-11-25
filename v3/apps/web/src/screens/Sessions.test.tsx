import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sessions } from './Sessions';

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
            <Sessions />
        </QueryClientProvider>,
    );
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الأجهزة والجلسات', () => {
    it('يعرض قائمة الجلسات النشطة والجلسة الحالية', async () => {
        const calls: Array<{ url: string; method: string | undefined }> = [];
        const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input.toString();
            calls.push({ url, method: init?.method });
            if (url.includes('/api/auth/sessions')) {
                return json({
                    ok: true,
                    current_session_id: 'sess-1',
                    sessions: [
                        {
                            id: 'sess-1',
                            current: true,
                            device: 'Chrome on Windows',
                            ip: '192.168.1.50',
                            started_at: '2026-11-07T10:00:00.000Z',
                            last_seen_at: '2026-11-07T12:00:00.000Z',
                            expires_at: '2026-11-14T10:00:00.000Z',
                        },
                        {
                            id: 'sess-2',
                            current: false,
                            device: 'Safari on iPhone',
                            ip: '10.0.0.2',
                            started_at: '2026-11-06T08:00:00.000Z',
                            last_seen_at: '2026-11-06T09:00:00.000Z',
                            expires_at: '2026-11-13T08:00:00.000Z',
                        },
                    ],
                });
            }
            return json({ error: 'NOT_FOUND' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect((await screen.findAllByText('Chrome on Windows')).length).toBeGreaterThan(0);
        expect(screen.getByText('Safari on iPhone')).toBeTruthy();
        expect(screen.getByText('الجلسة الحالية')).toBeTruthy();
        expect(screen.getAllByText('192.168.1.50').length).toBeGreaterThan(0);
    });

    it('يسمح بالبحث والتصفية باسم الجهاز', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input.toString();
            if (url.includes('/api/auth/sessions')) {
                return json({
                    ok: true,
                    current_session_id: 'sess-1',
                    sessions: [
                        {
                            id: 'sess-1',
                            current: true,
                            device: 'Chrome on Windows',
                            ip: '192.168.1.50',
                        },
                        {
                            id: 'sess-2',
                            current: false,
                            device: 'Safari on iPhone',
                            ip: '10.0.0.2',
                        },
                    ],
                });
            }
            return json({ error: 'NOT_FOUND' }, 404);
        });
        vi.stubGlobal('fetch', fetchMock);

        renderScreen();

        expect((await screen.findAllByText('Chrome on Windows')).length).toBeGreaterThan(0);
        const searchInput = screen.getByPlaceholderText(/ابحث بالجهاز/);
        fireEvent.change(searchInput, { target: { value: 'iPhone' } });

        // في الجدول بعد التصفية
        expect(screen.getByText('Safari on iPhone')).toBeTruthy();
    });
});
