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

function installSpeechRecognitionMock() {
    const instances: Array<{ lang: string; onstart: null | (() => void); onresult: null | ((e: unknown) => void); onerror: null | ((e: { error: string }) => void); onend: null | (() => void) }> = [];
    class MockRecognition {
        onstart: null | (() => void) = null;
        onresult: null | ((e: unknown) => void) = null;
        onerror: null | ((e: { error: string }) => void) = null;
        onend: null | (() => void) = null;
        lang = '';
        interimResults = true;
        continuous = false;
        maxAlternatives = 1;
        constructor() { instances.push(this as never); }
        start() { this.onstart?.(); }
        stop() { this.onend?.(); }
        abort() { this.onend?.(); }
    }
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockRecognition;
    return instances;
}

describe('الصوت', () => {
    it('زر الميك يبدأ الاستماع، وينقل السؤال، ويُقرأ الرد بنقرة زر استمع', async () => {
        stubFetch();
        const instances = installSpeechRecognitionMock();
        const speakMock = vi.fn((utterance: { onstart?: () => void; onend?: () => void }) => {
            utterance.onstart?.();
            utterance.onend?.();
        });
        Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: {
                speak: speakMock,
                cancel: vi.fn(),
                getVoices: () => [{ lang: 'ar-SA', name: 'Microsoft Zariya' } as SpeechSynthesisVoice],
                onvoiceschanged: null,
            },
        });
        (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = class MockUtterance {
            text: string;
            lang = 'ar-SA';
            rate = 1;
            pitch = 1;
            volume = 1;
            onstart: null | (() => void) = null;
            onend: null | (() => void) = null;
            onerror: null | (() => void) = null;
            voice: SpeechSynthesisVoice | null = null;
            constructor(text: string) { this.text = text; }
        };
        renderChat();
        fireEvent.click(screen.getByRole('button', { name: 'اسأل بصوتك' }));
        expect(instances.length).toBe(1);
        const rec = instances[0] as unknown as {
            onresult: null | ((e: unknown) => void);
            lang: string;
            stop(): void;
        };
        expect(rec.lang).toBe('ar-SA');
        rec.onresult?.({
            resultIndex: 0,
            results: [{ isFinal: true, 0: { transcript: 'تقرير اليوم', confidence: 0.9 } }],
        });
        // المتصفّح يُطلق onend بعد النتيجة النهائية — هذا ما يحرّر الإرسال التلقائي
        rec.stop();
        await waitFor(() => {
            expect(screen.getByText(/المبيعات 430 ألف/)).toBeTruthy();
        });
        fireEvent.click(screen.getAllByRole('button', { name: 'استمع للرد' })[0] as HTMLElement);
        expect(speakMock).toHaveBeenCalledTimes(1);
        expect(String((speakMock.mock.calls[0] as [{ text: string }])[0]?.text ?? '')).toContain('المبيعات');
    });
});

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
