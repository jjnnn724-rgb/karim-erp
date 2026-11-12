import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Yarasoft } from './Yarasoft';

/** وحدة التحميل الكسول لشاشة يارسوفت. */
export const Route = createLazyRoute('/yarasoft')({
    component: () => (
        <ScreenGate screen="yarasoft">
            <Yarasoft />
        </ScreenGate>
    ),
});
