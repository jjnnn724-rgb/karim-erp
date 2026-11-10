import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { InventoryInquiryPro } from './InventoryInquiryPro';

/** وحدة التحميل الكسول للبطاقة الفاخرة. */
export const Route = createLazyRoute('/inventory-inquiry-pro')({
    component: () => (
        <ScreenGate screen="inventory-inquiry-pro">
            <InventoryInquiryPro />
        </ScreenGate>
    ),
});
