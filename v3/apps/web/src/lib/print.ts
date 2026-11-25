import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { fetchJson } from './api';
import { getAccessToken } from './auth';

/**
 * هوية الطباعة — نظير `js/core/print-system.js` + `js/v2/print-branding.js` في V2.
 *
 * ما نُقل حرفيًّا:
 *  • شعار واسم الشركة من `GET /settings/main_settings` (`name` و`logoB64` كما
 *    يقرأهما V2 من `STATE.settings`)، مع بديل ثابت: شعار المستودع
 *    `/app/assets/al-shurfa-logo.png` واسم «مطاعم الشرفة العالمي».
 *  • الشعار قد يصل base64 خامًا أو `data:` أو مسارًا/URL — نفس قواعد V2.
 *  • سطر التذييل: اسم الشركة + عنوان الشاشة + «طُبع dd/mm/yyyy hh:mm» (en-GB
 *    في V2، ويُبنى هنا يدويًّا كي لا يتغيّر بتغيّر لغة المتصفح).
 *
 * ما لا ننقله: تحويل الأرقام العربية-الهندية إلى لاتينية. V3 يعرض أرقامه
 * لاتينية أصلًا (`Intl en-US`) في الطباعة، فالقاعدة القديمة تصبح تحويلًا
 * لصفر شيء. أي شاشة تعرض أرقامًا عربية-هندية ستُعالج في موضعها.
 */

export const PRINT_COMPANY_FALLBACK = 'مطاعم الشرفة العالمي';
export const PRINT_COMPANY_EN = 'AL SHURFA AL ALAMI RESTAURANTS';
export const PRINT_LOGO_FALLBACK = '/app/assets/al-shurfa-logo.png';

const printSettingsSchema = z.record(z.string(), z.unknown());

export type PrintSettings = z.infer<typeof printSettingsSchema>;

/** الاسم المطبوع — `settings.name` أو البديل (نفس `companyName()` في V2). */
export function printBrandName(settings?: PrintSettings | null): string {
    const raw = settings?.name;
    const name = typeof raw === 'string' ? raw.trim() : '';
    return name || PRINT_COMPANY_FALLBACK;
}

/** الشعار المطبوع — base64 خام أو `data:` أو مسار/URL، وإلا البديل. */
export function printLogoSrc(settings?: PrintSettings | null): string {
    const raw = settings?.logoB64;
    const legacy = settings?.logo;
    const value = typeof raw === 'string' && raw.trim() ? raw.trim() : typeof legacy === 'string' ? legacy.trim() : '';
    if (!value) {
        return PRINT_LOGO_FALLBACK;
    }
    if (/^data:image\//i.test(value)) {
        return value;
    }
    if (/^(https?:)?\/\//i.test(value)) {
        return value;
    }
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        return `data:image/png;base64,${value}`;
    }
    try {
        return new URL(value, 'http://localhost').href;
    } catch {
        return PRINT_LOGO_FALLBACK;
    }
}

/** `طُبع dd/mm/yyyy hh:mm` — نفس `stampNow()` في V2. */
export function printStamp(now: Date = new Date()): string {
    const pad = (value: number): string => String(value).padStart(2, '0');
    const date = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(now.getFullYear())}`;
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return `طُبع ${date} ${time}`;
}

/** عنوان التذييل: عنوان الشاشة من خريطة التنقّل، مطبَّعًا كما في V2. */
export function printRunnerTitle(title: string | null | undefined): string {
    return String(title ?? '')
        .replace(/\s+/g, ' ')
        .trim();
}

export async function fetchPrintSettings(signal?: AbortSignal): Promise<PrintSettings> {
    return fetchJson(printSettingsSchema, '/api/settings/main_settings', getAccessToken(), signal ? { signal } : {});
}

/**
 * هوية الطباعة كاستعلام واحد مشترك (Shield: مفتاح واحد فتُقرأ مرة لكل جلسة).
 * لا يُعطّل الطباعة عند فشل الشبكة — البدائل الثابتة تعمل دائمًا.
 */
export function usePrintBrand(): { name: string; logoSrc: string } {
    const query = useQuery({
        queryKey: ['print', 'brand'],
        queryFn: ({ signal }) => fetchPrintSettings(signal),
        staleTime: 30 * 60 * 1000,
        retry: 0,
    });
    return {
        name: printBrandName(query.data),
        logoSrc: printLogoSrc(query.data),
    };
}
