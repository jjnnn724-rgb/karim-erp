/**
 * features/dashboard.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// DASHBOARD
// ============================================
let dashboardChartDays = 30;
let dashboardChartDept = 'all';
function dashboardDateKey(value){ const d=new Date(value); return Number.isNaN(d.getTime())?'':d.toISOString().slice(0,10); }
function dashboardFilteredRows(){
 const cutoff=dashboardChartDays==='all'?null:new Date(Date.now()-Number(dashboardChartDays)*86400000);
 const deptOk=e=>dashboardChartDept==='all'||String(e.deptId)===String(dashboardChartDept);
 const rev=STATE.revenues.filter(r=>deptOk(r)).filter(r=>!cutoff||new Date(r.date)>=cutoff);
 const exp=STATE.expenses.filter(e=>deptOk(e)&&isOperatingExpense(e)).filter(e=>!cutoff||new Date(e.date)>=cutoff);
 const expAll=STATE.expenses.filter(e=>deptOk(e)).filter(e=>!cutoff||new Date(e.date)>=cutoff);
 return {rev,exp,expAll};
}
function renderDashboardAnalytics(){
 const deptOptions=STATE.departments.map(d=>`<option value="${esc(d.code)}" ${dashboardChartDept===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
 return `<section class="dashboard-analytics" style="margin-top:30px"><div class="section-header"><div><div class="section-title"><i class=ji data-i=chart></i> التحليلات التفاعلية</div><div class="text-muted" style="font-size:12px;margin-top:4px">بيانات مباشرة من النظام — اضغط على عناصر الرسم للتفاصيل</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><select id="dashboardChartDays" class="form-control" data-karim-action="kdRenderPage" data-karim-event="change" data-karim-pass="value"><option value="7" ${dashboardChartDays==='7'?'selected':''}>آخر 7 أيام</option><option value="30" ${String(dashboardChartDays)==='30'?'selected':''}>آخر 30 يومًا</option><option value="90" ${String(dashboardChartDays)==='90'?'selected':''}>آخر 90 يومًا</option><option value="all" ${dashboardChartDays==='all'?'selected':''}>كل الفترة</option></select><select id="dashboardChartDept" class="form-control" data-karim-action="kdRenderPage7" data-karim-event="change" data-karim-pass="value"><option value="all">كل الأقسام</option>${deptOptions}</select></div></div><div class="dashboard-chart-grid"><div class="mcard chart-panel"><div class="chart-panel-title">الإيرادات والمصروفات حسب القسم</div><div class="chart-canvas-wrap"><canvas id="dashboardDeptChart"></canvas></div></div><div class="mcard chart-panel"><div class="chart-panel-title">اتجاه الإيرادات والنتيجة</div><div class="chart-canvas-wrap"><canvas id="dashboardTrendChart"></canvas></div></div><div class="mcard chart-panel"><div class="chart-panel-title">توزيع المصروفات التشغيلية</div><div class="chart-canvas-wrap chart-doughnut"><canvas id="dashboardExpenseChart"></canvas></div></div></div></section>`;
}
function initDashboardCharts(){
 if(STATE.page!=='dashboard'||typeof Chart==='undefined') {return;}
 // لوحات بلا رسوم بيانية (لوحة رئيس القسم مثلًا) — لا تنشئ رسمًا على كانفس غير موجود
 if(!document.getElementById('dashboardDeptChart')) {return;}
 // ROOT FIX (2026-09-30): تهيئة مكررة (تنقل سريع) كانت تسقط بـ
 // "Canvas is already in use" — دمّر أي نسخة سابقة على نفس الكانفس أولًا.
 try {
   for (const id of ['dashboardDeptChart', 'dashboardTrendChart', 'dashboardExpenseChart']) {
     const cv = document.getElementById(id);
     if (cv && typeof Chart.getChart === 'function') { Chart.getChart(cv)?.destroy(); }
   }
 } catch (_) {}
 const {rev,exp,expAll}=dashboardFilteredRows();
 const css=getComputedStyle(document.documentElement), text=css.getPropertyValue('--text').trim()||'#263238', grid=css.getPropertyValue('--border').trim()||'#e5e7eb';
 const money=v=>Number(v||0).toLocaleString('ar-SA',{maximumFractionDigits:2});
 const common={responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{color:text,font:{family:'Cairo'}}},tooltip:{rtl:true,callbacks:{label:ctx=>` ${ctx.dataset.label||''}: ${money(ctx.parsed.y??ctx.parsed)} ${STATE.settings.currency}`}}},scales:{x:{ticks:{color:text,font:{family:'Cairo'}},grid:{color:grid}},y:{beginAtZero:true,ticks:{color:text,callback:v=>money(v)},grid:{color:grid}}}};
 const depts=STATE.departments.filter(d=>dashboardChartDept==='all'||String(d.code)===String(dashboardChartDept));
 const revBy=d=>rev.filter(r=>String(r.deptId)===String(d.code)).reduce((s,r)=>s+Number(r.amount||0),0); const expBy=d=>expAll.filter(e=>String(e.deptId)===String(d.code)).reduce((s,e)=>s+Number(e.amount||0),0);
 STATE.charts.dashboardDept=new Chart(document.getElementById('dashboardDeptChart'),{type:'bar',data:{labels:depts.map(d=>d.name),datasets:[{label:'الإيرادات',data:depts.map(revBy),backgroundColor:'#b8862d',borderRadius:6},{label:'التكلفة الإجمالية (شاملة الصرف)',data:depts.map(expBy),backgroundColor:'#d9776a',borderRadius:6}]},options:{...common,onClick:(_,els)=>{if(els.length){go('departments');}}}});
 const keys=[...new Set([...rev.map(r=>dashboardDateKey(r.date)),...exp.map(e=>dashboardDateKey(e.date))])].filter(Boolean).sort(); const labels=keys.length?keys:['لا توجد بيانات']; const revTrend=keys.map(k=>rev.filter(r=>dashboardDateKey(r.date)===k).reduce((s,r)=>s+Number(r.amount||0),0)); const expTrend=keys.map(k=>exp.filter(e=>dashboardDateKey(e.date)===k).reduce((s,e)=>s+Number(e.amount||0),0));
 STATE.charts.dashboardTrend=new Chart(document.getElementById('dashboardTrendChart'),{type:'line',data:{labels,datasets:[{label:'الإيرادات',data:revTrend,borderColor:'#2f9e72',backgroundColor:'#2f9e7222',fill:true,tension:.35},{label:'النتيجة التشغيلية',data:revTrend.map((v,i)=>v-expTrend[i]),borderColor:'#b8862d',backgroundColor:'#b8862d22',fill:false,tension:.35}]},options:common});
 const cats={}; exp.forEach(e=>{const c=e.category||'أخرى';cats[c]=(cats[c]||0)+Number(e.amount||0);}); const catKeys=Object.keys(cats); STATE.charts.dashboardExpense=new Chart(document.getElementById('dashboardExpenseChart'),{type:'doughnut',data:{labels:catKeys.length?catKeys:['لا توجد مصروفات تشغيلية'],datasets:[{data:catKeys.length?catKeys.map(k=>cats[k]):[1],backgroundColor:['#b8862d','#2f9e72','#5b8def','#d9776a','#8b6fc1','#94a3b8'],borderWidth:2,borderColor:css.getPropertyValue('--bg').trim()||'#fff'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',rtl:true,labels:{color:text,font:{family:'Cairo'}}},tooltip:{rtl:true,callbacks:{label:ctx=>catKeys.length?` ${ctx.label}: ${money(ctx.parsed)} ${STATE.settings.currency}`:' لا توجد مصروفات تشغيلية'}}}}});
}
// ─── علامة واضحة: هل البصمة مربوطة ومتصلة؟ (تظهر في لوحة التحكم) ───
async function loadZkDashboardStatus(){
const el=document.getElementById('zkDashStatus'); if(!el) {return;}
try{
const st=await apiFetch('/zkteco/status');
const devices=(st&&st.devices)||[];
const online=devices.filter(x=>x.status==='online').length;
const t=(st&&st.totals)||{};
let stateTxt,stateCls;
if(!devices.length){ stateTxt='لا يوجد جهاز بصمة مسجل'; stateCls='var(--orange)'; }
else if(!st.running){ stateTxt='محرك مزامنة البصمة متوقف'; stateCls='var(--red)'; }
else if(online>0){ stateTxt='البصمة مربوطة ومتصلة'; stateCls='var(--green)'; }
else { stateTxt='البصمة مسجلة لكن غير متصلة'; stateCls='var(--red)'; }
const dot=`<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${stateCls};box-shadow:0 0 8px ${stateCls}"></span>`;
const unlinked=t.unlinkedEmployees?` · <b style="color:var(--orange)">${fN(t.unlinkedEmployees)} موظف غير مربوط</b>`:' · كل الموظفين مربوطون';
el.innerHTML=`
<div class="mini-chart-header"><div><div class="u-sub-strong">بصمة الحضور — علامة الربط</div></div><div class="kpi-chip"><i class=ji data-i=user-check></i></div></div>
<div style="font-size:17px;font-weight:800;color:${stateCls};display:flex;align-items:center;gap:8px">${dot} ${stateTxt}</div>
<div class="u-sub">أجهزة متصلة: ${fN(online)}/${fN(devices.length)} · موظفون مربوطون: ${fN(t.linkedEmployees||0)}${unlinked}</div>`;
}catch(_){
el.innerHTML=`<div class="mini-chart-header"><div><div class="u-sub-strong">بصمة الحضور — علامة الربط</div></div><div class="kpi-chip"><i class=ji data-i=user-check></i></div></div><div class="u-sub" style="color:var(--orange)">تعذر جلب حالة البصمة — راجع صفحة بصمة الحضور</div>`;
}
}
// ─── لوحات تحكم حسب الدور (طلب المالك 2026-10-03): كل دور يشوف لوحته ───
function renderAccountantDashboard(){
const today=new Date();
const startOfMonth=new Date(today.getFullYear(),today.getMonth(),1);
const mRev=STATE.revenues.filter(r=>new Date(r.date)>=startOfMonth).reduce((s,r)=>s+Number(r.amount||0),0);
const mExp=STATE.expenses.filter(e=>new Date(e.date)>=startOfMonth).reduce((s,e)=>s+Number(e.amount||0),0);
const net=mRev-mExp;
const revRows=[...STATE.revenues].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6).map(r=>`<tr><td class="fw-bold">${esc(r.source||r.name||'—')}</td><td class="text-muted">${esc(String(r.date||'').slice(0,10))}</td><td class="c-green">${fC(r.amount)}</td></tr>`).join('');
const expRows=[...STATE.expenses].sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,6).map(e=>`<tr><td class="fw-bold">${esc(e.category||e.name||'—')}</td><td class="text-muted">${esc(String(e.date||'').slice(0,10))}</td><td class="c-red">${fC(e.amount)}</td></tr>`).join('');
return `
<div class="section-header"><div class="section-title"><i class=ji data-i=calculator></i> لوحة المدير المالي</div></div>
<div class="stats-grid-premium kpi-grid-4">
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;revenues&quot;]"><div class="kpi-top"><span class="kpi-label">إيرادات الشهر</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(mRev)}</div><div class="trend">${fN(STATE.revenues.length)} عملية مسجلة</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;expenses&quot;]"><div class="kpi-top"><span class="kpi-label">مصاريف الشهر</span><span class="kpi-chip"><i class=ji data-i=wallet></i></span></div><div class="value">${fC(mExp)}</div><div class="trend">${fN(STATE.expenses.length)} عملية مسجلة</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;pnl&quot;]"><div class="kpi-top"><span class="kpi-label">الصافي</span><span class="kpi-chip"><i class=ji data-i=gem></i></span></div><div class="value ${net<0?'c-red':''}">${fC(net)}</div><div class="trend">إيرادات − مصاريف</div></div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;reports&quot;]"><div class="kpi-top"><span class="kpi-label">التقارير</span><span class="kpi-chip"><i class=ji data-i=chart></i></span></div><div class="value">فتح</div><div class="trend">تقارير مالية مفصلة</div></div>
</div>
<div class="fr" style="gap:12px;margin-top:14px">
<div class="fg"><div class="tbl-hd" style="padding:8px 4px"><h3>أحدث الإيرادات</h3><button class="btn btn-blue btn-sm" data-karim-action="go" data-karim-args="[&quot;revenues&quot;]">الكل</button></div><table style="width:100%;font-size:12px"><tbody>${revRows||'<tr><td class="u-empty-sm">لا إيرادات بعد</td></tr>'}</tbody></table></div>
<div class="fg"><div class="tbl-hd" style="padding:8px 4px"><h3>أحدث المصاريف</h3><button class="btn btn-blue btn-sm" data-karim-action="go" data-karim-args="[&quot;expenses&quot;]">الكل</button></div><table style="width:100%;font-size:12px"><tbody>${expRows||'<tr><td class="u-empty-sm">لا مصاريف بعد</td></tr>'}</tbody></table></div>
</div>`;
}
function renderHRDashboard(){
const d=new Date().toISOString().split('T')[0];
const totalEmp=STATE.employees.filter(e=>e.status==='active').length;
const presentToday=STATE.attendance.filter(a=>a.date===d&&a.checkIn).length;
const pendingLeaves=STATE.leaveRequests.filter(l=>l.status==='pending');
const leaveRows=pendingLeaves.slice(0,6).map(l=>{const e=STATE.employees.find(x=>String(x.id)===String(l.employeeId));return `<tr><td class="fw-bold">${esc(e?e.name:'—')}</td><td class="text-muted">${esc(String(l.startDate||'').slice(0,10))} → ${esc(String(l.endDate||'').slice(0,10))}</td><td><span class="badge bdg-orange">معلق</span></td></tr>`;}).join('');
return `
<div class="section-header"><div class="section-title"><i class=ji data-i=users></i> لوحة الموارد البشرية</div></div>
<div class="stats-grid-premium kpi-grid-4">
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;employees&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">الموظفون النشطون</div></div><div class="kpi-chip"><i class=ji data-i=users></i></div></div><div class="u-panel-title">${fN(totalEmp)}</div><div class="u-sub">في النظام</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;attendance&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">الحاضرون اليوم</div></div><div class="kpi-chip"><i class=ji data-i=circle-check></i></div></div><div class="u-panel-title">${fN(presentToday)}</div><div class="u-sub">من ${fN(totalEmp)}</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;leaves&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">إجازات معلقة</div></div><div class="kpi-chip"><i class=ji data-i=hourglass></i></div></div><div style="font-size:22px;font-weight:700;color:${pendingLeaves.length>0?'var(--orange)':'var(--text)'}">${fN(pendingLeaves.length)}</div><div class="u-sub">بانتظار اعتماد</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;roster&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">دوامات</div></div><div class="kpi-chip"><i class=ji data-i=calendar-clock></i></div></div><div class="u-panel-title">فتح</div><div class="u-sub">جدول الدوامات</div></div>
</div>
<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3>طلبات إجازة بانتظار الاعتماد</h3><button class="btn btn-gold btn-sm" data-karim-action="go" data-karim-args="[&quot;leaves&quot;]">إدارة الإجازات</button></div>
<table style="width:100%"><thead><tr><th>الموظف</th><th>الفترة</th><th>الحالة</th></tr></thead><tbody>${leaveRows||'<tr><td colspan=3 style="text-align:center;padding:20px;color:var(--faint)">لا طلبات معلقة</td></tr>'}</tbody></table></div>`;
}
function renderWarehouseDashboard(){
const d=new Date().toISOString().split('T')[0];
const lowStock=STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty)).length;
const outStock=STATE.inventory.filter(i=>Number(i.qty)<=0).length;
const pendingDisp=STATE.dispatches.filter(x=>x.status==='pending').length;
const pendingPR=(STATE.purchaseRequests||[]).filter(x=>x.status==='pending').length;
const movesToday=(STATE.inventoryTx||[]).filter(x=>String(x.date||x.createdAt||'').slice(0,10)===d).length;
const lowRows=STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty)).slice(0,6).map(i=>`<tr><td class="fw-bold">${esc(i.name)}</td><td class="c-red">${fN(i.qty)}</td><td class="text-muted">${fN(i.minQty)}</td></tr>`).join('');
return `
<div class="section-header"><div class="section-title"><i class=ji data-i=package></i> لوحة المخزن</div></div>
<div class="stats-grid-premium kpi-grid-4">
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;warehouse&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">أصناف تحت الحد</div></div><div class="kpi-chip"><i class=ji data-i=alert-triangle></i></div></div><div style="font-size:22px;font-weight:700;color:${lowStock>0?'var(--red)':'var(--text)'}">${fN(lowStock)}</div><div class="u-sub">نافذ: ${fN(outStock)}</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">طلبات صرف معلقة</div></div><div class="kpi-chip"><i class=ji data-i=clipboard-list></i></div></div><div style="font-size:22px;font-weight:700;color:${pendingDisp>0?'var(--orange)':'var(--text)'}">${fN(pendingDisp)}</div><div class="u-sub">بانتظار الإجراء</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;wh-prs&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">طلبات شراء</div></div><div class="kpi-chip"><i class=ji data-i=shopping-cart></i></div></div><div style="font-size:22px;font-weight:700;color:${pendingPR>0?'var(--orange)':'var(--text)'}">${fN(pendingPR)}</div><div class="u-sub">معلقة</div></div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;wh-moves&quot;]"><div class="mini-chart-header"><div><div class="u-sub-strong">حركات اليوم</div></div><div class="kpi-chip"><i class=ji data-i=chart></i></div></div><div class="u-panel-title">${fN(movesToday)}</div><div class="u-sub">دخول/خروج اليوم</div></div>
</div>
<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3>أكثر الأصناف نقصًا</h3><button class="btn btn-gold btn-sm" data-karim-action="go" data-karim-args="[&quot;warehouse&quot;]">المخزن</button></div>
<table style="width:100%"><thead><tr><th>الصنف</th><th>الكمية</th><th>الحد الأدنى</th></tr></thead><tbody>${lowRows||'<tr><td colspan=3 style="text-align:center;padding:20px;color:var(--faint)">المخزون في الحدود الآمنة</td></tr>'}</tbody></table></div>`;
}
function renderDashboard(){
const role = STATE.currentUser?.role;
if(role==='employee'){ return renderEmployeeDashboard(); }
if(role==='dept_head'){ return renderDeptHeadDashboard(); }
if(role==='accountant'){ return renderAccountantDashboard(); }
if(role==='warehouse'){ return renderWarehouseDashboard(); }
if(role==='hr'){ return renderHRDashboard(); }
let totalRev=0,totalExp=0;
const deptStats = STATE.departments.map(d=>{const s=calcStats(d.code);totalRev+=s.rev;totalExp+=s.exp;return{...d,...s};});
const profit = totalRev-totalExp;
const pendingDisp = STATE.dispatches.filter(d=>d.status==='pending').length;
const lowStock = STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty)).length;
const today = new Date();
const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const monthlyRev = STATE.revenues.filter(r=>new Date(r.date)>=startOfMonth).reduce((s,r)=>s+Number(r.amount||0),0);
const monthlyExp = STATE.expenses.filter(e=>new Date(e.date)>=startOfMonth && Number(e.amount||0)>0).reduce((s,e)=>s+Number(e.amount||0),0);
// بطاقات الشهر أولًا (طلب المالك 2026-10-08): القيمة الأساسية = الشهر الحالي، والسطر الفرعي = الإجمالي الكلي
const monthlyProfit = monthlyRev - monthlyExp;
const monthlyRatio = monthlyRev>0?(monthlyExp/monthlyRev*100):0;
const profitTrend = totalRev>0 ? Math.round(((profit/totalRev)*100)*10)/10 : 0;

let html = '';

html += renderExpiryAlertBanner();

// ── Financial KPIs — fixed 4-column rhythm, neutral chips, semantic color only ──
if(role!=='hr'){
html += `
<div class="stats-grid-premium kpi-grid-4">
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;revenues&quot;]" data-tooltip="اضغط لعرض الإيرادات" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiRev')}">
    <div class="kpi-top"><span class="kpi-label">${t('db.kpiRev')} — الشهر</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div>
    <div class="value">${fC(monthlyRev)}</div>
    <div class="trend"><i class=ji data-i=calendar></i> الإجمالي: ${fC(totalRev)}</div>
  </div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;expenses&quot;]" data-tooltip="اضغط لعرض المصاريف" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiExp')}">
    <div class="kpi-top"><span class="kpi-label">تكلفة الشهر</span><span class="kpi-chip"><i class=ji data-i=wallet></i></span></div>
    <div class="value">${fC(monthlyExp)}</div>
    <div class="trend"><i class=ji data-i=calendar></i> الإجمالي: ${fC(totalExp)}</div>
  </div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;pnl&quot;]" data-tooltip="اضغط لعرض قائمة الأرباح والخسائر" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiProfit')}">
    <div class="kpi-top"><span class="kpi-label">صافي الشهر</span><span class="kpi-chip"><i class=ji data-i=gem></i></span></div>
    <div class="value ${monthlyProfit<0?'c-red':''}">${fC(monthlyProfit)}</div>
    <div class="trend ${profitTrend>=0?'trend-up':'trend-down'}">${profitTrend>=0?'<i class=ji data-i=trending-up></i>':'<i class=ji data-i=trending-down></i>'} ${t('db.margin')} ${fN(profitTrend)}%</div>
  </div>
  <div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;cost-analysis&quot;]" data-tooltip="اضغط لعرض تحليل التكاليف" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiCost')}">
    <div class="kpi-top"><span class="kpi-label">نسبة تكلفة الشهر</span><span class="kpi-chip"><i class=ji data-i=chart></i></span></div>
    <div class="value">${fN(monthlyRatio.toFixed(1))}%</div>
    <div class="progress-premium ${monthlyRatio<=65?'is-ok':monthlyRatio<=85?'is-warn':'is-bad'}" style="margin-top:10px"><div class="progress-premium-bar" style="width:${Math.min(monthlyRatio,100)}%"></div></div>
  </div>
</div>`;
}

// ── Operations KPIs — same grid rhythm, one neutral chip style ──
html += `<div class="stats-grid-premium kpi-grid-4">`;
if(role==='hr' || role==='admin'){
const totalEmp = STATE.employees.filter(e=>e.status==='active').length;
const presentToday = STATE.attendance.filter(a=>a.date===new Date().toISOString().split('T')[0]&&a.checkIn).length;
const pendingLeaves = STATE.leaveRequests.filter(l=>l.status==='pending').length;
const totalSalaries = STATE.employees.reduce((s,e)=>s+(e.salary||0),0);
html += `
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;employees&quot;]" role="button" tabindex="0" data-kb-activate aria-label="${t('db.totalEmp')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.totalEmp')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=users></i></div>
    </div>
    <div class="u-panel-title">${fN(totalEmp)}</div>
    <div class="u-sub">${t('db.activeInSys')}</div>
  </div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;attendance&quot;]" role="button" tabindex="0" data-kb-activate aria-label="${t('db.presentToday')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.presentToday')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=circle-check></i></div>
    </div>
    <div class="u-panel-title">${fN(presentToday)}</div>
    <div class="u-sub">${t('db.ofTotal')} ${fN(totalEmp)} ${t('db.emp')}</div>
  </div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;leaves&quot;]" role="button" tabindex="0" data-kb-activate aria-label="${t('db.pendingLeaves')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.pendingLeaves')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=hourglass></i></div>
    </div>
    <div style="font-size:22px;font-weight:700;color:${pendingLeaves>0?'var(--orange)':'var(--text)'}">${fN(pendingLeaves)}</div>
    <div class="u-sub">${t('db.pendingApproval')}</div>
  </div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;payroll&quot;]" role="button" tabindex="0" data-kb-activate aria-label="إجمالي الرواتب">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">إجمالي الرواتب</div></div>
      <div class="kpi-chip"><i class=ji data-i=banknote></i></div>
    </div>
    <div class="u-panel-title">${fC(totalSalaries)}</div>
    <div class="u-sub">شهرياً</div>
  </div>`;
}
if(role==='admin'||role==='manager'||role==='warehouse'){
html += `
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;dispatch&quot;]" role="button" tabindex="0" data-kb-activate aria-label="طلبات صرف">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">طلبات صرف</div></div>
      <div class="kpi-chip"><i class=ji data-i=clipboard-list></i></div>
    </div>
    <div style="font-size:22px;font-weight:700;color:${pendingDisp>0?'var(--orange)':'var(--text)'}">${fN(pendingDisp)}</div>
    <div class="u-sub">${pendingDisp>0?'<i class=ji data-i=hourglass></i> معلق':'<i class=ji data-i=circle-check></i> لا يوجد'}</div>
  </div>
  <div class="mini-chart-card" data-karim-action="go" data-karim-args="[&quot;warehouse&quot;]" role="button" tabindex="0" data-kb-activate aria-label="مخزون منخفض">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">مخزون منخفض</div></div>
      <div class="kpi-chip"><i class=ji data-i=alert-triangle></i></div>
    </div>
    <div style="font-size:22px;font-weight:700;color:${lowStock>0?'var(--red)':'var(--text)'}">${fN(lowStock)}</div>
    <div class="u-sub">${lowStock>0?'يحتاج إعادة طلب':'المخزون جيد'}</div>
  </div>
  `;
}
html += `</div>`;
// ── علامة حالة بصمة الحضور (مربوطة/غير مربوطة/متصلة) ──
if(['admin','hr','manager'].includes(role)){
html += `<div id="zkDashStatus" class="mini-chart-card" style="margin-top:14px;cursor:pointer;min-height:110px" data-karim-action="go" data-karim-args="[&quot;zkteco&quot;]" data-tooltip="اضغط لفتح صفحة بصمة الحضور" role="button" tabindex="0" data-kb-activate aria-label="حالة بصمة الحضور"><div class="spinner"></div></div>`;
setTimeout(loadZkDashboardStatus, 60);
}
// ─── موجز المدير (لوحة التحكم) ───
async function mgrBriefLoad(){
const box=document.getElementById('mgrBriefBox'); if(!box) {return;}
try{
const b=await apiFetch('/manager/briefing');
window.mgrBriefLoad = mgrBriefLoad; // متاحة لزر التحديث داخل الـ HTML المولَّد
const cashRows=(b.cashiers||[]).map(c=>`<tr><td class="fw-bold">${esc(c.name)}</td><td>${fN(c.invoices)}</td><td class="c-green">${fC(c.total)}</td></tr>`).join('');
const outRows=(b.stockOut||[]).slice(0,5).map(s=>`<tr><td>${esc(s.name)}</td><td class="c-red">نافذ</td></tr>`).join('');
const fcRows=(b.forecast||[]).slice(0,5).map(s=>`<tr><td>${esc(s.name)}</td><td class="c-gold">${fN(s.days_cover)} يوم</td></tr>`).join('');
const p=b.pending||{};
box.innerHTML=`<div class="tbl-hd"><h3><i class=ji data-i=briefcase></i> موجز المدير — ${esc(b.day||'')} (مباشر)</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="mgrBriefLoad"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" data-karim-action="go" data-karim-args="[&quot;reports&quot;]"><i class=ji data-i=chart></i> التقارير</button></div></div>
<div style="padding:16px 20px">
<div class="stats-grid-premium kpi-grid-4" style="margin-bottom:12px">
<div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;revenues&quot;]"><div class="kpi-top"><span class="kpi-label">مبيعات الكاشيرية</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(b.cashiersTotal?.total||0)}</div><div class="trend">${fN(b.cashiersTotal?.invoices||0)} فاتورة اليوم${(b.cashiersY&&Number(b.cashiersY.total)>0)?` — أمس ${fC(b.cashiersY.total)}`:''}</div></div>
<div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;expenses&quot;]"><div class="kpi-top"><span class="kpi-label">مصاريف اليوم</span><span class="kpi-chip"><i class=ji data-i=wallet></i></span></div><div class="value">${fC(b.expenses?.total||0)}</div><div class="trend">${fN(b.expenses?.count||0)} عملية</div></div>
<div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;warehouse&quot;]"><div class="kpi-top"><span class="kpi-label">نواقص المخزن</span><span class="kpi-chip"><i class=ji data-i=alert-triangle></i></span></div><div class="value">${fN((b.stockOut||[]).length+(b.stockLow||[]).length)}</div><div class="trend">نافذ ${(b.stockOut||[]).length} • سينفد ${(b.forecast||[]).length}</div></div>
<div class="metric-card-premium" data-karim-action="go" data-karim-args="[&quot;attendance&quot;]"><div class="kpi-top"><span class="kpi-label">الحضور</span><span class="kpi-chip"><i class=ji data-i=timer></i></span></div><div class="value">${fN(b.attendance?.checked_in||0)}</div><div class="trend">نسي خروج ${fN(b.attendance?.missing_out||0)} • نسي دخول ${fN(b.attendance?.missing_in||0)}</div></div>
</div>
<div class="fr" style="gap:12px">
<div class="fg"><div class="tbl-hd" style="padding:8px 4px"><h3>الكاشيرية اليوم</h3></div><table style="width:100%;font-size:12px"><tbody>${cashRows||'<tr><td class="u-empty-sm">لا مبيعات بعد اليوم</td></tr>'}</tbody></table></div>
<div class="fg"><div class="tbl-hd" style="padding:8px 4px"><h3>ينفد قريبًا</h3></div><table style="width:100%;font-size:12px"><tbody>${fcRows||outRows||'<tr><td class="u-empty-sm">لا تنبيهات حرجة</td></tr>'}</tbody></table></div>
<div class="fg"><div class="tbl-hd" style="padding:8px 4px"><h3>معلق يحتاج قرار</h3></div><div class="u-sub-strong">إجازات: ${fN(p.leavesPending||0)} • أقسام: ${fN(p.unmappedSections||0)} • ورديات: ${fN(p.openShifts||0)}</div></div>
</div></div>`;
}catch(e){
box.innerHTML=`<div class="tbl-hd"><h3><i class=ji data-i=briefcase></i> موجز المدير</h3></div><div style="padding:16px 20px" class="u-empty-sm">${esc(e.message||'تعذر الجلب')}</div>`;
}
}
html += renderDashboardAnalytics();

// ── موجز المدير المباشر (كاشيرية + مصاريف + نواقص + تنبؤ + حضور) ──
if(role==='admin'||role==='manager'){
html += `<div class="tbl-wrap" style="margin-top:14px" id="mgrBriefBox"><div class="tbl-hd"><h3><i class=ji data-i=briefcase></i> موجز المدير — اليوم مباشرة من السستم</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="mgrBriefLoad"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" data-karim-action="go" data-karim-args="[&quot;reports&quot;]"><i class=ji data-i=chart></i> التقارير</button></div></div><div style="padding:16px 20px"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>`;
setTimeout(mgrBriefLoad, 120);
}

// <i class=ji data-i=building></i> Department Performance
if(role==='admin'||role==='manager'){
html += `
<div class="section-header" style="margin-top:30px">
  <div class="section-title"><i class=ji data-i=building></i> أداء الأقسام</div>
  <button class="btn btn-gold btn-sm" data-karim-action="go" data-karim-args="[&quot;cost-analysis&quot;]"><i class=ji data-i=chart></i> تحليل مفصل <i class=ji data-i=arrow-left></i></button>
</div>
<div class="dept-grid">`;
html += deptStats.map((d)=>{
  const efficiency = d.rev>0 ? Math.min(100, Math.max(0, 100 - d.costRatio)) : 0;
  return `<div class="dept-card" data-karim-action="go" data-karim-args="[&quot;departments&quot;]">
    <div class="dept-hd">
      <span class="dept-ic">${deptIcon(d)}</span>
      <div class="u-flex1">
        <div style="font-weight:600;font-size:14px">${esc(d.name)}</div>
        <div style="font-size:11px;color:var(--text3)" class="mono">${d.code}</div>
      </div>
      <span class="badge-premium">${fN(efficiency)}%</span>
    </div>
    <div class="dept-stats">
      <div class="dstat"><div class="dstat-lbl"><i class=ji data-i=banknote></i> الإيراد</div><div class="dstat-val">${fC(d.rev)}</div></div>
      <div class="dstat"><div class="dstat-lbl"><i class=ji data-i=wallet></i> المصروف</div><div class="dstat-val">${fC(d.exp)}</div></div>
      <div class="dstat"><div class="dstat-lbl"><i class=ji data-i=gem></i> الربح</div><div class="dstat-val ${d.profit>=0?'c-green':'c-red'}">${fC(d.profit)}</div></div>
    </div>
    <div class="progress-premium u-mt12"><div class="progress-premium-bar" style="width:${efficiency}%"></div></div>
  </div>`;
}).join('');
html += '</div>';
}

// ── Quick Actions — one primary + flat outline peers (no per-action colors) ──
html += `
<div class="section-header" style="margin-top:30px">
  <div class="section-title"><i class=ji data-i=zap></i> إجراءات سريعة</div>
</div>
<div class="quick-actions-row">
  <button class="btn btn-gold" data-karim-action="showAddRevenueModal"><i class=ji data-i=plus></i> إيراد</button>
  <button class="btn" data-karim-action="showAddExpenseModal"><i class=ji data-i=wallet></i> مصروف</button>
  <button class="btn" data-karim-action="showDispatchRequestModal"><i class=ji data-i=package></i> طلب صرف</button>
  <button class="btn" data-karim-action="generateReport" data-karim-also="go"><i class=ji data-i=chart></i> تقرير</button>
</div>`;

return html;
}
function renderEmployeeDashboard(){
const emp = STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(!emp) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لم يتم ربط حسابك بملف موظف. تواصل مع HR.</div>';}
const todayRecord = STATE.attendance.find(a=>a.employeeId===emp.id && a.date===today());
return `
<div id="smartCardContainer"></div>
<div class="hero-panel">
<h3 style="color:var(--gold);margin-bottom:20px"><i class=ji data-i=timer></i> تسجيل الحضور والانصراف</h3>
<div style="display:flex;gap:20px;justify-content:center;flex-wrap:wrap">
<button class="attendance-btn check-in" data-karim-action="kdCheckIn" ${todayRecord?.checkIn?'disabled':''}>
<span class="u-f28"><i class=ji data-i=inbox></i></span>
<div>
<div class="u-t16-bold">تسجيل حضور</div>
<div class="u-faint-80">${todayRecord?.checkIn?`تم: ${todayRecord.checkIn}`:'اضغط للتسجيل'}</div>
</div>
</button>
<button class="attendance-btn check-out" data-karim-action="kdCheckOut" ${!todayRecord?.checkIn||todayRecord?.checkOut?'disabled':''}>
<span class="u-f28"><i class=ji data-i=upload></i></span>
<div>
<div class="u-t16-bold">تسجيل انصراف</div>
<div class="u-faint-80">${todayRecord?.checkOut?`تم: ${todayRecord.checkOut}`:'اضغط للتسجيل'}</div>
</div>
</button>
</div>
</div>
<div class="quick-actions">
<button class="quick-action-btn" data-karim-action="go" data-karim-args="[&quot;leaves&quot;]"><i class=ji data-i=calendar></i> طلب إجازة</button>
<button class="quick-action-btn" data-karim-action="go" data-karim-args="[&quot;attendance&quot;]"><i class=ji data-i=timer></i> سجل الحضور</button>
</div>
`;
}
function renderExpiryAlertBanner(){
const now = new Date();
const alerts = [];
STATE.employees.forEach(emp=>{
if(emp.iqamaExpiry){
const days = Math.ceil((new Date(emp.iqamaExpiry)-now)/86400000);
if(days<=30) {alerts.push({type:days<=0?'danger':'warn',icon:'<i class=ji data-i=id-card></i>',text:`إقامة ${emp.name}`,meta:(days<=0?'منتهية!':`متبقٍ ${days} يوم`),date:fHijri(emp.iqamaExpiry),empId:emp.id});}
}
if(emp.healthCertExpiry){
const days = Math.ceil((new Date(emp.healthCertExpiry)-now)/86400000);
if(days<=30) {alerts.push({type:days<=0?'danger':'warn',icon:'<i class=ji data-i=stethoscope></i>',text:`شهادة صحية - ${emp.name}`,meta:(days<=0?'منتهية!':`متبقٍ ${days} يوم`),date:fHijri(emp.healthCertExpiry),empId:emp.id});}
}
if(emp.healthEduExpiry){
const days = Math.ceil((new Date(emp.healthEduExpiry)-now)/86400000);
if(days<=30) {alerts.push({type:days<=0?'danger':'warn',icon:'<i class=ji data-i=award></i>',text:`تثقيف صحي - ${emp.name}`,meta:(days<=0?'منتهي!':`متبقٍ ${days} يوم`),date:fHijri(emp.healthEduExpiry),empId:emp.id});}
}
});
if(alerts.length===0) {return '';}
let html = '';
const dangerAlerts = alerts.filter(a=>a.type==='danger');
const warnAlerts = alerts.filter(a=>a.type==='warn');
if(dangerAlerts.length>0){
html += `<div class="expiry-alert-banner"><h4><i class=ji data-i=alert-triangle></i> تنبيهات عاجلة - وثائق منتهية</h4><div class="expiry-alert-list">${dangerAlerts.map(a=>`<div class="expiry-alert-row"><span>${a.icon} ${esc(a.text)} <small class="text-muted">هجري:  ${esc(a.date||'—')}</small></span><span class="badge bdg-red">${esc(a.meta)}</span></div>`).join('')}</div></div>`;
}
if(warnAlerts.length>0){
html += `<div class="expiry-alert-banner warn-only"><h4><i class=ji data-i=alert-triangle></i> وثائق ستنتهي قريباً</h4><div class="expiry-alert-list">${warnAlerts.map(a=>`<div class="expiry-alert-row"><span>${a.icon} ${esc(a.text)} <small class="text-muted">هجري:  ${esc(a.date||'—')}</small></span><span class="badge bdg-orange">${esc(a.meta)}</span></div>`).join('')}</div></div>`;
}
return html;
}/* ─── إجراءات مولَّدة (تفويض بدل معالجات سطرية) ─── */
function kdRenderPage(p0) {
    dashboardChartDays = p0;
    renderPage();
}

function kdRenderPage7(p0) {
    dashboardChartDept = p0;
    renderPage();
}

function kdCheckIn() {
    checkIn();
}

function kdCheckOut() {
    checkOut();
}



export {dashboardChartDays, dashboardChartDept, dashboardDateKey, dashboardFilteredRows, renderDashboardAnalytics, initDashboardCharts, loadZkDashboardStatus, renderDashboard, renderEmployeeDashboard, renderExpiryAlertBanner, kdRenderPage, kdRenderPage7, kdCheckIn, kdCheckOut };;
