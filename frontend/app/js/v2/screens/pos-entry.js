/**
 * V2 — POS entry screen · مدخل الكاشير (بوابة + حالة الوردية)
 * ═══════════════════════════════════════════════════════════════════════
 * Scope note (read before extending): POS itself is a standalone app
 * (/app/pos.html — 2,500+ lines with its own auth, cart, buffet, held
 * orders, printing and ZATCA flow). It is NOT rebuilt here: rebuilding a
 * money printer from scratch would violate zero-surprise delivery. This
 * screen is the V2 entry — same roles as the legacy topbar link
 * (auth-navigation.js:302: admin/accountant/cashier) — plus the live
 * shift state so a cashier sees whether a shift is open before entering.
 * Doors reused from cfo-repo (same /pos/shifts/open contract). The entry
 * is a real noopener link like the legacy anchor, never a popup script.
 */

import { fetchOpenShifts } from '../data/cfo-repo.js?v=4.9.151';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.151';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const POS_ROLES = ['admin', 'accountant', 'cashier'];

function template(allowed) {
    return `
      <div class="erp-v2-posentry">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الكاشير
              <span class="erp-eyebrow" dir="ltr" lang="en">POS Entry</span>
            </h2>
            <div class="erp-dash-sub" role="status" aria-live="polite" data-v2-note>نقطة البيع تطبيق مستقل — الدخول من هنا بنفس صلاحيات الشريط القديم.</div>
          </div>
          <div class="erp-dash-controls">
            ${allowed ? `<a class="erp-btn erp-btn--primary" href="/app/pos.html"
              target="_blank" rel="noopener" title="يفتح الكاشير في تبويب جديد">
              <i class="ji" data-i="receipt" aria-hidden="true"></i><span>فتح الكاشير</span>
            </a>` : ''}
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
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void}} [ctx]
 * @returns {{el: HTMLElement, reload: ()=>Promise<void>, destroy: ()=>void}}
 */
export function mountPosEntryScreen(host, ctx = {}) {
    const allowed = POS_ROLES.includes(String(ctx.role || ''));

    let currency = '';
    let loading = false;

    host.insertAdjacentHTML('beforeend', template(allowed));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);

    function money(v) {
        const m = formatMoney(v, currency);
        return `<span class="erp-num" dir="ltr">${esc(m.amount)}</span>${m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : ''}`;
    }

    async function reload() {
        if (loading) {return;}
        const box = q('[data-v2-body]');
        if (!allowed) {
            box.innerHTML = '<p class="erp-text-sm erp-text-muted">مدخل الكاشير لأدوار المحاسبة والكاشير — القرار للخادم.</p>';
            return;
        }
        loading = true;
        box.setAttribute('aria-busy', 'true');
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ قراءة حالة الورديات…</p>';
        try {
            const [d, cur] = await Promise.all([
                fetchOpenShifts(), fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            const shifts = d.shifts || [];
            box.innerHTML = shifts.length
                ? `<div class="erp-table__scroll"><table class="erp-table__grid"><caption class="erp-sr-only">الورديات المفتوحة</caption><thead><tr><th scope="col">وردية</th><th scope="col">الكاشير</th><th scope="col">القسم</th><th scope="col">اليوم</th><th scope="col">العهدة</th><th scope="col">المتوقع</th><th scope="col">الحركة</th></tr></thead><tbody>`
                + shifts.map((s) => {
                    const stale = s.biz_date !== s.today;
                    return `<tr>`
                    + `<td class="erp-td erp-mono">#${s.id}</td><td class="erp-td">${esc(s.cashier_name || '—')}</td>`
                    + `<td class="erp-td">${esc(s.dept_name || '—')}</td>`
                    + `<td class="erp-td erp-mono">${esc(s.biz_date)}${stale ? ' <span class="erp-badge" data-tone="warning">يوم سابق</span>' : ''}</td>`
                    + `<td class="erp-td">${money(s.opening_balance)}</td><td class="erp-td">${money(s.expected_cash)}</td>`
                    + `<td class="erp-td erp-text-muted">${formatInt(s.invoice_count)} فاتورة</td></tr>`;
                }).join('') + `</tbody></table></div>`
                + `<p class="erp-text-sm erp-text-muted">الإغلاق المركزي من لوحة المدير المالي.</p>`
                : '<p class="erp-text-sm erp-text-muted">لا ورديات مفتوحة — <span class="erp-badge" data-tone="success">كل الكاشيرية مغلقة</span></p>';
        } catch (e) {
            if (!el.isConnected) {return;}
            const message = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لعرض الورديات بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر قراءة الورديات: ${(e && e.message) || 'خطأ'}`);
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc(message)}</p>`
                + '<button type="button" class="erp-btn erp-btn--sm" data-erp-retry>إعادة المحاولة</button>';
        } finally {
            box.removeAttribute('aria-busy');
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]') || event.target.closest('[data-erp-retry]')) {reload();}
    });

    reload();

    return {
        el, reload,
        destroy() {el.remove();},
    };
}
