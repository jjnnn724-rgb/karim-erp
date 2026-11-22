import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Briefing } from './Briefing';

export const Route = createLazyRoute('/briefing')({
    component: () => (
        <ScreenGate screen="briefing">
            <Briefing />
        </ScreenGate>
    ),
});
