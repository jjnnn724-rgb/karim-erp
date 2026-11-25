import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Zkteco } from './Zkteco';

/** وحدة التحميل الكسول لأجهزة البصمة. */
export const Route = createLazyRoute('/zkteco')({
    component: () => (
        <ScreenGate screen="zkteco">
            <Zkteco />
        </ScreenGate>
    ),
});
