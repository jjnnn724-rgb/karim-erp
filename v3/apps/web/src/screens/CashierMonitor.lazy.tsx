import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CashierMonitor } from './CashierMonitor';

/** وحدة التحميل الكسول لمتابعة الكاشير. */
export const Route = createLazyRoute('/cashier-monitor')({
    component: () => (
        <ScreenGate screen="cashier-monitor">
            <CashierMonitor />
        </ScreenGate>
    ),
});
