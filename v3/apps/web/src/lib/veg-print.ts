import { intText, moneyText, qtyText } from './cash-register';
import { BRAND_MARK_HTML } from './print-brand';
import type { VegRequest } from './veg-requests';

/**
 * ورقة طلب خضار واحدة — هيكل V2 `buildVegPrintHtml` (veg-requests.js:58-158)
 * بنفس الحقول: الأصناف المرفوضة والتالف، أسعار الوحدة والإجماليات عند التسعير،
 * ختم الحالة، توقيعا الشيف وأمين المخزن، ورقم النسخة من `print_count + 1`.
 *
 * الديزاين (طلب المالك 2026-11-27): ترويسة مؤسسية، بطاقات بيانات، جدول بخطوط
 * واضحة، مساحات توقيع ثابتة، وقواعد طباعة A4 تحفظ السطور من الانكسار.
 */

export type VegPrintItem = {
    name: string;
    qty: number;
    unit: string;
    note: string;
    rejected: boolean;
    spoiledQty: number | null;
    price: number | null;
    lineTotal: number | null;
};

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function numberOrNull(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/** أصناف الطلب من `items` (مصفوفة أو JSON نصّي كما يخزّنها الخادم). */
export function vegPrintItems(request: VegRequest): VegPrintItem[] {
    const raw = (request as { items?: unknown }).items;
    let list: unknown[] = [];
    if (Array.isArray(raw)) {
        list = raw;
    } else if (typeof raw === 'string' && raw.trim()) {
        try {
            const parsed: unknown = JSON.parse(raw);
            list = Array.isArray(parsed) ? parsed : [];
        } catch {
            list = [];
        }
    }
    const items: VegPrintItem[] = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') {
            continue;
        }
        const item = entry as Record<string, unknown>;
        const name = String(item.name ?? '').trim();
        if (!name) {
            continue;
        }
        items.push({
            name,
            qty: numberOrNull(item.qty) ?? numberOrNull(item.quantity) ?? 0,
            unit: String(item.unit ?? ''),
            note: String(item.note ?? ''),
            rejected: item.rejected === true,
            spoiledQty: numberOrNull(item.spoiledQty),
            price: numberOrNull(item.price),
            lineTotal: numberOrNull(item.lineTotal),
        });
    }
    return items;
}

function stampText(value: unknown): string {
    if (value === null || value === undefined || value === '') {
        return '';
    }
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
        return String(value);
    }
    return date.toLocaleString('ar-EG', { dateStyle: 'long', timeStyle: 'short' });
}

export type VegPrintOptions = {
    byName: string;
    currency?: string;
    generatedAt?: Date;
};

export function vegRequestPrintHtml(request: VegRequest, options: VegPrintOptions): string {
    const currency = String(options.currency ?? '');
    const items = vegPrintItems(request);
    const hasPrices = items.some((item) => item.price !== null);
    const requestNo = String(request.request_no ?? `#${request.id}`);
    const status = String(request.status ?? '');
    const total = request.total;

    const rows = items
        .map((item, index) => {
            const spoiled = item.spoiledQty ? ` <span class="flag">تالف: ${escapeHtml(qtyText(item.spoiledQty))}</span>` : '';
            const rejected = item.rejected ? ' <span class="flag no">✗ مرفوض — لا يُسعَّر</span>' : '';
            const priceCells = hasPrices
                ? `<td class="c n">${item.rejected || item.price === null ? '—' : escapeHtml(moneyText(item.price, currency))}</td>` +
                  `<td class="c n strong">${item.rejected || item.lineTotal === null ? '—' : escapeHtml(moneyText(item.lineTotal, currency))}</td>`
                : '';
            return (
                `<tr${item.rejected ? ' class="rej-row"' : ''}><td class="c idx">${index + 1}</td>` +
                `<td class="name"><b>${escapeHtml(item.name)}</b>${rejected}${spoiled}</td>` +
                `<td class="c n qty">${escapeHtml(qtyText(item.qty))}</td>` +
                `<td class="c unit">${escapeHtml(item.unit)}</td>` +
                priceCells +
                `<td class="note">${escapeHtml(item.note)}</td></tr>`
            );
        })
        .join('');

    const receivedLine =
        status === 'priced' || status === 'received'
            ? `<div class="stamp">${status === 'priced' ? '✔ معتمد' : '✔ تم الاستلام'}</div>` +
              `<div class="recv">${status === 'priced' ? 'سعّرها' : 'استلمها'}: <b>${escapeHtml(
                  status === 'priced' ? request.priced_by_name : request.received_by_name,
              )}</b>${
                  status === 'priced'
                      ? request.priced_at
                          ? ` — ${escapeHtml(stampText(request.priced_at))}`
                          : ''
                      : request.received_at
                        ? ` — ${escapeHtml(stampText(request.received_at))}`
                        : ''
              }</div>`
            : '';
    const statusStamp =
        status === 'cancelled'
            ? '<div class="stamp no">✖ ملغي</div>'
            : status === 'priced' && total
              ? `${receivedLine}<div class="recv"><b>${escapeHtml(moneyText(total, currency))}</b></div>`
              : receivedLine;

    const generated = (options.generatedAt ?? new Date()).toLocaleString('ar-EG', {
        dateStyle: 'medium',
        timeStyle: 'short',
    });
    const copyNo = Number(request.print_count ?? 0) + 1;

    return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>طلب شراء خضار ${escapeHtml(requestNo)}</title>
<style>
:root{--ink:#102a43;--teal:#0f766e;--mint:#e7f5f2;--line:#d8e4ea;--muted:#5d7383;--soft:#f5f8fa;--danger:#8e1f16;--ok:#16834a}
*{box-sizing:border-box}
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:var(--ink);background:#eef2f5;margin:0;padding:24px;direction:rtl;font-size:13px;line-height:1.6}
.sheet{max-width:820px;margin:auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:26px 30px;box-shadow:0 18px 50px -24px rgba(16,42,67,.35)}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;border-bottom:3px solid #B08D57;padding-bottom:14px}
.brand{display:flex;align-items:center;gap:13px;min-width:0}
.brand img{max-inline-size:150px;block-size:auto;object-fit:contain}
.brand h1{margin:0;font-size:19px;line-height:1.3;letter-spacing:-.01em;color:#102a43}
.brand p{margin:3px 0 0;color:var(--muted);font-size:11.5px}
.docno{text-align:left;flex:none}
.docno .no{display:inline-block;border:2px solid var(--teal);border-radius:10px;padding:5px 14px;font-size:16px;font-weight:800;direction:ltr;color:var(--teal)}
.docno .dt{margin-top:6px;color:var(--muted);font-size:11.5px;direction:ltr;unicode-bidi:embed}
.title{background:#102a43;color:#f0f6fa;text-align:center;font-size:18px;font-weight:800;letter-spacing:.02em;padding:10px;border-radius:10px;margin:16px 0 12px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(185px,1fr));gap:8px;margin-bottom:12px}
.meta .m{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:7px 12px;font-size:12.5px;min-width:0}
.meta .m b{display:block;color:var(--muted);font-size:10.5px;font-weight:700;margin-bottom:2px}
.meta .m.urgent{background:#fce8e6;border-color:#e3a29b;color:var(--danger);font-weight:800}
.stamp{display:inline-block;border:2.5px solid var(--ok);color:var(--ok);font-weight:900;font-size:15px;border-radius:10px;padding:3px 16px;transform:rotate(-4deg);margin-top:4px}
.stamp.no{border-color:var(--danger);color:var(--danger)}
.recv{color:var(--ok);font-size:12px;margin-top:4px}
.tbl{border:1px solid var(--line);border-radius:12px;overflow:hidden}
table{width:100%;border-collapse:collapse}
th{background:var(--mint);color:var(--ink);padding:9px 7px;font-size:11.5px;font-weight:800;border-bottom:1px solid #b9ded7;white-space:nowrap}
td{border-bottom:1px solid var(--line);padding:8px 9px;font-size:12.5px;vertical-align:middle}
tbody tr:last-child td{border-bottom:0}
tbody tr:nth-child(even){background:var(--soft)}
tbody tr{break-inside:avoid;page-break-inside:avoid}
td.c{text-align:center}
td.idx{width:34px;color:var(--muted);font-size:11px}
td.qty{font-weight:800;font-size:14px}
td.unit{color:var(--muted)}
td.strong{font-weight:800}
td.n{direction:ltr;unicode-bidi:embed}
td.note{color:var(--muted);font-size:11.5px;max-width:170px}
td.name b{font-weight:800}
tr.rej-row{background:#fce8e6!important}
.flag{color:var(--danger);font-weight:800;font-size:10px;display:inline-block;margin-inline-start:6px}
.summary{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px;background:var(--mint);border:1px solid #b9ded7;border-radius:10px;padding:9px 14px;font-size:12.5px}
.summary b{font-size:15px}
.summary .n{direction:ltr;unicode-bidi:embed}
.notes-box{margin-top:12px;border:1px dashed var(--teal);border-radius:10px;padding:10px 14px;font-size:12.5px;background:var(--soft)}
.notes-box b{color:var(--teal)}
.signs{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:34px}
.sign{text-align:center;min-width:0}
.sign .line{border-top:2px dotted #9aabb7;margin-top:44px;padding-top:6px;font-weight:800;font-size:12px}
.sign .who{color:var(--muted);font-size:11px}
.foot{border-top:2px solid var(--teal);margin-top:22px;padding-top:8px;display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:10.5px}
/* الترويسة كتلة واحدة: لا تُفصل عن أول جدول في ورقة مستقلة */
.doc-head{break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}
.doc-head .head,.doc-head .title,.doc-head .meta{break-inside:avoid;page-break-inside:avoid}
@page{size:A4;margin:11mm}
@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:0;background:#fff}.sheet{max-width:none;border:0;border-radius:0;padding:0;box-shadow:none}.doc-head{break-after:avoid;page-break-after:avoid}.meta .m,.tbl,.summary,.notes-box{break-inside:avoid;page-break-inside:avoid}.title{margin:8px 0 6px;padding:7px}.head{padding-bottom:9px}.signs{margin-top:20px}.sign .line{margin-top:30px}.foot{margin-top:14px}}
@media(max-width:560px){body{padding:10px}.sheet{padding:16px}.head{flex-wrap:wrap}.signs{gap:14px}}
</style></head><body>
<main class="sheet">
<section class="doc-head">
<header class="head">
<div class="brand" data-print-brand>${BRAND_MARK_HTML}<div><h1>مطاعم الشرفة العالمي</h1><p>نظام Karim ERP لإدارة المطاعم — قسم المطبخ والمخازن</p></div></div>
<div class="docno"><div class="no">${escapeHtml(requestNo)}</div><div class="dt">${escapeHtml(stampText(request.created_at))}</div></div>
</header>
<div class="title">طلب شراء خضار</div>
<div class="meta">
<div class="m"><b>الجهة الطالبة</b>مطبخ المطعم</div>
<div class="m"><b> بواسطة</b>${escapeHtml(request.created_by_name ?? '')}${
        request.created_by_role ? ` (${escapeHtml(request.created_by_role)})` : ''
    }</div>
<div class="m"><b>إلى</b>المخازن</div>
${String(request.priority ?? '').toLowerCase() === 'urgent' ? '<div class="m urgent"><b>الأولوية</b>عاجل — التوريد بأسرع وقت</div>' : ''}
${statusStamp ? `<div class="m"><b>حالة الطلب</b>${statusStamp}</div>` : ''}
</div>
</section>
<div class="tbl"><table>
<thead><tr><th class="c">م</th><th>الصنف</th><th class="c">الكمية</th><th class="c">الوحدة</th>${
        hasPrices ? '<th class="c">سعر الوحدة</th><th class="c">الإجمالي</th>' : ''
    }<th>ملاحظات</th></tr></thead>
<tbody>${rows || `<tr><td class="c" colspan="${hasPrices ? 7 : 5}">لا أصناف مسجّلة في الطلب</td></tr>`}</tbody>
</table></div>
<div class="summary"><span>إجمالي الأصناف: <b class="n">${escapeHtml(intText(items.length))}</b></span>${
        total ? `<span>إجمالي القيمة: <b class="n">${escapeHtml(moneyText(total, currency))}</b></span>` : ''
    }</div>
${request.notes ? `<div class="notes-box"><b>ملاحظات:</b> ${escapeHtml(request.notes)}</div>` : ''}
<div class="signs">
<div class="sign"><div class="line"></div><div class="who">توقيع الشيف — ${escapeHtml(request.created_by_name ?? '')}</div></div>
<div class="sign"><div class="line"></div><div class="who">توقيع أمين المخزن — الاستلام</div></div>
</div>
<div class="foot">
<div>طُبعت من نظام Karim ERP بواسطة ${escapeHtml(options.byName)} — ${escapeHtml(generated)}</div>
<div>نسخة رقم ${escapeHtml(intText(copyNo))}</div>
</div>
</main></body></html>`;
}
