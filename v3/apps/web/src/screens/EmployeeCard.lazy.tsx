import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { EmployeeCard } from './EmployeeCard';

export const Route = createLazyRoute('/employee-card')({
    component: () => (
        <ScreenGate screen="employee-card">
            <EmployeeCard />
        </ScreenGate>
    ),
});
