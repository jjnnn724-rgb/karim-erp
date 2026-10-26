/**
 * kot-printer.js — Kitchen Order Ticket (KOT) builders
 * ────────────────────────────────────────────────────────────────────────────
 * When a sale completes at the cashier, every sold item belongs to a
 * PRODUCTION department (pos_products.department_id = the kitchen that
 * prepares it). For each involved department one (or `kot_copies`) thermal
 * ticket is queued so the section chief sees what to prepare — with NO
 * prices anywhere (kitchen staff must never see money on a ticket).
 *
 * Exports (pure, fully unit-testable):
 *   buildKotGroups(items, productPrepMap)  → [{department_id, department_name, lines:[]}]
 *   buildKotData({order, group, cashier, includeNotes, timeLabel}) → flat data
 *   buildEscPosKot(data)                    → ESC/POS Buffer (80mm)
 *   kotHtml(datas)                          → RTL HTML page (one card per dept)
 */

const ESC = 0x1B, GS = 0x1D;
const CMD = {
    INIT:         Buffer.from([ESC, 0x40]),
    ALIGN_LEFT:   Buffer.from([ESC, 0x61, 0x00]),
    ALIGN_CENTER: Buffer.from([ESC, 0x61, 0x01]),
    BOLD_ON:      Buffer.from([ESC, 0x45, 0x01]),
    BOLD_OFF:     Buffer.from([ESC, 0x45, 0x00]),
    DOUBLE_WIDTH: Buffer.from([GS, 0x21, 0x10]),
    DOUBLE_HD:    Buffer.from([GS, 0x21, 0x11]),   // double width + double height
    NORMAL_SIZE:  Buffer.from([GS, 0x21, 0x00]),
    CUT_PAPER:    Buffer.from([GS, 0x56, 0x42, 0x00]),
    FEED:         (n) => Buffer.from([ESC, 0x64, n]),
};
const PAPER_WIDTH = 48;

// ─── Grouping (pure) ─────────────────────────────────────────────────────────
/**
 * Group sold line items by their PRODUCTION department.
 * @param {Array} items           sale line_items [{product_id, product_name, quantity, ...}]
 * @param {Map|Object} productPrepMap  product_id → {department_id, department_name}
 *        Items whose product has no prep department (buffet tiers, hospitality,
 *        service items) are deliberately skipped — they need no preparation.
 * @returns {Array} [{department_id, department_name, lines:[{name, quantity}]}]
 *        stable order: first appearance of the department in the sale.
 */
function buildKotGroups(items, productPrepMap) {
    const map = productPrepMap instanceof Map ? productPrepMap : new Map(Object.entries(productPrepMap || {}));
    const groups = [];
    const byDept = new Map();
    for (const it of (items || [])) {
        const pid = Number(it.product_id);
        if (!Number.isFinite(pid)) {continue;}
        const prep = map.get(pid) || map.get(String(pid));
        if (!prep || !prep.department_id) {continue;} // service/buffet item → no ticket
        let g = byDept.get(prep.department_id);
        if (!g) {
            g = { department_id: prep.department_id, department_name: prep.department_name || 'قسم التجهيز', lines: [] };
            byDept.set(prep.department_id, g);
            groups.push(g);
        }
        // same product appearing twice in the sale merges into one ticket line
        const existing = g.lines.find((l) => l.product_id === pid);
        if (existing) {existing.quantity = Number(existing.quantity) + Number(it.quantity || 0);}
        else {g.lines.push({ product_id: pid, name: it.product_name || '—', quantity: Number(it.quantity || 0) });}
    }
    return groups;
}

// ─── Data assembly (pure) ────────────────────────────────────────────────────

/**
 * Flat data for one ticket — shared by the ESC/POS builder and the HTML view
 * so both paths always print the exact same content.
 */
function buildKotData({ order, group, cashier, includeNotes = true, timeLabel }) {
    const notes = (includeNotes && order && order.notes) ? String(order.notes).trim() : '';
    return {
        department_id: group.department_id,
        department_name: group.department_name,
        order_no: order?.invoice_counter ?? null,
        order_uuid: String(order?.invoice_uuid || '').slice(0, 8).toUpperCase(),
        time: timeLabel || (order?.created_at
            ? new Date(order.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Riyadh' })
            : ''),
        cashier_name: cashier?.name || '',
        party_name: notes,
        lines: (group.lines || []).map((l) => ({ name: l.name, quantity: Number(l.quantity) || 0 })),
        items_total: (group.lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0),
    };
}

// ─── ESC/POS ticket (no prices, big type, kitchen-proof) ─────────────────────
function kotText(t) { return Buffer.from(String(t) + '\n', 'utf8'); }
function kotDivider(c = '-') { return Buffer.from(c.repeat(PAPER_WIDTH) + '\n', 'ascii'); }

function buildEscPosKot(data) {
    const chunks = [];
    chunks.push(CMD.INIT);
    chunks.push(CMD.ALIGN_CENTER);
    chunks.push(CMD.BOLD_ON);
    chunks.push(CMD.DOUBLE_HD);                       // big — readable across the kitchen
    chunks.push(kotText('تذكرة تجهيز'));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(CMD.DOUBLE_WIDTH);
    chunks.push(kotText(data.department_name || 'قسم التجهيز'));
    chunks.push(CMD.NORMAL_SIZE);
    chunks.push(CMD.BOLD_OFF);
    chunks.push(kotText(`Order #${data.order_no ?? '—'}   ${data.time}`));
    chunks.push(kotDivider('='));
    chunks.push(CMD.ALIGN_LEFT);
    if (data.party_name) {
        chunks.push(CMD.BOLD_ON);
        chunks.push(kotText(`الضيف/المناسبة: ${data.party_name}`));
        chunks.push(CMD.BOLD_OFF);
        chunks.push(kotDivider());
    }
    for (const l of data.lines) {
        chunks.push(CMD.BOLD_ON);
        chunks.push(kotText(`${l.quantity} × ${l.name}`));
        chunks.push(CMD.BOLD_OFF);
    }
    chunks.push(kotDivider());
    chunks.push(kotText(`إجمالي القطع: ${data.items_total}`));
    if (data.cashier_name) {chunks.push(kotText(`الكاشير: ${data.cashier_name}`));}
    if (data.order_uuid) {chunks.push(kotText(`REF: ${data.order_uuid}`));}
    chunks.push(kotText('لا تُطبع الأسعار على تذاكر المطبخ'));
    chunks.push(CMD.FEED(2));
    chunks.push(CMD.CUT_PAPER);
    return Buffer.concat(chunks);
}

// ─── RTL HTML view (kitchen tablet / browser printing) ───────────────────────
/**
 * One HTML page with a printable card per department ticket.
 * `datas` = array of buildKotData results (possibly multiple copies or depts).
 */
function kotHtml(datas, { restaurantName = 'مطاعم الشرفه العالمي' } = {}) {
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const cards = (datas || []).map((d) => `
  <div class="kot-card">
    <div class="kot-head">
      <div class="kot-title">تذكرة تجهيز</div>
      <div class="kot-dept">${esc(d.department_name)}</div>
      <div class="kot-meta">Order #${esc(d.order_no ?? '—')} · ${esc(d.time)}${d.order_uuid ? ` · REF ${esc(d.order_uuid)}` : ''}</div>
      ${d.party_name ? `<div class="kot-party">الضيف/المناسبة: ${esc(d.party_name)}</div>` : ''}
    </div>
    <table class="kot-lines">
      <thead><tr><th>الكمية</th><th>الصنف</th></tr></thead>
      <tbody>
        ${d.lines.map((l) => `<tr><td class="q">${esc(l.quantity)}</td><td>${esc(l.name)}</td></tr>`).join('')}
      </tbody>
    </table>
    <div class="kot-foot">إجمالي القطع: <b>${esc(d.items_total)}</b>${d.cashier_name ? ` · الكاشير: ${esc(d.cashier_name)}` : ''} <span class="noprice">لا أسعار على تذاكر المطبخ</span></div>
  </div>`).join('') || '<div class="kot-empty">لا توجد تذاكر تجهيز لهذا الطلب (كل الأصناف خدمات/بوفيه)</div>';

    return `<!DOCTYPE html>
<html dir="rtl" lang="ar"><head><meta charset="UTF-8">
<title>تذاكر تجهيز المطبخ</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Cairo','Tajawal',sans-serif;background:#f2f2f2;padding:14px;direction:rtl}
  .kot-brand{text-align:center;font-size:12pt;font-weight:800;color:#444;margin-bottom:10px}
  .kot-card{background:#fff;border:2px solid #222;border-radius:8px;max-width:420px;margin:0 auto 14px;padding:14px;page-break-inside:avoid}
  .kot-head{text-align:center;border-bottom:2px dashed #888;padding-bottom:8px;margin-bottom:8px}
  .kot-title{font-size:17pt;font-weight:900;letter-spacing:1px}
  .kot-dept{font-size:14pt;font-weight:800;color:#c0392b;margin-top:2px}
  .kot-meta{font-size:9pt;color:#555;margin-top:3px}
  .kot-party{font-size:11pt;font-weight:800;background:#fff6dd;border:1px solid #e0c869;border-radius:6px;padding:4px 8px;margin-top:6px}
  .kot-lines{width:100%;border-collapse:collapse;margin-top:4px}
  .kot-lines th{font-size:9pt;color:#666;border-bottom:1px solid #bbb;padding:4px;text-align:right}
  .kot-lines td{padding:7px 4px;border-bottom:1px dashed #ddd;font-size:13pt;font-weight:700}
  .kot-lines td.q{width:64px;font-size:15pt;font-weight:900;color:#000;white-space:nowrap}
  .kot-foot{margin-top:8px;font-size:9.5pt;color:#444;border-top:1px solid #ddd;padding-top:6px}
  .noprice{display:block;color:#c0392b;font-weight:700;font-size:8.5pt;margin-top:3px}
  .kot-empty{max-width:420px;margin:20px auto;background:#fff;border:1px dashed #aaa;border-radius:8px;padding:18px;text-align:center;color:#777}
  .kot-printbar{max-width:420px;margin:0 auto 12px;text-align:center}
  .kot-printbar button{padding:10px 26px;border:0;border-radius:8px;background:#2c3e50;color:#fff;font-size:12pt;font-weight:800;cursor:pointer;font-family:inherit}
  @media print{ body{background:#fff;padding:0} .kot-printbar,.kot-brand{display:none} .kot-card{border-width:1px;border-radius:0;max-width:none;margin:0 0 8px} }
</style></head>
<body>
  <div class="kot-printbar"><button onclick="window.print()">طباعة التذاكر</button></div>
  <div class="kot-brand">${esc(restaurantName)} — تذاكر المطبخ</div>
  ${cards}
</body></html>`;
}

module.exports = {
    buildKotGroups,
    buildKotData,
    buildEscPosKot,
    kotHtml,
    CMD, // exported for tests (assert real ESC/POS framing)
};
