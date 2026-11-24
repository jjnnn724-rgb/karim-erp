import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Departments } from './Departments';

/** وحدة التحميل الكسول لسجل الأقسام — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/departments')({
    component: () => (
        <ScreenGate screen="departments">
            <Departments />
        </ScreenGate>
    ),
});
