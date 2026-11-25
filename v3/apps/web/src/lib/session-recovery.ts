import type { QueryClient } from '@tanstack/react-query';
import type { ToastOptions } from '../ui/Toast';
import { ApiError } from './api';
import { getAuthState, hasRefreshToken, logout, refreshSession } from './auth';

/**
 * الاستجابة التفاعلية لأخطاء 401 — طبقة واحدة تعبرها أخطاء الاستعلامات
 * والكتابات (`queryCache`/`mutationCache` في `App.tsx`).
 *
 * العقد:
 *  · **401 فقط، لا 403**: خطأ الصلاحية (403) يجب ألا يُنهي الجلسة — المستخدم
 *    ما زال مسجّلًا، لكنه يفتقد صلاحية هذا الإجراء.
 *  · **محاولة تجديد واحدة** مع إزالة تكرار النداءات المتزامنة: أخطاء 401
 *    المتزامنة تشترك وعد تجديد واحد، والآثار الجانبية (إبطال أو خروج) تقع
 *    مرة واحدة — صاحب المحاولة وحده ينفّذها.
 *  · **عند النجاح**: `invalidateQueries()` إعادة جلبٍ خشنة بالتوكن الجديد.
 *  · **عند الفشل**: `logout()` يعيد شاشة الدخول + توست عربي واحد.
 *  · **لا حلقة**: نقطة التجديد `/api/auth/refresh` تستخدم `fetch` الخام لا
 *    `fetchJson`، فـ401 منها لا يُنتج `ApiError` ولا يمرّ على هذه الطبقة.
 *    وبعد الخروج تصبح الجلسة مجهولة، فأي 401 متأخر يتخطّى الاستجابة.
 */

type ToastSink = (options: ToastOptions) => void;

/**
 * جسر التوست — `useToast` يحتاج مزوّدًا داخل React، وهذه الطبقة تعمل خارج
 * المكوّنات (من `onError` في الذاكرة). فيسجّل `App` دالة التوست هنا عبر
 * مكوّن جسر داخل `ToastProvider`، وتناديها هذه الطبقة عند انتهاء الجلسة.
 */
let toastSink: ToastSink | null = null;

export function registerSessionToast(sink: ToastSink | null): void {
    toastSink = sink;
}

const SESSION_EXPIRED_TOAST: ToastOptions = {
    title: 'انتهت الجلسة — سجّل الدخول من جديد',
    variant: 'error',
};

/** وعد التجديد الجاري — تشتركه كل أخطاء 401 المتزامنة (إزالة التكرار). */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * يعالج خطأ استعلام/كتابة: يحاول استعادة الجلسة عند 401 فقط. الآثار الجانبية
 * تقع مرة واحدة لكل محاولة (صاحبها)؛ الأخطاء المتزامنة تشترك الوعد نفسه وتعود
 * دون تكرار الآثار. أي خطأ آخر (403/500/شبكة) يُترك لطبقة العرض المعتادة.
 */
export async function handleAuthError(error: unknown, queryClient: QueryClient): Promise<void> {
    if (!(error instanceof ApiError) || error.status !== 401) {
        return;
    }
    // لا جلسة (بعد الخروج مثلًا) — لا محاولة مجددة كي لا نكرّر التوست أو ندور.
    if (!getAuthState().token) {
        return;
    }
    // بلا رمز تحديث (قناة التمهيد) لا مسار تجديد — نترك الخطأ لطبقة العرض ولا
    // نُخرج الجلسة، حفاظًا على سلوك ما قبل الاستجابة التفاعلية.
    if (!hasRefreshToken()) {
        return;
    }
    if (refreshInFlight) {
        await refreshInFlight;
        return;
    }
    const attempt = (async () => {
        const refreshed = await refreshSession();
        if (refreshed) {
            // إعادة جلب خشنة: كل استعلام نشط يعود بالتوكن الجديد.
            await queryClient.invalidateQueries();
        } else {
            // فشل التجديد (رمز مرفوض/منتهٍ) — أفرغ الجلسة وعد لشاشة الدخول.
            logout();
            toastSink?.(SESSION_EXPIRED_TOAST);
        }
        return refreshed;
    })();
    refreshInFlight = attempt;
    try {
        await attempt;
    } finally {
        refreshInFlight = null;
    }
}

/** يعيد حالة الوحدة بين الاختبارات (الوعد والجسر). */
export function resetSessionRecoveryForTests(): void {
    refreshInFlight = null;
    toastSink = null;
}
