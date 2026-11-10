import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { SalesInquiry } from './SalesInquiry';

/** وحدة التحميل الكسول لاستعلام المبيعات. */
export const Route = createLazyRoute('/sales-inquiry')({
    component: () => (
        <ScreenGate screen="sales-inquiry">
            <SalesInquiry />
        </ScreenGate>
    ),
});
