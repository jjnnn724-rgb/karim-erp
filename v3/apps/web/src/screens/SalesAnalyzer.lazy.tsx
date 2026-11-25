import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { SalesAnalyzer } from './SalesAnalyzer';

/** وحدة التحميل الكسول لتحليل مبيعات الأصناف. */
export const Route = createLazyRoute('/sales-analyzer')({
    component: () => (
        <ScreenGate screen="sales-analyzer">
            <SalesAnalyzer />
        </ScreenGate>
    ),
});
