import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { PurchaseRequests } from './PurchaseRequests';

export const Route = createLazyRoute('/wh-prs')({
    component: () => (
        <ScreenGate screen="wh-prs">
            <PurchaseRequests />
        </ScreenGate>
    ),
});
