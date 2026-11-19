import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ErrorBoundary, RouteError } from './components/ErrorBoundary';
import { handleAuthError, registerSessionToast } from './lib/session-recovery';
import { routeTree } from './routes/routes';
import { ToastProvider, useToast } from './ui/Toast';

/**
 * المُوجِّه — `basepath` هو `/v3` لأن التطبيق يُخدَم تحت ذلك المسار في
 * السيرفر القديم (ADR-02: داخل Express، لا على أصلٍ آخر).
 */

/**
 * عميل الاستعلامات — ذاكرتا الاستعلامات والكتابات تمرّان أخطاءهما على
 * `handleAuthError`: استجابة تفاعلية لـ401 (تجديد مرة واحدة ثم إعادة جلب،
 * أو خروج + توست واحد). 403 لا يُنهي الجلسة. انظر `lib/session-recovery.ts`.
 */
export const queryClient = new QueryClient({
    queryCache: new QueryCache({
        onError: (error) => {
            void handleAuthError(error, queryClient);
        },
    }),
    mutationCache: new MutationCache({
        onError: (error) => {
            void handleAuthError(error, queryClient);
        },
    }),
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
        },
    },
});

export const router = createRouter({
    routeTree,
    basepath: '/v3',
    defaultPreload: 'intent',
    // انهيار شاشةٍ لا يُسقط القشرة: الخطأ يُعرض داخل المسار مع «إعادة المحاولة».
    defaultErrorComponent: RouteError,
});

declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router;
    }
}

/**
 * جسر التوست — يسجّل دالة التوست (من داخل المزوّد) في طبقة استعادة الجلسة
 * التي تعمل خارج المكوّنات، فتستطيع عرض «انتهت الجلسة» عند فشل التجديد.
 */
function SessionToastBridge() {
    const { toast } = useToast();
    useEffect(() => {
        registerSessionToast(toast);
        return () => {
            registerSessionToast(null);
        };
    }, [toast]);
    return null;
}

/**
 * المزوّدات الجذرية للكتابة: `ToastProvider` لرسائل النجاح/الخطأ، و
 * `ConfirmProvider` لتأكيد الإجراءات كما في `js/v2/confirm.js`. كلاهما
 * خارج الموجّه كي تعمل من أي شاشة ومن داخل النوافذ.
 */
export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <SessionToastBridge />
                <ConfirmProvider>
                    <ErrorBoundary>
                        <RouterProvider router={router} />
                    </ErrorBoundary>
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>
    );
}
