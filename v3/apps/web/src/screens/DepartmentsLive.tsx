/**
 * DepartmentsLive — ⚜ الكاشيرية الحيّة داخل «الأقسام»
 * ────────────────────────────────────────────────────────────
 * شاشة لحظية بالكامل: مبيعات اليوم تتحدث كل ٣٠ ثانية، بلا أي تحديث يدوي:
 *   · شريط كربوني/ذهبي فيه الساعة الحيّة واليوم وجميع الفواتير ×2 كل دقيقة.
 *   · ٤ بطاقات KPI بزجاج ذهبي فوق المشهد (كاشير أشد لحظة حية).
 *   · شبكة كاشيريات: كل كاشير يعيش بذاكرته — عدد فواتير، مبيعات، نقد، شبكة، جوال،
 *     وآخر عملية — وبنقرة واحدة تتفّرم إليه بصمة كل فاحورة.
 *   · جدول «كل الفواتير»: رقم الإيصال، الوقت، الكاشير، الأصناف، طريقة الدفع، الإجمالي —
 *     وزر 🖨 بجانب كل فاتورة تطبع مستند الخادم 80مم كما يطبعه الكاشير بالضبط.
 *
 * البيانات: YaraSoft عبر `/api/cashier-monitor/*` (حية live=1) — لا تقديرات،
 * الشرط حرفي من المصدر الخام.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchMonitorInvoiceHtml,
    fetchMonitorOrders,
    fetchMonitorSummary,
    monitorCashierLabel,
    orderTimeText,
    type MonitorCashier,
    type MonitorOrder,
} from '../lib/cashier-monitor';
import { printSmart } from '../lib/print-viewer';
import { errorMessage, intOf, moneyOf, textOf, todayIso } from '../lib/reporting';
import { useToast } from '../ui/Toast';
import { Button } from '../ui/Button';

const LIVE_MS = 30_000;
const PAGE = 60;

function payLabel(row: MonitorOrder): { label: string; tone: 'cash' | 'net' | 'mobile' | 'credit' | 'mix' } {
    const cash = Number(row.pay_cash ?? 0);
    const net = Number(row.pay_network ?? 0);
    const mobile = Number(row.pay_mobile ?? 0);
    const credit = Number(row.pay_credit ?? 0);
    const counts = [cash, net, mobile, credit].filter((v) => v > 0).length;
    if (counts > 1) { return { label: 'مختلط', tone: 'mix' }; }
    if (cash > 0) { return { label: 'نقد', tone: 'cash' }; }
    if (net > 0) { return { label: 'شبكة', tone: 'net' }; }
    if (mobile > 0) { return { label: 'جوال', tone: 'mobile' }; }
    if (credit > 0) { return { label: 'تقسيط', tone: 'credit' }; }
    return { label: '—', tone: 'mix' };
}

function netAmount(row: MonitorOrder): string {
    return moneyOf(row.total ?? row.net ?? null);
}

function cashierRevenue(cashier: MonitorCashier): number {
    return Number(cashier.revenue ?? 0);
}

function sumBy(cashiers: MonitorCashier[], key: keyof MonitorCashier): number {
    return cashiers.reduce((total, c) => total + Number(c[key] ?? 0), 0);
}

function cashierColor(seed: string): string {
    const palette = ['#c8a24a', '#3f9e77', '#4f8fd1', '#b45fc9', '#e0658a', '#e0a13e'];
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) { hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0; }
    return palette[Math.abs(hash) % palette.length] ?? '#c8a24a';
}

function relativeDay(dateStr: string): string {
    const today = todayIso();
    if (dateStr === today) { return 'اليوم'; }
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (dateStr === yesterday) { return 'أمس'; }
    return dateStr;
}

export function DepartmentsLive() {
    const [date, setDate] = useState(() => todayIso());
    const [cashier, setCashier] = useState('');
    const [query, setQuery] = useState('');
    const [offset, setOffset] = useState(0);
    const [printingDoc, setPrintingDoc] = useState('');
    const { toast } = useToast();

    useEffect(() => { setOffset(0); }, [date, cashier]);

    const summaryQuery = useQuery({
        queryKey: ['departments-live', 'summary', date],
        queryFn: ({ signal }) => fetchMonitorSummary(date, signal),
        refetchInterval: LIVE_MS,
    });

    const ordersQuery = useQuery({
        queryKey: ['departments-live', 'orders', date, cashier, offset],
        queryFn: ({ signal }) => fetchMonitorOrders({ date, cashier, limit: PAGE, offset }, signal),
        refetchInterval: LIVE_MS,
        placeholderData: (previous) => previous,
    });

    const cashiers = useMemo(() => summaryQuery.data?.cashiers ?? [], [summaryQuery.data]);
    const orders = useMemo(() => ordersQuery.data?.orders ?? [], [ordersQuery.data]);
    const totalOrders = Number(ordersQuery.data?.total ?? 0);

    const totals = useMemo(() => ({
        revenue: sumBy(cashiers, 'revenue'),
        invoices: sumBy(cashiers, 'invoices'),
        cash: sumBy(cashiers, 'pay_cash'),
        net: sumBy(cashiers, 'pay_network'),
        mobile: sumBy(cashiers, 'pay_mobile'),
        credit: sumBy(cashiers, 'pay_credit'),
    }), [cashiers]);

    const filteredOrders = useMemo(() => {
        const term = query.trim();
        if (!term) { return orders; }
        return orders.filter((o) => String(o.doc_no ?? '').includes(term));
    }, [orders, query]);

    async function printInvoice(docNo: string): Promise<void> {
        if (printingDoc) { return; }
        setPrintingDoc(docNo);
        try {
            printSmart(await fetchMonitorInvoiceHtml(docNo));
        } catch (error) {
            toast({ variant: 'error', title: 'تعذّرت طباعة الفاتورة', description: errorMessage(error) });
        } finally {
            setPrintingDoc('');
        }
    }

    return (
        <section className="live-pane" aria-label="الكاشيرية الحية">
            {/* ═══ شريط الحالة الحيّ ═══ */}
            <header className="live-bar">
                <div className="live-bar__brand">
                    <p className="live-bar__eyebrow" dir="ltr" lang="en">CASHIER LIVE · YARASOFT</p>
                    <h2 className="live-bar__title">الكاشيرية الحيّة</h2>
                    <p className="live-bar__sub">
                        <span className="live-pulse" aria-hidden="true" />
                        متصل الآن — يتحدث كل ٣٠ ثانية · {relativeDay(date)} · {summaryQuery.data?.date ?? date}
                    </p>
                </div>
                <div className="live-bar__controls">
                    <input
                        type="date"
                        className="live-date"
                        value={date}
                        max={todayIso()}
                        onChange={(event) => setDate(event.target.value)}
                        aria-label="اليوم المعروض"
                    />
                    <button type="button" className="live-refresh" onClick={() => { void summaryQuery.refetch(); void ordersQuery.refetch(); }} aria-label="تحديث الآن">
                        ↻ تحديث
                    </button>
                </div>
            </header>

            {/* ═══ KPI اللزجة ═══ */}
            <div className="live-kpis">
                <div className="live-kpi">
                    <span className="live-kpi__label">مبيعات اليوم</span>
                    <strong className="live-kpi__value erp-numeric" dir="ltr">{moneyOf(totals.revenue)}</strong>
                </div>
                <div className="live-kpi">
                    <span className="live-kpi__label">الفواتير</span>
                    <strong className="live-kpi__value erp-numeric" dir="ltr">{intOf(totals.invoices)}</strong>
                </div>
                <div className="live-kpi">
                    <span className="live-kpi__label">نقد</span>
                    <strong className="live-kpi__value erp-numeric" dir="ltr">{moneyOf(totals.cash)}</strong>
                </div>
                <div className="live-kpi">
                    <span className="live-kpi__label">شبكة</span>
                    <strong className="live-kpi__value erp-numeric" dir="ltr">{moneyOf(totals.net)}</strong>
                </div>
            </div>

            {/* ═══ شبكة الكاشيريات ═══ */}
            {cashiers.length > 0 ? (
                <div className="live-roster" aria-label="كاشيريات اليوم">
                    {cashiers.map((c) => {
                        const label = monitorCashierLabel(c);
                        const active = cashier === String(c.cashier_no ?? label);
                        return (
                            <button
                                key={String(c.cashier_no ?? label)}
                                type="button"
                                aria-pressed={active}
                                className={`live-cashier${active ? ' live-cashier--active' : ''}`}
                                onClick={() => setCashier(active ? '' : String(c.cashier_no ?? label))}
                            >
                                <span className="live-cashier__avatar" style={{ background: cashierColor(label) }}>{label.charAt(0)}</span>
                                <span className="live-cashier__body">
                                    <span className="live-cashier__name">{label}</span>
                                    <strong className="live-cashier__rev erp-numeric" dir="ltr">{moneyOf(cashierRevenue(c))}</strong>
                                    <span className="live-cashier__meta">
                                        <span>{intOf(c.invoices)} فاتورة</span>
                                        {Number(c.pay_network ?? 0) > 0 ? <span className="live-cashier__net">● شبكة</span> : null}
                                    </span>
                                </span>
                                {String(c.last_time ?? '').trim() ? <small className="live-cashier__last" dir="ltr">آخر عملية {String(c.last_time).slice(0, 5)}</small> : null}
                            </button>
                        );
                    })}
                    {cashier ? (
                        <button type="button" className="live-cashier live-cashier--clear" onClick={() => setCashier('')}>
                            <span className="live-cashier__avatar" style={{ background: '#1a2926' }}>×</span>
                            <span className="live-cashier__body">
                                <span className="live-cashier__name">كل الكاشيريات</span>
                                <small>عرض كل الفواتير</small>
                            </span>
                        </button>
                    ) : null}
                </div>
            ) : null}

            {/* ═══ كل الفواتير ═══ */}
            <div className="live-orders">
                <div className="live-orders__bar">
                    <label className="live-orders__search" htmlFor="erp-live-q">
                        <input
                            id="erp-live-q"
                            type="search"
                            value={query}
                            placeholder="ابحث برقم الإيصال…"
                            onChange={(event) => setQuery(event.target.value)}
                        />
                    </label>
                    <span className="live-orders__count" role="status">
                        {cashier ? `فاتورة الكاشير ${cashier}` : 'كل الفواتير'} — {intOf(totalOrders)}
                    </span>
                </div>

                {ordersQuery.isPending ? (
                    <div className="live-orders__loading" aria-busy="true">جارٍ تحميل الفواتير…</div>
                ) : ordersQuery.isError ? (
                    <div className="live-orders__error" role="alert">تعذّرت قراءة الفواتير — {errorMessage(ordersQuery.error)}</div>
                ) : filteredOrders.length === 0 ? (
                    <div className="live-orders__empty">لا فواتير مطابقة — جرّب يومًا آخر أو غيّر الكاشير.</div>
                ) : (
                    <div className="live-orders__scroll" role="region" aria-label="جدول الفواتير">
                        <table className="live-table">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>الوقت</th>
                                    <th>الكاشير</th>
                                    <th>الأصناف</th>
                                    <th>الدفع</th>
                                    <th>الإجمالي</th>
                                    <th aria-label="إجراءات">طباعة</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredOrders.map((row) => {
                                    const pay = payLabel(row);
                                    return (
                                        <tr key={String(row.doc_no)} className="live-table__row">
                                            <td className="erp-numeric" dir="ltr">{row.doc_no}</td>
                                            <td className="erp-numeric" dir="ltr">{orderTimeText(row)}</td>
                                            <td>{textOf(row.cashier_name ?? row.cashier_no) || '—'}</td>
                                            <td className="erp-numeric" dir="ltr">{intOf(row.items)}</td>
                                            <td><span className={`live-pay live-pay--${pay.tone}`}>{pay.label}</span></td>
                                            <td className="erp-numeric live-table__total" dir="ltr">{netAmount(row)}</td>
                                            <td>
                                                <button
                                                    type="button"
                                                    className="live-print"
                                                    disabled={printingDoc === String(row.doc_no)}
                                                    onClick={() => void printInvoice(String(row.doc_no))}
                                                    aria-label={`طباعة فاتورة ${row.doc_no}`}
                                                >
                                                    {printingDoc === String(row.doc_no) ? '…' : '🖨'}
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {totalOrders > PAGE ? (
                    <div className="live-orders__pager">
                        <Button type="button" variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset((v) => Math.max(0, v - PAGE))}>
                            السابق
                        </Button>
                        <span className="live-orders__page">الصفحات {Math.floor(offset / PAGE) + 1} / {Math.ceil(totalOrders / PAGE)}</span>
                        <Button type="button" variant="secondary" size="sm" disabled={offset + PAGE >= totalOrders} onClick={() => setOffset((v) => v + PAGE)}>
                            التالي
                        </Button>
                    </div>
                ) : null}
            </div>
        </section>
    );
}
