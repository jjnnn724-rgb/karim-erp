import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { WarehouseGov } from './WarehouseGov';

export const Route = createLazyRoute('/warehouse-gov')({
    component: () => (
        <ScreenGate screen="warehouse-gov">
            <WarehouseGov />
        </ScreenGate>
    ),
});
