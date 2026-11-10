import type { ReactNode } from 'react';
import { cn } from './cn';
import { ArrowDownIcon, ArrowFlatIcon, ArrowUpIcon } from './icons';
import { Skeleton } from './Skeleton';

/**
 * بطاقة مؤشّر — DESIGN.md: الرقم أكبر عنصر، التسمية فوقه بخط صغير، والمقارنة
 * شارة تحته. الاتجاه لا يُنقل باللون وحده: سهم + نص نسبة + `aria-label`.
 *
 * `tone` يسمح بفصل الدلالة عن الاتجاه (انخفاض المصروف جيد) — الشارة تحمل
 * نصًّا دائمًا (WCAG 1.4.1).
 */

export type KpiTrend = 'up' | 'down' | 'flat';
export type KpiTone = 'success' | 'danger' | 'warning' | 'neutral' | 'info';

const TONE_CLASS: Record<KpiTone, string> = {
    success: 'border-success/30 bg-success-soft text-success-text',
    danger: 'border-danger/30 bg-danger-soft text-danger-text',
    warning: 'border-warning/30 bg-warning-soft text-warning-text',
    neutral: 'border-neutral/30 bg-neutral-soft text-neutral-text',
    info: 'border-info/30 bg-info-soft text-info-text',
};

const TREND_ICON: Record<KpiTrend, ReactNode> = {
    up: <ArrowUpIcon className="size-3.5" />,
    down: <ArrowDownIcon className="size-3.5" />,
    flat: <ArrowFlatIcon className="size-3.5" />,
};

const TREND_TONE: Record<KpiTrend, KpiTone> = {
    up: 'success',
    down: 'danger',
    flat: 'neutral',
};

const TREND_LABEL: Record<KpiTrend, string> = {
    up: 'ارتفاع',
    down: 'انخفاض',
    flat: 'ثبات',
};

export interface KpiTileProps {
    label: string;
    /** القيمة منسّقة مسبقًا بأرقام لاتينية (DESIGN.md). */
    value: string;
    unit?: string;
    delta?: string;
    trend?: KpiTrend;
    tone?: KpiTone;
    hint?: string;
    icon?: ReactNode;
    loading?: boolean;
    className?: string;
}

export function KpiTile({
    label,
    value,
    unit,
    delta,
    trend,
    tone,
    hint,
    icon,
    loading = false,
    className,
}: KpiTileProps) {
    const badgeTone = tone ?? (trend ? TREND_TONE[trend] : undefined);

    return (
        <div className={cn('flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md shadow-card', className)}>
            <div className="flex items-start justify-between gap-sm">
                <p className="text-label-md text-muted">{label}</p>
                {icon ? (
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-brass/15 text-brass-text" aria-hidden="true">
                        {icon}
                    </span>
                ) : null}
            </div>
            {loading ? (
                <Skeleton variant="rect" className="h-9" label={`جارٍ تحميل ${label}`} />
            ) : (
                <p className="text-display-lg font-semibold tabular-nums text-ink">
                    <span className="erp-numeric">{value}</span>
                    {unit ? <span className="ms-xxs text-body-md font-medium text-muted">{unit}</span> : null}
                </p>
            )}
            {delta && badgeTone ? (
                <span
                    className={cn(
                        'inline-flex w-fit items-center gap-xxs rounded-full border px-2 py-0.5 text-body-sm',
                        TONE_CLASS[badgeTone],
                    )}
                    aria-label={`${trend ? TREND_LABEL[trend] : 'تغيّر'}: ${delta}`}
                >
                    {trend ? <span aria-hidden="true">{TREND_ICON[trend]}</span> : null}
                    <span className="erp-numeric">{delta}</span>
                </span>
            ) : null}
            {hint ? <p className="text-caption text-faint">{hint}</p> : null}
        </div>
    );
}
