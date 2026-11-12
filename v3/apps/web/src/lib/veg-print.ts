import { intText, moneyText, qtyText } from './cash-register';
import type { VegRequest } from './veg-requests';

/**
 * ورقة طلب خضار واحدة — هيكل V2 `buildVegPrintHtml` (veg-requests.js:58-158)
 * بنفس الحقول: الأصناف المرفوضة والتالف، أسعار الوحدة والإجماليات عند التسعير،
 * ختم الحالة، توقيعا الشيف وأمين المخزن، ورقم النسخة من `print_count + 1`.
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
            const spoiled = item.spoiledQty ? ` <span class="rej">تالف: ${escapeHtml(qtyText(item.spoiledQty))}</span>` : '';
            const rejected = item.rejected ? ' <span class="rej">✗ مرفوض — لا يُسعَّر</span>' : '';
            const priceCells = hasPrices
                ? `<td class="c n">${item.rejected || item.price === null ? '—' : escapeHtml(moneyText(item.price, currency))}</td>` +
                  `<td class="c n">${item.rejected || item.lineTotal === null ? '—' : escapeHtml(moneyText(item.lineTotal, currency))}</td>`
                : '';
            return (
                `<tr${item.rejected ? ' class="rej-row"' : ''}><td class="c">${index + 1}</td>` +
                `<td><b>${escapeHtml(item.name)}</b>${rejected}${spoiled}</td>` +
                `<td class="c n">${escapeHtml(qtyText(item.qty))}</td>` +
                `<td class="c">${escapeHtml(item.unit)}</td>` +
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
body{font-family:'Tajawal','Segoe UI',Tahoma,Arial,sans-serif;color:#172b3b;background:#fff;margin:0;padding:28px;direction:rtl}
.sheet{max-width:820px;margin:auto}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0f766e;padding-bottom:12px}
.brand h1{margin:0;color:#0f766e;font-size:22px}.brand p{margin:4px 0 0;color:#596e80;font-size:12px}
.docno{text-align:left}.docno .no{display:inline-block;border:2px solid #0f766e;border-radius:10px;padding:6px 14px;font-size:17px;font-weight:800;direction:ltr}
.docno .dt{margin-top:6px;color:#596e80;font-size:12px}
.title{background:#102a43;color:#f0f6fa;text-align:center;font-size:18px;font-weight:800;padding:9px;border-radius:10px;margin:14px 0}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
.meta .m{background:#f3f6fa;border:1px solid #dce5ec;border-radius:9px;padding:6px 12px;font-size:12.5px}
.meta .m.urgent{background:#fce8e6;border-color:#b3261e;color:#8e1f16;font-weight:800}
.stamp{display:inline-block;border:2.5px solid #16834a;color:#16834a;font-weight:900;font-size:15px;border-radius:10px;padding:3px 16px;transform:rotate(-4deg);margin:6px 0}
.stamp.no{border-color:#8e1f16;color:#8e1f16}
.recv{color:#16834a;font-size:12.5px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{background:#eaf0f5;color:#102a43;padding:8px 6px;font-size:12.5px;border:1px solid #dce5ec}
td{border:1px solid #dce5ec;padding:7px 8px;font-size:13px}
tr:nth-child(even) td{background:#f3f6fa}
td.c{text-align:center}td.n{direction:ltr;unicode-bidi:embed}td.note{color:#596e80;font-size:12px}
tr.rej-row td{background:#fce8e6}
.rej{color:#8e1f16;font-weight:800;font-size:10.5px}
.total{margin-top:8px;text-align:left;font-weight:800}
.notes-box{margin-top:12px;background:#f3f6fa;border:1px dashed #0f766e;border-radius:10px;padding:10px 14px;font-size:13px}
.signs{display:flex;gap:24px;margin-top:36px}
.sign{flex:1;text-align:center}.sign .line{border-top:2px dotted #8496a5;margin-top:46px;padding-top:6px;font-weight:700;font-size:12.5px}
.sign .who{color:#596e80;font-size:11.5px}
.foot{border-top:2px solid #0f766e;margin-top:26px;padding-top:8px;display:flex;justify-content:space-between;color:#596e80;font-size:10.5px}
.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#0f766e;color:#fff}
.controls button.secondary{background:#555}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:13mm}}
</style></head><body>
<div class="controls"><button type="button" data-veg-print>طباعة</button><button type="button" class="secondary" data-veg-close>إغلاق</button></div>
<main class="sheet">
<header class="head">
<div class="brand"><h1>طلب شراء خضار</h1><p>نظام Karim ERP لإدارة المطاعم</p></div>
<div class="docno"><div class="no">${escapeHtml(requestNo)}</div><div class="dt">${escapeHtml(stampText(request.created_at))}</div></div>
</header>
<div class="title">طلب شراء خضار</div>
<div class="meta">
<div class="m"><b>الجهة الطالبة:</b> مطبخ المطعم</div>
<div class="m"><b>بواسطة:</b> ${escapeHtml(request.created_by_name ?? '')}${
        request.created_by_role ? ` (${escapeHtml(request.created_by_role)})` : ''
    }</div>
<div class="m"><b>إلى:</b> المخازن</div>
${String(request.priority ?? '').toLowerCase() === 'urgent' ? '<div class="m urgent">عاجل — التوريد بأسرع وقت</div>' : ''}
${statusStamp}
</div>
<table>
<thead><tr><th class="c">م</th><th>الصنف</th><th class="c">الكمية</th><th>الوحدة</th>${
        hasPrices ? '<th>سعر الوحدة</th><th>الإجمالي</th>' : ''
    }<th>ملاحظات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="6" class="c">لا أصناف مسجّلة في الطلب</td></tr>'}</tbody>
</table>
<div class="total">إجمالي الأصناف: ${escapeHtml(intText(items.length))}${total ? ` — إجمالي القيمة: ${escapeHtml(moneyText(total, currency))}` : ''}</div>
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
