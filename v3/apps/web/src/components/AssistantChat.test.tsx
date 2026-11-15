import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../ui/Toast';
import { AssistantChat } from './AssistantChat';

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stubFetch() {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        calls.push(`${init?.method ?? 'GET'} ${u}`);
        if (u.includes('/api/ai-assistant/status')) {
            return json({ enabled: true, local: true, model: 'qwen2.5:3b-instruct' });
        }
        if (u.includes('/api/ai-assistant/ask')) {
            return json({
                text: 'تقرير اليوم: المبيعات 430 ألف، والمصاريف 140 ألف، والفرق مع الأسبوع الماضي -13.6%.',
                mode: 'knowledge',
                model: 'qwen2.5:3b-instruct',
                fallback: false,
                grounded: true,
                canDeep: true,
            });
        }
        return json({});
    }));
    return calls;
}

afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderChat() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <AssistantChat />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

describe('ذكاء المحادثة', () => {
    it('تعرض اقتراحات البدء، وتعرض رد الموديل مع أرضيته', async () => {
        const calls = stubFetch();
        renderChat();
        expect(await screen.findByText('اسألني عن أي رقم في النظام')).toBeTruthy();
        const chip = screen.getByRole('button', { name: 'ملخص اليوم: المبيعات والمصروفات وقراري' });
        fireEvent.click(chip);
        await waitFor(() => {
            expect(screen.getByText(/المبيعات 430 ألف/)).toBeTruthy();
        });
        expect(screen.getAllByText(/qwen2\.5:3b-instruct/).length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText(/من قاعدة البيانات/)).toBeTruthy();
        expect(calls.some((c) => c.startsWith('POST /api/ai-assistant/ask'))).toBe(true);
    });

    it('تحفظ التاريخ محليًا، وتمسحه بزر «مسح»', async () => {
        stubFetch();
        const first = renderChat();
        fireEvent.click(screen.getByRole('button', { name: 'ملخص اليوم: المبيعات والمصروفات وقراري' }));
        await waitFor(() => {
            expect(screen.getByText(/المبيعات 430 ألف/)).toBeTruthy();
        });
        first.unmount();
        renderChat();
        expect(screen.getByText(/المبيعات 430 ألف/)).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'مسح' }));
        expect(screen.queryByText(/المبيعات 430 ألف/)).toBeNull();
        expect(screen.getByText('اسألني عن أي رقم في النظام')).toBeTruthy();
    });
});
