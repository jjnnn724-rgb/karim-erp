/**
 * features/reports.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// FIX 2026-10-01: localDateOnly كانت ضاعت في الهجرة (معرفة في smart-card فقط)
// فكان توليد كل التقارير يرمي «localDateOnly is not defined» — استيراد صريح.
import { localDateOnly } from './smart-card.js?v=4.9.1';
// ============================================
// REPORTS
// ============================================
function renderReports(){
if(!checkMenuAccessLocal('reports')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const todayStr=today();
const firstDayOfMonth=todayStr.substring(0,8)+'01';
return `
<div class="report-filter-bar no-print">
<div class="fg">
<label>${t('rep.type')}</label>
<select id="reportType" data-karim-action="generateReport" data-karim-event="change">
<option value="general">${t('rep.general')}</option>
<option value="department">${t('rep.dept')}</option>
<option value="kitchen">${t('rep.kitchen')}</option>
<option value="returns">تقرير المرتجعات</option>
<option value="warehouse">تقرير المخازن والمخزون</option>
<option value="hr">تقرير الموارد البشرية</option>
<option value="dept-specific">تقرير قسم محدد</option>
<option value="pos-department">مبيعات POS حسب القسم</option>
<option value="pos-cashier">مبيعات POS حسب الكاشير</option>
<option value="pos-item">مبيعات POS حسب الصنف</option>
<option value="yara-departments">إيرادات الأقسام (يومي/شهري/سنوي)</option>
<option value="yara-cashiers">مبيعات الكاشيرية (تفصيلي per كاشير)</option>
</select>
</div>
<div class="fg" id="deptSelectGroup" style="display:none">
<label>اختر القسم</label>
<select id="reportDeptSelect" data-karim-action="generateReport" data-karim-event="change">
${(STATE.departments||[]).map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('')}
</select>
</div>
<div class="fg">
<label>الفترة الزمنية</label>
<select id="reportPeriod" data-karim-action="updateDateInputs" data-karim-event="change">
<option value="today">اليوم</option>
<option value="week">هذا الأسبوع</option>
<option value="month">هذا الشهر</option>
<option value="year">هذا العام</option>
<option value="custom">فترة مخصصة</option>
</select>
</div>
<div class="fg" id="dateFromGroup" style="display:none">
<label>من تاريخ</label>
<input type="date" id="reportDateFrom" value="${firstDayOfMonth}">
</div>
<div class="fg" id="dateToGroup" style="display:none">
<label>إلى تاريخ</label>
<input type="date" id="reportDateTo" value="${todayStr}">
</div>
<div class="fg" style="display:flex;align-items:flex-end;gap:8px">
<button class="btn btn-gold" data-karim-action="generateReport"><i class=ji data-i=refresh></i> تحديث</button>
<button class="btn btn-blue" data-karim-action="printReportOnly"><i class=ji data-i=printer></i> طباعة</button>
</div>
</div>
<div id="reportContent" class="report-content"></div>
`;
}
function updateDateInputs(){
const period=document.getElementById('reportPeriod').value;
const reportType=document.getElementById('reportType').value;
document.getElementById('dateFromGroup').style.display=period==='custom'?'block':'none';
document.getElementById('dateToGroup').style.display=period==='custom'?'block':'none';
document.getElementById('deptSelectGroup').style.display=reportType==='dept-specific'?'block':'none';
}
function getDateRange(){
const period=document.getElementById('reportPeriod').value;
const todayDate=new Date();
let startDate, endDate;
// localDateOnly keeps the LOCAL calendar day (toISOString shifted the day
// backwards before 03:00 local in UTC+3)
if(period==='today'){ startDate=localDateOnly(todayDate); endDate=startDate; }
else if(period==='week'){ const weekStart=new Date(todayDate); weekStart.setDate(todayDate.getDate()-todayDate.getDay()); startDate=localDateOnly(weekStart); endDate=localDateOnly(todayDate); }
else if(period==='month'){ startDate=`${todayDate.getFullYear()}-${String(todayDate.getMonth()+1).padStart(2,'0')}-01`; endDate=localDateOnly(todayDate); }
else if(period==='year'){ startDate=`${todayDate.getFullYear()}-01-01`; endDate=localDateOnly(todayDate); }
else{ startDate=document.getElementById('reportDateFrom').value; endDate=document.getElementById('reportDateTo').value; }
return { startDate, endDate };
}
async function generateReport(){
if(STATE.page!=='reports') {return;}
const type=document.getElementById('reportType')?.value;
if(!type) {return;}
const { startDate, endDate } = getDateRange();
const periodLabel=document.getElementById('reportPeriod').selectedOptions[0].text;
const container=document.getElementById('reportContent');
container.innerHTML=`<div class="u-empty"><div class="spinner"></div><p>جارٍ إعداد التقرير...</p></div>`;
if(type==='yara-departments'){
await generateYaraDeptReport(startDate,endDate,periodLabel,container);
return;
}
if(type==='yara-cashiers'){
await generateYaraCashiersReport(startDate,endDate,periodLabel,container);
return;
}
if(type.startsWith('pos-')){
await generatePosSalesReport(type,startDate,endDate,periodLabel,container);
return;
}
setTimeout(()=>{
if(STATE.page!=='reports') {return;}
const liveContainer=document.getElementById('reportContent');
if(!liveContainer) {return;}
try{
const reportTypeNames={general:'الشامل',department:'الأقسام المفصل',kitchen:'أداء المطبخ',returns:'المرتجعات',warehouse:'المخازن والمخزون',hr:'الموارد البشرية','dept-specific':'قسم محدد'};
let html=`
<div class="report-header">
<div class="report-logo">${logoMarkup('report-logo-image')}</div>
<h1>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</h1>
<div class="subtitle">تقرير ${reportTypeNames[type]} احترافي</div>
<div class="meta">
<span><i class=ji data-i=calendar></i> الفترة: <strong>${periodLabel}</strong></span>
<span><i class=ji data-i=calendar-days></i> من: <strong>${fD(startDate)}</strong></span>
<span><i class=ji data-i=calendar-days></i> إلى: <strong>${fD(endDate)}</strong></span>
<span><i class=ji data-i=clock></i> تاريخ الإصدار: <strong>${fDT(new Date().toISOString())}</strong></span>
</div>
</div>
`;
if(type==='general') {html+=generateGeneralReport(startDate,endDate);}
else if(type==='department') {html+=generateDepartmentReport(startDate,endDate);}
else if(type==='kitchen') {html+=generateKitchenReport(startDate,endDate);}
else if(type==='returns') {html+=generateReturnsReport(startDate,endDate);}
else if(type==='warehouse') {html+=generateWarehouseReport(startDate,endDate);}
else if(type==='hr') {html+=generateHRReport(startDate,endDate);}
else if(type==='dept-specific'){ const deptCode=document.getElementById('reportDeptSelect').value; html+=generateSpecificDeptReport(deptCode,startDate,endDate); }
html+=`<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=chart></i> تم إنشاء هذا التقرير بواسطة <strong>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</strong></div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${fDT(new Date().toISOString())} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
liveContainer.innerHTML=html;
}catch(repErr){
console.error('[generateReport]', repErr);
try{ liveContainer.innerHTML=`<div class="mcard" style="text-align:center;padding:30px">⚠️ تعذر إنشاء التقرير: ${esc(repErr.message||'خطأ غير متوقع')} <button class="btn btn-gold btn-sm" data-karim-action="generateReport">إعادة المحاولة</button></div>`; }catch(_){}
}
},300);
}
async function generatePosSalesReport(type,startDate,endDate,periodLabel,container){
const groupMap={'pos-department':'department','pos-cashier':'cashier','pos-item':'item'};
const reportNames={'pos-department':'مبيعات الكاشير حسب القسم','pos-cashier':'مبيعات الكاشير حسب الموظف','pos-item':'مبيعات الكاشير حسب الصنف'};
try{
const params=new URLSearchParams({start_date:startDate,end_date:endDate,group_by:groupMap[type]||'department'});
// apiFetch attaches the Bearer token itself — the bare fetch only worked
// thanks to realtime.js's monkey-patched fetch and broke under API_KEY
const data=await apiFetch('/pos/reports/sales?' + params.toString());
container.innerHTML=renderPosSalesReportHtml(data,periodLabel,reportNames[type]||'مبيعات الكاشير');
}catch(err){
console.error('POS report error:',err);
container.innerHTML=`<div class="mcard" style="padding:24px;text-align:center"><div style="font-size:42px;margin-bottom:10px"><i class=ji data-i=alert-triangle></i></div><div style="font-weight:800;margin-bottom:8px">تعذر تحميل تقرير الكاشير</div><div class="u-faint">${esc(err.message||'حدث خطأ غير متوقع أثناء قراءة بيانات المبيعات من قاعدة البيانات')}</div></div>`;
toast(err.message||'تعذر تحميل تقرير الكاشير','error');
}
}
function renderPosPaymentSummary(paymentMethods){
const entries=Object.entries(paymentMethods||{}).filter(([,value])=>Number(value||0)!==0);
if(entries.length===0) {return '';}
const methodNames={cash:'نقدي',card:'بطاقة',wallet:'محفظة',bank:'تحويل',credit:'آجل'};
return `
<div class="report-section">
<h3><i class=ji data-i=credit-card></i> توزيع طرق الدفع</h3>
<div class="report-summary-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
${entries.map(([method,value])=>`<div class="report-summary-card"><h4>${methodNames[method]||method}</h4><div class="value c-blue">${fC(value)}</div></div>`).join('')}
</div>
</div>`;
}
function renderPosSalesReportHtml(data,periodLabel,reportTitle){
const summary=data.summary||{};
const rows=Array.isArray(data.rows)?data.rows:[];
const generatedAt=fDT(new Date().toISOString());
let tableHtml;
if(data.group_by==='department'){
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=building></i> المبيعات حسب القسم</h3>
<table class="report-table">
<thead><tr><th>القسم</th><th>عدد الفواتير</th><th>الكمية المباعة</th><th>الأصناف</th><th>صافي المبيعات</th><th>متوسط الفاتورة</th></tr></thead>
<tbody>
${rows.length?rows.map(row=>`<tr>
<td><strong>${esc(row.department_name||'—')}</strong><br><small class="u-faint">${esc(row.department_code||'')}</small></td>
<td>${fN(row.invoice_count||0)}</td>
<td>${fN(row.items_qty||0)}</td>
<td>${fN(row.unique_items||0)}</td>
<td class="amount-cell amount-gold">${fC(row.net_sales||0)}</td>
<td class="amount-cell c-blue">${fC(row.avg_ticket||0)}</td>
</tr>`).join(''):`<tr><td colspan="6" class="u-empty-sm">لا توجد مبيعات POS ضمن الفترة المحددة</td></tr>`}
</tbody>
</table>
</div>`;
}else if(data.group_by==='cashier'){
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=user></i> المبيعات حسب الكاشير</h3>
<table class="report-table">
<thead><tr><th>الكاشير</th><th>عدد الفواتير</th><th>الكمية المباعة</th><th>الأصناف</th><th>صافي المبيعات</th><th>متوسط الفاتورة</th></tr></thead>
<tbody>
${rows.length?rows.map(row=>`<tr>
<td><strong>${esc(row.cashier_name||'—')}</strong><br><small class="ltr-inline">${esc(row.cashier_username||'')}</small></td>
<td>${fN(row.invoice_count||0)}</td>
<td>${fN(row.items_qty||0)}</td>
<td>${fN(row.unique_items||0)}</td>
<td class="amount-cell amount-gold">${fC(row.net_sales||0)}</td>
<td class="amount-cell c-blue">${fC(row.avg_ticket||0)}</td>
</tr>`).join(''):`<tr><td colspan="6" class="u-empty-sm">لا توجد مبيعات POS ضمن الفترة المحددة</td></tr>`}
</tbody>
</table>
</div>`;
}else{
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=package></i> المبيعات حسب الصنف</h3>
<table class="report-table">
<thead><tr><th>الصنف</th><th>القسم</th><th>عدد الفواتير</th><th>الكمية</th><th>صافي المبيعات</th><th>الضريبة</th></tr></thead>
<tbody>
${rows.length?rows.map(row=>`<tr>
<td><strong>${esc(row.product_name||'—')}</strong><br><small class="ltr-inline">${esc(row.product_barcode||'')}</small></td>
<td>${esc(row.department_name||'—')}</td>
<td>${fN(row.invoice_count||0)}</td>
<td>${fN(row.quantity_sold||0)}</td>
<td class="amount-cell amount-gold">${fC(row.net_sales||0)}</td>
<td class="amount-cell c-orange">${fC(row.tax_total||0)}</td>
</tr>`).join(''):`<tr><td colspan="6" class="u-empty-sm">لا توجد مبيعات POS ضمن الفترة المحددة</td></tr>`}
</tbody>
</table>
</div>`;
}
return `
<div class="report-header">
<div class="report-logo">${logoMarkup('report-logo-image')}</div>
<h1>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</h1>
<div class="subtitle">${reportTitle} — مباشر من قاعدة البيانات</div>
<div class="meta">
<span><i class=ji data-i=calendar></i> الفترة: <strong>${periodLabel}</strong></span>
<span><i class=ji data-i=calendar-days></i> من: <strong>${fD(data.start_date||'')}</strong></span>
<span><i class=ji data-i=calendar-days></i> إلى: <strong>${fD(data.end_date||'')}</strong></span>
<span><i class=ji data-i=clock></i> تاريخ الإصدار: <strong>${generatedAt}</strong></span>
</div>
</div>
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> صافي المبيعات</h4><div class="value c-gold">${fC(summary.net_sales||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=receipt></i> عدد الفواتير</h4><div class="value c-blue">${fN(summary.invoice_count||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=package></i> إجمالي الكميات</h4><div class="value c-teal">${fN(summary.items_qty||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=target></i> متوسط الفاتورة</h4><div class="value c-green">${fC(summary.avg_ticket||0)}</div></div>
</div>
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=calculator></i> إجمالي قبل الضريبة</h4><div class="value c-blue">${fC(summary.subtotal_sales||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=tag></i> الخصومات</h4><div class="value c-red">${fC(summary.discount_total||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=receipt></i> الضريبة</h4><div class="value c-orange">${fC(summary.tax_total||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=folder-open></i> الأصناف المباعة</h4><div class="value c-purple">${fN(summary.unique_items||0)}</div></div>
</div>
${renderPosPaymentSummary(summary.payment_methods)}
${tableHtml}
<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=shopping-cart></i> هذا التقرير يعتمد على فواتير POS الفعلية وجداول المبيعات المباشرة</div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${generatedAt} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
}
function formatRevenueNote(note){
const raw=String(note||'').trim();
if(!raw){return '—';}
const isPos=raw.includes('[AUTO:POS]');
const isCashierDb=raw.includes('[AUTO:YARASOFT]');
if(!isPos&&!isCashierDb){return raw;}
const invoice=(raw.match(/invoice=([^|]+)/)||[])[1]?.trim();
const items=(raw.match(/items=([^|]+)/)||[])[1]?.trim();
if(isCashierDb){
const sec=(raw.match(/sec=([^|]+)/)||[])[1]?.trim();
const parts=['مبيعات الكاشير'];
if(invoice){parts.push(`فاتورة #${invoice}`);}
if(sec){parts.push(`الجهة: ${sec}`);}
if(items){parts.push(`الأصناف: ${items}`);}
return parts.join(' — ');
}
const cashier=(raw.match(/cashier=([^|]+)/)||[])[1]?.trim();
const parts=['بيع من الكاشير'];
if(invoice){parts.push(`فاتورة #${invoice}`);}
if(cashier){parts.push(`الكاشير: ${cashier}`);}
if(items){parts.push(`الأصناف: ${items.replace(/\(([^)]+)\)/g,' ($1)')}`);}
return parts.join(' — ');
}
function generateGeneralReport(startDate,endDate){
const revs=STATE.revenues.filter(r=>r.date>=startDate&&r.date<=endDate);
const exps=STATE.expenses.filter(e=>e.date>=startDate&&e.date<=endDate);
const totalRev=revs.reduce((s,r)=>s+Number(r.amount||0),0);
// القائمة العامة truthful: كل المصاريف تُحسب — تشغيلية + صرف مخزون + فروق جرد (المرتجعات السالبة تُخصم تلقائيًا)
const totalExp=exps.reduce((s,e)=>s+Number(e.amount||0),0);
const profit=totalRev-totalExp;
const costRatio=totalRev>0?((totalExp/totalRev)*100).toFixed(1):0;
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> إجمالي الإيرادات</h4><div class="value c-gold">${fC(totalRev)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=wallet></i> إجمالي المصاريف</h4><div class="value c-red">${fC(totalExp)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=trending-up></i> صافي الربح</h4><div class="value ${profit>=0?'c-green':'c-red'}">${fC(profit)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=chart></i> نسبة التكلفة</h4><div class="value c-orange">${costRatio}%</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=clipboard-list></i> ملخص المعاملات (${revs.length+exps.length} معاملة)</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=calendar></i> التاريخ</th><th><i class=ji data-i=pin></i> النوع</th><th><i class=ji data-i=file-text></i> البيان / القسم</th><th class="u-ta-l"><i class=ji data-i=banknote></i> المبلغ</th></tr></thead>
<tbody>
${[...revs.map(r=>({...r,type:'<i class=ji data-i=banknote></i> إيراد',cls:'c-gold'})),...exps.filter(isOperatingExpense).map(e=>({...e,type:'<i class=ji data-i=wallet></i> مصروف',cls:'c-red'})),...exps.filter(e=>!isOperatingExpense(e)).map(e=>({...e,type:'<i class=ji data-i=transfer></i> حركة مخزون',cls:'c-blue'}))].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,30).map(item=>{
const dept=STATE.departments.find(x=>x.code===item.deptId);
return `<tr>
<td>${fD(item.date)}</td>
<td><span class="badge ${item.type==='<i class=ji data-i=banknote></i> إيراد'?'bdg-green':item.type.includes('حركة مخزون')?'bdg-blue':'bdg-red'}">${item.type}</span></td>
<td>${esc(item.type==='<i class=ji data-i=banknote></i> إيراد'?formatRevenueNote(item.notes||item.source):item.notes||item.desc||item.source||'—')} ${dept?`(${dept.name})`:''}</td>
<td class="amount-cell ${item.cls} u-ta-l">${fC(item.amount)}</td>
</tr>`;
}).join('')}
</tbody>
<tfoot>
<tr>
<td colspan="3" class="u-ta-l"><i class=ji data-i=gem></i> الإجمالي الصافي</td>
<td class="u-ta-l amount-cell ${profit>=0?'c-green':'c-red'}">${fC(profit)}</td>
</tr>
</tfoot>
</table>
</div>
`;
}
function generateDepartmentReport(_startDate,_endDate){
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=building></i> عدد الأقسام النشطة</h4><div class="value c-blue">${STATE.departments.length}</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=chart></i> تحليل أداء الأقسام</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=building></i> القسم</th><th><i class=ji data-i=banknote></i> الإيرادات</th><th><i class=ji data-i=wallet></i> المصاريف</th><th><i class=ji data-i=gem></i> صافي الربح</th><th><i class=ji data-i=chart></i> نسبة التكلفة</th><th><i class=ji data-i=star></i> التقييم</th></tr></thead>
<tbody>
${STATE.departments.map(dept=>{
const s=calcStats(dept.code);
const ratio=s.rev>0?((s.exp/s.rev)*100).toFixed(1):0;
const rating=ratio<30?'<i class=ji data-i=dot-green></i> ممتاز':ratio<50?'<i class=ji data-i=dot-yellow></i> جيد':ratio<70?'<i class=ji data-i=dot-orange></i> متوسط':'<i class=ji data-i=dot-red></i> مرتفع';
return `<tr>
<td><strong>${dept.icon} ${esc(dept.name)}</strong><br><small class="u-faint">${dept.code}</small></td>
<td class="amount-cell amount-gold">${fC(s.rev)}</td>
<td class="amount-cell amount-red">${fC(s.exp)}</td>
<td class="amount-cell ${s.profit>=0?'amount-green':'amount-red'}">${fC(s.profit)}</td>
<td class="c-orange fw-bold">${ratio}%</td>
<td>${rating}</td>
</tr>`;
}).join('')}
</tbody>
</table>
</div>
`;
}
function generateKitchenReport(startDate,endDate){
const dispatches=STATE.dispatches.filter(d=>d.date>=startDate&&d.date<=endDate&&d.status==='approved');
const totalDispatchValue=dispatches.reduce((sum,d)=>sum+(d.approvedItems?d.approvedItems.reduce((s,i)=>s+(i.approvedValue||0),0):0),0);
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=circle-check></i> طلبات الصرف المعتمدة</h4><div class="value c-blue">${dispatches.length}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=wallet></i> إجمالي قيمة المستهلك</h4><div class="value c-red">${fC(totalDispatchValue)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=utensils></i> عدد الوصفات النشطة</h4><div class="value c-gold">${STATE.recipes.length}</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=clipboard-list></i> سجل صرف المطبخ المعتمد</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=calendar></i> التاريخ</th><th><i class=ji data-i=building></i> القسم الطالب</th><th><i class=ji data-i=package></i> الأصناف</th><th class="u-ta-l"><i class=ji data-i=banknote></i> القيمة المقدرة</th></tr></thead>
<tbody>
${dispatches.length>0?dispatches.map(d=>{
const val=d.approvedItems?d.approvedItems.reduce((s,i)=>s+(i.approvedValue||0),0):0;
const itemsList=d.items.map(i=>`${i.itemName} (${i.qty} ${i.unit})`).join(', ');
return `<tr>
<td>${fD(d.date)}</td>
<td>${esc(d.deptName)}</td>
<td><small>${esc(itemsList)}</small></td>
<td class="amount-cell amount-red u-ta-l">${fC(val)}</td>
</tr>`;
}).join(''):'<tr><td colspan="4" class="u-empty-sm">لا توجد عمليات صرف معتمدة في هذه الفترة</td></tr>'}
</tbody>
</table>
</div>
`;
}
function generateReturnsReport(startDate,endDate){
const returns=(STATE.kitchenReturns||[]).filter(ret=>ret.date>=startDate&&ret.date<=endDate);
const totalReturnsValue=returns.reduce((sum,ret)=>sum+(parseFloat(ret.totalValue)||0),0);
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=undo></i> عدد المرتجعات</h4><div class="value c-blue">${returns.length}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> إجمالي القيمة المعكوسة</h4><div class="value c-green">${fC(totalReturnsValue)}</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=undo></i> سجل المرتجعات</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=calendar></i> التاريخ</th><th><i class=ji data-i=building></i> القسم</th><th><i class=ji data-i=package></i> الأصناف</th><th><i class=ji data-i=pin></i> السبب</th><th class="u-ta-l"><i class=ji data-i=banknote></i> القيمة</th></tr></thead>
<tbody>
${returns.length>0?returns.map(ret=>`<tr>
<td>${fD(ret.date)}</td>
<td>${esc(ret.deptName||'—')}</td>
<td><small>${(ret.items||[]).map(item=>`${esc(item.name||item.itemName)} (${fN(item.qty)})`).join(', ')}</small></td>
<td>${esc(ret.reason||'—')}</td>
<td class="amount-cell amount-green u-ta-l">${fC(ret.totalValue||0)}</td>
</tr>`).join(''):'<tr><td colspan="5" class="u-empty-sm">لا توجد مرتجعات في هذه الفترة</td></tr>'}
</tbody>
</table>
</div>
`;
}
function generateWarehouseReport(_startDate,_endDate){
const totalInventoryValue=STATE.inventory.reduce((s,i)=>s+(i.qty*i.avgCost),0);
const lowStockItems=STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty));
const totalWeight=STATE.inventory.reduce((s,i)=>s+(i.weight||0),0);
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> القيمة الإجمالية للمخزون</h4><div class="value c-gold">${fC(totalInventoryValue)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=package></i> عدد الأصناف</h4><div class="value c-blue">${STATE.inventory.length}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=scale></i> إجمالي الوزن</h4><div class="value c-teal">${fN(totalWeight)} كجم</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=alert-triangle></i> أصناف تحت الحد الأدنى</h4><div class="value ${lowStockItems.length>0?'c-red':'c-green'}">${lowStockItems.length}</div></div>
</div>
${lowStockItems.length>0?`
<div class="report-section">
<h3><i class=ji data-i=alert-triangle></i> تنبيهات المخزون المنخفض</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=package></i> الصنف</th><th><i class=ji data-i=tag></i> الفئة</th><th><i class=ji data-i=chart></i> المتوفر</th><th><i class=ji data-i=trending-down></i> الحد الأدنى</th><th><i class=ji data-i=alert-triangle></i> النقص</th></tr></thead>
<tbody>
${lowStockItems.map(i=>`<tr>
<td><strong>${esc(i.name)}</strong></td>
<td>${esc(i.category||'—')}</td>
<td class="amount-cell amount-red">${fN(i.qty)} ${i.unit}</td>
<td>${fN(i.minQty)} ${i.unit}</td>
<td class="amount-cell amount-red">${fN(i.minQty-i.qty)} ${i.unit}</td>
</tr>`).join('')}
</tbody>
</table>
</div>
`:''}
<div class="report-section">
<h3><i class=ji data-i=archive></i> توزيع الأصناف على الرفوف</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=archive></i> الرف</th><th><i class=ji data-i=map-pin></i> الموقع</th><th><i class=ji data-i=package></i> عدد الأصناف</th><th><i class=ji data-i=banknote></i> القيمة</th></tr></thead>
<tbody>
${STATE.shelves.map(shelf=>{
const items=STATE.inventory.filter(i=>i.shelfId===shelf.id);
const value=items.reduce((s,i)=>s+(i.qty*i.avgCost),0);
return `<tr>
<td><strong>${shelf.icon} ${esc(shelf.name)}</strong></td>
<td>${esc(shelf.location||'—')}</td>
<td>${items.length}</td>
<td class="c-gold">${fC(value)}</td>
</tr>`;
}).join('')}
</tbody>
</table>
</div>
`;
}
function generateHRReport(startDate,endDate){
const activeEmployees=STATE.employees.filter(e=>e.status==='active');
const totalSalaries=activeEmployees.reduce((s,e)=>s+(e.salary||0),0);
const attendanceThisMonth=STATE.attendance.filter(a=>a.date>=startDate&&a.date<=endDate);
const leavesThisPeriod=STATE.leaveRequests.filter(l=>l.startDate>=startDate&&l.startDate<=endDate);
return `
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=users></i> إجمالي الموظفين</h4><div class="value c-gold">${fN(STATE.employees.length)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=circle-check></i> موظفون نشطون</h4><div class="value c-green">${fN(activeEmployees.length)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> إجمالي الرواتب الشهرية</h4><div class="value c-blue">${fC(totalSalaries)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=calendar></i> الإجازات في الفترة</h4><div class="value c-orange">${fN(leavesThisPeriod.length)}</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=users></i> قائمة الموظفين</h3>
<table class="report-table">
<thead><tr><th><i class=ji data-i=id-card></i> الرقم</th><th><i class=ji data-i=user></i> الاسم</th><th><i class=ji data-i=building></i> القسم</th><th><i class=ji data-i=briefcase></i> المنصب</th><th><i class=ji data-i=banknote></i> الراتب</th><th><i class=ji data-i=chart></i> الحضور</th></tr></thead>
<tbody>
${activeEmployees.map(emp=>{
const dept=STATE.hrDepartments.find(d=>d.code===emp.department);
const empAttendance=attendanceThisMonth.filter(a=>a.employeeId===emp.id&&a.checkIn).length;
return `<tr><td>${esc(emp.employeeId||'—')}</td><td class="fw-bold">${esc(emp.name)}</td><td>${dept?esc(dept.name):'—'}</td><td>${esc(emp.position||'—')}</td><td class="c-gold">${fC(emp.salary||0)}</td><td class="c-blue">${empAttendance} يوم</td></tr>`;
}).join('')}
</tbody>
<tfoot><tr><td colspan="4" class="u-ta-l"><i class=ji data-i=banknote></i> إجمالي الرواتب</td><td class="c-gold fw-bold">${fC(totalSalaries)}</td><td></td></tr></tfoot>
</table>
</div>
`;
}
function generateSpecificDeptReport(deptCode,startDate,endDate){
const dept=STATE.departments.find(d=>d.code===deptCode);
if(!dept) {return '<div class="report-section"><h3><i class=ji data-i=circle-x></i> القسم غير موجود</h3></div>';}
const s=calcStats(deptCode,startDate,endDate);
return `
<div class="report-header" style="padding:20px;margin-bottom:20px">
<div style="display:flex;align-items:center;gap:20px;justify-content:center">
<span style="font-size:56px">${dept.icon}</span>
<div style="text-align:right">
<h1 style="font-size:24px;margin-bottom:4px">${esc(dept.name)}</h1>
<div class="subtitle u-t14">كود القسم: ${dept.code}</div>
</div>
</div>
</div>
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> الإيرادات</h4><div class="value c-gold">${fC(s.rev)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=wallet></i> المصاريف</h4><div class="value c-red">${fC(s.exp)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=gem></i> صافي الربح</h4><div class="value ${s.profit>=0?'c-green':'c-red'}">${fC(s.profit)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=chart></i> نسبة التكلفة</h4><div class="value c-orange">${s.costRatio.toFixed(1)}%</div></div>
</div>
`;
}
async function generateYaraDeptReport(startDate,endDate,periodLabel,container){
const period=document.getElementById('reportPeriod')?.value;
const group=period==='month'?'month':period==='year'?'year':'day';
const groupNames={day:'يومي',month:'شهري',year:'سنوي'};
try{
const params=new URLSearchParams({from:startDate,to:endDate,group});
const data=await apiFetch('/yara-reports/departments?'+params.toString());
const rows=Array.isArray(data.rows)?data.rows:[];
const t=data.totals||{};
container.innerHTML=`
<div class="report-header">
<div class="report-logo">${logoMarkup('report-logo-image')}</div>
<h1>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</h1>
<div class="subtitle">إيرادات الأقسام (${groupNames[group]})</div>
<div class="meta">
<span><i class=ji data-i=calendar></i> الفترة: <strong>${periodLabel}</strong></span>
<span><i class=ji data-i=calendar-days></i> من: <strong>${fD(startDate)}</strong></span>
<span><i class=ji data-i=calendar-days></i> إلى: <strong>${fD(endDate)}</strong></span>
<span><i class=ji data-i=clock></i> تاريخ الإصدار: <strong>${fDT(new Date().toISOString())}</strong></span>
</div>
</div>
<div class="report-section">
<h3><i class=ji data-i=building></i> الإجماليات</h3>
<table class="report-table">
<thead><tr><th>إجمالي الإيراد</th><th>المرتجعات</th><th>الصافي</th><th>الفواتير</th></tr></thead>
<tbody><tr>
<td class="amount-cell amount-gold">${fC(t.gross||0)}</td>
<td class="amount-cell c-orange">${fC(t.refund||0)}</td>
<td class="amount-cell amount-gold"><strong>${fC(t.net||0)}</strong></td>
<td>${fN(t.invoices||0)}</td>
</tr></tbody>
</table>
</div>
<div class="report-section">
<h3><i class=ji data-i=chart></i> التفصيل ${group==='day'?'اليومي':group==='month'?'الشهري':'السنوي'} حسب القسم</h3>
<table class="report-table">
<thead><tr><th>${group==='day'?'اليوم':group==='month'?'الشهر':'السنة'}</th><th>القسم</th><th>الإيراد</th><th>المرتجعات</th><th>الصافي</th><th>الفواتير</th></tr></thead>
<tbody>
${rows.length?rows.map(row=>`<tr>
<td>${esc(row.period||'—')}</td>
<td><strong>${esc(row.dept_name||'—')}</strong><br><small class="u-faint">${esc(row.dept_code||'')}</small></td>
<td class="amount-cell">${fC(row.gross||0)}</td>
<td class="amount-cell c-orange">${fC(row.refund||0)}</td>
<td class="amount-cell amount-gold"><strong>${fC(row.net||0)}</strong></td>
<td>${fN(row.invoices||0)}</td>
</tr>`).join(''):`<tr><td colspan="6" class="u-empty-sm">لا توجد إغلاقات يومية ضمن الفترة — شغّل التعبئة من صفحة استيراد المبيعات</td></tr>`}
</tbody>
</table>
</div>
<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=chart></i> تم إنشاء هذا التقرير بواسطة <strong>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</strong></div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${fDT(new Date().toISOString())} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
}catch(err){
console.error('Yara dept report error:',err);
container.innerHTML=`<div class="u-empty-sm">تعذر تحميل التقرير: ${esc(err.message||err)}</div>`;
}
}
// ─── مبيعات الكاشيرية من يارا سوفت (تفصيلي: كاشير × صنف / فواتير) ───
const YCASH={cashier:'',view:'items',page:1};
async function generateYaraCashiersReport(startDate,endDate,periodLabel,container){
try{
const params=new URLSearchParams({from:startDate,to:endDate,view:YCASH.view,limit:'100'});
if(YCASH.cashier){params.set('cashier',YCASH.cashier);}
if(YCASH.view==='invoices'){params.set('page',String(YCASH.page));}
const data=await apiFetch('/yara-reports/cashier-items?'+params.toString());
container.innerHTML=renderYaraCashiersHtml(data,startDate,endDate,periodLabel);
}catch(err){
console.error('Yara cashiers report error:',err);
container.innerHTML=`<div class="mcard" style="padding:24px;text-align:center"><div style="font-weight:800;margin-bottom:8px">تعذر تحميل تقرير الكاشيرية</div><div class="u-faint">${esc(err.message||'تحقق من اتصال قاعدة المبيعات')}</div></div>`;
toast(err.message||'تعذر تحميل تقرير الكاشيرية','error');
}
}
function renderYaraCashiersHtml(data,startDate,endDate,periodLabel){
const t=data.totals||{};
const cashiers=Array.isArray(data.cashiers)?data.cashiers:[];
const rows=Array.isArray(data.rows)?data.rows:[];
const isInv=data.view==='invoices';
const generatedAt=fDT(new Date().toISOString());
const cashierOpts=`<option value="">كل الكاشيرية</option>`+cashiers.map(c=>`<option value="${esc(c.no)}" ${String(YCASH.cashier)===String(c.no)?'selected':''}>${esc(c.name)}</option>`).join('');
let tableHtml;
if(!isInv){
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=package></i> المباع تفصيلًا: الكاشير × الصنف (السعر × الكمية = الصافي)</h3>
<table class="report-table">
<thead><tr><th>الكاشير</th><th>الصنف</th><th>الوحدة</th><th>الفواتير</th><th>الكمية</th><th>متوسط السعر</th><th>الصافي</th><th>الخصم</th><th>الضريبة</th></tr></thead>
<tbody>
${rows.length?rows.map(r=>`<tr>
<td><strong>${esc(r.cashier_name||'—')}</strong></td>
<td><strong>${esc(r.item_name||'—')}</strong><br><small class="ltr-inline">${esc(r.item_code||'')}</small></td>
<td>${esc(r.unit||'—')}</td>
<td>${fN(r.invoices||0)}</td>
<td>${fN(r.qty||0)}</td>
<td class="amount-cell c-blue">${fC(r.avg_price||0)}</td>
<td class="amount-cell amount-gold"><strong>${fC(r.net||0)}</strong></td>
<td class="amount-cell c-red">${fC(r.discount||0)}</td>
<td class="amount-cell c-orange">${fC(r.vat||0)}</td>
</tr>`).join(''):`<tr><td colspan="9" class="u-empty-sm">لا توجد أصناف مباعة ضمن الفترة — وسّع الفترة أو تحقق من سحب المبيعات</td></tr>`}
</tbody>
</table>
</div>`;
}else{
const pg=`<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px" class="no-print">
<button class="btn btn-sm" ${data.page<=1?'disabled':''} data-karim-action="kdGenerateReport" data-karim-arg0="${(data.page||1)-1}">السابق</button>
<span class="u-faint">صفحة ${fN(data.page||1)} من ${fN(data.pages||1)} — ${fN(data.total||0)} فاتورة</span>
<button class="btn btn-sm" ${data.page>=data.pages?'disabled':''} data-karim-action="kdGenerateReport41" data-karim-arg0="${(data.page||1)+1}">التالي</button>
</div>`;
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=receipt></i> فواتير الكاشيرية (الأحدث أولًا — اضغط رقم الفاتورة للتفصيل)</h3>
<table class="report-table">
<thead><tr><th>رقم الفاتورة</th><th>اليوم</th><th>الكاشير</th><th>الوردية</th><th>الأصناف</th><th>الإجمالي</th><th>الخصم</th><th>الصافي</th><th>المدفوع</th></tr></thead>
<tbody>
${rows.length?rows.map(r=>`<tr>
<td><a href="#" data-karim-action="ysCashierInvoiceDetail" data-karim-arg0="${esc(r.doc_no)}" data-karim-prevent class="mono"><strong>${esc(r.doc_no)}</strong></a></td>
<td>${esc(r.day||'—')}</td>
<td>${esc(r.cashier_name||'—')}</td>
<td>${esc(r.shift??'—')}</td>
<td>${fN(r.lines||0)}</td>
<td class="amount-cell">${fC(r.total||0)}</td>
<td class="amount-cell c-red">${fC(r.discount||0)}</td>
<td class="amount-cell amount-gold"><strong>${fC(r.net||0)}</strong></td>
<td class="amount-cell c-green">${fC(r.paid||0)}</td>
</tr>`).join(''):`<tr><td colspan="9" class="u-empty-sm">لا توجد فواتير ضمن الفترة</td></tr>`}
</tbody>
</table>
${pg}
</div>`;
}
return `
<div class="report-header">
<div class="report-logo">${logoMarkup('report-logo-image')}</div>
<h1>${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</h1>
<div class="subtitle">مبيعات الكاشيرية — حي من قاعدة الكاشير</div>
<div class="meta">
<span><i class=ji data-i=calendar></i> الفترة: <strong>${periodLabel}</strong></span>
<span><i class=ji data-i=calendar-days></i> من: <strong>${fD(startDate)}</strong></span>
<span><i class=ji data-i=calendar-days></i> إلى: <strong>${fD(endDate)}</strong></span>
<span><i class=ji data-i=clock></i> تاريخ الإصدار: <strong>${generatedAt}</strong></span>
</div>
</div>
<div class="report-filter-bar no-print" style="margin-bottom:12px">
<div class="fg"><label>الكاشير</label><select id="yCashierSel" data-karim-action="kdGenerateReport43" data-karim-event="change" data-karim-pass="value">${cashierOpts}</select></div>
<div class="fg"><label>العرض</label><select id="yCashierView" data-karim-action="kdGenerateReport45" data-karim-event="change" data-karim-pass="value">
<option value="items" ${YCASH.view==='items'?'selected':''}>الأصناف المباعة</option>
<option value="invoices" ${YCASH.view==='invoices'?'selected':''}>الفواتير</option>
</select></div>
</div>
<div class="report-summary-grid">
<div class="report-summary-card"><h4><i class=ji data-i=banknote></i> صافي المبيعات</h4><div class="value c-gold">${fC(t.net||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=receipt></i> عدد الفواتير</h4><div class="value c-blue">${fN(t.invoices||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=tag></i> الخصومات</h4><div class="value c-red">${fC(t.discount||0)}</div></div>
<div class="report-summary-card"><h4><i class=ji data-i=users></i> الكاشيرية النشطة</h4><div class="value c-teal">${fN(cashiers.length)}</div></div>
</div>
<div class="report-section">
<h3><i class=ji data-i=user></i> ملخص الكاشيرية</h3>
<table class="report-table">
<thead><tr><th>الكاشير</th><th>الفواتير</th><th>الصافي</th><th>الخصم</th><th>متوسط الفاتورة</th></tr></thead>
<tbody>
${cashiers.length?cashiers.map(c=>`<tr>
<td><strong>${esc(c.name)}</strong></td>
<td>${fN(c.invoices||0)}</td>
<td class="amount-cell amount-gold"><strong>${fC(c.net||0)}</strong></td>
<td class="amount-cell c-red">${fC(c.discount||0)}</td>
<td class="amount-cell c-blue">${fC(c.invoices?c.net/c.invoices:0)}</td>
</tr>`).join(''):`<tr><td colspan="5" class="u-empty-sm">لا توجد مبيعات كاشيرية ضمن الفترة</td></tr>`}
</tbody>
</table>
</div>
${tableHtml}
<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=shopping-cart></i> المصدر: قاعدة مبيعات الكاشيرية — الكاشير 2 الداخلي مستثنى</div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${generatedAt} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
}
async function ysCashierInvoiceDetail(docNo){
try{
const data=await apiFetch('/yarasoft/sections/invoice-detail?ref='+encodeURIComponent('ora:CC:'+docNo));
const lines=Array.isArray(data.lines)?data.lines:[];
const h=data.header||{};
showModal(`<h3><i class=ji data-i=receipt></i> فاتورة كاشير #${esc(docNo)}</h3>
<div class="workflow-banner">الكاشير: <strong>${esc('كاشير '+(h.CSHR||'').trim())}</strong> — الصافي: <strong>${fC(h.NET_VAL||0)}</strong> — الخصم: ${fC(h.DSCNT_VL||0)} — الوردية: ${esc(h.SHFT_NO??'—')}</div>
<table class="report-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>الضريبة</th></tr></thead><tbody>
${lines.length?lines.map(l=>`<tr><td><strong>${esc(l.name||'—')}</strong><br><small class="ltr-inline">${esc(l.code||'')}</small></td><td>${fN(l.qty||0)} ${esc(l.unit||'')}</td><td class="amount-cell">${fC(l.price||0)}</td><td class="amount-cell amount-gold">${fC(l.total||0)}</td><td class="amount-cell c-orange">${fC(l.vat||0)}</td></tr>`).join(''):'<tr><td colspan="5" class="u-empty-sm">بلا أصناف مسجلة</td></tr>'}
</tbody></table>
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);
}catch(e){ toast(e.message||'تعذر جلب تفاصيل الفاتورة','error'); }
}
function printReportOnly(){
const reportContent=document.getElementById('reportContent');
if(!reportContent||!reportContent.innerHTML.trim()){ toast('يرجى إنشاء التقرير أولاً','warning'); return; }
const printWindow=(window.openInAppReport ? window.openInAppReport('تقرير') : window.open('', '_blank'));
const reportHTML=reportContent.innerHTML;
printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير - ${STATE.settings?.name || 'مطاعم الشرفه العالمي'}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Cairo','Tajawal',sans-serif;background:white;color:#000;direction:rtl;padding:10px;font-size:9pt;line-height:1.45}.report-header{text-align:center;padding:16px 12px;margin-bottom:14px;border-bottom:2px double #000}.report-header h1{font-size:18pt;color:#d4a843;margin-bottom:4px;font-weight:800}.report-header .subtitle{font-size:10pt;color:#333;margin-bottom:4px;font-weight:600}.report-header .meta{display:flex;justify-content:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid #ddd;font-size:8pt;color:#555;flex-wrap:wrap}.report-logo{width:44px;height:44px;margin:0 auto 8px;border-radius:10px;border:1px solid #d4a843;display:flex;align-items:center;justify-content:center;font-size:22px;overflow:hidden}.report-logo img{width:100%;height:100%;object-fit:cover}.report-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px}.report-summary-card{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center;border-top:2px solid #d4a843;break-inside:avoid}.report-summary-card h4{font-size:7.5pt;color:#555;text-transform:uppercase;margin-bottom:4px;font-weight:700}.report-summary-card .value{font-size:13pt;font-weight:800;color:#000}.report-section{margin:14px 0;break-inside:avoid}.report-section h3{font-size:11pt;font-weight:800;color:#d4a843;margin-bottom:7px;padding-bottom:4px;border-bottom:1px solid #d4a843}.report-table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:8.5pt;line-height:1.3}.report-table th{background:#f0f0f0;color:#000;font-weight:800;padding:5px 6px;text-align:right;border:1px solid #000;font-size:8pt}.report-table td{padding:5px 6px;border:1px solid #ddd;color:#000}.report-table tbody tr:nth-child(even){background:#f9f9f9}.report-table tfoot td{background:#e0e0e0;font-weight:800;color:#000;border:1px solid #000;padding:6px 8px;font-size:9pt}.report-footer{margin-top:12px;padding:8px;background:#f9f9f9;border-radius:6px;text-align:center;font-size:7.5pt;color:#555;border:1px solid #ddd}svg.ji,i.ji{width:14px!important;height:14px!important;display:inline-block;vertical-align:-0.2em;flex:none}.report-summary-card svg.ji,.report-section h3 svg.ji,.report-table th svg.ji,.report-table td svg.ji{width:12px!important;height:12px!important}.c-gold,.amount-gold{color:#d4a843!important}.c-red,.amount-red{color:#e74c3c!important}.c-green,.amount-green{color:#2ecc71!important}.c-orange{color:#f39c12!important}.c-blue{color:#3498db!important}.c-teal{color:#1abc9c!important}.badge{display:inline-block;padding:2px 8px;border-radius:15px;font-size:8pt;font-weight:700;border:1px solid}.bdg-green{background:rgba(46,204,113,0.1);color:#2ecc71;border-color:rgba(46,204,113,0.3)}.bdg-red{background:rgba(231,76,60,0.1);color:#e74c3c;border-color:rgba(231,76,60,0.3)}.fw-bold{font-weight:700}.print-controls{text-align:center;margin-bottom:20px;padding:15px;background:#f0f0f0;border-radius:8px}.print-controls button{padding:10px 25px;margin:0 10px;border:none;border-radius:6px;font-size:12pt;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif}.btn-print{background:#2ecc71;color:white}.btn-close{background:#e74c3c;color:white}@media print{@page{size:A4;margin:1cm}body{padding:0}.print-controls{display:none!important}}</style></head><body><div class="print-controls"><button class="btn-print" data-karim-action="print"><i class=ji data-i=printer></i> طباعة التقرير</button><button class="btn-close" data-karim-action="closeWindow"><i class=ji data-i=circle-x></i> إغلاق</button></div>${reportHTML}</body></html>`);
printWindow.document.close();
setTimeout(()=>{ printWindow.focus(); },500);
}
/* ─── إجراءات مولَّدة (تفويض بدل معالجات سطرية) ─── */
function kdGenerateReport(p0) {
    YCASH.page = p0;
    generateReport();
}

function kdGenerateReport41(p0) {
    YCASH.page = p0;
    generateReport();
}

function kdGenerateReport43(p0) {
    YCASH.cashier = p0;
    YCASH.page = 1;
    generateReport();
}

function kdGenerateReport45(p0) {
    YCASH.view = p0;
    YCASH.page = 1;
    generateReport();
}


export {renderReports, updateDateInputs, getDateRange, generateReport, generatePosSalesReport, renderPosPaymentSummary, renderPosSalesReportHtml, formatRevenueNote, generateGeneralReport, generateDepartmentReport, generateKitchenReport, generateReturnsReport, generateWarehouseReport, generateHRReport, generateSpecificDeptReport, generateYaraDeptReport, YCASH, generateYaraCashiersReport, renderYaraCashiersHtml, ysCashierInvoiceDetail, printReportOnly, kdGenerateReport, kdGenerateReport41, kdGenerateReport43, kdGenerateReport45 };;
