import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { ExternalSales } from './ExternalSales';

export const Route = createLazyRoute('/ext-sales')({
    component: () => (
        <ScreenGate screen="ext-sales">
            <ExternalSales />
        </ScreenGate>
    ),
});
