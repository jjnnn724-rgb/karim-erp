import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Roster } from './Roster';

export const Route = createLazyRoute('/roster')({
    component: () => (
        <ScreenGate screen="roster">
            <Roster />
        </ScreenGate>
    ),
});
