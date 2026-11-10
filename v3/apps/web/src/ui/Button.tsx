import { Button as ShadcnButton } from '@/components/ui/button';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from './cn';

/**
 * زر الإجراء — فوق **shadcn/ui** (`@/components/ui/button`)، بهوية DESIGN.md:
 * الياقوت لون الفعل الوحيد، والزر تدرّج «حجرٌ مضاء» بحدّ ضوء لا مستطيل مسطّح.
 * (تعيين `--primary` من بدائيات ERP يمنح shadcn نفس الهوية تلقائيًا.)
 *
 * الحالات: idle / hover / focus-visible (حلقة الشامبانيا العامة) / active /
 * disabled / loading (`aria-busy` + تعطيل + مؤشر دوّار). `type` افتراضيًا
 * `button` حتى لا يُرسل نموذجًا بغير قصد.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE_CLASS =
    'erp-button inline-flex select-none items-center justify-center gap-xs whitespace-nowrap rounded-md font-semibold text-button-md transition-[background-color,border-color,color,box-shadow,opacity] duration-[var(--erp-motion-fast)] ease-standard disabled:cursor-not-allowed disabled:opacity-50';

const ERP_VARIANT_CLASS: Record<ButtonVariant, string> = {
    primary:
        'border border-primary-active/40 bg-linear-to-b from-primary-hover to-primary-active text-on-primary shadow-card hover:from-primary hover:to-primary-hover active:from-primary-active active:to-primary-active',
    secondary:
        'border border-hairline-strong bg-surface text-ink shadow-card hover:bg-surface-hover active:bg-surface-sunken',
    ghost: 'border border-transparent bg-transparent text-ink-secondary hover:bg-surface-hover active:bg-surface-sunken',
    danger: 'border border-danger/50 bg-danger text-on-primary shadow-card hover:bg-danger/90 active:bg-danger',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
    sm: 'h-7.5 px-sm text-body-sm',
    md: 'h-9.5 px-md',
    lg: 'h-11 px-lg text-heading-sm',
};

const VARIANT_MAP: Record<ButtonVariant, 'default' | 'secondary' | 'ghost' | 'destructive'> = {
    primary: 'default',
    secondary: 'secondary',
    ghost: 'ghost',
    danger: 'destructive',
};

const SIZE_MAP: Record<ButtonSize, 'sm' | 'default' | 'lg'> = {
    sm: 'sm',
    md: 'default',
    lg: 'lg',
};

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    iconStart?: ReactNode;
    iconEnd?: ReactNode;
    fullWidth?: boolean;
    children?: ReactNode;
}

export function Button({
    variant = 'primary',
    size = 'md',
    loading = false,
    iconStart,
    iconEnd,
    fullWidth = false,
    disabled,
    type = 'button',
    className,
    children,
    ...rest
}: ButtonProps) {
    return (
        <ShadcnButton
            {...rest}
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            data-loading={loading ? 'true' : undefined}
            variant={VARIANT_MAP[variant]}
            size={SIZE_MAP[size]}
            className={cn(BASE_CLASS, ERP_VARIANT_CLASS[variant], SIZE_CLASS[size], fullWidth && 'w-full', className)}
        >
            {loading ? <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : iconStart}
            {children}
            {iconEnd}
        </ShadcnButton>
    );
}
