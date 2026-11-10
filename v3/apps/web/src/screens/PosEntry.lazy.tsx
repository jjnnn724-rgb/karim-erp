import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { PosEntry } from './PosEntry';

/** وحدة التحميل الكسول للكاشير — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/pos-entry')({
    component: () => (
        <ScreenGate screen="pos-entry">
            <PosEntry />
        </ScreenGate>
    ),
});
