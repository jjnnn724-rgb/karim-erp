import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { WarehouseDashboard } from './WarehouseDashboard';

/** وحدة التحميل الكسول للوحة المخزن. */
export const Route = createLazyRoute('/warehouse-dashboard')({
    component: () => (
        <ScreenGate screen="warehouse-dashboard">
            <WarehouseDashboard />
        </ScreenGate>
    ),
});
