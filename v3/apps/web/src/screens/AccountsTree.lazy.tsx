import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { AccountsTree } from './AccountsTree';

/**
 * وحدة التحميل الكسول لشجرة الحسابات — تُحمَّل عند فتح المسار لا مع البداية.
 * `createLazyRoute` هو ما يتوقّعه `route.lazy()` في التوجيه البرمجي.
 */
export const Route = createLazyRoute('/accounts')({
    component: () => (
        <ScreenGate screen="accounts">
            <AccountsTree />
        </ScreenGate>
    ),
});
