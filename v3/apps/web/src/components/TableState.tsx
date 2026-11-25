import type { ReactNode } from 'react';
import { Card as DesignCard } from '../ui/Card';
import { AlertTriangleIcon, InboxIcon } from './icons';

/**
 * حالات الجدول الأربع — عقدٌ إلزامي (DESIGN.md): لا منطقة فارغة أبدًا.
 *
 *  1. `loading` → هيكل عظمي **مع إبقاء الرؤوس الحقيقية**، `aria-busy`،
 *     ورسالة `role="status"` مخفية بصريًا. الهدف: CLS = 0.
 *  2. `error`   → أيقونة `alert-triangle` + زر «إعادة المحاولة» + `role="alert"`.
 *  3. `empty`   → أيقونة `inbox` + عنوان + تلميح (ماذا يفعل المستخدم الآن؟).
 *  4. `data`    → الصفوف الحقيقية.
 */

export function StateLoading({ label }: { label: string }) {
    return (
        <span role="status" className="sr-only">
            {label}
        </span>
    );
}

export function TableSkeleton({ rows = 5, columns = 3 }: { rows?: number; columns?: number }) {
    return (
        <div aria-hidden="true" className="flex flex-col gap-xxs p-sm">
            {Array.from({ length: rows }, (_, rowIndex) => (
                <div key={`skeleton-row-${String(rowIndex)}`} className="flex gap-sm">
                    {Array.from({ length: columns }, (_, columnIndex) => (
                        <span
                            key={`skeleton-cell-${String(columnIndex)}`}
                            className="block h-3 flex-1 rounded-sm bg-surface-sunken"
                            style={{ opacity: 1 - rowIndex * 0.12 }}
                        />
                    ))}
                </div>
            ))}
        </div>
    );
}

export function StateError({
    message,
    onRetry,
    title = 'تعذّر جلب البيانات',
}: {
    message: string;
    onRetry: () => void;
    /** عنوان قابل للتخصيص لمعرض المكوّنات؛ الافتراضي هو نص الحالة الحقيقي. */
    title?: string;
}) {
    return (
        <div role="alert" className="flex flex-col items-start gap-sm p-md text-body-md text-danger-text">
            <span className="flex items-center gap-xs">
                <AlertTriangleIcon />
                <span className="text-heading-sm">{title}</span>
            </span>
            <p className="text-body-sm">{message}</p>
            <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
            >
                إعادة المحاولة
            </button>
        </div>
    );
}

export function StateEmpty({ title, hint }: { title: string; hint: string }) {
    return (
        <div className="flex flex-col items-start gap-xs p-md text-body-md text-muted">
            <span className="flex items-center gap-xs">
                <InboxIcon />
                <span className="text-heading-sm text-ink">{title}</span>
            </span>
            <p className="text-body-sm">{hint}</p>
        </div>
    );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
    return <DesignCard className={className}>{children}</DesignCard>;
}

/**
 * منطقة تمرير الجدول — عقد DESIGN.md: «الجدول هو منطقة التمرير الأفقية
 * الوحيدة داخل بطاقته؛ الصفحة نفسها لا تمرر أفقيًا على 360px».
 *
 * `<section>` باسمٍ مفهوم = منطقة (landmark) ضمنيًا، و`tabIndex=0` يجعل
 * التمرير متاحًا بلوحة المفاتيح — منطقة تمرير بلا تركيز = محتوى لا يصل
 * إليه مستخدم لوحة المفاتيح (WCAG 2.1.1).
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
    return (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: منطقة التمرير يجب أن تقبل التركيز — عقد DESIGN.md وWCAG 2.1.1.
        <section className="erp-table__scroll" tabIndex={0} aria-label={label}>
            {children}
        </section>
    );
}
