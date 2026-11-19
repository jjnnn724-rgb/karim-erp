import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CashierKiosk } from './CashierKiosk';

/** وحدة كشك الكاشير — تُحمَّل عند فتح `/cashier` وحده. */
export const Route = createLazyRoute('/cashier')({
    component: () => (
        <ScreenGate screen="pos-entry">
            <CashierKiosk />
        </ScreenGate>
    ),
});
