/**
 * PosReports — مركز التقارير الاحترافي (ورقة رسمية قابلة للطباعة)
 * ═══════════════════════════════════════════════════════════════════════════════
 * طلب المالك: «عايز صفحة تقارير أقدر أطبع منها أي تقرير في السستم» —
 * تقرير قسم (إيراداته وأوردراته وكم)، تقرير صنف (إيراداته وكل شيء عنه)،
 * وتقرير مخزن (أي صنف اتسحب منه وكم في فترة يحددها).
 *
 * الورقة المطبوعة هي نفسها المعروضة: ترويسة رسمية + لوجو + جداول + خانات توقيع.
 */
import { useMemo, useState } from 'react';
import '../styles/pos-reports.css';
import { useQuery } from '@tanstack/react-query';
import { fetchDepartmentReport, fetchInventoryReport, fetchPosDepartments, fetchProductReport } from '../lib/pos';
import { Badge, Button, Input } from '../ui';
import { errorMessage } from '../lib/reporting';
import { useToast } from '../ui/Toast';

type ReportTab = 'department' | 'product' | 'inventory';

interface DepartmentRow {
    department_id: string; code: string; name: string; legacy_code: string;
    cashiers: string[]; invoices: number; net: string; total: string; vat: string;
    discount: string; cash: string; card: string; other: string;
    average_ticket: string; accounting_revenue: string; revenue_entries: number;
}
interface ProductRow {
    code: string; name: string; qty: string; revenue: string; vat: string;
    discount: string; invoices: number; average_price: string;
}
interface InventoryRow {
    id: string; date: string; type: string; reference_type: string; reason: string;
    item_id: string; item_name: string; item_category: string; unit: string;
    quantity: string; direction: 'in' | 'out'; unit_cost: string; value: string;
}

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(days: number): string {
    return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}
const money = (v: string | number) => Number(v || 0).toFixed(2);

export function PosReports() {
    const { toast } = useToast();
    const [tab, setTab] = useState<ReportTab>('department');
    const [from, setFrom] = useState(daysAgoIso(30));
    const [to, setTo] = useState(todayIso());
    const [departmentId, setDepartmentId] = useState('');
    const [productCode, setProductCode] = useState('');
    const [productName, setProductName] = useState('');
    const [itemSearch, setItemSearch] = useState('');

    const departmentsQuery = useQuery({
        queryKey: ['pos-departments'],
        queryFn: ({ signal }) => fetchPosDepartments(signal),
        staleTime: 300000,
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

    const active = tab === 'department' ? departmentQuery : tab === 'product' ? productQuery : inventoryQuery;

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
                { label: 'الخصومات', value: money(t.discount as string) },
                { label: 'عدد الفواتير', value: String(t.invoices ?? 0) },
                { label: 'متوسط السعر', value: money(t.average_price as string) },
            ] : [];
        }
        const t = inventoryQuery.data?.totals;
        return t ? [
            { label: 'عدد الحركات', value: String(t.movements ?? 0) },
            { label: 'وارد (كمية)', value: String(t.in_qty ?? 0) },
            { label: 'منصرف (كمية)', value: String(t.out_qty ?? 0) },
            { label: 'قيمة الوارد', value: money(t.in_value as string) },
            { label: 'قيمة المنصرف', value: money(t.out_value as string) },
        ] : [];
    }, [tab, departmentQuery.data, productQuery.data, inventoryQuery.data]);

    const printReport = () => {
        // نافذة الطباعة: نفس الورقة الرسمية (رأس + جداول + توقيعات)
        const rows: unknown[] = active.data && 'rows' in active.data ? (active.data.rows as unknown[]) : [];
        const head = tab === 'department'
            ? ['القسم', 'الكاشيرون', 'الفواتير', 'المبيعات', 'الضريبة', 'الخصومات', 'نقدي', 'شبكة', 'متوسط الفاتورة', 'الإيراد المحاسبي']
            : tab === 'product'
                ? ['الكود', 'الصنف', 'الكمية', 'الإيراد', 'الضريبة', 'الخصومات', 'الفواتير', 'متوسط السعر']
                : ['التاريخ', 'الصنف', 'الحركة', 'الكمية', 'القيمة', 'المرجع'];
        const body = rows.map((raw) => {
            const r = raw as Record<string, unknown>;
            const cells = tab === 'department'
                ? [(r as unknown as DepartmentRow).name, (r as unknown as DepartmentRow).cashiers.join('، ') || '—', (r as unknown as DepartmentRow).invoices, (r as unknown as DepartmentRow).total, (r as unknown as DepartmentRow).vat, (r as unknown as DepartmentRow).discount, (r as unknown as DepartmentRow).cash, (r as unknown as DepartmentRow).card, (r as unknown as DepartmentRow).average_ticket, (r as unknown as DepartmentRow).accounting_revenue]
                : tab === 'product'
                    ? [(r as unknown as ProductRow).code, (r as unknown as ProductRow).name, (r as unknown as ProductRow).qty, (r as unknown as ProductRow).revenue, (r as unknown as ProductRow).vat, (r as unknown as ProductRow).discount, (r as unknown as ProductRow).invoices, (r as unknown as ProductRow).average_price]
                    : [(r as unknown as InventoryRow).date, (r as unknown as InventoryRow).item_name, (r as unknown as InventoryRow).type === 'transfer_out' ? 'سحب' : 'إضافة', (r as unknown as InventoryRow).quantity, (r as unknown as InventoryRow).value, (r as unknown as InventoryRow).reason || '—'];
            return `<tr>${cells.map((c) => `<td>${String(c ?? '')}</td>`).join('')}</tr>`;
        }).join('');

        const title = tab === 'department' ? 'تقرير الأقسام' : tab === 'product' ? 'تقرير الأصناف' : 'تقرير حركة المخزن';
        const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${title}</title><style>
  @page{size:A4 portrait;margin:14mm 12mm}
  body{font-family:'Tajawal','Cairo','Segoe UI',Tahoma,sans-serif;color:#111;margin:0;font-size:12px}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2.5px double #000;padding-bottom:8px;margin-bottom:12px}
  .head img{width:56px;height:56px;object-fit:contain}
  .head h1{font-size:18px;margin:0 0 2px}
  .head p{margin:0;font-size:11px;color:#444}
  .meta{display:flex;gap:18px;font-size:11px;margin-bottom:10px;color:#333}
  table{width:100%;border-collapse:collapse;margin-bottom:14px}
  th{border:1px solid #000;background:#eee;padding:6px 5px;font-size:11px;text-align:right}
  td{border:1px solid #999;padding:5px;font-size:11px}
  thead{display:table-header-group} tr{break-inside:avoid}
  .sign{display:flex;justify-content:space-between;margin-top:26px;font-size:11px}
  .sign div{border-top:1px solid #000;padding-top:5px;min-width:150px;text-align:center}
</style></head><body>
  <div class="head">
    <img src="/app/assets/karim-logo.png" alt="شعار المطعم">
    <div><h1>${title}</h1><p>مطاعم الشرفة العالمي — تقرير رسمي</p></div>
  </div>
  <div class="meta"><span>الفترة: ${from} → ${to}</span><span>تاريخ الإصدار: ${todayIso()}</span><span>النظام: KARIM ERP</span></div>
  <table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
  <div class="sign"><div>إعداد</div><div>مراجعة</div><div>اعتماد</div></div>
</body></html>`;

        const win = window.open('', '_blank', 'width=900,height=1000');
        if (!win) {
            toast({ title: 'المتصفح حجب نافذة الطباعة — اسمح بالنوافذ المنبثقة', variant: 'error' });
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        win.setTimeout(() => win.print(), 300);
    };

    return (
        <section className="erp-card pos-reports" aria-labelledby="pos-reports-title">
            <div className="erp-card__body pos-reports__body">
                <header className="pos-reports__head">
                    <div>
                        <h2 id="pos-reports-title" className="erp-card__title">مركز التقارير</h2>
                        <p className="text-body-sm text-muted">تقرير رسمي قابل للطباعة — قسم، صنف، أو حركة مخزن.</p>
                    </div>
                    <Button variant="primary" size="sm" onClick={printReport} disabled={active.isPending || active.isError}>
                        طباعة ورقة رسمية
                    </Button>
                </header>

                <div className="pos-reports__tabs" role="tablist">
                    {([['department', 'تقرير قسم'], ['product', 'تقرير صنف'], ['inventory', 'تقرير المخزن']] as const).map(([key, label]) => (
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

                <div className="pos-reports__filters">
                    <label>من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label>إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                    {tab === 'department' ? (
                        <label>القسم
                            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                                <option value="">كل الأقسام</option>
                                {(departmentsQuery.data ?? []).map((d) => <option key={d.id} value={d.id}>{d.name_ar}</option>)}
                            </select>
                        </label>
                    ) : null}
                    {tab === 'product' ? (
                        <>
                            <label>كود الصنف<Input value={productCode} onChange={(e) => setProductCode(e.target.value)} dir="ltr" placeholder="010403" /></label>
                            <label>اسم الصنف<Input value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="ربع دجاج" /></label>
                        </>
                    ) : null}
                    {tab === 'inventory' ? (
                        <label>بحث في المخزن<Input value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} placeholder="اسم الصنف أو الفئة" /></label>
                    ) : null}
                </div>

                {active.isPending ? <p className="text-body-sm text-muted">جارٍ إعداد التقرير…</p> : null}
                {active.isError ? (
                    <p className="text-body-sm text-danger" role="alert">{errorMessage(active.error)}</p>
                ) : null}

                {summary.length ? (
                    <div className="pos-reports__kpis">
                        {summary.map((kpi) => (
                            <div key={kpi.label} className="pos-reports__kpi">
                                <span>{kpi.label}</span>
                                <strong>{kpi.value}</strong>
                            </div>
                        ))}
                    </div>
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
            </div>
        </section>
    );
}
