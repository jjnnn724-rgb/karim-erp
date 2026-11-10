import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Cfo } from './Cfo';

/** وحدة التحميل الكسول للمدير المالي — تُحمَّل عند فتح المسار فقط. */
export const Route = createLazyRoute('/cfo')({
    component: () => (
        <ScreenGate screen="cfo">
            <Cfo />
        </ScreenGate>
    ),
});
