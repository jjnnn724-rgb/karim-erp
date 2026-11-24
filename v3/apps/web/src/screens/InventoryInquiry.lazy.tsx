import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { InventoryInquiry } from './InventoryInquiry';

/** وحدة التحميل الكسول لمحرك استعلامات المخزون. */
export const Route = createLazyRoute('/inventory-inquiry')({
    component: () => (
        <ScreenGate screen="inventory-inquiry">
            <InventoryInquiry />
        </ScreenGate>
    ),
});
