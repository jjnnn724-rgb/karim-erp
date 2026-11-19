import { Loader2 } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Button as ShadcnButton } from '@/components/ui/button';
import { cn } from './cn';

/**
 * زر أيقوني — فوق **shadcn/ui** (`@/components/ui/button` بمقاس `icon`):
 * `label` إلزامي لأنه يُصبح `aria-label`: زر بلا نص مرئي بلا اسم مفهوم =
 * مخالفة WCAG 4.1.2. الأيقونة نفسها زخرفية (`aria-hidden`).
 */

export type IconButtonVariant = 'ghost' | 'secondary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const BASE_CLASS =
    'inline-flex shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors duration-[var(--erp-motion-fast)] ease-standard disabled:cursor-not-allowed disabled:opacity-50';

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
    ghost: 'bg-transparent hover:bg-surface-hover hover:text-ink active:bg-surface-sunken',
    secondary: 'border border-hairline-strong bg-surface shadow-card hover:bg-surface-hover active:bg-surface-sunken',
};

const SIZE_CLASS: Record<IconButtonSize, string> = {
    sm: 'size-7.5',
    md: 'size-9.5',
    lg: 'size-11',
};

const SIZE_MAP: Record<IconButtonSize, 'icon-sm' | 'icon' | 'icon-lg'> = {
    sm: 'icon-sm',
    md: 'icon',
    lg: 'icon-lg',
};

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
    /** اسم الزر المفهوم — يُطبَّق كـ`aria-label`. */
    label: string;
    icon: ReactNode;
    variant?: IconButtonVariant;
    size?: IconButtonSize;
    loading?: boolean;
}

export function IconButton({
    label,
    icon,
    variant = 'ghost',
    size = 'md',
    loading = false,
    disabled,
    type = 'button',
    className,
    ...rest
}: IconButtonProps) {
    return (
        <ShadcnButton
            {...rest}
            type={type}
            aria-label={label}
            title={label}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            variant={variant === 'ghost' ? 'ghost' : 'secondary'}
            size={SIZE_MAP[size]}
            className={cn(BASE_CLASS, VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
        >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : icon}
        </ShadcnButton>
    );
}
