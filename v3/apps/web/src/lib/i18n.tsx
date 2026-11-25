/**
 * i18n للتطبيق V3 — عربي افتراضي، إنجليزي متاح، محفوظ بـ localStorage وفي
 * `<html lang dir>`. يحقن الستات في كل مكوّن بالـ component-level API:
 *   const { lang, dir, t } = useLanguage();
 *   t('بحث…', 'Search…')
 *
 * `t()` يخذar النص العربي والإنجليزي جنباً إلى جنب — لا ملف strings ضخمة —
 * بحيث كل مطور يحافظ على اثنين من النص جنبًا إلى جانب عند أي تعديل مستقبلي.
 * عادًا ما نستخدم setDirection على <html> للتبديل الفوري.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

export type Lang = 'ar' | 'en';

const STORAGE_KEY = 'karim-lang';

export interface LanguageContextValue {
    lang: Lang;
    dir: 'rtl' | 'ltr';
    setLang: (next: Lang) => void;
    t: (ar: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readInitial(): Lang {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === 'ar' || stored === 'en') {
            return stored;
        }
        // Server-side default always Arabic — V3 Arabic-only audience today.
        return 'ar';
    } catch {
        return 'ar';
    }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
    const [lang, setLangState] = useState<Lang>(readInitial);

    const setLang = (next: Lang) => {
        setLangState(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, next);
        } catch {
            /* best effort persist */
        }
    };

    useEffect(() => {
        const dir = lang === 'en' ? 'ltr' : 'rtl';
        document.documentElement.lang = lang;
        document.documentElement.dir = dir;
    }, [lang]);

    const value = useMemo<LanguageContextValue>(
        () => ({
            lang,
            dir: lang === 'en' ? 'ltr' : 'rtl',
            setLang,
            t: (ar, en) => (lang === 'en' ? en : ar),
        }),
        [lang],
    );

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

const FALLBACK_CONTEXT: LanguageContextValue = {
    lang: 'ar',
    dir: 'rtl',
    setLang: () => undefined,
    t: (ar: string) => ar,
};

export function useLanguage(): LanguageContextValue {
    const value = useContext(LanguageContext);
    // Never crash — production wraps via LanguageProvider; tests can render bare.
    return value ?? FALLBACK_CONTEXT;
}
