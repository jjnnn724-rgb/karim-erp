import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { InventoryMovements } from './InventoryMovements';

/** وحدة التحميل الكسول لحركات المخزون — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/wh-moves')({
    component: () => (
        <ScreenGate screen="wh-moves">
            <InventoryMovements />
        </ScreenGate>
    ),
});
