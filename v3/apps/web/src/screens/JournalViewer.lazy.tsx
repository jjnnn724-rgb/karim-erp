import { createLazyRoute } from '@tanstack/react-router';
import { ScreenGate } from '../components/ScreenGate';
import { JournalViewer } from './JournalViewer';

/**
 * وحدة التحميل الكسول لعارض القيود — تُحمَّل عند فتح المسار لا مع البداية.
 * `createLazyRoute` هو ما يتوقّعه `route.lazy()` في التوجيه البرمجي.
 */
export const Route = createLazyRoute('/journal')({
    component: () => (
        <ScreenGate screen="journal">
            <JournalViewer />
        </ScreenGate>
    ),
});
