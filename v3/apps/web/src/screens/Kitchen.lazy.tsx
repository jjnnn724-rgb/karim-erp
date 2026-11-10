import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Kitchen } from './Kitchen';

/** وحدة التحميل الكسول لنظرة المطبخ. */
export const Route = createLazyRoute('/kitchen')({
    component: () => (
        <ScreenGate screen="kitchen">
            <Kitchen />
        </ScreenGate>
    ),
});
