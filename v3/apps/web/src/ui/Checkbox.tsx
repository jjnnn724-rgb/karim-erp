import { useId } from 'react';
import { Checkbox as ShadcnCheckbox } from '@/components/ui/checkbox';
import { Label as ShadcnLabel } from '@/components/ui/label';
import { cn } from './cn';

/**
 * خانة اختيار — فوق **shadcn/ui** (`@/components/ui/checkbox`): `role="checkbox"`
 * و`aria-checked` (بما فيها `mixed`) وإدارة التركيز. التسمية `<label htmlFor>`
 * مرتبطة بالزر القابل للتسمية، والوصف بـ`aria-describedby`.
 */

export type CheckedState = boolean | 'indeterminate';

export interface CheckboxProps {
    label: string;
    description?: string;
    checked?: CheckedState;
    onCheckedChange?: (checked: CheckedState) => void;
    disabled?: boolean;
    required?: boolean;
    name?: string;
    value?: string;
    id?: string;
    className?: string;
}

export function Checkbox({
    label,
    description,
    checked,
    onCheckedChange,
    disabled = false,
    required = false,
    name,
    value,
    id,
    className,
}: CheckboxProps) {
    const autoId = useId();
    const checkboxId = id ?? autoId;
    const descriptionId = description ? `${checkboxId}-description` : undefined;

    return (
        <div className={cn('flex items-start gap-sm', className)}>
            <ShadcnCheckbox
                id={checkboxId}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
                required={required}
                name={name}
                value={value}
                aria-describedby={descriptionId}
                className="mt-0.5 size-4.5 rounded-sm border-hairline-strong data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary"
            />
            <div className="flex flex-col gap-xxs">
                <ShadcnLabel htmlFor={checkboxId} className="cursor-pointer text-body-md text-ink">
                    {label}
                    {required ? (
                        <span aria-hidden="true" className="text-danger-text">
                            {' *'}
                        </span>
                    ) : null}
                </ShadcnLabel>
                {description ? (
                    <p id={descriptionId} className="text-body-sm text-muted">
                        {description}
                    </p>
                ) : null}
            </div>
        </div>
    );
}
