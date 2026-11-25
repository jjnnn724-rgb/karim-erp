import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CashRegister } from './CashRegister';

/** وحدة التحميل الكسول لسجلّ الصرف — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/cash-register')({
    component: () => (
        <ScreenGate screen="cash-register">
            <CashRegister />
        </ScreenGate>
    ),
});
