/**
 * features/page-router.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// MODAL & RENDER PAGE
// ============================================
function showModal(content,extraClass=''){
let modalDiv=document.getElementById('modals');
if(!modalDiv){ modalDiv=document.createElement('div'); modalDiv.id='modals'; document.body.appendChild(modalDiv); }
modalDiv.innerHTML=`<div class="overlay open"><div class="modal ${extraClass}">${content}</div></div>`;
const overlay=modalDiv.querySelector('.overlay');
overlay.addEventListener('click',(e)=>{ if(e.target===overlay) {closeModal();} });
}
function closeModal(){
const modalDiv=document.getElementById('modals');
if(modalDiv) {modalDiv.innerHTML='';}
}
async function renderPage(){
const content=document.getElementById('content');
if(!content){return;}
// إصلاح 2026-10-01 (صفحة بيضاء من الجوال): أي استثناء أثناء الرسم كان يترك
// المحتوى بشفافية صفر — الآن شبكة أمان تعرض رسالة بدل البياض وتعيد الظهور
try{
content.style.opacity='0'; destroyCharts();
let html='';
switch(STATE.page){
case 'dashboard': html=renderDashboard(); break;
case 'revenues': html=renderRevenues(); break;
case 'expenses': html=renderExpenses(); break;
case 'cost-analysis': html=renderCostAnalysis(); break;
case 'pnl': html=renderPnl(); break;
case 'departments': html=renderDepartments(); break;
case 'departmentDetail': html=renderDepartmentDetail(); break;
case 'warehouse': html=renderWarehouse(); break;
case 'wh-invoices': html=renderWhInvoices(); break;
case 'wh-moves': html=renderWhMoves(); break;
case 'wh-returns': html=renderWhReturns(); break;
case 'wh-prs': html=renderWhPrs(); break;
case 'procurement': html=renderProcurement(); break;
case 'roster': html=(typeof renderRoster==='function')?renderRoster():'<div class="mcard u-empty">تعذر تحميل وحدة الدوامات — حدّث الصفحة (Ctrl+F5)</div>'; break;
case 'dept-employees': html=(typeof renderDeptEmployeesPage==='function')?renderDeptEmployeesPage():'<div class="mcard u-empty">تعذر تحميل وحدة موظفي القسم — حدّث الصفحة (Ctrl+F5)</div>'; break;
case 'shelves': html=renderShelves(); break;
case 'weight': html=renderWeight(); break;
case 'dispatch': html=renderDispatch(); break;
case 'kitchen': html=renderKitchen(); break;
case 'recipes': html=renderRecipes(); break;
case 'reports': html=renderReports(); break;
case 'settings': html=renderSettings(); break;
case 'users': html=renderUsers(); break;
case 'permissions': html=renderPermissionsPage(); break;
case 'hr-dashboard': html=renderHRDashboard(); break;
case 'employees': renderEmployeesPage(); setTimeout(()=>{content.style.opacity='1';},30); return;
case 'leaves': html=renderLeavesPage(); break;
case 'attendance': html=renderAttendance(); if(STATE.attGapsAuto){ STATE.attGapsAuto=false; setTimeout(()=>{ const b=document.getElementById('attGapsBox'); if(b&&!b.innerHTML) {attGapsToggle();} },200); } break;
case 'zkteco':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderZktecoPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'yarasoft':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderYarasoftPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'yara-daily-locks':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderDailyLocksPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'oracle-data':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderOracleDataPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'whatsapp':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderWhatsappPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'employee-portal':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderEmployeePortal();
setTimeout(()=>{content.style.opacity='1';},30);
return;
case 'hr-departments': html=renderHRDepartmentsPage(); break;
case 'payroll': html=renderPayroll(); break;
case 'cfo':
content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
await renderCfoPage();
setTimeout(()=>{content.style.opacity='1';},30);
return;
default: html=renderDashboard();
}
content.innerHTML=html;
// Smart Card for employee portal
if(STATE.page==='employee-portal' || (STATE.page==='dashboard' && STATE.currentUser?.role==='employee')){
const emp = STATE.currentUser.role==='employee' ?
STATE.employees.find(e=>e.userId===STATE.currentUser.id) :
STATE.employees[0];
if(emp){
const cardContainer = document.getElementById('smartCardContainer');
if(cardContainer){
const canUpload = ['admin','hr','manager'].includes(STATE.currentUser?.role) || emp.userId===STATE.currentUser?.id;
cardContainer.innerHTML = await renderSmartCard(emp, { canUpload });
}
}
}
if(STATE.page==='attendance' && !['admin','hr','manager'].includes(STATE.currentUser?.role)){
const emp = STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(emp){
const cardContainer = document.getElementById('smartCardContainer');
if(cardContainer){
cardContainer.innerHTML = await renderSmartCard(emp, { canUpload: false });
}
}
}
setTimeout(()=>{content.style.opacity='1';},30);
if(STATE.page==='dashboard' && STATE.currentUser?.role!=='employee') {setTimeout(initDashboardCharts,80);}
if(STATE.page==='pnl') {setTimeout(pnlInitCharts,120);}
if(STATE.page==='reports'){
setTimeout(()=>{
if(STATE.page!=='reports') {return;}
try{ updateDateInputs(); }catch(e){ console.warn('[reports] updateDateInputs:', e.message); }
try{ generateReport(); }catch(e){ console.warn('[reports] generateReport:', e.message); }
},100);
}
}catch(pageErr){
console.error('[renderPage]', STATE.page, pageErr);
try{
content.innerHTML=`<div class="mcard" style="text-align:center;padding:40px 20px"><div style="font-size:44px;margin-bottom:12px">⚠️</div><h3>تعذر عرض الصفحة</h3><p class="text-muted">${String(pageErr.message||'خطأ غير متوقع')}</p><button class="btn btn-gold" onclick="renderPage()">إعادة المحاولة</button></div>`;
content.style.opacity='1';
}catch(_){}
}
}
// PWA — تثبيت + شريط عدم الاتصال: نُقل إلى js/core/pwa.js (يجسر عبر js/main.js — BRIDGE-001)


export { showModal, closeModal, renderPage };
