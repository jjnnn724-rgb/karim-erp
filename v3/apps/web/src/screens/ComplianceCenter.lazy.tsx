import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { ComplianceCenter } from './ComplianceCenter';

export const Route = createLazyRoute('/compliance-center')({
    component: () => (
        <ScreenGate screen="compliance-center">
            <ComplianceCenter />
        </ScreenGate>
    ),
});
