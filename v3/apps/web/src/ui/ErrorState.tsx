import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';
import { AlertTriangleIcon } from './icons';

/**
 * حالة خطأ — رسالة قابلة للتنفيذ (DESIGN.md §3.6): ماذا حدث + ماذا يفعل
 * المستخدم + زر إعادة المحاولة. `role="alert"` فورًا حتى يُعلن العطل،
 * والأيقونة زخرفية لأن النص يحمل المعنى.
 */

export interface ErrorStateProps {
    message?: string;
    title?: string;
    onRetry?: () => void;
    retryLabel?: string;
    icon?: ReactNode;
    className?: string;
    /** إجراء إضافي بجانب إعادة المحاولة (مثل «العودة»). */
    action?: ReactNode;
}

export function ErrorState({
    message,
    title = 'تعذّر جلب البيانات',
    onRetry,
    retryLabel = 'إعادة المحاولة',
    icon,
    className,
    action,
}: ErrorStateProps) {
    return (
        <div role="alert" className={cn('flex flex-col items-center gap-sm p-xl text-center', className)}>
            <span className="grid size-11 place-items-center rounded-full bg-danger-soft text-danger-text" aria-hidden="true">
                {icon ?? <AlertTriangleIcon className="size-5" />}
            </span>
            <div className="flex flex-col gap-xxs">
                <p className="text-heading-sm text-ink">{title}</p>
                {message ? <p className="text-body-sm text-muted">{message}</p> : null}
            </div>
            {onRetry || action ? (
                <div className="flex items-center gap-xs">
                    {onRetry ? (
                        <Button variant="secondary" size="sm" onClick={onRetry}>
                            {retryLabel}
                        </Button>
                    ) : null}
                    {action}
                </div>
            ) : null}
        </div>
    );
}
