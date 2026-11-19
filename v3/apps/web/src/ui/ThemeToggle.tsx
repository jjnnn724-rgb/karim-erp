import type { ReactNode } from 'react';
import { cn } from './cn';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';
import { useTheme } from './ThemeProvider';
import type { Theme } from './theme';

/**
 * مبدّل المظهر — ثلاثة أوضاع صريحة (فاتح/داكن/النظام) كمجموعة أزرار
 * `aria-pressed`: الحالة المختارة لا تُنقل باللون وحده (WCAG 1.4.1)، ونص
 * كل زر مرئي أو مخفي بصريًا لاسم مفهوم دائم.
 */

interface ThemeOption {
    value: Theme;
    label: string;
    icon: ReactNode;
}

const OPTIONS: readonly ThemeOption[] = [
    { value: 'light', label: 'فاتح', icon: <SunIcon className="size-4" /> },
    { value: 'dark', label: 'داكن', icon: <MoonIcon className="size-4" /> },
    { value: 'system', label: 'النظام', icon: <MonitorIcon className="size-4" /> },
];

export interface ThemeToggleProps {
    className?: string;
    /** إخفاء النص المرئي (يبقى مخفيًا بصريًا لقارئ الشاشة). */
    iconOnly?: boolean;
}

export function ThemeToggle({ className, iconOnly = false }: ThemeToggleProps) {
    const { theme, setTheme } = useTheme();

    return (
        <fieldset
            aria-label="مظهر الواجهة"
            className={cn(
                'm-0 inline-flex min-w-0 items-center gap-xxs rounded-md border border-hairline bg-surface p-xxs shadow-card',
                className,
            )}
        >
            {OPTIONS.map((option) => {
                const active = theme === option.value;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                            setTheme(option.value);
                        }}
                        className={cn(
                            'inline-flex items-center justify-center gap-xxs rounded-sm px-xs py-1 text-body-sm transition-colors duration-[var(--erp-motion-fast)] ease-standard',
                            active ? 'bg-primary text-on-primary' : 'text-ink-secondary hover:bg-surface-hover',
                        )}
                    >
                        <span aria-hidden="true">{option.icon}</span>
                        {iconOnly ? <span className="sr-only">{option.label}</span> : option.label}
                    </button>
                );
            })}
        </fieldset>
    );
}
