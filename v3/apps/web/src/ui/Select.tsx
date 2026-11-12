import { useId } from 'react';
import { Label as ShadcnLabel } from '@/components/ui/label';
import {
    SelectContent as ShadcnContent,
    SelectGroup as ShadcnGroup,
    SelectItem as ShadcnItem,
    SelectLabel as ShadcnPrimitiveLabel,
    Select as ShadcnSelect,
    SelectSeparator as ShadcnSeparator,
    SelectTrigger as ShadcnTrigger,
    SelectValue as ShadcnValue,
} from '@/components/ui/select';
import { cn } from './cn';
import { type ControlSize, controlClassName, controlSizeClassName } from './Input';
import { AlertCircleIcon } from './icons';

/**
 * قائمة اختيار — فوق **shadcn/ui** (`@/components/ui/select`): Radix يدير ARIA
 * (`combobox`/`listbox`/`option`)، التركيز، لوحة المفاتيح، والبوابة. نُلبس
 * فقط: هوية DESIGN.md، تسمية مرتبطة بـ`aria-labelledby`، خطأ بـ`aria-invalid` +
 * `aria-describedby`.
 *
 * القيمة `undefined` = غير مختارة، فيظهر `placeholder` بلون خافت.
 */

export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
}

export interface SelectProps {
    options: readonly SelectOption[];
    label?: string;
    hint?: string;
    error?: string;
    placeholder?: string;
    value?: string;
    onValueChange?: (value: string) => void;
    disabled?: boolean;
    name?: string;
    size?: ControlSize;
    required?: boolean;
    containerClassName?: string;
    id?: string;
    className?: string;
}

export function Select({
    options,
    label,
    hint,
    error,
    placeholder = 'اختر…',
    value,
    onValueChange,
    disabled = false,
    name,
    size = 'md',
    required = false,
    containerClassName,
    id,
    className,
}: SelectProps) {
    const autoId = useId();
    const selectId = id ?? autoId;
    const labelId = label ? `${selectId}-label` : undefined;
    const hintId = hint ? `${selectId}-hint` : undefined;
    const errorId = error ? `${selectId}-error` : undefined;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
        <div className={cn('flex flex-col gap-xs', containerClassName)}>
            {label ? (
                <span id={labelId} className="text-label-md text-ink-secondary">
                    {label}
                    {required ? (
                        <span aria-hidden="true" className="text-danger-text">
                            {' *'}
                        </span>
                    ) : null}
                </span>
            ) : null}
            <ShadcnSelect value={value} onValueChange={onValueChange} disabled={disabled} name={name} required={required}>
                <ShadcnTrigger
                    id={selectId}
                    aria-labelledby={labelId}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    aria-required={required || undefined}
                    className={cn(
                        controlClassName,
                        controlSizeClassName[size],
                        'flex items-center justify-between gap-sm text-start data-[placeholder]:text-faint',
                        className,
                    )}
                >
                    <ShadcnValue placeholder={<span className="text-faint">{placeholder}</span>} />
                </ShadcnTrigger>
                <ShadcnContent
                    position="popper"
                    sideOffset={4}
                    className="z-[var(--erp-z-tooltip)] max-h-64 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-hairline bg-surface-raised text-ink shadow-pop"
                >
                    {options.map((option) => (
                        <ShadcnItem
                            key={option.value}
                            value={option.value}
                            disabled={option.disabled}
                            className="flex cursor-pointer select-none items-center justify-between gap-sm rounded-sm px-sm py-xs text-body-md text-ink outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-hover data-[state=checked]:bg-surface-hover"
                        >
                            {option.label}
                        </ShadcnItem>
                    ))}
                </ShadcnContent>
            </ShadcnSelect>
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
            {label ? (
                <ShadcnLabel htmlFor={selectId} className="sr-only">
                    {label}
                </ShadcnLabel>
            ) : null}
        </div>
    );
}

/** إعادة تصدير البدائيات لمن يحتاج تحكّمًا أدق (مجموعات، فواصل). */
export const SelectParts = {
    Group: ShadcnGroup,
    Label: ShadcnPrimitiveLabel,
    Separator: ShadcnSeparator,
} as const;
