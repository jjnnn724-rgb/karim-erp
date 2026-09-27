/**
 * features/warehouse.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// عنقود صفحة الموظفين: نُقل إلى js/features/employees.js (يجسر عبر js/main.js — BRIDGE-011)
// ============================================
// WAREHOUSE
// ============================================
function renderWarehouse(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
const totalValue = STATE.inventory.reduce((s,i)=>s+(i.qty*i.avgCost),0);
const lowStock = STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty));
const allInvoices = (STATE.purchaseInvoices||[]).slice().reverse();
const totalWeight = STATE.inventory.reduce((s,i)=>s+(i.weight||0),0);
const whCats = [...new Set((STATE.inventory||[]).map(i=>String(i.category||'عام')))].sort((a,b)=>a.localeCompare(b,'ar'));
if(window.whCatFilter!=='all' && !whCats.includes(window.whCatFilter)) {window.whCatFilter='all';}
const whItems = (STATE.inventory||[])
.filter(i=>window.whCatFilter==='all'||String(i.category||'عام')===window.whCatFilter)
.sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'ar')||String(a.name||'').localeCompare(String(b.name||''),'ar'));
const whCatOpts = whCats.map(c=>`<option value="${esc(c)}" ${window.whCatFilter===c?'selected':''}>${esc(c)}</option>`).join('');
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> ${t('wh.items')}</div><div class="mcard-val c-gold">${fN(STATE.inventory.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('wh.value')}</div><div class="mcard-val c-green">${fC(totalValue)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> ${t('wh.low')}</div><div class="mcard-val ${lowStock.length>0?'c-red':'c-green'}">${fN(lowStock.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=file-text></i> ${t('wh.invoices')}</div><div class="mcard-val c-blue">${fN(allInvoices.length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('wh.weight')}</div><div class="mcard-val c-teal">${fN(totalWeight)} كجم</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('wh.shelves')}</div><div class="mcard-val c-purple">${fN(STATE.shelves.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> ${t('wh.cats')}</div><div class="mcard-val c-orange">${fN(new Set(STATE.inventory.map(i=>i.category)).size)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> ${t('wh.lastMove')}</div><div class="mcard-val c-blue u-t14">${STATE.inventoryTx.length>0?fD(STATE.inventoryTx[STATE.inventoryTx.length-1].date):'—'}</div></div>
</div>
${whShortPanel()}
<div class="tbl-wrap">
<div class="tbl-hd">
<h3><i class=ji data-i=package></i> ${t('wh.invTitle')}</h3>
<div class="u-row-wrap">
<select class="inp" onchange="window.whCatFilter=this.value;renderPage()" style="max-width:200px" title="تصفية حسب الفئة"><option value="all">كل الفئات (${fN(STATE.inventory.length)})</option>${whCatOpts}</select>
<input type="text" class="inp" placeholder="بحث: اسم / باركود / فئة..." oninput="ysTableSearch(this,'whInvBody')" style="max-width:240px">
<button class="btn btn-blue btn-sm" onclick="whPrintInventory()"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-green btn-sm" onclick="showAddPurchaseInvoiceModal()"><i class=ji data-i=file-text></i> ${t('wh.invBill')}</button>
<button class="btn btn-gold btn-sm" onclick="showOpeningBalanceModal()" title="إدخال سريع لأرصدة بداية الفترة دفعة واحدة"><i class=ji data-i=flag></i> رصيد افتتاحي</button>
<button class="btn btn-blue btn-sm" onclick="showImportItemsCatalogModal()"><i class=ji data-i=inbox></i> ${t('wh.impCat')}</button>
<button class="btn btn-blue btn-sm" onclick="showBulkInventoryImportModal()"><i class=ji data-i=chart></i> ${t('wh.impStock')}</button>
<button class="btn btn-blue btn-sm" onclick="scanToAddInventoryItem()"><i class=ji data-i=camera></i> ${t('wh.scan')}</button>
<button class="btn btn-gold btn-sm" onclick="showAddItemModal()"><i class=ji data-i=plus></i> ${t('wh.new')}</button>
<button class="btn btn-red btn-sm" onclick="whBulkDelete()"><i class=ji data-i=trash></i> حذف المحدد</button>
<button class="btn btn-purple btn-sm" onclick="showInventoryAuditModal()"><i class=ji data-i=clipboard-list></i> ${t('wh.audit')}</button><button class="btn btn-blue btn-sm" onclick="showFiscalYearModal()"><i class=ji data-i=calendar></i> ${t('wh.fyear')}</button>
</div>
</div>
<div class="tbl-scroll">
<table>
<thead><tr><th><input type="checkbox" onchange="document.querySelectorAll('.wh-sel').forEach(c=>c.checked=this.checked)" title="تحديد الكل"></th><th>${t('wh.item')}</th><th>${t('wh.cat')}</th><th>${t('wh.unit')}</th><th>${t('wh.qty')}</th><th>${t('wh.w8')}</th><th>${t('wh.shelf')}</th><th>${t('wh.min')}</th><th>${t('wh.avg')}</th><th>${t('wh.val')}</th><th>${t('wh.status')}</th><th>${t('wh.actions')}</th></tr></thead>
<tbody id="whInvBody">
${whItems.map(item=>{
const isLow = Number(item.qty)<Number(item.minQty);
const shelf = STATE.shelves.find(s=>s.id===item.shelfId);
return `<tr>
<td><input type="checkbox" class="wh-sel" value="${esc(String(item.id))}"></td>
<td class="fw-bold">${esc(item.name)}${item.barcode?`<div style="font-size:10px;color:var(--text3);font-family:monospace;font-weight:400">${esc(item.barcode)}</div>`:''}</td>
<td class="c-gold">${esc(item.category||'—')}</td>
<td>${item.unit}</td>
<td class="${isLow?'c-red fw-bold':''}">${fN(item.qty)}</td>
<td class="c-teal">${fN(item.weight||0)}</td>
<td>${shelf?`<span class="badge bdg-purple">${esc(shelf.code)}</span>`:'<span class="text-muted">—</span>'}</td>
<td class="c-red">${fN(item.minQty)}</td>
<td class="c-gold">${fC(item.avgCost)}</td>
<td class="c-gold fw-bold">${fC(item.qty*item.avgCost)}</td>
<td><span class="badge ${isLow?'bdg-red':'bdg-green'}">${isLow?`<i class=ji data-i=alert-triangle></i> ${t('wh.lowSt')}`:`<i class=ji data-i=circle-check></i> ${t('wh.okSt')}`}</span></td>
<td style="display:flex;gap:4px"><button type="button" class="btn btn-sm" data-action="edit-inventory" data-id="${esc(String(item.id))}" onclick="editItem('${esc(String(item.id))}')"><i class=ji data-i=pencil></i> ${t('act.edit')}</button><button type="button" class="btn btn-red btn-sm" data-action="delete-inventory" data-id="${esc(String(item.id))}" onclick="deleteItem('${esc(String(item.id))}')"><i class=ji data-i=trash></i> ${t('act.delete')}</button></td>
</tr>`;
}).join('')||`<tr><td colspan="11" class="u-empty">${t('wh.noItems')}</td></tr>`}
</tbody>
</table>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=file-text></i> ${t('wh.invBills')}</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث: رقم / مورد..." oninput="ysTableSearch(this,'whBillsBody')" style="max-width:220px"></div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>عدد الأصناف</th><th>الإجمالي</th><th>طريقة الدفع</th><th>إجراءات</th></tr></thead>
<tbody id="whBillsBody">
${allInvoices.map(inv=>`<tr>
<td class="fw-bold">${esc(inv.invoiceNumber)}</td>
<td>${fD(inv.date)}</td>
<td>${esc(inv.supplierName||'—')}</td>
<td>${Array.isArray(inv.items)?inv.items.length:(typeof inv.items==='string'?(()=>{try{return JSON.parse(inv.items).length||0}catch(_){return 0}})():0)}</td>
<td class="c-gold fw-bold">${fC(inv.totalAmount)}</td>
<td><span class="badge bdg-blue">${getPaymentMethodLabel(inv.paymentMethod)}</span></td>
<td><button class="btn btn-blue btn-sm" onclick="viewPurchaseInvoice('${inv.id}')"><i class=ji data-i=eye></i> عرض</button></td>
</tr>`).join('')||'<tr><td colspan="7" class="u-empty">لا توجد فواتير</td></tr>'}
</tbody>
</table>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=chart></i> آخر حركات المخزون</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث في الحركات..." oninput="ysTableSearch(this,'whTxBody')" style="max-width:220px"></div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>القيمة</th><th>المرجع</th></tr></thead>
<tbody id="whTxBody">
${(STATE.inventoryTx||[]).slice().reverse().slice(0,20).map(tx=>`<tr>
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
</div>
${renderKitchenReturnsSection()}
${renderPRSection()}
`;
}
function getPaymentMethodLabel(method){return method==='cash'?'<i class=ji data-i=banknote></i> نقدي':method==='bank'?'<i class=ji data-i=landmark></i> بنكي':'<i class=ji data-i=credit-card></i> آجل';}
async function whBulkDelete(){
const ids=[...document.querySelectorAll('.wh-sel:checked')].map(c=>String(c.value));
if(!ids.length){toast('حدد صنفًا واحدًا على الأقل','error');return;}
if(!confirm(`حذف ${ids.length} صنفًا من المخزن؟\nالأصناف المرتبطة بحركات/وصفات لن تُحذف وستُذكر في النتيجة.`)){return;}
showLoad();
let ok=0; const blocked=[];
for(const id of ids){
try{ await persistRemove('inventory', id); ok++; }
catch(e){ const it=(STATE.inventory||[]).find(x=>String(x.id)===String(id)); blocked.push({id, name:it?it.name:id}); }
}
if(blocked.length && STATE.currentUser?.role==='admin' && confirm(`${blocked.length} صنفًا لها حركات ولم تُحذف.\nهل تريد الحذف النهائي لها مع كل حركاتها وسجلاتها؟ (لا يمكن التراجع)`)){
for(const b of blocked){
try{ await apiFetch(`/warehouse/inventory/${encodeURIComponent(b.id)}/force`,{method:'DELETE'}); ok++; b.forced=true; }
catch(e){ b.error=true; }
}
const stillBlocked=blocked.filter(b=>!b.forced);
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
toast(stillBlocked.length?`حُذف ${ok} — تعذّر ${stillBlocked.length}: ${stillBlocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا (منها حذف نهائي)`, stillBlocked.length?'error':'success');
return;
}
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
toast(blocked.length?`حُذف ${ok} — تعذّر ${blocked.length} (مرتبطة بحركات): ${blocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا`, blocked.length?'error':'success');
}
function whPrintInventory(){
const rows = (STATE.inventory||[]).map((item,i)=>{
const shelf = STATE.shelves.find(s=>s.id===item.shelfId);
return `<tr><td>${i+1}</td><td>${esc(item.name)}${item.barcode?` — ${esc(item.barcode)}`:''}</td><td>${esc(item.category||'—')}</td><td>${fN(item.qty)}</td><td>${esc(item.unit||'')}</td><td>${fC(item.avgCost)}</td><td>${fC(item.qty*item.avgCost)}</td><td>${Number(item.qty)<Number(item.minQty)?'منخفض':'سليم'}</td></tr>`;}).join('');
const totalValue = STATE.inventory.reduce((s,x)=>s+(x.qty*x.avgCost),0);
const low = STATE.inventory.filter(x=>Number(x.qty)<Number(x.minQty)).length;
ysPrintReport('كشف أصناف المخزون', `${fN(STATE.inventory.length)} صنفًا`,
[['الأصناف', fN(STATE.inventory.length)],['إجمالي القيمة', fC(totalValue)],['منخفض المخزون', fN(low)]],
['#','الصنف','الفئة','الكمية','الوحدة','متوسط التكلفة','القيمة','الحالة'], rows);
}

// ═══ مركز المشتريات والموردين — دليل موردون، أرصدة مستحقة، دفعات، كشوف حساب ═══
const PCMT = { tab:'invoices', invFilter:'all', suppSearch:'', paySupplier:'', stmt:null, stmtSupplier:null, stmtFrom:'', stmtTo:'' };
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
    let body='';
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
${PCMT.tab==='suppliers'?`<input class="u-input" style="max-width:220px" placeholder="بحث باسم المورد..." value="${esc(PCMT.suppSearch)}" oninput="PCMT.suppSearch=this.value;pcmtRerenderSuppliers()">`:''}
${PCMT.tab==='suppliers'&&PCMT_CAN_WRITE.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="showSupplierModal()"><i class=ji data-i=plus></i> مورد جديد</button>`:''}
${PCMT.tab==='payments'&&PCMT_CAN_PAY.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="showPaymentModal()"><i class=ji data-i=plus></i> تسجيل دفعة</button>`:''}
</div>
${body}
</div>`;
}
function pcmtRerenderSuppliers(){
    const wrap=document.querySelector('.tbl-wrap'); if(!wrap) {return;}
    const old=wrap.innerHTML; wrap.innerHTML=pcmtSuppliersTab(STATE.suppliers||[]);
    void old;
}
function pcmtInvoicesTab(allInvoices, unpaid){
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
<button class="btn btn-blue btn-sm" onclick="viewPurchaseInvoice('${esc(String(inv.id))}')"><i class=ji data-i=eye></i> عرض</button>
${canPay?`<button class="btn btn-green btn-sm" onclick="payInvoiceFull('${esc(String(inv.id))}')"><i class=ji data-i=coins></i> تسديد</button>`:''}
<button class="btn btn-sm" onclick="printPurchaseInvoice('${esc(String(inv.id))}')"><i class=ji data-i=printer></i> طباعة</button>
</td>
</tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد فواتير مطابقة — أنشئ فاتورة شراء مرتبطة بمورد من صفحة المخزن</td></tr>'}
</tbody>
</table>
</div>`;
}
function pcmtSuppliersTab(suppliers){
    const q=String(PCMT.suppSearch||'').trim().toLowerCase();
    const rows=suppliers.filter(s=>!q||String(s.name||'').toLowerCase().includes(q));
    return `
<div class="tbl-scroll">
<table>
<thead><tr><th>المورد</th><th>الهاتف</th><th>نوع التوريد</th><th>عدد الفواتير</th><th>إجمالي المشتريات</th><th>إجمالي الدفعات</th><th>الرصيد المستحق</th><th>الحالة</th><th>إجراءات</th></tr></thead>
<tbody>
${rows.map(s=>{
const canW=PCMT_CAN_WRITE.includes(STATE.currentUser?.role);
const canP=PCMT_CAN_PAY.includes(STATE.currentUser?.role);
return `<tr ${s.is_active?'':'style="opacity:.55"'}>
<td class="fw-bold">${esc(s.name)}</td>
<td>${esc(s.phone||'—')}</td>
<td>${esc(s.category||'—')}</td>
<td>${fN(s.invoiceCount||0)}</td>
<td class="c-gold">${fC(s.purchasesTotal||0)}</td>
<td class="c-green">${fC(s.paymentsTotal||0)}</td>
<td class="${Number(s.dueTotal)>0?'c-red fw-bold':'c-green'}">${fC(s.dueTotal||0)}</td>
<td><span class="badge ${s.is_active?'bdg-green':'bdg-red'}">${s.is_active?'نشط':'موقوف'}</span></td>
<td style="display:flex;gap:4px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" onclick="openStatement('${esc(String(s.id))}')"><i class=ji data-i=file-text></i> كشف حساب</button>
${canP&&s.is_active?`<button class="btn btn-green btn-sm" onclick="showPaymentModal('${esc(String(s.id))}')"><i class=ji data-i=coins></i> دفعة</button>`:''}
${canW?`<button class="btn btn-sm" onclick="showSupplierModal('${esc(String(s.id))}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-purple btn-sm" onclick="toggleSupplier('${esc(String(s.id))}')"><i class=ji data-i=${s.is_active?'lock':'unlock'}></i> ${s.is_active?'إيقاف':'تفعيل'}</button>
<button class="btn btn-red btn-sm" onclick="deleteSupplier('${esc(String(s.id))}')"><i class=ji data-i=trash></i> حذف</button>`:''}
</td>
</tr>`;}).join('')||'<tr><td colspan="9" class="u-empty">لا يوجد موردون — أضف أول مورد من زر «مورد جديد»</td></tr>'}
</tbody>
</table>
</div>`;
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
${canDel?`<td><button class="btn btn-red btn-sm" onclick="deletePayment('${esc(String(p.id))}')"><i class=ji data-i=trash></i> عكس</button></td>`:''}
</tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد دفعات مسجلة</td></tr>'}
</tbody>
</table>
</div>`;
}
function showSupplierModal(id){
    const s=id?(STATE.suppliers||[]).find(x=>String(x.id)===String(id)):null;
    showModal(`
<h3><i class=ji data-i=users></i> ${s?'تعديل مورد':'مورد جديد'}</h3>
<div class="fr"><div class="fg"><label>اسم المورد *</label><input type="text" id="suppName" value="${esc(s?.name||'')}" placeholder="مثال: مؤسسة اللحوم الطازجة"></div>
<div class="fg"><label>رقم الهاتف</label><input type="text" id="suppPhone" value="${esc(s?.phone||'')}" placeholder="05xxxxxxxx"></div></div>
<div class="fr"><div class="fg"><label>نوع التوريد</label><input type="text" id="suppCategory" value="${esc(s?.category||'')}" placeholder="لحوم / خضار / مشروبات..."></div>
<div class="fg"><label>الرصيد الافتتاحي المستحق</label><input type="number" id="suppOpening" value="${s?Number(s.openingBalance||0):0}" step="0.01" min="0"><small class="text-muted">ما عليه له قبل استخدام النظام</small></div></div>
<div class="fg"><label>العنوان</label><input type="text" id="suppAddress" value="${esc(s?.address||'')}"></div>
<div class="fg"><label>ملاحظات</label><textarea id="suppNotes" rows="2">${esc(s?.notes||'')}</textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="saveSupplier(${s?`'${esc(String(s.id))}'`:'null'})"><i class=ji data-i=save></i> حفظ</button></div>
`);
}
async function saveSupplier(id){
    const payload={ name:document.getElementById('suppName')?.value.trim(), phone:document.getElementById('suppPhone')?.value.trim(),
        category:document.getElementById('suppCategory')?.value.trim(), address:document.getElementById('suppAddress')?.value.trim(),
        notes:document.getElementById('suppNotes')?.value.trim(), openingBalance:document.getElementById('suppOpening')?.value };
    if(!payload.name||payload.name.length<2){ toast('اسم المورد مطلوب (حرفان على الأقل)','error'); return; }
    try{
        if(id){ const row=await apiFetch('/procurement/suppliers/'+id,{method:'PUT',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تم تحديث بيانات المورد','success'); }
        else{ const row=await apiFetch('/procurement/suppliers',{method:'POST',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تمت إضافة المورد','success'); }
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
<div class="fr"><div class="fg"><label>المورد *</label><select id="paySupplier" onchange="pcmtOnSupplierChange()">${suppliers.map(s=>`<option value="${esc(String(s.id))}" ${String(selected)===String(s.id)?'selected':''}>${esc(s.name)} — مستحق ${fN(s.dueTotal)}</option>`).join('')}</select></div>
<div class="fg"><label>المبلغ *</label><input type="number" id="payAmount" step="0.01" min="0.01" placeholder="0.00"></div></div>
<div class="fr"><div class="fg"><label>طريقة الدفع</label><select id="payMethod"><option value="cash">نقدي</option><option value="bank">تحويل بنكي</option><option value="card">بطاقة</option><option value="cheque">شيك</option></select></div>
<div class="fg"><label>التاريخ</label><input type="date" id="payDate" value="${today()}"></div></div>
<div class="fg"><label>ربط بفاتورة (اختياري)</label><select id="payInvoice"><option value="">دفعة على الحساب العام</option>${pcmtUnpaidOptions(selected)}</select>
<small class="text-muted">عند الربط يجب ألا يتجاوز المبلغ المتبقي على الفاتورة</small></div>
<div class="fg"><label>ملاحظات</label><input type="text" id="payNotes" placeholder="مثال: دفعة أولى"></div>
<div id="payHint" class="u-t13 text-muted"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="savePayment()"><i class=ji data-i=save></i> حفظ الدفعة</button></div>
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
<div class="fg"><label>&nbsp;</label><button class="btn btn-blue" onclick="loadStatement()"><i class=ji data-i=search></i> عرض الكشف</button></div></div>
<div id="stmtBody"><div class="u-empty" style="padding:24px">اختر الفترة (أو اتركها فارغة لكل الحركات) ثم اعرض الكشف</div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button><button class="btn btn-gold" onclick="printStatement()"><i class=ji data-i=printer></i> طباعة</button></div>
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
    const win=window.open('','_blank','width=900,height=1000');
    if(!win){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
    win.document.open();
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب — ${esc(s.name)}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}@media print{.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button onclick="window.print()">طباعة</button><button onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'')}</h1><p>كشف حساب مورد</p><p>${esc(s.name)}${s.phone?' — '+esc(s.phone):''}</p></header><section class="meta"><div><b>من</b>${PCMT.stmtFrom||'البداية'}</div><div><b>إلى</b>${PCMT.stmtTo||'اليوم'}</div><div><b>الرصيد الافتتاحي</b>${fN(stmt.openingBalance)} ${currency}</div></section><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows||'<tr><td colspan="6">لا حركات</td></tr>'}</tbody><tfoot><tr><td colspan="3">إجمالي الفترة</td><td>${fN(stmt.totals.debit)}</td><td>${fN(stmt.totals.credit)}</td><td>الختامي: ${fN(stmt.totals.closing)}</td></tr></tfoot></table></main></body></html>`);
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
            <button class="st-tab" id="sttab-new" onclick="stocktakSetTab('new')"><i class=ji data-i=plus></i> جلسة جديدة</button>
            <button class="st-tab" id="sttab-count" onclick="stocktakSetTab('count')"><i class=ji data-i=clipboard-list></i> العد والفروقات</button>
            <button class="st-tab" id="sttab-history" onclick="stocktakSetTab('history')"><i class=ji data-i=history></i> سجل الجرد</button>
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
    else if(mode==='search'){ const q=search.trim(); if(q) {items = items.filter(i=>String(i.name||'').includes(q)||String(i.barcode||'').includes(q));} }
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
        }catch(e){
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
    try{ STOCK.locations = await apiFetch('/warehouse/inventory/locations'); }catch(e){ STOCK.locations=[]; }
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
        <div class="st-loc ${Number(l.id)===Number(STOCK.locationId)?'active':''}" data-loc="${l.id}" onclick="stocktakSetLocation('${l.id}')">
            <i class=ji data-i=package></i>
            <strong>${esc(l.name_ar)}</strong>
            <span>${l.dept_name?esc(l.dept_name)+' · ':''}${fN(l.items_count)} ${fN(l.items_count)} صنف · ${fC(l.on_hand_value)}</span>
        </div>`).join('');
    const openStrip = open.length?`<div class="st-resume"><i class=ji data-i=alert-circle></i> لديك جلسات جرد مفتوحة:
        ${open.slice(0,3).map(a=>`<button class="btn btn-gold btn-sm" onclick="stocktakOpenSession('${a.id}')">${esc(a.audit_number)} — متابعة العد</button>`).join('')}</div>`:'';
    return `${openStrip}
    <div class="audit-note"><strong>دورة جرد آمنة بثلاث خطوات — لكل مخزن على حدة</strong><br>
    <span class="text-muted">١) اختر المخزن وحدّد نطاق الجرد وابدأ الجلسة — ٢) عدّ الأصناف فعلياً (يُحفظ كل عدّ تلقائياً وتظهر الفروقات فوراً مقارنةً برصيد هذا المخزن) — ٣) اعتمد الفروقات فيُطبَّق على رصيد المخزن بحركات تصحيح موثّقة، وعجز المخزن يُسجَّل كلفة على القسم صاحبه. لا يتأثر أي رصيد قبل الاعتماد.</span></div>
    <h4 class="st-lochead"><i class=ji data-i=package></i> اختر مخزن الجرد</h4>
    <div class="st-loc-grid">${locChips||'<div class="text-muted">لا توجد مخازن مفعّلة</div>'}</div>
    <div class="st-scope-grid">
        <div class="st-scope active" onclick="stocktakSetScope('all')"><i class=ji data-i=package></i><strong>كل أصناف المخزن</strong><span>جرد شامل للمخزن المختار</span></div>
        <div class="st-scope" onclick="stocktakSetScope('in_stock')"><i class=ji data-i=box></i><strong>ذات رصيد فقط</strong><span>تجاهل أصناف الصفر في هذا المخزن</span></div>
        <div class="st-scope" onclick="stocktakSetScope('category')"><i class=ji data-i=folder></i><strong>فئة محددة</strong><span>جرد جزئي سريع</span></div>
        <div class="st-scope" onclick="stocktakSetScope('search')"><i class=ji data-i=search></i><strong>بحث بالاسم/الباركود</strong><span>أصناف مختارة</span></div>
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
    <div class="modal-footer" style="margin-top:14px"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-purple" id="stStartBtn" onclick="stocktakStartSession()"><i class=ji data-i=play></i> بدء جلسة الجرد</button></div>`;
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
        const cards=years.map(y=>`<tr><td><strong>${esc(y.name||y.year_code)}</strong><div class="text-muted">${esc(String(y.start_date))} → ${esc(String(y.end_date))}</div></td><td><span class="badge ${y.status==='closed'?'bdg-green':'bdg-blue'}">${y.status==='closed'?'مغلقة':'مفتوحة'}</span></td><td>${y.status==='closed'?`إيرادات: ${fC(y.closing_snapshot?.revenue_total||0)}<br>صافي: ${fC(y.closing_snapshot?.net_result||0)}`:'بانتظار الإقفال'}</td><td>${y.status==='open'&&canClose?`<button class="btn btn-gold btn-sm" onclick="closeFiscalYear('${y.id}')"><i class=ji data-i=lock></i> إقفال السنة</button>`:''}${y.status==='closed'&&canClose?`<button class="btn btn-blue btn-sm" onclick="createNextFiscalYear('${y.id}')"><i class=ji data-i=plus></i> السنة التالية</button>`:''}</td></tr>`).join('');
        showModal(`<h3><i class=ji data-i=calendar></i> السنة المالية والإقفال</h3><div class="audit-note"><strong>${current?esc(current.name):'لا توجد سنة مالية'}</strong><br><span class="text-muted">لا يتم حذف المبيعات أو المصروفات. يحفظ النظام لقطة إقفال، قيمة المخزون، وترحيل الأرصدة الافتتاحية للسنة التالية.</span></div><div class="tbl-scroll"><table><thead><tr><th>السنة</th><th>الحالة</th><th>الملخص</th><th>الإجراء</th></tr></thead><tbody>${cards||'<tr><td colspan="4">لا توجد سنوات مالية</td></tr>'}</tbody></table></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button></div>`,'modal-wide');
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
    if(q) {out = out.filter(i=>String(i.item_name||'').includes(q)||String(i.barcode||'').includes(q)||String(i.category||'').includes(q));}
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
        <td class="c"><input type="number" class="st-count-input" id="stc-${item.item_id}" min="0" step="0.001" inputmode="decimal" value="${counted?item.counted_qty:''}" placeholder="${item.system_qty}" ${locked?'disabled':''} oninput="stocktakCountChanged(${item.item_id})" onchange="stocktakSaveCount(${item.item_id},true)"></td>
        <td class="c st-var ${diffCls}" id="stv-${item.item_id}">${varText}</td>
        <td class="c st-val ${diffCls}" id="stvv-${item.item_id}">${counted?fC(item.variance_value):'—'}</td>
        <td><input type="text" class="st-note" id="stn-${item.item_id}" value="${esc(item.notes||'')}" placeholder="ملاحظة" ${locked?'disabled':''} onchange="stocktakSaveCount(${item.item_id},true)"></td>
        <td class="c">${counted&&!locked?`<button class="st-clear" title="مسح العد وإرجاعه إلى غير معدود" onclick="stocktakClearCount(${item.item_id})"><i class=ji data-i=x></i></button>`:''}</td>
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
        ${open.length?open.slice(0,5).map(a=>`<button class="btn btn-gold btn-sm" onclick="stocktakOpenSession('${a.id}')">${esc(a.audit_number)} (${a.item_count||0} صنف)</button>`).join(''):'<span class="text-muted">لا توجد جلسات مفتوحة</span>'}</div>`;
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
        <div class="st-search"><i class=ji data-i=search></i><input type="text" id="stSearchInput" placeholder="بحث بالاسم أو الباركود أو الفئة…" value="${esc(STOCK.search)}" oninput="stocktakOnSearch(this.value)"></div>
        <label class="st-diffsonly"><input type="checkbox" ${STOCK.diffsOnly?'checked':''} onchange="stocktakToggleDiffs(this.checked)"> الفروقات فقط</label>
        <button class="btn btn-sm" onclick="stocktakScanCount()"><i class=ji data-i=camera></i> مسح باركود</button>
        <button class="btn btn-blue btn-sm" onclick="stocktakPrint('count-sheet')"><i class=ji data-i=printer></i> ورقة الجرد</button>
        <button class="btn btn-sm" onclick="stocktakRefreshDetail()"><i class=ji data-i=refresh></i> تحديث</button>
    </div>
    <div class="tbl-scroll" style="max-height:42vh">
        <table class="st-table"><thead><tr><th>الصنف</th><th class="c">رصيد النظام</th><th class="c" style="min-width:130px">العدّ الفعلي</th><th class="c">الفرق</th><th class="c">قيمة الفرق</th><th style="min-width:120px">ملاحظة</th><th class="c"></th></tr></thead>
        <tbody id="stTbody">${stocktakRowsTbodyHtml()}</tbody></table>
    </div>
    ${locked?`<div class="modal-footer" style="margin-top:12px"><button class="btn" onclick="stocktakPrint('report')"><i class=ji data-i=printer></i> طباعة التقرير</button>${audit.status==='submitted'&&canWrite?`<button class="btn btn-gold" onclick="stocktakCancelSession()"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button><button class="btn btn-purple" onclick="stocktakApproveSession()"><i class=ji data-i=circle-check></i> اعتماد وتطبيق الفروقات</button>`:''}</div>`
    :canWrite?`
    ${signaturePadMarkup('stSignature','توقيع مسؤول الجرد / المعتمد')}
    <div class="modal-footer" style="margin-top:12px">
        <button class="btn btn-gold" onclick="stocktakCancelSession()"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button>
        <button class="btn btn-blue" onclick="stocktakSubmitSession()"><i class=ji data-i=send></i> إرسال للاعتماد</button>
        <button class="btn btn-purple" onclick="stocktakApproveSession()"><i class=ji data-i=circle-check></i> اعتماد فوري وتطبيق الفروقات</button>
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
        setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){} setTimeout(()=>frame.remove(),2000); },500);
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
        const actions = [`<button class="btn btn-blue btn-sm" onclick="stocktakOpenSession('${a.id}')"><i class=ji data-i=eye></i> فتح</button>`];
        if(a.status!=='cancelled') {actions.push(`<button class="btn btn-sm" onclick="stocktakPrintById('${a.id}','report')"><i class=ji data-i=printer></i> تقرير</button>`);}
        if(['draft','submitted'].includes(a.status)&&STOCK_CAN_WRITE.includes(STATE.currentUser?.role)) {actions.push(`<button class="btn btn-gold btn-sm" onclick="stocktakCancelById('${a.id}')"><i class=ji data-i=x-circle></i> إلغاء</button>`);}
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
function showAddItemModal(prefillBarcode=''){
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=package></i> إضافة صنف جديد</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="itemName"></div><div class="fg"><label>الفئة</label><input type="text" id="itemCategory"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="itemBarcode" value="${esc(prefillBarcode)}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" onclick="scanForItemBarcodeField('itemBarcode')"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="itemUnit">${inventoryUnitOptions('kg')}</select><small class="text-muted">مثال: زيت باللتر، أرز بالكجم، دجاج بالقطعة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="itemMinQty" value="5" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الكمية الافتتاحية</label><input type="number" id="itemQty" value="0" step="0.01"></div><div class="fg"><label>سعر الشراء</label><input type="number" id="itemPrice" value="0" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="itemWeight" value="0" step="0.01"></div><div class="fg"><label>الرف</label><select id="itemShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addInventoryItem()"><i class=ji data-i=save></i> حفظ</button></div>`);
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
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmQuickStockIn('${item.id}')"><i class=ji data-i=save></i> إضافة للمخزون</button></div>`);
setTimeout(()=>{ document.getElementById('quickStockQty')?.focus(); document.getElementById('quickStockQty')?.select(); },50);
}
async function confirmQuickStockIn(itemId){
if(confirmQuickStockIn._busy){return;}
const item=STATE.inventory.find(i=>i.id===itemId);
if(!item) {return;}
const qty=parseFloat(document.getElementById('quickStockQty')?.value)||0;
const price=parseFloat(document.getElementById('quickStockPrice')?.value)||item.avgCost;
if(qty<=0){ toast('أدخل كمية صحيحة','error'); return; }
confirmQuickStockIn._busy=true;
const oldValue=item.qty*item.avgCost;
const newValue=qty*price;
const newQty=item.qty+qty;
const newAvgCost=newQty>0?(oldValue+newValue)/newQty:price;
try{
const result = await apiFetch(`/warehouse/inventory/${encodeURIComponent(item.id)}/receipt`, {method:'POST',body:JSON.stringify({qty,price,unit:item.unit})});
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
if(!name){toast('أدخل اسم الصنف','error');return;}
if(STATE.inventory.find(i=>i.name===name)){toast('هذا الصنف موجود بالفعل','error');return;}
if(barcode && STATE.inventory.find(i=>i.barcode && i.barcode===barcode)){toast('هذا الباركود مستخدم لصنف آخر بالفعل','error');return;}
addInventoryItem._busy=true;
try{
const newItem = await persistCreate('inventory', (saved)=>STATE.inventory.push(saved), {id:uid(),name,category,unit,qty,avgCost:price,minQty,weight,shelfId,barcode});
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
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}" ${item.shelfId==s.id?'selected':''}>${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل الصنف</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="eiName" value="${esc(item.name)}"></div><div class="fg"><label>الفئة</label><input type="text" id="eiCategory" value="${esc(item.category||'')}"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="eiBarcode" value="${esc(item.barcode||'')}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" onclick="scanForItemBarcodeField('eiBarcode')"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="eiUnit">${inventoryUnitOptions(item.unit)}</select><small class="text-muted">يجب أن تطابق وحدة السعر في الفاتورة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="eiMin" value="${item.minQty}" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="eiWeight" value="${item.weight||0}" step="0.01"></div><div class="fg"><label>الرف</label><select id="eiShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r)">
<div>الكمية الحالية: <strong class="c-gold">${fN(item.qty)} ${item.unit}</strong></div>
<div>متوسط السعر: <strong class="c-gold">${fC(item.avgCost)}</strong></div>
</div>
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r);border:1px dashed var(--border)">
<strong style="font-size:13px"><i class=ji data-i=repeat></i> وحدات طلب ثانوية</strong>
<small class="text-muted" style="display:block;margin:4px 0 8px">لو الأقسام تطلب الصنف بوحدة مختلفة (شكارة، كرتون، شوال...) سجلها هنا مع محتواها — مثال: شكارة أرز = 50 كجم. عند طلب الصرف بالشكارة يتحوّل المبلغ تلقائيًا لوحدة المخزن.</small>
<div id="secUnitsRows"></div>
<button type="button" class="btn btn-blue btn-sm" onclick="addSecUnitRow()"><i class=ji data-i=plus></i> إضافة وحدة</button>
</div>
<div class="modal-footer"><button type="button" class="btn btn-red" onclick="deleteItem('${esc(String(id))}')"><i class=ji data-i=trash></i> حذف</button><button type="button" class="btn" onclick="closeModal()">إلغاء</button><button type="button" class="btn btn-gold" onclick="updateInventoryItem('${esc(String(id))}')"><i class=ji data-i=save></i> حفظ</button></div>`);
try{ (Array.isArray(item.secondary_units)?item.secondary_units:[]).forEach(u=>addSecUnitRow(u.uom,u.factor)); }catch(_){}
}
// ─── محرر وحدات الطلب الثانوية ───
function addSecUnitRow(uom='', factor=''){
const box=document.getElementById('secUnitsRows');
if(!box){return;}
const div=document.createElement('div');
div.className='fr sec-unit-row';
div.style.cssText='align-items:end;margin-top:6px;gap:6px';
div.innerHTML=`<div class="fg" style="flex:1"><label>اسم الوحدة</label><input type="text" class="sec-uom" value="${esc(String(uom||''))}" placeholder="شكارة، كرتون، شوال..."></div>
<div class="fg" style="flex:1"><label>محتواها من الوحدة الأساسية</label><input type="number" class="sec-factor" value="${esc(String(factor||''))}" step="0.001" min="0.001" placeholder="50"></div>
<button type="button" class="btn btn-red btn-sm" onclick="this.parentElement.remove()" title="حذف الوحدة"><i class=ji data-i=x></i></button>`;
box.appendChild(div);
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
const saved = await persistUpdate('inventory', id, {name,category,barcode,unit,minQty,weight,shelfId,qty:item.qty,avgCost:item.avgCost,secondary_units:secUnits.length?secUnits:null});
Object.assign(item, saved || {name,category,barcode,unit,minQty,weight,shelfId,secondary_units:secUnits.length?secUnits:null});
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
function showAddPurchaseInvoiceModal(){
currentInvoiceItems = [];
renderInvoiceItemsList();
showModal(`
<h3><i class=ji data-i=file-text></i> فاتورة مشتريات جديدة</h3>
<div class="fr">
<div class="fg"><label>رقم الفاتورة</label><input type="text" id="invoiceNumber" placeholder="INV-001"></div>
<div class="fg"><label>تاريخ الفاتورة</label><input type="date" id="invoiceDate" value="${today()}"></div>
</div>
<div class="fr">
<div class="fg"><label>المورد <small class="text-muted">(اختياري — يربط الفاتورة بالحساب)</small></label><select id="invoiceSupplierSel" onchange="pcmtInvoiceSupplierChanged()"><option value="">بدون ربط (اسم حر)</option>${(STATE.suppliers||[]).filter(s=>s.is_active).map(s=>`<option value="${esc(String(s.id))}">${esc(s.name)}</option>`).join('')}</select></div>
<div class="fg" id="invoiceSupplierNameWrap" style="display:none"><label>اسم المورد</label><input type="text" id="supplierName"></div>
<div class="fg" id="invoiceSupplierPhoneWrap" style="display:none"><label>رقم الهاتف</label><input type="text" id="supplierPhone"></div>
</div>
<div style="margin:16px 0">
<div style="font-weight:700;margin-bottom:12px"><i class=ji data-i=package></i> الأصناف</div>
<div id="invoiceItemsList"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addInvoiceItemRow()"><i class=ji data-i=plus></i> إضافة صنف</button>
</div>
<div class="fr">
<div class="fg"><label>إجمالي الفاتورة <small class="text-muted">(محسوب تلقائيًا)</small></label><input type="number" id="invoiceTotal" readonly aria-readonly="true" title="يُحسب تلقائيًا من كمية وسعر كل صنف" onclick="focusInvoiceEntryField()" style="background:var(--gold-d);color:var(--gold);font-weight:800;cursor:pointer"><small class="text-muted">اكتب الكمية والسعر في سطور الأصناف، وسيتم تحديث الإجمالي تلقائيًا.</small></div>
<div class="fg"><label>طريقة الدفع</label><select id="paymentMethod" onchange="pcmtInvoicePaidChanged()"><option value="cash">نقدي (مسدد)</option><option value="bank">تحويل بنكي (مسدد)</option><option value="credit">آجل (غير مسدد)</option></select></div>
</div>
<div class="fr">
<div class="fg"><label>المسدد الآن</label><input type="number" id="invoicePaidAmount" step="0.01" min="0" value="0" oninput="pcmtInvoicePaidChanged(true)"><small class="text-muted">اتركه 0 للآجل — سيحدد حالة السداد تلقائياً</small></div>
<div class="fg"><label>حالة السداد المتوقعة</label><div id="invoiceStatusPreview"><span class="badge bdg-red">غير مسددة</span></div></div>
</div>
<div class="fg"><label>ملاحظات</label><textarea id="invoiceNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="savePurchaseInvoice()"><i class=ji data-i=save></i> حفظ الفاتورة</button></div>
`);
}
function pcmtInvoiceSupplierChanged(){
    const sel=document.getElementById('invoiceSupplierSel'); if(!sel) {return;}
    const linked=String(sel.value)!=='';
    const nameWrap=document.getElementById('invoiceSupplierNameWrap');
    const phoneWrap=document.getElementById('invoiceSupplierPhoneWrap');
    if(nameWrap) {nameWrap.style.display=linked?'none':'';}
    if(phoneWrap) {phoneWrap.style.display=linked?'none':'';}
    pcmtInvoicePaidChanged();
}
function pcmtInvoicePaidChanged(fromInput){
    const totalEl=document.getElementById('invoiceTotal');
    const paidEl=document.getElementById('invoicePaidAmount');
    const prev=document.getElementById('invoiceStatusPreview');
    if(!paidEl||!prev) {return;}
    if(!fromInput){
        const method=document.getElementById('paymentMethod')?.value||'cash';
        paidEl.value=method==='credit'?'0':(totalEl?.value||'0');
    }
    const total=Number(totalEl?.value||0);
    const paid=Math.min(Math.max(Number(paidEl.value||0),0),total);
    let badge;
    if(total<=0||paid>=total) {badge='<span class="badge bdg-green">مدفوعة</span>';}
    else if(paid<=0) {badge='<span class="badge bdg-red">غير مسددة</span>';}
    else {badge=`<span class="badge bdg-gold">مسددة جزئياً — متبقٍ ${fN(total-paid)}</span>`;}
    prev.innerHTML=badge;
}
function addInvoiceItemRow(){ currentInvoiceItems.push({id:uid(),itemName:'',itemId:null,qty:1,price:0,total:0,unit:'وحدة',weight:''}); renderInvoiceItemsList(); }
function removeInvoiceItemRow(index){ currentInvoiceItems.splice(index,1); renderInvoiceItemsList(); }
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
}else if(field==='qty'){ item.qty=parseFloat(value)||0; }
else if(field==='unit'){ item.unit=String(value||'').trim()||'وحدة'; }
else if(field==='price'){ item.price=parseFloat(value)||0; }
else if(field==='weight'){ item.weight=String(value||'').trim()===''?'':(parseFloat(value)||0); }
item.total = item.qty * item.price;
const totalEl=document.getElementById(`item_total_${index}`);
if(totalEl) {totalEl.innerHTML=fC(item.total);}
updateInvoiceTotal();
}
function updateInvoiceTotal(){
const total = currentInvoiceItems.reduce((sum,item)=>sum+item.total,0);
const totalInput=document.getElementById('invoiceTotal');
if(totalInput) {totalInput.value=total.toFixed(2);}
// حالة السداد التوقّعية تتبع الإجمالي الحي (النقدي يُسدد كاملًا تلقائيًا)
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
  <div style="flex:2;min-width:180px;position:relative"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><input type="text" id="item_name_${idx}" value="${esc(item.itemName)}" placeholder="ابحث عن صنف..." class="u-input" onchange="updateInvoiceItem(${idx},'itemName',this.value)" list="inventoryList${idx}"><datalist id="inventoryList${idx}">${inventoryOptions}</datalist></div>
  <div class="u-flex1" style="min-width:100px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input type="number" id="item_qty_${idx}" value="${item.qty}" step="0.01" min="0" placeholder="الكمية" class="u-input" onchange="updateInvoiceItem(${idx},'qty',this.value)"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوحدة</small><input type="text" id="item_unit_${idx}" value="${esc(item.unit||'وحدة')}" list="invoiceUnitOptions" placeholder="كجم / شوال / علبة" class="u-input" onchange="updateInvoiceItem(${idx},'unit',this.value)"></div>
  <div class="u-flex1" style="min-width:110px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوزن الإجمالي (كجم)</small><input type="number" id="item_weight_${idx}" value="${item.weight??''}" min="0" step="0.01" placeholder="اختياري" class="u-input" onchange="updateInvoiceItem(${idx},'weight',this.value)"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">سعر الوحدة</small><input type="number" id="item_price_${idx}" value="${item.price}" min="0" step="0.01" placeholder="السعر" class="u-input" onchange="updateInvoiceItem(${idx},'price',this.value)"></div>
  <div style="flex:1;min-width:95px;text-align:center;font-weight:800;color:var(--gold)"><small style="display:block;margin-bottom:4px;color:var(--text3)">الإجمالي</small><span id="item_total_${idx}">${fC(item.total)}</span></div>
  <button type="button" onclick="removeInvoiceItemRow(${idx})" style="background:var(--red);color:white;border:none;border-radius:8px;padding:8px 12px;cursor:pointer" title="حذف الصنف"><i class=ji data-i=x></i></button>
  </div>`;
 }).join('');
 container.innerHTML=`<datalist id="invoiceUnitOptions">${unitOptions}</datalist><div class="text-muted" style="font-size:12px;margin-bottom:10px">الوحدة مرنة ويمكن كتابتها مثل: كجم، شوال، علبة أو كرتون. الوزن الإجمالي اختياري بالكيلوجرام.</div>${rows}`;
}
async function savePurchaseInvoice(){
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
try{
const result=await apiFetch('/warehouse/purchase-invoices',{method:'POST',body:JSON.stringify({
invoiceNumber,date:invoiceDate,supplierName,supplierPhone,paymentMethod,notes,
supplierId:supplierSel||null,
paidAmount:(paidAmountRaw!==''&&paidAmountRaw!=null)?Number(paidAmountRaw):undefined,
items:validItems.map(item=>({...item}))
})});
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
let msg = `تم إضافة فاتورة شراء بقيمة ${fC(result.totalAmount||0)} وتحديث المخزون`;
if(result.invoice?.supplierId){ msg += ` — الحالة: ${(result.invoice.paymentStatus==='paid')?'مدفوعة':(result.invoice.paymentStatus==='partial')?'مسددة جزئياً':'غير مسددة'}`; await refreshProcurementData(); }
if((result.createdNames||[]).length > 0){
msg += ` — تم إنشاء ${result.createdNames.length} صنف جديد: ${result.createdNames.slice(0,3).join('،')}${result.createdNames.length>3?` (+${result.createdNames.length-3})`:''}`;
}
toast(msg,'success');
}catch(e){ toast(e.message||'تعذر حفظ فاتورة الشراء','error'); }
}
// ═══ الرصيد الافتتاحي: إدخال سريع دفعة واحدة → فاتورة شراء آجلة على مورد الافتتاح ═══
let openingRows=[];
let openingImportPreview={rows:[],errors:[],fileName:''};
function openingSupplier(){
return (STATE.suppliers||[]).find(s=>s.category==='افتتاحي'||/افتتاحي/.test(s.name||''))
|| { id:null, name:'رصيد افتتاحي - بداية الفترة' };
}
function showOpeningBalanceModal(){
openingRows=[{name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}];
renderOpeningRows();
const sup=openingSupplier();
showModal(`<h3><i class=ji data-i=flag></i> رصيد افتتاحي — بداية الفترة</h3>
<div class="workflow-banner"><i class=ji data-i=info></i> أدخل جردك دفعة واحدة: <strong>الاسم + الكمية + الوحدة + سعر الشراء</strong> — واللحوم أضف <strong>عدد الكراتين</strong>. تُحفظ كفاتورة آجلة (مسدد 0) على المورد <strong>${esc(sup.name)}</strong> بلا حركة نقدية.</div>
<div class="callout-blue u-my16"><div class="fw-bold"><i class=ji data-i=file-text></i> إدخال احترافي من Excel</div><div class="text-muted u-t12 u-my8">حمّل النموذج، املأ الأصناف، ثم ارفع الملف لمراجعته قبل إضافته للفاتورة.</div><div class="u-row-wrap"><button type="button" class="btn btn-blue btn-sm" onclick="downloadOpeningTemplate()"><i class=ji data-i=arrow-down></i> تحميل النموذج</button><label class="btn btn-green btn-sm" style="cursor:pointer"><i class=ji data-i=inbox></i> رفع شيت Excel<input type="file" id="openingExcelFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="previewOpeningExcel(this.files[0])"></label></div><div id="openingImportPreview" class="u-mt8"></div></div>
<div id="openingRows" style="margin-top:12px"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addOpeningRow()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="callout-gold u-my16"><div class="fw-bold">إجمالي الرصيد الافتتاحي</div><div class="callout-value" id="openingTotal">${fC(0)}</div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="saveOpeningBalance()"><i class=ji data-i=save></i> حفظ الرصيد الافتتاحي</button></div>`);
renderOpeningRows();
updateOpeningTotal();
}
function downloadOpeningTemplate(){
const data=[['اسم الصنف','الكمية','الوحدة','سعر الشراء','الكراتين','الفئة'],['دجاج','50','كجم','25','4','لحوم'],['مشروم','12','علبة','18','','معلبات'],['دقيق','20','كيس','3.5','','حبوب']];
const ws=XLSX.utils.aoa_to_sheet(data); ws['!cols']=[{wch:24},{wch:16},{wch:16},{wch:12},{wch:18}];
const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'الرصيد الافتتاحي');
XLSX.writeFile(wb,`نموذج_الرصيد_الافتتاحي_${today()}.xlsx`); toast('تم تحميل نموذج الرصيد الافتتاحي','success');
}
function openingHeaderKey(value){
return String(value||'').trim().toLowerCase().replace(/[\s_()-]/g,'').replace(/[أإآ]/g,'ا');
}
function previewOpeningExcel(file){
if(!file){return;}
const reader=new FileReader();
reader.onload=e=>{
try{
const wb=XLSX.read(e.target.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
if(data.length<2){throw new Error('الملف لا يحتوي على صفوف بيانات بعد عناوين الأعمدة');}
const headers=data[0].map(openingHeaderKey);
const findHeader=names=>{const keys=names.map(openingHeaderKey); return headers.findIndex(h=>keys.includes(h));};
const nameIdx=findHeader(['اسم الصنف','الصنف','اسم','item','name']);
const qtyIdx=findHeader(['الكميةكجم','الكمية','كمية','qty','quantity']);
const unitIdx=findHeader(['الوحدة','وحدة','unit','uom']);
const priceIdx=findHeader(['سعر الشراء','سعر','التكلفة','price','cost']);
const boxesIdx=findHeader(['الكراتين','كراتين','عدد الكراتين','boxes','cartons']);
const categoryIdx=findHeader(['الفئة','التصنيف','category','cat']);
if(nameIdx<0||qtyIdx<0||priceIdx<0){throw new Error('الأعمدة المطلوبة هي: اسم الصنف، الكمية، الوحدة، سعر الشراء');}
const rows=[],errors=[];
data.slice(1).forEach((row,index)=>{
const line=index+2, name=String(row[nameIdx]||'').trim(), qty=Number(row[qtyIdx]), price=Number(row[priceIdx]), rawBoxes=boxesIdx>=0?String(row[boxesIdx]??'').trim():'';
if(!name&&!rawBoxes&&!String(row[qtyIdx]??'').trim()&&!String(row[priceIdx]??'').trim()){return;}
const rowErrors=[];
if(!name){rowErrors.push('اسم الصنف مفقود');}
if(!Number.isFinite(qty)||qty<=0){rowErrors.push('الكمية يجب أن تكون أكبر من صفر');}
if(!Number.isFinite(price)||price<0){rowErrors.push('سعر الشراء غير صحيح');}
let boxes=null;
if(rawBoxes!==''){boxes=Number(rawBoxes); if(!Number.isInteger(boxes)||boxes<=0){rowErrors.push('الكراتين عدد صحيح أكبر من صفر');}}
if(boxes!==null&&isOpeningMeatRow({name,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()} )===false){rowErrors.push('الكراتين مسموحة لأصناف اللحوم فقط');}
if(rowErrors.length){errors.push({line,message:rowErrors.join('،')}); return;}
rows.push({name,qty,unit:String(unitIdx>=0?row[unitIdx]||'':'').trim()||'كجم',price,boxes,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()||'عام'});
});
openingImportPreview={rows,errors,fileName:file.name}; renderOpeningImportPreview();
}catch(error){openingImportPreview={rows:[],errors:[{line:'—',message:error.message||'تعذر قراءة الملف'}],fileName:file.name}; renderOpeningImportPreview();}
};
reader.readAsArrayBuffer(file);
}
function renderOpeningImportPreview(){
const el=document.getElementById('openingImportPreview'); if(!el){return;}
const p=openingImportPreview;
if(!p.fileName){el.innerHTML=''; return;}
el.innerHTML=`<div class="u-t12"><strong>${esc(p.fileName)}</strong> — ${p.rows.length} صف صالح${p.errors.length?`، <span class="c-red">${p.errors.length} صف يحتاج تصحيحًا</span>`:'، جاهز للإضافة'}</div>${p.errors.length?`<div class="c-red u-t12 u-my8">${p.errors.slice(0,8).map(e=>`الصف ${e.line}: ${esc(e.message)}`).join('<br>')}${p.errors.length>8?'<br>...':''}</div>`:''}<button type="button" class="btn btn-green btn-sm u-mt8" onclick="appendOpeningImportRows()" ${p.rows.length?'':'disabled'}><i class=ji data-i=plus></i> إضافة ${p.rows.length} صف إلى الجرد</button>`;
}
function appendOpeningImportRows(){
if(!openingImportPreview.rows.length){toast('لا توجد صفوف صالحة للإضافة','error'); return;}
openingRows=openingRows.filter(r=>r.name||r.qty||r.price||r.category||r.boxes);
openingRows.push(...openingImportPreview.rows); openingImportPreview={rows:[],errors:[],fileName:''};
renderOpeningRows(); updateOpeningTotal(); renderOpeningImportPreview(); toast('تمت إضافة الصفوف الصحيحة إلى الجرد، راجعها قبل الحفظ','success');
}
function renderOpeningRows(){
const c=document.getElementById('openingRows'); if(!c){return;}
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (${esc(i.unit||'وحدة')})</option>`).join('');
c.innerHTML=openingRows.map((r,idx)=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px;border:1px solid var(--border)">
<div class="fr" style="align-items:flex-end">
<div class="fg" style="flex:2;min-width:160px"><label>الصنف *</label><input type="text" class="u-input" value="${esc(r.name)}" placeholder="اسم الصنف" list="openingInvList" oninput="updateOpeningRow(${idx},'name',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الكمية *</label><input type="number" class="u-input" value="${r.qty}" min="0" step="0.001" placeholder="0" style="font-weight:700" oninput="updateOpeningRow(${idx},'qty',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الوحدة *</label><input type="text" id="openingUnit_${idx}" class="u-input" value="${esc(r.unit||'كجم')}" placeholder="كجم، علبة، كيس..." oninput="updateOpeningRow(${idx},'unit',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>سعر الشراء *</label><input type="number" class="u-input" value="${r.price}" min="0" step="0.01" placeholder="0" oninput="updateOpeningRow(${idx},'price',this.value)"></div>
<div class="fg" id="openingBoxesField_${idx}" style="flex:1;min-width:80px;display:${isOpeningMeatRow(r)?'':'none'}"><label>كراتين (للحوم فقط)</label><input type="number" class="u-input" value="${r.boxes}" min="0" step="1" placeholder="—" oninput="updateOpeningRow(${idx},'boxes',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الفئة</label><input type="text" id="openingCategory_${idx}" class="u-input" value="${esc(r.category)}" placeholder="لحوم، خضار، مشروبات..." oninput="updateOpeningRow(${idx},'category',this.value)"></div>
<button type="button" class="btn btn-sm btn-red" onclick="removeOpeningRow(${idx})" title="حذف السطر"><i class=ji data-i=x></i></button>
</div></div>`).join('')+`<datalist id="openingInvList">${invOpts}</datalist>`;
}
function isOpeningMeatRow(row){
return /لحوم|لحم|لحمة|meat/i.test(String(row?.category||''));
}
function updateOpeningBoxesVisibility(idx){
const row=openingRows[idx]; if(!row){return;}
const field=document.getElementById(`openingBoxesField_${idx}`); const meat=isOpeningMeatRow(row);
if(field){field.style.display=meat?'':'none';}
if(!meat&&row.boxes!==''){
row.boxes='';
const input=field?.querySelector('input'); if(input){input.value='';}
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
function addOpeningRow(){ openingRows.push({name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}); renderOpeningRows(); }
function removeOpeningRow(idx){ if(openingRows.length<=1){ openingRows[0]={name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}; } else { openingRows.splice(idx,1); } renderOpeningRows(); updateOpeningTotal(); }
function updateOpeningRow(idx,field,value){
const r=openingRows[idx]; if(!r){return;}
if(field==='name'||field==='unit'||field==='category'){ r[field]=String(value||''); }
else if(field==='qty'){ r.qty=value===''?'':(parseFloat(value)||0); }
else if(field==='price'){ r.price=value===''?'':(parseFloat(value)||0); }
else if(field==='boxes'){ r.boxes=value===''?'':(parseInt(value)||0); }
if(field==='name'){ syncOpeningRowWithInventory(idx); }
if(field==='name'||field==='category'){ updateOpeningBoxesVisibility(idx); }
updateOpeningTotal();
}
function updateOpeningTotal(){
const t=openingRows.reduce((s,r)=>s+((parseFloat(r.qty)||0)*(parseFloat(r.price)||0)),0);
const el=document.getElementById('openingTotal'); if(el){el.innerHTML=fC(t);}
}
async function saveOpeningBalance(){
const items=openingRows.map(r=>({name:String(r.name||'').trim(),qty:parseFloat(r.qty)||0,unit:String(r.unit||'').trim()||'كجم',price:parseFloat(r.price)||0,boxes:r.boxes===''||r.boxes==null?null:(parseInt(r.boxes)||0),category:String(r.category||'').trim()||'عام'}))
.filter(r=>r.name&&r.qty>0&&r.price>=0);
if(!items.length){ toast('أدخل صنفًا واحدًا على الأقل: اسم + كمية + سعر','error'); return; }
const bad=items.find(r=>r.boxes!==null&&!(r.boxes>0));
if(bad){ toast(`عدد الكراتين للصنف "${bad.name}" يجب أن يكون أكبر من صفر أو اتركه فارغًا`,'error'); return; }
const sup=openingSupplier();
const invoiceNumber=`OPEN-${today().replace(/-/g,'')}-${String(Math.floor(Math.random()*900)+100)}`;
try{
showLoad();
const result=await apiFetch('/warehouse/purchase-invoices',{method:'POST',body:JSON.stringify({
invoiceNumber,date:today(),supplierName:sup.name,supplierPhone:'',paymentMethod:'credit',paidAmount:0,
notes:'رصيد افتتاحي بداية الفترة',supplierId:sup.id||null,
items:items.map(r=>({itemName:r.name,qty:r.qty,unit:r.unit,price:r.price,category:r.category,
...(r.boxes?{packagingQty:r.boxes,packagingUom:'كرتون'}:{})}))
})});
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast(`تم حفظ الرصيد الافتتاحي: ${items.length} صنف بقيمة ${fC(result.totalAmount||0)}`,'success');
addNotification('رصيد افتتاحي',`تم إدخال ${items.length} صنف كرصيد بداية الفترة`,'success');
}catch(e){ toast(e.message||'تعذر حفظ الرصيد الافتتاحي','error'); }
finally{ hideLoad(); }
}
function viewPurchaseInvoice(id){
const inv = (STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
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
<div class="details-item"><strong>حالة السداد:</strong><div>${pcmtStatusBadge(inv.paymentStatus)}${pcmtInvoiceRemaining(inv)>0?` <button class="btn btn-green btn-sm" onclick="closeModal();payInvoiceFull('${esc(String(inv.id))}')"><i class=ji data-i=coins></i> تسديد المتبقي</button>`:''}</div></div>`:''}
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
<div class="modal-footer"><button class="btn btn-blue" onclick="printPurchaseInvoice('${inv.id}')"><i class=ji data-i=printer></i> طباعة الفاتورة</button>${['admin','manager'].includes(STATE.currentUser?.role)?`<button class="btn btn-red" onclick="voidPurchaseInvoice('${inv.id}')"><i class=ji data-i=trash></i> حذف الفاتورة</button>`:''}<button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>
`);
}
async function voidPurchaseInvoice(id, force){
const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
if(!inv){return;}
if(!force && !confirm(`حذف فاتورة الشراء ${inv.invoiceNumber||''} (${fC(inv.totalAmount||0)})؟\nسيُعكس أثرها على المخزون تلقائيًا.\n${Number(inv.paidAmount||0)>0?'تحذير: عليها مبلغ مسدد — سيُرفض الحذف.':''}`)){return;}
showLoad();
try{
const r=await apiFetch(`/warehouse/purchase-invoices/${encodeURIComponent(id)}/void`,{method:'POST',body:JSON.stringify(force?{force:true}:{})});
STATE.purchaseInvoices=(STATE.purchaseInvoices||[]).filter(x=>String(x.id)!==String(id));
await window.loadData().catch(()=>{});
closeModal();renderPage();
toast(`حُذفت الفاتورة ${r.invoiceNumber||''} وعُكس مخزون ${r.reversedItems||0} صنفًا${r.deletedPayments?` وحُذفت ${r.deletedPayments} دفعة مرتبطة`:''}`,'success');
}catch(e){
const m=String(e.message||'');
if(!force&&(m.includes('مسدد')||m.includes('دفعات'))){
if(confirm(`${m}\n\nهل تريد الحذف القسري؟ (سيُحذف المسدد/الدفعات المرتبطة بهذه الفاتورة نهائيًا — لا يمكن التراجع)`)) {return voidPurchaseInvoice(id,true);}
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
 const paymentLabel={cash:'نقدي',bank:'تحويل بنكي',credit:'آجل'}[inv.paymentMethod]||'—';
 const statusLabel={paid:'مدفوعة',partial:'مسددة جزئياً',unpaid:'غير مسددة'}[inv.paymentStatus]||'غير مسددة';
 const currency=esc(STATE.settings.currency||'SAR');
 const rows=items.map(item=>`<tr><td>${esc(item.itemName||'—')}</td><td>${esc(item.unit||'—')}</td><td>${fN(item.qty)}</td><td>${fN(item.weight||0)} كجم</td><td>${fN(item.price)} ${currency}</td><td>${fN(item.total||(Number(item.qty||0)*Number(item.price||0)))} ${currency}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد أصناف</td></tr>';
 const win=window.open('','_blank','width=900,height=1000');
 if(!win){toast('اسمح بالنوافذ المنبثقة لطباعة الفاتورة','warning');return;}
 win.document.open();
 win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>فاتورة شراء ${esc(inv.invoiceNumber||'')}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}.meta b{display:block;color:#555;font-size:12px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:9px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.notes{margin-top:20px;border-top:1px solid #ddd;padding-top:12px;min-height:40px}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}.controls button.secondary{background:#555}@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button onclick="window.print()">طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>فاتورة شراء</p><p>${esc(inv.invoiceNumber||'—')}</p></header><section class="meta"><div><b>التاريخ</b>${fD(inv.date)}</div><div><b>المورد</b>${esc(inv.supplierName||'—')}</div><div><b>الهاتف</b>${esc(inv.supplierPhone||'—')}</div><div><b>طريقة الدفع</b>${paymentLabel}</div><div><b>حالة السداد</b>${statusLabel}</div><div><b>المسدد / المتبقي</b>${fN(inv.paidAmount||0)} / ${fN(Math.max(0,Number(inv.totalAmount||0)-Number(inv.paidAmount||0)))} ${currency}</div></section><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">إجمالي الفاتورة</td><td>${fN(inv.totalAmount)} ${currency}</td></tr></tfoot></table><div class="notes"><b>ملاحظات:</b> ${esc(inv.notes||'—')}</div></main></body></html>`);
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
<button class="btn btn-blue btn-sm" onclick="downloadItemsCatalogTemplate()"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="catalogExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="catalogPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="importItemsCatalog()"><i class=ji data-i=inbox></i> استيراد</button></div>
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
const wb=XLSX.read(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const rows=data.filter((r,i)=>i>0&&r[0]);
const prev=document.getElementById('catalogPreview');
if(!prev){return;}
if(rows.length===0){ prev.innerHTML='<div class="u-red"><i class=ji data-i=alert-triangle></i> لا توجد بيانات</div>'; return; }
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${rows.length} صنف</div>${rows.slice(0,5).map(r=>`<div class="preview-row"><i class=ji data-i=package></i> ${r[0]} | ${r[1]||'—'} | ${r[2]||'قطعة'} | حد أدنى: ${r[3]||5}</div>`).join('')}${rows.length>5?`<div style="color:var(--text3);font-size:12px;margin-top:6px">... و${rows.length-5} أصناف أخرى</div>`:''}</div>`;
}catch(err){ document.getElementById('catalogPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
};
reader.readAsBinaryString(file);
}
function importItemsCatalog(){
const file=document.getElementById('catalogExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
const reader=new FileReader();
reader.onload=async function(e){
try{
const wb=XLSX.read(e.target.result,{type:'binary'});
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
}catch(err){ toast('خطأ في معالجة الملف','error'); }
};
reader.readAsBinaryString(file);
}
// Bulk Inventory Import
function showBulkInventoryImportModal(){
showModal(`
<h3><i class=ji data-i=chart></i> استيراد المخزون من Excel</h3>
<div class="note-panel">
<strong><i class=ji data-i=clipboard-list></i> صيغة الملف:</strong><br>
الأعمدة: اسم الصنف، الفئة، الوحدة، الكمية، سعر الشراء، الحد الأدنى
</div>
<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);padding:12px;border-radius:var(--r);margin-bottom:14px;font-size:12px">
<i class=ji data-i=alert-triangle></i> <strong>تنبيه:</strong> إذا كان الصنف موجوداً مسبقاً، سيتم تحديث كميته وسعره فقط.
</div>
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-blue btn-sm" onclick="downloadInventoryTemplate()"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="inventoryExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="inventoryImportPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="importBulkInventory()"><i class=ji data-i=inbox></i> استيراد المخزون</button></div>
`);
document.getElementById('inventoryExcelFile').addEventListener('change',previewInventoryFile);
}
function downloadInventoryTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([['اسم الصنف','الفئة','الوحدة','الكمية','سعر الشراء','الحد الأدنى'],['دجاج','لحوم','كجم',50,25,10],['أرز','حبوب','كيس',100,3.5,20],['زيت نخيل','زيوت','لتر',30,8,5]]);
ws['!cols']=[{wch:20},{wch:15},{wch:10},{wch:10},{wch:12},{wch:12}];
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
                const book = XLSX.read(result, { type: isCsv ? 'string' : 'binary' });
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
        return {
            name: parseInventoryImportCell(item[0]),
            category: category || 'عام',
            unit: parseInventoryImportCell(item[2] || ''),
            qty: parseInventoryImportNumber(item[3], 0),
            price: parseInventoryImportNumber(item[4], 0),
            minQty: parseInventoryImportNumber(item[5], 5),
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
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${list.length} صنف | إجمالي القيمة: ${fC(totalValue)}</div><table style="width:100%;font-size:12px;border-collapse:collapse"><tr class="u-faint"><th style="text-align:right;padding:4px">الصنف</th><th>الكمية</th><th>السعر</th><th>القيمة</th></tr>${list.slice(0,6).map(r=>`<tr style="border-top:1px solid var(--border)"><td style="padding:4px">${esc(String(r.name))}</td><td class="u-ta-c">${fN(r.qty||0)} ${r.unit || ''}</td><td class="u-ta-c">${fC(r.price||0)}</td><td style="text-align:center;color:var(--gold)">${fC((r.qty||0)*(r.price||0))}</td></tr>`).join('')}${list.length>6?`<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:6px">... و${list.length-6} أصناف أخرى</td></tr>`:''}</table></div>`;
}catch(err){ document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
}).catch(() => { document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; });
}
async function importBulkInventory(){
const file=document.getElementById('inventoryExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
try{
const rows = await readInventoryImportRows(file);
const items = inventoryImportRowsFromSheet(rows).map((row) => ({
    name: String(row.name).trim(),
    category: String(row.category || 'عام').trim() || 'عام',
    unit: String(row.unit || 'قطعة').trim() || 'قطعة',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    minQty: Number(row.minQty) || 5,
})).filter((row) => row.name && row.qty > 0 && row.price >= 0);
if(!items.length){toast('لا توجد صفوف صالحة للاستيراد','error'); return;}
const existingNames=new Set(STATE.inventory.map(i=>String(i.name||'').toLowerCase()));
const result=await apiFetch('/warehouse/inventory/bulk-receipt',{method:'POST',body:JSON.stringify({items})});
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
const added=items.filter(item=>!existingNames.has(item.name.toLowerCase())).length;
const updated=items.length-added;
closeModal(); renderPage();
toast(`تم الاستيراد: ${added} صنف جديد، ${updated} صنف محدَّث`,'success');
}catch(err){ toast('خطأ في معالجة الملف','error'); }
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
<button class="btn btn-gold" onclick="showAddShelfModal()"><i class=ji data-i=plus></i> إضافة رف</button>
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
<button class="btn btn-sm u-flex1" onclick="editShelf('${shelf.id}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-red btn-sm u-flex1" onclick="deleteShelf('${shelf.id}')"><i class=ji data-i=trash></i> حذف</button>
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
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="addShelf()"><i class=ji data-i=save></i> حفظ</button>
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
const shelf=STATE.shelves.find(s=>s.id==id);
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
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="updateShelf('${id}')"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function updateShelf(id){
const shelf=STATE.shelves.find(s=>s.id==id);
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
STATE.shelves=STATE.shelves.filter(s=>s.id!=id);
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
<button class="weight-btn" onclick="adjustWeight(-1)">- 1</button>
<button class="weight-btn" onclick="adjustWeight(-0.1)">- 0.1</button>
<button class="weight-btn active" onclick="resetWeight()"><i class=ji data-i=refresh></i> تصفير</button>
<button class="weight-btn" onclick="adjustWeight(0.1)">+ 0.1</button>
<button class="weight-btn" onclick="adjustWeight(1)">+ 1</button>
</div>
<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="btn btn-gold" onclick="recordWeight()"><i class=ji data-i=file-text></i> تسجيل القراءة</button>
<button class="btn btn-blue" onclick="recordWeightToItem()"><i class=ji data-i=package></i> إضافة لصنف</button>
</div>
<div style="margin-top:15px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="weight-btn ${weightUnit==='kg'?'active':''}" onclick="setWeightUnit('kg')">كجم</button>
<button class="weight-btn ${weightUnit==='g'?'active':''}" onclick="setWeightUnit('g')">جرام</button>
<button class="weight-btn ${weightUnit==='lb'?'active':''}" onclick="setWeightUnit('lb')">رطل</button>
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
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="confirmRecordWeightToItem()"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function confirmRecordWeightToItem(){
const itemId = document.getElementById('weightItem')?.value;
const weight = parseFloat(document.getElementById('recordedWeight')?.value);
const notes = document.getElementById('weightNotes')?.value.trim();
const item = STATE.inventory.find(i=>i.id==itemId);
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

export { renderWarehouse, getPaymentMethodLabel, whBulkDelete, whPrintInventory, PCMT, PCMT_CAN_WRITE, PCMT_CAN_PAY, PCMT_PAY_LABELS, pcmtStatusBadge, pcmtInvoiceSupplier, pcmtInvoiceRemaining, refreshProcurementData, renderProcurement, pcmtRerenderSuppliers, pcmtInvoicesTab, pcmtSuppliersTab, pcmtPaymentsTab, showSupplierModal, saveSupplier, toggleSupplier, deleteSupplier, showPaymentModal, pcmtUnpaidOptions, pcmtOnSupplierChange, savePayment, payInvoiceFull, deletePayment, openStatement, loadStatement, pcmtStatementHtml, printStatement, STOCK, STOCK_CAN_WRITE, stocktakStatusBadge, stocktakChipsHtml, stocktakClientSummary, showInventoryAuditModal, stocktakSetTab, stocktakRender, stocktakScopeItems, stocktakScopePreview, stocktakSetLocation, stocktakLoadLocations, stocktakSetScope, stocktakHtmlNew, stocktakStartSession, showFiscalYearModal, closeFiscalYear, createNextFiscalYear, stocktakOpenSession, stocktakRefreshDetail, stocktakCountFilter, stocktakRowHtml, stocktakRowsTbodyHtml, stocktakStaleBanner, stocktakHtmlCount, stocktakOnSearch, stocktakToggleDiffs, stocktakScanCount, stocktakCountChanged, stocktakSaveCount, stocktakApplyItem, stocktakApplyProgress, stocktakClearCount, stocktakSavePending, stocktakSubmitSession, stocktakApproveSession, stocktakCancelSession, stocktakCancelById, stocktakPrintById, stocktakPrint, stocktakHtmlHistory, inventoryUnitOptions, showAddItemModal, scanForItemBarcodeField, scanToAddInventoryItem, showQuickStockInModal, confirmQuickStockIn, addInventoryItem, editItem, updateInventoryItem, deleteItem, addSecUnitRow, collectSecUnits, currentInvoiceItems, showAddPurchaseInvoiceModal, pcmtInvoiceSupplierChanged, pcmtInvoicePaidChanged, addInvoiceItemRow, removeInvoiceItemRow, updateInvoiceItem, updateInvoiceTotal, focusInvoiceEntryField, renderInvoiceItemsList, savePurchaseInvoice, openingRows, openingImportPreview, openingSupplier, showOpeningBalanceModal, downloadOpeningTemplate, openingHeaderKey, previewOpeningExcel, renderOpeningImportPreview, appendOpeningImportRows, renderOpeningRows, isOpeningMeatRow, updateOpeningBoxesVisibility, syncOpeningRowWithInventory, addOpeningRow, removeOpeningRow, updateOpeningRow, updateOpeningTotal, saveOpeningBalance, viewPurchaseInvoice, voidPurchaseInvoice, printPurchaseInvoice, showImportItemsCatalogModal, downloadItemsCatalogTemplate, previewCatalogFile, importItemsCatalog, showBulkInventoryImportModal, downloadInventoryTemplate, parseInventoryImportCell, parseInventoryImportNumber, readInventoryImportRows, inventoryImportRowsFromSheet, previewInventoryFile, importBulkInventory, renderShelves, showAddShelfModal, addShelf, editShelf, updateShelf, deleteShelf, currentWeight, weightUnit, renderWeight, adjustWeight, resetWeight, setWeightUnit, recordWeight, recordWeightToItem, confirmRecordWeightToItem };
