/**
 * DepartmentCost — وضع القسم «كل شيء بالجرام»
 * ══════════════════════════════════════════════════════════════
 * تبويبان:
 *   ١. وضع القسم  : كل ما سُحب من المخزن لقسم ما في فترة — كمية + تكلفة
 *                  + وزن بالجرام للأصناف الموزونة (من الأذونات الفعلية).
 *   ٢. تحليل الافطار : كوست مكونات الافطار (بيض/فول/عدس/…) من أذونات
 *                  المطبخ ÷ إيرادات كاشير 3 — بنسبة وتشخيص + ورقة رسمية A4.
 *
 * التصميم: هادئ فاخر (quiet premium) — نفس عائلة «المساعد الذكي».
 */
import { useEffect as reactUseEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    fetchBreakfastCost, fetchDepartmentIssues, fetchIssueDepartments, fetchSearchItems,
    type BreakfastCost, type DepartmentIssues, type InventorySearchItem,
} from '../lib/department-cost';
import { Button } from '../ui';
import '../styles/department-cost.css';
import { intOf, errorMessage } from '../lib/reporting';
import { printOfficialSheet, type OfficialSheetColumn } from '../lib/official-print';

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

/* ─── تبويب: وضع القسم ─── */
function DepartmentTab({ from, to }: { from: string; to: string }) {
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
        const totals = data.totals;
        printOfficialSheet({
            title: `وضع القسم — ${data.department}`,
            englishTitle: 'Department Issues from Warehouse',
            subtitle: 'صرف فعلي من المخزن (أذونات)',
            from: data.from ?? from, to: data.to ?? to,
            kpis: [
                { label: 'عدد الأصناف', value: intOf(totals.items) },
                { label: 'عدد الحركات', value: intOf(totals.moves) },
                { label: 'التكلفة الإجمالية', value: `${money2(totals.cost)} ر.س` },
                { label: 'الوزن الكلي', value: `${(totals.grams / 1000).toLocaleString('en-US', { maximumFractionDigits: 2 })} كجم` },
            ],
            sections: [
                {
                    heading: 'تفاصيل الأصناف المسحوبة من المخزن',
                    columns: [
                        { key: 'name', header: 'الصنف', width: '28%' },
                        { key: 'unit', header: 'الوحدة', width: '12%' },
                        { key: 'qty', header: 'الكمية', align: 'end' },
                        { key: 'grams', header: 'الوزن (جرام)', align: 'end' },
                        { key: 'cost', header: 'التكلفة', align: 'end' },
                        { key: 'share', header: 'النسبة', align: 'end' },
                    ] as OfficialSheetColumn[],
                    rows: data.items.map((r) => ({
                        name: r.name ?? '',
                        unit: r.unit ?? '',
                        qty: String(r.qty),
                        grams: r.grams !== null && r.grams !== undefined ? String(r.grams) : '—',
                        cost: `${money2(r.cost)} ر.س`,
                        share: `${r.share}%`,
                    })),
                },
            ],
        });
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

/* ─── تبويب: تحليل الفطار ─── */
function BreakfastTab({ from, to }: { from: string; to: string }) {
    const [extraIds, setExtraIds] = useState<number[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [debounced, setDebounced] = useState('');

    // debounce البحث بعد ٣٠٠ms من التوقف عن الكتابة
    reactUseEffect(() => {
        const t = window.setTimeout(() => setDebounced(searchTerm.trim()), 300);
        return () => window.clearTimeout(t);
    }, [searchTerm]);

    const searchQuery = useQuery({
        queryKey: ['search-items', debounced],
        queryFn: ({ signal }) => fetchSearchItems(debounced, signal),
        enabled: debounced.length >= 2,
        staleTime: 60_000,
        retry: 0,
    });

    const query = useQuery({
        queryKey: ['breakfast-cost', from, to, extraIds],
        queryFn: ({ signal }) => fetchBreakfastCost({ from, to }, signal, extraIds),
        staleTime: 30_000,
        retry: 0,
    });

    const data: BreakfastCost | undefined = query.data;
    const maxGroup = data?.groups.reduce((m, g) => Math.max(m, g.cost || 0), 0) ?? 1;
    const market = data?.market_estimates ?? null;
    const marketLines = market ? [...(market.veg_lines ?? [])] : [];
    const fullCost = data ? Number(data.full_cost ?? (Number(data.total_cost || 0) + Number(market?.total || 0))) : 0;
    const fullPct = data ? Number(data.full_cost_pct ?? (Number(data.revenue) > 0 ? (fullCost / Number(data.revenue)) * 100 : 0)) : 0;
    const fullVerdict = data?.full_verdict ?? data?.verdict ?? null;
    const combinedCost = fullCost;
    const combinedPct = fullPct;
    const verdictClass = fullVerdict ? `dcost__verdict dcost__verdict--${fullVerdict.tone}` : 'dcost__verdict';

    const printOfficial = () => {
        if (!data) { return; }
        const market = data.market_estimates;
        const combinedCost = Number(data.full_cost ?? (Number(data.total_cost || 0) + Number(market?.total || 0)));
        const combinedPct = Number(data.full_cost_pct ?? (Number(data.revenue) > 0 ? (combinedCost / Number(data.revenue)) * 100 : 0));
        const printVerdict = data.full_verdict ?? data.verdict;
        printOfficialSheet({
            title: 'تحليل تكلفة الافطار',
            englishTitle: 'Breakfast Cost Analysis',
            subtitle: 'مقارنة الإيراد بالتكلفة — كاشير 3',
            from: data.from ?? from, to: data.to ?? to,
            kpis: [
                { label: 'إيراد الفطار (كاشير 3)', value: `${money2(data.revenue)} ر.س`, hint: `${intOf(data.revenue_entries)} قيد` },
                { label: 'تكلفة المكونات (مخزن)', value: `${money2(data.total_cost)} ر.س` },
                { label: 'الخضار الطازجة (تقديري)', value: market ? `${money2(market.total)} ر.س` : '—', hint: market ? `≈ ${market.cost_pct_of_revenue}% من الإيراد` : '' },
                { label: 'التكلفة الشاملة', value: `${money2(combinedCost)} ر.س`, hint: `أذونات ${money2(data.total_cost)} + خضار ${money2(market?.total ?? 0)}` },
                { label: 'نسبة التكلفة (شاملة)', value: `${combinedPct}%`, hint: `${printVerdict?.text ?? ''} — شامل الخضار التقديري` },
            ],
            sections: [
                {
                    heading: 'تفاصيل مكونات الافطار (من أذونات المطبخ)',
                    columns: [
                        { key: 'group', header: 'المجموعة', width: '16%' },
                        { key: 'name', header: 'الصنف' },
                        { key: 'unit', header: 'الوحدة', width: '12%' },
                        { key: 'qty', header: 'الكمية', align: 'end' },
                        { key: 'cost', header: 'التكلفة', align: 'end' },
                        { key: 'share', header: 'النسبة', align: 'end' },
                    ] as OfficialSheetColumn[],
                    rows: data.groups.flatMap((g) => g.items.map((it) => ({
                        group: g.group ?? '',
                        name: it.name ?? '',
                        unit: it.unit ?? '',
                        qty: String(it.qty),
                        cost: `${money2(it.cost)} ر.س`,
                        share: `${g.share}%`,
                    }))),
                    totalsRow: [{ group: 'الإجمالي', name: '', unit: '', qty: '', cost: `${money2(data.total_cost)} ر.س`, share: '100%' }],
                },
                ...(market ? [{
                    heading: 'الخضار الطازجة — تقدير السوق (تقديري)',
                    columns: [
                        { key: 'label', header: 'الصنف' },
                        { key: 'qty', header: 'الكمية', align: 'end' as const },
                        { key: 'unit', header: 'الوحدة', width: '10%' },
                        { key: 'unit_price', header: 'سعر الوحدة', align: 'end' as const },
                        { key: 'total', header: 'الإجمالي', align: 'end' as const },
                    ] as OfficialSheetColumn[],
                    rows: [...(market.veg_lines ?? [])].map((l) => ({
                        label: l.label ?? '',
                        qty: String(l.qty),
                        unit: l.unit ?? '',
                        unit_price: `${money2(l.unit_price)} ر.س`,
                        total: `${money2(l.total)} ر.س`,
                    })),
                    totalsRow: [{ label: 'إجمالي البنود التقديرية', qty: '', unit: '', unit_price: '', total: `${money2(market.total)} ر.س` }],
                }] : []),
                {
                    heading: 'الإيرادات مقابل التكلفة',
                    columns: [
                        { key: 'src', header: 'المصدر', width: '60%' },
                        { key: 'val', header: 'القيمة', align: 'end' },
                    ] as OfficialSheetColumn[],
                    rows: [
                        { src: `إيراد الفطار — كاشير 3 (سجل الإيرادات، ${intOf(data.revenue_entries)} قيد)`, val: `${money2(data.revenue)} ر.س` },
                        { src: 'إيراد الفطار — YaraSoft', val: `${money2(data.revenue_ys)} ر.س` },
                        { src: 'التكلفة الشاملة (أذونات + خضار تقديري)', val: `${money2(combinedCost)} ر.س` },
                        { src: 'نسبة التكلفة من الإيراد (شاملة)', val: `${combinedPct}%` },
                        { src: 'نسبة التكلفة من المخزن فقط', val: `${data.cost_pct}%` },
                    ],
                },
            ],
            notes: market ? [...(data.notes ?? []), ...(market.notes ?? [])] : (data.notes ?? []),
        });
    };

    return (
        <>
            <div className="dcost__filters">
                <span className="dcost__hint">إيراد الافطار = كاشير 3 · التكلفة = مكونات الافطار من أذونات المطبخ (مواد فقط — ويشمل لحم 106 والكبدة وزيت دلال) · الخضار وحدها تقديري بسعر السوق</span>
                <Button variant="secondary" size="sm" onClick={printOfficial} disabled={!data}>🖨 طباعة ورقة رسمية A4</Button>
            </div>

            {query.isPending && !data ? <div className="dcost__skeleton"><span /><span /><span /></div> : null}
            {query.isError ? <p className="text-body-sm text-danger" role="alert">{errorMessage(query.error)}</p> : null}

            {data ? (
                <>
            {/* ═══════ إضافة مكوّنات يدويًا (أي صنف من المخزن) ═══════ */}
            <div className="dcost__manual">
                <div className="ai-section-head">
                    <h3 className="ai-section-head__title">إضافة مكوّنات يدويًا</h3>
                    <span className="ai-section-head__hint">اكتب اسم أي صنف (بيض، لحم مفروم، خضار…) — سيُضاف تلقائيًا للتحليل</span>
                </div>
                <div className="dcost__manual-controls">
                    <input
                        type="search"
                        className="dcost__manual-input"
                        placeholder="اكتب اسم الصنف…"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        aria-label="بحث عن صنف"
                    />
                </div>
                {searchQuery.isPending && debounced.length >= 2 ? <p className="text-body-sm text-muted">جارٍ البحث…</p> : null}
                {debounced.length >= 2 && (searchQuery.data ?? []).length === 0 && !searchQuery.isPending ? (
                    <p className="text-body-sm text-muted">لا توجد أصناف مطابقة — جرب اسمًا آخر.</p>
                ) : null}
                {debounced.length >= 2 && (searchQuery.data ?? []).length > 0 ? (
                    <ul className="dcost__manual-results">
                        {(searchQuery.data ?? []).map((item: InventorySearchItem) => {
                            const isAdded = extraIds.includes(Number(item.id));
                            return (
                                <li key={item.id} className="dcost__manual-item">
                                    <span className="dcost__manual-name">{item.name}</span>
                                    <span className="dcost__manual-meta">{item.unit} · رصيد {item.qty} · متوسط {money2(item.avg_cost)} ر.س</span>
                                    <button
                                        type="button"
                                        className={'dcost__manual-toggle' + (isAdded ? ' is-added' : '')}
                                        aria-pressed={isAdded}
                                        onClick={() => setExtraIds((prev) => isAdded ? prev.filter((id) => id !== Number(item.id)) : [...prev, Number(item.id)])}
                                    >
                                        {isAdded ? '✓ أُضيف' : '+ أضف'}
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                ) : null}
                {extraIds.length > 0 ? (
                    <p className="dcost__manual-summary">✓ أضفت <strong>{extraIds.length}</strong> مكوّن إلى التحليل — تُحسب تكلفتها من أذونات المطبخ تلقائيًا.</p>
                ) : null}
            </div>
                    <div className="dcost__versus">
                        <div className="dcost__versus-cell">
                            <span className="dcost__versus-label">إيراد الفطار (كاشير 3)</span>
                            <strong className="dcost__versus-num" dir="ltr">{money2(data.revenue)} <small>ر.س</small></strong>
                            <span className="dcost__versus-sub">{intOf(data.revenue_entries)} قيد · YaraSoft {money2(data.revenue_ys)} ر.س</span>
                        </div>
                        <div className="dcost__versus-op">÷</div>
                        <div className="dcost__versus-cell">
                            <span className="dcost__versus-label">التكلفة الشاملة (مخزن + خضار)</span>
                            <strong className="dcost__versus-num dcost__versus-num--cost" dir="ltr">{money2(fullCost)} <small>ر.س</small></strong>
                            <span className="dcost__versus-sub">أذونات {money2(data.total_cost)} + سوق {money2(market?.total ?? 0)} · {data.groups.length} مجموعات · {data.groups.reduce((s, g) => s + g.items.length, 0)} صنف</span>
                        </div>
                        <div className="dcost__versus-op">=</div>
                        <div className="dcost__versus-cell dcost__versus-cell--pct">
                            <span className="dcost__versus-label">نسبة التكلفة (شاملة)</span>
                            <strong className="dcost__versus-num dcost__versus-num--pct" dir="ltr">{fullPct}%</strong>
                            <span className={verdictClass}>{fullVerdict?.text ?? ''}</span>
                            <span className="dcost__versus-sub">شاملة الخضار التقديري (المخزن فقط {data.cost_pct}%)</span>
                        </div>
                    </div>

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

                    {market ? (
                        <>
                            <h3 className="dcost__h3">الخضار الطازجة — تقدير السوق <span className="dcost__verdict dcost__verdict--warning" style={{ marginInlineStart: '0.5rem' }}>تقديري — سعر السوق</span></h3>
                            <div className="dcost__groups">
                                <div className="dcost__group">
                                    <div className="dcost__group-head">
                                        <strong>تقدير السوق — {intOf(market.day_span)} يوم</strong>
                                        <span dir="ltr">{money2(market.total)} ر.س · ≈{market.cost_pct_of_revenue}% من الإيراد</span>
                                    </div>
                                    <div className="dcost__group-bar"><span style={{ inlineSize: '100%' }} /></div>
                                    <ul className="dcost__group-items">
                                        {marketLines.map((l) => (
                                            <li key={l.key}>
                                                <span>{l.label}</span>
                                                <span dir="ltr" className="dcost__item-qty">{l.qty} {l.unit} × {money2(l.unit_price)}</span>
                                                <span dir="ltr" className="dcost__item-cost">{money2(l.total)}</span>
                                            </li>
                                        ))}
                                    </ul>
                                    <div className="dcost__group-head" style={{ borderTop: '1px dashed var(--border, #e5e7eb)' }}>
                                        <strong>الإجمالي الشامل (مخزن + سوق)</strong>
                                        <span dir="ltr">{money2(combinedCost)} ر.س · ≈{combinedPct}% من الإيراد</span>
                                    </div>
                                </div>
                            </div>

                            <ul className="dcost__notes">
                                {market.notes.map((note, i) => <li key={`m-${i}`}>{note}</li>)}
                            </ul>
                        </>
                    ) : null}

                    <ul className="dcost__notes">
                        {data.notes.map((note, i) => <li key={i}>{note}</li>)}
                    </ul>
                </>
            ) : null}
        </>
    );
}

/* ─── الشاشة الرئيسية ─── */
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
