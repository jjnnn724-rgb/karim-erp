import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Attendance } from './Attendance';

export const Route = createLazyRoute('/attendance')({
    component: () => (
        <ScreenGate screen="attendance">
            <Attendance />
        </ScreenGate>
    ),
});
