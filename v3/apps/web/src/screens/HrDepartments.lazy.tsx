import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { HrDepartments } from './HrDepartments';

export const Route = createLazyRoute('/hr-departments')({
    component: () => (
        <ScreenGate screen="hr-departments">
            <HrDepartments />
        </ScreenGate>
    ),
});
