import type { ReactNode } from 'react';
import { cn } from './cn';
import { InboxIcon } from './icons';

/**
 * حالة فارغة — DESIGN.md: «أيقونة + عنوان + تلميح (ماذا يفعل المستخدم
 * الآن؟)». لذلك `description` و`action` جزء من العقد لا زينة: الحالة الفارغة
 * بلا خطوة تالية عطبٌ في تجربة الاستخدام.
 *
 * الأيقونة زخرفية؛ العنوان هو النص المفهوم.
 */

export interface EmptyStateProps {
    title: string;
    description?: string;
    icon?: ReactNode;
    action?: ReactNode;
    className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
    return (
        <div className={cn('flex flex-col items-center gap-sm p-xl text-center', className)}>
            <span className="grid size-11 place-items-center rounded-full bg-surface-sunken text-muted" aria-hidden="true">
                {icon ?? <InboxIcon className="size-5" />}
            </span>
            <div className="flex flex-col gap-xxs">
                <p className="text-heading-sm text-ink">{title}</p>
                {description ? <p className="text-body-sm text-muted">{description}</p> : null}
            </div>
            {action ? <div className="flex items-center gap-xs">{action}</div> : null}
        </div>
    );
}
