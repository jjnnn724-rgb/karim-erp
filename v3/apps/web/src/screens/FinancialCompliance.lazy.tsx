import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { FinancialCompliance } from './FinancialCompliance';

export const Route = createLazyRoute('/financial-compliance')({
    component: () => (
        <ScreenGate screen="financial-compliance">
            <FinancialCompliance />
        </ScreenGate>
    ),
});
