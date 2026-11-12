import type { ReactNode } from 'react';

/**
 * رأس الصفحة الموحّد — سطرٌ واحد مضغوط لا لافتة:
 *
 *  - بداية السطر (RTL يمين): مسار تنقّل صغير رمادي، ثم العنوان الرئيسي
 *    `text-xl font-bold`، ومعه وسمٌ إنجليزي اختياري، ثم الوصف إن وُجد.
 *  - نهاية السطر (RTL يسار): الإجراءات (زر أساسي مصمت + إجراء ثانوي محدّد).
 *
 * لا تنسيق خاص بشاشة: الشاشة تُمرّر المحتوى فقط، فيبقى الشكل واحدًا في
 * كل الشاشات، ويورّث كل تعديلٍ هنا إلى الجميع تلقائيًا.
 */

export interface PageHeaderProps {
    readonly title: string;
    readonly english?: string;
    readonly description?: string;
    readonly breadcrumbs?: ReactNode;
    readonly actions?: ReactNode;
    /** شارات/أرقام إجمالية تُعرض بجوار العنوان. */
    readonly meta?: ReactNode;
    readonly className?: string;
}

export function PageHeader({ title, english, description, breadcrumbs, actions, meta, className }: PageHeaderProps) {
    return (
        <header className={className ? `erp-page-header ${className}` : 'erp-page-header'}>
            <div className="erp-page-header__main">
                {breadcrumbs ?? null}
                <div className="erp-page-header__titleRow">
                    <h1 className="erp-page-header__title">{title}</h1>
                    {english ? (
                        <span className="erp-page-header__english" dir="ltr" lang="en">
                            {english}
                        </span>
                    ) : null}
                    {meta ?? null}
                </div>
                {description ? <p className="erp-page-header__description">{description}</p> : null}
            </div>
            {actions ? (
                <div className="erp-page-header__actions" data-erp-print-hide>
                    {actions}
                </div>
            ) : null}
        </header>
    );
}

/** الاسم المعتمد في دليل التصميم — نفس التنفيذ، نقطة استيراد أوضح. */
export const AppPageHeader = PageHeader;
export type AppPageHeaderProps = PageHeaderProps;
