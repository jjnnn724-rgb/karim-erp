import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Reports } from './Reports';

/** وحدة التحميل الكسول لتقرير مبيعات نقطة البيع. */
export const Route = createLazyRoute('/reports')({
    component: () => (
        <ScreenGate screen="reports">
            <Reports />
        </ScreenGate>
    ),
});
