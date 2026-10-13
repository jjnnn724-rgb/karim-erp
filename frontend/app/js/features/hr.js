/**
 * features/hr.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// HR DASHBOARD
// ============================================
function renderHRDashboard(){
const totalEmployees = STATE.employees.length;
const activeEmployees = STATE.employees.filter(e=>e.status==='active').length;
const presentToday = STATE.attendance.filter(a=>a.date===today()&&a.checkIn).length;
const pendingLeaves = STATE.leaveRequests.filter(l=>l.status==='pending').length;
const totalSalaries = STATE.employees.reduce((s,e)=>s+(e.salary||0),0);
const lateToday = STATE.attendance.filter(a=>a.date===today()&&a.checkIn&&a.late).length;
const absentToday = activeEmployees - presentToday;
const _mStart=(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;})();
let monthGaps=0; try{ monthGaps=attGapsData(_mStart,today()).length; }catch(_){ monthGaps=0; }
setTimeout(()=>{ renderHRCharts(); },100);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> إجمالي الموظفين</div><div class="mcard-val c-gold">${fN(totalEmployees)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> الحاضرون اليوم</div><div class="mcard-val c-green">${fN(presentToday)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-x></i> لم يحضروا اليوم</div><div class="mcard-val ${absentToday>0?'c-red':'c-green'}">${fN(absentToday)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=hourglass></i> إجازات معلقة</div><div class="mcard-val c-orange">${fN(pendingLeaves)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=dot-green></i> موظفون نشطون</div><div class="mcard-val c-green">${fN(activeEmployees)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> متأخرون اليوم</div><div class="mcard-val ${lateToday>0?'c-red':'c-green'}">${fN(lateToday)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الرواتب</div><div class="mcard-val c-blue">${fC(totalSalaries)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=building></i> أقسام HR</div><div class="mcard-val c-purple">${fN(STATE.hrDepartments.length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> نواقص الشهر تحتاج معالجة</div><div class="mcard-val ${monthGaps>0?'c-red':'c-green'}">${fN(monthGaps)}</div></div>
</div>
<div class="quick-actions">
<button class="quick-action-btn" onclick="hrGoGaps()"><i class=ji data-i=gavel></i> مراجعة نواقص الشهر</button>
<button class="quick-action-btn" onclick="go('employees')"><i class=ji data-i=users></i> إدارة الموظفين</button>
<button class="quick-action-btn" onclick="go('attendance')"><i class=ji data-i=timer></i> الحضور والانصراف</button>
<button class="quick-action-btn" onclick="go('leaves')"><i class=ji data-i=calendar></i> طلبات الإجازات</button>
<button class="quick-action-btn" onclick="go('hr-departments')"><i class=ji data-i=building></i> أقسام HR</button>
<button class="quick-action-btn" onclick="go('payroll')"><i class=ji data-i=banknote></i> الرواتب</button>
</div>
<div class="charts-grid">
<div class="chart-card"><div class="chart-title"><i class=ji data-i=chart></i> توزيع الموظفين حسب القسم</div><div class="chart-box"><canvas id="hrDeptChart"></canvas></div></div>
<div class="chart-card"><div class="chart-title"><i class=ji data-i=trending-up></i> الحضور الأسبوعي</div><div class="chart-box"><canvas id="attendanceChart"></canvas></div></div>
</div>
`;
}
function renderHRCharts(){
const ctx1=document.getElementById('hrDeptChart');
if(ctx1 && typeof Chart!=='undefined'){
if(STATE.charts.hrDept){STATE.charts.hrDept.destroy();}
const deptCounts={};
STATE.hrDepartments.forEach(d=>{deptCounts[d.name]=STATE.employees.filter(e=>e.department===d.code).length;});
STATE.charts.hrDept = new Chart(ctx1,{type:'doughnut',data:{labels:Object.keys(deptCounts),datasets:[{data:Object.values(deptCounts),backgroundColor:['#d4a843','#e74c3c','#2ecc71','#3498db','#9b59b6']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
const ctx2=document.getElementById('attendanceChart');
if(ctx2 && typeof Chart!=='undefined'){
if(STATE.charts.attendance){STATE.charts.attendance.destroy();}
const last7Days=[];
for(let i=6;i>=0;i--){const date=new Date();date.setDate(date.getDate()-i);last7Days.push(date.toISOString().split('T')[0]);}
const attendanceData=last7Days.map(date=>STATE.attendance.filter(a=>a.date===date&&a.checkIn).length);
STATE.charts.attendance = new Chart(ctx2,{type:'line',data:{labels:last7Days.map(d=>fD(d)),datasets:[{label:'الحاضرون',data:attendanceData,backgroundColor:'rgba(212,168,67,0.2)',borderColor:'#d4a843',borderWidth:2,fill:true,tension:0.4}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
}
// ============================================
// ATTENDANCE
// ============================================
function renderAttendance(){
const role=STATE.currentUser.role;
const isAdmin=['admin','hr','manager'].includes(role);
const isDeptHead=role==='dept_head';
// dept_head: جدول سجل حضور/انصراف موظفي قسمه (عرض فقط) — البيانات نفسها مقيدة على السيرفر
if(!isAdmin && !isDeptHead){
const emp=STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(!emp) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لم يتم ربط حسابك بملف موظف</div>';}
const todayRecord=STATE.attendance.find(a=>a.employeeId===emp.id&&a.date===today());
return `
<div id="smartCardContainer"></div>
<div class="hero-panel">
<h3 style="color:var(--gold);margin-bottom:20px"><i class=ji data-i=timer></i> تسجيل الحضور والانصراف</h3>
<div style="display:flex;gap:20px;justify-content:center;flex-wrap:wrap">
<button class="attendance-btn check-in" onclick="checkIn()" ${todayRecord?.checkIn?'disabled':''}>
<span class="u-f28"><i class=ji data-i=inbox></i></span>
<div>
<div class="u-t16-bold">تسجيل حضور</div>
<div class="u-faint-80">${todayRecord?.checkIn?`تم: ${todayRecord.checkIn}`:'اضغط للتسجيل'}</div>
</div>
</button>
<button class="attendance-btn check-out" onclick="checkOut()" ${!todayRecord?.checkIn||todayRecord?.checkOut?'disabled':''}>
<span class="u-f28"><i class=ji data-i=upload></i></span>
<div>
<div class="u-t16-bold">تسجيل انصراف</div>
<div class="u-faint-80">${todayRecord?.checkOut?`تم: ${todayRecord.checkOut}`:'اضغط للتسجيل'}</div>
</div>
</button>
</div>
</div>
`;
}
if(!STATE.attFrom){const d=new Date();d.setDate(1);STATE.attFrom=d.toISOString().slice(0,10);}
if(!STATE.attTo) {STATE.attTo=today();}
const attFrom=STATE.attFrom, attTo=STATE.attTo;
const rangeRecords=STATE.attendance.filter(a=>a.date>=attFrom&&a.date<=attTo);
const presentCount=rangeRecords.filter(a=>a.checkIn).length;
const totalDays=new Set(rangeRecords.map(a=>a.date)).size;
// إجمالي الساعات من النصوص المعروضة أولًا (يمنع تضخم قيم شاذة كـ 25:43)
const totalKarim=rangeRecords.reduce((s,a)=>{const m=attRawMinutes(a);return s+(m==null?(a.workMinutes?Number(a.workMinutes):0):m)/60;},0);
// dept_head: قائمة الموظفين الظاهرة هي موظفو قسمه فقط (من /hr/dept-employees)
const visibleEmployees=isDeptHead?(STATE.deptEmployees||[]):STATE.employees;
if(isDeptHead){ensureDeptEmpsForAtt();}
const activeEmployees=visibleEmployees.filter(e=>e.status==='active');
// ─── ترقيم صفحات الجدول (100 صف/صفحة) + فهارس — يمنع تهنيج المتصفح ───
const empMap=new Map((visibleEmployees||[]).map(e=>[String(e.id),e]));
const attQ=String(STATE.attSearch||'').trim().toLowerCase();
const normAr=s=>String(s||'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
const nq=normAr(attQ);
const filteredRecs=(nq?rangeRecords.filter(a=>{const e=empMap.get(String(a.employeeId));return e&&normAr(`${e.name} ${e.employeeId||''} ${e.department||''}`).includes(nq);}):rangeRecords)
.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:0);
const ATT_PS=100;
// ─── صفوف الغياب داخل الجدول: موظف نشط بلا سجل في يوم ماضٍ → شرط + لم يحضر ───
const leavesOk=(STATE.leaveRequests||[]).filter(l=>l.status==='approved');
const excusedMain=(empId,date)=>leavesOk.some(l=>String(l.employeeId)===String(empId)&&String(l.startDate)<=date&&date<=String(l.endDate));
const recByEmpDate=new Map(rangeRecords.map(a=>[String(a.employeeId)+'|'+a.date,a]));
const empList=activeEmployees.filter(e=>!nq||normAr(`${e.name} ${e.employeeId||''} ${e.department||''}`).includes(nq));
const absentRecs=[];
const todayIso=today();
for(const e of empList){
for(let d=attFrom; d<=attTo; d=attNextDay(d)){
if(d>todayIso) {continue;} // المستقبل ليس غيابًا
if(recByEmpDate.has(String(e.id)+'|'+d)) {continue;}
absentRecs.push({employeeId:e.id,date:d,_absent:true,_excused:excusedMain(e.id,d)});
}
}
const allRecs=filteredRecs.concat(absentRecs).sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:(String(a.employeeId)>String(b.employeeId)?1:-1));
const attPages=Math.max(1,Math.ceil(allRecs.length/ATT_PS));
if(STATE.attPage>attPages){STATE.attPage=attPages;}
if(!STATE.attPage||STATE.attPage<1){STATE.attPage=1;}
const pageRecs=allRecs.slice((STATE.attPage-1)*ATT_PS,STATE.attPage*ATT_PS);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> إجمالي الموظفين</div><div class="mcard-val c-gold">${fN(activeEmployees.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> سجلات الحضور</div><div class="mcard-val c-green">${fN(presentCount)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=calendar></i> أيام العمل</div><div class="mcard-val c-blue">${fN(totalDays)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=clock></i> إجمالي الساعات</div><div class="mcard-val c-gold">${totalKarim.toFixed(0)}</div></div>
</div>
<div id="attGapsBox"></div>
<div class="tbl-wrap">
<div class="tbl-hd">
<h3><i class=ji data-i=clipboard-list></i> سجل الحضور — ${fD(attFrom)} → ${fD(attTo)}</h3>
<div class="u-row-wrap">
<input type="date" id="attFrom" value="${attFrom}" onchange="attRangeChange()" style="min-width:140px">
<span style="color:var(--faint)">إلى</span>
<input type="date" id="attTo" value="${attTo}" onchange="attRangeChange()" style="min-width:140px">
<button class="btn btn-gold btn-sm" onclick="attRangeChange()"><i class=ji data-i=search></i> عرض</button>
<button class="btn btn-blue btn-sm" onclick="attRangePreset(7)">7 أيام</button>
<button class="btn btn-blue btn-sm" onclick="attRangePreset(30)">30 يوم</button>
<button class="btn btn-blue btn-sm" onclick="attRangePreset(180)">6 شهور</button>
</div>
</div>
<div style="display:flex;gap:8px;margin:8px 0;flex-wrap:wrap;align-items:center">
<input type="search" id="attSearch" placeholder="بحث بالاسم أو الكود أو القسم..." value="${esc(STATE.attSearch||'')}" oninput="attSearchFilter(this.value)" style="min-width:180px">
${!isDeptHead?`<button class="btn btn-gold btn-sm" onclick="scanAttendanceKiosk()"><i class=ji data-i=camera></i> مسح بطاقة موظف</button>
<button class="btn btn-blue btn-sm" onclick="openShiftsPanel()"><i class=ji data-i=clock></i> الورديات — تطبيق وإعادة حساب</button>`:''}
<button class="btn btn-blue btn-sm" onclick="exportAttendanceExcel()"><i class=ji data-i=inbox></i> تصدير Excel</button>
${!isDeptHead?`<button class="btn btn-green btn-sm" onclick="printMonthlyAttendance()"><i class=ji data-i=printer></i> كشف شهري مجمع (طباعة)</button>
<button class="btn btn-blue btn-sm" onclick="runStrictAuditUI()"><i class=ji data-i=shield-check></i> تدقيق صارم</button>
<button class="btn btn-gold btn-sm" onclick="attGapsToggle()"><i class=ji data-i=alert-triangle></i> مراجعة نواقص الشهر</button>
`:''}
${STATE.currentUser?.role==='admin' ? `<button class="btn btn-red btn-sm" onclick="revertAllInferred()" title="إلغاء كل الاستكمال التلقائي"><i class=ji data-i=undo></i> إلغاء الاستكمال للكل</button>` : ''}
<span class="text-muted" style="margin-inline-start:auto">صفحة ${fN(STATE.attPage)} من ${fN(attPages)} — ${fN(allRecs.length)} سجل (شامل الغياب)</span>
<button class="btn btn-sm" ${STATE.attPage<=1?'disabled':''} onclick="attPageGo(-1)">السابق</button>
<button class="btn btn-sm" ${STATE.attPage>=attPages?'disabled':''} onclick="attPageGo(1)">التالي</button>
</div>
<div class="tbl-scroll tbl-sticky-first">
<table>
<thead><tr><th>الموظف</th><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>المصدر</th></tr></thead>
<tbody id="attTodayBody">
${filteredRecs.length===0?'<tr><td colspan=7 style="text-align:center;padding:30px;color:var(--faint)">لا توجد سجلات في الفترة المحددة</td></tr>':''}
${pageRecs.map(record=>{
const emp=empMap.get(String(record.employeeId));
if(!emp) {return '';}
if(record._absent){
return `<tr data-date="${record.date}" style="background:rgba(231,76,60,.06)">
<td class="fw-bold">${esc(emp.name)}</td>
<td class="text-muted">${fD(record.date)}</td>
<td class="text-muted">${attWeekday(record.date)}</td>
<td>—</td><td>—</td><td>—</td>
<td>${record._excused?'<span class="badge bdg-blue">إجازة</span>':'<span class="badge bdg-red">لم يحضر</span>'}</td>
</tr>`;
}
const inferredBadge='<span class="badge bdg-orange" title="قيمة مستكملة تلقائيًا">~ تلقائي</span>';
const krm=attRawHours(record);
const recSource=record?(record.source==='device'?'<span class="badge bdg-blue">بصمة</span>':record.source==='qr'?'<span class="badge bdg-green">QR</span>':record.source==='portal'?'<span class="badge bdg-teal">كاميرا التطبيق</span>':record.source==='backfill'?'<span class="badge bdg-purple">أرشيف</span>':'<span class="badge bdg-gray">يدوي</span>'):'—';
return `<tr data-date="${record.date}">
<td class="fw-bold">${esc(emp.name)}</td>
<td class="text-muted">${fD(record.date)}</td>
<td class="text-muted">${attWeekday(record.date)}</td>
<td class="c-green" dir="ltr">${record.checkIn?esc(record.checkIn)+(record.checkin_inferred?' '+inferredBadge:''):'—'}</td>
<td class="c-red" dir="ltr">${record.checkOut?esc(record.checkOut)+(record.checkout_inferred?' '+inferredBadge:''):'—'}</td>
<td class="c-gold">${krm} ساعة</td>
<td>${recSource}</td>
</tr>`;
}).join('')}
</tbody>
</table>
</div>
</div>
${attExceptionsBox(visibleEmployees)}
`;
}
// موظفو قسم رئيس القسم — تُحمّل مرة واحدة وتُستخدم لجدول الحضور المقيد
function ensureDeptEmpsForAtt(){
if(STATE._deptEmpsLoading || (STATE.deptEmployees||[]).length) {return;}
STATE._deptEmpsLoading=true;
apiFetch('/hr/dept-employees').then(d=>{
STATE.deptEmployees=Array.isArray(d?.employees)?d.employees:[];
STATE._deptEmpsLoading=false;
renderPage();
}).catch(()=>{STATE._deptEmpsLoading=false;});
}
async function attRangeChange(){
const f=document.getElementById('attFrom')?.value;
const t=document.getElementById('attTo')?.value;
if(f) {STATE.attFrom=f;}
if(t) {STATE.attTo=t;}
STATE.attPage=1;
try{
const attRes=await apiFetch(`/attendance/range?from=${STATE.attFrom}&to=${STATE.attTo}&limit=30000`);
STATE.attendance=Array.isArray(attRes?.data)?attRes.data:[];
}catch(e){console.warn('Range load failed:',e.message);}
renderPage();
}
async function attRangePreset(days){
const d=new Date();d.setDate(d.getDate()-days);STATE.attFrom=d.toISOString().slice(0,10);STATE.attTo=today();
STATE.attPage=1;
try{
const attRes=await apiFetch(`/attendance/range?from=${STATE.attFrom}&to=${STATE.attTo}&limit=30000`);
STATE.attendance=Array.isArray(attRes?.data)?attRes.data:[];
}catch(e){console.warn('Range load failed:',e.message);}
renderPage();
}
function attSearchFilter(q){
  STATE.attSearch = q || '';
  STATE.attPage = 1;
  renderPage();
  const s = document.getElementById('attSearch');
  if(s){ s.focus(); try{ s.setSelectionRange(s.value.length, s.value.length); }catch(_){} }
}
function attPageGo(dir){
  STATE.attPage = Math.max(1, (STATE.attPage || 1) + dir);
  renderPage();
}
// دقائق العمل من النصين المعروضين أولًا (يمنع قيمًا شاذة كـ 25:43) — التفاف ليلي فقط عند out<in
function attRawMinutes(a){
const m=String(a.checkIn||'').match(/^(\d{1,2}):(\d{2})$/);
const o=String(a.checkOut||'').match(/^(\d{1,2}):(\d{2})$/);
if(m&&o){let d=(Number(o[1])*60+Number(o[2]))-(Number(m[1])*60+Number(m[2]));if(d<0){d+=24*60;}return Math.max(0,d);}
if(a.workMinutes!=null&&Number.isFinite(Number(a.workMinutes))){return Math.max(0,Number(a.workMinutes));}
return null;
}
function attRawHours(a){
const m=attRawMinutes(a);
return m==null?'—':(m/60).toFixed(2);
}
// ─── صندوق الاستثناءات: غياب/تأخير/انصراف مبكر/بصمة ناقصة في مكان واحد ───
function attExceptionsBox(emps){
  const d = today();
  const leaves = (STATE.leaveRequests || []).filter(l => l.status === 'approved' && String(l.startDate) <= d && d <= String(l.endDate));
  const excused = new Set(leaves.map(l => String(l.employeeId)));
  const rows = [];
  const typeMeta = {
    absent: { label: 'لم يحضر', cls: 'bdg-red' },
    late: { label: 'متأخر', cls: 'bdg-orange' },
    early: { label: 'انصراف مبكر', cls: 'bdg-orange' },
    missing: { label: 'بصمة ناقصة', cls: 'bdg-blue' },
  };
  ((Array.isArray(emps) ? emps : STATE.employees) || []).filter(e => e.status === 'active').forEach(emp => {
    const rec = (STATE.attendance || []).find(a => String(a.employeeId) === String(emp.id) && a.date === d);
    let type = null, detail = '';
    if(!rec || (!rec.checkIn && !rec.checkOut)){ type = 'absent'; detail = 'لا بصمات اليوم'; }
    else if(rec.checkIn && !rec.checkOut && !rec.checkout_inferred){ type = 'missing'; detail = `حضور ${esc(rec.checkIn)} بلا انصراف`; }
    else if(!rec.checkIn && rec.checkOut){ type = 'missing'; detail = `انصراف ${esc(rec.checkOut)} بلا حضور`; }
    else if(rec.late){ type = 'late'; detail = `حضور ${esc(rec.checkIn)}`; }
    else if(rec.early_leave){ type = 'early'; detail = `انصراف ${esc(rec.checkOut)}`; }
    if(!type) {return;}
    const isExc = excused.has(String(emp.id));
    rows.push({ emp, type, detail, rec, isExc });
  });
  if(!rows.length) {return `<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=shield-check></i> صندوق الاستثناءات — اليوم (${attWeekday(d)})</h3><span class="badge bdg-green">لا استثناءات</span></div></div>`;}
  const open = rows.filter(r => !r.isExc).length;
  const nowMin = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
  const toMin = (t) => { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const workHrs = (r) => {
    if(!r.rec || (!r.rec.checkIn && !r.rec.checkOut)) {return '0.0';}
    if(!r.rec.checkIn) {return '—';} // انصراف بلا حضور: لا يمكن الحساب
    const a = toMin(r.rec.checkIn);
    if(a == null) {return '—';}
    let b = toMin(r.rec.checkOut);
    if(b == null) {b = (r.rec.date || d) === d ? nowMin : a;} // بصمة ناقصة اليوم: حتى الآن
    let diff = b - a; if(diff < 0) {diff += 24 * 60;}
    return (diff / 60).toFixed(2);
  };
  return `<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=siren></i> صندوق الاستثناءات — اليوم (${attWeekday(d)}) (${open} مفتوح)</h3></div>
  <div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>النوع</th><th>التفاصيل</th><th>بصمة الحضور</th><th>بصمة الانصراف</th><th>ساعات العمل</th><th>الحالة</th><th>إجراء</th></tr></thead><tbody>
  ${rows.map(r => { const m = typeMeta[r.type]; return `<tr>
    <td class="fw-bold">${esc(r.emp.name)}</td>
    <td><span class="badge ${m.cls}">${m.label}</span></td>
    <td class="text-muted">${r.detail}</td>
    <td class="c-green">${r.rec?.checkIn ? esc(r.rec.checkIn) + (r.rec.checkin_inferred ? ' <span class="badge bdg-orange">~</span>' : '') : '—'}</td>
    <td class="c-red">${r.rec?.checkOut ? esc(r.rec.checkOut) + (r.rec.checkout_inferred ? ' <span class="badge bdg-orange">~</span>' : '') : '—'}</td>
    <td class="c-gold fw-bold">${workHrs(r)} ساعة</td>
    <td>${r.isExc ? '<span class="badge bdg-green">معذور</span>' : '<span class="badge bdg-red">معلق</span>'}</td>
    <td>${r.isExc ? '—' : `<div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="attExcuseModal('${r.emp.id}')"><i class=ji data-i=file-check></i> عذر</button><button class="btn btn-red btn-sm" onclick="hrAdjustModal('${r.emp.id}','${d.slice(0, 7)}','penalty')"><i class=ji data-i=gavel></i> جزاء</button></div>`}</td>
  </tr>`; }).join('')}
  </tbody></table></div></div>`;
}
// ─── مراجعة نواقص الشهر: نسي دخول/خروج/غياب — معالجة (تعبئة/عذر/تبديل) ───
function hrGoGaps(){
const d=new Date();
STATE.attFrom=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
STATE.attTo=today(); STATE.attPage=1; STATE.attGapsAuto=true;
go('attendance');
}
function attGapsToggle(){
const box=document.getElementById('attGapsBox');
if(!box) {return;}
if(box.innerHTML){ box.innerHTML=''; return; }
attGapsRender();
}
function attGapsData(from, to){
from=from||STATE.attFrom||today(); to=to||STATE.attTo||today();
const leaves=(STATE.leaveRequests||[]).filter(l=>l.status==='approved');
const excused=(empId,date)=>leaves.some(l=>String(l.employeeId)===String(empId)&&String(l.startDate)<=date&&date<=String(l.endDate));
const recByEmpDate=new Map((STATE.attendance||[]).map(a=>[String(a.employeeId)+'|'+a.date,a]));
const gaps=[];
(STATE.employees||[]).filter(e=>e.status==='active').forEach(emp=>{
for(let d=from; d<=to; d=attNextDay(d)){
if(excused(emp.id,d)) {continue;}
const rec=recByEmpDate.get(String(emp.id)+'|'+d);
if(!rec){ gaps.push({emp,date:d,type:'absent',label:'لم يحضر تمامًا',rec:null}); }
else if(rec.checkIn&&!rec.checkOut&&!rec.checkout_inferred){ gaps.push({emp,date:d,type:'missOut',label:'نسي بصمة الخروج',rec}); }
else if(!rec.checkIn&&rec.checkOut){ gaps.push({emp,date:d,type:'missIn',label:'نسي بصمة الدخول',rec}); }
}
});
return gaps;
}
function attNextDay(iso){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
// اسم يوم الأسبوع لتاريخ YYYY-MM-DD (T12 لتفادي انزياح المنطقة الزمنية)
function attWeekday(iso){ const names=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']; const d=new Date(String(iso||'')+'T12:00:00'); return Number.isNaN(d.getTime())?'—':names[d.getDay()]; }
function attGapsSearch(q){
STATE.attGapsQ=q||'';
attGapsRender();
const s=document.getElementById('attGapsSearch');
if(s){ s.focus(); try{ s.setSelectionRange(s.value.length,s.value.length); }catch(_){} }
}
function attGapsRender(){
const box=document.getElementById('attGapsBox');
if(!box) {return;}
let gaps=attGapsData();
const gq=String(STATE.attGapsQ||'').trim().toLowerCase();
if(gq){
const nr=s=>String(s||'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
gaps=gaps.filter(g=>nr(`${g.emp.name} ${g.emp.employeeId||''} ${g.emp.department||''}`).includes(nr(gq)));
}
const byType={absent:0,missOut:0,missIn:0};
gaps.forEach(g=>byType[g.type]++);
const typeMeta={absent:['لم يحضر تمامًا','bdg-red'],missOut:['نسي الخروج','bdg-orange'],missIn:['نسي الدخول','bdg-orange']};
box.innerHTML=`<div class="tbl-wrap" style="margin-top:14px;border:1px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> نواقص الفترة (${fN(gaps.length)}) — لم يحضر: ${fN(byType.absent)} • نسي خروج: ${fN(byType.missOut)} • نسي دخول: ${fN(byType.missIn)}</h3>
<div class="u-row-wrap"><input type="search" class="inp" id="attGapsSearch" placeholder="بحث بالاسم أو الكود..." value="${esc(STATE.attGapsQ||'')}" oninput="attGapsSearch(this.value)" style="max-width:200px"><small class="text-muted">العطلات الأسبوعية ظاهرة أيضًا — عدّها بعينك قبل المعالجة</small><button class="btn btn-sm" onclick="STATE.attGapsQ='';attGapsToggle()">إخفاء ✕</button></div></div>
<div class="tbl-scroll" style="max-height:380px;overflow:auto"><table>
<thead><tr><th>التاريخ</th><th>اليوم</th><th>الموظف</th><th>النوع</th><th>الحضور</th><th>الانصراف</th><th></th></tr></thead>
<tbody>${gaps.slice(0,300).map((g,i)=>{ const m=typeMeta[g.type]; const absent=g.type==='absent'; return `<tr${absent?' style="background:rgba(231,76,60,.06)"':''}>
<td class="text-muted">${fD(g.date)}</td><td class="fw-bold">${attWeekday(g.date)}</td><td class="fw-bold">${esc(g.emp.name)}</td>
<td><span class="badge ${m[1]}">${m[0]}</span></td>
<td class="c-green">${!absent&&g.rec?.checkIn?esc(g.rec.checkIn):'—'}</td>
<td class="c-red">${!absent&&g.rec?.checkOut?esc(g.rec.checkOut):'—'}</td>
<td><button class="btn btn-gold btn-sm" onclick='attResolveModal("${g.emp.id}","${g.date}")'><i class=ji data-i=gavel></i> معالجة</button></td>
</tr>`; }).join('')||'<tr><td colspan="7" class="u-empty-sm">لا نواقص — الشهر مقفل نضيف</td></tr>'}</tbody></table></div>
${gaps.length>300?`<div style="padding:8px 14px" class="text-muted">... و${fN(gaps.length-300)} أخرى — ضيق الفترة بالأعلى</div>`:''}</div>`;
}
function attResolveModal(empId, date){
if(!['admin','manager','hr'].includes(STATE.currentUser?.role)){ toast('للإدارة فقط','error'); return; }
const emp=(STATE.employees||[]).find(e=>String(e.id)===String(empId));
const rec=(STATE.attendance||[]).find(a=>String(a.employeeId)===String(empId)&&a.date===date);
const others=(STATE.employees||[]).filter(e=>e.status==='active'&&String(e.id)!==String(empId)).map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
showModal(`
<h3><i class=ji data-i=gavel></i> معالجة — ${esc(emp?.name||'')} <small class="text-muted">${fD(date)}</small></h3>
<div class="mcard" style="margin-bottom:12px;line-height:2">الحالي: حضور <b class="c-green">${esc(rec?.checkIn||'—')}</b> • انصراف <b class="c-red">${esc(rec?.checkOut||'—')}</b></div>
<div class="fg"><label>نوع المعالجة</label><select id="attResType" onchange="document.getElementById('attResFill').style.display=this.value==='fill'?'':'none';document.getElementById('attResSwap').style.display=this.value==='swap'?'':'none'">
<option value="fill">تعبئة البصمة الناقصة</option><option value="excuse">عذر معتمد</option><option value="swap">تبديل وردية</option></select></div>
<div id="attResFill"><div class="fr">
<div class="fg"><label>بصمة الحضور</label><input type="time" id="attResIn" value="${esc(rec?.checkIn||'')}"></div>
<div class="fg"><label>بصمة الانصراف</label><input type="time" id="attResOut" value="${esc(rec?.checkOut||'')}"></div>
</div></div>
<div id="attResSwap" style="display:none"><div class="fg"><label>تبديل مع الموظف</label><select id="attResWith"><option value="">اختر...</option>${others}</select></div></div>
<div class="fg"><label>السبب (إجباري)</label><input type="text" id="attResReason" placeholder="مثال: نسي البصمة — ظرف عائلي — تبديل متفق عليه"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="attResolveSave('${empId}','${date}','${rec?rec.id:''}')"><i class=ji data-i=save></i> اعتماد المعالجة</button></div>`);
}
function attCalcTimes(ci, co, shiftStart){
const toMin=t=>{ const m=String(t).match(/^(\d{2}):(\d{2})/); return Number(m[1])*60+Number(m[2]); };
let workMinutes=null;
if(ci&&co){ let d=toMin(co)-toMin(ci); if(d<0) {d+=1440;} workMinutes=d; }
// FIX 2026-10-11: add 15-min grace (same as shift-day.js + smart-card.js + backend)
const GRACE_MIN = 15;
const late=ci?toMin(ci)>toMin(shiftStart)+GRACE_MIN:false;
return {workMinutes, late};
}
async function attResolveSave(empId, date, recordId){
const type=document.getElementById('attResType')?.value||'fill';
const reason=(document.getElementById('attResReason')?.value||'').trim();
if(!reason){ toast('اكتب السبب','error'); return; }
const emp=(STATE.employees||[]).find(e=>String(e.id)===String(empId));
const shiftStart=String(emp?.shift_start||'').match(/^\d{2}:\d{2}/)?emp.shift_start:String(STATE.settings?.workStartHour??9).padStart(2,'0')+':00';
const who=STATE.currentUser?.name||'';
showLoad();
try{
if(type==='fill'){
const ci=(document.getElementById('attResIn')?.value||'').trim();
const co=(document.getElementById('attResOut')?.value||'').trim();
const tm=/^([01]\d|2[0-3]):[0-5]\d$/;
if(!ci&&!co){ toast('أدخل بصمة واحدة على الأقل','error'); return; }
if((ci&&!tm.test(ci))||(co&&!tm.test(co))){ toast('صيغة الوقت HH:MM','error'); return; }
const {workMinutes, late}=attCalcTimes(ci,co,shiftStart);
const audit=`[تعبئة ${today()} بواسطة ${who}: ${reason}]`;
if(recordId){
const rec=STATE.attendance.find(a=>String(a.id)===String(recordId));
await persistUpdate('attendance', recordId, { checkIn: ci||null, checkOut: co||null, workMinutes, late, notes: [rec?.notes, audit].filter(Boolean).join(' | ') });
Object.assign(rec||{}, { checkIn: ci||null, checkOut: co||null, workMinutes, late });
}else{
const saved=await persistCreate('attendance',(s)=>STATE.attendance.push(s),{ employeeId: String(empId), date, checkIn: ci||null, checkOut: co||null, workMinutes, late, notes: audit });
}
toast('تمت تعبئة البصمة','success');
}else if(type==='excuse'){
await apiCreate('leaveRequests', { employeeId: String(empId), startDate: date, endDate: date, status: 'approved', reason: 'عذر معتمد: ' + reason, requestDate: today(), requestedBy: STATE.currentUser?.id, approvedBy: STATE.currentUser?.id, approvedDate: today() });
toast('تم اعتماد العذر','success');
}else{
const withId=document.getElementById('attResWith')?.value;
if(!withId){ toast('اختر الموظف البديل','error'); return; }
const other=(STATE.employees||[]).find(e=>String(e.id)===String(withId));
await apiCreate('leaveRequests', { employeeId: String(empId), startDate: date, endDate: date, status: 'approved', reason: `تبديل وردية مع ${other?.name||withId}: ${reason}`, requestDate: today(), requestedBy: STATE.currentUser?.id, approvedBy: STATE.currentUser?.id, approvedDate: today() });
if(recordId){
const rec=STATE.attendance.find(a=>String(a.id)===String(recordId));
const audit=`[تبديل وردية ${today()} مع ${other?.name||withId} بواسطة ${who}: ${reason}]`;
await persistUpdate('attendance', recordId, { notes: [rec?.notes, audit].filter(Boolean).join(' | ') });
Object.assign(rec||{}, {});
}
toast('تم تسجيل التبديل','success');
}
closeModal(); await window.loadData().catch(()=>{}); renderPage();
const box=document.getElementById('attGapsBox'); if(box&&box.innerHTML) {attGapsRender();}
}catch(e){ toast(e.message||'تعذر الحفظ','error'); }finally{ hideLoad(); }
}
function attExcuseModal(empId){
  const emp = (STATE.employees || []).find(e => String(e.id) === String(empId));
  showModal(`<h3><i class=ji data-i=file-check></i> عذر إداري — ${esc(emp?.name || '')}</h3>
  <div class="fg"><label>التاريخ</label><input type="date" id="attExcDate" value="${today()}"></div>
  <div class="fg"><label>سبب العذر</label><input type="text" id="attExcReason" placeholder="مثال: ظرف عائلي / مأمورية عمل"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="attExcuseSave('${empId}')"><i class=ji data-i=save></i> اعتماد العذر</button></div>`);
}
async function attExcuseSave(empId){
  const date = document.getElementById('attExcDate')?.value || today();
  const reason = document.getElementById('attExcReason')?.value.trim();
  if(!reason){ toast('اكتب سبب العذر', 'error'); return; }
  showLoad();
  try{
    await apiCreate('leaveRequests', { employeeId: String(empId), startDate: date, endDate: date, status: 'approved', reason: 'عذر إداري: ' + reason, requestDate: today(), requestedBy: STATE.currentUser?.id, approvedBy: STATE.currentUser?.id, approvedDate: today() });
    closeModal(); await window.loadData().catch(() => {}); renderPage(); toast('تم اعتماد العذر', 'success');
  }catch(e){ toast(e.message || 'تعذر الحفظ', 'error'); }
  finally{ hideLoad(); }
}
// ─── تصحيح بصمة منسية (حضور/انصراف) باحترافية: سبب إجباري + توثيق + إعادة حساب ───
function attCorrectModal(recordId){
if(!['admin','manager','hr'].includes(STATE.currentUser?.role)){ toast('للإدارة فقط','error'); return; }
const rec=(STATE.attendance||[]).find(a=>String(a.id)===String(recordId));
if(!rec) {return;}
const emp=(STATE.employees||[]).find(e=>String(e.id)===String(rec.employeeId));
const missIn=!rec.checkIn, missOut=!rec.checkOut;
showModal(`
<h3><i class=ji data-i=pencil></i> تصحيح بصمة — ${esc(emp?.name||'')} <small class="text-muted">${esc(rec.date||'')}</small></h3>
<div class="mcard" style="margin-bottom:12px;line-height:2">الحالي: حضور <b class="c-green">${esc(rec.checkIn||'—')}</b> • انصراف <b class="c-red">${esc(rec.checkOut||'—')}</b><br><small class="text-muted">املى الخانة الناقصة فقط (أو عدّل الاتنين) — يُسجل اسمك وسببك في الملاحظات.</small></div>
<div class="fr">
<div class="fg"><label>بصمة الحضور ${missIn?'<span class="badge bdg-red">ناقصة</span>':''}</label><input type="time" id="attCorIn" value="${esc(rec.checkIn||'')}"></div>
<div class="fg"><label>بصمة الانصراف ${missOut?'<span class="badge bdg-red">ناقصة</span>':''}</label><input type="time" id="attCorOut" value="${esc(rec.checkOut||'')}"></div>
</div>
<div class="fg"><label>سبب التصحيح (إجباري)</label><input type="text" id="attCorReason" placeholder="مثال: نسي بصمة الدخول — تم التأكد من الكاميرات"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="attCorrectSave('${rec.id}')"><i class=ji data-i=save></i> اعتماد التصحيح</button></div>`);
}
async function attCorrectSave(recordId){
const rec=(STATE.attendance||[]).find(a=>String(a.id)===String(recordId));
if(!rec) {return;}
const ci=(document.getElementById('attCorIn')?.value||'').trim();
const co=(document.getElementById('attCorOut')?.value||'').trim();
const reason=(document.getElementById('attCorReason')?.value||'').trim();
const tm=/^([01]\d|2[0-3]):[0-5]\d$/;
if(!ci&&!co){ toast('أدخل بصمة واحدة على الأقل','error'); return; }
if((ci&&!tm.test(ci))||(co&&!tm.test(co))){ toast('صيغة الوقت HH:MM','error'); return; }
if(!reason){ toast('اكتب سبب التصحيح','error'); return; }
const toMin=t=>{ const m=String(t).match(/^(\d{2}):(\d{2})/); return Number(m[1])*60+Number(m[2]); };
let workMinutes=rec.workMinutes;
if(ci&&co){ let d=toMin(co)-toMin(ci); if(d<0) {d+=1440;} workMinutes=d; }
const emp=(STATE.employees||[]).find(e=>String(e.id)===String(rec.employeeId));
const shiftStart=String(emp?.shift_start||'').match(/^\d{2}:\d{2}/)?emp.shift_start:String(STATE.settings?.workStartHour??9).padStart(2,'0')+':00';
const late=ci?toMin(ci)>toMin(shiftStart)+15:!!rec.late; // سماحية 15 دقيقة (قرار المالك 2026-10-10)
const audit=`[تصحيح يدوي ${today()} بواسطة ${STATE.currentUser?.name||''}: ${reason}]`;
const notes=[rec.notes, audit].filter(Boolean).join(' | ');
showLoad();
try{
await persistUpdate('attendance', rec.id, { checkIn: ci||null, checkOut: co||null, workMinutes, late, notes });
Object.assign(rec, { checkIn: ci||null, checkOut: co||null, workMinutes, late, notes });
closeModal(); renderPage(); toast('تم اعتماد التصحيح','success');
}catch(e){ toast(e.message||'تعذر الحفظ','error'); }finally{ hideLoad(); }
}
async function checkInOutByScan(qrText){
let data;
try{ data = typeof qrText === 'string' ? JSON.parse(qrText) : qrText; }catch(e){ toast('الكود الممسوح غير صالح — استخدم بطاقة موظف صادرة من مطاعم الشرفه العالمي','error'); return; }
if(!data || (data.system!==CONFIG.APP_NAME && data.system!=='Karim ERP') || data.type!=='employee_card' || !data.token || !data.signature){ toast('الكود الممسوح غير صالح — استخدم بطاقة موظف صادرة من مطاعم الشرفه العالمي','error'); return; }
try{
const result = await apiFetch('/hr/attendance/scan', {method:'POST', body: JSON.stringify({qr_payload:data})});
const saved = result.record;
const idx = STATE.attendance.findIndex(a=>Number(a.id)===Number(saved.id));
if(idx>=0) {STATE.attendance[idx] = {...STATE.attendance[idx], ...saved};} else {STATE.attendance.push(saved);}
renderPage();
const actionLabel = result.action==='check_in' ? 'تسجيل حضور' : 'تسجيل انصراف';
toast(`${actionLabel}: ${result.employee.name} — ${result.record.checkIn||result.record.checkOut}`,'success');
addNotification(actionLabel, `${result.employee.name} سجّل ${result.action==='check_in'?'الحضور':'الانصراف'} عبر QR`, 'success');
}catch(e){ toast(e.message||'تعذر تسجيل حركة الحضور','error'); }
}
function scanAttendanceKiosk(){
openScanner({
title:'<i class=ji data-i=camera></i> مسح بطاقة موظف — تسجيل حضور/انصراف',
instruction:'اطلب من الموظف توجيه بطاقته (QR) نحو الكاميرا',
onDecode: checkInOutByScan
});
}
async function checkIn(){
// SPEC-employee-pwa-attendance-geofence-v1 (S5): البصمة الذاتية تمر حصريًا عبر
// مسار البوابة الآمن — Geofence + ساعة السيرفر + تدقيق كامل. الكتابة المباشرة
// عبر CRUD العام أُغلقت على السيرفر لأدوار الموظفين.
if (typeof window.mobileDoPunch === 'function') { return window.mobileDoPunch('in'); }
toast('البصمة الذاتية غير متاحة في هذه الجلسة — استخدم تطبيق الجوال','error');
}
async function checkOut(){
// SPEC-employee-pwa-attendance-geofence-v1 (S5): نفس المسار الآمن — المحرك
// الذكي يقرر الدخول/الانصراف وفق التسلسل، والسيرفر يفرض قيد المكان والزمن.
if (typeof window.mobileDoPunch === 'function') { return window.mobileDoPunch('out'); }
toast('البصمة الذاتية غير متاحة في هذه الجلسة — استخدم تطبيق الجوال','error');
}
function exportAttendanceExcel(){
const attFrom=STATE.attFrom||'', attTo=STATE.attTo||'';
const filtered=STATE.attendance.filter(a=>(!attFrom||a.date>=attFrom)&&(!attTo||a.date<=attTo));
const data=[['التاريخ','الموظف','الحضور','الانصراف','ساعات العمل','المصدر']];
filtered.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:a.employeeId-b.employeeId).forEach(a=>{
const emp=findEmployeeById(a.employeeId);
const krm=attRawHours(a);
const src=a.source==='device'?'بصمة':a.source==='qr'?'QR':a.source==='portal'?'كاميرا التطبيق':a.source==='backfill'?'أرشيف':'يدوي';
data.push([a.date,emp?.name||'',a.checkIn||'',a.checkOut||'',krm,src]);
});
const ws=XLSX.utils.aoa_to_sheet(data);
const wb=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,ws,'الحضور');
XLSX.writeFile(wb,`attendance_${attFrom}_to_${attTo}.xlsx`);
toast(`تم تصدير ${filtered.length} سجل`,'success');
}
// ============================================
// LEAVES
// ============================================
let leaveWorkflowData=[];
let leaveWorkflowLoaded=false;
let leaveWorkflowLoading=false;
const LEAVE_STAGE_LABELS={employee:'الموظف',direct_manager:'المدير المباشر',operations_manager:'مدير التشغيل (ملغاة)',general_manager:'المدير العام',hr:'شؤون العاملين'};
function leaveWorkflowStatusLabel(status){return {in_progress:'قيد الاعتماد',returned:'عاد للموظف للتعديل',completed:'معتمد نهائيًا',rejected:'مرفوض'}[status]||status||'غير محدد';}
function leaveWorkflowStatusClass(status){return {in_progress:'bdg-orange',returned:'bdg-purple',completed:'bdg-green',rejected:'bdg-red'}[status]||'bdg-orange';}
function renderLeaveWorkflowTimeline(leave){
  const events=Array.isArray(leave.events)?leave.events:[];const current=leave.current_stage||'direct_manager';
  const stages=['direct_manager','general_manager','hr'];
 return `<div class="leave-timeline">${stages.map((stage,index)=>{const event=events.find(e=>e.stage===stage&&['approve','reject','return'].includes(e.action));const reached=events.some(e=>e.stage===stage);const active=current===stage&&leave.workflow_status==='in_progress';return `<div class="leave-step ${active?'active':reached?'done':''}"><div class="leave-step-dot">${reached&&!active?'<i class=ji data-i=circle-check></i>':index+1}</div><div><strong>${LEAVE_STAGE_LABELS[stage]}</strong><small>${active?'متوقف هنا':event?.action==='approve'?'تمت الموافقة':event?.action==='reject'?'مرفوض':event?.action==='return'?'أعيد للموظف':'بانتظار الإجراء'}</small>${event?.note?`<em>${esc(event.note)}</em>`:''}</div></div>`;}).join('')}</div>`;
}
async function refreshLeaveWorkflow(){if(leaveWorkflowLoading){return;}leaveWorkflowLoading=true;try{leaveWorkflowData=await apiFetch('/hr/leave-workflow');leaveWorkflowLoaded=true;renderPage();}catch(e){toast(e.message||'تعذر تحميل مسار الإجازات','error')}finally{leaveWorkflowLoading=false;}}
function workflowForLeave(id){return leaveWorkflowData.find(l=>String(l.id)===String(id))||STATE.leaveRequests.find(l=>String(l.id)===String(id));}
function leaveCanAct(leave){if(!leave||leave.workflow_status!=='in_progress'){return false;}const role=STATE.currentUser?.role;if(role==='admin'){return true;}if(role==='hr'&&leave.current_stage==='hr'){return true;}if(role==='manager'&&['direct_manager','general_manager'].includes(leave.current_stage)){return true;}if(role==='dept_head'&&leave.current_stage==='direct_manager'){return true;}return false;}
function renderLeavesPage(){
 const isPrivileged=['admin','hr','manager'].includes(STATE.currentUser.role);if(!leaveWorkflowLoaded&&!leaveWorkflowLoading){setTimeout(refreshLeaveWorkflow,0);}
 const leavesToShow=leaveWorkflowLoaded?leaveWorkflowData:STATE.leaveRequests;const pendingCount=leavesToShow.filter(l=>l.workflow_status==='in_progress'||(!l.workflow_status&&l.status==='pending')).length;
 return `<div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=calendar></i> ${t('lv.total')}</div><div class="mcard-val c-gold">${fN(leavesToShow.length)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=hourglass></i> ${t('lv.pending')}</div><div class="mcard-val c-orange">${fN(pendingCount)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> ${t('lv.approved')}</div><div class="mcard-val c-green">${fN(leavesToShow.filter(l=>l.workflow_status==='completed'||l.status==='approved').length)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-x></i> مرفوضة</div><div class="mcard-val c-red">${fN(leavesToShow.filter(l=>l.workflow_status==='rejected'||l.status==='rejected').length)}</div></div></div><div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=calendar></i> دورة اعتماد الإجازات</h3><button class="btn btn-gold" onclick="showAddLeaveModal()"><i class=ji data-i=plus></i> طلب إجازة</button></div><div class="workflow-banner"><strong><i class=ji data-i=git-branch></i> مسار الاعتماد:</strong> الموظف ← المدير المباشر (رئيس القسم) ← المدير العام ← شؤون العاملين (تقفل الطلب)</div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> متابعة الطلبات</h3><small class="text-muted">المرحلة الحالية والملاحظات والإجراء المطلوب تظهر في كل طلب.</small></div><div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>نوع الإجازة</th><th>الفترة</th><th>المرحلة الحالية</th><th>الحالة</th><th>آخر ملاحظة</th><th>إجراءات</th></tr></thead><tbody>${leavesToShow.slice().reverse().map(l=>{const emp=findEmployeeById(l.employeeId);const type=STATE.leaveTypes.find(t=>String(t.id)===String(l.leaveTypeId));const days=Math.ceil((new Date(l.endDate)-new Date(l.startDate))/86400000)+1;const canAct=leaveCanAct(l);return `<tr><td class="fw-bold">${esc(l.employee_name||emp?.name||'—')}</td><td>${l.leave_type_icon||type?.icon||''} ${esc(l.leave_type_name||type?.name||'—')}</td><td>${fD(l.startDate)} — ${fD(l.endDate)}<small class="text-muted" style="display:block">${days} يوم</small></td><td><span class="badge ${canAct?'bdg-blue':'bdg-purple'}">${LEAVE_STAGE_LABELS[l.current_stage]||'—'}</span></td><td><span class="badge ${leaveWorkflowStatusClass(l.workflow_status||l.status)}">${leaveWorkflowStatusLabel(l.workflow_status||l.status)}</span></td><td class="u-maxw-260">${esc(l.current_note||l.reason||'—')}</td><td style="display:flex;gap:5px;flex-wrap:wrap">${canAct?`<button class="btn btn-green btn-sm" onclick="advanceLeaveWorkflow('${l.id}','approve')"><i class=ji data-i=circle-check></i> اعتماد</button><button class="btn btn-red btn-sm" onclick="advanceLeaveWorkflow('${l.id}','reject')"><i class=ji data-i=circle-x></i> رفض</button><button class="btn btn-sm" onclick="advanceLeaveWorkflow('${l.id}','return')"><i class=ji data-i=corner-up-left></i> إعادة</button>`:''}<button class="btn btn-blue btn-sm" onclick="viewLeaveDetails('${l.id}')"><i class=ji data-i=eye></i> عرض</button></td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد طلبات</td></tr>'}</tbody></table></div></div>`;
}
function showAddLeaveModal(){
const isAdmin=['admin','hr','manager'].includes(STATE.currentUser.role);
let empOptions='';
if(isAdmin){
empOptions=STATE.employees.filter(e=>e.status==='active').map(e=>`<option value="${e.id}">${esc(e.name)}</option>`).join('');
}else{
const emp=STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(!emp){ toast('لم يتم ربط حسابك بملف موظف','error'); return; }
empOptions=`<option value="${emp.id}">${esc(emp.name)}</option>`;
}
const typeOptions=STATE.leaveTypes.map(t=>`<option value="${t.id}">${t.icon} ${esc(t.name)} (${t.days} يوم)</option>`).join('');
showModal(`
<h3><i class=ji data-i=plus></i> طلب إجازة جديدة</h3>
<div class="fr">
<div class="fg"><label>الموظف</label><select id="leaveEmp">${empOptions}</select></div>
<div class="fg"><label>نوع الإجازة</label><select id="leaveType">${typeOptions}</select></div>
</div>
<div class="fr">
<div class="fg"><label>من تاريخ</label><input type="date" id="leaveStart" value="${today()}"></div>
<div class="fg"><label>إلى تاريخ</label><input type="date" id="leaveEnd" value="${today()}"></div>
</div>
<div class="fg"><label>السبب</label><textarea id="leaveReason" rows="3"></textarea></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="addLeaveRequest()"><i class=ji data-i=save></i> إرسال الطلب</button>
</div>
`);
}
async function addLeaveRequest(){
 const employeeId=document.getElementById('leaveEmp')?.value,leaveTypeId=parseInt(document.getElementById('leaveType')?.value),startDate=document.getElementById('leaveStart')?.value,endDate=document.getElementById('leaveEnd')?.value,reason=document.getElementById('leaveReason')?.value.trim();
 if(!employeeId||!leaveTypeId||!startDate||!endDate){toast('أكمل جميع الحقول المطلوبة','error');return;}
 if(new Date(endDate)<new Date(startDate)){toast('تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية','error');return;}
 try{showLoad();const result=await apiFetch('/hr/leave-requests',{method:'POST',body:JSON.stringify({employeeId:Number(employeeId),leaveTypeId,startDate,endDate,reason})});closeModal();leaveWorkflowLoaded=false;await refreshLeaveWorkflow();toast(`تم إرسال الطلب، وهو الآن لدى ${LEAVE_STAGE_LABELS[result.workflow?.current_stage||'direct_manager']}`,'success');addNotification('طلب إجازة','تم إرسال طلب إجازة جديد إلى المدير المباشر','info');}catch(e){toast(e.message||'تعذر إرسال طلب الإجازة','error')}finally{hideLoad();}
}
async function advanceLeaveWorkflow(id,action,noteOverride=null){
 let note=noteOverride;
 if(note===null){const prompts={approve:'ملاحظة الاعتماد (اختياري):',reject:'اكتب سبب الرفض:',return:'اكتب الملاحظة المطلوبة من الموظف:'};note=prompt(prompts[action]||'الملاحظة (اختياري):');if(action!=='approve'&&!note){return;}}
 try{showLoad();const result=await apiFetch(`/hr/leave-workflow/${id}/action`,{method:'POST',body:JSON.stringify({action,note:note||''})});await refreshLeaveWorkflow();toast(result.event_label||'تم تحديث مسار الإجازة',action==='reject'?'warning':'success');}catch(e){toast(e.message||'تعذر تنفيذ الإجراء','error')}finally{hideLoad();}
}
async function approveLeave(id){return advanceLeaveWorkflow(id,'approve');}
async function rejectLeave(id){return advanceLeaveWorkflow(id,'reject');}
async function returnLeaveToEmployee(id){return advanceLeaveWorkflow(id,'return');}
function viewLeaveDetails(id){
 const leave=workflowForLeave(id);if(!leave){toast('طلب الإجازة غير موجود','error');return;}
 const emp=findEmployeeById(leave.employeeId),type=STATE.leaveTypes.find(t=>String(t.id)===String(leave.leaveTypeId)),days=Math.ceil((new Date(leave.endDate)-new Date(leave.startDate))/86400000)+1;
 showModal(`<h3><i class=ji data-i=git-branch></i> مسار طلب الإجازة</h3><div class="fr"><div class="details-item"><strong>الموظف:</strong><div>${esc(leave.employee_name||emp?.name||'—')}</div></div><div class="details-item"><strong>نوع الإجازة:</strong><div>${leave.leave_type_icon||type?.icon||''} ${esc(leave.leave_type_name||type?.name||'—')}</div></div></div><div class="fr"><div class="details-item"><strong>الفترة:</strong><div>${fD(leave.startDate)} — ${fD(leave.endDate)}</div></div><div class="details-item"><strong>عدد الأيام:</strong><div class="c-gold fw-bold">${days} يوم</div></div></div><div class="details-item"><strong>السبب:</strong><div>${esc(leave.reason||'—')}</div></div><div class="workflow-banner"><strong>متوقف حاليًا لدى: ${esc(LEAVE_STAGE_LABELS[leave.current_stage]||'—')}</strong><br><span>${esc(leave.current_note||'لا توجد ملاحظات')}</span></div>${renderLeaveWorkflowTimeline(leave)}<div class="tbl-wrap u-mt12"><div class="tbl-hd"><h3><i class=ji data-i=clock></i> سجل الإجراءات والملاحظات</h3></div><div class="tbl-scroll"><table><thead><tr><th>التاريخ</th><th>المرحلة</th><th>الإجراء</th><th>الملاحظة</th></tr></thead><tbody>${(leave.events||[]).map(e=>`<tr><td>${fD(e.created_at)}</td><td>${esc(LEAVE_STAGE_LABELS[e.stage]||e.stage)}</td><td>${esc({submitted:'تقديم',approve:'اعتماد',reject:'رفض',return:'إعادة للموظف',resubmit:'إعادة إرسال'}[e.action]||e.action)}</td><td>${esc(e.note||'—')}</td></tr>`).join('')||'<tr><td colspan="4">لا يوجد سجل إجراءات</td></tr>'}</tbody></table></div></div><div class="modal-footer"><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
}
// ============================================
// HR DEPARTMENTS
// ============================================
function renderHRDepartmentsPage(){
return `
<div class="u-row-between">
<h3 class="u-gold-strong"><i class=ji data-i=building></i> أقسام HR</h3>
<button class="btn btn-gold" onclick="showAddHRDeptModal()"><i class=ji data-i=plus></i> إضافة قسم</button>
</div>
<div class="dept-grid">
${STATE.hrDepartments.map(dept=>{
const empCount=STATE.employees.filter(e=>e.department===dept.code).length;
return `
<div class="dept-card">
<div class="dept-hd">
<span class="dept-ic"><i class=ji data-i=building></i></span>
<div class="dept-info">
<div class="dept-name">${esc(dept.name)}</div>
<div class="dept-code">${dept.code}</div>
</div>
<span class="badge bdg-gold">${empCount} موظف</span>
</div>
<div class="details-item u-mt12">
<strong>المدير:</strong>
<div>${esc(dept.manager||'—')}</div>
</div>
<div class="u-footer-sep">
<button class="btn btn-sm u-flex1" onclick="editHRDept('${dept.code}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-red btn-sm u-flex1" onclick="deleteHRDept('${dept.code}')"><i class=ji data-i=trash></i> حذف</button>
</div>
</div>
`;
}).join('')||'<div class="mcard u-empty-grid">لا توجد أقسام</div>'}
</div>
`;
}
function showAddHRDeptModal(){
showModal(`
<h3><i class=ji data-i=plus></i> ${t('hrd.add')}</h3>
<div class="fr">
<div class="fg"><label>${t('hrd.name')}</label><input type="text" id="hrDeptName"></div>
<div class="fg"><label>${t('hrd.code')}</label><input type="text" id="hrDeptCode" maxlength="10"></div>
</div>
<div class="fg"><label>${t('hrd.manager')}</label><input type="text" id="hrDeptManager"></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">${t('act.cancel')}</button>
<button class="btn btn-gold" onclick="addHRDept()"><i class=ji data-i=save></i> ${t('act.save')}</button>
</div>
`);
}
async function addHRDept(){
const name=document.getElementById('hrDeptName')?.value.trim();
const code=document.getElementById('hrDeptCode')?.value.trim().toUpperCase();
const manager=document.getElementById('hrDeptManager')?.value.trim();
if(!name||!code){ toast('أدخل الاسم والكود','error'); return; }
if(STATE.hrDepartments.find(d=>d.code===code)){ toast('الكود موجود بالفعل','error'); return; }
// FIX 2026-10-01: الكود هو مفتاح الربط مع حسابات رؤساء الأقسام (dept_code) —
// كود عربي/فارغ يكسر فلترة موظفي القسم للأبد (حالة قسم الاستيورد). نولّد كودًا
// لاتينيًا آمنًا تلقائيًا إن كان فارغًا أو يحوي أحرف غير لاتينية.
if(!code || /[^A-Za-z0-9_-]/.test(code)){ code = 'HRD-' + Date.now().toString(36).toUpperCase().slice(-6); }
await persistCreate('hrDepartments', (saved)=>STATE.hrDepartments.push(saved), {name,code,manager});
closeModal(); renderPage();
toast('تم إضافة القسم','success');
}
function editHRDept(code){
const dept=STATE.hrDepartments.find(d=>d.code===code);
if(!dept){return;}
showModal(`
<h3><i class=ji data-i=pencil></i> ${t('hrd.edit')}</h3>
<div class="fg"><label>${t('hrd.name')}</label><input type="text" id="hrDeptName" value="${esc(dept.name)}"></div>
<div class="fg"><label>${t('hrd.manager')}</label><input type="text" id="hrDeptManager" value="${esc(dept.manager||'')}"></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">${t('act.cancel')}</button>
<button class="btn btn-gold" onclick="updateHRDept('${code}')"><i class=ji data-i=save></i> ${t('act.save')}</button>
</div>
`);
}
async function updateHRDept(code){
const dept=STATE.hrDepartments.find(d=>d.code===code);
if(!dept){return;}
const name=document.getElementById('hrDeptName')?.value.trim();
const manager=document.getElementById('hrDeptManager')?.value.trim();
await persistUpdate('hrDepartments', dept.id, {name,manager});
Object.assign(dept, {name,manager});
closeModal(); renderPage();
toast('تم التحديث','success');
}
async function deleteHRDept(code){
if(!confirm('حذف هذا القسم؟')){return;}
const dept=STATE.hrDepartments.find(d=>d.code===code);
if(dept) {await persistRemove('hrDepartments', dept.id);}
STATE.hrDepartments=STATE.hrDepartments.filter(d=>d.code!==code);
renderPage();
toast('تم الحذف','warning');
}
// ============================================
// PAYROLL
// ============================================
function renderPayroll(){
const totalSalaries=STATE.employees.filter(e=>e.status==='active').reduce((s,e)=>s+(e.salary||0),0);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('pay.total')}</div><div class="mcard-val c-gold">${fC(totalSalaries)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> ${t('pay.eligible')}</div><div class="mcard-val c-blue">${fN(STATE.employees.filter(e=>e.status==='active').length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('pay.avg')}</div><div class="mcard-val c-green">${fC(STATE.employees.filter(e=>e.status==='active').length>0?totalSalaries/STATE.employees.filter(e=>e.status==='active').length:0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=calendar></i> ${t('pay.curMonth')}</div><div class="mcard-val c-purple">${new Date().toLocaleDateString(STATE.lang==='en'?'en-US':'ar-EG',{month:'long',year:'numeric'})}</div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd">
<h3><i class=ji data-i=banknote></i> ${t('pay.sheet')}</h3>
<button class="btn btn-blue btn-sm" onclick="exportPayrollExcel()"><i class=ji data-i=inbox></i> ${t('act.export')}</button>
</div>
<div class="tbl-scroll">
<table>
<thead><tr><th>${t('pay.emp')}</th><th>${t('pay.dept')}</th><th>${t('pay.position')}</th><th>${t('pay.basic')}</th><th>${t('pay.days')}</th><th>${t('pay.net')}</th></tr></thead>
<tbody>
${STATE.employees.filter(e=>e.status==='active').map(emp=>{
const dept=STATE.hrDepartments.find(d=>d.code===emp.department);
const attendanceCount=STATE.attendance.filter(a=>a.employeeId===emp.id&&a.checkIn&&new Date(a.date).getMonth()===new Date().getMonth()).length;
return `<tr>
<td class="fw-bold">${esc(emp.name)}</td>
<td>${dept?esc(dept.name):'—'}</td>
<td>${esc(emp.position||'—')}</td>
<td class="c-gold">${fC(emp.salary||0)}</td>
<td class="c-blue">${attendanceCount} ${t('pay.day')}</td>
<td class="c-green fw-bold">${fC(emp.salary||0)}</td>
</tr>`;
}).join('')||'<tr><td colspan="6" class="u-empty">لا يوجد موظفون</td></tr>'}
</tbody>
<tfoot>
<tr>
<td colspan="3" class="u-num-l"><i class=ji data-i=banknote></i> الإجمالي</td>
<td class="c-gold fw-bold">${fC(totalSalaries)}</td>
<td colspan="2"></td>
</tr>
</tfoot>
</table>
</div>
</div>
${hrSuiteSection()}
`;
}
// ─── منظومة HR: مسيرات + سلف + جزاءات/علاوات + عقود + تقييم ───
function hrSuiteSection(){
  const canWrite = ['admin','manager','hr'].includes(STATE.currentUser?.role);
  const curMonth = new Date().toISOString().slice(0, 7);
  const runs = (STATE.payroll_runs || []).slice().sort((a, b) => String(b.month).localeCompare(String(a.month))).slice(0, 6);
  const empName = (id) => { const e = (STATE.employees || []).find(x => String(x.id) === String(id)); return e ? e.name : '#' + id; };
  const kindAr = { penalty: 'جزاء', bonus: 'علاوة', deduction: 'خصم', allowance: 'بدل' };
  return `
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=banknote></i> توليد مسير الرواتب</h3>
  <div class="u-row-wrap"><input type="month" id="payrunMonth" value="${curMonth}">${canWrite ? `<button class="btn btn-blue btn-sm" onclick="hrDeductionsModal()"><i class=ji data-i=gavel></i> معالجة خصومات الالتزام</button><button class="btn btn-gold btn-sm" onclick="runPayrollGen()"><i class=ji data-i=zap></i> توليد المسير</button>` : ''}</div></div>
  <div class="tbl-scroll"><table><thead><tr><th>الشهر</th><th>الموظفون</th><th>الأساسي</th><th>أوفرتايم</th><th>علاوات</th><th>جزاءات</th><th>سلف</th><th>الصافي</th></tr></thead><tbody>
  ${runs.map(r => `<tr><td class="fw-bold">${esc(r.month)}</td><td>${r.employee_count}</td><td>${fC(r.total_basic)}</td><td class="c-green">${fC(r.total_overtime)}</td><td class="c-green">${fC(r.total_bonuses)}</td><td class="c-red">${fC(r.total_penalties)}</td><td class="c-red">${fC(r.total_advances)}</td><td class="c-gold fw-bold">${fC(r.total_net)}</td></tr>`).join('') || '<tr><td colspan="8" class="u-empty-sm">لا مسيرات مولدة بعد</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=wallet></i> السلف (${(STATE.salary_advances || []).length})</h3>${canWrite ? `<button class="btn btn-gold btn-sm" onclick="hrAdvanceModal()"><i class=ji data-i=plus></i> سلفة</button>` : ''}</div>
  <div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>المبلغ</th><th>القسط الشهري</th><th>المتبقي</th><th>الحالة</th><th>التاريخ</th>${canWrite ? '<th></th>' : ''}</tr></thead><tbody>
  ${(STATE.salary_advances || []).slice().reverse().slice(0, 30).map(a => `<tr><td class="fw-bold">${esc(empName(a.employeeId))}</td><td>${fC(a.amount)}</td><td>${fC(a.monthly_deduction)}</td><td class="c-red fw-bold">${fC(a.remaining)}</td><td>${a.status === 'active' ? '<span class="badge bdg-green">نشطة</span>' : '<span class="badge">مغلقة</span>'}</td><td class="text-muted">${fD(a.date)}</td>${canWrite ? `<td><button class="btn btn-red btn-sm" onclick="hrDelete('salary_advances','${a.id}')"><i class=ji data-i=trash></i></button></td>` : ''}</tr>`).join('') || '<tr><td colspan="7" class="u-empty-sm">لا سلف</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=gavel></i> جزاءات وعلاوات الشهر</h3>${canWrite ? `<button class="btn btn-gold btn-sm" onclick="hrAdjustModal()"><i class=ji data-i=plus></i> بند</button>` : ''}</div>
  <div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>الشهر</th><th>النوع</th><th>المبلغ</th><th>السبب</th>${canWrite ? '<th></th>' : ''}</tr></thead><tbody>
  ${(STATE.payroll_adjustments || []).slice().reverse().slice(0, 30).map(a => `<tr><td class="fw-bold">${esc(empName(a.employeeId))}</td><td>${esc(a.month)}</td><td><span class="badge ${a.kind === 'penalty' || a.kind === 'deduction' ? 'bdg-red' : 'bdg-green'}">${kindAr[a.kind] || a.kind}</span></td><td>${fC(a.amount)}</td><td class="text-muted">${esc(a.reason || '—')}</td>${canWrite ? `<td><button class="btn btn-red btn-sm" onclick="hrDelete('payroll_adjustments','${a.id}')"><i class=ji data-i=trash></i></button></td>` : ''}</tr>`).join('') || '<tr><td colspan="6" class="u-empty-sm">لا بنود</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=file-text></i> العقود (الأقرب انتهاءً)</h3>${canWrite ? `<button class="btn btn-gold btn-sm" onclick="hrContractModal()"><i class=ji data-i=plus></i> عقد</button>` : ''}</div>
  <div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>من</th><th>إلى</th><th>الحالة</th>${canWrite ? '<th></th>' : ''}</tr></thead><tbody>
  ${(STATE.employee_contracts || []).slice().sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).slice(0, 30).map(k => { const left = Math.ceil((new Date(k.end_date) - new Date()) / 86400000); return `<tr><td class="fw-bold">${esc(empName(k.employeeId))}</td><td>${fD(k.start_date)}<br><small class="text-muted">${fHijri(k.start_date)}</small></td><td>${fD(k.end_date)}<br><small class="text-muted">${fHijri(k.end_date)}</small></td><td>${left < 0 ? '<span class="badge bdg-red">منتهٍ</span>' : left <= 30 ? `<span class="badge bdg-orange">متبقٍ ${left} يوم</span>` : '<span class="badge bdg-green">سارٍ</span>'}</td>${canWrite ? `<td><button class="btn btn-red btn-sm" onclick="hrDelete('employee_contracts','${k.id}')"><i class=ji data-i=trash></i></button></td>` : ''}</tr>`; }).join('') || '<tr><td colspan="5" class="u-empty-sm">لا عقود</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=star></i> التقييمات</h3>${canWrite ? `<button class="btn btn-gold btn-sm" onclick="hrEvalModal()"><i class=ji data-i=plus></i> تقييم</button>` : ''}</div>
  <div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>الفترة</th><th>التقييم</th><th>ملاحظات</th>${canWrite ? '<th></th>' : ''}</tr></thead><tbody>
  ${(STATE.employee_evaluations || []).slice().reverse().slice(0, 30).map(v => `<tr><td class="fw-bold">${esc(empName(v.employeeId))}</td><td>${esc(v.period)}</td><td>${'★'.repeat(Number(v.score) || 0)}${'☆'.repeat(5 - (Number(v.score) || 0))}</td><td class="text-muted">${esc(v.notes || '—')}</td>${canWrite ? `<td><button class="btn btn-red btn-sm" onclick="hrDelete('employee_evaluations','${v.id}')"><i class=ji data-i=trash></i></button></td>` : ''}</tr>`).join('') || '<tr><td colspan="5" class="u-empty-sm">لا تقييمات</td></tr>'}
  </tbody></table></div></div>`;
}
function hrEmpOptions(sel){
  return (STATE.employees || []).filter(e => e.status === 'active').map(e => `<option value="${e.id}" ${String(sel) === String(e.id) ? 'selected' : ''}>${esc(e.name)} — ${esc(e.employeeId || '')}</option>`).join('');
}
async function runPayrollGen(){
  const m = document.getElementById('payrunMonth')?.value || '';
  if(!/^\d{4}-\d{2}$/.test(m)){ toast('اختر الشهر', 'error'); return; }
  const incOt = confirm('توليد مسير الرواتب؟\n\nسيُحسب الأساسي فقط (بدون أوفرتايم).\n\nاضغط "موافق" لإضافة الأوفرتايم من البصمات.\nاضغط "إلغاء" للمسير بالأساسي فقط.');
  if(!confirm(`توليد مسير رواتب ${m}؟ سيُحسب الأساسي + الأوفرتايم من البصمات + العلاوات − الجزاءات − أقساط السلف.`)) {return;}
  showLoad();
  try{
    const r = await apiFetch('/hr/payroll-runs/generate', { method: 'POST', body: JSON.stringify({ month: m, includeOvertime: incOt }) });
    await window.loadData().catch(() => {});
    renderPage();
    toast(`مسير ${m}: ${r.count} موظف — الصافي ${fC(r.totals.net)}`, 'success');
  }catch(e){ toast(e.message || 'تعذر التوليد', 'error'); }
  finally{ hideLoad(); }
}
async function hrDelete(entity, id){
  if(!confirm('حذف هذا البند؟')) {return;}
  showLoad();
  try{ await apiRemove(entity, id); await window.loadData().catch(() => {}); renderPage(); toast('تم الحذف', 'warning'); }
  catch(e){ toast(e.message || 'تعذر الحذف', 'error'); }
  finally{ hideLoad(); }
}
// ─── معالجة خصومات الالتزام بالدوام: معاينة من البصمات ثم تطبيق آلي ───
function hrDeductionsModal(){
  const curMonth = new Date().toISOString().slice(0, 7);
  showModal(`<h3><i class=ji data-i=gavel></i> معالجة خصومات الالتزام بالدوام</h3>
  <div class="u-row-wrap" style="gap:8px;align-items:center">
  <input type="month" id="hrDedMonth" value="${curMonth}">
  <label style="font-size:13px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="hrDedSkipFri"> استثناء الجمعة</label>
  <button class="btn btn-blue btn-sm" onclick="hrDeductionsPreview()"><i class=ji data-i=search></i> معاينة</button>
  </div>
  <div id="hrDedBody" class="u-mt12"><div class="text-muted">اختر الشهر واضغط «معاينة» — يُحسب التأخير والغياب من البصمات مع استبعاد أيام الإجازات المعتمدة.</div></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" id="hrDedApplyBtn" onclick="hrDeductionsApply()" style="display:none"><i class=ji data-i=zap></i> تطبيق الخصومات</button></div>`);
}
async function hrDeductionsPreview(){
  const m = document.getElementById('hrDedMonth')?.value || '';
  if(!/^\d{4}-\d{2}$/.test(m)){ toast('اختر الشهر', 'error'); return; }
  const skipFri = document.getElementById('hrDedSkipFri')?.checked ? '1' : '0';
  const box = document.getElementById('hrDedBody');
  if(!box){ return; }
  box.innerHTML = '<div class="text-muted">جارٍ الحساب من البصمات...</div>';
  try{
    const r = await apiFetch(`/hr/deductions/preview?month=${encodeURIComponent(m)}&skip_fridays=${skipFri}`);
    window.__hrDedPreview = r;
    const rows = (r.employees || []).filter(e => e.totalDeduction > 0).map(e => `<tr>
      <td class="fw-bold">${esc(e.name)}</td><td>${fC(e.salary)}</td><td>${e.daysPresent}</td>
      <td class="c-red">${e.lateMinutes} د</td><td class="c-red fw-bold">${fC(e.lateDeduction)}</td>
      <td class="c-red">${e.absentDays}</td><td class="c-red fw-bold">${fC(e.absentDeduction)}</td>
      <td class="c-gold fw-bold">${fC(e.totalDeduction)}</td></tr>`).join('');
    box.innerHTML = `<div class="u-mb8" style="display:flex;gap:10px;flex-wrap:wrap">
      <span class="badge bdg-red">خصم التأخير: ${fC(r.totals?.late)}</span>
      <span class="badge bdg-orange">خصم الغياب: ${fC(r.totals?.absent)}</span>
      <span class="badge bdg-gold">الإجمالي: ${fC(r.totals?.total)}</span>
      <span class="badge">موظفون به خصومات: ${(r.employees || []).filter(e => e.totalDeduction > 0).length}</span></div>
    <div class="tbl-scroll" style="max-height:320px"><table>
    <thead><tr><th>الموظف</th><th>الراتب</th><th>أيام حضور</th><th>تأخير</th><th>خصم التأخير</th><th>غياب</th><th>خصم الغياب</th><th>الإجمالي</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="8" class="u-empty-sm">لا خصومات — كل الموظفين ملتزمون بدوامهم 👌</td></tr>'}</tbody></table></div>
    <small class="text-muted">السياسة: يوم الغياب = الراتب÷30 • دقيقة التأخير = الراتب÷30÷ساعات الوردية • الإجازات المعتمدة مستثناة${r.skipFridays ? ' • الجمعة مستثناة' : ''}</small>`;
    const btn = document.getElementById('hrDedApplyBtn');
    if(btn){ btn.style.display = ''; }
  }catch(e){ box.innerHTML = `<div style="color:#c0392b">${esc(e.message || 'تعذر جلب المعاينة')}</div>`; }
}
async function hrDeductionsApply(){
  const r = window.__hrDedPreview;
  if(!r?.month){ toast('اعمل معاينة أولًا', 'error'); return; }
  if(!confirm(`تطبيق خصومات الالتزام لشهر ${r.month}؟\nالإجمالي: ${fC(r.totals?.total)}\n\nيُستبدل أي تطبيق آلي سابق لنفس الشهر — البنود اليدوية لا تُمس.`)) { return; }
  showLoad();
  try{
    const skipFri = document.getElementById('hrDedSkipFri')?.checked === true;
    const res = await apiFetch('/hr/deductions/apply', { method: 'POST', body: JSON.stringify({ month: r.month, skipFridays: skipFri }) });
    await window.loadData().catch(() => {});
    closeModal();
    renderPage();
    toast(`تم تطبيق ${res.insertedRows} بند خصم — إجمالي ${fC(res.totalAmount)} (ستظهر في «جزاءات وعلاوات الشهر» وتُخصم عند توليد المسير)`, 'success');
  }catch(e){ toast(e.message || 'تعذر تطبيق الخصومات', 'error'); }
  finally{ hideLoad(); }
}
function hrAdvanceModal(){
  showModal(`<h3><i class=ji data-i=wallet></i> سلفة جديدة</h3>
  <div class="fg"><label>الموظف</label><select id="hrAdvEmp">${hrEmpOptions()}</select></div>
  <div class="fr"><div class="fg"><label>المبلغ</label><input type="number" id="hrAdvAmt" step="0.01"></div>
  <div class="fg"><label>القسط الشهري (0 = خصم كامل عند أول توليد)</label><input type="number" id="hrAdvInst" step="0.01" value="0"></div></div>
  <div class="fg"><label>التاريخ</label><input type="date" id="hrAdvDate" value="${today()}"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="hrAdvanceSave()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function hrAdvanceSave(){
  const employeeId = Number(document.getElementById('hrAdvEmp')?.value);
  const amount = parseFloat(document.getElementById('hrAdvAmt')?.value);
  const monthly_deduction = parseFloat(document.getElementById('hrAdvInst')?.value) || 0;
  const date = document.getElementById('hrAdvDate')?.value;
  if(!employeeId || !(amount > 0) || !date){ toast('أكمل البيانات', 'error'); return; }
  showLoad();
  try{
    await apiCreate('salary_advances', { employeeId, amount, monthly_deduction, remaining: amount, status: 'active', date });
    closeModal(); await window.loadData().catch(() => {}); renderPage(); toast('تم تسجيل السلفة', 'success');
  }catch(e){ toast(e.message || 'تعذر الحفظ', 'error'); }
  finally{ hideLoad(); }
}
function hrAdjustModal(preEmp, preMonth, preKind){
  const kinds = [['penalty', 'جزاء'], ['bonus', 'علاوة'], ['deduction', 'خصم'], ['allowance', 'بدل']];
  showModal(`<h3><i class=ji data-i=gavel></i> بند جزاء / علاوة</h3>
  <div class="fr"><div class="fg"><label>الموظف</label><select id="hrAdjEmp">${hrEmpOptions(preEmp)}</select></div>
  <div class="fg"><label>الشهر</label><input type="month" id="hrAdjMonth" value="${preMonth || new Date().toISOString().slice(0, 7)}"></div></div>
  <div class="fr"><div class="fg"><label>النوع</label><select id="hrAdjKind">${kinds.map(([v, l]) => `<option value="${v}" ${preKind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
  <div class="fg"><label>المبلغ</label><input type="number" id="hrAdjAmt" step="0.01"></div></div>
  <div class="fg"><label>السبب</label><input type="text" id="hrAdjReason"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="hrAdjustSave()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function hrAdjustSave(){
  const employeeId = Number(document.getElementById('hrAdjEmp')?.value);
  const month = document.getElementById('hrAdjMonth')?.value || '';
  const kind = document.getElementById('hrAdjKind')?.value;
  const amount = parseFloat(document.getElementById('hrAdjAmt')?.value);
  const reason = document.getElementById('hrAdjReason')?.value.trim();
  if(!employeeId || !/^\d{4}-\d{2}$/.test(month) || !(amount > 0)){ toast('أكمل البيانات', 'error'); return; }
  showLoad();
  try{
    await apiCreate('payroll_adjustments', { employeeId, month, kind, amount, reason });
    closeModal(); await window.loadData().catch(() => {}); renderPage(); toast('تم تسجيل البند', 'success');
  }catch(e){ toast(e.message || 'تعذر الحفظ', 'error'); }
  finally{ hideLoad(); }
}
function hrContractModal(){
  showModal(`<h3><i class=ji data-i=file-text></i> عقد عمل</h3>
  <div class="fg"><label>الموظف</label><select id="hrConEmp">${hrEmpOptions()}</select></div>
  <div class="fr"><div class="fg"><label>من (ميلادي)</label><input type="date" id="hrConFrom" value="${today()}"></div>
  <div class="fg"><label>إلى (ميلادي)</label><input type="date" id="hrConTo"></div></div>
  <div class="fg"><label>الراتب التعاقدي</label><input type="number" id="hrConSalary" step="0.01"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="hrContractSave()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function hrContractSave(){
  const employeeId = Number(document.getElementById('hrConEmp')?.value);
  const start_date = document.getElementById('hrConFrom')?.value;
  const end_date = document.getElementById('hrConTo')?.value;
  const salary = parseFloat(document.getElementById('hrConSalary')?.value) || 0;
  if(!employeeId || !start_date || !end_date || end_date < start_date){ toast('تواريخ غير صالحة', 'error'); return; }
  showLoad();
  try{
    await apiCreate('employee_contracts', { employeeId, start_date, end_date, salary });
    closeModal(); await window.loadData().catch(() => {}); renderPage(); toast('تم حفظ العقد', 'success');
  }catch(e){ toast(e.message || 'تعذر الحفظ', 'error'); }
  finally{ hideLoad(); }
}
function hrEvalModal(){
  showModal(`<h3><i class=ji data-i=star></i> تقييم أداء</h3>
  <div class="fr"><div class="fg"><label>الموظف</label><select id="hrEvEmp">${hrEmpOptions()}</select></div>
  <div class="fg"><label>الفترة (YYYY-MM)</label><input type="month" id="hrEvPeriod" value="${new Date().toISOString().slice(0, 7)}"></div></div>
  <div class="fr"><div class="fg"><label>التقييم (1-5)</label><select id="hrEvScore"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></div>
  <div class="fg"><label>المقيّم</label><input type="text" id="hrEvBy" value="${esc(STATE.currentUser?.name || '')}"></div></div>
  <div class="fg"><label>ملاحظات</label><textarea id="hrEvNotes"></textarea></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="hrEvalSave()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function hrEvalSave(){
  const employeeId = Number(document.getElementById('hrEvEmp')?.value);
  const period = document.getElementById('hrEvPeriod')?.value || '';
  const score = Number(document.getElementById('hrEvScore')?.value);
  const notes = document.getElementById('hrEvNotes')?.value.trim();
  const evaluator = document.getElementById('hrEvBy')?.value.trim();
  if(!employeeId || !/^\d{4}-\d{2}$/.test(period) || !(score >= 1 && score <= 5)){ toast('أكمل البيانات', 'error'); return; }
  showLoad();
  try{
    await apiCreate('employee_evaluations', { employeeId, period, score, notes, evaluator });
    closeModal(); await window.loadData().catch(() => {}); renderPage(); toast('تم حفظ التقييم', 'success');
  }catch(e){ toast(e.message || 'تعذر الحفظ', 'error'); }
  finally{ hideLoad(); }
}
function exportPayrollExcel(){
const data=[['الموظف','القسم','المنصب','الراتب الأساسي','أيام الحضور','الصافي']];
STATE.employees.filter(e=>e.status==='active').forEach(emp=>{
const dept=STATE.hrDepartments.find(d=>d.code===emp.department);
const attendanceCount=STATE.attendance.filter(a=>a.employeeId===emp.id&&a.checkIn&&new Date(a.date).getMonth()===new Date().getMonth()).length;
data.push([emp.name,dept?dept.name:'',emp.position||'',emp.salary||0,attendanceCount,emp.salary||0]);
});
const ws=XLSX.utils.aoa_to_sheet(data);
const wb=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,ws,'الرواتب');
XLSX.writeFile(wb,`payroll_${today()}.xlsx`);
toast('تم التصدير','success');
}


export { renderHRDashboard, renderHRCharts, renderAttendance, attRangeChange, attRangePreset, attSearchFilter, attPageGo, attExceptionsBox, hrGoGaps, attGapsToggle, attGapsData, attNextDay, attGapsSearch, attGapsRender, attResolveModal, attCalcTimes, attResolveSave, attExcuseModal, attExcuseSave, attCorrectModal, attCorrectSave, checkInOutByScan, scanAttendanceKiosk, checkIn, checkOut, exportAttendanceExcel, leaveWorkflowData, leaveWorkflowLoaded, leaveWorkflowLoading, LEAVE_STAGE_LABELS, leaveWorkflowStatusLabel, leaveWorkflowStatusClass, renderLeaveWorkflowTimeline, refreshLeaveWorkflow, workflowForLeave, leaveCanAct, renderLeavesPage, showAddLeaveModal, addLeaveRequest, advanceLeaveWorkflow, approveLeave, rejectLeave, returnLeaveToEmployee, viewLeaveDetails, renderHRDepartmentsPage, showAddHRDeptModal, addHRDept, editHRDept, updateHRDept, deleteHRDept, renderPayroll, hrSuiteSection, hrEmpOptions, runPayrollGen, hrDelete, hrDeductionsModal, hrDeductionsPreview, hrDeductionsApply, hrAdvanceModal, hrAdvanceSave, hrAdjustModal, hrAdjustSave, hrContractModal, hrContractSave, hrEvalModal, hrEvalSave, exportPayrollExcel };

// ─── محرك الورديات: إدخال جماعي من المالك + تطبيق وإعادة حساب تلقائية ───
function openShiftsPanel(){
  const html = `
  <div style="min-width:min(680px,92vw)">
    <h3 style="margin:0 0 8px"><i class=ji data-i=clock></i> الورديات — تطبيق من واقع بصماتك</h3>
    <p class="text-muted" style="margin:0 0 10px;font-size:13px">سطر لكل موظف: <b>EMP-رقم أو اسم الموظف أو بصمة رقم</b> ثم وقت الدخول ثم عدد ساعات الوردية (أو وقت الخروج).<br>
    أمثلة: <code>EMP-019: 16:00 12</code> · <code>بصمة 45: 04:00 - 16:00</code> · <code>احمد السيد العدوي 16:00 12س</code></p>
    <textarea id="shiftsInput" rows="10" style="width:100%;direction:ltr;text-align:left;font-family:monospace" placeholder="EMP-019: 16:00 12
بصمة 45: 04:00 - 16:00
احمد السيد العدوي 16:00 12س"></textarea>
    <label style="display:flex;gap:6px;align-items:center;margin:8px 0;font-size:13px"><input type="checkbox" id="shiftsAutoSuggest" checked> أضف تلقائيًا ورديات مقترحة من واقع البصمة للموظفين غير المذكورين (فجوة ≥30 دقيقة)</label>
    <div style="display:flex;gap:8px;justify-content:flex-start">
      <button class="btn btn-gold" onclick="applyShiftsFromPanel()">تطبيق وإعادة حساب الحضور</button>
      <button class="btn" onclick="closeModal()">إلغاء</button>
    </div>
    <div id="shiftsResult" style="margin-top:10px;font-size:13px"></div>
  </div>`;
  showModal(html);
}
async function applyShiftsFromPanel(){
  const box = document.getElementById('shiftsInput');
  const useAuto = document.getElementById('shiftsAutoSuggest') && document.getElementById('shiftsAutoSuggest').checked;
  const text = (box && box.value ? box.value : '').trim();
  if (!text) { toast('اكتب الورديات أولاً', 'warning'); return; }
  showLoad();
  try {
    let text2 = text;
    if (useAuto) {
      try {
        const analysis = await apiFetch('/hr/shifts/analysis?month=' + new Date().toISOString().slice(0, 7));
        const wrong = (analysis.items || []).filter(x => Math.abs(x.driftMinutes) >= 30);
        const manual = text2.toLowerCase();
        const extra = wrong.filter(x => {
          const n = (x.name || '').toLowerCase();
          return !text2.includes(n) && !text2.includes('emp-' + String(x.id)) && !(new RegExp('emp-\s*' + String(x.id) + '\b', 'i')).test(text2) && !(x.name || '').split(' ').some(w => w.length >= 3 && text2.includes(w));
        }).slice(0, 200);
        if (extra.length) {
          text2 += '\n' + extra.map(x => `${x.name} ${x.realityP25}`).join('\n');
        }
      } catch (_) { /* التحليل اختياري — الاستمرار بالنص المُدخل */ }
    }
    const res = await apiFetch('/hr/shifts/apply', { method: 'POST', body: JSON.stringify({ text: text2 }) });
    const rc = res && res.recompute ? res.recompute : {};
    const msg = [
      `تطبيق: ${res.applied}/${res.parsed} موظف`,
      `أيام التأخير: ${rc.lateDaysBefore} → ${rc.lateDaysAfter}`,
      `دقائق التأخير: ${rc.lateMinutesBefore} → ${rc.lateMinutesAfter}`,
      ...(res.failed && res.failed.length ? ['غير مطبق: ' + res.failed.slice(0, 5).join(' · ')] : []),
    ].join('\n');
    const box2 = document.getElementById('shiftsResult');
    if (box2) { box2.style.whiteSpace = 'pre-line'; box2.textContent = msg; }
    toast(`تم تطبيق ${res.applied} وردية وإعادة حساب الحضور`, 'success');
    renderPage();
  } catch (e) { toast('تعذر التطبيق: ' + (e.message || e), 'error'); }
  finally { hideLoad(); }
}
window.openShiftsPanel = openShiftsPanel;
window.applyShiftsFromPanel = applyShiftsFromPanel;
