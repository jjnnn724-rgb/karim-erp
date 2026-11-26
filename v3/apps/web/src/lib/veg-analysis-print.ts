import { intText, moneyText, qtyText } from './cash-register';
import type { VegConsumption, VegConsumptionRow } from './veg-requests';

/**
 * تقرير تحليل الخضار — ورقة إدارية احترافية تُطبع من لوحة «تحليل الخضار».
 * الشعار يُحقن تلقائياً عبر `printSmart` ← `withPrintBrand`.
 * الأرقام كلها قادمة من باب `/api/veg-requests/consumption` — لا حساب في الواجهة.
 */

function esc(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

const n = (value: number): number => (Number.isFinite(value) ? value : 0);

export type VegAnalysisPrintOptions = {
    byName: string;
    currency?: string;
    generatedAt?: Date;
};

export function vegAnalysisPrintHtml(data: VegConsumption, options: VegAnalysisPrintOptions): string {
    const currency = String(options.currency ?? '');
    const rows = [...data.rows].sort((a, b) => n(b.consumedQty) - n(a.consumedQty));
    const totals = data.totals;
    const maxConsumed = Math.max(1, ...rows.map((r) => n(r.consumedQty)));
    const generated = (options.generatedAt ?? new Date()).toLocaleString('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });

    const top = rows.slice(0, 5);
    const lowStock = rows.filter((r) => n(r.onHand) <= 0).length;
    const avgCost = rows.length ? n(totals.receivedValue) / Math.max(1, n(totals.receivedQty)) : 0;

    const tableRows = rows
        .map((row: VegConsumptionRow, index: number) => {
            const width = Math.max(2, Math.round((n(row.consumedQty) / maxConsumed) * 100));
            const trend =
                n(row.consumedQty) > n(row.receivedQty)
                    ? '<span class="flag warn">استهلاك > الوارد</span>'
                    : n(row.onHand) <= 0
                      ? '<span class="flag risk">رصيد منعدم</span>'
                      : '<span class="flag ok">مستقر</span>';
            return `<tr>
<td class="c">${index + 1}</td>
<td><b>${esc(row.name)}</b><div class="bar"><i style="width:${width}%"></i></div></td>
<td class="c">${esc(row.unit || '—')}</td>
<td class="num">${esc(qtyText(n(row.onHand)))}</td>
<td class="num">${esc(moneyText(n(row.avgCost), currency))}</td>
<td class="num">${esc(qtyText(n(row.receivedQty)))}</td>
<td class="num">${esc(moneyText(n(row.receivedValue), currency))}</td>
<td class="c">${esc(intText(n(row.requests)))}</td>
<td class="num strong">${esc(qtyText(n(row.consumedQty)))}</td>
<td class="num">${esc(moneyText(n(row.consumedValue), currency))}</td>
<td>${trend}</td></tr>`;
        })
        .join('');

    const topList = top.length
        ? top
              .map(
                  (r, i) =>
                      `<li><span class="rank">${i + 1}</span><b>${esc(r.name)}</b><span class="val" dir="ltr">${esc(qtyText(n(r.consumedQty)))} ${esc(r.unit || '')}</span></li>`,
              )
              .join('')
        : '<li class="empty">لا توجد بيانات في هذه الفترة</li>';

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>تقرير تحليل الخضار — ${esc(data.from)} إلى ${esc(data.to)}</title>
<style>
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#102a43;background:#fff;margin:0;padding:24px;direction:rtl}
.sheet{max-width:1180px;margin:auto}
.titlebar{background:linear-gradient(90deg,#102a43,#0f766e);color:#fff;border-radius:14px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center}
.titlebar h1{margin:0;font-size:22px;font-weight:800}
.titlebar p{margin:5px 0 0;font-size:12px;opacity:.85}
.period{border:1px solid rgba(255,255,255,.4);border-radius:10px;padding:8px 14px;font-size:13px;direction:ltr;font-variant-numeric:tabular-nums}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
.kpi{border:1px solid #dce5ec;border-top:4px solid #0f766e;border-radius:12px;padding:12px 14px;background:#f7fafc}
.kpi span{display:block;color:#596e80;font-size:11.5px}
.kpi b{display:block;margin-top:5px;font-size:19px;font-variant-numeric:tabular-nums;direction:ltr;text-align:right}
.kpi.alt{border-top-color:#B08D57}
h2{font-size:15px;margin:18px 0 8px;padding-inline-start:10px;border-inline-start:4px solid #B08D57}
table{width:100%;border-collapse:collapse;font-size:11.5px}
th{background:#102a43;color:#fff;padding:8px 6px;text-align:center;white-space:nowrap}
td{border:1px solid #e2e9ef;padding:6px 7px;vertical-align:middle}
tr:nth-child(even) td{background:#f7fafc}
td.c{text-align:center}td.num{direction:ltr;text-align:right;font-variant-numeric:tabular-nums}
td.strong{font-weight:800;color:#0f766e}
.bar{height:4px;background:#e8eef3;border-radius:99px;margin-top:5px;overflow:hidden}
.bar i{display:block;height:100%;background:#0f766e;border-radius:99px}
.flag{font-size:10px;border-radius:99px;padding:2px 7px;white-space:nowrap}
.flag.ok{background:#e7f5ed;color:#146c43}.flag.warn{background:#fff3d6;color:#8a6100}.flag.risk{background:#fce8e6;color:#8e1f16;font-weight:700}
.cols{display:grid;grid-template-columns:1.1fr .9fr;gap:14px;margin-top:14px}
.box{border:1px solid #dce5ec;border-radius:12px;padding:12px 16px;background:#fbfdfe}
.box ol{margin:6px 0 0;padding:0;list-style:none}
.box li{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px dashed #e2e9ef;font-size:12px}
.box li:last-child{border:0}
.rank{display:inline-grid;place-items:center;inline-size:20px;block-size:20px;border-radius:50%;background:#0f766e;color:#fff;font-size:10px;font-weight:800}
.val{margin-inline-start:auto;direction:ltr;font-variant-numeric:tabular-nums;color:#0f766e;font-weight:700}
.box .empty{color:#596e80}
.stats{display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px}
.stats div{display:flex;justify-content:space-between;border-bottom:1px dotted #dce5ec;padding:5px 0}
.stats b{direction:ltr;font-variant-numeric:tabular-nums}
.foot{border-top:2px solid #B08D57;margin-top:20px;padding-top:8px;display:flex;justify-content:space-between;color:#596e80;font-size:10.5px}
@media print{body{padding:0}@page{size:A4 landscape;margin:10mm}.titlebar,.kpi,.box{break-inside:avoid}tr{break-inside:avoid}}
</style></head><body><main class="sheet">
<div class="titlebar">
<div><h1>تقرير تحليل الخضار</h1><p>مطاعم الشرفة العالمي — تحليل الاستهلاك والوارد والأرصدة</p></div>
<div class="period">${esc(data.from)} &nbsp;→&nbsp; ${esc(data.to)}</div>
</div>
<section class="kpis">
<div class="kpi"><span>عدد الأصناف</span><b>${esc(intText(n(totals.items)))}</b></div>
<div class="kpi"><span>إجمالي الوارد</span><b>${esc(qtyText(n(totals.receivedQty)))}</b></div>
<div class="kpi alt"><span>إجمالي الاستهلاك</span><b>${esc(qtyText(n(totals.consumedQty)))}</b></div>
<div class="kpi alt"><span>قيمة الوارد</span><b>${esc(moneyText(n(totals.receivedValue), currency))}</b></div>
</section>
<h2>تفاصيل الأصناف — مرتبة حسب الاستهلاك</h2>
<table><thead><tr>
<th>م</th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>متوسط التكلفة</th><th>الوارد</th><th>قيمة الوارد</th><th>الطلبات</th><th>المستهلك</th><th>قيمة الاستهلاك</th><th>الحالة</th>
</tr></thead><tbody>${tableRows || '<tr><td colspan="11" class="c">لا توجد أصناف في هذه الفترة</td></tr>'}</tbody></table>
<div class="cols">
<div class="box"><h2 style="margin-top:0">أعلى الأصناف استهلاكاً</h2><ol>${topList}</ol></div>
<div class="box"><h2 style="margin-top:0">مؤشرات سريعة</h2><div class="stats">
<div><span>متوسط تكلفة الوحدة</span><b>${esc(moneyText(avgCost, currency))}</b></div>
<div><span>أصناف برصيد منعدم</span><b>${esc(intText(lowStock))}</b></div>
<div><span>نسبة الاستهلاك للوارد</span><b>${n(totals.receivedQty) > 0 ? Math.round((n(totals.consumedQty) / n(totals.receivedQty)) * 100) : 0}%</b></div>
<div><span>قيمة الاستهلاك</span><b>${esc(
        moneyText(
            rows.reduce((sum, r) => sum + n(r.consumedValue), 0),
            currency,
        ),
    )}</b></div>
</div></div>
</div>
<div class="foot"><div>أُعدّ بواسطة ${esc(options.byName)} — ${esc(generated)}</div><div>Karim ERP · شهادة العملة ${esc(currency || 'SAR')}</div></div>
</main></body></html>`;
}
