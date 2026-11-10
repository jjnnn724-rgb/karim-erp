/**
 * الثيم — `system | light | dark` (خطة المرحلة الثانية §3.1).
 *
 * التخزين `karim_theme_v1` متوافق مع الموجود في `main.tsx`/`Shell.tsx`
 * (القيم `dark`/`light`)، ويضيف `system` كقيمة ثالثة. غياب المفتاح = النظام:
 * هذا هو الفرق المقصود عن السلوك القديم (كان الفاتح دائمًا) وهو إصلاح فجوة
 * «لا prefers-color-scheme» في خطة P2.
 *
 * «لا وميض»: `applyInitialTheme()` تُنفَّذ عند تحميل الوحدة (قبل رسم React)،
 * و`ThemeProvider` يستدعيها أيضًا لكل تغيير. `main.tsx` ملك Lead ولا نلمسه،
 * فحين يُدمج `ThemeProvider` في الجذر تصبح التهيئة قبل أول رسم تلقائيًا.
 *
 * `color-scheme` يُضبط على `documentElement` (يؤثر في عناصر المتصفح الأصلية:
 * أشرطة التمرير، حقول الاختيار)، والوضع يُطبَّق بـ`class="dark"` كما يشترط
 * `styles.css`. `data-theme` يحمل الاختيار الخام (system/light/dark) للمعرض
 * والاختبارات.
 */

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'karim_theme_v1';

export function isTheme(value: unknown): value is Theme {
    return value === 'system' || value === 'light' || value === 'dark';
}

export function getSystemTheme(): ResolvedTheme {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function readStoredTheme(): Theme | null {
    try {
        const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
        return isTheme(stored) ? stored : null;
    } catch {
        return null;
    }
}

export function persistTheme(theme: Theme): void {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        /* التخزين معطّل (وضع خاص/سياسة) — الاختيار يبقى في الجلسة الحالية. */
    }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
    return theme === 'system' ? getSystemTheme() : theme;
}

/** يطبّق الثيم على الجذر ويعيد الوضع المحسوم. */
export function applyTheme(theme: Theme): ResolvedTheme {
    if (typeof document === 'undefined') {
        return resolveTheme(theme);
    }
    const resolved = resolveTheme(theme);
    const root = document.documentElement;
    root.classList.toggle('dark', resolved === 'dark');
    root.style.colorScheme = resolved;
    root.dataset['theme'] = theme;
    return resolved;
}

/** يقرأ التفضيل ويطبّقه فورًا — بلا انتظار رسم. */
export function applyInitialTheme(): Theme {
    const theme = readStoredTheme() ?? 'system';
    applyTheme(theme);
    return theme;
}
