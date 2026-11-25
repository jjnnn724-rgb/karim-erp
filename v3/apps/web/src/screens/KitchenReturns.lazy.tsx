import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { KitchenReturns } from './KitchenReturns';

export const Route = createLazyRoute('/wh-returns')({
    component: () => (
        <ScreenGate screen="wh-returns">
            <KitchenReturns />
        </ScreenGate>
    ),
});
