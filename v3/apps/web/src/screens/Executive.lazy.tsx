import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Executive } from './Executive';

/** وحدة التحميل الكسول للموجز التنفيذي — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/executive')({
    component: () => (
        <ScreenGate screen="executive">
            <Executive />
        </ScreenGate>
    ),
});
