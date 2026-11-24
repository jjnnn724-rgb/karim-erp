import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { ItemPrices } from './ItemPrices';

/** السعر يظهر بعد تفعيل شاشة الأسعار من manifest الشاشات. */
export const Route = createLazyRoute('/item-prices')({
    component: () => (
        <ScreenGate screen="item-prices">
            <ItemPrices />
        </ScreenGate>
    ),
});
