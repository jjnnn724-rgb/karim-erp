import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Whatsapp } from './Whatsapp';

export const Route = createLazyRoute('/whatsapp')({
    component: () => (
        <ScreenGate screen="whatsapp">
            <Whatsapp />
        </ScreenGate>
    ),
});
