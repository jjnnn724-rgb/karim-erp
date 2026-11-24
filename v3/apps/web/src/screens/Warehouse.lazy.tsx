import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Warehouse } from './Warehouse';

export const Route = createLazyRoute('/warehouse')({
    component: () => (
        <ScreenGate screen="warehouse">
            <Warehouse />
        </ScreenGate>
    ),
});
