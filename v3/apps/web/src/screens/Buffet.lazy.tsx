import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Buffet } from './Buffet';

/** كوست أصناف بوفيه الشرفة العالمي — تُحسب حيًّا من أسعار المخزن. */
export const Route = createLazyRoute('/buffet')({
    component: () => (
        <ScreenGate screen="buffet">
            <Buffet />
        </ScreenGate>
    ),
});
