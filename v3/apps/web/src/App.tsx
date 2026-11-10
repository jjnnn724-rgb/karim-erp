import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { ConfirmProvider } from './components/ConfirmProvider';
import { ErrorBoundary, RouteError } from './components/ErrorBoundary';
import { routeTree } from './routes/routes';
import { ToastProvider } from './ui/Toast';

/**
 * المُوجِّه — `basepath` هو `/v3` لأن التطبيق يُخدَم تحت ذلك المسار في
 * السيرفر القديم (ADR-02: داخل Express، لا على أصلٍ آخر).
 */

export const queryClient = new QueryClient({
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
 * المزوّدات الجذرية للكتابة: `ToastProvider` لرسائل النجاح/الخطأ، و
 * `ConfirmProvider` لتأكيد الإجراءات كما في `js/v2/confirm.js`. كلاهما
 * خارج الموجّه كي تعمل من أي شاشة ومن داخل النوافذ.
 */
export function App() {
    return (
        <QueryClientProvider client={queryClient}>
            <ToastProvider>
                <ConfirmProvider>
                    <ErrorBoundary>
                        <RouterProvider router={router} />
                    </ErrorBoundary>
                </ConfirmProvider>
            </ToastProvider>
        </QueryClientProvider>
    );
}
