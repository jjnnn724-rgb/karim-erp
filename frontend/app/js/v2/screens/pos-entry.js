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
 * Doors reused from cfo-repo (same /pos/shifts/open contract).
 */

import { fetchOpenShifts } from '../data/cfo-repo.js?v=4.9.131';
import { formatInt, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.131';

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
            ${allowed ? `<button type="button" class="erp-btn erp-btn--primary" data-v2-open>
              <i class="ji" data-i="receipt" aria-hidden="true"></i><span>فتح الكاشير</span>
            </button>` : ''}
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
        box.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ قراءة حالة الورديات…</p>';
        try {
            const [d, cur] = await Promise.all([
                fetchOpenShifts(), fetchCurrency().catch(() => ''),
            ]);
            if (!el.isConnected) {return;}
            currency = String(cur ?? '');
            const shifts = d.shifts || [];
            box.innerHTML = shifts.length
                ? `<div class="erp-table__scroll"><table class="erp-table__grid"><thead><tr><th>وردية</th><th>الكاشير</th><th>القسم</th><th>اليوم</th><th>العهدة</th><th>المتوقع</th><th>الحركة</th></tr></thead><tbody>`
                + shifts.map((s) => {
                    const stale = s.biz_date !== s.today;
                    return `<tr${stale ? ' style="background:rgba(255,0,0,.06)"' : ''}>`
                    + `<td class="erp-td erp-mono">#${s.id}</td><td class="erp-td">${esc(s.cashier_name || '—')}</td>`
                    + `<td class="erp-td">${esc(s.dept_name || '—')}</td>`
                    + `<td class="erp-td erp-mono">${esc(s.biz_date)}${stale ? ' ⚠ يوم سابق' : ''}</td>`
                    + `<td class="erp-td">${money(s.opening_balance)}</td><td class="erp-td">${money(s.expected_cash)}</td>`
                    + `<td class="erp-td erp-text-muted">${formatInt(s.invoice_count)} فاتورة</td></tr>`;
                }).join('') + `</tbody></table></div>`
                + `<p class="erp-text-sm erp-text-muted">الإغلاق المركزي من لوحة المدير المالي.</p>`
                : '<p class="erp-text-sm erp-text-muted">لا ورديات مفتوحة — كل الكاشيرية مغلقة ✓</p>';
        } catch (e) {
            if (!el.isConnected) {return;}
            box.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر القراءة')}</p>`;
        } finally {
            loading = false;
        }
    }

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-open]')) {
            window.open('/app/pos.html', '_blank');
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload();}
    });

    reload();

    return {
        el, reload,
        destroy() {el.remove();},
    };
}
