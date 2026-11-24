import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Employees } from './Employees';

export const Route = createLazyRoute('/employees')({
    component: () => (
        <ScreenGate screen="employees">
            <Employees />
        </ScreenGate>
    ),
});
