import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Branches } from './Branches';

export const Route = createLazyRoute('/branches')({
    component: () => (
        <ScreenGate screen="branches">
            <Branches />
        </ScreenGate>
    ),
});
