/**
 * AiAssistant — «المساعد الذكي» 🧠 «وين الزيادة؟»
 * ═══════════════════════════════════════════════════════════════════════════
 * طلب المالك: مساعد يحلل المبيعات والمصاريف والكوست والمخازن وأذونات الصرف،
 * يقارن بنفس الفترة الأسبوع الماضي أو الشهر الماضي، وينبّه عند أي زيادة.
 *
 * المبادئ:
 *   • كل رقم من القاعدة (لا نموذج ولا تقدير) — المقارنة أيام كاملة متكافئة.
 *   • إن كانت تغطية مصدرٍ ماضية أقصر من 80% من الأيام ⇒ المقارنة بمعدل اليوم
 *     ويُعلن ذلك صراحة (fairNotes).
 *   • التنبيه على «أي زيادة» افتراضيًا، ونسبة الإنذار قابلة للضبط من الشاشة.
 *   • الذكاء الاصطناعي **اختياري ومجاني**: النموذج المحلي يُستدعى فقط عند
 *     زر «اشرح الصورة» — العرض كله يعمل بدونه.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
    explainAnalytics, fetchAnalytics, type AnalyticsRange, type AnalyticsReport,
} from '../lib/ai-assistant';
import { Button } from '../ui';
import '../styles/ai-assistant.css';
import { errorMessage } from '../lib/reporting';
import { useToast } from '../ui/Toast';

const money = (v: number | null | undefined) =>
    Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (v: number | null | undefined) => Number(v || 0).toLocaleString('en-US');

function deltaBadge(deltaPct: number, lowerIsBetter?: boolean | null) {
    const up = deltaPct >= 0;
    const good = lowerIsBetter == null ? up : (up ? !lowerIsBetter : lowerIsBetter);
    const cls = deltaPct === 0
        ? 'ai-delta ai-delta--flat'
        : good ? 'ai-delta ai-delta--good' : 'ai-delta ai-delta--bad';
    const arrow = deltaPct === 0 ? '●' : up ? '▲' : '▼';
    const sign = deltaPct > 0 ? '+' : '';
    return (
        <span className={cls} dir="ltr">
            {arrow} {sign}{deltaPct.toFixed(1)}%
        </span>
    );
}

const SEVERITY: Record<string, { cls: string; label: string }> = {
    high: { cls: 'ai-alert ai-alert--high', label: 'حرج' },
    medium: { cls: 'ai-alert ai-alert--medium', label: 'انتباه' },
    low: { cls: 'ai-alert ai-alert--low', label: 'ملاحظة' },
};
const SEV_FALLBACK = SEVERITY.low as { cls: string; label: string };
function severityOf(sev: string | null | undefined): { cls: string; label: string } {
    return (sev && SEVERITY[sev]) || SEV_FALLBACK;
}

const METRIC_ORDER = ['sales', 'avgTicket', 'expenses', 'materials', 'warehouseOut', 'dispatches', 'purchases', 'attendance'] as const;

function ExplainPanel({ report }: { report: AnalyticsReport }) {
    const { toast } = useToast();
    const [busy, setBusy] = useState(false);
    const [elapsed, setElapsed] = useState(0);
    const [result, setResult] = useState<{ text: string; model: string | null; ms: number; fallback?: boolean | null } | null>(null);

    useEffect(() => {
        if (!busy) { return undefined; }
        const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
        return () => window.clearInterval(t);
    }, [busy]);

    const ask = async () => {
        setBusy(true);
        setElapsed(0);
        setResult(null);
        try {
            const out = await explainAnalytics(report.range === 'month' ? 'month' : 'week', report.alertPct);
            setResult({ text: out.text ?? '', model: out.model ?? null, ms: out.ms, fallback: out.fallback ?? null });
        } catch (err) {
            toast({
                title: err instanceof Error ? err.message : 'تعذّر الوصول للنموذج المحلي',
                variant: 'error',
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="ai-panel ai-explain" aria-label="شرح بالذكاء الاصطناعي">
            <div className="ai-panel__head">
                <div>
                    <h3 className="ai-panel__title">اشرح الصورة بالذكاء الاصطناعي <span className="ai-free">محلي · مجاني</span></h3>
                    <p className="ai-panel__sub">النموذج المحلي (Ollama على هذا الجهاز) يقرأ هذه الأرقام ويصوغها قرارًا — لا يُرسل أي شيء خارج الجهاز.</p>
                </div>
                <Button variant="primary" size="sm" onClick={ask} disabled={busy}>
                    {busy ? <>جارٍ التحليل… {elapsed}ث</> : '✦ اشرح الصورة'}
                </Button>
            </div>
            {result ? (
                <div className="ai-explain__result">
                    <div className="ai-explain__meta">
                        <span className="ai-chip">النموذج: {result.model || 'محلي (غير متاح — الحقائق فقط)'}</span>
                        <span className="ai-chip">الزمن: {(result.ms / 1000).toFixed(1)} ث</span>
                        {result.fallback ? <span className="ai-chip ai-chip--warn">النموذج المحلي غير متاح — الرد حقائق مقاسة</span> : null}
                    </div>
                    <pre className="ai-explain__text">{result.text}</pre>
                </div>
            ) : null}
        </section>
    );
}

export function AiAssistant() {
    const { toast } = useToast();
    const [range, setRange] = useState<AnalyticsRange>('week');
    const [alertPct, setAlertPct] = useState(0);

    const query = useQuery({
        queryKey: ['ai-analytics', range, alertPct],
        queryFn: ({ signal }) => fetchAnalytics(range, alertPct, signal),
        staleTime: 60_000,
        retry: 1,
        placeholderData: (prev) => prev,
    });

    const report = query.data;
    const alerts = useMemo(() => report?.alerts ?? [], [report]);
    const reduction = useMemo(() => report?.reductionTargets ?? [], [report]);
    const maxIncrease = useMemo(
        () => reduction.reduce((acc, t) => Math.max(acc, t.increase || 0), 0),
        [reduction],
    );

    const printOfficial = () => {
        if (!report) { return; }
        const win = window.open('', '_blank', 'width=900,height=1000');
        if (!win) {
            toast({ title: 'المتصفح حجب نافذة الطباعة — اسمح بالنوافذ المنبثقة', variant: 'error' });
            return;
        }
        const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const metricRows = METRIC_ORDER.map((key) => report.metrics[key]).map((m) =>
            `<tr><td>${escape(m.label)}</td><td>${escape(money(m.current))} ${escape(m.unit)}</td><td>${escape(money(m.previous))} ${escape(m.unit)}</td><td dir="ltr">${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%</td></tr>`,
        ).join('');
        const alertRows = alerts.slice(0, 12).map((a) =>
            `<tr><td>${escape(a.area)}</td><td>${escape(a.title)}</td><td>${escape(a.action)}</td></tr>`,
        ).join('');
        const reductionRows = reduction.map((t) =>
            `<tr><td>${escape(t.area)}</td><td>+${escape(money(t.increase))} ر.س (${t.increasePct.toFixed(1)}%)</td><td>${escape(t.note)}</td></tr>`,
        ).join('');
        win.document.open();
        win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>المساعد الذكي — مقارنة الفترة</title><style>
  @page{size:A4 portrait;margin:13mm 11mm}
  body{font-family:'Tajawal','Cairo','Segoe UI',Tahoma,sans-serif;color:#111;margin:0;font-size:11px}
  .head{display:flex;align-items:center;gap:14px;border-bottom:2.5px double #000;padding-bottom:8px;margin-bottom:10px}
  .head img{width:56px;height:56px;object-fit:contain}
  .head h1{font-size:19px;margin:0 0 2px}
  .head p{margin:0;font-size:11px;color:#444}
  .meta{display:flex;gap:16px;font-size:10.5px;margin-bottom:10px;color:#333;flex-wrap:wrap}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{border:1px solid #000;background:#eee;padding:5px;text-align:right;font-size:10.5px}
  td{border:1px solid #999;padding:4px 5px;font-size:10px}
  thead{display:table-header-group} tr{break-inside:avoid}
  h2{font-size:13px;margin:14px 0 6px;border-bottom:1.4px solid #000;padding-bottom:3px}
  .sign{display:flex;justify-content:space-between;margin-top:18px;font-size:10.5px}
  .sign div{border-top:1px solid #000;padding-top:4px;min-width:130px;text-align:center}
  .note{font-size:9px;color:#555;border:1px dashed #bbb;border-radius:6px;padding:6px 8px;margin-bottom:10px}
</style></head><body>
  <div class="head">
    <img src="/app/assets/karim-logo.png" alt="شعار المطعم">
    <div><h1>المساعد الذكي — مقارنة الفترة</h1><p>مطاعم الشرفة العالمي — تحليل حتمي من بيانات النظام الحقيقية</p></div>
  </div>
  <div class="meta"><span><strong>الفترة:</strong> ${escape(report.current.from)} → ${escape(report.current.to)} (${report.days} يوم)</span><span><strong>المقارنة:</strong> ${escape(report.previous.from)} → ${escape(report.previous.to)}</span><span><strong>حدّ التنبيه:</strong> ${report.alertPct}%</span><span><strong>الإصدار:</strong> ${escape(new Date().toISOString().slice(0, 10))}</span></div>
  ${report.fairNotes && report.fairNotes.length ? `<div class="note">ملاحظة منهجية: ${escape(report.fairNotes.join(' · '))}</div>` : ''}
  <h2>المؤشرات</h2>
  <table><thead><tr><th>المؤشر</th><th>الحالية</th><th>السابقة</th><th>التغيّر</th></tr></thead><tbody>${metricRows}</tbody></table>
  ${alertRows ? `<h2>التنبيهات</h2><table><thead><tr><th>المجال</th><th>التنبيه</th><th>الإجراء المقترح</th></tr></thead><tbody>${alertRows}</tbody></table>` : '<p>لا توجد تنبيهات — كل الأرقام ضمن الحدود.</p>'}
  ${reductionRows ? `<h2>فرص التخفيض</h2><table><thead><tr><th>البند</th><th>الزيادة</th><th>ملاحظة</th></tr></thead><tbody>${reductionRows}</tbody></table>` : ''}
  <div class="sign"><div>إعداد</div><div>مراجعة</div><div>اعتماد</div></div>
</body></html>`);
        win.document.close();
        win.focus();
        win.setTimeout(() => win.print(), 350);
    };

    return (
        <section className="erp-card ai-assistant" aria-labelledby="ai-assistant-title">
            <div className="erp-card__body ai-assistant__body">

                {/* ═══════ الترويسة ═══════ */}
                <header className="ai-hero">
                    <div className="ai-hero__text">
                        <span className="ai-hero__eyebrow">AI · LOCAL · FREE</span>
                        <h2 id="ai-assistant-title" className="ai-hero__title">المساعد الذكي <span className="ai-hero__q">«وين الزيادة؟»</span></h2>
                        <p className="ai-hero__sub">المبيعات · المصاريف · الكوست · المخازن · أذونات الصرف — مقارنة عادلة مع نفس الفترة الماضية، وتنبيه لأي زيادة</p>
                    </div>
                    <Button variant="secondary" size="sm" className="ai-hero__print" onClick={printOfficial} disabled={!report}>
                        🖨 طباعة ورقة رسمية
                    </Button>
                </header>

                {/* ═══════ أدوات التحكم: الفترة وحدّ التنبيه ═══════ */}
                <div className="ai-controls">
                    <div className="ai-seg" role="tablist" aria-label="الفترة">
                        {([['week', 'هذا الأسبوع vs الأسبوع الماضي'], ['month', 'هذا الشهر vs الشهر الماضي']] as const).map(([key, label]) => (
                            <button
                                key={key}
                                type="button"
                                role="tab"
                                aria-selected={range === key}
                                className={`ai-seg__btn${range === key ? ' is-active' : ''}`}
                                onClick={() => setRange(key)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <label className="ai-threshold">
                        <span className="ai-threshold__label">حدّ التنبيه: <strong dir="ltr">{alertPct}%</strong> {alertPct === 0 ? '(أي زيادة)' : ''}</span>
                        <input
                            type="range"
                            min={0}
                            max={25}
                            step={1}
                            value={alertPct}
                            onChange={(e) => setAlertPct(Number(e.target.value))}
                            aria-label="نسبة الإنذار على الزيادة"
                        />
                        <span className="ai-threshold__marks"><i>٠٪</i><i>٥٪</i><i>١٠٪</i><i>١٥٪</i><i>٢٥٪</i></span>
                    </label>
                </div>

                {query.isError ? (
                    <p className="text-body-sm text-danger" role="alert">تعذّر جلب التحليل — {errorMessage(query.error)}</p>
                ) : null}

                {query.isPending && !report ? (
                    <div className="ai-skeleton" aria-label="جارٍ حساب المقارنة"><span /><span /><span /><span /></div>
                ) : null}

                {report ? (
                    <>
                        {/* ═══════ ملاحظة منهجية عند تغطية غير متكافئة ═══════ */}
                        {report.fairNotes && report.fairNotes.length ? (
                            <div className="ai-fairnote" role="note">
                                <strong>منهج المقارنة:</strong> {report.fairNotes.join(' ')}
                            </div>
                        ) : null}

                        {/* ═══════ شريط مؤشرات كل موديولات النظام ═══════ */}
                        <div className="ai-kpis">
                            {METRIC_ORDER.map((key) => {
                                const m = report.metrics[key];
                                return (
                                <div key={key} className="ai-kpi">
                                    <span className="ai-kpi__label">{m.label}</span>
                                    <strong className="ai-kpi__value" dir="ltr">{m.unit === 'إذن' ? int(m.current) : money(m.current)}<small> {m.unit}</small></strong>
                                    <div className="ai-kpi__foot">
                                        {deltaBadge(m.deltaPct, m.lowerIsBetter)}
                                        <span className="ai-kpi__sub">{m.sub || `مقابل ${money(m.previous)}`}</span>
                                    </div>
                                </div>
                                );
                            })}
                        </div>

        
                {/* ═══════ يحتاج قرارك الآن ═══════ */}
                {report.pending ? (
                    <>
                        <div className="ai-section-head">
                            <h3 className="ai-section-head__title">يحتاج قرارك الآن
                                <span className="ai-count ai-count--amber">{(() => { const p = report.pending; return [p.dispatchesAwaiting, p.purchaseRequestsAwaiting, p.leavesAwaiting, p.openShifts, p.belowMinItems, p.negativeStockItems].reduce((a, b) => a + b, 0) + (p.daysSinceClose !== null && p.daysSinceClose !== undefined && p.daysSinceClose > 0 ? 1 : 0); })()}</span>
                            </h3>
                            <span className="ai-section-head__hint">لقطة لحظية من النظام — ليست مقارنة</span>
                        </div>
                        <div className="ai-decisions">
                            {report.pending.dispatchesAwaiting > 0 ? (
                                <Link to="/dispatch" className="ai-decision ai-decision--amber">
                                    <span className="ai-decision__count">{report.pending.dispatchesAwaiting}</span>
                                    <span className="ai-decision__text"><strong>إذن صرف بلا اعتماد</strong><small>بانتظار قرارك في المطبخ/القسم</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.purchaseRequestsAwaiting > 0 ? (
                                <Link to="/wh-prs" className="ai-decision ai-decision--amber">
                                    <span className="ai-decision__count">{report.pending.purchaseRequestsAwaiting}</span>
                                    <span className="ai-decision__text"><strong>طلب شراء ينتظر</strong><small>اعتماد chef/GM قبل التنفيذ</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.leavesAwaiting > 0 ? (
                                <Link to="/leaves" className="ai-decision ai-decision--amber">
                                    <span className="ai-decision__count">{report.pending.leavesAwaiting}</span>
                                    <span className="ai-decision__text"><strong>إجازة معلّقة</strong><small>اعتماد مشرف القسم</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.openShifts > 0 ? (
                                <Link to="/cashier-monitor" className="ai-decision ai-decision--amber">
                                    <span className="ai-decision__count">{report.pending.openShifts}</span>
                                    <span className="ai-decision__text"><strong>وردية مفتوحة</strong><small>نقد لم يُقفل — Z بعد قليل</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.daysSinceClose !== null && report.pending.daysSinceClose !== undefined && report.pending.daysSinceClose > 0 ? (
                                <Link to="/daily-locks" className="ai-decision ai-decision--red">
                                    <span className="ai-decision__count">{report.pending.daysSinceClose}</span>
                                    <span className="ai-decision__text"><strong>يوم بلا إقفال</strong><small>آخر إقفال كان {report.pending.lastDayClose}</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.belowMinItems > 0 ? (
                                <Link to="/warehouse" className="ai-decision ai-decision--amber">
                                    <span className="ai-decision__count">{report.pending.belowMinItems}</span>
                                    <span className="ai-decision__text"><strong>صنف تحت الحد الأدنى</strong><small>نافذة إعادة الطلب تمر دون توريد</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.pending.negativeStockItems > 0 ? (
                                <Link to="/warehouse" className="ai-decision ai-decision--red">
                                    <span className="ai-decision__count">{report.pending.negativeStockItems}</span>
                                    <span className="ai-decision__text"><strong>صنف رصيده سالب</strong><small>استهلاك بلا صرف — الكوست غير موثوق</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                            {report.inventoryOnHand ? (
                                <Link to="/warehouse" className="ai-decision ai-decision--neutral">
                                    <span className="ai-decision__count" dir="ltr">{Math.round(report.inventoryOnHand.value / 1000)}K</span>
                                    <span className="ai-decision__text"><strong>قيمة المخزون القائم</strong><small>{report.inventoryOnHand.items} صنف بمتوسط تكلفة</small></span>
                                    <span className="ai-decision__go">←</span>
                                </Link>
                            ) : null}
                        </div>
                    </>
                ) : null}

                {/* ═══════ التنبيهات ═══════ */}
                        <div className="ai-section-head">
                            <h3 className="ai-section-head__title">التنبيهات <span className="ai-count">{alerts.length}</span></h3>
                            {alerts.length ? <span className="ai-section-head__hint">مرتبة حسب الخطورة — أي زيادة فوق {report.alertPct}%</span> : null}
                        </div>

                        {alerts.length === 0 ? (
                            <div className="ai-allclear" role="status">
                                <span className="ai-allclear__icon">✓</span>
                                <div>
                                    <strong>لا توجد تنبيهات</strong>
                                    <p>كل المؤشرات ضمن الحد — المصروفات والكوست والمخزن في اتجاهها الطبيعي.</p>
                                </div>
                            </div>
                        ) : (
                            <ol className="ai-alerts">
                                {alerts.map((a) => {
                                    const sev = severityOf(a.severity);
                                    return (
                                        <li key={a.id ?? a.title} className={sev.cls}>
                                            <div className="ai-alert__row">
                                                <span className="ai-alert__badge">{sev.label}</span>
                                                <div className="ai-alert__body">
                                                    <div className="ai-alert__top">
                                                        <strong>{a.title}</strong>
                                                        <span className="ai-alert__area">{a.area}</span>
                                                    </div>
                                                    <p className="ai-alert__detail">{a.detail}</p>
                                                    <p className="ai-alert__action"><span>الفعل المقترح:</span> {a.action}</p>
                                                </div>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ol>
                        )}

                        {/* ═══════ فرص التخفيض ═══════ */}
                        {reduction.length ? (
                            <>
                                <div className="ai-section-head">
                                    <h3 className="ai-section-head__title">فرص التخفيض</h3>
                                    <span className="ai-section-head__hint">أكبر زيادات ممكن استردادها — راجعها بالترتيب</span>
                                </div>
                                <ol className="ai-reduction">
                                    {reduction.map((t) => (
                                        <li key={t.area} className="ai-reduction__row">
                                            <span className="ai-reduction__rank">{reduction.indexOf(t) + 1}</span>
                                            <span className="ai-reduction__area">{t.area}</span>
                                            <span className="ai-reduction__delta" dir="ltr">+{money(t.increase)} ر.س</span>
                                            <span className="ai-reduction__bar"><span style={{ inlineSize: `${maxIncrease > 0 ? (t.increase / maxIncrease) * 100 : 0}%` }} /></span>
                                            <span className="ai-reduction__pct" dir="ltr">+{t.increasePct.toFixed(1)}%</span>
                                        </li>
                                    ))}
                                </ol>
                            </>
                        ) : null}

                        {/* ═══════ المصروفات حسب الفئة + أذونات الصرف حسب القسم ═══════ */}
                        <div className="ai-panels">
                            <div className="ai-panel">
                                <h3 className="ai-panel__title">المصروفات حسب الفئة</h3>
                                <p className="ai-panel__sub">الأعلى قيمةً — التغيّر vs الفترة السابقة (مقاس بمعدل اليوم عند عدم تساوي التغطية)</p>
                                <table className="ai-table">
                                    <thead><tr><th>الفئة</th><th>الحالية</th><th>السابقة</th><th>التغيّر</th></tr></thead>
                                    <tbody>
                                        {(report.expenseCategories ?? []).slice(0, 8).map((row) => (
                                            <tr key={row.category}>
                                                <td>{row.category}</td>
                                                <td className="erp-numeric">{money(row.current)}</td>
                                                <td className="erp-numeric">{money(row.previous)}</td>
                                                <td className="erp-numeric">{deltaBadge(row.deltaPct, true)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="ai-panel">
                                <h3 className="ai-panel__title">أذونات الصرف حسب القسم</h3>
                                <p className="ai-panel__sub">{report.dispatches.curRequests} إذن · {int(report.dispatches.curItems)} بند — أكثر الأقسام طلبًا</p>
                                <table className="ai-table">
                                    <thead><tr><th>القسم</th><th>الحالية</th><th>السابقة</th><th>البنود</th><th>التغيّر</th></tr></thead>
                                    <tbody>
                                        {(report.dispatches.byDept ?? []).slice(0, 8).map((d) => (
                                            <tr key={d.dept}>
                                                <td>{d.dept}</td>
                                                <td className="erp-numeric">{d.requests}</td>
                                                <td className="erp-numeric">{d.previous}</td>
                                                <td className="erp-numeric">{int(d.items)}</td>
                                                <td className="erp-numeric">{deltaBadge(d.deltaPct, true)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <div className="ai-panel">
                                <h3 className="ai-panel__title">المشتريات حسب المورد</h3>
                                <p className="ai-panel__sub">{report.purchases.curInvoices} فاتورة — الأعلى قيمة في الفترة</p>
                                <table className="ai-table">
                                    <thead><tr><th>المورد</th><th>فواتير</th><th>القيمة</th></tr></thead>
                                    <tbody>
                                        {(report.purchases.topSuppliers ?? []).map((s) => (
                                            <tr key={s.supplier}>
                                                <td>{s.supplier}</td>
                                                <td className="erp-numeric">{s.invoices}</td>
                                                <td className="erp-numeric">{money(s.value)}</td>
                                            </tr>
                                        ))}
                                        {(report.purchases.topSuppliers ?? []).length === 0 ? (
                                            <tr><td colSpan={3} className="text-body-sm text-muted">لا توجد فواتير في الفترة</td></tr>
                                        ) : null}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* ═══════ لوحة الذكاء الاصطناعي (اختياري — محلي ومجاني) ═══════ */}
                        <ExplainPanel report={report} />
                    </>
                ) : null}
            </div>
        </section>
    );
}
