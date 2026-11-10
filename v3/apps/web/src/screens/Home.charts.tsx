import { useId } from 'react';
import {
    Area,
    AreaChart,
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import type { HomeDeptPoint, HomeSeries } from '../lib/home';

/**
 * وحدة الرسوم الكسولة فقط: ألوان رمزية، ومحاور رقمية LTR، وتقليل الحركة.
 * الجداول المطابقة تبقى في Home.tsx ولا تعتمد على نجاح تحميل هذه الوحدة.
 */
export interface HomeChartsProps {
    readonly revenue: HomeSeries;
    readonly net: HomeSeries;
    readonly depts: readonly HomeDeptPoint[];
    readonly deptsTitle: string;
    readonly reducedMotion: boolean;
}

/** لا نسخة لونية خام: بيئة الاختبار/الخادم تستخدم مرجع الرمز نفسه. */
function tokenColor(name: string): string {
    return `var(${name})`;
}

const TICK_SIZE = 10;

export default function HomeCharts({ revenue, net, depts, deptsTitle, reducedMotion }: HomeChartsProps) {
    const gradientId = useId().replace(/:/g, '');
    const primaryColor = tokenColor('--erp-chart-1');
    const brassColor = tokenColor('--erp-chart-2');
    const netColor = tokenColor('--erp-chart-3');
    const axisColor = tokenColor('--erp-muted');
    const gridColor = tokenColor('--erp-hairline');
    const surfaceColor = tokenColor('--erp-surface-raised');
    const inkColor = tokenColor('--erp-ink');
    const deptColors = [
        primaryColor,
        brassColor,
        netColor,
        tokenColor('--erp-chart-4'),
        tokenColor('--erp-chart-5'),
        tokenColor('--erp-chart-6'),
    ];
    const tooltipStyle = {
        direction: 'rtl' as const,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        backgroundColor: surfaceColor,
        color: inkColor,
        border: `1px solid ${gridColor}`,
        borderRadius: 10,
        boxShadow: 'var(--erp-shadow-pop)',
    };
    const tick = { fill: axisColor, fontSize: TICK_SIZE };

    return (
        <div className="home-charts">
            {revenue.points.length > 0 ? (
                <figure className="home-chart home-chart--revenue m-0" aria-label={revenue.title}>
                    <figcaption className="home-chart__caption">
                        <span>{revenue.title}</span>
                        <span className="home-chart__legend">
                            <span>
                                <i aria-hidden="true" />
                                الإيراد
                            </span>
                            <span>
                                <i aria-hidden="true" />
                                التكلفة
                            </span>
                        </span>
                    </figcaption>
                    <div className="home-chart__plot" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <AreaChart data={[...revenue.points]} accessibilityLayer>
                                <defs>
                                    <linearGradient id={`${gradientId}-revenue`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={primaryColor} stopOpacity={0.22} />
                                        <stop offset="100%" stopColor={primaryColor} stopOpacity={0.02} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke={gridColor} strokeDasharray="3 4" vertical={false} />
                                <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={22} />
                                <YAxis orientation="right" tick={tick} tickLine={false} axisLine={false} width={52} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: inkColor }} />
                                <Area
                                    type="monotone"
                                    dataKey="primary"
                                    name="الإيراد"
                                    stroke={primaryColor}
                                    fill={`url(#${gradientId}-revenue)`}
                                    strokeWidth={2.5}
                                    isAnimationActive={!reducedMotion}
                                    dot={revenue.points.length === 1}
                                    activeDot={{ r: 4, strokeWidth: 2 }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="secondary"
                                    name="التكلفة"
                                    stroke={brassColor}
                                    fill={brassColor}
                                    fillOpacity={0.04}
                                    strokeWidth={2}
                                    isAnimationActive={!reducedMotion}
                                    dot={revenue.points.length === 1}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </figure>
            ) : null}

            {net.points.length > 0 ? (
                <figure className="home-chart m-0" aria-label={net.title}>
                    <figcaption className="home-chart__caption">{net.title}</figcaption>
                    <div className="home-chart__plot" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart data={[...net.points]} accessibilityLayer barSize={18}>
                                <CartesianGrid stroke={gridColor} strokeDasharray="3 4" vertical={false} />
                                <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={false} minTickGap={22} />
                                <YAxis orientation="right" tick={tick} tickLine={false} axisLine={false} width={52} />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: inkColor }} />
                                <Bar
                                    dataKey="primary"
                                    name={net.title}
                                    fill={netColor}
                                    radius={[5, 5, 0, 0]}
                                    isAnimationActive={!reducedMotion}
                                />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </figure>
            ) : null}

            {depts.length > 0 ? (
                <figure className="home-chart m-0" aria-label={deptsTitle}>
                    <figcaption className="home-chart__caption">{deptsTitle}</figcaption>
                    <div className="home-chart__plot" dir="ltr">
                        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                            <BarChart data={[...depts]} layout="vertical" accessibilityLayer barSize={14}>
                                <CartesianGrid stroke={gridColor} strokeDasharray="3 4" horizontal={false} />
                                <XAxis type="number" tick={tick} tickLine={false} axisLine={false} />
                                <YAxis
                                    type="category"
                                    dataKey="name"
                                    orientation="right"
                                    width={88}
                                    tick={tick}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: inkColor }} />
                                <Bar
                                    dataKey="value"
                                    name={deptsTitle}
                                    radius={[0, 4, 4, 0]}
                                    isAnimationActive={!reducedMotion}
                                >
                                    {depts.map((entry, index) => (
                                        <Cell
                                            key={`${entry.name}-${String(index)}`}
                                            fill={deptColors[index % deptColors.length] ?? primaryColor}
                                        />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </figure>
            ) : null}
        </div>
    );
}
