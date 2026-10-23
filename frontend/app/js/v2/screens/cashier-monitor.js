/**
 * V2 — Cashier-monitor screen · متابعة الكاشير للمالك (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * قراءة مباشرة من Oracle عبر أبواب GET القائمة: الكاشيرات 1/3/4/5/9،
 * فواتير اليوم بترقيم خادمي، تفاصيل الفاتورة، طباعة التقرير وExcel.
 * التحديث كل 10 ثوانٍ، بلا كتابة لبيانات يارا سوفت.
 *
 * World-class deltas (no behavior change): KPI strip + EnterpriseDataTable
 * styling + Latin digits (en-US, per Arabic UX rule — legacy printed ar-EG
 * digits) + delegation-safe print buttons.
 */

import { formatInt, formatQty } from '../data/reports-repo.js?v=4.9.131';
import { openInAppReport } from '../report-viewer.js?v=4.9.131';
import { ensureXlsx } from '../vendor.js?v=4.9.131';
import { prepareReportWorkbook } from '../report-export.js?v=4.9.131';
import { fetchYaraCashierItems, fetchYaraInvoiceDetail } from '../data/reports-extra.js?v=4.9.131';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const LIMIT = 50;
const LIVE_MS = 10_000;
const CASHIER_NOS = ['1', '3', '4', '5', '9'];

function riyadhToday() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());
}

function fD(v) {
    return v ? new Date(`${v}T12:00:00`).toLocaleDateString('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

function clock(d) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) {return '—';}
    const p = (n) => String(n).padStart(2, '0');
    return `${p(x.getHours())}:${p(x.getMinutes())}:${p(x.getSeconds())}`;
}

function kpiStrip(kpis) {
    return `<ul class="erp-kpis" aria-label="إجماليات الكاشيرية">`
        + kpis.map((k) => `
      <li class="erp-kpi">
        <div class="erp-kpi__top">
          <span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="${esc(k.icon)}"></i></span>
          <span class="erp-kpi__label">${esc(k.label)}<span class="erp-eyebrow" dir="ltr" lang="en">${esc(k.en)}</span></span>
        </div>
        <div class="erp-kpi__value"${k.color ? ` style="color:${k.color}"` : ''}>${k.html}</div>
        <div class="erp-kpi__foot"><span class="erp-kpi__hint">${esc(k.hint)}</span></div>
      </li>`).join('')
        + `</ul>`;
}

function template() {
    return `
      <div class="erp-v2-cm">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">متابعة الكاشير
              <span class="erp-eyebrow" dir="ltr" lang="en">Cashier Monitor</span>
              <span class="erp-badge" data-tone="success" data-v2-live-badge title="تحديث مباشر من قاعدة الكاشير كل 10 ثوانٍ">مباشر</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <span class="erp-text-sm erp-text-muted">آخر تحديث <b data-v2-stamp dir="ltr">—</b></span>
            <span data-v2-sync></span>
            <label class="erp-text-sm erp-text-muted" for="v2cm-date">التاريخ</label>
            <input class="erp-input erp-input--ltr" id="v2cm-date" type="date" value="${riyadhToday()}" data-v2-date>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-print>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة التقرير</span>
            </button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-excel>
              <i class="ji" data-i="inbox" aria-hidden="true"></i><span>Excel</span>
            </button>
          </div>
        </div>
        <div data-v2-kpis></div>
        <div data-v2-cards></div>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title" data-v2-orders-title>الأوردرات</h3>
          <span class="erp-grow"></span>
          <span data-v2-unfilter></span>
        </div><div class="erp-card__body erp-stack">
          <div data-v2-orders></div>
          <div class="erp-dash-controls"><span class="erp-text-sm erp-text-muted" data-v2-page></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-prev>السابق</button>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-next>التالي</button>
            <span class="erp-grow"></span>
            <span class="erp-text-sm erp-text-muted">اضغط على أي بطاقة كاشير لعزل فواتيره</span>
          </div>
          <div data-v2-order></div>
        </div></section>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountCashierMonitorScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 cashier-monitor]', m);

    let date = riyadhToday();
    let cashier = '';
    let summary = [];
    let orders = [];
    let total = 0;
    let offset = 0;
    let updatedAt = null;
    let loading = false;
    let reloadQueued = false;
    let loadError = '';
    let timer = null;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    function syncBadge() {
        const box = q('[data-v2-sync]');
        if (!box) {return;}
        box.innerHTML = loadError
            ? '<span class="erp-badge" data-tone="danger">تعذّرت القراءة الحية · آخر بيانات ناجحة معروضة</span>'
            : '<span class="erp-badge" data-tone="success">قراءة مباشرة من قاعدة الكاشير · للعرض فقط</span>';
    }

    function paint() {
        const liveBadge = q('[data-v2-live-badge]');
        if (liveBadge) {
            const isToday = date === riyadhToday();
            liveBadge.textContent = isToday ? 'مباشر' : 'تاريخ';
            liveBadge.dataset.tone = isToday ? 'success' : 'neutral';
            liveBadge.title = isToday ? 'تحديث مباشر من قاعدة الكاشير كل 10 ثوانٍ' : 'عرض تاريخي — لا يتم تحديثه تلقائيًا';
        }
        const invoices = summary.reduce((sum, c) => sum + Number(c.invoices || 0), 0);
        const revenue = summary.reduce((sum, c) => sum + Number(c.revenue || 0), 0);
        const discounts = summary.reduce((sum, c) => sum + Number(c.discount || 0), 0);
        q('[data-v2-kpis]').innerHTML = kpiStrip([
            { icon: 'receipt', label: 'إجمالي الفواتير', en: 'Invoices', html: `<span class="erp-num" dir="ltr">${formatInt(invoices)}</span>`, hint: `${formatInt(summary.length)} كاشير · من قاعدة الكاشير مباشرة` },
            { icon: 'banknote', label: 'صافي الإيراد', en: 'Net revenue', html: `<span class="erp-num" dir="ltr">${formatQty(revenue)}</span>`, color: 'var(--erp-success-text)', hint: `الفترة: ${esc(fD(date))}` },
            { icon: 'receipt', label: 'الخصومات', en: 'Discounts', html: `<span class="erp-num" dir="ltr">${formatQty(discounts)}</span>`, color: 'var(--erp-info-text)', hint: 'إجمالي الخصم المسجل' },
        ]);
        syncBadge();
        q('[data-v2-cards]').innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">` + summary.map((c) => `
          <button type="button" class="erp-card" style="cursor:pointer;min-width:210px;flex:1;text-align:start;padding:12px 14px;${String(cashier) === String(c.cashier_no) ? 'border:2px solid var(--erp-brand-text);' : ''}" data-v2-cashier="${esc(String(c.cashier_no))}" aria-pressed="${String(cashier) === String(c.cashier_no)}">
            <div class="erp-text-sm erp-text-muted">كاشير ${esc(String(c.cashier_no))} ${String(cashier) === String(c.cashier_no) ? '✓' : ''}</div>
            <div style="font-size:20px;font-weight:800" class="erp-num" dir="ltr">${formatQty(c.revenue)}</div>
            <div class="erp-text-sm erp-text-muted">${esc(c.name || '')}<br>${formatInt(c.invoices)} فاتورة · متوسط ${formatQty(c.avg)}<br>
            الخصومات: ${formatQty(c.discount)}</div>
          </button>`).join('') + `</div>`;
        const pages = Math.max(1, Math.ceil(total / LIMIT));
        const page = Math.floor(offset / LIMIT) + 1;
        q('[data-v2-orders-title]').textContent = `فواتير ${cashier ? `كاشير ${cashier}` : 'الكاشيرية المحددة'} — ${formatInt(total)} فاتورة`;
        q('[data-v2-unfilter]').innerHTML = cashier ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-unfilter-btn>إلغاء الفلتر</button>' : '';
        const rows = orders.map((o) => `<tr data-v2-order-row="${esc(String(o.doc_no))}" style="cursor:pointer">`
            + `<td class="erp-td erp-mono" dir="ltr"><b>${esc(String(o.doc_no))}</b></td>`
            + `<td class="erp-td"><span class="erp-badge" data-tone="info">كاشير ${esc(String(o.cashier_no))}</span></td>`
            + `<td class="erp-td erp-mono" dir="ltr">${esc(String(o.time || '').slice(0, 8) || String(o.day || '').slice(0, 10))}</td>`
            + `<td class="erp-td">${esc(o.shift || '—')}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.net)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.total)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.paid)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatInt(o.lines || 0)}</td></tr>`).join('');
        q('[data-v2-orders]').innerHTML = `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr>`
            + `<th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الوردية</th><th>الصافي</th><th>الإجمالي</th><th>المدفوع</th><th>الأصناف</th>`
            + `</tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="8">لا توجد فواتير في هذا اليوم</td></tr>'}</tbody></table></div>`;
        q('[data-v2-page]').textContent = `صفحة ${formatInt(page)} من ${formatInt(pages)}`;
        q('[data-v2-prev]').disabled = page <= 1;
        q('[data-v2-next]').disabled = page >= pages;
        const stamp = q('[data-v2-stamp]');
        if (stamp && updatedAt) {stamp.textContent = clock(updatedAt);}
    }

    async function load(live = false) {
        if (loading) {reloadQueued = true; return;}
        loading = true;
        const requestedDate = date;
        const requestedCashier = cashier;
        const requestedOffset = offset;
        try {
            const baseParams = {
                from: requestedDate,
                to: requestedDate,
                view: 'invoices',
                cashiers: CASHIER_NOS,
                limit: LIMIT,
                live: requestedDate === riyadhToday(),
            };
            let summaryResult;
            let pageResult;
            if (requestedCashier) {
                [summaryResult, pageResult] = await Promise.all([
                    fetchYaraCashierItems({...baseParams, limit: 10, summaryOnly: true}),
                    fetchYaraCashierItems({
                        from: requestedDate, to: requestedDate, view: 'invoices',
                        cashier: requestedCashier, limit: LIMIT,
                        page: Math.floor(requestedOffset / LIMIT) + 1,
                        live: requestedDate === riyadhToday(),
                    }),
                ]);
            } else {
                summaryResult = await fetchYaraCashierItems({
                    ...baseParams, page: Math.floor(requestedOffset / LIMIT) + 1,
                });
                pageResult = summaryResult;
            }
            if (!el.isConnected || requestedDate !== date || requestedCashier !== cashier || requestedOffset !== offset) {return;}
            const byCashier = new Map(summaryResult.cashiers
                .filter((c) => CASHIER_NOS.includes(String(c.no)))
                .map((c) => [String(c.no), c]));
            summary = CASHIER_NOS.map((no) => {
                const c = byCashier.get(no) || {};
                const invoices = Number(c.invoices) || 0;
                const revenue = Number(c.net) || 0;
                return {
                    cashier_no: no, name: c.name || '',
                    invoices, revenue, discount: Number(c.discount) || 0,
                    avg: invoices ? revenue / invoices : 0,
                };
            });
            orders = pageResult.rows;
            total = pageResult.total;
            updatedAt = new Date();
            loadError = '';
            if (noteEl) {noteEl.textContent = '';}
            paint();
        } catch (e) {
            if (!el.isConnected || requestedDate !== date || requestedCashier !== cashier || requestedOffset !== offset) {return;}
            const message = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لمتابعة الكاشير بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر قراءة قاعدة الكاشير: ${(e && e.message) || 'خطأ'}`);
            loadError = message;
            syncBadge();
            if (live) {
                if (noteEl) {noteEl.textContent = `${message} آخر قراءة ناجحة: ${updatedAt ? clock(updatedAt) : 'لا توجد'}`;}
            } else {
                say(message);
            }
        } finally {
            loading = false;
            if (reloadQueued && el.isConnected) {
                reloadQueued = false;
                void load(false);
            }
        }
    }

    async function liveTick() {
        if (!el.isConnected) {stopLive(); return;}
        if (loading || date !== riyadhToday()) {return;}
        await load(true);
    }

    function stopLive() {
        if (timer) {clearInterval(timer); timer = null;}
    }

    function startLive() {
        stopLive();
        timer = setInterval(liveTick, LIVE_MS);
    }

    async function openOrder(docNo) {
        const box = q('[data-v2-order]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ جلب تفاصيل الفاتورة…</p>';
        try {
            const detail = await fetchYaraInvoiceDetail(docNo);
            if (!el.isConnected) {return;}
            const header = detail.header || {};
            const value = (key) => header[key] ?? header[key.toUpperCase()] ?? '';
            if (!Object.keys(header).length) {throw new Error('لم يتم العثور على الفاتورة في قاعدة الكاشير');}
            const lines = detail.lines.map((l, i) => `<tr><td class="erp-td erp-num">${formatInt(i + 1)}</td>`
                + `<td class="erp-td">${esc(l.name || '—')}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.qty)}</td>`
                + `<td class="erp-td erp-num">${esc(l.unit || '—')}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.price)}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.discount)}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.total)}</td></tr>`).join('');
            box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
                + `<h3 class="erp-card__title">فاتورة <span class="erp-mono" dir="ltr">${esc(String(value('DOC_NO') || docNo))}</span> — كاشير ${esc(String(value('CSHR') || '—'))}</h3>`
                + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-order-x>إغلاق</button></div>`
                + `<div class="erp-card__body erp-stack">`
                + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>التاريخ</th><th>الوردية</th><th>الإجمالي</th><th>الصافي</th><th>الخصم</th><th>المدفوع</th></tr></thead>`
                + `<tbody><tr><td class="erp-td erp-mono" dir="ltr">${esc(String(value('DOC_DATE') || '').slice(0, 10))}</td><td class="erp-td">${esc(String(value('SHFT_NO') || '—'))}</td>`
                + `<td class="erp-td erp-num">${formatQty(value('TOTAL_VAL'))}</td><td class="erp-td erp-num">${formatQty(value('NET_VAL'))}</td>`
                + `<td class="erp-td erp-num">${formatQty(value('DSCNT_VL'))}</td><td class="erp-td erp-num">${formatQty(value('PAYED'))}</td></tr></tbody></table></div>`
                + (lines ? `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>السعر</th><th>الخصم</th><th>الإجمالي</th></tr></thead><tbody>${lines}</tbody></table></div>`
                    : '<p class="erp-text-sm erp-text-muted">لا توجد تفاصيل أصناف لهذه الفاتورة في قاعدة الكاشير</p>')
                + `</div></section>`;
            box.scrollIntoView({ block: 'nearest' });
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">تعذر جلب الفاتورة: ${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function reportRows() {
        return summary.map((c) => ({
            cashier: c.cashier_no, invoices: Number(c.invoices || 0), revenue: Number(c.revenue || 0),
            discount: Number(c.discount || 0), avg: Number(c.avg || 0),
        }));
    }

    function printReport() {
        const rows = reportRows();
        const totN = rows.reduce((s, r) => s + r.invoices, 0);
        const totR = rows.reduce((s, r) => s + r.revenue, 0);
        const w = openInAppReport('تقرير إيرادات الكاشيرية');
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير إيرادات الكاشيرية — ${esc(date)}</title>`
            + `<style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#1a1a1a;direction:rtl}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:15px;margin-bottom:18px}`
            + `table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e}tfoot td{font-weight:800;background:#f3ecd9}`
            + `.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<h1>تقرير إيرادات الكاشيرية — ${esc(fD(date))}</h1><h2>مطاعم الشرفه العالمي · ${esc(new Date().toLocaleString('ar-EG'))}</h2>`
            + `<table><thead><tr><th>الكاشير</th><th>الفواتير</th><th>صافي الإيراد</th><th>الخصومات</th><th>متوسط الفاتورة</th></tr></thead><tbody>`
            + rows.map((r) => `<tr><td><b>كاشير ${esc(String(r.cashier))}</b></td><td>${formatInt(r.invoices)}</td><td>${formatQty(r.revenue)}</td><td>${formatQty(r.discount)}</td><td>${formatQty(r.avg)}</td></tr>`).join('')
            + `</tbody><tfoot><tr><td>الإجمالي (${formatInt(rows.length)} كاشير)</td><td>${formatInt(totN)}</td><td>${formatQty(totR)}</td><td colspan="2"></td></tr></tfoot></table></body></html>`);
        w.document.close();
        const bp = w.document.querySelector('[data-pl-print]');
        if (bp) {bp.addEventListener('click', () => w.print());}
        const bc = w.document.querySelector('[data-pl-close]');
        if (bc) {bc.addEventListener('click', () => w.close());}
        w.focus();
    }

    async function exportExcel() {
        // xlsx ليس محمَّلًا في v2.html (قرار السرعة في vendor.js) — يُجلب عند أول تصدير.
        const ready = await ensureXlsx();
        if (!ready || typeof window.XLSX === 'undefined') {say('مكتبة Excel غير محمّلة — حدّث الصفحة'); return;}
        const rows = reportRows();
        const data = [['الكاشير', 'الفواتير', 'صافي الإيراد', 'الخصومات', 'متوسط الفاتورة']];
        rows.forEach((r) => data.push([r.cashier, r.invoices, r.revenue, r.discount, r.avg]));
        const ws = window.XLSX.utils.aoa_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'الكاشيرية');
        prepareReportWorkbook(window.XLSX, wb, 'تقرير إيرادات الكاشيرية');
        window.XLSX.writeFile(wb, `cashiers_${date || 'report'}.xlsx`);
        say('اتصدّر ملف Excel');
    }

    async function reload() {
        offset = 0;
        await load(false);
    }

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-date]') && event.target.value) {
            date = event.target.value;
            offset = 0;
            summary = [];
            orders = [];
            total = 0;
            updatedAt = null;
            loadError = '';
            paint();
            load(false);
        }
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-print]')) {printReport(); return;}
        if (event.target.closest('[data-v2-excel]')) {exportExcel(); return;}
        if (event.target.closest('[data-v2-unfilter-btn]')) {cashier = ''; offset = 0; load(false); return;}
        if (event.target.closest('[data-v2-order-x]')) {q('[data-v2-order]').innerHTML = ''; return;}
        const cb = event.target.closest('[data-v2-cashier]');
        if (cb) {
            const no = String(cb.dataset.v2Cashier);
            cashier = (cashier === no) ? '' : no;
            offset = 0;
            load(false);
            return;
        }
        const prev = event.target.closest('[data-v2-prev]');
        if (prev && !prev.disabled) {
            const next = offset - LIMIT;
            if (next >= 0) {offset = next; load(false);}
            return;
        }
        const next = event.target.closest('[data-v2-next]');
        if (next && !next.disabled) {
            if (offset + LIMIT < Math.max(total, 1)) {offset += LIMIT; load(false);}
            return;
        }
        const row = event.target.closest('[data-v2-order-row]');
        if (row) {openOrder(row.dataset.v2OrderRow);}
    });

    load(false).then(() => { if (el.isConnected) {startLive();} });

    return {
        el, reload,
        destroy() {
            stopLive();
            el.remove();
        },
    };
}
