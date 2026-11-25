import { useId } from 'react';
import { cn } from './cn';

/**
 * أزرار راديو — أزرار أصلية (native) داخل `<fieldset>`/`<legend>`: دلالة
 * المجموعة والتسمية ولوحة المفاتيح (الأسهم) تأتي من المتصفح لا من محاكاة.
 *
 * `Radio` منخفض المستوى لمن يحتاج تخطيطًا خاصًا، و`RadioGroup` للاستخدام
 * الشائع: يُولّد `name` مشتركًا ويربط التسميات.
 */

export interface RadioProps {
    label: string;
    value: string;
    name: string;
    checked?: boolean | undefined;
    onChange?: ((value: string) => void) | undefined;
    disabled?: boolean | undefined;
    description?: string | undefined;
    id?: string | undefined;
    className?: string | undefined;
}

export function Radio({ label, value, name, checked, onChange, disabled = false, description, id, className }: RadioProps) {
    const autoId = useId();
    const radioId = id ?? autoId;

    return (
        <div className={cn('flex items-start gap-sm', className)}>
            <input
                id={radioId}
                type="radio"
                name={name}
                value={value}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange?.(value)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
            />
            <span className="flex flex-col gap-xxs">
                <label htmlFor={radioId} className="cursor-pointer text-body-md text-ink">
                    {label}
                </label>
                {description ? <span className="text-body-sm text-muted">{description}</span> : null}
            </span>
        </div>
    );
}

export interface RadioOption {
    value: string;
    label: string;
    description?: string;
    disabled?: boolean;
}

export interface RadioGroupProps {
    label: string;
    options: readonly RadioOption[];
    value?: string;
    onValueChange?: (value: string) => void;
    name?: string;
    disabled?: boolean;
    hint?: string;
    error?: string;
    inline?: boolean;
    containerClassName?: string;
    id?: string;
}

export function RadioGroup({
    label,
    options,
    value,
    onValueChange,
    name,
    disabled = false,
    hint,
    error,
    inline = false,
    containerClassName,
    id,
}: RadioGroupProps) {
    const autoId = useId();
    const groupId = id ?? autoId;
    const nameId = `${groupId}-name`;
    const hintId = hint ? `${groupId}-hint` : undefined;
    const errorId = error ? `${groupId}-error` : undefined;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    return (
        <fieldset
            id={groupId}
            aria-describedby={describedBy}
            className={cn('flex min-w-0 flex-col gap-xs border-0 p-0', containerClassName)}
        >
            <legend className="mb-xxs text-label-md text-ink-secondary">{label}</legend>
            <div className={cn('flex gap-sm', inline ? 'flex-row flex-wrap items-start' : 'flex-col')}>
                {options.map((option) => (
                    <Radio
                        key={option.value}
                        name={name ?? nameId}
                        value={option.value}
                        label={option.label}
                        description={option.description}
                        checked={value === option.value}
                        disabled={disabled || option.disabled}
                        onChange={onValueChange}
                    />
                ))}
            </div>
            {error ? (
                <p id={errorId} role="alert" className="text-body-sm text-danger-text">
                    {error}
                </p>
            ) : hint ? (
                <p id={hintId} className="text-caption text-faint">
                    {hint}
                </p>
            ) : null}
        </fieldset>
    );
}
