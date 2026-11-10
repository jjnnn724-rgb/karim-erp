import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Leaves } from './Leaves';

export const Route = createLazyRoute('/leaves')({
    component: () => (
        <ScreenGate screen="leaves">
            <Leaves />
        </ScreenGate>
    ),
});
