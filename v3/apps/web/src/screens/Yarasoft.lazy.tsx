import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Yarasoft } from './Yarasoft';

/** وحدة التحميل الكسول لشاشة إيرادات الكاشير. */
export const Route = createLazyRoute('/yarasoft')({
    component: () => (
        <ScreenGate screen="yarasoft">
            <Yarasoft />
        </ScreenGate>
    ),
});
