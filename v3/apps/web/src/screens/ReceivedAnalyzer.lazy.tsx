import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { ReceivedAnalyzer } from './ReceivedAnalyzer';

/** وحدة التحميل الكسول لتحليل المستلَم. */
export const Route = createLazyRoute('/received-analyzer')({
    component: () => (
        <ScreenGate screen="received-analyzer">
            <ReceivedAnalyzer />
        </ScreenGate>
    ),
});
