/**
 * features/inventory-inquiry.js — استعلامات المخزون (الواجهة القديمة · قراءة فقط)
 * ═════════════════════════════════════════════════════════════════════════════
 * صفحتان على نفس الباب الخلفي الذي تستخدمه V2 (/api/inventory-inquiry)، بلا أي
 * حساب جديد في المتصفح:
 *   • renderInventoryQueryPage()  → مفتاح القائمة 'query'        — محرك الاستعلامات
 *   • renderItemCardPage()        → مفتاح القائمة 'professional' — بطاقة الصنف
 *
 * أسئلة المالك بحروفه، وباب واحد لكل إجابة:
 *   «أي صنف دخل من الفواتير وكم عدده؟»  → /items.qtyInPurchases (دفتر + عائلته)
 *   «واللي في المخزن واللي تم صرفه؟»    → /items.onHand و qtyOutTotal
 *   «أي صنف كم منه اتبع؟»               → soldPos (معرف) | soldYara (اسم) — عمودان
 *   «كم الكوست العام وكم كوست أي قسم؟»  → /departments.costTotal لكل قسم + totals
 *
 * قاعدتان لا تُكسران هنا:
 *   1) soldPos مربوط بـ legacy_inventory_id (حقيقة) وsoldYara مربوط بالاسم
 *      المطبَّع (تقريب). لا يُجمعان في رقم ولا في خلية واحدة أبدًا.
 *   2) costTotal = تكلفة صرف الدفتر للقسم + مصروفه التشغيلي فقط. سطور
 *      expenses المخزنية/الجرديه مستثناة لأنها نفس قيود الدفتر — جمعها يضاعف.
 *
 * القراءة للمدير والسو-شيف (أو من مُنح inventory-inquiry.view) — الحاكم الخادم.
 */

const IQ = {
    from: '', to: '', q: '', cat: '', only: 'all', sort: 'movements', dir: 'desc', dept: '',
    rows: [], totals: null, meta: null, depts: null, currency: '',
    loading: false, card: null, cardId: null, openCardId: null,
};

/* ── أدوات تنسيق محلية (لا تُضاف لأي ملف مشترك حتى لا تتغير الواجهة القديمة) ── */
function iqToday(offsetDays = 0) {
    try {
        const d = new Date(Date.now() + offsetDays * 86400000);
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch (_) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        return d.toISOString().slice(0, 10);
    }
}
function iqMonthStart() { return iqToday(0).slice(0, 8) + '01'; }
function iqEsc(v) {
    if (typeof esc === 'function') { return esc(v); }
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function iqNum(v) { return Number(v || 0).toLocaleString('ar-EG', { maximumFractionDigits: 3 }); }
function iqMoney(v) {
    const n = Number(v || 0);
    const unit = IQ.currency ? ` ${IQ.currency}` : '';
    return `${n.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
}
function iqSigned(v) { return `${Number(v || 0) > 0 ? '+' : ''}${iqNum(v)}`; }

/** شارة الصلاحية — نفس قرار V2: انتهت / خلال 7 / سليمة / بلا تاريخ. */
function iqExpiryBadge(nearest, today) {
    if (!nearest) { return '<span class="u-dim">—</span>'; }
    const d = String(nearest).slice(0, 10);
    const t = String(today || iqToday(0)).slice(0, 10);
    if (d < t) { return '<span class="badge bdg-red">منتهية</span>'; }
    const days = Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${t}T12:00:00Z`)) / 86400000);
    if (days <= 7) { return `<span class="badge" style="background:#fef3c7;color:#92400e">خلال ${iqNum(days)} يومًا</span>`; }
    return '<span class="badge bdg-green">سليمة</span>';
}

function iqCurrency() {
    try { IQ.currency = String((typeof STATE !== 'undefined' && STATE.settings && STATE.settings.currency) || ''); }
    catch (_) { IQ.currency = ''; }
}

/* ── الصفحة 1: محرك الاستعلامات ── */
async function renderInventoryQueryPage() {
    const content = document.getElementById('content');
    if (!content) { return; }
    iqCurrency();
    if (!IQ.from || !IQ.to) { IQ.from = iqToday(-29); IQ.to = iqToday(0); }
    content.innerHTML = iqShell();
    await iqReload();
}

function iqShell() {
    return `
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
    <h3 class="u-gold-strong"><i class=ji data-i=search></i> محرك استعلامات المخزون — دخول · مخزن · انصراف · مبيع · تكلفة</h3>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <span class="u-dim" style="font-size:12px">قراءة فقط من دفتر المخزون</span>
      <button class="btn btn-sm" onclick="iqPrintReport()"><i class=ji data-i=printer></i> طباعة</button>
      <button class="btn btn-sm" onclick="iqExportExcel()"><i class=ji data-i=inbox></i> Excel</button>
      <button class="btn btn-sm btn-primary" onclick="iqReload()"><i class=ji data-i=refresh></i> استعلام</button>
    </div>
  </div>
  <div style="background:var(--card,#fff);padding:14px;border-radius:12px;border:1px solid var(--border,#e5e7eb);margin-bottom:14px">
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:10px">
      <label style="font-size:13px">من <input type="date" id="iqFrom" value="${iqEsc(IQ.from)}" class="inp" style="width:150px"></label>
      <label style="font-size:13px">إلى <input type="date" id="iqTo" value="${iqEsc(IQ.to)}" class="inp" style="width:150px" max="${iqEsc(iqToday(0))}"></label>
      <div style="display:flex;gap:4px;flex-wrap:wrap">
        <button class="btn btn-sm" onclick="iqPreset('today')">اليوم</button>
        <button class="btn btn-sm" onclick="iqPreset('yesterday')">أمس</button>
        <button class="btn btn-sm" onclick="iqPreset(7)">7 أيام</button>
        <button class="btn btn-sm btn-primary" onclick="iqPreset(30)">30 يوم</button>
        <button class="btn btn-sm" onclick="iqPreset('month')">هذا الشهر</button>
      </div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
      <label style="font-size:13px;flex:1;min-width:220px">بحث
        <input type="search" id="iqQ" value="${iqEsc(IQ.q)}" class="inp" style="width:100%" placeholder="اسم أو تصنيف أو باركود" autocomplete="off" onkeydown="if(event.key==='Enter')iqApply()">
      </label>
      <label style="font-size:13px">مخزن القسم
        <select id="iqDept" class="inp" style="width:200px" onchange="iqApply()">
          <option value="">المخزن الرئيسي وكل الأقسام</option>
        </select>
      </label>
      <label style="font-size:13px">تصنيف
        <select id="iqCat" class="inp" style="width:170px" onchange="iqApply()"><option value="">الكل</option></select>
      </label>
      <label style="font-size:13px">الحالة
        <select id="iqOnly" class="inp" style="width:170px" onchange="iqApply()">
          <option value="all" ${IQ.only === 'all' ? 'selected' : ''}>كل الأصناف</option>
          <option value="moved" ${IQ.only === 'moved' ? 'selected' : ''}>تحركت في المدى</option>
          <option value="active" ${IQ.only === 'active' ? 'selected' : ''}>موجودة أو متحركة</option>
          <option value="low" ${IQ.only === 'low' ? 'selected' : ''}>تحت الحد</option>
          <option value="expired" ${IQ.only === 'expired' ? 'selected' : ''}>صلاحية منتهية</option>
        </select>
      </label>
      <label style="font-size:13px">ترتيب
        <select id="iqSort" class="inp" style="width:170px" onchange="iqApply()">
          <option value="movements" ${IQ.sort === 'movements' ? 'selected' : ''}>الأكثر حركة</option>
          <option value="onHand" ${IQ.sort === 'onHand' ? 'selected' : ''}>الأعلى رصيدًا</option>
          <option value="value" ${IQ.sort === 'value' ? 'selected' : ''}>الأعلى قيمة</option>
          <option value="qtyIn" ${IQ.sort === 'qtyIn' ? 'selected' : ''}>الأكثر دخولًا</option>
          <option value="qtyOut" ${IQ.sort === 'qtyOut' ? 'selected' : ''}>الأكثر انصرافًا</option>
          <option value="sold" ${IQ.sort === 'sold' ? 'selected' : ''}>الأكثر مبيعًا</option>
          <option value="cost" ${IQ.sort === 'cost' ? 'selected' : ''}>الأعلى كوستًا</option>
          <option value="expiry" ${IQ.sort === 'expiry' ? 'selected' : ''}>أقرب صلاحية</option>
          <option value="name" ${IQ.sort === 'name' ? 'selected' : ''}>الاسم</option>
        </select>
      </label>
      <button class="btn btn-primary" onclick="iqApply()"><i class=ji data-i=search></i> استعلام</button>
    </div>
  </div>
  <div id="iqScope" class="u-dim" style="font-size:12px;margin-bottom:10px"></div>
  <div id="iqCards" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px"></div>
  <div id="iqBody"><div class="u-empty"><div class="spinner"></div> جارٍ الاستعلام…</div></div>
  <div id="iqCard"></div>
  <div id="iqDepts"></div>`;
}

/* ── تحميل المحرك ── */
async function iqReload(silent) {
    if (IQ.loading) { return; }
    const body = document.getElementById('iqBody');
    if (!body) { return; }
    iqCurrency();
    IQ.loading = true;
    if (!silent) { body.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ الاستعلام…</div>'; }
    try {
        const p = new URLSearchParams({ from: IQ.from, to: IQ.to, only: IQ.only, sort: IQ.sort, dir: IQ.dir, limit: '500' });
        if (IQ.q) { p.set('q', IQ.q); }
        if (IQ.cat) { p.set('cat', IQ.cat); }
        if (IQ.dept) { p.set('dept', IQ.dept); }
        const [items, depts] = await Promise.all([
            apiFetch(`/inventory-inquiry/items?${p.toString()}`),
            apiFetch(`/inventory-inquiry/departments?from=${encodeURIComponent(IQ.from)}&to=${encodeURIComponent(IQ.to)}`).catch(() => null),
        ]);
        IQ.rows = items.rows || [];
        IQ.totals = items.totals || null;
        IQ.meta = items.meta || null;
        IQ.depts = depts;
        IQ.fillPickers();
        iqRenderCards();
        iqRenderTable();
        iqRenderDepts();
        const scope = document.getElementById('iqScope');
        if (scope) {
            const y = (IQ.meta && IQ.meta.yara) || {};
            scope.textContent = `${IQ.from} ← ${IQ.to}${IQ.dept ? ` · مخزن القسم ${IQ.dept}` : ' · كل المواقع'}`
                + ` · ${IQ.rows.length} صنفًا من ${iqNum((IQ.totals || {}).items || IQ.rows.length)}`
                + ` · مرآة يارا: ${iqNum(y.qtyMatched || 0)} من ${iqNum(y.qtyTotal || 0)} مطابقة بالاسم`;
        }
    } catch (e) {
        IQ.rows = []; IQ.totals = null; IQ.depts = null;
        const cards = document.getElementById('iqCards');
        const depts = document.getElementById('iqDepts');
        const scope = document.getElementById('iqScope');
        if (cards) { cards.innerHTML = ''; }
        if (depts) { depts.innerHTML = ''; }
        if (scope) { scope.textContent = ''; }
        body.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> ${iqEsc(iqErrorText(e))}</div>`;
    } finally {
        IQ.loading = false;
    }
}

function iqErrorText(e) {
    const m = String((e && e.message) || e || '');
    if (m === 'UNAUTHORIZED') { return 'انتهت الجلسة — سجّل الدخول من النظام ثم أعد فتح الصفحة.'; }
    const code = String((e && e.code) || '');
    if (code === 'RANGE_TOO_WIDE') { return 'المدى أوسع مما يسمح الخادم — قلّصه إلى 93 يومًا أو أقل.'; }
    if (code === 'FORBIDDEN') { return 'لا صلاحية لاستعلامات المخزون بهذا الحساب — القرار للخادم.'; }
    return `تعذّر الاستعلام: ${m || 'خطأ'}`;
}

IQ.fillPickers = function () {
    const deptSel = document.getElementById('iqDept');
    if (deptSel) {
        deptSel.innerHTML = '<option value="">المخزن الرئيسي وكل الأقسام</option>'
            + ((IQ.depts && IQ.depts.rows) || []).map((d) => `<option value="${iqEsc(d.code)}" ${String(d.code) === String(IQ.dept) ? 'selected' : ''}>${iqEsc(d.name)}</option>`).join('');
    }
    const catSel = document.getElementById('iqCat');
    if (catSel) {
        const cats = [...new Set(IQ.rows.map((r) => r.category).filter(Boolean))].sort();
        catSel.innerHTML = '<option value="">الكل</option>'
            + cats.map((c) => `<option value="${iqEsc(c)}" ${c === IQ.cat ? 'selected' : ''}>${iqEsc(c)}</option>`).join('');
    }
};

/* ── بطاقات الإجمالي ── */
function iqRenderCards() {
    const box = document.getElementById('iqCards');
    if (!box) { return; }
    const t = IQ.totals || {};
    const cells = [
        ['قيمة المخزون', iqMoney(t.stockValue), 'banknote'],
        ['داخل من الفواتير', iqSigned(t.qtyInPurchases), 'inbox'],
        ['المنصرف', iqNum(t.qtyOutTotal), 'upload'],
        ['كوست الشراء', iqMoney(t.purchaseCost), 'wallet'],
        ['تكلفة المنصرف', iqMoney(t.outCost), 'arrow-right'],
        ['مبيع الكاشيرية', iqNum(t.qtySoldPos), 'receipt'],
        ['إيراد الكاشيرية', iqMoney(t.revenuePos), 'chart'],
        ['أصناف مُجمَّعة', iqNum(t.items), 'layers'],
    ];
    box.innerHTML = cells.map(([label, value, icon], i) => `
      <div class="mcard" style="flex:1;min-width:150px;padding:12px;text-align:center${i === 0 ? ';background:linear-gradient(135deg,#f5d76e22,#f5d76e11)' : ''}">
        <div class="u-dim" style="font-size:12px"><i class=ji data-i=${icon}></i> ${iqEsc(label)}</div>
        <b style="font-size:20px">${value}</b>
      </div>`).join('');
}

/* ── جدول الأصناف ── */
function iqRenderTable() {
    const body = document.getElementById('iqBody');
    if (!body) { return; }
    if (!IQ.rows.length) {
        body.innerHTML = '<div class="u-empty"><i class=ji data-i=inbox></i> لا صنف يطابق المرشّحات في هذا المدى</div>';
        return;
    }
    const rows = IQ.rows.map((r, i) => {
        const out = Number(r.qtyOutTotal || 0), inn = Number(r.qtyInPurchases || 0);
        return `<tr>
        <td>${i + 1}</td>
        <td style="text-align:start"><b>${iqEsc(r.itemName)}</b>${r.category ? `<div class="u-dim" style="font-size:11px">${iqEsc(r.category)}</div>` : ''}</td>
        <td>${iqEsc(r.unit || '—')}</td>
        <td><b>${iqNum(r.onHand)}</b></td>
        <td class="${inn < 0 ? 'c-red' : 'c-green'}"><b>${iqSigned(inn)}</b></td>
        <td class="c-gold"><b>${iqNum(out)}</b></td>
        <td class="${Number(r.qtyNet || 0) < 0 ? 'c-red' : 'c-green'}">${iqSigned(r.qtyNet)}</td>
        <td><b>${iqNum(r.soldPos)}</b><div class="u-dim" style="font-size:11px">${iqNum(r.ordersPos)} أوردر</div></td>
        <td class="u-dim">${iqNum(r.soldYara)}${r.yaraMatched ? '' : '<div class="u-dim" style="font-size:11px">بلا مطابقة</div>'}</td>
        <td>${iqMoney(r.purchaseCost)}</td>
        <td>${iqMoney(r.outCost)}</td>
        <td>${iqMoney(r.stockValue)}</td>
        <td>${iqExpiryBadge(r.nearestExpiry, IQ.to)}</td>
        <td><button class="btn btn-sm" onclick="iqOpenCard(${Number(r.itemId)} )"><i class=ji data-i=id-card></i> البطاقة</button></td>
      </tr>`;
    }).join('');
    body.innerHTML = `
      <div style="overflow-x:auto">
        <div class="tbl-hd" style="padding:8px 0"><h3><i class=ji data-i=clipboard-list></i> حركة الأصناف — ${iqNum(IQ.rows.length)} صنفًا</h3></div>
        <table class="tbl">
          <thead><tr>
            <th>#</th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>دخل من الفواتير</th><th>المنصرف</th><th>صافي الحركة</th>
            <th>مبيع (POS · معرّف)</th><th>مبيع (يارا · اسم)</th><th>كوست الشراء</th><th>تكلفة المنصرف</th><th>قيمة المخزون</th><th>الصلاحية</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p class="u-dim" style="font-size:12px;margin-top:8px">
          عمودا المبيع لا يُجمعان: الكاشيرية مربوطة بالمعرّف (حقيقة) ومرآة يارا مربوطة بالاسم المطبَّع (تقريب).
          «دخل من الفواتير» صافٍ مُوقَّع يشمل عكوس الإلغاء والتعديل.
        </p>
      </div>`;
}

/* ── تكلفة الأقسام والكوست العام ── */
function iqRenderDepts() {
    const box = document.getElementById('iqDepts');
    if (!box) { return; }
    if (!IQ.depts) {
        box.innerHTML = '<div class="u-empty u-dim">لا بيانات لتكلفة الأقسام — تعذّرت قراءة هذا المصدر، ولا تُعرض أرقام صفرية توحي بأنها مطابقة.</div>';
        return;
    }
    const t = IQ.depts.totals || {};
    const un = IQ.depts.unattributed || {};
    const rows = (IQ.depts.rows || []).slice().sort((a, b) => Number(b.costTotal) - Number(a.costTotal));
    box.innerHTML = `
      <div class="mcard" style="margin-top:14px;padding:14px">
        <h3 style="margin:0 0 10px"><i class=ji data-i=building></i> الكوست العام وتكلفة كل قسم</h3>
        <p class="u-dim" style="font-size:12px;margin:0 0 10px">
          تكلفة القسم = تكلفة ما انصرف له من الدفتر بسعر التكلفة + مصروفه التشغيلي فقط. سطور مصروفات المخزون
          والجرد مستثناة لأنها نفس قيود الدفتر — جمعها يضاعف الرقم.
          غير مُسند لقسم معروف: صرف ${iqMoney(un.issuedCost)} ومصروف ${iqMoney(un.expenseOperating)}.
        </p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          ${[['الكوست العام', iqMoney(t.costTotal)], ['تكلفة الصرف', iqMoney(t.issuedCost)], ['مصروف تشغيلي', iqMoney(t.expenseOperating)],
    ['سطور مخزنية (غير محسوبة)', iqMoney(t.expenseStock)], ['قيمة المخزون', iqMoney(t.stockValue)], ['أقسام', iqNum(t.departments)]]
        .map(([k, v]) => `<div class="mcard" style="flex:1;min-width:150px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">${iqEsc(k)}</div><b style="font-size:18px">${v}</b></div>`).join('')}
        </div>
        <div style="overflow-x:auto"><table class="tbl">
          <thead><tr><th>القسم</th><th>منصرف (عدد)</th><th>تكلفة الصرف</th><th>تشغيلي</th><th>سطور مخزنية</th><th>تكلفة القسم</th><th>إيراد يدوي</th><th>إيراد الكاشيرية</th></tr></thead>
          <tbody>${rows.map((d) => `<tr>
            <td style="text-align:start"><b>${iqEsc(d.name)}</b>${d.parentCode ? `<div class="u-dim" style="font-size:11px">${iqEsc(d.parentCode)}</div>` : ''}</td>
            <td>${iqNum(d.issuedQty)}</td><td>${iqMoney(d.issuedCost)}</td><td>${iqMoney(d.expenseOperating)}</td>
            <td class="u-dim">${iqMoney(d.expenseStock)}</td><td><b>${iqMoney(d.costTotal)}</b></td>
            <td>${iqMoney(d.revenueManual)}</td><td>${iqMoney(d.revenuePos)}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="u-empty">لا أقسام في هذا المدى</td></tr>'}</tbody>
        </table></div>
      </div>`;
}

/* ── الفلاتر ── */
function iqApply() {
    IQ.from = document.getElementById('iqFrom')?.value || IQ.from;
    IQ.to = document.getElementById('iqTo')?.value || IQ.to;
    IQ.q = (document.getElementById('iqQ')?.value || '').trim();
    IQ.cat = document.getElementById('iqCat')?.value || '';
    IQ.only = document.getElementById('iqOnly')?.value || 'all';
    IQ.sort = document.getElementById('iqSort')?.value || 'movements';
    IQ.dept = document.getElementById('iqDept')?.value || '';
    iqReload();
}

function iqPreset(key) {
    const t = iqToday(0);
    if (key === 'today') { IQ.from = t; IQ.to = t; }
    else if (key === 'yesterday') { const y = iqToday(-1); IQ.from = y; IQ.to = y; }
    else if (key === 'month') { IQ.from = iqMonthStart(); IQ.to = t; }
    else { const days = Math.max(1, Number(key) - 1); IQ.from = iqToday(-days); IQ.to = t; }
    const f = document.getElementById('iqFrom'), to = document.getElementById('iqTo');
    if (f) { f.value = IQ.from; }
    if (to) { to.value = IQ.to; }
    iqReload();
}

/* ── بطاقة الصنف (تُفتح داخل المحرك أو في صفحتها المستقلة) ── */
async function iqOpenCard(itemId) {
    const id = Number(itemId);
    if (!id) { return; }
    IQ.cardId = id;
    const host = document.getElementById('iqCard');
    if (!host) {
        // صفحة البطاقة المستقلة: تُحمَّل البيانات ثم تُرسم في مكانها.
        await icLoad(id);
        return;
    }
    host.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ قراءة ملف الصنف…</div>';
    try {
        const data = await apiFetch(`/inventory-inquiry/item/${id}?from=${encodeURIComponent(IQ.from)}&to=${encodeURIComponent(IQ.to)}`);
        IQ.card = data;
        host.innerHTML = icCardHtml(data);
        host.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        host.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> ${iqEsc(iqErrorText(e))}</div>`;
    }
}

function icCardHtml(d) {
    const item = d.item || {};
    const p = d.purchases || {};
    const s = d.sales || {};
    const cardex = d.cardex || [];
    const batches = d.batches || [];
    const nearest = batches.length ? batches[0].expiryDate : null;
    const st = iqExpiryBadge(nearest, d.to);
    return `
  <div class="mcard" style="margin-top:14px;padding:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
      <div>
        <h3 style="margin:0"><i class=ji data-i=id-card></i> ${iqEsc(item.name)}
          <span class="u-dim" style="font-size:13px">· ${iqEsc(item.category || 'بلا تصنيف')} · ${iqEsc(item.unit || 'وحدة')}</span>
        </h3>
        <div class="u-dim" style="font-size:12px;margin-top:4px">
          ${item.barcode ? `<span style="direction:ltr">${iqEsc(item.barcode)}</span> · ` : ''}
          ${item.shelf ? `رف: ${iqEsc(item.shelf)} · ` : ''}
          ${item.lowStock ? '<span class="badge bdg-red">تحت الحد</span> · ' : ''}
          الصلاحية: ${st}
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="window.print()"><i class=ji data-i=printer></i> طباعة</button>
        <button class="btn btn-sm" onclick="iqCloseCard()"><i class=ji data-i=x></i> إغلاق</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
      ${[['الرصيد', iqNum(item.qty) + ' ' + iqEsc(item.unit || '')], ['قيمة المخزون', iqMoney(item.stockValue)],
    ['داخل من الفواتير', iqSigned(p.qty)], ['كوست المشتريات', iqMoney(p.cost)],
    ['مبيع بالكاشيرية', iqNum(s.pos)], ['إيراد الكاشيرية', iqMoney(s.net)]]
        .map(([k, v], i) => `<div class="mcard" style="flex:1;min-width:140px;padding:10px;text-align:center${i === 0 ? ';background:linear-gradient(135deg,#f5d76e22,#f5d76e11)' : ''}"><div class="u-dim" style="font-size:12px">${iqEsc(k)}</div><b style="font-size:18px">${v}</b></div>`).join('')}
    </div>
    ${icTable('كراسي الحركة — الرصيد الجاري', ['اليوم', 'الحركة', 'الكمية', 'الرصيد بعده', 'سعر التكلفة', 'الموقع', 'المرجع', 'الصلاحية'],
        cardex.slice(-40).reverse().map((r) => [iqEsc(r.date), iqTypeBadge(r),
            `<span class="${Number(r.delta) < 0 ? 'c-red' : 'c-green'}"><b>${iqSigned(r.delta)}</b></span>`,
            iqNum(r.runningQty), iqMoney(r.unitCost), iqEsc(r.location || '—'),
            `<span style="direction:ltr">${iqEsc(r.referenceType || '')}${r.referenceId ? ` #${iqEsc(r.referenceId)}` : ''}</span>`,
            r.expiryDate ? `<span style="direction:ltr">${iqEsc(r.expiryDate)}</span>` : '<span class="u-dim">—</span>']),
        'لا حركة في هذا المدى')}
    ${icTable('فواتير الشراء — صافٍ مُوقَّع (السالب عكس)', ['الفاتورة', 'اليوم', 'المورد', 'العدد', 'سعر الوحدة', 'قيمة السطر', 'الصلاحية'],
        (p.invoices || []).map((r) => [iqEsc(r.invoiceNumber || `#${r.invoiceId}`), `<span style="direction:ltr">${iqEsc(r.day)}</span>`,
            iqEsc(r.supplier || '—'), `<span class="${Number(r.qty) < 0 ? 'c-red' : ''}"><b>${iqSigned(r.qty)}</b></span>`,
            iqMoney(r.unitCost), iqMoney(r.lineTotal), r.expiryDate ? `<span style="direction:ltr">${iqEsc(r.expiryDate)}</span>` : '<span class="u-dim">—</span>']),
        'لا فاتورة شراء في هذا المدى')}
    ${icTable('انصرف لهذه الأقسام', ['القسم', 'العدد', 'التكلفة', 'عدد السندات'],
        (d.departments || []).map((r) => [iqEsc(r.deptName || r.deptCode || '—'), iqNum(r.qty), iqMoney(r.cost), iqNum(r.docs)]),
        'لا صرف لأقسام في هذا المدى')}
    ${icTable('دُفعات الصلاحية', ['الصلاحية', 'الحالة', 'رقم الدفعة', 'العدد', 'عدد القيود'],
        (d.batches || []).map((r) => [r.expiryDate ? `<span style="direction:ltr">${iqEsc(r.expiryDate)}</span>` : '<span class="u-dim">بلا تاريخ</span>',
            iqExpiryBadge(r.expiryDate, d.to), r.lot ? `<span style="direction:ltr">${iqEsc(r.lot)}</span>` : '<span class="u-dim">—</span>',
            iqNum(r.qty), iqNum(r.postings)]),
        'لا دُفعات مسجلة في هذا المدى')}
    ${icTable('خطوط بيع الكاشيرية — ربط بالمعرّف', ['اليوم', 'الأوردر', 'القسم', 'الكاشير', 'العدد', 'السعر', 'الإجمالي'],
        (s.lines || []).map((r) => [`<span style="direction:ltr">${iqEsc(r.day)}</span>`,
            `<span style="direction:ltr">${iqEsc(r.orderId)}</span>`, iqEsc(r.dept || '—'), iqEsc(r.cashier || '—'),
            iqNum(r.qty), iqMoney(r.unitPrice), iqMoney(r.lineTotal)]),
        'لا أسطر بيع لهذا الصنف في هذا المدى')}
    <p class="u-dim" style="font-size:12px;margin:10px 0 0">${iqEsc(p.note || '')}</p>
    <p class="u-dim" style="font-size:12px;margin:4px 0 0">${iqEsc(s.note || '')}</p>
  </div>`;
}

function icTable(title, heads, rows, emptyText) {
    return `
    <div style="margin-top:12px">
      <div class="tbl-hd" style="padding:6px 0"><h3 style="font-size:15px"><i class=ji data-i=clipboard-list></i> ${iqEsc(title)}</h3></div>
      <div style="overflow-x:auto"><table class="tbl">
        <thead><tr>${heads.map((h) => `<th>${iqEsc(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')
        || `<tr><td colspan="${heads.length}" class="u-empty">${iqEsc(emptyText)}</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

/** أسماء أنواع الدفتر بالعربية — نفس قيم CHECK في migration 021. */
function iqTypeBadge(r) {
    const TYPES = {
        opening_balance: 'رصيد افتتاحي', purchase_receipt: 'استلام شراء', transfer_out: 'تحويل صادر',
        transfer_in: 'تحويل وارد', sale_consumption: 'استهلاك بيع', production_consumption: 'استهلاك إنتاج',
        production_output: 'إنتاج تام', waste: 'هدر', return: 'مرتجع', adjustment: 'تسوية',
        count_correction: 'فرق جرد', reversal: 'عكس قيد', receiving_variance: 'فرق استلام',
        other_approved_movement: 'حركة معتمدة أخرى',
    };
    const label = TYPES[r.type] || r.type || 'حركة';
    const tone = Number(r.delta) < 0 ? 'bdg-red' : 'bdg-green';
    return `<span class="badge ${tone}">${iqEsc(label)}</span>${r.referenceType && r.referenceType !== r.type ? `<div class="u-dim" style="font-size:11px">${iqEsc(r.referenceType)}</div>` : ''}`;
}

function iqCloseCard() {
    IQ.card = null;
    const host = document.getElementById('iqCard');
    if (host) { host.innerHTML = ''; }
}

/* ── الصفحة 2: بطاقة الصنف المستقلة ── */
async function renderItemCardPage() {
    const content = document.getElementById('content');
    if (!content) { return; }
    iqCurrency();
    if (!IQ.from || !IQ.to) { IQ.from = iqToday(-29); IQ.to = iqToday(0); }
    content.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
        <h3 class="u-gold-strong"><i class=ji data-i=id-card></i> بطاقة الصنف الفاخرة — ملف كامل من دفتر المخزون</h3>
        <span class="u-dim" style="font-size:12px">قراءة فقط · ${iqEsc(IQ.from)} ← ${iqEsc(IQ.to)}</span>
      </div>
      <div style="background:var(--card,#fff);padding:14px;border-radius:12px;border:1px solid var(--border,#e5e7eb);margin-bottom:14px">
        <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
          <label style="font-size:13px">من <input type="date" id="iqFrom" value="${iqEsc(IQ.from)}" class="inp" style="width:150px"></label>
          <label style="font-size:13px">إلى <input type="date" id="iqTo" value="${iqEsc(IQ.to)}" class="inp" style="width:150px" max="${iqEsc(iqToday(0))}"></label>
          <div style="display:flex;gap:4px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="iqPreset('today')">اليوم</button>
            <button class="btn btn-sm" onclick="iqPreset(7)">7 أيام</button>
            <button class="btn btn-sm btn-primary" onclick="iqPreset(30)">30 يوم</button>
            <button class="btn btn-sm" onclick="iqPreset(90)">90 يوم</button>
          </div>
          <label style="font-size:13px;flex:1;min-width:220px">الصنف
            <select id="icPick" class="inp" style="width:100%" onchange="iqOpenCard(this.value)"><option value="">جارٍ القراءة…</option></select>
          </label>
        </div>
      </div>
      <div id="iqCard"><div class="u-empty"><div class="spinner"></div> جارٍ تجهيز البطاقة…</div></div>`;
    await icLoad(IQ.cardId || null);
}

async function icLoad(preferredId) {
    const pick = document.getElementById('icPick');
    const host = document.getElementById('iqCard');
    if (!pick || !host) { return; }
    host.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ القراءة…</div>';
    try {
        const list = await apiFetch(`/inventory-inquiry/items?from=${encodeURIComponent(IQ.from)}&to=${encodeURIComponent(IQ.to)}&sort=movements&limit=200`);
        const rows = list.rows || [];
        const wanted = Number(preferredId) || (rows[0] ? Number(rows[0].itemId) : 0);
        pick.innerHTML = rows.length
            ? rows.map((r) => `<option value="${Number(r.itemId)}" ${Number(r.itemId) === wanted ? 'selected' : ''}>${iqEsc(r.itemName)}${r.category ? ` — ${iqEsc(r.category)}` : ''}</option>`).join('')
            : '<option value="">لا صنف في هذا المدى</option>';
        if (!rows.length) {
            host.innerHTML = '<div class="u-empty"><i class=ji data-i=inbox></i> لا صنف لعرضه — وسّع المدى أو ارجع للمحرك</div>';
            return;
        }
        IQ.cardId = wanted;
        const data = await apiFetch(`/inventory-inquiry/item/${wanted}?from=${encodeURIComponent(IQ.from)}&to=${encodeURIComponent(IQ.to)}`);
        IQ.card = data;
        host.innerHTML = icCardHtml(data);
    } catch (e) {
        pick.innerHTML = '<option value="">تعذّر القراءة</option>';
        host.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> ${iqEsc(iqErrorText(e))}</div>`;
    }
}

/* ── Excel ── */
function iqExportExcel() {
    if (typeof XLSX === 'undefined') { toast('مكتبة Excel غير محمّلة — حدّث الصفحة', 'error'); return; }
    const head = ['الصنف', 'التصنيف', 'الوحدة', 'الرصيد بالمخزن', 'داخل من الفواتير (صافي)', 'داخل آخر', 'المنصرف كله',
        'صرف للأقسام', 'مستهلك في البيع', 'صافي الحركة', 'كوست الشراء', 'تكلفة المنصرف', 'قيمة المخزون',
        'مبيع بالعدد (POS — معرّف)', 'إيراد POS', 'مبيع بالعدد (مرآة يارا — اسم)', 'أقرب صلاحية'];
    const data = [head, ...IQ.rows.map((r) => [r.itemName, r.category, r.unit, r.onHand, r.qtyInPurchases, r.qtyInOther,
        r.qtyOutTotal, r.qtyOutDispatch, r.qtyOutSale, r.qtyNet, r.purchaseCost, r.outCost, r.stockValue,
        r.soldPos, r.revenuePos, r.soldYara, r.nearestExpiry || ''])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), 'الأصناف');
    const dh = ['القسم', 'منصرف (عدد)', 'تكلفة الصرف', 'تشغيلي', 'سطور مخزنية', 'تكلفة القسم', 'إيراد يدوي', 'إيراد الكاشيرية'];
    const dd = [dh, ...((IQ.depts && IQ.depts.rows) || []).map((d) => [d.name, d.issuedQty, d.issuedCost,
        d.expenseOperating, d.expenseStock, d.costTotal, d.revenueManual, d.revenuePos])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dd), 'تكلفة الأقسام');
    XLSX.writeFile(wb, `inventory-inquiry_${IQ.from}_${IQ.to}.xlsx`);
    toast('تم تصدير Excel', 'success');
}

/* ── طباعة ── */
function iqPrintReport() {
    const t = IQ.totals || {};
    const rows = IQ.rows.map((r, i) => `<tr><td>${i + 1}</td><td style="text-align:start">${iqEsc(r.itemName)}</td>
      <td>${iqNum(r.onHand)}</td><td>${iqSigned(r.qtyInPurchases)}</td><td>${iqNum(r.qtyOutTotal)}</td>
      <td>${iqNum(r.soldPos)}</td><td>${iqNum(r.soldYara)}</td><td>${iqMoney(r.purchaseCost)}</td>
      <td>${iqMoney(r.outCost)}</td><td>${iqMoney(r.stockValue)}</td><td>${iqEsc(r.nearestExpiry || '—')}</td></tr>`).join('');
    const w = window.openInAppReport ? window.openInAppReport('تقرير استعلامات المخزون') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير استعلامات المخزون</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}
    h2{text-align:center;color:#666;font-size:14px;margin-bottom:12px}.summary{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:14px}
    .summary div{border:1px solid #999;padding:8px 16px;border-radius:6px;font-size:13px}table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #999;padding:5px;text-align:center}th{background:#0f172a;color:#f5d76e}
    .controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
    .bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" onclick="window.print()">طباعة</button><button class="bc" onclick="window.close()">إغلاق</button></div>
    <h1>تقرير استعلامات المخزون</h1>
    <h2>من ${iqEsc(IQ.from)} إلى ${iqEsc(IQ.to)}${IQ.dept ? ' · مخزن قسم: ' + iqEsc(IQ.dept) : ''}</h2>
    <div class="summary"><div>الأصناف: <b>${iqNum(t.items)}</b></div><div>قيمة المخزون: <b>${iqMoney(t.stockValue)}</b></div>
      <div>دخل: <b>${iqSigned(t.qtyInPurchases)}</b></div><div>انصرف: <b>${iqNum(t.qtyOutTotal)}</b></div>
      <div>كوست الشراء: <b>${iqMoney(t.purchaseCost)}</b></div><div>مبيع POS: <b>${iqNum(t.qtySoldPos)}</b></div></div>
    <table><thead><tr><th>#</th><th>الصنف</th><th>الرصيد</th><th>دخل</th><th>انصرف</th><th>مبيع POS</th><th>مبيع يارا</th>
      <th>كوست شراء</th><th>تكلفة منصرف</th><th>قيمة مخزون</th><th>صلاحية</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">أرقام الدفتر لا تُجمع مع مرآة يارا · تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

export {
    renderInventoryQueryPage, renderItemCardPage, iqApply, iqPreset, iqReload,
    iqOpenCard, iqCloseCard, iqExportExcel, iqPrintReport, IQ,
};
