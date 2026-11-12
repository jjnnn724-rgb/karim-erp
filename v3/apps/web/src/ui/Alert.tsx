import type { ReactNode } from 'react';
import { cn } from './cn';
import { AlertCircleIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from './icons';

/**
 * تنبيه سطري داخل الصفحة — لا نافذة ولا Toast.
 *
 * الفرق عن `Toast` (عابر أعلى الشاشة) و`EmptyState`/`ErrorState` (حالة كاملة):
 * `Alert` يشرح حالة **جزء** من الصفحة ويبقى مكانه حتى تزول الحالة — خطأ حفظ،
 * تحذير إعداد، نجاح مزامنة، ملاحظة سياسة.
 *
 * الوصول: `danger`/`warning` = `role="alert"` (يُعلَن فورًا)، و`info`/`success`
 * = `role="status"` (يُعلَن بأدب). الأيقونة زخرفية لأن النص يحمل المعنى،
 * والشكل لا يحمل معنى وحده (WCAG 1.4.1): اللون مكرّر بنص العنوان والأيقونة.
 */

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
    /** النبرة الدلالية — تحدد اللون والأيقونة و`role`. */
    variant?: AlertVariant;
    /** عنوان قصير؛ يُيتَّم النص إن غاب. */
    title?: string;
    /** الجسم — نص أو عناصر. */
    children?: ReactNode;
    /** إجراء اختياري (زر إعادة محاولة، رابط تفاصيل). */
    action?: ReactNode;
    /** تجاوز الأيقونة الافتراضية. */
    icon?: ReactNode;
    className?: string;
}

const TONE_CLASS: Record<AlertVariant, string> = {
    info: 'border-info/30 bg-info-soft',
    success: 'border-success/30 bg-success-soft',
    warning: 'border-warning/30 bg-warning-soft',
    danger: 'border-danger/30 bg-danger-soft',
};

const ICON_CLASS: Record<AlertVariant, string> = {
    info: 'text-info-text',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
};

const TITLE_CLASS: Record<AlertVariant, string> = {
    info: 'text-info-text',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
};

const DEFAULT_ICON: Record<AlertVariant, ReactNode> = {
    info: <InfoIcon className="size-5" />,
    success: <CheckCircleIcon className="size-5" />,
    warning: <AlertTriangleIcon className="size-5" />,
    danger: <AlertCircleIcon className="size-5" />,
};

/** `warning`/`danger` تستحق إعلانًا فوريًا؛ الباقي بأدب. */
const ROLE: Record<AlertVariant, 'alert' | 'status'> = {
    info: 'status',
    success: 'status',
    warning: 'alert',
    danger: 'alert',
};

export function Alert({ variant = 'info', title, children, action, icon, className }: AlertProps) {
    return (
        <div
            role={ROLE[variant]}
            data-variant={variant}
            className={cn('flex items-start gap-sm rounded-md border p-sm text-start', TONE_CLASS[variant], className)}
        >
            <span className={cn('mt-xxs shrink-0', ICON_CLASS[variant])} aria-hidden="true">
                {icon ?? DEFAULT_ICON[variant]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-xxs">
                {title ? <p className={cn('text-body-md font-semibold', TITLE_CLASS[variant])}>{title}</p> : null}
                {children ? <div className="text-body-sm text-ink-secondary">{children}</div> : null}
            </div>
            {action ? <div className="shrink-0 self-center">{action}</div> : null}
        </div>
    );
}
