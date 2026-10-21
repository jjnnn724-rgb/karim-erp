/**
 * features/sales-analyzer.js — محلّل مبيعات الكاشيرية الاحترافي (v2)
 * ────────────────────────────────────────────────────────────────────────────
 * تبويبان: تحليل مجمّع (صنف/كاشير/يوم) + أوردرات مفصّلة قابلة للطباعة.
 * المصدر: GET /yara-reports/item-sales + /orders + /order-detail/:docNo
 * بحث عربي ذكي (يتجاهل «ال» التعريف + كل كلمة على حدة) · تصدير Excel · طباعة تقرير + أوردر فردي.
 */
const SA = {
    tab: 'analysis', // analysis | orders
    from: '', to: '', cashier: '', item: '', group: 'item',
    // analysis
    rows: [], totals: null,
    // orders
    orders: [], ordersTotal: 0, ordersOffset: 0, ordersLimit: 50,
    updatedAt: null,
};

function saToday() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
}
function saMonthStart() { return saToday().slice(0, 8) + '01'; }
function saEscape(v) {
    if (typeof esc === 'function') { return esc(v); }
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function saMoney(n) { return Number(n || 0).toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function saNum(n) { return Number(n || 0).toLocaleString('ar-EG'); }

// ─── الصفحة الرئيسية ───
async function renderSalesAnalyzerPage() {
    const content = document.getElementById('content');
    if (!content) { return; }
    if (!SA.from) { SA.from = saMonthStart(); SA.to = saToday(); }
    content.innerHTML = saShell();
    await saReload();
}

function saShell() {
    return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
      <h3 class="u-gold-strong"><i class=ji data-i=chart></i> تحليل مبيعات الكاشيرية</h3>
      <span class="u-dim" style="font-size:12px">آخر تحديث: <b id="saStamp">${SA.updatedAt ? SA.updatedAt.toLocaleTimeString('ar-EG') : '—'}</b></span>
    </div>
    <!-- تبويبات -->
    <div style="display:flex;gap:6px;margin-bottom:14px;border-bottom:2px solid var(--border,#ddd);padding-bottom:0">
      <button id="saTabAnalysis" class="btn ${SA.tab === 'analysis' ? 'btn-primary' : ''}" style="border-radius:8px 8px 0 0" data-karim-action="saSwitchTab" data-karim-args="[&quot;analysis&quot;]"><i class=ji data-i=bar-chart></i> تحليل مجمّع</button>
      <button id="saTabOrders" class="btn ${SA.tab === 'orders' ? 'btn-primary' : ''}" style="border-radius:8px 8px 0 0" data-karim-action="saSwitchTab" data-karim-args="[&quot;orders&quot;]"><i class=ji data-i=receipt></i> الأوردرات</button>
    </div>
    <!-- شريط الفلاتر -->
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin-bottom:14px;background:var(--card,#fff);padding:12px;border-radius:10px;border:1px solid var(--border,#e5e7eb)">
      <label style="font-size:13px">من <input type="date" id="saFrom" value="${saEscape(SA.from)}" class="inp" style="width:150px"></label>
      <label style="font-size:13px">إلى <input type="date" id="saTo" value="${saEscape(SA.to)}" class="inp" style="width:150px"></label>
      <label style="font-size:13px">الكاشير <select id="saCashier" class="inp" style="width:160px"><option value="">الكل</option>${saCashierOpts()}</select></label>
      <label style="font-size:13px;flex:1;min-width:180px">بحث صنف <input type="text" id="saItem" value="${saEscape(SA.item)}" placeholder="مثال: البيبسي، شاورما، سفن…" class="inp" style="width:100%"></label>
      <label id="saGroupWrap" style="font-size:13px;${SA.tab === 'orders' ? 'display:none' : ''}">تجميع <select id="saGroup" class="inp" style="width:120px">
        <option value="item" ${SA.group === 'item' ? 'selected' : ''}>بالصنف</option>
        <option value="cashier" ${SA.group === 'cashier' ? 'selected' : ''}>بالكاشير</option>
        <option value="day" ${SA.group === 'day' ? 'selected' : ''}>باليوم</option>
      </select></label>
      <button class="btn btn-primary" data-karim-action="saApply"><i class=ji data-i=search></i> تحليل</button>
      <button class="btn btn-green" data-karim-action="saPrintReport"><i class=ji data-i=printer></i> طباعة</button>
      <button class="btn" data-karim-action="saExportExcel"><i class=ji data-i=inbox></i> Excel</button>
    </div>
    <div id="saCards" style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px"></div>
    <div id="saBody"><div class="u-empty"><div class="spinner"></div> جارٍ التحميل…</div></div>`;
}

function saCashierOpts() {
    const map = new Map();
    (SA.rows || []).forEach((r) => { if (r.cashier_no) { map.set(String(r.cashier_no), r.cashier_name || r.cashier_no); } });
    (SA.orders || []).forEach((o) => { if (o.cashier_no) { map.set(String(o.cashier_no), o.cashier_name || o.cashier_no); } });
    return [...map.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([no, name]) => `<option value="${saEscape(no)}" ${String(SA.cashier) === String(no) ? 'selected' : ''}>${saEscape(name)}</option>`).join('');
}

// ─── التبديل بين التبويبات ───
function saSwitchTab(tab) {
    SA.tab = tab;
    document.getElementById('saTabAnalysis')?.classList.toggle('btn-primary', tab === 'analysis');
    document.getElementById('saTabOrders')?.classList.toggle('btn-primary', tab === 'orders');
    document.getElementById('saGroupWrap')?.toggleAttribute('hidden', tab === 'orders');
    saReload();
}

// ─── تحميل البيانات ───
async function saReload() {
    const body = document.getElementById('saBody');
    if (!body) { return; }
    body.innerHTML = '<div class="u-empty"><div class="spinner"></div> جارٍ التحميل…</div>';
    try {
        if (SA.tab === 'orders') {
            await saLoadOrders();
        } else {
            await saLoadAnalysis();
        }
        SA.updatedAt = new Date();
        const stamp = document.getElementById('saStamp');
        if (stamp) { stamp.textContent = SA.updatedAt.toLocaleTimeString('ar-EG'); }
    } catch (e) {
        body.innerHTML = `<div class="u-empty"><i class=ji data-i=circle-x></i> تعذّر التحميل: ${saEscape(e.message || e)}</div>`;
    }
}

async function saLoadAnalysis() {
    const q = new URLSearchParams({ from: SA.from, to: SA.to, group: SA.group });
    if (SA.cashier) { q.set('cashier', SA.cashier); }
    if (SA.item) { q.set('item', SA.item); }
    const data = await apiFetch('/yara-reports/item-sales?' + q.toString());
    SA.rows = data.rows || [];
    SA.totals = data.totals || { invoices: 0, qty: 0, net: 0, vat: 0 };
    saRenderAnalysis();
}

async function saLoadOrders() {
    const q = new URLSearchParams({ from: SA.from, to: SA.to, limit: String(SA.ordersLimit), offset: String(SA.ordersOffset) });
    if (SA.cashier) { q.set('cashier', SA.cashier); }
    const data = await apiFetch('/yara-reports/orders?' + q.toString());
    SA.orders = data.orders || [];
    SA.ordersTotal = data.total || 0;
    saRenderOrders();
}

// ─── بطاقات الملخص ───
function saRenderCards(t) {
    const box = document.getElementById('saCards');
    if (!box) { return; }
    box.innerHTML = `
      <div class="mcard" style="flex:1;min-width:120px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">عدد الصفوف</div><b style="font-size:20px">${saNum(SA.rows.length)}</b></div>
      <div class="mcard" style="flex:1;min-width:120px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">فواتير</div><b style="font-size:20px" class="c-gold">${saNum(t.invoices)}</b></div>
      <div class="mcard" style="flex:1;min-width:120px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">الكمية</div><b style="font-size:20px">${saNum(t.qty)}</b></div>
      <div class="mcard" style="flex:1;min-width:130px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">الصافي</div><b style="font-size:18px">${saMoney(t.net)}</b></div>
      <div class="mcard" style="flex:1;min-width:120px;padding:10px;text-align:center"><div class="u-dim" style="font-size:12px">ضريبة</div><b style="font-size:18px">${saMoney(t.vat)}</b></div>
      <div class="mcard" style="flex:1;min-width:140px;padding:10px;text-align:center;background:linear-gradient(135deg,#f5d76e22,#f5d76e11)"><div class="u-dim" style="font-size:12px">الإجمالي</div><b style="font-size:20px" class="c-gold">${saMoney(Number(t.net) + Number(t.vat))}</b></div>`;
}

// ─── عرض التحليل المجمّع ───
function saRenderAnalysis() {
    const body = document.getElementById('saBody');
    if (!body) { return; }
    saRenderCards(SA.totals);
    const grpLabel = { item: 'الصنف', cashier: 'الكاشير', day: 'اليوم' }[SA.group];
    const rowsHtml = SA.rows.map((r, i) => {
        const label = SA.group === 'cashier' ? (r.cashier_name || r.cashier_no)
            : SA.group === 'day' ? (r.doc_date || r.day)
            : (r.item_name || r.name || '');
        const code = (SA.group === 'item' && r.item_code) ? `<div class="u-dim" style="font-size:11px">${saEscape(r.item_code)}</div>` : '';
        return `<tr>
          <td>${i + 1}</td>
          <td style="text-align:start">${saEscape(label)}${code}</td>
          <td>${saNum(r.invoices)}</td>
          <td><b>${saNum(r.qty)}</b></td>
          <td>${saMoney(r.net)}</td>
          <td>${saMoney(r.vat)}</td>
          <td class="c-gold"><b>${saMoney(Number(r.net) + Number(r.vat))}</b></td>
        </tr>`;
    }).join('');
    body.innerHTML = `
      <div style="overflow-x:auto">
      <table class="tbl">
        <thead><tr><th>#</th><th>${grpLabel}</th><th>فواتير</th><th>الكمية</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="7" class="u-empty">لا مبيعات في هذه الفترة/الفلاتر</td></tr>`}</tbody>
      </table>
      </div>`;
}

// ─── عرض الأوردرات ───
function saRenderOrders() {
    const body = document.getElementById('saBody');
    if (!body) { return; }
    const pages = Math.max(1, Math.ceil(SA.ordersTotal / SA.ordersLimit));
    const page = Math.floor(SA.ordersOffset / SA.ordersLimit) + 1;
    const rowsHtml = SA.orders.map((o) => `
      <tr style="cursor:pointer" data-karim-action="saOpenOrder" data-karim-arg0="${saEscape(o.doc_no)}">
        <td class="fw-bold" dir="ltr">${saEscape(o.doc_no)}</td>
        <td><span class="badge bdg-blue">${saEscape(o.cashier_name || o.cashier_no)}</span></td>
        <td dir="ltr">${saEscape(String(o.doc_time || '').slice(0, 5))}</td>
        <td>${saEscape(o.shift_no || '—')}</td>
        <td class="c-gold"><b>${saMoney(o.net)}</b></td>
        <td>${saMoney(o.total)}</td>
        <td class="c-green">${saMoney(o.payed)}</td>
        <td>${saNum(o.lines_count)}</td>
        <td class="text-muted">${saEscape(o.zone_name || o.table_name || '—')}</td>
        <td><button class="btn btn-sm btn-blue" data-karim-action="saPrintOrder" data-karim-arg0="${saEscape(o.doc_no)}" data-karim-stop><i class=ji data-i=printer></i></button></td>
      </tr>`).join('');
    body.innerHTML = `
      <div class="tbl-wrap">
        <div class="tbl-hd"><h3><i class=ji data-i=receipt></i> الأوردرات — ${saNum(SA.ordersTotal)} فاتورة</h3></div>
        <div class="tbl-scroll"><table class="tbl">
        <thead><tr><th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الوردية</th><th>الصافي</th><th>الإجمالي</th><th>مدفوع</th><th>الأصناف</th><th>المنطقة</th><th>طباعة</th></tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="10" class="u-empty">لا توجد أوردرات في هذه الفترة</td></tr>`}</tbody>
        </table></div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:10px;padding:8px 0">
          <span class="text-muted">صفحة ${saNum(page)} من ${saNum(pages)}</span>
          <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} data-karim-action="saOrdersPage" data-karim-args="[-1]">السابق</button>
          <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} data-karim-action="saOrdersPage" data-karim-args="[1]">التالي</button>
          <span class="text-muted" style="margin-inline-start:auto;font-size:12px">اضغط على أي أوردر لعرض تفاصيله</span>
        </div>
      </div>
      <div id="saOrderDetail"></div>`;
}

// ─── فتح تفاصيل أوردر ───
async function saOpenOrder(docNo) {
    const box = document.getElementById('saOrderDetail');
    if (!box) { return; }
    box.innerHTML = '<div class="mcard"><div class="spinner"></div> جارٍ جلب التفاصيل…</div>';
    try {
        const d = await apiFetch(`/yara-reports/order-detail/${encodeURIComponent(docNo)}`);
        const o = d.order || {};
        const lines = Array.isArray(o.lines) ? o.lines : [];
        const linesHtml = lines.map((l, i) => `
          <tr><td>${i + 1}</td><td style="text-align:start">${saEscape(l.name || '—')}</td>
          <td>${saNum(l.qty)}</td><td>${saMoney(l.price)}</td><td>${saMoney(l.total)}</td></tr>`).join('');
        box.innerHTML = `
        <div class="tbl-wrap" style="margin-top:14px">
          <div class="tbl-hd">
            <h3><i class=ji data-i=file-text></i> فاتورة ${saEscape(o.doc_no)} — ${saEscape(o.cashier_name || 'كاشير ' + o.cashier_no)} — ${saEscape(o.doc_date)}</h3>
            <div style="display:flex;gap:6px">
              <button class="btn btn-sm btn-green" data-karim-action="saPrintOrder" data-karim-arg0="${saEscape(o.doc_no)}"><i class=ji data-i=printer></i> طباعة الأوردر</button>
              <button class="btn btn-sm" onclick="document.getElementById('saOrderDetail').innerHTML=''">إغلاق</button>
            </div>
          </div>
          <div style="display:flex;gap:14px;flex-wrap:wrap;padding:10px 14px;background:var(--bg,#f9fafb);border-radius:8px;margin:8px 0;font-size:13px">
            <span>الوقت: <b dir="ltr">${saEscape(String(o.doc_time || '').slice(0, 5))}</b></span>
            <span>الوردية: <b>${saEscape(o.shift_no || '—')}</b></span>
            <span>المنطقة: <b>${saEscape(o.zone_name || o.table_name || '—')}</b></span>
            <span>الإجمالي: <b class="c-gold">${saMoney(o.total)}</b></span>
            <span>الصافي: <b>${saMoney(o.net)}</b></span>
            <span>الخصم: <b>${saMoney(o.discount)}</b></span>
            <span>الضريبة: <b>${saMoney(o.vat)}</b></span>
            <span>المدفوع: <b class="c-green">${saMoney(o.payed)}</b></span>
            <span>نقدًا: <b>${saMoney(o.pay_cash)}</b></span>
            <span>شبكة: <b>${saMoney(o.pay_network)}</b></span>
          </div>
          <div class="tbl-scroll"><table class="tbl">
            <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
            <tbody>${linesHtml || `<tr><td colspan="5" class="u-empty">لا سطور مفصّلة</td></tr>`}</tbody>
          </table></div>
        </div>`;
        box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        box.innerHTML = `<div class="mcard">تعذر جلب الفاتورة: ${saEscape(e.message || 'خطأ')}</div>`;
    }
}

// ─── طباعة أوردر فردي (إيصال حراري) ───
async function saPrintOrder(docNo) {
    try {
        const d = await apiFetch(`/yara-reports/order-detail/${encodeURIComponent(docNo)}`);
        const o = d.order || {};
        const lines = Array.isArray(o.lines) ? o.lines : [];
        const linesHtml = lines.map((l, i) => `
          <tr><td>${i + 1}</td><td style="text-align:start">${saEscape(l.name || '—')}</td>
          <td>${saNum(l.qty)}</td><td>${saMoney(l.price)}</td><td>${saMoney(l.total)}</td></tr>`).join('');
        const w = window.openInAppReport ? window.openInAppReport(`فاتورة ${saEscape(o.doc_no)}`) : window.open('', '_blank');
        if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
        w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>فاتورة ${saEscape(o.doc_no)}</title>
        <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:20px;max-width:400px;margin:0 auto;color:#111}
        h2{text-align:center;font-size:18px;margin:4px 0}h3{text-align:center;font-size:13px;color:#555;margin:2px 0 10px}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}th,td{border:1px solid #333;padding:4px 6px;text-align:center}
        th{background:#f0f0f0}.meta{font-size:12px;line-height:1.8}.meta b{display:inline-block;min-width:70px}
        .tot{margin-top:10px;border:2px solid #333;padding:8px;font-size:13px}.tot div{display:flex;justify-content:space-between;margin:2px 0}
        .btns{text-align:center;margin-top:12px}.btns button{padding:8px 24px;margin:0 4px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
        .bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.btns{display:none}body{padding:0}}</style></head><body>
        <h2>مطاعم الشرفة العالمي</h2><h3>فاتورة رقم: ${saEscape(o.doc_no)}</h3>
        <div class="meta">
          <div><b>التاريخ:</b> ${saEscape(o.doc_date)} — <b dir="ltr">${saEscape(String(o.doc_time || '').slice(0, 5))}</b></div>
          <div><b>الكاشير:</b> ${saEscape(o.cashier_name || o.cashier_no)}</div>
          <div><b>الوردية:</b> ${saEscape(o.shift_no || '—')}</div>
          <div><b>المنطقة:</b> ${saEscape(o.zone_name || o.table_name || '—')}</div>
        </div>
        <table><thead><tr><th>#</th><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>${linesHtml}</tbody></table>
        <div class="tot">
          <div><span>الإجمالي:</span><b>${saMoney(o.total)}</b></div>
          <div><span>الخصم:</span><b>${saMoney(o.discount)}</b></div>
          <div><span>الضريبة:</span><b>${saMoney(o.vat)}</b></div>
          <div><span>الصافي:</span><b>${saMoney(o.net)}</b></div>
          <div style="border-top:1px solid #333;padding-top:4px;margin-top:4px"><span>المدفوع:</span><b style="font-size:15px">${saMoney(o.payed)}</b></div>
          <div><span>نقدًا:</span><b>${saMoney(o.pay_cash)}</b></div>
          <div><span>شبكة:</span><b>${saMoney(o.pay_network)}</b></div>
        </div>
        <p style="text-align:center;font-size:11px;margin-top:10px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
        <div class="btns"><button class="bp" data-karim-action="print">طباعة</button><button class="bc" data-karim-action="closeWindow">إغلاق</button></div>
        </body></html>`);
        w.document.close();
        w.focus();
    } catch (e) {
        toast('تعذر طباعة الأوردر: ' + (e.message || 'خطأ'), 'error');
    }
}

// ─── تطبيق الفلاتر ───
function saApply() {
    SA.from = document.getElementById('saFrom')?.value || SA.from;
    SA.to = document.getElementById('saTo')?.value || SA.to;
    SA.cashier = document.getElementById('saCashier')?.value || '';
    SA.item = (document.getElementById('saItem')?.value || '').trim();
    SA.group = document.getElementById('saGroup')?.value || 'item';
    SA.ordersOffset = 0;
    saReload();
}

function saOrdersPage(dir) {
    const next = SA.ordersOffset + dir * SA.ordersLimit;
    if (next < 0 || next >= Math.max(SA.ordersTotal, 1)) { return; }
    SA.ordersOffset = next;
    saLoadOrders();
}

// ─── طباعة تقرير التحليل ───
function saPrintReport() {
    if (SA.tab === 'orders') { saPrintOrdersReport(); return; }
    const grpLabel = { item: 'الصنف', cashier: 'الكاشير', day: 'اليوم' }[SA.group];
    const rows = SA.rows.map((r, i) => {
        const label = SA.group === 'cashier' ? (r.cashier_name || r.cashier_no)
            : SA.group === 'day' ? (r.doc_date || r.day)
            : (r.item_name || r.name || '');
        return `<tr><td>${i + 1}</td><td style="text-align:start">${saEscape(label)}</td><td>${saNum(r.invoices)}</td><td>${saNum(r.qty)}</td><td>${saMoney(r.net)}</td><td>${saMoney(r.vat)}</td><td>${saMoney(Number(r.net) + Number(r.vat))}</td></tr>`;
    }).join('');
    const t = SA.totals || { invoices: 0, qty: 0, net: 0, vat: 0 };
    const w = window.openInAppReport ? window.openInAppReport('تحليل مبيعات الكاشيرية') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تحليل مبيعات الكاشيرية</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #999;padding:7px;text-align:center}th{background:#0f172a;color:#f5d76e}
    tfoot td{font-weight:800;background:#f3ecd9}.filters{text-align:center;font-size:13px;color:#444;margin-bottom:10px}.controls{text-align:center;margin-bottom:16px}
    .controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" data-karim-action="print">طباعة</button><button class="bc" data-karim-action="closeWindow">إغلاق</button></div>
    <h1>تحليل مبيعات الكاشيرية</h1>
    <h2>مطاعم الشرفة العالمي · من ${saEscape(SA.from)} إلى ${saEscape(SA.to)}</h2>
    <div class="filters">تجميع: ${grpLabel}${SA.item ? ' · بحث: ' + saEscape(SA.item) : ''}${SA.cashier ? ' · كاشير: ' + saEscape(SA.cashier) : ''}</div>
    <table><thead><tr><th>#</th><th>${grpLabel}</th><th>فواتير</th><th>الكمية</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="2">الإجمالي (${saNum(SA.rows.length)} صف)</td><td>${saNum(t.invoices)}</td><td>${saNum(t.qty)}</td><td>${saMoney(t.net)}</td><td>${saMoney(t.vat)}</td><td>${saMoney(Number(t.net) + Number(t.vat))}</td></tr></tfoot></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

function saPrintOrdersReport() {
    const rows = SA.orders.map((o) => `
      <tr><td dir="ltr">${saEscape(o.doc_no)}</td><td>${saEscape(o.cashier_name || o.cashier_no)}</td><td dir="ltr">${saEscape(String(o.doc_time || '').slice(0, 5))}</td>
      <td>${saMoney(o.net)}</td><td>${saMoney(o.total)}</td><td>${saMoney(o.payed)}</td><td>${saNum(o.lines_count)}</td><td>${saEscape(o.zone_name || '—')}</td></tr>`).join('');
    const tot = SA.orders.reduce((s, o) => ({ n: s.n + 1, net: s.net + Number(o.net || 0), payed: s.payed + Number(o.payed || 0) }), { n: 0, net: 0, payed: 0 });
    const w = window.openInAppReport ? window.openInAppReport('تقرير أوردرات الكاشيرية') : window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير أوردرات الكاشيرية</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#111}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:14px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;font-size:12.5px}th,td{border:1px solid #999;padding:6px;text-align:center}th{background:#0f172a;color:#f5d76e}
    tfoot td{font-weight:800;background:#f3ecd9}.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}
    .bp{background:#2e9e5b;color:#fff}.bc{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="bp" data-karim-action="print">طباعة</button><button class="bc" data-karim-action="closeWindow">إغلاق</button></div>
    <h1>تقرير أوردرات الكاشيرية</h1>
    <h2>مطاعم الشرفة العالمي · من ${saEscape(SA.from)} إلى ${saEscape(SA.to)}${SA.cashier ? ' · كاشير: ' + saEscape(SA.cashier) : ''}</h2>
    <table><thead><tr><th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الصافي</th><th>الإجمالي</th><th>مدفوع</th><th>أصناف</th><th>المنطقة</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr><td colspan="3">الإجمالي (${saNum(tot.n)} أوردر)</td><td>${saMoney(tot.net)}</td><td></td><td>${saMoney(tot.payed)}</td><td colspan="2"></td></tr></tfoot></table>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:#777">تاريخ الطباعة: ${new Date().toLocaleString('ar-EG')}</p>
    </body></html>`);
    w.document.close();
    w.focus();
}

// ─── تصدير Excel ───
function saExportExcel() {
    if (typeof XLSX === 'undefined') { toast('مكتبة Excel غير محمّلة', 'error'); return; }
    const wb = XLSX.utils.book_new();
    if (SA.tab === 'orders') {
        const data = [['الفاتورة', 'الكاشير', 'التاريخ', 'الوقت', 'الوردية', 'الصافي', 'الإجمالي', 'الخصم', 'الضريبة', 'مدفوع', 'نقدًا', 'شبكة', 'الأصناف', 'المنطقة']];
        SA.orders.forEach((o) => data.push([o.doc_no, o.cashier_name || o.cashier_no, o.doc_date, String(o.doc_time || '').slice(0, 5), o.shift_no || '', o.net, o.total, o.discount, o.vat, o.payed, o.pay_cash, o.pay_network, o.lines_count, o.zone_name || o.table_name || '']));
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'الأوردرات');
        XLSX.writeFile(wb, `orders_${SA.from}_${SA.to}.xlsx`);
    } else {
        const grpLabel = { item: 'الصنف', cashier: 'الكاشير', day: 'اليوم' }[SA.group];
        const data = [[grpLabel, 'فواتير', 'الكمية', 'الصافي', 'الضريبة', 'الإجمالي']];
        SA.rows.forEach((r) => {
            const label = SA.group === 'cashier' ? (r.cashier_name || r.cashier_no)
                : SA.group === 'day' ? (r.doc_date || r.day)
                : (r.item_name || r.name || '');
            data.push([label, r.invoices, r.qty, r.net, r.vat, Number(r.net) + Number(r.vat)]);
        });
        const ws = XLSX.utils.aoa_to_sheet(data);
        XLSX.utils.book_append_sheet(wb, ws, 'تحليل المبيعات');
        XLSX.writeFile(wb, `item-sales_${SA.from}_${SA.to}.xlsx`);
    }
    toast('تم تصدير Excel', 'success');
}

export { renderSalesAnalyzerPage, saApply, saExportExcel, saPrintReport, saSwitchTab, saOrdersPage, saOpenOrder, saPrintOrder };
