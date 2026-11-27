import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { MenuCost } from './MenuCost';

export const Route = createLazyRoute('/menu-cost')({
    component: () => (
        <ScreenGate screen="menu-cost">
            <MenuCost />
        </ScreenGate>
    ),
});
