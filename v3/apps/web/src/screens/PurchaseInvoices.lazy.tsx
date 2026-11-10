import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { PurchaseInvoices } from './PurchaseInvoices';

export const Route = createLazyRoute('/purchase-invoices')({
    component: () => (
        <ScreenGate screen="purchase-invoices">
            <PurchaseInvoices />
        </ScreenGate>
    ),
});
