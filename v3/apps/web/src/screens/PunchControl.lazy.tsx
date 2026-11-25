import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { PunchControl } from './PunchControl';

export const Route = createLazyRoute('/punch-control')({
    component: () => (
        <ScreenGate screen="punch-control">
            <PunchControl />
        </ScreenGate>
    ),
});
