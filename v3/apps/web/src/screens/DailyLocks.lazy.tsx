import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { DailyLocks } from './DailyLocks';

/** وحدة التحميل الكسول للوحة التقفيل اليومي — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/daily-locks')({
    component: () => (
        <ScreenGate screen="daily-locks">
            <DailyLocks />
        </ScreenGate>
    ),
});
