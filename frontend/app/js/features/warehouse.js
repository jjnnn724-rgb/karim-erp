/**
 * features/warehouse.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// عنقود صفحة الموظفين: نُقل إلى js/features/employees.js (يجسر عبر js/main.js — BRIDGE-011)
// ============================================
// WAREHOUSE
// ============================================
// ─── مخزون قابل للتوسع: بحث وترقيم من الخادم + تحديد محفوظ عبر الصفحات ────
const WHINV = { q:'', cat:'all', stock:'all', page:1, limit:50, total:0, results:null, loading:false, error:'', cats:[] };
if(!(window.whSelected instanceof Set)) {window.whSelected = new Set();}
let WHINV_REQ = 0; let WHINV_TIMER = null;
function whInvSearchInput(val){
    WHINV.q = String(val ?? '');
    WHINV.page = 1;
    if (WHINV_TIMER) {clearTimeout(WHINV_TIMER);}
    WHINV_TIMER = setTimeout(() => {whInvFetch();}, 300);
}
function whInvFilterChange(kind, val){
    if(kind==='cat'){ WHINV.cat = val || 'all'; window.whCatFilter = WHINV.cat; }
    if(kind==='stock'){ WHINV.stock = ['low','out','ok'].includes(val) ? val : 'all'; }
    WHINV.page = 1; // الفلتر يصفّر الصفحة
    whInvFetch();
}
function whInvPage(delta){
    const pages = Math.max(1, Math.ceil((WHINV.total || 0) / (WHINV.limit || 50)));
    const next = Math.min(pages, Math.max(1, (WHINV.page || 1) + delta));
    if (next === WHINV.page) {return;}
    WHINV.page = next; // التنقل يحفظ البحث والفلاتر
    whInvFetch();
}
function whInvClearSel(){ window.whSelected.clear(); renderPage(); }
function whSelToggle(id, checked){
    id = String(id);
    if (checked) {window.whSelected.add(id);} else {window.whSelected.delete(id);}
    const cnt = document.getElementById('whSelCount');
    if (cnt) {cnt.textContent = `المحدد: ${fN(window.whSelected.size)}`;}
}
function whSelPage(checked, ids){
    (ids || []).forEach(id => {
        if (checked) {window.whSelected.add(String(id));} else {window.whSelected.delete(String(id));}
    });
    renderPage();
}
/* ─── طلب المالك 2026-10-05: البحث في المخزن كان يقفز بالصفحة لأعلى ───
   السبب: whInvFetch كان يستدعي renderPage() (رسم كامل للصفحة) مرتين لكل بحث
   فيُهدم مربع البحث ويعاد بناؤه فيفقد التركيز وتقفز الصفحة.
   الحل: تحديث جزئي — tbody وعداد الفئات وشريط الترقيم فقط، ومربع البحث لا يُلمس
   فيبقى التركيز وموضع المؤشر وموضع الصفحة كما هما أثناء الكتابة. */
function whInvLocalItems(){
    return (STATE.inventory||[])
    .filter(i=>window.whCatFilter==='all'||String(i.category||'عام')===window.whCatFilter)
    .sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'ar')||String(a.name||'').localeCompare(String(b.name||''),'ar'));
}
function whInvRowsHtml(items){
    if(WHINV.loading) {return '<tr><td colspan="13" class="u-empty" aria-live="polite">جارٍ تحميل الأصناف...</td></tr>';}
    if(WHINV.error && WHINV.results === null) {return `<tr><td colspan="13" class="u-empty">تعذر البحث: ${esc(WHINV.error)} — عرض محلي <button class="btn btn-sm" data-karim-action="whInvFetch">إعادة المحاولة</button></td></tr>`;}
    return items.map(item=>{
    // طلب المالك 2026-10-05: «إذن الصرف 4 يعني الباقي 4» — العمود الأساسي = رصيد المخزن
    // الرئيسي، وما انتقل لمخازن الأقسام يظهر في عمود مستقل، والإجمالي في عمود القيمة
    const mainQty = item.mainQty != null ? Number(item.mainQty) : Number(item.qty);
    const deptQty = Math.max(0, Math.round((Number(item.qty) - mainQty) * 1000) / 1000);
    const isLow = mainQty < Number(item.minQty);
    const shelf = STATE.shelves.find(s=>s.id===item.shelfId);
    return `<tr>
    <td><input type="checkbox" class="wh-sel" value="${esc(String(item.id))}" ${window.whSelected.has(String(item.id))?'checked':''} data-karim-action="whSelToggle" data-karim-event="change" data-karim-arg0="${esc(String(item.id))}" data-karim-pass="checked" aria-label="تحديد ${esc(item.name||'صنف')}"></td>
    <td class="fw-bold">${esc(item.name)}${item.barcode?`<div style="font-size:10px;color:var(--text3);font-family:monospace;font-weight:400">${esc(item.barcode)}</div>`:''}</td>
    <td class="c-gold">${esc(item.category||'—')}</td>
    <td>${item.unit}</td>
    <td class="${isLow?'c-red fw-bold':''}">${fN(mainQty)}</td>
    <td class="${deptQty>0?'c-gold':''}">${fN(deptQty)}</td>
    <td class="c-teal">${fN(item.weight||0)}</td>
    <td>${shelf?`<span class="badge bdg-purple">${esc(shelf.code)}</span>`:'<span class="text-muted">—</span>'}</td>
    <td class="c-red">${fN(item.minQty)}</td>
    <td class="c-gold">${fC(item.avgCost)}</td>
    <td class="c-gold fw-bold">${fC(item.qty*item.avgCost)}</td>
    <td><span class="badge ${isLow?'bdg-red':'bdg-green'}">${isLow?`<i class=ji data-i=alert-triangle></i> ${t('wh.lowSt')}`:`<i class=ji data-i=circle-check></i> ${t('wh.okSt')}`}</span></td>
    <td style="display:flex;gap:4px"><button type="button" class="btn btn-sm" data-action="edit-inventory" data-id="${esc(String(item.id))}" data-karim-action="editItem" data-karim-arg0="${esc(String(item.id))}"><i class=ji data-i=pencil></i> ${t('act.edit')}</button><button type="button" class="btn btn-red btn-sm" data-action="delete-inventory" data-id="${esc(String(item.id))}" data-karim-action="deleteItem" data-karim-arg0="${esc(String(item.id))}"><i class=ji data-i=trash></i> ${t('act.delete')}</button></td>
    </tr>`;
    }).join('')||`<tr><td colspan="13" class="u-empty">${t('wh.noItems')}</td></tr>`;
}
function whInvPagerHtml(serverMode){
    if(!serverMode) {return '';}
    const pages = Math.max(1, Math.ceil((WHINV.total || 0) / (WHINV.limit || 50)));
    const fuzzyNote = WHINV.fuzzy && (WHINV.q||'').trim() ? ` <span class="badge bdg-purple" title="بحثنا بتسامح الحروف المتشابهة (بازنجان = باذنجان)">نتائج مشابهة لكتابتك</span>` : '';
    return `<div class="fr" style="padding:8px 14px;align-items:center" aria-live="polite">
    <span class="u-t13 text-muted">الأصناف: ${fN(WHINV.total)} — صفحة ${fN(WHINV.page)} من ${fN(pages)} (50/صفحة)${fuzzyNote}</span>
    <div class="fr"></div>
    <button class="btn btn-sm" ${WHINV.page<=1?'disabled':''} data-karim-action="whInvPage" data-karim-args="[-1]">السابق</button>
    <button class="btn btn-sm" ${WHINV.page>=pages?'disabled':''} data-karim-action="whInvPage" data-karim-args="[1]">التالي</button>
    </div>`;
}
function whInvPartialRender(){
    const body = document.getElementById('whInvBody');
    if(!body) {renderPage(); return;} // الجدول غير موجود بعد → الرسم الكامل كالسابق
    const serverMode = WHINV.results !== null;
    body.innerHTML = whInvRowsHtml(serverMode ? WHINV.results : whInvLocalItems());
    const pager = document.getElementById('whInvPager');
    if(pager) {pager.innerHTML = whInvPagerHtml(serverMode);}
    const catSel = document.getElementById('whInvCatSelect');
    if(catSel && catSel.options.length) {catSel.options[0].textContent = `كل الفئات (${fN(serverMode?WHINV.total:STATE.inventory.length)})`;}
}
async function whInvFetch(){
    const myId = ++WHINV_REQ;
    WHINV.loading = true; WHINV.error = '';
    if (STATE.page === 'warehouse') {whInvPartialRender();}
    const params = new URLSearchParams({
        q: WHINV.q || '', category: WHINV.cat || 'all', stock: WHINV.stock || 'all',
        page: String(WHINV.page || 1), limit: String(WHINV.limit || 50),
    });
    try{
        const res = await apiFetch('/warehouse/inventory/search?' + params.toString());
        if (myId !== WHINV_REQ) {return;} // stale — ignore
        WHINV.results = Array.isArray(res.data) ? res.data : [];
        WHINV.total = Number(res.pagination?.total || 0);
        WHINV.fuzzy = Boolean(res.fuzzy);
        WHINV.page = Number(res.pagination?.page || 1);
        if (Array.isArray(res.categories)) {WHINV.cats = res.categories;}
        WHINV.loading = false;
    }catch(e){
        if (myId !== WHINV_REQ) {return;}
        WHINV.loading = false;
        WHINV.error = e.message || 'تعذر البحث';
        WHINV.results = null; // fallback: العرض المحلي الكامل
    }
    if (STATE.page === 'warehouse') {whInvPartialRender();}
}
function whInvClearSearch(){
    WHINV.q = ''; WHINV.page = 1;
    renderPage();
    whInvFetch();
}
function whMetricsHtml(){
const totalValue = STATE.inventory.reduce((s,i)=>s+(i.qty*i.avgCost),0);
const lowStock = STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty));
const totalWeight = STATE.inventory.reduce((s,i)=>s+(i.weight||0),0);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> ${t('wh.items')}</div><div class="mcard-val c-gold">${fN(STATE.inventory.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('wh.value')}</div><div class="mcard-val c-green">${fC(totalValue)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> ${t('wh.low')}</div><div class="mcard-val ${lowStock.length>0?'c-red':'c-green'}">${fN(lowStock.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=file-text></i> ${t('wh.invoices')}</div><div class="mcard-val c-blue">${fN((STATE.purchaseInvoices||[]).length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('wh.weight')}</div><div class="mcard-val c-teal">${fN(totalWeight)} كجم</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('wh.shelves')}</div><div class="mcard-val c-purple">${fN(STATE.shelves.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> ${t('wh.cats')}</div><div class="mcard-val c-orange">${fN(new Set(STATE.inventory.map(i=>i.category)).size)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> ${t('wh.lastMove')}</div><div class="mcard-val c-blue u-t14">${STATE.inventoryTx.length>0?fD(STATE.inventoryTx[STATE.inventoryTx.length-1].date):'—'}</div></div>
</div>`;
}

// ─── صفحة الأصناف (المخزن) ───
// طلب المالك 2026-10-05: «اجعل البحث في أول صفحة المخزن» — شريط بحث فوري لاصق
// في أول الصفحة فوق كل شيء (لا يختفي مع النزول)، والنتائج تتحقق تحته جزئيًا بلا قفزة.
function renderWarehouse(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
if (WHINV.results === null && !WHINV.loading && !WHINV.error) { setTimeout(()=>whInvFetch(),0); }
const serverMode = WHINV.results !== null;
const whTopSearch = `
<section aria-label="بحث المخزن السريع" style="margin-bottom:12px">
<div style="position:sticky;top:0;z-index:35;background:var(--bg2);border:1px solid var(--border-gold,var(--border));border-radius:var(--r);padding:10px 14px;box-shadow:0 8px 22px rgba(0,0,0,.18);display:flex;gap:10px;align-items:center">
<i class=ji data-i=search style="color:var(--gold);font-size:18px;flex-shrink:0"></i>
<input type="text" id="whTopSearch" class="inp" placeholder="بحث فوري: اسم / باركود / فئة..." aria-label="بحث الأصناف" value="${esc(WHINV.q)}" data-karim-action="whInvSearchInput" data-karim-event="input" data-karim-pass="value" style="flex:1;border:none;background:transparent;font-size:16px;font-weight:700;color:var(--text);padding:4px 0;outline:none;box-shadow:none">
${WHINV.q?`<button class="btn btn-red btn-sm" data-karim-action="whInvClearSearch" title="مسح البحث"><i class=ji data-i=x></i></button>`:''}
</div>
</section>`;
const whCats = [...new Set((STATE.inventory||[]).map(i=>String(i.category||'عام')))].sort((a,b)=>a.localeCompare(b,'ar'));
if(window.whCatFilter!=='all' && !whCats.includes(window.whCatFilter)) {window.whCatFilter='all';}
if (WHINV.cat === 'all' && window.whCatFilter && window.whCatFilter !== 'all') {WHINV.cat = window.whCatFilter;}
const catOpts = (WHINV.cats.length ? WHINV.cats : whCats).map(c=>`<option value="${esc(c)}" ${WHINV.cat===c?'selected':''}>${esc(c)}</option>`).join('');
const whItems = serverMode ? WHINV.results : whInvLocalItems();
return whTopSearch + whMetricsHtml() + `
<section id="wh-sec-items" aria-label="أصناف المخزون">
<div class="tbl-wrap">
<div class="tbl-hd">
<h3><i class=ji data-i=package></i> ${t('wh.invTitle')}</h3>
<div class="u-row-wrap">
<select class="inp" id="whInvCatSelect" data-karim-action="whInvFilterChange" data-karim-event="change" data-karim-args="[&quot;cat&quot;]" data-karim-pass="value" style="max-width:160px" title="تصفية حسب الفئة" aria-label="تصفية حسب الفئة"><option value="all">كل الفئات (${fN(serverMode?WHINV.total:STATE.inventory.length)})</option>${catOpts}</select>
<select class="inp" data-karim-action="whInvFilterChange" data-karim-event="change" data-karim-args="[&quot;stock&quot;]" data-karim-pass="value" style="max-width:130px" aria-label="فلتر المخزون">
<option value="all" ${WHINV.stock==='all'?'selected':''}>كل الحالات</option>
<option value="low" ${WHINV.stock==='low'?'selected':''}>منخفض</option>
<option value="out" ${WHINV.stock==='out'?'selected':''}>نافذ</option>
<option value="ok" ${WHINV.stock==='ok'?'selected':''}>سليم</option>
</select>
<span id="whSelCount" class="u-t13 text-muted">المحدد: ${fN(window.whSelected.size)}</span>
${window.whSelected.size?`<button class="btn btn-sm" data-karim-action="whInvClearSel">مسح التحديد</button>`:''}
<button class="btn btn-blue btn-sm" data-karim-action="whPrintInventory"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-green btn-sm" data-karim-action="showAddPurchaseInvoiceModal"><i class=ji data-i=file-text></i> ${t('wh.invBill')}</button>
<button class="btn btn-blue btn-sm" data-karim-action="scanToAddInventoryItem"><i class=ji data-i=camera></i> ${t('wh.scan')}</button>
<button class="btn btn-gold btn-sm" data-karim-action="showAddItemModal"><i class=ji data-i=plus></i> ${t('wh.new')}</button>
<details class="wh-adv"><summary class="btn btn-sm">إجراءات متقدمة</summary><div class="u-row-wrap">
${STATE.settings?.opening_balance_visible !== false ? `<button class="btn btn-gold btn-sm" data-karim-action="showOpeningBalanceModal" title="إدخال سريع لأرصدة بداية الفترة دفعة واحدة"><i class=ji data-i=flag></i> رصيد افتتاحي</button>` : ''}
<button class="btn btn-blue btn-sm" data-karim-action="showImportItemsCatalogModal"><i class=ji data-i=inbox></i> ${t('wh.impCat')}</button>
<button class="btn btn-blue btn-sm" data-karim-action="showBulkInventoryImportModal"><i class=ji data-i=chart></i> ${t('wh.impStock')}</button>
<button class="btn btn-red btn-sm" data-karim-action="whBulkDelete"><i class=ji data-i=trash></i> حذف المحدد</button>
<button class="btn btn-purple btn-sm" data-karim-action="showInventoryAuditModal"><i class=ji data-i=clipboard-list></i> ${t('wh.audit')}</button><button class="btn btn-blue btn-sm" data-karim-action="showFiscalYearModal"><i class=ji data-i=calendar></i> ${t('wh.fyear')}</button>
${STATE.currentUser?.role==='admin'?`<button class="btn btn-blue btn-sm" data-karim-action="showSystemHealth" title="تشخيص شامل بضغطة: سلامة الأرصدة والدفاتر وإحصائيات المخزن"><i class=ji data-i=clipboard-list></i> فحص النظام</button><button class="btn btn-orange btn-sm" data-karim-action="showMergeDuplicatesModal" title="اكتشاف الأصناف المكررة بالاسم ودمجها في صنف واحد"><i class=ji data-i=git-merge></i> دمج أصناف مكررة</button>`:''}
</div></details>
</div>
</div>
<div class="tbl-scroll">
<table>
<thead><tr><th><input type="checkbox" data-karim-action="whSelPage" data-karim-event="change" data-karim-args="[(WHINV.results!==null?WHINV.results:whItems).map(i=>i.id)]" data-karim-pass="checked" title="تحديد الصفحة" aria-label="تحديد كل الصفحة"></th><th>${t('wh.item')}</th><th>${t('wh.cat')}</th><th>${t('wh.unit')}</th><th title="الرصيد الفعلي في المخزن الرئيسي — بعد خصم ما صُرف للأقسام">رصيد المخزن</th><th title="ما انتقل لمخازن الأقسام بأذون الصرف المستلمة">في الأقسام</th><th>${t('wh.w8')}</th><th>${t('wh.shelf')}</th><th>${t('wh.min')}</th><th>${t('wh.avg')}</th><th>${t('wh.val')}</th><th>${t('wh.status')}</th><th>${t('wh.actions')}</th></tr></thead>
<tbody id="whInvBody">
${whInvRowsHtml(whItems)}
</tbody>
</table>
</div>
<div id="whInvPager">${whInvPagerHtml(serverMode)}</div>
</section>
${whShortPanel()}`;
}

// ─── صفحة فواتير الشراء (مستقلة) ───
// الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — إفراغ التاريخ يعرض الكل
if(window.whInvFrom===undefined&&window.whInvTo===undefined){const _m=today().slice(0,8)+'01';window.whInvFrom=_m;window.whInvTo=today();}
function renderWhInvoices(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const allInvoices = (STATE.purchaseInvoices||[]).slice().reverse();
const invoices = allInvoices.filter(i=>{const d=String(i.date||'').slice(0,10);if(window.whInvFrom&&d<window.whInvFrom){return false;}if(window.whInvTo&&d>window.whInvTo){return false;}return true;});
const invTotal = invoices.reduce((s,i)=>s+Number(i.totalAmount||0),0);
const monthFiltered = window.whInvFrom||window.whInvTo;
return `
<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=file-text></i> فواتير الشراء — ${fN(invoices.length)} فاتورة بإجمالي ${fC(invTotal)}${monthFiltered?' <span class="badge bdg-blue">الشهر الحالي</span>':''}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="whInvListPrint"><i class=ji data-i=printer></i> طباعة الكشف</button><button class="btn btn-gold btn-sm" data-karim-action="showAddPurchaseInvoiceModal"><i class=ji data-i=plus></i> فاتورة جديدة</button><button class="btn btn-blue btn-sm" data-karim-action="go" data-karim-args="[&quot;procurement&quot;]"><i class=ji data-i=arrow-left></i> إدارة الفواتير والموردين</button>${STATE.currentUser?.role==='admin'&&invoices.length?`<button class="btn btn-red btn-sm" data-karim-action="showClearAllInvoicesModal"><i class=ji data-i=trash></i> حذف كل الفواتير</button>`:''}</div></div><div class="fr" style="align-items:end;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px"><div class="fg"><label>من</label><input type="date" value="${window.whInvFrom||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="whInvFrom:@value"></div><div class="fg"><label>إلى</label><input type="date" value="${window.whInvTo||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="whInvTo:@value"></div>${monthFiltered?`<button class="btn btn-sm" data-karim-action="renderPage" data-karim-set="whInvFrom:'',whInvTo:''"><i class=ji data-i=rotate-ccw></i> عرض الكل (قديم + جديد)</button>`:''}</div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>رقم الفاتورة</th><th>المورد</th><th>التاريخ</th><th>الإجمالي</th><th>الدفع</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>${invoices.map((inv,ii)=>{const pay={cash:'نقدي',bank:'بنكي',card:'بطاقة',cheque:'شيك',credit:'آجل'}[inv.paymentMethod]||esc(inv.paymentMethod||'—');const st={paid:['مدفوعة','bdg-green'],partial:['مسددة جزئياً','bdg-orange'],unpaid:['غير مسددة','bdg-red']}[inv.paymentStatus]||['غير محددة','bdg-gray'];return `<tr><td>${ii+1}</td><td class="fw-bold">${esc(inv.invoiceNumber||'—')}</td><td>${esc(inv.supplierName||'—')}</td><td class="text-muted">${fD(inv.date)}</td><td class="c-gold fw-bold">${fC(inv.totalAmount)}</td><td>${pay}</td><td><span class="badge ${st[1]}">${st[0]}</span></td><td style="white-space:nowrap;display:flex;gap:5px"><button class="btn btn-blue btn-sm" data-karim-action="viewPurchaseInvoice" data-karim-arg0="${esc(String(inv.id))}"><i class=ji data-i=eye></i> عرض</button><button class="btn btn-sm" data-karim-action="printPurchaseInvoice" data-karim-arg0="${esc(String(inv.id))}" title="طباعة الفاتورة"><i class=ji data-i=printer></i> طباعة</button></td></tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد فواتير في الفترة — أفرغ التاريخ لعرض الكل</td></tr>'}</tbody></table></div></div>`;
}

// ─── صفحة حركات المخزون (مستقلة) ───
// الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — إفراغ التاريخ يعرض الكل
if(window.txFrom===undefined&&window.txTo===undefined){const _m=today().slice(0,8)+'01';window.txFrom=_m;window.txTo=today();}
function whInvListPrint(){
const invoices=(STATE.purchaseInvoices||[]).slice().reverse().filter(i=>{const d=String(i.date||'').slice(0,10);if(window.whInvFrom&&d<window.whInvFrom){return false;}if(window.whInvTo&&d>window.whInvTo){return false;}return true;});
const body=invoices.map((i,n)=>`<tr><td>${invoices.length-n}</td><td>${esc(i.invoiceNumber||'—')}</td><td>${esc(i.supplierName||'—')}</td><td>${fC(i.totalAmount)}</td><td>${fD(i.date)}</td><td>${esc(i.status||'—')}</td></tr>`).join('');
ysPrintReport('كشف فواتير الشراء', `${window.whInvFrom||window.whInvTo?`من ${window.whInvFrom||'البداية'} إلى ${window.whInvTo||'اليوم'}`:'كل الفواتير'}`,
[['عدد الفواتير', fN(invoices.length)],['الإجمالي', fC(invoices.reduce((s,i)=>s+Number(i.totalAmount||0),0))]],
['#','رقم الفاتورة','المورد','الإجمالي','التاريخ','الحالة'], body);
}
function whTxListPrint(){
const txRows=(STATE.inventoryTx||[]).filter(t=>{const d=String(t.date||'').slice(0,10);if(window.txFrom&&d<window.txFrom){return false;}if(window.txTo&&d>window.txTo){return false;}return true;}).slice().reverse();
const tName={in:'وارد',out:'صادر',return:'مرتجع'};
const body=txRows.map((tx,n)=>`<tr><td>${txRows.length-n}</td><td>${fD(tx.date)}</td><td>${esc(tx.itemName)}</td><td>${tName[tx.type]||tx.type}</td><td>${fN(tx.qty)}</td><td>${tx.totalValue?fC(tx.totalValue):'—'}</td><td>${esc(tx.invoiceNumber||tx.dispatchId||tx.notes||'—')}</td></tr>`).join('');
ysPrintReport('كشف حركات المخزون', `${window.txFrom||window.txTo?`من ${window.txFrom||'البداية'} إلى ${window.txTo||'اليوم'}`:'كل الفترة'}`,
[['عدد الحركات', fN(txRows.length)]], ['#','التاريخ','الصنف','النوع','الكمية','القيمة','المرجع'], body);
}
function renderWhMoves(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const txRows=(STATE.inventoryTx||[]).filter(t=>{const d=String(t.date||'').slice(0,10);if(window.txFrom&&d<window.txFrom){return false;}if(window.txTo&&d>window.txTo){return false;}return true;}).slice().reverse();
const txShown=txRows.slice(0,300);
const monthFiltered=window.txFrom||window.txTo;
return `
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=chart></i> حركات المخزون ${monthFiltered?'<span class="badge bdg-blue">الشهر الحالي</span>':''}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="whTxListPrint"><i class=ji data-i=printer></i> طباعة الكشف</button><input type="text" class="inp" placeholder="بحث في الحركات..." data-karim-action="ysTableSearch" data-karim-event="input" data-karim-args="[&quot;whTxBody&quot;]" data-karim-pass="element" style="max-width:220px"></div></div>
<div class="fr" style="padding:8px 14px;gap:8px;flex-wrap:wrap"><div class="fg"><label>من</label><input type="date" value="${window.txFrom||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="txFrom:@value"></div><div class="fg"><label>إلى</label><input type="date" value="${window.txTo||''}" data-karim-action="renderPage" data-karim-event="change" data-karim-set="txTo:@value"></div>${monthFiltered?`<button class="btn btn-sm" data-karim-action="renderPage" data-karim-set="txFrom:'',txTo:''">عرض الكل (قديم + جديد)</button>`:''}<small class="text-muted">الأحدث أولًا (بحد أقصى 300 صف)</small></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>القيمة</th><th>المرجع</th></tr></thead>
<tbody id="whTxBody">
${txShown.map(tx=>`<tr>
<td>${fD(tx.date)}</td>
<td class="fw-bold">${esc(tx.itemName)}</td>
<td><span class="badge ${tx.type==='in'?'bdg-green':tx.type==='out'?'bdg-red':tx.type==='return'?'bdg-blue':'bdg-gold'}">${tx.type==='in'?'<i class=ji data-i=inbox></i> وارد':tx.type==='out'?'<i class=ji data-i=upload></i> صادر':tx.type==='return'?'<i class=ji data-i=undo></i> مرتجع':'<i class=ji data-i=flag></i> افتتاحي'}</span></td>
<td>${fN(tx.qty)}</td>
<td class="c-gold">${tx.cost?fC(tx.cost):'—'}</td>
<td class="c-gold">${tx.totalValue?fC(tx.totalValue):'—'}</td>
<td><small>${esc(tx.invoiceNumber||tx.dispatchId||tx.notes||'—')}</small></td>
</tr>`).join('')||'<tr><td colspan="7" class="u-empty">لا توجد حركات</td></tr>'}
</tbody>
</table>
</div>
</div>`;
}

// ─── صفحة مرتجعات المطبخ (مستقلة) ───
function renderWhReturns(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
return renderKitchenReturnsSection();
}

// ─── صفحة طلبات الشراء (مستقلة — بيتها المخزن: إنشاء مخزن ← توقيع شيف ← اعتماد مدير عام ← استلام مخزن)
function renderWhPrs(){
if(!prCanSee()) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
return renderPRSection();
}

function whGoSec(id){
    const el = document.getElementById(id);
    if (el && el.scrollIntoView) {el.scrollIntoView({ behavior: 'smooth', block: 'start' });}
    document.querySelectorAll('.wh-secnav button').forEach(b => {
        b.classList.toggle('btn-gold', b.dataset.sec === id);
    });
}
function getPaymentMethodLabel(method){return method==='cash'?'<i class=ji data-i=banknote></i> نقدي':method==='bank'?'<i class=ji data-i=landmark></i> بنكي':'<i class=ji data-i=credit-card></i> آجل';}
async function whBulkDelete(){
const ids=[...new Set([...document.querySelectorAll('.wh-sel:checked')].map(c=>String(c.value)), ...window.whSelected)];
if(!ids.length){toast('حدد صنفًا واحدًا على الأقل','error');return;}
if(!confirm(`حذف ${ids.length} صنفًا من المخزن؟\nالأصناف المرتبطة بحركات/وصفات لن تُحذف وستُذكر في النتيجة.`)){return;}
showLoad();
let ok=0; const blocked=[];
for(const id of ids){
try{ await persistRemove('inventory', id); ok++; window.whSelected.delete(String(id)); }
catch(_){ const it=(STATE.inventory||[]).find(x=>String(x.id)===String(id)); blocked.push({id, name:it?it.name:id}); }
}
if(blocked.length && STATE.currentUser?.role==='admin' && confirm(`${blocked.length} صنفًا لها حركات ولم تُحذف.\nهل تريد الحذف النهائي لها مع كل حركاتها وسجلاتها؟ (لا يمكن التراجع)`)){
for(const b of blocked){
try{ await apiFetch(`/warehouse/inventory/${encodeURIComponent(b.id)}/force`,{method:'DELETE'}); ok++; b.forced=true; }
catch(_){ b.error=true; }
}
const stillBlocked=blocked.filter(b=>!b.forced);
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
if(WHINV.results!==null){whInvFetch();}
toast(stillBlocked.length?`حُذف ${ok} — تعذّر ${stillBlocked.length}: ${stillBlocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا (منها حذف نهائي)`, stillBlocked.length?'error':'success');
return;
}
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
if(WHINV.results!==null){whInvFetch();}
toast(blocked.length?`حُذف ${ok} — تعذّر ${blocked.length} (مرتبطة بحركات): ${blocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا`, blocked.length?'error':'success');
}
function whPrintInventory(){
const rows = (STATE.inventory||[]).map((item,i)=>{
return `<tr><td>${i+1}</td><td>${esc(item.name)}${item.barcode?` — ${esc(item.barcode)}`:''}</td><td>${esc(item.category||'—')}</td><td>${fN(item.qty)}</td><td>${esc(item.unit||'')}</td><td>${fC(item.avgCost)}</td><td>${fC(item.qty*item.avgCost)}</td><td>${Number(item.qty)<Number(item.minQty)?'منخفض':'سليم'}</td></tr>`;}).join('');
const totalValue = STATE.inventory.reduce((s,x)=>s+(x.qty*x.avgCost),0);
const low = STATE.inventory.filter(x=>Number(x.qty)<Number(x.minQty)).length;
ysPrintReport('كشف أصناف المخزون', `${fN(STATE.inventory.length)} صنفًا`,
[['الأصناف', fN(STATE.inventory.length)],['إجمالي القيمة', fC(totalValue)],['منخفض المخزون', fN(low)]],
['#','الصنف','الفئة','الكمية','الوحدة','متوسط التكلفة','القيمة','الحالة'], rows);
}

// ═══ مركز المشتريات والموردين — دليل موردون، أرصدة مستحقة، دفعات، كشوف حساب ═══
const PCMT = { tab:'invoices', invFilter:'all', suppSearch:'', suppTax:'ALL', suppPage:1, suppLimit:20, suppTotal:0, suppResults:null, suppLoading:false, suppError:'', paySupplier:'', stmt:null, stmtSupplier:null, stmtFrom:'', stmtTo:'' };
const PCMT_CAN_WRITE = ['admin','manager','warehouse'];
const PCMT_CAN_PAY = ['admin','manager','accountant'];
const PCMT_PAY_LABELS = { cash:'نقدي', bank:'تحويل بنكي', card:'بطاقة', cheque:'شيك', credit:'آجل' };
function pcmtStatusBadge(st){
    const map = { paid:['bdg-green','مدفوعة'], partial:['bdg-gold','مسددة جزئياً'], unpaid:['bdg-red','غير مسددة'] };
    const [cls,label] = map[st]||['bdg-red',st||'غير مسددة'];
    return `<span class="badge ${cls}">${label}</span>`;
}
function pcmtInvoiceSupplier(inv){
    if(inv.supplierId){ const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(inv.supplierId)); if(s) {return s.name;} }
    return inv.supplierName||'—';
}
function pcmtInvoiceRemaining(inv){ return Math.max(0, Number(inv.totalAmount||0) - Number(inv.paidAmount||0)); }
async function refreshProcurementData(){
    try{
        const [suppliers, payments] = await Promise.all([
            apiFetch('/procurement/suppliers'),
            apiFetch('/procurement/payments')
        ]);
        STATE.suppliers = Array.isArray(suppliers)?suppliers:[];
        STATE.supplierPayments = Array.isArray(payments)?payments:[];
    }catch(e){ console.warn('[procurement] refresh failed:', e.message); }
    if(STATE.page==='procurement') {renderPage();}
}
window.refreshProcurementData = refreshProcurementData;
function renderProcurement(){
    const suppliers = STATE.suppliers||[];
    const active = suppliers.filter(s=>s.is_active);
    const invoices = (STATE.purchaseInvoices||[]).filter(i=>i.supplierId);
    const purchasesTotal = invoices.reduce((a,i)=>a+Number(i.totalAmount||0),0);
    const paymentsTotal = (STATE.supplierPayments||[]).reduce((a,p)=>a+Number(p.amount||0),0);
    const openingTotal = suppliers.reduce((a,s)=>a+Number(s.openingBalance||0),0);
    const dueTotal = openingTotal + purchasesTotal - paymentsTotal;
    const unpaid = invoices.filter(i=>pcmtInvoiceRemaining(i)>0);
    const tabs = [['invoices',t('prc.invoices'),'file-text'],['suppliers',t('prc.suppliers'),'users'],['payments',t('prc.payments'),'banknote']];
    let body;
    if(PCMT.tab==='invoices') {body=pcmtInvoicesTab(invoices, unpaid);}
    else if(PCMT.tab==='suppliers') {body=pcmtSuppliersTab(suppliers);}
    else {body=pcmtPaymentsTab();}
    return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=shopping-cart></i> إجمالي المشتريات (مرتبطة بموردين)</div><div class="mcard-val c-gold">${fC(purchasesTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الدفعات</div><div class="mcard-val c-green">${fC(paymentsTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> الرصيد المستحق للموردين</div><div class="mcard-val ${dueTotal>0?'c-red':'c-green'}">${fC(dueTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> موردون نشطون</div><div class="mcard-val c-blue">${fN(active.length)} / ${fN(suppliers.length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=file-text></i> فواتير غير مسددة</div><div class="mcard-val ${unpaid.length?'c-red':'c-green'}">${fN(unpaid.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=coins></i> متبقٍ على الفواتير</div><div class="mcard-val c-red">${fC(unpaid.reduce((a,i)=>a+pcmtInvoiceRemaining(i),0))}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=landmark></i> أرصدة افتتاحية</div><div class="mcard-val c-teal">${fC(openingTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> مصدر الحقيقة</div><div class="mcard-val u-t13">الرصيد = افتتاحي + فواتير − دفعات</div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd" style="gap:10px;flex-wrap:wrap">
${tabs.map(([k,label,icon])=>`<button class="btn btn-sm ${PCMT.tab===k?'btn-gold':''}" onclick="PCMT.tab='${k}';renderPage()"><i class=ji data-i=${icon}></i> ${label}</button>`).join('')}
<div class="fr"></div>
${PCMT.tab==='invoices'?`<select class="u-input" style="max-width:180px" onchange="PCMT.invFilter=this.value;renderPage()">
<option value="all" ${PCMT.invFilter==='all'?'selected':''}>كل الفواتير</option>
<option value="unpaid" ${PCMT.invFilter==='unpaid'?'selected':''}>غير مسددة</option>
<option value="partial" ${PCMT.invFilter==='partial'?'selected':''}>مسددة جزئياً</option>
<option value="paid" ${PCMT.invFilter==='paid'?'selected':''}>مدفوعة</option>
</select>`:''}
${PCMT.tab==='suppliers'?`<input class="u-input" style="max-width:240px" placeholder="ابحث بالاسم أو الرقم الضريبي أو السجل التجاري" aria-label="بحث الموردين" value="${esc(PCMT.suppSearch)}" data-karim-action="pcmtSuppSearchInput" data-karim-event="input" data-karim-pass="value">
<select class="u-input" style="max-width:150px" aria-label="فلتر الحالة الضريبية" data-karim-action="pcmtSuppTaxChange" data-karim-event="change" data-karim-pass="value">
<option value="ALL" ${PCMT.suppTax==='ALL'?'selected':''}>الكل</option>
<option value="REGISTERED" ${PCMT.suppTax==='REGISTERED'?'selected':''}>مسجل ضريبيًا</option>
<option value="NOT_REGISTERED" ${PCMT.suppTax==='NOT_REGISTERED'?'selected':''}>غير مسجل</option>
<option value="EXEMPT" ${PCMT.suppTax==='EXEMPT'?'selected':''}>معفى</option>
</select>`:''}
${PCMT.tab==='suppliers'&&PCMT_CAN_WRITE.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" data-karim-action="showSupplierModal"><i class=ji data-i=plus></i> مورد جديد</button>`:''}
${PCMT.tab==='payments'&&PCMT_CAN_PAY.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" data-karim-action="showPaymentModal"><i class=ji data-i=plus></i> تسجيل دفعة</button>`:''}
</div>
${body}
</div>`;
}
function pcmtRerenderSuppliers(){
    const wrap=document.querySelector('.tbl-wrap'); if(!wrap) {return;}
    const old=wrap.innerHTML; wrap.innerHTML=pcmtSuppliersTab(STATE.suppliers||[]);
    void old;
}
// ─── Smart supplier search (server-side, debounced, stale-guarded) ─────────
// apiFetch owns its AbortController (30s) → here we debounce 300ms and ignore
// stale responses via requestId (never full page reload; page keeps term+filter).
let PCMT_SUPP_REQ = 0; let PCMT_SUPP_TIMER = null;
function pcmtSuppSearchInput(val){
    PCMT.suppSearch = String(val ?? '');
    PCMT.suppPage = 1;
    if (PCMT_SUPP_TIMER) {clearTimeout(PCMT_SUPP_TIMER);}
    PCMT_SUPP_TIMER = setTimeout(() => {pcmtFetchSuppliers();}, 300);
}
function pcmtSuppTaxChange(val){
    PCMT.suppTax = ['REGISTERED','NOT_REGISTERED','EXEMPT'].includes(val) ? val : 'ALL';
    PCMT.suppPage = 1; // taxStatus change → reset page
    pcmtFetchSuppliers();
}
function pcmtSuppPage(delta){
    const pages = Math.max(1, Math.ceil((PCMT.suppTotal || 0) / (PCMT.suppLimit || 20)));
    const next = Math.min(pages, Math.max(1, (PCMT.suppPage || 1) + delta));
    if (next === PCMT.suppPage) {return;}
    PCMT.suppPage = next; // page change → keep searchTerm + taxStatus
    pcmtFetchSuppliers();
}
async function pcmtFetchSuppliers(){
    const myId = ++PCMT_SUPP_REQ;
    PCMT.suppLoading = true; PCMT.suppError = '';
    if (STATE.page === 'procurement' && PCMT.tab === 'suppliers') {renderPage();}
    const params = new URLSearchParams({
        q: PCMT.suppSearch || '', tax_status: PCMT.suppTax || 'ALL',
        page: String(PCMT.suppPage || 1), limit: String(PCMT.suppLimit || 20),
    });
    try{
        const res = await apiFetch('/procurement/suppliers/search?' + params.toString());
        if (myId !== PCMT_SUPP_REQ) {return;} // stale response — ignore
        PCMT.suppResults = Array.isArray(res.data) ? res.data : [];
        PCMT.suppTotal = Number(res.pagination?.total || 0);
        PCMT.suppPage = Number(res.pagination?.page || 1);
        PCMT.suppLoading = false;
    }catch(e){
        if (myId !== PCMT_SUPP_REQ) {return;}
        PCMT.suppLoading = false;
        PCMT.suppError = e.message || 'تعذر البحث';
        PCMT.suppResults = [];
        PCMT.suppTotal = 0;
    }
    if (STATE.page === 'procurement' && PCMT.tab === 'suppliers') {renderPage();}
}
const PCMT_TAX_AR = { REGISTERED:'مسجل ضريبيًا', NOT_REGISTERED:'غير مسجل', EXEMPT:'معفى' };
function pcmtTaxBadge(st){
    const v = String(st || 'NOT_REGISTERED').toUpperCase();
    const cls = v === 'REGISTERED' ? 'bdg-green' : (v === 'EXEMPT' ? 'bdg-blue' : 'bdg-red');
    return `<span class="badge ${cls}">${PCMT_TAX_AR[v] || v}</span>`;
}
function pcmtInvoicesTab(allInvoices, _unpaid){
    let invoices = allInvoices.slice().reverse();
    if(PCMT.invFilter!=='all') {invoices = invoices.filter(i=>(i.paymentStatus||'unpaid')===PCMT.invFilter);}
    return `
<div class="tbl-scroll">
<table>
<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>حالة السداد</th><th>إجراءات</th></tr></thead>
<tbody>
${invoices.map(inv=>{
const rem=pcmtInvoiceRemaining(inv);
const canPay=rem>0&&PCMT_CAN_PAY.includes(STATE.currentUser?.role);
return `<tr>
<td class="fw-bold">${esc(inv.invoiceNumber)}</td>
<td>${fD(inv.date)}</td>
<td class="c-gold">${esc(pcmtInvoiceSupplier(inv))}</td>
<td class="c-gold fw-bold">${fC(inv.totalAmount)}</td>
<td class="c-green">${fC(inv.paidAmount||0)}</td>
<td class="${rem>0?'c-red':'c-green'} fw-bold">${fC(rem)}</td>
<td>${pcmtStatusBadge(inv.paymentStatus)}</td>
<td style="display:flex;gap:4px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" data-karim-action="viewPurchaseInvoice" data-karim-arg0="${esc(String(inv.id))}"><i class=ji data-i=eye></i> عرض</button>
${canPay?`<button class="btn btn-green btn-sm" data-karim-action="payInvoiceFull" data-karim-arg0="${esc(String(inv.id))}"><i class=ji data-i=coins></i> تسديد</button>`:''}
<button class="btn btn-sm" data-karim-action="printPurchaseInvoice" data-karim-arg0="${esc(String(inv.id))}"><i class=ji data-i=printer></i> طباعة</button>
</td>
</tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد فواتير مطابقة — أنشئ فاتورة شراء مرتبطة بمورد من صفحة المخزن</td></tr>'}
</tbody>
</table>
</div>`;
}
function pcmtSuppliersTab(suppliers){
    // Server mode (smart search active) → merge directory financials by id.
    // Client mode (legacy fallback) → filter the preloaded directory.
    const serverMode = PCMT.suppResults !== null;
    const byId = new Map((suppliers || []).map(s => [String(s.id), s]));
    let rows;
    if (serverMode) {
        rows = (PCMT.suppResults || []).map(r => Object.assign({}, byId.get(String(r.id)) || {}, r));
    } else {
        const q = String(PCMT.suppSearch || '').trim().toLowerCase();
        rows = (suppliers || []).filter(s => !q || String(s.name || '').toLowerCase().includes(q) || (window.arSearchIncludes?window.arSearchIncludes(s.name, q):false));
    }
    const pages = Math.max(1, Math.ceil((serverMode ? PCMT.suppTotal : rows.length) / (PCMT.suppLimit || 20)));
    const bodyHtml = PCMT.suppLoading
        ? '<tr><td colspan="11" class="u-empty" aria-live="polite">جارٍ البحث...</td></tr>'
        : PCMT.suppError
            ? `<tr><td colspan="11" class="u-empty">تعذر البحث: ${esc(PCMT.suppError)} <button class="btn btn-sm" data-karim-action="pcmtFetchSuppliers">إعادة المحاولة</button></td></tr>`
            : (rows.map(s=>{
const canW=PCMT_CAN_WRITE.includes(STATE.currentUser?.role);
const canP=PCMT_CAN_PAY.includes(STATE.currentUser?.role);
return `<tr ${s.is_active?'':'style="opacity:.55"'}>
<td class="fw-bold">${esc(s.name)}</td>
<td dir="ltr">${esc(s.vat_number||'—')}</td>
<td>${pcmtTaxBadge(s.tax_status||s.tax_registration_status)}</td>
<td>${esc(s.phone||'—')}</td>
<td>${esc(s.category||'—')}</td>
<td>${fN(s.invoiceCount||0)}</td>
<td class="c-gold">${fC(s.purchasesTotal||0)}</td>
<td class="c-green">${fC(s.paymentsTotal||0)}</td>
<td class="${Number(s.dueTotal)>0?'c-red fw-bold':'c-green'}">${fC(s.dueTotal||0)}</td>
<td><span class="badge ${s.is_active?'bdg-green':'bdg-red'}">${s.is_active?'نشط':'موقوف'}</span></td>
<td style="display:flex;gap:4px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" data-karim-action="openStatement" data-karim-arg0="${esc(String(s.id))}"><i class=ji data-i=file-text></i> كشف حساب</button>
${canP&&s.is_active?`<button class="btn btn-green btn-sm" data-karim-action="showPaymentModal" data-karim-arg0="${esc(String(s.id))}"><i class=ji data-i=coins></i> دفعة</button>`:''}
${canW?`<button class="btn btn-sm" data-karim-action="showSupplierModal" data-karim-arg0="${esc(String(s.id))}"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-purple btn-sm" data-karim-action="toggleSupplier" data-karim-arg0="${esc(String(s.id))}"><i class=ji data-i=${s.is_active?'lock':'unlock'}></i> ${s.is_active?'إيقاف':'تفعيل'}</button>
<button class="btn btn-red btn-sm" data-karim-action="deleteSupplier" data-karim-arg0="${esc(String(s.id))}"><i class=ji data-i=trash></i> حذف</button>`:''}
</td>
</tr>`;}).join('')||'<tr><td colspan="11" class="u-empty">لا يوجد موردون مطابقون — جرّب بحثًا مختلفًا أو أضف موردًا جديدًا</td></tr>');
    return `
<div class="tbl-scroll">
<table>
<thead><tr><th>المورد</th><th>الرقم الضريبي</th><th>الحالة الضريبية</th><th>الهاتف</th><th>نوع التوريد</th><th>عدد الفواتير</th><th>إجمالي المشتريات</th><th>إجمالي الدفعات</th><th>الرصيد المستحق</th><th>الحالة</th><th>إجراءات</th></tr></thead>
<tbody>
${bodyHtml}
</tbody>
</table>
</div>
${serverMode?`<div class="fr" style="margin-top:8px;align-items:center" aria-live="polite">
<span class="u-t13 text-muted">النتائج: ${fN(PCMT.suppTotal||0)} — صفحة ${fN(PCMT.suppPage||1)} من ${fN(pages)}</span>
<div class="fr"></div>
<button class="btn btn-sm" ${PCMT.suppPage<=1?'disabled':''} data-karim-action="pcmtSuppPage" data-karim-args="[-1]">السابق</button>
<button class="btn btn-sm" ${PCMT.suppPage>=pages?'disabled':''} data-karim-action="pcmtSuppPage" data-karim-args="[1]">التالي</button>
</div>`:''}`;
}
function pcmtPaymentsTab(){
    let payments=STATE.supplierPayments||[];
    if(PCMT.paySupplier) {payments=payments.filter(p=>String(p.supplierId)===String(PCMT.paySupplier));}
    const canDel=STATE.currentUser?.role==='admin';
    return `
<div class="fr" style="margin-bottom:10px"><select class="u-input" style="max-width:240px" onchange="PCMT.paySupplier=this.value;renderPage()">
<option value="">كل الموردين</option>
${(STATE.suppliers||[]).map(s=>`<option value="${esc(String(s.id))}" ${String(PCMT.paySupplier)===String(s.id)?'selected':''}>${esc(s.name)}</option>`).join('')}
</select></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>المورد</th><th>المبلغ</th><th>الطريقة</th><th>الفاتورة المرتبطة</th><th>ملاحظات</th><th>سجّلها</th>${canDel?'<th>إجراءات</th>':''}</tr></thead>
<tbody>
${payments.map(p=>{
const inv=p.invoiceId?(STATE.purchaseInvoices||[]).find(i=>String(i.id)===String(p.invoiceId)):null;
return `<tr>
<td>${fD(p.date)}</td>
<td class="c-gold fw-bold">${esc(p.supplierName||'—')}</td>
<td class="c-green fw-bold">${fC(p.amount)}</td>
<td><span class="badge bdg-blue">${PCMT_PAY_LABELS[p.method]||p.method}</span></td>
<td>${inv?esc(inv.invoiceNumber||('#'+inv.id)):'—'}</td>
<td>${esc(p.notes||'—')}</td>
<td class="u-t12">${esc(p.createdBy||'—')}</td>
${canDel?`<td><button class="btn btn-red btn-sm" data-karim-action="deletePayment" data-karim-arg0="${esc(String(p.id))}"><i class=ji data-i=trash></i> عكس</button></td>`:''}
</tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد دفعات مسجلة</td></tr>'}
</tbody>
</table>
</div>`;
}
function showSupplierModal(id){
    const s=id?(STATE.suppliers||[]).find(x=>String(x.id)===String(id)):null;
    const st = String(s?.tax_status || s?.tax_registration_status || 'NOT_REGISTERED').toUpperCase();
    showModal(`
<h3><i class=ji data-i=users></i> ${s?'تعديل مورد':'مورد جديد'}</h3>
<div class="fr"><div class="fg"><label class="req">اسم المورد *</label><input type="text" id="suppName" value="${esc(s?.name||'')}" placeholder="مثال: شركة نجم خير الشرق"></div>
<div class="fg"><label>الاسم الإنجليزي (اختياري)</label><input type="text" id="suppNameEn" dir="ltr" value="${esc(s?.name_en||s?.nameEn||'')}" placeholder="Optional English name"></div></div>
<div class="fr"><div class="fg"><label>رقم الهاتف</label><input type="text" id="suppPhone" dir="ltr" value="${esc(s?.phone||'')}" placeholder="0551234567"></div>
<div class="fg"><label>البريد الإلكتروني</label><input type="email" id="suppEmail" dir="ltr" value="${esc(s?.email||'')}"></div></div>
<div class="fg"><label>الحالة الضريبية *</label>
<div class="fr" role="radiogroup" aria-label="الحالة الضريبية">
<label><input type="radio" name="suppTaxStatus" value="REGISTERED" ${st==='REGISTERED'?'checked':''} data-karim-action="pcmtTaxStatusChanged" data-karim-event="change"> مسجل في ضريبة القيمة المضافة</label>
<label><input type="radio" name="suppTaxStatus" value="NOT_REGISTERED" ${st==='NOT_REGISTERED'?'checked':''} data-karim-action="pcmtTaxStatusChanged" data-karim-event="change"> غير مسجل</label>
<label><input type="radio" name="suppTaxStatus" value="EXEMPT" ${st==='EXEMPT'?'checked':''} data-karim-action="pcmtTaxStatusChanged" data-karim-event="change"> معفى</label>
</div></div>
<div class="fr"><div class="fg"><label id="suppVatLabel">الرقم الضريبي (15 رقمًا)</label><input type="text" id="suppVat" dir="ltr" inputmode="numeric" maxlength="15" value="${esc(s?.vat_number||s?.vatNumber||'')}" placeholder="302212427200003" aria-describedby="suppVatHint">
<small id="suppVatHint" class="text-muted" aria-live="polite"></small></div>
<div class="fg"><label>السجل التجاري</label><input type="text" id="suppCr" dir="ltr" maxlength="20" value="${esc(s?.cr||s?.commercial_register||s?.commercialRegister||'')}" placeholder="754"><small class="text-muted">أرقام وحروف إنجليزية فقط</small></div></div>
<div class="fr"><div class="fg"><label>نوع التوريد</label><input type="text" id="suppCategory" value="${esc(s?.category||'')}" placeholder="لحوم / خضار / مشروبات..."></div>
<div class="fg"><label>الرصيد الافتتاحي المستحق</label><input type="number" id="suppOpening" value="${s?Number(s.openingBalance||0):0}" step="0.01" min="0"><small class="text-muted">ما عليه له قبل استخدام النظام</small></div></div>
<div class="fg"><label>العنوان</label><input type="text" id="suppAddress" value="${esc(s?.address||'')}"></div>
<div class="fg"><label>ملاحظات</label><textarea id="suppNotes" rows="2">${esc(s?.notes||'')}</textarea></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="saveSupplier" data-karim-arg0="${s?`'${esc(String(s.id))}'`:'null'}"><i class=ji data-i=save></i> حفظ</button></div>
`);
    pcmtTaxStatusChanged();
}
// Dynamic validation (UX only — backend is authoritative)
function pcmtClearFieldErrors(){
    document.querySelectorAll('.fg.invalid').forEach(x=>{x.classList.remove('invalid');x.querySelector('.field-err')?.remove();});
}
function pcmtFieldError(id, msg){
    pcmtClearFieldErrors();
    const el=document.getElementById(id);
    const fg=el?.closest('.fg');
    if(!fg) {toast(msg,'error');return false;}
    fg.classList.add('invalid');
    const s=document.createElement('small');
    s.className='field-err'; s.setAttribute('role','alert'); s.textContent=msg;
    fg.appendChild(s);
    el.focus();
    return false;
}
function pcmtTaxStatusChanged(){
    const checked = document.querySelector('input[name="suppTaxStatus"]:checked');
    const st = checked ? checked.value : 'NOT_REGISTERED';
    const vat = document.getElementById('suppVat');
    const hint = document.getElementById('suppVatHint');
    const vatLabel = document.getElementById('suppVatLabel');
    if (!vat) {return;}
    pcmtClearFieldErrors();
    if (st === 'REGISTERED') {
        vat.disabled = false;
        vat.placeholder = '١٥ رقم (مثال: 302212427200003)';
        if (hint) {hint.textContent = 'مطلوب: 15 رقمًا بالضبط';}
        if (vatLabel) {vatLabel.classList.add('req');}
    } else if (st === 'NOT_REGISTERED') {
        vat.disabled = true; vat.value = '';
        if (hint) {hint.textContent = 'لا ينطبق — المورد غير مسجل';}
        if (vatLabel) {vatLabel.classList.remove('req');}
    } else {
        vat.disabled = false;
        if (hint) {hint.textContent = 'اختياري للمعفى — 15 رقمًا إن وُجد';}
        if (vatLabel) {vatLabel.classList.remove('req');}
    }
}
function pcmtReadTaxStatus(){
    const checked = document.querySelector('input[name="suppTaxStatus"]:checked');
    return checked ? checked.value : 'NOT_REGISTERED';
}
async function saveSupplier(id){
    pcmtClearFieldErrors();
    const status = pcmtReadTaxStatus();
    const vatRaw = String(document.getElementById('suppVat')?.value ?? '').replace(/\D/g, '');
    if (status === 'REGISTERED' && !/^[0-9]{15}$/.test(vatRaw)) {
        return pcmtFieldError('suppVat', 'الرقم الضريبي يجب أن يكون 15 رقمًا');
    }
    const crRaw = String(document.getElementById('suppCr')?.value ?? '').trim();
    if (crRaw && !/^[0-9A-Za-z-]{1,20}$/.test(crRaw)) {
        return pcmtFieldError('suppCr', 'السجل التجاري: أرقام وحروف إنجليزية فقط (حتى 20 خانة) — مثال: 754');
    }
    const emailRaw = String(document.getElementById('suppEmail')?.value ?? '').trim();
    if (emailRaw && !/^\S+@\S+\.\S+$/.test(emailRaw)) {
        return pcmtFieldError('suppEmail', 'البريد الإلكتروني غير صحيح');
    }
    const phoneRaw = String(document.getElementById('suppPhone')?.value ?? '').trim();
    if (phoneRaw && !/^[0-9+\-\s()]{1,30}$/.test(phoneRaw)) {
        return pcmtFieldError('suppPhone', 'رقم الهاتف: أرقام فقط (مسموح + ومسافة وشرطة) — مثال: 0551234567');
    }
    const nameRaw = String(document.getElementById('suppName')?.value ?? '').trim();
    if(!nameRaw||nameRaw.length<2){ return pcmtFieldError('suppName', 'اسم المورد مطلوب (حرفان على الأقل)'); }
    const payload={ name:nameRaw, name_en:document.getElementById('suppNameEn')?.value.trim(),
        phone:phoneRaw, email:emailRaw,
        tax_registration_status:status, vat_number:status==='NOT_REGISTERED' ? null : (vatRaw || null),
        commercial_register:crRaw || null,
        category:document.getElementById('suppCategory')?.value.trim(), address:document.getElementById('suppAddress')?.value.trim(),
        notes:document.getElementById('suppNotes')?.value.trim(), openingBalance:document.getElementById('suppOpening')?.value };
    try{
        if(id){ const row=await apiFetch('/procurement/suppliers/'+id,{method:'PUT',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تم تحديث بيانات المورد','success'); }
        else{ const row=await apiFetch('/procurement/suppliers',{method:'POST',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تمت إضافة المورد','success'); }
        PCMT.suppResults = null; // reset smart search → fresh directory
        closeModal(); renderPage();
    }catch(e){ toast(e.message||'تعذر حفظ المورد','error'); }
}
async function toggleSupplier(id){
    try{ const row=await apiFetch('/procurement/suppliers/'+id+'/toggle',{method:'POST'}); upsertStateEntity('suppliers',row); toast(row.is_active?'تم تفعيل المورد':'تم إيقاف المورد','info'); renderPage(); }
    catch(e){ toast(e.message||'تعذر تغيير الحالة','error'); }
}
async function deleteSupplier(id){
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(id));
    if(!confirm(`حذف المورد «${s?.name||''}» نهائيًا؟ لا يمكن الحذف إذا له فواتير أو دفعات (استخدم الإيقاف بدلًا منها).`)) {return;}
    try{
        await apiFetch('/procurement/suppliers/'+id,{method:'DELETE'});
        STATE.suppliers=(STATE.suppliers||[]).filter(x=>String(x.id)!==String(id));
        toast('تم حذف المورد','success'); renderPage();
    }catch(e){ toast(e.message||'تعذر حذف المورد — جرّب إيقافه','error'); }
}
function showPaymentModal(supplierId){
    const suppliers=(STATE.suppliers||[]).filter(s=>s.is_active);
    if(!suppliers.length){ toast('أضف مورداً واحداً على الأقل أولاً','warning'); return; }
    const selected=supplierId||String(suppliers[0].id);
    showModal(`
<h3><i class=ji data-i=coins></i> تسجيل دفعة لمورد</h3>
<div class="fr"><div class="fg"><label>المورد *</label><select id="paySupplier" data-karim-action="pcmtOnSupplierChange" data-karim-event="change">${suppliers.map(s=>`<option value="${esc(String(s.id))}" ${String(selected)===String(s.id)?'selected':''}>${esc(s.name)} — مستحق ${fN(s.dueTotal)}</option>`).join('')}</select></div>
<div class="fg"><label>المبلغ *</label><input type="number" id="payAmount" step="0.01" min="0.01" placeholder="0.00"></div></div>
<div class="fr"><div class="fg"><label>طريقة الدفع</label><select id="payMethod"><option value="cash">نقدي</option><option value="bank">تحويل بنكي</option><option value="card">بطاقة</option><option value="cheque">شيك</option></select></div>
<div class="fg"><label>التاريخ</label><input type="date" id="payDate" value="${today()}"></div></div>
<div class="fg"><label>ربط بفاتورة (اختياري)</label><select id="payInvoice"><option value="">دفعة على الحساب العام</option>${pcmtUnpaidOptions(selected)}</select>
<small class="text-muted">عند الربط يجب ألا يتجاوز المبلغ المتبقي على الفاتورة</small></div>
<div class="fg"><label>ملاحظات</label><input type="text" id="payNotes" placeholder="مثال: دفعة أولى"></div>
<div id="payHint" class="u-t13 text-muted"></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="savePayment"><i class=ji data-i=save></i> حفظ الدفعة</button></div>
`);
    pcmtOnSupplierChange();
}
function pcmtUnpaidOptions(supplierId){
    return (STATE.purchaseInvoices||[])
        .filter(i=>String(i.supplierId)===String(supplierId)&&pcmtInvoiceRemaining(i)>0)
        .map(i=>`<option value="${esc(String(i.id))}">${esc(i.invoiceNumber)} — متبقٍ ${fN(pcmtInvoiceRemaining(i))}</option>`).join('');
}
function pcmtOnSupplierChange(){
    const sel=document.getElementById('paySupplier'); if(!sel) {return;}
    const invSel=document.getElementById('payInvoice'); if(!invSel) {return;}
    const cur=invSel.value;
    invSel.innerHTML='<option value="">دفعة على الحساب العام</option>'+pcmtUnpaidOptions(sel.value);
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(sel.value));
    const hint=document.getElementById('payHint');
    if(hint) {hint.innerHTML=s?`الرصيد المستحق حالياً لـ «${esc(s.name)}»: <strong class="${Number(s.dueTotal)>0?'c-red':'c-green'}">${fC(s.dueTotal)}</strong> (افتتاحي ${fN(s.openingBalance)} + فواتير ${fN(s.purchasesTotal)} − دفعات ${fN(s.paymentsTotal)})`:'';}
    if(cur) {invSel.value=cur;}
}
async function savePayment(){
    const payload={ supplierId:document.getElementById('paySupplier')?.value, amount:document.getElementById('payAmount')?.value,
        method:document.getElementById('payMethod')?.value||'cash', date:document.getElementById('payDate')?.value,
        invoiceId:document.getElementById('payInvoice')?.value||null, notes:document.getElementById('payNotes')?.value.trim() };
    if(!payload.supplierId){ toast('اختر المورد','error'); return; }
    if(!Number(payload.amount)||Number(payload.amount)<=0){ toast('أدخل مبلغاً أكبر من صفر','error'); return; }
    try{
        const result=await apiFetch('/procurement/payments',{method:'POST',body:JSON.stringify(payload)});
        upsertStateEntity('supplierPayments',result.payment);
        if(result.invoice) {upsertStateEntity('purchaseInvoices',result.invoice);}
        closeModal();
        toast(`تم تسجيل دفعة بقيمة ${fC(result.payment.amount)} — الرصيد المستحق الآن ${fC(result.supplierDueTotal||0)}`,'success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر تسجيل الدفعة','error'); }
}
async function payInvoiceFull(id){
    const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
    if(!inv) {return;}
    const rem=pcmtInvoiceRemaining(inv);
    if(rem<=0){ toast('الفاتورة مسددة بالكامل','info'); return; }
    if(!confirm(`تسديد كامل المتبقي على الفاتورة ${inv.invoiceNumber||''}: ${fN(rem)} ${STATE.settings.currency}؟`)) {return;}
    try{
        const result=await apiFetch('/procurement/invoices/'+id+'/pay',{method:'POST',body:JSON.stringify({method:'cash'})});
        upsertStateEntity('supplierPayments',result.payment);
        upsertStateEntity('purchaseInvoices',result.invoice);
        toast(`تم تسديد الفاتورة بالكامل (${fC(rem)})`,'success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر التسديد','error'); }
}
async function deletePayment(id){
    const p=(STATE.supplierPayments||[]).find(x=>String(x.id)===String(id));
    if(!p) {return;}
    if(!confirm(`عكس الدفعة بقيمة ${fN(p.amount)} ${STATE.settings.currency}؟ سيُعاد المبلغ إلى رصيد المورد المستحق${p.invoiceId?' وتُعاد حالة الفاتورة المرتبطة':''}.`)) {return;}
    try{
        const result=await apiFetch('/procurement/payments/'+id,{method:'DELETE'});
        STATE.supplierPayments=(STATE.supplierPayments||[]).filter(x=>String(x.id)!==String(id));
        if(result.invoice) {upsertStateEntity('purchaseInvoices',result.invoice);}
        toast('تم عكس الدفعة','success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر عكس الدفعة','error'); }
}
async function openStatement(id){
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(id));
    if(!s) {return;}
    PCMT.stmtSupplier=s; PCMT.stmtFrom=''; PCMT.stmtTo=''; PCMT.stmt=null;
    showModal(`
<h3><i class=ji data-i=file-text></i> كشف حساب — ${esc(s.name)}</h3>
<div class="fr"><div class="fg"><label>من تاريخ</label><input type="date" id="stmtFrom" value="${PCMT.stmtFrom}"></div>
<div class="fg"><label>إلى تاريخ</label><input type="date" id="stmtTo" value="${PCMT.stmtTo}"></div>
<div class="fg"><label>&nbsp;</label><button class="btn btn-blue" data-karim-action="loadStatement"><i class=ji data-i=search></i> عرض الكشف</button></div></div>
<div id="stmtBody"><div class="u-empty" style="padding:24px">اختر الفترة (أو اتركها فارغة لكل الحركات) ثم اعرض الكشف</div></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button><button class="btn btn-gold" data-karim-action="printStatement"><i class=ji data-i=printer></i> طباعة</button></div>
`,'modal-wide');
}
async function loadStatement(){
    const s=PCMT.stmtSupplier; if(!s) {return;}
    PCMT.stmtFrom=document.getElementById('stmtFrom')?.value||'';
    PCMT.stmtTo=document.getElementById('stmtTo')?.value||'';
    const body=document.getElementById('stmtBody'); if(!body) {return;}
    body.innerHTML='<div class="u-empty"><div class="spinner"></div></div>';
    try{
        const params=new URLSearchParams();
        if(PCMT.stmtFrom) {params.set('from',PCMT.stmtFrom);}
        if(PCMT.stmtTo) {params.set('to',PCMT.stmtTo);}
        const res=await apiFetch('/procurement/suppliers/'+s.id+'/statement'+(params.toString()?'?'+params:''));
        PCMT.stmt=res.statement;
        body.innerHTML=pcmtStatementHtml(res.supplier,res.statement);
    }catch(e){ body.innerHTML=`<div class="u-empty">${esc(e.message||'تعذر تحميل الكشف')}</div>`; }
}
function pcmtStatementHtml(supplier,stmt){
    const rows=stmt.rows.map(r=>`<tr>
<td>${fD(r.date)}</td>
<td>${r.type==='invoice'?'<span class="badge bdg-blue">فاتورة</span>':'<span class="badge bdg-green">دفعة</span>'}</td>
<td>${esc(r.ref)}</td>
<td class="c-red">${r.debit?fN(r.debit):'—'}</td>
<td class="c-green">${r.credit?fN(r.credit):'—'}</td>
<td class="fw-bold ${r.balance>0?'c-red':r.balance<0?'c-green':''}">${fN(r.balance)}</td>
</tr>`).join('')||'<tr><td colspan="6" class="u-empty">لا حركات في هذه الفترة</td></tr>';
    return `
<div class="u-t13 text-muted u-mb8">الرصيد الافتتاحي للفترة: <strong>${fN(stmt.openingBalance)}</strong> ${STATE.settings.currency} — الإجمالي: مدين ${fN(stmt.totals.debit)} / دائن ${fN(stmt.totals.credit)} — <strong>الرصيد الختامي: ${fN(stmt.totals.closing)}</strong></div>
<div class="tbl-scroll"><table>
<thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين (يزيد)</th><th>دائن (ينقص)</th><th>الرصيد</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">إجمالي الفترة</td><td class="c-red fw-bold">${fN(stmt.totals.debit)}</td><td class="c-green fw-bold">${fN(stmt.totals.credit)}</td><td class="fw-bold">${fN(stmt.totals.closing)}</td></tr></tfoot>
</table></div>`;
}
function printStatement(){
    const s=PCMT.stmtSupplier, stmt=PCMT.stmt;
    if(!s||!stmt){ toast('اعرض الكشف أولاً ثم اطبعه','warning'); return; }
    const currency=esc(STATE.settings.currency||'SAR');
    const rows=stmt.rows.map(r=>`<tr><td>${fD(r.date)}</td><td>${r.type==='invoice'?'فاتورة شراء':'دفعة'}</td><td>${esc(r.ref)}</td><td>${r.debit?fN(r.debit):'—'}</td><td>${r.credit?fN(r.credit):'—'}</td><td>${fN(r.balance)}</td></tr>`).join('');
    const win=(window.openInAppReport ? window.openInAppReport('تقرير المستودع') : window.open('', '_blank'));
    if(!win){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
    win.document.open();
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب — ${esc(s.name)}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}@media print{.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button data-karim-action="print">طباعة</button><button data-karim-action="closeWindow">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'')}</h1><p>كشف حساب مورد</p><p>${esc(s.name)}${s.phone?' — '+esc(s.phone):''}</p></header><section class="meta"><div><b>من</b>${PCMT.stmtFrom||'البداية'}</div><div><b>إلى</b>${PCMT.stmtTo||'اليوم'}</div><div><b>الرصيد الافتتاحي</b>${fN(stmt.openingBalance)} ${currency}</div></section><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows||'<tr><td colspan="6">لا حركات</td></tr>'}</tbody><tfoot><tr><td colspan="3">إجمالي الفترة</td><td>${fN(stmt.totals.debit)}</td><td>${fN(stmt.totals.credit)}</td><td>الختامي: ${fN(stmt.totals.closing)}</td></tr></tfoot></table></main></body></html>`);
    win.document.close(); win.focus();
}

// ═══ استوديو جرد المخزون الاحترافي — عدّ حي تُلقائي، فروقات فورية، أوراق طباعة ═══
const STOCK = { tab:'new', detail:null, dirty:{}, timers:{}, search:'', diffsOnly:false, scope:{mode:'all',category:'',search:''}, locationId:0, locations:null };
const STOCK_CAN_WRITE = ['admin','manager','warehouse'];
function stocktakStatusBadge(status){
    const map = { draft:['bdg-gold','مسودة قيد العد'], submitted:['bdg-blue','بانتظار الاعتماد'], approved:['bdg-green','معتمد'], cancelled:['bdg-red','ملغاة'] };
    const [cls,label] = map[status]||['bdg-gold',status];
    return `<span class="badge ${cls}">${label}</span>`;
}
function stocktakChipsHtml(){
    const d = STOCK.detail; if(!d) {return '';}
    const summary = stocktakClientSummary();
    const neg = summary.projected_variance_value < 0;
    return `<div class="st-chips">
        <span class="st-chip st-c-blue"><i class=ji data-i=package></i> معدود ${d.progress.counted} / ${d.progress.total}</span>
        <span class="st-chip ${summary.items_with_variance?'st-c-orange':'st-c-green'}"><i class=ji data-i=git-compare></i> أصناف بفروقات ${summary.items_with_variance}</span>
        <span class="st-chip st-c-red"><i class=ji data-i=trending-down></i> نقص ${summary.shortage_items}</span>
        <span class="st-chip st-c-green"><i class=ji data-i=trending-up></i> زيادة ${summary.surplus_items}</span>
        <span class="st-chip ${neg?'st-c-red':'st-c-green'}"><i class=ji data-i=coins></i> صافي الفروقات ${fC(summary.projected_variance_value)}</span>
        ${summary.stale_items?`<span class="st-chip st-c-orange" title="تغير رصيد هذه الأصناف بعد بدء الجلسة"><i class=ji data-i=alert-triangle></i> انحراف رصيد ${summary.stale_items}</span>`:''}
    </div>`;
}
function stocktakClientSummary(){
    const items = STOCK.detail?.items||[];
    const varianceItems = items.filter(i=>i.is_counted&&i.variance_qty!==0);
    return {
        items_with_variance: varianceItems.length,
        shortage_items: varianceItems.filter(i=>i.variance_qty<0).length,
        surplus_items: varianceItems.filter(i=>i.variance_qty>0).length,
        projected_variance_value: Math.round(varianceItems.reduce((s,i)=>s+Number(i.variance_value||0),0)*100)/100,
        stale_items: items.filter(i=>i.is_stale).length,
    };
}
async function showInventoryAuditModal(){
    STOCK.tab='new'; STOCK.detail=null; STOCK.search=''; STOCK.diffsOnly=false; STOCK.dirty={};
    showModal(`<h3><i class=ji data-i=clipboard-list></i> استوديو جرد المخزون</h3>
        <div class="st-tabs">
            <button class="st-tab" id="sttab-new" data-karim-action="stocktakSetTab" data-karim-args="[&quot;new&quot;]"><i class=ji data-i=plus></i> جلسة جديدة</button>
            <button class="st-tab" id="sttab-count" data-karim-action="stocktakSetTab" data-karim-args="[&quot;count&quot;]"><i class=ji data-i=clipboard-list></i> العد والفروقات</button>
            <button class="st-tab" id="sttab-history" data-karim-action="stocktakSetTab" data-karim-args="[&quot;history&quot;]"><i class=ji data-i=history></i> سجل الجرد</button>
        </div>
        <div id="stocktakBody"><div class="text-muted" style="padding:26px;text-align:center">جارٍ التحميل…</div></div>`, 'modal-wide');
    stocktakRender();
}
function stocktakSetTab(tab){
    STOCK.tab=tab;
    ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t===tab);} });
    stocktakRender();
}
async function stocktakRender(){
    const body=document.getElementById('stocktakBody'); if(!body) {return;}
    body.innerHTML='<div class="text-muted" style="padding:26px;text-align:center">جارٍ التحميل…</div>';
    try{
        if(STOCK.tab==='new') {body.innerHTML = await stocktakHtmlNew();}
        else if(STOCK.tab==='count') {body.innerHTML = await stocktakHtmlCount();}
        else {body.innerHTML = await stocktakHtmlHistory();}
    }catch(e){ body.innerHTML=`<div class="audit-note">تعذر التحميل: ${esc(e.message)}</div>`; }
    if(document.getElementById('stSignature')) {afterModalSignatureInit('stSignature');}
    if(STOCK.tab==='new') {stocktakScopePreview();}
}
// ─── تبويب جلسة جديدة ───
// Task 20: منتقي مخزن الجرد — اللقطة والفروقات والاعتماد كلها على رصيد المخزن المختار
function stocktakScopeItems(){
    const {mode,category,search} = STOCK.scope;
    let items = STATE.inventory;
    if(mode==='category') {items = items.filter(i=>String(i.category||'')===String(category));}
    else if(mode==='search'){ const q=search.trim(); if(q) {const hit=(i)=>String(i.name||'').includes(q)||String(i.barcode||'').includes(q); items = items.filter(hit); if(!items.length){items = STATE.inventory.filter(i=>(String(i.category||'')===String(category)) && ((window.arSearchIncludes?window.arSearchIncludes(i.name,q):false)||String(i.barcode||'').includes(q)));}} }
    else if(mode==='in_stock') {items = items.filter(i=>Number(i.qty||0)>0);}
    return items;
}
async function stocktakScopePreview(){
    const el=document.getElementById('stScopePreview'); if(!el) {return;}
    const locId = Number(STOCK.locationId||0);
    const btn=document.getElementById('stStartBtn');
    if(locId>0){
        try{
            const params = new URLSearchParams({mode:STOCK.scope.mode||'all',category:STOCK.scope.category||'',search:STOCK.scope.search||''});
            const p = await apiFetch(`/warehouse/inventory/locations/${locId}/preview?${params}`);
            el.innerHTML = `<i class=ji data-i=clipboard-list></i> سيُدرج <strong>${fN(p.items_count)}</strong> صنف من مخزن الجرد المختار — رصيده المتوقع: <strong>${fN(p.on_hand_qty)}</strong> وحدة بقيمة <strong>${fC(p.on_hand_value)}</strong>`;
            if(btn) {btn.disabled = !p.items_count;}
        }catch(_){
            el.innerHTML = `<i class=ji data-i=clipboard-list></i> <span class="text-muted">تعذرت المعاينة الحية — سيحدد النطاق على الخادم عند بدء الجلسة</span>`;
        }
        return;
    }
    const items = stocktakScopeItems();
    const value = items.reduce((s,i)=>s+(Number(i.qty||0)*Number(i.avgCost||0)),0);
    el.innerHTML = `<i class=ji data-i=clipboard-list></i> سيُدرج <strong>${fN(items.length)}</strong> صنف في الجلسة — قيمة المخزون المتوقع جرده: <strong>${fC(value)}</strong>`;
    if(btn) {btn.disabled = !items.length;}
}
function stocktakSetLocation(id){
    STOCK.locationId = Number(id)||0;
    document.querySelectorAll('.st-loc').forEach(el=>el.classList.toggle('active', Number(el.dataset.loc)===STOCK.locationId));
    stocktakScopePreview();
}
async function stocktakLoadLocations(){
    if(Array.isArray(STOCK.locations) && STOCK.locations.length) {return STOCK.locations;}
    try{ STOCK.locations = await apiFetch('/warehouse/inventory/locations'); }catch(_){ STOCK.locations=[]; }
    return STOCK.locations;
}
function stocktakSetScope(mode, value=''){
    STOCK.scope = { mode, category: mode==='category'?(value||''):'', search: mode==='search'?(value||''):'' };
    ['stScopeCat','stScopeSearch'].forEach(id=>{ const el=document.getElementById(id); if(el) {el.style.display='none';} });
    if(mode==='category'){ const el=document.getElementById('stScopeCat'); if(el){ el.style.display=''; STOCK.scope.category=el.value; } }
    if(mode==='search'){ const el=document.getElementById('stScopeSearch'); if(el){ el.style.display=''; el.focus(); } }
    stocktakScopePreview();
}
async function stocktakHtmlNew(){
    let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
    const open = audits.filter(a=>['draft','submitted'].includes(a.status));
    const cats = [...new Set(STATE.inventory.map(i=>i.category).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ar'));
    const locations = await stocktakLoadLocations();
    if(!STOCK.locationId) {STOCK.locationId = Number(locations.find(l=>l.code==='MAIN-WAREHOUSE')?.id || locations[0]?.id || 0);}
    const locChips = locations.map(l=>`
        <div class="st-loc ${Number(l.id)===Number(STOCK.locationId)?'active':''}" data-loc="${l.id}" data-karim-action="stocktakSetLocation" data-karim-arg0="${l.id}">
            <i class=ji data-i=package></i>
            <strong>${esc(l.name_ar)}</strong>
            <span>${l.dept_name?esc(l.dept_name)+' · ':''}${fN(l.items_count)} ${fN(l.items_count)} صنف · ${fC(l.on_hand_value)}</span>
        </div>`).join('');
    const openStrip = open.length?`<div class="st-resume"><i class=ji data-i=alert-circle></i> لديك جلسات جرد مفتوحة:
        ${open.slice(0,3).map(a=>`<button class="btn btn-gold btn-sm" data-karim-action="stocktakOpenSession" data-karim-arg0="${a.id}">${esc(a.audit_number)} — متابعة العد</button>`).join('')}</div>`:'';
    return `${openStrip}
    <div class="audit-note"><strong>دورة جرد آمنة بثلاث خطوات — لكل مخزن على حدة</strong><br>
    <span class="text-muted">١) اختر المخزن وحدّد نطاق الجرد وابدأ الجلسة — ٢) عدّ الأصناف فعلياً (يُحفظ كل عدّ تلقائياً وتظهر الفروقات فوراً مقارنةً برصيد هذا المخزن) — ٣) اعتمد الفروقات فيُطبَّق على رصيد المخزن بحركات تصحيح موثّقة، وعجز المخزن يُسجَّل كلفة على القسم صاحبه. لا يتأثر أي رصيد قبل الاعتماد.</span></div>
    <h4 class="st-lochead"><i class=ji data-i=package></i> اختر مخزن الجرد</h4>
    <div class="st-loc-grid">${locChips||'<div class="text-muted">لا توجد مخازن مفعّلة</div>'}</div>
    <div class="st-scope-grid">
        <div class="st-scope active" data-karim-action="stocktakSetScope" data-karim-args="[&quot;all&quot;]"><i class=ji data-i=package></i><strong>كل أصناف المخزن</strong><span>جرد شامل للمخزن المختار</span></div>
        <div class="st-scope" data-karim-action="stocktakSetScope" data-karim-args="[&quot;in_stock&quot;]"><i class=ji data-i=box></i><strong>ذات رصيد فقط</strong><span>تجاهل أصناف الصفر في هذا المخزن</span></div>
        <div class="st-scope" data-karim-action="stocktakSetScope" data-karim-args="[&quot;category&quot;]"><i class=ji data-i=folder></i><strong>فئة محددة</strong><span>جرد جزئي سريع</span></div>
        <div class="st-scope" data-karim-action="stocktakSetScope" data-karim-args="[&quot;search&quot;]"><i class=ji data-i=search></i><strong>بحث بالاسم/الباركود</strong><span>أصناف مختارة</span></div>
    </div>
    <div class="fr">
        <div class="fg" id="stScopeCat" style="display:none"><label>الفئة</label><select onchange="STOCK.scope.category=this.value;stocktakScopePreview()"><option value="">— اختر الفئة —</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
        <div class="fg" id="stScopeSearch" style="display:none"><label>بحث</label><input type="text" oninput="STOCK.scope.search=this.value;stocktakScopePreview()" placeholder="اسم الصنف أو الباركود"></div>
    </div>
    <div class="st-preview" id="stScopePreview"></div>
    <div class="fr">
        <div class="fg"><label>نوع الفترة</label><select id="stPeriodType"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly" selected>شهري</option><option value="custom">فترة مخصصة</option><option value="annual">سنوي</option></select></div>
        <div class="fg"><label>تاريخ العد</label><input type="date" id="stCountedAt" value="${today()}"></div>
        <div class="fg"><label>بداية الفترة</label><input type="date" id="stPeriodStart" value="${today()}"></div>
        <div class="fg"><label>نهاية الفترة</label><input type="date" id="stPeriodEnd" value="${today()}"></div>
    </div>
    <div class="fg"><label>ملاحظات الجلسة</label><input type="text" id="stNotes" placeholder="مثال: جرد نهاية الشهر — فرع الرئيسي"></div>
    <div class="modal-footer" style="margin-top:14px"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-purple" id="stStartBtn" data-karim-action="stocktakStartSession"><i class=ji data-i=play></i> بدء جلسة الجرد</button></div>`;
}
async function stocktakStartSession(){
    showLoad();
    try{
        const locId = Number(STOCK.locationId||0);
        if(!locId){ hideLoad(); toast('اختر مخزن الجرد أولاً','warning'); return; }
        const payload = {
            countedAt: document.getElementById('stCountedAt')?.value||today(),
            periodType: document.getElementById('stPeriodType')?.value||'custom',
            periodStart: document.getElementById('stPeriodStart')?.value||today(),
            periodEnd: document.getElementById('stPeriodEnd')?.value||today(),
            notes: document.getElementById('stNotes')?.value||'',
            locationId: locId,
            scopeFilter: { ...STOCK.scope },
        };
        const res = await apiFetch('/warehouse/inventory/audits',{method:'POST',body:JSON.stringify(payload)});
        toast(`بدأت جلسة الجرد ${res.audit.audit_number} على ${res.location?.name||'المخزن'} — ${res.itemCount} صنف`,'success');
        await stocktakOpenSession(res.audit.id);
    }catch(e){ toast(e.message||'تعذر بدء جلسة الجرد','error'); }
    finally{ hideLoad(); }
}
async function showFiscalYearModal(){
    try{
        const years=await apiFetch('/warehouse/fiscal-years');
        const current=years.find(y=>y.status==='open')||years[0];
        const canClose=STATE.currentUser?.role==='admin';
        const cards=years.map(y=>`<tr><td><strong>${esc(y.name||y.year_code)}</strong><div class="text-muted">${esc(String(y.start_date))} → ${esc(String(y.end_date))}</div></td><td><span class="badge ${y.status==='closed'?'bdg-green':'bdg-blue'}">${y.status==='closed'?'مغلقة':'مفتوحة'}</span></td><td>${y.status==='closed'?`إيرادات: ${fC(y.closing_snapshot?.revenue_total||0)}<br>صافي: ${fC(y.closing_snapshot?.net_result||0)}`:'بانتظار الإقفال'}</td><td>${y.status==='open'&&canClose?`<button class="btn btn-gold btn-sm" data-karim-action="closeFiscalYear" data-karim-arg0="${y.id}"><i class=ji data-i=lock></i> إقفال السنة</button>`:''}${y.status==='closed'&&canClose?`<button class="btn btn-blue btn-sm" data-karim-action="createNextFiscalYear" data-karim-arg0="${y.id}"><i class=ji data-i=plus></i> السنة التالية</button>`:''}</td></tr>`).join('');
        showModal(`<h3><i class=ji data-i=calendar></i> السنة المالية والإقفال</h3><div class="audit-note"><strong>${current?esc(current.name):'لا توجد سنة مالية'}</strong><br><span class="text-muted">لا يتم حذف المبيعات أو المصروفات. يحفظ النظام لقطة إقفال، قيمة المخزون، وترحيل الأرصدة الافتتاحية للسنة التالية.</span></div><div class="tbl-scroll"><table><thead><tr><th>السنة</th><th>الحالة</th><th>الملخص</th><th>الإجراء</th></tr></thead><tbody>${cards||'<tr><td colspan="4">لا توجد سنوات مالية</td></tr>'}</tbody></table></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`,'modal-wide');
    }catch(e){toast(e.message||'تعذر تحميل السنوات المالية','error');}
}
async function closeFiscalYear(id){
    if(!confirm('سيتم إقفال السنة بعد التحقق من إغلاق الورديات واعتماد الجرد. لا يمكن تكرار الإقفال. هل تريد المتابعة؟')) {return;}
    try{showLoad();await apiFetch(`/warehouse/fiscal-years/${id}/close`,{method:'POST'});toast('تم إقفال السنة المالية وحفظ لقطة الأرصدة','success');await showFiscalYearModal();}catch(e){toast(e.message||'تعذر إقفال السنة المالية','error');}finally{hideLoad();}
}
async function createNextFiscalYear(id){
    if(!confirm('سيتم إنشاء السنة التالية وترحيل أرصدة المخزون الافتتاحية. هل تريد المتابعة؟')) {return;}
    try{showLoad();await apiFetch(`/warehouse/fiscal-years/${id}/create-next`,{method:'POST'});toast('تم إنشاء السنة التالية وترحيل الأرصدة','success');await showFiscalYearModal();}catch(e){toast(e.message||'تعذر إنشاء السنة التالية','error');}finally{hideLoad();}
}
// ─── تبويب العد والفروقات (استوديو العد الحي) ───
async function stocktakOpenSession(id){
    showLoad();
    try{
        STOCK.detail = await apiFetch(`/warehouse/inventory/audits/${id}`);
        STOCK.dirty = {}; STOCK.search=''; STOCK.diffsOnly=false;
        STOCK.tab = 'count';
        ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t==='count');} });
        stocktakRender();
    }catch(e){ toast(e.message||'تعذر فتح جلسة الجرد','error'); }
    finally{ hideLoad(); }
}
async function stocktakRefreshDetail(){
    if(!STOCK.detail) {return;}
    try{ STOCK.detail = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}`); stocktakRender(); }
    catch(e){ toast(e.message||'تعذر تحديث الجلسة','error'); }
}
function stocktakCountFilter(){
    const items = STOCK.detail?.items||[];
    const q = STOCK.search.trim();
    let out = items;
    if(q) {const hit=(i)=>String(i.item_name||'').includes(q)||String(i.barcode||'').includes(q)||String(i.category||'').includes(q); out = out.filter(hit); if(!out.length){out = (STOCK.detail?.items||[]).filter(i=>(window.arSearchIncludes?window.arSearchIncludes(i.item_name,q):false)||String(i.barcode||'').includes(q)||(window.arSearchIncludes?window.arSearchIncludes(i.category,q):false));}}
    if(STOCK.diffsOnly) {out = out.filter(i=>i.is_counted&&i.variance_qty!==0);}
    return out;
}
function stocktakRowHtml(item, locked){
    const counted = item.is_counted;
    const dirty = STOCK.dirty[item.item_id] !== undefined;
    const state = dirty?'st-dirty':counted?'st-saved':'st-uncounted';
    const diffCls = counted&&item.variance_qty!==0?(item.variance_qty<0?'st-var-neg':'st-var-pos'):'';
    const varText = counted?(item.variance_qty===0?'مطابق':(item.variance_qty>0?'+':'')+fN(item.variance_qty)):'لم يُعدّ';
    return `<tr class="st-row ${state}" id="strow-${item.item_id}">
        <td><strong>${esc(item.item_name)}</strong><div class="st-sub">${esc(item.category||'—')} · ${esc(item.unit||'وحدة')}${item.barcode?` · <span class="st-bc">${esc(item.barcode)}</span>`:''}</div></td>
        <td class="c st-sys">${fN(item.system_qty)}</td>
        <td class="c"><input type="number" class="st-count-input" id="stc-${item.item_id}" min="0" step="0.001" inputmode="decimal" value="${counted?item.counted_qty:''}" placeholder="${item.system_qty}" ${locked?'disabled':''} data-karim-action="stocktakCountChanged" data-karim-event="input" data-karim-arg0="${item.item_id}" data-karim-action="stocktakSaveCount" data-karim-event="change" data-karim-args="[&quot;${item.item_id}&quot;,true]"></td>
        <td class="c st-var ${diffCls}" id="stv-${item.item_id}">${varText}</td>
        <td class="c st-val ${diffCls}" id="stvv-${item.item_id}">${counted?fC(item.variance_value):'—'}</td>
        <td><input type="text" class="st-note" id="stn-${item.item_id}" value="${esc(item.notes||'')}" placeholder="ملاحظة" ${locked?'disabled':''} data-karim-action="stocktakSaveCount" data-karim-event="change" data-karim-args="[&quot;${item.item_id}&quot;,true]"></td>
        <td class="c">${counted&&!locked?`<button class="st-clear" title="مسح العد وإرجاعه إلى غير معدود" data-karim-action="stocktakClearCount" data-karim-arg0="${item.item_id}"><i class=ji data-i=x></i></button>`:''}</td>
    </tr>`;
}
function stocktakRowsTbodyHtml(){
    const d = STOCK.detail; if(!d) {return '';}
    const locked = d.audit.status!=='draft';
    const items = stocktakCountFilter();
    if(!items.length) {return '<tr><td colspan="7" class="c text-muted" style="padding:22px">لا توجد أصناف مطابقة للبحث في هذه الجلسة</td></tr>';}
    return items.map(item=>stocktakRowHtml(item,locked)).join('');
}
function stocktakStaleBanner(){
    const stale = (STOCK.detail?.items||[]).filter(i=>i.is_stale);
    if(!stale.length) {return '';}
    return `<div class="st-stale"><i class=ji data-i=alert-triangle></i> <strong>تنبيه انحراف الرصيد:</strong> تغير رصيد ${stale.length} صنف في النظام بعد بدء الجلسة (مثال: ${esc(stale.slice(0,2).map(i=>i.item_name).join('، '))}). سيمنع النظام الاعتماد حتى تبدأ جلسة جديدة تلتقط الأرصدة الحالية.</div>`;
}
async function stocktakHtmlCount(){
    if(!STOCK.detail){
        let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
        const open = audits.filter(a=>['draft','submitted'].includes(a.status));
        return `<div class="st-empty"><i class=ji data-i=clipboard-list></i><p>لا توجد جلسة جرد مفتوحة الآن.</p><p class="text-muted">ابدأ جلسة جديدة من تبويب «جلسة جديدة»، أو تابع إحدى الجلسات المفتوحة:</p>
        ${open.length?open.slice(0,5).map(a=>`<button class="btn btn-gold btn-sm" data-karim-action="stocktakOpenSession" data-karim-arg0="${a.id}">${esc(a.audit_number)} (${a.item_count||0} صنف)</button>`).join(''):'<span class="text-muted">لا توجد جلسات مفتوحة</span>'}</div>`;
    }
    const {audit,progress} = STOCK.detail;
    const locked = audit.status!=='draft';
    const canWrite = STOCK_CAN_WRITE.includes(STATE.currentUser?.role);
    const locChip = STOCK.detail.location_name?`· <span class="badge bdg-blue">${esc(STOCK.detail.location_name)}</span>`:'';
    const statusStrip = {
        submitted:`<div class="st-locked"><i class=ji data-i=lock></i> الجلسة أُرسلت للاعتماد — العد مقفل. يمكن للمدير اعتماد الفروقات أو إلغاء الجلسة.</div>`,
        approved:`<div class="st-approved"><i class=ji data-i=circle-check></i> اعتُمدت الجلسة وطُبّقت الفروقات على الأرصدة بتاريخ ${esc(String(audit.approved_at||'').slice(0,16).replace('T',' '))}.</div>`,
        cancelled:`<div class="st-locked"><i class=ji data-i=x-circle></i> أُلغيت الجلسة (${esc(audit.cancel_reason||'بدون سبب')}) — لا أثر على الأرصدة.</div>`,
    }[audit.status]||'';
    return `
    <div class="st-head">
        <div><strong class="st-num">${esc(audit.audit_number)}</strong><div class="st-sub">أنشأها ${esc(audit.created_by)} — ${esc(String(audit.counted_at).slice(0,10))} ${locChip}</div></div>
        <div class="st-progresswrap"><div class="st-progresstxt"><span id="stProgressTxt">${progress.counted} / ${progress.total}</span><span>${progress.percent}%</span></div><div class="progress-premium" style="height:10px"><div class="progress-premium-bar" id="stProgressBar" style="width:${progress.percent}%"></div></div></div>
        ${stocktakChipsHtml()}
    </div>
    ${statusStrip}${stocktakStaleBanner()}
    <div class="st-toolbar">
        <div class="st-search"><i class=ji data-i=search></i><input type="text" id="stSearchInput" placeholder="بحث بالاسم أو الباركود أو الفئة…" value="${esc(STOCK.search)}" data-karim-action="stocktakOnSearch" data-karim-event="input" data-karim-pass="value"></div>
        <label class="st-diffsonly"><input type="checkbox" ${STOCK.diffsOnly?'checked':''} data-karim-action="stocktakToggleDiffs" data-karim-event="change" data-karim-pass="checked"> الفروقات فقط</label>
        <button class="btn btn-sm" data-karim-action="stocktakScanCount"><i class=ji data-i=camera></i> مسح باركود</button>
        <button class="btn btn-blue btn-sm" data-karim-action="stocktakPrint" data-karim-args="[&quot;count-sheet&quot;]"><i class=ji data-i=printer></i> ورقة الجرد</button>
        <button class="btn btn-sm" data-karim-action="stocktakRefreshDetail"><i class=ji data-i=refresh></i> تحديث</button>
    </div>
    <div class="tbl-scroll" style="max-height:42vh">
        <table class="st-table"><thead><tr><th>الصنف</th><th class="c">رصيد النظام</th><th class="c" style="min-width:130px">العدّ الفعلي</th><th class="c">الفرق</th><th class="c">قيمة الفرق</th><th style="min-width:120px">ملاحظة</th><th class="c"></th></tr></thead>
        <tbody id="stTbody">${stocktakRowsTbodyHtml()}</tbody></table>
    </div>
    ${locked?`<div class="modal-footer" style="margin-top:12px"><button class="btn" data-karim-action="stocktakPrint" data-karim-args="[&quot;report&quot;]"><i class=ji data-i=printer></i> طباعة التقرير</button>${audit.status==='submitted'&&canWrite?`<button class="btn btn-gold" data-karim-action="stocktakCancelSession"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button><button class="btn btn-purple" data-karim-action="stocktakApproveSession"><i class=ji data-i=circle-check></i> اعتماد وتطبيق الفروقات</button>`:''}</div>`
    :canWrite?`
    ${signaturePadMarkup('stSignature','توقيع مسؤول الجرد / المعتمد')}
    <div class="modal-footer" style="margin-top:12px">
        <button class="btn btn-gold" data-karim-action="stocktakCancelSession"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button>
        <button class="btn btn-blue" data-karim-action="stocktakSubmitSession"><i class=ji data-i=send></i> إرسال للاعتماد</button>
        <button class="btn btn-purple" data-karim-action="stocktakApproveSession"><i class=ji data-i=circle-check></i> اعتماد فوري وتطبيق الفروقات</button>
    </div>`:`<div class="text-muted" style="text-align:center;padding:10px">دورك يسمح بالمشاهدة والعد فقط — الاعتماد يتطلب مديراً.</div>`}`;
}
function stocktakOnSearch(value){
    STOCK.search = value;
    const tbody = document.getElementById('stTbody');
    if(tbody) {tbody.innerHTML = stocktakRowsTbodyHtml();}
}
function stocktakToggleDiffs(checked){
    STOCK.diffsOnly = !!checked;
    const tbody = document.getElementById('stTbody');
    if(tbody) {tbody.innerHTML = stocktakRowsTbodyHtml();}
}
function stocktakScanCount(){
    if(!STOCK.detail||STOCK.detail.audit.status!=='draft'){ toast('العد متاح في الجلسات المسودة فقط','warning'); return; }
    openScanner({ title:'<i class=ji data-i=camera></i> مسح باركود صنف', onDecode:(val)=>{
        const code = String(val||'').trim();
        const item = (STOCK.detail?.items||[]).find(i=>String(i.barcode||'')===code);
        if(!item){ toast('لا يوجد صنف بهذا الباركود في الجلسة','warning'); return; }
        STOCK.search = code; STOCK.diffsOnly=false;
        const input=document.getElementById('stSearchInput'); if(input) {input.value=code;}
        stocktakToggleDiffs(false);
        setTimeout(()=>{ const c=document.getElementById(`stc-${item.item_id}`); if(c){ c.focus(); c.select(); } },150);
        toast(`الصنف: ${item.item_name}`,'success');
    }});
}
function stocktakCountChanged(itemId){
    STOCK.dirty[itemId] = true;
    const row = document.getElementById(`strow-${itemId}`);
    if(row){ row.classList.add('st-dirty'); row.classList.remove('st-saved'); }
    clearTimeout(STOCK.timers[itemId]);
    STOCK.timers[itemId] = setTimeout(()=>stocktakSaveCount(itemId,false), 900);
}
async function stocktakSaveCount(itemId, manual){
    const input = document.getElementById(`stc-${itemId}`);
    if(!input||!STOCK.detail) {return;}
    if(input.value===''){ if(manual) {toast('أدخل الكمية المعدودة أولاً — أو امسح العد بزر ×','warning');} return; }
    const value = Number(input.value);
    if(!Number.isFinite(value)||value<0){ toast('الكمية المعدودة غير صالحة','error'); return; }
    clearTimeout(STOCK.timers[itemId]); delete STOCK.dirty[itemId];
    try{
        const res = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}/counts/${itemId}`,{method:'PUT',body:JSON.stringify({countedQty:value,notes:document.getElementById(`stn-${itemId}`)?.value||''})});
        stocktakApplyItem(res.item); stocktakApplyProgress(res.counted_items);
        const row=document.getElementById(`strow-${itemId}`);
        if(row){ row.classList.remove('st-dirty'); row.classList.remove('st-uncounted'); row.classList.add('st-saved'); }
    }catch(e){ STOCK.dirty[itemId]=true; toast(e.message||'تعذر حفظ العد','error'); }
}
function stocktakApplyItem(item){
    const local = (STOCK.detail?.items||[]).find(i=>Number(i.item_id)===Number(item.item_id));
    if(local){
        Object.assign(local,{ counted_qty:Number(item.counted_qty), variance_qty:Number(item.variance_qty), variance_value:Number(item.variance_value), notes:item.notes||null, is_counted:true });
    }
    const qty = Number(item.variance_qty);
    const v = document.getElementById(`stv-${item.item_id}`);
    if(v){ v.textContent = qty===0?'مطابق':(qty>0?'+':'')+fN(qty); v.classList.toggle('st-var-neg',qty<0); v.classList.toggle('st-var-pos',qty>0); }
    const vv = document.getElementById(`stvv-${item.item_id}`);
    if(vv){ vv.innerHTML = fC(Number(item.variance_value)); vv.classList.toggle('st-var-neg',Number(item.variance_value)<0); vv.classList.toggle('st-var-pos',Number(item.variance_value)>0); }
}
function stocktakApplyProgress(countedItems){
    const d=STOCK.detail; if(!d) {return;}
    d.progress.counted = countedItems;
    d.progress.remaining = d.progress.total - countedItems;
    d.progress.percent = d.progress.total?Math.round((countedItems/d.progress.total)*100):0;
    const bar=document.getElementById('stProgressBar'); if(bar) {bar.style.width=d.progress.percent+'%';}
    const txt=document.getElementById('stProgressTxt'); if(txt) {txt.textContent=`${d.progress.counted} / ${d.progress.total}`;}
    const head=document.querySelector('.st-head'); if(head){ const old=head.querySelector('.st-chips'); if(old) {old.remove();} head.insertAdjacentHTML('beforeend',stocktakChipsHtml()); }
}
async function stocktakClearCount(itemId){
    if(!STOCK.detail) {return;}
    try{
        const res = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}/counts/${itemId}`,{method:'DELETE'});
        const local = (STOCK.detail.items||[]).find(i=>Number(i.item_id)===Number(itemId));
        if(local) {Object.assign(local,{ counted_qty:local.system_qty, variance_qty:0, variance_value:0, is_counted:false, notes:null });}
        stocktakApplyProgress(res.counted_items);
        const tbody=document.getElementById('stTbody'); if(tbody) {tbody.innerHTML=stocktakRowsTbodyHtml();}
        toast('مُسح العد — الصنف عاد إلى «غير معدود»','success');
    }catch(e){ toast(e.message||'تعذر مسح العد','error'); }
}
async function stocktakSavePending(){
    const ids = Object.keys(STOCK.dirty);
    for(const id of ids){ clearTimeout(STOCK.timers[id]); await stocktakSaveCount(Number(id),false); }
    return ids.length;
}
async function stocktakSubmitSession(){
    const d=STOCK.detail;
    if(!d||d.audit.status!=='draft') {return;}
    await stocktakSavePending();
    const sig = readSignaturePad('stSignature'); if(!sig) {return;}
    const signerName = readSignerName('stSignature'); if(!signerName) {return;}
    if(!confirm('سيتم إرسال الجلسة للاعتماد وتثبيت العد والتوقيع. متابعة؟')) {return;}
    showLoad();
    try{
        await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/submit`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});
        toast('أُرسلت الجلسة للاعتماد — العد مقفل الآن','success');
        await stocktakRefreshDetail();
    }catch(e){ toast(e.message||'تعذر إرسال الجلسة','error'); }
    finally{ hideLoad(); }
}
async function stocktakApproveSession(){
    const d=STOCK.detail;
    if(!d||!['draft','submitted'].includes(d.audit.status)) {return;}
    await stocktakSavePending();
    const sig = readSignaturePad('stSignature'); if(!sig) {return;}
    const signerName = readSignerName('stSignature'); if(!signerName) {return;}
    const summary = stocktakClientSummary();
    if(!confirm(`سيتم تطبيق الفروقات على أرصدة المخزون:\n— أصناف بفروقات: ${summary.items_with_variance} (نقص ${summary.shortage_items} / زيادة ${summary.surplus_items})\n— صافي قيمة الفروقات: ${summary.projected_variance_value}\nتُسجَّل حركات تصحيح موثّقة ولا يمكن التراجع. متابعة؟`)) {return;}
    showLoad();
    try{
        if(d.audit.status==='draft') {await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/submit`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});}
        const result = await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/approve`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});
        for(const change of (result.stockChanges||[])){ const local=STATE.inventory.find(i=>String(i.id)===String(change.id)); if(local) {Object.assign(local,change);} }
        for(const tx of (result.transactions||[])) {upsertStateEntity('inventoryTx',tx);}
        toast(`اعتُمد الجرد وطُبّقت ${result.transactions?.length||0} حركة تصحيح على الأرصدة`,'success');
        await stocktakRefreshDetail();
    }catch(e){ toast(e.message||'تعذر اعتماد الجرد — لم يُطبق أي تغيير','error'); }
    finally{ hideLoad(); }
}
async function stocktakCancelSession(){
    const d=STOCK.detail;
    if(d){ await stocktakCancelById(d.audit.id); return; }
    toast('لا توجد جلسة مفتوحة','warning');
}
async function stocktakCancelById(id){
    const reason = prompt('سبب إلغاء جلسة الجرد (مطلوب):');
    if(reason===null) {return;}
    if(reason.trim().length<3){ toast('سبب الإلغاء مطلوب (3 أحرف على الأقل)','warning'); return; }
    if(!confirm('سيتم إلغاء الجلسة دون أي تأثير على أرصدة المخزون. متابعة؟')) {return;}
    showLoad();
    try{
        await apiFetch(`/warehouse/inventory/audits/${id}/cancel`,{method:'POST',body:JSON.stringify({reason:reason.trim()})});
        toast('أُلغيت جلسة الجرد','success');
        if(STOCK.detail&&Number(STOCK.detail.audit.id)===Number(id)){ STOCK.detail=null; STOCK.tab='history'; ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t==='history');} }); }
        stocktakRender();
    }catch(e){ toast(e.message||'تعذر إلغاء الجلسة','error'); }
    finally{ hideLoad(); }
}
async function stocktakPrintById(id, kind){
    try{
        const res = await fetch(API_BASE+`/warehouse/inventory/audits/${id}/${kind}`,{headers:{'Authorization':'Bearer '+(window._jwt||'')}});
        if(!res.ok) {throw new Error('فشل تحميل المستند');}
        const html = await res.text();
        const frame=document.createElement('iframe');
        frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(frame);
        frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
        setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(_){} setTimeout(()=>frame.remove(),2000); },500);
    }catch(e){ toast(e.message||'تعذر الطباعة','error'); }
}
function stocktakPrint(kind){
    if(!STOCK.detail){ toast('افتح جلسة أولاً','warning'); return; }
    stocktakPrintById(STOCK.detail.audit.id, kind);
}
// ─── تبويب سجل الجرد ───
async function stocktakHtmlHistory(){
    let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
    const rows = audits.map(a=>{
        const counted = a.counted_items!=null?a.counted_items:null;
        const variance = Number(a.total_variance_value||0);
        const actions = [`<button class="btn btn-blue btn-sm" data-karim-action="stocktakOpenSession" data-karim-arg0="${a.id}"><i class=ji data-i=eye></i> فتح</button>`];
        if(a.status!=='cancelled') {actions.push(`<button class="btn btn-sm" data-karim-action="stocktakPrintById" data-karim-args="[&quot;${a.id}&quot;,&quot;report&quot;]"><i class=ji data-i=printer></i> تقرير</button>`);}
        if(['draft','submitted'].includes(a.status)&&STOCK_CAN_WRITE.includes(STATE.currentUser?.role)) {actions.push(`<button class="btn btn-gold btn-sm" data-karim-action="stocktakCancelById" data-karim-arg0="${a.id}"><i class=ji data-i=x-circle></i> إلغاء</button>`);}
        return `<tr>
            <td><strong>${esc(a.audit_number)}</strong><div class="st-sub">${esc(String(a.created_at||'').slice(0,16).replace('T',' '))}</div></td>
            <td>${esc(String(a.counted_at||'').slice(0,10))}</td>
            <td>${esc(a.created_by)}</td>
            <td class="c">${counted!=null?`${counted} / ${a.item_count||0}`:fN(a.item_count||0)}</td>
            <td class="c" style="color:${variance<0?'var(--red)':variance>0?'var(--green)':'inherit'}">${variance?fC(variance):'—'}</td>
            <td class="c">${stocktakStatusBadge(a.status)}</td>
            <td><div class="st-actions">${actions.join('')}</div></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="c text-muted" style="padding:22px">لا توجد جلسات جرد بعد — ابدأ الأولى من تبويب «جلسة جديدة»</td></tr>';
    return `<div class="tbl-scroll" style="max-height:56vh">
        <table><thead><tr><th>رقم الجلسة</th><th>تاريخ العد</th><th>المنشئ</th><th class="c">معدود / الأصناف</th><th class="c">صافي الفروقات</th><th class="c">الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    <div class="audit-note" style="margin-top:12px"><span class="text-muted">الجلسات المعتمدة ظهرت فروقاتها كحركات تصحيح في سجل المخزون، والملغاة دون أي أثر. اضغط «فتح» لعرض تفاصيل أي جلسة وطباعة تقريرها.</span></div>`;
}

function inventoryUnitOptions(selected='كجم'){ const opts=[['kg','كجم'],['g','جرام'],['l','لتر'],['ml','مل'],['piece','قطعة/وحدة']]; const aliases={كجم:'kg',كيلو:'kg',جرام:'g',غرام:'g',لتر:'l',مل:'ml',وحدة:'piece',قطعة:'piece',حبة:'piece'}; const current=aliases[String(selected||'').trim()]||selected; return opts.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join(''); }

// ─── سياسة المالك 2026-10-20: تاريخ الصلاحية اختياري في كل مداخل المخزون ───────
// الخادم هو الحكم: يقبل الغياب، ويرفض الصيغة الفاسدة (INVALID_EXPIRY_DATE).
// هذه الطبقة تعطي العامل نفس الرسالة قبل دورة الشبكة، ولا تخترع تاريخًا أبدًا.
const EXPIRY_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function normExpiryDate(value){ if(value instanceof Date){ if(Number.isNaN(value.getTime())) {return null;} const p=(n)=>String(n).padStart(2,'0'); return `${value.getFullYear()}-${p(value.getMonth()+1)}-${p(value.getDate())}`; } const s=String(value ?? '').trim().slice(0,10); const m=EXPIRY_DATE_RE.exec(s); if(!m) {return null;} const y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]); if(y<1900||mo<1||mo>12) {return null;} const probe=new Date(Date.UTC(y,mo-1,d)); if(probe.getUTCFullYear()!==y||probe.getUTCMonth()!==mo-1||probe.getUTCDate()!==d) {return null;} return s; }
/** @returns {string|null} التاريخ الصحيح، أو '' عند الغياب (اختياري)، أو null عند صيغة فاسدة بعد تنبيه العامل */
function requireExpiryDate(raw){
    const text=String(raw ?? '').trim();
    if(!text){
        return '';
    }
    const d=normExpiryDate(text);
    if(!d){
        toast(`تاريخ الصلاحية غير صحيح (${text.slice(0,24)}) — الصيغة المطلوبة YYYY-MM-DD`, 'error');
    }
    return d;
}
function showAddItemModal(prefillBarcode=''){
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=package></i> إضافة صنف جديد</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="itemName"></div><div class="fg"><label>الفئة</label><input type="text" id="itemCategory"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="itemBarcode" value="${esc(prefillBarcode)}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" data-karim-action="scanForItemBarcodeField" data-karim-args="[&quot;itemBarcode&quot;]"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="itemUnit">${inventoryUnitOptions('kg')}</select><small class="text-muted">مثال: زيت باللتر، أرز بالكجم، دجاج بالقطعة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="itemMinQty" value="5" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الكمية الافتتاحية</label><input type="number" id="itemQty" value="0" step="0.01"></div><div class="fg"><label>سعر الشراء</label><input type="number" id="itemPrice" value="0" step="0.01"></div><div class="fg"><label>تاريخ الصلاحية</label><input type="date" id="itemExpiry"><small class="text-muted">اختياري — إن أُدخل فيجب أن يكون YYYY-MM-DD</small></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="itemWeight" value="0" step="0.01"></div><div class="fg"><label>الرف</label><select id="itemShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="addInventoryItem"><i class=ji data-i=save></i> حفظ</button></div>`);
}
function scanForItemBarcodeField(inputId){
openScanner({
title:'<i class=ji data-i=camera></i> مسح باركود / QR الصنف',
instruction:'وجّه الكاميرا نحو باركود أو QR الصنف',
onDecode:(code)=>{
const el=document.getElementById(inputId);
if(el){ el.value=code; toast('تم مسح الكود','success'); }
}
});
}
function scanToAddInventoryItem(){
openScanner({
title:'<i class=ji data-i=camera></i> مسح صنف للمخزون',
instruction:'وجّه الكاميرا نحو باركود أو QR الصنف',
onDecode:(code)=>{
const existing=STATE.inventory.find(i=>i.barcode && i.barcode===code);
if(existing){ showQuickStockInModal(existing.id, code); }
else{ showAddItemModal(code); }
}
});
}
function showQuickStockInModal(itemId, scannedCode){
const item=STATE.inventory.find(i=>i.id===itemId);
if(!item) {return;}
showModal(`<h3><i class=ji data-i=package></i> ${esc(item.name)}</h3>
<div style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:12px">
<div>الكمية الحالية: <strong class="c-gold">${fN(item.qty)} ${item.unit}</strong></div>
<div class="u-sub">الباركود الممسوح: ${esc(scannedCode)}</div>
</div>
<div class="fg"><label>الكمية المضافة</label><input type="number" id="quickStockQty" value="1" step="0.01"></div>
<div class="fg"><label>سعر الشراء (اختياري)</label><input type="number" id="quickStockPrice" value="${item.avgCost}" step="0.01"></div>
<div class="fg"><label>تاريخ الصلاحية</label><input type="date" id="quickStockExpiry"><small class="text-muted">اختياري — إن أُدخل فيجب أن يكون YYYY-MM-DD</small></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="confirmQuickStockIn" data-karim-arg0="${item.id}"><i class=ji data-i=save></i> إضافة للمخزون</button></div>`);
setTimeout(()=>{ document.getElementById('quickStockQty')?.focus(); document.getElementById('quickStockQty')?.select(); },50);
}
async function confirmQuickStockIn(itemId){
if(confirmQuickStockIn._busy){return;}
const item=STATE.inventory.find(i=>i.id===itemId);
if(!item) {return;}
const qty=parseFloat(document.getElementById('quickStockQty')?.value)||0;
const price=parseFloat(document.getElementById('quickStockPrice')?.value)||item.avgCost;
const expiryRaw=document.getElementById('quickStockExpiry')?.value||'';
if(qty<=0){ toast('أدخل كمية صحيحة','error'); return; }
const expiryDate=requireExpiryDate(expiryRaw, qty, item.name);
if(expiryDate === null) {return;}
confirmQuickStockIn._busy=true;
const oldValue=item.qty*item.avgCost;
const newValue=qty*price;
const newQty=item.qty+qty;
const newAvgCost=newQty>0?(oldValue+newValue)/newQty:price;
try{
const result = await apiFetch(`/warehouse/inventory/${encodeURIComponent(item.id)}/receipt`, {method:'POST',body:JSON.stringify({qty,price,unit:item.unit,expiryDate:expiryDate||null})});
Object.assign(item, result.inventory || {qty:newQty,avgCost:newAvgCost});
if(!STATE.inventoryTx){STATE.inventoryTx=[];}
if(result.transaction){STATE.inventoryTx.push(result.transaction);}
closeModal(); renderPage();
toast(`تم إضافة ${fN(qty)} ${item.unit} إلى ${item.name}`,'success');
addNotification('مسح مخزون',`تم إضافة ${fN(qty)} ${item.unit} لصنف ${item.name} عبر المسح`,'success');
}catch(e){ toast(e.message||'فشل تحديث المخزون في قاعدة البيانات','error'); }
finally{ confirmQuickStockIn._busy=false; }
}
async function addInventoryItem(){
if(addInventoryItem._busy){return;}
const name=document.getElementById('itemName')?.value.trim();
const category=document.getElementById('itemCategory')?.value.trim();
const barcode=document.getElementById('itemBarcode')?.value.trim()||'';
const unit=document.getElementById('itemUnit')?.value||'قطعة';
const minQty=parseFloat(document.getElementById('itemMinQty')?.value)||5;
const qty=parseFloat(document.getElementById('itemQty')?.value)||0;
const price=parseFloat(document.getElementById('itemPrice')?.value)||0;
const weight=parseFloat(document.getElementById('itemWeight')?.value)||0;
const shelfId=document.getElementById('itemShelf')?.value||null;
const expiryRaw=document.getElementById('itemExpiry')?.value||'';
if(!name){toast('أدخل اسم الصنف','error');return;}
if(STATE.inventory.find(i=>i.name===name)){toast('هذا الصنف موجود بالفعل','error');return;}
if(barcode && STATE.inventory.find(i=>i.barcode && i.barcode===barcode)){toast('هذا الباركود مستخدم لصنف آخر بالفعل','error');return;}
const expiryDate=requireExpiryDate(expiryRaw, qty, name);
if(expiryDate === null) {return;}
addInventoryItem._busy=true;
try{
const newItem = await persistCreate('inventory', (saved)=>STATE.inventory.push(saved), {id:uid(),name,category,unit,qty,avgCost:price,minQty,weight,shelfId,barcode,expiryDate:expiryDate||null});
if(qty>0){
if(!STATE.inventoryTx){STATE.inventoryTx=[];}
await persistCreate('inventoryTx', (saved)=>STATE.inventoryTx.push(saved), {id:uid(),itemId:newItem.id,itemName:name,qty:qty,type:'initial',date:today(),cost:price,totalValue:qty*price,notes:'رصيد افتتاحي'});
}
closeModal();renderPage();toast('تم إضافة الصنف','success');
}catch(e){ toast(e.message||'فشل حفظ الصنف في قاعدة البيانات','error'); }
finally{ addInventoryItem._busy=false; }
}
function editItem(id){
const item=STATE.inventory.find(i=>String(i.id)===String(id));
if(!item){return;}
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}" ${String(item.shelfId)===String(s.id)?'selected':''}>${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل الصنف</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="eiName" value="${esc(item.name)}"></div><div class="fg"><label>الفئة</label><input type="text" id="eiCategory" value="${esc(item.category||'')}"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="eiBarcode" value="${esc(item.barcode||'')}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" data-karim-action="scanForItemBarcodeField" data-karim-args="[&quot;eiBarcode&quot;]"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="eiUnit">${inventoryUnitOptions(item.unit)}</select><small class="text-muted">يجب أن تطابق وحدة السعر في الفاتورة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="eiMin" value="${item.minQty}" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="eiWeight" value="${item.weight||0}" step="0.01"></div><div class="fg"><label>الرف</label><select id="eiShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r)">
<div>الكمية الحالية: <strong class="c-gold">${fN(item.qty)} ${item.unit}</strong></div>
<div>متوسط السعر: <strong class="c-gold">${fC(item.avgCost)}</strong></div>
</div>
${STATE.currentUser?.role === 'admin' ? `
<div style="background:rgba(231,76,60,.06);padding:12px;margin:12px 0;border-radius:var(--r);border:1px dashed var(--red)">
<strong style="font-size:13px;color:var(--red)"><i class=ji data-i=crown></i> صلاحية الأدمن المطلقة — تعديل مباشر</strong>
<small class="text-muted" style="display:block;margin:4px 0 8px">تعديل الكمية والتكلفة مباشرة بقيد تسوية جرد موثق في الدفتر — يُسجَّل باسمك مع السبب.</small>
<div class="fr">
<div class="fg"><label>الكمية الجديدة</label><input type="number" id="eiAdminQty" value="${item.qty}" step="0.001" min="0"></div>
<div class="fg"><label>متوسط التكلفة الجديد</label><input type="number" id="eiAdminCost" value="${item.avgCost}" step="0.01" min="0"></div>
</div>
<div class="fg"><label>سبب التعديل (يُوثَّق في الدفتر)</label><input type="text" id="eiAdminReason" placeholder="مثال: تسوية جرد فعلي / تصحيح إدخال"></div>
<button type="button" class="btn btn-red btn-sm" data-karim-action="adminDirectEdit" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=save></i> حفظ التعديل المباشر</button>
</div>` : ''}
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r);border:1px dashed var(--border)">
<strong style="font-size:13px"><i class=ji data-i=repeat></i> وحدات طلب ثانوية</strong>
<small class="text-muted" style="display:block;margin:4px 0 8px">لو الأقسام تطلب الصنف بوحدة مختلفة (شكارة، كرتون، صاع...) سجلها هنا مع محتواها — مثال: شكارة أرز = 50 كجم. عند طلب الصرف بالشكارة يتحوّل المبلغ تلقائيًا لوحدة المخزن.</small>
<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">${['صاع','شكارة','كرتون','كيس','جوال','دزينة','علبة'].map(u=>`<button type="button" class="btn btn-sm" style="padding:3px 10px" data-karim-action="addSecUnitPreset" data-karim-arg0="${esc(u)}">${esc(u)}</button>`).join('')}<small class="text-muted" style="align-self:center">اضغط لإضافة الوحدة بسرعة ثم اكتب محتواها</small></div>
<div id="secUnitsRows"></div>
<button type="button" class="btn btn-blue btn-sm" data-karim-action="addSecUnitRow"><i class=ji data-i=plus></i> إضافة وحدة</button>
</div>
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r);border:1px dashed var(--border)">
<strong style="font-size:13px"><i class=ji data-i=scale></i> الوزن المتغير — استلام بالكيلو وصرف بالكرتون</strong>
<small class="text-muted" style="display:block;margin:4px 0 8px">لأصناف اللحوم: المطبخ يطلب بعدد الكراتين، والمخزن يصرف بالوزن الفعلي بالكيلو. حدد متوسط وزن الكرتون ليُقدَّر الطلب تلقائيًا.</small>
<label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer"><input type="checkbox" id="eiCatch" ${item.catch_weight_enabled?'checked':''}> تفعيل الوزن المتغير لهذا الصنف</label>
<div class="fr" style="margin-top:8px">
<div class="fg"><label>وحدة التعبئة (الطلب)</label><input type="text" id="eiPkgUom" value="${esc(item.packaging_uom||'كرتون')}"></div>
<div class="fg"><label>متوسط وزن التعبئة (كجم)</label><input type="number" id="eiPkgFactor" value="${item.packaging_qty_per_base??''}" step="0.001" min="0" placeholder="مثال: 25"></div>
</div>
</div>
<div class="modal-footer"><button type="button" class="btn btn-red" data-karim-action="deleteItem" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=trash></i> حذف</button><button type="button" class="btn" data-karim-action="closeModal">إلغاء</button><button type="button" class="btn btn-gold" data-karim-action="updateInventoryItem" data-karim-arg0="${esc(String(id))}"><i class=ji data-i=save></i> حفظ</button></div>`);
try{ (Array.isArray(item.secondary_units)?item.secondary_units:[]).forEach(u=>addSecUnitRow(u.uom,u.factor)); }catch(_){}
}
// ─── محرر وحدات الطلب الثانوية ───
function addSecUnitRow(uom='', factor=''){
const box=document.getElementById('secUnitsRows');
if(!box){return;}
const div=document.createElement('div');
div.className='fr sec-unit-row';
div.style.cssText='align-items:end;margin-top:6px;gap:6px';
div.innerHTML=`<div class="fg" style="flex:1"><label>اسم الوحدة</label><input type="text" class="sec-uom" value="${esc(String(uom||''))}" placeholder="شكارة، كرتون، صاع..."></div>
<div class="fg" style="flex:1"><label>محتواها من الوحدة الأساسية</label><input type="number" class="sec-factor" value="${esc(String(factor||''))}" step="0.001" min="0.001" placeholder="50"></div>
<button type="button" class="btn btn-red btn-sm" data-karim-action="this.parentElement.remove" title="حذف الوحدة"><i class=ji data-i=x></i></button>`;
box.appendChild(div);
return div;
}
// إضافة وحدة جاهزة بالضغط (صاع/شكارة/كرتون...) ثم التركيز على حقل المحتوى
function addSecUnitPreset(uom){
const row=addSecUnitRow(uom,'');
if(row){row.querySelector('.sec-factor')?.focus();}
}
function collectSecUnits(){
const rows=[...document.querySelectorAll('#secUnitsRows .sec-unit-row')];
const out=[];
for(const r of rows){
const uom=String(r.querySelector('.sec-uom')?.value||'').trim();
const factor=parseFloat(r.querySelector('.sec-factor')?.value);
if(!uom||!(factor>0)){continue;}
out.push({uom,factor});
}
return out;
}
// ─── صلاحية الأدمن المطلقة: تعديل مباشر للكمية/التكلفة بقيد تسوية موثق ───
async function adminDirectEdit(id){
const qtyRaw=document.getElementById('eiAdminQty')?.value;
const costRaw=document.getElementById('eiAdminCost')?.value;
const reason=document.getElementById('eiAdminReason')?.value.trim()||'';
const qty=parseFloat(qtyRaw), cost=parseFloat(costRaw);
if(!Number.isFinite(qty)||qty<0){toast('اكتب كمية صحيحة ≥ صفر','error');return;}
if(!Number.isFinite(cost)||cost<0){toast('اكتب تكلفة صحيحة ≥ صفر','error');return;}
if(!reason){toast('اكتب سبب التعديل — يُوثَّق في الدفتر','error');return;}
const item=STATE.inventory.find(i=>String(i.id)===String(id));
if(!item){return;}
if(!confirm(`تعديل مباشر لـ "${item.name}":\nالكمية ${fN(item.qty)} → ${fN(qty)}\nالتكلفة ${fC(item.avgCost)} → ${fC(cost)}\n\nسيُقيَّد الفرق في دفتر المخزون باسمك.`)){return;}
try{
showLoad();
const saved=await apiFetch(`/warehouse/inventory/${encodeURIComponent(id)}/direct`,{method:'PUT',body:JSON.stringify({qty,avgCost:cost,reason})});
Object.assign(item, saved.item||{});
closeModal();renderPage();
toast(`تم التعديل المباشر — الفرق ${fN(Math.abs(saved.delta||0))} ${item.unit} قُيِّد في الدفتر`,'success');
}catch(e){ toast(e.message||'فشل التعديل المباشر','error'); }
finally{ hideLoad(); }
}

async function updateInventoryItem(id){
const item=STATE.inventory.find(i=>String(i.id)===String(id));
if(!item){return;}
const barcode=document.getElementById('eiBarcode')?.value.trim()||'';
if(barcode && STATE.inventory.find(i=>String(i.id)!==String(id) && i.barcode && i.barcode===barcode)){toast('هذا الباركود مستخدم لصنف آخر بالفعل','error');return;}
const name=document.getElementById('eiName')?.value.trim();
const category=document.getElementById('eiCategory')?.value.trim();
const unit=document.getElementById('eiUnit')?.value||'قطعة';
const minQty=parseFloat(document.getElementById('eiMin')?.value)||5;
const weight=parseFloat(document.getElementById('eiWeight')?.value)||0;
const shelfId=document.getElementById('eiShelf')?.value||null;
const secUnits=collectSecUnits();
try{
const eiCatch=document.getElementById('eiCatch');
const catchEnabled=eiCatch?eiCatch.checked:Boolean(item.catch_weight_enabled);
const pkgUom=document.getElementById('eiPkgUom')?.value.trim()||'كرتون';
const pkgFactorRaw=document.getElementById('eiPkgFactor')?.value;
const pkgFactor=(pkgFactorRaw===''||pkgFactorRaw===undefined||pkgFactorRaw===null)?null:parseFloat(pkgFactorRaw);
const saved = await persistUpdate('inventory', id, {name,category,barcode,unit,minQty,weight,shelfId,qty:item.qty,avgCost:item.avgCost,secondary_units:secUnits.length?secUnits:null,catch_weight_enabled:catchEnabled,packaging_uom:catchEnabled?pkgUom:(item.packaging_uom||null),packaging_qty_per_base:(catchEnabled&&pkgFactor>0)?pkgFactor:null});
Object.assign(item, saved || {name,category,barcode,unit,minQty,weight,shelfId,secondary_units:secUnits.length?secUnits:null,catch_weight_enabled:catchEnabled,packaging_uom:catchEnabled?pkgUom:null,packaging_qty_per_base:(catchEnabled&&pkgFactor>0)?pkgFactor:null});
closeModal();renderPage();toast(secUnits.length?`تم التحديث — وحدات الطلب: ${secUnits.map(u=>u.uom).join('، ')}`:'تم التحديث','success');
}catch(e){ toast(e.message||'فشل تحديث الصنف في قاعدة البيانات','error'); }
}
async function deleteItem(id, force){
id=String(id);
const item=(STATE.inventory||[]).find(i=>String(i.id)===String(id));
if(!force && !confirm(`حذف الصنف "${item?.name||id}"؟`)){return;}
if(force && !confirm(`حذف نهائي لـ "${item?.name||id}" مع كل حركاته وسجلاته؟\nلا يمكن التراجع — سجلات هذا الصنف ستُمحى من الدفاتر.`)){return;}
try{
if(force) {await apiFetch(`/warehouse/inventory/${encodeURIComponent(id)}/force`,{method:'DELETE'});}
else {await persistRemove('inventory', id);}
STATE.inventory=STATE.inventory.filter(i=>String(i.id)!==String(id));
if(STATE.inventoryTx){STATE.inventoryTx=STATE.inventoryTx.filter(tx=>String(tx.itemId)!==String(id));}
closeModal();renderPage();toast(force?'تم الحذف النهائي مع الحركات':'تم الحذف','warning');
}catch(e){
const m=String(e.message||'');
if(!force&&(m.includes('INVENTORY_HAS_MOVEMENTS')||m.includes('حركات مخزون'))){
if(confirm(`"${item?.name||id}" له حركات مخزون.\nهل تريد الحذف النهائي مع كل حركاته وسجلاته؟ (لا يمكن التراجع)`)) {return deleteItem(id,true);}
return;
}
if(m.includes('violates foreign key')||m.includes('23503'))
{toast('لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر','error');}
else {toast(m||'فشل الحذف من قاعدة البيانات','error');}
}
}
// Purchase Invoice
let currentInvoiceItems = [];
let currentEditingInvoiceId = null;
let invoicePaidTouched = false; // لمس المستخدم حقل المسدد يدويًا؟ (لا → الخادم يحسم الشامل تلقائيًا)
// ═══ حذف كل فواتير الشراء (أدمن فقط) — نافذة تحذير + تأكيد صريح ═══
function showClearAllInvoicesModal(){
if(STATE.currentUser?.role!=='admin'){ toast('هذه العملية للأدمن فقط','error'); return; }
const n=(STATE.purchaseInvoices||[]).length;
if(!n){ toast('لا توجد فواتير لحذفها','info'); return; }
showModal(`<h3><i class=ji data-i=trash></i> حذف كل فواتير الشراء (${fN(n)})</h3>
<div class="workflow-banner" style="background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.35)"><i class=ji data-i=alert-triangle></i> <strong>عملية نهائية لا يمكن التراجع عنها:</strong> ستُحذف الفواتير الـ ${fN(n)} كلها، وسيتم <strong>عكس كمياتها من المخزون</strong> (الاستلام كان يزيد الرصيد — الحذف ينقصه)، وستُحذف حركات المخزون المرتبطة بها. خذ نسخة احتياطية أولًا من الإعدادات.</div>
<label style="display:flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:10px 0"><input type="checkbox" id="clearInvConfirm" onchange="document.getElementById('clearInvBtn').disabled=!this.checked"> أفهم أن هذه العملية نهائية وتعكس كميات المخزون</label>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" id="clearInvBtn" disabled data-karim-action="clearAllInvoices"><i class=ji data-i=trash></i> حذف كل الفواتير نهائيًا</button></div>`);
}
async function clearAllInvoices(){
try{
showLoad();
const result=await apiFetch('/warehouse/purchase-invoices/clear-all',{method:'POST',body:JSON.stringify({confirm:'حذف كل الفواتير'})});
hideLoad(); closeModal();
STATE.purchaseInvoices=[]; STATE.inventoryTx=[];
renderPage();
toast(`تم حذف ${fN(result.deletedInvoices||0)} فاتورة وعكس ${fN(result.reversedLedgerRows||0)} قيد مخزون`,'success');
}catch(e){ hideLoad(); toast(e.message||'تعذر حذف الفواتير','error'); }
}
function showAddPurchaseInvoiceModal(invoiceId){
const editing=(STATE.purchaseInvoices||[]).find(inv=>String(inv.id)===String(invoiceId));
if(invoiceId&&!editing){toast('الفاتورة غير موجودة','error');return;}
if(editing&&Number(editing.paidAmount||0)>0){toast('لا يمكن تعديل فاتورة عليها دفعة مسجلة؛ اعكس الدفعة رسميًا أولًا','error');return;}
currentEditingInvoiceId=editing?String(editing.id):null;
currentInvoiceItems = [];
invoicePaidTouched = false;
if(editing){
let oldItems=editing.items;
if(typeof oldItems==='string'){try{oldItems=JSON.parse(oldItems);}catch(_){oldItems=[];}}
currentInvoiceItems=(Array.isArray(oldItems)?oldItems:[]).map(item=>({
id:uid(),itemId:item.itemId||item.item_id||null,itemName:item.itemName||item.name||'',
qty:Number(item.qty)||0,price:Number(item.price)||0,total:Number(item.total)||0,
unit:item.unit||'وحدة',weight:item.weight??'',taxCategory:item.taxCategory||item.tax_category||'STANDARD',
packagingQty:item.packagingQty??item.packaging_qty??null,packagingUom:item.packagingUom||item.packaging_uom||null,
expiryDate:normExpiryDate(item.expiryDate ?? item.expiry_date) || '',
}));
currentInvoiceItems.forEach(item=>{item.total=Math.round((item.qty*item.price+Number.EPSILON)*100)/100;});
invoicePaidTouched=true;
}
renderInvoiceItemsList();
showModal(`
<h3><i class=ji data-i=file-text></i> فاتورة مشتريات جديدة</h3>
<div class="fr">
<div class="fg"><label>رقم الفاتورة</label><input type="text" id="invoiceNumber" placeholder="INV-001" value="${esc(editing?.invoiceNumber||'')}"></div>
<div class="fg"><label>تاريخ الفاتورة</label><input type="date" id="invoiceDate" value="${esc(String(editing?.date||today()).slice(0,10))}"></div>
</div>
<div class="fr">
<div class="fg"><label>المورد <small class="text-muted">(اختياري — يربط الفاتورة بالحساب)</small></label><select id="invoiceSupplierSel" data-karim-action="pcmtInvoiceSupplierChanged" data-karim-event="change"><option value="">بدون ربط (اسم حر)</option>${(STATE.suppliers||[]).filter(s=>s.is_active||String(s.id)===String(editing?.supplierId)).map(s=>`<option value="${esc(String(s.id))}" ${String(s.id)===String(editing?.supplierId)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div>
<div class="fg" id="invoiceSupplierNameWrap" style="display:none"><label>اسم المورد</label><input type="text" id="supplierName" data-karim-action="pcmtSupplierLinkHint" data-karim-event="input" value="${esc(editing?.supplierName||'')}"><small id="invoiceSupplierLinkHint" aria-live="polite"></small></div>
<div class="fg" id="invoiceSupplierPhoneWrap" style="display:none"><label>رقم الهاتف</label><input type="text" id="supplierPhone" value="${esc(editing?.supplierPhone||'')}"></div>
</div>
<div style="margin:16px 0">
<div style="font-weight:700;margin-bottom:12px"><i class=ji data-i=package></i> الأصناف</div>
<div id="invoiceItemsList"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" data-karim-action="addInvoiceItemRow"><i class=ji data-i=plus></i> إضافة صنف</button>
</div>
<div class="fr">
<div class="fg"><label>خصم الفاتورة</label><div style="display:flex;gap:8px"><select id="invoiceDiscountType" class="u-input" data-karim-action="updateInvoiceTotal" data-karim-event="change"><option value="none" ${!editing?.discount_type||editing.discount_type==='none'?'selected':''}>بدون خصم</option><option value="percent" ${editing?.discount_type==='percent'?'selected':''}>نسبة مئوية %</option><option value="amount" ${editing?.discount_type==='amount'?'selected':''}>مبلغ ثابت</option></select><input type="number" id="invoiceDiscountValue" min="0" step="0.01" value="${Number(editing?.discount_value||0)}" placeholder="قيمة الخصم" data-karim-action="updateInvoiceTotal" data-karim-event="input"></div><small id="invoiceDiscountHint" class="text-muted" aria-live="polite"></small></div>
<div class="fg"><label>إجمالي الفاتورة <small class="text-muted">(محسوب تلقائيًا)</small></label><input type="number" id="invoiceTotal" readonly aria-readonly="true" title="يُحسب تلقائيًا من كمية وسعر كل صنف" data-karim-action="focusInvoiceEntryField" style="background:var(--gold-d);color:var(--gold);font-weight:800;cursor:pointer"><small id="invoiceVatHint" class="text-muted" aria-live="polite"></small></div>
<div class="fg"><label>طريقة الدفع</label><select id="paymentMethod" data-karim-action="pcmtInvoicePaidChanged" data-karim-event="change"><option value="cash" ${editing?.paymentMethod==='cash'?'selected':''}>نقدي (مسدد)</option><option value="bank" ${editing?.paymentMethod==='bank'?'selected':''}>تحويل بنكي (مسدد)</option><option value="credit" ${editing?.paymentMethod==='credit'?'selected':''}>آجل (غير مسدد)</option><option value="card" ${editing?.paymentMethod==='card'?'selected':''}>بطاقة</option><option value="cheque" ${editing?.paymentMethod==='cheque'?'selected':''}>شيك</option></select></div>
</div>
<div class="fr">
<div class="fg"><label>المسدد الآن</label><input type="number" id="invoicePaidAmount" step="0.01" min="0" value="${Number(editing?.paidAmount||0).toFixed(2)}" data-karim-action="pcmtInvoicePaidChanged" data-karim-event="input" data-karim-args="[true]"><small class="text-muted">تلقائي = الشامل (نقدي) أو 0 (آجل) — يقبل الكسور حتى هللتين</small></div>
<div class="fg"><label>حالة السداد المتوقعة</label><div id="invoiceStatusPreview"><span class="badge bdg-red">غير مسددة</span></div></div>
</div>
<div class="fg"><label>ملاحظات</label><textarea id="invoiceNotes" rows="2">${esc(editing?.notes||'')}</textarea></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="savePurchaseInvoice"><i class=ji data-i=save></i> ${editing?'حفظ التعديلات':'حفظ الفاتورة'}</button></div>
`);
if(editing){pcmtInvoiceSupplierChanged();const paid=document.getElementById('invoicePaidAmount');if(paid){paid.value=Number(editing.paidAmount||0).toFixed(2);}pcmtInvoicePaidChanged(true);updateInvoiceTotal();}
}
function pcmtInvoiceSupplierChanged(){
    const sel=document.getElementById('invoiceSupplierSel'); if(!sel) {return;}
    const linked=String(sel.value)!=='';
    const nameWrap=document.getElementById('invoiceSupplierNameWrap');
    const phoneWrap=document.getElementById('invoiceSupplierPhoneWrap');
    if(nameWrap) {nameWrap.style.display=linked?'none':'';}
    if(phoneWrap) {phoneWrap.style.display=linked?'none':'';}
    pcmtSupplierLinkHint();
    updateInvoiceTotal();
    pcmtInvoicePaidChanged();
}
// تنبيه الربط الذكي: اسم حر يطابق موردًا مسجلًا ضريبيًا → زر ربط واحد
function pcmtSupplierLinkHint(){
    const hint=document.getElementById('invoiceSupplierLinkHint');
    const sel=document.getElementById('invoiceSupplierSel');
    if(!hint) {return;}
    hint.innerHTML='';
    if(!sel || String(sel.value)!=='') {return;} // مربوط بالفعل
    const typed=String(document.getElementById('supplierName')?.value||'').trim().toLowerCase();
    if(!typed) {return;}
    const match=(STATE.suppliers||[]).find(s=>s.is_active&&String(s.name||'').trim().toLowerCase()===typed
        &&String(s.tax_status||s.tax_registration_status||'').toUpperCase()==='REGISTERED');
    if(!match) {return;}
    hint.innerHTML=`«${esc(match.name)}» مسجل ضريبيًا (15%) — <button type="button" class="btn btn-gold btn-sm" data-karim-action="pcmtSupplierQuickLink" data-karim-arg0="${esc(String(match.id))}">اربط لتطبيق الضريبة</button>`;
}
function pcmtSupplierQuickLink(id){
    const sel=document.getElementById('invoiceSupplierSel');
    if(sel){sel.value=String(id);pcmtInvoiceSupplierChanged();}
}
function pcmtInvoicePaidChanged(fromInput){
    const paidEl=document.getElementById('invoicePaidAmount');
    const prev=document.getElementById('invoiceStatusPreview');
    if(!paidEl||!prev) {return;}
    if(fromInput){invoicePaidTouched=true;}
    const est=pcmtGrandEstimate();
    if(!fromInput&&!invoicePaidTouched){
        const method=document.getElementById('paymentMethod')?.value||'cash';
        paidEl.value=method==='credit'?'0':est.grand.toFixed(2);
    }
    const total=est.grand;
    const paidRaw=Number(paidEl.value||0);
    const paid=Math.min(Math.max(paidRaw,0),total);
    let badge;
    if(total<=0||paid>=total) {badge='<span class="badge bdg-green">مدفوعة</span>';}
    else if(paid<=0) {badge='<span class="badge bdg-red">غير مسددة</span>';}
    else {badge=`<span class="badge bdg-gold">مسددة جزئياً — متبقٍ ${fN(total-paid)}</span>`;}
    prev.innerHTML=badge;
}
// تقدير الشامل (مرآة حساب الخادم سطرًا بسطر — الخادم هو المرجع عند الحفظ)
function pcmtGrandEstimate(){
    const r2=v=>Math.round((Number(v)||0)*100)/100;
    const sel=document.getElementById('invoiceSupplierSel')?.value || '';
    const sup=sel?(STATE.suppliers||[]).find(s=>String(s.id)===String(sel)):null;
    const registered=!!sup&&String(sup.tax_status||sup.tax_registration_status||'').toUpperCase()==='REGISTERED';
    let net=0, vat=0;
    const grossLines=(currentInvoiceItems||[]).map(it=>r2((Number(it.qty)||0)*(Number(it.price)||0)));
    const subtotal=r2(grossLines.reduce((sum,value)=>sum+value,0));
    const discountType=document.getElementById('invoiceDiscountType')?.value||'none';
    const discountValue=Number(document.getElementById('invoiceDiscountValue')?.value||0);
    const discount=discountType==='percent'?r2(subtotal*Math.min(Math.max(discountValue,0),100)/100)
        :discountType==='amount'?Math.min(subtotal,r2(Math.max(discountValue,0))):0;
    let allocated=0;
    grossLines.forEach((gross,index)=>{
        const lineDiscount=index===grossLines.length-1?r2(discount-allocated)
            :(subtotal>0?r2(discount*gross/subtotal):0);
        allocated=r2(allocated+lineDiscount);
        const n=r2(gross-lineDiscount); net=r2(net+n);
        const it=currentInvoiceItems[index];
        const cat=String(it.taxCategory||'STANDARD').toUpperCase();
        const rate=(registered&&cat==='STANDARD')?15:0;
        vat=r2(vat+r2(n*rate/100));
    });
    return { net, vat, grand:r2(net+vat), registered, discount, subtotal };
}
function addInvoiceItemRow(){ currentInvoiceItems.push({id:uid(),itemName:'',itemId:null,qty:1,price:0,total:0,unit:'وحدة',weight:'',taxCategory:'STANDARD'}); renderInvoiceItemsList(); }
function removeInvoiceItemRow(index){ currentInvoiceItems.splice(index,1); renderInvoiceItemsList(); updateInvoiceTotal(); }
function updateInvoiceItem(index,field,value){
const item = currentInvoiceItems[index];
if(field==='itemName'){
const invItem = STATE.inventory.find(i=>i.name===value);
if(invItem){
item.itemName=invItem.name; item.itemId=invItem.id; item.unit=invItem.unit||'وحدة'; item.price=invItem.avgCost; item.weight='';
const priceInput=document.getElementById(`item_price_${index}`);
if(priceInput) {priceInput.value=invItem.avgCost;}
const unitInput=document.getElementById(`item_unit_${index}`);
if(unitInput) {unitInput.value=item.unit;}
}else{ item.itemName=value; }
}else if(field==='qty'){ item.qty=value===''?0:Number(value); }
else if(field==='unit'){ item.unit=String(value||'').trim()||'وحدة'; }
else if(field==='price'){ item.price=value===''?0:Number(value); }
else if(field==='taxCategory'){ item.taxCategory=['STANDARD','ZERO_RATED','EXEMPT','OUT_OF_SCOPE'].includes(value)?value:'STANDARD'; updateInvoiceTotal(); }
else if(field==='weight'){ item.weight=String(value||'').trim()===''?'':(parseFloat(value)||0); }
else if(field==='expiryDate'){ item.expiryDate=String(value||'').trim(); }
item.total = Math.round((item.qty * item.price + Number.EPSILON) * 100) / 100;
const totalEl=document.getElementById(`item_total_${index}`);
if(totalEl) {totalEl.innerHTML=fC(item.total);}
updateInvoiceTotal();
}
function updateInvoiceTotal(){
const totalInput=document.getElementById('invoiceTotal');
const estimate=pcmtGrandEstimate();
if(totalInput) {totalInput.value=estimate.grand.toFixed(2);}
const discountHint=document.getElementById('invoiceDiscountHint');
if(discountHint) {discountHint.textContent=`قبل الخصم ${fC(estimate.subtotal)} · الخصم ${fC(estimate.discount)}`;}
// تقدير ضريبي فوري (مرآة الخادم — هو المرجع عند الحفظ)
const hint=document.getElementById('invoiceVatHint');
if(hint){
    const est=pcmtGrandEstimate();
    if(est.registered&&est.vat>0){
        hint.innerHTML=`شامل الضريبة تلقائيًا: صافي ${fC(est.net)} + ضريبة 15% (${fC(est.vat)}) = شامل ${fC(est.grand)} — يُحسم عند الحفظ`;
    } else if (est.registered) {
        hint.innerHTML='المورد مسجل — لا ضريبة على هذه الأصناف (معفاة/صفرية)';
    } else {
        const sel=document.getElementById('invoiceSupplierSel')?.value || '';
        const sup=sel?(STATE.suppliers||[]).find(s=>String(s.id)===String(sel)):null;
        hint.innerHTML=sup?'المورد غير مسجل/معفى — لا ضريبة متوقعة':'بدون ربط مورد — لا ضريبة متوقعة';
    }
}
// حالة السداد التوقّعية تتبع الإجمالي الحي (النقدي يُسدد الشامل تلقائيًا)
pcmtInvoicePaidChanged();
}
function focusInvoiceEntryField(){
const firstEditable=document.querySelector('#invoiceItemsList input[type="number"]');
if(firstEditable){firstEditable.focus();firstEditable.select();toast('الإجمالي محسوب تلقائيًا؛ اكتب الكمية أو السعر في سطر الصنف','info');return;}
addInvoiceItemRow();
setTimeout(()=>{const next=document.querySelector('#invoiceItemsList input[type="number"]');if(next){next.focus();next.select();}},0);
}
function renderInvoiceItemsList(){
 const container=document.getElementById('invoiceItemsList');
 if(!container){return;}
 if(currentInvoiceItems.length===0){
  container.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);background:var(--bg3);border-radius:var(--r)"><i class=ji data-i=package></i> أضف صنفاً بالنقر على زر "إضافة صنف"</div>';
  return;
 }
 const unitOptions=['وحدة','كجم','كيلوجرام','جرام','شوال','كيس','علبة','كرتون','عبوة','لتر'].map(unit=>`<option value="${unit}"></option>`).join('');
 const rows=currentInvoiceItems.map((item,idx)=>{
  const inventoryOptions=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (${esc(i.unit||'وحدة')}) — ${fN(i.avgCost)} ${STATE.settings.currency}</option>`).join('');
  return `<div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-end;flex-wrap:wrap">
  <div style="flex:2;min-width:180px;position:relative"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><input type="text" id="item_name_${idx}" value="${esc(item.itemName)}" placeholder="ابحث عن صنف..." class="u-input" data-karim-action="updateInvoiceItem" data-karim-event="change" data-karim-args="[&quot;${idx}&quot;,&quot;itemName&quot;]" data-karim-pass="value" list="inventoryList${idx}"><datalist id="inventoryList${idx}">${inventoryOptions}</datalist></div>
  <div class="u-flex1" style="min-width:100px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input type="number" id="item_qty_${idx}" value="${item.qty}" step="0.001" min="0" placeholder="الكمية" class="u-input" data-karim-action="updateInvoiceItem" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;qty&quot;]" data-karim-pass="value"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوحدة</small><input type="text" id="item_unit_${idx}" value="${esc(item.unit||'وحدة')}" list="invoiceUnitOptions" placeholder="كجم / شوال / علبة" class="u-input" data-karim-action="updateInvoiceItem" data-karim-event="change" data-karim-args="[&quot;${idx}&quot;,&quot;unit&quot;]" data-karim-pass="value"></div>
  <div class="u-flex1" style="min-width:110px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوزن الإجمالي (كجم)</small><input type="number" id="item_weight_${idx}" value="${item.weight??''}" min="0" step="0.001" placeholder="اختياري" class="u-input" data-karim-action="updateInvoiceItem" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;weight&quot;]" data-karim-pass="value"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">سعر الوحدة</small><input type="number" id="item_price_${idx}" value="${item.price}" min="0" step="0.01" placeholder="السعر" class="u-input" data-karim-action="updateInvoiceItem" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;price&quot;]" data-karim-pass="value"></div>
  <div class="u-flex1" style="min-width:150px"><small style="display:block;margin-bottom:4px;color:var(--text3)">تاريخ الصلاحية</small><input type="date" id="item_expiry_${idx}" value="${esc(item.expiryDate||'')}" class="u-input" aria-label="تاريخ الصلاحية للصنف ${idx+1}" title="اختياري — YYYY-MM-DD" data-karim-action="updateInvoiceItem" data-karim-event="change" data-karim-args="[&quot;${idx}&quot;,&quot;expiryDate&quot;]" data-karim-pass="value"></div>
  <div class="u-flex1" style="min-width:110px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الفئة الضريبية</small><select class="u-input" aria-label="الفئة الضريبية للصنف" data-karim-action="updateInvoiceItem" data-karim-event="change" data-karim-args="[&quot;${idx}&quot;,&quot;taxCategory&quot;]" data-karim-pass="value">
  <option value="STANDARD" ${(item.taxCategory||'STANDARD')==='STANDARD'?'selected':''}>خاضع 15%</option>
  <option value="ZERO_RATED" ${item.taxCategory==='ZERO_RATED'?'selected':''}>صفري 0%</option>
  <option value="EXEMPT" ${item.taxCategory==='EXEMPT'?'selected':''}>معفى</option>
  <option value="OUT_OF_SCOPE" ${item.taxCategory==='OUT_OF_SCOPE'?'selected':''}>خارج النطاق</option>
  </select></div>
  <div style="flex:1;min-width:95px;text-align:center;font-weight:800;color:var(--gold)"><small style="display:block;margin-bottom:4px;color:var(--text3)">الإجمالي</small><span id="item_total_${idx}">${fC(item.total)}</span></div>
  <button type="button" data-karim-action="removeInvoiceItemRow" data-karim-arg0="${idx}" style="background:var(--red);color:white;border:none;border-radius:8px;padding:8px 12px;cursor:pointer" title="حذف الصنف"><i class=ji data-i=x></i></button>
  </div>`;
 }).join('');
 container.innerHTML=`<datalist id="invoiceUnitOptions">${unitOptions}</datalist><div class="text-muted" style="font-size:12px;margin-bottom:10px">الوحدة مرنة ويمكن كتابتها مثل: كجم، شوال، علبة أو كرتون. الوزن الإجمالي اختياري بالكيلوجرام. <strong>تاريخ الصلاحية اختياري، وإن أُدخل فيجب أن يكون بصيغة YYYY-MM-DD.</strong></div>${rows}`;
}
let _savingPurchaseInvoice = false;
async function savePurchaseInvoice(){
if(_savingPurchaseInvoice){ toast('جارٍ حفظ الفاتورة... انتظر','info'); return; }
const invoiceNumber = document.getElementById('invoiceNumber')?.value.trim() || `INV-${uid()}`;
const invoiceDate = document.getElementById('invoiceDate')?.value || today();
const supplierName = document.getElementById('supplierName')?.value.trim() || '';
const supplierPhone = document.getElementById('supplierPhone')?.value.trim() || '';
const supplierSel = document.getElementById('invoiceSupplierSel')?.value || '';
const paymentMethod = document.getElementById('paymentMethod')?.value || 'cash';
const paidAmountRaw = document.getElementById('invoicePaidAmount')?.value;
const notes = document.getElementById('invoiceNotes')?.value.trim() || '';
const validItems = currentInvoiceItems.filter(item=>item.itemName && item.qty>0 && item.price>=0);
if(validItems.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
if(currentInvoiceItems.some(item=>item.itemName&&(!Number.isFinite(Number(item.qty))||!Number.isFinite(Number(item.price))||Number(item.qty)<0||Number(item.price)<0))){toast('تحقق من إدخال كمية وسعر صحيحين لكل صنف','error');return;}
if(invoicePaidTouched&&paidAmountRaw!==''&&(!Number.isFinite(Number(paidAmountRaw))||Number(paidAmountRaw)<0)){toast('أدخل مبلغ سداد صحيحًا أو اتركه فارغًا','error');return;}
const discountType=document.getElementById('invoiceDiscountType')?.value||'none';
const discountValue=Number(document.getElementById('invoiceDiscountValue')?.value||0);
if(!Number.isFinite(discountValue)||discountValue<0||(discountType==='percent'&&discountValue>100)){toast('قيمة الخصم غير صحيحة','error');return;}
// سياسة 2026-10-20: تاريخ الصلاحية اختياري — نرفض فقط الصيغة الفاسدة (نفس رسالة الخادم).
const invalidExpiry=validItems.filter(item=>String(item.expiryDate??'').trim() && !normExpiryDate(item.expiryDate));
if(invalidExpiry.length){
    toast(`تاريخ الصلاحية غير صحيح للصنف ${invalidExpiry.slice(0,5).map(i=>i.itemName).join('، ')}${invalidExpiry.length>5?` (+${invalidExpiry.length-5} صنفًا)`:''} — الصيغة المطلوبة YYYY-MM-DD`,'error');
    const firstIdx=currentInvoiceItems.indexOf(invalidExpiry[0]);
    if(firstIdx>=0) {document.getElementById(`item_expiry_${firstIdx}`)?.focus();}
    return;
}
_savingPurchaseInvoice = true;
const _payload = {
invoiceNumber,date:invoiceDate,supplierName,supplierPhone,paymentMethod,notes,
supplierId:supplierSel||null,
discountType,discountValue,
// أوتوماتيك: لم يلمس المستخدم المسدد → الخادم يسدد الشامل (نقدي) أو صفر (آجل)
paidAmount:invoicePaidTouched&&(paidAmountRaw!==''&&paidAmountRaw!=null)?Number(paidAmountRaw):undefined,
items:validItems.map(item=>({...item,expiryDate:normExpiryDate(item.expiryDate)}))
};
try{
const editingId=currentEditingInvoiceId;
const result=await apiFetch(editingId?`/warehouse/purchase-invoices/${encodeURIComponent(editingId)}`:'/warehouse/purchase-invoices',{method:editingId?'PUT':'POST',body:JSON.stringify(_payload)});
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal();
currentEditingInvoiceId=null;
renderPage();
toast(editingId?'تم تحديث الفاتورة والمخزون والحسابات':'تم حفظ الفاتورة','success');
if(result.invoice?.supplierId){
try{await refreshProcurementData();}
catch(refreshError){toast('تم حفظ الفاتورة، لكن تعذر تحديث بيانات المورد الآن: '+String(refreshError.message||''),'warning');}
}
}catch(e){
const m = String(e.message||'تعذر حفظ فاتورة الشراء');
if(e.code==='DUPLICATE_INVOICE'||/مكرر|مشابهة|DUPLICATE/.test(m)){ toast('الفاتورة مسجلة بالفعل — لم تتكرر','info'); }
else { toast('تعذر الحفظ: '+m,'error'); }
}finally{ _savingPurchaseInvoice = false; }
}
// ═══ الرصيد الافتتاحي: إدخال سريع دفعة واحدة → فاتورة شراء آجلة على مورد الافتتاح ═══
let openingRows=[];
let openingImportPreview={rows:[],errors:[],fileName:''};
/* طلب المالك 2026-10-05: «عايز يتخصم أذونات الصرف من الرصيد الجديد» — الوضع الصافي:
   يكتب كمية بداية الفترة، والنظام يجيب المنصرف فعليًا من دفتر الصرف ويعين الرصيد الحالي = البداية − المنصرف */
const openingNet={on:false,issued:new Map(),loaded:false};
function openingNetEnabled(){return STATE.currentUser?.role==='admin';}
function openingIssuedFor(name){
return openingNet.on?(openingNet.issued.get(String(name||'').trim().toLowerCase())||0):0;
}
async function openingNetModeChanged(on){
openingNet.on=!!on;
if(openingNet.on&&!openingNet.loaded){
try{
const res=await apiFetch('/warehouse/issued-totals');
openingNet.issued=new Map((res.items||[]).map(r=>[String(r.itemName||'').trim().toLowerCase(),Number(r.issued)||0]));
openingNet.loaded=true;
}catch(e){
toast('تعذر حساب المنصرف من الدفتر: '+(e.message||''),'error');
openingNet.on=false; const el=document.getElementById('openingNetMode'); if(el){el.checked=false;}
return;
}
}
renderOpeningRows(); updateOpeningTotal();
const btn=document.getElementById('openingSaveBtn');
if(btn){btn.innerHTML=openingNet.on?'<i class=ji data-i=save></i> تعيين الأرصدة (خصم المنصرف تلقائيًا)':'<i class=ji data-i=save></i> حفظ الرصيد الافتتاحي';}
}
function refreshOpeningNetCells(idx){
if(!openingNet.on){return;}
const r=openingRows[idx]; if(!r){return;}
const issued=openingIssuedFor(r.name);
const net=Math.round(((parseFloat(r.qty)||0)-issued)*1000)/1000;
const iEl=document.getElementById(`openingIssued_${idx}`);
const nEl=document.getElementById(`openingNetQty_${idx}`);
if(iEl){iEl.textContent=fN(issued);}
if(nEl){nEl.textContent=fN(net); nEl.className=(net<0?'c-red fw-bold':'c-green fw-bold');}
}
function openingSupplier(){
return (STATE.suppliers||[]).find(s=>s.category==='افتتاحي'||/افتتاحي/.test(s.name||''))
|| { id:null, name:'رصيد افتتاحي - بداية الفترة' };
}
function showOpeningBalanceModal(){
openingRows=[{name:'',qty:'',unit:'كجم',price:'',boxes:'',category:'',expiry:''}];
renderOpeningRows();
const sup=openingSupplier();
showModal(`<h3><i class=ji data-i=flag></i> رصيد افتتاحي — بداية الفترة</h3>
<div class="workflow-banner"><i class=ji data-i=info></i> ادخل الجدول مباشرة: <strong>اسم الصنف • الوحدة • كمية فعلية • سعر الشراء • تاريخ الصلاحية</strong> — مفتاح <strong>Enter</strong> ينقلك بين الخلايا، وآخر صف ينشئ صفًا جديدًا. اللحوم أضف <strong>عدد الكراتين</strong>. <strong>تاريخ الصلاحية اختياري (YYYY-MM-DD).</strong> تُحفظ كفاتورة آجلة (مسدد 0) على المورد <strong>${esc(sup.name)}</strong> بلا حركة نقدية.</div>
${openingNetEnabled()?`<label style="display:flex;gap:10px;align-items:center;margin-top:10px;cursor:pointer;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:10px"><input type="checkbox" id="openingNetMode" data-karim-action="openingNetModeChanged" data-karim-event="change" data-karim-pass="checked"><span class="u-t13"><strong>الوضع الصافي (لإعادة ضبط الجداول):</strong> اكتب كمية <strong>بداية الفترة</strong>، والنظام يجيب المنصرف فعليًا من دفتر الصرف، ويخصمه تلقائيًا ويعيّن الرصيد الحالي = <strong>البداية − المنصرف</strong></span></label>`:''}
<div id="openingExisting" class="u-my8"></div>
<div class="callout-blue u-my16"><div class="fw-bold"><i class=ji data-i=file-text></i> إدخال احترافي من Excel</div><div class="text-muted u-t12 u-my8">حمّل النموذج، املأ الأصناف، ثم ارفع الملف لمراجعته قبل إضافته للفاتورة.</div><div class="u-row-wrap"><button type="button" class="btn btn-blue btn-sm" data-karim-action="downloadOpeningTemplate"><i class=ji data-i=arrow-down></i> تحميل النموذج</button><label class="btn btn-green btn-sm" style="cursor:pointer"><i class=ji data-i=inbox></i> رفع شيت Excel<input type="file" id="openingExcelFile" accept=".xlsx,.xls,.csv" style="display:none" data-karim-action="previewOpeningExcel" data-karim-event="change" data-karim-args="[this.files[0]]"></label></div><div id="openingImportPreview" class="u-mt8"></div></div>
<div id="openingRows" style="margin-top:12px"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" data-karim-action="addOpeningRow"><i class=ji data-i=plus></i> إضافة صف</button>
<div class="callout-gold u-my16"><div class="fw-bold">إجمالي الرصيد الافتتاحي</div><div class="callout-value" id="openingTotal">${fC(0)}</div></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" id="openingSaveBtn" data-karim-action="saveOpeningBalance"><i class=ji data-i=save></i> حفظ الرصيد الافتتاحي</button></div>`);
renderOpeningRows();
updateOpeningTotal();
loadOpeningExisting();
}
/* طلب المالك 2026-10-05: «أعيد الرصيد الافتتاحي مرة أخرى وأحذف القديم بس اخصم من الرصيد طلبات الصرف» —
   عرض الأرصدة الافتتاحية المسجلة مع زر استبدال: إلغاء القديم (يعكس استلامه فقط — الصرف يبقى محسوبًا) ثم حفظ الجديد */
async function loadOpeningExisting(){
const box=document.getElementById('openingExisting'); if(!box) {return;}
try{
const res=await apiFetch('/warehouse/opening-balance/report');
const invoices=Array.isArray(res.invoices)?res.invoices:[];
if(!invoices.length){ box.innerHTML='<div class="u-t12 text-muted">لا يوجد رصيد افتتاحي مسجل بعد — أدخله في الجدول بالأسفل.</div>'; return; }
box.innerHTML=`<div class="callout" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:10px"><div class="fw-bold u-t13"><i class=ji data-i=history></i> أرصدة افتتاحية مسجلة (${fN(invoices.length)})</div>${invoices.map(inv=>`<div class="u-row-between u-mt8" style="gap:8px;flex-wrap:wrap"><span class="u-t12"><strong>${esc(inv.invoiceNumber)}</strong> · ${esc(inv.date||'')} · ${fN(inv.items.length)} صنف · ${fC(inv.totalAmount)}</span><button type="button" class="btn btn-orange btn-sm" onclick="showOpeningBalanceReplaceGrid(${JSON.stringify(inv).replace(/"/g,'&quot;')})"><i class=ji data-i=rotate-ccw></i> استبدال وإعادة إدخال</button></div>`).join('')}<div class="u-t11 text-muted u-mt8">الاستبدال يلغي القديم ويعكس استلامه فقط — <strong>طلبات الصرف تبقى محسوبة</strong>، ثم تدخل الكميات الصحيحة.</div></div>`;
}catch(e){ box.innerHTML=`<div class="u-t12 text-muted">تعذر تحميل الأرصدة المسجلة: ${esc(e.message||'')}</div>`; }
}
function downloadOpeningTemplate(){
const data=[['اسم الصنف','الوحدة','كمية فعلية','سعر الشراء','الكراتين','الفئة','تاريخ الصلاحية'],['دجاج','50','كجم','25','4','لحوم','2026-11-30'],['مشروم','12','علبة','18','','معلبات','2027-02-28'],['دقيق','20','كيس','3.5','','حبوب','2027-06-30']];
const ws=XLSX.utils.aoa_to_sheet(data); ws['!cols']=[{wch:24},{wch:16},{wch:16},{wch:12},{wch:18},{wch:14},{wch:18}];
const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'الرصيد الافتتاحي');
XLSX.writeFile(wb,`نموذج_الرصيد_الافتتاحي_${today()}.xlsx`); toast('تم تحميل نموذج الرصيد الافتتاحي','success');
}
function openingHeaderKey(value){
// تطبيع قوي: مسافات/شرطات + همزات + تاء مربوطة/هاء + ألف مقصورة — حتى يطابق «كمية فعلية» بأي كتابة
return String(value||'').trim().toLowerCase().replace(/[\s_()\-\u00a0\t]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي');
}
/* طلب المالك 2026-10-05: شيت Excel بأعمدة «اسم الصنف | الوحدة | كمية فعلية | سعر الشراء» كان يُرفض
   لأن المدقق يدور على «الكمية» فقط — الآن: أسماء أعمدة متعددة (بما فيها كمية فعلية) + يجرب أول
   3 صفوف كصف عناوين (لو في عنوان ورقة فوق الجدول) + رسالة الخطأ تطبع أعمدة الملف الفعلية */
/* خلية صلاحية من ورقة Excel: نص YYYY-MM-DD، أو Date، أو رقم تسلسي (XLSX يقرأ
   التواريخ أرقامًا بلا cellDates). لا تاريخ يُخترع — كل صورة غير مفهومة تعود null. */
function openingExpiryCell(v){
if(v instanceof Date) {return normExpiryDate(v);}
if(typeof v==='number'&&Number.isFinite(v)&&v>20&&v<60000) {return normExpiryDate(new Date(Math.round((v-25569)*86400000)).toISOString());}
return normExpiryDate(v);
}
function parseOpeningSheetRows(data){
const headersOf=(row)=> (row||[]).map(openingHeaderKey);
let found=null;
for(let h=0; h<Math.min(3, data.length); h++){
const headers=headersOf(data[h]);
const findHeader=names=>{const keys=names.map(openingHeaderKey); return headers.findIndex(x=>keys.includes(x));};
const fuzzy=subs=>headers.findIndex(x=>subs.some(s=>String(x).includes(s)));
const nameIdx=findHeader(['اسم الصنف','الصنف','اسم','item','name']);
let qtyIdx=findHeader(['الكميه','كميه','كميهفيعليه','الكميهفيعليه','كميهفعليه','الكميهفعليه','qty','quantity']);
if(qtyIdx<0){ qtyIdx=fuzzy(['كميه','كم','qty','quantity']); }
const unitIdx=findHeader(['الوحده','وحده','unit','uom']);
const priceIdx=findHeader(['سعر الشراء','سعر','التكلفه','price','cost']);
const boxesIdx=findHeader(['الكراتين','كراتين','عدد الكراتين','boxes','cartons']);
const categoryIdx=findHeader(['الفئه','التصنيف','فئه','category','cat']);
let expiryIdx=findHeader(['تاريخ الصلاحية','الصلاحية','تاريخ الانتهاء','expiry','expiry_date','bestBefore','best_before']);
if(expiryIdx<0){ expiryIdx=fuzzy(['صلاحيه','انتهاء','expiry','bestbefore']); }
if(nameIdx>=0&&qtyIdx>=0&&priceIdx>=0){ found={headerRow:h, nameIdx, qtyIdx, unitIdx, priceIdx, boxesIdx, categoryIdx, expiryIdx}; break; }
}
if(!found){
const seen=(data[0]||[]).map(x=>String(x).trim()).filter(Boolean).join(' ، ');
return { rows:[], errors:[{line:'—', message:'لم أتعرف على أعمدة الملف. الأعمدة الموجودة: ' + (seen||'(فارغة)') + ' — المطلوب وجود: اسم الصنف، كمية فعلية، سعر الشراء'}], headerRow:-1 };
}
const {headerRow, nameIdx, qtyIdx, unitIdx, priceIdx, boxesIdx, categoryIdx, expiryIdx}=found;
const rows=[], errors=[];
data.slice(headerRow+1).forEach((row,index)=>{
const line=headerRow+2+index;
const name=String(row[nameIdx]||'').trim(), qty=Number(row[qtyIdx]), price=Number(row[priceIdx]);
const rawBoxes=boxesIdx>=0?String(row[boxesIdx]??'').trim():'';
const rawExpiry=expiryIdx>=0?row[expiryIdx]:'';
const hasExpiryCell=rawExpiry!==''&&rawExpiry!=null;
const expiry=hasExpiryCell?openingExpiryCell(rawExpiry):null;
if(!name&&!rawBoxes&&!String(row[qtyIdx]??'').trim()&&!String(row[priceIdx]??'').trim()){return;}
const rowErrors=[];
if(!name){rowErrors.push('اسم الصنف مفقود');}
if(!Number.isFinite(qty)||qty<=0){rowErrors.push('الكمية يجب أن تكون أكبر من صفر');}
if(!Number.isFinite(price)||price<0){rowErrors.push('سعر الشراء غير صحيح');}
if(hasExpiryCell&&!expiry){rowErrors.push('تاريخ الصلاحية غير صحيح — الصيغة YYYY-MM-DD');}
let boxes=null;
if(rawBoxes!==''){boxes=Number(rawBoxes); if(!Number.isInteger(boxes)||boxes<=0){rowErrors.push('الكراتين عدد صحيح أكبر من صفر');}}
if(boxes!==null&&isOpeningMeatRow({name,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()})===false){rowErrors.push('الكراتين مسموحة لأصناف اللحوم فقط');}
if(rowErrors.length){errors.push({line,message:rowErrors.join('،')}); return;}
rows.push({name,qty,unit:String(unitIdx>=0?row[unitIdx]||'':'').trim()||'كجم',price,boxes,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()||'عام',expiry:expiry||''});
});
return {rows, errors, headerRow};
}
function previewOpeningExcel(file){
if(!file){return;}
const reader=new FileReader();
reader.onload=e=>{
try{
const wb=window.XLSXGuard.readWorkbook(e.target.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
if(data.length<2){throw new Error('الملف لا يحتوي على صفوف بيانات بعد عناوين الأعمدة');}
const parsed=parseOpeningSheetRows(data);
if(parsed.headerRow<0){throw new Error(parsed.errors[0].message);}
openingImportPreview={rows:parsed.rows,errors:parsed.errors,fileName:file.name}; renderOpeningImportPreview();
}catch(error){openingImportPreview={rows:[],errors:[{line:'—',message:error.message||'تعذر قراءة الملف'}],fileName:file.name}; renderOpeningImportPreview();}
};
reader.readAsArrayBuffer(file);
}
function renderOpeningImportPreview(){
const el=document.getElementById('openingImportPreview'); if(!el){return;}
const p=openingImportPreview;
if(!p.fileName){el.innerHTML=''; return;}
const noExpiry=p.rows.filter(r=>!normExpiryDate(r.expiry)).length;
const expiryHint=noExpiry?`<div class="text-muted u-t12 u-my8"><i class=ji data-i=info></i> ${noExpiry} صفاً بلا تاريخ صلاحية — سيُحفظ بدون صلاحية (اختياري).</div>`:'';
el.innerHTML=`<div class="u-t12"><strong>${esc(p.fileName)}</strong> — ${p.rows.length} صف صالح${p.errors.length?`، <span class="c-red">${p.errors.length} صف يحتاج تصحيحًا</span>`:'، جاهز للإضافة'}</div>${expiryHint}${p.errors.length?`<div class="c-red u-t12 u-my8">${p.errors.slice(0,8).map(e=>`الصف ${e.line}: ${esc(e.message)}`).join('<br>')}${p.errors.length>8?'<br>...':''}</div>`:''}<button type="button" class="btn btn-green btn-sm u-mt8" onclick="appendOpeningImportRows()" ${p.rows.length?'':'disabled'}><i class=ji data-i=plus></i> إضافة ${p.rows.length} صف إلى الجرد</button>`;
}
function appendOpeningImportRows(){
if(!openingImportPreview.rows.length){toast('لا توجد صفوف صالحة للإضافة','error'); return;}
openingRows=openingRows.filter(r=>r.name||r.qty||r.price||r.category||r.boxes);
openingRows.push(...openingImportPreview.rows); openingImportPreview={rows:[],errors:[],fileName:''};
renderOpeningRows(); updateOpeningTotal(); renderOpeningImportPreview(); toast('تمت إضافة الصفوف الصحيحة إلى الجرد، راجعها قبل الحفظ','success');
}
/* طلب المالك 2026-10-05: «عايز اضبط قوائم الرصيد الافتتاحي مثل هذا أقدر أدخل الجدول» —
   جدول إدخال حقيقي بأعمدة: اسم الصنف | الوحدة | كمية فعلية | سعر الشراء (كانت بطاقات حقول مكدسة)،
   التنقل بين الخلايا بمفتاح Enter وآخر صف ينشئ صفًا جديدًا، وعمود الكراتين يظهر لأصناف اللحوم فقط.
   إصلاح جانبي: دوال هذه الشاشة لم تكن تُصدَّر من الموديول فكان الزر معطولًا منذ ترحيل ESM. */
function renderOpeningRows(){
const c=document.getElementById('openingRows'); if(!c){return;}
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (${esc(i.unit||'وحدة')})</option>`).join('');
const netCols=openingNet.on?`<th style="width:104px" title="مجموع ما صُرف فعليًا لهذا الصنف بأذون الصرف (من دفتر المخزون)">المنصرف فعليًا</th><th style="width:110px" title="الكمية التي ستُعتمد: بداية الفترة − المنصرف">الصافي المعتمد</th>`:'';
c.innerHTML=`<div class="tbl-scroll" style="max-height:46vh"><table style="min-width:620px"><thead><tr><th>اسم الصنف</th><th style="width:110px">الوحدة</th><th style="width:120px">كمية فعلية</th><th style="width:120px">سعر الشراء</th>${netCols}<th style="width:150px" title="YYYY-MM-DD — اختياري (سياسة 2026-10-20)">تاريخ الصلاحية</th><th style="width:104px" title="لأصناف اللحوم ذات الوزن المتغير فقط">كراتين</th><th style="width:44px"></th></tr></thead><tbody>
${openingRows.map((r,idx)=>{
const issued=openingNet.on?openingIssuedFor(r.name):0;
const net=openingNet.on?Math.round(((parseFloat(r.qty)||0)-issued)*1000)/1000:null;
const netCells=openingNet.on?`<td class="c-red" id="openingIssued_${idx}">${fN(issued)}</td><td class="${net<0?'c-red fw-bold':'c-green fw-bold'}" id="openingNetQty_${idx}">${fN(net)}</td>`:'';
return `<tr>
<td><input type="text" class="u-input" value="${esc(r.name)}" placeholder="اسم الصنف" list="openingInvList" data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;name&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}"></td>
<td><input type="text" id="openingUnit_${idx}" class="u-input" value="${esc(r.unit||'')}" placeholder="كجم، علبة..." data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;unit&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}"></td>
<td><input type="number" class="u-input" value="${r.qty}" min="0" step="0.001" placeholder="0" style="font-weight:700" data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;qty&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}"></td>
<td><input type="number" class="u-input" value="${r.price}" min="0" step="0.01" placeholder="0" data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;price&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}"></td>
${netCells}
<td><input type="date" id="openingExpiry_${idx}" class="u-input" value="${esc(r.expiry||'')}" aria-label="تاريخ الصلاحية للصنف ${idx+1}" data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;expiry&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}"></td>
<td>${openingBoxCell(idx, r)}</td>
<td><button type="button" class="btn btn-sm btn-red" data-karim-action="removeOpeningRow" data-karim-arg0="${idx}" title="حذف السطر"><i class=ji data-i=x></i></button></td>
</tr>`;}).join('')}
</tbody></table></div><datalist id="openingInvList">${invOpts}</datalist>`;
}
function openingBoxCell(idx, r){
const meat=isOpeningMeatRow(r);
return `<span class="text-muted" id="openingBoxDash_${idx}" style="display:${meat?'none':''}">—</span><input type="number" id="openingBoxes_${idx}" class="u-input" value="${r.boxes}" min="0" step="1" placeholder="—" data-karim-action="updateOpeningRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;boxes&quot;]" data-karim-pass="value" data-karim-action="openingRowKey" data-karim-event="keydown" data-karim-args="[event]" data-karim-arg0="${idx}" style="display:${meat?'':'none'}">`;
}
function isOpeningMeatRow(row){
// اسم الصنف أو فئته يوحي باللحوم الطازجة ذات الوزن المتغير — دجاج وفراخ مشمولان
return /لحوم|لحم|دجاج|فراخ|meat|chicken|beef/i.test(`${row?.name||''} ${row?.category||''}`);
}
function openingRowKey(e, idx){
// Enter: الخلية التالية في الصف → أول خلية في الصف التالي → وآخر صف ينشئ صفًا جديدًا
if(e.key!=='Enter'){return;}
e.preventDefault();
const rows=Array.from(document.querySelectorAll('#openingRows tbody tr'));
const rowEl=rows[idx]; if(!rowEl){return;}
const inputs=Array.from(rowEl.querySelectorAll('input')).filter(el=>el.style.display!=='none');
const pos=inputs.indexOf(e.target);
if(pos>-1&&pos<inputs.length-1){ inputs[pos+1].focus(); if(inputs[pos+1].select){inputs[pos+1].select();} return; }
if(idx>=openingRows.length-1){ addOpeningRow(); }
else { const first=rows[idx+1]?.querySelector('input'); if(first){first.focus(); if(first.select){first.select();}} }
}
function updateOpeningBoxesVisibility(idx){
const row=openingRows[idx]; if(!row){return;}
const meat=isOpeningMeatRow(row);
const input=document.getElementById(`openingBoxes_${idx}`); const dash=document.getElementById(`openingBoxDash_${idx}`);
if(input){input.style.display=meat?'':'none';}
if(dash){dash.style.display=meat?'none':'';}
if(!meat&&row.boxes!==''){
row.boxes='';
if(input){input.value='';}
}
}
function syncOpeningRowWithInventory(idx){
const row=openingRows[idx]; if(!row||!row.name){return;}
const item=(STATE.inventory||[]).find(i=>String(i.name||'').trim().toLowerCase()===String(row.name||'').trim().toLowerCase());
if(!item){return;}
if(item.unit){row.unit=String(item.unit); const unitEl=document.getElementById(`openingUnit_${idx}`); if(unitEl){unitEl.value=row.unit;}}
if(item.category){row.category=String(item.category); const categoryEl=document.getElementById(`openingCategory_${idx}`); if(categoryEl){categoryEl.value=row.category;}}
updateOpeningBoxesVisibility(idx);
}
function addOpeningRow(){
openingRows.push({name:'',qty:'',unit:'',price:'',boxes:'',category:'',expiry:''});
renderOpeningRows(); updateOpeningTotal();
const names=document.querySelectorAll('#openingRows tbody tr:last-child input[type="text"]');
if(names.length){names[0].focus();}
}
function removeOpeningRow(idx){ if(openingRows.length<=1){ openingRows[0]={name:'',qty:'',unit:'كجم',price:'',boxes:'',category:'',expiry:''}; } else { openingRows.splice(idx,1); } renderOpeningRows(); updateOpeningTotal(); }
function updateOpeningRow(idx,field,value){
const r=openingRows[idx]; if(!r){return;}
if(field==='name'||field==='unit'||field==='category'||field==='expiry'){ r[field]=String(value||''); }
else if(field==='qty'){ r.qty=value===''?'':(parseFloat(value)||0); }
else if(field==='price'){ r.price=value===''?'':(parseFloat(value)||0); }
else if(field==='boxes'){ r.boxes=value===''?'':(parseInt(value)||0); }
if(field==='name'){ syncOpeningRowWithInventory(idx); }
if(field==='name'||field==='category'){ updateOpeningBoxesVisibility(idx); }
refreshOpeningNetCells(idx);
updateOpeningTotal();
}
function updateOpeningTotal(){
const t=openingRows.reduce((s,r)=>s+((parseFloat(r.qty)||0)*(parseFloat(r.price)||0)),0);
const el=document.getElementById('openingTotal'); if(el){el.innerHTML=fC(t);}
}
/* تطبيع بنود الرصيد الافتتاحي — مشتركة بين الحفظ والاستبدال (نقية للاختبار) */
function normalizeOpeningItems(rows){
return (rows||[]).map(r=>({name:String(r.name||'').trim(),qty:parseFloat(r.qty)||0,unit:String(r.unit||'').trim()||'كجم',price:parseFloat(r.price)||0,boxes:r.boxes===''||r.boxes==null?null:(parseInt(r.boxes)||0),category:String(r.category||'').trim()||'عام',expiry:String(r.expiry||'').trim()}))
.filter(r=>r.name&&r.qty>0&&r.price>=0);
}
/* سياسة 2026-10-20: الرصيد الافتتاحي مدخلٌ للمخزون وتاريخ الصلاحية فيه اختياري.
   نرفض فقط الصيغة الفاسدة (INVALID_EXPIRY_DATE) — لا نمنع الحفظ لغياب التاريخ.
   @returns {string|null} رسالة تمنع الحفظ، أو null إذا سلمت كل البنود */
function openingExpiryError(items){
const invalid=[];
for(const r of (items||[])){
    const raw=String(r.expiry ?? '').trim();
    if(!raw || normExpiryDate(raw)) {continue;}
    invalid.push(r.name);
}
if(invalid.length){return `تاريخ الصلاحية غير صحيح للصنف ${invalid.slice(0,5).join('، ')} — الصيغة المطلوبة YYYY-MM-DD`;}
return null;
}
async function postOpeningInvoice(items){
const sup=openingSupplier();
const invoiceNumber=`OPEN-${today().replace(/-/g,'')}-${String(Math.floor(Math.random()*900)+100)}`;
return await apiFetch('/warehouse/purchase-invoices',{method:'POST',body:JSON.stringify({
invoiceNumber,date:today(),supplierName:sup.name,supplierPhone:'',paymentMethod:'credit',paidAmount:0,
notes:'رصيد افتتاحي بداية الفترة',supplierId:sup.id||null,
items:items.map(r=>({itemName:r.name,qty:r.qty,unit:r.unit,price:r.price,category:r.category,
expiryDate:normExpiryDate(r.expiry),
...(r.boxes?{packagingQty:r.boxes,packagingUom:'كرتون'}:{})}))
})});
}
/* حساب بنود الوضع الصافي: الصافي = البداية المعلنة − المنصرف فعليًا — يرفض البداية الأقل من المنصرف */
function resolveOpeningNetItems(items){
const resolved=[], negatives=[];
for(const it of items){
const issued=openingNet.issued.get(String(it.name||'').trim().toLowerCase())||0;
const net=Math.round((it.qty-issued)*1000)/1000;
if(net<0){ negatives.push({name:it.name,qty:it.qty,issued,net}); continue; }
// طلب المالك 2026-10-06: المطابقة بمفتاح مطبع (مسافات/همزات/تاء مربوطة) —
// كان الاسم بمسافة زايدة يفشل التطابق فيُنشأ صنف مكرر جديد بلا أي حركة
const key=mergeItemKey(it.name);
const invItem=(STATE.inventory||[]).find(i=>mergeItemKey(i.name)===key);
resolved.push({...it, invId:invItem?invItem.id:null, issued, net});
}
return {resolved,negatives};
}
async function saveOpeningNet(){
const items=normalizeOpeningItems(openingRows);
if(!items.length){ toast('أدخل صنفًا واحدًا على الأقل: اسم + كمية + سعر','error'); return; }
const expiryErr=openingExpiryError(items);
if(expiryErr){ toast(expiryErr,'error'); return; }
const {resolved,negatives}=resolveOpeningNetItems(items);
if(negatives.length){
toast(`المنصرف أكبر من البداية المعلنة لـ ${negatives.length} صنف (مثال: «${negatives[0].name}»: بداية ${fN(negatives[0].qty)} − منصرف ${fN(negatives[0].issued)}) — ارفع كمية البداية`,'error');
return;
}
if(!resolved.length){ toast('لا توجد أصناف للتعيين','error'); return; }
try{
showLoad();
let updated=0,created=0; const failed=[];
for(const it of resolved){
try{
if(it.invId){
// mainQty: الصافي يقع على المخزن الرئيسي تحديدًا — رصيد مخازن الأقسام يبقى كما هو
await apiFetch(`/warehouse/inventory/${encodeURIComponent(it.invId)}/direct`,{method:'PUT',body:JSON.stringify({mainQty:it.net,avgCost:it.price,reason:`تعيين رصيد افتتاحي صافي — بداية ${it.qty}، منصرف ${it.issued}`})});
updated++;
}else{
await persistCreate('inventory',(saved)=>STATE.inventory.push(saved),{id:uid(),name:it.name,category:it.category,unit:it.unit,qty:it.net,avgCost:it.price,minQty:0,expiryDate:normExpiryDate(it.expiry)});
created++;
}
}catch(e){ failed.push({name:it.name,message:e.message||''}); }
}
if(failed.length){ toast(`تعذر تعيين ${failed.length} صنف — أولها «${failed[0].name}»: ${failed[0].message}`,'error'); return; }
closeModal(); renderPage();
toast(`تم تعيين الرصيد الصافي: ${updated} صنفًا عُدل + ${created} جديد — المنصرف مخصوم تلقائيًا`,'success');
addNotification('رصيد افتتاحي صافي',`تعيين ${resolved.length} صنف: البداية المعلنة − المنصرف الفعلي`,'success');
}catch(e){ toast(e.message||'فشل تعيين الرصيد الصافي','error'); }
finally{ hideLoad(); }
}
async function saveOpeningBalance(){
if(openingNet.on){return saveOpeningNet();}
const items=normalizeOpeningItems(openingRows);
if(!items.length){ toast('أدخل صنفًا واحدًا على الأقل: اسم + كمية + سعر','error'); return; }
const expiryErr=openingExpiryError(items);
if(expiryErr){ toast(expiryErr,'error'); return; }
const bad=items.find(r=>r.boxes!==null&&!(r.boxes>0));
if(bad){ toast(`عدد الكراتين للصنف "${bad.name}" يجب أن يكون أكبر من صفر أو اتركه فارغًا`,'error'); return; }
try{
showLoad();
const result=await postOpeningInvoice(items);
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast(`تم حفظ الرصيد الافتتاحي: ${items.length} صنف بقيمة ${fC(result.totalAmount||0)}`,'success');
addNotification('رصيد افتتاحي',`تم إدخال ${items.length} صنف كرصيد بداية الفترة`,'success');
}catch(e){ toast(e.message||'تعذر حفظ الرصيد الافتتاحي','error'); }
finally{ hideLoad(); }
}
// ─── معالج استبدال الرصيد الافتتاحي: إلغاء القديم (عكس الاستلام فقط) ثم حفظ الجديد ───
let openingReplace={invoiceId:null,invoiceNumber:'',rows:[],oldVoided:false};
function buildOpeningReplaceRows(inv){
return (inv?.items||[]).map(it=>({name:it.itemName||'',qty:it.qty,unit:it.unit||'',price:it.price,
boxes:it.packagingQty!=null?it.packagingQty:'',category:it.category||'',
expiry:normExpiryDate(it.expiryDate ?? it.expiry_date) || '',
oldQty:it.qty,currentQty:it.currentQty,issuedSince:it.issuedSince,itemExists:!!it.itemExists}));
}
async function showOpeningBalanceReplaceGrid(inv){
if(!inv||!inv.id){toast('فاتورة غير صالحة','error');return;}
openingReplace={invoiceId:inv.id,invoiceNumber:inv.invoiceNumber||'',rows:buildOpeningReplaceRows(inv),oldVoided:false};
if(!openingReplace.rows.length){toast('الفاتورة القديمة بلا بنود صالحة','error');return;}
showModal(`<h3><i class=ji data-i=rotate-ccw></i> استبدال الرصيد الافتتاحي — ${esc(inv.invoiceNumber)}</h3>
<div class="workflow-banner"><i class=ji data-i=info></i> عدّل <strong>الكمية الجديدة</strong> و<strong>السعر الجديد</strong> لكل صنف. عند الحفظ: يُلغى الرصيد القديم (يعكس استلامه <strong>فقط</strong> — طلبات الصرف تبقى محسوبة) ثم يُسجل الجديد مكانًا واحدًا.</div>
<div id="openingReplaceMsg"></div>
<div id="openingReplaceRows" style="margin-top:10px"></div>
<div class="callout-gold u-my16"><div class="fw-bold">إجمالي الرصيد الجديد</div><div class="callout-value" id="openingReplaceTotal">${fC(0)}</div></div>
<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="openingReplaceAck"> أفهم أن الرصيد القديم سيُلغى ويُعكس استلامه فقط — وطلبات الصرف تبقى محسوبة على الرصيد الجديد</label>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="confirmOpeningReplace"><i class=ji data-i=rotate-ccw></i> إلغاء القديم وحفظ الجديد</button></div>`);
renderOpeningReplaceRows();
updateOpeningReplaceTotal();
}
function renderOpeningReplaceRows(){
const c=document.getElementById('openingReplaceRows'); if(!c){return;}
c.innerHTML=`<div class="tbl-scroll" style="max-height:46vh"><table style="min-width:960px"><thead><tr><th>اسم الصنف</th><th style="width:90px">الوحدة</th><th style="width:95px">مدخل قديمًا</th><th style="width:95px">منصرف منذذك</th><th style="width:95px">الرصيد الحالي</th><th style="width:110px">كمية جديدة *</th><th style="width:110px">سعر جديد *</th><th style="width:150px" title="YYYY-MM-DD — اختياري">تاريخ الصلاحية</th><th style="width:95px">كراتين</th></tr></thead><tbody>
${openingReplace.rows.map((r,idx)=>{
const meat=isOpeningMeatRow(r);
return `<tr${r.itemExists?'':' style="opacity:.6"'}>
<td class="fw-bold">${esc(r.name)}${r.itemExists?'':' <span class="badge bdg-red" title="الصنف محذوف من المخزن — سيُعاد إنشاؤه بالحفظ">محذوف؟</span>'}</td>
<td>${esc(r.unit||'—')}</td>
<td class="c-gold">${fN(r.oldQty)}</td>
<td class="${r.issuedSince>0?'c-red':''}">${fN(r.issuedSince)}</td>
<td class="${(Number(r.currentQty)||0)<r.oldQty?'c-red':'c-green'}">${r.currentQty==null?'—':fN(r.currentQty)}</td>
<td><input type="number" class="u-input" value="${r.qty}" min="0" step="0.001" style="font-weight:700" data-karim-action="updateOpeningReplaceRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;qty&quot;]" data-karim-pass="value"></td>
<td><input type="number" class="u-input" value="${r.price}" min="0" step="0.01" data-karim-action="updateOpeningReplaceRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;price&quot;]" data-karim-pass="value"></td>
<td><input type="date" class="u-input" value="${esc(r.expiry||'')}" aria-label="تاريخ الصلاحية للصنف ${idx+1}" data-karim-action="updateOpeningReplaceRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;expiry&quot;]" data-karim-pass="value"></td>
<td>${meat?`<input type="number" class="u-input" value="${r.boxes}" min="0" step="1" placeholder="—" data-karim-action="updateOpeningReplaceRow" data-karim-event="input" data-karim-args="[&quot;${idx}&quot;,&quot;boxes&quot;]" data-karim-pass="value">`:'<span class="text-muted">—</span>'}</td>
</tr>`;}).join('')}
</tbody></table></div>`;
}
function updateOpeningReplaceRow(idx,field,value){
const r=openingReplace.rows[idx]; if(!r){return;}
if(field==='qty'||field==='price'){ r[field]=value===''?'':(parseFloat(value)||0); }
else if(field==='boxes'){ r.boxes=value===''?'':(parseInt(value)||0); }
else if(field==='expiry'){ r.expiry=String(value||''); }
const t=openingReplace.rows.reduce((s,r)=>s+((parseFloat(r.qty)||0)*(parseFloat(r.price)||0)),0);
const el=document.getElementById('openingReplaceTotal'); if(el){el.innerHTML=fC(t);}
}
async function confirmOpeningReplace(){
const items=normalizeOpeningItems(openingReplace.rows);
if(!items.length){ toast('أدخل كمية وسعرًا صحيحين لصنف واحد على الأقل','error'); return; }
const bad=items.find(r=>r.boxes!==null&&!(r.boxes>0));
if(bad){ toast(`عدد الكراتين للصنف "${bad.name}" يجب أن يكون أكبر من صفر أو اتركه فارغًا`,'error'); return; }
// البوابة قبل الإلغاء: لا يُلغى الرصيد القديم ثم يُرفض الجديد بلا صلاحية.
const expiryErr=openingExpiryError(items);
if(expiryErr){ toast(expiryErr,'error'); return; }
const ack=document.getElementById('openingReplaceAck')?.checked;
if(!ack){ toast('فعّل مربع التأكيد أولًا — العملية تلغي الرصيد القديم','error'); return; }
try{
showLoad();
// 1) إلغاء الرصيد القديم — يعكس استلامه فقط؛ لو أُلغي سلفًا نكمل عادي
if(!openingReplace.oldVoided){
try{
await apiFetch(`/warehouse/purchase-invoices/${encodeURIComponent(openingReplace.invoiceId)}/void`,{method:'POST',body:JSON.stringify({})});
openingReplace.oldVoided=true;
}catch(e){
if(!/غير موجودة|INVOICE_NOT_FOUND/i.test(String(e.message||''))){throw e;}
openingReplace.oldVoided=true; // أُلغي في محاولة سابقة — نكمل الحفظ
}
}
// 2) حفظ الرصيد الجديد
const result=await postOpeningInvoice(items);
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast(`تم استبدال الرصيد الافتتاحي: أُلغي ${openingReplace.invoiceNumber} وحُفظ ${items.length} صنفًا بقيمة ${fC(result.totalAmount||0)} — طلبات الصرف كما هي`,'success');
addNotification('استبدال رصيد افتتاحي',`أُلغي ${openingReplace.invoiceNumber} وأُدخل رصيد جديد بـ ${items.length} صنفًا`,'success');
}catch(e){
const msg=document.getElementById('openingReplaceMsg');
if(msg){msg.innerHTML=`<div class="badge bdg-red" style="padding:8px;line-height:1.6">${esc(e.message||'فشل الاستبدال')} — لو أُلغي القديم بالفعل اضغط «إلغاء القديم وحفظ الجديد» مرة أخرى (لن يتكرر الإلغاء)</div>`;}
toast(e.message||'فشل استبدال الرصيد الافتتاحي','error');
}finally{ hideLoad(); }
}
// ═══ فحص النظام الشامل (طلب المالك 2026-10-06: «سهل جدا وزكي جدا وقوي جدا») ═══
// زر واحد = تشخيص فوري: سلامة كل الأرصدة (الرصيد = المخازن = الدفتر) + إحصائيات + صفر الرصيد
async function showSystemHealth(){
try{
showLoad();
const r=await apiFetch('/warehouse/system-health');
const ok=!!r.ok;
const anomalyRows=(r.anomalies||[]).map(a=>`<div style="padding:6px 10px;border-bottom:1px solid var(--border);color:var(--red,#d64545)">✗ <b>${esc(a.name)}</b> — ${esc(a.issue)}</div>`).join('');
showModal(`<h3><i class=ji data-i=clipboard-list></i> فحص النظام</h3>
<div class="workflow-banner" style="${ok?'':'color:var(--red,#d64545)'}"><i class=ji data-i=${ok?'clipboard-list':'alert-triangle'}></i> ${ok?'<strong>النظام سليم 100%</strong> — كل الأرصدة متطابقة مع المخازن والدفاتر، والمعادلة (البداية − المنصرف = رصيد الرئيسي) واقفة':'<strong>توجد ملاحظات تحتاج نظر</strong> — الأصناف الآتية رصيدها غير متطابق'}</div>
<div class="fr">
<div class="details-item"><strong>إجمالي الأصناف:</strong> ${fN(r.itemsTotal)}</div>
<div class="details-item"><strong>سليمة:</strong> <span class="c-green">${fN(r.consistent)}</span></div>
<div class="details-item"><strong>صفر الرصيد:</strong> ${fN(r.zeroStock)}</div>
<div class="details-item"><strong>تحت الحد الأدنى:</strong> <span class="c-orange">${fN(r.lowStock)}</span></div>
</div>
${anomalyRows?`<div style="max-height:260px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">${anomalyRows}</div>`:''}
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);
}catch(e){ toast(e.message||'تعذر الفحص','error'); } finally{ hideLoad(); }
}
// ─── دمج الأصناف المكررة (طلب المالك 2026-10-05: «في اصناف مثل كده عايز احذف المكرر») ───
// مفتاح الكشف: إزالة كل المسافات + توحيد الهمزات/التاء المربوطة/الألف المقصورة —
// التقاط متسامح عمدًا (أرز بسمتي20 مقابل أرز بسمتي 20) — الدمج نفسه بتأكيد بشري لكل مجموعة
function mergeItemKey(name){
return String(name||'').toLowerCase().replace(/[\s\u00a0\t]/g,'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي');
}
function findDuplicateItemGroups(){
const groups=new Map();
(STATE.inventory||[]).forEach(i=>{
const k=mergeItemKey(i.name); if(!k){return;}
if(!groups.has(k)){groups.set(k,[]);}
groups.get(k).push(i);
});
return [...groups.values()].filter(g=>g.length>1);
}
function showMergeDuplicatesModal(){
if(STATE.currentUser?.role!=='admin'){toast('الدمج متاح للأدمن فقط','error');return;}
const groups=findDuplicateItemGroups();
if(!groups.length){showModal(`<h3><i class=ji data-i=git-merge></i> دمج أصناف مكررة</h3><div class="u-empty">ممتاز — لا توجد أصناف مكررة بالاسم نفسه حاليًا 👌</div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);return;}
const cards=groups.map((g,gi)=>{
const keepIdx=g.reduce((best,i,idx)=>Number(i.qty)>Number(g[best].qty)?idx:best,0);
return `<div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:12px;margin-bottom:10px">
<div class="fw-bold u-mb8"><i class=ji data-i=copy></i> «${esc(g[0].name)}» — ${fN(g.length)} نسخ</div>
${g.map((i,idx)=>`<label style="display:flex;gap:8px;align-items:center;padding:6px;border-radius:8px;cursor:pointer;background:${idx===keepIdx?'rgba(212,168,67,.12)':'transparent'}">
<input type="radio" name="mergeKeep_${gi}" value="${esc(String(i.id))}" ${idx===keepIdx?'checked':''}>
<span class="u-t13">${idx===keepIdx?'<strong>':''}${esc(i.name)}${idx===keepIdx?'</strong>':''} — رصيد ${fN(i.qty)} ${esc(i.unit||'')}${Number(i.minQty)>0?` · حد أدنى ${fN(i.minQty)}`:''} <span class="text-muted">(id: ${esc(String(i.id))})</span></span>
</label>`).join('')}
<button type="button" class="btn btn-red btn-sm u-mt8" data-karim-action="mergeDuplicateGroup" data-karim-arg0="${gi}"><i class=ji data-i=git-merge></i> دمج في الصنف المحدد</button>
</div>`;
}).join('');
showModal(`<h3><i class=ji data-i=git-merge></i> دمج أصناف مكررة</h3>
<div class="workflow-banner"><i class=ji data-i=info></i> اختر النسخة التي <strong>تبقى</strong> في كل مجموعة ثم اضغط دمج — يتم نقل الرصيد والسجل التاريخي للمُبقي وحذف المكرر نهائيًا. <strong>لا تراجع بعد الدمج.</strong></div>
${cards}
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);
}
async function mergeDuplicateGroup(gi){
const groups=findDuplicateItemGroups();
const g=groups[gi]; if(!g){return;}
const keepEl=document.querySelector(`input[name="mergeKeep_${gi}"]:checked`);
const keepId=keepEl?Number(keepEl.value):null;
if(!keepId){toast('اختر النسخة التي تبقى','error');return;}
const dupIds=g.filter(i=>Number(i.id)!==keepId).map(i=>Number(i.id));
if(!dupIds.length){toast('اختر النسخة التي تبقى','error');return;}
if(!confirm(`تأكيد الدمج: سيُنقل رصيد ${dupIds.length} صنفًا مكررًا («${g.filter(i=>Number(i.id)!==keepId).map(i=>i.name).join('، ')}») إلى النسخة المبقية ويُحذف نهائيًا مع إعادة توجيه السجل التاريخي. متابعة؟`)){return;}
try{
showLoad();
const result=await apiFetch('/warehouse/inventory/merge',{method:'POST',body:JSON.stringify({keepId,dupIds})});
STATE.inventory=STATE.inventory.filter(i=>!dupIds.includes(Number(i.id)));
const ki=STATE.inventory.findIndex(i=>String(i.id)===String(keepId));
if(ki>-1&&result.keeper){STATE.inventory[ki]=result.keeper;}
showMergeDuplicatesModal();
toast(`تم الدمج: ${result.mergedCount} مكرر حُذف ونُقل رصيده (${fN(result.movedQty)}) — حدث الصفحة لتحديث الكل`,'success');
}catch(e){ toast(e.message||'فشل الدمج','error'); }
finally{ hideLoad(); }
}
function viewPurchaseInvoice(id){const inv = (STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
if(!inv){ toast('الفاتورة غير موجودة في قاعدة البيانات','warning'); return; }
let invoiceItems=Array.isArray(inv.items)?inv.items:[];
if(typeof inv.items==='string'){try{const parsed=JSON.parse(inv.items); if(Array.isArray(parsed)) {invoiceItems=parsed;}}catch(_){} }
showModal(`
<h3><i class=ji data-i=file-text></i> تفاصيل فاتورة الشراء</h3>
<div class="fr">
<div class="details-item"><strong>رقم الفاتورة:</strong><div>${esc(inv.invoiceNumber)}</div></div>
<div class="details-item"><strong>التاريخ:</strong><div>${fD(inv.date)}</div></div>
</div>
<div class="fr">
<div class="details-item"><strong>المورد:</strong><div>${esc(inv.supplierName||'—')}</div></div>
<div class="details-item"><strong>الهاتف:</strong><div>${esc(inv.supplierPhone||'—')}</div></div>
</div>
<div class="details-item"><strong>طريقة الدفع:</strong><div>${getPaymentMethodLabel(inv.paymentMethod)}</div></div>
${inv.supplierId?`<div class="fr">
<div class="details-item"><strong>المسدد:</strong><div class="c-green fw-bold">${fC(inv.paidAmount||0)}</div></div>
<div class="details-item"><strong>المتبقي:</strong><div class="${pcmtInvoiceRemaining(inv)>0?'c-red':'c-green'} fw-bold">${fC(pcmtInvoiceRemaining(inv))}</div></div>
</div>
<div class="details-item"><strong>حالة السداد:</strong><div>${pcmtStatusBadge(inv.paymentStatus)}${pcmtInvoiceRemaining(inv)>0?` <button class="btn btn-green btn-sm" data-karim-action="closeModal" data-karim-also="payInvoiceFull"><i class=ji data-i=coins></i> تسديد المتبقي</button>`:''}</div></div>`:''}
<div class="tbl-wrap" style="margin-top:14px">
<div class="tbl-hd"><h3><i class=ji data-i=package></i> الأصناف</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead>
<tbody>
${invoiceItems.map(item=>`<tr><td class="fw-bold">${esc(item.itemName)}</td><td>${esc(item.unit||'—')}</td><td>${fN(item.qty)}</td><td class="c-teal">${fN(item.weight||0)} كجم</td><td>${fC(item.price)}</td><td class="c-gold fw-bold">${fC(item.total||(item.qty*item.price))}</td></tr>`).join('')}
</tbody>
</table>
</div>
</div>
<div class="details-item"><strong>إجمالي الفاتورة:</strong><div class="c-gold fw-bold">${fC(inv.totalAmount)}</div></div>
<div class="details-item"><strong>ملاحظات:</strong><div>${esc(inv.notes||'—')}</div></div>
<div class="details-item"><strong>الخصم:</strong><div>${inv.discount_type==='percent'?`${fN(inv.discount_value)}%`:inv.discount_type==='amount'?fC(inv.discount_amount):'بدون خصم'} ${Number(inv.discount_amount||0)>0?`(${fC(inv.discount_amount)})`:''}</div></div>
${Number(inv.vat_total||0)>0?`<div class="details-item"><strong>ضريبة القيمة المضافة:</strong><div>${fC(inv.vat_total)}</div></div>`:''}
<div class="modal-footer"><button class="btn btn-blue" data-karim-action="printPurchaseInvoice" data-karim-arg0="${inv.id}"><i class=ji data-i=printer></i> طباعة الفاتورة</button>${['admin','manager','warehouse'].includes(STATE.currentUser?.role)&&Number(inv.paidAmount||0)===0?`<button class="btn btn-gold" data-karim-action="closeModal" data-karim-also="showAddPurchaseInvoiceModal"><i class=ji data-i=edit></i> تعديل الفاتورة</button>`:''}${['admin','manager'].includes(STATE.currentUser?.role)?`<button class="btn btn-red" data-karim-action="voidPurchaseInvoice" data-karim-arg0="${inv.id}"><i class=ji data-i=trash></i> حذف الفاتورة</button>`:''}<button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button></div>
`);
}
async function voidPurchaseInvoice(id, force){
const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
if(!inv){return;}
if(!force && !confirm(`حذف فاتورة الشراء ${inv.invoiceNumber||''} (${fC(inv.totalAmount||0)})؟\nسيُعكس أثرها على المخزون تلقائيًا.\n${Number(inv.paidAmount||0)>0?`عليها مبلغ مسدد ${fC(inv.paidAmount||0)} — إن كان من نوع «دفعة تلقائية مع تسجيل الفاتورة» سيُعكس مع الإلغاء.`:''}`)){return;}
showLoad();
try{
const r=await apiFetch(`/warehouse/purchase-invoices/${encodeURIComponent(id)}/void`,{method:'POST',body:JSON.stringify(force?{force:true}:{})});
STATE.purchaseInvoices=(STATE.purchaseInvoices||[]).filter(x=>String(x.id)!==String(id));
await window.loadData().catch(()=>{});
closeModal();renderPage();
toast(`حُذفت الفاتورة ${r.invoiceNumber||''} وعُكس مخزون ${r.reversedItems||0} صنفًا${r.deletedPayments?` وعُكست ${r.deletedPayments} دفعة تلقائية مرتبطة`:''}`,'success');
}catch(e){
const m=String(e.message||'');
if(!force&&(m.includes('يدوية')||m.includes('دفعات موردين'))){
toast(`${m} — افتح «المشتريات › الدفعات» واعكس الدفعة يدويًا ثم أعد الإلغاء`,'warning');
return;
}
toast(m||'تعذر حذف الفاتورة','error');
}finally{hideLoad();}
}
function printPurchaseInvoice(id){
 const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
 if(!inv){toast('الفاتورة غير موجودة في قاعدة البيانات','warning');return;}
 let items=Array.isArray(inv.items)?inv.items:[];
 if(typeof inv.items==='string'){try{const parsed=JSON.parse(inv.items);if(Array.isArray(parsed)){items=parsed;}}catch(_){} }
 const paymentLabel={cash:'نقدي',bank:'تحويل بنكي',card:'بطاقة',cheque:'شيك',credit:'آجل'}[inv.paymentMethod]||'—';
 const statusLabel={paid:'مدفوعة',partial:'مسددة جزئياً',unpaid:'غير مسددة'}[inv.paymentStatus]||'غير مسددة';
 const currency=esc(STATE.settings.currency||'SAR');
 const rows=items.map(item=>`<tr><td>${esc(item.itemName||'—')}</td><td>${esc(item.unit||'—')}</td><td>${fN(item.qty)}</td><td>${fN(item.weight||0)} كجم</td><td>${fN(item.price)} ${currency}</td><td>${fN(item.total||(Number(item.qty||0)*Number(item.price||0)))} ${currency}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد أصناف</td></tr>';
 const subtotal=items.reduce((sum,item)=>sum+Number(item.grossTotal??(Number(item.qty||0)*Number(item.price||0))),0);
 const discount=Number(inv.discount_amount||0);
 const vat=Number(inv.vat_total||0);
 const win=(window.openInAppReport ? window.openInAppReport('تقرير المستودع') : window.open('', '_blank'));
 if(!win){toast('اسمح بالنوافذ المنبثقة لطباعة الفاتورة','warning');return;}
 win.document.open();
 win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>فاتورة شراء ${esc(inv.invoiceNumber||'')}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}.meta b{display:block;color:#555;font-size:12px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:9px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.notes{margin-top:20px;border-top:1px solid #ddd;padding-top:12px;min-height:40px}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}.controls button.secondary{background:#555}@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button data-karim-action="print">طباعة</button><button class="secondary" data-karim-action="closeWindow">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>فاتورة شراء</p><p>${esc(inv.invoiceNumber||'—')}</p></header><section class="meta"><div><b>التاريخ</b>${fD(inv.date)}</div><div><b>المورد</b>${esc(inv.supplierName||'—')}</div><div><b>الهاتف</b>${esc(inv.supplierPhone||'—')}</div><div><b>طريقة الدفع</b>${paymentLabel}</div><div><b>حالة السداد</b>${statusLabel}</div><div><b>المسدد / المتبقي</b>${fN(inv.paidAmount||0)} / ${fN(Math.max(0,Number(inv.totalAmount||0)-Number(inv.paidAmount||0)))} ${currency}</div></section><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">الإجمالي قبل الخصم</td><td>${fN(subtotal)} ${currency}</td></tr><tr><td colspan="5">الخصم</td><td>− ${fN(discount)} ${currency}</td></tr><tr><td colspan="5">ضريبة القيمة المضافة</td><td>${fN(vat)} ${currency}</td></tr><tr><td colspan="5">الإجمالي المستحق</td><td>${fN(inv.totalAmount)} ${currency}</td></tr></tfoot></table><div class="notes"><b>ملاحظات:</b> ${esc(inv.notes||'—')}</div></main></body></html>`);
 win.document.close();
 win.focus();
}
// Import Catalog
function showImportItemsCatalogModal(){
showModal(`
<h3><i class=ji data-i=inbox></i> استيراد قائمة الأصناف من Excel</h3>
<div class="note-panel">
<strong><i class=ji data-i=clipboard-list></i> صيغة الملف:</strong><br>
الأعمدة: اسم الصنف، الفئة، الوحدة، الحد الأدنى
</div>
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-blue btn-sm" data-karim-action="downloadItemsCatalogTemplate"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="catalogExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="catalogPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="importItemsCatalog"><i class=ji data-i=inbox></i> استيراد</button></div>
`);
document.getElementById('catalogExcelFile').addEventListener('change',previewCatalogFile);
}
function downloadItemsCatalogTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([['اسم الصنف','الفئة','الوحدة','الحد الأدنى'],['دجاج','لحوم','كجم',5],['أرز','حبوب','كيس',10],['زيت','زيوت','لتر',3]]);
ws['!cols']=[{wch:20},{wch:15},{wch:10},{wch:12}];
XLSX.utils.book_append_sheet(wb,ws,'الأصناف');
XLSX.writeFile(wb,'نموذج_قائمة_الأصناف.xlsx');
}
function previewCatalogFile(){
const file=document.getElementById('catalogExcelFile')?.files[0];
if(!file){return;}
const reader=new FileReader();
reader.onload=function(e){
try{
const wb=window.XLSXGuard.readWorkbook(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const rows=data.filter((r,i)=>i>0&&r[0]);
const prev=document.getElementById('catalogPreview');
if(!prev){return;}
if(rows.length===0){ prev.innerHTML='<div class="u-red"><i class=ji data-i=alert-triangle></i> لا توجد بيانات</div>'; return; }
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${rows.length} صنف</div>${rows.slice(0,5).map(r=>`<div class="preview-row"><i class=ji data-i=package></i> ${r[0]} | ${r[1]||'—'} | ${r[2]||'قطعة'} | حد أدنى: ${r[3]||5}</div>`).join('')}${rows.length>5?`<div style="color:var(--text3);font-size:12px;margin-top:6px">... و${rows.length-5} أصناف أخرى</div>`:''}</div>`;
}catch(_){ document.getElementById('catalogPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
};
reader.readAsBinaryString(file);
}
function importItemsCatalog(){
const file=document.getElementById('catalogExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
const reader=new FileReader();
reader.onload=async function(e){
try{
const wb=window.XLSXGuard.readWorkbook(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const rows=data.filter((r,i)=>i>0&&String(r[0]).trim());
let added=0, skipped=0;
for(const r of rows){
const name=String(r[0]).trim();
if(!name){continue;}
if(STATE.inventory.find(i=>i.name===name)){ skipped++; continue; }
const item = {name,category:String(r[1]||'').trim()||'عام',unit:String(r[2]||'').trim()||'قطعة',qty:0,avgCost:0,minQty:parseFloat(r[3])||5,weight:0,shelfId:null};
await persistCreate('inventory', (saved)=>STATE.inventory.push(saved), item);
added++;
}
closeModal(); renderPage();
toast(`تم استيراد ${added} صنف جديد${skipped>0?` (${skipped} مكرر تم تجاهله)`:''}`,'success');
}catch(_){ toast('خطأ في معالجة الملف','error'); }
};
reader.readAsBinaryString(file);
}
// Bulk Inventory Import
function showBulkInventoryImportModal(){
showModal(`
<h3><i class=ji data-i=chart></i> استيراد المخزون من Excel</h3>
<div class="note-panel">
<strong><i class=ji data-i=clipboard-list></i> صيغة الملف:</strong><br>
الأعمدة: اسم الصنف، الفئة، الوحدة، الكمية، سعر الشراء، الحد الأدنى، تاريخ الصلاحية (YYYY-MM-DD)
</div>
<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);padding:12px;border-radius:var(--r);margin-bottom:14px;font-size:12px">
<i class=ji data-i=alert-triangle></i> <strong>تنبيه:</strong> إذا كان الصنف موجوداً مسبقاً، سيتم تحديث كميته وسعره فقط.
</div>
<div class="fg"><label>صلاحية الورقة — للأصناف التي بلا عمود صلاحية في الملف (اختياري)</label><input type="date" id="bulkSheetExpiry" class="u-input"><small class="text-muted">عمود «تاريخ الصلاحية» في الملف له الأولوية؛ لا يُخترع تاريخ لأي صنف.</small></div>
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-blue btn-sm" data-karim-action="downloadInventoryTemplate"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="inventoryExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="bulkImportProgress" style="display:none;margin:10px 0"><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:700;margin-bottom:4px"><span id="bulkImportPhase">جارٍ الاستيراد...</span><span id="bulkImportPct" dir="ltr">0%</span></div><div style="height:10px;background:var(--bg3);border-radius:999px;overflow:hidden"><div id="bulkImportBar" style="height:100%;width:0%;background:linear-gradient(90deg,#f59e0b,#b45309);transition:width .3s"></div></div></div><div id="inventoryImportPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="importBulkInventory"><i class=ji data-i=inbox></i> استيراد المخزون</button></div>
`);
document.getElementById('inventoryExcelFile').addEventListener('change',previewInventoryFile);
}
function downloadInventoryTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([['اسم الصنف','الفئة','الوحدة','الكمية','سعر الشراء','الحد الأدنى','تاريخ الصلاحية'],['دجاج','لحوم','كجم',50,25,10,'2026-11-30'],['أرز','حبوب','كيس',100,3.5,20,'2027-06-30'],['زيت نخيل','زيوت','لتر',30,8,5,'2027-03-31']]);
ws['!cols']=[{wch:20},{wch:15},{wch:10},{wch:10},{wch:12},{wch:12},{wch:18}];
XLSX.utils.book_append_sheet(wb,ws,'المخزون');
XLSX.writeFile(wb,'نموذج_استيراد_المخزون.xlsx');
}
function parseInventoryImportCell(value) {
    if (value === null || value === undefined) {return '';} 
    return String(value).replace(/\uFEFF/g, '').trim();
}
function parseInventoryImportNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') {return fallback;}
    const raw = parseInventoryImportCell(value).replace(/[,\s]/g, '');
    const normalized = raw.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)).replace(/[\u0660-\u0669]/g, ch => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    const num = Number(normalized.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(num) ? num : fallback;
}
async function readInventoryImportRows(file) {
    if (!file) {return [];} 
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const result = e.target && e.target.result;
                if (!result) { resolve([]); return; }
                const isCsv = /\.csv$/i.test(file.name || '');
                const book = window.XLSXGuard.readWorkbook(result, { type: isCsv ? 'string' : 'binary' });
                const sheet = book.Sheets[book.SheetNames[0]];
                const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const rows = Array.isArray(allRows) ? allRows.filter((row) => Array.isArray(row) ? row.some((cell) => parseInventoryImportCell(cell) !== '') : parseInventoryImportCell(row) !== '') : [];
                resolve(rows);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = function () { reject(new Error('FILE_READ_FAILED')); };
        if (/\.csv$/i.test(file.name || '')) { reader.readAsText(file, 'UTF-8'); }
        else { reader.readAsBinaryString(file); }
    });
}
function inventoryImportRowsFromSheet(rows) {
    if (!rows.length) {return [];} 
    const headerRow = rows[0].map((cell) => parseInventoryImportCell(cell).toLowerCase());
    const headerHasNames = headerRow.some((cell) => /^(اسم|اسم\s*الصنف|item|product|name)$/.test(cell));
    const startIndex = headerHasNames ? 1 : 0;
    return rows.slice(startIndex).map((row) => {
        const item = Array.isArray(row) ? row : [row];
        const category = parseInventoryImportCell(item[1] || '');
        const expiryCell = item[6];
        return {
            name: parseInventoryImportCell(item[0]),
            category: category || 'عام',
            unit: parseInventoryImportCell(item[2] || ''),
            qty: parseInventoryImportNumber(item[3], 0),
            price: parseInventoryImportNumber(item[4], 0),
            minQty: parseInventoryImportNumber(item[5], 5),
            // العمود السابع (ز) صلاحية الدفعة — نص ISO أو Date أو رقم Excel تسلسلي.
            expiryDate: expiryCell instanceof Date || typeof expiryCell === 'number'
                ? openingExpiryCell(expiryCell)
                : (normExpiryDate(parseInventoryImportCell(expiryCell)) || null),
        };
    }).filter((row) => row.name && row.qty >= 0 && row.price >= 0);
}
function previewInventoryFile(){
const file=document.getElementById('inventoryExcelFile')?.files[0];
if(!file){return;}
readInventoryImportRows(file).then((rows) => {
try{
const list = inventoryImportRowsFromSheet(rows);
const prev=document.getElementById('inventoryImportPreview');
if(!prev){return;}
if(!list.length){ prev.innerHTML='<div class="u-red"><i class=ji data-i=alert-triangle></i> لا توجد بيانات صالحة</div>'; return; }
const totalValue=list.reduce((s,r)=>s+((r.qty||0)*(r.price||0)),0);
const missingExpiry=list.filter((r)=>r.qty>0&&!normExpiryDate(r.expiryDate)).length;
const expiryWarn=missingExpiry?`<div class="text-muted u-t12 u-my8"><i class=ji data-i=info></i> ${missingExpiry} صفاً بلا تاريخ صلاحية — سيُحفظ بدون صلاحية (اختياري).</div>`:'';
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${list.length} صنف | إجمالي القيمة: ${fC(totalValue)}</div>${expiryWarn}<table style="width:100%;font-size:12px;border-collapse:collapse"><tr class="u-faint"><th style="text-align:right;padding:4px">الصنف</th><th>الكمية</th><th>السعر</th><th>القيمة</th><th>الصلاحية</th></tr>${list.slice(0,6).map(r=>`<tr style="border-top:1px solid var(--border)"><td style="padding:4px">${esc(String(r.name))}</td><td class="u-ta-c">${fN(r.qty||0)} ${r.unit || ''}</td><td class="u-ta-c">${fC(r.price||0)}</td><td style="text-align:center;color:var(--gold)">${fC((r.qty||0)*(r.price||0))}</td><td class="u-ta-c" style="text-align:center">${r.expiryDate?esc(r.expiryDate):'—'}</td></tr>`).join('')}${list.length>6?`<tr><td colspan="5" style="color:var(--text3);text-align:center;padding:6px">... و${list.length-6} أصناف أخرى</td></tr>`:''}</table></div>`;
}catch(_){ document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
}).catch(() => { document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; });
}
async function importBulkInventory(){
const file=document.getElementById('inventoryExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
// FIX: الطلب الواحد لملف كبير كان ينقطع عند مهلة apiFetch (30 ثانية) فيبدو
// الزر «غير مستجيب». الآن: دفعات من 20 صنفًا مع شريط تقدم حي وأخطاء حقيقية.
const footerBtns=document.querySelectorAll('#modal .modal-footer .btn, .modal-footer .btn');
const importBtn=[...footerBtns].find(b=>b.getAttribute('onclick')==='importBulkInventory()');
const fileInput=document.getElementById('inventoryExcelFile');
const progWrap=document.getElementById('bulkImportProgress');
const progBar=document.getElementById('bulkImportBar');
const progPct=document.getElementById('bulkImportPct');
const progPhase=document.getElementById('bulkImportPhase');
const prev=document.getElementById('inventoryImportPreview');
const setProgress=(done,total,label)=>{
  if(!progWrap){return;}
  progWrap.style.display='block';
  const pct=Math.round((done/Math.max(total,1))*100);
  if(progBar) {progBar.style.width=pct+'%';}
  if(progPct) {progPct.textContent=pct+'%';}
  if(progPhase && label) {progPhase.textContent=label;}
};
const setBusy=(busy)=>{
  if(importBtn){ importBtn.disabled=busy; importBtn.textContent=busy?'جارٍ الاستيراد...':'استيراد المخزون'; }
  if(fileInput) {fileInput.disabled=busy;}
};
try{
const rows = await readInventoryImportRows(file);
// عمود الصلاحية اختياري في الملف؛ وحقل «صلاحية الورقة» يغطّي الصفوف الناقصة — ولا تاريخ يُخترع.
const sheetExpiry = normExpiryDate(document.getElementById('bulkSheetExpiry')?.value || '');
const items = inventoryImportRowsFromSheet(rows).map((row) => ({
    name: String(row.name).trim(),
    category: String(row.category || 'عام').trim() || 'عام',
    unit: String(row.unit || 'قطعة').trim() || 'قطعة',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    minQty: Number(row.minQty) || 5,
    expiryDate: normExpiryDate(row.expiryDate) || sheetExpiry,
})).filter((row) => row.name && row.qty > 0 && row.price >= 0);
if(!items.length){toast('لا توجد صفوف صالحة للاستيراد','error'); return;}
const existingNames=new Set(STATE.inventory.map(i=>String(i.name||'').toLowerCase()));
const CHUNK=20;
const chunks=[];
for(let i=0;i<items.length;i+=CHUNK){ chunks.push(items.slice(i,i+CHUNK)); }
setBusy(true);
setProgress(0,chunks.length+1,`جارٍ استيراد ${items.length} صنف في ${chunks.length} دفعة — لا تغلق النافذة`);
let added=0, updated=0; const importedNames=new Set();
const failures=[];
for(let ci=0;ci<chunks.length;ci++){
  setProgress(ci,chunks.length,`جارٍ الاستيراد: ${Math.min(ci*CHUNK,items.length)}/${items.length} صنف`);
  try{
    const result=await apiFetch('/warehouse/inventory/bulk-receipt',{method:'POST',body:JSON.stringify({items:chunks[ci]})});
    (result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
    (result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
    chunks[ci].forEach(item=>{
      if(importedNames.has(item.name.toLowerCase())){ return; } // مكرر داخل الملف — عُدّ مرة
      importedNames.add(item.name.toLowerCase());
      if(existingNames.has(item.name.toLowerCase())){ updated++; } else { added++; }
    });
  }catch(err){
    failures.push({ chunk: ci+1, names: chunks[ci].map(x=>x.name).slice(0,4).join('، '), message: err.message || 'فشل غير معروف' });
  }
}
setProgress(chunks.length,chunks.length,'اكتمل');
setBusy(false);
renderPage();
if(failures.length){
  if(prev){
    const rows=failures.map(f=>'<div style="margin:4px 0">&#8226; الدفعة '+f.chunk+' ('+esc(f.names)+'...): '+esc(f.message)+'</div>').join('');
    prev.innerHTML='<div style="background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.3);padding:12px;border-radius:var(--r)">'
      +'<div class="fw-bold u-mb8">استُورد '+(added+updated)+' صنف من '+items.length+' — فشلت '+failures.length+' دفعة:</div>'
      +rows
      +'<div class="text-muted" style="font-size:12px;margin-top:8px">صحّح الخطأ في ملف Excel (غالبًا تعارض وحدة مع صنف موجود) وأعد رفع الملف — الأصناف الناجحة ستتحدث كمياتها، فاحذفها من الملف قبل الإعادة.</div></div>';
  }
  toast('اكتمل جزئيًا: '+(added+updated)+' نجح، '+failures.length+' دفعة فشلت — التفاصيل في المعاينة','warning');
  return; // لا تغلق النافذة — التفاصيل معروضة
}
closeModal();
toast(`تم الاستيراد: ${added} صنف جديد، ${updated} صنف محدَّث`,'success');
}catch(err){
  setBusy(false);
  toast(err.message || 'خطأ في معالجة الملف','error');
}
}
// ============================================
// SHELVES
// ============================================
function renderShelves(){
if(!checkMenuAccessLocal('shelves')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const totalItems = STATE.inventory.length;
const assignedItems = STATE.inventory.filter(i=>i.shelfId).length;
const emptyShelves = STATE.shelves.filter(s=>!STATE.inventory.some(i=>i.shelfId===s.id)).length;
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('shv.total')}</div><div class="mcard-val c-teal">${fN(STATE.shelves.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> ${t('shv.assigned')}</div><div class="mcard-val c-gold">${fN(assignedItems)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> رفوف فارغة</div><div class="mcard-val ${emptyShelves>0?'c-orange':'c-green'}">${fN(emptyShelves)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> نسبة الإشغال</div><div class="mcard-val c-purple">${totalItems>0?fN((assignedItems/totalItems*100).toFixed(1))+'%':'0%'}</div></div>
</div>
<div class="u-row-between">
<h3 class="u-gold-strong"><i class=ji data-i=archive></i> إدارة الرفوف</h3>
<button class="btn btn-gold" data-karim-action="showAddShelfModal"><i class=ji data-i=plus></i> إضافة رف</button>
</div>
<div class="shelf-grid">
${STATE.shelves.map(shelf=>{
const items = STATE.inventory.filter(i=>i.shelfId===shelf.id);
const totalQty = items.reduce((s,i)=>s+i.qty,0);
const totalValue = items.reduce((s,i)=>s+(i.qty*i.avgCost),0);
return `
<div class="shelf-card">
<div class="shelf-header">
<span class="shelf-icon">${shelf.icon||'<i class=ji data-i=archive></i>'}</span>
<div class="shelf-name">${esc(shelf.name)}</div>
<span class="shelf-count">${items.length}</span>
</div>
<div style="font-size:11px;color:var(--text3);margin-bottom:10px"><i class=ji data-i=map-pin></i> ${esc(shelf.location||'—')} | <i class=ji data-i=chart></i> السعة: ${shelf.capacity||'—'}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
<div class="dstat"><div class="dstat-lbl">الكمية</div><div class="dstat-val c-gold">${fN(totalQty)}</div></div>
<div class="dstat"><div class="dstat-lbl">القيمة</div><div class="dstat-val c-green">${fC(totalValue)}</div></div>
</div>
<div class="shelf-items">
${items.slice(0,5).map(item=>`
<div class="shelf-item">
<span>${esc(item.name)}</span>
<span class="c-gold fw-bold">${fN(item.qty)} ${item.unit}</span>
</div>
`).join('')}
${items.length>5?`<div style="font-size:11px;color:var(--text3);text-align:center;padding:4px">... و${items.length-5} أصناف أخرى</div>`:''}
${items.length===0?'<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px">الرف فارغ</div>':''}
</div>
<div style="display:flex;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
<button class="btn btn-sm u-flex1" data-karim-action="editShelf" data-karim-arg0="${shelf.id}"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-red btn-sm u-flex1" data-karim-action="deleteShelf" data-karim-arg0="${shelf.id}"><i class=ji data-i=trash></i> حذف</button>
</div>
</div>
`;
}).join('')||'<div class="mcard u-empty-grid">لا توجد رفوف</div>'}
</div>
`;
}
function showAddShelfModal(){
showModal(`
<h3><i class=ji data-i=plus></i> إضافة رف جديد</h3>
<div class="fr">
<div class="fg"><label>اسم الرف</label><input type="text" id="shelfName" placeholder="مثال: الرف A1"></div>
<div class="fg"><label>الكود</label><input type="text" id="shelfCode" placeholder="A1" maxlength="5"></div>
</div>
<div class="fr">
<div class="fg"><label>الموقع</label><input type="text" id="shelfLocation" placeholder="المخزن الرئيسي"></div>
<div class="fg"><label>السعة</label><input type="number" id="shelfCapacity" value="50"></div>
</div>
<div class="fg"><label>الأيقونة</label><input type="text" id="shelfIcon" value="<i class=ji data-i=archive></i>" maxlength="2"></div>
<div class="modal-footer">
<button class="btn" data-karim-action="closeModal">إلغاء</button>
<button class="btn btn-gold" data-karim-action="addShelf"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function addShelf(){
const name=document.getElementById('shelfName')?.value.trim();
const code=document.getElementById('shelfCode')?.value.trim().toUpperCase();
const location=document.getElementById('shelfLocation')?.value.trim();
const capacity=parseInt(document.getElementById('shelfCapacity')?.value)||50;
const icon=document.getElementById('shelfIcon')?.value||'<i class=ji data-i=archive></i>';
if(!name||!code){ toast('أدخل الاسم والكود','error'); return; }
if(STATE.shelves.find(s=>s.code===code)){ toast('الكود موجود بالفعل','error'); return; }
await persistCreate('shelves', (saved)=>STATE.shelves.push(saved), {id:uid(),name,code,location,capacity,icon});
closeModal(); renderPage();
toast('تم إضافة الرف','success');
}
function editShelf(id){
const shelf=STATE.shelves.find(s=>String(s.id)===String(id));
if(!shelf){return;}
showModal(`
<h3><i class=ji data-i=pencil></i> تعديل الرف</h3>
<div class="fg"><label>اسم الرف</label><input type="text" id="shelfName" value="${esc(shelf.name)}"></div>
<div class="fr">
<div class="fg"><label>الموقع</label><input type="text" id="shelfLocation" value="${esc(shelf.location||'')}"></div>
<div class="fg"><label>السعة</label><input type="number" id="shelfCapacity" value="${shelf.capacity||50}"></div>
</div>
<div class="fg"><label>الأيقونة</label><input type="text" id="shelfIcon" value="${shelf.icon||'<i class=ji data-i=archive></i>'}" maxlength="2"></div>
<div class="modal-footer">
<button class="btn" data-karim-action="closeModal">إلغاء</button>
<button class="btn btn-gold" data-karim-action="updateShelf" data-karim-arg0="${id}"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function updateShelf(id){
const shelf=STATE.shelves.find(s=>String(s.id)===String(id));
if(!shelf){return;}
const name=document.getElementById('shelfName')?.value.trim();
const location=document.getElementById('shelfLocation')?.value.trim();
const capacity=parseInt(document.getElementById('shelfCapacity')?.value)||50;
const icon=document.getElementById('shelfIcon')?.value||'<i class=ji data-i=archive></i>';
await persistUpdate('shelves', id, {name,location,capacity,icon});
Object.assign(shelf, {name,location,capacity,icon});
closeModal(); renderPage();
toast('تم التحديث','success');
}
async function deleteShelf(id){
if(!confirm('حذف هذا الرف؟ سيتم إزالة تعيين الأصناف منه.')){return;}
await persistRemove('shelves', id);
STATE.shelves=STATE.shelves.filter(s=>String(s.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}
// ============================================
// WEIGHT
// ============================================
let currentWeight = 0;
let weightUnit = 'kg';
function renderWeight(){
if(!checkMenuAccessLocal('weight')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const totalReadings = (STATE.weightReadings||[]).length;
const totalWeight = (STATE.weightReadings||[]).reduce((s,r)=>s+(r.weight||0),0);
const todayReadings = (STATE.weightReadings||[]).filter(r=>r.date===today()).length;
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('w8.today')}</div><div class="mcard-val c-teal">${fN(todayReadings)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> ${t('w8.total')}</div><div class="mcard-val c-gold">${fN(totalReadings)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> إجمالي الوزن</div><div class="mcard-val c-blue">${fN(totalWeight)} كجم</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> آخر قراءة</div><div class="mcard-val c-purple u-t14">${STATE.weightReadings?.length?fDT(STATE.weightReadings[STATE.weightReadings.length-1].timestamp):'—'}</div></div>
</div>
<div class="weight-display">
<div class="weight-label"><i class=ji data-i=scale></i> الميزان الرقمي</div>
<div class="weight-value" id="weightValue">${fN(currentWeight)}</div>
<div class="weight-unit" id="weightUnit">${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'}</div>
<div class="weight-controls">
<button class="weight-btn" data-karim-action="adjustWeight" data-karim-args="[-1]">- 1</button>
<button class="weight-btn" data-karim-action="adjustWeight" data-karim-args="[-0.1]">- 0.1</button>
<button class="weight-btn active" data-karim-action="resetWeight"><i class=ji data-i=refresh></i> تصفير</button>
<button class="weight-btn" data-karim-action="adjustWeight" data-karim-args="[0.1]">+ 0.1</button>
<button class="weight-btn" data-karim-action="adjustWeight" data-karim-args="[1]">+ 1</button>
</div>
<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="btn btn-gold" data-karim-action="recordWeight"><i class=ji data-i=file-text></i> تسجيل القراءة</button>
<button class="btn btn-blue" data-karim-action="recordWeightToItem"><i class=ji data-i=package></i> إضافة لصنف</button>
</div>
<div style="margin-top:15px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="weight-btn ${weightUnit==='kg'?'active':''}" data-karim-action="setWeightUnit" data-karim-args="[&quot;kg&quot;]">كجم</button>
<button class="weight-btn ${weightUnit==='g'?'active':''}" data-karim-action="setWeightUnit" data-karim-args="[&quot;g&quot;]">جرام</button>
<button class="weight-btn ${weightUnit==='lb'?'active':''}" data-karim-action="setWeightUnit" data-karim-args="[&quot;lb&quot;]">رطل</button>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=chart></i> سجل القراءات</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الوقت</th><th>الوزن</th><th>الوحدة</th><th>الصنف</th><th>ملاحظات</th></tr></thead>
<tbody>
${(STATE.weightReadings||[]).slice().reverse().slice(0,30).map(r=>`<tr>
<td>${fD(r.date)}</td>
<td>${r.time||'—'}</td>
<td class="c-teal fw-bold">${fN(r.weight)}</td>
<td>${r.unit==='kg'?'كجم':r.unit==='g'?'جرام':'رطل'}</td>
<td>${esc(r.itemName||'—')}</td>
<td class="text-muted">${esc(r.notes||'—')}</td>
</tr>`).join('')||'<tr><td colspan="6" class="u-empty">لا توجد قراءات</td></tr>'}
</tbody>
</table>
</div>
</div>
`;
}
function adjustWeight(val){
currentWeight = Math.max(0, currentWeight + val);
currentWeight = parseFloat(currentWeight.toFixed(3));
const el = document.getElementById('weightValue');
if(el) {el.textContent = fN(currentWeight);}
}
function resetWeight(){
currentWeight = 0;
const el = document.getElementById('weightValue');
if(el) {el.textContent = '0';}
}
function setWeightUnit(unit){
weightUnit = unit;
const el = document.getElementById('weightUnit');
if(el) {el.textContent = unit==='kg'?'كجم':unit==='g'?'جرام':'رطل';}
document.querySelectorAll('.weight-btn').forEach(b=>{
if(b.textContent.includes('كجم')||b.textContent.includes('جرام')||b.textContent.includes('رطل')){
b.classList.remove('active');
}
});
event.target.classList.add('active');
}
async function recordWeight(){
if(currentWeight<=0){ toast('الوزن يجب أن يكون أكبر من صفر','error'); return; }
const notes = prompt('ملاحظات (اختياري):') || '';
if(!STATE.weightReadings) {STATE.weightReadings = [];}
const wr = {id:uid(), date:today(), time:nowTime(), timestamp:new Date().toISOString(),
weight:currentWeight, unit:weightUnit, itemName:null, notes,
recordedBy:STATE.currentUser?.username||'unknown'};
await persistCreate('weightReadings', (saved)=>STATE.weightReadings.push(saved), wr);
toast(`تم تسجيل الوزن: ${fN(currentWeight)} ${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'}`,'success');
resetWeight();
renderPage();
}
function recordWeightToItem(){
if(currentWeight<=0){ toast('الوزن يجب أن يكون أكبر من صفر','error'); return; }
const itemOptions = STATE.inventory.map(i=>`<option value="${i.id}">${esc(i.name)} (${i.unit})</option>`).join('');
showModal(`
<h3><i class=ji data-i=package></i> إضافة الوزن لصنف</h3>
<div class="fg"><label>الصنف</label><select id="weightItem">${itemOptions}</select></div>
<div class="fg"><label>الوزن المقاس</label><input type="number" id="recordedWeight" value="${currentWeight}" step="0.01" readonly style="background:var(--gold-d);color:var(--gold);font-weight:800"></div>
<div class="fg"><label>ملاحظات</label><textarea id="weightNotes" rows="2"></textarea></div>
<div class="modal-footer">
<button class="btn" data-karim-action="closeModal">إلغاء</button>
<button class="btn btn-gold" data-karim-action="confirmRecordWeightToItem"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function confirmRecordWeightToItem(){
const itemId = document.getElementById('weightItem')?.value;
const weight = parseFloat(document.getElementById('recordedWeight')?.value);
const notes = document.getElementById('weightNotes')?.value.trim();
const item = STATE.inventory.find(i=>String(i.id)===String(itemId));
if(!item){ toast('الصنف غير موجود','error'); return; }
if(!STATE.weightReadings) {STATE.weightReadings = [];}
const wr2 = {id:uid(), date:today(), time:nowTime(), timestamp:new Date().toISOString(),
weight, unit:weightUnit, itemId:item.id, itemName:item.name, notes,
recordedBy:STATE.currentUser?.username||'unknown'};
await persistCreate('weightReadings', (saved)=>STATE.weightReadings.push(saved), wr2);
item.weight = (item.weight||0) + (weightUnit==='kg'?weight:weightUnit==='g'?weight/1000:weight*0.453592);
item.weight = parseFloat(item.weight.toFixed(3));
await persistUpdate('inventory', item.id, {weight:item.weight});
closeModal();
toast(`تم إضافة ${fN(weight)} ${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'} إلى ${item.name}`,'success');
resetWeight();
renderPage();
}

function __dbgInvoiceState(){ return { len: currentInvoiceItems.length, items: currentInvoiceItems.map(i=>({n:i.itemName,q:i.qty,p:i.price,u:i.unit})) }; }
export { adminDirectEdit, __dbgInvoiceState, renderWarehouse, whGoSec, WHINV, whInvSearchInput, whInvFilterChange, whInvPage, whInvClearSel, whInvClearSearch, whSelToggle, whSelPage, whInvFetch, getPaymentMethodLabel, whBulkDelete, whPrintInventory, PCMT, PCMT_CAN_WRITE, PCMT_CAN_PAY, PCMT_PAY_LABELS, pcmtStatusBadge, pcmtInvoiceSupplier, pcmtInvoiceRemaining, refreshProcurementData, renderProcurement, pcmtRerenderSuppliers, openingBoxCell, openingRowKey, pcmtSuppSearchInput, pcmtSuppTaxChange, pcmtSuppPage, pcmtFetchSuppliers, pcmtTaxStatusChanged, pcmtReadTaxStatus, pcmtTaxBadge, pcmtInvoicesTab, pcmtSuppliersTab, pcmtPaymentsTab, showSupplierModal, saveSupplier, toggleSupplier, deleteSupplier, showPaymentModal, pcmtUnpaidOptions, pcmtOnSupplierChange, savePayment, payInvoiceFull, deletePayment, openStatement, loadStatement, pcmtStatementHtml, printStatement, STOCK, STOCK_CAN_WRITE, stocktakStatusBadge, stocktakChipsHtml, stocktakClientSummary, showInventoryAuditModal, stocktakSetTab, stocktakRender, stocktakScopeItems, stocktakScopePreview, stocktakSetLocation, stocktakLoadLocations, stocktakSetScope, stocktakHtmlNew, stocktakStartSession, showFiscalYearModal, closeFiscalYear, createNextFiscalYear, stocktakOpenSession, stocktakRefreshDetail, stocktakCountFilter, stocktakRowHtml, stocktakRowsTbodyHtml, stocktakStaleBanner, stocktakHtmlCount, stocktakOnSearch, stocktakToggleDiffs, stocktakScanCount, stocktakCountChanged, stocktakSaveCount, stocktakApplyItem, stocktakApplyProgress, stocktakClearCount, stocktakSavePending, stocktakSubmitSession, stocktakApproveSession, stocktakCancelSession, stocktakCancelById, stocktakPrintById, stocktakPrint, stocktakHtmlHistory, inventoryUnitOptions, showAddItemModal, scanForItemBarcodeField, scanToAddInventoryItem, showQuickStockInModal, confirmQuickStockIn, addInventoryItem, editItem, updateInventoryItem, deleteItem, addSecUnitRow, addSecUnitPreset, collectSecUnits, currentInvoiceItems, showAddPurchaseInvoiceModal, pcmtInvoiceSupplierChanged, pcmtSupplierLinkHint, pcmtSupplierQuickLink, pcmtInvoicePaidChanged, addInvoiceItemRow, removeInvoiceItemRow, updateInvoiceItem, updateInvoiceTotal, focusInvoiceEntryField, renderInvoiceItemsList, savePurchaseInvoice, openingRows, openingImportPreview, openingSupplier, showOpeningBalanceModal, downloadOpeningTemplate, openingHeaderKey, parseOpeningSheetRows, previewOpeningExcel, renderOpeningImportPreview, appendOpeningImportRows, renderOpeningRows, isOpeningMeatRow, updateOpeningBoxesVisibility, syncOpeningRowWithInventory, addOpeningRow, removeOpeningRow, updateOpeningRow, updateOpeningTotal, saveOpeningBalance, normalizeOpeningItems, postOpeningInvoice, loadOpeningExisting, buildOpeningReplaceRows, showOpeningBalanceReplaceGrid, renderOpeningReplaceRows, updateOpeningReplaceRow, confirmOpeningReplace, openingNetModeChanged, openingNetEnabled, openingIssuedFor, refreshOpeningNetCells, resolveOpeningNetItems, saveOpeningNet, mergeItemKey, findDuplicateItemGroups, showMergeDuplicatesModal, mergeDuplicateGroup, showSystemHealth, viewPurchaseInvoice, voidPurchaseInvoice, printPurchaseInvoice, showImportItemsCatalogModal, downloadItemsCatalogTemplate, previewCatalogFile, importItemsCatalog, showBulkInventoryImportModal, downloadInventoryTemplate, parseInventoryImportCell, parseInventoryImportNumber, readInventoryImportRows, inventoryImportRowsFromSheet, previewInventoryFile, importBulkInventory, renderShelves, showAddShelfModal, addShelf, editShelf, updateShelf, deleteShelf, currentWeight, weightUnit, renderWeight, adjustWeight, resetWeight, setWeightUnit, recordWeight, recordWeightToItem, confirmRecordWeightToItem, renderWhInvoices, renderWhMoves, whInvListPrint, whTxListPrint, renderWhReturns, renderWhPrs, showClearAllInvoicesModal, clearAllInvoices };
