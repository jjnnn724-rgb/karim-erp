import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { EmployeePortal } from './EmployeePortal';

/** وحدة التحميل الكسول لبوابة الموظف. */
export const Route = createLazyRoute('/employee-portal')({
    component: () => (
        <ScreenGate screen="employee-portal">
            <EmployeePortal />
        </ScreenGate>
    ),
});
