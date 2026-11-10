import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Permissions } from './Permissions';

export const Route = createLazyRoute('/permissions')({
    component: () => (
        <ScreenGate screen="permissions">
            <Permissions />
        </ScreenGate>
    ),
});
