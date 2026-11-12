import { useQuery } from '@tanstack/react-query';
import type { LinkProps } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { Component, lazy, type ReactNode, Suspense, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { Card, StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import { fetchHomeSnapshot, type HomeDeptPoint, type HomeKpi, type HomeSeries, quickActionsForRole } from '../lib/home';
import { useAllowedMenus } from '../lib/my-menus';
import { HOME_TITLE } from '../lib/navigation';
import { type PageStatus, useDocumentMeta, usePageStatusReporter } from '../lib/page-meta';
import { type DisplayTone, errorMessage, todayIso } from '../lib/reporting';
import { enabledScreens } from '../lib/screens';
import { roleLabel } from '../lib/users';
import { Button } from '../ui/Button';
import { AlertCircleIcon, ChevronEndIcon, InfoIcon } from '../ui/icons';
import { StatCard } from '../ui/StatCard';
import './home-premium.css';

/**
 * الرئيسية: مؤشرات من العقود القائمة فقط، وإجراءات حسب الدور والشاشات المفعّلة.
 * تبقى الرسوم في وحدة كسولة، والجداول مستقلة عنها حتى عند فشل تحميلها.
 * لكل مصدر حالات التحميل والخطأ والفراغ نفسها؛ لا تُستبدل البيانات المفقودة بأصفار.
 */
const HomeCharts = lazy(() => import('./Home.charts'));

const TONE_CLASS: Record<DisplayTone, string> = {
    neutral: 'text-ink',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
};

function usePrefersReducedMotion(): boolean {
    const [reduced, setReduced] = useState(() => {
        try {
            return typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
        } catch {
            return false;
        }
    });
    useEffect(() => {
        try {
            if (typeof window.matchMedia !== 'function') {
                return;
            }
            const media = window.matchMedia('(prefers-reduced-motion: reduce)');
            const onChange = () => {
                setReduced(media.matches);
            };
            media.addEventListener('change', onChange);
            return () => {
                media.removeEventListener('change', onChange);
            };
        } catch {
            return;
        }
    }, []);
    return reduced;
}

function HomeKpiTile({ kpi }: { kpi: HomeKpi }) {
    return (
        <StatCard
            label={kpi.label}
            english={kpi.english}
            value={kpi.value}
            hint={kpi.hint}
            tone={kpi.tone}
            {...(kpi.trend ? { trend: kpi.trend.direction, delta: kpi.trend.label } : {})}
        />
    );
}

function SectionHeading({ title, english, description }: { title: string; english: string; description?: string }) {
    return (
        <div className="home-section-heading">
            <div>
                <h2>{title}</h2>
                {description ? <p>{description}</p> : null}
            </div>
            <span className="home-section-heading__english" dir="ltr" lang="en">
                {english}
            </span>
        </div>
    );
}

function ChartSkeleton() {
    return (
        <div className="home-chart-skeleton" aria-busy="true">
            <StateLoading label="جارٍ تحميل الرسوم…" />
            <div aria-hidden="true" className="h-56 w-full rounded-md bg-surface-sunken motion-safe:animate-pulse" />
            <div aria-hidden="true" className="h-48 w-full rounded-md bg-surface-sunken motion-safe:animate-pulse" />
        </div>
    );
}

/** فشل وحدة Recharts لا يُسقط الصفحة ولا يُخفي الجداول البديلة. */
class ChartBoundary extends Component<{ readonly children: ReactNode; readonly fallback: ReactNode }, { failed: boolean }> {
    override state = { failed: false };

    static getDerivedStateFromError() {
        return { failed: true };
    }

    override render() {
        return this.state.failed ? this.props.fallback : this.props.children;
    }
}

function HomeSkeleton() {
    return (
        <div aria-busy="true" className="home-loading">
            <StateLoading label="جارٍ تحميل الصفحة الرئيسية…" />
            <ul aria-hidden="true" className="home-kpis">
                {Array.from({ length: 8 }, (_, index) => (
                    <li key={`home-skeleton-${String(index)}`} className="erp-kpi motion-safe:animate-pulse">
                        <span className="block h-3 w-1/2 rounded-sm bg-surface-sunken" />
                        <span className="mt-sm block h-6 w-2/3 rounded-sm bg-surface-sunken" />
                        <span className="mt-sm block h-2 w-3/4 rounded-sm bg-surface-sunken" />
                    </li>
                ))}
            </ul>
            <div aria-hidden="true" className="h-48 rounded-lg border border-hairline bg-surface motion-safe:animate-pulse" />
        </div>
    );
}

function RevenueTable({ series }: { series: HomeSeries }) {
    if (series.points.length === 0) {
        return null;
    }
    return (
        <section className="home-data-section">
            <h3>{series.title}</h3>
            <TableScroll label={`${series.title} — بيانات الرسم نفسه`}>
                <table className="home-data-table">
                    <caption className="sr-only">{`${series.title} — بيانات الرسم نفسه`}</caption>
                    <thead>
                        <tr>
                            <th scope="col">اليوم</th>
                            <th scope="col">الإيراد</th>
                            <th scope="col">التكلفة</th>
                        </tr>
                    </thead>
                    <tbody>
                        {series.points.map((point, index) => (
                            <tr key={`${point.label}-${String(index)}`}>
                                <td className="erp-numeric" dir="ltr">
                                    {point.label || '—'}
                                </td>
                                <td className="erp-numeric" dir="ltr">
                                    {point.primary.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                </td>
                                <td className="erp-numeric" dir="ltr">
                                    {point.secondary.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableScroll>
        </section>
    );
}

function NetTable({ series }: { series: HomeSeries }) {
    if (series.points.length === 0) {
        return null;
    }
    return (
        <section className="home-data-section">
            <h3>{series.title}</h3>
            <TableScroll label={`${series.title} — بيانات الرسم نفسه`}>
                <table className="home-data-table">
                    <caption className="sr-only">{`${series.title} — بيانات الرسم نفسه`}</caption>
                    <thead>
                        <tr>
                            <th scope="col">اليوم</th>
                            <th scope="col">القيمة</th>
                        </tr>
                    </thead>
                    <tbody>
                        {series.points.map((point, index) => (
                            <tr key={`${point.label}-${String(index)}`}>
                                <td className="erp-numeric" dir="ltr">
                                    {point.label || '—'}
                                </td>
                                <td className="erp-numeric" dir="ltr">
                                    {point.primary.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </TableScroll>
        </section>
    );
}

function DepartmentsTable({ title, depts }: { title: string; depts: readonly HomeDeptPoint[] }) {
    if (depts.length === 0) {
        return null;
    }
    return (
        <section className="home-data-section">
            <h3>{title}</h3>
            <ul className="home-dept-data">
                {depts.map((entry, index) => (
                    <li key={`${entry.name}-${String(index)}`}>
                        <span>{entry.name}</span>
                        <span className="erp-numeric" dir="ltr">
                            {entry.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export function Home() {
    const auth = useAuthState();
    const reducedMotion = usePrefersReducedMotion();
    const role = auth.user?.role ?? '';
    const snapshot = useQuery({
        queryKey: ['home', 'snapshot', role],
        queryFn: ({ signal }) => fetchHomeSnapshot(role, signal),
        // لا نطلب قبل معرفة الدور: مصادر KPI مقيّدة بالأدوار، والطلب قبلها 403 متوقَّع.
        enabled: role !== '',
    });

    const data = snapshot.data;
    const status: PageStatus = snapshot.isPending
        ? 'loading'
        : snapshot.isError
          ? 'error'
          : data && data.kpis.length > 0
            ? 'success'
            : 'idle';
    usePageStatusReporter(status);
    useDocumentMeta(HOME_TITLE);

    const name = auth.user?.name ?? '';
    const roleText = roleLabel(role).label;
    const screens = enabledScreens();
    const allowedMenus = useAllowedMenus();
    const quickActions = quickActionsForRole(role, screens, allowedMenus);
    const greeting = name ? `مرحبًا، ${name}` : 'مرحبًا';

    const hasCharts = Boolean(data && (data.revenueSeries.points.length > 1 || data.netSeries.points.length > 1 || data.depts.length > 0));

    return (
        <div className="home-premium">
            <div className="home-hero">
                <div className="home-hero__intro">
                    <span className="home-hero__eyebrow">مساحة العمل</span>
                    <PageHeader
                        title={greeting}
                        english="Home"
                        description={`${roleText} · ${todayIso()}`}
                        actions={
                            <Button
                                variant="secondary"
                                className="home-refresh"
                                loading={snapshot.isFetching}
                                disabled={snapshot.isFetching}
                                onClick={() => {
                                    void snapshot.refetch();
                                }}
                            >
                                {snapshot.isFetching ? 'جارٍ التحديث…' : 'تحديث'}
                            </Button>
                        }
                    />
                    <p className="home-hero__description">مؤشراتك، نشاطاتك وإجراءاتك في مكان واحد.</p>
                </div>
                <div className="home-hero__motif" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                </div>
            </div>

            {snapshot.isPending ? <HomeSkeleton /> : null}
            {snapshot.isError ? (
                <StateError
                    message={errorMessage(snapshot.error)}
                    onRetry={() => {
                        void snapshot.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    {data.failures.length > 0 && data.kpis.length > 0 ? (
                        <p role="status" className="home-partial-notice">
                            <InfoIcon className="size-4 shrink-0" />
                            <span>تعذّر جلب بعض المصادر: {data.failures.join(' · ')} — عُرضت البيانات المتاحة.</span>
                        </p>
                    ) : null}

                    {data.kpis.length > 0 ? (
                        <section aria-label="مؤشرات الأداء" className="home-overview">
                            <SectionHeading title="مؤشرات الأداء" english="Overview" />
                            <ul className="home-kpis">
                                {data.kpis.map((kpi) => (
                                    <HomeKpiTile key={kpi.id} kpi={kpi} />
                                ))}
                            </ul>
                        </section>
                    ) : data.failures.length > 0 ? (
                        <StateError
                            message={data.failures.join(' · ')}
                            onRetry={() => {
                                void snapshot.refetch();
                            }}
                        />
                    ) : (
                        <StateEmpty title="لا بيانات متاحة لهذا الدور بعد" hint="لا مؤشرات مسجّلة لهذا الحساب بعد." />
                    )}

                    {quickActions.length > 0 ? (
                        <Card className="home-panel home-actions">
                            <SectionHeading title="إجراءات سريعة" english="Quick actions" />
                            <ul className="home-actions__list">
                                {quickActions.map((action) => (
                                    <li key={action.to}>
                                        <Link to={action.to as NonNullable<LinkProps['to']>} className="home-action">
                                            <span>{action.label}</span>
                                            <ChevronEndIcon className="home-action__arrow size-4" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    ) : null}

                    <div className={`home-workspace${hasCharts ? '' : ' home-workspace--no-charts'}`}>
                        {hasCharts ? (
                            <Card className="home-panel home-analytics">
                                <SectionHeading title="الرسوم والاتجاهات" english="Charts" />
                                <div className="home-analytics__body">
                                    {reducedMotion ? (
                                        <p className="home-chart-note">
                                            حركة الرسوم معطّلة احترامًا لتفضيل تقليل الحركة — والجداول تحمل الأرقام نفسها.
                                        </p>
                                    ) : null}
                                    <Suspense fallback={<ChartSkeleton />}>
                                        <ChartBoundary
                                            fallback={
                                                <p role="status" className="home-chart-note">
                                                    تعذّر عرض الرسوم البيانية — الجداول أدناه تحمل الأرقام نفسها.
                                                </p>
                                            }
                                        >
                                            <HomeCharts
                                                revenue={data.revenueSeries}
                                                net={data.netSeries}
                                                depts={data.depts}
                                                deptsTitle={data.deptsTitle}
                                                reducedMotion={reducedMotion}
                                            />
                                        </ChartBoundary>
                                    </Suspense>
                                    <div className="home-data-alternative">
                                        <p className="home-data-alternative__label">
                                            بيانات الرسوم <span>الأرقام نفسها، في عرض نصّي</span>
                                        </p>
                                        <div className="home-data-grid">
                                            <RevenueTable series={data.revenueSeries} />
                                            <NetTable series={data.netSeries} />
                                            <DepartmentsTable title={data.deptsTitle} depts={data.depts} />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        ) : null}

                        <div className="home-feed">
                            <Card className="home-panel home-activity">
                                <SectionHeading title="آخر النشاطات" english="Recent activity" />
                                {data.activity.length === 0 ? (
                                    <StateEmpty title="لا نشاطات حديثة" hint="لا نشاطات مسجّلة بعد." />
                                ) : (
                                    <ul className="home-activity__list">
                                        {data.activity.map((row) => (
                                            <li key={row.id} className="home-activity__row" data-kind={row.kind}>
                                                <span className="home-activity__marker" aria-hidden="true">
                                                    {row.kind === 'revenue' ? '↙' : '↗'}
                                                </span>
                                                <div className="home-activity__content">
                                                    <p className="home-activity__detail">{row.detail}</p>
                                                    <p className="home-activity__meta">
                                                        {row.title} ·{' '}
                                                        <span className="erp-numeric" dir="ltr">
                                                            {row.date}
                                                        </span>
                                                    </p>
                                                    <p
                                                        className={`erp-numeric home-activity__amount ${row.kind === 'revenue' ? 'text-success-text' : 'text-danger-text'}`}
                                                        dir="ltr"
                                                    >
                                                        {row.amount}
                                                    </p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </Card>

                            {data.alerts.length > 0 ? (
                                <Card className="home-panel home-alerts">
                                    <SectionHeading title="تنبيهات" english="Alerts" />
                                    <ul className="home-alerts__list">
                                        {data.alerts.map((alert) => (
                                            <li key={alert.id} className="home-alert" data-tone={alert.tone}>
                                                <AlertCircleIcon className={`home-alert__icon size-4 ${TONE_CLASS[alert.tone]}`} />
                                                <div>
                                                    <p className={`home-alert__title ${TONE_CLASS[alert.tone]}`}>
                                                        {alert.title} · {alert.severity}
                                                    </p>
                                                    <p className="home-alert__detail">{alert.detail}</p>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                </Card>
                            ) : null}
                        </div>
                    </div>

                    <p className="home-source" role="status">
                        <InfoIcon className="size-4 shrink-0" />
                        <span>المصدر الأساسي: {data.basis}</span>
                    </p>
                </>
            ) : null}
        </div>
    );
}
