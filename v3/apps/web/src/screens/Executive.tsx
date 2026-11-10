import './Executive.premium.css';
import { useQuery } from '@tanstack/react-query';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    alertTone,
    buildExecutiveKpis,
    fetchExecutiveSummary,
    severityLabel,
} from '../lib/executive';
import { errorMessage, intOf, moneyOf, num, qtyOf, textOf } from '../lib/reporting';

/**
 * الموجز التنفيذي — قراءة واحدة من `/api/executive/summary` (admin|owner).
 * لا جمع ولا إعادة حساب: كل رقم يصل جاهزًا من الخادم، والواجهة تعرضه فقط.
 */

const TONE_CLASS = {
    neutral: 'text-muted',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
} as const;

export function Executive() {
    const summary = useQuery({
        queryKey: ['executive', 'summary', 14],
        queryFn: ({ signal }) => fetchExecutiveSummary(14, signal),
    });

    const payload = summary.data;
    const kpis = payload ? buildExecutiveKpis(payload) : [];
    const series = (payload?.series ?? []).slice(-14);
    const departments = payload?.topDepts ?? [];
    const items = payload?.topItems ?? [];
    const cash = payload?.cash ?? [];
    const alerts = payload?.alerts ?? [];

    return (
        <div className="flex flex-col gap-md premium-screen premium-executive">
            <ReportHeader
                title="الموجز التنفيذي"
                english="Executive Summary"
                description="مبيعات اليوم وتكلفتها وصافيها ونقد الدفاتر والإنذارات — من دفتر القيود المُرحَّل، في قراءة واحدة."
                pending={summary.isFetching}
                onRefresh={() => {
                    void summary.refetch();
                }}
            />
            <div className="flex justify-end gap-xs" data-erp-print-hide>
                <PrintActions title="الموجز التنفيذي" />
            </div>

            {summary.isPending ? <StateLoading label="جارٍ تحميل الموجز التنفيذي…" /> : null}

            {summary.isError ? (
                <StateError
                    message={errorMessage(summary.error)}
                    onRetry={() => {
                        void summary.refetch();
                    }}
                />
            ) : null}

            {payload ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الموجز التنفيذي">
                        {kpis.map((kpi) => (
                            <KpiCard
                                key={kpi.id}
                                label={kpi.label}
                                english={kpi.english}
                                value={kpi.value}
                                hint={kpi.hint}
                                tone={kpi.tone}
                            />
                        ))}
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="حركة الفترة" english={textOf(payload.day) || 'Trend'}>
                            {series.length === 0 ? (
                                <p className="p-sm text-body-sm text-muted">لا قيود مُرحَّلة في الفترة المعروضة.</p>
                            ) : (
                                <TableScroll label="جدول حركة الإيراد والتكلفة والصافي">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    اليوم
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الإيراد
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    التكلفة
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصافي
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {series.map((row) => (
                                                <tr
                                                    key={textOf(row.day)}
                                                    className="border-b border-hairline hover:bg-surface-hover"
                                                >
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {textOf(row.day).slice(0, 10)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(row.revenue)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(row.cost)}
                                                    </td>
                                                    <td
                                                        className={`erp-numeric px-sm py-xxs ${
                                                            num(row.net) < 0 ? 'text-danger-text' : 'text-ink'
                                                        }`}
                                                        dir="ltr"
                                                    >
                                                        {moneyOf(row.net)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>

                        <SectionCard title="الإيراد حسب القسم" english="Revenue by department">
                            {departments.length === 0 ? (
                                <p className="p-sm text-body-sm text-muted">لا إيراد أقسام مسجل اليوم.</p>
                            ) : (
                                <ul className="flex flex-col gap-xxs p-sm" aria-label="إيراد الأقسام">
                                    {departments.map((dept, index) => (
                                        <li
                                            key={`${textOf(dept.name)}-${String(index)}`}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className="text-ink">{textOf(dept.name) || '—'}</span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(dept.total)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>
                    </div>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="الأعلى مبيعًا" english="Top items">
                            {items.length === 0 ? (
                                <p className="p-sm text-body-sm text-muted">لا فواتير نقطة بيع اليوم.</p>
                            ) : (
                                <TableScroll label="جدول الأصناف الأعلى مبيعًا">
                                    <table className="w-full border-collapse text-body-md">
                                        <thead>
                                            <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصنف
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الكمية
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    القيمة
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {items.map((item, index) => (
                                                <tr
                                                    key={`${textOf(item.name)}-${String(index)}`}
                                                    className="border-b border-hairline"
                                                >
                                                    <td className="px-sm py-xxs text-ink">{textOf(item.name) || '—'}</td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(item.qty)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(item.total)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>

                        <SectionCard title="أرصدة النقد" english="Cash accounts">
                            {cash.length === 0 ? (
                                <p className="p-sm text-body-sm text-muted">لا حسابات نقد في الدليل.</p>
                            ) : (
                                <ul className="flex flex-col gap-xxs p-sm" aria-label="أرصدة حسابات النقد">
                                    {cash.map((row) => (
                                        <li
                                            key={textOf(row.code)}
                                            className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                        >
                                            <span className="text-ink">
                                                {textOf(row.name) || textOf(row.code) || '—'}{' '}
                                                {row.code ? (
                                                    <span className="text-caption text-faint" dir="ltr">
                                                        ({textOf(row.code)})
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(row.balance)}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCard>
                    </div>

                    <Card>
                        <div className="border-b border-hairline px-sm py-xs">
                            <h2 className="text-heading-md text-ink">
                                الإنذارات{' '}
                                <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                    Alerts
                                </span>
                            </h2>
                        </div>
                        {alerts.length === 0 ? (
                            <StateEmpty title="لا إنذارات مفتوحة" hint="كل ما يقيسه الخادم داخل الحدود الآن." />
                        ) : (
                            <ul className="flex list-none flex-col gap-xs p-sm">
                                {alerts.map((alert, index) => (
                                    <li
                                        key={`${textOf(alert.title)}-${String(index)}`}
                                        className="rounded-md border border-hairline bg-surface-sunken p-sm"
                                    >
                                        <p
                                            className={`text-body-md font-medium ${
                                                TONE_CLASS[alertTone(textOf(alert.severity))]
                                            }`}
                                        >
                                            {severityLabel(textOf(alert.severity))} · {textOf(alert.title) || 'تنبيه'}
                                        </p>
                                        <p className="mt-xxs text-body-sm text-muted">{textOf(alert.detail)}</p>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <p className="text-caption text-muted" role="status">
                        {`قيود اليوم: ${intOf(payload.postedToday)} · ${String(series.length)} يومًا في السلسلة`}
                    </p>
                </>
            ) : null}

            {summary.isPending ? (
                <Card>
                    <TableSkeleton rows={4} columns={4} />
                </Card>
            ) : null}
        </div>
    );
}
