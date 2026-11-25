import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { DeptTransfers } from './DeptTransfers';

export const Route = createLazyRoute('/dept-transfers')({
    component: () => (
        <ScreenGate screen="dept-transfers">
            <DeptTransfers />
        </ScreenGate>
    ),
});
