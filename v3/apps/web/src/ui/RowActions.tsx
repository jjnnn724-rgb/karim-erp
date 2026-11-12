import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from './cn';

/**
 * إجراءات الصف — قائمة النقاط الثلاث في طرف الصف بدل أزرار ملوّنة متضخمة.
 *
 * لماذا قائمة: عمود الإجراءات في ERP كثيف، وزرّان مصمتان لكل صف يجعلان
 * الجدول «أزرارًا» لا بيانات. هنا يبقى الصف هادئًا، والفعل على بُعد نقرة.
 *
 * الوصول: العنصر جذر Radix، فيورث لوحة المفاتيح (Enter/Space/الأسهم/Escape)
 * ونقل التركيز ومحاصرة الدور. الزرّ له `aria-label` صريح لأنه بلا نص.
 * الحذف ليس أحمر مصمتًا: نصٌّ أحمر داخل القائمة (`tone="danger"`).
 */

export interface RowAction {
    readonly key: string;
    readonly label: string;
    readonly icon?: ReactNode;
    readonly onSelect: () => void;
    readonly tone?: 'default' | 'danger';
    readonly disabled?: boolean;
    /** يُخفي العنصر كليًا (مثال: صفٌّ مقفول لا يُعدَّل). */
    readonly hidden?: boolean;
    /** فاصل قبل العنصر (تجميع «تعديل/طباعة» عن «حذف»). */
    readonly separatorBefore?: boolean;
    readonly shortcut?: string;
}

export interface RowActionsProps {
    /** اسم القائمة المفهوم — يصبح `aria-label` للزرّ. */
    readonly label: string;
    readonly actions: readonly RowAction[];
    /** عنوان اختياري أعلى القائمة (اسم السجل مثلًا). */
    readonly heading?: string;
    readonly className?: string;
}

export function RowActions({ label, actions, heading, className }: RowActionsProps) {
    const visible = actions.filter((action) => !action.hidden);
    if (visible.length === 0) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    title={label}
                    data-slot="row-actions-trigger"
                    className={cn(
                        'erp-row-actions__trigger inline-flex size-7.5 shrink-0 items-center justify-center rounded-md',
                        'text-muted transition-colors duration-[var(--erp-motion-fast)]',
                        'hover:bg-surface-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2',
                        'data-[state=open]:bg-surface-hover data-[state=open]:text-ink',
                        className,
                    )}
                >
                    <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={4} className="erp-row-actions__menu min-w-44">
                {heading ? (
                    <div className="px-2 py-1.5 text-[11px] font-bold text-muted" data-slot="row-actions-heading">
                        {heading}
                    </div>
                ) : null}
                {visible.map((action) => (
                    <div key={action.key}>
                        {action.separatorBefore ? <DropdownMenuSeparator /> : null}
                        <DropdownMenuItem
                            variant={action.tone === 'danger' ? 'destructive' : 'default'}
                            disabled={action.disabled}
                            onSelect={() => {
                                action.onSelect();
                            }}
                            className="gap-2 text-body-sm"
                        >
                            {action.icon ? (
                                <span className="shrink-0 opacity-70" aria-hidden="true">
                                    {action.icon}
                                </span>
                            ) : null}
                            <span className="flex-1">{action.label}</span>
                            {action.shortcut ? (
                                <span className="text-caption text-faint" dir="ltr">
                                    {action.shortcut}
                                </span>
                            ) : null}
                        </DropdownMenuItem>
                    </div>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
