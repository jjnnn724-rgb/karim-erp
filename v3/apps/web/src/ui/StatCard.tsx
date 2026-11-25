import type { ReactNode } from 'react';
import { cn } from './cn';
import { Skeleton } from './Skeleton';

/**
 * بطاقة إحصائية موحدة — **المصدر الوحيد** لشكل المؤشرات في V3.
 * تعرض قيمة رئيسية مع تسمية عربية/إنجليزية، نغمة لونية، اتجاهًا نصيًا،
 * شارة سياقية (نسبة/حصة)، وتلميحًا. أي شاشة تحتاج مؤشرًا تستخدمها بدل
 * نسخة محلية، فيبقى الارتفاع والأبعاد والطباعة واحدة عبر النظام.
 *
 * الحالات: idle / loading / empty / error — كلها داخل البطاقة نفسها
 * حتى لا يقفز الارتفاع بين الحالات (CLS = 0).
 *
 * RTL آمن: الأرقام لاتينية دائمًا (`erp-numeric`)، والتسمية عربية.
 */
export interface StatCardProps {
    label: string;
    english?: string;
    value: string | number;
    /** وحدة صغيرة تُعرض بجانب الرقم (SAR، ساعة…) بدل دمجها في القيمة. */
    unit?: string;
    hint?: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
    trend?: 'up' | 'down' | 'flat';
    delta?: string;
    /** شارة سياقية أعلى البطاقة — نسبة مساهمة أو حصة. */
    badge?: { text: string; aria?: string };
    icon?: ReactNode;
    loading?: boolean;
    empty?: boolean;
    error?: boolean;
    errorMessage?: string;
    onRetry?: () => void;
    className?: string;
}

const TONE_CLASS: Record<string, string> = {
    neutral: 'text-ink',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
    info: 'text-brand-text',
};

const TREND_GLYPH: Record<'up' | 'down' | 'flat', string> = {
    up: '↑',
    down: '↓',
    flat: '→',
};

const TREND_CLASS: Record<'up' | 'down' | 'flat', string> = {
    up: 'text-success-text',
    down: 'text-danger-text',
    flat: 'text-muted',
};

export function StatCard({
    label,
    english,
    value,
    unit,
    hint,
    tone = 'neutral',
    trend,
    delta,
    badge,
    icon,
    loading = false,
    empty = false,
    error = false,
    errorMessage,
    onRetry,
    className,
}: StatCardProps) {
    return (
        <li className={cn('min-w-0', className)}>
            <div className="erp-kpi" data-tone={tone} aria-busy={loading || undefined}>
                <div className="erp-kpi__head">
                    <p className="erp-kpi__label">
                        {label}{' '}
                        {english ? (
                            <span className="erp-kpi__english" dir="ltr" lang="en">
                                {english}
                            </span>
                        ) : null}
                    </p>
                    {badge ? (
                        <span className="erp-kpi__badge" title={badge.aria}>
                            {badge.text}
                        </span>
                    ) : icon ? (
                        <span className="erp-kpi__icon" aria-hidden="true">
                            {icon}
                        </span>
                    ) : null}
                </div>

                {loading ? (
                    <Skeleton variant="rect" className="erp-kpi__skeleton h-8 w-3/4" label={`جارٍ تحميل ${label}`} />
                ) : empty ? (
                    <p className="erp-kpi__value erp-kpi__value--empty">لا بيانات</p>
                ) : error ? (
                    <div className="erp-kpi__error">
                        <p className="text-body-sm text-danger-text">{errorMessage || 'تعذّر تحميل البيانات'}</p>
                        {onRetry ? (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="mt-xs rounded-md border border-hairline-strong bg-surface px-sm py-xs text-button-sm text-ink hover:bg-surface-hover"
                            >
                                إعادة المحاولة
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <p className={cn('erp-numeric erp-kpi__value', TONE_CLASS[tone])} dir="ltr">
                        {value}
                        {unit ? <span className="erp-kpi__unit">{unit}</span> : null}
                    </p>
                )}

                {trend && delta ? (
                    <p className={`erp-kpi__trend ${TREND_CLASS[trend]}`}>
                        <span aria-hidden="true">{TREND_GLYPH[trend]}</span> {delta}
                    </p>
                ) : null}
                {hint ? <p className="erp-kpi__hint">{hint}</p> : null}
            </div>
        </li>
    );
}
