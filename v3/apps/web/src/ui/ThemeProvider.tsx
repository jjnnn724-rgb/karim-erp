import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
    applyInitialTheme,
    applyTheme,
    isTheme,
    persistTheme,
    type ResolvedTheme,
    readStoredTheme,
    resolveTheme,
    type Theme,
} from './theme';

/**
 * مزوّد الثيم — يطبّق الاختيار على `documentElement`، يتتبّع تغيّر تفضيل
 * النظام عندما يكون الاختيار `system`، ويحفظ الاختيار الصريح في
 * `karim_theme_v1`.
 *
 * التهيئة الاستباقية أدناه تُنفَّذ عند استيراد الوحدة (قبل أول رسم) — لا وميض
 * حتى لو فُتح المسار مباشرة على وضع داكن، ثم يبدأ المزوّد من نفس القيمة.
 */

const initialTheme: Theme = typeof document === 'undefined' ? 'system' : applyInitialTheme();

export interface ThemeContextValue {
    /** الاختيار الصريح: system | light | dark. */
    theme: Theme;
    /** الوضع المطبَّق فعلًا بعد حل system. */
    resolvedTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
    children: ReactNode;
    /** يُستخدم فقط عند غياب تفضيل محفوظ. */
    defaultTheme?: Theme;
}

export function ThemeProvider({ children, defaultTheme }: ThemeProviderProps) {
    const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? defaultTheme ?? initialTheme);
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme));

    const setTheme = useCallback((next: Theme) => {
        if (!isTheme(next)) {
            return;
        }
        persistTheme(next);
        setThemeState(next);
    }, []);

    // تطبيق فوري لأي تغيير اختيار.
    useEffect(() => {
        setResolvedTheme(applyTheme(theme));
    }, [theme]);

    // متابعة تفضيل النظام طالما الاختيار `system`.
    useEffect(() => {
        if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            setResolvedTheme(applyTheme('system'));
        };
        media.addEventListener('change', onChange);
        return () => {
            media.removeEventListener('change', onChange);
        };
    }, [theme]);

    const value = useMemo<ThemeContextValue>(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme]);

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
    const value = useContext(ThemeContext);
    if (!value) {
        throw new Error('useTheme يجب أن يُستخدم داخل <ThemeProvider>.');
    }
    return value;
}
