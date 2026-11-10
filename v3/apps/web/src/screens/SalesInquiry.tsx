import './SalesInquiry.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { fetchOrders, YARA_MAX_DAYS } from '../lib/yara-reports';
import { errorMessage, intOf, moneyOf, presetRange, rangeProblem, textOf } from '../lib/reporting';
import { PrintActions } from '../components/PrintActions';

const PAGE = 50;

/**
 * استعلام المبيعات — أوردرات المرآة بيوم ووقت وكاشير وطاولة ومدفوعات.
 * الصفحة ٥٠ أمرًا، والعدد الكلي من `total` على الخادم لا من طول الصفحة.
 */
export function SalesInquiry() {
    const [draft, setDraft] = useState(() => presetRange('today'));
    const [range, setRange] = useState(draft);
    const [cashier, setCashier] = useState('');
    const [offset, setOffset] = useState(0);
    const [problem, setProblem] = useState('');

    const ordersQuery = useQuery({
        queryKey: ['yara', 'orders', range.from, range.to, cashier, offset],
        queryFn: ({ signal }) =>
            fetchOrders(cashier ? { from: range.from, to: range.to, cashier, limit: PAGE, offset } : { from: range.from, to: range.to, limit: PAGE, offset }, signal),
    });

    const page = ordersQuery.data;
    const orders = page?.orders ?? [];
    const total = Number(page?.total ?? 0);

    function apply() {
        const message = rangeProblem(draft.from, draft.to, YARA_MAX_DAYS);
        setProblem(message);
        if (!message) {
            setRange(draft);
            setOffset(0);
        }
    }

    return (
        <div className="screen-premium flex flex-col gap-md">
            <PrintActions title="استعلام المبيعات" />
            <ReportHeader
                title="استعلام المبيعات"
                english="Sales Inquiry"
                description="أوردرات الكاشير سطرًا سطرًا: اليوم والوقت والطاولة والمنطقة والصافي والضريبة والمدفوع."
                pending={ordersQuery.isFetching}
                onRefresh={() => {
                    void ordersQuery.refetch();
                }}
            />

            <SectionCard title="الفترة والكاشير" english="Filters">
                <div className="flex flex-col gap-sm p-sm">
                    <RangeControls
                        from={draft.from}
                        to={draft.to}
                        onFrom={(value) => {
                            setDraft((current) => ({ ...current, from: value }));
                        }}
                        onTo={(value) => {
                            setDraft((current) => ({ ...current, to: value }));
                        }}
                        onApply={apply}
                        pending={ordersQuery.isFetching}
                    />
                    <label className="flex max-w-xs flex-col gap-xxs text-label-md text-ink-secondary">
                        رقم الكاشير (اختياري)
                        <input
                            type="text"
                            inputMode="numeric"
                            value={cashier}
                            onChange={(event) => {
                                setCashier(event.target.value.replace(/\D/g, '').slice(0, 8));
                                setOffset(0);
                            }}
                            placeholder="مثال: 101"
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            dir="ltr"
                        />
                    </label>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            {ordersQuery.isPending ? <StateLoading label="جارٍ قراءة الأوردرات…" /> : null}

            {ordersQuery.isError ? (
                <StateError
                    message={errorMessage(ordersQuery.error)}
                    onRetry={() => {
                        void ordersQuery.refetch();
                    }}
                />
            ) : null}

            {page ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات استعلام المبيعات">
                        <KpiCard label="أوامر مطابقة" english="Matched" value={intOf(total)} hint="كل الصفحات" />
                        <KpiCard label="في الصفحة" english="Page" value={intOf(orders.length)} hint={`${String(PAGE)} لكل صفحة`} />
                        <KpiCard
                            label="الصفحة"
                            english="Page index"
                            value={intOf(Math.floor(offset / PAGE) + 1)}
                            hint={`من ${intOf(Math.max(1, Math.ceil(total / PAGE)))}`}
                        />
                        <KpiCard
                            label="الفترة"
                            english="Range"
                            value={`${textOf(page.from) || range.from}`}
                            hint={`إلى ${textOf(page.to) || range.to}`}
                        />
                    </ul>

                    <SectionCard
                        title="الأوردرات"
                        english="Orders"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(offset + 1)}–${intOf(offset + orders.length)} من ${intOf(total)}`}
                            </span>
                        }
                    >
                        {orders.length === 0 ? (
                            <StateEmpty title="لا أوردرات" hint="لا أوامر مطابقة لهذه الفلاتر." />
                        ) : (
                            <TableScroll label="جدول أوردرات المبيعات">
                                <table className="w-full border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الأمر
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التاريخ / الوقت
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
                                                الخصم
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                المدفوع
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                السطور
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {orders.map((order) => (
                                            <tr key={order.doc_no} className="border-b border-hairline hover:bg-surface-hover">
                                                <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                                                    {order.doc_no}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {`${textOf(order.doc_date)} ${textOf(order.doc_time)}`}
                                                </td>
                                                <td className="px-sm py-xxs text-body-sm">
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
                                                    {moneyOf(order.discount)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {moneyOf(order.payed)}
                                                </td>
                                                <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                                                    {intOf(order.lines_count)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    setOffset((current) => Math.max(0, current - PAGE));
                                }}
                                disabled={offset === 0 || ordersQuery.isFetching}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                            >
                                السابق
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setOffset((current) => current + PAGE);
                                }}
                                disabled={offset + orders.length >= total || ordersQuery.isFetching}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                            >
                                التالي
                            </button>
                        </div>
                    </SectionCard>
                </>
            ) : null}
        </div>
    );
}

