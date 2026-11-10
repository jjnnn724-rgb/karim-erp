import { Label as ShadcnLabel } from '@/components/ui/label';
import { Textarea as ShadcnTextarea } from '@/components/ui/textarea';
import { useId, type ComponentPropsWithRef } from 'react';
import { cn } from './cn';
import { AlertCircleIcon } from './icons';
import { controlClassName, type ControlSize } from './Input';

/**
 * منطقة نصّ متعددة الأسطر — فوق **shadcn/ui** (`@/components/ui/textarea`):
 * نفس عقد الحقل النصّي: تسمية مرتبطة، خطأ `aria-invalid` + `aria-describedby`،
 * وتلميح. الارتفاع من `rows` لا من ارتفاع ثابت، وفشل التركيز نفسه (حلقة
 * الشامبانيا العامة).
 */

export interface TextareaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'rows'> {
    label?: string;
    hint?: string;
    error?: string;
    rows?: number;
    size?: ControlSize;
    containerClassName?: string;
    requiredMark?: boolean;
}

export function Textarea({
    label,
    hint,
    error,
    rows = 3,
    size = 'md',
    containerClassName,
    requiredMark,
    id,
    className,
    'aria-describedby': ariaDescribedBy,
    ...rest
}: TextareaProps) {
    const autoId = useId();
    const textareaId = id ?? autoId;
    const hintId = hint ? `${textareaId}-hint` : undefined;
    const errorId = error ? `${textareaId}-error` : undefined;
    const describedBy = [ariaDescribedBy, errorId ?? hintId].filter((value): value is string => Boolean(value)).join(' ');

    return (
        <div className={cn('flex flex-col gap-xs', containerClassName)}>
            {label ? (
                <ShadcnLabel htmlFor={textareaId} className="text-label-md text-ink-secondary">
                    {label}
                    {requiredMark || rest.required ? (
                        <span aria-hidden="true" className="text-danger-text">
                            {' *'}
                        </span>
                    ) : null}
                </ShadcnLabel>
            ) : null}
            <ShadcnTextarea
                id={textareaId}
                rows={rows}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                className={cn(
                    controlClassName,
                    'min-h-16 py-xs leading-normal',
                    size === 'sm' ? 'text-body-sm' : 'text-body-md',
                    className,
                )}
                {...rest}
            />
            {error ? (
                <p id={errorId} className="flex items-center gap-xxs text-body-sm text-danger-text">
                    <AlertCircleIcon className="size-3.5 shrink-0" />
                    {error}
                </p>
            ) : hint ? (
                <p id={hintId} className="text-caption text-faint">
                    {hint}
                </p>
            ) : null}
        </div>
    );
}
