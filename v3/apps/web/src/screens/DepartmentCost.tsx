/**
 * DepartmentCost — وضع القسم «كل شيء بالجرام»
 * ═════════════════════════════════════════════════════════════════════════
 * تبويبان:
 *   ١. وضع القسم  : كل ما سُحب من المخزن لقسم ما في فترة — كمية + تكلفة
 *                  + وزن بالجرام للأصناف الموزونة (من الأذونات الفعلية).
 *   ٢. تحليل الافطار : كوست مكونات الافطار (بيض/فول/عدس/…) من أذونات
 *                  المطبخ ÷ إيرادات كاشير 3 — بنسبة وتشخيص + ورقة رسمية A4.
 *
 * التصميم: هادئ فاخر (quiet premium) — نفس عائلة «المساعد الذكي».
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchBreakfastCost, fetchDepartmentIssues, fetchIssueDepartments,
    type BreakfastCost, type DepartmentIssues,
} from '../lib/department-cost';
import { Button } from '../ui';
import '../styles/department-cost.css';
import { useToast } from '../ui/Toast';
import { intOf, errorMessage } from '../lib/reporting';

const money2 = (v: number | null | undefined) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gramsText = (g: number | null | undefined) => (g === null || g === undefined ? '—' : `${g.toLocaleString('en-US')} ج`);

type Tab = 'department' | 'breakfast';

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoIso(days: number): string { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
function monthStartIso(): string {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    return first < '2026-11-01' ? '2026-11-01' : first;
}

/* ─────────────── طباعة ورقة رسمية A4 ─────────────── */
function buildOfficialSheet(opts: { title: string; subtitle: string; from: string; to: string; rows: string; kpiHtml: string }) {
    const { title, subtitle, from, to, rows, kpiHtml } = opts;
    const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${escape(title)}</title><style>
  @page{size:A4 portrait;margin:13mm 11mm}
  body{font-family:'Tajawal','Cairo','Segoe UI',Tahoma,sans-serif;color:#111;margin:0;font-size:11px}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2.5px double #000;padding-bottom:8px;margin-bottom:10px}
  .head img{width:56px;height:56px;object-fit:contain}
  .head h1{font-size:19px;margin:0 0 2px}
  .head p{margin:0;font-size:11px;color:#444}
  .meta{display:flex;gap:16px;font-size:10.5px;margin-bottom:10px;color:#333;flex-wrap:wrap}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:12px}
  .kpi{border:1px solid #bbb;border-radius:8px;padding:6px 8px}
  .kpi span{font-size:10px;color:#444;display:block}
  .kpi strong{font-size:14px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{border:1px solid #000;background:#eee;padding:5px;font-size:10.5px;text-align:right}
  td{border:1px solid #999;padding:4px 5px;font-size:10px}
  thead{display:table-header-group} tr{break-inside:avoid}
  h2{font-size:13px;margin:14px 0 6px;border-bottom:1.4px solid #000;padding-bottom:3px}
  .sign{display:flex;justify-content:space-between;margin-top:18px;font-size:10.5px}
  .sign div{border-top:1px solid #000;padding-top:4px;min-width:130px;text-align:center}
  .note{font-size:9px;color:#555;border:1px dashed #bbb;border-radius:6px;padding:6px 8px;margin-top:6px;line-height:1.6}
</style></head><body>
  <div class="head">
    <img src="/app/assets/karim-logo.png" alt="شعار المطعم">
    <div><h1>${escape(title)}</h1><p>${escape(subtitle)} — مطاعم الشرفة العالمي</p></div>
  </div>
  <div class="meta"><span><strong>الفترة:</strong> ${escape(from)} → ${escape(to)}</span><span><strong>الإصدار:</strong> ${escape(todayIso())}</span><span><strong>النظام:</strong> KARIM ERP</span></div>
  ${kpiHtml}
  ${rows}
  <div class="sign"><div>إعداد</div><div>مراجعة</div><div>اعتماد</div></div>
</body></html>`;
}

/* ═════════════════════════════════════════════════════════════════
   تبويب: وضع القسم
   ═════════════════════════════════════════════════════════════════ */
function DepartmentTab({ from, to }: { from: string; to: string }) {
    const { toast } = useToast();
    const departmentsQuery = useQuery({
        queryKey: ['issue-departments'],
        queryFn: ({ signal }) => fetchIssueDepartments(signal),
        staleTime: 300_000,
        retry: 0,
    });
    const [dept, setDept] = useState('المطبخ');

    const query = useQuery({
        queryKey: ['department-issues', dept, from, to],
        queryFn: ({ signal }) => fetchDepartmentIssues(dept, { from, to }, signal),
        enabled: Boolean(dept),
        staleTime: 30_000,
        retry: 0,
    });

    const data: DepartmentIssues | undefined = query.data;
    const maxCost = data?.items.reduce((m, r) => Math.max(m, r.cost || 0), 0) ?? 1;

    const printOfficial = () => {
        if (!data) { return; }
        const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const totals = data.totals;
        const kpis = `<div class="kpis">
      <div class="kpi"><span>عدد الأصناف</span><strong>${totals.items}</strong></div>
      <div class="kpi"><span>عدد الحركات</span><strong>${totals.moves}</strong></div>
      <div class="kpi"><span>التكلفة الإجمالية</span><strong>${money2(totals.cost)} ر.س</strong></div>
      <div class="kpi"><span>الوزن الكلي (كجم)</span><strong>${(totals.grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })}</strong></div>
    </div>`;
        const rows = `<h2>تفاصيل الأصناف المسحوبة من المخزن</h2>
    <table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن (جرام)</th><th>التكلفة</th><th>النسبة</th></tr></thead><tbody>
    ${data.items.map((r) => `<tr><td>${escape(r.name)}</td><td>${escape(r.unit)}</td><td>${r.qty}</td><td dir="ltr">${r.grams ?? '—'}</td><td>${money2(r.cost)} ر.س</td><td dir="ltr">${r.share}%</td></tr>`).join('')}
    </tbody></table>`;
        const html = buildOfficialSheet({
            title: `وضع القسم — ${data.department}`,
            subtitle: 'صرف فعلي من المخزن (أذونات)',
            from: data.from ?? from, to: data.to ?? to,
            rows, kpiHtml: kpis,
        });
        const win = window.open('', '_blank', 'width=900,height=1000');
        if (!win) { toast({ title: 'المتصفح حجب نافذة الطباعة', variant: 'error' }); return; }
        win.document.open(); win.document.write(html); win.document.close(); win.focus(); win.setTimeout(() => win.print(), 350);
    };

    return (
        <>
            <div className="dcost__filters">
                <label className="dcost__field">القسم
                    <select value={dept} onChange={(e) => setDept(e.target.value)}>
                        {(departmentsQuery.data ?? []).map((d) => (
                            <option key={d.code ?? d.dept} value={d.dept ?? ''}>{d.dept}</option>
                        ))}
                        {!departmentsQuery.data?.length ? <option value="المطبخ">المطبخ</option> : null}
                    </select>
                </label>
                <Button variant="secondary" size="sm" onClick={printOfficial} disabled={!data}>🖨 طباعة ورقة رسمية A4</Button>
            </div>

            {query.isPending && !data ? <div className="dcost__skeleton"><span /><span /><span /></div> : null}
            {query.isError ? <p className="text-body-sm text-danger" role="alert">{errorMessage(query.error)}</p> : null}

            {data ? (
                <>
                    <div className="dcost__kpis">
                        <div className="dcost__kpi"><span>عدد الأصناف</span><strong>{intOf(data.totals.items)}</strong></div>
                        <div className="dcost__kpi"><span>عدد الحركات</span><strong>{intOf(data.totals.moves)}</strong></div>
                        <div className="dcost__kpi"><span>التكلفة الإجمالية</span><strong>{money2(data.totals.cost)} <small>ر.س</small></strong></div>
                        <div className="dcost__kpi"><span>الوزن الكلي</span><strong dir="ltr">{(data.totals.grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} <small>كجم</small></strong></div>
                    </div>

                    {data.veg && data.veg.requests > 0 ? (
                        <p className="dcost__vegline">🌱 <strong>خضار طازج واردة من طلبات الخضار</strong>: {intOf(data.veg.requests)} طلب · {intOf(data.veg.items_count)} صنف · {money2(data.veg.qty_kg)} كجم (بدون تسعير مسجل)</p>
                    ) : null}

                    <div className="dcost__tablewrap">
                        <table className="dcost__table">
                            <thead>
                                <tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن (جرام)</th><th>الحركات</th><th>التكلفة</th><th>النسبة</th></tr>
                            </thead>
                            <tbody>
                                {data.items.map((r) => (
                                    <tr key={r.item_id}>
                                        <td>{r.name}</td>
                                        <td>{r.unit}</td>
                                        <td dir="ltr" className="erp-numeric">{r.qty}</td>
                                        <td dir="ltr" className="erp-numeric">{gramsText(r.grams)}</td>
                                        <td dir="ltr" className="erp-numeric">{r.moves}</td>
                                        <td dir="ltr" className="erp-numeric">{money2(r.cost)}</td>
                                        <td className="dcost__share">
                                            <span className="dcost__share-bar"><span style={{ inlineSize: `${Math.max(2, (r.cost / maxCost) * 100)}%` }} /></span>
                                            <span dir="ltr" className="erp-numeric">{r.share}%</span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p className="dcost__footnote">الوزن بالجرام للأصناف الموزونة (كيلو/جرام/طن)؛ الأصناف المعبأة وحدة العبوة كما هي — لا تقدير لأوزانها.</p>
                </>
            ) : null}
        </>
    );
}

/* ═════════════════════════════════════════════════════════════════
   تبويب: تحليل الفطار
   ═════════════════════════════════════════════════════════════════ */
function BreakfastTab({ from, to }: { from: string; to: string }) {
    const { toast } = useToast();
    const query = useQuery({
        queryKey: ['breakfast-cost', from, to],
        queryFn: ({ signal }) => fetchBreakfastCost({ from, to }, signal),
        staleTime: 30_000,
        retry: 0,
    });

    const data: BreakfastCost | undefined = query.data;
    const maxGroup = data?.groups.reduce((m, g) => Math.max(m, g.cost || 0), 0) ?? 1;
    const verdictClass = data ? `dcost__verdict dcost__verdict--${data.verdict.tone}` : 'dcost__verdict';

    const printOfficial = () => {
        if (!data) { return; }
        const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const kpis = `<div class="kpis">
      <div class="kpi"><span>إيراد الفطار (كاشير 3)</span><strong>${money2(data.revenue)} ر.س</strong></div>
      <div class="kpi"><span>تكلفة المكونات</span><strong>${money2(data.total_cost)} ر.س</strong></div>
      <div class="kpi"><span>نسبة التكلفة</span><strong>${data.cost_pct}%</strong></div>
      <div class="kpi"><span>عدد الأصناف</span><strong>${data.groups.reduce((s, g) => s + g.items.length, 0)}</strong></div>
    </div>`;
        const rows = `<h2>تفاصيل مكونات الافطار (من أذونات المطبخ)</h2>
    <table><thead><tr><th>المجموعة</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>التكلفة</th><th>النسبة</th></tr></thead><tbody>
    ${data.groups.map((g) => g.items.map((it, i) => `<tr><td>${i === 0 ? escape(g.group) : ''}</td><td>${escape(it.name)}</td><td>${escape(it.unit)}</td><td>${it.qty}</td><td>${money2(it.cost)} ر.س</td><td></td></tr>`).join('')).join('')}
    <tr><td colspan="4"><strong>الإجمالي</strong></td><td><strong>${money2(data.total_cost)} ر.س</strong></td><td><strong>100%</strong></td></tr>
    </tbody></table>
    <h2>الإيرادات مقابل التكلفة</h2>
    <table><thead><tr><th>المصدر</th><th>القيمة</th></tr></thead><tbody>
      <tr><td>إيراد الفطار — كاشير 3 (سجل الإيرادات، ${intOf(data.revenue_entries)} قيد)</td><td>${money2(data.revenue)} ر.س</td></tr>
      <tr><td>إيراد الفطار — YaraSoft (${intOf(2275)} فاتورة)</td><td>${money2(data.revenue_ys)} ر.س</td></tr>
      <tr><td><strong>نسبة تكلفة المكونات من الإيراد</strong></td><td><strong>${data.cost_pct}%</strong></td></tr>
    </tbody></table>
    <div class="note">${data.notes.map((n) => escape(n)).join('<br>')}</div>`;
        const html = buildOfficialSheet({
            title: 'تحليل تكلفة الافطار',
            subtitle: `مقارنة الإيراد بالتكلفة — كاشير 3`,
            from: data.from ?? from, to: data.to ?? to,
            rows, kpiHtml: kpis,
        });
        const win = window.open('', '_blank', 'width=900,height=1000');
        if (!win) { toast({ title: 'المتصفح حجب نافذة الطباعة', variant: 'error' }); return; }
        win.document.open(); win.document.write(html); win.document.close(); win.focus(); win.setTimeout(() => win.print(), 350);
    };

    return (
        <>
            <div className="dcost__filters">
                <span className="dcost__hint">إيراد الافطار = كاشير 3 · التكلفة = مكونات الفطار من أذونات المطبخ · مواد فقط</span>
                <Button variant="secondary" size="sm" onClick={printOfficial} disabled={!data}>🖨 طباعة ورقة رسمية A4</Button>
            </div>

            {query.isPending && !data ? <div className="dcost__skeleton"><span /><span /><span /></div> : null}
            {query.isError ? <p className="text-body-sm text-danger" role="alert">{errorMessage(query.error)}</p> : null}

            {data ? (
                <>
                    <div className="dcost__versus">
                        <div className="dcost__versus-cell">
                            <span className="dcost__versus-label">إيراد الافطار (كاشير 3)</span>
                            <strong className="dcost__versus-num" dir="ltr">{money2(data.revenue)} <small>ر.س</small></strong>
                            <span className="dcost__versus-sub">{intOf(data.revenue_entries)} قيد · YaraSoft {money2(data.revenue_ys)} ر.س</span>
                        </div>
                        <div className="dcost__versus-op">÷</div>
                        <div className="dcost__versus-cell">
                            <span className="dcost__versus-label">تكلفة مكونات الافطار</span>
                            <strong className="dcost__versus-num dcost__versus-num--cost" dir="ltr">{money2(data.total_cost)} <small>ر.س</small></strong>
                            <span className="dcost__versus-sub">{data.groups.length} مجموعات · {data.groups.reduce((s, g) => s + g.items.length, 0)} صنف</span>
                        </div>
                        <div className="dcost__versus-op">=</div>
                        <div className="dcost__versus-cell dcost__versus-cell--pct">
                            <span className="dcost__versus-label">نسبة التكلفة</span>
                            <strong className="dcost__versus-num dcost__versus-num--pct" dir="ltr">{data.cost_pct}%</strong>
                            <span className={verdictClass}>{data.verdict.text}</span>
                        </div>
                    </div>

                    {/* المكونات بالترتيب */}
                    <h3 className="dcost__h3">مكونات الافطار (من أذونات المطبخ)</h3>
                    <div className="dcost__groups">
                        {data.groups.map((g) => (
                            <div key={g.group} className="dcost__group">
                                <div className="dcost__group-head">
                                    <strong>{g.group}</strong>
                                    <span dir="ltr">{money2(g.cost)} ر.س · {g.share}%</span>
                                </div>
                                <div className="dcost__group-bar"><span style={{ inlineSize: `${Math.max(2, (g.cost / maxGroup) * 100)}%` }} /></div>
                                <ul className="dcost__group-items">
                                    {g.items.map((it) => (
                                        <li key={it.item_id}>
                                            <span>{it.name}</span>
                                            <span dir="ltr" className="dcost__item-qty">{it.qty} {it.unit}{it.grams !== null ? ` · ${(it.grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} كجم` : ''}</span>
                                            <span dir="ltr" className="dcost__item-cost">{money2(it.cost)}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {/* ملاحظات صادقة */}
                    <ul className="dcost__notes">
                        {data.notes.map((note, i) => <li key={i}>{note}</li>)}
                    </ul>
                </>
            ) : null}
        </>
    );
}

/* ═════════════════════════════════════════════════════════════════
   الشاشة الرئيسية
   ═════════════════════════════════════════════════════════════════ */
export function DepartmentCost() {
    const [tab, setTab] = useState<Tab>('breakfast');
    const [from, setFrom] = useState(monthStartIso());
    const [to, setTo] = useState(todayIso());
    const presets: Array<[string, string, string]> = [
        ['من ١ نوفمبر', '2026-11-01', todayIso()],
        ['آخر ٧ أيام', daysAgoIso(7), todayIso()],
        ['آخر ٣٠ يوم', daysAgoIso(30), todayIso()],
        ['من ١٥ أكتوبر', '2026-10-15', todayIso()],
    ];

    return (
        <section className="erp-card dcost" aria-labelledby="dcost-title">
            <div className="erp-card__body dcost__body">
                <header className="dcost__hero">
                    <div className="dcost__hero-text">
                        <span className="dcost__eyebrow">KARIM ERP · التكلفة الحقيقية</span>
                        <h2 id="dcost-title" className="dcost__title">وضع القسم — «كل شيء بالجرام»</h2>
                        <p className="dcost__sub">كل ما سُحب من المخزن لكل قسم من خلال الأذونات الفعلية + تحليل تكلفة الافطار مقابل إيراداته — بأعلى احترافية وطباعة رسمية</p>
                    </div>
                </header>

                <div className="dcost__filters dcost__filters--period">
                    <label className="dcost__field">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
                    <label className="dcost__field">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
                    <div className="dcost__presets" role="group" aria-label="فترات جاهزة">
                        {presets.map(([label, f, t2]) => (
                            <button
                                key={label}
                                type="button"
                                className={`dcost__preset${from === f && to === t2 ? ' is-active' : ''}`}
                                onClick={() => { setFrom(f); setTo(t2); }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="dcost__seg" role="tablist" aria-label="نوع التحليل">
                        {([['breakfast', 'تحليل الافطار'], ['department', 'وضع القسم']] as const).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={tab === key}
                                className={`dcost__seg-btn${tab === key ? ' is-active' : ''}`}
                                onClick={() => setTab(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>

                {tab === 'breakfast' ? <BreakfastTab from={from} to={to} /> : <DepartmentTab from={from} to={to} />}
            </div>
        </section>
    );
}
