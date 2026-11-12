import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ItemDossier } from '../components/ItemDossier';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    expiryState,
    fetchInquiryDepartments,
    fetchInquiryExport,
    fetchInquiryItems,
    INQ_FILTERS,
    INQ_SORTS,
    type InquiryRow,
    saveDownload,
} from '../lib/inventory-inquiry';
import { errorMessage, intOf, moneyOf, presetRange, qtyOf, rangeProblem, textOf, todayIso } from '../lib/reporting';

/**
 * محرك استعلامات المخزون — قراءة فقط من `/api/inventory-inquiry`.
 *
 * يعرض: إجماليات المحرك، جدول الأصناف (دخل/منصرف/مبيع POS/مبيع المرآة/
 * التكلفة/الصلاحية)، بطاقة الصنف عند اختيار صف، وتكلفة الأقسام.
 *
 * `soldPos` و`soldYara` عمودان منفصلان دائمًا: الأول حقيقة بالمعرّف،
 * والثاني تقريب بالاسم المطبَّع — ولا يُجمعان.
 */

const FILTER_LABELS: Record<(typeof INQ_FILTERS)[number], string> = {
    all: 'كل الأصناف',
    moved: 'تحركت في المدى',
    active: 'موجودة أو متحركة',
    low: 'تحت الحد',
    expired: 'صلاحية منتهية',
};

const SORT_LABELS: Record<(typeof INQ_SORTS)[number], string> = {
    movements: 'الأكثر حركة',
    onHand: 'الأعلى رصيدًا',
    value: 'الأعلى قيمة',
    qtyIn: 'الأكثر دخولًا',
    qtyOut: 'الأكثر انصرافًا',
    sold: 'الأكثر مبيعًا',
    cost: 'الأعلى كوستًا',
    name: 'الاسم',
    expiry: 'أقرب صلاحية',
};

export function InventoryInquiry() {
    const initial = presetRange('month');
    const [from, setFrom] = useState(initial.from);
    const [to, setTo] = useState(initial.to);
    const [query, setQuery] = useState('');
    const [only, setOnly] = useState<(typeof INQ_FILTERS)[number]>('all');
    const [sort, setSort] = useState<(typeof INQ_SORTS)[number]>('movements');
    const [applied, setApplied] = useState({
        from: initial.from,
        to: initial.to,
        q: '',
        only: 'all' as (typeof INQ_FILTERS)[number],
        sort: 'movements' as (typeof INQ_SORTS)[number],
    });
    const [selected, setSelected] = useState('');

    const problem = rangeProblem(applied.from, applied.to, 93);
    const itemsQuery = useQuery({
        queryKey: ['inquiry-items', applied],
        queryFn: ({ signal }) =>
            fetchInquiryItems(
                {
                    from: applied.from,
                    to: applied.to,
                    q: applied.q,
                    only: applied.only,
                    sort: applied.sort,
                    dir: 'desc',
                    limit: 200,
                },
                signal,
            ),
        enabled: problem === '',
    });
    // التصدير من الخادم بنفس المرشّحات والسقف المعروض — لا مكتبة Excel في المتصفح.
    const exportFile = useMutation({
        mutationFn: () =>
            fetchInquiryExport({
                from: applied.from,
                to: applied.to,
                q: applied.q,
                only: applied.only,
                sort: applied.sort,
                dir: 'desc',
                limit: 200,
            }),
        onSuccess: (file) => {
            saveDownload(file);
        },
    });
    const departmentsQuery = useQuery({
        queryKey: ['inquiry-departments', applied.from, applied.to],
        queryFn: ({ signal }) => fetchInquiryDepartments(applied.from, applied.to, signal),
        enabled: problem === '',
    });

    const rows = itemsQuery.data?.rows ?? [];
    const totals = itemsQuery.data?.totals;
    const departments = departmentsQuery.data?.rows ?? [];
    const today = todayIso();

    return (
        <div className="mx-auto flex w-full min-w-0 flex-col gap-lg">
            <ReportHeader
                title="محرك الاستعلامات"
                english="Inventory Query"
                description="ما دخل من الفواتير، وما في المخزن، وما انصرف، وما بيع، وبأي تكلفة — من دفتر المخزون مباشرة."
                pending={itemsQuery.isFetching || departmentsQuery.isFetching}
                onRefresh={() => {
                    void itemsQuery.refetch();
                    void departmentsQuery.refetch();
                }}
            />

            <Card>
                <div className="flex flex-col gap-sm p-sm">
                    <RangeControls
                        from={from}
                        to={to}
                        onFrom={setFrom}
                        onTo={setTo}
                        onApply={() => {
                            setSelected('');
                            setApplied({ from, to, q: query.trim(), only, sort });
                        }}
                        pending={itemsQuery.isFetching}
                    />
                    <div className="flex flex-wrap items-end gap-sm">
                        <label className="flex min-w-48 flex-1 flex-col gap-xxs text-label-md text-ink-secondary">
                            بحث
                            <input
                                type="search"
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        setSelected('');
                                        setApplied({ from, to, q: query.trim(), only, sort });
                                    }
                                }}
                                placeholder="اسم أو تصنيف أو باركود"
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            />
                        </label>
                        <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                            الحالة
                            <select
                                value={only}
                                onChange={(event) => {
                                    setOnly(event.target.value as (typeof INQ_FILTERS)[number]);
                                }}
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            >
                                {INQ_FILTERS.map((key) => (
                                    <option key={key} value={key}>
                                        {FILTER_LABELS[key]}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-xxs text-label-md text-ink-secondary">
                            ترتيب
                            <select
                                value={sort}
                                onChange={(event) => {
                                    setSort(event.target.value as (typeof INQ_SORTS)[number]);
                                }}
                                className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                            >
                                {INQ_SORTS.map((key) => (
                                    <option key={key} value={key}>
                                        {SORT_LABELS[key]}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                    {problem ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {problem}
                        </p>
                    ) : null}
                </div>
            </Card>

            {itemsQuery.isPending && problem === '' ? <StateLoading label="جارٍ تجميع حركة الأصناف…" /> : null}

            {itemsQuery.isError ? (
                <StateError
                    message={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                />
            ) : null}

            {totals ? (
                <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="إجماليات المحرك">
                    <KpiCard
                        label="قيمة المخزون"
                        english="Stock value"
                        value={moneyOf(totals.stockValue)}
                        hint={`${intOf(totals.items)} صنفًا في النتائج`}
                    />
                    <KpiCard
                        label="داخل من الفواتير"
                        english="Received"
                        value={qtyOf(totals.qtyInPurchases)}
                        hint="صافي مُوقَّع — يشمل عكوس الإلغاء والتعديل"
                        tone="success"
                    />
                    <KpiCard
                        label="المنصرف"
                        english="Issued"
                        value={qtyOf(totals.qtyOutTotal)}
                        hint={`بتكلفة ${moneyOf(totals.outCost)}`}
                        tone="warning"
                    />
                    <KpiCard
                        label="تكلفة المشتريات"
                        english="Purchase cost"
                        value={moneyOf(totals.purchaseCost)}
                        hint={`مبيع POS ${qtyOf(totals.qtySoldPos)} · إيراد ${moneyOf(totals.revenuePos)}`}
                    />
                </ul>
            ) : null}

            <SectionCard
                title="الأصناف"
                english="Items"
                actions={
                    <div className="flex flex-wrap items-center gap-sm" data-erp-print-hide>
                        {exportFile.isError ? (
                            <span role="alert" className="text-caption text-danger-text">
                                {errorMessage(exportFile.error)}
                            </span>
                        ) : null}
                        {exportFile.isSuccess ? (
                            <span role="status" className="text-caption text-success-text">
                                تم تصدير الملف
                            </span>
                        ) : null}
                        <button
                            type="button"
                            onClick={() => {
                                exportFile.mutate();
                            }}
                            disabled={exportFile.isPending || rows.length === 0}
                            className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                        >
                            {exportFile.isPending ? 'جارٍ التصدير…' : 'تصدير Excel'}
                        </button>
                        <PrintActions title="محرك الاستعلامات" />
                    </div>
                }
            >
                {rows.length === 0 ? (
                    <StateEmpty title="لا أصناف تطابق المرشّحات" hint="وسّع المدى أو امسح البحث." />
                ) : (
                    <TableScroll label="جدول أصناف المخزون — حركة الدخول والانصراف والمبيع">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الصنف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        الرصيد
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        دخل
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        منصرف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        مبيع POS
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        مبيع المرآة
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        قيمة المخزون
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الصلاحية
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row: InquiryRow) => {
                                    const expiry = expiryState(textOf(row.nearestExpiry), today);
                                    return (
                                        <tr
                                            key={String(row.itemId)}
                                            className={`border-b border-hairline hover:bg-surface-hover ${
                                                String(row.itemId) === selected ? 'bg-surface-hover' : ''
                                            }`}
                                        >
                                            <td className="px-sm py-xxs">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setSelected(String(row.itemId));
                                                    }}
                                                    className="erp-inline-btn min-h-6 py-0.5 text-start text-ink underline-offset-2 hover:underline"
                                                >
                                                    {textOf(row.itemName) || `#${String(row.itemId)}`}
                                                </button>
                                                <span className="block text-caption text-faint">
                                                    {textOf(row.category) || 'بلا تصنيف'}
                                                    {row.yaraMatched === false ? ' · بلا مطابقة مرآة' : ''}
                                                </span>
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {qtyOf(row.onHand)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {qtyOf(row.qtyInPurchases)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {qtyOf(row.qtyOutTotal)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {qtyOf(row.soldPos)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-muted" dir="ltr">
                                                {qtyOf(row.soldYara)}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {moneyOf(row.stockValue)}
                                            </td>
                                            <td className="px-sm py-xxs">
                                                <span
                                                    className={
                                                        expiry.tone === 'danger'
                                                            ? 'text-danger-text'
                                                            : expiry.tone === 'warning'
                                                              ? 'text-warning-text'
                                                              : expiry.tone === 'success'
                                                                ? 'text-success-text'
                                                                : 'text-muted'
                                                    }
                                                >
                                                    {expiry.label}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
            </SectionCard>

            {selected ? (
                <SectionCard title="بطاقة الصنف" english="Item dossier">
                    <ItemDossier itemId={selected} from={applied.from} to={applied.to} />
                </SectionCard>
            ) : null}

            <SectionCard title="تكلفة الأقسام والكوست العام" english="Department cost">
                {departmentsQuery.isError ? (
                    <StateError
                        message={errorMessage(departmentsQuery.error)}
                        onRetry={() => {
                            void departmentsQuery.refetch();
                        }}
                    />
                ) : departments.length === 0 ? (
                    <StateEmpty title="لا أقسام في هذا المدى" hint="غيّر الفترة أو أعد التحميل." />
                ) : (
                    <TableScroll label="جدول تكلفة الأقسام">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        القسم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        منصرف (عدد)
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        تكلفة الصرف
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        تشغيلي
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        تكلفة القسم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-end font-medium">
                                        إيراد الكاشيرية
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {departments.map((row) => (
                                    <tr key={textOf(row.code)} className="border-b border-hairline">
                                        <td className="px-sm py-xxs text-ink">{textOf(row.name) || '—'}</td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {qtyOf(row.issuedQty)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {moneyOf(row.issuedCost)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {moneyOf(row.expenseOperating)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {moneyOf(row.costTotal)}
                                        </td>
                                        <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                            {moneyOf(row.revenuePos)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </TableScroll>
                )}
                <p className="border-t border-hairline px-sm py-xs text-caption text-muted">
                    تكلفة القسم = تكلفة الصرف من الدفتر + المصروف التشغيلي؛ سطور المخزون التلقائية مستثناة لأنها نفس قيود الدفتر.
                </p>
            </SectionCard>

            {itemsQuery.isPending && problem === '' ? (
                <Card>
                    <TableSkeleton rows={5} columns={5} />
                </Card>
            ) : null}
        </div>
    );
}
