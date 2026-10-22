/**
 * V2 — Goods scan: مسح الباركود في المخزن — ربطٌ ثم دخولٌ ثم صرف (البند ٩)
 * ══════════════════════════════════════════════════════════════════════
 *
 * طلب المالك: «عايز مسح باركود دخول وخروج الاصناف من المخزن… احترافي جدًا ودقيق».
 * القياسُ قدّم قرارًا لا يقدّمه الكود: 356 صنفًا و**صفر باركود** مربوط، فبدأنا
 * بالربط ثم الوارد ثم الصرف (أذون صرف).
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
 * للوارد (warehouse-routes.js:1584) وPOST /api/dispatches لأذون الصرف المعلّق
 * (server.js:1546) — لا خادم، لا سكيمًا، ولا توقيعٌ يُتجاوز.
 */

import { resolveScan, assignDecision, coverage, unassignedRows, scanEnabledModel,
    normalizeCode, codeFamily, bumpLine, setLineQty, setLinePrice, setLineExpiry, dropLine,
    sessionTotals, lookupByCode, loadCampaign, searchItems, assignItemBarcode } from '../data/scan-repo.js?v=4.9.194';
import { checkExpiryOnLines } from '../data/expiry-policy.js?v=4.9.194';
import { inventoryToRow, receiveInventoryItem, receiptPayload,
    invWriteVisible, formatQty } from '../data/inventory-repo.js?v=4.9.194';
/* الصادر (أذون صرف): موجةٌ كانت مستقلّة لأن الاعتماد والتوقيع يقعان لاحقًا
 * (warehouse-routes.js:365-382/:621/:1076). الإنشاء وحده لا يطلب توقيعًا —
 * POST /api/dispatches (server.js:1546) يقبل طلبًا pending، وسلسلة الاعتماد
 * القائمة (شيف عمومي ← مخازن ← استلام، بتوقيعاتها) تكمل على شاشة الأذون.
 * فنستعمل أبواب dispatch-repo نفسها حرفًا، ولا نُعيد اختراع ولا نتجاوز توقيعًا. */
import { createDispatch, fetchDepartmentOptions, CREATE_ROLES } from '../data/dispatch-repo.js?v=4.9.194';
import { createDataTable } from '../data-display/data-table.js?v=4.9.194';
import { ensureHtml5Qrcode } from '../vendor.js?v=4.9.194';

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** عتبات keyboard-wedge كما هي في js/pos.js:2133-2160 — لا إعادة اختراع. */
const WEDGE = { minLen: 4, maxLen: 64, avgMs: 60, gapMs: 90 };
/** مسحٌ واحد لا اثنان: نفس الكود في لحظتين يُعدّ قراءة مزدوجة (USB + كاميرا معًا). */
const ECHO_MS = 350;

const MODES = [
    { key: 'bind', ar: 'ربط كود بصنف', en: 'Bind' },
    { key: 'in', ar: 'وارد بالمسح', en: 'Goods IN' },
    { key: 'out', ar: 'صرف (أذون)', en: 'Goods OUT' },
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
            <span class="erp-state__title">الشاشة غير مفعّلة في هذه النسخة</span>
            <span>لا شبكة، ولا قارئ، ولا أزرار كتابة في هذه الحالة. لتفعيل مسح
              الباركود تواصل مع مدير النظام.</span>
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
          <div class="gs-panel" data-v2-panel="out" hidden></div>
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
    /* من يُنشئ أذون صرف — مرآة CREATE_ROLES (dispatch-repo.js:116 = server.js:1547):
     * أوسع من canWrite (المخزن وحده) لأن الشيف ورئيس القسم يطلبان صرفًا أيضًا. */
    const canDispatch = CREATE_ROLES.includes(role);
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

    /* جلسة الصرف: أسطرٌ كما الوارد (bumpLine/setLineQty/dropLine) + خريطة
     * بيانات كل صنف (الاسم والوحدة والمتاح بالرئيسي) حتى يُرسم السطر بلا اعتماد
     * على صفوف الحملة القابلة للقطّ. */
    let outLines = [];
    const outMeta = new Map();
    let outDepts = [];
    let outDept = '';
    let outNotes = '';
    let outDeptLoaded = false;
    let outAmbiguous = [];
    let outSearchTimer = null;
    let outSearchSequence = 0;
    const outSearchItems = new Map();

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
        codeInput.value = '';
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
            if (mode === 'out') {await onScanOut(found, res); return;}
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

    /* ── وضع الصرف (أذون صرف) ─────────────────────────────────────────────
     * المسح يبني طلبًا معلّقًا فقط؛ الاعتماد والتوقيع والاستلام تبقى على شاشة
     * الأذون. الرصيد يُقاس على المخزن الرئيسي (mainQty من تعرُّف البحث، وهو
     * نفس ما يحسبه dispatchStockGate :450)، والخادم يعيد الفحص عند الإنشاء. */

    /** يحمّل أقسام الطلب مرة واحدة (باب dispatch-repo نفسه الذي يستعمله نموذج
     *  الأذون) — ولا يمنع المسح إن فشلت القراءة، فالخادم يحقن القسم لاحقًا. */
    async function ensureOutDepts() {
        if (outDeptLoaded) {return;}
        outDeptLoaded = true;
        try {
            outDepts = await fetchDepartmentOptions();
        } catch {
            outDepts = [];
        }
        if (el.isConnected && mode === 'out') {paintOut(null);}
    }

    /** تحويل مسحٍ إلى سطر صرف: صنفٌ بلا أي رصيدٍ بالرئيسي لا يُصرف أصلًا. */
    async function onScanOut(found, res) {
        if (!canDispatch) {
            say(`حسابك (${role || 'بلا دور'}) لا يُنشئ أذون صرف — الأدوار: الشيف والمدير والمخازن ورئيس القسم.`);
            return;
        }
        if (found.state === 'unique') {
            addOutItem(found.items[0], true);
            return;
        }
        if (found.state === 'ambiguous') {
            say('الكود على أكثر من صنف — حدّد أيهما يُصرَّف، فلا يُصرف على شبه.');
            paintOutAmbiguous(found.items);
            return;
        }
        say(res.truncated
            ? `لا صنف بهذا الكود في ما مشينا من نتائج (${res.total}) — اربطه أولًا من وضع «ربط كود بصنف».`
            : `لا صنف بهذا الكود — اربطه أولًا من وضع «ربط كود بصنف».`);
    }

    function addOutItem(item, scanned = false) {
        if (!canDispatch) {say('لا صلاحية إنشاء أذون صرف لهذا الحساب.'); return;}
        if (!item || item.id === undefined || item.id === null || !item.name) {
            say('تعذّر تحديد الصنف — أعد البحث أو المسح.');
            return;
        }
        const avail = Number(item.mainQty) || 0;
        if (avail <= 0) {
            say(`«${item.name}» لا رصيد له في المخزن الرئيسي — لا يُصرَّف.`);
            return;
        }
        const key = String(item.id);
        outMeta.set(key, { name: item.name, unit: item.unit || '', avail });
        outLines = bumpLine(outLines, key);
        paintOut(item);
        say(scanned
            ? `أُضيف «${item.name}» بالمسح — المتاح بالرئيسي ${formatQty(avail)} ${item.unit || ''}.`
            : `أُضيف «${item.name}» يدويًا — المتاح بالرئيسي ${formatQty(avail)} ${item.unit || ''}.`);
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
        if (next === 'out') {paintOut(null); ensureOutDepts();}
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
          <p class="erp-text-sm erp-text-muted">التفريد هنا فحص واجهة لأن قاعدة البيانات
             لا تمنع تكرار الكود بعد. أزل التكرار من صنفٍ واحد ثم أعد الربط.</p>`);
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
              <td><input class="erp-input erp-input--ltr" type="date" value="${esc(l.expiryDate || '')}"
                         aria-label="تاريخ الصلاحية" aria-required="false" title="اختياري — YYYY-MM-DD"
                         data-v2-expiry="${esc(l.key)}"></td>
              <td><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-drop="${esc(l.key)}">حذف</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="6" class="erp-text-sm erp-text-muted">امسح كارتونةً واحدة أو أكثر — كل مسحٍ لنفس الكود يزيد عدَّه لا يضيف صنفًا.</td></tr>';
        panel('in').innerHTML = `
          <div class="gs-box">
            <p class="erp-text-sm erp-text-muted">الوارد يمرّ بدفتر المخزون نفسه الذي يعتمده النظام
              — لا كتابة مباشرة على رصيد الصنف، فالإسقاط يُعاد حسابه من الأرصدة.
              <strong>تاريخ الصلاحية اختياري</strong> — إن أُدخل فيجب أن يكون بصيغة YYYY-MM-DD.</p>
            <div class="gs-table-wrap"><table class="gs-table"><thead><tr><th>الصنف</th><th>المسح</th><th>الكمية</th><th>سعر الوحدة</th><th>تاريخ الصلاحية</th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
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

    /** رسم جلسة الصرف: المتاح بالرئيسي لكل سطر، القسم الطالب، والملاحظات. */
    function paintOut(active) {
        const totals = sessionTotals(outLines);
        const rowsHtml = outLines.length ? outLines.map((l) => {
            const m = outMeta.get(l.key) || {};
            const avail = Number(m.avail) || 0;
            const over = l.qty > avail;
            return `<tr>
              <td>${esc(m.name || l.key)}</td>
              <td class="gs-tnum" dir="ltr">${esc(formatQty(avail))} ${esc(m.unit || '')}</td>
              <td><input class="erp-input erp-input--ltr gs-qty" type="number" min="0" step="0.001" value="${esc(l.qty)}" data-v2-oqty="${esc(l.key)}"></td>
              <td>${over ? '<span class="gs-warn erp-text-sm">فوق المتاح</span>' : ''}</td>
              <td><button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-odrop="${esc(l.key)}">حذف</button></td>
            </tr>`;
        }).join('') : '<tr><td colspan="5" class="erp-text-sm erp-text-muted">امسح باركود الصنف المراد صرفه — كل مسحٍ لنفس الكود يزيد كميته، والكمية بالوحدة الأساسية.</td></tr>';
        const deptOpts = '<option value="">— اختر القسم الطالب —</option>'
            + outDepts.map((d) => `<option value="${esc(d.code)}"${outDept === d.code ? ' selected' : ''}>${esc(d.name)}</option>`).join('');
        panel('out').innerHTML = `
          <div class="gs-box">
            <p class="erp-text-sm erp-text-muted">الصرف هنا ينشئ <strong>أذون صرف معلّقًا</strong> يمرّ بسلسلة الاعتماد القائمة — اعتماد الشيف العمومي ثم المخازن ثم الاستلام،
              والتواقيع تُؤخذ عند تلك المراحل لا هنا. الرصيد يُقاس على المخزن الرئيسي، ويتحقق النظام منه مرة أخرى عند الإنشاء.</p>
            <div class="gs-table-wrap"><table class="gs-table"><thead><tr><th>الصنف</th><th>المتاح بالرئيسي</th><th>الكمية</th><th></th><th></th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
            <p class="erp-text-sm">${esc(`${totals.lines} صنفًا · ${totals.qty} وحدة`)}</p>
            ${canDispatch ? `<div class="gs-manual-add">
              <label class="erp-label" for="gs-out-search">إضافة صنف يدويًا بالاسم</label>
              <input class="erp-input" id="gs-out-search" type="search" maxlength="100" autocomplete="off"
                     placeholder="اكتب اسم الصنف للبحث" data-v2-osearch>
              <div class="gs-picks" data-v2-osearch-results aria-live="polite"></div>
            </div>` : ''}
            <label class="erp-label" for="gs-out-dept">القسم الطالب *</label>
            <select class="erp-input" id="gs-out-dept" data-v2-odept>${deptOpts}</select>
            <label class="erp-label" for="gs-out-notes">ملاحظات الطلب</label>
            <textarea class="erp-input" id="gs-out-notes" rows="2" data-v2-onotes>${esc(outNotes)}</textarea>
            <div class="gs-actions">
              <button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-opost ${canDispatch && outLines.length && outDept ? '' : 'disabled'}>إرسال أذون الصرف</button>
              <button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-oreset ${outLines.length ? '' : 'disabled'}>تفريغ الجلسة</button>
            </div>
            ${active ? itemLine(active) : ''}
            ${canDispatch ? '' : '<p class="gs-warn erp-text-sm">حسابك لا يُنشئ أذون صرف — الأدوار: الشيف والمدير والمخازن ورئيس القسم.</p>'}
          </div>`;
    }

    function paintOutAmbiguous(items) {
        outAmbiguous = Array.isArray(items) ? items.slice() : [];
        panel('out').innerHTML = `<div class="gs-box">
          <p class="gs-warn erp-text-sm">الكود على أكثر من صنف — حدّد أيهما يُصرَّف:</p>
          ${items.map((r) => `<button type="button" class="gs-pick" data-v2-ochse="${esc(r.id)}">${esc(r.name)} <span class="erp-text-sm erp-text-muted">${esc(r.unit || '')} · رصيد ${esc(formatQty(Number(r.mainQty) || 0))}</span></button>`).join('')}
        </div>`;
    }

    /** إرسال جلسة الصرف كأذونٍ واحد معلّق — الحمولة كما تقبلها شاشة الأذون حرفًا. */
    async function postOut() {
        if (!canDispatch) {say('لا صلاحية إنشاء أذون صرف لهذا الحساب.'); return;}
        if (!outLines.length) {say('لا أصناف في جلسة الصرف.'); return;}
        if (!outDept) {say('اختر القسم الطالب قبل الإرسال.'); return;}
        const items = outLines
            .map((l) => {
                const m = outMeta.get(l.key);
                return m ? { itemName: m.name, qty: l.qty, unit: m.unit } : null;
            })
            .filter((x) => x && x.itemName && x.qty > 0);
        if (!items.length) {say('لا صنف صالح للإرسال — راجع الكميات.'); return;}
        const deptName = (outDepts.find((d) => d.code === outDept) || {}).name || undefined;
        const today = new Date();
        const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        busy = true;
        try {
            await createDispatch({ deptCode: outDept, deptName, items, notes: outNotes, status: 'pending', date: iso });
            if (!el.isConnected) {busy = false; return;}
            notify(`أُرسل أذون صرف لقسم «${deptName || outDept}» — ${items.length} صنفًا، بانتظار الاعتماد`);
            say('أُنشئ أذون الصرف المعلّق ودخل سلسلة الاعتماد. تتابعه من شاشة أذونات الصرف.');
            outLines = [];
            outMeta.clear();
            outNotes = '';
            paintOut(null);
        } catch (e) {
            const m = String((e && e.message) || '');
            if ((e && e.code === 'INSUFFICIENT_STOCK') || /الرصيد|INSUFFICIENT/.test(m)) {
                say(`رفض الخادم — ${m || 'الرصيد غير كافٍ في المخزن الرئيسي.'}`);
            } else if ((e && e.code === 'DUPLICATE_DISPATCH') || /مكرر|مشابه|DUPLICATE/.test(m)) {
                say('أذون مشابه مسجّل بالفعل — لم يتكرر.');
            } else {
                say(writeFailure(e));
            }
        } finally {
            busy = false;
        }
    }

    /** جلسة الوارد تُرسَل صنفًا صنفًا بالباب نفسه، والتسلسل لا التوازي:
     *  كل طلبٍ يفتح معاملة `FOR UPDATE` في الخادم، والتوازي يولّد تنافسًا
     *  على القفل بلا فائدة، وفشل صنفٍ لا يُبطل ما سبق. */
    async function postSession() {
        if (!canWrite) {say('لا صلاحية تسجيل وارد لهذا الحساب.'); return;}
        if (!lines.length) {say('لا أصناف في الجلسة.'); return;}
        // حارس الصلاحية (سياسة 2026-10-20) — الغياب مقبول، والصيغة الفاسدة فقط تُوقف الدفعة.
        const inGate = checkExpiryOnLines(lines.map((l) => ({
            name: (rows.find((r) => String(r.id) === l.key) || {}).name || l.key,
            expiryDate: l.expiryDate,
        })));
        if (!inGate.ok) {say(`توقف: ${inGate.message}`); return;}
        busy = true;
        const results = [];
        for (const l of lines) {
            const raw = rows.find((r) => String(r.id) === l.key);
            if (!raw) {results.push({ key: l.key, ok: false, message: 'الصنف غير موجود في النتيجة' }); continue;}
            try {
                await receiveInventoryItem(raw.id, receiptPayload(raw, l.qty, l.price == null ? '' : l.price, l.expiryDate));
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
        q('[data-v2-camwrap]').hidden = false;
        if (window.isSecureContext === false) {
            camSay('كاميرا الجوال تحتاج اتصالًا آمنًا HTTPS أو localhost — أو استخدم قارئ QR/USB.');
            return;
        }
        camSay('جارٍ تجهيز الكاميرا…');
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
            const qrbox = {
                width: Math.max(180, Math.min(300, window.innerWidth - 32)),
                height: Math.max(180, Math.min(280, window.innerHeight * 0.35)),
            };
            await inst.start({ facingMode: 'environment' }, { fps: 10, qrbox },
                (text) => { stopCamera(); submit(text); }, () => {});
            camOn = true;
            camSay('وجّه الباركود أو رمز QR إلى الإطار، واسمح للمتصفح باستخدام الكاميرا.');
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
        /* — وضع الصرف — */
        const ochse = t.closest('[data-v2-ochse]');
        if (ochse) {
            const raw = outAmbiguous.find((r) => String(r.id) === ochse.getAttribute('data-v2-ochse'));
            if (raw) {
                outAmbiguous = [];
                addOutItem(raw);
            }
            return;
        }
        const oadd = t.closest('[data-v2-oadd]');
        if (oadd) {
            const id = oadd.getAttribute('data-v2-oadd');
            const item = outSearchItems.get(String(id));
            if (!item) {say('انتهت نتيجة البحث — أعد البحث عن الصنف.'); return;}
            addOutItem(item);
            return;
        }
        const odrop = t.closest('[data-v2-odrop]');
        if (odrop) {
            const key = odrop.getAttribute('data-v2-odrop');
            outLines = dropLine(outLines, key);
            outMeta.delete(key);
            paintOut(null);
            return;
        }
        if (t.closest('[data-v2-opost]')) {await postOut(); return;}
        if (t.closest('[data-v2-oreset]')) {
            outLines = [];
            outMeta.clear();
            outNotes = '';
            paintOut(null);
            say('أُفرغت جلسة الصرف.');
            return;
        }
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
            return;
        }
        const expiry = ev.target.closest('[data-v2-expiry]');
        if (expiry) {
            // مثل السعر: على السطر وبلا إعادة رسم — الصلاحية اختيارية عند التسجيل.
            lines = setLineExpiry(lines, expiry.getAttribute('data-v2-expiry'), expiry.value);
            return;
        }
        /* — وضع الصرف — */
        const oqty = ev.target.closest('[data-v2-oqty]');
        if (oqty) {
            outLines = setLineQty(outLines, oqty.getAttribute('data-v2-oqty'), oqty.value);
            paintOut(null);
            return;
        }
        const odept = ev.target.closest('[data-v2-odept]');
        if (odept) {
            outDept = odept.value;
            paintOut(null); // إعادة الرسم تفعّل زر الإرسال؛ ولا نلمس حقلًا ينتظر الكتابة.
            return;
        }
        const onotes = ev.target.closest('[data-v2-onotes]');
        if (onotes) {outNotes = onotes.value;} // بلا إعادة رسم حتى لا ينقطع تركيز النص
    });

    el.addEventListener('input', (ev) => {
        const search = ev.target.closest('[data-v2-osearch]');
        if (!search) {return;}
        clearTimeout(outSearchTimer);
        const term = search.value.trim();
        const results = q('[data-v2-osearch-results]');
        const sequence = ++outSearchSequence;
        outSearchItems.clear();
        if (!term) {
            if (results) {results.innerHTML = '';}
            return;
        }
        if (results) {results.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ البحث عن الصنف…</p>';}
        outSearchTimer = setTimeout(async () => {
            try {
                const matches = await searchItems(term);
                const currentSearch = q('[data-v2-osearch]');
                const target = q('[data-v2-osearch-results]');
                if (!el.isConnected || sequence !== outSearchSequence || mode !== 'out'
                    || !currentSearch || currentSearch.value.trim() !== term || !target) {return;}
                const available = matches.filter((item) => Number(item.mainQty) > 0).slice(0, 30);
                available.forEach((item) => {outSearchItems.set(String(item.id), item);});
                target.innerHTML = available.length
                    ? available.map((item) => `<button type="button" class="gs-pick" data-v2-oadd="${esc(item.id)}">
                        <span>${esc(item.name)} <span class="erp-text-sm erp-text-muted">${esc(item.unit || '')}</span></span>
                        <span class="erp-text-sm erp-text-muted">متاح ${esc(formatQty(Number(item.mainQty) || 0))}</span>
                      </button>`).join('')
                    : '<p class="erp-text-sm erp-text-muted">لا توجد أصناف مطابقة لها رصيد في المخزن الرئيسي.</p>';
            } catch (error) {
                if (!el.isConnected || sequence !== outSearchSequence) {return;}
                const target = q('[data-v2-osearch-results]');
                if (target) {target.innerHTML = `<p class="gs-warn erp-text-sm">${esc(writeFailure(error))}</p>`;}
                say(`تعذّر البحث اليدوي: ${(error && error.message) || 'خطأ'}`);
            }
        }, 250);
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
            clearTimeout(outSearchTimer);
            stopCamera();
            if (covTable) {covTable.destroy(); covTable = null;}
            el.remove();
        },
    };
}
