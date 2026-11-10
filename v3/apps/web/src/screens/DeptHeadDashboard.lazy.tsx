import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { DeptHeadDashboard } from './DeptHeadDashboard';

/** وحدة التحميل الكسول للوحة رئيس القسم. */
export const Route = createLazyRoute('/dept-head-dashboard')({
    component: () => (
        <ScreenGate screen="dept-head-dashboard">
            <DeptHeadDashboard />
        </ScreenGate>
    ),
});
