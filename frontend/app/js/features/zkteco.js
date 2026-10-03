/**
 * features/zkteco.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// ZKTECO BIOMETRIC PAGE (بصمة الحضور داخل النظام)
// ============================================
const ZKSTATE = { tab:'devices', status:null, devices:[], mappings:null, logs:[], deviceUsers:null, deviceUsersFor:null };

function zkStatusBadge(status){
if(status==='online') {return '<span class="badge bdg-green"><i class=ji data-i=circle-check></i> متصل</span>';}
if(status==='offline') {return '<span class="badge bdg-red"><i class=ji data-i=circle-x></i> غير متصل</span>';}
if(status==='disabled') {return '<span class="badge bdg-gray">موقوف</span>';}
if(status==='syncing') {return '<span class="badge bdg-blue"><i class=ji data-i=refresh></i> مزامنة...</span>';}
return '<span class="badge bdg-orange">لم يُفحص</span>';
}
function zkPunchName(state){
return {0:'حضور',1:'انصراف',2:'خروج استراحة',3:'عودة استراحة',4:'دخول أوفر تايم',5:'خروج أوفر تايم'}[state]||`حالة ${state}`;
}
function zkVerifyName(v){
return {1:'بصمة',2:'بطاقة',15:'وجه'}[v]||'أخرى';
}
function zkFmtTime(iso){
try{ return new Date(iso).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit',hour12:false}); }catch(e){ return '—'; }
}
function zkFmtDate(iso){
try{ return fD(new Date(iso).toISOString().slice(0,10)); }catch(e){ return '—'; }
}
async function renderZktecoPage(){
const content = document.getElementById('content');
const canWrite = ['admin','hr'].includes(STATE.currentUser?.role);
content.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
<h3 class="u-gold-strong"><i class=ji data-i=user-check></i> أجهزة بصمة الحضور</h3>
<div class="u-row-wrap">
${canWrite?`<button class="btn btn-gold" onclick="zkAddDeviceModal()"><i class=ji data-i=plus></i> إضافة جهاز</button>`:''}
<button class="btn btn-blue btn-sm" onclick="zkRefresh()"><i class=ji data-i=refresh></i> تحديث</button>
</div>
</div>
<div class="u-row-wrap" style="gap:8px;margin-bottom:14px" id="zkTabs">
<button class="btn btn-sm ${ZKSTATE.tab==='devices'?'btn-gold':''}" onclick="zkSetTab('devices')"><i class=ji data-i=user-check></i> الأجهزة</button>
<button class="btn btn-sm ${ZKSTATE.tab==='mappings'?'btn-gold':''}" onclick="zkSetTab('mappings')"><i class=ji data-i=users></i> ربط الموظفين</button>
<button class="btn btn-sm ${ZKSTATE.tab==='logs'?'btn-gold':''}" onclick="zkSetTab('logs')"><i class=ji data-i=clipboard-list></i> سجل البصمات</button>
<button class="btn btn-sm ${ZKSTATE.tab==='coverage'?'btn-gold':''}" onclick="zkSetTab('coverage')"><i class=ji data-i=shield-check></i> تغطية البصمات</button>
</div>
<div id="zkBody"><div class="mcard u-empty"><div class="spinner"></div></div></div>
`;
await zkRefresh();
}
async function zkRefresh(){
try{
const [status, devices] = await Promise.all([
apiFetch('/zkteco/status').catch(()=>null),
apiFetch('/zkteco/devices')
]);
ZKSTATE.status = status;
ZKSTATE.devices = Array.isArray(devices)?devices:[];
zkRenderBody();
}catch(e){
const body=document.getElementById('zkBody');
if(body) {body.innerHTML = `<div class="mcard u-empty">تعذر تحميل بيانات البصمة: ${esc(e.message)}</div>`;}
}
}
function zkSetTab(tab){ ZKSTATE.tab = tab; const t=document.getElementById('zkTabs'); if(t){ t.querySelectorAll('button').forEach((b,i)=>{ const tabs=['devices','mappings','logs','coverage']; b.classList.toggle('btn-gold', tabs[i]===tab); }); } zkRenderBody(); }
function zkRenderBody(){
const body = document.getElementById('zkBody');
if(!body) {return;}
if(ZKSTATE.tab==='devices') {zkRenderDevices(body);}
else if(ZKSTATE.tab==='mappings') {zkLoadMappings(body);}
else if(ZKSTATE.tab==='coverage') {zkLoadCoverage(body);}
else {zkLoadLogs(body);}
}
// ─── تغطية البصمات (Enterprise 2026-10-03): من بلا بصمة ولماذا — فورًا ───
async function zkLoadCoverage(el){
el.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const r = await apiFetch('/zkteco/coverage?days=7');
const s = r.summary || {};
const diagBadge = (d) => d==='سليم' ? '<span class="badge bdg-green">سليم</span>' : d.startsWith('آخر بصمة') ? '<span class="badge bdg-gold">صمّت قديمًا</span>' : d.includes('غير مسجل') ? '<span class="badge bdg-red">بصمته غير مسجلة</span>' : d.includes('رقمه') ? '<span class="badge bdg-red">غير موجود بالجهاز</span>' : '<span class="badge bdg-red">بلا ربط</span>';
const rowHtml = (e) => `<tr>
<td class="fw-bold">${esc(e.name)}</td><td>${esc(e.department||'—')}</td>
<td>${e.deviceUserId?esc(String(e.deviceUserId)):'<span class="badge bdg-red">—</span>'}</td>
<td>${e.face_enrolled?'<span class="badge bdg-teal">وجه ✓</span>':'<span class="text-muted">—</span>'}</td>
<td>${e.last_punch?`<span dir="ltr" class="u-faint">${esc(String(e.last_punch).slice(0,16))}</span>`:'<span class="badge bdg-red">أبدًا</span>'}</td>
<td class="c">${e.attendance_days||0}</td>
<td>${diagBadge(e.diagnosis)}</td>
<td class="u-faint u-t12">${esc(e.action||'—')}</td></tr>`;
el.innerHTML = `
<div class="u-row-wrap" style="margin-bottom:12px">
<span class="badge bdg-blue">إجمالي الموظفين: ${s.total_employees||0}</span>
<span class="badge bdg-green">سليم: ${s.ok||0}</span>
<span class="badge bdg-red">مشاكل: ${s.problems||0}</span>
<span class="badge bdg-teal">بصمة وجه (تطبيق): ${s.face_enrolled||0}</span>
<span class="badge bdg-gold">بصمات خام بلا موظف: ${s.unmapped_device_users||0}</span>
<button class="btn btn-blue btn-sm" onclick="zkRefresh()"><i class=ji data-i=refresh></i> تحديث</button>
</div>
${(r.unmapped_device_users||[]).length?`<div class="mcard" style="margin-bottom:14px;border:1px solid var(--gold,#c9a227)"><b><i class=ji data-i=alert-triangle></i> بصمات خام على الجهاز بلا موظف مربوط — اربطها من تبويب «ربط الموظفين»:</b><div class="u-row-wrap" style="margin-top:8px">${r.unmapped_device_users.map(u=>`<span class="badge bdg-gold">جهاز #${esc(String(u.deviceUserId))} — ${u.raw} بصمة خام</span>`).join(' ')}</div></div>`:''}
<div class="tbl-wrap"><div class="tbl-hd"><h3>الموظفون الذين يحتاجون معالجة (${(r.problems||[]).length})</h3><small class="text-muted">آخر 7 أيام — بصمة الإصبع تُسجل بلمس الجهاز؛ وبصمة الوجه من التطبيق تصلح للجميع</small></div>
<div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>القسم</th><th>رقم الجهاز</th><th>وجه (تطبيق)</th><th>آخر بصمة</th><th class="c">أيام حضور</th><th>التشخيص</th><th>الإجراء</th></tr></thead><tbody>
${(r.problems||[]).map(rowHtml).join('') || '<tr><td colspan=8 class="u-empty">كل الموظفين سليمون — لا شيء يحتاج معالجة</td></tr>'}
</tbody></table></div></div>
<details style="margin-top:12px"><summary class="fw-bold" style="cursor:pointer">الموظفون السليمون (${(r.ok||[]).length})</summary>
<div class="tbl-wrap" style="margin-top:8px"><div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>القسم</th><th>رقم الجهاز</th><th>وجه (تطبيق)</th><th>آخر بصمة</th><th class="c">أيام حضور</th></tr></thead><tbody>
${(r.ok||[]).map(e=>`<tr><td class="fw-bold">${esc(e.name)}</td><td>${esc(e.department||'—')}</td><td>${esc(String(e.deviceUserId||'—'))}</td><td>${e.face_enrolled?'<span class="badge bdg-teal">وجه ✓</span>':'<span class="text-muted">—</span>'}</td><td><span dir="ltr" class="u-faint">${esc(String(e.last_punch||'—').slice(0,16))}</span></td><td class="c">${e.attendance_days||0}</td></tr>`).join('')}
</tbody></table></div></div></details>`;
}catch(e){ el.innerHTML = `<div class="mcard u-empty"><i class=ji data-i=alert-triangle></i> تعذر تحميل التغطية: ${esc(e.message||String(e))}</div>`; }
}
function zkRenderDevices(el){
const totals = ZKSTATE.status?.totals || {logs:0,unmapped:0,today:0};
const online = ZKSTATE.devices.filter(d=>d.status==='online').length;
const rows = ZKSTATE.devices.map(d=>`
<tr>
<td class="fw-bold">${esc(d.name)}</td>
<td><span class="badge bdg-blue">${esc(d.ipAddress)}:${d.port}</span></td>
<td>${zkStatusBadge(d.status)}</td>
<td>${d.deviceUid?`<span class="badge bdg-gray">${esc(d.deviceUid)}</span>`:'<span class="text-muted">—</span>'}</td>
<td>${d.lastSyncAt?zkFmtDate(d.lastSyncAt)+' · '+zkFmtTime(d.lastSyncAt):'—'}</td>
<td class="c-gold">${fN(d.totalSynced||0)}</td>
<td>${d.lastError?`<span class="text-danger" title="${esc(d.lastError)}"><i class=ji data-i=alert-triangle></i> ${esc(d.lastError.slice(0,40))}…</span>`:'—'}</td>
<td>
<div class="u-row-wrap" style="gap:4px">
${['admin','hr'].includes(STATE.currentUser?.role)?`
<button class="btn btn-green btn-sm" onclick="zkTestDevice('${d.id}')" title="فحص اتصال حقيقي"><i class=ji data-i=zap></i> فحص</button>
<button class="btn btn-blue btn-sm" onclick="zkSyncNow('${d.id}')" title="مزامنة الآن"><i class=ji data-i=refresh></i> مزامنة</button>
<button class="btn btn-sm" onclick="zkEditDeviceModal('${d.id}')"><i class=ji data-i=pencil></i></button>
<button class="btn btn-sm" onclick="zkToggleEnabled('${d.id}', ${!d.enabled})" title="${d.enabled?'إيقاف':'تشغيل'}">${d.enabled?'⏸':'▶'}</button>
<button class="btn btn-red btn-sm" onclick="zkDeleteDevice('${d.id}')"><i class=ji data-i=trash></i></button>`:'—'}
</div>
</td>
</tr>`).join('');
el.innerHTML = `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=user-check></i> أجهزة متصلة</div><div class="mcard-val c-green">${fN(online)} / ${fN(ZKSTATE.devices.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=timer></i> بصمات اليوم</div><div class="mcard-val c-blue">${fN(totals.today||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=inbox></i> إجمالي البصمات المخزنة</div><div class="mcard-val c-gold">${fN(totals.logs||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> غير مرتبطة بموظف</div><div class="mcard-val ${totals.unmapped?'c-red':'c-green'}">${fN(totals.unmapped||0)}</div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=user-check></i> أجهزة البصمة على الشبكة</h3><span class="text-muted">المحرك يعمل داخل النظام — ${ZKSTATE.status?.running?'<span class="badge bdg-green">يعمل</span>':'<span class="badge bdg-red">متوقف</span>'}</span></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>الجهاز</th><th>العنوان</th><th>الحالة</th><th>الرقم التسلسلي</th><th>آخر مزامنة</th><th>بصمات مُخزنة</th><th>آخر خطأ</th><th>إجراءات</th></tr></thead>
<tbody>${rows || '<tr><td colspan="8" class="u-empty-sm">لا توجد أجهزة — أضف جهاز البصمة ليبدأ النظام بمزامنته تلقائيًا</td></tr>'}</tbody>
</table>
</div>
</div>
<div class="mcard" style="margin-top:14px">
<h4 style="color:var(--gold);margin-bottom:8px"><i class=ji data-i=info></i> كيف تعمل المزامنة؟</h4>
<div style="color:var(--text2);line-height:1.9;font-size:13px">
• أضف جهاز البصمة بعنوان IP في الشبكة المحلية (المنفذ الافتراضي 4370).<br>
• اضغط <b>فحص</b> — يقوم النظام بمصافحة بروتوكول حقيقية مع الجهاز ويعرض الرقم التسلسلي وعدد البصمات (فتح المنفذ وحده لا يثبت أن الجهاز ZKTeco).<br>
• عند تفعيل الجهاز يبدأ النظام بقراءة البصمات الجديدة تلقائيًا كل فترة، ويخزن كل بصمة مرة واحدة بالضبط.<br>
• اربط كل موظف برقمه على الجهاز من تبويب <b>ربط الموظفين</b> — تظهر بصماته فورًا في سجل حضوره وبوابة الموظف.<br>
• البصمة لا تؤثر على التسجيل اليدوي أو QR: النظام يملأ الفراغات فقط ولا يعدّل أي قيمة مسجلة.
</div>
</div>`;
}
function zkAddDeviceModal(){
showModal(`
<h3><i class=ji data-i=plus></i> إضافة جهاز بصمة</h3>
<div class="fr">
<div class="fg"><label>اسم الجهاز *</label><input type="text" id="zkName" placeholder="مثال: بصمة البوابة الرئيسية"></div>
<div class="fg"><label>عنوان IP *</label><input type="text" id="zkIp" placeholder="192.168.1.201"></div>
</div>
<div class="fr">
<div class="fg"><label>المنفذ</label><input type="number" id="zkPort" value="4370"></div>
<div class="fg"><label>مفتاح الاتصال (Comm Key)</label><input type="number" id="zkKey" value="0" title="كلمة مرور الجهاز — عادة 0"></div>
</div>
<div class="fr">
<div class="fg"><label>فترة المزامنة (ثانية)</label><input type="number" id="zkInterval" value="30" min="5"></div>
<div class="fg"><label>مفعّل</label><select id="zkEnabled"><option value="true" selected>نعم — ابدأ المزامنة</option><option value="false">لا — لاحقًا</option></select></div>
</div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="zkAddDevice()"><i class=ji data-i=save></i> حفظ الجهاز</button>
</div>
`);
}
async function zkAddDevice(){
const name=document.getElementById('zkName')?.value.trim();
const ipAddress=document.getElementById('zkIp')?.value.trim();
const port=Number(document.getElementById('zkPort')?.value)||4370;
const commKey=Number(document.getElementById('zkKey')?.value)||0;
const syncIntervalSeconds=Number(document.getElementById('zkInterval')?.value)||30;
const enabled=document.getElementById('zkEnabled')?.value==='true';
if(!name||!ipAddress){toast('أدخل اسم الجهاز وعنوان IP','error');return;}
showLoad();
try{
await apiFetch('/zkteco/devices',{method:'POST',body:JSON.stringify({name,ipAddress,port,commKey,syncIntervalSeconds,enabled})});
closeModal(); toast('أُضيف الجهاز — اضغط "فحص" للتأكد من الاتصال','success'); await zkRefresh();
}catch(e){toast(e.message||'تعذر إضافة الجهاز','error');}finally{hideLoad();}
}
function zkEditDeviceModal(id){
const d=ZKSTATE.devices.find(x=>Number(x.id)===Number(id)); if(!d){return;}
showModal(`
<h3><i class=ji data-i=pencil></i> تعديل جهاز: ${esc(d.name)}</h3>
<div class="fr">
<div class="fg"><label>اسم الجهاز</label><input type="text" id="zkName" value="${esc(d.name)}"></div>
<div class="fg"><label>عنوان IP</label><input type="text" id="zkIp" value="${esc(d.ipAddress)}"></div>
</div>
<div class="fr">
<div class="fg"><label>المنفذ</label><input type="number" id="zkPort" value="${d.port}"></div>
<div class="fg"><label>مفتاح الاتصال (Comm Key)</label><input type="number" id="zkKey" value="${d.commKey||0}"></div>
</div>
<div class="fr">
<div class="fg"><label>فترة المزامنة (ثانية)</label><input type="number" id="zkInterval" value="${d.syncIntervalSeconds||30}" min="5"></div>
<div class="fg"><label>مفعّل</label><select id="zkEnabled"><option value="true" ${d.enabled?'selected':''}>نعم</option><option value="false" ${!d.enabled?'selected':''}>لا</option></select></div>
</div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="zkUpdateDevice('${d.id}')"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function zkUpdateDevice(id){
const body={
name:document.getElementById('zkName')?.value.trim(),
ipAddress:document.getElementById('zkIp')?.value.trim(),
port:Number(document.getElementById('zkPort')?.value)||4370,
commKey:Number(document.getElementById('zkKey')?.value)||0,
syncIntervalSeconds:Number(document.getElementById('zkInterval')?.value)||30,
enabled:document.getElementById('zkEnabled')?.value==='true',
};
showLoad();
try{ await apiFetch(`/zkteco/devices/${id}`,{method:'PUT',body:JSON.stringify(body)}); closeModal(); toast('تم تحديث الجهاز','success'); await zkRefresh(); }
catch(e){toast(e.message||'تعذر التحديث','error');}finally{hideLoad();}
}
async function zkTestDevice(id){
showLoad();
try{
const r=await apiFetch(`/zkteco/devices/${id}/test`,{method:'POST'});
toast(r.message||'تم الاتصال بنجاح','success');
}catch(e){toast(e.message||'فشل الاتصال بالجهاز','error');}
finally{hideLoad(); await zkRefresh();}
}
async function zkSyncNow(id){
showLoad();
try{
const r=await apiFetch(`/zkteco/devices/${id}/sync`,{method:'POST'});
toast(r.message||'تمت المزامنة','success');
}catch(e){toast(e.message||'فشلت المزامنة','error');}
finally{hideLoad(); await zkRefresh(); if(window.loadData) {window.loadData().catch(()=>{});}}
}
async function zkToggleEnabled(id, enable){
showLoad();
try{ await apiFetch(`/zkteco/devices/${id}`,{method:'PUT',body:JSON.stringify({enabled:enable})}); toast(enable?'تم تفعيل الجهاز':'تم إيقاف الجهاز','success'); await zkRefresh(); }
catch(e){toast(e.message||'تعذر التغيير','error');}finally{hideLoad();}
}
async function zkDeleteDevice(id){
const d=ZKSTATE.devices.find(x=>Number(x.id)===Number(id)); if(!d){return;}
if(!confirm(`حذف جهاز "${d.name}" وكل بصماته الخام؟`)){return;}
showLoad();
try{ await apiFetch(`/zkteco/devices/${id}`,{method:'DELETE'}); toast('حُذف الجهاز','warning'); await zkRefresh(); }
catch(e){toast(e.message||'تعذر الحذف','error');}finally{hideLoad();}
}
// ─── ربط الموظفين ───
async function zkLoadMappings(el){
el.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
try{ ZKSTATE.mappings = await apiFetch('/zkteco/mappings'); }
catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
zkRenderMappings(el);
}
function zkRenderMappings(el){
const m=ZKSTATE.mappings; if(!m){return;}
const canWrite=['admin','hr'].includes(STATE.currentUser?.role);
const emps=m.employees||[];
const linkedCount=emps.filter(e=>e.deviceUserId).length;
const unlinkedCount=emps.length-linkedCount;
const empRows=emps.map(e=>`
<tr>
<td class="fw-bold">${esc(e.name)}</td>
<td>${esc(e.employeeId||'')}</td>
<td>${STATE.hrDepartments.find(d=>d.code===e.department)?esc(STATE.hrDepartments.find(d=>d.code===e.department).name):'—'}</td>
<td>${e.deviceUserId?`<span class="badge bdg-green"><i class=ji data-i=circle-check></i> مربوط — رقم ${esc(String(e.deviceUserId))}</span>`:'<span class="badge bdg-orange"><i class=ji data-i=circle-x></i> غير مربوط</span>'}</td>
<td><input type="text" id="zkMap_${e.id}" value="${esc(e.deviceUserId||'')}" placeholder="رقم البصمة على الجهاز" style="max-width:160px;padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text)" ${canWrite?'':'disabled'}></td>
<td>${e.todayPunches?`<span class="badge bdg-green">${e.todayPunches} بصمة اليوم</span>`:'<span class="badge bdg-gray">لا بصمات اليوم</span>'}</td>
<td>${canWrite?`<button class="btn btn-gold btn-sm" onclick="zkSaveMapping('${e.id}')"><i class=ji data-i=save></i> حفظ</button>`:'—'}</td>
</tr>`).join('');
const unmappedRows=(m.unmapped||[]).map(u=>`
<tr><td><span class="badge bdg-blue">${esc(u.deviceUserId)}</span></td><td>${u.punches}</td><td>${u.lastPunch?zkFmtDate(u.lastPunch)+' · '+zkFmtTime(u.lastPunch):'—'}</td>
<td>${canWrite?`<button class="btn btn-sm" onclick="zkMapDeviceUser('${esc(u.deviceUserId)}')">اختر موظفًا…</button>`:'—'}</td></tr>`).join('');
el.innerHTML=`
<div class="metrics-grid" style="margin-bottom:12px">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> موظفون مربوطون بالبصمة</div><div class="mcard-val c-green">${fN(linkedCount)} / ${fN(emps.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> موظفون غير مربوطين</div><div class="mcard-val ${unlinkedCount?'c-orange':'c-green'}">${fN(unlinkedCount)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=inbox></i> أرقام بصمات بلا موظف</div><div class="mcard-val ${(m.unmapped||[]).length?'c-red':'c-green'}">${fN((m.unmapped||[]).length)}</div></div>
</div>
${canWrite?`
<div class="u-row-wrap" style="gap:8px;margin-bottom:12px">
<button class="btn btn-green" onclick="zkAutoLink()"><i class=ji data-i=zap></i> ربط تلقائي بالرقم الوظيفي</button>
<span class="text-muted" style="font-size:12px">يربط كل موظف بلا رقم بصمة برقمه الوظيفي مباشرة (إن لم يكن مرتبطًا بموظف آخر)</span>
</div>
<div class="tbl-wrap" style="margin-bottom:12px">
<div class="tbl-hd"><h3><i class=ji data-i=inbox></i> سحب الأسماء من جهاز البصمة</h3><span class="text-muted">إنشاء موظفين جدد: الرقم الوظيفي = رقم البصمة</span></div>
<div class="u-row-wrap" style="gap:8px;padding:12px 14px">
<select id="zkImportDevice" style="padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);max-width:220px">
${ZKSTATE.devices.map(d=>`<option value="${d.id}">${esc(d.name)} — ${esc(d.ipAddress)}</option>`).join('') || '<option value="">لا توجد أجهزة</option>'}
</select>
<select id="zkImportDept" style="padding:8px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);max-width:200px">
<option value="">بدون قسم</option>
${(STATE.hrDepartments||[]).map(d=>`<option value="${esc(d.code)}">${esc(d.name)}</option>`).join('')}
</select>
<button class="btn btn-blue" onclick="zkImportPreview()"><i class=ji data-i=user-check></i> سحب الأسماء من الجهاز</button>
</div>
</div>`:''}
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=users></i> ربط الموظفين بأرقام البصمة</h3><span class="text-muted">رقم البصمة = رقم المستخدم داخل جهاز البصمة</span></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>الموظف</th><th>الرقم الوظيفي</th><th>القسم</th><th>علامة الربط</th><th>رقم البصمة على الجهاز</th><th>بصمات اليوم</th><th></th></tr></thead>
<tbody>${empRows||'<tr><td colspan="7" class="u-empty-sm">لا يوجد موظفون</td></tr>'}</tbody>
</table>
</div>
</div>
<div class="tbl-wrap" style="margin-top:14px">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> أرقام بصمات غير مرتبطة بموظف</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>رقم البصمة</th><th>عدد البصمات</th><th>آخر بصمة</th><th></th></tr></thead>
<tbody>${unmappedRows||'<tr><td colspan="4" class="u-empty-sm">كل البصمات مرتبطة بموظفين</td></tr>'}</tbody>
</table>
</div>
</div>`;
}
async function zkSaveMapping(employeeId){
const raw=document.getElementById(`zkMap_${employeeId}`)?.value?.trim()??'';
showLoad();
try{
await apiFetch(`/zkteco/mappings/${employeeId}`,{method:'PUT',body:JSON.stringify({deviceUserId:raw})});
toast(raw?`تم ربط الموظف برقم البصمة ${raw}`:'تم إلغاء ربط الموظف','success');
await zkLoadMappings(document.getElementById('zkBody'));
}catch(e){toast(e.message||'تعذر حفظ الربط','error');}
finally{hideLoad();}
}
async function zkAutoLink(){
showLoad();
try{
const r=await apiFetch('/zkteco/mappings/auto',{method:'POST',body:JSON.stringify({})});
toast(r.message||'تم الربط التلقائي','success');
await zkLoadMappings(document.getElementById('zkBody'));
}catch(e){toast(e.message||'فشل الربط التلقائي','error');}
finally{hideLoad();}
}
function zkMapDeviceUser(deviceUserId){
// حوار سريع لربط رقم بصمة غير مرتبط بأحد الموظفين
const candidates=STATE.employees.filter(e=>e.status!=='inactive');
if(!candidates.length){toast('لا يوجد موظفون','warning');return;}
showModal(`
<h3><i class=ji data-i=users></i> ربط البصمة ${esc(deviceUserId)} بموظف</h3>
<div class="fg"><label>اختر الموظف</label>
<select id="zkMapEmployee" style="width:100%;padding:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text)">
${candidates.map(e=>`<option value="${e.id}">${esc(e.name)} — ${esc(e.employeeId||'')}</option>`).join('')}
</select></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="zkConfirmMapDeviceUser('${esc(deviceUserId)}')"><i class=ji data-i=save></i> ربط</button>
</div>`);
}
// ─── استيراد مستخدمي الجهاز كموظفين (الرقم الوظيفي = رقم البصمة) ───
function zkTakenFpSet(){
  const s = new Set();
  (STATE.employees || []).forEach(e => {
    [e.deviceUserId, e.employeeId].forEach(v => {
      const t = String(v ?? '').trim();
      if(!t) {return;}
      s.add(t);
      if(/^\d+$/.test(t)) {s.add(String(Number(t)));}
    });
  });
  return s;
}
async function zkImportPreview(){
  const deviceId = Number(document.getElementById('zkImportDevice')?.value);
  if(!deviceId){ toast('اختر جهاز البصمة أولاً', 'error'); return; }
  showLoad();
  try{
    let users = [];
    try {
      const s = await apiFetch(`/zkteco/devices/${deviceId}/stored-users`);
      if (Array.isArray(s.users) && s.users.length) {users = s.users;}
    } catch (_) { /* fallback للقراءة الحية من الجهاز */ }
    if (!users.length) {
      const r = await apiFetch(`/zkteco/devices/${deviceId}/users`);
      users = Array.isArray(r.users) ? r.users : [];
    }
    if(!users.length){ toast('لا يوجد مستخدمون مسجلون على هذا الجهاز', 'warning'); return; }
    ZKSTATE.deviceUsers = users;
    ZKSTATE.deviceUsersFor = deviceId;
    zkImportModal();
  }catch(e){ toast(e.message || 'تعذر قراءة مستخدمي الجهاز', 'error'); }
  finally{ hideLoad(); }
}
function zkImportModal(){
  const users = ZKSTATE.deviceUsers || [];
  const taken = zkTakenFpSet();
  let fresh = 0;
  const rows = users.map((u) => {
    const uid = String(u.userId ?? '').trim();
    const nm = String(u.name ?? '').trim() || (u.archived ? `أرشيف — بصمات سابقة (${fN(u.totalPunches||0)})` : `موظف ${uid}`);
    const exists = !uid || taken.has(uid) || (/^\d+$/.test(uid) && taken.has(String(Number(uid)))) || !!u.employeeId;
    if(!exists && uid){ fresh++; taken.add(uid); if(/^\d+$/.test(uid)) {taken.add(String(Number(uid)));} }
    const punchInfo = u.totalPunches != null ? ` <small class="u-faint">${fN(u.totalPunches)} بصمة</small>` : '';
    return `<tr style="border-top:1px solid var(--border)">
      <td style="padding:8px;text-align:center"><input type="checkbox" class="zkImpCk" value="${esc(uid)}" ${exists ? 'disabled' : 'checked'}></td>
      <td class="u-p10"><span class="badge bdg-blue">${esc(uid || '—')}</span></td>
      <td class="u-p10"><strong>${esc(nm)}</strong>${punchInfo}${u.archived ? ' <span class="badge bdg-gray">محذوف من الجهاز</span>' : ''}${u.employeeName ? ` <small class="u-faint">← ${esc(u.employeeName)}</small>` : ''}</td>
      <td class="u-p10">${exists ? '<span class="badge bdg-gray">موجود — تخطي</span>' : '<span class="badge bdg-green">جديد</span>'}</td>
    </tr>`;
  }).join('');
  showModal(`
  <h3><i class=ji data-i=inbox></i> مستخدمو جهاز البصمة (${users.length}) — جديد: ${fresh}</h3>
  <div class="text-muted" style="font-size:12px;margin-bottom:10px">المحدد سيُنشأ كموظف: الاسم من الجهاز + الرقم الوظيفي = رقم البصمة + مربوط تلقائيًا</div>
  <div style="max-height:340px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">
  <table style="width:100%;border-collapse:collapse;font-size:13px">
  <thead><tr style="background:var(--bg3);position:sticky;top:0"><th class="u-p10">#</th><th class="u-p10">رقم البصمة</th><th class="u-p10">الاسم على الجهاز</th><th class="u-p10">الحالة</th></tr></thead>
  <tbody>${rows}</tbody>
  </table>
  </div>
  <div class="modal-footer">
  <button class="btn" onclick="closeModal()">إلغاء</button>
  <button class="btn btn-gold" onclick="zkConfirmImport()"><i class=ji data-i=circle-check></i> إنشاء المحدد كموظفين</button>
  </div>`, 'modal-wide');
}
async function zkConfirmImport(){
  const ids = [...document.querySelectorAll('.zkImpCk:checked')].map(c => c.value);
  if(!ids.length){ toast('اختر مستخدمًا واحدًا على الأقل', 'warning'); return; }
  const dept = document.getElementById('zkImportDept')?.value || '';
  showLoad();
  try{
    const r = await apiFetch(`/zkteco/devices/${ZKSTATE.deviceUsersFor}/import-users`, { method: 'POST', body: JSON.stringify({ userIds: ids, department: dept }) });
    closeModal();
    try { if(window.loadData) {await window.loadData();} }catch(_){}
    await zkLoadMappings(document.getElementById('zkBody'));
    showModal(`
    <h3><i class=ji data-i=circle-check></i> نتيجة الاستيراد</h3>
    <div class="metrics-grid" style="margin-bottom:12px">
    <div class="mcard"><div class="mcard-label">تم إنشاؤهم</div><div class="mcard-val c-green">${fN(r.created || 0)}</div></div>
    <div class="mcard"><div class="mcard-label">تُخطي (موجود)</div><div class="mcard-val c-orange">${fN(r.skipped || 0)}</div></div>
    </div>
    <div class="text-muted" style="font-size:12.5px">${esc(r.message || '')}</div>
    <div class="modal-footer"><button class="btn btn-gold" onclick="closeModal()">تم</button></div>`);
  }catch(e){ toast(e.message || 'فشل الاستيراد', 'error'); }
  finally{ hideLoad(); }
}
async function zkConfirmMapDeviceUser(deviceUserId){const employeeId=Number(document.getElementById('zkMapEmployee')?.value);
if(!employeeId){return;}
showLoad();
try{
await apiFetch(`/zkteco/mappings/${employeeId}`,{method:'PUT',body:JSON.stringify({deviceUserId})});
closeModal(); toast('تم الربط — البصمات السابقة وغير المرتبطة ستظهر ضمن سجل الموظف','success');
await zkLoadMappings(document.getElementById('zkBody'));
}catch(e){toast(e.message||'تعذر الربط','error');}
finally{hideLoad();}
}
// ─── سجل البصمات ───
async function zkLoadLogs(el){
el.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
try{ ZKSTATE.logs = await apiFetch('/zkteco/logs?limit=200'); }
catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
zkRenderLogs(el);
}
function zkRenderLogs(el){
const rows=(ZKSTATE.logs||[]).map(l=>`
<tr>
<td>${zkFmtDate(l.attendanceTime)}</td>
<td>${zkFmtTime(l.attendanceTime)}</td>
<td>${l.employeeName?`<span class="fw-bold">${esc(l.employeeName)}</span>`:`<span class="badge bdg-orange">غير مرتبط (${esc(l.deviceUserId)})</span>`}</td>
<td>${l.employeeNumber?esc(l.employeeNumber):'—'}</td>
<td><span class="badge ${l.punchState===0?'bdg-green':l.punchState===1?'bdg-red':'bdg-blue'}">${zkPunchName(l.punchState)}</span></td>
<td>${zkVerifyName(l.verifyType)}</td>
<td>${esc(l.deviceName||'—')}</td>
</tr>`).join('');
el.innerHTML=`
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> سجل البصمات الخام (تدقيق كامل)</h3>
<div class="u-row-wrap">
<input type="date" id="zkExpFrom" class="inp" title="من تاريخ">
<input type="date" id="zkExpTo" class="inp" title="إلى تاريخ">
<button class="btn btn-green btn-sm" onclick="zkExportLogs()"><i class=ji data-i=download></i> تصدير CSV</button>
<button class="btn btn-blue btn-sm" onclick="zkRefresh()"><i class=ji data-i=refresh></i> تحديث</button>
</div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الوقت</th><th>الموظف</th><th>الرقم الوظيفي</th><th>الحركة</th><th>طريقة التحقق</th><th>الجهاز</th></tr></thead>
<tbody>${rows||'<tr><td colspan="7" class="u-empty-sm">لا توجد بصمات بعد — تأكد من فحص الجهاز وربطه</td></tr>'}</tbody>
</table>
</div>
</div>`;
}
async function zkExportLogs(){
const from=document.getElementById('zkExpFrom')?.value||'';
const to=document.getElementById('zkExpTo')?.value||'';
showLoad();
try{
const q=new URLSearchParams({...(from?{from}:{}),...(to?{to}:{})}).toString();
const headers={'Authorization':'Bearer '+window._jwt};
const res=await fetch(API_BASE+'/zkteco/logs/export'+(q?'?'+q:''),{headers});
if(!res.ok) {throw new Error(`فشل التصدير (${res.status})`);}
const blob=await res.blob();
const a=document.createElement('a');
a.href=URL.createObjectURL(blob);
a.download=`fingerprints-${from||'all'}_${to||'all'}.csv`;
document.body.appendChild(a); a.click();
setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},5000);
toast('تم تنزيل ملف البصمات (يفتح مباشرة في Excel بالعربية)', 'success');
}catch(e){ toast(e.message||'تعذر التصدير','error'); }
finally{ hideLoad(); }
}

export { ZKSTATE, renderZktecoPage, zkFmtTime, zkFmtDate, zkSetTab, zkRefresh, zkAddDeviceModal, zkAddDevice, zkEditDeviceModal, zkUpdateDevice, zkTestDevice, zkSyncNow, zkToggleEnabled, zkDeleteDevice, zkSaveMapping, zkAutoLink, zkMapDeviceUser, zkConfirmMapDeviceUser, zkImportPreview, zkConfirmImport, zkExportLogs };
