import { useCallback, useEffect, useState } from 'react';

/**
 * تسجيل PWA الكاشير في الإنتاج فقط.
 *
 * التطوير لا يسجّل Service Worker كي لا يتداخل مع HMR أو يخزّن نسخة قديمة.
 * التسجيل مقصور على `/v3/cashier`؛ بقية شاشات V3 الإدارية لا تُثبّت كشكًا.
 */
export function registerCashierPwa(): void {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) {
        return;
    }
    if (!window.location.pathname.startsWith(`${import.meta.env.BASE_URL}cashier`)) {
        return;
    }

    const register = () => {
        void navigator.serviceWorker
            .register(`${import.meta.env.BASE_URL}sw.js`, {
                scope: import.meta.env.BASE_URL,
            })
            .catch((error: unknown) => {
                // التثبيت اختياري: فشل التسجيل لا يجوز أن يمنع فتح الكاشير.
                console.warn('[pwa] تعذّر تسجيل Service Worker', error);
            });
    };

    if (document.readyState === 'complete') {
        register();
    } else {
        window.addEventListener('load', register, { once: true });
    }
}

type InstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

/** زر التثبيت يظهر فقط عندما يعلن المتصفح أن التطبيق قابل للتثبيت. */
export function useCashierInstallPrompt(): {
    canInstall: boolean;
    install: () => Promise<void>;
} {
    const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);

    useEffect(() => {
        const onBeforeInstall = (event: Event) => {
            event.preventDefault();
            setPromptEvent(event as InstallPromptEvent);
        };
        const onInstalled = () => setPromptEvent(null);

        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onInstalled);
        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const install = useCallback(async () => {
        if (!promptEvent) {
            return;
        }
        try {
            await promptEvent.prompt();
            await promptEvent.userChoice;
        } catch (error: unknown) {
            console.warn('[pwa] تعذّر فتح نافذة التثبيت', error);
        } finally {
            // المتصفح لا يعيد إطلاق الحدث بعد اختيار المستخدم؛ أخفِ الزر.
            setPromptEvent(null);
        }
    }, [promptEvent]);

    return { canInstall: Boolean(promptEvent), install };
}
