import { useQuery } from '@tanstack/react-query';
import { fetchJson } from './api';
import { getAccessToken, useAuthState } from './auth';
import { hiddenNavKeys, mainSettingsSchema } from './settings';
import { settingsReadVisible } from './settings-write';

/**
 * الشاشات المخفية يدويًا من شاشة الإعدادات (`hidden_nav_pages` في صف الإعدادات
 * الرئيسي — نفس الحقل الذي يكتبه V2). لا يقرأه إلا دور يملك قراءة الإعدادات،
 * وشاشة الإعدادات نفسها لا تُخفى حتى لا يُقفل المخرج الوحيد لإرجاع القائمة.
 */

const LOCKED = new Set(['settings', 'home']);

export function useHiddenNavKeys(): readonly string[] {
    const auth = useAuthState();
    const readable = settingsReadVisible(auth.user?.role);

    const query = useQuery({
        queryKey: ['settings', 'main'],
        queryFn: ({ signal }) => fetchJson(mainSettingsSchema, '/api/settings', getAccessToken(), { signal }),
        enabled: readable,
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    if (!readable) {
        return [];
    }
    return hiddenNavKeys(query.data?.hidden_nav_pages ?? '').filter((key) => !LOCKED.has(key));
}
