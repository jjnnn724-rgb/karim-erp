import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { EXPENSES_CONFIG, FinanceRegister } from './FinanceRegister';

/** وحدة التحميل الكسول لسجل المصروفات — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/expenses')({
    component: () => (
        <ScreenGate screen="expenses">
            <FinanceRegister config={EXPENSES_CONFIG} />
        </ScreenGate>
    ),
});
