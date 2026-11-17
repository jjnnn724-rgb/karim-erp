import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import './ExternalSales.premium.css';
import { PrintActions } from '../components/PrintActions';
import { KpiCard, ReportHeader, SectionCard } from '../components/Reports';
import { StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { errorMessage, intOf, moneyOf, qtyOf, textOf } from '../lib/reporting';
import { fetchExternalSales, sumQty, share } from '../lib/external-sales';
import { printExternalSalesReport } from '../lib/external-sales-print';
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
    const [tab, setTab] = useState<'sales' | 'issued'>('sales');
    const [salesQuery, setSalesQuery] = useState('');
    const [issuedQuery, setIssuedQuery] = useState('');
    const [salesSort, setSalesSort] = useState<{ key: 'name' | 'qty'; dir: 'asc' | 'desc' }>({ key: 'qty', dir: 'desc' });
    const [issuedSort, setIssuedSort] = useState<{ key: 'date' | 'value' | 'item'; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });

    const rangeInvalid = from > to || !ISO.test(from) || !ISO.test(to);

    const query = useQuery({
        queryKey: ['external-sales', from, to],
        queryFn: ({ signal }) => fetchExternalSales(from, to, signal),
        enabled: !rangeInvalid,
        staleTime: 60_000,
    });

    const summary = query.data;
    const totalIssued = summary?.issued.totals ?? null;
    const totalSold = summary?.sold.totals ?? null;
    const salesShare = summary && totalSold ? share(totalSold.qty, sumQty(summary.sold.byItem)) : 0;

    const filteredSold = useMemo(() => {
        if (!summary) {
            return [];
        }
        const needle = salesQuery.trim().toLowerCase();
        const base = needle
            ? summary.sold.byItem.filter((row) => row.item.toLowerCase().includes(needle))
            : summary.sold.byItem;
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
            ? summary.issued.rows.filter((row) =>
                  `${row.item} ${row.doc} ${row.date} ${row.status ?? ''}`.toLowerCase().includes(needle),
              )
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
            <PrintActions title="البيع الخارجي" />

            <ReportHeader
                title="البيع الخارجي — المبيعات مقابل المسحوبات"
                english="External sales — issued cost vs real sales"
                description="كل صنف كم اتباع من مرآة Oracle، وكل وحدة خرجت من المخزن على إذن صرف — بنفس الفترة."
                pending={query.isFetching}
                onRefresh={() => {
                    void query.refetch();
                }}
            />

            <div className="ext-filters" role="group" aria-label="فترة التقرير">
                <label className="ext-filters__date">
                    <span>من</span>
                    <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="erp-control" dir="ltr" aria-label="من تاريخ" />
                </label>
                <label className="ext-filters__date">
                    <span>إلى</span>
                    <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="erp-control" dir="ltr" aria-label="إلى تاريخ" />
                </label>
                <div className="ext-presets" role="group" aria-label="فترات سريعة">
                    <button type="button" className="ext-preset" onClick={() => applyPreset(1)}>اليوم</button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(7)}>٧ أيام</button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(30)}>٣٠ يومًا</button>
                    <button type="button" className="ext-preset" onClick={() => applyPreset(90)}>٣ أشهر</button>
                </div>
                <div className="ext-filters__actions">
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
            {query.isError ? (
                <StateError message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
            ) : null}
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

                    <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
                        <TabsList className="w-full justify-start overflow-x-auto">
                            <TabsTrigger value="sales">المبيعات لكل صنف</TabsTrigger>
                            <TabsTrigger value="issued">كل حركة مسحوبات (أذون الصرف)</TabsTrigger>
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
                                        <input id="ext-sales-search" type="search" className="erp-control" placeholder="ابحث باسم الصنف…" value={salesQuery} onChange={(e) => setSalesQuery(e.target.value)} />
                                    </label>
                                    <div className="ext-sort" role="group" aria-label="ترتيب المبيعات">
                                        <button type="button" aria-pressed={salesSort.key === 'qty' && salesSort.dir === 'desc'} className="ext-sort-btn" onClick={() => setSalesSort({ key: 'qty', dir: 'desc' })}>
                                            الكمية ↓
                                        </button>
                                        <button type="button" aria-pressed={salesSort.key === 'qty' && salesSort.dir === 'asc'} className="ext-sort-btn" onClick={() => setSalesSort({ key: 'qty', dir: 'asc' })}>
                                            الكمية ↑
                                        </button>
                                        <button type="button" aria-pressed={salesSort.key === 'name' && salesSort.dir === 'asc'} className="ext-sort-btn" onClick={() => setSalesSort({ key: 'name', dir: 'asc' })}>
                                            أ–ي
                                        </button>
                                    </div>
                                </div>
                                {filteredSold.length === 0 ? (
                                    <StateEmpty title="لا مبيعات مطابقة" hint={salesQuery ? 'غيّر كلمة البحث.' : 'لا توجد فواتير بيع خارجي في الفترة.'} />
                                ) : (
                                    <TableScroll label="جدول المبيعات حسب الصنف">
                                        <table className="ext-table">
                                            <thead>
                                                <tr>
                                                    <th scope="col">الصنف</th>
                                                    <th scope="col" className="text-end">الكمية المباعة</th>
                                                    <th scope="col" className="text-end">النسبة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredSold.map((row) => {
                                                    const pct = totalSold && totalSold.qty > 0 ? (row.qty / totalSold.qty) * 100 : 0;
                                                    return (
                                                        <tr key={row.item}>
                                                            <td className="ext-table__item">{row.item}</td>
                                                            <td className="erp-numeric text-end" dir="ltr">{qtyOf(row.qty)}</td>
                                                            <td className="ext-table__share">
                                                                <span className="ext-bar" style={{ ['--share' as string]: `${String(pct)}%` }} />
                                                                <span className="erp-numeric" dir="ltr">{`${pct.toFixed(1)}%`}</span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ext-table__total">
                                                    <td>الإجمالي (المعروض)</td>
                                                    <td className="erp-numeric text-end" dir="ltr">{qtyOf(sumQty(filteredSold))}</td>
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
                                        <input id="ext-issued-search" type="search" className="erp-control" placeholder="ابحث بالصنف أو رقم الإذن أو الحالة…" value={issuedQuery} onChange={(e) => setIssuedQuery(e.target.value)} />
                                    </label>
                                    <div className="ext-sort" role="group" aria-label="ترتيب المسحوبات">
                                        <button type="button" aria-pressed={issuedSort.key === 'date' && issuedSort.dir === 'desc'} className="ext-sort-btn" onClick={() => setIssuedSort({ key: 'date', dir: 'desc' })}>التاريخ ↓</button>
                                        <button type="button" aria-pressed={issuedSort.key === 'date' && issuedSort.dir === 'asc'} className="ext-sort-btn" onClick={() => setIssuedSort({ key: 'date', dir: 'asc' })}>التاريخ ↑</button>
                                        <button type="button" aria-pressed={issuedSort.key === 'value' && issuedSort.dir === 'desc'} className="ext-sort-btn" onClick={() => setIssuedSort({ key: 'value', dir: 'desc' })}>القيمة ↓</button>
                                        <button type="button" aria-pressed={issuedSort.key === 'item' && issuedSort.dir === 'asc'} className="ext-sort-btn" onClick={() => setIssuedSort({ key: 'item', dir: 'asc' })}>الصنف أ–ي</button>
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
                                                    <th scope="col" className="text-end">الكمية</th>
                                                    <th scope="col">الوحدة</th>
                                                    <th scope="col" className="text-end">تكلفة الوحدة</th>
                                                    <th scope="col" className="text-end">القيمة</th>
                                                    <th scope="col">الحالة</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredIssued.map((row, index) => (
                                                    <tr key={`${row.doc}-${row.item}-${index}`}>
                                                        <td className="ext-table__date" dir="ltr">{row.date}</td>
                                                        <td className="ext-table__doc" dir="ltr">{row.doc}</td>
                                                        <td className="ext-table__item">{row.item}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">{qtyOf(row.qty)}</td>
                                                        <td>{row.unit ?? '—'}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">{moneyOf(row.cost)}</td>
                                                        <td className="erp-numeric text-end" dir="ltr">{moneyOf(row.value)}</td>
                                                        <td><span className={`ext-pill ext-pill--${row.status === 'received' ? 'ok' : row.status === 'partially_received' ? 'warn' : 'mix'}`}>{row.status === 'received' ? 'مستلم' : row.status === 'partially_received' ? 'جزئي' : row.status === 'approved' ? 'معتمد' : textOf(row.status)}</span></td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot>
                                                <tr className="ext-table__total">
                                                    <td colSpan={3}>الإجمالي</td>
                                                    <td className="erp-numeric text-end" dir="ltr">{qtyOf(sumQty(filteredIssued))}</td>
                                                    <td />
                                                    <td />
                                                    <td className="erp-numeric text-end" dir="ltr">{moneyOf(filteredIssued.reduce((s, r) => s + r.value, 0))}</td>
                                                    <td />
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </TableScroll>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>
                </>
            ) : null}
        </div>
    );
}
