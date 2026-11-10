import { useEffect, useSyncExternalStore } from 'react';
import { APP_NAME, documentTitle } from './navigation';

/**
 * عنوان الوثيقة وأيقونتها — خطّاف واحد لكل شاشة (خطة §3.3).
 *
 *  · `document.title = «{الشاشة} — Karim ERP»`، والجذر «الرئيسية — Karim ERP».
 *  · الأيقونة SVG مضمّنة كـ`data:` URI (مسموح في CSP: `img-src 'self' data:`)،
 *    فلا ملف جديد ولا طلب شبكة. لونها من رموز `styles.css` المحسوبة، وحالتها
 *    (تحميل/خطأ/نجاح) وحالة الوضع الداكن تُغيّر لونها — بلا canvas.
 *  · مصدر الوضع هو `ui-kit/ThemeProvider`؛ هنا نقرأ أثره من `documentElement`
 *    (`class="dark"` و`data-theme`) عبر `MutationObserver` — لا مصدر ثيم
 *    ثانٍ، ولا اشتراط أن يكون الخطّاف داخل المزوّد (يعمل في الاختبارات أيضًا).
 *  · الحالة العامة: الشاشة تعلن `loading/error/success`، والقشرة تعرض
 *    الأيقونة الموافقة. عنصر تحكّم واحد يمنع مصادر متنازعة.
 */

export type PageStatus = 'idle' | 'loading' | 'error' | 'success';
export type ResolvedTheme = 'light' | 'dark';

export const PAGE_STATUSES: readonly PageStatus[] = ['idle', 'loading', 'error', 'success'];

let pageStatus: PageStatus = 'idle';
const statusListeners = new Set<() => void>();

export function getPageStatus(): PageStatus {
    return pageStatus;
}

/** تعلن الشاشة حالتها؛ القشرة تترجمها إلى لون الأيقونة. */
export function setPageStatus(next: PageStatus): void {
    if (pageStatus === next) {
        return;
    }
    pageStatus = next;
    for (const listener of statusListeners) {
        listener();
    }
}

function subscribePageStatus(listener: () => void): () => void {
    statusListeners.add(listener);
    return () => {
        statusListeners.delete(listener);
    };
}

export function usePageStatus(): PageStatus {
    return useSyncExternalStore(subscribePageStatus, getPageStatus, getPageStatus);
}

/** خطّاف الشاشة: يُعلن حالتها طوال بقائها، ويعيد «خامل» عند مغادرتها. */
export function usePageStatusReporter(status: PageStatus): void {
    useEffect(() => {
        setPageStatus(status);
        return () => {
            setPageStatus('idle');
        };
    }, [status]);
}

/* ─── الأيقونة ──────────────────────────────────────────────────────────── */

const FALLBACK_LIGHT_BG = '#5b21b6';
const FALLBACK_LIGHT_FG = '#fff9ee';
const FALLBACK_DARK_BG = '#a78bfa';
const FALLBACK_DARK_FG = '#150f33';
const FALLBACK_ACCENT = '#97742a';

function tokenColor(name: string, fallback: string): string {
    try {
        if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
            return fallback;
        }
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

function statusAccent(status: PageStatus): string {
    if (status === 'error') {
        return tokenColor('--erp-c-danger', '#b03428');
    }
    if (status === 'loading') {
        return tokenColor('--erp-c-brass', '#97742a');
    }
    if (status === 'success') {
        return tokenColor('--erp-c-success', '#d97706');
    }
    return tokenColor('--erp-c-brass-bright', FALLBACK_ACCENT);
}

/** أيقونة SVG 32×32: حرف K على خلفية حسب الوضع + نقطة حالة. */
export function faviconHref(resolved: ResolvedTheme, status: PageStatus): string {
    const background = resolved === 'dark' ? tokenColor('--erp-c-primary', FALLBACK_DARK_BG) : tokenColor('--erp-c-primary', FALLBACK_LIGHT_BG);
    const foreground = resolved === 'dark' ? tokenColor('--erp-c-on-primary', FALLBACK_DARK_FG) : tokenColor('--erp-c-on-primary', FALLBACK_LIGHT_FG);
    const accent = statusAccent(status);
    const svg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img">',
        `<rect width="32" height="32" rx="7" fill="${background}"/>`,
        `<text x="16" y="22" text-anchor="middle" font-family="monospace" font-size="18" font-weight="600" fill="${foreground}">K</text>`,
        `<circle cx="25.5" cy="25.5" r="4.5" fill="${accent}" stroke="${background}" stroke-width="1.5"/>`,
        '</svg>',
    ].join('');
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ensureIconLink(): HTMLLinkElement | null {
    if (typeof document === 'undefined') {
        return null;
    }
    const existing = document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (existing) {
        return existing;
    }
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.appendChild(link);
    return link;
}

function applyFavicon(resolved: ResolvedTheme, status: PageStatus): void {
    const link = ensureIconLink();
    if (!link) {
        return;
    }
    const href = faviconHref(resolved, status);
    if (link.getAttribute('href') !== href) {
        link.setAttribute('href', href);
    }
    if (link.getAttribute('type') !== 'image/svg+xml') {
        link.setAttribute('type', 'image/svg+xml');
    }
}

/* ─── قراءة الوضع المطبَّق من الجذر ─────────────────────────────────────── */

function readResolvedTheme(): ResolvedTheme {
    try {
        if (typeof document === 'undefined') {
            return 'light';
        }
        return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    } catch {
        return 'light';
    }
}

function subscribeResolvedTheme(listener: () => void): () => void {
    try {
        if (typeof document === 'undefined' || typeof MutationObserver !== 'function') {
            return () => undefined;
        }
        const observer = new MutationObserver(listener);
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
        return () => {
            observer.disconnect();
        };
    } catch {
        return () => undefined;
    }
}

/** الوضع المطبَّق فعلًا — يتبع `ui-kit/ThemeProvider` عبر DOM بلا مصدر ثانٍ. */
export function useResolvedTheme(): ResolvedTheme {
    return useSyncExternalStore(subscribeResolvedTheme, readResolvedTheme, readResolvedTheme);
}

/**
 * خطّاف عنوان الصفحة + الأيقونة.
 * يُستدعى في القشرة (لكل المسارات) وفي الرئيسية (تأكيد ذاتي).
 */
export function useDocumentMeta(title: string | null): void {
    const status = usePageStatus();
    const resolved = useResolvedTheme();

    useEffect(() => {
        if (typeof document === 'undefined') {
            return;
        }
        document.title = documentTitle(title ?? APP_NAME);
    }, [title]);

    useEffect(() => {
        applyFavicon(resolved, status);
    }, [resolved, status]);
}

/** احتياطي للاختبارات: يُعيد الحالة العامة إلى «خامل». */
export function resetPageMetaForTests(): void {
    pageStatus = 'idle';
    document.title = 'Karim ERP — v3';
}
