import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Shelves } from './Shelves';

export const Route = createLazyRoute('/shelves')({
    component: () => (
        <ScreenGate screen="shelves">
            <Shelves />
        </ScreenGate>
    ),
});
