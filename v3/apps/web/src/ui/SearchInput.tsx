import { type KeyboardEventHandler, type Ref, useId } from 'react';
import { cn } from './cn';
import { controlClassName, controlSizeClassName } from './Input';
import { SearchIcon, XIcon } from './icons';

/**
 * حقل بحث — أيقونة بحث في بداية السطر المنطقية، وزر مسح عند وجود نص.
 * التسمية مخفية بصريًا لكنها مرتبطة (`htmlFor`) فلا يبقى الحقل بلا اسم.
 */

export interface SearchInputProps {
    value: string;
    onChange: (value: string) => void;
    onClear?: () => void;
    label?: string;
    placeholder?: string;
    disabled?: boolean;
    id?: string;
    className?: string;
    /** لالتقاط Enter (قارئ باركود) قبل أي معالج آخر. */
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    'data-testid'?: string;
    /** لتركيز الحقل من اختصار لوحة مفاتيح دون البحث في DOM. */
    inputRef?: Ref<HTMLInputElement>;
    /** `none` يمنع لوحة المفاتيح اللينة على شاشات اللمس — قارئ الباركود يكتب مباشرة. */
    inputMode?: 'none' | 'text' | 'search' | 'numeric' | 'decimal';
    autoComplete?: string;
    enterKeyHint?: 'enter' | 'search' | 'done' | 'go';
}

export function SearchInput({
    value,
    onChange,
    onClear,
    label = 'بحث',
    placeholder = 'بحث…',
    disabled = false,
    id,
    className,
    onKeyDown,
    'data-testid': testId,
    inputRef,
    inputMode,
    autoComplete = 'off',
    enterKeyHint,
}: SearchInputProps) {
    const autoId = useId();
    const inputId = id ?? autoId;

    return (
        <div className={cn('flex flex-col gap-xs', className)}>
            <label htmlFor={inputId} className="sr-only">
                {label}
            </label>
            <div className="relative">
                <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input
                    ref={inputRef}
                    id={inputId}
                    data-testid={testId}
                    type="search"
                    inputMode={inputMode}
                    autoComplete={autoComplete}
                    enterKeyHint={enterKeyHint}
                    value={value}
                    disabled={disabled}
                    placeholder={placeholder}
                    onKeyDown={onKeyDown}
                    onChange={(event) => {
                        if (disabled) {
                            return;
                        }
                        onChange(event.target.value);
                    }}
                    className={cn(controlClassName, controlSizeClassName.md, 'pos-search__input ps-10 pe-10')}
                />
                {value ? (
                    <button
                        type="button"
                        aria-label="مسح البحث"
                        onClick={() => {
                            onChange('');
                            onClear?.();
                        }}
                        className="absolute end-1.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-sm text-muted transition-colors duration-[var(--erp-motion-fast)] hover:bg-surface-hover hover:text-ink"
                    >
                        <XIcon className="size-3.5" />
                    </button>
                ) : null}
            </div>
        </div>
    );
}
