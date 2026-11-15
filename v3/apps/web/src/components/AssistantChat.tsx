/**
 * AssistantChat — «اسأل أي رقم في Karim ERP» — محادثة ذكية بحق، بالنموذج المحلي (Qwen) ثم Gemini.
 *
 * التصميم:
 *   · فقاعات كربون/ذهبي بهوية النظام، RTL بالكامل، حركة ناعمة عند كل ردّ.
 *   · عدّاد استعلام أسفل كل ردّ: الموديل + زمن التنفيذ + أرضية المصدر (بيانات النظام / عام).
 *   · اقتراحات جاهزة في حالة الفراغ — تقود المستخدم إلى أقوى الأسئلة.
 *   · التاريخ يُحفظ محليًا (localStorage) — لا شيء يُرفع لخادم خارج نظامك.
 *   · حماية من المعدل: الخادم 12 سؤالًا/5 دقائق لكل مدير — الرسائل تظهر كما هي.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { askAssistant, fetchStatus } from '../lib/ai-chat';
import { createSpeechSession, listen, voiceSupport, type ListenSession, type SpeakSession } from '../lib/voice';
import { printOfficialSheet } from '../lib/official-print';

type ChatRole = 'user' | 'assistant';

interface ChatMessage {
    id: string;
    role: ChatRole;
    text: string;
    meta?: {
        model: string | null;
        ms: number;
        grounded?: boolean | null;
        fallback?: boolean | null;
        mode?: string | null;
    };
    at: string;
}

const STORAGE_KEY = 'karim-ai-chat-v1';
const MAX_MESSAGES = 60;

const SUGGESTIONS = [
    'ملخص اليوم: المبيعات والمصروفات وقراري',
    'مين الموظفين المتأخرين اليوم؟',
    'كم إذن صرف صدر اليوم؟',
    'أعلى قسم فيه صرف من المخزن هذا الأسبوع',
    'أعطني تنبيهات المخزون المنخفضة',
];

function loadHistory(): ChatMessage[] {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) { return []; }
        const parsed = JSON.parse(raw) as ChatMessage[];
        return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : [];
    } catch {
        return [];
    }
}

function saveHistory(messages: ChatMessage[]): void {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES))); } catch { /* best effort */ }
}

function nowStamp(): string {
    const now = new Date();
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function fmtSecs(ms: number): string {
    if (ms < 1000) { return `${ms} ms`; }
    return `${(ms / 1000).toFixed(1)} ث`;
}

function metaLine(meta: ChatMessage['meta']): string {
    if (!meta) { return ''; }
    const bits: string[] = [];
    bits.push(meta.model ? `الموديل: ${meta.model}` : 'القاعدة الحية');
    if (meta.ms) { bits.push(`زمن: ${fmtSecs(meta.ms)}`); }
    if (meta.grounded === true) { bits.push('من قاعدة البيانات'); } else if (meta.grounded === false) { bits.push('عام'); }
    if (meta.fallback) { bits.push('ردّ احتياطي'); }
    return bits.join(' · ');
}

export function AssistantChat() {
    const { toast } = useToast();
    const listRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const micSessionRef = useRef<ListenSession | null>(null);
    const speechSessionRef = useRef<SpeakSession | null>(null);

    const support = useMemo(() => voiceSupport(), []);
    const [listening, setListening] = useState(false);
    const [interim, setInterim] = useState('');
    const [speakingId, setSpeakingId] = useState<string | null>(null);

    const statusQuery = useQuery({
        queryKey: ['ai-assistant-status'],
        queryFn: ({ signal }) => fetchStatus(signal),
        staleTime: 60_000,
        retry: 1,
    });
    const status = statusQuery.data ?? null;
    const localReady = status?.local === true && status?.enabled !== false;

    const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory());
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { saveHistory(messages); }, [messages]);
    useEffect(() => {
        const node = listRef.current;
        if (node) { node.scrollTop = node.scrollHeight; }
    }, [messages, busy, error]);
    useEffect(() => {
        if (!busy) { return undefined; }
        const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => window.clearInterval(t);
    }, [busy]);

    // ── الميكروفون: زر ضغط واحد يبدأ/يوقف؛ النص النهائي يُطير تلقائيًا ──
    const toggleMic = useCallback((): void => {
        if (listening) {
            micSessionRef.current?.stop();
            return;
        }
        const session = listen({ lang: 'ar-SA' });
        if (!session) {
            toast({ title: 'المتصفح لا يدعم التعرف على الصوت — جرّب Chrome أو Edge', variant: 'error' });
            return;
        }
        micSessionRef.current?.cancel();
        micSessionRef.current = session;
        session.onInterim((text) => setInterim(text));
        session.onFinal((text) => { setInterim(''); void send(text); });
        session.onError((friendly) => { setInterim(''); toast({ title: friendly, variant: 'error' }); });
        session.onStateChange((active) => {
            setListening(active);
            if (!active) { micSessionRef.current = null; }
        });
        setInterim('');
        session.start();
    }, [listening, send, toast]);

    // ── النطق: زر استماع لكل رد ──
    const toggleSpeak = useCallback((messageId: string, text: string): void => {
        if (!speechSessionRef.current) { speechSessionRef.current = createSpeechSession(); }
        const speech = speechSessionRef.current;
        if (!speech) {
            toast({ title: 'المتصفح لا يدعم النطق — جرّب Chrome أو Edge', variant: 'error' });
            return;
        }
        if (speakingId === messageId) {
            speech.stop();
            setSpeakingId(null);
            return;
        }
        speech.stop(); // لا يتراكم
        speech.speak(text);
        setSpeakingId(messageId);
    }, [speakingId, toast]);

    useEffect(() => () => {
        micSessionRef.current?.cancel();
        speechSessionRef.current?.stop();
    }, []);

    useEffect(() => {
        // عند بدء ردّ جديد: سكوت عن أي نطق سابق
        if (busy) { speechSessionRef.current?.stop(); setSpeakingId(null); }
    }, [busy]);

    async function send(textRaw?: string): Promise<void> {
        const text = (textRaw ?? input).trim();
        if (!text || busy) { return; }
        setError(null);
        const started = Date.now();
        setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', text, at: nowStamp() }]);
        setInput('');
        setBusy(true);
        setElapsed(0);
        try {
            const answer = await askAssistant(text, { mode: 'knowledge' });
            const body = String(answer.text ?? '').trim();
            const ms = Date.now() - started;
            setMessages((prev) => [
                ...prev,
                {
                    id: `${Date.now()}-a`,
                    role: 'assistant',
                    text: body || 'لم يصل ردّ — حاول مرة أخرى.',
                    meta: { model: answer.model ?? null, ms, grounded: answer.grounded ?? null, fallback: answer.fallback ?? null, mode: answer.mode ?? null },
                    at: nowStamp(),
                },
            ]);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'تعذر الاتصال بالمساعد';
            setError(message);
            toast({ title: message, variant: 'error' });
        } finally {
            setBusy(false);
        }
    }

    function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
        }
    }

    function clearChat(): void {
        setMessages([]);
        setError(null);
        try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* best effort */ }
        inputRef.current?.focus();
    }

    function printChat(): void {
        if (!messages.length) { return; }
        const list = messages.map((m) => (m.role === 'user' ? `س: ${m.text}` : `ج: ${m.text}`));
        printOfficialSheet({
            title: 'محادثة مع المساعد الذكي',
            englishTitle: 'AI Assistant Transcript',
            subtitle: `${messages.length} رسالة — ${new Date().toLocaleDateString('ar-SA')}`,
            sections: [{ heading: 'نص المحادثة', list }],
            ref: `AI-${Date.now().toString().slice(-6)}`,
        });
    }

    const canPrint = messages.length > 0;

    return (
        <section className="ai-chat" aria-label="المحادثة الذكية">
            <header className="ai-chat__head">
                <div className="ai-chat__title-block">
                    <span className="ai-chat__eyebrow" dir="ltr" lang="en">SMART ASK · QWEN محلي</span>
                    <h2 className="ai-chat__title">اسأل أي رقم في Karim ERP</h2>
                    <p className="ai-chat__status" aria-live="polite">
                        <span className={`ai-chat__dot ${localReady ? 'ai-chat__dot--ok' : status ? 'ai-chat__dot--warn' : 'ai-chat__dot--off'}`} />
                        {statusQuery.isPending
                            ? 'المساعد متصل…'
                            : localReady
                                ? `المساعد جاهز${status?.model ? ` · ${status.model}` : ''}`
                                : status?.enabled
                                    ? 'المساعد متصل (الرد قد يكون أبطأ)'
                                    : 'المساعد غير مفعّل على هذا الخادم'}
                    </p>
                </div>
                <div className="ai-chat__actions">
                    <Button type="button" variant="ghost" size="sm" onClick={clearChat}>
                        مسح
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={printChat} disabled={!canPrint}>
                        🖨 طباعة
                    </Button>
                </div>
            </header>

            <div className="ai-chat__body" ref={listRef} role="log" aria-live="polite" aria-label="سجل المحادثة">
                {messages.length === 0 ? (
                    <div className="ai-chat__empty">
                        <p className="ai-chat__empty-title">اسألني عن أي رقم في النظام</p>
                        <p className="ai-chat__empty-hint">المبيعات، المصروفات، التأخير، أذون الصرف، المخزون — كلها عندي.</p>
                        <div className="ai-chat__chips">
                            {SUGGESTIONS.map((s) => (
                                <button key={s} type="button" className="ai-chat__chip" onClick={() => void send(s)}>
                                    {s}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <ol className="ai-chat__list">
                        {messages.map((m) => (
                            <li key={m.id} className={`ai-chat__msg ai-chat__msg--${m.role}`}>
                                {m.role === 'assistant' ? <span className="ai-chat__avatar" aria-hidden="true">✦</span> : null}
                                <div className="ai-chat__col">
                                    <div className={`ai-chat__bubble ai-chat__bubble--${m.role}`}>{m.text}</div>
                                    <p className="ai-chat__meta">
                                        <time>{m.at}</time>
                                        {m.role === 'assistant' && m.meta ? <span>{metaLine(m.meta)}</span> : null}
                                        {m.role === 'assistant' && support.speech ? (
                                            <button
                                                type="button"
                                                className={`ai-chat__speak${speakingId === m.id ? ' ai-chat__speak--on' : ''}`}
                                                aria-label={speakingId === m.id ? 'إيقاف القراءة' : 'استمع للرد'}
                                                aria-pressed={speakingId === m.id}
                                                onClick={() => toggleSpeak(m.id, m.text)}
                                            >
                                                {speakingId === m.id ? '⏹ إيقاف' : '🔊 استمع'}
                                            </button>
                                        ) : null}
                                    </p>
                                </div>
                            </li>
                        ))}
                        {busy ? (
                            <li className="ai-chat__msg ai-chat__msg--assistant" role="status">
                                <span className="ai-chat__avatar" aria-hidden="true">✦</span>
                                <div className="ai-chat__col">
                                    <div className="ai-chat__thinking" aria-label="يفكر…">
                                        <span /><span /><span />
                                    </div>
                                    <p className="ai-chat__meta">يفكر{elapsed > 2 ? `… ${elapsed} ث` : '…'}</p>
                                </div>
                            </li>
                        ) : null}
                        {error ? (
                            <li className="ai-chat__msg ai-chat__msg--assistant">
                                <div className="ai-chat__bubble ai-chat__bubble--error" role="alert">{error}</div>
                            </li>
                        ) : null}
                    </ol>
                )}
            </div>

            {listening ? (
                <div className="ai-chat__listening" role="status" aria-live="polite">
                    <span className="ai-chat__mic-pulse" aria-hidden="true" />
                    <span>{interim ? interim : 'يسمعك… اضغط الميك مرة أخرى للتثبيت'}</span>
                </div>
            ) : null}

            <form
                className="ai-chat__composer"
                onSubmit={(event) => { event.preventDefault(); void send(); }}
            >
                <textarea
                    ref={inputRef}
                    className="ai-chat__input"
                    rows={1}
                    value={input}
                    disabled={busy}
                    placeholder="اكتب سؤالك… مثال: تقرير المبيعات أمس والأكثر أهمية فيها"
                    aria-label="سؤال للمساعد الذكي"
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                />
                {support.mic ? (
                    <button
                        type="button"
                        className={`ai-chat__mic${listening ? ' ai-chat__mic--on' : ''}`}
                        onClick={toggleMic}
                        aria-label={listening ? 'أوقف الاستماع' : 'اسأل بصوتك'}
                        aria-pressed={listening}
                        title="اسأل بصوتك — الميكروفون"
                    >
                        <span aria-hidden="true">🎙</span>
                    </button>
                ) : null}
                <button
                    type="submit"
                    className="ai-chat__send"
                    disabled={busy || !input.trim()}
                    aria-label="إرسال"
                >
                    <span aria-hidden="true">➤</span>
                </button>
            </form>
        </section>
    );
}

export function formatAskMeta(meta: ChatMessage['meta']): string {
    return metaLine(meta);
}
