import { useId, type ReactNode } from 'react';
import { cn } from './cn';

/**
 * مقطع تحكّم (Segmented control) — اختيار واحد من بدائل قليلة.
 *
 * البنية أزرار راديو أصلية داخل `<fieldset>`: الأسهم والاختيار الواحد وإعلان
 * الحالة من المتصفح، لا محاكاة. الحالة المختارة تتباين بالسطح + الوزن +
 * النص، لا باللون وحده. حلقة التركيز تُرسم على النص المرئي (peer-focus-visible)
 * لأن الراديو نفسه `sr-only`.
 */

export interface SegmentedOption {
    value: string;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
}

export type SegmentedSize = 'sm' | 'md';

const SIZE_CLASS: Record<SegmentedSize, string> = {
    sm: 'px-sm py-1 text-body-sm',
    md: 'px-md py-1.5 text-body-md',
};

export interface SegmentedControlProps {
    /** اسم المجموعة (legend مخفي بصريًا). */
    label: string;
    options: readonly SegmentedOption[];
    value: string;
    onValueChange: (value: string) => void;
    size?: SegmentedSize;
    disabled?: boolean;
    name?: string;
    id?: string;
    className?: string;
}

export function SegmentedControl({
    label,
    options,
    value,
    onValueChange,
    size = 'md',
    disabled = false,
    name,
    id,
    className,
}: SegmentedControlProps) {
    const autoId = useId();
    const groupName = name ?? id ?? autoId;

    return (
        <fieldset className={cn('min-w-0 border-0 p-0', className)}>
            <legend className="sr-only">{label}</legend>
            <div className="inline-flex items-center gap-xxs rounded-md border border-hairline bg-surface-sunken p-xxs">
                {options.map((option) => {
                    const optionId = `${groupName}-${option.value}`;
                    const isDisabled = disabled || option.disabled;
                    return (
                        <label key={option.value} htmlFor={optionId} className="cursor-pointer">
                            <input
                                id={optionId}
                                type="radio"
                                name={groupName}
                                value={option.value}
                                checked={value === option.value}
                                disabled={isDisabled}
                                onChange={() => {
                                    onValueChange(option.value);
                                }}
                                className="peer sr-only"
                            />
                            <span
                                className={cn(
                                    'inline-flex items-center justify-center gap-xxs whitespace-nowrap rounded-sm text-muted transition-colors duration-[var(--erp-motion-fast)] ease-standard hover:text-ink peer-checked:bg-surface peer-checked:font-semibold peer-checked:text-ink peer-checked:shadow-card peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brass peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                                    SIZE_CLASS[size],
                                )}
                            >
                                {option.icon ? <span aria-hidden="true">{option.icon}</span> : null}
                                {option.label}
                            </span>
                        </label>
                    );
                })}
            </div>
        </fieldset>
    );
}
