import type { ReactNode } from 'react';

/**
 * ترويسة الصفحة الموحّدة (خطة §3.3): مسار تنقّل اختياري، عنوان `h1`،
 * عنوان إنجليزي اختياري، وصف، وإجراءات. لا تنسيق خاص بشاشة — الشاشة تُمرّر
 * المحتوى فقط، فيبقى الشكل واحدًا في الرئيسية وغيرها.
 */

export interface PageHeaderProps {
    readonly title: string;
    readonly english?: string;
    readonly description?: string;
    readonly breadcrumbs?: ReactNode;
    readonly actions?: ReactNode;
}

export function PageHeader({ title, english, description, breadcrumbs, actions }: PageHeaderProps) {
    return (
        <header className="erp-page-header flex flex-col gap-xxs">
            {breadcrumbs ?? null}
            <div className="flex flex-wrap items-end justify-between gap-sm">
                <div className="min-w-0">
                    {english ? (
                        <p className="erp-page-header__eyebrow" dir="ltr" lang="en">
                            {english}
                        </p>
                    ) : null}
                    <h1 className="text-display-lg font-semibold text-ink">{title}</h1>
                    {description ? <p className="mt-xxs text-body-sm text-muted">{description}</p> : null}
                </div>
                {actions ? <div className="flex flex-wrap items-center gap-xs">{actions}</div> : null}
            </div>
        </header>
    );
}
