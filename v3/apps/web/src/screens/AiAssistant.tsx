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
    explainAnalytics, fetchAnalytics, fetchLookup, fetchRadar,
    type AnalyticsRange, type AnalyticsReport, type LookupReport, type RadarReport,
} from '../lib/ai-assistant';
import { printOfficialSheet, type OfficialSheetColumn } from '../lib/official-print';
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
    const [fromDate, setFromDate] = useState(() => new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10));
    const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
    const [alertPct, setAlertPct] = useState(0);
    const [keyword, setKeyword] = useState('شاورما');
    const [appliedKeyword, setAppliedKeyword] = useState('شاورما');

    const radarQuery = useQuery({
        queryKey: ['ai-radar'],
        queryFn: ({ signal }) => fetchRadar(signal),
        staleTime: 60_000,
        refetchInterval: 120_000,
        retry: 0,
    });
    const radar: RadarReport | undefined = radarQuery.data;

    const lookupQuery = useQuery({
        queryKey: ['ai-lookup', appliedKeyword, fromDate, toDate],
        queryFn: ({ signal }) => fetchLookup(appliedKeyword, { from: fromDate, to: toDate }, signal),
        enabled: appliedKeyword.trim().length >= 2,
        staleTime: 30_000,
        retry: 0,
        placeholderData: (prev) => prev,
    });
    const lookup: LookupReport | undefined = lookupQuery.data;

    const query = useQuery({
        queryKey: ['ai-analytics', range, alertPct, range === 'custom' ? fromDate : '', range === 'custom' ? toDate : ''],
        queryFn: ({ signal }) => fetchAnalytics(range, alertPct, signal, range === 'custom' ? fromDate : undefined, range === 'custom' ? toDate : undefined),
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
        printOfficialSheet({
            title: 'المساعد الذكي «وين الزيادة؟»',
            englishTitle: 'AI Assistant — Where did it increase?',
            subtitle: 'تقرير حتمي من بيانات النظام',
            from: report.current.from ?? '',
            to: report.current.to ?? '',
            kpis: METRIC_ORDER.map((key) => {
                const m = report.metrics[key];
                if (!m) { return null; }
                return { label: m.label ?? key, value: `${m.unit === 'إذن' ? int(m.current) : money(m.current)} ${m.unit ?? ''}`, hint: m.deltaPct !== undefined ? `${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}% vs الفترة السابقة` : '' };
            }).filter((k): k is NonNullable<typeof k> => k !== null),
            sections: [
                {
                    heading: 'المؤشرات',
                    columns: [
                        { key: 'label', header: 'المؤشر', width: '30%' } as const,
                        { key: 'current', header: 'الحالية', align: 'end' as const },
                        { key: 'previous', header: 'السابقة', align: 'end' as const },
                        { key: 'delta', header: 'التغيّر', align: 'end' as const },
                    ] as OfficialSheetColumn[],
                    rows: METRIC_ORDER.map((key) => {
                        const m = report.metrics[key];
                        return {
                            label: m.label ?? key,
                            current: `${m.unit === 'إذن' ? int(m.current) : money(m.current)} ${m.unit ?? ''}`,
                            previous: `${m.unit === 'إذن' ? int(m.previous) : money(m.previous)} ${m.unit ?? ''}`,
                            delta: `${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(1)}%`,
                        };
                    }),
                },
                ...(alerts.length ? [{
                    heading: 'التنبيهات',
                    columns: [
                        { key: 'area', header: 'المجال', width: '18%' } as const,
                        { key: 'title', header: 'التنبيه' } as const,
                        { key: 'action', header: 'الإجراء المقترح', width: '34%' } as const,
                    ] as OfficialSheetColumn[],
                    rows: alerts.slice(0, 12).map((a) => ({ area: a.area ?? '', title: a.title ?? '', action: a.action ?? '' })),
                }] : []),
                ...(reduction.length ? [{
                    heading: 'فرص التخفيض',
                    columns: [
                        { key: 'area', header: 'البند', width: '30%' } as const,
                        { key: 'increase', header: 'الزيادة', align: 'end' as const },
                        { key: 'note', header: 'الملاحظة' } as const,
                    ] as OfficialSheetColumn[],
                    rows: reduction.map((t) => ({ area: t.area ?? '', increase: `+${money(t.increase)} ر.س (${t.increasePct.toFixed(1)}%)`, note: t.note ?? '' })),
                }] : []),
            ],
            notes: (report.fairNotes ?? []).filter((n): n is string => typeof n === 'string' && n.length > 0),
            signatures: [{ role: 'إعداد' }, { role: 'مراجعة' }, { role: 'اعتماد' }],
        }) || toast({ title: 'المتصفح حجب نافذة الطباعة — اسمح بالنوافذ المنبثقة', variant: 'error' });
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


                {/* ═══════ الرادار — صاحي دايمًا ═══════ */}
                {radar && radar.total > 0 ? (
                    <div className="ai-radar" role="alert" aria-label="تنبيهات الرادار">
                        <div className="ai-radar__head">
                            <span className="ai-radar__dot" aria-hidden="true" />
                            <strong>الرادار الحي</strong>
                            <span className="ai-radar__meta">فحص كل دقيقتين · {radar.total} تنبيه{radar.critical > 0 ? ` · ${radar.critical} حرج` : ''}{radar.high > 0 ? ` · ${radar.high} مهم` : ''}</span>
                        </div>
                        <ul className="ai-radar__list">
                            {radar.items.slice(0, 4).map((a) => (
                                <li key={a.id} className={`ai-radar__item ai-radar__item--${a.severity}`}>
                                    <span className="ai-radar__area">{a.area}</span>
                                    <div className="ai-radar__body">
                                        <strong>{a.title}</strong>
                                        <span>{a.action}</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : radar && radar.total === 0 ? (
                    <div className="ai-radar ai-radar--clear" role="status">
                        <span className="ai-radar__dot ai-radar__dot--ok" aria-hidden="true" />
                        <strong>الرادار الحي</strong>
                        <span>لا شيء خارج الحدود — النظام كله سليم.</span>
                    </div>
                ) : null}

                {/* ═══════ أدوات التحكم: الفترة وحدّ التنبيه ═══════ */}
                <div className="ai-controls">
                    <div className="ai-seg" role="tablist" aria-label="الفترة">
                        {([['week', 'هذا الأسبوع'], ['month', 'هذا الشهر'], ['custom', 'فترة محددة']] as const).map(([key, label]) => (
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
                    {range === 'custom' ? (
                        <div className="ai-custom-range" role="group" aria-label="فترة مخصصة">
                            <label className="ai-threshold__field">من<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
                            <label className="ai-threshold__field">إلى<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
                        </div>
                    ) : null}

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


                        {/* ═══════ بحث ذكي بكلمة ═══════ */}
                        <div className="ai-lookup">
                            <div className="ai-section-head">
                                <h3 className="ai-section-head__title">بحث ذكي بكلمة <small>(شاورما · مشويات · أي شيء)</small></h3>
                                <span className="ai-section-head__hint">مبيعات + صرف + قيمة مخزنية لأي كلمة</span>
                            </div>
                            <form className="ai-lookup__form" onSubmit={(e) => { e.preventDefault(); setAppliedKeyword(keyword.trim()); }}>
                                <input
                                    type="text"
                                    value={keyword}
                                    onChange={(e) => setKeyword(e.target.value)}
                                    placeholder="اكتب: شاورما أو مشويات أو كبسة…"
                                    dir="auto"
                                    aria-label="كلمة البحث"
                                />
                                <Button type="submit" variant="primary" size="sm">ابحث</Button>
                            </form>
                            {lookupQuery.isPending && !lookup ? <div className="ai-skeleton"><span /><span /><span /></div> : null}
                            {lookupQuery.isError ? <p className="text-body-sm text-danger" role="alert">{errorMessage(lookupQuery.error)}</p> : null}
                            {lookup ? (
                                <>
                                    <div className="ai-lookup__kpis">
                                        <div className="ai-kpi"><span className="ai-kpi__label">الإيراد</span><strong className="ai-kpi__value" dir="ltr">{money(lookup.sales.revenue)}<small> ر.س</small></strong><span className="ai-kpi__sub">{lookup.sales.share_of_revenue}% من إجمالي المبيعات</span></div>
                                        <div className="ai-kpi"><span className="ai-kpi__label">الفواتير</span><strong className="ai-kpi__value" dir="ltr">{int(lookup.sales.invoices)}</strong><span className="ai-kpi__sub">{int(lookup.sales.lines)} صنف · {money(lookup.sales.qty)} قطعة</span></div>
                                        <div className="ai-kpi"><span className="ai-kpi__label">صرف المخزن</span><strong className="ai-kpi__value" dir="ltr">{money(lookup.issues_cost)}<small> ر.س</small></strong><span className="ai-kpi__sub">{(lookup.issues ?? []).reduce((s, i) => s + i.moves, 0)} حركة</span></div>
                                        <div className="ai-kpi"><span className="ai-kpi__label">قيمة المخزون المطابق</span><strong className="ai-kpi__value" dir="ltr">{money(lookup.inventory.value)}<small> ر.س</small></strong><span className="ai-kpi__sub">{lookup.inventory.items} صنف</span></div>
                                    </div>
                                    <div className="ai-panels">
                                        <div className="ai-panel">
                                            <h3 className="ai-panel__title">الأكثر مبيعًا</h3>
                                            <table className="ai-table">
                                                <thead><tr><th>الصنف</th><th>الكمية</th><th>الإيراد</th></tr></thead>
                                                <tbody>
                                                    {(lookup.sales_breakdown ?? []).map((row) => (
                                                        <tr key={row.name}><td>{row.name}</td><td className="erp-numeric">{money(row.qty)}</td><td className="erp-numeric">{money(row.revenue)}</td></tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="ai-panel">
                                            <h3 className="ai-panel__title">المنصرف من المخزن</h3>
                                            <table className="ai-table">
                                                <thead><tr><th>الصنف</th><th>الكمية</th><th>التكلفة</th></tr></thead>
                                                <tbody>
                                                    {(lookup.issues ?? []).map((row) => (
                                                        <tr key={row.item_id}><td>{row.name}</td><td className="erp-numeric">{money(row.qty)} {row.unit}</td><td className="erp-numeric">{money(row.cost)}</td></tr>
                                                    ))}
                                                    {(lookup.issues ?? []).length === 0 ? (<tr><td colSpan={3} className="text-body-sm text-muted">لا توجد أصناف مطابقة في الصرف</td></tr>) : null}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </>
                            ) : null}
                        </div>

                        {/* ═══════ لوحة الذكاء الاصطناعي (اختياري — محلي ومجاني) ═══════ */}
                        <ExplainPanel report={report} />
                    </>
                ) : null}
            </div>
        </section>
    );
}
