import { type ReactNode, useEffect, useState } from 'react';
import { StateError, StateLoading } from '../../components/TableState';
import { Badge } from '../../ui/Badge';
import { Button } from '../../ui/Button';
import { Card, CardBody, CardHeader, CardTitle } from '../../ui/Card';

/**
 * قطع مشتركة بين أقسام الإعدادات: هيكل البطاقة، شبكة الحقول، شريط الحفظ
 * الملتصق أسفل البطاقة، وحالة نموذج «مسودة/أساس» تحفظ التغييرات عبر التنقل.
 */

export interface Draft<T> {
    base: T;
    value: T;
    dirty: boolean;
    set: <K extends keyof T>(key: K, next: T[K]) => void;
    patch: (next: Partial<T>) => void;
    commit: () => void;
    reset: () => void;
}

/**
 * مسودة نموذج تعيد الضبط حين تتغير البيانات المرجعية فعلًا (بصمة المحتوى)،
 * لا عند كل إعادة جلب متطابقة. `commit` يجعل القيمة المحفوظة أساسًا جديدًا.
 */
export function useDraftForm<T>(initial: T | null, signature: string): Draft<T> | null {
    const [state, setState] = useState<{ base: T; value: T; signature: string } | null>(null);

    useEffect(() => {
        if (initial === null) {
            return;
        }
        setState((current) => (current && current.signature === signature ? current : { base: initial, value: initial, signature }));
    }, [initial, signature]);

    if (state === null) {
        return null;
    }
    return {
        base: state.base,
        value: state.value,
        dirty: JSON.stringify(state.base) !== JSON.stringify(state.value),
        set: (key, next) => {
            setState((current) => (current ? { ...current, value: { ...current.value, [key]: next } } : current));
        },
        patch: (next) => {
            setState((current) => (current ? { ...current, value: { ...current.value, ...next } } : current));
        },
        commit: () => {
            setState((current) => (current ? { ...current, base: current.value } : current));
        },
        reset: () => {
            setState((current) => (current ? { ...current, value: current.base } : current));
        },
    };
}

export function SectionCard({
    title,
    english,
    badge,
    actions,
    children,
    footer,
}: {
    title: string;
    english?: string;
    badge?: ReactNode;
    actions?: ReactNode;
    children: ReactNode;
    footer?: ReactNode;
}) {
    return (
        <Card>
            <CardHeader
                actions={
                    <>
                        {badge}
                        {actions}
                    </>
                }
            >
                <CardTitle>{title}</CardTitle>
                {english ? (
                    <span className="text-caption text-faint" dir="ltr" lang="en">
                        {english}
                    </span>
                ) : null}
            </CardHeader>
            <CardBody className="flex flex-col gap-md">{children}</CardBody>
            {footer}
        </Card>
    );
}

export function FieldGrid({ children, columns = 2 }: { children: ReactNode; columns?: 2 | 3 }) {
    return (
        <div className={columns === 3 ? 'grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-3' : 'grid grid-cols-1 gap-md sm:grid-cols-2'}>
            {children}
        </div>
    );
}

export function ToggleGrid({ children }: { children: ReactNode }) {
    return <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

export function SaveBar({
    dirty,
    saving,
    error,
    onSave,
    onReset,
    label = 'حفظ التغييرات',
    disabled = false,
}: {
    dirty: boolean;
    saving: boolean;
    error?: string;
    onSave: () => void;
    onReset: () => void;
    label?: string;
    disabled?: boolean;
}) {
    if (!dirty && !error) {
        return null;
    }
    return (
        <div className="sticky bottom-sm z-10 flex flex-wrap items-center justify-between gap-sm rounded-lg border border-hairline bg-surface/95 px-md py-sm shadow-card backdrop-blur">
            <div className="min-w-0">
                {error ? (
                    <p role="alert" className="text-body-sm text-danger-text">
                        {error}
                    </p>
                ) : (
                    <p className="text-body-sm text-muted">تغييرات غير محفوظة</p>
                )}
            </div>
            <div className="flex items-center gap-xs">
                <Button variant="ghost" size="sm" onClick={onReset} disabled={saving}>
                    تراجع
                </Button>
                <Button variant="primary" size="sm" loading={saving} disabled={disabled} onClick={onSave}>
                    {label}
                </Button>
            </div>
        </div>
    );
}

export function ReadOnlyBadge({ visible }: { visible: boolean }) {
    return visible ? null : (
        <Badge variant="neutral" dot>
            قراءة فقط
        </Badge>
    );
}

export function QueryBoundary({
    pending,
    error,
    onRetry,
    children,
}: {
    pending: boolean;
    error: unknown;
    onRetry: () => void;
    children: ReactNode;
}) {
    if (pending) {
        return (
            <Card>
                <CardBody>
                    <StateLoading label="جارٍ تحميل الإعدادات" />
                    <div className="flex flex-col gap-xs" aria-hidden="true">
                        <span className="h-4 w-1/3 rounded-sm bg-surface-sunken" />
                        <span className="h-9 w-full rounded-md bg-surface-sunken" />
                        <span className="h-9 w-2/3 rounded-md bg-surface-sunken" />
                    </div>
                </CardBody>
            </Card>
        );
    }
    if (error) {
        const message = error instanceof Error ? error.message : 'تعذّر تحميل الإعدادات';
        return (
            <Card>
                <StateError message={message} onRetry={onRetry} />
            </Card>
        );
    }
    return <>{children}</>;
}

export function formatStamp(value: string): string {
    const raw = String(value ?? '').trim();
    if (!raw) {
        return '—';
    }
    return raw.replace('T', ' ').slice(0, 19);
}

export function formatNumber(value: number): string {
    return value.toLocaleString('en-US');
}
