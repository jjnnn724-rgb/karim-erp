import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * ScreenHero — فاتحة الصفحة الموحدة (نمط توقيعي «لغة كريم»، 2026-11-21).
 * ────────────────────────────────────────────────────────────────────────────
 * يحل الأشكال الثلاثة المتعارضة: h1 يدوي (36 شاشة)، ReportHeader (32 شاشة
 * بلا فتحة إجراءات)، PageHeader (4 شاشات فقط). العقد:
 *
 *  • **الجواب أولًا**: فتحة `answer` تُعرض تحت العنوان مباشرة (AnswerStrip
 *    عادةً) — الشاشة تفتح بما جاء لها المستخدم، لا بأدوات الفلترة.
 *  • **النص حرفي**: `title` يُصيَّر h1 بنفس نص الشاشة السابق — حراس
 *    الاختبارات تثبّت العناوين، والهيرو لا يلمسها.
 *  • الإجراءات مخفية من الطباعة (`data-erp-print-hide`) كما في سابقاتها.
 *
 * RTL آمن بالخصائص المنطقية؛ بلا ألوان خام (توكنز فقط).
 */
export interface ScreenHeroProps {
    /** العنوان العربي — يُصيَّر h1 بنفس النص الحرفي للشاشة. */
    title: string;
    /** السطر الإنجليزي العلوي (eyebrow). */
    english?: string;
    description?: string;
    /** الجواب — شريط المؤشرات الرئيسية (AnswerStrip عادةً). */
    answer?: ReactNode;
    /** إجراءات الرأس (أزرار إنشاء/تصدير…) — مخفية من الطباعة. */
    actions?: ReactNode;
    className?: string;
}

export function ScreenHero({ title, english, description, answer, actions, className }: ScreenHeroProps) {
    return (
        <header className={cn('flex flex-col gap-sm border-b border-hairline pb-md', className)}>
            <div className="flex flex-wrap items-start justify-between gap-sm">
                <div className="flex min-w-0 flex-col gap-xxs">
                    {english ? (
                        <span className="text-caption font-medium uppercase tracking-[0.14em] text-faint" dir="ltr" lang="en">
                            {english}
                        </span>
                    ) : null}
                    <h1 className="text-display-lg text-ink">{title}</h1>
                    {description ? <p className="mt-xxs max-w-3xl text-body-sm text-muted">{description}</p> : null}
                </div>
                {actions ? (
                    <div className="flex flex-wrap items-center gap-xs" data-erp-print-hide>
                        {actions}
                    </div>
                ) : null}
            </div>
            {answer ? <div className="mt-xxs">{answer}</div> : null}
        </header>
    );
}
