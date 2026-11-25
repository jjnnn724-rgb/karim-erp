import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Sessions } from './Sessions';

export const Route = createLazyRoute('/sessions')({
    component: () => (
        <ScreenGate screen="sessions">
            <Sessions />
        </ScreenGate>
    ),
});
