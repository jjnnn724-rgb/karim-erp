import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CommandCenter } from './CommandCenter';

export const Route = createLazyRoute('/command-center')({
    component: () => (
        <ScreenGate screen="command-center">
            <CommandCenter />
        </ScreenGate>
    ),
});
