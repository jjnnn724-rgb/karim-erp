import type { ReactNode } from 'react';
import type { DisplayTone } from '../lib/reporting';
import { StatCard } from '../ui/StatCard';

/**
 * عناصر التقارير المشتركة — نفس عقد DESIGN.md المستخدم في الشاشات القائمة:
 * بطاقة مؤشر، بطاقة قسم، قائمة أشرطة، ترويسة تقرير، وشريط مدى زمني.
 *
 * كلها عرضٌ فقط: لا حساب ولا جلب ولا قرار صلاحية. الشاشة هي التي تقرر
 * ماذا تعرض، وهذه العناصر تُوحّد الشكل فقط.
 */

export function KpiCard({
    label,
    english,
    value,
    hint,
    tone = 'neutral',
}: {
    label: string;
    english: string;
    value: string;
    hint: string;
    tone?: DisplayTone;
}) {
    return <StatCard label={label} english={english} value={value} hint={hint} tone={tone} />;
}

export function SectionCard({
    title,
    english,
    children,
    actions,
}: {
    title: string;
    english: string;
    children: ReactNode;
    actions?: ReactNode;
}) {
    return (
        <section className="min-w-0 rounded-lg border border-hairline bg-surface shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-sm border-b border-hairline px-sm py-xs">
                <h2 className="text-heading-md text-ink">
                    {title}{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        {english}
                    </span>
                </h2>
                {actions ?? null}
            </div>
            {children}
        </section>
    );
}

export function BarList({
    items,
    emptyText,
    ariaLabel,
}: {
    items: { label: string; value: string; share: number | null }[];
    emptyText: string;
    ariaLabel: string;
}) {
    if (items.length === 0) {
        return <p className="p-sm text-body-sm text-muted">{emptyText}</p>;
    }
    return (
        <ul className="flex flex-col gap-xs p-sm" aria-label={ariaLabel}>
            {items.map((item) => (
                <li key={item.label} className="flex items-center gap-sm text-body-sm">
                    <span className="w-40 shrink-0 truncate text-ink" title={item.label}>
                        {item.label}
                    </span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <span
                            className="block h-full rounded-full bg-primary"
                            style={{ width: `${String(Math.max(0, Math.min(100, item.share ?? 0)))}%` }}
                        />
                    </span>
                    <span className="erp-numeric w-28 shrink-0 text-end text-ink" dir="ltr">
                        {item.value}
                    </span>
                </li>
            ))}
        </ul>
    );
}

export function ReportHeader({
    title,
    english,
    description,
    onRefresh,
    pending,
}: {
    title: string;
    english: string;
    description: string;
    onRefresh: () => void;
    pending: boolean;
}) {
    return (
        <header className="flex flex-wrap items-end justify-between gap-sm">
            <div>
                <h1 className="text-display-lg text-ink">
                    {title}{' '}
                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                        {english}
                    </span>
                </h1>
                <p className="text-body-sm text-muted">{description}</p>
            </div>
            <button
                type="button"
                onClick={onRefresh}
                disabled={pending}
                className="erp-touch rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
            >
                تحديث
            </button>
        </header>
    );
}

export function RangeControls({
    from,
    to,
    onFrom,
    onTo,
    onApply,
    pending,
}: {
    from: string;
    to: string;
    onFrom: (value: string) => void;
    onTo: (value: string) => void;
    onApply: () => void;
    pending: boolean;
}) {
    return (
        <div className="flex flex-wrap items-end gap-sm">
            <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                من
                <input
                    type="date"
                    data-testid="range-from"
                    value={from}
                    onChange={(event) => {
                        onFrom(event.target.value);
                    }}
                    className="erp-touch h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                />
            </label>
            <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                إلى
                <input
                    type="date"
                    data-testid="range-to"
                    value={to}
                    onChange={(event) => {
                        onTo(event.target.value);
                    }}
                    className="erp-touch h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                />
            </label>
            <button
                type="button"
                data-testid="range-apply"
                onClick={onApply}
                disabled={pending}
                className="erp-touch rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
            >
                عرض
            </button>
            {pending ? (
                <span role="status" className="text-body-sm text-muted">
                    جارٍ التحديث…
                </span>
            ) : null}
        </div>
    );
}

