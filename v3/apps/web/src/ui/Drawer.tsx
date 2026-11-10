import { Dialog as SheetPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { IconButton } from './IconButton';
import { XIcon } from './icons';

/**
 * درج جانبي — Radix Dialog في هيئة حافة منزلقة (نفس بدائية **shadcn/ui** `Sheet`:
 * `@/components/ui/sheet` مبنية على Radix Dialog)، للفلاتر التفصيلية والإجراءات
 * الطويلة على الجوال. الحافة **منطقية** (`start`/`end`) وليست فيزيائية،
 * والانزلاق في `styles.css` يحسب الاتجاه من `dir` و`data-side`.
 */

export type DrawerSide = 'start' | 'end';

export interface DrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    trigger?: ReactNode;
    side?: DrawerSide;
    closeLabel?: string;
    className?: string;
}

export function Drawer({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    trigger,
    side = 'end',
    closeLabel = 'إغلاق',
    className,
}: DrawerProps) {
    return (
        <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
            {trigger ? <SheetPrimitive.Trigger asChild>{trigger}</SheetPrimitive.Trigger> : null}
            <SheetPrimitive.Portal>
                <SheetPrimitive.Overlay className="fixed inset-0 z-[var(--erp-z-overlay)] bg-overlay" />
                <SheetPrimitive.Content
                    data-side={side}
                    className={cn(
                        'erp-drawer fixed inset-y-0 z-[var(--erp-z-modal)] flex w-[min(92vw,24rem)] flex-col gap-md overflow-y-auto bg-surface-raised p-lg text-ink shadow-[0_24px_64px_rgb(0_0_0/0.30)]',
                        side === 'end' ? 'end-0 border-s border-hairline' : 'start-0 border-e border-hairline',
                        className,
                    )}
                >
                    <div className="flex items-start justify-between gap-md">
                        <div className="flex min-w-0 flex-col gap-xxs">
                            <SheetPrimitive.Title className="text-heading-lg text-ink">{title}</SheetPrimitive.Title>
                            {description ? (
                                <SheetPrimitive.Description className="text-body-sm text-muted">
                                    {description}
                                </SheetPrimitive.Description>
                            ) : null}
                        </div>
                        <SheetPrimitive.Close asChild>
                            <IconButton label={closeLabel} icon={<XIcon />} size="sm" />
                        </SheetPrimitive.Close>
                    </div>
                    {children ? <div className="flex-1 text-body-md text-ink">{children}</div> : null}
                    {footer ? (
                        <div className="mt-auto flex flex-wrap items-center justify-end gap-xs border-t border-hairline pt-md">
                            {footer}
                        </div>
                    ) : null}
                </SheetPrimitive.Content>
            </SheetPrimitive.Portal>
        </SheetPrimitive.Root>
    );
}
