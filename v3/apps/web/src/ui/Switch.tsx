import { useId } from 'react';
import { Label as ShadcnLabel } from '@/components/ui/label';
import { Switch as ShadcnSwitch } from '@/components/ui/switch';
import { cn } from './cn';

/**
 * مفتاح تبديل — فوق **shadcn/ui** (`@/components/ui/switch`):
 * `role="switch"` + `aria-checked` + مسافة/Enter. الحالة لا تُنقل باللون وحده:
 * موضع المقبض + `aria-checked` هما الدلالة.
 */

export interface SwitchProps {
    label: string;
    description?: string;
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    name?: string;
    value?: string;
    id?: string;
    className?: string;
}

export function Switch({ label, description, checked, onCheckedChange, disabled = false, name, value, id, className }: SwitchProps) {
    const autoId = useId();
    const switchId = id ?? autoId;
    const descriptionId = description ? `${switchId}-description` : undefined;

    return (
        <div className={cn('flex items-start gap-sm', className)}>
            <ShadcnSwitch
                id={switchId}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
                name={name}
                value={value}
                aria-describedby={descriptionId}
                className="mt-0.5 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
            />
            <div className="flex flex-col gap-xxs">
                <ShadcnLabel htmlFor={switchId} className="cursor-pointer text-body-md text-ink">
                    {label}
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
