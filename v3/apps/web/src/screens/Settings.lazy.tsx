import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Settings } from './Settings';

export const Route = createLazyRoute('/settings')({
    component: () => (
        <ScreenGate screen="settings">
            <Settings />
        </ScreenGate>
    ),
});
