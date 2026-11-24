import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Users } from './Users';

export const Route = createLazyRoute('/users')({
    component: () => (
        <ScreenGate screen="users">
            <Users />
        </ScreenGate>
    ),
});
