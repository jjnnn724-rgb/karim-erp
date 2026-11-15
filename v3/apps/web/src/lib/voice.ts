/**
 * voice.ts — الصوت المدمج في المتصفح (Web Speech API) — عربي افتراضًا.
 * ───────────────────────────────────────────────────────────
 * الالتقاط:  `listen` — تسجيل من الميك بجودة المتصفح، with interim results لحظية.
 *   · يُفضّل Chrome/Edge + Android Chrome؛ أي متصفح يدعم SpeechRecognition يعمل.
 *   · ar-SA كنجم أوضح ولكن المتصفّحات تتعامل مع أي لهجة عربية جيدًا.
 * النطق:   `createSpeechSession` — speechSynthesis باختيار أنسب صوت عربي على الجهاز،
 *   ولا يحتاج أي خادم — كل شيء محلي.
 * لو المتصفّح/الجهاز لا يدعم: ترجع كل الدوال بهدوء مع «unsupported» ولا تكسر الشاشة.
 */

export interface VoiceSupport {
    mic: boolean;
    speech: boolean;
}

interface SpeechRecognitionAlternative { readonly transcript: string }
interface SpeechRecognitionResult { readonly isFinal: boolean; readonly length: number; readonly [index: number]: SpeechRecognitionAlternative }
interface SpeechRecognitionResultList {
    readonly length: number;
    readonly [index: number]: SpeechRecognitionResult;
    item(index: number): SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike { readonly resultIndex: number; readonly results: SpeechRecognitionResultList }
interface SpeechRecognitionErrorEventLike { readonly error: string }
interface SpeechRecognitionLike {
    lang: string;
    interimResults: boolean;
    continuous: boolean;
    maxAlternatives: number;
    onstart: (() => void) | null;
    onresult: ((event: SpeechRecognitionEventLike) => void) | null;
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
    onend: (() => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function voiceSupport(): VoiceSupport {
    const mic = typeof window !== 'undefined' && Boolean(getRecognitionCtor());
    const speech = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.speechSynthesis?.speak === 'function';
    return { mic, speech };
}

function getRecognitionCtor(): SpeechRecognitionCtor | null {
    if (typeof window === 'undefined') { return null; }
    const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
    return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ── الالتقاط ───────────────────────────────────────────────────────────── */

export interface ListenSession {
    start(): void;
    stop(): void;
    cancel(): void;
    isActive(): boolean;
    onInterim(handler: (text: string) => void): void;
    onFinal(handler: (text: string) => void): void;
    onError(handler: (error: string) => void): void;
    onStateChange(handler: (active: boolean) => void): void;
}

const SILENCE_MS = 1_600;

export function listen(opts: { lang?: string } = {}): ListenSession | null {
    const Ctor = getRecognitionCtor();
    if (!Ctor) { return null; }
    const lang = opts.lang ?? 'ar-SA';
    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 3;

    const interimHandlers: Array<(t: string) => void> = [];
    const finalHandlers: Array<(t: string) => void> = [];
    const errorHandlers: Array<(e: string) => void> = [];
    const stateHandlers: Array<(active: boolean) => void> = [];

    let silenceTimer: number | null = null;
    let active = false;
    let finalText = '';

    const clearSilence = () => {
        if (silenceTimer !== null) { window.clearTimeout(silenceTimer); silenceTimer = null; }
    };
    const setActive = (next: boolean) => {
        if (active === next) { return; }
        active = next;
        for (const h of stateHandlers) { h(active); }
    };

    recognition.onstart = () => { finalText = ''; setActive(true); };
    recognition.onresult = (event: SpeechRecognitionEventLike) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
            const r = event.results[i];
            if (!r) { continue; }
            const alt = r[0];
            const transcript = alt?.transcript ?? '';
            if (r.isFinal) {
                final += transcript;
            } else {
                interim += transcript;
            }
        }
        if (interim) {
            clearSilence();
            silenceTimer = window.setTimeout(() => { try { recognition.stop(); } catch { /* noop */ } }, SILENCE_MS);
            for (const h of interimHandlers) { h(finalText + interim); }
        }
        if (final) {
            finalText += final;
            for (const h of interimHandlers) { h(finalText); }
        }
    };
    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
        clearSilence();
        setActive(false);
        const code = String(event.error ?? 'unknown');
        const friendly = code === 'not-allowed' || code === 'service-not-allowed'
            ? 'الميكروفون مرفوض — اسمح للمتصفح بالوصول إليه من إعدادات الموقع'
            : code === 'no-speech'
                ? 'لم أسمع شيئًا — تكلم بصوت أعلى قليلًا'
                : code === 'network'
                    ? 'تعذر تشغيل التعرف على الصوت — تحقق من الإنترنت'
                    : 'تعذر تشغيل الميكروفون — حاول مرة أخرى';
        for (const h of errorHandlers) { h(friendly); }
    };
    recognition.onend = () => {
        clearSilence();
        setActive(false);
        if (finalText.trim()) {
            for (const h of finalHandlers) { h(finalText.trim()); }
        }
    };

    return {
        start() { try { recognition.start(); } catch { /* already running */ } },
        stop() { try { recognition.stop(); } catch { /* noop */ } },
        cancel() { try { recognition.abort(); } catch { /* noop */ } },
        isActive() { return active; },
        onInterim(handler) { interimHandlers.push(handler); },
        onFinal(handler) { finalHandlers.push(handler); },
        onError(handler) { errorHandlers.push(handler); },
        onStateChange(handler) { stateHandlers.push(handler); },
    };
}

/* ── النطق ──────────────────────────────────────────────────────────────── */

export interface SpeakSession {
    speak(text: string): void;
    stop(): void;
    isSpeaking(): boolean;
    voices(): SpeechSynthesisVoice[];
}

const VOICE_LANG_CANDIDATES = ['ar-SA', 'ar-EG', 'ar-AE', 'ar-IQ', 'ar-SY', 'ar-LB', 'ar-MA', 'ar'];

export function pickBestArabicVoice(): SpeechSynthesisVoice | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { return null; }
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) { return null; }
    for (const lang of VOICE_LANG_CANDIDATES) {
        const exact = voices.find((v) => v.lang?.toLowerCase().startsWith(lang.toLowerCase()));
        if (exact) { return exact; }
    }
    return voices.find((v) => (v.lang ?? '').toLowerCase().startsWith('ar')) ?? voices[0] ?? null;
}

export function createSpeechSession(): SpeakSession | null {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) { return null; }
    let speaking = false;
    const session: SpeakSession = {
        speak(text: string) {
            if (!text.trim()) { return; }
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            const voice = pickBestArabicVoice();
            if (voice) { utterance.voice = voice; }
            utterance.lang = voice?.lang ?? 'ar-SA';
            utterance.rate = 1;
            utterance.pitch = 1;
            utterance.volume = 1;
            utterance.onstart = () => { speaking = true; };
            utterance.onend = () => { speaking = false; };
            utterance.onerror = () => { speaking = false; };
            speaking = true;
            window.speechSynthesis.speak(utterance);
        },
        stop() {
            try { window.speechSynthesis.cancel(); } catch { /* noop */ }
            speaking = false;
        },
        isSpeaking() { return speaking; },
        voices() { return window.speechSynthesis.getVoices().slice(); },
    };
    return session;
}
