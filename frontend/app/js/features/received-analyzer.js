/**
 * features/received-analyzer.js — محلّل الاستلام والصرف الذكي (v3)
 * ────────────────────────────────────────────────────────────────────────────
 * 3 تبويبات: المستلمة + أذونات الصرف + المصروفات (ذكي).
 * بحث تلقائي بالاقتراحات · فترات جاهزة · تنبيهات · رصيد كل صنف · طباعة + Excel.
 */
const RA = {
    tab: 'items', // items | dispatches | outflow
    from: '', to: '', dept: '', item: '', group: 'item',
    rows: [], totals: null,
    dispatches: [], dispatchesTotal: 0, dispatchesOffset: 0, dispatchesLimit: 50,
    outflowRows: [], outflowTotals: null, outflowDetails: [], outflowAlerts: [], outflowBalances: [],
    suggestions: [], _suggestTimer: null,
    updatedAt: null,
};

function raToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
}
function raMonthStart() { return raToday().slice(0, 8) + '01'; }
function raEscape(v) {
    if (typeof esc === 'function') { return esc(v); }
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function raNum(n) { return Number(n || 0).toLocaleString('ar-EG'); }
function raMoney(n) { return Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function raDate(n) { const d = new Date(n); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
function raTime(n) { const d = new Date(n); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }); }

// ─── فترات جاهزة ───
function raPreset(key) {
    const t = raToday();
    const d = new Date(t + 'T12:00:00Z');
    if (key === 'today') { RA.from = t; RA.to = t; }
    else if (key === 'yesterday') { d.setUTCDate(d.getUTCDate() - 1); RA.from = d.toISOString().slice(0, 10); RA.to = RA.from; }
    else if (key === 'week') { const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7)); RA.from = d.toISOString().slice(0, 10); RA.to = t; }
    else if (key === 'month') { RA.from = raMonthStart(); RA.to = t; }
    else if (key === 'last7') { d.setUTCDate(d.getUTCDate() - 6); RA.from = d.toISOString().slice(0, 10); RA.to = t; }
    else if (key === 'last30') { d.setUTCDate(d.getUTCDate() - 29); RA.from = d.toISOString().slice(0, 10); RA.to = t; }
    raReload();
}

// ─── الصفحة الرئيسية ───
async function renderReceivedAnalyzerPage() {
    const content = document.getElementById('content');
    if (!content) { return; }
    if (!RA.from) { RA.from = raMonthStart(); RA.to = raToday(); }
    content.innerHTML = raShell();
    await raReload();
}

function raShell() {
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h3 class="u-gold-strong"><i class=ji data-i=package></i> استلام وصرف المخازن — تحليل ذكي</h3>
      <span class="u-dim" style="font-size:12px">آخر تحديث: <b id="raStamp">${RA.updatedAt ? RA.updatedAt.toLocaleTimeString('ar-EG') : '—'}</b></span>
    </div>
    <!-- تبويبات -->
    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:2px solid var(--border,#ddd);padding-bottom:0;flex-wrap:wrap">
      <button id="raTabItems" class="btn ${RA.tab === 'items' ? 'btn-primary' : ''}" style="border-radius:8px 8px 0 0" onclick="raSwitchTab('items')"><i class=ji data-i=package></i> المستلمة</button>
      <button id="raTabDispatches" class="btn ${RA.tab === 'dispatches' ? 'btn-primary' : ''}" style="border-radius:8px 8px 0 0" onclick="raSwitchTab('dispatches')"><i class=ji data-i=file-text></i> أذونات الصرف</button>
      <button id="raTabOutflow" class="btn ${RA.tab === 'outflow' ? 'btn-primary' : ''}" style="border-radius:8px 8px 0 0" onclick="raSwitchTab('outflow')"><i class=ji data-i=trending-down></i> المصروفات والاستهلاك</button>
    </div>
    <!-- فلاتر -->
    <div style="background:var(--card,#fff);padding:14px;border-radius:12px;border:1px solid var(--border,#e5e7eb);margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:10px">
        <label style="font-size:13px">من <input type="date" id="raFrom" value="${raEscape(RA.from)}" class="inp" style="width:150px"></label>
        <label style="font-size:13px">إلى <input type="date" id="raTo" value="${raEscape(RA.to)}" class="inp" style="width:150px"></label>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="raPreset('today')">اليوم</button>
          <button class="btn btn-sm" onclick="raPreset('yesterday')">أمس</button>
          <button class="btn btn-sm" onclick="raPreset('week')">هذا الأسبوع</button>
          <button class="btn btn-sm btn-primary" onclick="raPreset('month')">هذا الشهر</button>
          <button class="btn btn-sm" onclick="raPreset('last7')">آخر 7 أيام</button>
          <button class="btn btn-sm" onclick="raPreset('last30')">آخر 30 يوم</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
        <label style="font-size:13px;${RA.tab === 'dispatches' ? 'display:none' : ''}" id="raDeptWrap">القسم <input type="text" id="raDept" value="${raEscape(RA.dept)}" placeholder="مثال: الحلواني" class="inp" style="width:160px"></label>
        <div style="font-size:13px;flex:1;min-width:220px;position:relative;${RA.tab === 'dispatches' ? 'display:none' : ''}" id="raItemWrap">
          <label>بحث صنف <input type="text" id="raItem" value="${raEscape(RA.item)}" placeholder="اكتب اسم الصنف… مثال: البيبسي، دجاج، لحم" class="inp" style="width:100%" autocomplete="off" oninput="raSuggest()" onkeydown="if(event.key==='Enter')raApply()"></label>
          <div id="raSuggestBox" style="display:none;position:absolute;top:100%;right:0;left:0;background:var(--card,#fff);border:1px solid var(--border,#ddd);border-radius:0 0 8px 8px;max-height:220px;overflow-y:auto;z-index:50;box-shadow:0 8px 20px rgba(0,0,0,.12)"></div>
        </div>
        <label style="font-size:13px;${RA.tab !== 'items' ? 'display:none' : ''}" id="raGroupWrap">تجميع <select id="raGroup" class="inp" style="width:120px">
          <option value="item" ${RA.group === 'item' ? 'selected' : ''}>بالصنف</option>
          <option value="dept" ${RA.group === 'dept' ? 'selected' : ''}>بالقسم</option>
          <option value="day" ${RA.group === 'day' ? 'selected' : ''}>باليوم</option>
        </select></label>
        <button class="btn btn-primary" onclick="raApply()"><i class=ji data-i=search></i> استعلام</button>
        <button class="btn btn-green" onclick="raPrintReport()"><i class=ji data-i=printer></i> طباعة</button>
        <button class="btn" onclick="raExportExcel()"><i class=ji data-i=inbox></i> Excel</button>
      </div>
    </div>
    <div id="raAlerts" style="margin-bottom:14px"></div>
    <div id="raCards" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px"></div>
    <div id="raBody"><div class="u-empty"><div class="spinner"></div> جارٍ التحميل…</div></div>`;
}

// ─── اقتراحات البحث الذكي ───
async function raSuggest() {
    const input = document.getElementById('raItem');
    const box = document.getElementById('raSuggestBox');
    if (!input || !box) { return; }
    const q = input.value.trim();
    if (RA._suggestTimer) { clearTimeout(RA._suggestTimer); }
    if (q.length < 2) { box.style.display = 'none'; return; }
    RA._suggestTimer = setTimeout(async () => {
        try {
            const data = await apiFetch('/yara-reports/item-suggest?q=' + encodeURIComponent(q));
            const items = data.suggestions || [];
            if (!items.length) { box.style.display = 'none'; return; }
            box.innerHTML = items.map((s) => `
              <div style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border,#f0f0f0)" onmousedown="raPickSuggest('${raEscape(s.name)}')" onmouseover="this.style.background='var(--bg,#f5f5f5)'" onmouseout="this.style.background=''">
                <span><b>${raEscape(s.name)}</b></span>
                <span style="font-size:11px;color:${s.balance < 0 ? '#dc2626' : '#16a34a'}">رصيد: ${raNum(s.balance)}</span>
              </div>`).join('');
            box.style.display = 'block';
        } catch (_) { box.style.display = 'none'; }
    }, 280);
}

function raPickSuggest(name) {
    const input = document.getElementById('raItem');
    const box = document.getElementById('raSuggestBox');
    if (input) { input.value = name; }
    if (box) { box.style.display = 'none'; }
    RA.item = name;
    raReload();
}

function raSwitchTab(tab) {
    RA.tab = tab;
    document.getElementById('raTabItems')?.classList.toggle('btn-primary', tab === 'items');
    document.getElementById('raTabDispatches')?.classList.toggle('btn-primary', tab === 'dispatches');
    document.getElementById('raTabOutflow')?.classList.toggle('btn-primary', tab === 'outflow');
    document.getElementById('raItemWrap')?.toggleAttribute('hidden', tab === 'dispatches');
    document.getElementById('raDeptWrap')?.toggleAttribute('hidden', tab === 'dispatches');
    document.getElementById('raGroupWrap')?.toggleAttribute('hidden', tab !== 'items');
    raReload();
}

async function raReload() {
    const body = document.getElementById('raBody');
    if (!body) { return; }
    body.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ التحميل…</div>';
    try {
        if (RA.tab === 'dispatches') { await raLoadDispatches(); }
        else if (RA.tab === 'outflow') { await raLoadOutflow(); }
        else { await raLoadItems(); }
        RA.updatedAt = new Date();
        const stamp = document.getElementById('raStamp');
        if (stamp) { stamp.textContent = RA.updatedAt.toLocaleTimeString('ar-EG'); }
    } catch (e) {
        body.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> تعذّر التحميل: ${raEscape(e.message || e)}</div>`;
    }
}

async function raLoadItems() {
    const q = new URLSearchParams({ from: RA.from, to: RA.to, group: RA.group });
    if (RA.dept) { q.set('dept', RA.dept); }
    if (RA.item) { q.set('item', RA.item); }
    const data = await apiFetch('/yara-reports/received-items?' + q.toString());
    RA.rows = data.rows || [];
    RA.totals = data.totals || { dispatches: 0, qty: 0, approved_qty: 0, variance_qty: 0 };
    raRenderItems();
}

async function raLoadDispatches() {
    const q = new URLSearchParams({ from: RA.from, to: RA.to, limit: String(RA.dispatchesLimit), offset: String(RA.dispatchesOffset) });
    if (RA.dept) { q.set('dept', RA.dept); }
    const data = await apiFetch('/yara-reports/received-dispatches?' + q.toString());
    RA.dispatches = data.dispatches || [];
    RA.dispatchesTotal = data.total || 0;
    raRenderDispatches();
}

async function raLoadOutflow() {
    const q = new URLSearchParams({ from: RA.from, to: RA.to });
    if (RA.item) { q.set('item', RA.item); }
    const data = await apiFetch('/yara-reports/item-outflow?' + q.toString());
    RA.outflowRows = data.rows || [];
    RA.outflowTotals = data.totals || { qty_in: 0, qty_out: 0 };
    RA.outflowDetails = data.details || [];
    RA.outflowAlerts = data.alerts || [];
    RA.outflowBalances = data.balances || [];
    raRenderOutflow();
}

// ─── تنبيهات ذكية ───
function raRenderAlerts() {
    const box = document.getElementById('raAlerts');
    if (!box) { return; }
    if (RA.tab !== 'outflow' || !RA.outflowAlerts.length) { box.innerHTML = ''; return; }
    const colors = { danger: '#dc2626', warning: '#d97706', info: '#2563eb' };
    const icons = { danger: 'alert-triangle', warning: 'alert-triangle', info: 'info' };
    box.innerHTML = RA.outflowAlerts.slice(0, 6).map((a) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;margin-bottom:6px;background:${colors[a.type]}11;border:1px solid ${colors[a.type]}33;font-size:13px">
        <i class=ji data-i=${icons[a.type]} style="color:${colors[a.type]}"></i>
        <b style="color:${colors[a.type]}">${raEscape(a.item)}</b>
        <span>${raEscape(a.msg)}</span>
      </div>`).join('');
    if (RA.outflowAlerts.length > 6) {
        box.innerHTML += `<div class="u-dim" style="font-size:12px;text-align:center">+ ${RA.outflowAlerts.length - 6} تنبيهات أخرى…</div>`;
    }
}

// ─── بطاقات الملخص ───
function raRenderCards(t) {
    const box = document.getElementById('raCards');
    if (!box) { return; }
    if (RA.tab === 'outflow') {
        const negCount = RA.outflowRows.filter(r => r.alert === 'negative').length;
        const lowCount = RA.outflowRows.filter(r => r.alert === 'low').length;
        box.innerHTML = `
          <div class="mcard" style="flex:1;min-width:120px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">أصناف مصطفّة</div><b style="font-size:22px">${raNum(RA.outflowRows.length)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">إجمالي الوارد</div><b style="font-size:22px" class="c-green">${raNum(t.qty_in)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">إجمالي المصروف</div><b style="font-size:22px" class="c-red">${raNum(t.qty_out)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">الصافي</div><b style="font-size:22px" class="c-gold">${raNum(Number(t.qty_in) - Number(t.qty_out))}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center;${negCount ? 'border:2px solid #dc2626;' : ''}"><div class="u-dim" style="font-size:12px">رصيد سالب</div><b style="font-size:22px;${negCount ? 'color:#dc2626' : ''}">${raNum(negCount)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center;${lowCount ? 'border:2px solid #d97706;' : ''}"><div class="u-dim" style="font-size:12px">رصيد منخفض</div><b style="font-size:22px;${lowCount ? 'color:#d97706' : ''}">${raNum(lowCount)}</b></div>`;
        return;
    }
    box.innerHTML = `
      <div class="mcard" style="flex:1;min-width:120px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">${RA.tab === 'items' ? 'أصناف' : 'أذونات'}</div><b style="font-size:22px">${raNum(RA.tab === 'items' ? RA.rows.length : RA.dispatchesTotal)}</b></div>
      <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">${RA.tab === 'items' ? 'أذونات صرف' : 'أصناف مصطفّة'}</div><b style="font-size:22px" class="c-gold">${raNum(t.dispatches)}</b></div>
      <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">كمية مستلمة</div><b style="font-size:22px" class="c-green">${raNum(t.qty)}</b></div>
      <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">كمية معتمدة</div><b style="font-size:22px">${raNum(t.approved_qty)}</b></div>
      <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">الفرق</div><b style="font-size:22px" class="${Number(t.variance_qty) !== 0 ? 'c-red' : ''}">${raNum(t.variance_qty)}</b></div>`;
}

// ─── عرض الأصناف المستلمة ───
function raRenderItems() {
    const body = document.getElementById('raBody');
    if (!body) { return; }
    raRenderAlerts();
    raRenderCards(RA.totals);
    const grpLabel = { item: 'الصنف', dept: 'القسم', day: 'اليوم' }[RA.group];
    const rowsHtml = RA.rows.map((r, i) => {
        const label = RA.group === 'dept' ? (r.dept_name || r.deptName || '')
            : RA.group === 'day' ? (r.doc_date || r.day || r.date || '')
            : (r.item_name || r.name || '');
        const variance = Number(r.variance_qty || 0);
        return `<tr>
          <td>${i + 1}</td>
          <td style="text-align:start"><b>${raEscape(label)}</b></td>
          <td>${raNum(r.dispatches)}</td>
          <td><b class="c-green">${raNum(r.qty)}</b></td>
          <td>${raNum(r.approved_qty)}</td>
          <td class="${variance !== 0 ? (variance < 0 ? 'c-red' : 'c-gold') : ''}">${variance !== 0 ? raNum(variance) : '—'}</td>
        </tr>`;
    }).join('');
    body.innerHTML = `
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>#</th><th>${grpLabel}</th><th>أذونات</th><th>مستلم</th><th>معتمد</th><th>الفرق</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="6" class="u-empty">لا يوجد استلام في هذه الفترة</td></tr>`}</tbody>
      </table>
      </div>`;
}

// ─── عرض المصروفات الذكي ───
function raRenderOutflow() {
    const body = document.getElementById('raBody');
    if (!body) { return; }
    raRenderAlerts();
    raRenderCards(RA.outflowTotals);
    const alertBadge = (a) => {
        if (a === 'negative') { return '<span class="badge bdg-red">سالب</span>'; }
        if (a === 'depleted') { return '<span class="badge" style="background:#fef3c7;color:#92400e">صفر</span>'; }
        if (a === 'low') { return '<span class="badge" style="background:#fef3c7;color:#92400e">منخفض</span>'; }
        return '<span class="badge bdg-green">سليم</span>';
    };
    const rowsHtml = RA.outflowRows.map((r, i) => {
        const bal = Number(r.balance);
        return `<tr>
          <td>${i + 1}</td>
          <td style="text-align:start"><b>${raEscape(r.item_name || '')}</b></td>
          <td class="c-green">${raNum(r.qty_in)}</td>
          <td class="c-red"><b>${raNum(r.qty_out)}</b></td>
          <td class="${bal < 0 ? 'c-red' : bal === 0 ? '' : 'c-gold'}"><b>${raNum(bal)}</b></td>
          <td>${raNum(r.period_avg_daily)}</td>
          <td>${alertBadge(r.alert)}</td>
          <td class="text-muted" dir="ltr" style="font-size:11px">${raEscape(r.first_date || '')} → ${raEscape(r.last_date || '')}</td>
        </tr>`;
    }).join('');
    const detailsHtml = RA.outflowDetails.map((d, i) => `
      <tr>
        <td>${i + 1}</td>
        <td style="text-align:start">${raEscape(d.item_name || '')}</td>
        <td dir="ltr">${raEscape(d.date || '')}</td>
        <td>${d.type === 'in' ? '<span class="badge bdg-green">وارد</span>' : '<span class="badge bdg-red">مصروف</span>'}</td>
        <td><b>${raNum(d.qty)}</b></td>
        <td style="text-align:start" class="text-muted">${raEscape(d.notes || '')}</td>
        <td dir="ltr" class="text-muted" style="font-size:11px">${raEscape(d.dispatchId || '')}</td>
      </tr>`).join('');
    body.innerHTML = `
      <div style="overflow-x:auto;margin-bottom:18px">
      <div class="tbl-hd" style="padding:8px 0"><h3><i class=ji data-i=trending-down></i> ملخص المصروفات — ${raNum(RA.outflowRows.length)} صنف</h3></div>
      <table class="tbl">
        <thead><tr><th>#</th><th>الصنف</th><th>وارد بالفترة</th><th>مصروف بالفترة</th><th>الرصيد الكلي</th><th>متوسط/يوم</th><th>الحالة</th><th>الفترة</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="u-empty">لا حركات في هذه الفترة</td></tr>`}</tbody>
      </table>
      </div>
      <div style="overflow-x:auto">
      <div class="tbl-hd" style="padding:8px 0"><h3><i class=ji data-i=list></i> آخر الحركات التفصيلية (${raNum(RA.outflowDetails.length)} حركة)</h3></div>
      <table class="tbl">
        <thead><tr><th>#</th><th>الصنف</th><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>الملاحظات</th><th>رقم الإذن</th></tr></thead>
        <tbody>${detailsHtml || `<tr><td colspan="7" class="u-empty">لا حركات</td></tr>`}</tbody>
      </table>
      </div>`;
}

// ─── عرض أذونات الصرف ───
function raRenderDispatches() {
    const body = document.getElementById('raBody');
    if (!body) { return; }
    raRenderAlerts();
    raRenderCards({ dispatches: RA.dispatchesTotal, qty: RA.dispatches.reduce((s, d) => s + d.total_qty, 0), approved_qty: 0, variance_qty: 0 });
    const pages = Math.max(1, Math.ceil(RA.dispatchesTotal / RA.dispatchesLimit));
    const page = Math.floor(RA.dispatchesOffset / RA.dispatchesLimit) + 1;
    const rowsHtml = RA.dispatches.map((d) => `
      <tr style="cursor:pointer" onclick="raOpenDispatch('${raEscape(d.id)}')">
        <td class="fw-bold" dir="ltr">${raEscape(d.id.slice(-8))}</td>
        <td style="text-align:start"><b>${raEscape(d.dept_name || '—')}</b></td>
        <td dir="ltr">${raEscape(d.date)}</td>
        <td dir="ltr">${raEscape(String(d.received_at || '').slice(0, 16).replace('T', ' '))}</td>
        <td style="text-align:start">${raEscape(d.received_by || '—')}</td>
        <td>${raNum(d.items_count)}</td>
        <td class="c-green"><b>${raNum(d.total_qty)}</b></td>
        <td><button class="btn btn-sm btn-blue" onclick="event.stopPropagation();raOpenDispatch('${raEscape(d.id)}')"><i class=ji data-i=eye></i></button></td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="tbl-wrap">
        <div class="tbl-hd"><h3><i class=ji data-i=file-text></i> أذونات الصرف المستلمة — ${raNum(RA.dispatchesTotal)} إذن</h3></div>
        <div class="tbl-scroll"><table class="tbl">
        <thead><tr><th>الإذن</th><th>القسم</th><th>التاريخ</th><th>وقت الاستلام</th><th>المستلم</th><th>أصناف</th><th>إجمالي الكمية</th><th></th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="u-empty">لا توجد أذونات في هذه الفترة</td></tr>`}</tbody>
        </table></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;padding:8px 0">
          <span class="text-muted">صفحة ${raNum(page)} من ${raNum(pages)}</span>
          <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="raDispatchesPage(-1)">السابق</button>
          <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} onclick="raDispatchesPage(1)">التالي</button>
        </div>
      </div>
      <div id="raDispatchDetail"></div>`;
}

// ─── فتح تفاصيل إذن صرف ───
async function raOpenDispatch(id) {
    const box = document.getElementById('raDispatchDetail');
    if (!box) { return; }
    box.innerHTML = '<div class="mcard"><div class="spinner"></div> جارٍ جلب التفاصيل…</div>';
    try {
        const d = await apiFetch(`/yara-reports/received-dispatch-detail/${encodeURIComponent(id)}`);
        const disp = d.dispatch || {};
        const items = Array.isArray(disp.approved_items) && disp.approved_items.length ? disp.approved_items : (Array.isArray(disp.items) ? disp.items : []);
        const receivedMap = new Map();
        (disp.received_items || []).forEach((ri) => { receivedMap.set(String(ri.itemName || ri.item_name || ''), ri); });
        const rowsHtml = items.map((it, i) => {
            const name = it.itemName || it.name || '';
            const ri = receivedMap.get(String(name)) || {};
            const approved = Number(it.qty || it.approvedQty || 0);
            const received = Number(ri.receivedQty || 0);
            const variance = Number(ri.varianceQty || 0);
            return `<tr>
              <td>${i + 1}</td>
              <td style="text-align:start"><b>${raEscape(name)}</b></td>
              <td>${raEscape(it.unit || '')}</td>
              <td>${raNum(approved)}</td>
              <td class="c-green"><b>${raNum(received)}</b></td>
              <td class="${variance !== 0 ? (variance < 0 ? 'c-red' : 'c-gold') : ''}">${variance !== 0 ? raNum(variance) : '—'}</td>
            </tr>`;
        }).join('');
        box.innerHTML = `
        <div class="tbl-wrap" style="margin-top:14px">
          <div class="tbl-hd">
            <h3><i class=ji data-i=file-text></i> إذن صرف — ${raEscape(disp.dept_name || '')} — ${raEscape(disp.date || '')}</h3>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-green" onclick="raPrintDispatch('${raEscape(disp.id)}')"><i class=ji data-i=printer></i> طباعة</button>
              <button class="btn btn-sm" onclick="document.getElementById('raDispatchDetail').innerHTML=''">إغلاق</button>
            </div>
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;padding:10px 14px;background:var(--bg,#f9fafb);border-radius:8px;margin:8px 0;font-size:13px">
            <span>القسم: <b>${raEscape(disp.dept_name || '—')}</b></span>
            <span>التاريخ: <b dir="ltr">${raEscape(disp.date || '')}</b></span>
            <span>المستلم: <b>${raEscape(disp.received_by || '—')}</b></span>
            <span>وقت الاستلام: <b dir="ltr">${raEscape(String(disp.received_at || '').slice(0, 16).replace('T', ' '))}</b></span>
            <span>أنشأها: <b>${raEscape(disp.created_by || '—')}</b></span>
          </div>
          ${disp.receipt_notes ? `<div style="padding:8px 14px;background:#fffbeb;border-radius:8px;margin:8px 0;font-size:13px"><b>ملاحظات:</b> ${raEscape(disp.receipt_notes)}</div>` : ''}
          <div class="tbl-scroll"><table class="tbl">
            <thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>معتمد</th><th>مستلم</th><th>الفرق</th></tr></thead>
            <tbody>${rowsHtml || `<tr><td colspan="6" class="u-empty">لا أصناف</td></tr>`}</tbody>
          </table></div>
        </div>`;
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        box.innerHTML = `<div class="mcard">تعذر جلب الإذن: ${raEscape(e.message || 'خطأ')}</div>`;
    }
}

// ─── طباعة إذن صرف ───
async function raPrintDispatch(id) {
    try {
        const d = await apiFetch(`/yara-reports/received-dispatch-detail/${encodeURIComponent(id)}`);
        const disp = d.dispatch || {};
        const items = Array.isArray(disp.approved_items) && disp.approved_items.length ? disp.approved_items : (Array.isArray(disp.items) ? disp.items : []);
        const receivedMap = new Map();
        (disp.received_items || []).forEach((ri) => { receivedMap.set(String(ri.itemName || ri.item_name || ''), ri); });
        const rowsHtml = items.map((it, i) => {
            const name = it.itemName || it.name || '';
            const ri = receivedMap.get(String(name)) || {};
            return `<tr><td>${i + 1}</td><td style="text-align:start">${raEscape(name)}</td><td>${raEscape(it.unit || '')}</td>
            <td>${raNum(it.qty || it.approvedQty || 0)}</td><td><b>${raNum(ri.receivedQty || 0)}</b></td></tr>`;
        }).join('');
        const w = window.openInAppReport ? window.openInAppReport(`إذن صرف ${raEscape(disp.id)}`) : window.open('', '_blank');
        if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف ${raEscape(disp.id)}</title>
        <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:28px;color:#111}h1{text-align:center;font-size:20px}h2{text-align:center;color:#555;font-size:14px;margin-bottom:14px}
        table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}th,td{border:1px solid #333;padding:6px;text-align:center}th{background:#f0f0f0}
        .meta{font-size:13px;line-height:2}.meta b{display:inline-block;min-width:80px}.controls{text-align:center;margin-bottom:14px}
        .controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
        .bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
        <div class="controls"><button class="bp" onclick="window.print()">طباعة</button><button class="bc" onclick="window.close()">إغلاق</button></div>
        <h1>إذن صرف — مطاعم الشرفة العالمي</h1>
        <h2>${raEscape(disp.dept_name || '')} — ${raEscape(disp.date || '')}</h2>
        <div class="meta">
          <div><b>القسم:</b> ${raEscape(disp.dept_name || '—')}</div>
          <div><b>المستلم:</b> ${raEscape(disp.received_by || '—')}</div>
          <div><b>وقت الاستلام:</b> ${raEscape(String(disp.received_at || '').slice(0, 16).replace('T', ' '))}</div>
          <div><b>أنشأها:</b> ${raEscape(disp.created_by || '—')}</div>
        </div>
        <table><thead><tr><th>#</th><th>الصنف</th><th>الوحدة</th><th>معتمد</th><th>مستلم</th></tr></thead><tbody>${rowsHtml}</tbody></table>
        ${disp.receipt_notes ? `<p style="margin-top:10px"><b>ملاحظات:</b> ${raEscape(disp.receipt_notes)}</p>` : ''}
        <p style="text-align:center;margin-top:14px;font-size:11px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
        </body></html>`);
        w.document.close();
        w.focus();
    } catch (e) {
        toast('تعذر الطباعة: ' + (e.message || 'خطأ'), 'error');
    }
}

// ─── تطبيق الفلاتر ───
function raApply() {
    RA.from = document.getElementById('raFrom')?.value || RA.from;
    RA.to = document.getElementById('raTo')?.value || RA.to;
    RA.dept = (document.getElementById('raDept')?.value || '').trim();
    RA.item = (document.getElementById('raItem')?.value || '').trim();
    RA.group = document.getElementById('raGroup')?.value || 'item';
    RA.dispatchesOffset = 0;
    const box = document.getElementById('raSuggestBox');
    if (box) { box.style.display = 'none'; }
    raReload();
}

function raDispatchesPage(dir) {
    const next = RA.dispatchesOffset + dir * RA.dispatchesLimit;
    if (next < 0 || next >= Math.max(RA.dispatchesTotal, 1)) { return; }
    RA.dispatchesOffset = next;
    raLoadDispatches();
}

// ─── طباعة تقرير ───
function raPrintReport() {
    if (RA.tab === 'dispatches') { raPrintDispatchesReport(); return; }
    if (RA.tab === 'outflow') { raPrintOutflowReport(); return; }
    raPrintItemsReport();
}

function raPrintItemsReport() {
    const grpLabel = { item: 'الصنف', dept: 'القسم', day: 'اليوم' }[RA.group];
    const rows = RA.rows.map((r, i) => {
        const label = RA.group === 'dept' ? (r.dept_name || '')
            : RA.group === 'day' ? (r.doc_date || r.day || r.date || '')
            : (r.item_name || r.name || '');
        return `<tr><td>${i + 1}</td><td style="text-align:start">${raEscape(label)}</td><td>${raNum(r.dispatches)}</td><td>${raNum(r.qty)}</td><td>${raNum(r.approved_qty)}</td><td>${raNum(r.variance_qty)}</td></tr>`;
    }).join('');
    const t = RA.totals || { dispatches: 0, qty: 0, approved_qty: 0, variance_qty: 0 };
    const w = window.openInAppReport ? window.openInAppReport('تقرير الاستلام') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير الاستلام</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #999;padding:7px;text-align:center}th{background:#0f172a;color:#f5d76e}
    tfoot td{font-weight:800;background:#f3ecd9}.filters{text-align:center;font-size:13px;color:#444;margin-bottom:10px}.controls{text-align:center;margin-bottom:16px}
    .controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" onclick="window.print()">طباعة</button><button class="bc" onclick="window.close()">إغلاق</button></div>
    <h1>تقرير الاستلام من المخازن</h1>
    <h2>مطاعم الشرفة العالمي · من ${raEscape(RA.from)} إلى ${raEscape(RA.to)}</h2>
    <div class="filters">تجميع: ${grpLabel}${RA.item ? ' · بحث: ' + raEscape(RA.item) : ''}${RA.dept ? ' · قسم: ' + raEscape(RA.dept) : ''}</div>
    <table><thead><tr><th>#</th><th>${grpLabel}</th><th>أذونات</th><th>مستلم</th><th>معتمد</th><th>الفرق</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">الإجمالي (${raNum(RA.rows.length)} صف)</td><td>${raNum(t.dispatches)}</td><td>${raNum(t.qty)}</td><td>${raNum(t.approved_qty)}</td><td>${raNum(t.variance_qty)}</td></tr></tfoot></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

function raPrintOutflowReport() {
    const rows = RA.outflowRows.map((r, i) => {
        const bal = Number(r.balance);
        return `<tr><td>${i + 1}</td><td style="text-align:start">${raEscape(r.item_name || '')}</td><td>${raNum(r.qty_in)}</td><td>${raNum(r.qty_out)}</td><td>${raNum(bal)}</td><td>${raNum(r.period_avg_daily)}</td><td>${r.alert === 'negative' ? '⚠ سالب' : r.alert === 'depleted' ? 'صفر' : r.alert === 'low' ? 'منخفض' : 'سليم'}</td></tr>`;
    }).join('');
    const t = RA.outflowTotals || { qty_in: 0, qty_out: 0 };
    const w = window.openInAppReport ? window.openInAppReport('تقرير المصروفات والاستهلاك') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير المصروفات والاستهلاك</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #999;padding:6px;text-align:center}th{background:#0f172a;color:#f5d76e}
    tfoot td{font-weight:800;background:#f3ecd9}.filters{text-align:center;font-size:13px;color:#444;margin-bottom:10px}.controls{text-align:center;margin-bottom:16px}
    .controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" onclick="window.print()">طباعة</button><button class="bc" onclick="window.close()">إغلاق</button></div>
    <h1>تقرير المصروفات والاستهلاك</h1>
    <h2>مطاعم الشرفة العالمي · من ${raEscape(RA.from)} إلى ${raEscape(RA.to)}${RA.item ? ' · بحث: ' + raEscape(RA.item) : ''}</h2>
    <table><thead><tr><th>#</th><th>الصنف</th><th>وارد بالفترة</th><th>مصروف بالفترة</th><th>الرصيد الكلي</th><th>متوسط/يوم</th><th>الحالة</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">الإجمالي (${raNum(RA.outflowRows.length)} صنف)</td><td>${raNum(t.qty_in)}</td><td>${raNum(t.qty_out)}</td><td colspan="3"></td></tr></tfoot></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

function raPrintDispatchesReport() {
    const rows = RA.dispatches.map((d) => `
      <tr><td dir="ltr">${raEscape(d.id.slice(-8))}</td><td>${raEscape(d.dept_name || '—')}</td><td dir="ltr">${raEscape(d.date)}</td>
      <td dir="ltr">${raEscape(String(d.received_at || '').slice(0, 16).replace('T', ' '))}</td><td>${raEscape(d.received_by || '—')}</td><td>${raNum(d.items_count)}</td><td>${raNum(d.total_qty)}</td></tr>`).join('');
    const w = window.openInAppReport ? window.openInAppReport('تقرير أذونات الصرف') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير أذونات الصرف</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #999;padding:6px;text-align:center}th{background:#0f172a;color:#f5d76e}
    .controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
    .bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" onclick="window.print()">طباعة</button><button class="bc" onclick="window.close()">إغلاق</button></div>
    <h1>تقرير أذونات الصرف المستلمة</h1>
    <h2>مطاعم الشرفة العالمي · من ${raEscape(RA.from)} إلى ${raEscape(RA.to)}${RA.dept ? ' · قسم: ' + raEscape(RA.dept) : ''}</h2>
    <table><thead><tr><th>الإذن</th><th>القسم</th><th>التاريخ</th><th>وقت الاستلام</th><th>المستلم</th><th>أصناف</th><th>إجمالي الكمية</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

// ─── تصدير Excel ───
function raExportExcel() {
    if (typeof XLSX === 'undefined') { toast('مكتبة Excel غير محمّلة', 'error'); return; }
    const wb = XLSX.utils.book_new();
    if (RA.tab === 'outflow') {
        const data = [['الصنف', 'وارد بالفترة', 'مصروف بالفترة', 'الرصيد الكلي', 'متوسط يومي', 'الحالة', 'أول حركة', 'آخر حركة']];
        RA.outflowRows.forEach((r) => data.push([r.item_name || '', r.qty_in, r.qty_out, r.balance, r.period_avg_daily, r.alert === 'negative' ? 'سالب' : r.alert === 'depleted' ? 'صفر' : r.alert === 'low' ? 'منخفض' : 'سليم', r.first_date || '', r.last_date || '']));
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'المصروفات');
        XLSX.writeFile(wb, `outflow_${RA.from}_${RA.to}.xlsx`);
    } else if (RA.tab === 'dispatches') {
        const data = [['الإذن', 'القسم', 'التاريخ', 'وقت الاستلام', 'المستلم', 'أصناف', 'إجمالي الكمية', 'ملاحظات']];
        RA.dispatches.forEach((d) => data.push([d.id, d.dept_name || '', d.date, String(d.received_at || '').slice(0, 16).replace('T', ' '), d.received_by || '', d.items_count, d.total_qty, d.notes || '']));
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'أذونات الصرف');
        XLSX.writeFile(wb, `dispatches_${RA.from}_${RA.to}.xlsx`);
    } else {
        const grpLabel = { item: 'الصنف', dept: 'القسم', day: 'اليوم' }[RA.group];
        const data = [[grpLabel, 'أذونات', 'كمية مستلمة', 'كمية معتمدة', 'الفرق']];
        RA.rows.forEach((r) => {
            const label = RA.group === 'dept' ? (r.dept_name || '')
                : RA.group === 'day' ? (r.doc_date || r.day || r.date || '')
                : (r.item_name || r.name || '');
            data.push([label, r.dispatches, r.qty, r.approved_qty, r.variance_qty]);
        });
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'الأصناف المستلمة');
        XLSX.writeFile(wb, `received-items_${RA.from}_${RA.to}.xlsx`);
    }
    toast('تم تصدير Excel', 'success');
}

export { renderReceivedAnalyzerPage, raApply, raExportExcel, raPrintReport, raSwitchTab, raDispatchesPage, raOpenDispatch, raPrintDispatch, raPreset, raPickSuggest };
