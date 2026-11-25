import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { FinanceRegister, REVENUES_CONFIG } from './FinanceRegister';

/** وحدة التحميل الكسول لسجل الإيرادات — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/revenues')({
    component: () => (
        <ScreenGate screen="revenues">
            <FinanceRegister config={REVENUES_CONFIG} />
        </ScreenGate>
    ),
});
