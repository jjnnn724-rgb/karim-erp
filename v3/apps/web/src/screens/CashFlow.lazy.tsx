import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CashFlow } from './CashFlow';

export const Route = createLazyRoute('/cash-flow')({
    component: () => (
        <ScreenGate screen="cash-flow">
            <CashFlow />
        </ScreenGate>
    ),
});
