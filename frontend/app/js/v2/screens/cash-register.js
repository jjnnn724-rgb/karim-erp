/**
 * screens/cash-register.js — سجلّ الصرف + إذن الصرف
 * ══════════════════════════════════════════════════════════════════════
 * «سجلّ الصرف» صفحة واحدة تجمع كل ما خرج من الصندوق: كل حركة (صرف مخزون
 * أو جرد أو مصروف يدوي) مع رقم إذنها وحالتها ومجموع الفترة. وفتح أي سطر
 * يفتح **إذن الصرف** بتفاصيله وسلسلة اعتماداته، ويُطبع عبر عارض V2.
 *
 * الطباعة: نقاط نهايا HTML (مثل /voucher/:id/html) محمية برؤوس المصادقة
 * فقط — قفزة متصفح (href/target) لا تحمل x-api-key فترجع 401. لذلك
 * تجلب الورقة بـ fetch خام (نمط employee-card-repo.js) ثم تُكتب في
 * عارض التطبيق (openInAppReport) وشريط العارض هو مَن يطبع.
 *
 * المبادئ: قراءةٌ فقط · لا مكتبة رسوم · رموز --erp-* فقط · لا معالجات inline
 * · كل رقم من الخادم (لا حساب في الواجهة) · RTL عربي.
 */
import { apiFetch, API_BASE } from '../../core/api.js?v=4.9.193';
import { openInAppReport } from '../report-viewer.js?v=4.9.193';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (v) => `${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;
const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const monthStart = () => `${today().slice(0, 7)}-01`;

const STATUS = {
    approved: { label: 'معتمد', tone: 'success' },
    received: { label: 'مستلم', tone: 'success' },
    rejected: { label: 'مرفوض', tone: 'danger' },
    pending: { label: 'بانتظار الاعتماد', tone: 'warning' },
    draft: { label: 'مسودة', tone: 'neutral' },
};

const TYPE_LABEL = {
    dispatch: 'صرف مخزون', count_correction: 'تصحيح جرد', transfer: 'تحويل',
    receipt: 'وارد مخزون', stock_transfer: 'تحويل مخزون', inventory_transfer: 'تحويل مخزون',
    kitchen_return: 'مرتجع مطبخ', count_correction_receipt: 'إذن جرد', manual: 'يدوي', '': 'يدوي',
};

/**
 * جلب ورقة الإذن HTML من الخادم برؤوس المصادقة (جنبًا إلى جنب مع
 * fetchLuxCardHtml في employee-card-repo.js) ثم عرضها في عارض V2.
 * Navigation العادي يعيد 401 لأن نقطة النهاية تقبل الرؤوس فقط.
 * @param {number|string} id رقم إذن الصرف
 * @returns {Promise<void>}
 */
async function printVoucher(id) {
    const headers = {};
    if (typeof window !== 'undefined' && window._jwt) {headers.Authorization = `Bearer ${window._jwt}`;}
    if (typeof window !== 'undefined' && window._appKey) {headers['x-api-key'] = window._appKey;}
    const res = await fetch(`${API_BASE}/expense-register/voucher/${encodeURIComponent(id)}/html`, { headers });
    if (!res.ok) {
        let msg = `تعذر توليد الإذن (${res.status})`;
        try {
            const e = await res.clone().json();
            if (e && (e.message || e.error)) {msg = e.message || e.error;}
        } catch (_) { /* صفحة HTML — يبقى الردّ العام */ }
        throw new Error(msg);
    }
    const html = await res.text();
    const w = openInAppReport('إذن صرف');
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
}

/**
 * @param {HTMLElement} host
 * @param {{ navigate?: (key:string)=>void }} [ctx]
 */
export function mountCashRegister(host, ctx = {}) {
    const navigate = typeof ctx.navigate === 'function' ? ctx.navigate : () => {};
    let data = { rows: [], totals: {}, top: [], types: [] };
    let busy = false;
    const filters = { from: monthStart(), to: today(), type: '', dept: '', q: '' };

    host.insertAdjacentHTML('beforeend', `
      <section class="erp-v2 cashreg">
        <header class="cashreg__head erp-screen-in">
          <div>
            <h1 class="cashreg__title">سجلّ الصرف</h1>
            <p class="cashreg__sub">كل ما خرج من الصندوق: حركات الصرف معلَّمةً بأذونها واعتماداتها</p>
          </div>
          <div class="cashreg__tools">
            <label class="cashreg__field"><span>من</span><input type="date" data-cr="from" value="${esc(filters.from)}"></label>
            <label class="cashreg__field"><span>إلى</span><input type="date" data-cr="to" value="${esc(filters.to)}"></label>
            <label class="cashreg__field"><span>النوع</span><select data-cr="type"><option value="">الكل</option></select></label>
            <input class="cashreg__search" type="search" data-cr="q" placeholder="بحث في البيان…" aria-label="بحث">
            <button type="button" class="erp-btn erp-btn--sm" data-cr-apply>عرض</button>
          </div>
        </header>
        <div class="cashreg__kpis" data-cr-kpis></div>
        <div class="exec__grid">
          <section class="erp-card cashreg__card cashreg__card--wide erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">الحركات</h2>
              <span class="erp-eyebrow" dir="ltr" lang="en">Cash Register</span></div>
            <div class="erp-card__body" data-cr-table><p class="erp-state">جارٍ التحميل…</p></div>
          </section>
          <section class="erp-card cashreg__card erp-screen-in">
            <div class="erp-card__head"><h2 class="erp-card__title">أعلى البنود</h2></div>
            <div class="erp-card__body" data-cr-top></div>
          </section>
        </div>
        <div class="cashreg__drawer" data-cr-drawer hidden></div>
      </section>`);

    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);

    function paintKpis() {
        const t = data.totals || {};
        const cards = [
            { label: 'إجمالي الصرف (الفترة)', value: money(t.total), tone: 'brand' },
            { label: 'عدد الحركات', value: String(t.count || 0), tone: 'neutral' },
            { label: 'صرفٌ يدوي (غير آلي)', value: money(t.manual_total), tone: 'warning' },
            { label: 'أقسام صرف', value: String(t.depts || 0), tone: 'info' },
        ];
        q('[data-cr-kpis]').innerHTML = cards.map((c, i) => `
          <article class="exec__kpi exec__kpi--${c.tone}" style="--exec-i:${i}">
            <span class="exec__kpi-label">${esc(c.label)}</span>
            <strong class="exec__kpi-value">${esc(c.value)}</strong>
          </article>`).join('');
    }

    function paintTypes() {
        const sel = q('[data-cr="type"]');
        const current = filters.type;
        const options = ['<option value="">الكل</option>']
            .concat((data.types || []).map((t) => `<option value="${esc(t.type)}">${esc(TYPE_LABEL[t.type] || t.type)} (${t.n})</option>`));
        sel.innerHTML = options.join('');
        sel.value = current;
    }

    function paintTable() {
        const rows = data.rows || [];
        const box = q('[data-cr-table]');
        if (!rows.length) {
            box.innerHTML = '<p class="erp-state"><span class="erp-state__title">لا حركات في هذه الفترة</span><span>وسّع المدى أو غيّر المرشّحات.</span></p>';
            return;
        }
        box.innerHTML = `<div class="cashreg__tablewrap"><table class="cashreg__table">
          <thead><tr>
            <th>التاريخ</th><th>إذن الصرف</th><th>البيان</th><th>القسم</th><th>النوع</th><th>المبلغ</th><th>الحالة</th>
          </tr></thead>
          <tbody>${rows.map((r) => {
            const st = STATUS[r.request_status] || (r.autoGenerated ? { label: 'آلي', tone: 'neutral' } : { label: 'يدوي', tone: 'warning' });
            return `<tr class="cashreg__row${r.request_id ? ' is-open' : ''}" ${r.request_id ? `data-cr-voucher="${esc(r.request_id)}" tabindex="0" role="button"` : ''}>
              <td dir="ltr">${esc(r.date)}</td>
              <td dir="ltr">${esc(r.request_id || '—')}</td>
              <td>${esc(r.desc || '—')}</td>
              <td>${esc(r.request_dept || r.deptId || '—')}</td>
              <td>${esc(TYPE_LABEL[r.adjustmentType] || r.adjustmentType || 'يدوي')}</td>
              <td class="cashreg__amount">${esc(money(r.amount))}</td>
              <td><span class="cashreg__badge cashreg__badge--${esc(st.tone)}">${esc(st.label)}</span></td>
            </tr>`;
        }).join('')}</tbody>
        </table></div>`;
        box.querySelectorAll('[data-cr-voucher]').forEach((tr) => {
            const open = () => openVoucher(tr.dataset.crVoucher);
            tr.addEventListener('click', open);
            tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        });
    }

    function paintTop() {
        const top = data.top || [];
        q('[data-cr-top]').innerHTML = top.length
            ? `<ul class="exec__list">${top.map((t) => `<li><span>${esc(t.category)}</span><strong>${esc(money(t.total))}</strong></li>`).join('')}</ul>`
            : '<p class="exec__muted">لا بيانات.</p>';
    }

    async function openVoucher(id) {
        const drawer = q('[data-cr-drawer]');
        drawer.hidden = false;
        drawer.innerHTML = '<div class="cashreg__drawerpanel"><p class="erp-state">جارٍ فتح الإذن…</p></div>';
        try {
            const v = await apiFetch(`/expense-register/voucher/${encodeURIComponent(id)}`);
            const d = v.dispatch || {};
            const st = STATUS[d.status] || { label: d.status || '—', tone: 'neutral' };
            const items = Array.isArray(v.items) ? v.items : [];
            drawer.innerHTML = `<div class="cashreg__drawerpanel">
              <header class="cashreg__drawerhead">
                <div>
                  <h2 class="cashreg__drawertitle">إذن صرف</h2>
                  <p class="cashreg__drawersub" dir="ltr">${esc(d.id || '')} · ${esc(d.deptName || d.deptCode || '')} · ${esc(d.date || '')}</p>
                </div>
                <div class="cashreg__draweractions">
                  <span class="cashreg__badge cashreg__badge--${esc(st.tone)}">${esc(st.label)}</span>
                  <button type="button" class="erp-btn erp-btn--sm" data-cr-print>طباعة الإذن</button>
                  <button type="button" class="erp-btn erp-btn--sm" data-cr-open-dispatch>فتح طلب الصرف</button>
                  <button type="button" class="erp-icon-btn" data-cr-close aria-label="إغلاق">×</button>
                </div>
              </header>
              <div class="cashreg__drawerbody">
                <dl class="cashreg__facts">
                  <div><dt>مُعِدّ الطلب</dt><dd>${esc(d.createdBy || '—')}</dd></div>
                  <div><dt>اعتماد المستودع</dt><dd>${esc(d.approvedBy || '—')}</dd></div>
                  <div><dt>اعتماد المطبخ</dt><dd>${esc(d.chefApprovedBy || '—')}</dd></div>
                  <div><dt>استلام المطبخ</dt><dd>${esc(d.kitchenReceivedBy || '—')}</dd></div>
                  <div><dt>ملاحظات</dt><dd>${esc(d.notes || '—')}</dd></div>
                  <div><dt>إجمالي الصرف</dt><dd>${esc(money(v.total))}</dd></div>
                </dl>
                <table class="cashreg__table cashreg__table--items">
                  <thead><tr><th>الصنف</th><th>الكمية</th><th>الوحدة</th><th>سعر التكلفة</th><th>القيمة</th></tr></thead>
                  <tbody>${items.map((it) => `<tr>
                    <td>${esc(it.itemName || it.name || '—')}</td>
                    <td>${esc(it.approvedQty ?? it.requestedQty ?? it.qty ?? '—')}</td>
                    <td>${esc(it.unit || '—')}</td>
                    <td>${it.avgCost != null ? esc(Number(it.avgCost).toFixed(2)) : '—'}</td>
                    <td>${esc(Number(it.approvedValue || 0).toFixed(2))}</td>
                  </tr>`).join('') || '<tr><td colspan="5">لا أصناف</td></tr>'}</tbody>
                </table>
                ${(v.events || []).length ? `<p class="cashreg__chain">${v.events.map((e) => `<span>${esc(e.to_status || e.event_type)}${e.actor_name ? ' — ' + esc(e.actor_name) : ''}</span>`).join('')}</p>` : ''}
              </div>
            </div>`;
            drawer.querySelector('[data-cr-close]').addEventListener('click', () => { drawer.hidden = true; drawer.innerHTML = ''; });
            drawer.querySelector('[data-cr-open-dispatch]')?.addEventListener('click', () => { navigate('dispatch'); });
            drawer.querySelector('[data-cr-print]').addEventListener('click', () => {
                printVoucher(d.id).catch((e) => {
                    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
                        window.toast((e && e.message) || 'تعذر طباعة الإذن', 'error');
                    }
                });
            });
        } catch (e) {
            drawer.innerHTML = `<div class="cashreg__drawerpanel"><p class="erp-state">تعذّر فتح الإذن: ${esc((e && e.message) || 'خطأ')}</p>
              <button type="button" class="erp-btn erp-btn--sm" data-cr-close>إغلاق</button></div>`;
            drawer.querySelector('[data-cr-close]').addEventListener('click', () => { drawer.hidden = true; drawer.innerHTML = ''; });
        }
    }

    async function load() {
        if (busy) {return;}
        busy = true;
        const params = new URLSearchParams();
        for (const [k, v] of Object.entries(filters)) { if (v) { params.set(k, v); } }
        params.set('limit', '300');
        q('[data-cr-table]').innerHTML = '<p class="erp-state">جارٍ التحميل…</p>';
        try {
            data = await apiFetch(`/expense-register?${params.toString()}`);
            paintTypes();
            paintKpis();
            paintTable();
            paintTop();
        } catch (e) {
            q('[data-cr-table]').innerHTML = `<p class="erp-state">تعذّر تحميل السجل: ${esc((e && e.message) || 'خطأ')}</p>`;
        } finally {
            busy = false;
        }
    }

    q('[data-cr-apply]').addEventListener('click', () => {
        filters.from = q('[data-cr="from"]').value;
        filters.to = q('[data-cr="to"]').value;
        filters.type = q('[data-cr="type"]').value;
        filters.q = q('[data-cr="q"]').value.trim();
        load();
    });
    q('[data-cr="q"]').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { q('[data-cr-apply]').click(); }
    });

    load();
    return { destroy() { host.innerHTML = ''; }, refresh: load, openVoucher, printVoucher };
}
