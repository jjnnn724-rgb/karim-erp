import type { ReactElement, ReactNode } from 'react';
import {
    TooltipContent as ShadcnContent,
    TooltipProvider as ShadcnProvider,
    Tooltip as ShadcnRoot,
    TooltipTrigger as ShadcnTrigger,
} from '@/components/ui/tooltip';
import { cn } from './cn';

/**
 * تلميح — فوق **shadcn/ui** (`@/components/ui/tooltip`): يفتح بالتركيز وhover،
 * ويُربط بـ`aria-describedby` تلقائيًا. التلميح إضافة لا بديل: كل معلومة حرجة
 * يجب أن تكون في النص الظاهر (WCAG 1.4.13). المحتوى على سطح داكن من رموز الهوية.
 *
 * `side` منطقي: `start`/`end` تُترجم إلى الجهة الفيزيائية حسب `dir` الجذر.
 */

export type TooltipSide = 'top' | 'bottom' | 'start' | 'end';

export interface TooltipProps {
    content: ReactNode;
    /** عنصر واحد قابل للتركيز (Trigger asChild). */
    children: ReactElement;
    side?: TooltipSide;
    delayDuration?: number;
    className?: string;
}

function resolvePhysicalSide(side: TooltipSide): 'top' | 'bottom' | 'right' | 'left' {
    if (side === 'top' || side === 'bottom') {
        return side;
    }
    const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
    if (side === 'start') {
        return isRtl ? 'right' : 'left';
    }
    return isRtl ? 'left' : 'right';
}

export function Tooltip({ content, children, side = 'top', delayDuration = 300, className }: TooltipProps) {
    return (
        <ShadcnProvider delayDuration={delayDuration}>
            <ShadcnRoot>
                <ShadcnTrigger asChild>{children}</ShadcnTrigger>
                <ShadcnContent
                    side={resolvePhysicalSide(side)}
                    sideOffset={6}
                    className={cn(
                        'z-[var(--erp-z-tooltip)] max-w-64 rounded-sm bg-sidebar px-sm py-xs text-body-sm text-sidebar-ink shadow-pop',
                        className,
                    )}
                >
                    {content}
                </ShadcnContent>
            </ShadcnRoot>
        </ShadcnProvider>
    );
}
