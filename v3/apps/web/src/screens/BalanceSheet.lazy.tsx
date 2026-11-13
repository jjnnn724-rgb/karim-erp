import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { BalanceSheet } from './BalanceSheet';

export const Route = createLazyRoute('/balance-sheet')({
    component: () => (
        <ScreenGate screen="balance-sheet">
            <BalanceSheet />
        </ScreenGate>
    ),
});
