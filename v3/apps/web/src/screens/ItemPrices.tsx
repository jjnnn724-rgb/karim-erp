import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { fetchCurrency } from '../lib/finance';
import { formatMoney } from '../lib/format';
import { fetchInventoryRegister } from '../lib/inventory-register';
import {
    formatCost,
    formatPriceInt,
    itemToPriceRow,
    PRICE_PAGE_SIZE,
    PRICE_SORT_LABELS,
    PRICE_SORTS,
    type PriceSort,
    priceTotals,
    sortPriceRows,
} from '../lib/item-prices';

import { PageHeader } from '../ui';

/**
 * أسعار الأصناف — صفحة قراءة فقط لـ`inventory."avgCost"`.
 *
 * السعر يتحدّث أوتوماتيك مع كل فاتورة/استلام شراء (المتوسط المرجح) —
 * لا تعديل يدوي هنا ولا حقل تكلفة محلي: المصدر الوحيد هو ما تكتبه مسارات
 * الشراء في قاعدة البيانات، والشاشة مجرد عرض محدث لحظيًا. التعديل اليدوي
 * للتكلفة (لو محتاج) موجود في شاشة المخزون لدور `admin` فقط.
 */

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

export function ItemPrices() {
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');
    const [sort, setSort] = useState<PriceSort>('name-asc');
    const [page, setPage] = useState(1);

    // بحث متأخر 300ms — نفس نمط سجل المخزون.
    useEffect(() => {
        const timer = setTimeout(() => {
            setSearch(searchInput.trim());
        }, 300);
        return () => {
            clearTimeout(timer);
        };
    }, [searchInput]);

    const pricesQuery = useQuery({
        queryKey: ['inventory', 'prices', search, category],
        queryFn: ({ signal }) => fetchInventoryRegister({ q: search, category, stock: 'all' }, signal),
    });
    const currencyQuery = useQuery({
        queryKey: ['finance', 'currency'],
        queryFn: ({ signal }) => fetchCurrency(signal),
        staleTime: 10 * 60 * 1000,
    });
    const currency = currencyQuery.data ?? '';
    const withCurrency = (text: string) => `${formatMoney(text)}${currency ? ` ${currency}` : ''}`;

    const rows = useMemo(
        () => sortPriceRows((pricesQuery.data?.rows ?? []).map(itemToPriceRow), sort),
        [pricesQuery.data, sort],
    );
    const totals = useMemo(() => priceTotals(rows), [rows]);

    const categories = pricesQuery.data?.categories ?? [];
    const total = pricesQuery.data?.total ?? rows.length;
    const truncated = pricesQuery.data?.truncated ?? false;
    const fuzzy = pricesQuery.data?.fuzzy ?? false;

    const pageCount = Math.max(1, Math.ceil(rows.length / PRICE_PAGE_SIZE));
    const safePage = Math.min(page, pageCount);
    const pageRows = rows.slice((safePage - 1) * PRICE_PAGE_SIZE, safePage * PRICE_PAGE_SIZE);

    const resetFilters = () => {
        setSearchInput('');
        setSearch('');
        setCategory('all');
        setSort('name-asc');
        setPage(1);
    };

    return (
        <div className="flex flex-col gap-md">
            <PageHeader
                title="أسعار الأصناف"
                english="Item Prices"
                description="متوسط تكلفة الشراء لكل صنف — يتحدّث أوتوماتيك مع كل فاتورة/استلام شراء بالمتوسط المرجح."
                actions={
                    <>
                        <div className="flex items-center gap-xs" data-erp-print-hide>
                            <button
                                type="button"
                                onClick={() => {
                                    void pricesQuery.refetch();
                                }}
                                className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                            >
                                تحديث
                            </button>
                            <PrintActions title="أسعار الأصناف" />
                        </div>
                    </>
                }
            />

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الأصناف المعروضة"
                    english="Items"
                    value={formatPriceInt(totals.items)}
                    hint={
                        truncated
                            ? `معروض ${formatPriceInt(rows.length)} من ${formatPriceInt(total)} — ضيّق البحث`
                            : `من إجمالي ${formatPriceInt(total)} صنف في المخزن`
                    }
                />
                <Kpi
                    label="قيمة المخزون بتكلفة الشراء"
                    english="Stock Value"
                    value={withCurrency(totals.valueText)}
                    hint="الكمية × متوسط التكلفة — للمعروض الحالي"
                />
                <Kpi
                    label="أصناف بدون تكلفة"
                    english="Zero Cost"
                    value={formatPriceInt(totals.zeroCost)}
                    hint="لسه ما اتسجلش عليها شراء بالتكلفة"
                />
                <Kpi
                    label="أعلى تكلفة وحدة"
                    english="Highest Cost"
                    value={withCurrency(totals.maxCostText)}
                    hint={totals.maxCostName}
                />
            </div>

            <Card className="p-sm">
                <div className="flex flex-wrap items-end gap-sm" data-erp-print-hide>
                    <label
                        className="flex min-w-56 flex-1 flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-item-prices-search"
                    >
                        بحث
                        <input
                            id="erp-item-prices-search"
                            type="search"
                            value={searchInput}
                            placeholder="ابحث باسم الصنف أو الباركود…"
                            onChange={(event) => {
                                setSearchInput(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-item-prices-category"
                    >
                        الفئة
                        <select
                            id="erp-item-prices-category"
                            value={category}
                            onChange={(event) => {
                                setCategory(event.target.value);
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            <option value="all">كل الفئات</option>
                            {categories
                                .filter((name) => name !== 'all')
                                .map((name) => (
                                    <option key={name} value={name}>
                                        {name || 'بدون فئة'}
                                    </option>
                                ))}
                        </select>
                    </label>
                    <label
                        className="flex flex-col gap-xxs text-label-md text-ink-secondary"
                        htmlFor="erp-item-prices-sort"
                    >
                        الترتيب
                        <select
                            id="erp-item-prices-sort"
                            value={sort}
                            onChange={(event) => {
                                const value = event.target.value as PriceSort;
                                setSort(PRICE_SORTS.includes(value) ? value : 'name-asc');
                                setPage(1);
                            }}
                            className="h-9 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        >
                            {PRICE_SORTS.map((key) => (
                                <option key={key} value={key}>
                                    {PRICE_SORT_LABELS[key]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover"
                    >
                        مسح الفلاتر
                    </button>
                    <span className="text-body-sm text-muted">{formatPriceInt(rows.length)} صنف</span>
                </div>
            </Card>

            {!pricesQuery.isPending && !pricesQuery.isError ? (
                <p className="text-body-sm text-muted" role="status">
                    {`${formatPriceInt(rows.length)} صنف معروض — القيمة = الكمية × متوسط التكلفة`}
                    {fuzzy ? ' — بحث تقريبي بالحروف' : ''}
                    {truncated
                        ? ` — معروض أول ${formatPriceInt(rows.length)} من ${formatPriceInt(total)}؛ ضيّق البحث لرؤية الباقي`
                        : ''}
                </p>
            ) : null}

            <Card>
                {pricesQuery.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل الأسعار" />
                        <TableSkeleton rows={8} columns={5} />
                    </div>
                ) : null}

                {pricesQuery.isError ? (
                    <StateError
                        message={pricesQuery.error instanceof Error ? pricesQuery.error.message : 'تعذر تحميل الأسعار'}
                        onRetry={() => {
                            void pricesQuery.refetch();
                        }}
                    />
                ) : null}

                {!pricesQuery.isPending && !pricesQuery.isError && rows.length === 0 ? (
                    <StateEmpty title="لا توجد أصناف" hint="لم يتم العثور على أصناف مطابقة — عدّل البحث أو الفئة." />
                ) : null}

                {!pricesQuery.isPending && !pricesQuery.isError && rows.length > 0 ? (
                    <>
                        <TableScroll label="جدول أسعار الأصناف">
                            <table className="w-full border-collapse text-body-md">
                                <thead>
                                    <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الصنف
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-start font-medium">
                                            الفئة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-center font-medium">
                                            الكمية
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            متوسط التكلفة
                                        </th>
                                        <th scope="col" className="px-sm py-xs text-end font-medium">
                                            قيمة المخزون
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageRows.map((row) => (
                                        <tr key={row.id} className="border-b border-hairline hover:bg-surface-hover">
                                            <td className="px-sm py-xxs text-ink">
                                                <span className={row.nameResolved ? '' : 'text-muted'}>{row.name}</span>
                                                {row.barcode ? (
                                                    <span
                                                        className="block erp-numeric text-caption text-faint"
                                                        dir="ltr"
                                                    >
                                                        {row.barcode}
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {row.category || '—'}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-center text-ink" dir="ltr">
                                                {row.qtyText}
                                                {row.unit ? (
                                                    <span className="text-caption text-muted"> {row.unit}</span>
                                                ) : null}
                                            </td>
                                            <td className="px-sm py-xxs text-end">
                                                <span className="erp-numeric text-ink" dir="ltr">
                                                    {formatCost(row.costText)}
                                                </span>
                                                {row.zeroCost ? (
                                                    <span className="block text-caption text-warning-text">
                                                        بدون تكلفة
                                                    </span>
                                                ) : null}
                                            </td>
                                            <td className="erp-numeric px-sm py-xxs text-end text-ink" dir="ltr">
                                                {formatMoney(row.valueText)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="border-t border-hairline-strong bg-surface-sunken text-label-md text-ink-secondary">
                                        <td colSpan={4} className="px-sm py-xs text-end font-medium">
                                            إجمالي قيمة المعروض
                                        </td>
                                        <td className="erp-numeric px-sm py-xs text-end font-medium text-ink" dir="ltr">
                                            {formatMoney(totals.valueText)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </TableScroll>

                        <div
                            className="flex items-center justify-between gap-sm border-t border-hairline px-sm py-xs"
                            data-erp-print-hide
                        >
                            <span className="text-body-sm text-muted">
                                صفحة {formatPriceInt(safePage)} من {formatPriceInt(pageCount)}
                                {truncated ? ` — معروض ${formatPriceInt(rows.length)} من ${formatPriceInt(total)}` : ''}
                            </span>
                            <div className="flex gap-xs">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage - 1);
                                    }}
                                    disabled={safePage <= 1}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    السابق
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPage(safePage + 1);
                                    }}
                                    disabled={safePage >= pageCount}
                                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-body-sm text-ink hover:bg-surface-hover disabled:opacity-50"
                                >
                                    التالي
                                </button>
                            </div>
                        </div>
                    </>
                ) : null}
            </Card>
        </div>
    );
}
