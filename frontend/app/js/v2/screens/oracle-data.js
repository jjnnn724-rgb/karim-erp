/**
 * V2 — Oracle data screen · بيانات Oracle المنسوخة (قراءة + مزامنة)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of renderOracleDataPage/oraData* (whatsapp.js:362-508):
 * قائمة الجداول + بحث محلي + تفاصيل جدول (بحث خادمي + ترقيم 50) + طباعة
 * + مزامنة. نفس المسارات والحمولات — والخادم يحسم الصلاحية.
 */

import { formatInt } from '../data/reports-repo.js?v=4.9.130';
import { fetchOraTables, refreshOraTables, fetchOraTable } from '../data/oracle-repo.js?v=4.9.130';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function template() {
    return `
      <div class="erp-v2-ora">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">بيانات Oracle المنسوخة
              <span class="erp-eyebrow" dir="ltr" lang="en">Oracle Data</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <span class="erp-text-sm erp-text-muted" data-v2-stamp></span>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-sync>
              <i class="ji" data-i="database" aria-hidden="true"></i><span>مزامنة</span>
            </button>
          </div>
        </div>
        <div data-v2-kpis></div>
        <section class="erp-card"><div class="erp-card__head">
          <h3 class="erp-card__title">الجداول</h3><span class="erp-grow"></span>
          <input class="erp-input" data-v2-search placeholder="بحث في اسم الجدول..." aria-label="بحث في اسم الجدول" style="max-width:280px">
        </div><div class="erp-card__body erp-stack"><div data-v2-tables></div></div></section>
        <div data-v2-detail></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountOracleDataScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 oracle-data]', m);

    let tables = [];
    let loading = false;
    let syncing = false;
    let filter = '';
    let detail = { name: '', page: 1, search: '', data: null };

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    function paintTables() {
        const list = tables.filter((t) => String(t.oracle_name || '').toLowerCase().includes(filter));
        const totalRows = tables.reduce((s, t) => s + (Number(t.live_count) || 0), 0);
        q('[data-v2-kpis]').innerHTML = `<ul class="erp-kpis">`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">جدول</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(tables.length)}</span></div></li>`
            + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">صف إجمالًا</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(totalRows)}</span></div></li>`
            + `</ul>`;
        q('[data-v2-tables]').innerHTML = `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>الجدول (Oracle)</th><th>الجدول (karim)</th><th>الصفوف</th><th></th></tr></thead><tbody>`
            + (list.map((t) => `<tr><td class="erp-td"><b>${esc(t.oracle_name || '')}</b></td>`
                + `<td class="erp-td erp-mono" dir="ltr">${esc(t.pg_name || '')}</td>`
                + `<td class="erp-td"><span class="erp-badge" data-tone="info">${formatInt(t.live_count || 0)}</span></td>`
                + `<td class="erp-td"><button type="button" class="erp-btn erp-btn--sm" data-v2-open="${esc(t.pg_name || '')}"><i class="ji" data-i="eye" aria-hidden="true"></i><span>عرض</span></button></td></tr>`).join('')
                || '<tr><td class="erp-td" colspan="4">لا جداول مطابقة</td></tr>')
            + `</tbody></table></div>`;
    }

    function paintDetail() {
        const box = q('[data-v2-detail]');
        const d = detail.data;
        if (!detail.name) {box.innerHTML = ''; return;}
        if (!d) {box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>'; return;}
        const cols = d.columns || [];
        box.innerHTML = `<section class="erp-card"><div class="erp-card__head">`
            + `<h3 class="erp-card__title"><span class="erp-mono" dir="ltr">${esc(d.table || '')}</span></h3><span class="erp-grow"></span>`
            + `<span class="erp-text-sm erp-text-muted">${formatInt(d.total)} صف — صفحة ${formatInt(d.page)}/${formatInt(d.totalPages)}</span>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-print><i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة</span></button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-detail-x>إغلاق</button></div>`
            + `<div class="erp-card__body erp-stack">`
            + `<div class="erp-dash-controls"><input class="erp-input" data-v2-dsearch value="${esc(detail.search)}" placeholder="بحث..." aria-label="بحث داخل الجدول" style="max-width:400px">`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-dgo>بحث</button></div>`
            + `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>`
            + (d.rows.map((row) => `<tr>${cols.map((c) => `<td class="erp-td" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(String(row[c] ?? ''))}">${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('')
                || `<tr><td class="erp-td" colspan="${Math.max(cols.length, 1)}">لا صفوف</td></tr>`)
            + `</tbody></table></div>`
            + (d.totalPages > 1 ? `<div class="erp-dash-controls">`
                + (d.page > 1 ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-dprev>السابق</button>` : '')
                + `<span class="erp-text-sm erp-text-muted">صفحة ${formatInt(d.page)} من ${formatInt(d.totalPages)}</span>`
                + (d.page < d.totalPages ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-dnext>التالي</button>` : '')
                + `</div>` : '')
            + `</div></section>`;
        box.scrollIntoView({ block: 'nearest' });
    }

    async function openDetail(name, page = 1, search = '') {
        detail = { name, page, search, data: null };
        paintDetail();
        try {
            const d = await fetchOraTable(name, { page, limit: 50, search });
            if (!el.isConnected || detail.name !== name) {return;}
            detail.data = d;
            detail.page = d.page;
            paintDetail();
        } catch (e) {
            if (!el.isConnected || detail.name !== name) {return;}
            q('[data-v2-detail]').innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'خطأ')}</p>`;
        }
    }

    function printDetail() {
        const d = detail.data;
        if (!d) {return;}
        const cols = d.columns || [];
        const rows = d.rows.map((row) => `<tr>${cols.map((c) => `<td>${esc(String(row[c] ?? ''))}</td>`).join('')}</tr>`).join('');
        const w = window.open('', '_blank');
        if (!w) {say('اسمح بالنوافذ المنبثقة للطباعة'); return;}
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>جدول ${esc(d.table || '')}</title>`
            + `<style>body{font-family:'Cairo',Tahoma,sans-serif;padding:28px;direction:rtl}table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #999;padding:6px;text-align:right}th{background:#f4ead2}`
            + `.controls{text-align:center;margin-bottom:14px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}`
            + `@media print{.controls{display:none}body{padding:0}}</style></head><body>`
            + `<div class="controls"><button type="button" class="btn-print" data-pl-print>طباعة</button><button type="button" class="btn-close" data-pl-close>إغلاق</button></div>`
            + `<h3>جدول ${esc(d.table || '')}</h3><p>${formatInt(d.total)} صف — صفحة ${d.page} من ${d.totalPages}${detail.search ? ` — بحث: ${esc(detail.search)}` : ''}</p>`
            + `<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></body></html>`);
        w.document.close();
        const bp = w.document.querySelector('[data-pl-print]');
        if (bp) {bp.addEventListener('click', () => w.print());}
        const bc = w.document.querySelector('[data-pl-close]');
        if (bc) {bc.addEventListener('click', () => w.close());}
        w.focus();
    }

    async function reload() {
        if (loading) {return;}
        loading = true;
        try {
            tables = await fetchOraTables();
            if (!el.isConnected) {return;}
            paintTables();
            const stamp = q('[data-v2-stamp]');
            if (stamp) {stamp.textContent = `آخر تحديث: ${new Date().toLocaleString('ar-EG')}`;}
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'خطأ');
        } finally {
            loading = false;
        }
    }

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-search]')) {
            filter = String(event.target.value || '').toLowerCase();
            paintTables();
        }
    });

    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.target.matches('[data-v2-dsearch]')) {
            openDetail(detail.name, 1, event.target.value);
        }
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-sync]')) {
            if (syncing) {return;}
            syncing = true;
            say('جارٍ المزامنة…');
            refreshOraTables().then(() => {
                if (!el.isConnected) {return;}
                say('تمت المزامنة');
                reload();
            }).catch((e) => {
                if (!el.isConnected) {return;}
                say((e && e.message) || 'خطأ');
            }).finally(() => {syncing = false;});
            return;
        }
        const op = event.target.closest('[data-v2-open]');
        if (op) {openDetail(op.dataset.v2Open, 1, ''); return;}
        if (event.target.closest('[data-v2-detail-x]')) {detail = { name: '', page: 1, search: '', data: null }; paintDetail(); return;}
        if (event.target.closest('[data-v2-print]')) {printDetail(); return;}
        if (event.target.closest('[data-v2-dgo]')) {
            openDetail(detail.name, 1, el.querySelector('[data-v2-dsearch]')?.value || '');
            return;
        }
        if (event.target.closest('[data-v2-dprev]')) {openDetail(detail.name, detail.page - 1, detail.search); return;}
        if (event.target.closest('[data-v2-dnext]')) {openDetail(detail.name, detail.page + 1, detail.search); return;}
    });

    reload();

    return {
        el, reload,
        destroy() { el.remove(); },
    };
}
