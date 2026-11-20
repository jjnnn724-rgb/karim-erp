import './SalesAnalyzer.premium.css';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { BarList, KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll } from '../components/TableState';
import { getAppKey, getAccessToken } from '../lib/auth';
import { formatCurrency } from '../lib/format';
import { errorMessage, intOf, moneyOf, presetRange, qtyOf, rangeProblem, shareOf, textOf } from '../lib/reporting';
import { fetchItemInvoices, fetchItemSales, fetchOrderDetail, groupItemSales, YARA_MAX_DAYS, type ItemInvoiceRow } from '../lib/yara-reports';

/**
 * تحليل المبيعات — صفحة واحدة بتابين (دمج 2026-11-20، قرار المالك):
 *  • «تحليل مجمّع»: صفوف `item-sales` مجمّعة برمز الصنف على النافذة.
 *  • «استعلام تفصيلي»: تنقيب الصنف (دمج شاشة استعلام المبيعات المحذوفة) —
 *    فواتير الصنف سطرًا سطرًا عبر `/item-invoices`، وتفاصيل الأمر عبر
 *    `/order-detail/:docNo` مع إيصال 80mm قابل للطباعة.
 * المجاميع من الخادم؛ التجميع هنا كمية وصافٍ على الصفوف الواصلة فقط.
 */

type AnalyzerTab = 'aggregate' | 'inquiry';
const INQUIRY_PAGE = 100;

export function SalesAnalyzer() {
    const [draft, setDraft] = useState(() => presetRange('week'));
    const [range, setRange] = useState(draft);
    const [tab, setTab] = useState<AnalyzerTab>('aggregate');
    const [problem, setProblem] = useState('');

    const itemsQuery = useQuery({
        queryKey: ['yara', 'item-sales', range.from, range.to],
        queryFn: ({ signal }) => fetchItemSales(range.from, range.to, signal),
        enabled: tab === 'aggregate',
    });

    function apply() {
        const message = rangeProblem(draft.from, draft.to, YARA_MAX_DAYS);
        setProblem(message);
        if (!message) {
            setRange(draft);
        }
    }

    return (
        <div className="screen-premium flex flex-col gap-md">
            <PrintActions title="تحليل المبيعات" />
            <ReportHeader
                title="تحليل المبيعات"
                english="Sales Analyzer"
                description="تحليل الأصناف من مرآة YaraSoft مع تنقيب تفصيلي: فواتير كل صنف وتفاصيل الأمر وإيصاله — في صفحة واحدة."
                pending={itemsQuery.isFetching}
                onRefresh={() => {
                    void itemsQuery.refetch();
                }}
            />

            <SectionCard title="الفترة" english="Period">
                <div className="p-sm">
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
                        pending={itemsQuery.isFetching}
                    />
                    {problem ? (
                        <p role="alert" className="mt-xs text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </SectionCard>

            <div role="tablist" aria-label="تبويبات تحليل المبيعات" className="flex gap-xs border-b border-hairline px-sm" data-erp-print-hide>
                <button
                    type="button"
                    role="tab"
                    id="sales-tab-aggregate"
                    aria-selected={tab === 'aggregate'}
                    aria-controls="sales-panel-aggregate"
                    onClick={() => {
                        setTab('aggregate');
                    }}
                    className={`rounded-t-md px-md py-xs text-button-md ${
                        tab === 'aggregate' ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted hover:bg-surface-hover hover:text-ink'
                    }`}
                >
                    تحليل مجمّع
                </button>
                <button
                    type="button"
                    role="tab"
                    id="sales-tab-inquiry"
                    aria-selected={tab === 'inquiry'}
                    aria-controls="sales-panel-inquiry"
                    onClick={() => {
                        setTab('inquiry');
                    }}
                    className={`rounded-t-md px-md py-xs text-button-md ${
                        tab === 'inquiry' ? 'border-b-2 border-primary font-medium text-primary' : 'text-muted hover:bg-surface-hover hover:text-ink'
                    }`}
                >
                    استعلام تفصيلي
                </button>
            </div>

            {tab === 'aggregate' ? (
                <div role="tabpanel" id="sales-panel-aggregate" aria-labelledby="sales-tab-aggregate" className="flex flex-col gap-md">
                    <AggregatePanel itemsQuery={itemsQuery} />
                </div>
            ) : (
                <div role="tabpanel" id="sales-panel-inquiry" aria-labelledby="sales-tab-inquiry" className="flex flex-col gap-md">
                    <InquiryPanel from={range.from} to={range.to} />
                </div>
            )}
        </div>
    );
}

/* ─── التاب المجمع — الأصناف على النافذة ────────────────────────────────── */

interface AggregateProps {
    itemsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchItemSales>>>>;
}

function AggregatePanel({ itemsQuery }: AggregateProps) {
    const data = itemsQuery.data;
    const grouped = groupItemSales(data?.rows ?? []);
    const topNet = grouped.length > 0 ? Number(grouped[0]?.net ?? 0) : 0;
    const top = grouped.slice(0, 8);

    return (
        <>
            {itemsQuery.isPending ? <StateLoading label="جارٍ تحليل مبيعات الأصناف…" /> : null}

            {itemsQuery.isError ? (
                <StateError
                    message={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                />
            ) : null}

            {data ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات مبيعات الأصناف">
                        <KpiCard
                            label="صافي المبيعات"
                            english="Net"
                            value={moneyOf(data.totals?.net)}
                            hint={`ضريبة ${moneyOf(data.totals?.vat)}`}
                        />
                        <KpiCard label="الفواتير" english="Invoices" value={intOf(data.totals?.invoices)} hint="فواتير المرآة في الفترة" />
                        <KpiCard
                            label="الكميات المباعة"
                            english="Quantity"
                            value={qtyOf(data.totals?.qty)}
                            hint={`${intOf(grouped.length)} صنفًا مختلفًا`}
                        />
                        <KpiCard
                            label="صفوف المصدر"
                            english="Source rows"
                            value={intOf((data.rows ?? []).length)}
                            hint="الصفوف قبل التجميع برمز الصنف"
                        />
                    </ul>

                    <div className="grid gap-md lg:grid-cols-2">
                        <SectionCard title="أعلى الأصناف صافيًا" english="Top items">
                            <BarList
                                ariaLabel="أعلى الأصناف صافيًا"
                                emptyText="لا أصناف في الفترة."
                                items={top.map((row) => ({
                                    label: row.label,
                                    value: moneyOf(row.net),
                                    share: shareOf(row.net, topNet),
                                }))}
                            />
                        </SectionCard>

                        <SectionCard title="إجمالي الأصناف" english="All items">
                            {grouped.length === 0 ? (
                                <StateEmpty title="لا مبيعات أصناف" hint="لا سطور أصناف في هذه الفترة." />
                            ) : (
                                <TableScroll label="جدول مبيعات الأصناف">
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
                                                    فواتير
                                                </th>
                                                <th scope="col" className="px-sm py-xs text-start font-medium">
                                                    الصافي
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {grouped.map((row) => (
                                                <tr key={row.code || row.label} className="border-b border-hairline">
                                                    <td className="px-sm py-xxs text-ink">{row.label}</td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {qtyOf(row.qty)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {intOf(row.invoices)}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                        {moneyOf(row.net)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            )}
                        </SectionCard>
                    </div>

                    <p className="text-caption text-muted" role="status">
                        {`سقف الفترة ${intOf(YARA_MAX_DAYS)} يومًا · تجميع برمز الصنف`}
                    </p>
                </>
            ) : null}
        </>
    );
}

/* ─── تاب الاستعلام التفصيلي — فواتير الصنف وتفاصيل الأمر ───────────────── */

function InquiryPanel({ from, to }: { from: string; to: string }) {
    const [itemDraft, setItemDraft] = useState('');
    const [item, setItem] = useState('');
    const [code, setCode] = useState('');
    const [cashier, setCashier] = useState('');
    const [offset, setOffset] = useState(0);
    const [openDoc, setOpenDoc] = useState('');

    const invoicesQuery = useQuery({
        queryKey: ['yara', 'item-invoices', item, code, from, to, cashier, offset],
        queryFn: ({ signal }) => {
            const base = { from, to, limit: INQUIRY_PAGE, offset };
            if (code) {
                return fetchItemInvoices(cashier ? { ...base, code, cashier } : { ...base, code }, signal);
            }
            return fetchItemInvoices(cashier ? { ...base, item, cashier } : { ...base, item }, signal);
        },
        enabled: Boolean(item || code),
    });

    const page = invoicesQuery.data;
    const invoices = page?.invoices ?? [];
    const totals = page?.totals;
    const total = Number(totals?.invoices ?? 0);

    function search(rawItem: string, rawCode: string) {
        setItem(rawItem.trim());
        setCode(rawCode.trim());
        setOffset(0);
        setOpenDoc('');
    }

    return (
        <>
            <SectionCard title="الصنف والكاشير" english="Item & cashier">
                <div className="flex flex-col gap-sm p-sm">
                    <div className="flex flex-wrap items-end gap-sm">
                        <label className="flex max-w-sm flex-1 flex-col gap-xxs text-label-md text-ink-secondary">
                            اسم الصنف أو كوده
                            <input
                                type="text"
                                value={itemDraft}
                                onChange={(event) => {
                                    setItemDraft(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        search(itemDraft, '');
                                    }
                                }}
                                placeholder="مثال: فوركواتر كلو"
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            />
                        </label>
                        <label className="flex max-w-xxs flex-col gap-xxs text-label-md text-ink-secondary">
                            الكاشير (اختياري)
                            <input
                                type="text"
                                inputMode="numeric"
                                value={cashier}
                                onChange={(event) => {
                                    setCashier(event.target.value.replace(/\D/g, '').slice(0, 8));
                                    setOffset(0);
                                }}
                                placeholder="101"
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                                dir="ltr"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => {
                                search(itemDraft, '');
                            }}
                            disabled={!itemDraft.trim()}
                            className="rounded-md bg-primary px-md py-xs text-button-md text-ink-inverse hover:bg-primary-strong disabled:opacity-50"
                        >
                            استعلام
                        </button>
                    </div>
                    <p className="text-caption text-muted">
                        اكتب اسم الصنف ثم Enter أو زر الاستعلام — تظهر فواتيره داخل الفترة أعلاه، واضغط أي فاتورة لتفاصيلها وإيصالها.
                    </p>
                </div>
            </SectionCard>

            {!item && !code ? (
                <StateEmpty title="ابدأ باسم صنف" hint="اكتب اسم الصنف أو كوده لعرض فواتيره في الفترة المحددة." />
            ) : null}

            {invoicesQuery.isPending && (item || code) ? <StateLoading label="جارٍ تنقيب فواتير الصنف…" /> : null}

            {invoicesQuery.isError ? (
                <StateError
                    message={errorMessage(invoicesQuery.error)}
                    onRetry={() => {
                        void invoicesQuery.refetch();
                    }}
                />
            ) : null}

            {page && (item || code) ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات تنقيب الصنف">
                        <KpiCard label="فواتير الصنف" english="Invoices" value={intOf(total)} hint="كل الصفحات على الخادم" />
                        <KpiCard label="كمية الصنف" english="Item qty" value={qtyOf(totals?.qty)} hint="مجموع الكمية داخل تلك الفواتير" />
                        <KpiCard label="صافي الصنف" english="Item net" value={moneyOf(totals?.net)} hint={`ضريبة ${moneyOf(totals?.vat)}`} />
                        <KpiCard
                            label="نوع المطابقة"
                            english="Match"
                            value={matchLabel(textOf(page.match))}
                            hint={textOf(page.match) === 'search' ? 'بحث عائلي — قد يشمل أصنافًا متشابهة' : 'هوية صنف محصورة'}
                        />
                    </ul>

                    <SectionCard
                        title={`فواتير ${textOf(page.item) || textOf(page.code) || 'الصنف'}`}
                        english="Item invoices"
                        actions={
                            <span className="text-body-sm text-muted" role="status">
                                {`${intOf(offset + 1)}–${intOf(offset + invoices.length)} من ${intOf(invoices.length)} معروضة`}
                            </span>
                        }
                    >
                        {invoices.length === 0 ? (
                            <StateEmpty title="لا فواتير" hint="لم يُبع هذا الصنف داخل الفترة المحددة." />
                        ) : (
                            <TableScroll label="جدول فواتير الصنف">
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
                                                كمية الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                صافي الصنف
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                صافي الفاتورة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الطاولة / المنطقة
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.map((invoice) => (
                                            <InvoiceRow key={invoice.doc_no} invoice={invoice} open={openDoc === invoice.doc_no} onOpen={setOpenDoc} />
                                        ))}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                        <div className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs">
                            <button
                                type="button"
                                onClick={() => {
                                    setOffset((current) => Math.max(0, current - INQUIRY_PAGE));
                                }}
                                disabled={offset === 0 || invoicesQuery.isFetching}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                            >
                                السابق
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setOffset((current) => current + INQUIRY_PAGE);
                                }}
                                disabled={offset + invoices.length >= invoices.length || invoicesQuery.isFetching}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                            >
                                التالي
                            </button>
                        </div>
                    </SectionCard>

                    {openDoc ? <OrderDetailCard docNo={openDoc} /> : null}
                </>
            ) : null}
        </>
    );
}

function matchLabel(match: string): string {
    if (match === 'search') {
        return 'بحث عائلي';
    }
    if (match === 'pair' || match === 'code') {
        return 'مطابقة دقيقة';
    }
    return match || '—';
}

function InvoiceRow({ invoice, open, onOpen }: { invoice: ItemInvoiceRow; open: boolean; onOpen: (doc: string) => void }) {
    return (
        <tr
            className={`cursor-pointer border-b border-hairline hover:bg-surface-hover ${open ? 'bg-surface-sunken' : ''}`}
            onClick={() => {
                onOpen(open ? '' : invoice.doc_no);
            }}
        >
            <td className="erp-numeric px-sm py-xxs text-ink" dir="ltr">
                {invoice.doc_no}
            </td>
            <td className="erp-numeric px-sm py-xxs text-muted" dir="ltr">
                {`${textOf(invoice.doc_date)} ${textOf(invoice.doc_time)}`}
            </td>
            <td className="px-sm py-xxs text-body-sm">{textOf(invoice.cashier_name) || textOf(invoice.cashier_no) || '—'}</td>
            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                {qtyOf(invoice.item_qty)}
            </td>
            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                {moneyOf(invoice.item_net)}
            </td>
            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                {moneyOf(invoice.net)}
            </td>
            <td className="px-sm py-xxs text-body-sm text-muted">
                {[textOf(invoice.table_name), textOf(invoice.zone_name)].filter(Boolean).join(' · ') || '—'}
            </td>
        </tr>
    );
}

/** تفاصيل الأمر المفتوح — سطور الأصناف والمدفوعات وإيصال الطباعة. */
function OrderDetailCard({ docNo }: { docNo: string }) {
    const detail = useQuery({
        queryKey: ['yara', 'order-detail', docNo],
        queryFn: ({ signal }) => fetchOrderDetail(docNo, signal),
    });

    const order = detail.data?.order;
    const lines = order?.lines ?? [];

    async function printReceipt() {
        try {
            const headers: Record<string, string> = { Accept: 'text/html' };
            const token = getAccessToken();
            if (token) {
                headers.Authorization = `Bearer ${token}`;
            }
            const appKey = getAppKey();
            if (appKey) {
                headers['x-api-key'] = appKey;
            }
            const response = await fetch(`/api/pos/orders/ys/${encodeURIComponent(docNo)}/receipt-html`, { headers });
            if (!response.ok) {
                throw new Error(`HTTP ${String(response.status)}`);
            }
            const html = await response.text();
            const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener');
        } catch {
            window.alert('تعذّر تحضير الإيصال — حاول مرة أخرى.');
        }
    }

    return (
        <SectionCard
            title={`تفاصيل الأمر ${docNo}`}
            english="Order detail"
            actions={
                <button
                    type="button"
                    onClick={() => {
                        void printReceipt();
                    }}
                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-button-md text-ink hover:bg-surface-hover"
                >
                    طباعة الإيصال
                </button>
            }
        >
            {detail.isPending ? <StateLoading label="جارٍ قراءة تفاصيل الأمر…" /> : null}
            {detail.isError ? (
                <StateError
                    message={errorMessage(detail.error)}
                    onRetry={() => {
                        void detail.refetch();
                    }}
                />
            ) : null}
            {order ? (
                <div className="flex flex-col gap-sm p-sm">
                    <ul className="grid list-none gap-xxs text-body-sm text-muted sm:grid-cols-3" aria-label="بيانات الأمر">
                        <li>
                            الكاشير: <span className="text-ink">{textOf(order.cashier_no) || '—'}</span>
                        </li>
                        <li>
                            الطاولة: <span className="text-ink">{textOf(order.table_name) || '—'}</span>
                        </li>
                        <li>
                            المنطقة: <span className="text-ink">{textOf(order.zone_name) || '—'}</span>
                        </li>
                        <li>
                            الصافي: <span className="erp-numeric text-ink" dir="ltr">{formatCurrency(Number(order.net ?? 0))}</span>
                        </li>
                        <li>
                            الضريبة: <span className="erp-numeric text-ink" dir="ltr">{formatCurrency(Number(order.vat ?? 0))}</span>
                        </li>
                        <li>
                            المدفوع: <span className="erp-numeric text-ink" dir="ltr">{formatCurrency(Number(order.payed ?? 0))}</span>
                        </li>
                    </ul>
                    {lines.length === 0 ? (
                        <p className="text-body-sm text-muted">لا سطور محفوظة لهذا الأمر.</p>
                    ) : (
                        <TableScroll label="جدول سطور الأمر">
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
                                            السعر
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الإجمالي
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lines.map((line, index) => (
                                        <tr key={`${textOf(line.code)}-${textOf(line.name)}-${String(index)}`} className="border-b border-hairline">
                                            <td className="px-sm py-xxs text-ink">{textOf(line.name) || textOf(line.code) || '—'}</td>
                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                {qtyOf(line.qty)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                {moneyOf(line.price)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs" dir="ltr">
                                                {moneyOf(line.total)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </TableScroll>
                    )}
                    <p className="text-caption text-muted" role="status">
                        {`سطور الأمر: ${intOf(lines.length)}`}
                    </p>
                </div>
            ) : null}
        </SectionCard>
    );
}
