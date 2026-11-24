import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { DeptEmployees } from './DeptEmployees';

/** وحدة التحميل الكسول لسجل موظفي القسم. */
export const Route = createLazyRoute('/dept-employees')({
    component: () => (
        <ScreenGate screen="dept-employees">
            <DeptEmployees />
        </ScreenGate>
    ),
});
