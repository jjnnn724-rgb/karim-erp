import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { AccountantDashboard } from './AccountantDashboard';

/** وحدة التحميل الكسول للوحة المحاسب. */
export const Route = createLazyRoute('/accountant-dashboard')({
    component: () => (
        <ScreenGate screen="accountant-dashboard">
            <AccountantDashboard />
        </ScreenGate>
    ),
});
