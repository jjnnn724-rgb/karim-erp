/**
 * الدفع اللحظي (socket.io) — مُسرِّع اختياري فوق الاستطلاع الدوري.
 *
 * القاعدة الحاكمة: **اللحظي مُسرِّع لا اعتمادية صحة**. مواقع `refetchInterval`
 * الـ17 تبقى كما هي وتغطّي البيانات دائمًا؛ فإن تعذّر الاتصال أو سقط السكربت
 * أو رُفض التوكن، يتوقف هذا المسار بهدوء ويستمر الاستطلاع وحده. لا اعتماديات
 * جديدة: نحمّل عميل socket.io الذي يخدمه السيرفر القديم من
 * `/socket.io/socket.io.js` (نمط `frontend/app/js/v2/board/boot.js`).
 *
 * الأحداث: `entity_changed` و`state_updated` (يبثّهما القديم عبر `emitScoped`).
 * نجمع الانفجارات في نافذة ~500ms ثم ننادي المعالج مرة واحدة (إبطال خشن).
 */

/** شكل أدنى لعميل socket.io — بلا اعتمادية أنواع خارجية (لا حزم جديدة). */
type SocketHandler = (...args: unknown[]) => void;
interface RealtimeSocket {
    on(event: string, handler: SocketHandler): void;
    disconnect(): void;
}
interface IoOptions {
    auth: { token: string };
    transports: string[];
    reconnectionAttempts: number;
    reconnectionDelay: number;
    reconnectionDelayMax: number;
}
type IoConnect = (options: IoOptions) => RealtimeSocket;

export interface RealtimeOptions {
    /** توكن الوصول الحالي — يُقرأ عند الاتصال (لا جلسة ⇒ لا اتصال). */
    getToken: () => string | null;
    /** يُنادى بعد تجميع الانفجارات (إبطال خشن للاستعلامات). */
    onEntityChanged: () => void;
    /** نافذة تجميع الانفجارات بالمللي ثانية (الافتراضي 500). */
    debounceMs?: number;
}

const SCRIPT_ID = 'karim-v3-socket-io';
const SCRIPT_SRC = '/socket.io/socket.io.js';
const DEFAULT_DEBOUNCE_MS = 500;
/** محاولات إعادة اتصال محدودة («ما لا نهاية» مقيدة) ثم توقف هادئ. */
const RECONNECTION_ATTEMPTS = 50;

let socket: RealtimeSocket | null = null;
let scriptPromise: Promise<void> | null = null;
let debounceTimer: number | null = null;
let started = false;
/** جيل البدء — يُلغي أي بدءٍ معلّق إذا توقف المسار أو أُعيد قبل تحميل السكربت. */
let epoch = 0;

function getIo(): IoConnect | null {
    // `globalThis` === `window` في المتصفح؛ وقراءة العام هنا تطابق حقن الاختبار.
    const io = (globalThis as unknown as { io?: IoConnect }).io;
    return typeof io === 'function' ? io : null;
}

/**
 * يحمّل سكربت العميل مرة واحدة (idempotent). يحلّ الوعد عند النجاح **أو**
 * الفشل — لا يرفض أبدًا، كي يبقى الفشل صامتًا والاستطلاع هو الغطاء. وإن كان
 * `io` موجودًا أصلًا (حمّله القديم مثلًا) يحلّ فورًا بلا حقن سكربت.
 */
function loadScript(): Promise<void> {
    if (scriptPromise) {
        return scriptPromise;
    }
    scriptPromise = new Promise<void>((resolve) => {
        if (getIo()) {
            resolve();
            return;
        }
        try {
            const script = document.createElement('script');
            script.id = SCRIPT_ID;
            script.src = SCRIPT_SRC;
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => resolve();
            document.head.appendChild(script);
        } catch {
            // بيئة بلا DOM/حقن معطّل — الاستطلاع يغطّي.
            resolve();
        }
    });
    return scriptPromise;
}

/** خطأ مصادقة من الخادم/العميل — نتوقف عنده بهدوء (الاستطلاع باقٍ). */
function isAuthError(err: unknown): boolean {
    if (!err) {
        return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    return /unauthorized|invalid[ _-]?token|jwt|expired|auth|401/i.test(message);
}

/** يجمع انفجار الأحداث في نافذة واحدة ثم ينادي المعالج مرة. */
function scheduleInvalidation(options: RealtimeOptions): void {
    const wait = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        options.onEntityChanged();
    }, wait);
}

/**
 * يبدأ الدفع اللحظي إن وُجد توكن. idempotent: نداءات متكررة لا تفتح أكثر من
 * اتصال. لا توكن ⇒ لا اتصال (شاشة الدخول لا تتصل). فشل السكربت/الاتصال صامت.
 */
export function startRealtime(options: RealtimeOptions): void {
    if (started) {
        return;
    }
    if (!options.getToken()) {
        return;
    }
    started = true;
    const myEpoch = ++epoch;
    void loadScript().then(() => {
        // توقف المسار أو أُعيد بدءٌ أحدث أثناء التحميل — لا اتصال لهذا البدء.
        if (!started || myEpoch !== epoch) {
            return;
        }
        const io = getIo();
        const token = options.getToken();
        if (!io || !token) {
            return;
        }
        try {
            const next = io({
                auth: { token },
                transports: ['websocket', 'polling'],
                reconnectionAttempts: RECONNECTION_ATTEMPTS,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 15000,
            });
            socket = next;
            const schedule = () => scheduleInvalidation(options);
            next.on('entity_changed', schedule);
            next.on('state_updated', schedule);
            // بصمة جديدة كُتبت صفّها في `attendance` — حدّث شاشة الحضور فورًا.
            next.on('attendance:updated', schedule);
            // رفض المصادقة ⇒ توقف هادئ؛ غير ذلك تتركه إعادة الاتصال المحدودة.
            next.on('connect_error', (err) => {
                if (isAuthError(err)) {
                    stopRealtime();
                }
            });
            next.on('error', (err) => {
                if (isAuthError(err)) {
                    stopRealtime();
                }
            });
            // استُنزفت المحاولات المحدودة — توقف هادئ والاستطلاع يغطّي.
            next.on('reconnect_failed', () => stopRealtime());
        } catch {
            // الاتصال مُسرِّع؛ أي رميٍ هنا لا يكسر التطبيق.
            stopRealtime();
        }
    });
}

/** يوقف الدفع اللحظي: يقطع الاتصال ويلغي أي إبطال معلّق. صامت دائمًا. */
export function stopRealtime(): void {
    started = false;
    epoch++;
    if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
    }
    if (socket) {
        try {
            socket.disconnect();
        } catch {
            // قطعٌ معطّل — الحالة المحلية كافية.
        }
        socket = null;
    }
}

/** يعيد حالة الوحدة بين الاختبارات (ويحذف سكربت الحقن إن وُجد). */
export function resetRealtimeForTests(): void {
    stopRealtime();
    scriptPromise = null;
    epoch = 0;
    document.getElementById(SCRIPT_ID)?.remove();
}
