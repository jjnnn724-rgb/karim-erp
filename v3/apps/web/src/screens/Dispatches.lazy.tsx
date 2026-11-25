import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Dispatches } from './Dispatches';

/** وحدة التحميل الكسول لأذون الصرف — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/dispatch')({
    component: () => (
        <ScreenGate screen="dispatch">
            <Dispatches />
        </ScreenGate>
    ),
});
