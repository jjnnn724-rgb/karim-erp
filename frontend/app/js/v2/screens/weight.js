/**
 * V2 — Weight screen · الميزان (P2-5)
 * ═══════════════════════════════════════════════════════════════════════
 * Parity with warehouse.js renderWeight/adjustWeight/resetWeight/
 * setWeightUnit/recordWeight/recordWeightToItem/confirmRecordWeightToItem,
 * on the same doors: GET /weightReadings, GET /inventory,
 * POST /weightReadings, PUT /inventory/:id {weight}.
 *
 * WRITES ARE DOUBLE-LOCKED, AND NOT BY THE SAME MAP
 *   Recording a reading needs WEIGHT_WRITE_ROLES (the server's
 *   OPEN_ENTITY_WRITE_ROLES.weightReadings) AND the independent
 *   `v2weightwrite` flag. «إضافة لصنف» writes inventory too, so it needs a
 *   second role map — WEIGHT_INVENTORY_ROLES — on top of both. The scale
 *   itself is a local calculator and stays usable; no write control is drawn
 *   unless every lock is open.
 *
 * PARTIAL FAILURE IS STATED, NOT HIDDEN
 *   «إضافة لصنف» is two writes (the reading, then the item's stored weight).
 *   If the second fails after the first, the screen says exactly which one
 *   landed instead of reporting one flat error for two different outcomes.
 *
 * TOTALS ARE CONVERTED, NEVER ADDED RAW
 *   «إجمالي الوزن» is in kilograms: grams and pounds are converted first, so
 *   1 kg + 500 g can never be reported as 501.
 */

import {
    formatInt, formatQty, localDateOnly,
} from '../data/reports-repo.js?v=4.9.145';
import { canWrite } from '../session.js?v=4.9.145';
import { weightWriteEnabled } from '../write-flags.js?v=4.9.145';
import {
    WEIGHT_WRITE_ROLES, WEIGHT_INVENTORY_ROLES, WEIGHT_UNITS, WEIGHT_UNIT_AR,
    fetchWeightReadings, fetchWeightInventory, readingToRow, readingsSummary,
    validateReading, buildReadingPayload, createWeightReading, addWeightToItem,
} from '../data/weight-repo.js?v=4.9.145';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const LOG_LIMIT = 30;

function kpisHtml(rows, today) {
    const s = readingsSummary(rows, today);
    const last = s.last
        ? `${s.last.date || '—'}${s.last.time ? ` · ${s.last.time}` : ''}`
        : '—';
    return `<ul class="erp-kpis" aria-label="مؤشرات الميزان — محسوبة من القراءات المقروءة">
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="scale"></i></span><span class="erp-kpi__label">قراءات اليوم</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(s.todayCount)}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="chart"></i></span><span class="erp-kpi__label">إجمالي القراءات</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatInt(s.count)}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="package"></i></span><span class="erp-kpi__label">إجمالي الوزن</span></div><div class="erp-kpi__value"><span class="erp-num" dir="ltr">${formatQty(s.totalKg)}</span> <span class="erp-text-sm erp-text-muted">كجم</span></div><div class="erp-kpi__foot"><span class="erp-kpi__hint">بعد تحويل الجرام والرطل — لا جمع وحدات مختلفة كما هي${s.unconverted ? ` · ${formatInt(s.unconverted)} قراءة بوحدة غير معروفة لم تُحوَّل` : ''}</span></div></li>
      <li class="erp-kpi"><div class="erp-kpi__top"><span class="erp-kpi__icon" aria-hidden="true"><i class="ji" data-i="refresh"></i></span><span class="erp-kpi__label">آخر قراءة</span></div><div class="erp-kpi__value erp-text-sm" dir="ltr">${esc(last)}</div></li>
    </ul>`;
}

function unitButtonsHtml(unit) {
    return WEIGHT_UNITS.map((u) => `<button type="button" class="erp-scale__unit-btn${u === unit ? ' is-active' : ''}"
      data-v2-unit="${u}" aria-pressed="${u === unit}">${WEIGHT_UNIT_AR[u]}</button>`).join('');
}

function logHtml(rows) {
    const latest = rows.slice(0, LOG_LIMIT);
    if (!latest.length) {
        return `<div class="erp-state" role="status">
          <span class="erp-state__title">لا قراءات مسجّلة</span>
          <span>${'كل قراءة تُسجَّل هنا بوقتها ووحدتها، ومن سجّلها.'}</span>
        </div>`;
    }
    return `<div class="erp-weight-log__scroll">
      <table class="erp-weight-log__table">
        <thead><tr>
          <th scope="col">التاريخ</th><th scope="col">الوقت</th>
          <th scope="col">الوزن</th><th scope="col">بالكيلوجرام</th>
          <th scope="col">الصنف</th><th scope="col">ملاحظات</th>
        </tr></thead>
        <tbody>
          ${latest.map((r) => `<tr>
            <td><span class="erp-mono" dir="ltr">${esc(r.date || '—')}</span></td>
            <td><span class="erp-mono" dir="ltr">${esc(r.time || '—')}</span></td>
            <td><span dir="ltr"><span class="erp-num">${formatQty(r.weight)}</span> <span class="erp-text-sm erp-text-muted">${esc(r.unitAr)}</span></span></td>
            <td><span class="erp-num" dir="ltr">${r.kg === null ? '—' : formatQty(r.kg)}</span></td>
            <td>${r.itemName ? esc(r.itemName) : '—'}</td>
            <td class="erp-text-muted">${r.notes ? esc(r.notes) : '—'}${r.recordedBy ? `<span class="erp-text-sm"> · ${esc(r.recordedBy)}</span>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function itemFormHtml(items, canAdd) {
    if (!canAdd) {return '';}
    const options = items
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar'))
        .map((i) => `<option value="${esc(i.id)}">${esc(i.name)}${i.unit ? ` (${esc(i.unit)})` : ''}</option>`)
        .join('');
    return `<form class="erp-scale__item-form" data-v2-if novalidate>
      <div class="erp-scale__item-grid">
        <label class="erp-field"><span>الصنف</span>
          <select class="erp-select" name="itemId" required>${options || '<option value="">لا أصناف في المخزون</option>'}</select>
        </label>
        <label class="erp-field"><span>ملاحظات</span>
          <input class="erp-input" name="notes" maxlength="2000" placeholder="اختياري">
        </label>
      </div>
      <p class="erp-text-sm erp-text-muted" data-v2-if-preview></p>
      <p class="erp-text-sm erp-text-danger" data-v2-if-err role="alert" hidden></p>
      <div class="erp-row">
        <button type="submit" class="erp-btn erp-btn--primary erp-btn--sm" ${items.length ? '' : 'disabled'}>
          <i class="ji" data-i="save" aria-hidden="true"></i><span>حفظ القراءة وإضافة الوزن</span>
        </button>
        <button type="button" class="erp-btn erp-btn--ghost erp-btn--sm" data-v2-if-x>إلغاء</button>
      </div>
    </form>`;
}

function template(writable, canAdd) {
    return `
      <div class="erp-v2-weight">
        <div class="erp-dash-head">
          <div>
            <h2 class="erp-dash-title">الميزان
              <span class="erp-eyebrow" dir="ltr" lang="en">Scale</span>
            </h2>
            <div class="erp-dash-sub" data-v2-note role="status" aria-live="polite"></div>
          </div>
          <div class="erp-dash-controls">
            <button type="button" class="erp-btn erp-btn--sm" data-v2-reload aria-label="تحديث">
              <i class="ji" data-i="refresh" aria-hidden="true"></i><span>تحديث</span>
            </button>
          </div>
        </div>
        <div data-v2-kpis></div>
        <div class="erp-weight-grid">
          <section class="erp-card erp-scale" aria-label="الميزان الرقمي">
            <div class="erp-card__head">
              <h3 class="erp-card__title">الميزان الرقمي</h3>
              <span class="erp-text-sm erp-text-muted">قراءة محلية — لا تُسجَّل حتى تحفظ</span>
            </div>
            <div class="erp-card__body">
              <div class="erp-scale__display">
                <output class="erp-scale__value" data-v2-value dir="ltr" aria-live="polite">0</output>
                <span class="erp-scale__unit" data-v2-unit-label>${WEIGHT_UNIT_AR.kg}</span>
              </div>
              <div class="erp-scale__steps" role="group" aria-label="ضبط الوزن">
                <button type="button" class="erp-btn erp-btn--sm" data-v2-step="-1">− 1</button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-step="-0.1">− 0.1</button>
                <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-reset>تصفير</button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-step="0.1">+ 0.1</button>
                <button type="button" class="erp-btn erp-btn--sm" data-v2-step="1">+ 1</button>
              </div>
              <div class="erp-scale__units" role="group" aria-label="وحدة الوزن">
                ${unitButtonsHtml('kg')}
              </div>
              <div class="erp-scale__actions">
                ${writable ? `<label class="erp-field erp-scale__notes"><span>ملاحظات القراءة</span>
                  <input class="erp-input" data-v2-notes maxlength="2000" placeholder="اختياري">
                </label>
                <div class="erp-row">
                  <button type="button" class="erp-btn erp-btn--primary" data-v2-record>
                    <i class="ji" data-i="file-text" aria-hidden="true"></i><span>تسجيل القراءة</span>
                  </button>
                  ${canAdd ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-to-item>
                    <i class="ji" data-i="package" aria-hidden="true"></i><span>إضافة لصنف</span>
                  </button>` : ''}
                </div>` : `<p class="erp-text-sm erp-text-muted" data-v2-ro>
                  الكتابة غير متاحة الآن — إما الصلاحية لا تسمح أو علم
                  <span class="erp-mono" dir="ltr">v2weightwrite</span> مغلق.
                  الميزان يبقى حاسبة محلية، والسجل يُقرأ كما هو.
                </p>`}
              </div>
              <div data-v2-if-host hidden></div>
            </div>
          </section>
          <section class="erp-card erp-weight-log">
            <div class="erp-card__head">
              <h3 class="erp-card__title">سجل القراءات</h3>
              <span class="erp-badge" data-tone="info" data-v2-log-count>0 قراءة</span>
            </div>
            <div class="erp-card__body" data-v2-log></div>
          </section>
        </div>
      </div>`;
}

/**
 * @param {ParentNode} host
 * @param {{role?: string|null, userName?: string, notify?: (message:string, kind?:string)=>void,
 *          confirmFn?: (message:string)=>boolean}} [ctx]
 */
export function mountWeightScreen(host, ctx = {}) {
    const writable = canWrite(ctx.role, WEIGHT_WRITE_ROLES) && weightWriteEnabled();
    const canAdd = writable && canWrite(ctx.role, WEIGHT_INVENTORY_ROLES);
    const notify = typeof ctx.notify === 'function' ? ctx.notify : (m) => console.info('[V2 weight]', m);
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn
        : (m) => (typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    const recordedBy = String(ctx.userName || '').trim();

    let readings = [];
    let items = [];
    let currentWeight = 0;
    let unit = 'kg';
    let loading = false;
    let queued = false;
    let saving = false;
    let itemFormOpen = false;

    host.insertAdjacentHTML('beforeend', template(writable, canAdd));
    const el = host.lastElementChild;
    const q = (sel) => el.querySelector(sel);
    const noteEl = q('[data-v2-note]');
    const kpisHost = q('[data-v2-kpis]');
    const logHost = q('[data-v2-log]');
    const logCount = q('[data-v2-log-count]');
    const valueEl = q('[data-v2-value]');
    const unitLabelEl = q('[data-v2-unit-label]');
    const itemHost = q('[data-v2-if-host]');
    const notesEl = q('[data-v2-notes]');

    const say = (m) => { if (noteEl) {noteEl.textContent = m;} };

    function drawScale() {
        if (valueEl) {valueEl.textContent = formatQty(currentWeight);}
        if (unitLabelEl) {unitLabelEl.textContent = WEIGHT_UNIT_AR[unit] || unit;}
    }

    function drawUnits() {
        for (const btn of el.querySelectorAll('[data-v2-unit]')) {
            const active = btn.dataset.v2Unit === unit;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', String(active));
        }
    }

    function draw() {
        const rows = readings.map(readingToRow);
        kpisHost.innerHTML = kpisHtml(readings, localDateOnly());
        logHost.innerHTML = logHtml(rows);
        if (logCount) {
            logCount.textContent = `${formatInt(rows.length)} قراءة`;
        }
        drawScale();
        drawUnits();
    }

    function resetScale() {
        currentWeight = 0;
        drawScale();
    }

    function itemPreview() {
        if (!itemFormOpen) {return;}
        const select = itemHost.querySelector('select[name="itemId"]');
        const preview = itemHost.querySelector('[data-v2-if-preview]');
        if (!select || !preview) {return;}
        const item = items.find((i) => String(i.id) === String(select.value));
        if (!item) {preview.textContent = ''; return;}
        const current = Number(item.weight) || 0;
        const next = Number((current + unitToKg(currentWeight, unit)).toFixed(3));
        preview.textContent = `الوزن المخزّن للصنف: ${formatQty(current)} كجم ← بعد الإضافة: ${formatQty(next)} كجم.`;
    }

    function unitToKg(weight, u) {
        const w = Number(weight) || 0;
        if (u === 'g') {return w / 1000;}
        if (u === 'lb') {return w * 0.453592;}
        return w;
    }

    function openItemForm() {
        if (!canAdd || saving) {return;}
        if (!items.length) {
            say('لا أصناف في المخزون — لا يمكن إضافة وزن لصنف.');
            return;
        }
        itemFormOpen = true;
        itemHost.hidden = false;
        itemHost.innerHTML = itemFormHtml(items, canAdd);
        itemPreview();
        const select = itemHost.querySelector('select[name="itemId"]');
        if (select && typeof select.focus === 'function') {select.focus();}
    }

    function closeItemForm() {
        itemFormOpen = false;
        itemHost.hidden = true;
        itemHost.innerHTML = '';
    }

    async function reload() {
        if (loading) {queued = true; return;}
        loading = true;
        say('جارٍ قراءة قراءات الميزان والمخزون…');
        try {
            const [readingsRes, itemsRes] = await Promise.allSettled([
                fetchWeightReadings(), fetchWeightInventory(),
            ]);
            if (!el.isConnected) {return;}
            const errors = [];
            if (readingsRes.status === 'fulfilled') {readings = readingsRes.value;}
            else {
                readings = [];
                errors.push(`تعذّر تحميل قراءات الميزان: ${(readingsRes.reason && readingsRes.reason.message) || 'خطأ'}`);
            }
            if (itemsRes.status === 'fulfilled') {items = itemsRes.value;}
            else {
                items = [];
                errors.push(`تعذّر تحميل المخزون — إضافة الوزن لصنف غير متاحة الآن: ${(itemsRes.reason && itemsRes.reason.message) || 'خطأ'}`);
                closeItemForm();
            }
            say(errors.join(' · '));
            draw();
        } finally {
            loading = false;
            if (queued && el.isConnected) {queued = false; reload();}
        }
    }

    async function record() {
        if (!writable || saving) {return;}
        const errors = validateReading(currentWeight);
        if (errors.length) {say(errors[0].message); return;}
        saving = true;
        const button = q('[data-v2-record]');
        if (button) {button.disabled = true;}
        try {
            const notes = notesEl ? notesEl.value : '';
            await createWeightReading(buildReadingPayload({
                weight: currentWeight, unit, notes, recordedBy,
            }));
            if (!el.isConnected) {return;}
            notify(`تم تسجيل الوزن: ${formatQty(currentWeight)} ${WEIGHT_UNIT_AR[unit] || unit}`);
            if (notesEl) {notesEl.value = '';}
            say('');
            resetScale();
            closeItemForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            say((e && e.message) || 'تعذّر تسجيل القراءة');
        } finally {
            saving = false;
            if (button) {button.disabled = false;}
        }
    }

    async function addToItem(form) {
        if (!canAdd || saving) {return;}
        const select = form.querySelector('select[name="itemId"]');
        const item = items.find((i) => String(i.id) === String(select && select.value));
        if (!item) {
            say('اختر صنفًا من المخزون');
            return;
        }
        const errors = validateReading(currentWeight);
        if (errors.length) {say(errors[0].message); return;}
        if (!confirmFn(`إضافة ${formatQty(currentWeight)} ${WEIGHT_UNIT_AR[unit] || unit} إلى وزن الصنف «${item.name}»؟`)) {return;}
        saving = true;
        const buttons = form.querySelectorAll('button');
        for (const b of buttons) {b.disabled = true;}
        let readingSaved = false;
        try {
            const notes = form.querySelector('input[name="notes"]');
            const payload = buildReadingPayload({
                weight: currentWeight, unit, item, recordedBy,
                notes: notes ? notes.value : '',
            });
            await createWeightReading(payload);
            readingSaved = true;
            const { nextWeight } = await addWeightToItem(item, currentWeight, unit);
            if (!el.isConnected) {return;}
            notify(`أُضيف ${formatQty(currentWeight)} ${WEIGHT_UNIT_AR[unit] || unit} إلى «${item.name}» — الوزن المخزّن الآن ${formatQty(nextWeight)} كجم`);
            say('');
            resetScale();
            closeItemForm();
            await reload();
        } catch (e) {
            if (!el.isConnected) {return;}
            const message = (e && e.message) || 'خطأ';
            // Two writes, two outcomes — say exactly which one landed.
            say(readingSaved
                ? `سُجّلت القراءة، لكن تعذّر تحديث وزن الصنف: ${message}`
                : `تعذّرت إضافة الوزن لصنف «${item.name}»: ${message}`);
            if (readingSaved) {await reload();}
        } finally {
            saving = false;
            for (const b of buttons) {b.disabled = false;}
        }
    }

    el.addEventListener('click', (event) => {
        const step = event.target.closest('[data-v2-step]');
        if (step) {
            const delta = Number(step.dataset.v2Step) || 0;
            currentWeight = Math.max(0, Math.round((currentWeight + delta) * 1000) / 1000);
            drawScale();
            itemPreview();
            return;
        }
        if (event.target.closest('[data-v2-reset]')) {
            resetScale();
            itemPreview();
            return;
        }
        const unitBtn = event.target.closest('[data-v2-unit]');
        if (unitBtn) {
            unit = WEIGHT_UNITS.includes(unitBtn.dataset.v2Unit) ? unitBtn.dataset.v2Unit : 'kg';
            drawScale();
            drawUnits();
            itemPreview();
            return;
        }
        if (event.target.closest('[data-v2-reload]')) {reload(); return;}
        if (event.target.closest('[data-v2-record]')) {record(); return;}
        if (event.target.closest('[data-v2-to-item]')) {
            if (itemFormOpen) {closeItemForm();} else {openItemForm();}
            return;
        }
        if (event.target.closest('[data-v2-if-x]')) {closeItemForm();}
    });

    el.addEventListener('change', (event) => {
        if (event.target.matches('select[name="itemId"]')) {itemPreview();}
    });

    el.addEventListener('submit', (event) => {
        const form = event.target.closest('[data-v2-if]');
        if (!form) {return;}
        event.preventDefault();
        addToItem(form);
    });

    reload();

    return {
        el, reload,
        getState: () => ({ weight: currentWeight, unit }),
        destroy() { el.remove(); },
    };
}
