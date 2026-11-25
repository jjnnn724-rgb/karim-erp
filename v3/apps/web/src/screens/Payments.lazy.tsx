import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Payments } from './Payments';

/** وحدة التحميل الكسول لمدفوعات الموردين — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/payments')({
    component: () => (
        <ScreenGate screen="payments">
            <Payments />
        </ScreenGate>
    ),
});
