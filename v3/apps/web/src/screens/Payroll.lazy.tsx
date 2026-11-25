import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Payroll } from './Payroll';

export const Route = createLazyRoute('/payroll')({
    component: () => (
        <ScreenGate screen="payroll">
            <Payroll />
        </ScreenGate>
    ),
});
