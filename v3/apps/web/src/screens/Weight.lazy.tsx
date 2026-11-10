import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Weight } from './Weight';

export const Route = createLazyRoute('/weight')({
    component: () => (
        <ScreenGate screen="weight">
            <Weight />
        </ScreenGate>
    ),
});
