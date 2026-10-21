/**
 * features/wh-vs-pos.js — مقارنة احترافية: الصرف من المخازن vs مبيعات الكاشيرية (v1)
 * ────────────────────────────────────────────────────────────────────────────
 * لكل صنف: كم صُرف من المخزن vs كم بيع في الكاشيرية — فروقات، نسب، تنبيهات.
 * مزامنة تلقائية كل 60 ثانية · بحث ذكي · فلترة بالحالة · طباعة + Excel.
 */
const WV = {
    from: '', to: '', item: '', only: 'all',
    rows: [], summary: null,
    updatedAt: null, _liveTimer: null,
};

function wvToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
}
function wvMonthStart() { return wvToday().slice(0, 8) + '01'; }
function wvEscape(v) {
    if (typeof esc === 'function') { return esc(v); }
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function wvNum(n) { return Number(n || 0).toLocaleString('ar-EG'); }
function wvMoney(n) { return Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// ─── فترات جاهزة ───
function wvPreset(key) {
    const t = wvToday();
    const d = new Date(t + 'T12:00:00Z');
    if (key === 'today') { WV.from = t; WV.to = t; }
    else if (key === 'yesterday') { d.setUTCDate(d.getUTCDate() - 1); WV.from = d.toISOString().slice(0, 10); WV.to = WV.from; }
    else if (key === 'week') { const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7)); WV.from = d.toISOString().slice(0, 10); WV.to = t; }
    else if (key === 'month') { WV.from = wvMonthStart(); WV.to = t; }
    else if (key === 'last7') { d.setUTCDate(d.getUTCDate() - 6); WV.from = d.toISOString().slice(0, 10); WV.to = t; }
    else if (key === 'last30') { d.setUTCDate(d.getUTCDate() - 29); WV.from = d.toISOString().slice(0, 10); WV.to = t; }
    wvReload();
}

// ─── الصفحة الرئيسية ───
async function renderWhVsPosPage() {
    const content = document.getElementById('content');
    if (!content) { return; }
    if (!WV.from) { WV.from = wvMonthStart(); WV.to = wvToday(); }
    content.innerHTML = wvShell();
    await wvReload();
    wvStartLive();
}

function wvShell() {
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h3 class="u-gold-strong"><i class=ji data-i=bar-chart></i> مقارنة الصرف والمبيعات — تحليل ذكي</h3>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span id="wvLiveBadge" class="badge bdg-green" title="البيانات تتحدث تلقائيًا كل 60 ثانية"><i class=ji data-i=activity></i> مباشر</span>
        <span class="u-dim" style="font-size:12px">آخر تحديث: <b id="wvStamp">${WV.updatedAt ? WV.updatedAt.toLocaleTimeString('ar-EG') : '—'}</b></span>
      </div>
    </div>
    <!-- فلاتر -->
    <div style="background:var(--card,#fff);padding:14px;border-radius:12px;border:1px solid var(--border,#e5e7eb);margin-bottom:14px">
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:10px">
        <label style="font-size:13px">من <input type="date" id="wvFrom" value="${wvEscape(WV.from)}" class="inp" style="width:150px"></label>
        <label style="font-size:13px">إلى <input type="date" id="wvTo" value="${wvEscape(WV.to)}" class="inp" style="width:150px"></label>
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-sm" data-karim-action="wvPreset" data-karim-args="[&quot;today&quot;]">اليوم</button>
          <button class="btn btn-sm" data-karim-action="wvPreset" data-karim-args="[&quot;yesterday&quot;]">أمس</button>
          <button class="btn btn-sm" data-karim-action="wvPreset" data-karim-args="[&quot;week&quot;]">هذا الأسبوع</button>
          <button class="btn btn-sm btn-primary" data-karim-action="wvPreset" data-karim-args="[&quot;month&quot;]">هذا الشهر</button>
          <button class="btn btn-sm" data-karim-action="wvPreset" data-karim-args="[&quot;last7&quot;]">آخر 7 أيام</button>
          <button class="btn btn-sm" data-karim-action="wvPreset" data-karim-args="[&quot;last30&quot;]">آخر 30 يوم</button>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end">
        <div style="font-size:13px;flex:1;min-width:220px;position:relative">
          <label>بحث صنف <input type="text" id="wvItem" value="${wvEscape(WV.item)}" placeholder="اكتب اسم الصنف… مثال: بيبسي، دجاج، بطاطس" class="inp" style="width:100%" autocomplete="off" data-karim-action="wvSuggest" data-karim-event="input" data-karim-action="if" data-karim-event="keydown" data-karim-args="[event.key===&#39;Enter&#39;]" data-karim-also="wvApply"></label>
          <div id="wvSuggestBox" style="display:none;position:absolute;top:100%;right:0;left:0;background:var(--card,#fff);border:1px solid var(--border,#ddd);border-radius:0 0 8px 8px;max-height:220px;overflow-y:auto;z-index:50;box-shadow:0 8px 20px rgba(0,0,0,.12)"></div>
        </div>
        <label style="font-size:13px">عرض <select id="wvOnly" class="inp" style="width:170px">
          <option value="all" ${WV.only === 'all' ? 'selected' : ''}>كل الأصناف</option>
          <option value="mismatch" ${WV.only === 'mismatch' ? 'selected' : ''}>المختلفة فقط</option>
        </select></label>
        <button class="btn btn-primary" data-karim-action="wvApply"><i class=ji data-i=search></i> استعلام</button>
        <button class="btn btn-green" data-karim-action="wvPrintReport"><i class=ji data-i=printer></i> طباعة</button>
        <button class="btn" data-karim-action="wvExportExcel"><i class=ji data-i=inbox></i> Excel</button>
      </div>
    </div>
    <div id="wvAlerts" style="margin-bottom:14px"></div>
    <div id="wvCards" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px"></div>
    <div id="wvChart" style="margin-bottom:14px"></div>
    <div id="wvBody"><div class="u-empty"><div class="spinner"></div> جارٍ التحميل…</div></div>`;
}

// ─── مزامنة تلقائية كل 60 ثانية ───
function wvStartLive() {
    if (WV._liveTimer) { clearInterval(WV._liveTimer); }
    WV._liveTimer = setInterval(() => {
        if (STATE.page !== 'wh-vs-pos' || !document.getElementById('wvFrom')) {
            clearInterval(WV._liveTimer); WV._liveTimer = null; return;
        }
        wvReload(true);
    }, 60_000);
}

// ─── اقتراحات البحث ───
let wvSuggestTimer = null;
async function wvSuggest() {
    const input = document.getElementById('wvItem');
    const box = document.getElementById('wvSuggestBox');
    if (!input || !box) { return; }
    const q = input.value.trim();
    if (wvSuggestTimer) { clearTimeout(wvSuggestTimer); }
    if (q.length < 2) { box.style.display = 'none'; return; }
    wvSuggestTimer = setTimeout(async () => {
        try {
            const data = await apiFetch('/yara-reports/item-suggest?q=' + encodeURIComponent(q));
            const items = data.suggestions || [];
            if (!items.length) { box.style.display = 'none'; return; }
            box.innerHTML = items.map((s) => `
              <div style="padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border,#f0f0f0)" data-karim-action="wvPickSuggest" data-karim-event="mousedown" data-karim-arg0="${wvEscape(s.name)}" data-karim-hover="var(--bg,#f5f5f5)">
                <span><b>${wvEscape(s.name)}</b></span>
                <span style="font-size:11px;color:${s.balance < 0 ? '#dc2626' : '#16a34a'}">رصيد: ${wvNum(s.balance)}</span>
              </div>`).join('');
            box.style.display = 'block';
        } catch (_) { box.style.display = 'none'; }
    }, 280);
}

function wvPickSuggest(name) {
    const input = document.getElementById('wvItem');
    const box = document.getElementById('wvSuggestBox');
    if (input) { input.value = name; }
    if (box) { box.style.display = 'none'; }
    WV.item = name;
    wvReload();
}

// ─── تحميل البيانات ───
async function wvReload(silent) {
    const body = document.getElementById('wvBody');
    if (!body) { return; }
    if (!silent) { body.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ المقارنة…</div>'; }
    try {
        const q = new URLSearchParams({ from: WV.from, to: WV.to, only: WV.only });
        if (WV.item) { q.set('item', WV.item); }
        // مزامنة حية من الكاشيرية عند عرض بيانات اليوم
        if (WV.to >= wvToday()) { q.set('live', '1'); }
        const data = await apiFetch('/yara-reports/wh-vs-pos?' + q.toString());
        WV.rows = data.rows || [];
        WV.summary = data.summary || null;
        // مؤشر المزامنة الحية
        const liveEl = document.getElementById('wvLiveBadge');
        if (liveEl) {
            if (data.liveSynced) { liveEl.innerHTML = '<i class=ji data-i=activity></i> تمت المزامنة الآن'; liveEl.className = 'badge bdg-green'; }
            else { liveEl.innerHTML = '<i class=ji data-i=activity></i> مباشر'; liveEl.className = 'badge bdg-green'; }
        }
        WV.updatedAt = new Date();
        const stamp = document.getElementById('wvStamp');
        if (stamp) { stamp.textContent = WV.updatedAt.toLocaleTimeString('ar-EG'); }
        wvRender();
    } catch (e) {
        body.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> تعذّر التحميل: ${wvEscape(e.message || e)}</div>`;
    }
}

// ─── عرض البطاقات والتنبيهات والرسم ───
function wvRender() {
    const s = WV.summary || {};
    // بطاقات
    const cardsBox = document.getElementById('wvCards');
    if (cardsBox) {
        cardsBox.innerHTML = `
          <div class="mcard" style="flex:1;min-width:120px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">إجمالي الأصناف</div><b style="font-size:22px">${wvNum(s.total_items)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center;border:2px solid #16a34a33"><div class="u-dim" style="font-size:12px">✓ متطابقة</div><b style="font-size:22px;color:#16a34a">${wvNum(s.matched)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center;border:2px solid #dc262633"><div class="u-dim" style="font-size:12px">المبيعات أكثر</div><b style="font-size:22px;color:#dc2626">${wvNum(s.sold_more)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center;border:2px solid #d9770633"><div class="u-dim" style="font-size:12px">المصروف أكثر</div><b style="font-size:22px;color:#d97706">${wvNum(s.issued_more)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">مباع فقط</div><b style="font-size:22px" class="c-blue">${wvNum(s.pos_only)}</b></div>
          <div class="mcard" style="flex:1;min-width:130px;padding:12px;text-align:center"><div class="u-dim" style="font-size:12px">مصروف فقط</div><b style="font-size:22px" class="c-gold">${wvNum(s.wh_only)}</b></div>
          <div class="mcard" style="flex:1;min-width:150px;padding:12px;text-align:center;background:linear-gradient(135deg,#f5d76e22,#f5d76e11)"><div class="u-dim" style="font-size:12px">إجمالي المبيعات</div><b style="font-size:20px" class="c-gold">${wvMoney(s.total_pos_gross)}</b></div>`;
    }
    // تنبيهات
    const alertsBox = document.getElementById('wvAlerts');
    if (alertsBox) {
        const mismatches = WV.rows.filter(r => r.status === 'sold_more' && Math.abs(r.diff) >= 10).slice(0, 5);
        const issuedMore = WV.rows.filter(r => r.status === 'issued_more' && Math.abs(r.diff) >= 10).slice(0, 3);
        let html = '';
        for (const m of mismatches) {
            html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;margin-bottom:6px;background:#dc262611;border:1px solid #dc262633;font-size:13px">
              <i class=ji data-i=alert-triangle style="color:#dc2626"></i>
              <b style="color:#dc2626">${wvEscape(m.name)}</b>
              <span>باعوا ${wvNum(m.pos_qty)} بس صُرف ${wvNum(m.wh_qty)} — فرق <b>${wvNum(m.diff)}</b> (${wvNum(m.pct)}%)</span>
            </div>`;
        }
        for (const m of issuedMore) {
            html += `<div style="display:flex;align-items:center;gap:8px;padding:8px 14px;border-radius:8px;margin-bottom:6px;background:#d9770611;border:1px solid #d9770633;font-size:13px">
              <i class=ji data-i=alert-triangle style="color:#d97706"></i>
              <b style="color:#d97706">${wvEscape(m.name)}</b>
              <span>صُرف ${wvNum(m.wh_qty)} بس باعوا ${wvNum(m.pos_qty)} — فرق <b>${wvNum(Math.abs(m.diff))}</b></span>
            </div>`;
        }
        alertsBox.innerHTML = html;
    }
    // رسم بياني بسيط لأكبر 10 فروقات
    const chartBox = document.getElementById('wvChart');
    if (chartBox) {
        const top = WV.rows.filter(r => r.status !== 'match').slice(0, 10);
        if (top.length) {
            const maxVal = Math.max(...top.map(r => Math.max(r.wh_qty, r.pos_qty)), 1);
            chartBox.innerHTML = `
            <div class="mcard" style="padding:14px">
              <div class="u-dim" style="font-size:13px;margin-bottom:10px"><i class=ji data-i=bar-chart></i> أكبر 10 فروقات — <span style="color:#16a34a">■</span> مصروف &nbsp; <span style="color:#dc2626">■</span> مبيع</div>
              ${top.map(r => `
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
                  <div style="min-width:140px;font-size:12px;text-align:start;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${wvEscape(r.name)}">${wvEscape(r.name)}</div>
                  <div style="flex:1;display:flex;flex-direction:column;gap:2px">
                    <div style="height:10px;background:#16a34a;border-radius:4px;width:${Math.min((r.wh_qty / maxVal) * 100, 100)}%"></div>
                    <div style="height:10px;background:#dc2626;border-radius:4px;width:${Math.min((r.pos_qty / maxVal) * 100, 100)}%"></div>
                  </div>
                  <div style="min-width:80px;font-size:11px;text-align:end;color:${r.diff > 0 ? '#dc2626' : '#d97706'}">${r.diff > 0 ? '+' : ''}${wvNum(r.diff)}</div>
                </div>`).join('')}
            </div>`;
        } else { chartBox.innerHTML = ''; }
    }
    // جدول
    const body = document.getElementById('wvBody');
    if (!body) { return; }
    const statusBadge = (st) => {
        if (st === 'match') { return '<span class="badge bdg-green">✓ متطابق</span>'; }
        if (st === 'sold_more') { return '<span class="badge bdg-red">المبيع أكثر</span>'; }
        if (st === 'issued_more') { return '<span class="badge" style="background:#fef3c7;color:#92400e">المصروف أكثر</span>'; }
        if (st === 'pos_only') { return '<span class="badge bdg-blue">مباع فقط</span>'; }
        return '<span class="badge" style="background:#fef3c7;color:#92400e">مصروف فقط</span>';
    };
    const rowsHtml = WV.rows.map((r, i) => `
      <tr style="${r.status === 'sold_more' ? 'background:#dc262608' : r.status === 'issued_more' ? 'background:#d9770608' : ''}">
        <td>${i + 1}</td>
        <td style="text-align:start"><b>${wvEscape(r.name)}</b>${r.dept ? `<div class="u-dim" style="font-size:11px">${wvEscape(r.dept)}</div>` : ''}</td>
        <td class="c-green"><b>${wvNum(r.wh_qty)}</b>${r.wh_docs ? `<div class="u-dim" style="font-size:11px">${wvNum(r.wh_docs)} إذن</div>` : ''}</td>
        <td class="c-red"><b>${wvNum(r.pos_qty)}</b>${r.pos_invoices ? `<div class="u-dim" style="font-size:11px">${wvNum(r.pos_invoices)} فاتورة</div>` : ''}</td>
        <td class="${r.diff > 0 ? 'c-red' : r.diff < 0 ? 'c-gold' : ''}"><b>${r.diff > 0 ? '+' : ''}${wvNum(r.diff)}</b></td>
        <td style="font-size:12px;color:${r.pct > 50 ? '#dc2626' : r.pct > 10 ? '#d97706' : '#666'}">${r.pct > 0 ? '+' : ''}${wvNum(r.pct)}%</td>
        <td>${wvMoney(r.pos_gross)}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`).join('');
    body.innerHTML = `
      <div style="overflow-x:auto">
      <div class="tbl-hd" style="padding:8px 0"><h3><i class=ji data-i=list></i> المقارنة التفصيلية — ${wvNum(WV.rows.length)} صنف</h3></div>
      <table class="tbl">
        <thead><tr><th>#</th><th>الصنف</th><th>مصروف من المخزن</th><th>مبيع بالكاشيرية</th><th>الفرق</th><th>النسبة</th><th>قيمة المبيع</th><th>الحالة</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="8" class="u-empty">لا بيانات في هذه الفترة</td></tr>`}</tbody>
      </table>
      </div>`;
}

// ─── تطبيق الفلاتر ───
function wvApply() {
    WV.from = document.getElementById('wvFrom')?.value || WV.from;
    WV.to = document.getElementById('wvTo')?.value || WV.to;
    WV.item = (document.getElementById('wvItem')?.value || '').trim();
    WV.only = document.getElementById('wvOnly')?.value || 'all';
    const box = document.getElementById('wvSuggestBox');
    if (box) { box.style.display = 'none'; }
    wvReload();
}

// ─── طباعة تقرير ───
function wvPrintReport() {
    const s = WV.summary || {};
    const rows = WV.rows.map((r, i) => `
      <tr><td>${i + 1}</td><td style="text-align:start">${wvEscape(r.name)}</td><td>${wvNum(r.wh_qty)}</td><td>${wvNum(r.pos_qty)}</td>
      <td>${r.diff > 0 ? '+' : ''}${wvNum(r.diff)}</td><td>${r.pct > 0 ? '+' : ''}${wvNum(r.pct)}%</td><td>${wvMoney(r.pos_gross)}</td>
      <td>${r.status === 'match' ? '✓' : r.status === 'sold_more' ? 'مباع أكثر' : r.status === 'issued_more' ? 'مصروف أكثر' : r.status === 'pos_only' ? 'مباع فقط' : 'مصروف فقط'}</td></tr>`).join('');
    const w = window.openInAppReport ? window.openInAppReport('تقرير مقارنة الصرف والمبيعات') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير مقارنة الصرف والمبيعات</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:12px}
    .summary{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:14px}.summary div{border:1px solid #999;padding:8px 16px;border-radius:6px;font-size:13px}
    table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #999;padding:5px;text-align:center}th{background:#0f172a;color:#f5d76e}
    tfoot td{font-weight:800;background:#f3ecd9}.filters{text-align:center;font-size:13px;color:#444;margin-bottom:10px}.controls{text-align:center;margin-bottom:16px}
    .controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" data-karim-action="print">طباعة</button><button class="bc" data-karim-action="closeWindow">إغلاق</button></div>
    <h1>تقرير مقارنة الصرف والمبيعات</h1>
    <h2>مطاعم الشرفة العالمي · من ${wvEscape(WV.from)} إلى ${wvEscape(WV.to)}${WV.item ? ' · بحث: ' + wvEscape(WV.item) : ''}</h2>
    <div class="summary">
      <div>الأصناف: <b>${wvNum(s.total_items)}</b></div>
      <div>متطابقة: <b style="color:#16a34a">${wvNum(s.matched)}</b></div>
      <div>مباع أكثر: <b style="color:#dc2626">${wvNum(s.sold_more)}</b></div>
      <div>مصروف أكثر: <b style="color:#d97706">${wvNum(s.issued_more)}</b></div>
      <div>مباع فقط: <b>${wvNum(s.pos_only)}</b></div>
      <div>مصروف فقط: <b>${wvNum(s.wh_only)}</b></div>
    </div>
    <table><thead><tr><th>#</th><th>الصنف</th><th>مصروف</th><th>مبيع</th><th>الفرق</th><th>النسبة</th><th>قيمة المبيع</th><th>الحالة</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

// ─── تصدير Excel ───
function wvExportExcel() {
    if (typeof XLSX === 'undefined') { toast('مكتبة Excel غير محمّلة', 'error'); return; }
    const data = [['الصنف', 'مصروف من المخزن', 'مبيع بالكاشيرية', 'الفرق', 'النسبة %', 'قيمة المبيع الصافي', 'قيمة المبيع الإجمالي', 'عدد الأذونات', 'عدد الفواتير', 'القسم', 'الحالة']];
    WV.rows.forEach((r) => {
        const st = { match: 'متطابق', sold_more: 'المبيع أكثر', issued_more: 'المصروف أكثر', pos_only: 'مباع فقط', wh_only: 'مصروف فقط' }[r.status] || r.status;
        data.push([r.name, r.wh_qty, r.pos_qty, r.diff, r.pct, r.pos_net, r.pos_gross, r.wh_docs, r.pos_invoices, r.dept || '', st]);
    });
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المقارنة');
    XLSX.writeFile(wb, `wh-vs-pos_${WV.from}_${WV.to}.xlsx`);
    toast('تم تصدير Excel', 'success');
}

// wvSuggest مستدعاة من معالج سطري داخل HTML (oninput="wvSuggest()") —
// والملف يُحمَّل كـmodule عبر safeBridge، فبلا تصديرها لا تصل إلى window.
export { renderWhVsPosPage, wvApply, wvSuggest, wvExportExcel, wvPrintReport, wvPreset, wvPickSuggest };
