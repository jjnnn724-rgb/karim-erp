import { createRootRoute } from '@tanstack/react-router';
import { AuthGate } from '../components/AuthGate';
import { Shell } from '../components/Shell';

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
    return (
        <AuthGate>
            <Shell />
        </AuthGate>
    );
}
