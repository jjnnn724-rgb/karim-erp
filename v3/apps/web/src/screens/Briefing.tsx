import './Briefing.premium.css';
import { useQuery } from '@tanstack/react-query';
import { PrintActions } from '../components/PrintActions';
import { Card, StateError, StateLoading } from '../components/TableState';
import { fetchJson } from '../lib/api';
import { getAccessToken } from '../lib/auth';
import {
    type BriefingResponse,
    briefingResponseSchema,
    type PosStatsResponse,
    parseNumericVal,
    posStatsResponseSchema,
} from '../lib/briefing';
import { formatCurrency, formatInt } from '../lib/format';
import { StatCard } from '../ui/StatCard';

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return <StatCard label={label} english={english} value={value} hint={hint} />;
}

export function Briefing() {
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
    const ordersCount =
        posStats.orders_count || parseNumericVal(briefing.pos.count || briefing.cashiersTotal.count || 0);
    const avgTicket = parseNumericVal(posStats.avg_ticket || (ordersCount > 0 ? totalSales / ordersCount : 0));

    const isPending = briefingQuery.isPending || posStatsQuery.isPending;
    const isError = briefingQuery.isError && posStatsQuery.isError;

    return (
        <div className="flex flex-col gap-md premium-screen premium-briefing">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الموجز التنفيذي{' '}
                        <span className="text-body-sm text-muted" dir="ltr" lang="en">
                            Executive Briefing
                        </span>
                    </h1>
                    <p className="text-body-sm text-muted">
                        لوحة المتابعة اللحظية للمدير: مبيعات اليوم، المصروفات، متوسط الفاتورة، وحالة المخزون والأقسام.
                    </p>
                </div>
                <div className="flex items-center gap-xs">
                    <PrintActions title="الموجز التنفيذي" />
                    <button
                        type="button"
                        onClick={() => {
                            void briefingQuery.refetch();
                            void posStatsQuery.refetch();
                        }}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            {isPending ? (
                <StateLoading label="جارٍ جمع بيانات الموجز التنفيذي…" />
            ) : isError ? (
                <StateError
                    message={briefingQuery.error?.message || 'تعذّر جلب بيانات الموجز'}
                    onRetry={() => {
                        void briefingQuery.refetch();
                        void posStatsQuery.refetch();
                    }}
                />
            ) : (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات الموجز">
                        <Kpi
                            label="مبيعات اليوم"
                            english="Today's sales"
                            value={formatCurrency(totalSales)}
                            hint="إجمالي المبيعات المحققة حتى اللحظة"
                        />
                        <Kpi
                            label="المصروفات اليومية"
                            english="Today's expenses"
                            value={formatCurrency(totalExpenses)}
                            hint="المصروفات المسجلة اليوم"
                        />
                        <Kpi
                            label="عدد الفواتير"
                            english="Orders count"
                            value={formatInt(ordersCount)}
                            hint="إجمالي طلبات وفواتير الكاشير"
                        />
                        <Kpi
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
                                    <p className="text-body-sm text-muted">
                                        لا توجد مبيعات أقسام مسجلة لهذا اليوم حتى الآن.
                                    </p>
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
                                    <p className="text-body-sm text-muted">
                                        لا توجد عمليات دفع مسجلة لهذا اليوم حتى الآن.
                                    </p>
                                ) : (
                                    <ul className="flex flex-col gap-xs list-none">
                                        {briefing.payments.map((pm, idx) => {
                                            const method = String(pm.method || pm.payment_method || 'نقدي');
                                            const amount = parseNumericVal(pm.total || pm.amount || 0);
                                            return (
                                                <li
                                                    key={idx}
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
                                            يوجد {formatInt(briefing.stockOut.length)} صنفًا نفد رصيدها بالكامل من
                                            المخزن.
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
        </div>
    );
}
