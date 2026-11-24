import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { OracleData } from './OracleData';

/** وحدة التحميل الكسول لبيانات Oracle — تُحمَّل عند فتح المسار. */
export const Route = createLazyRoute('/oracle-data')({
    component: () => (
        <ScreenGate screen="oracle-data">
            <OracleData />
        </ScreenGate>
    ),
});
