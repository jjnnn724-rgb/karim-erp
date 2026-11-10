import { Skeleton as ShadcnSkeleton } from '@/components/ui/skeleton';
import { cn } from './cn';

/**
 * هيكل عظمي — فوق **shadcn/ui** (`@/components/ui/skeleton`)، CLS = 0 (DESIGN.md):
 * الشكل يُحجز بنفس ارتفاع المحتوى القادم.
 *
 * زخرفي دائمًا (`aria-hidden`)؛ الإعلان للمساعدات يأتي من `label` عبر عنصر
 * `role="status"` مخفي بصريًا، فيُقرأ مرة واحدة بلا إزعاج. اللمعة في
 * `styles.css` وتتوقف تحت `prefers-reduced-motion`.
 */

export type SkeletonVariant = 'text' | 'rect' | 'circle';

export interface SkeletonProps {
    variant?: SkeletonVariant;
    /** عدد الأسطر (variant="text" فقط). */
    lines?: number;
    /** نصّ بديل لقارئ الشاشة — يعلن أن هناك تحميلًا. */
    label?: string;
    className?: string;
}

const SHAPE_CLASS: Record<SkeletonVariant, string> = {
    text: 'h-3 w-full rounded-sm',
    rect: 'h-24 w-full rounded-md',
    circle: 'size-10 rounded-full',
};

export function Skeleton({ variant = 'text', lines = 1, label, className }: SkeletonProps) {
    const count = variant === 'text' ? Math.max(1, lines) : 1;

    return (
        <div className={cn('flex flex-col gap-xs', className)}>
            {label ? (
                <span role="status" className="sr-only">
                    {label}
                </span>
            ) : null}
            <div aria-hidden="true" className="flex flex-col gap-xs">
                {Array.from({ length: count }, (_, index) => (
                    <ShadcnSkeleton
                        key={`skeleton-${String(index)}`}
                        className={cn('erp-skeleton block animate-pulse bg-accent', SHAPE_CLASS[variant], index > 0 && variant === 'text' && 'w-4/5')}
                    />
                ))}
            </div>
        </div>
    );
}
