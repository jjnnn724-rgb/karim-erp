import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { HrDashboard } from './HrDashboard';

/** وحدة التحميل الكسول للوحة الموارد البشرية. */
export const Route = createLazyRoute('/hr-dashboard')({
    component: () => (
        <ScreenGate screen="hr-dashboard">
            <HrDashboard />
        </ScreenGate>
    ),
});
