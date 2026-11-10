import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { MonthlyComparison } from './MonthlyComparison';

/** وحدة التحميل الكسول للمقارنة الشهرية. */
export const Route = createLazyRoute('/monthly-comparison')({
    component: () => (
        <ScreenGate screen="monthly-comparison">
            <MonthlyComparison />
        </ScreenGate>
    ),
});
