import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ItemDossier } from '../components/ItemDossier';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, RangeControls, ReportHeader, SectionCard } from '../components/Reports';
import { Card, StateEmpty, StateError, TableScroll, TableSkeleton } from '../components/TableState';
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
import { DataTable, type DataTableColumn } from '../ui';

/**
 * محرك استعلامات المخزون — قراءة فقط من `/api/inventory-inquiry`.
 *
 * يعرض: إجماليات المحرك، جدول الأصناف (دخل/منصرف/مبيع POS/مبيع المرآة/
 * التكلفة/الصلاحية)، بطاقة الصنف عند اختيار صف، وتكلفة الأقسام.
 *
 * `soldPos` و`soldYara` عمودان منفصلان دائمًا: الأول حقيقة بالمعرّف،
 * والثاني تقريب بالاسم المطبَّع — ولا يُجمعان.
 *
 * عقد الاستقرار (CLS = 0): شبكة المؤشرات تحجز مكانها بهيكل عظمي أثناء
 * التحميل، وجدول الأصناف DataTable بحالاته الأربع داخل منطقة تمرير ثابتة
 * الارتفاع (الصفوف الافتراضية فوق 50 صفًا — سقف الخادم 200)، فلا تدفع
 * البياناتُ القادمة الأقسامَ والأسفلَ خارج الشاشة. الفرز يبقى للخادم عبر
 * قائمة الترتيب: فرز محلي لقائمة مبتورة عند 200 يوحي بترتيب كامل وهو ليس
 * كذلك (نفس عقد حركات المخزون).
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
    const kpiLoading = itemsQuery.isPending && problem === '';

    /**
     * أعمدة الأصناف — القيم كما كانت حرفيًا (كميات ومبالغ لاتينية معزولة
     * الاتجاه، واسم الصنف زر يفتح البطاقة، والتصنيف سطر ثانٍ). لا فرز محلي:
     * الترتيب مسؤولية الخادم على كامل النتائج قبل بترها عند 200.
     */
    const columns = useMemo<DataTableColumn<InquiryRow>[]>(() => {
        const expiryToneClass = (tone: 'danger' | 'warning' | 'success' | 'neutral') =>
            tone === 'danger'
                ? 'text-danger-text'
                : tone === 'warning'
                  ? 'text-warning-text'
                  : tone === 'success'
                    ? 'text-success-text'
                    : 'text-muted';
        return [
            {
                key: 'item',
                header: 'الصنف',
                className: 'text-ink',
                cell: (row) => (
                    <>
                        <button
                            type="button"
                            onClick={() => {
                                setSelected(String(row.itemId));
                            }}
                            aria-pressed={String(row.itemId) === selected}
                            className="erp-inline-btn min-h-6 py-0.5 text-start text-ink underline-offset-2 hover:underline"
                        >
                            {textOf(row.itemName) || `#${String(row.itemId)}`}
                        </button>
                        <span className="block text-caption text-faint">
                            {textOf(row.category) || 'بلا تصنيف'}
                            {row.yaraMatched === false ? ' · بلا مطابقة مرآة' : ''}
                        </span>
                    </>
                ),
            },
            {
                key: 'onHand',
                header: 'الرصيد',
                align: 'end',
                className: 'erp-numeric text-ink',
                cell: (row) => <span dir="ltr">{qtyOf(row.onHand)}</span>,
            },
            {
                key: 'qtyIn',
                header: 'دخل',
                align: 'end',
                className: 'erp-numeric text-ink',
                cell: (row) => <span dir="ltr">{qtyOf(row.qtyInPurchases)}</span>,
            },
            {
                key: 'qtyOut',
                header: 'منصرف',
                align: 'end',
                className: 'erp-numeric text-ink',
                cell: (row) => <span dir="ltr">{qtyOf(row.qtyOutTotal)}</span>,
            },
            {
                key: 'soldPos',
                header: 'مبيع POS',
                align: 'end',
                className: 'erp-numeric text-ink',
                cell: (row) => <span dir="ltr">{qtyOf(row.soldPos)}</span>,
            },
            {
                key: 'soldYara',
                header: 'مبيع المرآة',
                align: 'end',
                className: 'erp-numeric text-muted',
                cell: (row) => <span dir="ltr">{qtyOf(row.soldYara)}</span>,
            },
            {
                key: 'stockValue',
                header: 'قيمة المخزون',
                align: 'end',
                className: 'erp-numeric text-ink',
                cell: (row) => <span dir="ltr">{moneyOf(row.stockValue)}</span>,
            },
            {
                key: 'expiry',
                header: 'الصلاحية',
                cell: (row) => {
                    const expiry = expiryState(textOf(row.nearestExpiry), today);
                    return <span className={expiryToneClass(expiry.tone)}>{expiry.label}</span>;
                },
            },
        ];
    }, [selected, today]);

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

            {/* شبكة المؤشرات تحجز ارتفاعها أثناء التحميل (هيكل عظمي داخل
                البطاقة نفسها) — لا تُدرَج بعد البيانات فتدفع ما أسفلها (CLS). */}
            <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="إجماليات المحرك">
                <KpiCard
                    label="قيمة المخزون"
                    english="Stock value"
                    loading={kpiLoading}
                    value={totals ? moneyOf(totals.stockValue) : '—'}
                    hint={totals ? `${intOf(totals.items)} صنفًا في النتائج` : '—'}
                />
                <KpiCard
                    label="داخل من الفواتير"
                    english="Received"
                    loading={kpiLoading}
                    value={totals ? qtyOf(totals.qtyInPurchases) : '—'}
                    hint="صافي مُوقَّع — يشمل عكوس الإلغاء والتعديل"
                    tone="success"
                />
                <KpiCard
                    label="المنصرف"
                    english="Issued"
                    loading={kpiLoading}
                    value={totals ? qtyOf(totals.qtyOutTotal) : '—'}
                    hint={totals ? `بتكلفة ${moneyOf(totals.outCost)}` : '—'}
                    tone="warning"
                />
                <KpiCard
                    label="تكلفة المشتريات"
                    english="Purchase cost"
                    loading={kpiLoading}
                    value={totals ? moneyOf(totals.purchaseCost) : '—'}
                    hint={totals ? `مبيع POS ${qtyOf(totals.qtySoldPos)} · إيراد ${moneyOf(totals.revenuePos)}` : '—'}
                />
            </ul>

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
                <DataTable<InquiryRow>
                    caption="جدول أصناف المخزون — حركة الدخول والانصراف والمبيع"
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => String(row.itemId)}
                    state={
                        problem !== ''
                            ? 'empty'
                            : itemsQuery.isPending
                              ? 'loading'
                              : itemsQuery.isError
                                ? 'error'
                                : rows.length === 0
                                  ? 'empty'
                                  : 'data'
                    }
                    loadingRows={9}
                    emptyTitle="لا أصناف تطابق المرشّحات"
                    emptyDescription={problem !== '' ? 'صحّح المدى الزمني أولًا.' : 'وسّع المدى أو امسح البحث.'}
                    errorMessage={errorMessage(itemsQuery.error)}
                    onRetry={() => {
                        void itemsQuery.refetch();
                    }}
                    manualFiltering
                    virtualizeThreshold={50}
                    rowHeight={52}
                    // ميزانية DOM: صفوف أقل خارج الرؤية تكفي لاستباق التمرير هنا.
                    overscan={5}
                    rowClassName={(row) => (String(row.itemId) === selected ? 'bg-surface-hover' : '')}
                />
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
                ) : departmentsQuery.isPending && problem === '' ? (
                    // هيكل عظمي ثابت أثناء التحميل — لا يومض «لا أقسام» ثم يقفز الجدول.
                    <>
                        <span role="status" className="sr-only">
                            جارٍ تحميل تكلفة الأقسام…
                        </span>
                        <TableSkeleton rows={5} columns={6} />
                    </>
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
                    تكلفة القسم = تكلفة الصرف من الدفتر + المصروف التشغيلي؛ سطور المخزون التلقائية مستثناة لأنها نفس
                    قيود الدفتر.
                </p>
            </SectionCard>
        </div>
    );
}
