import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CostAnalysis } from './CostAnalysis';

/** وحدة التحميل الكسول لتحليل التكاليف. */
export const Route = createLazyRoute('/cost-analysis')({
    component: () => (
        <ScreenGate screen="cost-analysis">
            <CostAnalysis />
        </ScreenGate>
    ),
});
