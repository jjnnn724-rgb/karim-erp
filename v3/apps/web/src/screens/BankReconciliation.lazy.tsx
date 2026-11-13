import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { BankReconciliation } from './BankReconciliation';

export const Route = createLazyRoute('/bank-rec')({
    component: () => (
        <ScreenGate screen="bank-rec">
            <BankReconciliation />
        </ScreenGate>
    ),
});
