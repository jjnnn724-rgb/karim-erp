/**
 * V2 — Daily locks screen · لوحة التقفيل اليومي (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 * Behavior mirror of renderDailyLocksPage/loadDailyLocks (whatsapp.js:371-419):
 * تاريخ + بطاقات (مقفّل/مفتوح/فواتير/صافي) + جدول الأقسام. نفس الباب
 * والحسابات — والخادم يحسم الصلاحية.
 */

import { formatInt, formatQty } from '../data/reports-repo.js?v=4.9.197';
import { fetchDailyLocks } from '../data/oracle-repo.js?v=4.9.197';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function template() {
    return `
      <div class="erp-v2-locks">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">لوحة التقفيل اليومي
              <span class="erp-eyebrow" dir="ltr" lang="en">Daily Locks</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note></div>
          </div>
          <div class="erp-dash-controls">
            <label class="erp-text-sm erp-text-muted" for="v2dl-date">اليوم</label>
            <input class="erp-input erp-input--ltr" id="v2dl-date" type="date" value="${todayIso()}" data-v2-date>
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-body></div>
      </div>`;
}

/**
 * @param {ParentNode} host where the screen is inserted
 * @param {{notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountDailyLocksScreen(host, ctx = {}) {
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 daily-locks]', m);

    let date = todayIso();
    let loading = false;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} notify(m); };

    async function reload() {
        if (loading) {return;}
        loading = true;
        const box = q('[data-v2-body]');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const d = await fetchDailyLocks(date);
            if (!el.isConnected) {return;}
            box.innerHTML = `<ul class="erp-kpis">`
                + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">اليوم</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${esc(d.date)}</span></div></li>`
                + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">مقفّل</span></div><div class="erp-kpi__value" style="color:var(--erp-success-text)"><span class="erp-num" dir="ltr">${formatInt(d.locked)}</span></div></li>`
                + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">مفتوح</span></div><div class="erp-kpi__value" style="color:var(--erp-danger-text)"><span class="erp-num" dir="ltr">${formatInt(d.unlocked)}</span></div></li>`
                + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">فاتورة</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(d.totalInv)}</span></div></li>`
                + `<li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__label">صافي</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatQty(d.totalNet)}</span></div></li>`
                + `</ul>`
                + `<div class="erp-table__scroll" tabindex="0"><table class="erp-table__grid"><thead><tr><th>القسم</th><th>مقفّل</th><th>إيراد</th><th>مرتجع</th><th>صافي</th><th>فاتورة</th><th>مرتجعات</th></tr></thead><tbody>`
                + (d.rows.map((x) => `<tr${x.lock_count > 0 ? '' : ' style="background:var(--erp-surface-hover)"'}>`
                    + `<td class="erp-td"><b>${esc(x.dept_name)}</b> <span class="erp-mono erp-text-muted" dir="ltr">${esc(x.dept_code)}</span></td>`
                    + `<td class="erp-td"><span class="erp-badge" data-tone="${x.lock_count > 0 ? 'success' : 'danger'}">${x.lock_count > 0 ? 'مقفّل' : 'مفتوح'}</span></td>`
                    + `<td class="erp-td erp-num" dir="ltr">${formatQty(x.gross)}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${formatQty(x.refund)}</td>`
                    + `<td class="erp-td erp-num" dir="ltr"><b>${formatQty(x.net)}</b></td>`
                    + `<td class="erp-td erp-num" dir="ltr">${formatInt(x.invoices)}</td>`
                    + `<td class="erp-td erp-num" dir="ltr">${formatInt(x.refunds)}</td></tr>`).join('')
                    || '<tr><td class="erp-td" colspan="7">لا أقسام في هذا اليوم</td></tr>')
                + `</tbody></table></div>`;
        } catch (e) {
            if (!el.isConnected) {return;}
            say(e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض التقفيل بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر التحميل: ${(e && e.message) || 'خطأ'}`));
        } finally {
            loading = false;
        }
    }

    el.addEventListener('change', (event) => {
        if (event.target.matches('[data-v2-date]') && event.target.value) {
            date = event.target.value;
            reload();
        }
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload();}
    });

    reload();

    return {
        el, reload,
        destroy() { el.remove(); },
    };
}
