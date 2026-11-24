import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRealtimeForTests, startRealtime, stopRealtime } from './realtime';

/**
 * الدفع اللحظي — يُختبَر بعميل socket.io مُستبدل (`io` عام) وبسكربت حقن
 * نتحكم في onload/onerror يدويًا (jsdom لا يحمّل الشبكة). نثبّت: البدء
 * idempotent، لا توكن⇒لا اتصال، الأحداث⇒إبطال مجمّع، الإيقاف⇒قطع، فشل
 * السكربت⇒صامت، وخطأ المصادقة⇒توقف هادئ.
 */

const SCRIPT_ID = 'karim-v3-socket-io';

type Handler = (...args: unknown[]) => void;

function mockIo() {
    const handlers = new Map<string, Handler>();
    const socket = {
        on: vi.fn((event: string, handler: Handler) => {
            handlers.set(event, handler);
        }),
        disconnect: vi.fn(),
    };
    const io = vi.fn((_options: { auth: { token: string }; transports: string[] }) => socket);
    vi.stubGlobal('io', io);
    return { io, socket, handlers };
}

/** تفريغ المهام الدقيقة — وعد السكربت يحلّ فورًا حين يكون `io` عامًا. */
async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function injectedScript(): HTMLScriptElement | null {
    return document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
}

beforeEach(() => {
    resetRealtimeForTests();
    vi.useRealTimers();
});

afterEach(() => {
    resetRealtimeForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('بدء الدفع اللحظي', () => {
    it('idempotent — نداءان متكرران يفتحان اتصالًا واحدًا', async () => {
        const { io } = mockIo();
        const onEntityChanged = vi.fn();
        startRealtime({ getToken: () => 'tok', onEntityChanged });
        startRealtime({ getToken: () => 'tok', onEntityChanged });
        await flush();
        expect(io).toHaveBeenCalledTimes(1);
        expect(io.mock.calls[0]?.[0]).toMatchObject({
            auth: { token: 'tok' },
            transports: ['websocket', 'polling'],
        });
    });

    it('بلا توكن ⇒ لا اتصال ولا حقن سكربت', async () => {
        const { io } = mockIo();
        startRealtime({ getToken: () => null, onEntityChanged: vi.fn() });
        await flush();
        expect(io).not.toHaveBeenCalled();
        expect(injectedScript()).toBeNull();
    });

    it('يوصل التوكن الأحدث عند الاتصال (getToken يُقرأ حيًّا)', async () => {
        const { io } = mockIo();
        let token: string | null = 'first';
        startRealtime({ getToken: () => token, onEntityChanged: vi.fn() });
        token = 'second';
        await flush();
        expect(io.mock.calls[0]?.[0]).toMatchObject({ auth: { token: 'second' } });
    });
});

describe('الأحداث والإبطال المجمّع', () => {
    it('انفجار أحداث خلال النافذة ⇒ إبطال واحد بعد ~500ms', async () => {
        vi.useFakeTimers();
        const { handlers } = mockIo();
        const onEntityChanged = vi.fn();
        startRealtime({ getToken: () => 'tok', onEntityChanged, debounceMs: 500 });
        await flush();

        handlers.get('entity_changed')?.();
        handlers.get('entity_changed')?.();
        handlers.get('state_updated')?.();

        vi.advanceTimersByTime(499);
        expect(onEntityChanged).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onEntityChanged).toHaveBeenCalledTimes(1);
    });

    it('حدثان متباعدان ⇒ إبطالان', async () => {
        vi.useFakeTimers();
        const { handlers } = mockIo();
        const onEntityChanged = vi.fn();
        startRealtime({ getToken: () => 'tok', onEntityChanged, debounceMs: 500 });
        await flush();

        handlers.get('entity_changed')?.();
        vi.advanceTimersByTime(500);
        handlers.get('state_updated')?.();
        vi.advanceTimersByTime(500);
        expect(onEntityChanged).toHaveBeenCalledTimes(2);
    });
});

describe('الإيقاف', () => {
    it('stopRealtime يقطع الاتصال ويلغي الإبطال المعلّق', async () => {
        vi.useFakeTimers();
        const { socket, handlers } = mockIo();
        const onEntityChanged = vi.fn();
        startRealtime({ getToken: () => 'tok', onEntityChanged });
        await flush();

        handlers.get('entity_changed')?.();
        stopRealtime();
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(1000);
        expect(onEntityChanged).not.toHaveBeenCalled();
    });

    it('الإيقاف قبل حلّ السكربت ⇒ لا اتصال (حارس الجيل)', async () => {
        // لا io عامًا ⇒ السكربت يُحقن ويبقى معلّقًا.
        startRealtime({ getToken: () => 'tok', onEntityChanged: vi.fn() });
        stopRealtime();
        const { io } = mockIo();
        injectedScript()?.dispatchEvent(new Event('load'));
        await flush();
        expect(io).not.toHaveBeenCalled();
    });
});

describe('الفشل الصامت', () => {
    it('فشل تحميل السكربت ⇒ لا اتصال ولا رمي، ولا إعادة حقن', async () => {
        const onEntityChanged = vi.fn();
        startRealtime({ getToken: () => 'tok', onEntityChanged });
        const script = injectedScript();
        expect(script).toBeTruthy();
        script?.dispatchEvent(new Event('error'));
        await flush();
        // io غير موجود ⇒ لا اتصال، صامت.
        expect((globalThis as { io?: unknown }).io).toBeUndefined();

        // إعادة البدء بعد الإيقاف لا تحقن سكربتًا ثانيًا (الوعد محفوظ).
        stopRealtime();
        startRealtime({ getToken: () => 'tok', onEntityChanged });
        await flush();
        expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1);
    });

    it('خطأ مصادقة عند الاتصال ⇒ توقف هادئ (قطع)', async () => {
        const { socket, handlers } = mockIo();
        startRealtime({ getToken: () => 'tok', onEntityChanged: vi.fn() });
        await flush();
        handlers.get('connect_error')?.(new Error('Unauthorized: invalid token'));
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });

    it('خطأ شبكة عابر لا يقطع (تتركه إعادة الاتصال المحدودة)', async () => {
        const { socket, handlers } = mockIo();
        startRealtime({ getToken: () => 'tok', onEntityChanged: vi.fn() });
        await flush();
        handlers.get('connect_error')?.(new Error('websocket error'));
        expect(socket.disconnect).not.toHaveBeenCalled();
    });

    it('استنزاف محاولات إعادة الاتصال ⇒ توقف هادئ', async () => {
        const { socket, handlers } = mockIo();
        startRealtime({ getToken: () => 'tok', onEntityChanged: vi.fn() });
        await flush();
        handlers.get('reconnect_failed')?.();
        expect(socket.disconnect).toHaveBeenCalledTimes(1);
    });
});
