import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { VegRequests } from './VegRequests';

export const Route = createLazyRoute('/veg-requests')({
    component: () => (
        <ScreenGate screen="veg-requests">
            <VegRequests />
        </ScreenGate>
    ),
});
