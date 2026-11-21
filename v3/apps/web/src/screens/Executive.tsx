import './Executive.premium.css';
import { ScreenHero } from '../ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KpiCard, SectionCard } from '../components/Reports';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { fetchJson } from '../lib/api';
import { getAccessToken, useAuthState } from '../lib/auth';
import {
    type BriefingResponse,
    briefingResponseSchema,
    type PosStatsResponse,
    parseNumericVal,
    posStatsResponseSchema,
} from '../lib/briefing';
import { formatCurrency, formatInt } from '../lib/format';
import { alertTone, buildExecutiveKpis, fetchExecutiveSummary, severityLabel } from '../lib/executive';
import { errorMessage, intOf, moneyOf, num, qtyOf, textOf } from '../lib/reporting';
import { StatCard } from '../ui/StatCard';

/**
 * الموجز التنفيذي — صفحة واحدة بتابين (دمج 2026-11-20، قرار المالك):
 *  • «محاسبي»: قراءة `/api/executive/summary` (admin|owner) — دفتر القيود المُرحَّل.
 *  • «تشغيلي»: قراءة `/api/manager/briefing` (admin|manager) — مبيعات اليوم
 *    والمصروفات والنواقص (موجز المدير السابق؛ شاشته المستقلة أُزيلت لأن
 *    «الرئيسية» تعرضه حسب الدور أصلًا).
 * لا جمع ولا إعادة حساب: كل رقم يصل جاهزًا من الخادم، والواجهة تعرضه فقط.
 */

type ExecutiveTab = 'accounting' | 'operational';

const TONE_CLASS = {
    neutral: 'text-muted',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
} as const;

export function Executive() {
    const auth = useAuthState();
    const role = auth.user?.role ?? '';
    // admin/owner يران معًا؛ manager التشغيلي فقط؛ بلا جلسة (معاينة/اختبار) الاثنان.
    const canAccounting = role === '' || role === 'admin' || role === 'owner';
    const canOperational = role === '' || role === 'admin' || role === 'owner' || role === 'manager';
    const [tab, setTab] = useState<ExecutiveTab>(canAccounting ? 'accounting' : 'operational');
    const activeTab: ExecutiveTab = canAccounting ? tab : 'operational';

    return (
        <div className="flex flex-col gap-md premium-screen premium-executive">
<ScreenHero
                title="الموجز التنفيذي"
                english="Executive Summary"
                description="تاب المحاسبي من دفتر القيود المُرحَّل، وتاب التشغيلي من موجز المدير: مبيعات اليوم والمصروفات والنواقص — في صفحة واحدة."
                actions={
                    <>
                        <button
                            type="button"
                            onClick={() => { () => {
                    window.location.reload();
                } }}
                            disabled={false}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            تحديث
                        </button>
                    </>
                }
            />

            {canAccounting && canOperational ? (
                <div role="tablist" aria-label="تبويبات الموجز التنفيذي" className="flex gap-xs border-b border-hairline px-sm" data-erp-print-hide>
                    <button
                        type="button"
                        role="tab"
                        id="executive-tab-accounting"
                        aria-selected={activeTab === 'accounting'}
                        aria-controls="executive-panel-accounting"
                        onClick={() => {
                            setTab('accounting');
                        }}
                        className={`rounded-t-md px-md py-xs text-button-md ${
                            activeTab === 'accounting'
                                ? 'border-b-2 border-primary font-medium text-primary'
                                : 'text-muted hover:bg-surface-hover hover:text-ink'
                        }`}
                    >
                        المحاسبي
                    </button>
                    <button
                        type="button"
                        role="tab"
                        id="executive-tab-operational"
                        aria-selected={activeTab === 'operational'}
                        aria-controls="executive-panel-operational"
                        onClick={() => {
                            setTab('operational');
                        }}
                        className={`rounded-t-md px-md py-xs text-button-md ${
                            activeTab === 'operational'
                                ? 'border-b-2 border-primary font-medium text-primary'
                                : 'text-muted hover:bg-surface-hover hover:text-ink'
                        }`}
                    >
                        التشغيلي
                    </button>
                </div>
            ) : null}

            {activeTab === 'accounting' && canAccounting ? (
                <div
                    role="tabpanel"
                    id="executive-panel-accounting"
                    aria-labelledby="executive-tab-accounting"
                    className="flex flex-col gap-md"
                >
                    <AccountingBrief />
                </div>
            ) : null}

            {activeTab === 'operational' && canOperational ? (
                <div
                    role="tabpanel"
                    id="executive-panel-operational"
                    aria-labelledby="executive-tab-operational"
                    className="flex flex-col gap-md"
                >
                    <OperationalBrief />
                </div>
            ) : null}
        </div>
    );
}

/* ─── التاب المحاسبي — دفتر القيود المُرحَّل ─────────────────────────────── */

function AccountingBrief() {
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
        <>
            <div className="flex justify-end gap-xs" data-erp-print-hide>
            </div>

            {summary.isPending ? <StateLoading label="جارٍ تحميل الموجز المحاسبي…" /> : null}

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
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الموجز المحاسبي">
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
                                                <tr key={textOf(row.day)} className="border-b border-hairline hover:bg-surface-hover">
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
                                                <tr key={`${textOf(item.name)}-${String(index)}`} className="border-b border-hairline">
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
                                        <p className={`text-body-md font-medium ${TONE_CLASS[alertTone(textOf(alert.severity))]}`}>
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
        </>
    );
}

/* ─── التاب التشغيلي — موجز المدير (كاشيرية/مصروفات/نواقص) ───────────────── */

function OperationalBrief() {
    const briefingQuery = useQuery({
        queryKey: ['manager', 'briefing'],
        queryFn: () => fetchJson(briefingResponseSchema, '/api/manager/briefing', getAccessToken()),
    });

    const posStatsQuery = useQuery({
        queryKey: ['pos', 'orders', 'stats', 'today'],
        queryFn: () => fetchJson(posStatsResponseSchema, '/api/pos/orders/stats/today', getAccessToken()),
    });

    const briefing: BriefingResponse = briefingQuery.data || {
        cashiers: [],
        cashiersTotal: {},
        pos: {},
        expenses: {},
        stockOut: [],
        stockLow: [],
        attendance: {},
        payments: [],
    };

    const posStats: PosStatsResponse = posStatsQuery.data || {
        ok: true,
        orders_count: 0,
        total_sales: 0,
        avg_ticket: 0,
        recent_orders: [],
    };

    const totalSales = parseNumericVal(briefing.pos.total || briefing.cashiersTotal.total || posStats.total_sales);
    const totalExpenses = parseNumericVal(briefing.expenses.total || 0);
    const ordersCount = posStats.orders_count || parseNumericVal(briefing.pos.count || briefing.cashiersTotal.count || 0);
    const avgTicket = parseNumericVal(posStats.avg_ticket || (ordersCount > 0 ? totalSales / ordersCount : 0));

    const isPending = briefingQuery.isPending || posStatsQuery.isPending;
    const isError = briefingQuery.isError && posStatsQuery.isError;

    return (
        <>
            <div className="flex justify-end gap-xs" data-erp-print-hide>
            </div>

            {isPending ? (
                <StateLoading label="جارٍ جمع بيانات الموجز التشغيلي…" />
            ) : isError ? (
                <StateError
                    message={briefingQuery.error?.message || 'تعذّر جلب بيانات الموجز التشغيلي'}
                    onRetry={() => {
                        void briefingQuery.refetch();
                        void posStatsQuery.refetch();
                    }}
                />
            ) : (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الموجز التشغيلي">
                        <StatCard
                            label="مبيعات اليوم"
                            english="Today's sales"
                            value={formatCurrency(totalSales)}
                            hint="إجمالي المبيعات المحققة حتى اللحظة"
                        />
                        <StatCard
                            label="المصروفات اليومية"
                            english="Today's expenses"
                            value={formatCurrency(totalExpenses)}
                            hint="المصروفات المسجلة اليوم"
                        />
                        <StatCard
                            label="عدد الفواتير"
                            english="Orders count"
                            value={formatInt(ordersCount)}
                            hint="إجمالي طلبات وفواتير الكاشير"
                        />
                        <StatCard
                            label="متوسط الفاتورة"
                            english="Average ticket"
                            value={formatCurrency(avgTicket)}
                            hint="متوسط قيمة الفاتورة الواحدة"
                        />
                    </ul>

                    <div className="grid gap-md md:grid-cols-2">
                        <Card>
                            <div className="border-b border-hairline px-sm py-xs">
                                <h2 className="text-heading-md text-ink">
                                    مبيعات الأقسام{' '}
                                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                        Departments breakdown
                                    </span>
                                </h2>
                            </div>
                            <div className="p-sm">
                                {briefing.cashiers.length === 0 ? (
                                    <p className="text-body-sm text-muted">لا توجد مبيعات أقسام مسجلة لهذا اليوم حتى الآن.</p>
                                ) : (
                                    <ul className="flex flex-col gap-xs list-none">
                                        {briefing.cashiers.map((dept, idx) => (
                                            <li
                                                key={dept.department_id ? String(dept.department_id) : `dept-${idx}`}
                                                className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                            >
                                                <span className="text-ink font-medium">{dept.department_name}</span>
                                                <div className="flex items-center gap-sm">
                                                    <span className="text-caption text-muted">
                                                        {formatInt(parseNumericVal(dept.count))} فاتورة
                                                    </span>
                                                    <span className="erp-numeric font-medium text-ink" dir="ltr">
                                                        {formatCurrency(parseNumericVal(dept.total))}
                                                    </span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </Card>

                        <Card>
                            <div className="border-b border-hairline px-sm py-xs">
                                <h2 className="text-heading-md text-ink">
                                    طرق الدفع والتحصيل{' '}
                                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                        Payment methods
                                    </span>
                                </h2>
                            </div>
                            <div className="p-sm">
                                {briefing.payments.length === 0 ? (
                                    <p className="text-body-sm text-muted">لا توجد عمليات دفع مسجلة لهذا اليوم حتى الآن.</p>
                                ) : (
                                    <ul className="flex flex-col gap-xs list-none">
                                        {briefing.payments.map((pm) => {
                                            const method = String(pm.method || pm.payment_method || 'نقدي');
                                            const amount = parseNumericVal(pm.total || pm.amount || 0);
                                            return (
                                                <li
                                                    key={method}
                                                    className="flex items-center justify-between rounded-md bg-surface-sunken p-xs text-body-md"
                                                >
                                                    <span className="text-ink font-medium">{method}</span>
                                                    <span className="erp-numeric font-medium text-ink" dir="ltr">
                                                        {formatCurrency(amount)}
                                                    </span>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}
                            </div>
                        </Card>
                    </div>

                    {(briefing.stockOut.length > 0 || briefing.stockLow.length > 0) && (
                        <Card>
                            <div className="border-b border-hairline px-sm py-xs">
                                <h2 className="text-heading-md text-ink">
                                    تنبيهات المخزون والنواقص{' '}
                                    <span className="text-body-sm text-muted" dir="ltr" lang="en">
                                        Stock alerts
                                    </span>
                                </h2>
                            </div>
                            <div className="p-sm flex flex-col gap-xs">
                                {briefing.stockOut.length > 0 && (
                                    <div className="rounded-md border border-danger/30 bg-danger/10 p-sm text-body-md text-danger">
                                        <p className="font-medium">
                                            يوجد {formatInt(briefing.stockOut.length)} صنفًا نفد رصيدها بالكامل من المخزن.
                                        </p>
                                    </div>
                                )}
                                {briefing.stockLow.length > 0 && (
                                    <div className="rounded-md border border-warn/30 bg-warn/10 p-sm text-body-md text-warn">
                                        <p className="font-medium">
                                            يوجد {formatInt(briefing.stockLow.length)} صنفًا اقترب من حد إعادة الطلب.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </Card>
                    )}
                </>
            )}
        </>
    );
}
