import { cn } from './cn';

/**
 * StatusRail — سكة الحالة (نمط توقيعي، 2026-11-21): دورة العمل تُرى مسارًا
 * لا كلمة ملونة — نقاط المراحل موصولة، المقطع المنقضي ممتلئ بلون النجاح
 * الهادئ، والمرحلة الحالية تتميّز.
 *
 * النص المثبَّت بالاختبارات يبقى بجانب السكة (السكة بصرية مع aria-label
 * يعلن المرحلة) — عقد Dispatches/VegRequests محفوظ حرفيًا.
 */
export interface StatusRailStep {
    key: string;
    label: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

export interface StatusRailProps {
    /** مراحل الدورة بالترتيب — آخر مرحلة مكتملة = `current`. */
    steps: ReadonlyArray<StatusRailStep>;
    /** رقم المرحلة الحالية (0-based)؛ -1 = لم تبدأ. */
    current: number;
    /** مصغّرة داخل خلايا الجداول (نقاط دون نصوص المراحل). */
    compact?: boolean;
    /** نص إعلاني اختياري فوق السكة (المرحلة الحالية بالعربي). */
    label?: string;
    className?: string;
}

const STEP_COLOR: Record<string, string> = {
    neutral: 'bg-muted',
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
    info: 'bg-info',
};

export function StatusRail({ steps, current, compact = false, label, className }: StatusRailProps) {
    const safeCurrent = Math.min(Math.max(current, -1), steps.length - 1);
    const stage = safeCurrent >= 0 ? steps[safeCurrent] : null;
    return (
        <div
            className={cn('flex flex-col gap-xxs', className)}
            role="img"
            aria-label={label ?? (stage ? `المرحلة: ${stage.label}` : 'لم تبدأ الدورة')}
            data-testid={compact ? 'status-rail-compact' : 'status-rail'}
        >
            {label && !compact ? <span className="text-caption text-muted">{label}</span> : null}
            <div className="flex items-center gap-xxs" aria-hidden="true">
                {steps.map((step, index) => {
                    const done = index <= safeCurrent;
                    const isCurrent = index === safeCurrent;
                    return (
                        <span key={step.key} className="inline-flex items-center gap-xxs">
                            <span
                                className={cn(
                                    'inline-block rounded-full transition-[background-color,box-shadow] duration-[var(--erp-motion-fast)]',
                                    compact ? 'size-1.5' : 'size-2.5',
                                    done ? STEP_COLOR[step.tone ?? 'neutral'] : 'bg-hairline-strong',
                                    isCurrent && !compact ? 'ring-2 ring-primary/30' : '',
                                )}
                            />
                            {index < steps.length - 1 ? (
                                <span
                                    className={cn(
                                        'inline-block h-px transition-colors duration-[var(--erp-motion-base)]',
                                        compact ? 'w-2' : 'w-4',
                                        index < safeCurrent ? 'bg-success' : 'bg-hairline-strong',
                                    )}
                                />
                            ) : null}
                        </span>
                    );
                })}
            </div>
            {/* نص المرحلة الحالية يظهر فقط بغياب label الصريح — لا تكرار. */}
            {!compact && !label && stage ? <span className="text-caption text-muted">{stage.label}</span> : null}
        </div>
    );
}
