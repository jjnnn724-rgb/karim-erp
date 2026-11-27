import { BRAND_MARK_HTML } from './print-brand';
import { VEG_REQUEST_CATALOG } from './veg-catalog';

/**
 * نموذج «طلبية الخضروات والأعشاب» فارغ للطباعة — النسخة المعتمدة 2026-11-27:
 * 30 صنفًا رئيسيًا + 5 أصناف إضافية، وخانة كمية فارغة أمام كل صنف.
 * يُبنى من نفس كتالوج النظام (لا نسخة يدوية) حتى لا تنحرف الورقة عن الواجهة.
 */

export type VegOrderSheetOptions = {
    /** التاريخ المعروض في الترويسة — افتراضيًا تاريخ اليوم. */
    date?: string;
    /** اسم مُعِدّ الطلبية (اختياري). */
    preparedBy?: string;
    /** لتثبيت التاريخ في الاختبارات. */
    generatedAt?: Date;
};

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function displayDate(options: VegOrderSheetOptions): string {
    if (options.date) {
        return options.date;
    }
    return (options.generatedAt ?? new Date()).toLocaleDateString('ar-EG-u-nu-latn', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
    });
}

const STYLE = `
:root{--ink:#102a43;--teal:#0f766e;--mint:#e7f5f2;--line:#d5e2e8;--muted:#5d7383;--soft:#f5f8fa;--gold:#a87b18}
*{box-sizing:border-box}
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:var(--ink);background:#eef2f5;margin:0;padding:20px;direction:rtl;line-height:1.5}
.sheet{max-width:960px;margin:auto;background:#fff;border:1px solid var(--line);border-radius:14px;padding:22px 26px;box-shadow:0 18px 50px -26px rgba(16,42,67,.4)}
.head{display:flex;justify-content:space-between;align-items:center;gap:16px;border-bottom:3px solid #B08D57;padding-bottom:12px}
.brand{display:flex;align-items:center;gap:12px;min-width:0}
.brand img{max-inline-size:150px;block-size:auto;object-fit:contain}
.brand h1{margin:0;font-size:19px;line-height:1.3;color:var(--ink)}
.brand p{margin:2px 0 0;color:var(--muted);font-size:11px}
.date{text-align:left;flex:none;background:var(--mint);border:1px solid #b9ded7;border-radius:10px;padding:7px 13px}
.date span{display:block;color:var(--muted);font-size:10.5px}
.date b{font-size:14px;direction:ltr;unicode-bidi:embed}
.title{background:#102a43;color:#f0f6fa;text-align:center;font-size:19px;font-weight:800;padding:10px;border-radius:10px;margin:14px 0 8px}
.hint{background:var(--soft);border:1px dashed var(--teal);border-radius:10px;padding:8px 14px;font-size:12.5px;text-align:center;margin-bottom:12px}
.hint b{color:var(--teal)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th{background:var(--mint);color:var(--ink);font-size:11px;font-weight:800;padding:7px 5px;border:1px solid var(--line)}
th:nth-child(1){width:30px}th:nth-child(3){width:64px}th:nth-child(4){width:52px}
td{border:1px solid var(--line);padding:5px 6px;font-size:11.5px;height:25px;vertical-align:middle}
td.idx{text-align:center;color:var(--muted);font-size:10.5px}
td.qty{text-align:center}
td.qty i{display:inline-block;min-width:46px;height:16px;border-bottom:1.5px solid #9aabb7}
td.unit{text-align:center;color:var(--muted);font-size:11px}
tr.group td{background:var(--soft);font-weight:800;color:var(--teal);font-size:10.5px;text-align:center;padding:3px}
tr.extra td{background:#fdf9ef}
.legend{margin-top:10px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:11px}
.signs{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:26px}
.sign{text-align:center;font-size:11.5px;font-weight:700}
.sign .line{border-top:2px dotted #9aabb7;margin-top:40px;padding-top:5px}
.sign .who{color:var(--muted);font-size:10.5px;font-weight:400}
.foot{border-top:2px solid var(--teal);margin-top:18px;padding-top:7px;color:var(--muted);font-size:10px;text-align:center}
.doc-head{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}
.doc-head .head,.doc-head .title,.doc-head .hint{break-inside:avoid;page-break-inside:avoid}
@page{size:A4 portrait;margin:10mm}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0;background:#fff}.sheet{max-width:none;border:0;border-radius:0;padding:0;box-shadow:none}.doc-head{break-after:avoid;page-break-after:avoid}.title{margin:8px 0 6px;padding:7px}.head{padding-bottom:8px}tr{break-inside:avoid;page-break-inside:avoid}}
@media(max-width:700px){.cols{grid-template-columns:1fr}.signs{grid-template-columns:1fr}}
`;

/** قسّم القائمة إلى عمودين متوازيين مع الحفاظ على ترقيم الورقة الأصلي. */
function splitColumns(): Array<Array<(typeof VEG_REQUEST_CATALOG)[number] & { no: number }>> {
    const numbered = VEG_REQUEST_CATALOG.map((item, index) => ({ ...item, no: index + 1 }));
    const perColumn = Math.ceil(numbered.length / 2);
    return [numbered.slice(0, perColumn), numbered.slice(perColumn)];
}

function columnHtml(items: ReturnType<typeof splitColumns>[number]): string {
    let lastCategory = '';
    const rows = items
        .map((item) => {
            const group = item.category !== lastCategory ? `<tr class="group"><td colspan="4">${escapeHtml(item.category)}</td></tr>` : '';
            lastCategory = item.category;
            const extra = item.category === 'أصناف إضافية' ? ' class="extra"' : '';
            return (
                group +
                `<tr${extra}><td class="idx">${item.no}</td><td>${escapeHtml(item.name)}</td>` +
                `<td class="qty"><i></i></td><td class="unit">${escapeHtml(item.unit)}</td></tr>`
            );
        })
        .join('');
    return `<table><thead><tr><th class="c">م</th><th>اسم الصنف</th><th class="c">الكمية</th><th class="c">الوحدة</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function vegOrderSheetHtml(options: VegOrderSheetOptions = {}): string {
    const [firstRaw, secondRaw] = splitColumns();
    const first = firstRaw ?? [];
    const second = secondRaw ?? [];
    const preparedBy = escapeHtml(options.preparedBy ?? '');
    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>طلبية الخضروات والأعشاب</title><style>${STYLE}</style></head><body>
<main class="sheet">
<section class="doc-head">
<header class="head">
<div class="brand" data-print-brand>${BRAND_MARK_HTML}<div><h1>مطاعم الشرفة العالمي</h1><p>نظام Karim ERP — طلبية الخضروات والأعشاب</p></div></div>
<div class="date"><span>التاريخ</span><b>${escapeHtml(displayDate(options))}</b></div>
</header>
<div class="title">طلبية الخضروات والأعشاب</div>
<div class="hint"><b>يرجى تسجيل الكمية المتاحة أمام كل صنف</b> — ${VEG_REQUEST_CATALOG.length} صنفًا (30 رئيسية + 5 إضافية)</div>
</section>
<div class="cols">${columnHtml(first)}${columnHtml(second)}</div>
<div class="legend"><span>• كجم = كيلوجرام</span><span>${preparedBy ? `مُعِدّ الطلبية: <b>${preparedBy}</b>` : 'طلبية من مطبخ المطعم إلى المخازن'}</span></div>
<div class="signs">
<div class="sign"><div class="line"></div><div>التوقيع / المُعِدّ</div><div class="who">مطبخ المطعم</div></div>
<div class="sign"><div class="line"></div><div>التوقيع / المستلم</div><div class="who">المخازن</div></div>
<div class="sign"><div class="line"></div><div>التاريخ</div><div class="who">يوم الاستلام</div></div>
</div>
<div class="foot">نموذج موحّد من نظام Karim ERP — النسخة المعتمدة 2026-11-27</div>
</main></body></html>`;
}
