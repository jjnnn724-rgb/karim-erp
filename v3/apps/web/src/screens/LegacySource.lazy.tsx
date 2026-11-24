import { createLazyRoute } from '@tanstack/react-router';
import { LegacySource } from './LegacySource';

/** وحدة التحميل الكسول لمصدر البيانات. */
export const Route = createLazyRoute('/integrations')({
    component: () => <LegacySource />,
});
