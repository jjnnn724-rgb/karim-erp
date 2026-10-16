/**
 * V2 — Goods scan: مسح الباركود في المخزن — ربطٌ ثم دخول (البند ٩، موجة ١)
 * ══════════════════════════════════════════════════════════════════════
 *
 * طلب المالك: «عايز مسح باركود دخول وخروج الاصناف من المخزن… احترافي جدًا ودقيق».
 * القياسُ قدّم قرارًا لا يقدّمه الكود: 356 صنفًا و**صفر باركود** مربوط، فبدأنا
 * بالربط ثم الوارد (والصادر موجتُه التالية لحاجته لتوقيعٍ وسلسلة اعتماد).
 *
 * المفتاح: `?v2scan=1` (أو karim_v2_scan مخزَّنًا) — **مطفأٌ افتراضيًا**، ومع
 * الإطفاء تُرسم حالةٌ صامتة لا شبكة فيها ولا قارئ ولا زر كتابة. الوصول الآن
 * بالمقطع `#goods-scan` (مسار فرعي في routing.js) لا ببطاقة في القائمة، حتى
 * لا يرى أحدٌ شاشةً معطلة في قائمةٍ حيّة.
 *
 * العتاد: قارئ USB هو الأساس (keyboard-wedge: ٤+ محارف، أقل من ٦٠ms للمحرف،
 * Enter في الآخر — نفس مُحلِّل js/pos.js:2130-2166 بعتباته الحرفية)، والكاميرا
 * احتياط بنفس مكتبة المستودع (vendor/html5-qrcode.min.js، بلا CDN) على نمط
 * كشك الحضور في هذه الشاشة نفسها. لا طلبَ طرفٍ ثالث في أيٍّ منهما.
 *
 * كل كتابةٍ تمرّ ببابٍ موجود: PUT /api/inventory/:id لعمود barcode وحده
 * (schema-registry.js:326 و:780) وPOST /warehouse/inventory/:id/receipt
 * للوارد (warehouse-routes.js:1584) — لا خادم، لا سكيمًا، لا دفتر مخزون يُكسر.
 */

import { resolveScan, assignDecision, coverage, unassignedRows, scanEnabledModel,
    normalizeCode, codeFamily, bumpLine, setLineQty, setLinePrice, dropLine,
    sessionTotals, lookupByCode, loadCampaign, searchItems, assignItemBarcode } from '../data/scan-repo.js?v=4.9.134';
import { inventoryToRow, receiveInventoryItem, receiptPayload,
    invWriteVisible, formatQty } from '../data/inventory-repo.js?v=4.9.134';
import { createDataTable } from '../data-display/data-table.js?v=4.9.134';
import { ensureHtml5Qrcode } from '../vendor.js?v=4.9.134';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** عتبات keyboard-wedge كما هي في js/pos.js:2133-2160 — لا إعادة اختراع. */
const WEDGE = { minLen: 4, maxLen: 64, avgMs: 60, gapMs: 90 };
/** مسحٌ واحد لا اثنان: نفس الكود في لحظتين يُعدّ قراءة مزدوجة (USB + كاميرا معًا). */
const ECHO_MS = 350;

const MODES = [
    { key: 'bind', ar: 'ربط كود بصنف', en: 'Bind' },
    { key: 'in', ar: 'وارد بالمسح', en: 'Goods IN' },
    { key: 'campaign', ar: 'تغطية الحملة', en: 'Coverage' },
];

function offState() {
    return `
      <section class="erp-card erp-v2-scan">
        <div class="erp-card__head">
          <h3 class="erp-card__title">مسح الباركود
            <span class="erp-eyebrow" dir="ltr" lang="en">Barcode Scan</span></h3>
        </div>
        <div class="erp-card__body">
          <div class="erp-state">
            <span class="erp-state__title">الشاشة مطفأة — خلف مفتاح <span class="erp-addr" dir="ltr">?v2scan=1</span></span>
            <span>لا شبكة، ولا قارئ، ولا أزرار كتابة في هذه الحالة. للفحص:
              <span class="erp-addr" dir="ltr">v2.html?live=1&amp;v2scan=1#goods-scan</span></span>
          </div>
        </div>
      </section>`;
}

function template() {
    const tabs = MODES.map((m, i) => `<button type="button" class="erp-btn erp-btn--sm${i === 0 ? ' erp-btn--primary' : ''}" data-v2-mode="${m.key}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(m.ar)}</button>`).join('');
    return `
      <section class="erp-card erp-v2-scan">
        <div class="erp-card__head">
          <h3 class="erp-card__title">مسح الباركود في المخزن
            <span class="erp-eyebrow" dir="ltr" lang="en">Barcode · IN</span>
            <span class="erp-text-muted erp-text-sm" data-v2-cov></span>
          </h3>
          <span class="erp-grow"></span>
          ${tabs}
        </div>
        <div class="erp-card__body erp-stack">
          <p class="erp-text-sm erp-text-muted" data-v2-note role="status" aria-live="polite"></p>

          <div class="gs-line">
            <label class="erp-label" for="gs-code">الكود المقروء</label>
            <input class="erp-input erp-input--ltr gs-code" id="gs-code" type="text" inputmode="numeric"
                   autocomplete="off" spellcheck="false" maxlength="100" placeholder="امسح أو اكتب ثم Enter">
            <button type="button" class="erp-btn erp-btn--sm erp-btn--primary" data-v2-go>حلّ الكود</button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-cam><i class="ji" data-i="camera" aria-hidden="true"></i><span>كاميرا</span></button>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-clear-code>تفريغ</button>
          </div>
          <p class="erp-text-sm erp-text-muted" data-v2-wedge>
            قارئ USB يعمل من أي مكان في الشاشة ما لم تكون داخل حقل كتابة؛ والكاميرا تقرأ
            EAN/UPC/Code128/ITF/QR حيث يدعمها المتصفح. الكود يُطبَّق كما هو — بلا بحثٍ بالمطابقة الجزئية.
          </p>

          <div class="gs-panel" data-v2-panel="bind"></div>
          <div class="gs-panel" data-v2-panel="in" hidden></div>
          <div class="gs-panel" data-v2-panel="campaign" hidden></div>

          <div class="gs-cam" data-v2-camwrap hidden>
            <div class="erp-scan" id="gs-cam"></div>
            <p class="erp-text-sm erp-text-muted" data-v2-cam-msg role="status" aria-live="polite"></p>
            <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-cam-stop>إيقاف الكاميرا</button>
          </div>
        </div>
      </section>`;
}

export function mountGoodsScanScreen(host, ctx = {}) {
    const model = scanEnabledModel(window.location.search, window.localStorage.getItem('karim_v2_scan'));
    if (!model.enabled) {
        host.insertAdjacentHTML('beforeend', offState());
        const off = host.lastElementChild;
        return { el: off, reload: () => {}, destroy() { off.remove(); } };
    }

    const role = String(ctx.role ?? '');
    const canWrite = invWriteVisible(role);
    const notify = typeof ctx.notify === 'function' ? ctx.notify : say;
    const confirmFn = typeof ctx.confirmFn === 'function' ? ctx.confirmFn : () => true;

    host.insertAdjacentHTML('beforeend', template());
    const el = host.lastElementChild;
    const q = (s) => el.querySelector(s);
    const note = q('[data-v2-note]');
    const codeInput = q('#gs-code');
    const covEl = q('[data-v2-cov]');

    let mode = 'bind';
    let rows = [];
    let pending = [];
    let lines = [];
    let busy = false;
    let scanner = null;
    let camOn = false;
    let lastCode = '';
    let lastAt = 0;
    let searchTimer = null;
    let covTable = null;

    const wedge = { text: '', last: 0, started: 0 };

    function say(t) {
        note.textContent = String(t ?? '');
    }

    /* ── القارئ ─────────────────────────────────────────────────────────── */

    function onKeydown(ev) {
        if (ev.key === 'Escape') {wedge.text = ''; return;}
        const ae = document.activeElement;
        if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) {wedge.text = ''; return;}
        if (ev.key === 'Enter') {
            const code = wedge.text;
            const started = wedge.started;
            wedge.text = '';
            // القارئ يكتب الكود كله في ومضة واحدة؛ الكتابة البشرية أبطأ من 60ms/محرف
            // فتُتجاهل بأمان (نفس الحكم في pos.js:2145-2152).
            if (code.length >= WEDGE.minLen && (performance.now() - started) / code.length < WEDGE.avgMs) {
                ev.preventDefault();
                submit(code);
            }
            return;
        }
        if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
            const now = performance.now();
            if (now - wedge.last > WEDGE.gapMs || wedge.text.length >= WEDGE.maxLen) {
                wedge.text = '';
                wedge.started = now;
            }
            wedge.last = now;
            wedge.text += ev.key;
        }
    }

    /** echo-guard: نفس الكود مرتين في لحظتين = قراءتان لا مسحان (USB وكاميرا معًا). */
    function isEcho(code) {
        const now = performance.now();
        if (code === lastCode && now - lastAt < ECHO_MS) {return true;}
        lastCode = code;
        lastAt = now;
        return false;
    }

    function submit(raw) {
        const code = normalizeCode(raw);
        if (!code) {say('لا كود — امسح الباركود أو اكتبه ثم Enter.'); return;}
        if (isEcho(code)) {return;}
        codeInput.value = code;
        handle(code);
    }

    /* ── المعالجة بحسب الوضع ────────────────────────────────────────────── */

    async function handle(code) {
        if (busy) {say('جارٍ تنفيذ عملية — انتظر النتيجة.'); return;}
        busy = true;
        say(`جارٍ حلّ الكود ${code}…`);
        try {
            const res = await lookupByCode(code);
            if (!el.isConnected) {return;}
            const found = resolveScan(res.rows, code);
            if (mode === 'in') {await onScanIn(found, res); return;}
            await onScanBind(found, res);
        } catch (e) {
            if (!el.isConnected) {return;}
            say(writeFailure(e));
        } finally {
            busy = false;
        }
    }

    function writeFailure(e) {
        if (e && e.message === 'UNAUTHORIZED') {return 'انتهت الجلسة — سجّل الدخول في النظام ثم أعد المحاولة.';}
        if (e && e.code === 'FORBIDDEN') {return 'الخادم رفض الكتابة لهذا الحساب — القرار له وحده.';}
        return `تعذّر التنفيذ: ${(e && e.message) || 'خطأ'}`;
    }

    /** وضع الربط: كودٌ مربوط ⇒ قل «استعمل الوارد»؛ غير مربوط ⇒ ابحث عن صاحبه واربطه. */
    async function onScanBind(found, res) {
        if (found.state === 'unique') {
            const r = found.items[0];
            say(`الكود مربوط أصلًا بـ«${r.name}». لتسجيل كمية افتح «وارد بالمسح».`);
            paintBindBound(r, found);
            return;
        }
        if (found.state === 'ambiguous') {
            say(`تحذير: ${found.items.length} أصناف تحمل الكود نفسه — لا يُربط مثله حتى يُصلح التكرار.`);
            paintBindAmbiguous(found.items, found);
            return;
        }
        if (res.truncated) {
            say('نتيجة الخادم مقتطعة عند حدّ المشي — ابحث بالصنف مباشرةً إن لم تجده.');
        }
        if (!canWrite) {
            say(`الكود غير مربوط. الربط لإدارة المخزن والمدير والمسؤول — حسابك (${role || 'بلا دور'}) لا يكتب.`);
            return;
        }
        pending = [{ code: found.code, validation: found.validation }];
        paintBindNew(found);
        say(found.validation.ok
            ? `الكود ${found.code} غير مربوط — اختر الصنف ثم اربطه.`
            : `الكود ${found.code} غير مربوط، و${found.validation.reason}`);
    }

    /** وضع الوارد: كودٌ مربوط ⇒ سطرٌ في الجلسة (والتكرار = عددٌ لا سطرٌ جديد). */
    async function onScanIn(found, res) {
        if (found.state === 'unique') {
            lines = bumpLine(lines, String(found.items[0].id));
            paintIn(found.items[0]);
            say(`أُضيف «${found.items[0].name}» — المسح المكرّر يعدّ نفس الصنف.`);
            return;
        }
        if (found.state === 'ambiguous') {
            say('الكود على أكثر من صنف — اختر أيهما قبل التسجيل، فلا يُكتب واردٌ على شبه.');
            paintInAmbiguous(found.items);
            return;
        }
        say(res.truncated
            ? `لا صنف بهذا الكود في ما مشينا من نتائج (${res.total}) — اربطه أولًا من وضع «ربط كود بصنف».`
            : `لا صنف بهذا الكود — اربطه أولًا من وضع «ربط كود بصنف».`);
    }

    /* ── الرسم ──────────────────────────────────────────────────────────── */

    function panel(which) {
        return q(`[data-v2-panel="${which}"]`);
    }

    function setMode(next) {
        mode = next;
        el.querySelectorAll('[data-v2-mode]').forEach((b) => {
            const on = b.getAttribute('data-v2-mode') === next;
            b.classList.toggle('erp-btn--primary', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        MODES.forEach((m) => { panel(m.key).hidden = m.key !== next; });
        if (next === 'campaign') {paintCampaign();}
        if (next === 'in') {paintIn(null);}
        if (next === 'bind') {paintBindNew(null);}
    }

    function itemLine(r) {
        const row = inventoryToRow(r);
        const fam = codeFamily(row.barcode || '');
        return `<div class="gs-item">
          <span class="gs-item__name">${esc(row.name)}</span>
          <span class="erp-text-sm erp-text-muted">${esc(row.category || '—')} · ${esc(row.unit || '—')} · رصيد ${esc(formatQty(row.qty))}</span>
          <span class="gs-item__code" dir="ltr">${esc(row.barcode || 'بلا كود')}</span>
          <span class="erp-badge" data-tone="${fam === 'alphanumeric' ? 'neutral' : 'info'}" dir="ltr">${esc(fam)}</span>
        </div>`;
    }

    function bindBox(inner) {
        panel('bind').innerHTML = `<div class="gs-box">${inner}</div>`;
    }

    function paintBindBound(r, found) {
        const v = found.validation;
        bindBox(`${itemLine(r)}
          <p class="erp-text-sm${v.checked && v.ok ? ' gs-ok' : ' gs-warn'}">${esc(v.checked ? v.reason : 'لا فحص تحقق لهذا النوع من الأكواد')}</p>
          <button type="button" class="erp-btn erp-btn--sm" data-v2-to-in>تسجيل وارد لهذا الصنف</button>`);
    }

    function paintBindAmbiguous(items, found) {
        bindBox(`<p class="gs-warn erp-text-sm">${esc(found.items.length + ' أصناف تحمل الكود: ')}${items.map((x) => esc(x.name)).join('، ')}</p>
          <p class="erp-text-sm erp-text-muted">قيدُ التفريد غير موجود في القاعدة (<span class="erp-addr" dir="ltr">010_inventory_barcode.sql</span>)،
             فالتفريد هنا فحصُ واجهة. أزل التكرار من صنفٍ واحد ثم أعد الربط.</p>`);
    }

    function paintBindNew(found) {
        if (!canWrite) {
            bindBox(`<p class="erp-text-sm erp-text-muted">حسابك لا يكتب في المخزن — عرضٌ فقط.</p>`);
            return;
        }
        const warn = found && !found.validation.ok
            ? `<p class="gs-warn erp-text-sm">${esc(found.validation.reason)}</p>` : '';
        bindBox(`
          <label class="erp-label" for="gs-pick">ابحث عن الصنف بالاسم</label>
          <input class="erp-input" id="gs-pick" type="search" autocomplete="off" placeholder="اسم الصنف…">
          ${warn}
          <div data-v2-pick-list class="gs-picks"></div>`);
        const pick = q('#gs-pick');
        pick.addEventListener('input', () => {
            clearTimeout(searchTimer);
            const term = pick.value.trim();
            if (!term) {q('[data-v2-pick-list]').innerHTML = ''; return;}
            searchTimer = setTimeout(async () => {
                try {
                    const hits = await searchItems(term);
                    if (!el.isConnected) {return;}
                    q('[data-v2-pick-list]').innerHTML = hits.length
                        ? hits.slice(0, 40).map((r) => `<button type="button" class="gs-pick" data-v2-pick="${esc(r.id)}" data-v2-name="${esc(r.name)}">${esc(r.name)} <span class="erp-text-sm erp-text-muted">${esc(r.category || '')}</span></button>`).join('')
                        : '<p class="erp-text-sm erp-text-muted">لا صنف بهذا الاسم — راجع الإملاء أو ابدأ من قائمة التغطية.</p>';
                } catch (e) {
                    if (el.isConnected) {q('[data-v2-pick-list]').innerHTML = '';}
                    say(writeFailure(e));
                }
            }, 220);
        });
    }

    /** اختيار الصنف ثم القرار (assignDecision في النموذج) ثم PUTٌّ بعمودٍ واحد. */
    async function bindTo(itemId) {
        if (!pending.length) {say('لا كود معلّق — امسح أولًا.'); return;}
        const code = pending[0].code;
        const all = rows.length ? rows : (await loadCampaign()).rows;
        if (!el.isConnected) {return;}
        rows = all;
        const decision = assignDecision(all, code, itemId);
        if (decision.state === 'taken' || decision.state === 'invalid' || decision.state === 'empty') {
            say(decision.message);
            return;
        }
        if (decision.state === 'suspect') {
            const ok = await confirmFn(`تحقّق مشكوك فيه: ${decision.message}\nاربط «${decision.item.name}» بالكود ${code} رغم ذلك؟`);
            if (!ok) {say('لم يُربط — أُلغي التأكيد.'); return;}
        }
        if (decision.state === 'duplicate') {
            const ok = await confirmFn(`${decision.message} — تابع؟`);
            if (!ok) {say('لم يُربط — أُلغي التأكيد.'); return;}
        }
        try {
            await assignItemBarcode(itemId, code);
            const i = all.findIndex((r) => String(r.id) === String(itemId));
            if (i !== -1) {rows[i] = {...rows[i], barcode: code};}
            if (!el.isConnected) {return;}
            notify(`ربطٌ تمّ: ${code} → «${decision.item ? decision.item.name : itemId}»`);
            pending = [];
            paintCoverage();
            if (mode === 'bind') {paintBindNew(null);}
        } catch (e) {
            if (el.isConnected) {say(writeFailure(e));}
        }
    }

    function paintIn(active) {
        const totals = sessionTotals(lines);
        const rowsHtml = lines.length ? lines.map((l) => {
            const raw = rows.find((r) => String(r.id) === l.key) || {};
            return `<tr>
              <td>${esc(raw.name || l.key)}</td>
              <td class="gs-tnum" dir="ltr">${esc(String(l.count))}</td>
              <td><input class="erp-input erp-input--ltr gs-qty" type="number" min="0" step="0.001" value="${esc(l.qty)}" data-v2-qty="${esc(l.key)}"></td>
              <td><input class="erp-input erp-input--ltr" type="number" min="0" step="0.01"
                         value="${l.price == null ? '' : esc(String(l.price))}" placeholder="فارغ = متوسط التكلفة"
                         data-v2-price="${esc(l.key)}"></td>
              <td><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-drop="${esc(l.key)}">حذف</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="5" class="erp-text-sm erp-text-muted">امسح كارتونةً واحدة أو أكثر — كل مسحٍ لنفس الكود يزيد عدَّه لا يضيف صنفًا.</td></tr>';
        panel('in').innerHTML = `
          <div class="gs-box">
            <p class="erp-text-sm erp-text-muted">الوارد يمرّ بدفتر المخزون نفسه الذي يستعمله النظام القديم
              (<span class="erp-addr" dir="ltr">POST /warehouse/inventory/:id/receipt</span>) — لا كتابة مباشرة على
              <span class="erp-addr" dir="ltr">inventory.qty</span>، فالإسقاط يُعاد حسابه من الأرصدة.</p>
            <table class="gs-table"><thead><tr><th>الصنف</th><th>المسح</th><th>الكمية</th><th>سعر الوحدة</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table>
            <p class="erp-text-sm">${esc(`${totals.lines} صنفًا · ${totals.scans} مسحة · ${totals.qty} وحدة`)}</p>
            <div class="gs-actions">
              <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-post ${canWrite && lines.length ? '' : 'disabled'}>تسجيل الوارد</button>
              <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-reset ${lines.length ? '' : 'disabled'}>تفريغ الجلسة</button>
            </div>
            ${active ? itemLine(active) : ''}
            ${canWrite ? '' : '<p class="gs-warn erp-text-sm">حسابك لا يكتب الوارد — الأزرار معطّلة والقرار للخادم.</p>'}
          </div>`;
    }

    function paintInAmbiguous(items) {
        panel('in').innerHTML = `<div class="gs-box">
          <p class="gs-warn erp-text-sm">الكود على أكثر من صنف — حدّد أيهما يسجَّل له الوارد:</p>
          ${items.map((r) => `<button type="button" class="gs-pick" data-v2-choose="${esc(r.id)}">${esc(r.name)} <span class="erp-text-sm erp-text-muted">${esc(r.unit || '')}</span></button>`).join('')}
        </div>`;
    }

    /** جلسة الوارد تُرسَل صنفًا صنفًا بالباب نفسه، والتسلسل لا التوازي:
     *  كل طلبٍ يفتح معاملة `FOR UPDATE` في الخادم، والتوازي يولّد تنافسًا
     *  على القفل بلا فائدة، وفشل صنفٍ لا يُبطل ما سبق. */
    async function postSession() {
        if (!canWrite) {say('لا صلاحية تسجيل وارد لهذا الحساب.'); return;}
        if (!lines.length) {say('لا أصناف في الجلسة.'); return;}
        busy = true;
        const results = [];
        for (const l of lines) {
            const raw = rows.find((r) => String(r.id) === l.key);
            if (!raw) {results.push({ key: l.key, ok: false, message: 'الصنف غير موجود في النتيجة' }); continue;}
            try {
                await receiveInventoryItem(raw.id, receiptPayload(raw, l.qty, l.price == null ? '' : l.price));
                results.push({ key: l.key, ok: true, name: raw.name, qty: l.qty });
            } catch (e) {
                results.push({ key: l.key, ok: false, name: raw.name, message: (e && e.message) || 'رفض الخادم' });
            }
            if (!el.isConnected) {busy = false; return;}
        }
        const ok = results.filter((r) => r.ok);
        const bad = results.filter((r) => !r.ok);
        lines = lines.filter((l) => bad.some((b) => String(b.key) === String(l.key)));
        say(bad.length
            ? `سُجّل ${ok.length} وصنّفٌ فشل ${bad.length}: ${bad.map((b) => `${b.name || b.key} — ${b.message}`).join(' | ')}`
            : `سُجّل وارد ${ok.length} صنفًا في الدفتر.`);
        if (ok.length) {notify(`وارد مسجّل: ${ok.length} صنفًا`);}
        busy = false;
        await refreshRows();
        paintIn(null);
    }

    function paintCampaign() {
        const cov = coverage(rows);
        panel('campaign').innerHTML = `
          <div class="gs-box">
            <p class="erp-text-sm">المقياس الذي يُنهي الحملة لا الذي يُطرب النظر: كم صنفًا صار له كود،
              وكم كودًا مكررًا، وكم كودًا كسرَ فحص GS1.</p>
            <div class="gs-kpis">
              <span class="gs-kpi">المربوط <b dir="ltr">${cov.assigned}/${cov.total}</b> <i>${cov.pct}%</i></span>
              <span class="gs-kpi">بلا كود <b dir="ltr">${cov.unassigned}</b></span>
              <span class="gs-kpi">أكواد متكررة <b dir="ltr">${cov.duplicates.length}</b></span>
              <span class="gs-kpi">تحققٌ مكسور <b dir="ltr">${cov.suspect}</b></span>
            </div>
            <p class="erp-text-sm erp-text-muted" data-v2-trunc>${cov.total && cov.duplicates.length ? 'أكواد: ' + cov.duplicates.slice(0, 6).map((d) => `${d.code}×${d.count}`).join('، ') : 'لا أكواد متكررة في المقروء.'}</p>
            <div data-v2-cov-table></div>
          </div>`;
        if (!covTable) {
            covTable = createDataTable({
                caption: 'الأصناف بلا باركود — قائمة عمل الحملة', mode: 'client', pageSize: 25, stickyHeader: true,
                emptyMessage: 'كل صنفٍ في النتيجة له كود', emptyHint: 'الحملة مكتملة في هذا النطاق.',
                rowKey: (r) => r.id,
                columns: [
                    { key: 'name', header: 'الصنف', sortable: true, filterable: true },
                    { key: 'category', header: 'الفئة', sortable: true, filterable: true, width: '160px' },
                    { key: 'unit', header: 'الوحدة', width: '90px' },
                    { key: 'qty', header: 'الرصيد', type: 'number', sortable: true, width: '110px', align: 'end', render: (r) => `<span class="erp-num" dir="ltr">${esc(formatQty(r.qty))}</span>` },
                    { key: 'state', header: 'الحالة', width: '120px', render: (r) => `<span class="erp-badge" data-tone="${esc(r.state && r.state.tone || 'neutral')}">${esc((r.state && r.state.label) || '—')}</span>` },
                ],
            });
            const slot = q('[data-v2-cov-table]');
            if (slot) {slot.appendChild(covTable.el);}
        } else {
            const slot = q('[data-v2-cov-table]');
            if (slot && !slot.contains(covTable.el)) {slot.appendChild(covTable.el);}
        }
        covTable.setRows(unassignedRows(rows, 2000).map((r) => inventoryToRow(r)));
    }

    function paintCoverage() {
        const cov = coverage(rows);
        covEl.textContent = `${cov.assigned}/${cov.total} مربوط (${cov.pct}%)`;
        if (mode === 'campaign') {paintCampaign();}
    }

    async function refreshRows() {
        const res = await loadCampaign();
        rows = res.rows;
        if (!el.isConnected) {return;}
        paintCoverage();
        if (res.truncated) {say(`نتيجة مشيّّة عند 2,000 من ${res.total} — استعمل البحث بالاسم.`);}
    }

    /* ── الكاميرا ───────────────────────────────────────────────────────── */

    function camSay(t) {
        const n = q('[data-v2-cam-msg]');
        if (n) {n.textContent = String(t ?? '');}
    }

    function stopCamera() {
        if (!scanner || !camOn) {camOn = false; return;}
        const s = scanner;
        camOn = false;
        try {
            Promise.resolve(s.stop(true)).catch(() => {}).finally(() => { /* توقّفٌ صامت */ });
        } catch (_) { /* قارئٌ لم يبدأ أصلاً */ }
        scanner = null;
    }

    async function startCamera() {
        if (camOn) {camSay('الكاميرا تعمل بالفعل — وجّه الباركود إلى الإطار.'); return;}
        camSay('جارٍ تجهيز الكاميرا…');
        q('[data-v2-camwrap]').hidden = false;
        const ok = await ensureHtml5Qrcode();
        if (!el.isConnected) {return;}
        if (!ok) {camSay('تعذّر تحميل قارئ الكاميرا من المستودع — استعمل قارئ USB أو اكتب الكود.'); return;}
        const F = window.Html5QrcodeSupportedFormats;
        const cfg = { verbose: false, useBarCodeDetectorIfSupported: true };
        if (F) {
            cfg.formatsToSupport = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE].filter((x) => Number.isFinite(x));
        }
        try {
            const inst = new window.Html5Qrcode('gs-cam', cfg);
            scanner = inst;
            await inst.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 300, height: 140 } },
                (text) => { stopCamera(); submit(text); }, () => {});
            camOn = true;
            camSay('وجّه الباركود الخطي إلى الإطار المستطيل.');
        } catch (e) {
            camSay(`تعذّر تشغيل الكاميرا: ${(e && e.message) || 'خطأ'} — امنح الإذن، أو استعمل قارئ USB.`);
        }
    }

    /* ── الربط بالأحداث (تفويضٌ على جذر الشاشة، بلا معالِجاتٍ داخل HTML) ─── */

    el.addEventListener('click', async (ev) => {
        const t = ev.target;
        const modeBtn = t.closest('[data-v2-mode]');
        if (modeBtn) {setMode(modeBtn.getAttribute('data-v2-mode')); return;}
        if (t.closest('[data-v2-go]')) {submit(codeInput.value); return;}
        if (t.closest('[data-v2-clear-code]')) {codeInput.value = ''; wedge.text = ''; say('فُرِّغ الحقل.'); codeInput.focus(); return;}
        if (t.closest('[data-v2-cam]')) {startCamera(); return;}
        if (t.closest('[data-v2-cam-stop]')) {stopCamera(); q('[data-v2-camwrap]').hidden = true; return;}
        const pick = t.closest('[data-v2-pick]');
        if (pick) {await bindTo(pick.getAttribute('data-v2-pick')); return;}
        if (t.closest('[data-v2-to-in]')) {setMode('in'); return;}
        const choose = t.closest('[data-v2-choose]');
        if (choose) {
            const raw = rows.find((r) => String(r.id) === choose.getAttribute('data-v2-choose'));
            if (raw) {lines = bumpLine(lines, String(raw.id)); paintIn(raw); say(`سُجّل الاختيار: «${raw.name}».`);}
            return;
        }
        const drop = t.closest('[data-v2-drop]');
        if (drop) {lines = dropLine(lines, drop.getAttribute('data-v2-drop')); paintIn(null); return;}
        if (t.closest('[data-v2-post]')) {await postSession(); return;}
        if (t.closest('[data-v2-reset]')) {lines = []; paintIn(null); say('أُفرغت الجلسة.'); return;}
    });

    el.addEventListener('change', (ev) => {
        const qty = ev.target.closest('[data-v2-qty]');
        if (qty) {
            lines = setLineQty(lines, qty.getAttribute('data-v2-qty'), qty.value);
            paintIn(null);
            return;
        }
        const price = ev.target.closest('[data-v2-price]');
        if (price) {
            // السعر يبقى على السطر: إعادة الرسم التي يتسبب فيها أيّ حقلٍ آخر
            // كانت ستُفرّغ الحقل وتُسجّل الوارد بمتوسط التكلفة بدل سعر المورد.
            lines = setLinePrice(lines, price.getAttribute('data-v2-price'), price.value);
        }
    });

    codeInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {ev.preventDefault(); submit(codeInput.value);}
    });

    document.addEventListener('keydown', onKeydown);

    (async () => {
        try {
            await refreshRows();
        } catch (e) {
            if (el.isConnected) {say(writeFailure(e));}
        }
        if (el.isConnected) {setMode('bind'); codeInput.focus();}
    })();

    return {
        el,
        reload: refreshRows,
        getLines: () => lines.slice(),
        destroy() {
            document.removeEventListener('keydown', onKeydown);
            clearTimeout(searchTimer);
            stopCamera();
            if (covTable) {covTable.destroy(); covTable = null;}
            el.remove();
        },
    };
}
