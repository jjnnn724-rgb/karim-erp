import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { GoodsScan } from './GoodsScan';

export const Route = createLazyRoute('/goods-scan')({
    component: () => (
        <ScreenGate screen="goods-scan">
            <GoodsScan />
        </ScreenGate>
    ),
});
