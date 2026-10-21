/**
 * features/veg-requests.js — طلبات شراء الخضار (المطبخ → المخازن) (2026-10-04)
 * ────────────────────────────────────────────────────────────────────────────
 * صفحة مخصصة: الشيف/السو شيف يبني طلب خضار من قايمة مصنّفة جاهزة ويرسله
 * للمخازن، والطرفان يطبعان نموذج A4 احترافي (ترويسة + توقيعات + رقم طلب).
 * المخازن يشوف الطلبات الواردة ويستلمها بنقرة، والإشعار اللحظي عبر veg_request:new.
 * الـ API: /api/veg-requests (catelog / إنشاء / سجل / استلام / إلغاء / طباعة).
 */
'use strict';

let _vegTab = 'new';            // 'new' | 'log'
let _vegPriority = 'normal';    // 'normal' | 'urgent'
let _vegCatalog = null;         // {categories:[{key,label,items:[{name,unit}]}], units:[]}
let _vegCustomSeq = 0;
let _vegFilter = '';            // فلتر سجل الطلبات

function vegCanCreate() { return ['sous_chef', 'admin', 'owner'].includes(STATE.currentUser?.role); }
function vegCanPrice() { return ['warehouse', 'admin', 'owner'].includes(STATE.currentUser?.role); }
function vegIsBoss() { return ['admin', 'owner'].includes(STATE.currentUser?.role); }
// الاستلام والتوقيع: السو شيف فقط + الإدارة (قرار المالك 2026-10-10)
function vegCanReceive() {
    const me = STATE.currentUser || {};
    if (['admin', 'owner'].includes(me.role)) {return true;}
    return me.role === 'sous_chef';
}

function vegStatusBadge(status) {
    if (status === 'received') {return '<span class="badge bdg-green">✔ تم الاستلام</span>';}
    if (status === 'priced') {return '<span class="badge bdg-blue">💰 تم التسعير</span>';}
    if (status === 'cancelled') {return '<span class="badge bdg-gray">✖ ملغي</span>';}
    return '<span class="badge bdg-gold">⏳ قيد الانتظار</span>';
}

// ─── الحاوية الرئيسية (تُستدعى من page-router عبر await) ────────────────────

async function renderVegRequestsPage() {
    const content = document.getElementById('content');
    if (!content) {return;}
    _vegTab = vegCanCreate() ? 'new' : 'log';
    content.innerHTML = `
    <div class="veg-wrap">
      <div class="veg-hero">
        <div>
          <h2 style="margin:0 0 4px"><i class=ji data-i=shopping-cart></i> طلب شراء خضار</h2>
          <div style="color:var(--text2);font-size:13px">من مطبخ المطعم إلى المخازن — قايمة جاهزة، إرسال بنقرة، وطباعة احترافية للطرفين</div>
        </div>
        <div id="vegStats" class="veg-stats">…</div>
      </div>
      <div class="veg-tabs">
        ${vegCanCreate() ? `<button type="button" class="veg-tab" data-t="new" data-karim-action="vegSwitchTab" data-karim-args="[&quot;new&quot;]"><i class=ji data-i=chef-hat></i> طلب جديد</button>` : ''}
        <button type="button" class="veg-tab" data-t="log" data-karim-action="vegSwitchTab" data-karim-args="[&quot;log&quot;]"><i class=ji data-i=clipboard-list></i> سجل الطلبات</button>
      </div>
      <div id="vegNewTab"></div>
      <div id="vegLogTab"></div>
    </div>
    <style>
      .veg-wrap{max-width:1100px;margin:0 auto}
      .veg-hero{display:flex;justify-content:space-between;gap:16px;align-items:center;flex-wrap:wrap;
        background:linear-gradient(135deg,var(--bg3),var(--bg2));border:1px solid var(--border);border-radius:16px;
        padding:18px 22px;margin-bottom:14px;border-right:4px solid var(--gold)}
      .veg-stats{display:flex;gap:10px;flex-wrap:wrap}
      .veg-stat{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:8px 14px;text-align:center;min-width:86px}
      .veg-stat b{display:block;font-size:20px;color:var(--gold)}
      .veg-stat span{font-size:11px;color:var(--text2)}
      .veg-tabs{display:flex;gap:8px;margin-bottom:14px}
      .veg-tab{background:var(--bg3);border:1px solid var(--border);color:var(--text2);border-radius:999px;
        padding:9px 20px;font-weight:700;cursor:pointer;font-size:14px}
      .veg-tab.active{background:var(--gold);border-color:var(--gold);color:#1a1a2e}
      .veg-card{background:var(--bg3);border:1px solid var(--border);border-radius:16px;padding:18px 20px;margin-bottom:14px}
      .veg-cat-title{display:flex;align-items:center;gap:8px;font-weight:800;color:var(--gold);margin:14px 0 10px;font-size:15px}
      .veg-cat-title:first-child{margin-top:0}
      .veg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:10px}
      .veg-item{background:var(--bg2);border:1.5px solid var(--border);border-radius:12px;padding:10px 12px;transition:border-color .15s}
      .veg-item.filled{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
      .veg-item .vi-name{font-weight:700;font-size:14px;margin-bottom:7px;display:flex;justify-content:space-between;gap:6px;align-items:center}
      .veg-item .vi-unit{font-size:10.5px;color:var(--text2);background:var(--bg3);border-radius:999px;padding:1px 8px;font-weight:700}
      .veg-row{display:flex;gap:6px;align-items:center}
      .veg-row input[type=number]{width:76px;padding:6px 8px;border-radius:8px}
      .veg-row select{padding:6px 6px;border-radius:8px;flex:1;min-width:0}
      .veg-search{display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
      .veg-search input{flex:1;min-width:180px;max-width:340px;padding:9px 14px;border-radius:10px}
      .veg-summary{position:sticky;bottom:12px;z-index:5;background:var(--bg3);border:1.5px solid var(--gold);
        border-radius:16px;padding:14px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap;box-shadow:0 8px 24px rgba(0,0,0,.25)}
      .veg-summary .vs-count{font-weight:900;font-size:15px}
      .veg-priority{display:flex;border:1px solid var(--border);border-radius:999px;overflow:hidden}
      .veg-priority button{border:0;background:transparent;color:var(--text2);padding:7px 16px;font-weight:700;cursor:pointer}
      .veg-priority button.on{background:var(--red);color:#fff}
      .veg-priority button.on.normal{background:var(--green, #2ecc71)}
      .veg-reqcard{background:var(--bg3);border:1px solid var(--border);border-radius:16px;padding:16px 18px;margin-bottom:12px}
      .veg-reqcard.urgent{border-right:4px solid var(--red)}
      .veg-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
      .veg-chip{background:var(--bg2);border:1px solid var(--border);border-radius:999px;padding:3px 11px;font-size:12.5px}
      .veg-chip b{color:var(--gold)}
      .veg-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
      .veg-success{border:1.5px solid var(--green,#2ecc71);background:rgba(46,204,113,.08);border-radius:16px;padding:20px;text-align:center;margin-bottom:14px}
      .veg-custom-row{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}
      .veg-custom-row input.name{flex:2;min-width:140px;padding:8px 10px;border-radius:8px}
      .veg-custom-row input.qty{width:80px;padding:8px 8px;border-radius:8px}
      .veg-custom-row select{padding:8px;border-radius:8px}
      .veg-custom-row input.note{flex:2;min-width:140px;padding:8px 10px;border-radius:8px}
      @media (max-width:640px){ .veg-grid{grid-template-columns:1fr 1fr} .veg-hero{padding:14px} }
    </style>`;

    // الكتالوج (يُجلب مرة واحدة ويُخزَّن)
    if (!_vegCatalog) {
        try { _vegCatalog = await apiFetch('/veg-requests/catalog'); }
        catch (e) { _vegCatalog = { categories: [], units: ['كجم'] }; toast('تعذر تحميل قايمة الخضار: ' + e.message, 'error'); }
    }
    vegSwitchTab(_vegTab);
    vegLoadStats();
}

// ─── التبويبات ───────────────────────────────────────────────────────────────

function vegSwitchTab(tab) {
    _vegTab = tab;
    document.querySelectorAll('.veg-tab').forEach((b) => b.classList.toggle('active', b.dataset.t === tab));
    const newTab = document.getElementById('vegNewTab');
    const logTab = document.getElementById('vegLogTab');
    if (!newTab || !logTab) {return;}
    newTab.style.display = tab === 'new' ? '' : 'none';
    logTab.style.display = tab === 'log' ? '' : 'none';
    if (tab === 'new' && !newTab.dataset.built) { vegRenderNewTab(); }
    if (tab === 'log' && !logTab.dataset.built) { loadVegRequestsLog(); }
}

// ─── تبويب الطلب الجديد ──────────────────────────────────────────────────────

function vegRenderNewTab() {
    const box = document.getElementById('vegNewTab');
    if (!box) {return;}
    const me = STATE.currentUser || {};
    const today = new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const units = _vegCatalog?.units || ['كجم'];
    const unitOptions = (def) => units.map((u) => `<option value="${esc(u)}" ${u === def ? 'selected' : ''}>${esc(u)}</option>`).join('');
    const catsHtml = (_vegCatalog?.categories || []).map((cat) => `
      <div class="veg-cat-title"><i class=ji data-i=leaf></i> ${esc(cat.label)}</div>
      <div class="veg-grid">
        ${cat.items.map((it, _i) => `
          <div class="veg-item" data-veg-item="${esc(it.name)}" data-veg-cat="${esc(cat.key)}">
            <div class="vi-name"><span>${esc(it.name)}</span><span class="vi-unit">${esc(it.unit)}</span></div>
            <div class="veg-row">
              <input type="number" min="0" step="any" placeholder="الكمية" data-veg-qty="${esc(it.name)}" data-veg-unit="${esc(it.unit)}" data-karim-action="vegMarkFilled" data-karim-event="input" data-karim-pass="element">
              <select data-veg-unit-sel="${esc(it.name)}">${unitOptions(it.unit)}</select>
            </div>
          </div>`).join('')}
      </div>`).join('');
    box.innerHTML = `
    <div id="vegSuccessBox"></div>
    <div class="veg-card">
      <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="font-size:13.5px;color:var(--text2)">
          <b style="color:var(--text)">من:</b> مطبخ المطعم — ${esc(me.name || me.username || '')} <span class="badge bdg-blue">${esc(me.role || '')}</span>
          &nbsp;•&nbsp; <b style="color:var(--text)">إلى:</b> المخازن &nbsp;•&nbsp; ${esc(today)}
        </div>
        <div class="veg-search" style="margin:0">
          <input type="text" placeholder="🔍 ابحث عن صنف…" data-karim-action="vegSearchItems" data-karim-event="input" data-karim-pass="value">
        </div>
      </div>
      <div id="vegCatalog">${catsHtml}</div>
      <div class="veg-cat-title"><i class=ji data-i=plus></i> صنف غير موجود في القايمة</div>
      <div id="vegCustomRows"></div>
      <button type="button" class="btn btn-blue btn-sm" data-karim-action="vegAddCustomRow"><i class=ji data-i=plus></i> إضافة صنف حر</button>
    </div>
    <div class="veg-summary">
      <div class="vs-count">الأصناف: <span id="vegSelCount" style="color:var(--gold)">0</span></div>
      <div class="veg-priority">
        <button type="button" id="vegPrNormal" class="on normal" data-karim-action="vegSetPriority" data-karim-args="[&quot;normal&quot;]">عادي</button>
        <button type="button" id="vegPrUrgent" data-karim-action="vegSetPriority" data-karim-args="[&quot;urgent&quot;]">🚨 عاجل</button>
      </div>
      <input type="text" id="vegNotes" placeholder="ملاحظات للمخازن (اختياري) — مثل: التوريد قبل ٩ صباحًا" style="flex:1;min-width:180px;padding:9px 12px;border-radius:10px">
      <button type="button" class="btn btn-gold" style="font-size:15px;padding:11px 26px" data-karim-action="vegSendRequest"><i class=ji data-i=send></i> إرسال الطلب للمخازن</button>
    </div>`;
    box.dataset.built = '1';
    vegUpdateCount();
}

function vegMarkFilled(input) {
    const card = input.closest('.veg-item');
    if (card) {card.classList.toggle('filled', Number(input.value) > 0);}
    vegUpdateCount();
}

function vegSearchItems(q) {
    const term = String(q || '').trim().toLowerCase();
    document.querySelectorAll('#vegCatalog .veg-item').forEach((card) => {
        const name = card.dataset.vegItem || '';
        const catTitle = card.parentElement?.previousElementSibling;
        card.style.display = (!term || name.toLowerCase().includes(term) || (window.arSearchIncludes?window.arSearchIncludes(name, term):false)) ? '' : 'none';
        if (catTitle && catTitle.classList.contains('veg-cat-title')) {
            const anyVisible = [...card.parentElement.querySelectorAll('.veg-item')].some((c) => c.style.display !== 'none');
            catTitle.style.display = anyVisible ? '' : 'none';
        }
    });
}

function vegAddCustomRow() {
    const box = document.getElementById('vegCustomRows');
    if (!box) {return;}
    _vegCustomSeq += 1;
    const n = _vegCustomSeq;
    const units = _vegCatalog?.units || ['كجم'];
    const row = document.createElement('div');
    row.className = 'veg-custom-row';
    row.innerHTML = `
      <input type="text" class="name" placeholder="اسم الصنف" data-veg-cname="c${n}">
      <input type="number" class="qty" min="0" step="any" placeholder="الكمية" data-veg-cqty="c${n}">
      <select data-veg-cunit="c${n}">${units.map((u) => `<option value="${esc(u)}">${esc(u)}</option>`).join('')}</select>
      <input type="text" class="note" placeholder="ملاحظة (اختياري)" data-veg-cnote="c${n}">
      <button type="button" class="btn btn-red btn-sm" data-karim-action="this.parentElement.remove" data-karim-also="vegUpdateCount">✖</button>`;
    box.appendChild(row);
    row.querySelector('.qty').addEventListener('input', vegUpdateCount);
}

function vegSetPriority(p) {
    _vegPriority = p === 'urgent' ? 'urgent' : 'normal';
    const n = document.getElementById('vegPrNormal');
    const u = document.getElementById('vegPrUrgent');
    if (n) {n.classList.toggle('on', _vegPriority === 'normal');}
    if (u) {u.classList.toggle('on', _vegPriority === 'urgent');}
}

function vegCollectItems() {
    const items = [];
    document.querySelectorAll('#vegCatalog [data-veg-qty]').forEach((inp) => {
        const qty = Number(inp.value);
        if (Number.isFinite(qty) && qty > 0) {
            const name = inp.dataset.vegQty;
            const unitSel = document.querySelector(`[data-veg-unit-sel="${CSS.escape(name)}"]`);
            items.push({ name, qty, unit: unitSel ? unitSel.value : inp.dataset.vegUnit });
        }
    });
    document.querySelectorAll('#vegCustomRows [data-veg-cname]').forEach((inp) => {
        const key = inp.dataset.vegCname;
        const qty = Number(document.querySelector(`[data-veg-cqty="${key}"]`)?.value);
        const name = inp.value.trim();
        if (name && Number.isFinite(qty) && qty > 0) {
            items.push({
                name,
                qty,
                unit: document.querySelector(`[data-veg-cunit="${key}"]`)?.value || 'وحدة',
                note: document.querySelector(`[data-veg-cnote="${key}"]`)?.value.trim() || null,
            });
        }
    });
    return items;
}

function vegUpdateCount() {
    const el = document.getElementById('vegSelCount');
    if (el) {el.textContent = String(vegCollectItems().length);}
}

async function vegSendRequest() {
    const items = vegCollectItems();
    if (!items.length) {toast('اكتب كمية صنف واحد على الأقل قبل الإرسال', 'error'); return;}
    const notes = document.getElementById('vegNotes')?.value.trim() || '';
    try {
        const res = await apiFetch('/veg-requests', {
            method: 'POST',
            body: JSON.stringify({ items, notes, priority: _vegPriority }),
        });
        toast(`تم إرسال الطلب ${res.request.request_no} للمخازن ✔`, 'success');
        vegShowSuccess(res.request);
        vegLoadStats();
        const logTab = document.getElementById('vegLogTab');
        if (logTab) {logTab.dataset.built = '';}
    } catch (e) {toast(e.message || 'فشل إرسال الطلب', 'error');}
}

function vegShowSuccess(req) {
    const box = document.getElementById('vegSuccessBox');
    if (!box) {return;}
    box.innerHTML = `
    <div class="veg-success">
      <div style="font-size:38px">🥬</div>
      <h3 style="margin:6px 0">تم إرسال الطلب للمخازن</h3>
      <div style="font-size:15px">رقم الطلب: <b style="color:var(--gold);font-size:19px">${esc(req.request_no)}</b> — ${esc(String(req.items_count))} صنف${req.priority === 'urgent' ? ' — <span style="color:var(--red);font-weight:800">عاجل 🚨</span>' : ''}</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap">
        <button type="button" class="btn btn-gold" data-karim-action="vegPrint" data-karim-arg0="${Number(req.id)}"><i class=ji data-i=printer></i> طباعة الفورمة</button>
        <button type="button" class="btn btn-blue" data-karim-action="vegResetForm"><i class=ji data-i=plus></i> طلب جديد</button>
        <button type="button" class="btn btn-sm" data-karim-action="vegSwitchTab" data-karim-args="[&quot;log&quot;]"><i class=ji data-i=clipboard-list></i> سجل الطلبات</button>
      </div>
    </div>`;
    const newTab = document.getElementById('vegNewTab');
    if (newTab) {setTimeout(() => { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);}
}

function vegResetForm() {
    document.querySelectorAll('#vegCatalog [data-veg-qty]').forEach((inp) => { inp.value = ''; });
    document.querySelectorAll('#vegCatalog .veg-item').forEach((c) => c.classList.remove('filled'));
    const custom = document.getElementById('vegCustomRows');
    if (custom) {custom.innerHTML = '';}
    const notes = document.getElementById('vegNotes');
    if (notes) {notes.value = '';}
    const box = document.getElementById('vegSuccessBox');
    if (box) {box.innerHTML = '';}
    vegUpdateCount();
}

// ─── سجل الطلبات ─────────────────────────────────────────────────────────────

async function loadVegRequestsLog() {
    const box = document.getElementById('vegLogTab');
    if (!box) {return;}
    try {
        const q = _vegFilter ? `&status=${encodeURIComponent(_vegFilter)}` : '';
        const res = await apiFetch('/veg-requests?limit=60' + q);
        const requests = res.requests || [];
        window._vegLog = requests;
        box.innerHTML = `
        <div class="veg-card">
          <div class="veg-search">
            <button type="button" class="btn btn-blue btn-sm" data-karim-action="loadVegRequestsLog"><i class=ji data-i=refresh></i> تحديث</button>
            ${[['', 'الكل'], ['pending', 'قيد الانتظار'], ['received', 'تم الاستلام'], ['cancelled', 'ملغي']].map(([v, l]) =>
                `<button type="button" class="veg-tab ${_vegFilter === v ? 'active' : ''}" style="padding:6px 16px" data-karim-action="vegSetFilter" data-karim-arg0="${v}">${l}</button>`).join('')}
          </div>
          <div id="vegLogList">${requests.length ? requests.map(vegRequestCard).join('') : '<div class="mcard u-empty">لا توجد طلبات — أول طلب من المطبخ هيظهر هنا</div>'}</div>
        </div>`;
        box.dataset.built = '1';
    } catch (e) {
        box.innerHTML = `<div class="mcard u-empty">تعذر تحميل السجل: ${esc(e.message)}</div>`;
    }
}

function vegSetFilter(v) {
    _vegFilter = v || '';
    const box = document.getElementById('vegLogTab');
    if (box) {box.dataset.built = '';}
    loadVegRequestsLog();
}

function vegRequestCard(r) {
    const items = Array.isArray(r.items) ? r.items : [];
    const dt = r.created_at ? new Date(r.created_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
    const rdt = r.received_at ? new Date(r.received_at).toLocaleString('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }) : null;
    const mine = Number(r.created_by) === Number(STATE.currentUser?.id);
    const canCancel = r.status === 'pending' && (mine || vegIsBoss());
    const chips = items.map((it) => `<span class="veg-chip" data-vc-name="${esc(it.name)}" data-vc-qty="${esc(String(it.qty))}" ${it.rejected ? 'style="text-decoration:line-through;opacity:.65"' : ''}>${it.rejected ? '✗ ' : ''}${esc(it.name)} <b>${esc(String(it.qty))}</b> ${esc(it.unit)}${it.rejected ? ' (مرفوض)' : it.price != null ? ` × ${esc(String(it.price))} = <b>${esc(String(it.lineTotal))}</b> ر.س` : ''}</span>`).join('');
    return `
    <div class="veg-reqcard ${r.priority === 'urgent' && r.status === 'pending' ? 'urgent' : ''}">
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div>
          <b style="font-size:15.5px;color:var(--gold)">${esc(r.request_no || ('#' + r.id))}</b>
          ${r.priority === 'urgent' ? '<span class="badge bdg-red">عاجل 🚨</span>' : ''}
          ${vegStatusBadge(r.status)}
        </div>
        <small style="color:var(--text2)">${esc(dt)} — بواسطة <b style="color:var(--text)">${esc(r.created_by_name || '—')}</b></small>
      </div>
      <div class="veg-chips">${chips}</div>
      ${r.notes ? `<div style="font-size:13px;color:var(--text2)">📝 ${esc(r.notes)}</div>` : ''}
      ${r.status === 'received' && r.received_by_name ? `<div style="font-size:13px;color:var(--green,#2ecc71);margin-top:6px">✔ استلمها ${esc(r.received_by_name)}${r.received_by_dept ? ' — قسم ' + esc(r.received_by_dept) : ''}${rdt ? ' — ' + esc(rdt) : ''}</div>` : ''}
      ${r.status === 'priced' ? `<div style="font-size:14px;margin-top:8px;color:var(--text)"><b style="color:var(--gold);font-size:17px">${esc(String(r.total))} ر.س</b> — محمّلة مصروف على قسم المطبخ (مصروف #${esc(String(r.expense_id || ''))})${r.priced_by_name ? ` — سعّرها ${esc(r.priced_by_name)}` : ''}</div>` : ''}
      ${r.status === 'cancelled' && r.cancelled_by_name ? `<div style="font-size:13px;color:var(--text2);margin-top:6px">ألغاها ${esc(r.cancelled_by_name)}</div>` : ''}
      <div class="veg-actions">
        <button type="button" class="btn btn-gold btn-sm" data-karim-action="vegPrint" data-karim-arg0="${Number(r.id)}"><i class=ji data-i=printer></i> طباعة</button>
        ${r.status === 'pending' && vegCanReceive() ? `<button type="button" class="btn btn-blue btn-sm" data-karim-action="vegToggleReceive" data-karim-arg0="${Number(r.id)}"><i class=ji data-i=check></i> استلام / إرجاع</button>` : ''}
        ${r.status === 'received' && vegCanPrice() ? `<button type="button" class="btn btn-blue btn-sm" data-karim-action="vegTogglePricing" data-karim-arg0="${Number(r.id)}">💰 سعرها</button>` : ''}
        ${vegCanEdit(r) ? `<button type="button" class="btn btn-blue btn-sm" data-karim-action="vegEditItems" data-karim-arg0="${Number(r.id)}"><i class=ji data-i=pencil></i> تعديل الكميات</button>` : ''}
        ${canCancel ? `<button type="button" class="btn btn-red btn-sm" data-karim-action="vegCancel" data-karim-arg0="${Number(r.id)}">✖ إلغاء</button>` : ''}
        ${r.print_count ? `<small style="align-self:center;color:var(--text2)">طُبع ${esc(String(r.print_count))} مرة</small>` : ''}
      </div>
      ${r.status === 'pending' && vegCanReceive() ? vegReceivePanel(r, items) : ''}
      ${r.status === 'received' && vegCanPrice() ? vegPricingPanel(r, items) : ''}
    </div>`;
}

/** لوحة استلام رئيس القسم: لكل صنف استلام أو ارجاع — المرفوض لا يُسعَّر لاحقًا */
function vegReceivePanel(r, items) {
    const rows = items.map((it) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
        <span style="flex:1;min-width:140px">${esc(it.name)} <small class="text-muted">(${esc(String(it.qty))} ${esc(it.unit)})</small></span>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px">المستلم: <input type="number" min="0" step="0.001" value="${esc(String(it.qty))}" data-vq-name="${esc(it.name)}" data-vq-max="${esc(String(it.qty))}" style="width:90px;padding:6px 8px;border-radius:8px" title="الكمية السليمة المستلمة — الباقي يُسجل تالفًا"></label>
        <label style="display:flex;align-items:center;gap:4px;font-size:13px">السعر: <input type="number" min="0" step="0.01" placeholder="سعر الوحدة" data-vp-recv="${Number(r.id)}" data-vp-name="${esc(it.name)}" style="width:90px;padding:6px 8px;border-radius:8px" title="سعر المندوب النهائي — لو سعّرت كل الأصناف يُعتمد الطلب مباشرة"></label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px"><input type="radio" name="vr_${Number(r.id)}" data-vr-item="${esc(it.name)}" value="ok" checked> استلام</label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:13px;color:var(--red)"><input type="radio" name="vr_${Number(r.id)}" data-vr-item="${esc(it.name)}" value="reject"> ارجاع / رفض</label>
      </div>`).join('');
    return `
    <div id="vegReceivePanel_${Number(r.id)}" style="display:none;border:1px solid var(--blue,#3b82f6);border-radius:12px;padding:12px 14px;margin-top:10px;background:var(--bg2)">
      <div style="font-weight:800;margin-bottom:8px">استلام الأصناف — حدد مستلَمًا أو مُرجَعًا لكل صنف</div>
      <div class="text-muted" style="font-size:12px;margin-bottom:8px">لو جزء تالف: اكتب الكمية <b>السليمة</b> في خانة المستلم — الحساب يكون على السليم فقط والباقي يُسجل تالفًا.<br>💰 لو كتبت <b>سعر كل الأصناف المقبولة</b> يُعتمد الطلب مباشرة بسعر المندوب — لو تركتها فارغة يبقى التسعير لخطوة لاحقة.</div>
      ${rows}
      <div style="display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <small class="text-muted">المرفوض لا يرجع للمخزن للتسعير ولا يُحمَّل مصروفًا</small>
        <button type="button" class="btn btn-gold btn-sm" data-karim-action="vegSubmitReceive" data-karim-arg0="${Number(r.id)}">تأكيد الاستلام</button>
      </div>
    </div>`;
}

function vegToggleReceive(id) {
    const panel = document.getElementById(`vegReceivePanel_${id}`);
    if (panel) {panel.style.display = panel.style.display === 'none' ? '' : 'none';}
}

async function vegSubmitReceive(id) {
    const panel = document.getElementById(`vegReceivePanel_${id}`);
    if (!panel) {return;}
    const rejections = [...panel.querySelectorAll('input[type=radio][value=reject]:checked')]
        .map((r) => r.dataset.vrItem).filter(Boolean);
    const rejectCount = panel.querySelectorAll('input[type=radio][value=reject]').length;
    if (rejections.length && rejections.length === rejectCount) {
        if (!window.confirm('رفض كل الأصناف؟ الطلب سيُستلم بلا أي صنف ولا يُسعَّر.')) {return;}
    }
    const quantities = [...panel.querySelectorAll('[data-vq-name]')].map((el) => ({
        name: el.getAttribute('data-vq-name'), receivedQty: Number(el.value),
    })).filter(q => q.name && Number.isFinite(q.receivedQty));
    // أسعار المندوب النهائية — تُرسل فقط لو سُعّرت كل الأصناف المقبولة (اعتماد مباشر)
    const rejSet = new Set(rejections);
    const prices = [];
    let need = 0;
    for (const inp of panel.querySelectorAll('[data-vp-recv]')) {
        const nm = inp.getAttribute('data-vp-name');
        if (!nm || rejSet.has(nm)) {continue;}
        need++;
        const v = String(inp.value || '').trim();
        if (v === '') {continue;}
        const p = Number(v);
        if (!Number.isFinite(p) || p < 0) {toast(`سعر غير سليم للصنف ${nm}`, 'error'); return;}
        prices.push({ name: nm, unitPrice: p });
    }
    if (prices.length && prices.length < need) {toast('سعّر كل الأصناف المقبولة أو اترك الأسعار فارغة للاستلام فقط', 'error'); return;}
    const body = { rejections, quantities };
    const direct = need > 0 && prices.length === need;
    if (direct) {body.prices = prices;}
    try {
        const res = await apiFetch(`/veg-requests/${id}/receive`, { method: 'POST', body: JSON.stringify(body) });
        toast(direct ? `تم الاستلام والاعتماد المباشر ✔ — الإجمالي ${res?.total ?? ''}` : (rejections.length ? `تم الاستلام — ${rejections.length} صنف مرفوض لن يُسعَّر` : 'تم استلام كل الأصناف ✔ (الحساب على الكميات السليمة)'), 'success');
        await loadVegRequestsLog();
        vegLoadStats();
    } catch (e) {toast(e.message || 'فشل تسجيل الاستلام', 'error');}
}

/** لوحة تسعير المخزن: سعر وحدة لكل صنف مقبول + الإجمالي الحي + تحميل المصروف.
 * الأصناف المرفوضة تظهر كسطر جامد «مرفوض» ولا تُسعَّر ولا تدخل الإجمالي. */
function vegPricingPanel(r, items) {
    const priced = items.filter((it) => !it.rejected);
    const rejectedRows = items.filter((it) => it.rejected)
        .map((it) => `<div style="font-size:12.5px;color:var(--red);margin-bottom:4px">✗ ${esc(it.name)} — مرفوض، لا يُسعَّر ولا يُحمَّل</div>`).join('');
    const rows = priced.map((it) => `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;flex-wrap:wrap">
        <span style="flex:1;min-width:120px">${esc(it.name)} <small class="text-muted">(${esc(String(it.qty))} ${esc(it.unit)})</small>${it.spoiledQty ? ` <span class="badge bdg-red" title="كمية تالفة لا تُحتسب">تالف: ${esc(String(it.spoiledQty))}</span>` : ''}</span>
        <input type="number" min="0" step="0.01" placeholder="سعر الوحدة" style="width:110px;padding:6px 8px;border-radius:8px"
               data-vp-price="${Number(r.id)}" data-vp-name="${esc(it.name)}" data-vp-qty="${esc(String(it.qty))}" data-karim-action="vegPriceCalc" data-karim-event="input" data-karim-arg0="${Number(r.id)}">
        <span style="width:80px;text-align:left" id="vpLine_${Number(r.id)}_${esc(it.name).replace(/"/g, '')}">—</span>
      </div>`).join('');
    const hasAccepted = priced.length > 0;
    return `
    <div id="vegPricePanel_${Number(r.id)}" style="display:none;border:1px solid var(--gold);border-radius:12px;padding:12px 14px;margin-top:10px;background:var(--bg2)">
      <div style="font-weight:800;margin-bottom:8px">💰 تسعير المخزن — سعر الوحدة لكل صنف مقبول</div>
      ${rejectedRows}
      ${rows}
      <div style="display:flex;gap:12px;align-items:center;margin-top:8px;flex-wrap:wrap">
        <b>الإجمالي (المقبول فقط): <span id="vpTotal_${Number(r.id)}">0.00</span> ر.س</b>
        <small class="text-muted">يُحمّل مصروف على قسم المطبخ تلقائياً عند التأكيد</small>
        ${hasAccepted ? `<button type="button" class="btn btn-gold btn-sm" data-karim-action="vegSubmitPrices" data-karim-arg0="${Number(r.id)}">تأكيد التسعير</button>` : '<small class="text-muted">لا صنف مقبول — التسعير غير متاح</small>'}
      </div>
    </div>`;
}

function vegTogglePricing(id) {
    const panel = document.getElementById(`vegPricePanel_${id}`);
    if (panel) {panel.style.display = panel.style.display === 'none' ? '' : 'none';}
}

function vegPriceCalc(id) {
    let total = 0;
    document.querySelectorAll(`[data-vp-price="${id}"]`).forEach((inp) => {
        const price = Number(inp.value);
        const qty = Number(inp.dataset.vpQty);
        const line = Number.isFinite(price) && price >= 0 && Number.isFinite(qty)
            ? Math.round(qty * price * 100) / 100 : 0;
        const lineEl = document.getElementById(`vpLine_${id}_${(inp.dataset.vpName || '').replace(/"/g, '')}`);
        if (lineEl) {lineEl.textContent = inp.value === '' ? '—' : line.toFixed(2) + ' ر.س';}
        total += line;
    });
    const totalEl = document.getElementById(`vpTotal_${id}`);
    if (totalEl) {totalEl.textContent = total.toFixed(2);}
}

async function vegSubmitPrices(id) {
    const prices = [...document.querySelectorAll(`[data-vp-price="${id}"]`)].map((inp) => ({
        name: inp.dataset.vpName || '',
        unitPrice: Number(inp.value),
    }));
    if (prices.some((p) => !p.name || !Number.isFinite(p.unitPrice) || p.unitPrice < 0)) {
        toast('سعّر كل الأصناف المقبولة (صفر أو أكثر) قبل التأكيد', 'error'); return;
    }
    try {
        const res = await apiFetch(`/veg-requests/${id}/price`, { method: 'POST', body: JSON.stringify({ prices }) });
        toast(`تم التسعير: ${res.total} ر.س — حُمّلت مصروف على قسم المطبخ (مصروف #${res.expenseId})`, 'success');
        await loadVegRequestsLog();
        vegLoadStats();
    } catch (e) {toast(e.message || 'فشل التسعير', 'error');}
}

async function vegReceive(id) {
    if (!window.confirm('تأكيد استلام الطلب من المخازن؟')) {return;}
    try {
        await apiFetch(`/veg-requests/${id}/receive`, { method: 'POST' });
        toast('تم تسجيل الاستلام ✔', 'success');
        await loadVegRequestsLog();
        vegLoadStats();
    } catch (e) {toast(e.message || 'فشل تسجيل الاستلام', 'error');}
}

function vegCanEdit(r) {
    if (!r || r.status !== 'pending') {return false;}
    const role = STATE.currentUser?.role;
    if (['warehouse', 'admin', 'owner', 'manager', 'kitchen', 'sous_chef', 'dept_head'].includes(role)) {return true;}
    return Number(r.created_by) === Number(STATE.currentUser?.id);
}
function vegEditItems(id) {
    const list = (window._vegLog || []);
    const r = list.find(x => Number(x.id) === Number(id));
    if (!r) {toast('الطلب غير موجود','error');return;}
    const items = Array.isArray(r.items) ? r.items : [];
    showModal('<h3><i class=ji data-i=pencil></i> تعديل كميات الطلب ' + esc(r.request_no || ('#' + r.id)) + '</h3>'
        + '<div class="text-muted" style="margin-bottom:10px">التعديل قبل الاعتماد النهائي فقط — أي تغيير يُوثَّق باسمك.</div>'
        + items.map((it, i) => '<div class="fr" style="align-items:end;gap:8px"><div class="fg" style="flex:2"><label>' + esc(it.name) + ' (' + esc(it.unit || '') + ')</label><input type="number" min="0.001" step="0.001" id="vegEditQty_' + i + '" value="' + Number(it.qty || 0) + '"></div></div>').join('')
        + '<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="vegSubmitItemsEdit" data-karim-arg0="' + Number(id) + '"><i class=ji data-i=save></i> حفظ الكميات</button></div>');
}
async function vegSubmitItemsEdit(id) {
    const list = (window._vegLog || []);
    const r = list.find(x => Number(x.id) === Number(id));
    if (!r) {toast('الطلب غير موجود','error');return;}
    const items = Array.isArray(r.items) ? r.items : [];
    const payload = items.map((it, i) => {
        const el = document.getElementById('vegEditQty_' + i);
        return { name: it.name, qty: el ? Number(el.value) : it.qty, unit: it.unit };
    });
    try {
        showLoad();
        const res = await apiFetch('/veg-requests/' + encodeURIComponent(id) + '/items', { method: 'PUT', body: JSON.stringify({ items: payload }) });
        if (res.request) {
            const ix = (window._vegLog || []).findIndex(x => Number(x.id) === Number(id));
            if (ix > -1) {window._vegLog[ix] = res.request;}
        }
        closeModal(); renderPage();
        toast('تم تعديل الكميات','success');
    } catch (e) { toast(e.message || 'تعذر التعديل', 'error'); }
    finally { hideLoad(); }
}
async function vegCancel(id) {
    const reason = window.prompt('سبب الإلغاء (اختياري):') ;
    if (reason === null) {return;}
    try {
        await apiFetch(`/veg-requests/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
        toast('تم إلغاء الطلب', 'info');
        await loadVegRequestsLog();
        vegLoadStats();
    } catch (e) {toast(e.message || 'فشل الإلغاء', 'error');}
}

async function vegLoadStats() {
    const box = document.getElementById('vegStats');
    if (!box) {return;}
    try {
        const res = await apiFetch('/veg-requests?limit=1');
        const s = res.summary || {};
        box.innerHTML = `
        <div class="veg-stat"><b>${Number(s.today || 0)}</b><span>طلبات اليوم</span></div>
        <div class="veg-stat"><b>${Number(s.pending || 0)}</b><span>قيد الانتظار</span></div>
        <div class="veg-stat"><b>${Number(s.pending_today || 0)}</b><span>انتظار اليوم</span></div>`;
    } catch (_) { box.innerHTML = ''; }
}

// ─── الطباعة الاحترافية (A4) ─────────────────────────────────────────────────

async function vegPrint(id) {
    try {
        const res = await apiFetch('/veg-requests?limit=200');
        const req = (res.requests || []).find((r) => Number(r.id) === Number(id));
        if (!req) {toast('لم يتم العثور على الطلب — حدّث السجل', 'error'); return;}
        apiFetch(`/veg-requests/${id}/printed`, { method: 'POST' }).catch(() => {});
        vegOpenPrintWindow(req);
    } catch (e) {toast(e.message || 'تعذر تجهيز الطباعة', 'error');}
}

/** باني قالب الطباعة A4 — منفصل ليُختبر ويُعاين مباشرة (نفس المحتوى المطبوع) */
function vegBuildPrintHtml(req) {
    const items = Array.isArray(req.items) ? req.items : [];
    const hasPrices = items.some((it) => it.price !== null && it.price !== undefined);
    const fmt = (n) => Number(n).toLocaleString('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rows = items.map((it, i) => `
      <tr${it.rejected ? ' style="background:#fdecec"' : ''}>
        <td class="c">${i + 1}</td>
        <td class="name">${esc(it.name)}${it.rejected ? ' <span class="rej">✗ مرفوض — لا يُسعَّر</span>' : ''}${it.spoiledQty ? ` <span class="rej">تالف: ${esc(String(it.spoiledQty))}</span>` : ''}</td>
        <td class="c qty">${esc(String(it.qty))}</td>
        <td class="c">${esc(it.unit)}</td>
        ${hasPrices ? `<td class="c">${it.rejected ? '—' : (it.price !== null && it.price !== undefined ? fmt(it.price) : '—')}</td><td class="c">${it.lineTotal !== null && it.lineTotal !== undefined ? fmt(it.lineTotal) : '—'}</td>` : ''}
        <td class="note">${esc(it.note || '')}</td>
      </tr>`).join('');
    const created = req.created_at ? new Date(req.created_at) : new Date();
    const dtStr = created.toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' });
    const rdt = req.received_at ? new Date(req.received_at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const me = STATE.currentUser || {};
    const nowStr = new Date().toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
    const pdt = req.priced_at ? new Date(req.priced_at).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'long', timeStyle: 'short' }) : '';
    const statusStamp = req.status === 'priced'
        ? `<div class="stamp ok">✔ معتمد${req.total ? ' — ' + fmt(req.total) : ''}</div><div class="recv-line">سعّرها: <b>${esc(req.priced_by_name || '')}</b>${pdt ? ' — ' + esc(pdt) : ''}</div>`
        : (req.status === 'received'
        ? `<div class="stamp ok">✔ تم الاستلام</div><div class="recv-line">استلمها: <b>${esc(req.received_by_name || '')}</b>${rdt ? ' — ' + esc(rdt) : ''}</div>`
        : (req.status === 'cancelled' ? '<div class="stamp no">✖ ملغي</div>' : ''));
    const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>طلب شراء خضار ${esc(req.request_no || '')}</title>
<style>
@page { size: A4; margin: 13mm; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Segoe UI', Tahoma, sans-serif; color: #16213e; background: #fff; font-size: 13.5px; }
.sheet { max-width: 780px; margin: 0 auto; }
.head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #c9a227; padding-bottom: 12px; }
.brand h1 { font-size: 22px; color: #16213e; letter-spacing: .5px; }
.brand .sub { color: #7a7a8c; font-size: 11.5px; margin-top: 3px; }
.docno { text-align: left; }
.docno .no { font-size: 17px; font-weight: 800; color: #16213e; border: 2px solid #c9a227; border-radius: 10px; padding: 6px 14px; display: inline-block; direction: ltr; }
.docno .dt { color: #555; font-size: 12px; margin-top: 6px; }
.title { background: #16213e; color: #c9a227; text-align: center; font-size: 18px; font-weight: 800; padding: 9px; border-radius: 10px; margin: 14px 0; letter-spacing: 1px; }
.meta { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; }
.meta .m { background: #f6f4ec; border: 1px solid #e2ddc9; border-radius: 9px; padding: 6px 12px; font-size: 12.5px; }
.meta .m b { color: #16213e; }
.meta .m.urgent { background: #fdecec; border-color: #e74c3c; color: #c0392b; font-weight: 800; }
table { width: 100%; border-collapse: collapse; margin-top: 4px; }
th { background: #16213e; color: #fff; padding: 8px 6px; font-size: 12.5px; }
td { border: 1px solid #d8d4c4; padding: 7px 8px; font-size: 13px; }
tr:nth-child(even) td { background: #faf9f4; }
td.c { text-align: center; width: 46px; } td.qty { text-align: center; font-weight: 800; width: 80px; font-size: 14px; }
td.name { font-weight: 700; } td.note { color: #666; font-size: 12px; }
.rej { color: #c0392b; font-weight: 800; font-size: 10.5px; }
.total { margin-top: 8px; text-align: left; font-weight: 800; color: #16213e; }
.notes-box { margin-top: 12px; background: #f6f4ec; border: 1px dashed #c9a227; border-radius: 10px; padding: 10px 14px; font-size: 13px; }
.signs { display: flex; gap: 24px; margin-top: 30px; }
.sign { flex: 1; text-align: center; }
.sign .line { border-top: 2px dotted #999; margin-top: 46px; padding-top: 6px; font-weight: 700; font-size: 12.5px; }
.sign .who { color: #7a7a8c; font-size: 11.5px; }
.stamp { display: inline-block; border: 2.5px solid #27ae60; color: #27ae60; font-weight: 900; font-size: 16px; border-radius: 10px; padding: 4px 18px; transform: rotate(-4deg); margin-top: 14px; }
.stamp.no { border-color: #c0392b; color: #c0392b; }
.recv-line { margin-top: 6px; font-size: 12.5px; color: #27ae60; }
.foot { border-top: 2px solid #c9a227; margin-top: 26px; padding-top: 8px; display: flex; justify-content: space-between; color: #7a7a8c; font-size: 10.5px; }
@media print { .sheet { max-width: none; } }
</style></head><body>
<div class="sheet">
  <div class="head">
    <div class="brand">
      <h1>مطاعم الشرفاء العالمي</h1>
      <div class="sub">نظام Karim ERP لإدارة المطاعم</div>
    </div>
    <div class="docno">
      <div class="no">${esc(req.request_no || '')}</div>
      <div class="dt">${esc(dtStr)}</div>
    </div>
  </div>
  <div class="title">طلب شراء خضار</div>
  <div class="meta">
    <div class="m"><b>الجهة الطالبة:</b> مطبخ المطعم</div>
    <div class="m"><b>بواسطة:</b> ${esc(req.created_by_name || '')}${req.created_by_role ? ' (' + esc(req.created_by_role) + ')' : ''}</div>
    <div class="m"><b>إلى:</b> المخازن</div>
    ${req.priority === 'urgent' ? '<div class="m urgent">🚨 عاجل — التوريد بأسرع وقت</div>' : ''}
    ${statusStamp}
  </div>
  <table>
    <thead><tr><th class="c">م</th><th>الصنف</th><th class="qty">الكمية</th><th>الوحدة</th>${hasPrices ? '<th>سعر الوحدة</th><th>الإجمالي</th>' : ''}<th>ملاحظات</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">إجمالي الأصناف: ${items.length}${req.total ? ' — إجمالي القيمة: ' + fmt(req.total) : ''}</div>
  ${req.notes ? `<div class="notes-box"><b>ملاحظات:</b> ${esc(req.notes)}</div>` : ''}
  <div class="signs">
    <div class="sign"><div class="line"></div><div class="who">توقيع الشيف — ${esc(req.created_by_name || '')}</div></div>
    <div class="sign"><div class="line"></div><div class="who">توقيع أمين المخزن — الاستلام</div></div>
  </div>
  <div class="foot">
    <div>طُبعت من نظام Karim ERP بواسطة ${esc(me.name || me.username || '')} — ${esc(nowStr)}</div>
    <div>نسخة رقم ${Number(req.print_count || 0) + 1}</div>
  </div>
</div>
<script>window.onload=function(){setTimeout(function(){window.print();},350);};</script>
</body></html>`;
    return html;
}

function vegOpenPrintWindow(req) {
    const html = vegBuildPrintHtml(req);
    const w = window.openInAppReport ? window.openInAppReport('إذن طلب خضار') : window.open('', '_blank');
    if (!w) {toast('المتصفح منع فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة', 'error'); return;}
    w.document.open();
    w.document.write(html);
    w.document.close();
}

// تصدير الدوال (يُجسرها main.js إلى window لاستخدام onclick)
export {
    renderVegRequestsPage, loadVegRequestsLog, vegSwitchTab, vegSearchItems, vegMarkFilled,
    vegAddCustomRow, vegSetPriority, vegSendRequest, vegResetForm, vegSetFilter,
    vegPrint, vegReceive, vegCancel, vegBuildPrintHtml,
    vegTogglePricing, vegPriceCalc, vegSubmitPrices, vegToggleReceive, vegSubmitReceive,
    vegCanEdit, vegEditItems, vegSubmitItemsEdit, vegUpdateCount,
};
