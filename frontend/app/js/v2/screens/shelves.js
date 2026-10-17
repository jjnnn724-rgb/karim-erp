/**
 * V2 — Shelves screen · الرفوف (P2-5)
 * ═══════════════════════════════════════════════════════════════════════
 * Parity with warehouse.js renderShelves/showAddShelfModal/addShelf/
 * editShelf/updateShelf/deleteShelf, on the same doors: GET /shelves,
 * GET /inventory, POST/PUT/DELETE /shelves.
 *
 * WRITES ARE DOUBLE-LOCKED
 *   Role (admin|manager|warehouse, the server's own map) AND the independent
 *   `v2shelfwrite` flag — OFF by default, query overrides storage. With
 *   either one missing the grid stays readable and no write control is drawn.
 *
 * WHAT THE SCREEN DOES NOT DO
 *   It never renders the stored `icon` string: legacy kept raw markup there,
 *   and injecting it would be an XSS door. Every shelf gets the design
 *   system's archive icon instead; the stored value is untouched.
 *
 * DELETE, SAID HONESTLY
 *   inventory.shelfId is ON DELETE SET NULL, so deleting a shelf unassigns
 *   its items instead of deleting them. The confirmation says exactly that
 *   before the request; the screen never claims otherwise.
 */

import { formatInt, formatQty, formatMoney, fetchCurrency } from '../data/reports-repo.js?v=4.9.154';
import { canWrite } from '../session.js?v=4.9.154';
import { shelfWriteEnabled } from '../write-flags.js?v=4.9.154';
import {
    SHELF_WRITE_ROLES, fetchShelves, fetchShelfInventory,
    shelfStats, shelfItems, validateShelfForm, createShelf, updateShelf, deleteShelf,
} from '../data/shelves-repo.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const TOP_ITEMS = 5;

function money(v, currency) {
    const m = formatMoney(v, currency);
    const unit = m.hasUnit ? ` <span class="erp-text-sm erp-text-muted">${esc(m.unit)}</span>` : '';
    return `<span class="erp-num" dir="ltr">${m.amount}</span>${unit}`;
}

function kpisHtml(shelves, items) {
    const s = shelfStats(shelves, items);
    return `<ul class="erp-kpis" aria-label="مؤشرات الرفوف — محسوبة من دليل الرفوف والمخزون المقروءين">
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="archive"></i></span><span class="erp-kpi__label">رف</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(s.shelves)}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="package"></i></span><span class="erp-kpi__label">أصناف معيّنة</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(s.assignedItems)}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="alert-triangle"></i></span><span class="erp-kpi__label">رفوف فارغة</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(s.emptyShelves)}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="chart"></i></span><span class="erp-kpi__label">نسبة الإشغال</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${s.occupancy.toFixed(1)}%</span></div><div class="erp-kpi__foot"><span class="erp-kpi__hint">${formatInt(s.assignedItems)} من ${formatInt(items.length)} صنفًا لها رف</span></div></li>
    </ul>`;
}

function cardHtml(shelf, items, currency, writable) {
    const stats = shelfItems(shelf.id, items);
    const top = stats.rows.slice(0, TOP_ITEMS);
    const more = stats.rows.length - top.length;
    const location = shelf.location ? esc(shelf.location) : '—';
    return `<article class="erp-card erp-shelf" data-v2-shelf="${esc(shelf.id)}">
      <div class="erp-shelf__head">
        <span class="erp-shelf__icon" aria-hidden="true"><i class="ji" data-i="archive"></i></span>
        <div class="erp-shelf__title">
          <h3 class="erp-card__title">${esc(shelf.name) || '—'}</h3>
          <div class="erp-text-sm erp-text-muted">
            <span class="erp-mono" dir="ltr">${esc(shelf.code || '—')}</span>
            <span aria-hidden="true"> · </span>${location}
          </div>
        </div>
        <span class="erp-badge" data-tone="info">${formatInt(stats.count)} صنف</span>
      </div>
      <dl class="erp-shelf__stats">
        <div><dt>الكمية</dt><dd><span class="erp-num" dir="ltr">${formatQty(stats.qty)}</span></dd></div>
        <div><dt>القيمة</dt><dd>${money(stats.value, currency)}</dd></div>
        <div><dt>السعة</dt><dd><span class="erp-num" dir="ltr">${shelf.capacity == null || shelf.capacity === '' ? '—' : formatQty(shelf.capacity)}</span></dd></div>
      </dl>
      <ul class="erp-shelf__items" aria-label="أصناف الرف ${esc(shelf.name)}">
        ${top.map((i) => `<li><span>${esc(i.name || '—')}</span><span class="erp-num" dir="ltr">${formatQty(i.qty)} ${esc(i.unit || '')}</span></li>`).join('')}
        ${more > 0 ? `<li class="erp-text-muted">… و${formatInt(more)} أصناف أخرى</li>` : ''}
        ${top.length === 0 ? '<li class="erp-text-muted">الرف فارغ</li>' : ''}
      </ul>
      ${writable ? `<div class="erp-shelf__actions">
        <button type="button" class="erp-btn erp-btn--sm" data-v2-shelf-edit="${esc(shelf.id)}"><i class="ji" data-i="pencil" aria-hidden="true"></i><span>تعديل</span></button>
        <button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-shelf-del="${esc(shelf.id)}"><i class="ji" data-i="trash" aria-hidden="true"></i><span>حذف</span></button>
      </div>` : ''}
    </article>`;
}

function formHtml(row, writable) {
    if (!writable) {return '';}
    const editing = !!row;
    return `<section class="erp-card erp-shelf-form" data-v2-form>
      <div class="erp-card__head">
        <h3 class="erp-card__title">${editing ? `تعديل رف «${esc(row.name)}»` : 'إضافة رف'}</h3>
      </div>
      <div class="erp-card__body erp-stack">
        <form data-v2-sf novalidate>
          <div class="erp-shelf-form__grid">
            <label class="erp-field"><span>اسم الرف</span>
              <input class="erp-input" name="name" maxlength="255" value="${editing ? esc(row.name) : ''}" required>
            </label>
            <label class="erp-field"><span>الكود</span>
              <input class="erp-input erp-input--ltr" name="code" maxlength="50" value="${editing ? esc(row.code) : ''}" ${editing ? 'readonly' : ''} required>
            </label>
            <label class="erp-field"><span>الموقع</span>
              <input class="erp-input" name="location" maxlength="255" value="${editing ? esc(row.location || '') : ''}">
            </label>
            <label class="erp-field"><span>السعة</span>
              <input class="erp-input" name="capacity" type="number" min="0" step="1" value="${editing ? esc(row.capacity ?? 50) : 50}">
            </label>
          </div>
          <p class="erp-text-sm erp-text-danger" data-v2-sf-err role="alert" hidden></p>
          <div class="erp-row erp-shelf-form__actions">
            <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm"><i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ</span></button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-sf-x>إلغاء</button>
          </div>
        </form>
      </div>
    </section>`;
}

function template(writable) {
    return `
      <div class="erp-v2-shelves">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الرفوف
              <span class="erp-eyebrow" dir="ltr" lang="en">Shelves</span>
            </h2>
            <div class="erp-dash-sub" data-v2-note role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <input class="erp-input" data-v2-search placeholder="بحث بالاسم أو الكود أو الموقع" aria-label="بحث في الرفوف" style="max-width:280px">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
            ${writable ? `<button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-add>
              <i class="ji" data-i="plus" aria-hidden="true"></i><span>إضافة رف</span>
            </button>` : ''}
          </div>
        </div>
        <p class="erp-text-sm erp-text-muted">
          كل صنف يُعيَّن لرفٍ واحد عبر <span class="erp-mono" dir="ltr">inventory.shelfId</span>.
          حذف الرف لا يحذف أصنافه: المفتاح الخارجي <span class="erp-mono" dir="ltr">ON DELETE SET NULL</span>
          يزيل تعيينها فقط.
          ${writable ? '' : '<span data-v2-ro>الكتابة غير متاحة الآن — إما الصلاحية لا تسمح أو علم <span class="erp-mono" dir="ltr">v2shelfwrite</span> مغلق.</span>'}
        </p>
        <div data-v2-kpis></div>
        <div data-v2-form-host hidden></div>
        <div data-v2-grid class="erp-shelf-grid"></div>
      </div>`;
}

/**
 * @param {ParentNode} host
 * @param {{role?: string|null, notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean}} [ctx]
 */
export function mountShelvesScreen(host, ctx = {}) {
    const writable = canWrite(ctx.role, SHELF_WRITE_ROLES) && shelfWriteEnabled();
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 shelves]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);

    let shelves = [];
    let items = [];
    let currency = '';
    let filter = '';
    let editing = null;
    let loading = false;
    let queued = false;
    let saving = false;

    host.insertAdjacentHTML('beforeend', template(writable));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');
    const kpisHost = q('[data-v2-kpis]');
    const grid = q('[data-v2-grid]');
    const formHost = q('[data-v2-form-host]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} };
    const fail = (form, message, field) => {
        const box = form.querySelector('[data-v2-sf-err]');
        if (box) {box.textContent = message; box.hidden = false;}
        const input = field ? form.querySelector(`[name="${field}"]`) : null;
        if (input && typeof input.focus === 'function') {input.focus();}
    };

    function visibleShelves() {
        const needle = filter.trim().toLowerCase();
        if (!needle) {return shelves;}
        return shelves.filter((s) => [s.name, s.code, s.location]
            .some((v) => String(v || '').toLowerCase().includes(needle)));
    }

    function paint() {
        kpisHost.innerHTML = kpisHtml(shelves, items);
        const list = visibleShelves();
        grid.innerHTML = list.length
            ? list.map((s) => cardHtml(s, items, currency, writable)).join('')
            : `<div class="erp-state" role="status">
                 <span class="erp-state__title">${shelves.length ? 'لا رف يطابق البحث' : 'لا رفوف مسجّلة'}</span>
                 <span>${shelves.length ? 'امسح كلمة البحث لعرض الدليل كاملًا.' : (writable ? 'أضف أول رف من زر «إضافة رف».' : 'لا بيانات في دليل الرفوف.')}</span>
               </div>`;
    }

    function openForm(row) {
        if (!writable) {return;}
        editing = row || null;
        formHost.innerHTML = formHtml(editing, writable);
        formHost.hidden = false;
        const first = formHost.querySelector('input[name="name"]');
        if (first && typeof first.focus === 'function') {first.focus();}
    }

    function closeForm() {
        editing = null;
        formHost.innerHTML = '';
        formHost.hidden = true;
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        say('جارٍ قراءة الرفوف والمخزون…');
        try {
            const [shelvesRes, itemsRes, currencyRes] = await Promise.allSettled([
                fetchShelves(), fetchShelfInventory(), fetchCurrency(),
            ]);
            if (!el.isConnected) {return;}
            if (shelvesRes.status === 'fulfilled') {shelves = shelvesRes.value;}
            else {shelves = []; say(`تعذّر تحميل الرفوف: ${(shelvesRes.reason && shelvesRes.reason.message) || 'خطأ'}`);}
            if (itemsRes.status === 'fulfilled') {items = itemsRes.value;}
            else {items = []; say(`تعذّر تحميل المخزون — أعداد الأصناف غير معروضة: ${(itemsRes.reason && itemsRes.reason.message) || 'خطأ'}`);}
            currency = currencyRes.status === 'fulfilled' ? currencyRes.value : '';
            if (shelvesRes.status === 'fulfilled' && itemsRes.status === 'fulfilled') {say('');}
            paint();
        } finally {
            loading = false;
            if (queued && el.isConnected) {queued = false; reload();}
        }
    }

    async function save(form) {
        if (saving || !writable) {return;}
        const data = new FormData(form);
        const raw = {
            name: data.get('name') || '',
            code: data.get('code') || '',
            location: data.get('location') || '',
            capacity: data.get('capacity'),
        };
        const errors = validateShelfForm(raw);
        if (errors.length) {fail(form, errors[0].message, errors[0].field); return;}
        const code = String(raw.code).trim().toUpperCase();
        const duplicate = shelves.some((s) => String(s.code || '').toUpperCase() === code
            && String(s.id) !== String(editing && editing.id));
        if (duplicate) {fail(form, 'الكود موجود بالفعل', 'code'); return;}
        saving = true;
        const button = form.querySelector('button[type="submit"]');
        if (button) {button.disabled = true;}
        try {
            if (editing) {
                await updateShelf(editing.id, raw);
                if (!el.isConnected) {return;}
                notify(`تم تحديث الرف «${String(raw.name).trim()}»`);
            } else {
                await createShelf(raw);
                if (!el.isConnected) {return;}
                notify(`تمت إضافة الرف «${String(raw.name).trim()}»`);
            }
            closeForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            fail(form, (e && e.message) || 'تعذّر حفظ الرف');
        } finally {
            saving = false;
            if (button) {button.disabled = false;}
        }
    }

    async function remove(id) {
        if (!writable) {return;}
        const row = shelves.find((s) => String(s.id) === String(id));
        if (!row) {return;}
        if (!confirmFn(`حذف الرف «${row.name}»؟ ستُزال تعيينات أصنافه (${formatInt(shelfItems(row.id, items).count)} صنفًا) ولن تُحذف الأصناف نفسها.`)) {return;}
        try {
            await deleteShelf(row.id);
            if (!el.isConnected) {return;}
            notify(`تم حذف الرف «${row.name}»`);
            closeForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذّر حذف الرف');
        }
    }

    el.addEventListener('input', (event) => {
        if (event.target.matches('[data-v2-search]')) {
            filter = String(event.target.value || '');
            paint();
        }
    });

    el.addEventListener('submit', (event) => {
        const form = event.target.closest('[data-v2-sf]');
        if (!form) {return;}
        event.preventDefault();
        save(form);
    });

    el.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-add]')) {openForm(null); return;}
        if (event.target.closest('[data-v2-sf-x]')) {closeForm(); return;}
        const edit = event.target.closest('[data-v2-shelf-edit]');
        if (edit) {
            const row = shelves.find((s) => String(s.id) === String(edit.dataset.v2ShelfEdit));
            if (row) {openForm(row);}
            return;
        }
        const del = event.target.closest('[data-v2-shelf-del]');
        if (del) {remove(del.dataset.v2ShelfDel);}
    });

    reload();

    return {
        el, reload,
        getRows: () => shelves,
        destroy() { el.remove(); },
    };
}
