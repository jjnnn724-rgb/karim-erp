import type { Dispatch } from './dispatches';
import { printLogoSrc, printStamp } from './print';

const PRINTABLE_STATUSES = new Set(['approved', 'partially_received', 'received', 'cancelled', 'voided']);

const STATUS_LABELS: Record<string, string> = {
    approved: 'معتمد من المخازن',
    partially_received: 'مستلم جزئيًا',
    received: 'مستلم ومغلق',
    cancelled: 'ملغي',
    voided: 'مُبطل',
};

function escapeHtml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function numberText(value: unknown): string {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—';
}

function dateText(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
        return '—';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? escapeHtml(value)
        : escapeHtml(date.toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }));
}

function safeImageSource(value: unknown): string {
    const source = String(value ?? '').trim();
    return /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/]+=*$/i.test(source) ? source : '';
}

function signature(label: string, image: unknown, name: unknown, at: unknown): string {
    const source = safeImageSource(image);
    return `<section class="signature">
      <div class="signature__ink">${source ? `<img src="${escapeHtml(source)}" alt="">` : ''}</div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(name || '—')}</span>
      <small>${dateText(at)}</small>
    </section>`;
}

function dispatchLines(dispatch: Dispatch): string {
    const items =
        Array.isArray(dispatch.approvedItems) && dispatch.approvedItems.length > 0
            ? dispatch.approvedItems
            : (dispatch.items ?? []);
    const receivedByName = new Map<string, number>();
    for (const item of dispatch.receivedItems ?? []) {
        const key = String(item.itemName || item.name || '').trim().toLowerCase();
        const quantity = Number(item.receivedQty ?? item.qty ?? 0);
        if (key) {
            receivedByName.set(
                key,
                (receivedByName.get(key) ?? 0) + (Number.isFinite(quantity) ? quantity : 0),
            );
        }
    }
    return items
        .map((item, index) => {
            const name = item.itemName || item.name || '—';
            const quantity = numberText(item.approvedQty ?? item.qty);
            const unit = item.unit || '—';
            const receivedQty = receivedByName.get(String(name).trim().toLowerCase());
            const packaging =
                item.catchWeightEnabled || Number(item.actualWeight) > 0
                    ? `<small>وزن متغير · ${numberText(item.packagingQty)} ${escapeHtml(item.packagingUom || 'كرتون')}</small>`
                    : '';
            const received = receivedQty === undefined ? '—' : `${numberText(receivedQty)} ${escapeHtml(unit)}`;
            return `<tr>
              <td class="numeric">${index + 1}</td>
              <td>${escapeHtml(name)}${packaging}</td>
              <td class="numeric">${quantity} ${escapeHtml(unit)}</td>
              <td class="numeric">${received}</td>
            </tr>`;
        })
        .join('');
}

/** ورقة تشغيلية A4 لا تعرض أسعار التكلفة أو الإجماليات المالية. */
export function dispatchPrintHtml(
    dispatch: Dispatch,
    brand: { name: string; logoSrc: string },
    printedAt: Date = new Date(),
): string {
    const status = String(dispatch.status ?? '');
    const itemRows = dispatchLines(dispatch);
    const audit = [
        dispatch.createdBy
            ? { label: 'إعداد الطلب', name: dispatch.createdBy, at: dispatch.requestedAt || dispatch.date }
            : null,
        dispatch.chefApprovedBy
            ? { label: 'اعتماد الشيف', name: dispatch.chefApprovedBy, at: dispatch.chefApprovedAt }
            : null,
        dispatch.warehouseApprovedBy || dispatch.approvedBy
            ? {
                  label: 'اعتماد المخزن',
                  name: dispatch.warehouseApprovedBy || dispatch.approvedBy,
                  at: dispatch.warehouseApprovedAt || dispatch.approvedDate,
              }
            : null,
        dispatch.kitchenReceivedBy
            ? { label: 'استلام القسم', name: dispatch.kitchenReceivedBy, at: dispatch.kitchenReceivedAt }
            : null,
        dispatch.cancelledBy ? { label: 'الإلغاء', name: dispatch.cancelledBy, at: dispatch.cancelledAt } : null,
        dispatch.reopenedBy
            ? { label: 'الإرجاع للمراجعة', name: dispatch.reopenedBy, at: dispatch.reopenedAt }
            : null,
        dispatch.voidedBy ? { label: 'الإبطال', name: dispatch.voidedBy, at: dispatch.voidedAt } : null,
    ].filter((entry) => entry !== null);
    const notes = [
        ['ملاحظات الطلب', dispatch.notes],
        ['ملاحظات الاعتماد', dispatch.approveNotes],
        ['ملاحظات الاستلام', dispatch.receiptNotes],
        ['سبب الرفض', dispatch.rejectionReason],
        ['سبب الإلغاء', dispatch.cancellationReason],
        ['سبب الإرجاع', dispatch.reopenReason],
        ['سبب الإبطال', dispatch.voidReason],
    ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()));

    return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>إذن صرف #${escapeHtml(dispatch.id)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:24px;background:#f4f6f7;color:#17212b;font-family:Tahoma,Arial,sans-serif}
    .sheet{max-width:900px;margin:auto;padding:28px;background:#fff;border:1px solid #d9e0e3}
    .brand{display:flex;align-items:center;gap:16px;padding-bottom:18px;border-bottom:3px solid #0b5a5f}
    .brand img{width:68px;height:68px;object-fit:contain}.brand strong{font-size:20px}.brand small{display:block;margin-top:4px;color:#667085}
    h1{margin:22px 0 6px;text-align:center;font-size:23px}.status{text-align:center;color:#0b5a5f;font-weight:700}
    .meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:20px 0}
    .meta div,.note{padding:10px 12px;border:1px solid #d9e0e3;border-radius:6px}.meta b,.note b{display:block;margin-bottom:4px;color:#0b5a5f}
    table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:9px;border:1px solid #b8c2c7;text-align:right}
    th{background:#e8f0f0;color:#153b3d}.numeric{text-align:center;direction:ltr;font-variant-numeric:tabular-nums}td small{display:block;color:#667085}
    .audit,.signatures{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:20px}
    .audit div,.signature{padding:10px;border:1px solid #d9e0e3;border-radius:6px;text-align:center}
    .audit b,.signature strong,.signature span,.signature small{display:block}.audit small,.signature small{margin-top:5px;color:#667085}
    .signature__ink{height:56px;display:flex;align-items:center;justify-content:center;margin-bottom:6px}
    .signature__ink img{max-width:100%;max-height:54px;object-fit:contain}.notes{display:grid;gap:8px;margin-top:18px}
    .footer{margin-top:24px;padding-top:10px;border-top:1px solid #d9e0e3;text-align:center;color:#667085;font-size:11px}
    @media print{body{padding:0;background:#fff}.sheet{max-width:none;padding:0;border:0}thead{display:table-header-group}tr{break-inside:avoid}.brand,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
    @page{size:A4;margin:12mm}
    @media(max-width:600px){body{padding:8px}.sheet{padding:14px}.meta{grid-template-columns:repeat(2,minmax(0,1fr))}.audit,.signatures{grid-template-columns:repeat(2,minmax(0,1fr))}}
  </style>
</head>
<body>
  <main class="sheet">
    <header class="brand"><img src="${escapeHtml(printLogoSrc({ logoB64: brand.logoSrc }))}" alt=""><div><strong>${escapeHtml(brand.name)}</strong><small>نظام إدارة المخازن والمطاعم</small></div></header>
    <h1>إذن صرف مخزني</h1>
    <div class="status">${escapeHtml(STATUS_LABELS[status] || status || 'غير محدد')}</div>
    <section class="meta">
      <div><b>رقم الإذن</b>#${escapeHtml(dispatch.id)}</div>
      <div><b>القسم الطالب</b>${escapeHtml(dispatch.deptName || dispatch.deptCode || '—')}</div>
      <div><b>تاريخ الطلب</b>${dateText(dispatch.requestedAt || dispatch.date)}</div>
    </section>
    <table><thead><tr><th>#</th><th>الصنف</th><th>الكمية المعتمدة</th><th>المستلم</th></tr></thead>
      <tbody>${itemRows || '<tr><td colspan="4" style="text-align:center">لا توجد أصناف مسجلة</td></tr>'}</tbody>
    </table>
    ${audit.length ? `<section class="audit">${audit.map((entry) => `<div><b>${escapeHtml(entry.label)}</b><span>${escapeHtml(entry.name)}</span><small>${dateText(entry.at)}</small></div>`).join('')}</section>` : ''}
    ${notes.length ? `<section class="notes">${notes.map(([label, value]) => `<div class="note"><b>${escapeHtml(label)}</b>${escapeHtml(value)}</div>`).join('')}</section>` : ''}
    <section class="signatures">
      ${signature('توقيع مقدم الطلب', dispatch.requestSignatureData, dispatch.createdBy, dispatch.requestedAt || dispatch.date)}
      ${signature('اعتماد الشيف', dispatch.chefApprovalSignatureData, dispatch.chefApprovedBy, dispatch.chefApprovedAt)}
      ${signature('اعتماد المخزن', dispatch.warehouseApprovalSignatureData, dispatch.warehouseApprovedBy || dispatch.approvedBy, dispatch.warehouseApprovedAt || dispatch.approvedDate)}
      ${signature('رفض الشيف', dispatch.chefRejectionSignatureData, dispatch.chefRejectedBy, dispatch.chefRejectedAt)}
      ${signature('رفض المخزن', dispatch.warehouseRejectionSignatureData, dispatch.warehouseRejectedBy, dispatch.warehouseRejectedAt)}
      ${signature('استلام القسم', dispatch.kitchenReceiptSignatureData, dispatch.kitchenReceivedBy, dispatch.kitchenReceivedAt)}
    </section>
    <footer class="footer">${escapeHtml(brand.name)} · إذن صرف #${escapeHtml(dispatch.id)} · ${escapeHtml(printStamp(printedAt))}</footer>
  </main>
</body>
</html>`;
}

export function dispatchPrintable(status: string | null | undefined): boolean {
    return PRINTABLE_STATUSES.has(String(status ?? ''));
}
