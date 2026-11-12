import { lazy, Suspense, useId } from 'react';
import { cn } from './cn';
import { Skeleton } from './Skeleton';

/**
 * رسم بياني — غلاف كسول لـRecharts (ADR-003: Recharts في chunk مستقل،
 * **لا يدخل الحزمة الأولية**). هذا الملف لا يستورد `recharts` إطلاقًا؛
 * الاستيراد الديناميكي في `chart-impl.tsx` وحده، وهذا ما يحرسه اختبار الوحدة.
 *
 * الوصول (WCAG): الرسم نفسه زخرفي (`aria-hidden`) لأن SVG لا يُقرأ بمعنى،
 * والبديل الحقيقي جدول بيانات مخفي بصريًا يحتوي كل القيم. الألوان من
 * `chart-1..6` عبر أدوات Tailwind فقط (لا قيم خام).
 */

export type ChartKind = 'line' | 'bar' | 'area' | 'pie';

export interface ChartSeries {
    key: string;
    label: string;
}

export type ChartRow = Record<string, string | number>;

export interface ChartProps {
    kind: ChartKind;
    title: string;
    description?: string;
    data: readonly ChartRow[];
    xKey: string;
    series: readonly ChartSeries[];
    height?: number;
    className?: string;
}

const LazyChartImpl = lazy(() => import('./chart-impl'));

function ChartDataTable({
    title,
    xKey,
    series,
    data,
}: {
    title: string;
    xKey: string;
    series: readonly ChartSeries[];
    data: readonly ChartRow[];
}) {
    return (
        <table className="sr-only">
            <caption>{`${title} — جدول البيانات`}</caption>
            <thead>
                <tr>
                    <th scope="col">{xKey}</th>
                    {series.map((entry) => (
                        <th key={entry.key} scope="col">
                            {entry.label}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {data.map((row, index) => (
                    <tr key={`chart-row-${String(index)}`}>
                        <th scope="row">{row[xKey]}</th>
                        {series.map((entry) => (
                            <td key={entry.key}>{row[entry.key]}</td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export function Chart({ kind, title, description, data, xKey, series, height = 240, className }: ChartProps) {
    const titleId = useId();

    return (
        <figure
            aria-labelledby={titleId}
            className={cn('erp-chart flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md shadow-card', className)}
        >
            <figcaption id={titleId} className="flex flex-col gap-xxs">
                <span className="text-heading-sm text-ink">{title}</span>
                {description ? <span className="text-body-sm text-muted">{description}</span> : null}
            </figcaption>
            <Suspense fallback={<Skeleton variant="rect" label={`جارٍ تحميل رسم ${title}`} />}>
                <div aria-hidden="true" className="w-full">
                    <LazyChartImpl kind={kind} title={title} data={data} xKey={xKey} series={series} height={height} />
                </div>
            </Suspense>
            <ChartDataTable title={title} xKey={xKey} series={series} data={data} />
        </figure>
    );
}
