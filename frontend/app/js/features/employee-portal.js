/**
 * features/employee-portal.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ساعات العمل مع الالتفاف الليلي: الخروج بعد منتصف الليل يُكمل اليوم التالي
// (مطابق لمنطق calculateMinutes في الخادم) — بدونها يظهر الخروج بعد 12 ص بالسالب.
function portalWorkHours(a){
if(!(a.checkIn && a.checkOut)) {return null;}
const mins = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? (Number(m[1]) * 60 + Number(m[2])) : null; };
const ci = mins(a.checkIn), co = mins(a.checkOut);
if(ci == null || co == null) {return null;}
let diff = co - ci;
if(diff < 0) {diff += 24 * 60;}
return diff / 60;
}
// ============================================
// EMPLOYEE PORTAL
// ============================================
async function renderEmployeePortal(){
const isAdmin = ['admin','hr','manager'].includes(STATE.currentUser?.role);
let emp = null;
if(isAdmin){ emp = STATE.employees[0]; }
else{ emp = STATE.employees.find(e=>e.userId===STATE.currentUser.id); }
if(!emp){
document.getElementById('content').innerHTML = `
<div class="mcard" style="text-align:center;padding:60px 20px">
<div style="font-size:60px;margin-bottom:20px"><i class=ji data-i=user></i></div>
<h3 style="color:var(--gold);margin-bottom:10px">لم يتم ربط حسابك بملف موظف</h3>
<p style="color:var(--text2)">تواصل مع مدير الموارد البشرية لربط حسابك</p>
</div>`;
return;
}
await ensureEmployeeCardData(emp);
const dept = STATE.hrDepartments.find(d=>d.code===emp.department);
const myAttendance = STATE.attendance.filter(a=>a.employeeId===emp.id && a.checkIn);
const myLeaves = STATE.leaveRequests.filter(l=>l.employeeId===emp.id);
const totalKarim = myAttendance.reduce((sum,a)=>{
if(a.checkIn && a.checkOut){
return sum + (portalWorkHours(a) || 0);
}
return sum;
},0);
const content = document.getElementById('content');
content.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
<h3 class="u-gold-strong"><i class=ji data-i=home></i> بوابة الموظف - البطاقة الذكية</h3>
${isAdmin && STATE.employees.length>1 ? `
<select onchange="switchPortalEmployee(this.value)" style="padding:8px 14px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);color:var(--text);font-family:inherit">
${STATE.employees.map(e=>`<option value="${e.id}" ${e.id===emp.id?'selected':''}>${esc(e.name)} - ${esc(e.employeeId||'')}</option>`).join('')}
</select>
` : ''}
</div>
<div id="smartCardContainer"></div>
<div class="metrics-grid" style="margin-top:24px">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> الراتب الأساسي</div><div class="mcard-val c-gold">${fC(emp.salary||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> إجمالي ساعات العمل</div><div class="mcard-val c-blue">${fN(totalKarim.toFixed(1))} ساعة</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=calendar></i> أيام الحضور</div><div class="mcard-val c-green">${fN(myAttendance.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=sun></i> إجمالي الإجازات</div><div class="mcard-val c-purple">${fN(myLeaves.length)}</div></div>
</div>
<div id="zkMyPunches" style="margin-top:24px"></div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=timer></i> سجل الحضور والانصراف</h3><div class="u-row-wrap"><button class="btn btn-green btn-sm" onclick="printEmployeeAttendanceDay('${emp.id}')"><i class=ji data-i=printer></i> اليوم</button><button class="btn btn-blue btn-sm" onclick="printEmployeeAttendanceMonth('${emp.id}')"><i class=ji data-i=calendar></i> الشهر كامل</button></div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>المصدر</th><th>الحالة</th></tr></thead>
<tbody>
${myAttendance.slice().reverse().map(a=>{
const krm = a.checkIn&&a.checkOut?(portalWorkHours(a) ?? 0).toFixed(1):'—';
const src = a.source==='device'?'<span class="badge bdg-blue"><i class=ji data-i=user-check></i> بصمة</span>':a.source==='qr'?'<span class="badge bdg-green">QR</span>':a.source==='portal'?'<span class="badge bdg-teal"><i class=ji data-i=camera></i> كاميرا التطبيق</span>':a.source==='backfill'?'<span class="badge bdg-gray">أرشيف</span>':'<span class="badge bdg-gray">يدوي</span>';
const statusText = formatAttendanceStatus({
    checkIn: a.checkIn,
    checkOut: a.checkOut,
    lateMinutes: Number(a.lateMinutes || a.late ? (a.lateMinutes || 0) : 0),
    earlyLeaveMinutes: Number(a.earlyLeaveMinutes || 0)
});
const statusMarkup = !a.checkIn || !String(a.checkIn).trim() ? '<span class="badge bdg-orange">بلا حضور</span>' : (
    !a.checkOut || !String(a.checkOut).trim() ? '<span class="badge bdg-yellow">بلا انصراف</span>' : (
        a.late || Number(a.lateMinutes || 0) > 0 || Number(a.earlyLeaveMinutes || 0) > 0 ? `<span class="badge bdg-orange">${statusText}</span>` : '<span class="badge bdg-green">في الوقت</span>'
    )
);
return `<tr><td>${fD(a.date)}</td><td class="c-green">${a.checkIn||'—'}</td><td class="c-red">${a.checkOut||'—'}</td><td class="c-gold">${krm} ساعة</td><td>${src}</td><td>${statusMarkup}</td></tr>`;
}).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد سجلات</td></tr>'}
</tbody>
</table>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=calendar></i> سجل الإجازات</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الأيام</th><th>الحالة</th></tr></thead>
<tbody>
${myLeaves.slice().reverse().map(l=>{
const type=STATE.leaveTypes.find(t=>t.id===l.leaveTypeId);
const days=Math.ceil((new Date(l.endDate)-new Date(l.startDate))/86400000)+1;
return `<tr><td>${type?`${type.icon} ${esc(type.name)}`:'—'}</td><td>${fD(l.startDate)}</td><td>${fD(l.endDate)}</td><td class="c-gold">${days}</td><td><span class="badge ${l.status==='approved'?'bdg-green':l.status==='rejected'?'bdg-red':'bdg-orange'}">${l.status==='approved'?'<i class=ji data-i=circle-check></i> معتمد':l.status==='rejected'?'<i class=ji data-i=circle-x></i> مرفوض':'<i class=ji data-i=hourglass></i> معلق'}</span></td></tr>`;
}).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد إجازات</td></tr>'}
</tbody>
</table>
</div>
</div>
`;
const cardContainer = document.getElementById('smartCardContainer');
if(cardContainer){
const canUpload = isAdmin || emp.userId===STATE.currentUser?.id;
cardContainer.innerHTML = await renderSmartCard(emp, { canUpload });
}
loadMyBiometricPanel();
}
// ─── لوحة بصمات اليوم داخل بوابة الموظف (حيّة عبر Socket.io) ───
async function loadMyBiometricPanel(){
const panel = document.getElementById('zkMyPunches');
if(!panel) {return;}
try{
const data = await apiFetch('/zkteco/my-punches');
if(data.hasEmployeeProfile===false){
panel.innerHTML=zkPortalIndicator('none','لا يوجد ملف موظف مرتبط بحسابك — راجع إدارة الموارد البشرية'); return; }
if(!data.linked){
const numTxt = data.employeeNumber?` (رقمك الوظيفي «${esc(String(data.employeeNumber))}»)`:'';
panel.innerHTML=zkPortalIndicator('unlinked',`بصمتك غير مربوطة بعد بجهاز الحضور${numTxt} — راجع إدارة الموارد البشرية لربط رقمك على جهاز البصمة`); return; }
const devBadges=data.devices&&data.devices.enabled>0&&data.devices.online===0
?` <span class="badge bdg-red"><i class=ji data-i=circle-x></i> الجهاز غير متصل حاليًا</span>`:'';
const linkBadge=`<span class="badge bdg-green"><i class=ji data-i=circle-check></i> بصمتك مربوطة — رقم البصمة: ${esc(String(data.deviceUserId))}</span>${devBadges}`;
const punchRows=(data.punches||[]).map(p=>{
const isIn=p.punchState===0;
return `<span class="badge ${isIn?'bdg-green':'bdg-red'}" style="margin:2px">${isIn?'حضور':'انصراف'} · ${zkFmtTime(p.attendanceTime)} · ${esc(p.deviceName||'')}</span>`;
}).join(' ');
const rec=data.todayRecord;
panel.innerHTML=`
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=user-check></i> بصماتي اليوم — مباشرة من أجهزة البصمة</h3><span>${linkBadge}</span></div>
<div style="padding:14px">
${punchRows||'<span class="text-muted">لا توجد بصمات مسجلة لك اليوم — اقترب من جهاز البصمة وسجّل حضورك</span>'}
${rec?`<div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);color:var(--text2);font-size:13px">حالة سجل اليوم: حضور <b class="c-green">${esc(rec.checkIn||'—')}</b> — انصراف <b class="c-red">${esc(rec.checkOut||'—')}</b>${rec.workMinutes?` — عمل ${rec.workMinutes} دقيقة`:''}</div>`:''}
</div>
</div>`;
}catch(e){ panel.innerHTML=''; }
}
function zkPortalIndicator(state,msg){
const map={none:['bdg-gray','<i class=ji data-i=info></i>'],unlinked:['bdg-orange','<i class=ji data-i=alert-triangle></i>'],linked:['bdg-green','<i class=ji data-i=circle-check></i>']};
const [cls,icon]=map[state]||map.none;
return `<div class="tbl-wrap"><div style="padding:18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><span class="badge ${cls}">${icon}</span><span style="color:var(--text2);font-size:14px">${msg}</span></div></div>`;
}
window.zkPortalPunchHandler = function(data){
// حدث بصمة حي: حدّث لوحة البوابة وصفحات الحضور فورًا
const emp = STATE.employees.find(e=>e.userId===STATE.currentUser?.id);
const mine = emp && data.employeeId===emp.id;
if(mine){ toast(`بصمة ${data.action==='check_in'?'حضور':'انصراف'} مسجلة ${data.time?zkFmtTime(data.time):''} عبر ${data.deviceName||'الجهاز'}`,'success'); }
else if(['admin','hr','manager'].includes(STATE.currentUser?.role)){ toast(`بصمة جديدة: ${data.employeeName||('رقم '+data.deviceUserId)} — ${data.punchName||''}`,'info'); }
if(STATE.page==='employee-portal' || (STATE.page==='dashboard' && STATE.currentUser?.role==='employee')) {loadMyBiometricPanel();}
clearTimeout(window.__zkPunchRefreshTimer);
window.__zkPunchRefreshTimer = setTimeout(async ()=>{
try{ await loadData(); if(['attendance','zkteco','dashboard'].includes(STATE.page)) {renderPage();} }catch(e){}
}, 800);
};
function switchPortalEmployee(empId){
const emp = STATE.employees.find(e=>e.id==empId);
if(!emp) {return;}
renderEmployeePortalFor(emp);
}
async function renderEmployeePortalFor(emp){
await ensureEmployeeCardData(emp);
const cardContainer = document.getElementById('smartCardContainer');
if(cardContainer){
const isAdmin = ['admin','hr','manager'].includes(STATE.currentUser?.role);
cardContainer.innerHTML = await renderSmartCard(emp, { canUpload: isAdmin });
}
}

export { renderEmployeePortal, loadMyBiometricPanel, zkPortalIndicator, switchPortalEmployee, renderEmployeePortalFor };
