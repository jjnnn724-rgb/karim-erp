import { createLazyRoute } from '@tanstack/react-router';
import { Home } from './Home';

/**
 * وحدة التحميل الكسول للصفحة الرئيسية — مسار الجذر `/` (خارج عدّ التكافؤ).
 *
 * تُسجَّل في `routes.tsx` بسطر واحد:
 * `indexRoute.lazy(() => import('../screens/Home.lazy').then((module) => module.Route));`
 * فلا تدخل الرئيسية ولا Recharts في حزمة البداية.
 */
export const Route = createLazyRoute('/')({
    component: Home,
});
