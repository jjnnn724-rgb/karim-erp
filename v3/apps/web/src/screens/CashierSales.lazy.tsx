import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CashierSales } from './CashierSales';

/** وحدة التحميل الكسول لمبيعات الكاشير. */
export const Route = createLazyRoute('/cashier-sales')({
    component: () => (
        <ScreenGate screen="cashier-sales">
            <CashierSales />
        </ScreenGate>
    ),
});
