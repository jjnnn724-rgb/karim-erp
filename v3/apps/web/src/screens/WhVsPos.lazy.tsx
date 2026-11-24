import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { WhVsPos } from './WhVsPos';

/** وحدة التحميل الكسول لمقارنة المخزن بنقطة البيع. */
export const Route = createLazyRoute('/wh-vs-pos')({
    component: () => (
        <ScreenGate screen="wh-vs-pos">
            <WhVsPos />
        </ScreenGate>
    ),
});
