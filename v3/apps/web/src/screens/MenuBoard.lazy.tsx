import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { MenuBoard } from './MenuBoard';

/** وحدة التحميل الكسول لشاشات المنيو. */
export const Route = createLazyRoute('/menu-board')({
    component: () => (
        <ScreenGate screen="menu-board">
            <MenuBoard />
        </ScreenGate>
    ),
});
