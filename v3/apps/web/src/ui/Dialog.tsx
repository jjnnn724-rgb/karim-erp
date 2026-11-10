import {
    Dialog as ShadcnRoot,
    DialogContent as ShadcnContent,
    DialogDescription as ShadcnDescription,
    DialogTitle as ShadcnTitle,
    DialogTrigger as ShadcnTrigger,
} from '@/components/ui/dialog';
import type { ReactNode } from 'react';
import { cn } from './cn';
import { XIcon } from './icons';

/**
 * نافذة حوار — فوق **shadcn/ui** (`@/components/ui/dialog`): حبس التركيز، Esc،
 * إعادة التركيز، `role="dialog"` + `aria-labelledby` من Title. لا تُغلق بالنقر
 * خارجها هنا (افتراضي Radix) حتى لا تفقد نموذجًا غير محفوظ؛ `onOpenChange`
 * يبقى بيد المستدعي.
 *
 * البنية: `flex` عمودي مقيّد بـ`max-block-size` — الرأس والذيل ثابتان والجسم
 * وحده يمرّر، فيبقى زر الاعتماد/الإضافة في متناول اليد مهما طال المحتوى.
 * الأبعاد والتمرير في `.erp-dialog` داخل styles.css.
 */

export type DialogSize = 'sm' | 'md' | 'lg';

export interface DialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children?: ReactNode;
    footer?: ReactNode;
    /** زر يفتح النافذة (Trigger asChild). */
    trigger?: ReactNode;
    size?: DialogSize;
    className?: string;
    closeLabel?: string;
}

export function Dialog({
    open,
    onOpenChange,
    title,
    description,
    children,
    footer,
    trigger,
    size = 'md',
    className,
    closeLabel = 'إغلاق',
}: DialogProps) {
    return (
        <ShadcnRoot open={open} onOpenChange={onOpenChange}>
            {trigger ? <ShadcnTrigger asChild>{trigger}</ShadcnTrigger> : null}
            <ShadcnContent
                showCloseButton={false}
                className={cn(
                    'erp-dialog z-[var(--erp-z-modal)] rounded-xl border border-hairline bg-surface-raised text-ink shadow-[0_24px_64px_rgb(0_0_0/0.30)]',
                    `erp-dialog--${size}`,
                    className,
                )}
            >
                <div className="erp-dialog__head">
                    <div className="erp-dialog__titles">
                        <ShadcnTitle className="text-heading-lg text-ink">{title}</ShadcnTitle>
                        {description ? (
                            <ShadcnDescription className="text-body-sm text-muted">{description}</ShadcnDescription>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        aria-label={closeLabel}
                        onClick={() => onOpenChange(false)}
                        className="erp-dialog__close"
                    >
                        <XIcon className="size-4" />
                    </button>
                </div>
                {children ? <div className="erp-dialog__body text-body-md text-ink">{children}</div> : null}
                {footer ? <div className="erp-dialog__foot">{footer}</div> : null}
            </ShadcnContent>
        </ShadcnRoot>
    );
}
