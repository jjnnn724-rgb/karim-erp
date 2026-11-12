import type { ReactNode } from 'react';
import { cn } from './cn';
import { ArrowDownIcon, ArrowFlatIcon, ArrowUpIcon } from './icons';
import { Skeleton } from './Skeleton';

/**
 * بطاقة مؤشّر — DESIGN.md: الرقم أكبر عنصر، التسمية فوقه بخط صغير، والمقارنة
 * شارة تحته. الاتجاه لا يُنقل باللون وحده: سهم + نص نسبة + نص مخفي بصريًا
 * يقرأه قارئ الشاشة (لا `aria-label` على عنصر محايد).
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
        <div
            data-slot="kpi-tile"
            className={cn('flex flex-col gap-xs rounded-xl border border-hairline bg-surface p-4 shadow-sm', className)}
        >
            <div className="flex items-start justify-between gap-sm">
                <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="truncate text-caption font-medium text-muted">{label}</p>
                    {loading ? (
                        <Skeleton variant="rect" className="h-8" label={`جارٍ تحميل ${label}`} />
                    ) : (
                        <p className="text-heading-lg font-bold leading-tight text-ink">
                            <span className="erp-numeric tabular-nums">{value}</span>
                            {unit ? <span className="ms-1.5 text-body-sm font-medium text-muted">{unit}</span> : null}
                        </p>
                    )}
                </div>
                {icon ? (
                    <span
                        className="grid size-8 shrink-0 place-items-center rounded-lg bg-brass/15 text-brass-text"
                        aria-hidden="true"
                    >
                        {icon}
                    </span>
                ) : null}
            </div>
            {delta && badgeTone ? (
                <span
                    data-slot="kpi-badge"
                    className={cn(
                        'inline-flex w-fit items-center gap-xxs rounded-full border px-2 py-0.5 text-caption',
                        TONE_CLASS[badgeTone],
                    )}
                >
                    <span className="sr-only">{trend ? TREND_LABEL[trend] : 'تغيّر'}:</span>
                    {trend ? <span aria-hidden="true">{TREND_ICON[trend]}</span> : null}
                    <span className="erp-numeric tabular-nums" dir="ltr">
                        {delta}
                    </span>
                </span>
            ) : null}
            {hint ? <p className="text-caption text-faint">{hint}</p> : null}
        </div>
    );
}
