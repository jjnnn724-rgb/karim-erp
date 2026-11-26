import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ScreenHero } from '../ui';
import './ExternalSales.premium.css';
import { KpiCard, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import {
    buildCoverageRows,
    COVERAGE_STATUS_LABEL,
    coverageSummary,
    deltaPct,
    fetchExternalSales,
    previousPeriod,
    share,
    sumQty,
    toCsv,
} from '../lib/external-sales';
import { printExternalSalesReport } from '../lib/external-sales-print';
import { errorMessage, intOf, moneyOf, qtyOf, textOf } from '../lib/reporting';
import { Button } from '../ui/Button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs';
import { useToast } from '../ui/Toast';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function riyadhToday(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}

function firstOfThisMonth(today: string): string {
    return `${today.slice(0, 7)}-01`;
}

function minusDays(today: string, days: number): string {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
}

export function ExternalSales() {
    const { toast } = useToast();
    const today = riyadhToday();
    const [from, setFrom] = useState(() => firstOfThisMonth(today));
    const [to, setTo] = useState(() => today);
    const [tab, setTab] = useState<'sales' | 'issued' | 'coverage'>('sales');
    const [salesQuery, setSalesQuery] = useState('');
    const [issuedQuery, setIssuedQuery] = useState('');
    const [coverageQuery, setCoverageQuery] = useState('');
    const [coverageSort, setCoverageSort] = useState<{ key: 'value' | 'coverage' | 'name'; dir: 'asc' | 'desc' }>({
        key: 'value',
        dir: 'desc',
    });
    const [lossOnly, setLossOnly] = useState(false);
    const [salesSort, setSalesSort] = useState<{ key: 'name' | 'qty'; dir: 'asc' | 'desc' }>({ key: 'qty', dir: 'desc' });
    const [issuedSort, setIssuedSort] = useState<{ key: 'date' | 'value' | 'item'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

    const rangeInvalid = from > to || !ISO.test(from) || !ISO.test(to);

    const query = useQuery({
        queryKey: ['external-sales', from, to],
        queryFn: ({ signal }) => fetchExternalSales(from, to, signal),
        enabled: !rangeInvalid,
        staleTime: 60_000,
    });
    const { prevFrom, prevTo } = useMemo(() => previousPeriod(from, to), [from, to]);
    const previousQuery = useQuery({
        queryKey: ['external-sales', prevFrom, prevTo],
        queryFn: ({ signal }) => fetchExternalSales(prevFrom, prevTo, signal),
        enabled: !rangeInvalid,
        staleTime: 60_000,
    });

    const summary = query.data;
    const previous = previousQuery.data;
    const coverageRows = useMemo(() => (summary ? buildCoverageRows(summary) : []), [summary]);
    const covTotals = useMemo(() => coverageSummary(coverageRows), [coverageRows]);

    // مقارنة الفترة السابقة (نفس طول الفترة الحالية)
    const comparisons = useMemo(() => {
        if (!summary || !previous) {
            return null;
        }
        const mk = (label: string, current: number, prev: number, higherIsBetter: boolean) => {
            const pct = deltaPct(current, prev);
            const up = pct === null ? null : pct >= 0;
            return { label, pct, good: up === null ? null : up === higherIsBetter };
        };
        return [
            mk('الإيرادات', Number(summary.sold.totals?.amount ?? 0), Number(previous.sold.totals?.amount ?? 0), true),
            mk('قيمة المسحوبات', Number(summary.issued.totals?.value ?? 0), Number(previous.issued.totals?.value ?? 0), false),
            mk(
                'الصافي',
                Number(summary.sold.totals?.amount ?? 0) - Number(summary.issued.totals?.value ?? 0),
                Number(previous.sold.totals?.amount ?? 0) - Number(previous.issued.totals?.value ?? 0),
                true,
            ),
            mk('الوحدات المباعة', Number(summary.sold.totals?.qty ?? 0), Number(previous.sold.totals?.qty ?? 0), true),
        ];
    }, [summary, previous]);

    const coverageQueryTrimmed = coverageQuery.trim().toLowerCase();
    const filteredCoverage = useMemo(() => {
        let rows = coverageRows;
        if (lossOnly) {
            rows = rows.filter((row) => row.status === 'no-sales');
        }
        if (coverageQueryTrimmed) {
            rows = rows.filter((row) => row.item.toLowerCase().includes(coverageQueryTrimmed));
        }
        const sign = coverageSort.dir === 'asc' ? 1 : -1;
        const sorted = [...rows];
        sorted.sort((a, b) => {
            if (coverageSort.key === 'name') {
                return sign * a.item.localeCompare(b.item, 'ar');
            }
            if (coverageSort.key === 'coverage') {
                const ca = a.coverage ?? -1;
                const cb = b.coverage ?? -1;
                return sign * (ca - cb);
            }
            return sign * (a.issuedValue - b.issuedValue);
        });
        return sorted;
    }, [coverageRows, coverageQueryTrimmed, coverageSort, lossOnly]);

    const visibleCoverageTotals = useMemo(
        () => ({
            soldQty: filteredCoverage.reduce((sum, row) => sum + row.soldQty, 0),
            issuedQty: filteredCoverage.reduce((sum, row) => sum + row.issuedQty, 0),
            issuedValue: Math.round(filteredCoverage.reduce((sum, row) => sum + row.issuedValue, 0) * 100) / 100,
        }),
        [filteredCoverage],
    );

    const noSalesTop = useMemo(() => coverageRows.filter((row) => row.status === 'no-sales').slice(0, 3), [coverageRows]);

    function downloadCsv(filename: string, csv: string) {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    function exportSalesCsv() {
        if (!summary) {
            return;
        }
        const rows: (string | number)[][] = summary.sold.rows.map((row) => [
            row.date,
            row.ref,
            row.customer ?? '',
            row.items,
            row.qty,
            row.amount,
        ]);
        rows.push([
            'الإجمالي',
            `${summary.sold.totals?.invoices ?? 0} فاتورة`,
            '',
            summary.sold.totals?.lines ?? 0,
            summary.sold.totals?.qty ?? 0,
            soldAmount,
        ]);
        downloadCsv(
            `external-sales-sold-${from}-${to}.csv`,
            toCsv(['التاريخ', 'المرجع', 'العميل', 'عدد البنود', 'الكمية', 'المبلغ'], rows),
        );
    }

    function exportIssuedCsv() {
        if (!summary) {
            return;
        }
        const rows: (string | number)[][] = summary.issued.rows.map((row) => [
            row.date,
            row.doc,
            row.item,
            row.unit ?? '',
            row.qty,
            row.cost,
            row.value,
            row.status ?? '',
        ]);
        rows.push([
            'الإجمالي',
            `${summary.issued.totals?.docs ?? 0} إذن صرف`,
            '',
            '',
            summary.issued.totals?.qty ?? 0,
            '',
            issuedValue,
            '',
        ]);
        downloadCsv(
            `external-sales-issued-${from}-${to}.csv`,
            toCsv(['التاريخ', 'إذن الصرف', 'الصنف', 'الوحدة', 'الكمية', 'التكلفة', 'القيمة', 'الحالة'], rows),
        );
    }

    function exportCoverageCsv() {
        if (!coverageRows.length) {
            return;
        }
        const rows = coverageRows.map(
            (row) =>
                [
                    row.item,
                    row.soldQty,
                    row.issuedQty,
                    row.coverage === null ? '' : `${(row.coverage * 100).toFixed(1)}%`,
                    row.issuedValue,
                    COVERAGE_STATUS_LABEL[row.status],
                ] as const,
        );
        downloadCsv(
            `external-sales-coverage-${from}-${to}.csv`,
            toCsv(['الصنف', 'مباع (وحدة)', 'مسحوب (وحدة)', 'التغطية', 'القيمة المسحوبة', 'الحالة'], rows),
        );
    }

    const totalIssued = summary?.issued.totals ?? null;
    const totalSold = summary?.sold.totals ?? null;
    const salesShare = summary && totalSold ? share(totalSold.qty, sumQty(summary.sold.byItem)) : 0;

    const filteredSold = useMemo(() => {
        if (!summary) {
            return [];
        }
        const needle = salesQuery.trim().toLowerCase();
        const base = needle ? summary.sold.byItem.filter((row) => row.item.toLowerCase().includes(needle)) : summary.sold.byItem;
        return [...base].sort((a, b) => {
            const sign = salesSort.dir === 'asc' ? 1 : -1;
            if (salesSort.key === 'name') {
                return sign * a.item.localeCompare(b.item, 'ar');
            }
            return sign * (a.qty - b.qty);
        });
    }, [summary, salesQuery, salesSort]);

    const filteredIssued = useMemo(() => {
        if (!summary) {
            return [];
        }
        const needle = issuedQuery.trim().toLowerCase();
        const rows = needle
            ? summary.issued.rows.filter((row) => `${row.item} ${row.doc} ${row.date} ${row.status ?? ''}`.toLowerCase().includes(needle))
            : summary.issued.rows;
        const sorted = [...rows];
        const sign = issuedSort.dir === 'asc' ? 1 : -1;
        sorted.sort((a, b) => {
            if (issuedSort.key === 'date') {
                return sign * String(a.date).localeCompare(String(b.date)) || sign * String(a.doc).localeCompare(String(b.doc));
            }
            if (issuedSort.key === 'item') {
                return sign * a.item.localeCompare(b.item, 'ar');
            }
            return sign * (a.value - b.value);
        });
        return sorted;
    }, [summary, issuedQuery, issuedSort]);

    function applyPreset(days: number) {
        setFrom(minusDays(today, days));
        setTo(today);
    }

    function handlePrint() {
        if (!summary) {
            return;
        }
        const ok = printExternalSalesReport(summary);
        if (!ok) {
            toast({ title: 'تعذر فتح نافذة الطباعة', variant: 'error' });
        }
    }

    const headerPending = query.isPending && !rangeInvalid;
    const issuedValue = totalIssued?.value ?? 0;
    const soldAmount = totalSold?.amount ?? 0;
    const netExternal = soldAmount - issuedValue;

    return (
        <div className="erp-premium-screen ext-sales flex flex-col gap-md">
            <ScreenHero
                title="البيع الخارجي — المبيعات مقابل المسحوبات"
                english="External sales — issued cost vs real sales"
                description="كل صنف كم اتباع من مرآة Oracle، وكل وحدة خرجت من المخزن على إذن صرف — بنفس الفترة."
                actions={
                    <button
                        type="button"
                        onClick={() => {
                            () => {
                                void query.refetch();
                            };
                        }}
                        disabled={query.isFetching}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover disabled:opacity-50"
                    >
                        تحديث
                    </button>
                }
            />

            <div className="ext-filters" role="group" aria-label="فترة التقرير">
                <label className="ext-filters__date">
                    <span>من</span>
                    <input
                        type="date"
                        value={from}
                        max={to}
                        onChange={(e) => setFrom(e.target.value)}
                        className="erp-control"
                        dir="ltr"
                        aria-label="من تاريخ"
                    />
                </label>
                <label className="ext-filters__date">
                    <span>إلى</span>
                    <input
                        type="date"
                        value={to}
                        min={from}
                        onChange={(e) => setTo(e.target.value)}
                        className="erp-control"
                        dir="ltr"
                        aria-label="إلى تاريخ"
                    />
                </label>
                <div className="ext-presets" role="group" aria-label="فترات سريعة">
                    <button type="button" className="ext-preset" onClick={() => applyPreset(1)}>
                        اليوم
                    </button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(7)}>
                        ٧ أيام
                    </button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(30)}>
                        ٣٠ يومًا
                    </button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(90)}>
                        ٣ أشهر
                    </button>
                </div>
                <div className="ext-filters__actions">
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={exportSalesCsv}
                        disabled={!summary || query.isFetching}
                        title="تصدير المبيعات لكل فاتورة CSV"
                    >
                        مبيعات CSV
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={exportIssuedCsv}
                        disabled={!summary || query.isFetching}
                        title="تصدير كل حركة مسحوبات من إذن الصرف CSV"
                    >
                        مسحوبات CSV
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={exportCoverageCsv}
                        disabled={coverageRows.length === 0 || query.isFetching}
                        title="تصدير مطابقة الأصناف (مباع مقابل مسحوب) CSV"
                    >
                        الأصناف CSV
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={() => void query.refetch()} disabled={rangeInvalid}>
                        تحديث
                    </Button>
                    <Button type="button" size="sm" onClick={handlePrint} disabled={!summary || query.isFetching}>
                        طباعة التقرير الرسمي
                    </Button>
                </div>
            </div>

            {rangeInvalid ? (
                <p role="alert" className="text-body-sm text-danger-text">
                    تاريخ «من» بعد تاريخ «إلى» — صحّح الفترة.
                </p>
            ) : null}

            {headerPending ? <StateLoading label="جارٍ قراءة بيانات البيع الخارجي والمسحوبات…" /> : null}
            {query.isError ? <StateError message={errorMessage(query.error)} onRetry={() => void query.refetch()} /> : null}
            {query.isPending && !query.isError ? (
                <SectionCard title="البيانات" english="Loading">
                    <TableSkeleton rows={5} columns={6} />
                </SectionCard>
            ) : null}

            {summary && !rangeInvalid ? (
                <>
                    <ul className="grid list-none gap-sm sm:grid-cols-2 xl:grid-cols-4" aria-label="مؤشرات البيع الخارجي">
                        <KpiCard
                            label="قيمة المسحوبات"
                            english="Issued cost"
                            value={moneyOf(issuedValue)}
                            hint={`${intOf(totalIssued?.docs ?? 0)} إذن صرف · ${String(totalIssued?.lines ?? 0)} بند · ${intOf(totalIssued?.qty ?? 0)} وحدة`}
                            tone="warning"
                        />
                        <KpiCard
                            label="الوحدات المصارفة"
                            english="Issued qty"
                            value={qtyOf(totalIssued?.qty ?? 0)}
                            hint="كل حركة خروج مسجلة على إذن صرف لقسم البيع الخارجي"
                        />
                        <KpiCard
                            label="إيرادات البيع الخارجي"
                            english="Sales revenue"
                            value={moneyOf(soldAmount)}
                            hint={`${intOf(totalSold?.invoices ?? 0)} فاتورة · ${intOf(totalSold?.qty ?? 0)} وحدة مباعة`}
                            tone="success"
                        />
                        <KpiCard
                            label="صافي البيع الخارجي"
                            english="Net = revenue − issued"
                            value={moneyOf(netExternal)}
                            hint="الإيرادات ناقص تكلفة المسحوبات (كوست، لا ربح محاسبي)"
                            tone={netExternal >= 0 ? 'success' : 'danger'}
                        />
                    </ul>

                    {comparisons ? (
                        <div className="ext-compare" role="status" aria-label="مقارنة بالفترة السابقة">
                            <span className="ext-compare__title">
                                مقارنة بالفترة السابقة ({prevFrom} ← {prevTo})
                            </span>
                            {comparisons.map((item) => (
                                <span
                                    key={item.label}
                                    className={`ext-compare__item${item.good === null ? '' : item.good ? ' ext-compare__item--up' : ' ext-compare__item--down'}`}
                                >
                                    {item.label}{' '}
                                    {item.pct === null ? '—' : `${item.pct >= 0 ? '▲' : '▼'} ${Math.abs(item.pct).toFixed(1)}%`}
                                </span>
                            ))}
                        </div>
                    ) : null}

                    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
                        <TabsList className="w-full justify-start overflow-x-auto">
                            <TabsTrigger value="sales">المبيعات لكل صنف</TabsTrigger>
                            <TabsTrigger value="issued">كل حركة مسحوبات (أذون الصرف)</TabsTrigger>
                            <TabsTrigger value="coverage">الأصناف: مباع مقابل مسحوب</TabsTrigger>
                        </TabsList>

                        <TabsContent value="sales" className="mt-md">
                            <div className="ext-section">
                                <div className="ext-section__head">
                                    <p className="ext-section__meta" role="status">
                                        {`${intOf(summary.sold.byItem.length)} صنفًا مختلفًا · ${intOf(totalSold?.qty ?? 0)} وحدة مباعة · ${intOf(totalSold?.invoices ?? 0)} فاتورة`}
                                        {salesShare > 0 ? ` · أعلى صنف = ${salesShare.toFixed(1)}% من الوحدات` : ''}
                                    </p>
                                    <label className="ext-search" htmlFor="ext-sales-search">
                                        <span className="sr-only">بحث باسم الصنف</span>
                                        <input
                                            id="ext-sales-search"
                                            type="search"
                                            className="erp-control"
                                            placeholder="ابحث باسم الصنف…"
                                            value={salesQuery}
                                            onChange={(e) => setSalesQuery(e.target.value)}
                                        />
                                    </label>
                                    <div className="ext-sort" role="group" aria-label="ترتيب المبيعات">
                                        <button
                                            type="button"
                                            aria-pressed={salesSort.key === 'qty' && salesSort.dir === 'desc'}
                                            className="ext-sort-btn"
                                            onClick={() => setSalesSort({ key: 'qty', dir: 'desc' })}
                                        >
                                            الكمية ↓
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={salesSort.key === 'qty' && salesSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setSalesSort({ key: 'qty', dir: 'asc' })}
                                        >
                                            الكمية ↑
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={salesSort.key === 'name' && salesSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setSalesSort({ key: 'name', dir: 'asc' })}
                                        >
                                            أ–ي
                                        </button>
                                    </div>
                                </div>
                                {filteredSold.length === 0 ? (
                                    <StateEmpty
                                        title="لا مبيعات مطابقة"
                                        hint={salesQuery ? 'غيّر كلمة البحث.' : 'لا توجد فواتير بيع خارجي في الفترة.'}
                                    />
                                ) : (
                                    <TableScroll label="جدول المبيعات حسب الصنف">
                                        <table className="ext-table">
                                            <thead>
                                                <tr>
                                                    <th scope="col">الصنف</th>
                                                    <th scope="col" className="text-end">
                                                        الكمية المباعة
                                                    </th>
                                                    <th scope="col" className="text-end">
                                                        النسبة
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredSold.map((row) => {
                                                    const pct = totalSold && totalSold.qty > 0 ? (row.qty / totalSold.qty) * 100 : 0;
                                                    return (
                                                        <tr key={row.item}>
                                                            <td className="ext-table__item">{row.item}</td>
                                                            <td className="erp-numeric text-end" dir="ltr">
                                                                {qtyOf(row.qty)}
                                                            </td>
                                                            <td className="ext-table__share">
                                                                <span
                                                                    className="ext-bar"
                                                                    style={{ ['--share' as string]: `${String(pct)}%` }}
                                                                />
                                                                <span className="erp-numeric" dir="ltr">{`${pct.toFixed(1)}%`}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ext-table__total">
                                                    <td>الإجمالي (المعروض)</td>
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {qtyOf(sumQty(filteredSold))}
                                                    </td>
                                                    <td className="text-end text-caption text-muted">{`من ${intOf(totalSold?.qty ?? 0)} وحدة`}</td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </TableScroll>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="issued" className="mt-md">
                            <div className="ext-section">
                                <div className="ext-section__head">
                                    <p className="ext-section__meta" role="status">
                                        {`${intOf(summary.issued.byItem.length)} صنفًا مختلفًا · ${intOf(filteredIssued.length)} حركة`}
                                        {summary.issued.capped ? ' · يعرض آخر ٦٠٠ حركة فقط' : ''}
                                    </p>
                                    <label className="ext-search" htmlFor="ext-issued-search">
                                        <span className="sr-only">بحث في المسحوبات</span>
                                        <input
                                            id="ext-issued-search"
                                            type="search"
                                            className="erp-control"
                                            placeholder="ابحث بالصنف أو رقم الإذن أو الحالة…"
                                            value={issuedQuery}
                                            onChange={(e) => setIssuedQuery(e.target.value)}
                                        />
                                    </label>
                                    <div className="ext-sort" role="group" aria-label="ترتيب المسحوبات">
                                        <button
                                            type="button"
                                            aria-pressed={issuedSort.key === 'date' && issuedSort.dir === 'desc'}
                                            className="ext-sort-btn"
                                            onClick={() => setIssuedSort({ key: 'date', dir: 'desc' })}
                                        >
                                            التاريخ ↓
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={issuedSort.key === 'date' && issuedSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setIssuedSort({ key: 'date', dir: 'asc' })}
                                        >
                                            التاريخ ↑
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={issuedSort.key === 'value' && issuedSort.dir === 'desc'}
                                            className="ext-sort-btn"
                                            onClick={() => setIssuedSort({ key: 'value', dir: 'desc' })}
                                        >
                                            القيمة ↓
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={issuedSort.key === 'item' && issuedSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setIssuedSort({ key: 'item', dir: 'asc' })}
                                        >
                                            الصنف أ–ي
                                        </button>
                                    </div>
                                </div>
                                {filteredIssued.length === 0 ? (
                                    <StateEmpty title="لا مسحوبات مطابقة" hint="غيّر كلمة البحث أو الفترة." />
                                ) : (
                                    <TableScroll label="جدول حركات المسحوبات على أذون الصرف">
                                        <table className="ext-table ext-table--issued">
                                            <thead>
                                                <tr>
                                                    <th scope="col">التاريخ</th>
                                                    <th scope="col">رقم الإذن</th>
                                                    <th scope="col">الصنف</th>
                                                    <th scope="col" className="text-end">
                                                        الكمية
                                                    </th>
                                                    <th scope="col">الوحدة</th>
                                                    <th scope="col" className="text-end">
                                                        تكلفة الوحدة
                                                    </th>
                                                    <th scope="col" className="text-end">
                                                        القيمة
                                                    </th>
                                                    <th scope="col">الحالة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredIssued.map((row, index) => (
                                                    <tr key={`${row.doc}-${row.item}-${index}`}>
                                                        <td className="ext-table__date" dir="ltr">
                                                            {row.date}
                                                        </td>
                                                        <td className="ext-table__doc" dir="ltr">
                                                            {row.doc}
                                                        </td>
                                                        <td className="ext-table__item">{row.item}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {qtyOf(row.qty)}
                                                        </td>
                                                        <td>{row.unit ?? '—'}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {moneyOf(row.cost)}
                                                        </td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {moneyOf(row.value)}
                                                        </td>
                                                        <td>
                                                            <span
                                                                className={`ext-pill ext-pill--${row.status === 'received' ? 'ok' : row.status === 'partially_received' ? 'warn' : 'mix'}`}
                                                            >
                                                                {row.status === 'received'
                                                                    ? 'مستلم'
                                                                    : row.status === 'partially_received'
                                                                      ? 'جزئي'
                                                                      : row.status === 'approved'
                                                                        ? 'معتمد'
                                                                        : textOf(row.status)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ext-table__total">
                                                    <td colSpan={3}>الإجمالي</td>
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {qtyOf(sumQty(filteredIssued))}
                                                    </td>
                                                    <td />
                                                    <td />
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {moneyOf(filteredIssued.reduce((s, r) => s + r.value, 0))}
                                                    </td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </TableScroll>
                                )}
                            </div>
                        </TabsContent>

                        <TabsContent value="coverage" className="mt-md">
                            <div className="ext-section">
                                <div className="ext-section__head">
                                    <p className="ext-section__meta" role="status">
                                        {`${intOf(coverageRows.length)} صنفًا · بلا مبيعات ${intOf(covTotals.noSalesCount)} بقيمة ${moneyOf(covTotals.noSalesValue)}`}
                                    </p>
                                    <label className="ext-search" htmlFor="ext-coverage-search">
                                        <span className="sr-only">ابحث باسم الصنف</span>
                                        <input
                                            id="ext-coverage-search"
                                            type="search"
                                            className="erp-control"
                                            placeholder="ابحث باسم الصنف…"
                                            value={coverageQuery}
                                            onChange={(e) => setCoverageQuery(e.target.value)}
                                        />
                                    </label>
                                    <div className="ext-sort" role="group" aria-label="ترتيب مطابقة الأصناف">
                                        <button
                                            type="button"
                                            aria-pressed={coverageSort.key === 'value' && coverageSort.dir === 'desc'}
                                            className="ext-sort-btn"
                                            onClick={() => setCoverageSort({ key: 'value', dir: 'desc' })}
                                        >
                                            الأعلى قيمة ↓
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={coverageSort.key === 'value' && coverageSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setCoverageSort({ key: 'value', dir: 'asc' })}
                                        >
                                            الأعلى قيمة ↑
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={coverageSort.key === 'coverage' && coverageSort.dir === 'desc'}
                                            className="ext-sort-btn"
                                            onClick={() => setCoverageSort({ key: 'coverage', dir: 'desc' })}
                                        >
                                            التغطية ↓
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={coverageSort.key === 'coverage' && coverageSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setCoverageSort({ key: 'coverage', dir: 'asc' })}
                                        >
                                            التغطية ↑
                                        </button>
                                        <button
                                            type="button"
                                            aria-pressed={coverageSort.key === 'name' && coverageSort.dir === 'asc'}
                                            className="ext-sort-btn"
                                            onClick={() => setCoverageSort({ key: 'name', dir: 'asc' })}
                                        >
                                            الاسم أ→ي
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        aria-pressed={lossOnly}
                                        className="ext-toggle"
                                        onClick={() => setLossOnly((value) => !value)}
                                    >
                                        تشخيص الخسارة فقط
                                    </button>
                                </div>
                                {lossOnly && noSalesTop.length > 0 ? (
                                    <div className="ext-loss-banner" role="alert">
                                        <p className="ext-loss-banner__title">
                                            أصناف صُرفت من المخزن ولم تُباع في الفترة ({intOf(covTotals.noSalesCount)})
                                        </p>
                                        <p>
                                            قيمة {moneyOf(covTotals.noSalesValue)} — الأعلى قيمة:{' '}
                                            {noSalesTop.map((row) => row.item).join(' · ')}
                                        </p>
                                    </div>
                                ) : null}
                                {filteredCoverage.length === 0 ? (
                                    <StateEmpty
                                        title={lossOnly ? 'لا أصناف بلا مبيعات بالمرشّحات الحالية' : 'لا أصناف تطابق المرشّحات'}
                                        hint={lossOnly ? 'شيل «تشخيص الخسارة فقط» لعرض كل الأصناف.' : 'عدّل البحث أو امسحه.'}
                                    />
                                ) : (
                                    <TableScroll label="جدول مطابقة الأصناف (مباع مقابل مسحوب)">
                                        <table className="ext-table ext-table--coverage">
                                            <thead>
                                                <tr>
                                                    <th scope="col">الصنف</th>
                                                    <th scope="col" className="text-end">
                                                        مباع (وحدة)
                                                    </th>
                                                    <th scope="col" className="text-end">
                                                        مسحوب (وحدة)
                                                    </th>
                                                    <th scope="col" className="text-end">
                                                        التغطية
                                                    </th>
                                                    <th scope="col" className="text-end">
                                                        القيمة المسحوبة
                                                    </th>
                                                    <th scope="col">الحالة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredCoverage.map((row) => (
                                                    <tr key={row.item}>
                                                        <td className="ext-table__item">{row.item}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {qtyOf(row.soldQty)}
                                                        </td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {qtyOf(row.issuedQty)}
                                                        </td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {row.coverage === null ? '—' : `${(row.coverage * 100).toFixed(1)}%`}
                                                        </td>
                                                        <td className="erp-numeric text-end" dir="ltr">
                                                            {moneyOf(row.issuedValue)}
                                                        </td>
                                                        <td>
                                                            <span
                                                                className={`ext-pill ext-pill--${row.status === 'covered' ? 'ok' : row.status === 'partial' ? 'warn' : row.status === 'no-sales' ? 'danger' : 'info'}`}
                                                            >
                                                                {COVERAGE_STATUS_LABEL[row.status]}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ext-table__total">
                                                    <td>الإجمالي</td>
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {qtyOf(visibleCoverageTotals.soldQty)}
                                                    </td>
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {qtyOf(visibleCoverageTotals.issuedQty)}
                                                    </td>
                                                    <td className="text-end text-caption text-muted">مباع ÷ مسحوب</td>
                                                    <td className="erp-numeric text-end" dir="ltr">
                                                        {moneyOf(visibleCoverageTotals.issuedValue)}
                                                    </td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </TableScroll>
                                )}
                                <p className="ext-section__foot">
                                    «مباع» من مرآة Oracle (الكمية فقط — الفاتورة المسجلة لا تخزّن سعر البند، فالربح لكل صنف غير متاح من هذا
                                    المصدر) · «مسحوب» من حركات الخروج على أذون الصرف · «بلا مبيعات» = صُرفت الكمية من المخزن ولم يُبع منها شيء
                                    في الفترة — اقرأه كتسريب/هالك أو بضاعة لم تصل للمورد.
                                </p>
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            ) : null}
        </div>
    );
}
