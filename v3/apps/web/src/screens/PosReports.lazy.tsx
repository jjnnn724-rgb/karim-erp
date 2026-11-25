import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { PosReports } from './PosReports';

/** وحدة التحميل الكسول لمركز التقارير — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/pos-reports')({
    component: () => (
        <ScreenGate screen="pos-reports">
            <PosReports />
        </ScreenGate>
    ),
});
