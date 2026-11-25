import { createRootRoute, useRouterState } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthGate } from '../components/AuthGate';
import { Shell } from '../components/Shell';

const SYSTEM_MANIFEST = '/v3/manifest.webmanifest';
const CASHIER_MANIFEST = '/v3/manifest-cashier.webmanifest';

/**
 * الجذر — بوابة الجلسة ثم القشرة.
 *
 * `notFoundComponent`: كل مسار مجهول يعرض رسالةً بدل شاشة فارغة.
 */
export const rootRoute = createRootRoute({
    component: RootLayout,
    notFoundComponent: () => (
        <div className="grid min-h-screen place-items-center bg-canvas">
            <p className="text-body-md text-muted">الصفحة غير موجودة.</p>
        </div>
    ),
});

function RootLayout() {
    const cashierKiosk = useRouterState({
        select: (state) => state.location.pathname.replace(/\/+$/, '') === '/cashier',
    });
    // صفحة الكاشير مدخل مستقل قابل للتثبيت، والنظام كله تطبيق واحد على نفس
    // الخادم ونفس قاعدة البيانات — فالتبديل يمسّ بيانات التطبيق وحدها.
    useEffect(() => {
        const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
        if (!link) return;
        link.setAttribute('href', cashierKiosk ? CASHIER_MANIFEST : SYSTEM_MANIFEST);
    }, [cashierKiosk]);

    return (
        <AuthGate kiosk={cashierKiosk}>
            <Shell />
        </AuthGate>
    );
}
