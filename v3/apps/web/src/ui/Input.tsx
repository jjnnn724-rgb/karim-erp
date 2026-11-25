import { type ComponentPropsWithRef, useId } from 'react';
import { Input as ShadcnInput } from '@/components/ui/input';
import { Label as ShadcnLabel } from '@/components/ui/label';
import { cn } from './cn';
import { definedProps } from './definedProps';
import { AlertCircleIcon } from './icons';

/**
 * حقل نصّي — فوق **shadcn/ui** (`@/components/ui/input` + `Label`)، تسمية مرتبطة
 * (`htmlFor`/`id`)، خطأ بـ`aria-invalid` + `aria-describedby`، وتلميح اختياري.
 * حلقة التركيز بلون الفعل عامة من `styles.css` (لا تُحذف أبدًا — DESIGN.md).
 *
 * `controlClassName` يُصدَّر لتشاركه Select/Textarea/Combobox، فيبقى مظهر
 * كل عناصر التحكم من مصدر واحد (قاعدة «لا زوايا مختلطة داخل المكوّن»).
 */

export const controlClassName =
    'erp-control block w-full rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink shadow-card transition-colors duration-[var(--erp-motion-fast)] ease-standard placeholder:text-faint hover:border-primary/60 focus-visible:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:bg-danger-soft';

export const controlSizeClassName = {
    sm: 'h-7.5 text-body-sm',
    md: 'h-9.5',
    lg: 'h-11 text-body-md',
} as const;

export type ControlSize = keyof typeof controlSizeClassName;

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
    label?: string;
    hint?: string;
    error?: string;
    size?: ControlSize;
    containerClassName?: string;
    requiredMark?: boolean;
}

export function Input({
    label,
    hint,
    error,
    size = 'md',
    containerClassName,
    requiredMark,
    id,
    className,
    'aria-describedby': ariaDescribedBy,
    ...rest
}: InputProps) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = [ariaDescribedBy, errorId ?? hintId].filter((value): value is string => Boolean(value)).join(' ');

    return (
        <div className={cn('flex flex-col gap-xs', containerClassName)}>
            {label ? (
                <ShadcnLabel htmlFor={inputId} className="text-label-md text-ink-secondary">
                    {label}
                    {requiredMark || rest.required ? (
                        <span aria-hidden="true" className="text-danger-text">
                            {' *'}
                        </span>
                    ) : null}
                </ShadcnLabel>
            ) : null}
            <ShadcnInput
                id={inputId}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy || undefined}
                className={cn(controlClassName, controlSizeClassName[size], className)}
                {...definedProps(rest)}
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
