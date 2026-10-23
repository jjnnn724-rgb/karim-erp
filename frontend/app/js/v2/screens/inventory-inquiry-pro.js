/**
 * V2 — Professional item card · «البطاقة الفاخرة» (قراءة فقط)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   الشاشة الأخت لـ «محرك الاستعلامات»: بدل جدول ثم نقرًا، منتقي صنف مباشر
 *   يفتح بطاقة الصنف الكاملة في عرضها الكامل (mountItemDossier بلا compact).
 *   لا حساب هنا ولا بوابة جديدة — نفس المُحمِّل، نفس العقد، نفس الخادم.
 *
 * WHY IT REUSES THE DOSSIER
 *   لو بُنيت بطاقة ثانية لانفصل الرقم عن مصدره: الكاردكس والفواتير والأقسام
 *   والدُفعات وأسطر POS تُبنى مرة واحدة في data-display/item-dossier.js، وهذه الشاشة تضيف
 *   اختيار الصنف والمدى فقط.
 *
 * SEARCH IS SERVER-SIDE
 *   قائمة الأصناف تأتي من /items بحدّ بحث الخادم (ILIKE على الاسم/التصنيف،
 *   والباركود حرفيًا) — لا تحميل ألف صنف في المتصفح ثم تصفيتها.
 *
 * الصلاحية قرار الخادم (admin + sous_chef أو inventory-inquiry.view).
 */

import { fetchInquiryItems, rangeError } from '../data/inventory-inquiry-repo.js?v=4.9.132';
import { mountItemDossier } from '../data-display/item-dossier.js?v=4.9.132';
import { formatInt } from '../data/reports-repo.js?v=4.9.132';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

function todayIso(offset = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function template(from, to) {
    return `
      <div class="erp-v2-pro">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">البطاقة الفاخرة
              <span class="erp-eyebrow" dir="ltr" lang="en">Professional Item Card</span>
            </h2>
            <div class="erp-dash-sub" data-v2-scope-line role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm erp-no-print" data-v2-print>
              <i class="ji" data-i="printer" aria-hidden="true"></i><span>طباعة البطاقة</span>
            </button>
            <button type="button" class="erp-btn erp-btn--primary erp-btn--sm erp-no-print" data-v2-reload>
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>

        <div class="erp-filterbar erp-v2-pro__picker erp-no-print">
          <label class="erp-text-sm erp-text-muted" for="v2pro-from">من</label>
          <input class="erp-input erp-input--ltr" id="v2pro-from" type="date" value="${esc(from)}">
          <label class="erp-text-sm erp-text-muted" for="v2pro-to">إلى</label>
          <input class="erp-input erp-input--ltr" id="v2pro-to" type="date" value="${esc(to)}" max="${esc(todayIso(0))}">
          <span class="erp-seg" role="group" aria-label="فترة مسبقة">
            <button type="button" data-v2-preset="today">اليوم</button>
            <button type="button" data-v2-preset="7">7 أيام</button>
            <button type="button" data-v2-preset="30" class="is-active">30 يوم</button>
            <button type="button" data-v2-preset="90">90 يوم</button>
          </span>
          <label class="erp-field">
            <span class="erp-text-sm erp-text-muted">ابحث عن صنف</span>
            <input class="erp-input" id="v2pro-q" type="search" placeholder="اسم أو تصنيف أو باركود" autocomplete="off">
          </label>
          <label class="erp-field">
            <span class="erp-text-sm erp-text-muted">الصنف</span>
            <select class="erp-input" id="v2pro-item" aria-live="polite">
              <option value="">جارٍ القراءة…</option>
            </select>
          </label>
        </div>


        <div data-v2-dossier></div>
      </div>`;
}

/**
 * @param {ParentNode} host
 * @param {{role?:string|null, notify?:(m:string,k?:string)=>void, openItemId?:number|string}} [ctx]
 */
export function mountProfessionalScreen(host, ctx = {}) {
    let items = [];
    let currentId = ctx.openItemId != null ? String(ctx.openItemId) : null;
    let dossier = null;
    let loading = false;
    let searchTimer = null;
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 pro]', m);

    host.insertAdjacentHTML('beforeend', template(todayIso(-29), todayIso(0)));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const scopeLine = q('[data-v2-scope-line]');
    const picker = q('#v2pro-item');

    function range() {
        return { from: q('#v2pro-from').value, to: q('#v2pro-to').value };
    }

    function fillPicker(keep) {
        const wanted = keep !== undefined ? String(keep) : String(currentId ?? '');
        picker.innerHTML = items.length
            ? items.map((r) => `<option value="${esc(r.itemId)}">${esc(r.itemName)}${r.category ? ` — ${esc(r.category)}` : ''}</option>`).join('')
            : '<option value="">لا صنف يطابق البحث</option>';
        if (wanted && items.some((r) => String(r.itemId) === wanted)) {picker.value = wanted;}
        scopeLine.textContent = items.length
            ? `${formatInt(items.length)} صنفًا في نتائج البحث · اختر صنفًا لعرض بطاقته الكاملة`
            : 'لا نتائج — جرّب اسمًا آخر أو وسّع المدى';
    }

    function mountDossier(id) {
        const host2 = q('[data-v2-dossier]');
        const r = range();
        if (dossier) {dossier.destroy();}
        host2.innerHTML = '';
        if (!id) {
            host2.innerHTML = '<p class="erp-text-sm erp-text-muted">اختر صنفًا لعرض بطاقته.</p>';
            return;
        }
        currentId = id;
        dossier = mountItemDossier(host2, { itemId: id, from: r.from, to: r.to, ctx: { notify } });
    }

    async function loadItems() {
        if (loading) {return;}
        const r = range();
        const gate = rangeError(r.from, r.to);
        if (!gate.ok) {
            items = [];
            picker.innerHTML = `<option value="">${esc(gate.message)}</option>`;
            scopeLine.textContent = gate.message;
            return;
        }
        loading = true;
        picker.disabled = true;
        try {
            const payload = await fetchInquiryItems({
                from: r.from, to: r.to, q: q('#v2pro-q').value.trim(),
                sort: 'movements', limit: 200,
            });
            if (!el.isConnected) {return;}
            items = payload.rows || [];
            const keepInResults = items.some((x) => String(x.itemId) === String(currentId ?? ''));
            fillPicker(keepInResults ? currentId : '');
            if (!keepInResults) {currentId = items.length ? items[0].itemId : null;}
            mountDossier(currentId);
        } catch (e) {
            if (!el.isConnected) {return;}
            const msg = e && e.message === 'UNAUTHORIZED'
                ? 'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح البطاقة.'
                : (e && e.code === 'FORBIDDEN'
                    ? 'لا صلاحية لاستعلام المخزون بهذا الحساب — القرار للخادم وحده.'
                    : `تعذّر قراءة الأصناف: ${(e && e.message) || 'خطأ'}`);
            items = [];
            picker.innerHTML = `<option value="">${esc(msg)}</option>`;
            scopeLine.textContent = msg;
            q('[data-v2-dossier]').innerHTML = '';
        } finally {
            loading = false;
            picker.disabled = false;
        }
    }

    function applyPreset(name) {
        const days = name === 'today' ? 0 : num(name) - 1;
        q('#v2pro-from').value = todayIso(-Math.max(0, days));
        q('#v2pro-to').value = todayIso(0);
        loadItems();
    }

    el.addEventListener('click', (event) => {
        const preset = event.target.closest('[data-v2-preset]');
        if (preset) {
            [...el.querySelectorAll('[data-v2-preset]')].forEach((b) => b.classList.remove('is-active'));
            preset.classList.add('is-active');
            applyPreset(preset.dataset.v2Preset);
            return;
        }
        if (event.target.closest('[data-v2-print]')) {window.print(); return;}
        if (event.target.closest('[data-v2-reload]')) {loadItems();}
    });
    el.addEventListener('change', (event) => {
        const t = event.target;
        if (t.matches('#v2pro-item')) {
            mountDossier(t.value ? Number(t.value) : null);
            return;
        }
        if (t.matches('#v2pro-from, #v2pro-to')) {
            // المدى ملك البطاقة نفسها: تُعاد قراءتها بلا إعادة تحميل القائمة.
            if (dossier) {dossier.destroy();dossier = null;}
            mountDossier(currentId);
        }
    });
    el.addEventListener('input', (event) => {
        if (!event.target.matches('#v2pro-q')) {return;}
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadItems, 350);
    });

    loadItems();

    return {
        el,
        reload: loadItems,
        getItems: () => items,
        getItemId: () => currentId,
        getDossier: () => dossier,
        destroy() {
            clearTimeout(searchTimer);
            if (dossier) {dossier.destroy();}
            el.remove();
        },
    };
}
