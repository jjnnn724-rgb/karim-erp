/**
 * features/cashier-monitor.js — متابعة الكاشير للأونر (قراءة فقط)
 * ────────────────────────────────────────────────────────────────────────────
 * شاشة المالك: بطاقات ملخص كاشير 1/4/5/6/9 (فواتير/إيراد/متوسط/مدفوعات) من
 * مرآة يارا سوفت + قائمة أوردرات اليوم مع فلتر كاشير وترقيم صفحات.
 * المصدر: GET /cashier-monitor/summary + /cashier-monitor/orders (قراءة فقط —
 * النطاق نفسه محفوظ على السيرفر: MIRROR_CASHIERS).
 */
const CMSTATE = {
    date: '', cashier: '', orders: [], summary: [],
    total: 0, offset: 0, limit: 50,
    updatedAt: null, _lastSnap: null, _liveTimer: null, _socketBound: false,
};

function cmToday(){ try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }catch(_){ return new Date().toISOString().slice(0,10); } }

function cmClock(d){
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) {return '—';}
    const p = (n) => String(n).padStart(2, '0');
    return p(x.getHours()) + ':' + p(x.getMinutes()) + ':' + p(x.getSeconds());
}

// ─── المزامنة الحية: حلقة 30 ثانية + بث socket لحظي ───
async function cmLiveRefresh(){
    if (STATE.page !== 'cashier-monitor' || !document.getElementById('cmDate')) {
        if (CMSTATE._liveTimer) {clearInterval(CMSTATE._liveTimer); CMSTATE._liveTimer = null;}
        return;
    }
    try {
        const liveQ = (CMSTATE.date === cmToday()) ? '&live=1' : '';
        const [summary, orders] = await Promise.all([
            apiFetch(`/cashier-monitor/summary?date=${CMSTATE.date}${liveQ}`),
            apiFetch(`/cashier-monitor/orders?date=${CMSTATE.date}&cashier=${encodeURIComponent(CMSTATE.cashier || '')}&limit=${CMSTATE.limit}&offset=${CMSTATE.offset}`),
        ]);
        CMSTATE.summary = summary.cashiers || [];
        CMSTATE.orders = orders.orders || [];
        CMSTATE.total = orders.total || 0;
        CMSTATE.updatedAt = new Date();
        const snap = JSON.stringify([CMSTATE.summary, CMSTATE.orders]);
        if (snap !== CMSTATE._lastSnap) {
            CMSTATE._lastSnap = snap;
            renderCashierMonitor();
            return;
        }
        const el = document.getElementById('cmLiveStamp');
        if (el) {el.textContent = cmClock(CMSTATE.updatedAt);}
    } catch (_) {}
}
function cmStartLive(){
    if (CMSTATE._liveTimer) {clearInterval(CMSTATE._liveTimer);}
    CMSTATE._liveTimer = setInterval(cmLiveRefresh, 30_000);
    if (!CMSTATE._socketBound && typeof socket !== 'undefined' && socket && typeof socket.on === 'function') {
        CMSTATE._socketBound = true;
        try {
            socket.on('yarasoft:mirror', () => { if (STATE.page === 'cashier-monitor') {cmLiveRefresh();} });
        } catch (_) {}
    }
}

function cmMoney(n){
    return Number(n || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 });
}

function cmTime(t){
    const s = String(t || '');
    return s ? s.slice(0, 5) : '—';
}

async function renderCashierMonitor(){
    const box = document.getElementById('content');
    if (!box) {return;}
    if (!CMSTATE.date) {CMSTATE.date = cmToday();}
    box.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div> جاري تحميل متابعة الكاشير…</div>';
    let summary = { cashiers: [] }, orders = { orders: [], total: 0 };
    try {
        [summary, orders] = await Promise.all([
            apiFetch(`/cashier-monitor/summary?date=${CMSTATE.date}`),
            apiFetch(`/cashier-monitor/orders?date=${CMSTATE.date}&cashier=${encodeURIComponent(CMSTATE.cashier || '')}&limit=${CMSTATE.limit}&offset=${CMSTATE.offset}`),
        ]);
    } catch (e) {
        box.innerHTML = `<div class="mcard u-empty"><i class=ji data-i=circle-x></i> تعذر تحميل البيانات: ${esc(e.message || 'خطأ غير متوقع')}</div>`;
        return;
    }
    CMSTATE.summary = summary.cashiers || [];
    CMSTATE.orders = orders.orders || [];
    CMSTATE.total = orders.total || 0;
    CMSTATE.updatedAt = new Date();
    CMSTATE._lastSnap = JSON.stringify([CMSTATE.summary, CMSTATE.orders]);

    const totInvoices = CMSTATE.summary.reduce((s, c) => s + Number(c.invoices || 0), 0);
    const totRevenue = CMSTATE.summary.reduce((s, c) => s + Number(c.revenue || 0), 0);
    const totRevenueEx = CMSTATE.summary.reduce((s, c) => s + Number(c.revenue_ex_vat || 0), 0);
    const totCash = CMSTATE.summary.reduce((s, c) => s + Number(c.pay_cash || 0), 0);
    const totNetwork = CMSTATE.summary.reduce((s, c) => s + Number(c.pay_network || 0), 0);
    // حداثة المرآة: آخر مزامنة من يارسوفت — لو قديمة، البيانات المعروضة متجمدة
    const syncTimes = (CMSTATE.summary||[]).map(c=>c.synced_at).filter(Boolean);
    const lastSync = syncTimes.length ? syncTimes.sort().reverse()[0] : null;
    const syncAgeMin = lastSync ? Math.round((Date.now() - new Date(lastSync).getTime()) / 60000) : null;
    const syncStale = syncAgeMin === null || syncAgeMin > 45;
    const syncBadge = !lastSync
        ? `<span class="badge bdg-red">لا توجد مزامنة بعد</span>`
        : syncStale
        ? `<span class="badge bdg-red">المرآة متوقفة منذ ${fN(syncAgeMin)} دقيقة — تأكد أن جهاز يارسوفت يعمل</span>`
        : `<span class="badge bdg-green">مزامنة حية (منذ ${fN(syncAgeMin)} دقيقة)</span>`;

    const pages = Math.max(1, Math.ceil(CMSTATE.total / CMSTATE.limit));
    const page = Math.floor(CMSTATE.offset / CMSTATE.limit) + 1;

    box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
    <h3 class="u-gold-strong"><i class=ji data-i=chart></i> متابعة الكاشير — ${esc(fD(CMSTATE.date))}
    <span class="badge bdg-green" style="vertical-align:middle" title="البيانات تتحدث تلقائيًا كل 30 ثانية"><i class=ji data-i=activity></i> مباشر</span></h3>
    <div class="u-row-wrap">
    <span class="text-muted" style="font-size:12px">آخر تحديث <b id="cmLiveStamp" dir="ltr">${esc(cmClock(CMSTATE.updatedAt))}</b></span>
    ${syncBadge}
    <input type="date" id="cmDate" value="${esc(CMSTATE.date)}" onchange="cmDateChange(this.value)" style="min-width:150px">
    <button class="btn btn-gold btn-sm" onclick="cmRefresh()"><i class=ji data-i=refresh></i> تحديث</button>
    <button class="btn btn-blue btn-sm" onclick="cmPrintReport()"><i class=ji data-i=printer></i> طباعة التقرير</button>
    <button class="btn btn-green btn-sm" onclick="cmExportExcel()"><i class=ji data-i=inbox></i> Excel</button>
    </div>
    </div>
    <div class="metrics-grid">
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=receipt></i> إجمالي الفواتير</div><div class="mcard-val c-gold">${fN(totInvoices)}</div></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الإيراد (شامل الضريبة)</div><div class="mcard-val c-green">${cmMoney(totRevenue)}</div><div class="text-muted" style="font-size:11px">قبل الضريبة: ${cmMoney(totRevenueEx)}</div></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> نقدًا</div><div class="mcard-val c-blue">${cmMoney(totCash)}</div></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=credit-card></i> شبكة/محفظة</div><div class="mcard-val c-gold">${cmMoney(totNetwork)}</div></div>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin:10px 0" id="cmCards">
    ${CMSTATE.summary.map(c => `
    <div class="mcard" style="cursor:pointer;min-width:210px;flex:1;${String(CMSTATE.cashier) === String(c.cashier_no) ? 'border:2px solid var(--gold);' : ''}" onclick="cmFilterCashier('${esc(c.cashier_no)}')">
    <div class="mcard-label"><i class=ji data-i=store></i> كاشير ${esc(c.cashier_no)} ${String(CMSTATE.cashier) === String(c.cashier_no) ? '✓' : ''}</div>
    <div class="mcard-val c-gold" style="font-size:20px">${cmMoney(c.revenue)}</div>
    <div class="text-muted" style="font-size:12px;margin-top:4px">
    ${fN(c.invoices)} فاتورة · متوسط ${cmMoney(c.avg)}<br>
    قبل الضريبة: ${cmMoney(c.revenue_ex_vat)}<br>
    نقدًا ${cmMoney(c.pay_cash)} · شبكة ${cmMoney(c.pay_network)}<br>
    آخر فاتورة: ${esc(cmTime(c.last_time))}
    </div>
    </div>`).join('')}
    </div>
    <div class="tbl-wrap">
    <div class="tbl-hd">
    <h3><i class=ji data-i=receipt></i> أوردرات ${CMSTATE.cashier ? `كاشير ${esc(CMSTATE.cashier)}` : 'كل الكاشيرية'} — ${fN(CMSTATE.total)} أوردر</h3>
    ${CMSTATE.cashier ? `<button class="btn btn-sm" onclick="cmFilterCashier('')">إلغاء الفلتر</button>` : ''}
    </div>
    <div class="tbl-scroll">
    <table>
    <thead><tr><th>الفاتورة</th><th>الكاشير</th><th>الوقت</th><th>الوردية</th><th>شامل الضريبة</th><th>قبل الضريبة</th><th>مدفوع</th><th>الأصناف</th><th>المنطقة</th></tr></thead>
    <tbody>
    ${CMSTATE.orders.length === 0 ? '<tr><td colspan=9 style="text-align:center;padding:30px;color:var(--faint)">لا توجد أوردرات في هذا اليوم</td></tr>' : ''}
    ${CMSTATE.orders.map(o => `
    <tr onclick="cmOpenOrder('${esc(o.doc_no)}')" style="cursor:pointer">
    <td class="fw-bold" dir="ltr">${esc(o.doc_no)}</td>
    <td><span class="badge bdg-blue">كاشير ${esc(o.cashier_no)}</span></td>
    <td dir="ltr">${esc(cmTime(o.doc_time))}</td>
    <td>${esc(o.shift_no || '—')}</td>
    <td class="c-gold">${cmMoney(o.net)}</td>
    <td>${cmMoney(o.total)}</td>
    <td class="c-green">${cmMoney(o.payed)}</td>
    <td>${fN(o.lines_count)}</td>
    <td class="text-muted">${esc(o.zone_name || '—')}</td>
    </tr>`).join('')}
    </tbody>
    </table>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
    <span class="text-muted">صفحة ${fN(page)} من ${fN(pages)}</span>
    <button class="btn btn-sm" ${page <= 1 ? 'disabled' : ''} onclick="cmPageGo(-1)">السابق</button>
    <button class="btn btn-sm" ${page >= pages ? 'disabled' : ''} onclick="cmPageGo(1)">التالي</button>
    <span class="text-muted" style="margin-inline-start:auto">${CMSTATE.cashier ? 'اضغط على بطاقة الكاشير المحددة لإلغاء الفلتر' : 'اضغط على أي بطاقة كاشير لعزل فواتيره'}</span>
    </div>
    </div>
    <div id="cmOrderBox"></div>
    `;
    cmStartLive();
}

function cmDateChange(v){
    if (!v) {return;}
    CMSTATE.date = v;
    CMSTATE.offset = 0;
    renderCashierMonitor();
}

function cmRefresh(){
    CMSTATE.offset = 0;
    renderCashierMonitor();
}

function cmFilterCashier(no){
    CMSTATE.cashier = (CMSTATE.cashier === String(no)) ? '' : String(no);
    CMSTATE.offset = 0;
    renderCashierMonitor();
}

function cmPageGo(dir){
    const next = CMSTATE.offset + dir * CMSTATE.limit;
    if (next < 0 || next >= Math.max(CMSTATE.total, 1)) {return;}
    CMSTATE.offset = next;
    renderCashierMonitor();
}

async function cmOpenOrder(docNo){
    const box = document.getElementById('cmOrderBox');
    if (!box) {return;}
    box.innerHTML = '<div class="mcard"><div class="spinner"></div> جاري جلب تفاصيل الفاتورة…</div>';
    try {
        const d = await apiFetch(`/cashier-monitor/orders/${encodeURIComponent(docNo)}`);
        const o = d.order || {};
        const lines = Array.isArray(o.lines) ? o.lines : [];
        box.innerHTML = `
        <div class="tbl-wrap" style="margin-top:14px">
        <div class="tbl-hd"><h3><i class=ji data-i=file-text></i> فاتورة ${esc(o.doc_no)} — كاشير ${esc(o.cashier_no)}</h3>
        <button class="btn btn-sm" onclick="document.getElementById('cmOrderBox').innerHTML=''">إغلاق</button></div>
        <div class="tbl-scroll"><table>
        <thead><tr><th>الوقت</th><th>الوردية</th><th>الإجمالي</th><th>الصافي</th><th>الخصم</th><th>الضريبة</th><th>نقدًا</th><th>شبكة</th><th>مطبوع</th></tr></thead>
        <tbody><tr>
        <td dir="ltr">${esc(cmTime(o.doc_time))}</td><td>${esc(o.shift_no || '—')}</td>
        <td class="c-gold">${cmMoney(o.total)}</td><td>${cmMoney(o.net)}</td>
        <td>${cmMoney(o.discount)}</td><td>${cmMoney(o.vat)}</td>
        <td>${cmMoney(o.pay_cash)}</td><td>${cmMoney(o.pay_network)}</td>
        <td>${o.printed ? 'نعم' : 'لا'}</td>
        </tr></tbody></table></div>
        ${lines.length ? `
        <div class="tbl-scroll" style="margin-top:8px"><table>
        <thead><tr><th>#</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${lines.map((l, i) => `
        <tr><td>${fN(i + 1)}</td><td>${esc(l.name || l.item || l.desc || '—')}</td>
        <td>${fN(l.qty || l.quantity || 0)}</td><td>${cmMoney(l.price || l.unit_price)}</td>
        <td class="c-gold">${cmMoney(l.total || l.amount)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<div class="text-muted" style="padding:8px">لا سطور مفصلة لهذه الفاتورة في المرآة</div>'}
        </div>`;
    } catch (e) {
        box.innerHTML = `<div class="mcard">تعذر جلب الفاتورة: ${esc(e.message || 'خطأ')}</div>`;
    }
}

export { renderCashierMonitor, cmDateChange, cmRefresh, cmFilterCashier, cmPageGo, cmOpenOrder, cmPrintReport, cmExportExcel, CMSTATE };

// ─── تقرير إيرادات كل كاشير (طباعة + Excel) ───
function cmReportRows(){
    return (CMSTATE.summary||[]).map(c=>({
        cashier: c.cashier_no, invoices: Number(c.invoices||0), revenue: Number(c.revenue||0),
        exVat: Number(c.revenue_ex_vat||0), avg: Number(c.avg||0), cash: Number(c.pay_cash||0),
        network: Number(c.pay_network||0), last: c.last_time||'—',
    }));
}
function cmPrintReport(){
    const rows = cmReportRows();
    const tot = rows.reduce((s,r)=>({n:s.n+r.invoices,r:s.r+r.revenue}),{n:0,r:0});
    const w = (window.openInAppReport ? window.openInAppReport('تقرير الكاشيرية') : window.open('', '_blank'));
    if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير إيرادات الكاشيرية — ${esc(CMSTATE.date)}</title>
    <style>body{font-family:'Cairo',Tahoma,sans-serif;padding:36px;color:#1a1a1a}h1{text-align:center;font-size:22px}h2{text-align:center;color:#666;font-size:15px;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#0f172a;color:#f5d76e}tfoot td{font-weight:800;background:#f3ecd9}.controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}@media print{.controls{display:none}body{padding:0}}</style></head><body>
    <div class="controls"><button class="btn-print" onclick="window.print()">طباعة</button><button class="btn-close" onclick="window.close()">إغلاق</button></div>
    <h1>تقرير إيرادات الكاشيرية — ${esc(fD(CMSTATE.date))}</h1><h2>مطاعم الشرفه العالمي · ${esc(new Date().toLocaleString('ar-EG'))}</h2>
    <table><thead><tr><th>الكاشير</th><th>الفواتير</th><th>الإيراد (شامل)</th><th>قبل الضريبة</th><th>المتوسط</th><th>نقدًا</th><th>شبكة</th><th>آخر فاتورة</th></tr></thead><tbody>
    ${rows.map(r=>`<tr><td><b>كاشير ${esc(r.cashier)}</b></td><td>${fN(r.invoices)}</td><td>${cmMoney(r.revenue)}</td><td>${cmMoney(r.exVat)}</td><td>${cmMoney(r.avg)}</td><td>${cmMoney(r.cash)}</td><td>${cmMoney(r.network)}</td><td dir="ltr">${esc(r.last)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td>الإجمالي (${fN(rows.length)} كاشير)</td><td>${fN(tot.n)}</td><td>${cmMoney(tot.r)}</td><td colspan="5"></td></tr></tfoot></table>
    </body></html>`);
    w.document.close();
    w.focus();
}
function cmExportExcel(){
    if(typeof XLSX==='undefined'){ toast('مكتبة Excel غير محملة','error'); return; }
    const rows = cmReportRows();
    const data=[['الكاشير','الفواتير','الإيراد شامل','قبل الضريبة','المتوسط','نقدًا','شبكة','آخر فاتورة']];
    rows.forEach(r=>data.push([r.cashier,r.invoices,r.revenue,r.exVat,r.avg,r.cash,r.network,r.last]));
    const ws=XLSX.utils.aoa_to_sheet(data);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'الكاشيرية');
    XLSX.writeFile(wb,`cashiers_${CMSTATE.date||'report'}.xlsx`);
    toast('اتصدّر ملف Excel','success');
}
