import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from './cn';
import { AlertCircleIcon, CheckIcon, ChevronIcon } from './icons';
import { controlClassName, controlSizeClassName } from './Input';

/**
 * صندوق اختيار قابل للبحث (Combobox) — بحث داخل القائمة عبر إدخال نصّي.
 *
 * تطبيق نمط ARIA 1.2: `input[role="combobox"]` + `aria-expanded` +
 * `aria-controls` + `aria-autocomplete="list"` + `aria-activedescendant`،
 * والقائمة `role="listbox"` والخيارات `role="option"` بحالة `aria-selected`.
 * الأسهم/Enter/Escape/Home/End تعمل من داخل الإدخال بلا نقل تركيز (النمط
 * الموصى به)، والخيارات المعطّلة تُتخطّى في التنقّل.
 *
 * البحث يطبّع العربية (همزات/تاء مربوطة/تشكيل) كي يجد «القاهره» مقابل
 * «القاهرة» — نفس سلوك بحث الشاشات القائمة.
 */

export interface ComboboxOption {
    value: string;
    label: string;
    hint?: string;
    disabled?: boolean;
}

function normalize(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[\u064b-\u0652]/g, '')
        .replace(/[أإآ]/g, 'ا')
        .replace(/ى/g, 'ي')
        .replace(/ة/g, 'ه');
}

export interface ComboboxProps {
    options: readonly ComboboxOption[];
    label: string;
    value?: string;
    onValueChange?: (value: string) => void;
    placeholder?: string;
    emptyMessage?: string;
    hint?: string;
    error?: string;
    disabled?: boolean;
    id?: string;
    'data-testid'?: string;
    className?: string;
}

export function Combobox({
    options,
    label,
    value,
    onValueChange,
    placeholder = 'ابحث أو اختر…',
    emptyMessage = 'لا نتائج مطابقة',
    hint,
    error,
    disabled = false,
    id,
    'data-testid': testId,
    className,
}: ComboboxProps) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const listboxId = `${inputId}-listbox`;
    const hintId = hint ? `${inputId}-hint` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;
    const describedBy = error ? errorId : hint ? hintId : undefined;

    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const selected = useMemo(() => options.find((option) => option.value === value), [options, value]);

    const filtered = useMemo(() => {
        const needle = normalize(query);
        if (!needle) {
            return options;
        }
        return options.filter((option) => normalize(option.label).includes(needle) || normalize(option.value).includes(needle));
    }, [options, query]);

    const activeOption = activeIndex >= 0 ? filtered[activeIndex] : undefined;
    const activeDescendant = open && activeOption ? `${listboxId}-option-${String(activeIndex)}` : undefined;

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: PointerEvent) => {
            if (!containerRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('pointerdown', onPointerDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
        };
    }, [open]);

    function openList(): void {
        setOpen(true);
        setQuery('');
        const firstEnabled = options.findIndex((option) => !option.disabled);
        setActiveIndex(firstEnabled);
    }

    function moveActive(step: 1 | -1): void {
        if (filtered.length === 0) {
            return;
        }
        let next = activeIndex;
        for (let attempts = 0; attempts < filtered.length; attempts += 1) {
            next = (next + step + filtered.length) % filtered.length;
            if (!filtered[next]?.disabled) {
                setActiveIndex(next);
                return;
            }
        }
    }

    function selectOption(option: ComboboxOption): void {
        if (option.disabled) {
            return;
        }
        onValueChange?.(option.value);
        setOpen(false);
        setQuery('');
    }

    const displayValue = open ? query : (selected?.label ?? '');

    return (
        <div ref={containerRef} className={cn('relative flex flex-col gap-xs', className)}>
            <label htmlFor={inputId} className="text-label-md text-ink-secondary">
                {label}
            </label>
            <div className="relative">
                <input
                    id={inputId}
                    data-testid={testId}
                    role="combobox"
                    type="text"
                    autoComplete="off"
                    aria-expanded={open}
                    aria-controls={open ? listboxId : undefined}
                    aria-autocomplete="list"
                    aria-activedescendant={activeDescendant}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    disabled={disabled}
                    placeholder={placeholder}
                    value={displayValue}
                    onChange={(event) => {
                        setQuery(event.target.value);
                        setOpen(true);
                        setActiveIndex(0);
                        onValueChange?.(event.target.value);
                    }}
                    onFocus={() => {
                        if (!open) {
                            openList();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault();
                            if (!open) {
                                openList();
                            } else {
                                moveActive(1);
                            }
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault();
                            if (!open) {
                                openList();
                            } else {
                                moveActive(-1);
                            }
                        } else if (event.key === 'Enter') {
                            if (open && activeOption) {
                                event.preventDefault();
                                selectOption(activeOption);
                            }
                        } else if (event.key === 'Escape') {
                            if (open) {
                                event.preventDefault();
                                setOpen(false);
                            }
                        } else if (event.key === 'Tab') {
                            setOpen(false);
                        }
                    }}
                    className={cn(controlClassName, controlSizeClassName.md, 'pe-9')}
                />
                <span aria-hidden="true" className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-muted">
                    <ChevronIcon className="size-4" />
                </span>
                {open ? (
                    <ul
                        id={listboxId}
                        role="listbox"
                        aria-label={label}
                        className="absolute inset-x-0 top-full z-[var(--erp-z-tooltip)] mt-xxs max-h-64 overflow-auto rounded-md border border-hairline bg-surface-raised p-xxs shadow-[0_24px_64px_rgb(0_0_0/0.30)]"
                    >
                        {filtered.length === 0 ? (
                            <li role="presentation" className="px-sm py-xs text-body-sm text-muted">
                                {emptyMessage}
                            </li>
                        ) : (
                            filtered.map((option, index) => (
                                <li
                                    key={option.value}
                                    id={`${listboxId}-option-${String(index)}`}
                                    role="option"
                                    aria-selected={option.value === value}
                                    aria-disabled={option.disabled || undefined}
                                    onMouseDown={(event) => {
                                        event.preventDefault();
                                    }}
                                    onClick={() => {
                                        selectOption(option);
                                    }}
                                    className={cn(
                                        'flex cursor-pointer items-center justify-between gap-sm rounded-sm px-sm py-xs text-body-md',
                                        index === activeIndex ? 'bg-surface-hover text-ink' : 'text-ink',
                                        option.value === value && 'font-semibold',
                                        option.disabled && 'cursor-not-allowed opacity-50',
                                    )}
                                >
                                    <span className="flex flex-col">
                                        <span>{option.label}</span>
                                        {option.hint ? <span className="text-caption text-faint">{option.hint}</span> : null}
                                    </span>
                                    {option.value === value ? (
                                        <span aria-hidden="true" className="text-brand-text">
                                            <CheckIcon className="size-4" />
                                        </span>
                                    ) : null}
                                </li>
                            ))
                        )}
                    </ul>
                ) : null}
            </div>
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
