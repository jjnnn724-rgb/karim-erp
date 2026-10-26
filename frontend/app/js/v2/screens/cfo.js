/**
 * V2 — CFO screen · لوحة المدير المالي + القيود + الفترات + القوائم + النمو
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of features/cfo.js (477 lines, read fully). Same doors,
 * same payloads, same server sentences. The server stays the authority on
 * every gate (cfoCanWrite → CFO_WRITE_ROLES admin/accountant, period
 * reopen admin-only, custody/shifts/day-close by their own routers).
 *
 * World-class deltas (no behavior change):
 *  - blocking dialogs and the month-modal replaced by inline forms (same fields, same payloads)
 *  - TB + journal read through EnterpriseDataTable (search/sort/pagination)
 *  - live Dr/Cr totals in the journal form (display only — the server validates)
 *  - growth/statements load on demand; periods + open shifts auto-load (parity)
 *  - prints use delegation-safe buttons (no inline handlers — CSP contract)
 */

import { createDataTable } from '../data-display/data-table.js?v=4.9.180';
import { canWrite } from '../session.js?v=4.9.180';
import { openInAppReport } from '../report-viewer.js?v=4.9.180';
import { formatInt, formatQty, formatMoney } from '../data/reports-repo.js?v=4.9.180';
import { ensureXlsx } from '../vendor.js?v=4.9.180';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.180';
import { kpiStrip } from '../role-dash-parts.js?v=4.9.180';
import {
    CFO_WRITE_ROLES, fetchCfoCurrency, fetchBrandName, fetchCfoSummary, fetchTrialBalance,
    fetchJournal, fetchChart, collectJournalLines, createJournal,
    approveJournal, voidJournal, postPayroll, fetchPeriods, closePeriod,
    openPeriod, fetchBalanceSheet, fetchCashFlow, fetchProfitByCC, fetchApAging,
    fetchBankRec, autoMatchBank, addBankStatement, fetchAssets, createAsset,
    disposeAsset, runDepreciation, fetchCustody, handCustody, ackCustody,
    fetchBudgetVsActual, createBudget, deleteBudget, fetchAlertsLog, runAlerts,
    fetchOpenShifts, closeShiftRemote, dayCloseStatus, execDayClose,
} from '../data/cfo-repo.js?v=4.9.180';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function isoDay(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function firstOfMonth() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-01`;
}

function fD(v) {
    return v ? new Date(v).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

/* kpiStrip مشترك الآن في role-dash-parts.js — نسخة واحدة للنظام. */

const TONE = {
    green: 'var(--erp-success-text)',
    red: 'var(--erp-danger-text)',
    gold: 'var(--erp-brand-text)',
    blue: 'var(--erp-info-text)',
};

function template(canPost) {
    return `
      <div class="erp-v2-cfo">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">المدير المالي
              <span class="erp-eyebrow" dir="ltr" lang="en">CFO</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <label class="erp-text-sm erp-text-muted" for="v2cfo-from">من</label>
            <input class="erp-input erp-input--ltr" id="v2cfo-from" type="date" value="${firstOfMonth()}" data-v2-from>
            <label class="erp-text-sm erp-text-muted" for="v2cfo-to">إلى</label>
            <input class="erp-input erp-input--ltr" id="v2cfo-to" type="date" value="${isoDay(0)}" data-v2-to>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print-summary>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة الملخص</span>
            </button>
            ${canPost ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-new-entry>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>قيد يدوي</span>
            </button>` : ''}
          </div>
        </div>
        <div data-v2-kpis></div>
        <section class="erp-card" data-v2-recon hidden><div class="erp-card__head">
          <h3 class="erp-card__title">تسوية الدفتر مع يارسوفت
            <span class="erp-eyebrow" dir="ltr" lang="en">Ledger parity</span>
          </h3>
          <span class="erp-grow"></span>
          <span data-v2-recon-badge></span>
        </div><div class="erp-card__body erp-stack">
          <div data-v2-recon-body></div>
        </div></section>
        <div data-v2-panel hidden></div>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">ميزان المراجعة <span class="erp-eyebrow" dir="ltr" lang="en">Trial Balance</span></h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print-tb>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-export-tb>
            <i class="ji" data-i="inbox" aria-hidden="true"></i><span>Excel</span>
          </button>
        </div><div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-tb-note></p>
          <div data-v2-tb></div>
        </div></section>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">دفتر اليومية <span class="erp-eyebrow" dir="ltr" lang="en">Journal</span></h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-print-journal>
            <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span>
          </button>
        </div><div class="erp-card__body erp-stack"><div data-v2-journal></div></div></section>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title"><i class="ji" data-i="lock" aria-hidden="true"></i> الإغلاق الشهري (قفل الفترات)</h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-periods-refresh>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
        </div><div class="erp-card__body erp-stack"><div data-v2-periods></div></div></section>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">القوائم الختامية</h3>
          <span class="erp-grow"></span>
          <input class="erp-input erp-input--ltr" type="date" value="${isoDay(0)}" data-v2-stmt-date aria-label="تاريخ القائمة">
          <button type="button" class="erp-btn erp-btn--sm" data-v2-balance>الميزانية العمومية</button>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-cashflow>التدفق النقدي</button>
        </div><div class="erp-card__body erp-stack"><div data-v2-stmt></div></div></section>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title"><i class="ji" data-i="users" aria-hidden="true"></i> إغلاق ورديات الكاشير مركزيًا</h3>
          <span class="erp-grow"></span>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-shifts-refresh>
            <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
          </button>
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-dayclose>إقفال اليوم Z</button>
        </div><div class="erp-card__body erp-stack"><div data-v2-shifts></div></div></section>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title"><i class="ji" data-i="trending-up" aria-hidden="true"></i> النمو المحاسبي</h3>
        </div><div class="erp-card__body erp-stack">
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="cc">ربحية المراكز</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="aging">أعمار الذمم</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="bank">التسوية البنكية</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="assets">الأصول والإهلاك</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="custody">العهد</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="budgets">الموازنات</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-g="alerts">سجل التنبيهات</button>
          </div>
          <div data-v2-growth></div>
        </div></section>
        ${canPost ? `<section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title"><i class="ji" data-i="banknote" aria-hidden="true"></i> ترحيل الرواتب</h3>
          <span class="erp-grow"></span>
          <input class="erp-input erp-input--ltr" type="month" data-v2-pay-month value="${isoDay(0).slice(0, 7)}" aria-label="شهر الرواتب">
          <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pay-post>ترحيل</button>
        </div></section>` : ''}
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void, confirmFn?: (m:string)=>boolean|Promise<boolean>}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountCfoScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 cfo]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const canPost = canWrite(ctx.role, CFO_WRITE_ROLES);

    let summary = null;
    let tb = null;
    let journalRows = [];
    let chart = [];
    let currency = '';
    let brand = '';
    let loading = false;
    let busy = false;
    let growthView = null;

    host.insertAdjacentHTML('beforeend', template(canPost));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');
    const kpisEl = q('[data-v2-kpis]');
    const panelEl = q('[data-v2-panel]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    function moneyText(v) {
        const m = formatMoney(v, currency);
        return m.hasUnit ? `${esc(m.amount)} <span class="erp-text-muted">${esc(m.unit)}</span>` : esc(m.amount);
    }

    const tbTable = createDataTable({
        caption: 'ميزان المراجعة — بيانات حية', mode: 'client', pageSize: 50,
        stickyHeader: true, emptyMessage: 'لا حركات في الفترة',
        emptyHint: 'رحّل المبيعات تلقائيًا من الكاشير أو أدخل قيدًا يدويًا.',
        rowKey: (row) => row.code,
        columns: [
            { key: 'code', header: 'الكود', sortable: true, filterable: true, width: '110px', className: 'erp-mono' },
            { key: 'name', header: 'الحساب', sortable: true, filterable: true },
            { key: 'type', header: 'النوع', sortable: true, filterable: true, width: '120px' },
            { key: 'debit', header: 'مدين', sortable: true, type: 'number', width: '130px', align: 'end', className: 'erp-tnum', render: (row) => moneyText(row.debit) },
            { key: 'credit', header: 'دائن', sortable: true, type: 'number', width: '130px', align: 'end', className: 'erp-tnum', render: (row) => moneyText(row.credit) },
            { key: 'balance', header: 'الرصيد', sortable: true, type: 'number', width: '140px', align: 'end', className: 'erp-tnum', render: (row) => moneyText(row.balance) },
        ],
    });

    const journalTable = createDataTable({
        caption: 'دفتر اليومية — بيانات حية', mode: 'client', pageSize: 20,
        stickyHeader: true, emptyMessage: 'لا قيود بعد', rowKey: (row) => row.id,
        columns: [
            { key: 'entry_no', header: 'القيد', sortable: true, width: '110px', className: 'erp-mono' },
            { key: 'date', header: 'التاريخ', sortable: true, width: '110px', render: (r) => esc(r.date ? fD(r.date) : '—') },
            { key: 'memo', header: 'البيان', filterable: true, render: (r) => (r.memo ? esc(r.memo) : '<span class="erp-text-muted">—</span>') },
            { key: 'source', header: 'المصدر', width: '150px', render: (r) => `<span class="erp-badge" data-tone="info">${esc(r.source || '—')}</span>` },
            { key: 'lines', header: 'السطور', render: (r) => r.linesHtml || '<span class="erp-text-muted">—</span>' },
            { key: 'status', header: 'الحالة', width: '110px', render: (r) => r.statusHtml || '' },
            ...(canPost ? [{
                key: 'actions', header: '', width: '170px',
                render: (r) => r.actionsHtml || '',
            }] : []),
        ],
    });

    q('[data-v2-tb]').appendChild(tbTable.el);
    q('[data-v2-journal]').appendChild(journalTable.el);

    function entryStatusHtml(j) {
        if (j.status === 'posted') {return '<span class="erp-badge" data-tone="success">مرحّل</span>';}
        if (j.status === 'draft') {return '<span class="erp-badge" data-tone="warning">مسودة</span>';}
        return '<span class="erp-badge" data-tone="neutral">ملغي</span>';
    }

    function journalRow(j) {
        const lines = Array.isArray(j.lines) ? j.lines : [];
        return {
            id: j.id, entry_no: j.entry_no || '—', date: j.date || '',
            memo: j.memo || '', source: j.source_type ? `${j.source_type}${j.source_id ? ` #${j.source_id}` : ''}` : '—',
            linesHtml: lines.map((l) => `<div><span class="erp-mono" dir="ltr">${esc(l.account_code)}</span> `
                + (Number(l.debit) ? `<span style="color:var(--erp-success-text)">مدين ${esc(formatMoney(l.debit, currency).amount)}</span>`
                : `<span style="color:var(--erp-danger-text)">دائن ${esc(formatMoney(l.credit, currency).amount)}</span>`)).join(''),
            statusHtml: entryStatusHtml(j),
            actionsHtml: canPost ? (`${j.status === 'draft' ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-approve="${esc(String(j.id))}">اعتماد</button> ` : ''}`
                + `${j.status === 'posted' ? `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-void="${esc(String(j.id))}">إلغاء</button>` : ''}`) : '',
            _dim: j.status !== 'posted',
        };
    }

    function paintKpis() {
        if (!summary || !tb) {kpisEl.innerHTML = ''; return;}
        const s = summary;
        const money = (v) => moneyText(v);
        const r = s.reconciliation || {};
        const net = s.net_profit || { amount: s.net_approx || 0 };
        const gross = s.gross_profit || { amount: 0 };
        const parityTone = r.status === 'متوافق' ? TONE.green : TONE.red;
        kpisEl.innerHTML = kpiStrip([
            { icon: 'banknote', label: 'الإيرادات', en: 'Revenue', html: money(s.revenue.total), color: TONE.green, hint: `${formatInt(s.revenue.count)} حركة — صافي بلا ضريبة أو بيع خارجي` },
            { icon: 'trending-up', label: 'مجمل الربح', en: 'Gross', html: money(gross.amount), color: TONE.green, hint: `بعد تكلفة المواد ${formatMoney(s.cogs ? s.cogs.net : 0, currency).amount} — هامش ${gross.margin_pct == null ? '—' : `${gross.margin_pct}%`}` },
            { icon: 'wallet', label: 'المصروفات', en: 'Expenses', html: money(s.expenses.total), color: TONE.red, hint: `${formatInt(s.expenses.count)} سطرًا تشغيليًا — بلا صرف مخزون أو فروق جرد` },
            { icon: 'gem', label: 'صافي الربح', en: 'Net', html: money(net.amount), color: net.amount >= 0 ? TONE.green : TONE.red, hint: `مجمل − فروق جرد − تشغيلية − رواتب (${formatMoney(s.payroll_open, currency).amount})` },
            { icon: 'archive', label: 'النقدية', en: 'Cash', html: money(s.cash_position), color: TONE.blue, hint: `صندوق ${formatMoney((s.cash_ledger || {}).petty_cash, currency).amount} · بنك ${formatMoney((s.cash_ledger || {}).bank, currency).amount}` },
            { icon: 'circle-check', label: 'تسوية الدفتر', en: 'Parity', html: `<span style="color:${parityTone}">${esc(r.status || '—')}</span>`, color: parityTone, hint: `فرق ${formatMoney(r.difference || 0, currency).amount} · ${formatInt(r.unposted_rows || 0)} صفًا بلا قيد` },
            { icon: 'receipt', label: 'فواتير POS', en: 'POS', html: money(s.pos.total), color: TONE.gold, hint: `${formatInt(s.pos.invoices)} فاتورة` },
            { icon: 'scale', label: 'الميزان', en: 'TB', html: tb.balanced ? 'متوازن' : 'غير متوازن', color: tb.balanced ? TONE.green : TONE.red, hint: `${formatInt(s.journal_entries)} قيدًا مرحّلًا في الفترة` },
        ], 'مؤشرات مالية');
        paintRecon();
    }

    function paintRecon() {
        const box = q('[data-v2-recon]');
        const body = q('[data-v2-recon-body]');
        const badge = q('[data-v2-recon-badge]');
        if (!box || !body || !badge) {return;}
        const r = (summary && summary.reconciliation) || null;
        if (!r) {box.hidden = true; body.innerHTML = ''; badge.textContent = ''; return;}
        const ok = r.status === 'متوافق';
        box.hidden = false;
        badge.innerHTML = `<span class="erp-badge" data-tone="${ok ? 'success' : 'danger'}">${esc(r.status || '—')}</span>`;
        const row = (label, value, tone) => `<tr class="erp-tr"><td class="erp-td">${esc(label)}</td>`
            + `<td class="erp-td erp-tnum" style="${tone ? `color:${tone}` : ''}" dir="ltr">${value}</td></tr>`;
        const m = (v) => moneyText(v);
        body.innerHTML = `<table class="erp-table__grid"><tbody>`
            + row('إيراد المرآة (يهام الكاشير)', `${m(r.mirror_revenue)} · ${formatInt(r.mirror_rows)} صفًا`)
            + row('المرحّل في الدفتر', `${m(r.ledger_revenue)} · ${formatInt(r.ledger_entries)} قيدًا`)
            + row('الفرق', m(r.difference), ok ? TONE.green : TONE.red)
            + row('صفوف بلا قيد', `${m(r.unposted_amount)} · ${formatInt(r.unposted_rows)} صفًا`, Number(r.unposted_rows) > 0 ? TONE.red : TONE.green)
            + row('مزدوجات مُلغاة', `${m(r.voided_amount)} · ${formatInt(r.voided_duplicates)} قيدًا`)
            + row('بيع خارجي (مُستثنى من القوائم)', `${m(r.external_revenue)} · ${formatInt(r.external_revenue_rows)} صفًا`)
            + row('حركات مخزون داخلية (مُستثناة من المصروفات)', `${m((summary.inventory_moves || {}).amount)} · ${formatInt((summary.inventory_moves || {}).count)} حركة`)
            + row('افتتاحي ما قبل الدفتر', `${m(r.pre_book_opening)} · ${formatInt(r.pre_book_months)} شهرًا`)
            + row('بداية الترحيل اليومي', `<span dir="ltr">${esc(r.cutover || '—')}</span>`)
            + `</tbody></table><p class="erp-text-sm erp-text-muted">${esc(r.note || '')}</p>`;
    }

    function paintTb() {
        const rows = (tb && Array.isArray(tb.accounts) ? tb.accounts : [])
            .filter((a) => Number(a.debit) || Number(a.credit))
            .map((a) => ({
                code: a.code, name: a.name_ar, type: a.type,
                debit: Number(a.debit), credit: Number(a.credit),
                balance: Number(a.debit) - Number(a.credit),
            }));
        tbTable.setRows(rows);
        const n = q('[data-v2-tb-note]');
        if (n) {n.textContent = tb ? `${rows.length} حسابًا بحركة — الفترة ${q('[data-v2-from]').value} ← ${q('[data-v2-to]').value}` : '';}
    }

    function paintJournal() {
        journalTable.setRows(journalRows.map(journalRow));
    }

    /* ── الطباعة: نفس ورقة القديم (cfo.js:421) بلا معالج سطري ──────────── */

    function printDoc(title, bodyHtml, period) {
        const w = openInAppReport(title);
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>${esc(title)}</title>`
            + `<style>body{font-family:'Cairo',Arial,sans-serif;padding:28px;color:#1a1a1a;direction:rtl}`
            + `.hd{text-align:center;border-bottom:3px solid #b45309;padding-bottom:14px;margin-bottom:18px}`
            + `.hd h1{margin:0 0 4px;color:#b45309;font-size:24px}.hd p{margin:3px 0;color:#555;font-size:13px}`
            + `table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:8px;text-align:center;font-size:13px}`
            + `th{background:#f4ead2}.tot td{font-weight:900;background:#fafafa}`
            + `.sig{display:flex;justify-content:space-between;margin-top:48px}.sig div{border-top:1px solid #555;padding-top:6px;width:28%;text-align:center;font-size:12px}`
            + `.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<div class="hd"><h1>${esc(brand || 'Karim ERP')}</h1><p>${esc(title)}</p><p>${esc(period || '')}</p></div>`
            + `${bodyHtml}<div class="sig"><div>إعداد المحاسب</div><div>مراجعة المدير المالي</div><div>اعتماد الإدارة</div></div>`
            + `</body></html>`);
        w.document.close();
        const bp = w.document.querySelector('[data-pl-print]');
        if (bp) {bp.addEventListener('click', () => w.print());}
        const bc = w.document.querySelector('[data-pl-close]');
        if (bc) {bc.addEventListener('click', () => w.close());}
        w.focus();
    }

    function printSummary() {
        if (!summary) {return;}
        const s = summary;
        const r = s.reconciliation || {};
        const kv = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
        const m = (v) => { const x = formatMoney(v, currency); return `${x.amount}${x.hasUnit ? ` ${esc(x.unit)}` : ''}`; };
        const pct = (v) => (v == null ? '—' : `${v}%`);
        const profit = (o) => { const x = o || {}; return `${m(x.amount)} (${pct(x.margin_pct)})`; };
        printDoc('المدير المالي', `<table><tbody>`
            + kv('الإيرادات (أساس قائمة الدخل)', m(s.revenue.total))
            + kv('تكلفة المواد', m((s.cogs || {}).net || 0))
            + kv('مجمل الربح', profit(s.gross_profit))
            + kv('فروق الجرد', m((s.shrinkage || {}).amount || 0))
            + kv('المصروفات التشغيلية', m(s.expenses.total))
            + kv('الرواتب', m(s.payroll_open))
            + kv('صافي الربح', profit(s.net_profit))
            + kv('النقدية (صندوق + بنك)', m(s.cash_position))
            + kv('فواتير POS', `${m(s.pos.total)} (${s.pos.invoices})`)
            + kv('تسوية الدفتر مع الكاشير', `${esc(r.status || '—')} — فرق ${m(r.difference || 0)} · ${Number(r.unposted_rows || 0)} صفًا بلا قيد`)
            + (s.top_expense_categories || []).map((c) => kv(`— ${esc(c.category)}`, m(c.total))).join('')
            + '</tbody></table>', `${q('[data-v2-from]').value} ← ${q('[data-v2-to]').value}`);
    }

    function printTb() {
        if (!tb) {return;}
        const rows = (tb.accounts || []).filter((a) => Number(a.debit) || Number(a.credit)).map((a) =>
            `<tr><td>${esc(a.code)}</td><td>${esc(a.name_ar)}</td><td>${esc(a.type)}</td>`
            + `<td>${formatQty(a.debit)}</td><td>${formatQty(a.credit)}</td><td>${formatQty(Number(a.debit) - Number(a.credit))}</td></tr>`).join('');
        const t = (v) => { const x = formatMoney(v, currency); return `${x.amount}${x.hasUnit ? ` ${esc(x.unit)}` : ''}`; };
        printDoc(`ميزان المراجعة — ${tb.balanced ? 'متوازن' : 'غير متوازن'}`,
            `<table><thead><tr><th>الكود</th><th>الحساب</th><th>النوع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows}</tbody>`
            + `<tfoot><tr class="tot"><td colspan="3">الإجمالي</td><td>${t(tb.total_debit)}</td><td>${t(tb.total_credit)}</td><td></td></tr></tfoot></table>`,
            `${q('[data-v2-from]').value} ← ${q('[data-v2-to]').value}`);
    }

    function printJournalDoc() {
        const rows = journalRows.map((j) =>
            `<tr><td>${esc(j.entry_no)}</td><td>${esc(String(j.date).slice(0, 10))}</td><td>${esc(j.memo || '—')}</td>`
            + `<td>${esc(j.source_type)}${j.source_id ? ` #${esc(String(j.source_id)).slice(-8)}` : ''}</td>`
            + `<td>${(j.lines || []).map((l) => `${esc(l.account_code)}: ${Number(l.debit) ? `مدين ${formatQty(l.debit)}` : `دائن ${formatQty(l.credit)}`}`).join('<br>')}</td>`
            + `<td>${j.status === 'posted' ? 'مرحّل' : 'ملغي'}</td></tr>`).join('');
        printDoc('دفتر اليومية',
            `<table><thead><tr><th>القيد</th><th>التاريخ</th><th>البيان</th><th>المصدر</th><th>السطور</th><th>الحالة</th></tr></thead><tbody>${rows}</tbody></table>`,
            `${q('[data-v2-from]').value} ← ${q('[data-v2-to]').value}`);
    }

    async function exportTb() {
        if (!tb) {return;}
        // xlsx ليس محمَّلًا في v2.html (قرار السرعة في vendor.js) — يُجلب عند أول تصدير.
        const ready = await ensureXlsx();
        if (!ready || typeof window.XLSX === 'undefined') {say('مكتبة Excel غير محمّلة — حدّث الصفحة'); return;}
        const data = [['الكود', 'الحساب', 'النوع', 'مدين', 'دائن', 'الرصيد']];
        (tb.accounts || []).filter((a) => Number(a.debit) || Number(a.credit))
            .forEach((a) => data.push([a.code, a.name_ar, a.type, Number(a.debit), Number(a.credit), Number(a.debit) - Number(a.credit)]));
        data.push(['', '', '', tb.total_debit, tb.total_credit, '']);
        const ws = window.XLSX.utils.aoa_to_sheet(data);
        ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'TB');
        prepareReportWorkbook(window.XLSX, wb, 'ميزان المراجعة');
        window.XLSX.writeFile(wb, `trial-balance_${q('[data-v2-from]').value}_${q('[data-v2-to]').value}.xlsx`);
        say('تم تحميل ميزان المراجعة');
    }

    /* ── اللوحة: قيد يدوي + تأكيدات ─────────────────────────────────────── */

    function closePanel() {
        panelEl.innerHTML = '';
        panelEl.hidden = true;
    }

    function openEntryPanel() {
        const opts = chart.filter((c) => c.is_postable && c.is_active)
            .map((c) => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name_ar)}</option>`).join('');
        const row = (i) => `<tr><td><select class="erp-select" data-jl-acc="${i}" aria-label="حساب السطر ${i + 1}" style="width:100%">${opts}</select></td>`
            + `<td><input class="erp-input" type="number" data-jl-dr="${i}" aria-label="مدين — السطر ${i + 1}" min="0" step="0.01" style="width:100%"></td>`
            + `<td><input class="erp-input" type="number" data-jl-cr="${i}" aria-label="دائن — السطر ${i + 1}" min="0" step="0.01" style="width:100%"></td></tr>`;
        panelEl.innerHTML = `<div class="erp-card"><div class="erp-card__head"><h3 class="erp-card__title">قيد يدوي متوازن</h3>`
            + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-panel-close>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<div class="erp-dash-controls"><label class="erp-text-sm erp-text-muted" for="v2cfo-jl-date">التاريخ</label>`
            + `<input class="erp-input erp-input--ltr" id="v2cfo-jl-date" type="date" data-v2-jl-date value="${isoDay(0)}">`
            + `<label class="erp-text-sm erp-text-muted" for="v2cfo-jl-memo">البيان</label>`
            + `<input class="erp-input" id="v2cfo-jl-memo" data-v2-jl-memo placeholder="شرح القيد"></div>`
            + `<table class="erp-table__grid"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead>`
            + `<tbody>${row(0)}${row(1)}${row(2)}${row(3)}</tbody></table>`
            + `<p class="erp-text-sm erp-text-muted"><span data-v2-jl-total></span></p>`
            + `<div data-v2-panel-msg role="alert" class="erp-text-sm"></div>`
            + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-jl-draft>حفظ كمسودة</button>`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-jl-post><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span></button></div>`
            + `</div></div>`;
        panelEl.hidden = false;
        panelEl.scrollIntoView({ block: 'nearest' });
    }

    function panelMsg(t) {
        const box = panelEl.querySelector('[data-v2-panel-msg]');
        if (box) {box.textContent = t || '';}
        if (t) {say(t);}
    }

    function updateJlTotal() {
        const box = panelEl.querySelector('[data-v2-jl-total]');
        if (!box) {return;}
        let dr = 0;
        let cr = 0;
        for (let i = 0; i < 4; i += 1) {
            dr += parseFloat(panelEl.querySelector(`[data-jl-dr="${i}"]`)?.value) || 0;
            cr += parseFloat(panelEl.querySelector(`[data-jl-cr="${i}"]`)?.value) || 0;
        }
        box.textContent = `مدين ${formatQty(dr)} = دائن ${formatQty(cr)}${Math.abs(dr - cr) < 0.005 && dr > 0 ? ' ✓ متوازن' : ''}`;
    }

    async function submitEntry(asDraft) {
        if (busy) {say('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
        const rows = [];
        for (let i = 0; i < 4; i += 1) {
            rows.push({
                account_code: panelEl.querySelector(`[data-jl-acc="${i}"]`)?.value,
                debit: parseFloat(panelEl.querySelector(`[data-jl-dr="${i}"]`)?.value) || 0,
                credit: parseFloat(panelEl.querySelector(`[data-jl-cr="${i}"]`)?.value) || 0,
            });
        }
        const lines = collectJournalLines(rows);
        if (!lines.length) {panelMsg('أدخل سطرًا واحدًا على الأقل بحساب ومبلغ'); return;}
        busy = true;
        try {
            await createJournal({
                date: panelEl.querySelector('[data-v2-jl-date]')?.value,
                memo: panelEl.querySelector('[data-v2-jl-memo]')?.value,
                lines, status: asDraft ? 'draft' : 'posted',
            });
            closePanel();
            say(asDraft ? 'حُفظت المسودة — بانتظار الاعتماد' : 'تم ترحيل القيد');
            await reload();
        } catch (e) {
            panelMsg((e && e.message) || 'تعذر حفظ القيد');
        } finally {
            busy = false;
        }
    }

    /* ── الفترات ────────────────────────────────────────────────────────── */

    async function loadPeriods() {
        const box = q('[data-v2-periods]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchPeriods();
            if (!el.isConnected) {return;}
            const rows = (d.periods || []).slice(0, 12).map((p) => `<tr>`
                + `<td class="erp-td erp-mono">${esc(p.period)}</td>`
                + `<td class="erp-td">${p.closed ? '<span class="erp-badge" data-tone="neutral">مقفلة 🔒</span>' : '<span class="erp-badge" data-tone="success">مفتوحة</span>'}</td>`
                + `<td class="erp-td erp-text-muted">${formatInt(p.posted)} مرحّل / ${formatInt(p.drafts)} مسودة</td>`
                + `<td class="erp-td erp-text-muted">${p.closed ? `أقفلها @${esc(p.closed_by_name || '—')}` : '—'}</td>`
                + `<td class="erp-td">${!p.closed && canPost ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-pclose="${esc(p.period)}">قفل</button>` : ''}`
                + `${p.closed && ctx.role === 'admin' ? ` <button type="button" class="erp-btn erp-btn--sm" data-v2-popen="${esc(p.period)}">إعادة فتح</button>` : ''}</td></tr>`).join('');
            box.innerHTML = `<table class="erp-table__grid"><thead><tr><th>الفترة</th><th>الحالة</th><th>القيود</th><th>القفل</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
                + `<div data-v2-pform></div>`
                + `<small class="erp-text-sm erp-text-muted">القفل يمنع أي ترحيل/إلغاء على الشهر — وإعادة الفتح للمدير فقط ومسجلة باسمه.</small>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    function openPeriodCloseForm(period) {
        const holder = q('[data-v2-pform]');
        if (!holder) {return;}
        holder.innerHTML = `<div class="erp-dash-controls"><span class="erp-text-sm">قفل فترة <b class="erp-mono" dir="ltr">${esc(period)}</b> — ملاحظة اختيارية:</span>`
            + `<input class="erp-input" data-v2-pnote maxlength="300" placeholder="ملاحظة القفل">`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pclose-go="${esc(period)}">تأكيد القفل</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pform-x>إلغاء</button></div>`;
    }

    /* ── القوائم ────────────────────────────────────────────────────────── */

    async function loadBalance() {
        const box = q('[data-v2-stmt]');
        const asOf = q('[data-v2-stmt-date]').value || q('[data-v2-to]').value;
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchBalanceSheet(asOf);
            if (!el.isConnected) {return;}
            const t = d.totals || {};
            const m = (v) => moneyText(v);
            const rows = (arr) => (arr || []).filter((a) => Math.abs(Number(a.balance)) > 0.005)
                .map((a) => `<tr><td class="erp-td erp-mono">${esc(a.code)}</td><td class="erp-td">${esc(a.name_ar)}</td><td class="erp-td">${m(a.balance)}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="3">—</td></tr>';
            box.innerHTML = `<h4>الميزانية العمومية — حتى ${esc(d.as_of)} ${t.balanced ? '<span class="erp-badge" data-tone="success">متوازنة ✓</span>' : '<span class="erp-badge" data-tone="danger">غير متوازنة!</span>'}</h4>`
                + `<table class="erp-table__grid"><thead><tr><th>الكود</th><th>الأصول</th><th>الرصيد</th></tr></thead><tbody>${rows(d.assets)}</tbody></table>`
                + `<table class="erp-table__grid"><thead><tr><th>الكود</th><th>الالتزامات</th><th>الرصيد</th></tr></thead><tbody>${rows(d.liabilities)}</tbody></table>`
                + `<table class="erp-table__grid"><thead><tr><th>الكود</th><th>حقوق الملكية (+ ربح الفترة ${m(t.currentProfit)})</th><th>الرصيد</th></tr></thead><tbody>${rows(d.equity)}</tbody></table>`
                + `<p class="erp-text-sm">الأصول ${m(t.assets)} = الالتزامات ${m(t.liabilities)} + الملكية ${m(t.equity)}</p>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    async function loadCashflow() {
        const box = q('[data-v2-stmt]');
        const to = q('[data-v2-stmt-date]').value || q('[data-v2-to]').value;
        const from = `${String(to).slice(0, 7)}-01`;
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchCashFlow(from, to);
            if (!el.isConnected) {return;}
            const rows = (d.byCounterparty || []).map((c) => `<tr><td class="erp-td">${esc(c.account)}</td>`
                + `<td class="erp-td" style="color:${c.net >= 0 ? 'var(--erp-success-text)' : 'var(--erp-danger-text)'}">${moneyText(c.net)}</td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="2">لا حركة نقدية</td></tr>';
            box.innerHTML = `<h4>التدفق النقدي (الطريقة المباشرة) — ${esc(d.from)} ← ${esc(d.to)}</h4>`
                + kpiStrip([
                    { icon: 'archive', label: 'رصيد أول الفترة', en: 'Opening', html: moneyText(d.opening), hint: 'صندوق+بنك' },
                    { icon: 'banknote', label: 'مقبوضات', en: 'In', html: moneyText(d.inflow), color: TONE.green, hint: '' },
                    { icon: 'wallet', label: 'مدفوعات', en: 'Out', html: moneyText(d.outflow), color: TONE.red, hint: '' },
                    { icon: 'gem', label: 'الصافي / الختامي', en: 'Net', html: `${moneyText(d.net)} / ${moneyText(d.closing)}`, color: TONE.gold, hint: '' },
                ], 'مؤشرات مالية')
                + `<table class="erp-table__grid"><thead><tr><th>الطرف المقابل</th><th>الصافي</th></tr></thead><tbody>${rows}</tbody></table>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    /* ── الورديات والإقفال ──────────────────────────────────────────────── */

    async function loadShifts() {
        const box = q('[data-v2-shifts]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchOpenShifts();
            if (!el.isConnected) {return;}
            const rows = (d.shifts || []).map((s) => {
                const stale = s.biz_date !== s.today;
                return `<tr${stale ? ' style="background:rgba(255,0,0,.06)"' : ''}>`
                + `<td class="erp-td erp-mono">#${s.id}</td><td class="erp-td">${esc(s.cashier_name || '—')}</td>`
                + `<td class="erp-td">${esc(s.dept_name || '—')}</td>`
                + `<td class="erp-td erp-mono">${esc(s.biz_date)}${stale ? ' ⚠ يوم سابق' : ''}</td>`
                + `<td class="erp-td">${moneyText(s.opening_balance)}</td><td class="erp-td">${moneyText(s.expected_cash)}</td>`
                + `<td class="erp-td erp-text-muted">${formatInt(s.invoice_count)} فاتورة</td>`
                + `<td class="erp-td"><input class="erp-input" type="number" data-v2-shift-actual="${s.id}" min="0" step="0.01" placeholder="الجرد الفعلي" style="width:120px" aria-label="الجرد الفعلي للوردية ${s.id}"></td>`
                + `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-shift-close="${s.id}">إغلاق</button></td></tr>`;
            }).join('');
            box.innerHTML = `<table class="erp-table__grid"><thead><tr><th>وردية</th><th>الكاشير</th><th>القسم</th><th>اليوم</th><th>العهدة</th><th>المتوقع</th><th>الحركة</th><th>الجرد الفعلي</th><th></th></tr></thead>`
                + `<tbody>${rows || '<tr><td class="erp-td" colspan="9">لا ورديات مفتوحة — كل الكاشيرية مغلقة ✓</td></tr>'}</tbody></table>`
                + `<small class="erp-text-sm erp-text-muted">الإغلاق عن بُعد بصلاحية المدير — يُسجل باسمك في التدقيق. الورديات المظللة من أيام سابقة ويجب إغلاقها أولًا.</small>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    /* ── النمو ──────────────────────────────────────────────────────────── */

    function growthBox() {
        return q('[data-v2-growth]');
    }

    function stmtPeriod() {
        return (q('[data-v2-stmt-date]').value || q('[data-v2-to]').value).slice(0, 7);
    }

    async function loadGrowth(view) {
        growthView = view;
        const box = growthBox();
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            if (view === 'cc') {
                const to = q('[data-v2-stmt-date]').value || q('[data-v2-to]').value;
                const d = await fetchProfitByCC(`${String(to).slice(0, 7)}-01`, to);
                if (!el.isConnected || growthView !== view) {return;}
                const rows = (d.centers || []).map((c) => `<tr><td class="erp-td"><b>${esc(c.cc)}</b><br><small class="erp-text-muted">${esc(c.cc_name || '')}</small></td>`
                    + `<td class="erp-td" style="color:var(--erp-success-text)">${moneyText(c.revenue)}</td>`
                    + `<td class="erp-td" style="color:var(--erp-danger-text)">${moneyText(c.cogs)}</td>`
                    + `<td class="erp-td" style="color:var(--erp-danger-text)">${moneyText(c.expense)}</td>`
                    + `<td class="erp-td" style="color:${c.net >= 0 ? 'var(--erp-success-text)' : 'var(--erp-danger-text)'}"><b>${moneyText(c.net)}</b></td></tr>`).join('');
                box.innerHTML = `<h4>ربحية مراكز التكلفة — ${esc(d.from)} ← ${esc(d.to)}</h4>`
                    + `<table class="erp-table__grid"><thead><tr><th>المركز</th><th>إيراد</th><th>تكلفة</th><th>مصروف</th><th>الصافي</th></tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="5">لا حركة — وزّع القيود على المراكز من نافذة القيد (حقل اختياري).</td></tr>'}</tbody></table>`;
            } else if (view === 'aging') {
                const d = await fetchApAging();
                if (!el.isConnected || growthView !== view) {return;}
                const rows = (d.aging || []).map((a) => `<tr><td class="erp-td"><b>${esc(a.supplier)}</b></td>`
                    + `<td class="erp-td">${moneyText(a.total)}</td><td class="erp-td">${moneyText(a.current)}</td>`
                    + `<td class="erp-td">${moneyText(a.d30)}</td><td class="erp-td">${moneyText(a.d60)}</td>`
                    + `<td class="erp-td" style="color:${a.d90 > 0 ? 'var(--erp-danger-text)' : 'inherit'}">${moneyText(a.d90)}</td>`
                    + `<td class="erp-td" style="color:${a.over90 > 0 ? 'var(--erp-danger-text)' : 'inherit'}"><b>${moneyText(a.over90)}</b></td></tr>`).join('');
                box.innerHTML = `<h4>أعمار ذمم الموردين — الإجمالي ${moneyText(d.total)} (متأخر +90: تنبيه واتساب مقترح)</h4>`
                    + `<table class="erp-table__grid"><thead><tr><th>المورد</th><th>الإجمالي</th><th>غير مؤرخ</th><th>0-30</th><th>31-60</th><th>61-90</th><th>+90 ⚠</th></tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="7">لا ذمم مستحقة ✓</td></tr>'}</tbody></table>`;
            } else if (view === 'bank') {
                await paintBank(box, view);
            } else if (view === 'assets') {
                await paintAssets(box, view);
            } else if (view === 'custody') {
                await paintCustody(box, view);
            } else if (view === 'budgets') {
                await paintBudgets(box, view);
            } else if (view === 'alerts') {
                const d = await fetchAlertsLog();
                if (!el.isConnected || growthView !== view) {return;}
                const rows = (d.log || []).map((a) => `<tr><td class="erp-td erp-mono">${esc(a.key)}</td><td class="erp-td">${esc(a.last_title || '—')}</td>`
                    + `<td class="erp-td erp-text-muted">${esc(String(a.last_sent_at || '').replace('T', ' ').slice(0, 19))}</td><td class="erp-td">${formatInt(a.times_sent)}×</td></tr>`).join('');
                box.innerHTML = `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-alerts-run>فحص الآن</button>`
                    + `<span class="erp-text-sm erp-text-muted">الفحص التلقائي كل 30 دقيقة — التنبيه الواحد يُرسل مرة كل 24 ساعة.</span></div>`
                    + `<table class="erp-table__grid"><thead><tr><th>القاعدة</th><th>آخر تنبيه</th><th>الوقت</th><th>المرات</th></tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="4">لا تنبيهات مرسلة — الوضع هادئ ✓</td></tr>'}</tbody></table>`;
            }
        } catch (e) {
            if (!el.isConnected || growthView !== view) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر الجلب')}</p>`;
        }
    }

    async function paintBank(box, view) {
        const to = q('[data-v2-stmt-date]').value || q('[data-v2-to]').value;
        const from = `${String(to).slice(0, 7)}-01`;
        const d = await fetchBankRec('1010', from, to);
        if (!el.isConnected || growthView !== view) {return;}
        const rows = (d.unmatched || []).map((s) => `<tr><td class="erp-td">${esc(String(s.stmt_date).slice(0, 10))}</td><td class="erp-td">${esc(s.description || '—')}</td>`
            + `<td class="erp-td" style="color:${Number(s.amount) >= 0 ? 'var(--erp-success-text)' : 'var(--erp-danger-text)'}">${moneyText(s.amount)}</td></tr>`).join('');
        box.innerHTML = `<h4>التسوية البنكية (1010) — ${esc(d.from)} ← ${esc(d.to)}</h4>`
            + kpiStrip([
                { icon: 'archive', label: 'الدفتر', en: 'Book', html: moneyText(d.book), hint: '' },
                { icon: 'banknote', label: 'الكشف', en: 'Statement', html: moneyText(d.statement), hint: '' },
                { icon: 'scale', label: 'الفرق', en: 'Diff', html: moneyText(d.diff), color: d.diff === 0 ? TONE.green : TONE.red, hint: '' },
            ], 'مؤشرات مالية')
            + (canPost ? `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-bank-match>مطابقة تلقائية</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-bank-add>إضافة سطر كشف</button></div><div data-v2-bank-form></div>` : '')
            + `<table class="erp-table__grid"><thead><tr><th>التاريخ</th><th>البيان</th><th>المبلغ</th></tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="3">لا بنود معلقة — التسوية نظيفة ✓</td></tr>'}</tbody></table>`;
    }

    async function paintAssets(box, view) {
        const d = await fetchAssets();
        if (!el.isConnected || growthView !== view) {return;}
        const rows = (d.assets || []).filter((a) => a.status === 'active').map((a) => `<tr><td class="erp-td"><b>${esc(a.name)}</b></td>`
            + `<td class="erp-td">${moneyText(a.cost)}</td><td class="erp-td">${moneyText(a.monthly)}/شهر</td>`
            + `<td class="erp-td">${moneyText(a.accumulated)}</td><td class="erp-td">${moneyText(a.remaining)}</td>`
            + `<td class="erp-td erp-text-muted">${esc(a.last_month || '—')}</td>`
            + (canPost ? `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-asset-dispose="${esc(String(a.id))}">استبعاد</button></td>` : '<td class="erp-td"></td>')).join('');
        box.innerHTML = (canPost ? `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-asset-add>أصل جديد</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-dep-run>تشغيل إهلاك الشهر</button></div><div data-v2-asset-form></div>` : '')
            + `<table class="erp-table__grid"><thead><tr><th>الأصل</th><th>التكلفة</th><th>الشهري</th><th>المتراكم</th><th>المتبقي</th><th>آخر إهلاك</th><th></th></tr></thead>`
            + `<tbody>${rows || '<tr><td class="erp-td" colspan="7">لا أصول — سجل معدات المطبخ والتجهيزات هنا.</td></tr>'}</tbody></table>`;
    }

    async function paintCustody(box, view) {
        const d = await fetchCustody();
        if (!el.isConnected || growthView !== view) {return;}
        const rows = (d.rows || []).map((c) => `<tr><td class="erp-td">@${esc(c.from_name)}</td><td class="erp-td">@${esc(c.to_name)}</td>`
            + `<td class="erp-td">${moneyText(c.amount)}</td><td class="erp-td">${esc(c.note || '—')}</td>`
            + `<td class="erp-td">${c.ack_at ? '<span class="erp-badge" data-tone="success">مُستلمة ✓</span>' : '<span class="erp-badge" data-tone="warning">معلقة</span>'}</td></tr>`).join('');
        box.innerHTML = (canPost ? `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-custody-hand>تسليم عهدة</button>`
            + `<span class="erp-text-sm erp-text-muted">لديك ${formatInt(d.myPending)} عهدة معلقة بانتظار إقرارك.</span></div><div data-v2-custody-form></div>`
            + `<div class="erp-dash-controls"><input class="erp-input" data-v2-custody-ack-id placeholder="رقم العهدة للإقرار" style="width:160px" inputmode="numeric"><button type="button" class="erp-btn erp-btn--sm" data-v2-custody-ack>إقرار استلام</button></div>`
            : `<p class="erp-text-sm erp-text-muted">لديك ${formatInt(d.myPending)} عهدة معلقة بانتظار إقرارك.</p>`)
            + `<table class="erp-table__grid"><thead><tr><th>من</th><th>إلى</th><th>المبلغ</th><th>ملاحظة</th><th>الحالة</th></tr></thead>`
            + `<tbody>${rows || '<tr><td class="erp-td" colspan="5">لا عهد اليوم.</td></tr>'}</tbody></table>`;
    }

    async function paintBudgets(box, view) {
        const period = stmtPeriod();
        const d = await fetchBudgetVsActual(period);
        if (!el.isConnected || growthView !== view) {return;}
        const rows = (d.rows || []).map((r) => `<tr><td class="erp-td"><b>${esc(r.label || r.account_name || r.account_code || '—')}</b></td>`
            + `<td class="erp-td erp-mono" dir="ltr">${esc(r.account_code || '—')}</td><td class="erp-td">${moneyText(r.budget)}</td><td class="erp-td">${moneyText(r.actual)}</td>`
            + `<td class="erp-td" style="color:${r.over ? 'var(--erp-danger-text)' : 'var(--erp-success-text)'}"><b>${moneyText(r.variance)}${r.over ? ' ⚠' : ''}</b></td>`
            + `<td class="erp-td">${r.pct === null || r.pct === undefined ? '—' : `${formatQty(r.pct)}%`}</td>`
            + (canPost ? `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-budget-del="${esc(String(r.id))}">حذف</button></td>` : '<td class="erp-td"></td>')).join('');
        box.innerHTML = (canPost ? `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--sm" data-v2-budget-add>موازنة جديدة</button>`
            + `<span class="erp-text-sm erp-text-muted">${esc(period)} — التجاوز يُنبه تلقائيًا.</span></div><div data-v2-budget-form></div>` : '')
            + `<table class="erp-table__grid"><thead><tr><th>البند</th><th>الحساب</th><th>الموازنة</th><th>الفعلي</th><th>الانحراف</th><th>النسبة</th><th></th></tr></thead>`
            + `<tbody>${rows || '<tr><td class="erp-td" colspan="7">لا موازنات — أضف سقوف المصروفات هنا.</td></tr>'}</tbody></table>`;
    }

    function miniForm(holderSel, fieldsHtml, goAttr, goLabel) {
        const holder = el.querySelector(holderSel);
        if (!holder) {return;}
        holder.innerHTML = `<div class="erp-dash-controls">${fieldsHtml}`
            + `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-mini-go="${goAttr}">${esc(goLabel)}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-mini-x>إلغاء</button></div>`
            + `<div data-v2-mini-msg role="alert" class="erp-text-sm"></div>`;
    }

    function miniMsg(t) {
        const box = el.querySelector('[data-v2-mini-msg]');
        if (box) {box.textContent = t || '';}
        if (t) {say(t);}
    }

    const miniVal = (sel) => el.querySelector(sel)?.value ?? '';

    /* ── القراءة الرئيسية ───────────────────────────────────────────────── */

    async function reload() {
        if (loading) {return;}
        loading = true;
        const from = q('[data-v2-from]').value;
        const to = q('[data-v2-to]').value;
        tbTable.setLoading(true);
        journalTable.setLoading(true);
        try {
            const [s, t, j, c, cur] = await Promise.all([
                fetchCfoSummary(from, to), fetchTrialBalance(from, to),
                fetchJournal(30), fetchChart(), fetchCfoCurrency(),
            ]);
            if (!el.isConnected) {return;}
            summary = s;
            tb = t;
            journalRows = Array.isArray(j) ? j : (j && Array.isArray(j.entries) ? j.entries : []);
            chart = Array.isArray(c) ? c : (c && Array.isArray(c.chart) ? c.chart : []);
            currency = cur || '';
            try {brand = await fetchBrandName();}
            catch {brand = '';}
            if (!el.isConnected) {return;}
            paintKpis();
            paintTb();
            paintJournal();
            say(`المدير المالي — الفترة ${from} ← ${to}${currency ? '' : ' (عملة النظام غائبة — الأرقام بلا وحدة)'}`);
            loadPeriods();
            loadShifts();
        } catch (e) {
            if (!el.isConnected) {return;}
            summary = null;
            tb = null;
            journalRows = [];
            tbTable.setRows([]);
            journalTable.setRows([]);
            kpisEl.innerHTML = '';
            paintRecon();
            say(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض المحاسبة بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل بيانات المحاسبة: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    /* ── التفويض ────────────────────────────────────────────────────────── */

    el.addEventListener('input', (event) => {
        if (event.target.closest('[data-v2-panel]')) {updateJlTotal();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-from], [data-v2-to]')) {reload();}
    });

    el.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-panel-close]')) {closePanel(); return;}
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print-summary]')) {printSummary(); return;}
        if (event.target.closest('[data-v2-print-tb]')) {printTb(); return;}
        if (event.target.closest('[data-v2-export-tb]')) {exportTb(); return;}
        if (event.target.closest('[data-v2-print-journal]')) {printJournalDoc(); return;}
        if (event.target.closest('[data-v2-periods-refresh]')) {loadPeriods(); return;}
        if (event.target.closest('[data-v2-balance]')) {loadBalance(); return;}
        if (event.target.closest('[data-v2-cashflow]')) {loadCashflow(); return;}
        if (event.target.closest('[data-v2-shifts-refresh]')) {loadShifts(); return;}
        if (event.target.closest('[data-v2-new-entry]')) {openEntryPanel(); return;}
        if (event.target.closest('[data-v2-jl-draft]')) {submitEntry(true); return;}
        if (event.target.closest('[data-v2-jl-post]')) {submitEntry(false); return;}
        const g = event.target.closest('[data-v2-g]');
        if (g) {loadGrowth(g.dataset.v2G); return;}

        const ap = event.target.closest('[data-v2-approve]');
        if (ap) {
            if (busy) {say('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
            if (!await confirmFn('اعتماد هذا القيد وترحيله نهائيًا؟')) {return;}
            busy = true;
            try {
                await approveJournal(ap.dataset.v2Approve);
                say('اعتُمد القيد ورُحّل');
                await reload();
            } catch (e) {say((e && e.message) || 'تعذر الاعتماد');} finally {busy = false;}
            return;
        }
        const vd = event.target.closest('[data-v2-void]');
        if (vd) {
            if (busy) {say('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
            if (!await confirmFn('إلغاء هذا القيد؟ سيبقى للمراجعة.')) {return;}
            busy = true;
            try {
                await voidJournal(vd.dataset.v2Void);
                say('أُلغي القيد (يبقى للمراجعة)');
                await reload();
            } catch (e) {say((e && e.message) || 'تعذر الإلغاء');} finally {busy = false;}
            return;
        }
        if (event.target.closest('[data-v2-pay-post]')) {
            if (busy) {say('جارٍ تنفيذ عملية — انتظر النتيجة'); return;}
            const m = miniVal('[data-v2-pay-month]') || q('[data-v2-pay-month]')?.value || '';
            if (!/^\d{4}-\d{2}$/.test(m)) {say('الشهر بصيغة YYYY-MM'); return;}
            busy = true;
            try {
                const r = await postPayroll(m);
                say(`رُحّلت رواتب ${m}: ${r && r.total !== undefined ? r.total : ''}`);
                await reload();
            } catch (e) {say((e && e.message) || 'تعذر الترحيل');} finally {busy = false;}
            return;
        }
        const pc = event.target.closest('[data-v2-pclose]');
        if (pc) {openPeriodCloseForm(pc.dataset.v2Pclose); return;}
        if (event.target.closest('[data-v2-pform-x]')) {
            const h = q('[data-v2-pform]');
            if (h) {h.innerHTML = '';}
            return;
        }
        const pgo = event.target.closest('[data-v2-pclose-go]');
        if (pgo) {
            const period = pgo.dataset.v2PcloseGo;
            if (!await confirmFn(`تأكيد قفل ${period} — لن يُقبل أي قيد عليها بعد الآن؟`)) {return;}
            try {
                await closePeriod(period, miniVal('[data-v2-pnote]'));
                say(`أُقفلت ${period}`);
                await loadPeriods();
            } catch (e) {say((e && e.message) || 'تعذر القفل');}
            return;
        }
        const po = event.target.closest('[data-v2-popen]');
        if (po) {
            const period = po.dataset.v2Popen;
            if (!await confirmFn(`إعادة فتح ${period}؟ سيُسجل اسمك على هذا الإجراء.`)) {return;}
            try {
                await openPeriod(period);
                say(`أُعيد فتح ${period}`);
                await loadPeriods();
            } catch (e) {say((e && e.message) || 'تعذر الفتح');}
            return;
        }
        const sc = event.target.closest('[data-v2-shift-close]');
        if (sc) {
            const id = sc.dataset.v2ShiftClose;
            const v = parseFloat(q(`[data-v2-shift-actual="${id}"]`)?.value);
            if (!Number.isFinite(v) || v < 0) {say(`أدخل الجرد الفعلي للوردية #${id}`); return;}
            if (!await confirmFn(`إغلاق الوردية #${id} عن بُعد بالجرد ${v}؟`)) {return;}
            try {
                const r = await closeShiftRemote(id, v);
                say(`أُغلقت #${id} — الفرق ${r && r.cash_variance !== undefined ? r.cash_variance : ''}`);
                await loadShifts();
            } catch (e) {say((e && e.message) || 'تعذر الإغلاق');}
            return;
        }
        if (event.target.closest('[data-v2-dayclose]')) {
            if (!await confirmFn('تنفيذ الإقفال اليومي Z ليوم العمل الحالي؟')) {return;}
            try {
                const st = await dayCloseStatus();
                if (st.existing_z) {say(`اليوم مقفل مسبقًا (${st.existing_z.z_number})`); return;}
                if ((st.open || []).length) {say(`أغلق ${st.open.length} وردية مفتوحة أولًا من الجدول أعلاه`); await loadShifts(); return;}
                const r = await execDayClose(st.today);
                say(`تم الإقفال ${r.z.z_number} — الفرق ${r.z.total_variance}`);
            } catch (e) {say((e && e.message) || 'فشل الإقفال');}
            return;
        }
        if (event.target.closest('[data-v2-bank-match]')) {
            try {
                const r = await autoMatchBank('1010');
                say(`طُابق ${r.matched} من ${r.scanned}`);
                await loadGrowth('bank');
            } catch (e) {say((e && e.message) || 'تعذر المطابقة');}
            return;
        }
        if (event.target.closest('[data-v2-bank-add]')) {
            miniForm('[data-v2-bank-form]',
                `<input class="erp-input erp-input--ltr" data-mf="date" type="date" value="${isoDay(0)}" aria-label="التاريخ">`
                + `<input class="erp-input erp-input--ltr" data-mf="amount" type="number" step="0.01" placeholder="المبلغ (موجب داخل/سالب خارج)" aria-label="المبلغ">`
                + `<input class="erp-input" data-mf="desc" placeholder="البيان" aria-label="البيان">`,
                'bank-add', 'إضافة');
            return;
        }
        if (event.target.closest('[data-v2-asset-add]')) {
            miniForm('[data-v2-asset-form]',
                `<input class="erp-input" data-mf="name" placeholder="اسم الأصل" aria-label="اسم الأصل">`
                + `<input class="erp-input erp-input--ltr" data-mf="cost" type="number" step="0.01" min="0" placeholder="التكلفة" aria-label="التكلفة">`
                + `<input class="erp-input erp-input--ltr" data-mf="life" type="number" step="1" min="1" value="60" placeholder="العمر بالشهور" aria-label="العمر بالشهور">`,
                'asset-add', 'تسجيل');
            return;
        }
        if (event.target.closest('[data-v2-dep-run]')) {
            if (!await confirmFn('ترحيل الإهلاك الشهري (6600 / 1520)؟')) {return;}
            try {
                const r = await runDepreciation();
                say(r.total > 0 ? `رُحل إهلاك ${r.month}: ${formatMoney(r.total, currency).amount} (${r.posted} أصل)` : 'لا أصول مستحقة هذا الشهر');
                await loadGrowth('assets');
            } catch (e) {say((e && e.message) || 'تعذر الترحيل');}
            return;
        }
        const ad = event.target.closest('[data-v2-asset-dispose]');
        if (ad) {
            if (!await confirmFn('استبعاد هذا الأصل نهائيًا؟')) {return;}
            try {
                await disposeAsset(ad.dataset.v2AssetDispose);
                say('استُبعد الأصل');
                await loadGrowth('assets');
            } catch (e) {say((e && e.message) || 'تعذر الاستبعاد');}
            return;
        }
        if (event.target.closest('[data-v2-custody-hand]')) {
            miniForm('[data-v2-custody-form]',
                `<input class="erp-input erp-input--ltr" data-mf="to" type="number" min="1" step="1" placeholder="رقم المستخدم المستلم (ID)" aria-label="المستلم">`
                + `<input class="erp-input erp-input--ltr" data-mf="amount" type="number" step="0.01" min="0" placeholder="المبلغ" aria-label="المبلغ">`,
                'custody-hand', 'تسليم');
            return;
        }
        if (event.target.closest('[data-v2-custody-ack]')) {
            const id = miniVal('[data-v2-custody-ack-id]');
            if (!id) {say('أدخل رقم العهدة'); return;}
            try {
                await ackCustody(id);
                say('تم إقرار الاستلام ✓');
                await loadGrowth('custody');
            } catch (e) {say((e && e.message) || 'تعذر الإقرار');}
            return;
        }
        if (event.target.closest('[data-v2-budget-add]')) {
            miniForm('[data-v2-budget-form]',
                `<input class="erp-input" data-mf="label" placeholder="اسم البند (مثال: الرواتب)" aria-label="اسم البند">`
                + `<input class="erp-input erp-input--ltr" data-mf="code" placeholder="كود الحساب — فارغ لسقف عام" aria-label="كود الحساب">`
                + `<input class="erp-input erp-input--ltr" data-mf="amount" type="number" step="0.01" min="0" placeholder="المبلغ الشهري" aria-label="المبلغ الشهري">`,
                'budget-add', 'إضافة');
            return;
        }
        const bd = event.target.closest('[data-v2-budget-del]');
        if (bd) {
            if (!await confirmFn('حذف هذه الموازنة؟')) {return;}
            try {
                await deleteBudget(bd.dataset.v2BudgetDel);
                say('حُذفت');
                await loadGrowth('budgets');
            } catch (e) {say((e && e.message) || 'تعذر الحذف');}
            return;
        }
        if (event.target.closest('[data-v2-alerts-run]')) {
            try {
                const r = await runAlerts();
                say((r.sent && r.sent.length) ? `أُرسل ${r.sent.length} تنبيه` : 'لا جديد — كل القواعد سليمة ✓');
                await loadGrowth('alerts');
            } catch (e) {say((e && e.message) || 'تعذر الفحص');}
            return;
        }
        if (event.target.closest('[data-v2-mini-x]')) {
            const h = event.target.closest('[data-v2-bank-form], [data-v2-asset-form], [data-v2-custody-form], [data-v2-budget-form]');
            if (h) {h.innerHTML = '';}
            return;
        }
        const go = event.target.closest('[data-v2-mini-go]');
        if (go) {
            const mf = (n) => el.querySelector(`[data-mf="${n}"]`)?.value ?? '';
            if (go.dataset.v2MiniGo === 'bank-add') {
                const amt = parseFloat(mf('amount'));
                if (!mf('date') || !Number.isFinite(amt) || amt === 0) {miniMsg('مبلغ غير صالح'); return;}
                try {
                    await addBankStatement([{ account_code: '1010', stmt_date: mf('date'), amount: amt, description: mf('desc') }]);
                    say('أُضيف سطر الكشف');
                    await loadGrowth('bank');
                } catch (e) {miniMsg((e && e.message) || 'تعذر الإضافة');}
            } else if (go.dataset.v2MiniGo === 'asset-add') {
                const cost = parseFloat(mf('cost'));
                const life = parseInt(mf('life'), 10);
                if (!mf('name').trim()) {miniMsg('أدخل اسم الأصل'); return;}
                if (!Number.isFinite(cost) || cost <= 0) {miniMsg('تكلفة غير صالحة'); return;}
                if (!Number.isInteger(life) || life <= 0) {miniMsg('عمر غير صالح'); return;}
                try {
                    await createAsset({ name: mf('name').trim(), cost, life_months: life });
                    say('سُجل الأصل');
                    await loadGrowth('assets');
                } catch (e) {miniMsg((e && e.message) || 'تعذر التسجيل');}
            } else if (go.dataset.v2MiniGo === 'custody-hand') {
                const amt = parseFloat(mf('amount'));
                if (!mf('to') || !Number.isFinite(amt) || amt <= 0) {miniMsg('مبلغ غير صالح'); return;}
                try {
                    await handCustody(Number(mf('to')), amt);
                    say('سُلمت العهدة بانتظار الإقرار');
                    await loadGrowth('custody');
                } catch (e) {miniMsg((e && e.message) || 'تعذر التسليم');}
            } else if (go.dataset.v2MiniGo === 'budget-add') {
                const amt = parseFloat(mf('amount'));
                if (!mf('label').trim()) {miniMsg('أدخل اسم البند'); return;}
                if (!Number.isFinite(amt) || amt < 0) {miniMsg('مبلغ غير صالح'); return;}
                try {
                    await createBudget({ period: stmtPeriod(), label: mf('label').trim(), account_code: mf('code').trim() || null, amount: amt });
                    say('أُضيفت الموازنة');
                    await loadGrowth('budgets');
                } catch (e) {miniMsg((e && e.message) || 'تعذر الإضافة');}
            }
        }
    });

    reload();

    return {
        el,
        reload,
        destroy() {
            tbTable.destroy();
            journalTable.destroy();
            el.remove();
        },
    };
}
