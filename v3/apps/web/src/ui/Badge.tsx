import { Badge as ShadcnBadge } from '@/components/ui/badge';
import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * شارة حالة — فوق **shadcn/ui** (`@/components/ui/badge`)، DESIGN.md: «الشارة تحمل
 * نصًّا دائمًا؛ اللون وحده ليس دلالة» (WCAG 1.4.1)، وحدّ بلون النبرة إشارةٌ ثانية.
 * القيمة غير المعروفة تُعلَّم بحدّ متقطّع (`data-unknown`) بدل اختلاق لون.
 *
 * `soft` هو الافتراضي (خلفية 15%) لأن الشارة تُقرأ فوق البطاقات؛ `solid`
 * للمواضع التي تحتاج أعلى تباين.
 */

export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const SOFT_CLASS: Record<BadgeVariant, string> = {
    neutral: 'border-neutral/30 bg-neutral-soft text-neutral-text',
    success: 'border-success/30 bg-success-soft text-success-text',
    warning: 'border-warning/30 bg-warning-soft text-warning-text',
    danger: 'border-danger/30 bg-danger-soft text-danger-text',
    info: 'border-info/30 bg-info-soft text-info-text',
};

const SOLID_CLASS: Record<BadgeVariant, string> = {
    neutral: 'border-neutral bg-neutral text-on-primary',
    success: 'border-success bg-success text-on-primary',
    warning: 'border-warning bg-warning text-on-primary',
    danger: 'border-danger bg-danger text-on-primary',
    info: 'border-info bg-info text-on-primary',
};

const DOT_CLASS: Record<BadgeVariant, string> = {
    neutral: 'bg-neutral',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
};

export interface BadgeProps {
    children: ReactNode;
    variant?: BadgeVariant;
    soft?: boolean;
    dot?: boolean;
    unknown?: boolean;
    className?: string;
}

export function Badge({
    children,
    variant = 'neutral',
    soft = true,
    dot = false,
    unknown = false,
    className,
}: BadgeProps) {
    return (
        <ShadcnBadge
            variant="outline"
            data-variant={variant}
            data-unknown={unknown ? 'true' : undefined}
            className={cn(
                'erp-badge inline-flex items-center gap-xxs rounded-full border px-2 py-0.5 text-body-sm font-medium leading-normal',
                soft ? SOFT_CLASS[variant] : SOLID_CLASS[variant],
                unknown && 'border-dashed border-faint text-muted',
                className,
            )}
        >
            {dot ? <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT_CLASS[variant])} /> : null}
            {children}
        </ShadcnBadge>
    );
}
