import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    XAxis,
    YAxis,
} from 'recharts';
import type { ChartProps } from './Chart';

/**
 * تنفيذ الرسم — الوحدة الوحيدة التي تستورد Recharts (تُحمَّل ديناميكيًا من
 * `Chart.tsx`، فلا تدخل الحزمة الأولية ولا حزمة أي شاشة لا تعرض رسمًا).
 *
 * الألوان عبر أدوات Tailwind المولّدة من رموز `chart-1..6` (أصناف ثابتة كي
 * يلتقطها ماسح Tailwind؛ لا أسماء ديناميكية)، ومحاور/تلميحات عبر CSS في
 * `styles.css` تحت `.erp-chart` فلا قيم لونية في JS.
 */

const FILL_CLASS: Record<number, string> = {
    1: 'fill-chart-1',
    2: 'fill-chart-2',
    3: 'fill-chart-3',
    4: 'fill-chart-4',
    5: 'fill-chart-5',
    6: 'fill-chart-6',
};

const STROKE_CLASS: Record<number, string> = {
    1: 'stroke-chart-1',
    2: 'stroke-chart-2',
    3: 'stroke-chart-3',
    4: 'stroke-chart-4',
    5: 'stroke-chart-5',
    6: 'stroke-chart-6',
};

function chartColorIndex(index: number): number {
    return (index % 6) + 1;
}

function fillClass(index: number): string {
    return FILL_CLASS[chartColorIndex(index)] ?? 'fill-chart-1';
}

function strokeClass(index: number): string {
    return STROKE_CLASS[chartColorIndex(index)] ?? 'stroke-chart-1';
}

// الهوامش الرأسية فقط — حارس RTL يمنع خصائص الاتجاه الفيزيائية في المصدر.
const MARGIN = { top: 8, bottom: 0 };

export default function ChartImpl({ kind, data, xKey, series, height = 240 }: ChartProps) {
    const chartData = [...data];
    const chartSeries = [...series];
    const axes = (
        <>
            <CartesianGrid strokeDasharray="3 3" vertical={false} className="erp-chart-grid" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} className="erp-chart-axis" />
            <YAxis
                width={80}
                tickMargin={8}
                tick={{ style: { direction: 'ltr' } }}
                tickLine={false}
                axisLine={false}
                className="erp-chart-axis"
            />
            <RechartsTooltip />
        </>
    );

    if (kind === 'pie') {
        const valueKey = chartSeries[0]?.key ?? 'value';
        return (
            <ResponsiveContainer width="100%" height={height}>
                {/* الرسم مرئي فقط؛ البديل النصي هو جدول sr-only في Chart.tsx.
                    تعطيل طبقة a11y في Recharts يمنع عناصر قابلة للتركيز داخل aria-hidden (axe aria-hidden-focus). */}
                <PieChart margin={MARGIN} accessibilityLayer={false}>
                    <Pie data={chartData} dataKey={valueKey} nameKey={xKey} outerRadius="72%" strokeWidth={2} rootTabIndex={-1}>
                        {chartData.map((_, index) => (
                            <Cell key={`cell-${String(index)}`} className={fillClass(index)} />
                        ))}
                    </Pie>
                    <RechartsTooltip />
                </PieChart>
            </ResponsiveContainer>
        );
    }

    if (kind === 'bar') {
        return (
            <ResponsiveContainer width="100%" height={height}>
                <BarChart data={chartData} margin={MARGIN} accessibilityLayer={false}>
                    {axes}
                    <Legend />
                    {chartSeries.map((entry, index) => (
                        <Bar key={entry.key} dataKey={entry.key} name={entry.label} className={fillClass(index)} radius={[4, 4, 0, 0]} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        );
    }

    if (kind === 'area') {
        return (
            <ResponsiveContainer width="100%" height={height}>
                <AreaChart data={chartData} margin={MARGIN} accessibilityLayer={false}>
                    {axes}
                    <Legend />
                    {chartSeries.map((entry, index) => (
                        <Area
                            key={entry.key}
                            type="monotone"
                            dataKey={entry.key}
                            name={entry.label}
                            fillOpacity={0.18}
                            className={`${fillClass(index)} ${strokeClass(index)}`}
                            strokeWidth={2}
                            activeDot={false}
                        />
                    ))}
                </AreaChart>
            </ResponsiveContainer>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={height}>
            <LineChart data={chartData} margin={MARGIN} accessibilityLayer={false}>
                {axes}
                <Legend />
                {chartSeries.map((entry, index) => (
                    <Line
                        key={entry.key}
                        type="monotone"
                        dataKey={entry.key}
                        name={entry.label}
                        className={strokeClass(index)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={false}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}
