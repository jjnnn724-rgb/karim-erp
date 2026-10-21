/**
 * features/finance.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// عنقود المطبخ والصرف + الوصفات: نُقل إلى js/features/kitchen.js (يجسر عبر js/main.js — BRIDGE-013)
// ============================================
// REVENUES & EXPENSES
// ============================================
function renderRevenues(){
if(!checkMenuAccessLocal('revenues')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const q = String(window.revFilterSearch||'').trim().toLowerCase();
const filtered = STATE.revenues.filter(r=>{
if(window.revFilterDept!=='all'&&String(r.deptId)!==window.revFilterDept) {return false;}
const d=String(r.date||'').slice(0,10);
if(window.revFilterFrom&&d<window.revFilterFrom) {return false;}
if(window.revFilterTo&&d>window.revFilterTo) {return false;}
if(q && !(`${r.source||''} ${r.notes||''} ${r.deptId||''}`.toLowerCase().includes(q)) && !(window.arSearchIncludes?window.arSearchIncludes(`${r.source||''} ${r.notes||''} ${r.deptId||''}`, q):false)) {return false;}
return true;
});
const totalRev = filtered.reduce((s,r)=>s+Number(r.amount||0),0);
const hasFilter=window.revFilterDept!=='all'||window.revFilterFrom||window.revFilterTo||q;
const deptOpts=STATE.departments.map(d=>`<option value="${esc(d.code)}" ${window.revFilterDept===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
// PERF: ترقيم صفحات إلزامي — كانت القائمة ترسم *كل* الإيرادات (19,395 صفًا من
// مبيعات الكاشير) في جدول واحد فيتجمد المتصفح 30-60 ثانية مع كل رسم.
const PAGE_SIZE=50;
const ordered=filtered.slice().reverse();
const pages=Math.max(1,Math.ceil(ordered.length/PAGE_SIZE));
window.revPage=Math.min(Math.max(1,Number(window.revPage)||1),pages);
const pageRows=ordered.slice((window.revPage-1)*PAGE_SIZE,window.revPage*PAGE_SIZE);
const pageBar=`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px"><small class="text-muted">صفحة ${fN(window.revPage)} من ${fN(pages)} — ${fN(ordered.length)} إيراد</small><div style="display:flex;gap:6px"><button class="btn btn-sm" ${window.revPage<=1?'disabled':''} onclick="window.revPage=1;renderPage()">&laquo; الأولى</button><button class="btn btn-sm" ${window.revPage<=1?'disabled':''} onclick="window.revPage--;renderPage()">السابقة</button><button class="btn btn-sm" ${window.revPage>=pages?'disabled':''} onclick="window.revPage++;renderPage()">التالية</button><button class="btn btn-sm" ${window.revPage>=pages?'disabled':''} onclick="window.revPage=${pages};renderPage()">الأخيرة &raquo;</button></div></div>`;
return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=banknote></i> ${t('pg.revenues')}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="revPrintFiltered()"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold btn-sm" onclick="showAddRevenueModal()"><i class=ji data-i=plus></i> ${t('rev.add')}</button></div></div><div class="fr" style="align-items:end;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div class="fg"><label>${t('exp.dept')}</label><select onchange="window.revFilterDept=this.value;window.revPage=1;renderPage()"><option value="all" ${window.revFilterDept==='all'?'selected':''}>${t('exp.allDepts')}</option>${deptOpts}</select></div><div class="fg"><label>${t('exp.fromDate')}</label><input type="date" value="${window.revFilterFrom}" onchange="window.revFilterFrom=this.value;window.revPage=1;renderPage()"></div><div class="fg"><label>${t('exp.toDate')}</label><input type="date" value="${window.revFilterTo}" onchange="window.revFilterTo=this.value;window.revPage=1;renderPage()"></div><div class="fg"><label>بحث</label><input type="text" placeholder="المصدر أو ملاحظات..." value="${esc(window.revFilterSearch)}" oninput="window.revFilterSearch=this.value;window.revPage=1;renderPage();const s=document.getElementById('revSearchBox');if(s){s.focus();s.setSelectionRange(s.value.length,s.value.length);}" id="revSearchBox"></div>${hasFilter?`<button class="btn btn-sm" onclick="window.revFilterDept='all';window.revFilterFrom='';window.revFilterTo='';window.revFilterSearch='';window.revPage=1;renderPage()"><i class=ji data-i=rotate-ccw></i> ${t('exp.clearFilter')}</button>`:''}<div class="mcard" style="padding:8px 14px;margin-inline-start:auto"><div class="mcard-label" style="font-size:11px">${t('exp.netShown')} (${fN(filtered.length)} ${t('exp.items')})</div><div class="mcard-val c-gold" style="font-size:18px">${fC(totalRev)}</div></div></div>${pageBar}<div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('rev.source')}</th><th>${t('rev.dept')}</th><th>${t('rev.amount')}</th><th>${t('rev.date')}</th><th>${t('rev.notes')}</th><th></th></tr></thead><tbody>${pageRows.map((r,i)=>{const d=STATE.departments.find(x=>x.code===r.deptId);return `<tr><td>${ordered.length-((window.revPage-1)*PAGE_SIZE)-i}</td><td class="fw-bold">${esc(r.source)}</td><td class="c-gold">${d?`${deptIcon(d)} ${esc(d.name)}`:'—'}</td><td class="c-gold fw-bold">${fC(r.amount)}</td><td class="text-muted">${fD(r.date)}</td><td class="text-muted"><span class="revenue-note-clean">${esc(formatRevenueNote(r.notes||r.source||'—'))}</span></td><td><button class="btn btn-sm" onclick="editRevenue('${r.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteRevenue('${r.id}')"><i class=ji data-i=trash></i></button></td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">' + t('rev.noData') + '</td></tr>'}</tbody><tfoot><tr><td colspan="4" class="u-num-l"><i class=ji data-i=banknote></i> ${t('rev.total')}</td><td colspan="3" class="c-gold fw-bold">${fC(totalRev)}</td></tr></tfoot></table></div></div>`;
}
window.revFilterDept='all';window.revFilterSearch='';;
// الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — زر المسح يعرض الكل
if(!window.revFilterFrom&&!window.revFilterTo){const m=today().slice(0,8)+'01';window.revFilterFrom=m;window.revFilterTo=today();}
window.whCatFilter='all'; // كان let في قسم الوزن — صار خاصية window لأن المخزن والوزن يتشاركان الفلتر (BRIDGE-012)
const whShortFilter='all'; // all | out | low — فلتر لوحة النواقص الشاملة
async function refreshWhShortages(silent){
try{
const rows=await apiFetch('/warehouse/purchase-requests/shortages');
const invById=new Map((STATE.inventory||[]).map(i=>[String(i.id),i]));
STATE._whShort=(Array.isArray(rows)?rows:[]).map(s=>{
const it=invById.get(String(s.itemId))||{};
const qty=Number(s.currentQty||0), min=Number(s.minQty||0), cost=Number(it.avgCost||0);
return { id:s.itemId, name:s.itemName||it.name||'—', unit:s.unit||it.unit||'', qty, min, cost,
category:it.category||'عام', gap:Math.max(0,min-qty), gapVal:Math.max(0,min-qty)*cost,
noCost:!(cost>0), out:qty<=0 };
});
STATE._whShortAt=new Date().toISOString();
}catch(e){ if(!silent){toast(e.message||'تعذر جلب النواقص','error');} }
if(STATE.page==='warehouse'){renderPage();}
}
function whPrintShortages(){
const rows=whShortRows();
const out=rows.filter(r=>r.out).length;
const refill=rows.reduce((s,r)=>s+r.gapVal,0);
const noCost=rows.filter(r=>r.noCost&&r.gap>0).length;
ysPrintReport('كشف نواقص المخزن الشامل', `${rows.length} صنفًا (نافذ ${out} • منخفض ${rows.length-out})${noCost?` • ${noCost} بلا تكلفة مدخلة`:''}`,
[['الأصناف الناقصة',fN(rows.length)],['نافذ تمامًا',fN(out)],['قيمة التعبئة حتى الحد',noCost&&refill<=0?'— (التكلفة غير مدخلة)':fC(refill)]],
['#','الصنف','الفئة','الوحدة','الرصيد','الحد الأدنى','العجز','قيمة العجز','الحالة'],
rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.category)}</td><td>${esc(r.unit)}</td><td>${fN(r.qty)}</td><td>${fN(r.min)}</td><td>${fN(r.gap)}</td><td>${r.noCost&&r.gap>0?'—':fC(r.gapVal)}</td><td>${r.out?'نافذ':'منخفض'}</td></tr>`).join('')||'<tr><td colspan="9">لا توجد أصناف مسجلة — أدخل الرصيد الافتتاحي أو استورد الأصناف أولًا</td></tr>');
}
function whShortRows(){
const all=STATE._whShort||[];
if(whShortFilter==='out'){return all.filter(r=>r.out);}
if(whShortFilter==='low'){return all.filter(r=>!r.out);}
return all;
}
function whShortPanel(){
const all=STATE._whShort;
if(!all){ if(!STATE._whShortLoading){STATE._whShortLoading=true; setTimeout(()=>refreshWhShortages(true).finally(()=>{STATE._whShortLoading=false;}),0);} return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> كل الأصناف الناقصة وخلاصة المخزن</h3></div><div class="mcard u-empty"><div class="spinner"></div></div></div>`; }
const out=all.filter(r=>r.out), low=all.filter(r=>!r.out);
const totalVal=(STATE.inventory||[]).reduce((s,i)=>s+(Number(i.qty||0)*Number(i.avgCost||0)),0);
const refill=all.reduce((s,r)=>s+r.gapVal,0);
const noCostCount=all.filter(r=>r.noCost&&r.gap>0).length;
const refillTxt=noCostCount&&refill<=0?'—':fC(refill);
const rows=whShortRows();
const fBtn=(k,l)=>`<button class="btn btn-sm ${whShortFilter===k?'btn-gold':''}" onclick="whShortFilter='${k}';renderPage()">${l}</button>`;
return `<div class="tbl-wrap" style="border:2px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> كل الأصناف الناقصة وخلاصة المخزن</h3>
<div class="u-row-wrap">${fBtn('all',`الكل (${fN(all.length)})`)}${fBtn('out',`نافذ (${fN(out.length)})`)}${fBtn('low',`منخفض (${fN(low.length)})`)}
<button class="btn btn-blue btn-sm" onclick="refreshWhShortages()"><i class=ji data-i=refresh></i> تحديث</button>
<button class="btn btn-blue btn-sm" onclick="whPrintShortages()"><i class=ji data-i=printer></i> طباعة الكشف</button>
${prCanCreate()?`<button class="btn btn-gold btn-sm" onclick="openPRCreateModal()"><i class=ji data-i=shopping-cart></i> طلب شراء من النواقص</button>`:''}
</div></div>
<div class="metrics-grid" style="padding:12px 16px 0">
<div class="mcard"><div class="mcard-label">نافذ تمامًا</div><div class="mcard-val c-red">${fN(out.length)}</div></div>
<div class="mcard"><div class="mcard-label">منخفض (فوق الصفر)</div><div class="mcard-val c-orange">${fN(low.length)}</div></div>
<div class="mcard"><div class="mcard-label">قيمة التعبئة حتى الحد</div><div class="mcard-val c-gold">${refillTxt}</div></div>
<div class="mcard"><div class="mcard-label">قيمة المخزون الكلية</div><div class="mcard-val c-green">${fC(totalVal)}</div></div>
</div>
${noCostCount?`<div class="audit-banner"><i class=ji data-i=alert-triangle></i> <strong>${fN(noCostCount)} صنفًا بلا تكلفة مدخلة</strong> — قيمة التعبئة غير محسوبة لها. أدخل أسعار الشراء عند الاستلام لتظهر القيمة الحقيقية.</div>`:''}
<div class="tbl-scroll tbl-sticky-first" style="margin-top:12px"><table><thead><tr><th>#</th><th>الصنف</th><th>الفئة</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>العجز</th><th>قيمة العجز</th><th>الحالة</th></tr></thead>
<tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td class="fw-bold">${esc(r.name)}</td><td class="c-gold">${esc(r.category)}</td><td>${esc(r.unit)}</td>
<td class="c-red fw-bold">${fN(r.qty)}</td><td>${fN(r.min)}</td><td class="c-orange fw-bold">${fN(r.gap)}</td><td class="c-gold">${r.noCost&&r.gap>0?'—':fC(r.gapVal)}</td>
<td><span class="badge ${r.out?'bdg-red':'bdg-orange'}">${r.out?'<i class=ji data-i=circle-x></i> نافذ':'<i class=ji data-i=alert-triangle></i> منخفض'}</span></td></tr>`).join('')||((STATE.inventory||[]).length?'<tr><td colspan="9" class="u-empty-sm">لا نواقص — المخزون كله فوق الحد</td></tr>':'<tr><td colspan="9" class="u-empty-sm">لا توجد أصناف مسجلة — أدخل الرصيد الافتتاحي أو استورد الأصناف أولًا</td></tr>')}</tbody></table></div>
<div style="padding:8px 16px"><small class="text-muted">آخر تحديث: ${STATE._whShortAt?esc(String(STATE._whShortAt).replace('T',' ').slice(0,19)):'—'} • العجز = الحد − الرصيد • قيمة العجز بمتوسط التكلفة</small></div>
</div>`;
}
function revPrintFiltered(){
const q = String(window.revFilterSearch||'').trim().toLowerCase();
const filtered = STATE.revenues.filter(r=>{
if(window.revFilterDept!=='all'&&String(r.deptId)!==window.revFilterDept) {return false;}
const d=String(r.date||'').slice(0,10);
if(window.revFilterFrom&&d<window.revFilterFrom) {return false;}
if(window.revFilterTo&&d>window.revFilterTo) {return false;}
if(q && !(`${r.source||''} ${r.notes||''} ${r.deptId||''}`.toLowerCase().includes(q)) && !(window.arSearchIncludes?window.arSearchIncludes(`${r.source||''} ${r.notes||''} ${r.deptId||''}`, q):false)) {return false;}
return true;
});
const deptName = window.revFilterDept==='all' ? 'كل الأقسام' : (STATE.departments.find(x=>x.code===window.revFilterDept)?.name || window.revFilterDept);
const rows = filtered.slice().reverse().map((r,i)=>{const d=STATE.departments.find(x=>x.code===r.deptId);return `<tr><td>${filtered.length-i}</td><td>${esc(r.source)}</td><td>${esc(d?d.name:'—')}</td><td>${fC(r.amount)}</td><td>${esc(r.date||'')}</td></tr>`;}).join('');
ysPrintReport('كشف الإيرادات', `${deptName}${window.revFilterFrom||window.revFilterTo?` — من ${window.revFilterFrom||'البداية'} إلى ${window.revFilterTo||'اليوم'}`:''}`,
[['عدد البنود', fN(filtered.length)],['الإجمالي', fC(filtered.reduce((s,r)=>s+Number(r.amount||0),0))]],
['#','المصدر','القسم','المبلغ','التاريخ'], rows);
}
// Optional preselectedDept opens the modal with that department already selected
function showAddRevenueModal(preselectedDept){
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${preselectedDept&&d.code===preselectedDept?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=banknote></i> ${t('rev.addTitle')}</h3><div class="fg"><label>${t('rev.source')}</label><input type="text" id="revSource"></div><div class="fr"><div class="fg"><label>${t('rev.dept')}</label><select id="revDept">${opts}</select></div><div class="fg"><label>${t('rev.amount')}</label><input type="number" id="revAmount" step="0.01"></div></div><div class="fg"><label>${t('rev.date')}</label><input type="date" id="revDate" value="${today()}"></div><div class="fg"><label>${t('rev.notes')}</label><textarea id="revNotes"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="addRevenue()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function addRevenue(){
const deptId=document.getElementById('revDept')?.value,
amount=parseFloat(document.getElementById('revAmount')?.value),
date=document.getElementById('revDate')?.value,
source=document.getElementById('revSource')?.value.trim(),
notes=document.getElementById('revNotes')?.value.trim();
if(!deptId||isNaN(amount)||amount<=0||!source){ toast('بيانات غير صحيحة','error'); return; }
try{
await persistCreate('revenues', (saved)=>STATE.revenues.push(saved), {id:uid(),deptId,amount,date,source,notes});
closeModal(); renderPage();
toast('تم إضافة الإيراد');
addNotification('إيراد جديد',`تم إضافة إيراد بقيمة ${fC(amount)}`,'success');
}catch(e){ toast(e.message||'فشل حفظ الإيراد في قاعدة البيانات','error'); }
}
function editRevenue(id){
const r=STATE.revenues.find(x=>String(x.id)===String(id));
if(!r){return;}
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${r.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> ${t('rev.editTitle')}</h3><div class="fg"><label>${t('rev.source')}</label><input type="text" id="revSource" value="${esc(r.source)}"></div><div class="fr"><div class="fg"><label>${t('rev.dept')}</label><select id="revDept">${opts}</select></div><div class="fg"><label>${t('rev.amount')}</label><input type="number" id="revAmount" value="${r.amount}" step="0.01"></div></div><div class="fg"><label>${t('rev.date')}</label><input type="date" id="revDate" value="${r.date}"></div><div class="fg"><label>${t('rev.notes')}</label><textarea id="revNotes">${esc(r.notes||'')}</textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="updateRevenue('${id}')"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function updateRevenue(id){
const r=STATE.revenues.find(x=>String(x.id)===String(id));
if(!r){return;}
const deptId=document.getElementById('revDept')?.value;
const amount=parseFloat(document.getElementById('revAmount')?.value);
const date=document.getElementById('revDate')?.value;
const source=document.getElementById('revSource')?.value.trim();
const notes=document.getElementById('revNotes')?.value.trim();
try{
const saved = await persistUpdate('revenues', id, {deptId,amount,date,source,notes});
Object.assign(r, saved || {deptId,amount,date,source,notes});
closeModal(); renderPage();
toast('تم التحديث');
}catch(e){ toast(e.message||'فشل تحديث الإيراد في قاعدة البيانات','error'); }
}
async function deleteRevenue(id){
if(!confirm('حذف هذا الإيراد؟')){return;}
try{
await persistRemove('revenues', id);
STATE.revenues=STATE.revenues.filter(x=>String(x.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}catch(e){ toast(e.message||'فشل الحذف من قاعدة البيانات','error'); }
}
function expPrintFiltered(){
const filtered=STATE.expenses.filter(e=>{
if(window.expenseFilterDept!=='all'&&String(e.deptId)!==window.expenseFilterDept) {return false;}
const d=String(e.date||'').slice(0,10);
if(window.expenseFilterFrom&&d<window.expenseFilterFrom) {return false;}
if(window.expenseFilterTo&&d>window.expenseFilterTo) {return false;}
return true;
});
const deptName = window.expenseFilterDept==='all' ? 'كل الأقسام' : (STATE.departments.find(x=>x.code===window.expenseFilterDept)?.name || window.expenseFilterDept);
const rows = filtered.slice().reverse().map((e,i)=>{const d=STATE.departments.find(x=>x.code===e.deptId);return `<tr><td>${filtered.length-i}</td><td>${esc(e.desc||e.category||'—')}</td><td>${esc(d?d.name:'—')}</td><td>${fC(e.amount)}</td><td>${esc(e.date||'')}</td></tr>`;}).join('');
ysPrintReport('كشف المصروفات', `${deptName}${window.expenseFilterFrom||window.expenseFilterTo?` — من ${window.expenseFilterFrom||'البداية'} إلى ${window.expenseFilterTo||'اليوم'}`:''}`,
[['عدد البنود', fN(filtered.length)],['الإجمالي', fC(filtered.reduce((s,e)=>s+Number(e.amount||0),0))]],
['#','البيان','القسم','المبلغ','التاريخ'], rows);
}
function renderExpenses(){
if(!checkMenuAccessLocal('expenses')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const filtered=STATE.expenses.filter(e=>{
if(window.expenseFilterDept!=='all'&&String(e.deptId)!==window.expenseFilterDept) {return false;}
const d=String(e.date||'').slice(0,10);
if(window.expenseFilterFrom&&d<window.expenseFilterFrom) {return false;}
if(window.expenseFilterTo&&d>window.expenseFilterTo) {return false;}
return true;
});
const filteredTotal=filtered.reduce((s,e)=>s+Number(e.amount||0),0);
const hasFilter=window.expenseFilterDept!=='all'||window.expenseFilterFrom||window.expenseFilterTo;
const deptOpts=STATE.departments.map(d=>`<option value="${esc(d.code)}" ${window.expenseFilterDept===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=wallet></i> ${t('pg.expenses')}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="expPrintFiltered()"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold btn-sm" onclick="showAddExpenseModal()"><i class=ji data-i=plus></i> ${t('exp.add')}</button></div><div class="fr" style="align-items:end;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div class="fg"><label>${t('exp.dept')}</label><select onchange="window.expenseFilterDept=this.value;renderPage()"><option value="all" ${window.expenseFilterDept==='all'?'selected':''}>${t('exp.allDepts')}</option>${deptOpts}</select></div><div class="fg"><label>${t('exp.fromDate')}</label><input type="date" value="${window.expenseFilterFrom}" onchange="window.expenseFilterFrom=this.value;renderPage()"></div><div class="fg"><label>${t('exp.toDate')}</label><input type="date" value="${window.expenseFilterTo}" onchange="window.expenseFilterTo=this.value;renderPage()"></div>${hasFilter?`<button class="btn btn-sm" onclick="window.expenseFilterDept='all';window.expenseFilterFrom='';window.expenseFilterTo='';renderPage()"><i class=ji data-i=rotate-ccw></i> ${t('exp.clearFilter')}</button>`:''}<div class="mcard" style="padding:8px 14px;margin-inline-start:auto"><div class="mcard-label" style="font-size:11px">${t('exp.netShown')} (${fN(filtered.length)} ${t('exp.items')})</div><div class="mcard-val ${filteredTotal<0?'c-green':'c-red'}" style="font-size:18px">${fC(filteredTotal)}</div></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('exp.desc')}</th><th>${t('exp.dept')}</th><th>${t('exp.amount')}</th><th>${t('exp.type')}</th><th>${t('exp.date')}</th><th></th></tr></thead><tbody>${filtered.slice().reverse().map((e,i)=>{const d=STATE.departments.find(x=>x.code===e.deptId);const isAuto=e.autoGenerated;const amountClass=Number(e.amount||0)<0?'c-green':'c-red';const typeLabel=isCountCorrectionExpense(e)?'<i class=ji data-i=clipboard-list></i> فرق جرد':isStockMovementExpense(e)?(Number(e.amount||0)<0?'<i class=ji data-i=undo></i> عكس صرف':'<i class=ji data-i=zap></i> صرف مخزون'):isAuto?'<i class=ji data-i=zap></i> تلقائي':'<i class=ji data-i=pen-tool></i> يدوي';const badgeClass=isCountCorrectionExpense(e)?'bdg-blue':typeLabel==='<i class=ji data-i=undo></i> عكس صرف'?'bdg-green':isAuto?'bdg-blue':'bdg-gold';return `<tr><td>${filtered.length-i}</td><td class="fw-bold">${esc(e.desc)}</td><td class="c-gold">${d?`${deptIcon(d)} ${esc(d.name)}`:'—'}</td><td class="${amountClass} fw-bold">${fC(e.amount)}</td><td><span class="badge ${badgeClass}">${typeLabel}</span></td><td class="text-muted">${fD(e.date)}</td><td>${isAuto?'<span class="text-muted"><i class=ji data-i=lock></i></span>':`<button class="btn btn-sm" onclick="editExpense('${e.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteExpense('${e.id}')"><i class=ji data-i=trash></i></button>`}</td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد بيانات</td></tr>'}</tbody></table></div></div>`;
}
window.expenseFilterDept='all';;
// الشهر الحالي افتراضيًا (طلب المالك 2026-10-08) — زر المسح يعرض الكل
if(!window.expenseFilterFrom&&!window.expenseFilterTo){const m=today().slice(0,8)+'01';window.expenseFilterFrom=m;window.expenseFilterTo=today();}
// Optional preselectedDept opens the modal with that department already selected
function showAddExpenseModal(preselectedDept){
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${preselectedDept&&d.code===preselectedDept?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=wallet></i> ${t('exp.addTitle')}</h3><div class="fg"><label>${t('exp.desc')}</label><input type="text" id="expDesc"></div><div class="fr"><div class="fg"><label>${t('exp.dept')}</label><select id="expDept">${opts}</select></div><div class="fg"><label>${t('exp.category')}</label><select id="expCategory"><option value="مواد خام">مواد خام</option><option value="رواتب">رواتب</option><option value="تشغيل">تشغيل</option><option value="أخرى">أخرى</option></select></div></div><div class="fr"><div class="fg"><label>${t('exp.amount')}</label><input type="number" id="expAmount" step="0.01"></div><div class="fg"><label>${t('exp.date')}</label><input type="date" id="expDate" value="${today()}"></div></div><div class="fg"><label>${t('exp.notes')}</label><textarea id="expNotes"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="addExpense()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function addExpense(){
const deptId=document.getElementById('expDept')?.value,
amount=parseFloat(document.getElementById('expAmount')?.value),
date=document.getElementById('expDate')?.value,
desc=document.getElementById('expDesc')?.value.trim(),
category=document.getElementById('expCategory')?.value,
notes=document.getElementById('expNotes')?.value.trim();
if(!deptId||isNaN(amount)||amount<=0||!desc){ toast('بيانات غير صحيحة','error'); return; }
try{
await persistCreate('expenses', (saved)=>STATE.expenses.push(saved), {id:uid(),deptId,amount,date,desc,category,notes,autoGenerated:false});
closeModal(); renderPage();
toast('تم إضافة المصروف');
}catch(e){ toast(e.message||'فشل حفظ المصروف في قاعدة البيانات','error'); }
}
function editExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(!e||e.autoGenerated){ if(e?.autoGenerated) {toast('لا يمكن تعديل المصاريف التلقائية','error');} return; }
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${e.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> ${t('exp.editTitle')}</h3><div class="fg"><label>${t('exp.desc')}</label><input type="text" id="expDesc" value="${esc(e.desc)}"></div><div class="fr"><div class="fg"><label>${t('exp.dept')}</label><select id="expDept">${opts}</select></div><div class="fg"><label>${t('exp.category')}</label><select id="expCategory"><option value="مواد خام" ${e.category==='مواد خام'?'selected':''}>مواد خام</option><option value="رواتب" ${e.category==='رواتب'?'selected':''}>رواتب</option><option value="تشغيل" ${e.category==='تشغيل'?'selected':''}>تشغيل</option><option value="أخرى" ${e.category==='أخرى'?'selected':''}>أخرى</option></select></div></div><div class="fr"><div class="fg"><label>${t('exp.amount')}</label><input type="number" id="expAmount" value="${e.amount}" step="0.01"></div><div class="fg"><label>${t('exp.date')}</label><input type="date" id="expDate" value="${e.date}"></div></div><div class="fg"><label>${t('exp.notes')}</label><textarea id="expNotes">${esc(e.notes||'')}</textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="updateExpense('${id}')"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function updateExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(!e){return;}
const deptId=document.getElementById('expDept')?.value;
const amount=parseFloat(document.getElementById('expAmount')?.value);
const date=document.getElementById('expDate')?.value;
const desc=document.getElementById('expDesc')?.value.trim();
const category=document.getElementById('expCategory')?.value;
const notes=document.getElementById('expNotes')?.value.trim();
try{
const saved = await persistUpdate('expenses', id, {deptId,amount,date,desc,category,notes});
Object.assign(e, saved || {deptId,amount,date,desc,category,notes});
closeModal(); renderPage();
toast('تم التحديث');
}catch(err){ toast(err.message||'فشل تحديث المصروف في قاعدة البيانات','error'); }
}
async function deleteExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(e?.autoGenerated){ toast('لا يمكن حذف المصاريف التلقائية','error'); return; }
if(!confirm('حذف؟')){return;}
try{
await persistRemove('expenses', id);
STATE.expenses=STATE.expenses.filter(x=>String(x.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}catch(err){ toast(err.message||'فشل الحذف من قاعدة البيانات','error'); }
}
// ============================================
// COST ANALYSIS
// ============================================
window.costAnalysisFrom='';window.costAnalysisTo='';;
function renderCostAnalysis(){
if(!checkMenuAccessLocal('cost-analysis')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const from=window.costAnalysisFrom||null,to=window.costAnalysisTo||null;
let totalRev=0, totalExp=0, totMat=0, totCnt=0, totOps=0;
const details = STATE.departments.map(d=>{const s=calcStats(d.code,from,to);const bd=deptExpenseBreakdown(d.code,from,to);totalRev+=s.rev;totalExp+=s.exp;totMat+=bd.materials;totCnt+=bd.countAdj;totOps+=bd.operating;return{...d,...s,bd};});
const avgCost = totalRev>0?(totalExp/totalRev*100):0;
const inPeriod=e=>{const d=String(e.date||'').slice(0,10);if(!d){return false;}if(from&&d<from){return false;}if(to&&d>to){return false;}return true;};
const categories = {};
STATE.expenses.filter(inPeriod).forEach(e=>{const cat=e.category||'أخرى';categories[cat]=(categories[cat]||0)+Number(e.amount||0);});
setTimeout(()=>{
const ctx1=document.getElementById('costBarChart');
if(ctx1 && typeof Chart!=='undefined'){
if(STATE.charts.costBar){STATE.charts.costBar.destroy();}
STATE.charts.costBar = new Chart(ctx1,{type:'bar',data:{labels:details.map(d=>d.name),datasets:[{label:'الإيرادات',data:details.map(d=>d.rev),backgroundColor:'#2ecc7188',borderColor:'#2ecc71',borderWidth:1},{label:'التكلفة الإجمالية',data:details.map(d=>d.exp),backgroundColor:'#e74c3c88',borderColor:'#e74c3c',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
const ctx2=document.getElementById('costPieChart');
if(ctx2 && Object.keys(categories).length && typeof Chart!=='undefined'){
if(STATE.charts.costPie){STATE.charts.costPie.destroy();}
STATE.charts.costPie = new Chart(ctx2,{type:'pie',data:{labels:Object.keys(categories),datasets:[{data:Object.values(categories),backgroundColor:['#d4a843','#e74c3c','#2ecc71','#3498db','#9b59b6']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
},100);
return `<div class="u-row-between u-mb12"><div class="fr" style="align-items:end"><div class="fg"><label>من تاريخ</label><input type="date" value="${window.costAnalysisFrom}" onchange="window.costAnalysisFrom=this.value;renderPage()"></div><div class="fg"><label>إلى تاريخ</label><input type="date" value="${window.costAnalysisTo}" onchange="window.costAnalysisTo=this.value;renderPage()"></div><button class="btn btn-sm" onclick="window.costAnalysisFrom='';window.costAnalysisTo='';renderPage()"><i class=ji data-i=rotate-ccw></i> كل الفترة</button></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الإيرادات</div><div class="mcard-val c-gold">${fC(totalRev)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> إجمالي التكاليف</div><div class="mcard-val c-red">${fC(totalExp)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> متوسط نسبة التكلفة</div><div class="mcard-val ${avgCost<50?'c-green':avgCost<75?'c-orange':'c-red'}">${fN(avgCost.toFixed(1))}%</div></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> صرف مخزون (صافي المرتجعات)</div><div class="mcard-val c-blue">${fC(totMat)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=clipboard-list></i> عجز / زيادة الجرد</div><div class="mcard-val ${totCnt>0?'c-red':totCnt<0?'c-green':''}">${fC(totCnt)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=pen-tool></i> مصروفات تشغيلية</div><div class="mcard-val c-orange">${fC(totOps)}</div></div></div><div class="charts-grid"><div class="chart-card"><div class="chart-title"><i class=ji data-i=chart></i> الإيرادات مقابل التكلفة حسب القسم</div><div class="chart-box"><canvas id="costBarChart"></canvas></div></div><div class="chart-card"><div class="chart-title"><i class=ji data-i=pie></i> توزيع بنود التكلفة بالتصنيف</div><div class="chart-box"><canvas id="costPieChart"></canvas></div></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> تفاصيل كلفة الأقسام</h3></div><div class="tbl-scroll"><table><thead><tr><th>القسم</th><th>الإيرادات</th><th>صرف مخزون</th><th>فرق جرد</th><th>تشغيلية</th><th>التكلفة الإجمالية</th><th>نسبة التكلفة</th><th>التقييم</th></tr></thead><tbody>${details.map(d=>`<tr><td class="fw-bold">${deptIcon(d)} ${esc(d.name)}</td><td class="c-gold">${fC(d.rev)}</td><td class="c-blue">${fC(d.bd.materials)}</td><td class="${d.bd.countAdj>0?'c-red':d.bd.countAdj<0?'c-green':'text-muted'}">${fC(d.bd.countAdj)}</td><td class="c-orange">${fC(d.bd.operating)}</td><td class="c-red fw-bold">${fC(d.exp)}</td><td class="c-orange">${fN(d.costRatio.toFixed(1))}%</td><td class="${d.costRatio<30?'c-green':d.costRatio<50?'c-orange':'c-red'} fw-bold">${d.costRatio<30?'ممتاز':d.costRatio<50?'جيد':d.costRatio<70?'متوسط':'مرتفع'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
// ============================================
// P&L — قائمة الأرباح والخسائر الحية (تُبنى من الحركات المسجّلة فعليًا)
// ============================================
window.pnlFrom='';window.pnlTo='';window.PNL_DATA=null;window.PNL_LOADING=false;;
const PNL_PRESETS = [
  ['today','اليوم'],['yesterday','أمس'],['last7','آخر 7 أيام'],
  ['thismonth','هذا الشهر'],['lastmonth','الشهر الماضي'],['custom','مخصص']
];
function pnlPresetRange(kind){
  const t=new Date();
  const iso=d=>d.toISOString().slice(0,10);
  if(kind==='today') {return [iso(t),iso(t)];}
  if(kind==='yesterday'){const y=new Date(t);y.setDate(y.getDate()-1);return [iso(y),iso(y)];}
  if(kind==='last7'){const s=new Date(t);s.setDate(s.getDate()-6);return [iso(s),iso(t)];}
  if(kind==='thismonth') {return [iso(new Date(t.getFullYear(),t.getMonth(),1)),iso(t)];}
  if(kind==='lastmonth') {return [iso(new Date(t.getFullYear(),t.getMonth()-1,1)),iso(new Date(t.getFullYear(),t.getMonth(),0))];}
  return [window.pnlFrom,window.pnlTo];
}
function pnlActivePreset(){
  for(const [k] of PNL_PRESETS){
    if(k==='custom') {continue;}
    const [f,t]=pnlPresetRange(k);
    if(f===window.pnlFrom&&t===window.pnlTo) {return k;}
  }
  return 'custom';
}
async function pnlLoad(){
  PNL_LOADING=true;
  try{
    const p=new URLSearchParams();
    if(window.pnlFrom) {p.set('from',window.pnlFrom);}
    if(window.pnlTo) {p.set('to',window.pnlTo);}
    PNL_DATA=await apiFetch('/finance/pnl?'+p.toString());
    if(window.pnlFrom!==PNL_DATA.period.from||window.pnlTo!==PNL_DATA.period.to){
      window.pnlFrom=PNL_DATA.period.from; window.pnlTo=PNL_DATA.period.to;
    }
  }catch(e){ toast(e.message||'تعذر تحميل قائمة الدخل','error'); PNL_DATA=null; }
  finally{ PNL_LOADING=false; }
  if(STATE.page==='pnl') {renderPage();}
}
function pnlRefresh(){ PNL_DATA=null; pnlLoad(); }
function pnlCmpChip(key,label,goodWhenUp=true){
  const c=(PNL_DATA&&PNL_DATA.comparison)||{}; const v=c[key];
  if(!v||v.previous==null) {return '';}
  const d=Number(v.delta||0), p=v.pct;
  const up=d>0, neutral=Math.abs(d)<0.005;
  const good=neutral?null:(up===goodWhenUp);
  const color=neutral?'text-muted':(good?'c-green':'c-red');
  const arrow=neutral?'−':(up?'<i class=ji data-i=trending-up></i>':'<i class=ji data-i=trending-down></i>');
  const pctTxt=(p==null||!Number.isFinite(p))?'':` (${fN(Math.abs(p).toFixed(1))}%)`;
  return `<div class="trend ${good===true?'trend-up':good===false?'trend-down':''}">${arrow} <span class="${color}">${neutral?'دون تغيير':`${fN(Math.abs(d))} ${esc(label)}${pctTxt}`}</span> <span class="text-muted">مقابل الفترة السابقة</span></div>`;
}
function renderPnl(){
if(!checkMenuAccessLocal('pnl')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(!PNL_DATA&&!PNL_LOADING){ setTimeout(pnlLoad,0); return '<div class="u-empty"><div class="spinner"></div></div>'; }
if(!PNL_DATA) {return '<div class="u-empty"><div class="spinner"></div></div>';}
const st=PNL_DATA.statement;
const rev=st.revenue, gp=st.gross_profit, np=st.net_profit;
const otherCosts=Number((st.shrinkage.amount||0))+Number(st.operating.total||0)+Number(st.payroll.total||0);
const cogsPct=rev.total>0?((st.cogs.net/rev.total)*100):0;
const otherPct=rev.total>0?((otherCosts/rev.total)*100):0;
const marginChip=(m)=>m==null?'<span class="text-muted">بلا إيراد</span>':`هامش ${fN(Number(m).toFixed(1))}%`;
const deptRows=(st.by_department||[]).map(d=>`<tr>
<td class="fw-bold">${esc(d.name)}<div class="u-faint u-t12">${esc(d.code)}</div></td>
<td class="c-gold">${fC(d.revenue)}</td>
<td class="c-blue">${fC(d.cogs)}</td>
<td class="${d.shrinkage>0?'c-red':d.shrinkage<0?'c-green':'text-muted'}">${fC(d.shrinkage)}</td>
<td class="c-orange">${fC(d.operating)}</td>
<td class="fw-bold ${d.net>=0?'c-green':'c-red'}">${fC(d.net)}</td>
<td class="c-orange">${d.margin_pct==null?'—':fN(Number(d.margin_pct).toFixed(1))+'%'}</td></tr>`).join('');
return `
<div class="u-row-between u-mb12"><div class="fr" style="align-items:end">
<div class="fr" style="gap:6px;flex-wrap:wrap">
${PNL_PRESETS.map(([k,label])=>`<button class="btn btn-sm ${pnlActivePreset()===k?'btn-gold':''}" onclick="pnlApplyPreset('${k}')">${label}</button>`).join('')}
</div>
<div class="fg"><label>من</label><input type="date" value="${esc(window.pnlFrom)}" onchange="window.pnlFrom=this.value;pnlRefresh()"></div>
<div class="fg"><label>إلى</label><input type="date" value="${esc(window.pnlTo)}" onchange="window.pnlTo=this.value;pnlRefresh()"></div>
<button class="btn btn-sm" onclick="pnlPrint()" data-tooltip="طباعة قائمة دخل A4"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-sm btn-blue" onclick="pnlExportExcel()" data-tooltip="تصدير Excel"><i class=ji data-i=download></i> Excel</button>
</div></div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> صافي الإيرادات (قبل الضريبة)</div><div class="mcard-val c-gold">${fC(rev.total)}</div>
<div class="trend"><i class=ji data-i=receipt></i> ${fN(rev.invoice_count)} فاتورة كاشير + ${fN(rev.manual_count)} إيراد يدوي</div>${pnlCmpChip('revenue','إيراد',true)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> تكلفة المواد (COGS)</div><div class="mcard-val c-red">${fC(st.cogs.net)}</div>
<div class="trend"><i class=ji data-i=chart></i> ${fN(cogsPct.toFixed(1))}% من الإيراد</div>${pnlCmpChip('cogs','تكلفة',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=trending-up></i> مجمل الربح</div><div class="mcard-val ${gp.amount>=0?'c-green':'c-red'}">${fC(gp.amount)}</div>
<div class="trend">${marginChip(gp.margin_pct)}</div>${pnlCmpChip('gross_profit','مجمل',true)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=gem></i> صافي الربح التشغيلي</div><div class="mcard-val ${np.amount>=0?'c-green':'c-red'}">${fC(np.amount)}</div>
<div class="trend">${marginChip(np.margin_pct)}</div>${pnlCmpChip('net_profit','صافي',true)}</div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=clipboard-list></i> فروق الجرد (عجز/زيادة)</div><div class="mcard-val ${st.shrinkage.amount>0?'c-red':st.shrinkage.amount<0?'c-green':''}">${fC(st.shrinkage.amount)}</div>
<div class="trend">${fN(st.shrinkage.count)} حركة جرد</div>${pnlCmpChip('shrinkage','فروق',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> مصاريف تشغيلية</div><div class="mcard-val c-orange">${fC(st.operating.total)}</div>
<div class="trend">${fN(st.operating.count)} مصروف بـ ${fN(st.operating.items.length)} فئة</div>${pnlCmpChip('operating','تشغيلية',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> الرواتب والأجور</div><div class="mcard-val c-teal">${fC(st.payroll.total)}</div>
<div class="trend">${st.payroll.count?`${fN(st.payroll.count)} مسير — ${st.payroll.months.join(', ')}`:'لا مسيرات رواتب داخل الفترة'}</div>${pnlCmpChip('payroll','رواتب',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=percent></i> ضريبة القيمة المضافة المحصلة</div><div class="mcard-val c-blue">${fC(rev.vat_collected)}</div>
<div class="trend">التزام للهيئة — خارج حساب الربح</div>${pnlCmpChip('revenue','إجمالي',true)}</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=file-text></i> قائمة الدخل — ${fD(st.period.from)} إلى ${fD(st.period.to)}</h3><span class="u-faint u-t12">كل الأرقام من حركات مسجّلة فعليًا (لا إدخال يدوي)</span></div>
<div class="tbl-scroll"><table>
<thead><tr><th style="width:55%">البند</th><th>المبلغ</th><th style="width:16%">% من الإيراد</th></tr></thead>
<tbody>
<tr class="pnl-sec"><td colspan="3">أولًا: الإيرادات</td></tr>
<tr class="pnl-sub"><td>صافي مبيعات الكاشير (بعد الخصم، قبل الضريبة)</td><td class="c">${fC(rev.pos_net)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sub"><td>الإيرادات اليدوية/الأخرى</td><td class="c">${fC(rev.manual)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>إجمالي الإيرادات الصافية</td><td class="c-gold fw-bold">${fC(rev.total)}</td><td class="c">100%</td></tr>
<tr class="pnl-sub"><td>ضريبة القيمة المضافة المحصلة (التزام — ليست إيرادًا)</td><td class="c-blue">${fC(rev.vat_collected)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sec"><td colspan="3">ثانيًا: تكلفة المبيعات (COGS)</td></tr>
<tr class="pnl-sub"><td>صرف مخزون مواد للأقسام</td><td class="c">${fC(st.cogs.dispatch)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sub"><td>مرتجعات الأقسام للمخزن</td><td class="c ${st.cogs.returns<0?'c-green':''}">${fC(st.cogs.returns)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>صافي تكلفة المواد المستهلكة</td><td class="c-red fw-bold">${fC(st.cogs.net)}</td><td class="c">${fN(cogsPct.toFixed(1))}%</td></tr>
<tr class="pnl-total"><td>مجمل الربح</td><td class="fw-bold ${gp.amount>=0?'c-green':'c-red'}">${fC(gp.amount)}</td><td class="c">${gp.margin_pct==null?'—':fN(Number(gp.margin_pct).toFixed(1))+'%'}</td></tr>
<tr class="pnl-sec"><td colspan="3">ثالثًا: المصاريف التشغيلية والتكاليف الأخرى</td></tr>
<tr class="pnl-sub"><td>صافي فروق الجرد (عجز/زيادة)</td><td class="c ${st.shrinkage.amount>0?'c-red':st.shrinkage.amount<0?'c-green':''}">${fC(st.shrinkage.amount)}</td><td class="c text-muted">—</td></tr>
${st.operating.items.map(it=>`<tr class="pnl-sub"><td>${esc(it.category)} <span class="text-muted u-t12">(${fN(it.count)})</span></td><td class="c">${fC(it.amount)}</td><td class="c text-muted">—</td></tr>`).join('')||( '<tr class="pnl-sub"><td class="text-muted">لا توجد مصاريف تشغيلية في الفترة</td><td class="c">—</td><td class="c text-muted">—</td></tr>')}
<tr class="pnl-sub"><td>الرواتب والأجور</td><td class="c">${fC(st.payroll.total)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>إجمالي المصاريف التشغيلية والتكاليف الأخرى</td><td class="c-orange fw-bold">${fC(otherCosts)}</td><td class="c">${fN(otherPct.toFixed(1))}%</td></tr>
<tr class="pnl-net"><td>صافي الربح التشغيلي</td><td class="fw-bold ${np.amount>=0?'c-green':'c-red'}">${fC(np.amount)}</td><td class="c">${np.margin_pct==null?'—':fN(Number(np.margin_pct).toFixed(1))+'%'}</td></tr>
</tbody></table></div>
</div>
<div class="charts-grid">
<div class="chart-card"><div class="chart-title"><i class=ji data-i=chart></i> الإيراد مقابل التكاليف يوميًا</div><div class="chart-box"><canvas id="pnlTrendChart"></canvas></div></div>
<div class="chart-card"><div class="chart-title"><i class=ji data-i=building></i> الربح الصافي حسب القسم</div><div class="chart-box"><canvas id="pnlDeptChart"></canvas></div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=building></i> ربحية الأقسام</h3><span class="u-faint u-t12">الرواتب تُحتسب على مستوى المنشأة</span></div>
<div class="tbl-scroll"><table>
<thead><tr><th>القسم</th><th>الإيرادات</th><th>تكلفة المواد</th><th>فروق جرد</th><th>تشغيلية</th><th>الصافي</th><th>الهامش</th></tr></thead>
<tbody>${deptRows||'<tr><td colspan="7" class="text-muted c">لا حركات أقسام في الفترة</td></tr>'}</tbody>
</table></div>
</div>`;
}
function pnlApplyPreset(kind){
  if(kind==='custom') {return;}
  const [f,t]=pnlPresetRange(kind);
  window.pnlFrom=f; window.pnlTo=t; pnlRefresh();
}
function pnlInitCharts(){
  if(!PNL_DATA||STATE.page!=='pnl'||typeof Chart==='undefined') {return;}
  const st=PNL_DATA.statement;
  const daily=st.daily_series||[];
  const c1=document.getElementById('pnlTrendChart');
  if(c1){
    if(STATE.charts.pnlTrend) {STATE.charts.pnlTrend.destroy();}
    STATE.charts.pnlTrend=new Chart(c1,{type:'line',data:{
      labels:daily.map(d=>d.date.slice(5)),
      datasets:[
        {label:'الإيرادات',data:daily.map(d=>d.revenue),borderColor:'#2f9e72',backgroundColor:'#2f9e7222',fill:true,tension:.35},
        {label:'تكلفة المواد',data:daily.map(d=>d.cogs),borderColor:'#e74c3c',backgroundColor:'#e74c3c11',fill:true,tension:.35},
        {label:'تكاليف أخرى',data:daily.map(d=>d.opex),borderColor:'#b8862d',backgroundColor:'transparent',borderDash:[5,4],tension:.35}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}},scales:{x:{ticks:{color:'#9aa0b4'}},y:{ticks:{color:'#9aa0b4'}}}}});
  }
  const c2=document.getElementById('pnlDeptChart');
  if(c2){
    const depts=st.by_department||[];
    if(STATE.charts.pnlDept) {STATE.charts.pnlDept.destroy();}
    STATE.charts.pnlDept=new Chart(c2,{type:'bar',data:{
      labels:depts.map(d=>d.name),
      datasets:[
        {label:'الإيرادات',data:depts.map(d=>d.revenue),backgroundColor:'#2f9e7288',borderRadius:6},
        {label:'تكلفة المواد',data:depts.map(d=>d.cogs),backgroundColor:'#e74c3c88',borderRadius:6},
        {label:'الصافي',data:depts.map(d=>d.net),backgroundColor:'#b8862dcc',borderRadius:6}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}},scales:{x:{ticks:{color:'#9aa0b4'}},y:{ticks:{color:'#9aa0b4'}}}}});
  }
}
async function pnlPrint(){
  try{
    const p=new URLSearchParams();
    if(window.pnlFrom) {p.set('from',window.pnlFrom);}
    if(window.pnlTo) {p.set('to',window.pnlTo);}
    const res=await fetch(API_BASE+'/finance/pnl/print?'+p.toString(),{headers:{'Authorization':'Bearer '+(window._jwt||'')}});
    if(!res.ok) {throw new Error('فشل تحميل المستند');}
    const html=await res.text();
    const frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
    setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(_){} setTimeout(()=>frame.remove(),2000); },500);
  }catch(e){ toast(e.message||'تعذر الطباعة','error'); }
}
function pnlExportExcel(){
  if(!PNL_DATA){ toast('لا بيانات للتصدير','warning'); return; }
  const st=PNL_DATA.statement, cmp=PNL_DATA.comparison||{};
  const cur=(k)=>{const v=cmp[k];return v&&v.previous!=null?[v.current,v.previous,v.delta??'',v.pct??'']:['','','',''];};
  const data=[
    [`قائمة الأرباح والخسائر — ${st.period.from} إلى ${st.period.to}`],
    ['البند','القيمة (ريال)','% من الإيراد','الفترة السابقة','الفرق','التغير %'],
    ['صافي مبيعات الكاشير',st.revenue.pos_net,'','','',''],
    ['الإيرادات اليدوية/الأخرى',st.revenue.manual,'','','',''],
    ['إجمالي الإيرادات الصافية',st.revenue.total,'100',...cur('revenue')],
    ['ضريبة القيمة المضافة المحصلة (التزام)',st.revenue.vat_collected,'','','',''],
    ['صرف مخزون مواد للأقسام',st.cogs.dispatch,'','','',''],
    ['مرتجعات الأقسام للمخزن',st.cogs.returns,'','','',''],
    ['صافي تكلفة المواد (COGS)',st.cogs.net,st.revenue.total?((st.cogs.net/st.revenue.total)*100).toFixed(1):'',...cur('cogs')],
    ['مجمل الربح',st.gross_profit.amount,st.gross_profit.margin_pct??'',...cur('gross_profit')],
    ['صافي فروق الجرد',st.shrinkage.amount,'','','',''],
    ...st.operating.items.map(it=>[`مصروف تشغيلي — ${it.category}`,it.amount,'','','','']),
    ['الرواتب والأجور',st.payroll.total,'','','',''],
    ['صافي الربح التشغيلي',st.net_profit.amount,st.net_profit.margin_pct??'',...cur('net_profit')],
    [],
    ['ربحية الأقسام'],
    ['القسم','الإيرادات','تكلفة المواد','فروق جرد','تشغيلية','الصافي','الهامش %'],
    ...(st.by_department||[]).map(d=>[d.name,d.revenue,d.cogs,d.shrinkage,d.operating,d.net,d.margin_pct??'']),
    [],
    ['السلسلة اليومية'],
    ['التاريخ','الإيرادات','تكلفة المواد','تكاليف أخرى'],
    ...(st.daily_series||[]).map(d=>[d.date,d.revenue,d.cogs,d.opex])
  ];
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:38},{wch:16},{wch:14},{wch:16},{wch:14},{wch:12}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'قائمة الدخل');
  XLSX.writeFile(wb,`pnl_${st.period.from}_${st.period.to}.xlsx`);
  toast('تم تحميل ملف Excel','success');
}
window.pnlApplyPreset=pnlApplyPreset; window.pnlRefresh=pnlRefresh; window.pnlPrint=pnlPrint; window.pnlExportExcel=pnlExportExcel;



export { renderRevenues, whShortFilter, refreshWhShortages, whPrintShortages, whShortRows, whShortPanel, revPrintFiltered, expPrintFiltered, showAddRevenueModal, addRevenue, editRevenue, updateRevenue, deleteRevenue, renderExpenses, showAddExpenseModal, addExpense, editExpense, updateExpense, deleteExpense, renderCostAnalysis, PNL_PRESETS, pnlPresetRange, pnlActivePreset, pnlLoad, pnlRefresh, pnlCmpChip, renderPnl, pnlApplyPreset, pnlInitCharts, pnlPrint, pnlExportExcel };
