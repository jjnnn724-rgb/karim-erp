/**
 * PosReports — مركز التقارير التنفيذي (Executive Briefing)
 * ═══════════════════════════════════════════════════════════════════════════════
 * طلب المالك: «عايز تقارير احترافية، شيء عالمي».
 * الصفحة تتحقق من الطلب على ثلاث طبقات:
 *   1. نَظْرة تنفيذية (Executive Overview): KPI hero + منحنى الإيراد اليومي مقابل الفترة
 *      السابقة + حصص الأقسام والمنتجات الأكثر مبيعًا + توزيع طرق الدفع.
 *   2. تفاصيل (Tabs): تقرير قسم / صنف / مخزن — كلها للطباعة الرسمية.
 *   3. ورقة رسمية: طباعة A4 بشعار المطعم وتوقيعات (إعداد/مراجعة/اعتماد).
 *
 * الأرقام كلها لحظية من الخادم (لا بيانات وهمية)، والفترة السابقة تُحسب تلقائيًا.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
    Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
    fetchDepartmentReport, fetchExecutiveReport, fetchInventoryReport,
    fetchPosDepartments, fetchProductReport,
    type ReportDepartment, type ReportInventory, type ReportProduct,
} from '../lib/pos';
import { Badge, Button, Input } from '../ui';
import '../styles/pos-reports.css';
import { errorMessage } from '../lib/reporting';
import { printSmart } from '../lib/print-viewer';

type ReportTab = 'overview' | 'department' | 'product' | 'inventory';

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(days: number): string { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
const money = (v: string | number | null | undefined) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number) => Number(v || 0).toLocaleString('en-US');

function deltaPct(current: number, previous: number): number | null {
    if (!Number.isFinite(previous) || previous === 0) { return null; }
    return ((current - previous) / Math.abs(previous)) * 100;
}

function trendArrow(delta: number | null): string {
    if (delta === null) { return '—'; }
    return delta >= 0 ? '▲' : '▼';
}
function trendClass(delta: number | null): string {
    if (delta === null) { return 'pos-reports__trend pos-reports__trend--flat'; }
    return delta >= 0 ? 'pos-reports__trend pos-reports__trend--up' : 'pos-reports__trend pos-reports__trend--down';
}

function deltaText(delta: number | null): string {
    if (delta === null) { return 'لا مقارنة'; }
    const sign = delta >= 0 ? '+' : '';
    return `${sign}${delta.toFixed(1)}%`;
}

const CHART_GREEN = 'var(--erp-chart-1)';
const CHART_AMBER = 'var(--erp-chart-2)';
const CHART_GRID = 'var(--erp-hairline)';
const CHART_MUTED = 'var(--erp-muted)';
const PIE_COLORS: string[] = ['var(--erp-chart-1)', 'var(--erp-chart-3)', 'var(--erp-chart-2)', 'var(--erp-chart-4)'];

const tooltipStyle = {
    direction: 'rtl' as const,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    backgroundColor: 'var(--erp-surface-raised)',
    color: 'var(--erp-ink)',
    border: '1px solid var(--erp-hairline)',
    borderRadius: 10,
    boxShadow: 'var(--erp-shadow-pop)',
};

export function PosReports() {
    const [tab, setTab] = useState<ReportTab>('overview');
    const [from, setFrom] = useState(daysAgoIso(30));
    const [to, setTo] = useState(todayIso());
    const [departmentId, setDepartmentId] = useState('');
    const [productCode, setProductCode] = useState('');
    const [productName, setProductName] = useState('');
    const [itemSearch, setItemSearch] = useState('');

    const departmentsQuery = useQuery({
        queryKey: ['pos-departments'],
        queryFn: ({ signal }) => fetchPosDepartments(signal),
        staleTime: 300_000,
        retry: 0,
    });

    const executiveQuery = useQuery({
        queryKey: ['pos-report-executive', from, to, departmentId],
        queryFn: ({ signal }) => fetchExecutiveReport(departmentId ? { from, to, departmentId } : { from, to }, signal),
        enabled: tab === 'overview',
        staleTime: 30_000,
        retry: 0,
    });

    const departmentQuery = useQuery({
        queryKey: ['pos-report-department', from, to, departmentId],
        queryFn: ({ signal }) => fetchDepartmentReport(departmentId ? { from, to, departmentId } : { from, to }, signal),
        enabled: tab === 'department',
        staleTime: 30_000,
        retry: 0,
    });

    const productQuery = useQuery({
        queryKey: ['pos-report-product', from, to, productCode, productName],
        queryFn: ({ signal }) => fetchProductReport({ from, to, ...(productCode ? { productCode } : {}), ...(productName ? { productName } : {}) }, signal),
        enabled: tab === 'product',
        staleTime: 30_000,
        retry: 0,
    });

    const inventoryQuery = useQuery({
        queryKey: ['pos-report-inventory', from, to, itemSearch],
        queryFn: ({ signal }) => fetchInventoryReport(itemSearch ? { from, to, search: itemSearch } : { from, to }, signal),
        enabled: tab === 'inventory',
        staleTime: 30_000,
        retry: 0,
    });

    const active = tab === 'overview' ? executiveQuery : tab === 'department' ? departmentQuery : tab === 'product' ? productQuery : inventoryQuery;
    void active;

    const summary = useMemo(() => {
        if (tab === 'department') {
            const t = departmentQuery.data?.totals;
            return t ? [
                { label: 'عدد الفواتير', value: String(t.invoices ?? 0) },
                { label: 'إجمالي المبيعات', value: money(t.total as string) },
                { label: 'الضريبة', value: money(t.vat as string) },
                { label: 'الخصومات', value: money(t.discount as string) },
                { label: 'نقدي', value: money(t.cash as string) },
                { label: 'شبكة', value: money(t.card as string) },
                { label: 'متوسط الفاتورة', value: money(t.average_ticket as string) },
            ] : [];
        }
        if (tab === 'product') {
            const t = productQuery.data?.totals;
            return t ? [
                { label: 'عدد الأصناف', value: String(productQuery.data?.rows.length ?? 0) },
                { label: 'الكمية المباعة', value: String(t.qty ?? 0) },
                { label: 'الإيراد', value: money(t.revenue as string) },
                { label: 'الضريبة', value: money(t.vat as string) },
                { label: 'الفواتير', value: String(t.invoices ?? 0) },
                { label: 'متوسط السعر', value: money(t.average_price as string) },
            ] : [];
        }
        if (tab === 'inventory') {
            const t = inventoryQuery.data?.totals;
            return t ? [
                { label: 'عدد الحركات', value: String(t.movements ?? 0) },
                { label: 'وارد (كمية)', value: String(t.in_qty ?? 0) },
                { label: 'منصرف (كمية)', value: String(t.out_qty ?? 0) },
                { label: 'قيمة الوارد', value: money(t.in_value as string) },
                { label: 'قيمة المنصرف', value: money(t.out_value as string) },
            ] : [];
        }
        return [];
    }, [tab, departmentQuery.data, productQuery.data, inventoryQuery.data]);

    const exec = executiveQuery.data;
    const compareDaily = useMemo(() => {
        if (!exec) { return []; }
        const map = new Map<string, { day: string; current: number; previous: number }>();
        for (const d of exec.daily) { if (d.day) { map.set(d.day, { day: d.day, current: Number(d.revenue ?? 0), previous: 0 }); } }
        for (const d of exec.previous_daily) {
            if (!d.day) { continue; }
            const existing = map.get(d.day);
            if (existing) { existing.previous = Number(d.revenue ?? 0); }
            else { map.set(d.day, { day: d.day, current: 0, previous: Number(d.revenue ?? 0) }); }
        }
        return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
    }, [exec]);

    const kpis = useMemo(() => {
        if (!exec) { return []; }
        const curRev = Number(exec.current.revenue);
        const prevRev = Number(exec.previous_period.revenue);
        const curTicket = Number(exec.current.average_ticket);
        const prevTicket = Number(exec.previous_period.average_ticket);
        const curInv = exec.current.invoices;
        const prevInv = exec.previous_period.invoices;
        const curVat = Number(exec.current.vat);
        const prevVat = Number(exec.previous_period.vat);
        return [
            { label: 'صافي الإيرادات', value: money(curRev), unit: 'ر.س', delta: deltaPct(curRev, prevRev), good: true },
            { label: 'عدد الفواتير', value: int(curInv), unit: 'فاتورة', delta: deltaPct(curInv, prevInv), good: true },
            { label: 'متوسط الفاتورة', value: money(curTicket), unit: 'ر.س', delta: deltaPct(curTicket, prevTicket), good: true },
            { label: 'الضريبة المحصلة', value: money(curVat), unit: 'ر.س', delta: deltaPct(curVat, prevVat), good: true },
        ];
    }, [exec]);

    const paymentData = useMemo(() => {
        if (!exec) { return []; }
        return [
            { name: 'نقدي', value: Number(exec.payments.cash) },
            { name: 'شبكة', value: Number(exec.payments.card) },
            { name: 'أخرى', value: Number(exec.payments.other) },
        ].filter((p) => p.value > 0);
    }, [exec]);

    const topDepartments = useMemo(() => exec?.by_department.slice(0, 6) ?? [], [exec]);
    const topProducts = useMemo(() => exec?.top_products.slice(0, 6) ?? [], [exec]);

    const printReport = () => {
        const title = tab === 'department' ? 'تقرير الأقسام' : tab === 'product' ? 'تقرير الأصناف' : tab === 'inventory' ? 'تقرير حركة المخزن' : 'النظرة التنفيذية';
        const titleEn = tab === 'department' ? 'Departments Report' : tab === 'product' ? 'Products Report' : tab === 'inventory' ? 'Inventory Movement Report' : 'Executive Overview';
        const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const rowsHtml = (() => {
            if (tab === 'department' && departmentQuery.data) {
                return departmentQuery.data.rows.map((r: ReportDepartment["rows"][number]) =>
                    `<tr><td>${escape(r.name)}</td><td>${escape(r.cashiers.join('، ') || '—')}</td><td>${r.invoices}</td><td>${escape(r.total)}</td><td>${escape(r.vat)}</td><td>${escape(r.discount)}</td><td>${escape(r.cash)}</td><td>${escape(r.card)}</td><td>${escape(r.average_ticket)}</td><td>${escape(r.accounting_revenue)}</td></tr>`,
                ).join('');
            }
            if (tab === 'product' && productQuery.data) {
                return productQuery.data.rows.map((r: ReportProduct["rows"][number]) =>
                    `<tr><td>${escape(r.code)}</td><td>${escape(r.name)}</td><td>${escape(r.qty)}</td><td>${escape(r.revenue)}</td><td>${escape(r.vat)}</td><td>${escape(r.discount)}</td><td>${r.invoices}</td><td>${escape(r.average_price)}</td></tr>`,
                ).join('');
            }
            if (tab === 'inventory' && inventoryQuery.data) {
                return inventoryQuery.data.rows.map((r: ReportInventory["rows"][number]) =>
                    `<tr><td>${escape(r.date)}</td><td>${escape(r.item_name)}</td><td>${r.direction === 'in' ? 'إضافة' : 'سحب'}</td><td>${escape(r.quantity)}</td><td>${escape(r.value)}</td><td>${escape(r.reason || r.reference_type || '—')}</td></tr>`,
                ).join('');
            }
            if (exec) {
                const deptRows = exec.by_department.map((d) => `<tr><td>${escape(d.name)}</td><td>${d.invoices}</td><td>${escape(d.revenue)}</td><td>${d.share}%</td></tr>`).join('');
                const productRows = exec.top_products.map((p) => `<tr><td>${escape(p.code)}</td><td>${escape(p.name)}</td><td>${escape(p.qty)}</td><td>${escape(p.revenue)}</td></tr>`).join('');
                return `
                  <table><thead><tr><th>القسم</th><th>الفواتير</th><th>الإيراد</th><th>الحصة</th></tr></thead><tbody>${deptRows}</tbody></table>
                  <h2 style="margin-top:22px">الأصناف الأكثر مبيعًا</h2>
                  <table><thead><tr><th>الكود</th><th>الصنف</th><th>الكمية</th><th>الإيراد</th></tr></thead><tbody>${productRows}</tbody></table>`;
            }
            return '';
        })();

        const head = tab === 'department'
            ? ['القسم', 'الكاشيرون', 'الفواتير', 'المبيعات', 'الضريبة', 'الخصومات', 'نقدي', 'شبكة', 'متوسط الفاتورة', 'الإيراد المحاسبي']
            : tab === 'product'
                ? ['الكود', 'الصنف', 'الكمية', 'الإيراد', 'الضريبة', 'الخصومات', 'الفواتير', 'متوسط السعر']
                : tab === 'inventory'
                    ? ['التاريخ', 'الصنف', 'الحركة', 'الكمية', 'القيمة', 'المرجع']
                    : [];

        const tableHtml = tab !== 'overview' && head.length
            ? `<table><thead><tr>${head.map((h) => `<th>${escape(h)}</th>`).join('')}</tr></thead><tbody>${rowsHtml}</tbody></table>`
            : rowsHtml;

        const kpisHtml = kpis.length
            ? `<div class="kpis">${kpis.map((k) => `<div class="kpi"><span>${escape(k.label)}</span><strong>${escape(k.value)} <small>${escape(k.unit)}</small></strong></div>`).join('')}</div>`
            : '';

        const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${escape(title)}</title><style>
  @page{size:A4 portrait;margin:13mm 11mm}
  body{font-family:'Tajawal','Cairo','Segoe UI',Tahoma,sans-serif;color:#111;margin:0;font-size:11px}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2.5px double #000;padding-bottom:8px;margin-bottom:10px}
  .head img{width:56px;height:56px;object-fit:contain}
  .head h1{font-size:19px;margin:0 0 2px}
  .head p{margin:0;font-size:11px;color:#444}
  .meta{display:flex;gap:16px;font-size:11px;margin-bottom:10px;color:#333;flex-wrap:wrap}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px}
  .kpi{border:1px solid #bbb;border-radius:8px;padding:6px 8px}
  .kpi span{font-size:10px;color:#444;display:block}
  .kpi strong{font-size:14px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{border:1px solid #000;background:#eee;padding:5px 5px;font-size:10.5px;text-align:right}
  td{border:1px solid #999;padding:4px 5px;font-size:10.5px}
  thead{display:table-header-group} tr{break-inside:avoid}
  h2{font-size:13px;margin:14px 0 6px;border-bottom:1.4px solid #000;padding-bottom:3px}
  .sign{display:flex;justify-content:space-between;margin-top:20px;font-size:10.5px}
  .sign div{border-top:1px solid #000;padding-top:4px;min-width:140px;text-align:center}
</style></head><body>
  <div class="head">
    <img src="/app/assets/karim-logo.png" alt="شعار المطعم">
    <div><h1>${escape(title)} <span style="font-size:.55em;letter-spacing:.05em;color:#6b5d2f" lang="en" dir="ltr">${escape(titleEn)}</span></h1><p>مطاعم الشرفة العالمي — تقرير رسمي معتمد</p></div>
  </div>
  <div class="meta"><span><strong>الفترة:</strong> ${escape(from)} → ${escape(to)}</span><span><strong>الإصدار:</strong> ${escape(todayIso())}</span><span><strong>النظام:</strong> KARIM ERP</span></div>
  ${kpisHtml}
  ${tableHtml}
  <div class="sign"><div>إعداد</div><div>مراجعة</div><div>اعتماد</div></div>
</body></html>`;

        printSmart(html, { autoPrint: true, printDelayMs: 350 });
    };

    const execTabActive = tab === 'overview';

    return (
        <section className="erp-card pos-reports" aria-labelledby="pos-reports-title">
            <div className="erp-card__body pos-reports__body">
                <header className="pos-reports__head">
                    <div className="pos-reports__title-block">
                        <h2 id="pos-reports-title" className="erp-card__title">مركز التقارير</h2>
                        <p className="pos-reports__subtitle">
                            نظرة تنفيذية + تقارير تفصيلية + طباعة ورقة رسمية — كل الأرقام من بيانات KARIM الحقيقية
                        </p>
                    </div>
                    <Button variant="primary" size="sm" onClick={printReport} disabled={active?.isPending || active?.isError}>
                        طباعة ورقة رسمية
                    </Button>
                </header>

                <div className="pos-reports__filters">
                    <label className="pos-reports__field">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label className="pos-reports__field">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                    <label className="pos-reports__field">القسم
                        <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                            <option value="">كل الأقسام</option>
                            {(departmentsQuery.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                        </select>
                    </label>
                </div>

                <div className="pos-reports__tabs" role="tablist">
                    {([['overview', 'النظرة التنفيذية'], ['department', 'تقرير قسم'], ['product', 'تقرير صنف'], ['inventory', 'تقرير المخزن']] as const).map(([key, label]) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            className={`pos-reports__tab${tab === key ? ' is-active' : ''}`}
                            onClick={() => setTab(key)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {execTabActive && executiveQuery.isPending ? <p className="text-body-sm text-muted">جارٍ إعداد النظرة التنفيذية…</p> : null}
                {execTabActive && executiveQuery.isError ? (
                    <p className="text-body-sm text-danger" role="alert">{errorMessage(executiveQuery.error)}</p>
                ) : null}

                {/* ═══════ النظرة التنفيذية ═══════ */}
                {execTabActive && exec ? (
                    <>
                        {executiveQuery.data ? (
                            <div className="pos-reports__exec">
                                <div className="pos-reports__kpis">
                                    {kpis.map((kpi) => {
                                        const delta = kpi.delta;
                                        return (
                                            <div key={kpi.label} className="pos-reports__kpi">
                                                <span className="pos-reports__kpi-label">{kpi.label}</span>
                                                <div className="pos-reports__kpi-row">
                                                    <strong className="pos-reports__kpi-value">{kpi.value}<small> {kpi.unit}</small></strong>
                                                    <span className={trendClass(delta)}>{trendArrow(delta)} {deltaText(delta)}</span>
                                                </div>
                                                <span className="pos-reports__kpi-hint">مقابل {exec.previous.from} — {exec.previous.to}</span>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="pos-reports__charts">
                                    <figure className="pos-reports__chart pos-reports__chart--wide">
                                        <figcaption>الإيرادات اليومية ومقارنة بالفترة السابقة</figcaption>
                                        <ResponsiveContainer width="100%" height={210}>
                                            <AreaChart data={compareDaily} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                                                <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 3" />
                                                <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_MUTED }} tickLine={false} axisLine={false} />
                                                <YAxis tick={{ fontSize: 10, fill: CHART_MUTED }} tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}K`} />
                                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${money(Number(value ?? 0))} ر.س`, 'الإيراد']} />
                                                <Legend />
                                                <Area type="monotone" dataKey="current" name="هذه الفترة" stroke={CHART_GREEN} strokeWidth={2.5} fill={CHART_GREEN} fillOpacity={0.18} />
                                                <Area type="monotone" dataKey="previous" name="الفترة السابقة" stroke={CHART_MUTED} strokeWidth={1.5} strokeDasharray="5 4" fill="transparent" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </figure>

                                    <figure className="pos-reports__chart">
                                        <figcaption>توزيع الإيرادات على الأقسام</figcaption>
                                        <ResponsiveContainer width="100%" height={210}>
                                            <BarChart data={topDepartments} layout="vertical" margin={{ left: 8, right: 4, top: 4, bottom: 0 }}>
                                                <CartesianGrid stroke={CHART_GRID} horizontal={false} strokeDasharray="3 3" />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="name" type="category" width={110} tick={{ fontSize: 10, fill: CHART_MUTED }} tickLine={false} axisLine={false} />
                                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${money(Number(value ?? 0))} ر.س`, 'الإيراد']} />
                                                <Bar dataKey="revenue" radius={[0, 8, 8, 0]} fill={CHART_GREEN} barSize={16} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </figure>

                                    <figure className="pos-reports__chart">
                                        <figcaption>توزيع طرق الدفع</figcaption>
                                        <ResponsiveContainer width="100%" height={210}>
                                            <PieChart>
                                                <Pie data={paymentData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={76} paddingAngle={3} strokeWidth={2}>
                                                    {paymentData.map((entry, index) => (
                                                        <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length] ?? CHART_GREEN} />
                                                    ))}
                                                </Pie>
                                                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${money(Number(value ?? 0))} ر.س`, 'المبلغ']} />
                                                <Legend />
                                            </PieChart>
                                        </ResponsiveContainer>
                                    </figure>
                                </div>

                                <div className="pos-reports__bottom">
                                    <figure className="pos-reports__chart pos-reports__chart--wide">
                                        <figcaption>الأكثر مبيعًا (بالإيراد)</figcaption>
                                        <ResponsiveContainer width="100%" height={230}>
                                            <BarChart data={topProducts} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                                                <CartesianGrid stroke={CHART_GRID} vertical={false} strokeDasharray="3 3" />
                                                <XAxis dataKey="name" tick={{ fontSize: 9, fill: CHART_MUTED }} tickLine={false} axisLine={false} interval={0} />
                                                <YAxis tick={{ fontSize: 10, fill: CHART_MUTED }} tickLine={false} axisLine={false} width={52} />
                                                <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [name === 'revenue' ? `${money(Number(value ?? 0))} ر.س` : `${value} قطعة`, name === 'revenue' ? 'الإيراد' : 'الكمية']} />
                                                <Bar dataKey="revenue" radius={[8, 8, 0, 0]} fill={CHART_AMBER} barSize={34} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </figure>

                                    <div className="pos-reports__depts">
                                        <h3 className="pos-reports__depts-title">الأقسام حسب الإيراد</h3>
                                        <ol className="pos-reports__depts-list">
                                            {topDepartments.map((d) => (
                                                <li key={d.id} className="pos-reports__dept-row">
                                                    <span className="pos-reports__dept-rank">{topDepartments.indexOf(d) + 1}</span>
                                                    <span className="pos-reports__dept-name">{d.name}</span>
                                                    <span className="pos-reports__dept-share">{d.share}%</span>
                                                    <span className="pos-reports__dept-revenue">{money(d.revenue)}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                </div>
                            </div>
                        ) : null}
                    </>
                ) : null}

                {/* ═══════ تفاصيل: قسم/صنف/مخزن ═══════ */}
                {!execTabActive ? (
                    <>
                        {summary.length ? (
                            <div className="pos-reports__kpis">
                                {summary.map((kpi) => (
                                    <div key={kpi.label} className="pos-reports__kpi">
                                        <span className="pos-reports__kpi-label">{kpi.label}</span>
                                        <strong className="pos-reports__kpi-value">{kpi.value}</strong>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                        <div className="pos-reports__detail-filters">
                            {tab === 'product' ? (
                                <>
                                    <label className="pos-reports__field">كود الصنف<Input value={productCode} onChange={(e) => setProductCode(e.target.value)} dir="ltr" placeholder="010403" /></label>
                                    <label className="pos-reports__field">اسم الصنف<Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="ربع دجاج" /></label>
                                </>
                            ) : null}
                            {tab === 'inventory' ? (
                                <label className="pos-reports__field">بحث في المخزن<Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="اسم الصنف أو الفئة" /></label>
                            ) : null}
                        </div>

                        {departmentQuery.isPending || productQuery.isPending || inventoryQuery.isPending ? <p className="text-body-sm text-muted">جارٍ إعداد التقرير…</p> : null}
                        {departmentQuery.isError || productQuery.isError || inventoryQuery.isError ? (
                            <p className="text-body-sm text-danger" role="alert">تعذر إعداد التقرير — تحقق من الاتصال</p>
                        ) : null}

                        {tab === 'department' && departmentQuery.data ? (
                            <table className="pos-reports__table">
                                <thead>
                                    <tr><th>القسم</th><th>الكاشيرون</th><th>الفواتير</th><th>المبيعات</th><th>الضريبة</th><th>الخصومات</th><th>نقدي</th><th>شبكة</th><th>متوسط الفاتورة</th><th>الإيراد المحاسبي</th></tr>
                                </thead>
                                <tbody>
                                    {departmentQuery.data.rows.map((row) => (
                                        <tr key={row.department_id}>
                                            <td>{row.name}</td>
                                            <td>{row.cashiers.length ? `كاشير ${row.cashiers.join('، ')}` : '—'}</td>
                                            <td className="erp-numeric">{row.invoices}</td>
                                            <td className="erp-numeric">{row.total}</td>
                                            <td className="erp-numeric">{row.vat}</td>
                                            <td className="erp-numeric">{row.discount}</td>
                                            <td className="erp-numeric">{row.cash}</td>
                                            <td className="erp-numeric">{row.card}</td>
                                            <td className="erp-numeric">{row.average_ticket}</td>
                                            <td className="erp-numeric">{row.accounting_revenue}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : null}

                        {tab === 'product' && productQuery.data ? (
                            <table className="pos-reports__table">
                                <thead>
                                    <tr><th>الكود</th><th>الصنف</th><th>الكمية</th><th>الإيراد</th><th>الضريبة</th><th>الخصومات</th><th>الفواتير</th><th>متوسط السعر</th></tr>
                                </thead>
                                <tbody>
                                    {productQuery.data.rows.map((row) => (
                                        <tr key={`${row.code}-${row.name}`}>
                                            <td dir="ltr">{row.code}</td>
                                            <td>{row.name}</td>
                                            <td className="erp-numeric">{row.qty}</td>
                                            <td className="erp-numeric">{row.revenue}</td>
                                            <td className="erp-numeric">{row.vat}</td>
                                            <td className="erp-numeric">{row.discount}</td>
                                            <td className="erp-numeric">{row.invoices}</td>
                                            <td className="erp-numeric">{row.average_price}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : null}

                        {tab === 'inventory' && inventoryQuery.data ? (
                            <table className="pos-reports__table">
                                <thead>
                                    <tr><th>التاريخ</th><th>الصنف</th><th>الحركة</th><th>الكمية</th><th>القيمة</th><th>المرجع</th></tr>
                                </thead>
                                <tbody>
                                    {inventoryQuery.data.rows.map((row) => (
                                        <tr key={row.id}>
                                            <td dir="ltr">{row.date}</td>
                                            <td>{row.item_name || '—'}</td>
                                            <td>
                                                <Badge variant={row.direction === 'in' ? 'success' : 'danger'}>
                                                    {row.direction === 'in' ? 'إضافة' : 'سحب'}
                                                </Badge>
                                                <span className="text-caption text-muted"> {row.type}</span>
                                            </td>
                                            <td className="erp-numeric">{row.quantity}</td>
                                            <td className="erp-numeric">{row.value}</td>
                                            <td className="text-caption">{row.reason || row.reference_type || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        ) : null}
                    </>
                ) : null}
            </div>
        </section>
    );
}
