import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { CostCenter } from './CostCenter';

/** وحدة التحميل الكسول لمركز التكلفة. */
export const Route = createLazyRoute('/cost-center')({
    component: () => (
        <ScreenGate screen="cost-center">
            <CostCenter />
        </ScreenGate>
    ),
});
