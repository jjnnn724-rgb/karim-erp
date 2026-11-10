import './CashierMonitor.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchMonitorOrders, fetchMonitorSummary, monitorCashierLabel, orderTimeText } from '../lib/cashier-monitor';
import { errorMessage, intOf, moneyOf, pctOf, shareOf, textOf, todayIso } from '../lib/reporting';

/** تحديث تلقائي كل ٣٠ ثانية — المرآة تُحدَّث نفسها على الخادم بـ live=1. */
const LIVE_MS = 30000;

/**
 * متابعة الكاشير — أوردرات اليوم الحيّة لكل كاشير، والصندوق المفتوح وآخر حركة.
 * القراءة فقط: لا إغلاق جلسة ولا تعديل فاتورة من هنا.
 */
export function CashierMonitor() {
    const [date, setDate] = useState(() => todayIso());
    const [cashier, setCashier] = useState('');

    const summaryQuery = useQuery({
        queryKey: ['cashier-monitor', 'summary', date],
        queryFn: ({ signal }) => fetchMonitorSummary(date, signal),
        refetchInterval: LIVE_MS,
    });

    const ordersQuery = useQuery({
        queryKey: ['cashier-monitor', 'orders', date, cashier],
        queryFn: ({ signal }) =>
            fetchMonitorOrders(cashier ? { date, cashier, limit: 50 } : { date, limit: 50 }, signal),
        refetchInterval: LIVE_MS,
    });

    const summary = summaryQuery.data;
    const cashiers = summary?.cashiers ?? [];
    const orders = ordersQuery.data?.orders ?? [];
    const openSessions = cashiers.reduce((sum, row) => sum + Number(row.open ?? 0), 0);
    const totalInvoices = cashiers.reduce((sum, row) => sum + Number(row.invoices ?? 0), 0);

    return (
        <div className="flex flex-col gap-md premium-screen premium-cashiermonitor">
            <PrintActions title="متابعة الكاشير" />
            <ReportHeader
                title="متابعة الكاشير"
                english="Cashier Monitor"
                description="أوردرات اليوم الحيّة لكل كاشير، والوردية المفتوحة وآخر حركة — تحديث تلقائي كل ٣٠ ثانية."
                pending={summaryQuery.isFetching || ordersQuery.isFetching}
                onRefresh={() => {
                    void summaryQuery.refetch();
                    void ordersQuery.refetch();
                }}
            />

            <SectionCard title="اليوم والكاشير" english="Day & cashier">
                <div className="flex flex-wrap items-end gap-sm p-sm">
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                        اليوم
                        <input
                            type="date"
                            value={date}
                            onChange={(event) => {
                                setDate(event.target.value);
                                setCashier('');
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label className="flex max-w-xs flex-col gap-xxs text-label-md text-ink-secondary">
                        الكاشير
                        <select
                            value={cashier}
                            onChange={(event) => {
                                setCashier(event.target.value);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="">كل الكاشيريات</option>
                            {cashiers.map((row) => (
                                <option
                                    key={textOf(row.cashier_no) || monitorCashierLabel(row)}
                                    value={textOf(row.cashier_no)}
                                >
                                    {monitorCashierLabel(row)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span className="text-caption text-muted" role="status">
                        {`تحديث تلقائي · ${date}`}
                    </span>
                </div>
            </SectionCard>

            {summaryQuery.isPending ? <StateLoading label="جارٍ قراءة صندوق اليوم…" /> : null}

            {summaryQuery.isError ? (
                <StateError
                    message={errorMessage(summaryQuery.error)}
                    onRetry={() => {
                        void summaryQuery.refetch();
                    }}
                />
            ) : null}

            {summary ? (
                <>
                    <ul
                        className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4"
                        aria-label="مؤشرات متابعة الكاشير"
                    >
                        <KpiCard
                            label="كاشيريات اليوم"
                            english="Cashiers"
                            value={intOf(cashiers.length)}
                            hint={`${intOf(totalInvoices)} فاتورة`}
                        />
                        <KpiCard
                            label="ورديات مفتوحة"
                            english="Open shifts"
                            value={intOf(openSessions)}
                            hint="لم تُغلق بعد"
                            tone={openSessions > 0 ? 'warning' : 'success'}
                        />
                        <KpiCard
                            label="فواتير معروضة"
                            english="Orders"
                            value={intOf(ordersQuery.data?.total ?? orders.length)}
                            hint="أحدث 50 أمرًا في النافذة"
                        />
                        <KpiCard
                            label="آخر حركة"
                            english="Last order"
                            value={orderTimeText(orders[0] ?? { doc_no: '' })}
                            hint={textOf(orders[0]?.cashier_name) || 'لا أوامر'}
                        />
                    </ul>

                    <SectionCard title="الصندوق لكل كاشير" english="Per cashier">
                        {cashiers.length === 0 ? (
                            <StateEmpty title="لا كاشيريات" hint="لا فواتير على هذا اليوم." />
                        ) : (
                            <TableScroll label="جدول صندوق الكاشيريات">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكاشير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                فواتير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإيراد
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                نقد / شبكة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                آجل / جوال
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                متوسط
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                مفتوح
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                آخر حركة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cashiers.map((row) => (
                                            <tr
                                                key={textOf(row.cashier_no) || monitorCashierLabel(row)}
                                                className="border-b border-hairline"
                                            >
                                                <td className="px-sm py-xxs text-ink">{monitorCashierLabel(row)}</td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {intOf(row.invoices)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    {moneyOf(row.revenue)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {`${moneyOf(row.pay_cash)} / ${moneyOf(row.pay_network)}`}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-body-sm" dir="ltr">
                                                    {`${moneyOf(row.pay_credit)} / ${moneyOf(row.pay_mobile)}`}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {moneyOf(row.avg)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                    <span
                                                        className={
                                                            Number(row.open ?? 0) > 0
                                                                ? 'text-warning-text'
                                                                : 'text-muted'
                                                        }
                                                    >
                                                        {intOf(row.open)}
                                                    </span>
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {textOf(row.last_time) || '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>

                    <SectionCard
                        title="الأوردرات"
                        english="Orders"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(orders.length)} من ${intOf(ordersQuery.data?.total ?? orders.length)}`}
                            </span>
                        }
                    >
                        {ordersQuery.isError ? (
                            <StateError
                                message={errorMessage(ordersQuery.error)}
                                onRetry={() => {
                                    void ordersQuery.refetch();
                                }}
                            />
                        ) : orders.length === 0 ? (
                            <StateEmpty title="لا أوردرات" hint="لا أوامر مطابقة في هذه النافذة." />
                        ) : (
                            <TableScroll label="جدول أوردرات اليوم">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الأمر
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الوقت
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الكاشير
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الطاولة / المنطقة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصافي
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الضريبة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الحصة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orders.map((order) => {
                                            const totalCollected = orders.reduce(
                                                (sum, row) => sum + Number(row.net ?? 0),
                                                0,
                                            );
                                            return (
                                                <tr key={order.doc_no} className="border-b border-hairline">
                                                    <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                        {order.doc_no}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {orderTimeText(order)}
                                                    </td>
                                                    <td className="px-sm py-xxs">
                                                        {textOf(order.cashier_name) || textOf(order.cashier_no) || '—'}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">
                                                        {[textOf(order.table_name), textOf(order.zone_name)]
                                                            .filter(Boolean)
                                                            .join(' · ') || '—'}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(order.net)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {moneyOf(order.vat)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                        {pctOf(shareOf(Number(order.net ?? 0), totalCollected))}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}
