/**
 * V2 — Cashier-monitor screen · متابعة الكاشير للمالك (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of features/cashier-monitor.js (275 lines, read fully):
 * بطاقات الكاشيرية (نقر = فلتر) + أوردرات اليوم بترقيم خادمي + تفاصيل
 * فاتورة + طباعة تقرير + Excel + حلقة لايف 30 ثانية بمقارنة لقطة + ختم
 * حداثة المرآة (45 دقيقة). لا كتابة إطلاقًا — والخادم يحسم النطاق.
 *
 * World-class deltas (no behavior change): KPI strip + EnterpriseDataTable
 * styling + Latin digits (en-US, per Arabic UX rule — legacy printed ar-EG
 * digits) + delegation-safe print buttons. Socket hook mirrors legacy
 * (window.socket 'yarasoft:mirror' when present, released on destroy).
 */

import { formatInt, formatQty } from '../data/reports-repo.js?v=4.9.130';
import { ensureXlsx } from '../vendor.js?v=4.9.130';
import {
    mirrorToday, fetchMonitorSummary, fetchMonitorOrders, fetchMonitorOrder,
    summarizeCashiers, mirrorFreshness,
} from '../data/cashier-monitor-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const LIMIT = 50;
const LIVE_MS = 30_000;

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
              <span class="erp-badge" data-tone="success" title="البيانات تتحدث تلقائيًا كل 30 ثانية">مباشر</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <span class="erp-text-sm erp-text-muted">آخر تحديث <b data-v2-stamp dir="ltr">—</b></span>
            <span data-v2-sync></span>
            <label class="erp-text-sm erp-text-muted" for="v2cm-date">اليوم</label>
            <input class="erp-input erp-input--ltr" id="v2cm-date" type="date" value="${mirrorToday()}" data-v2-date>
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

    let date = mirrorToday();
    let cashier = '';
    let summary = [];
    let orders = [];
    let total = 0;
    let offset = 0;
    let updatedAt = null;
    let lastSnap = null;
    let loading = false;
    let timer = null;
    let socketHandler = null;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    function syncBadge() {
        const f = mirrorFreshness(summary);
        const box = q('[data-v2-sync]');
        if (!box) {return;}
        if (f.state === 'none') {box.innerHTML = '<span class="erp-badge" data-tone="danger">لا توجد مزامنة بعد</span>';}
        else if (f.state === 'stale') {box.innerHTML = `<span class="erp-badge" data-tone="danger">المرآة متوقفة منذ ${formatInt(f.ageMin)} دقيقة — تأكد أن جهاز يارسوفت يعمل</span>`;}
        else {box.innerHTML = `<span class="erp-badge" data-tone="success">مزامنة حية (منذ ${formatInt(f.ageMin)} دقيقة)</span>`;}
    }

    function paint() {
        const t = summarizeCashiers(summary);
        q('[data-v2-kpis]').innerHTML = kpiStrip([
            { icon: 'receipt', label: 'إجمالي الفواتير', en: 'Invoices', html: `<span class="erp-num" dir="ltr">${formatInt(t.invoices)}</span>`, hint: `${formatInt(summary.length)} كاشير في المرآة` },
            { icon: 'banknote', label: 'الإيراد (شامل الضريبة)', en: 'Revenue', html: `<span class="erp-num" dir="ltr">${formatQty(t.revenue)}</span>`, color: 'var(--erp-success-text)', hint: `قبل الضريبة: ${formatQty(t.revenueEx)}` },
            { icon: 'wallet', label: 'نقدًا', en: 'Cash', html: `<span class="erp-num" dir="ltr">${formatQty(t.cash)}</span>`, color: 'var(--erp-info-text)', hint: 'مدفوعات نقدية' },
            { icon: 'credit-card', label: 'شبكة/محفظة', en: 'Network', html: `<span class="erp-num" dir="ltr">${formatQty(t.network)}</span>`, color: 'var(--erp-brand-text)', hint: 'مدفوعات شبكية' },
        ]);
        syncBadge();
        q('[data-v2-cards]').innerHTML = `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0">` + summary.map((c) => `
          <button type="button" class="erp-card" style="cursor:pointer;min-width:210px;flex:1;text-align:start;padding:12px 14px;${String(cashier) === String(c.cashier_no) ? 'border:2px solid var(--erp-brand-text);' : ''}" data-v2-cashier="${esc(String(c.cashier_no))}" aria-pressed="${String(cashier) === String(c.cashier_no)}">
            <div class="erp-text-sm erp-text-muted">كاشير ${esc(String(c.cashier_no))} ${String(cashier) === String(c.cashier_no) ? '✓' : ''}</div>
            <div style="font-size:20px;font-weight:800" class="erp-num" dir="ltr">${formatQty(c.revenue)}</div>
            <div class="erp-text-sm erp-text-muted">${formatInt(c.invoices)} فاتورة · متوسط ${formatQty(c.avg)}<br>
            قبل الضريبة: ${formatQty(c.revenue_ex_vat)}<br>
            نقدًا ${formatQty(c.pay_cash)} · شبكة ${formatQty(c.pay_network)}<br>
            آخر فاتورة: ${esc(String(c.last_time || '—').slice(0, 5))}</div>
          </button>`).join('') + `</div>`;
        const pages = Math.max(1, Math.ceil(total / LIMIT));
        const page = Math.floor(offset / LIMIT) + 1;
        q('[data-v2-orders-title]').textContent = `أوردرات ${cashier ? `كاشير ${cashier}` : 'كل الكاشيرية'} — ${formatInt(total)} أوردر`;
        q('[data-v2-unfilter]').innerHTML = cashier ? '<button type="button" class="erp-btn erp-btn--sm" data-v2-unfilter-btn>إلغاء الفلتر</button>' : '';
        const rows = orders.map((o) => `<tr data-v2-order-row="${esc(String(o.doc_no))}" style="cursor:pointer">`
            + `<td class="erp-td erp-mono" dir="ltr"><b>${esc(String(o.doc_no))}</b></td>`
            + `<td class="erp-td"><span class="erp-badge" data-tone="info">كاشير ${esc(String(o.cashier_no))}</span></td>`
            + `<td class="erp-td erp-mono" dir="ltr">${esc(String(o.doc_time || '').slice(0, 5))}</td>`
            + `<td class="erp-td">${esc(o.shift_no || '—')}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.net)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.total)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatQty(o.payed)}</td>`
            + `<td class="erp-td erp-num" dir="ltr">${formatInt(o.lines_count)}</td>`
            + `<td class="erp-td erp-text-muted">${esc(o.zone_name || '—')}</td></tr>`).join('');
        q('[data-v2-orders]').innerHTML = `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr>`
            + `<th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الوردية</th><th>شامل الضريبة</th><th>قبل الضريبة</th><th>مدفوع</th><th>الأصناف</th><th>المنطقة</th>`
            + `</tr></thead><tbody>${rows || '<tr><td class="erp-td" colspan="9">لا توجد أوردرات في هذا اليوم</td></tr>'}</tbody></table></div>`;
        q('[data-v2-page]').textContent = `صفحة ${formatInt(page)} من ${formatInt(pages)}`;
        q('[data-v2-prev]').disabled = page <= 1;
        q('[data-v2-next]').disabled = page >= pages;
        const stamp = q('[data-v2-stamp]');
        if (stamp && updatedAt) {stamp.textContent = clock(updatedAt);}
    }

    async function load(live = false) {
        if (loading) {return;}
        loading = true;
        try {
            const [s, o] = await Promise.all([
                fetchMonitorSummary(date, live && date === mirrorToday()),
                fetchMonitorOrders({ date, cashier, limit: LIMIT, offset }),
            ]);
            if (!el.isConnected) {return;}
            summary = s;
            orders = o.orders;
            total = o.total;
            updatedAt = new Date();
            paint();
            lastSnap = JSON.stringify([summary, orders]);
        } catch (e) {
            if (!el.isConnected) {return;}
            say(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لمتابعة الكاشير بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر تحميل البيانات: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    async function liveTick() {
        if (!el.isConnected) {stopLive(); return;}
        if (loading) {return;}
        try {
            const [s, o] = await Promise.all([
                fetchMonitorSummary(date, date === mirrorToday()),
                fetchMonitorOrders({ date, cashier, limit: LIMIT, offset }),
            ]);
            if (!el.isConnected) {return;}
            const snap = JSON.stringify([s, o.orders]);
            if (snap !== lastSnap) {
                summary = s;
                orders = o.orders;
                total = o.total;
                updatedAt = new Date();
                lastSnap = snap;
                paint();
                return;
            }
            updatedAt = new Date();
            const stamp = q('[data-v2-stamp]');
            if (stamp) {stamp.textContent = clock(updatedAt);}
        } catch { /* اللايف صامت — الخطأ يظهر عند التحديث اليدوي */ }
    }

    function stopLive() {
        if (timer) {clearInterval(timer); timer = null;}
        try {
            const s = typeof window !== 'undefined' ? window.socket : null;
            if (s && socketHandler && typeof s.off === 'function') {s.off('yarasoft:mirror', socketHandler);}
        } catch { /* no-op */ }
        socketHandler = null;
    }

    function startLive() {
        stopLive();
        timer = setInterval(liveTick, LIVE_MS);
        try {
            const s = typeof window !== 'undefined' ? window.socket : null;
            if (s && typeof s.on === 'function') {
                socketHandler = () => { if (el.isConnected) {liveTick();} };
                s.on('yarasoft:mirror', socketHandler);
            }
        } catch { /* no-op */ }
    }

    async function openOrder(docNo) {
        const box = q('[data-v2-order]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ جلب تفاصيل الفاتورة…</p>';
        try {
            const o = await fetchMonitorOrder(docNo);
            if (!el.isConnected) {return;}
            const lines = o.lines.map((l, i) => `<tr><td class="erp-td erp-num">${formatInt(i + 1)}</td>`
                + `<td class="erp-td">${esc(l.name || l.item || l.desc || '—')}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.qty || l.quantity || 0)}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.price || l.unit_price)}</td>`
                + `<td class="erp-td erp-num">${formatQty(l.total || l.amount)}</td></tr>`).join('');
            box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
                + `<h3 class="erp-card__title">فاتورة <span class="erp-mono" dir="ltr">${esc(String(o.doc_no))}</span> — كاشير ${esc(String(o.cashier_no))}</h3>`
                + `<span class="erp-grow"></span><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-order-x>إغلاق</button></div>`
                + `<div class="erp-card__body erp-stack">`
                + `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>الوقت</th><th>الوردية</th><th>الإجمالي</th><th>الصافي</th><th>الخصم</th><th>الضريبة</th><th>نقدًا</th><th>شبكة</th><th>مطبوع</th></tr></thead>`
                + `<tbody><tr><td class="erp-td erp-mono" dir="ltr">${esc(String(o.doc_time || '').slice(0, 5))}</td><td class="erp-td">${esc(o.shift_no || '—')}</td>`
                + `<td class="erp-td erp-num">${formatQty(o.total)}</td><td class="erp-td erp-num">${formatQty(o.net)}</td>`
                + `<td class="erp-td erp-num">${formatQty(o.discount)}</td><td class="erp-td erp-num">${formatQty(o.vat)}</td>`
                + `<td class="erp-td erp-num">${formatQty(o.pay_cash)}</td><td class="erp-td erp-num">${formatQty(o.pay_network)}</td>`
                + `<td class="erp-td">${o.printed ? 'نعم' : 'لا'}</td></tr></tbody></table></div>`
                + (lines ? `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${lines}</tbody></table></div>`
                    : '<p class="erp-text-sm erp-text-muted">لا سطور مفصلة لهذه الفاتورة في المرآة</p>')
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
            exVat: Number(c.revenue_ex_vat || 0), avg: Number(c.avg || 0),
            cash: Number(c.pay_cash || 0), network: Number(c.pay_network || 0),
            last: c.last_time || '—',
        }));
    }

    function printReport() {
        const rows = reportRows();
        const totN = rows.reduce((s, r) => s + r.invoices, 0);
        const totR = rows.reduce((s, r) => s + r.revenue, 0);
        const w = window.open('', '_blank');
        if (!w) {say('اسمح بالنوافذ المنبثقة للطباعة'); return;}
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير إيرادات الكاشيرية — ${esc(date)}</title>`
            + `<style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#1a1a1a;direction:rtl}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:15px;margin-bottom:18px}`
            + `table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e}tfoot td{font-weight:800;background:#f3ecd9}`
            + `.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<h1>تقرير إيرادات الكاشيرية — ${esc(fD(date))}</h1><h2>مطاعم الشرفه العالمي · ${esc(new Date().toLocaleString('ar-EG'))}</h2>`
            + `<table><thead><tr><th>الكاشير</th><th>الفواتير</th><th>الإيراد (شامل)</th><th>قبل الضريبة</th><th>المتوسط</th><th>نقدًا</th><th>شبكة</th><th>آخر فاتورة</th></tr></thead><tbody>`
            + rows.map((r) => `<tr><td><b>كاشير ${esc(String(r.cashier))}</b></td><td>${formatInt(r.invoices)}</td><td>${formatQty(r.revenue)}</td><td>${formatQty(r.exVat)}</td><td>${formatQty(r.avg)}</td><td>${formatQty(r.cash)}</td><td>${formatQty(r.network)}</td><td dir="ltr">${esc(String(r.last))}</td></tr>`).join('')
            + `</tbody><tfoot><tr><td>الإجمالي (${formatInt(rows.length)} كاشير)</td><td>${formatInt(totN)}</td><td>${formatQty(totR)}</td><td colspan="5"></td></tr></tfoot></table></body></html>`);
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
        const data = [['الكاشير', 'الفواتير', 'الإيراد شامل', 'قبل الضريبة', 'المتوسط', 'نقدًا', 'شبكة', 'آخر فاتورة']];
        rows.forEach((r) => data.push([r.cashier, r.invoices, r.revenue, r.exVat, r.avg, r.cash, r.network, r.last]));
        const ws = window.XLSX.utils.aoa_to_sheet(data);
        const wb = window.XLSX.utils.book_new();
        window.XLSX.utils.book_append_sheet(wb, ws, 'الكاشيرية');
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
