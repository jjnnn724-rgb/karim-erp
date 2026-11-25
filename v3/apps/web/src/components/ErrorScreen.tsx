import type { ReactNode } from 'react';
import { Button } from '../ui/Button';
import { AlertTriangleIcon } from '../ui/icons';

/**
 * شاشة الخطأ — الحالة التي يراها المستخدم عند انهيار العرض.
 *
 * لا تكشف رسالة الاستثناء في الإنتاج: قد تحمل نصّ SQL أو مسار ملف. التفاصيل
 * تُعرض في التطوير فقط، وفي الإنتاج يبقى «إعادة المحاولة» و«العودة للرئيسية»
 * وخيار الرجوع إلى النسخة القديمة من `ErrorBoundary` أدناه.
 */

export interface ErrorScreenProps {
    readonly error?: unknown;
    readonly onRetry: () => void;
    readonly onHome?: () => void;
    readonly title?: string;
    readonly description?: string;
    readonly extra?: ReactNode;
}

function detailOf(error: unknown): string {
    if (error instanceof Error) {
        return error.stack || error.message;
    }
    return typeof error === 'string' ? error : '';
}

export function ErrorScreen({
    error,
    onRetry,
    onHome = () => window.location.assign('/v3/'),
    title = 'وقعت مشكلة غير متوقعة',
    description = 'تعذّر عرض هذه الشاشة. لم تتأثر بياناتك — أعد المحاولة، وإن تكرّر الخطأ أبلغ مسؤول النظام.',
    extra,
}: ErrorScreenProps) {
    const detail = import.meta.env.DEV ? detailOf(error) : '';
    return (
        <section
            role="alert"
            aria-live="assertive"
            className="mx-auto flex max-w-xl flex-col items-center gap-md rounded-lg border border-line bg-surface p-xl text-center text-ink"
        >
            <span className="grid size-11 place-items-center rounded-full bg-surface-sunken text-danger" aria-hidden="true">
                <AlertTriangleIcon className="size-5" />
            </span>
            <div className="flex flex-col gap-xxs">
                <h1 className="text-heading-md">{title}</h1>
                <p className="text-body-md text-muted">{description}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-xs">
                <Button onClick={onRetry}>إعادة المحاولة</Button>
                <Button variant="secondary" onClick={onHome}>
                    العودة إلى الرئيسية
                </Button>
            </div>
            {detail ? (
                <details className="w-full text-start">
                    <summary className="cursor-pointer text-body-sm text-muted">تفاصيل تقنية (تطوير)</summary>
                    <pre
                        dir="ltr"
                        className="mt-xs max-h-56 overflow-auto rounded-md bg-surface-sunken p-sm text-start text-body-xs text-muted"
                    >
                        {detail}
                    </pre>
                </details>
            ) : null}
            {extra}
        </section>
    );
}
