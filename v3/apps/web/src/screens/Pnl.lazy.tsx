import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Pnl } from './Pnl';

/** وحدة التحميل الكسول لقائمة الأرباح والخسائر. */
export const Route = createLazyRoute('/pnl')({
    component: () => (
        <ScreenGate screen="pnl">
            <Pnl />
        </ScreenGate>
    ),
});
