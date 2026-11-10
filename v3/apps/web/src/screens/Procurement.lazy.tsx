import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { Procurement } from './Procurement';

/** وحدة التحميل الكسول لدليل الموردين — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/procurement')({
    component: () => (
        <ScreenGate screen="procurement">
            <Procurement />
        </ScreenGate>
    ),
});
