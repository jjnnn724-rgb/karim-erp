import { StatCard } from './StatCard';
import { cn } from './cn';
import { definedProps } from './definedProps';
import { useCountUp } from '../lib/use-count-up';

/**
 * AnswerStrip — شريط الجواب (نمط توقيعي، 2026-11-21): 1–4 مؤشرات تجيب سؤال
 * الشاشة، تُعرض تحت العنوان قبل أي أدوات. القيم الرقمية تكشف تدريجيًا
 * (count-up عبر useCountUp، ملغى مع prefers-reduced-motion)؛ القيم النصية
 * تُعرض كما هي (عملات/نِسب مُنسّقة من الشاشة).
 *
 * مبني فوق StatCard — وهو `<li>` بذاته، فالشريط `<ul role="list">` يلفّها
 * مباشرة بلا غلاف مزدوج (عقد axe: li لا يتداخل).
 */
export interface AnswerItem {
    label: string;
    english?: string;
    /** رقم ⇒ كشف تدريجي؛ نص ⇒ كما هو (مُنسّق مسبقًا). */
    value: string | number;
    /** مُنسّق العرض للقيم الرقمية أثناء الكشف وبعده (moneyOf مثلًا). */
    format?: (value: number) => string;
    unit?: string;
    hint?: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
    trend?: 'up' | 'down' | 'flat';
    delta?: string;
    loading?: boolean;
}

export interface AnswerStripProps {
    items: ReadonlyArray<AnswerItem>;
    /** عدد الأعمدة في الشبكة — الافتراضي بحسب عدد العناصر (2–4). */
    columns?: 2 | 3 | 4;
    className?: string;
}

const COLUMN_CLASS: Record<2 | 3 | 4, string> = {
    2: 'sm:grid-cols-2',
    3: 'sm:grid-cols-2 lg:grid-cols-3',
    4: 'sm:grid-cols-2 xl:grid-cols-4',
};

function AnswerCard({ item }: { item: AnswerItem }) {
    const isNumber = typeof item.value === 'number' && Number.isFinite(item.value);
    const animated = useCountUp(isNumber ? (item.value as number) : 0);
    const displayValue = isNumber
        ? item.format
            ? item.format(animated)
            : String(Math.round(animated * 100) / 100)
        : item.value;
    return (
        <StatCard
            {...definedProps({
                label: item.label,
                english: item.english,
                value: displayValue,
                unit: item.unit,
                hint: item.hint,
                tone: item.tone,
                trend: item.trend,
                delta: item.delta,
                loading: item.loading,
            })}
        />
    );
}

export function AnswerStrip({ items, columns, className }: AnswerStripProps) {
    const list = items.slice(0, 4);
    const resolvedColumns = columns ?? (list.length <= 2 ? 2 : list.length === 3 ? 3 : 4);
    return (
        <ul
            className={cn('grid list-none gap-sm', COLUMN_CLASS[resolvedColumns], className)}
            aria-label="جواب الشاشة"
            role="list"
            data-testid="answer-strip"
        >
            {list.map((item) => (
                <AnswerCard key={item.label} item={item} />
            ))}
        </ul>
    );
}
