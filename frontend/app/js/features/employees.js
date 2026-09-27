/**
 * features/employees.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// EMPLOYEES PAGE
// ============================================
function renderEmployeesPage(){
const content = document.getElementById('content');
content.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
<h3 class="u-gold-strong"><i class=ji data-i=users></i> ${t('emp.title')}</h3>
<div style="display:flex;gap:10px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" onclick="exportEmployeesExcel()"><i class=ji data-i=inbox></i> ${t('act.export')}</button>
<button class="btn btn-green btn-sm" onclick="showEmpSheetImportModal()"><i class=ji data-i=file-text></i> استيراد شيت Excel</button>
<button class="btn btn-gold" onclick="showAddEmployeeModal()"><i class=ji data-i=plus></i> ${t('emp.add')}</button>
<button class="btn btn-green" onclick="showBulkImportModal()"><i class=ji data-i=inbox></i> ${t('emp.bulk')}</button>
</div>
</div>
<div class="emp-search-row">
<div class="smart-search">
<input type="text" id="empSearch" placeholder="${t('emp.searchName')}" oninput="filterEmployees()" onkeydown="if(event.key==='Enter')filterEmployees()">
</div>
<button class="btn btn-blue btn-sm" onclick="filterEmployees()"><i class=ji data-i=search></i> ${t('emp.searchBtn')}</button>
<div class="emp-id-search">
<input type="text" id="empIdSearch" inputmode="numeric" placeholder="${t('emp.searchId')}" onkeydown="if(event.key==='Enter')searchEmployeeById()">
<button class="btn btn-gold btn-sm" onclick="searchEmployeeById()"><i class=ji data-i=search></i> ${t('emp.search')}</button>
</div>
</div>
<div class="dept-grid" id="employeesGrid">
${renderEmployeesCards(STATE.employees)}
</div>
`;
setTimeout(()=>{content.style.opacity='1';},30);
}
// شارة الوردية: البداية والمدة + قمر لليلية العابرة لمنتصف الليل
function empShiftChip(emp){
  const st = String(emp.shift_start || '09:00');
  const hrs = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
  const m = st.match(/^(\d{1,2}):(\d{2})$/);
  let overnight = false;
  if(m){
    const end = (Number(m[1]) * 60 + Number(m[2]) + Math.round(hrs * 60)) % (24 * 60);
    const startMin = Number(m[1]) * 60 + Number(m[2]);
    overnight = end <= startMin;
  }
  const hrsTxt = String(hrs).replace(/\.0$/, '');
  const auto = emp.auto_checkout ? `<span class="badge bdg-purple" title="انصراف تلقائي عند ${shiftEndText(st, hrs)} لمن ينسى البصمة">⏱ تلقائي</span>` : '';
  const lock = emp.auto_lock ? `<span class="badge bdg-red" title="اليوم يُقفل بعد الإغلاق التلقائي — لا تُقبل بصمات لاحقة">🔒 مقفل</span>` : '';
  return `<span class="badge bdg-blue" title="الوردية ${st} لمدة ${hrsTxt} ساعات — الانصراف المتوقع ${shiftEndText(st, hrs)}"><i class=ji data-i=clock></i> ${st} · ${hrsTxt}س${overnight ? ' 🌙' : ''}</span>${auto}${lock}`;
}
function shiftEndText(st, hrs){
  const m = String(st || '09:00').match(/^(\d{1,2}):(\d{2})$/);
  if(!m) {return '—';}
  const total = Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(hrs || 9) * 60);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(total / 60) % 24)}:${p(total % 60)}`;
}
function renderEmployeesCards(employees){if(employees.length===0) {return `<div class="mcard u-empty-grid">${t('emp.noEmp')}</div>`;}
return employees.map(emp=>{
const dept=STATE.hrDepartments.find(d=>d.code===emp.department);
const linkedUser=linkedUserForEmployee(emp);
const initials=emp.name.split(' ').map(n=>n[0]).join('').substring(0,2);
return `
<div class="employee-card" onclick="viewEmployeeDetails('${emp.id}')">
<div class="emp-head">
<div class="employee-avatar">${emp.photo?`<img src="${emp.photo}" alt="${esc(emp.name)}" loading="lazy">`:initials}</div>
<div class="u-flex1">
<div class="emp-name">${esc(emp.name)}</div>
<div class="emp-id">${esc(emp.employeeId||t('emp.noEmpId'))}</div>
</div>
<span class="badge ${emp.status==='active'?'bdg-green':'bdg-red'}">${emp.status==='active'?`<i class=ji data-i=circle-check></i> ${t('emp.active')}`:`<i class=ji data-i=circle-x></i> ${t('emp.inactive')}`}</span>
</div>
<div class="dept-stats">
<div class="dstat"><div class="dstat-lbl"><i class=ji data-i=building></i> ${t('emp.dept')}</div><div class="dstat-val">${dept?esc(dept.name):'—'}</div></div>
<div class="dstat"><div class="dstat-lbl"><i class=ji data-i=briefcase></i> ${t('emp.position')}</div><div class="dstat-val">${esc(emp.position||'—')}</div></div>
<div class="dstat"><div class="dstat-lbl"><i class=ji data-i=banknote></i> ${t('emp.salary')}</div><div class="dstat-val c-gold">${fC(emp.salary||0)}</div></div>
</div>
<div class="emp-meta">
${emp.deviceUserId?`<span class="badge bdg-green" title="رقم البصمة ${esc(String(emp.deviceUserId))}"><i class=ji data-i=user-check></i> ${t('emp.fp')} ${esc(String(emp.deviceUserId))}</span>`:`<span class="badge bdg-orange" title="أضف رقم البصمة من تعديل الموظف أو صفحة بصمة الحضور"><i class=ji data-i=user-check></i> ${t('emp.noFp')}</span>`}
${linkedUser?`<span class="badge ${linkedUser.active!==false?'bdg-green':'bdg-red'}" title="${esc(ROLES[linkedUser.role]?.name||linkedUser.role)}${linkedUser.active===false?' · موقوف':''}"><i class=ji data-i=key></i> @${esc(linkedUser.username)}</span>`:`<span class="badge" title="لم يُنشأ حساب دخول بعد"><i class=ji data-i=key></i> ${t('emp.noAccount')}</span>`}
${empShiftChip(emp)}
</div>
<div class="u-footer-sep">
<button class="btn btn-sm u-flex1" onclick="event.stopPropagation();editEmployee('${emp.id}')"><i class=ji data-i=pencil></i> ${t('emp.edit')}</button>
${linkedUser?`<button class="btn btn-blue btn-sm u-flex1" onclick="event.stopPropagation();editUser('${linkedUser.id}')"><i class=ji data-i=key></i> ${t('emp.account')}</button>`:`<button class="btn btn-green btn-sm u-flex1" onclick="event.stopPropagation();showCreateEmployeeAccountModal('${emp.id}')"><i class=ji data-i=plus></i> ${t('emp.account')}</button>`}
<button class="btn btn-sm" style="flex:1;background:rgba(52,152,219,0.1);color:var(--blue);border:1px solid rgba(52,152,219,0.2)" onclick="event.stopPropagation();showSmartCardModal('${emp.id}')"><i class=ji data-i=ticket></i> ${t('emp.card')}</button>
<button class="btn btn-red btn-sm u-flex1" onclick="event.stopPropagation();deleteEmployee('${emp.id}')"><i class=ji data-i=trash></i></button>
</div>
</div>
`;
}).join('');
}
function searchEmployeeById(){
const q = (document.getElementById('empIdSearch')?.value || '').trim();
const grid = document.getElementById('employeesGrid');
if(!grid) {return;}
if(!q){ grid.innerHTML = renderEmployeesCards(STATE.employees); return; }
const norm = s => String(s ?? '').trim();
const isNum = /^\d+$/.test(q);
const qNum = isNum ? String(Number(q)) : null;
const hits = (STATE.employees || []).filter(emp => {
  const eid = norm(emp.employeeId);
  if(eid === q) {return true;}
  if(isNum && /^\d+$/.test(eid) && String(Number(eid)) === qNum) {return true;}
  const fp = norm(emp.deviceUserId);
  if(fp === q) {return true;}
  if(isNum && /^\d+$/.test(fp) && String(Number(fp)) === qNum) {return true;}
  return false;
});
if(hits.length === 0){ toast(`لا يوجد موظف برقم "${q}"`, 'error'); return; }
const nameBox = document.getElementById('empSearch');
if(nameBox) {nameBox.value = '';}
grid.innerHTML = renderEmployeesCards(hits).replace('class="employee-card"', 'class="employee-card flash"');
grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// تطبيع عربي للبحث: أحمد=احمد، فاطمة=فاطمه، علي=على — بلا حساسية للهمزات والتشكيل
function normalizeAr(s){
  return String(s ?? '').toLowerCase().trim()
    .replace(/[\u064B-\u0652\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي');
}
// إلغاء جماعي للاستكمال التلقائي (مدير فقط) — يعيد كل الصفوف المفتوحة
async function revertAllInferred(){
  if(STATE.currentUser?.role!=='admin'){ toast('غير مصرح — المدير فقط', 'error'); return; }
  if(!confirm('إلغاء كل الاستكمال التلقائي؟ ستُمسح القيم المستنتَجة ويُعاد فتح الصفوف. القيم الحقيقية لن تُمس.')) {return;}
  showLoad();
  try{
    const r = await apiFetch('/hr/attendance/revert-inferred', { method: 'POST', body: JSON.stringify({}) });
    await window.loadData().catch(() => {});
    renderPage();
    toast(`تم: مسح خروج ${r.clearedCheckouts} — مسح دخول ${r.clearedCheckins} — حذف فارغ ${r.deletedEmpty}`, 'warning');
  }catch(e){ toast(e.message || 'تعذر الإلغاء الجماعي', 'error'); }
  finally{ hideLoad(); }
}
// إلغاء الاستكمال التلقائي: يعيد القيمة المستنتَجة فارغة ويفتح الصف للبصمات
async function revertInference(id){  if(STATE.currentUser?.role!=='admin'){ toast('غير مصرح — المدير فقط', 'error'); return; }
  const rec = STATE.attendance.find(a => String(a.id) === String(id));
  if(!rec) {return;}
  const parts = [];
  if(rec.checkin_inferred) {parts.push('الدخول');}
  if(rec.checkout_inferred) {parts.push('الخروج');}
  if(!parts.length){ toast('لا يوجد استكمال لإلغائه', 'warning'); return; }
  if(!confirm(`إلغاء الاستكمال التلقائي (${parts.join(' + ')}) وإعادة الصف مفتوحًا؟`)) {return;}
  showLoad();
  try{
    const patch = { notes: (rec.notes || '') + ' | أُلغي الاستكمال يدويًا' };
    if(rec.checkin_inferred) {Object.assign(patch, { checkIn: null, checkInAt: null, late: false, checkin_inferred: false, workMinutes: null });}
    if(rec.checkout_inferred) {Object.assign(patch, { checkOut: null, checkOutAt: null, checkout_inferred: false, early_leave: false, workMinutes: null });}
    const saved = await apiUpdate('attendance', id, patch);
    Object.assign(rec, saved);
    await window.loadData().catch(() => {});
    renderPage();
    toast('أُلغي الاستكمال — الصف مفتوح', 'warning');
  }catch(e){ toast(e.message || 'تعذر الإلغاء', 'error'); }
  finally{ hideLoad(); }
}
function filterEmployees(){const search=normalizeAr(document.getElementById('empSearch')?.value||'');
const grid=document.getElementById('employeesGrid');
if(!grid){return;}
if(!search){ grid.innerHTML=renderEmployeesCards(STATE.employees); return; }
const filtered=(STATE.employees||[]).filter(emp=>
  normalizeAr(emp.name).includes(search)
  || normalizeAr(emp.employeeId).includes(search)
  || normalizeAr(emp.position).includes(search));
grid.innerHTML=filtered.length?renderEmployeesCards(filtered):`<div class="mcard u-empty-grid">${t('emp.noResult')}</div>`;
}
function showAddEmployeeModal(){
const deptOptions=STATE.hrDepartments.map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('');
showModal(`
<h3><i class=ji data-i=plus></i> إضافة موظف جديد</h3>
<div class="fr">
<div class="fg"><label>الاسم الكامل</label><input type="text" id="empName" required></div>
<div class="fg"><label>الرقم الوظيفي</label><input type="text" id="empId" value="EMP${String(STATE.employees.length+1).padStart(3,'0')}"></div>
</div>
<div class="fr">
<div class="fg"><label><i class=ji data-i=user-check></i> رقم البصمة على الجهاز</label><input type="text" id="empDeviceUserId" placeholder="اتركه فارغًا للربط التلقائي بالرقم الوظيفي"></div>
<div class="fg"></div>
</div>
<div class="fr">
<div class="fg"><label>القسم</label><select id="empDept">${deptOptions}</select></div>
<div class="fg"><label>المنصب</label><input type="text" id="empPosition" list="employeePositions"><datalist id="employeePositions"><option value="كاشير"></option><option value="مساعد كاشير"></option><option value="مدير وردية الكاشير"></option><option value="موظف مطعم"></option></datalist></div>
</div>
<div class="fr">
<div class="fg"><label>رقم الهاتف</label><input type="tel" id="empPhone"></div>
<div class="fg"><label>البريد الإلكتروني</label><input type="email" id="empEmail"></div>
</div>
<div class="fr">
<div class="fg"><label>تاريخ الالتحاق</label><input type="date" id="empJoinDate" value="${today()}"></div>
<div class="fg"><label>الراتب الأساسي</label><input type="number" id="empSalary" step="0.01"></div>
</div>
<div class="fr">
<div class="fg"><label><i class=ji data-i=clock></i> بداية الوردية</label><input type="time" id="empShiftStart" value="09:00"></div>
<div class="fg"><label><i class=ji data-i=timer></i> ساعات الوردية</label><input type="number" id="empShiftKarim" min="1" max="24" step="0.5" value="10" placeholder="10 أو 12"></div>
</div>
<div class="fg"><label><i class=ji data-i=id-card></i> انتهاء الإقامة</label>${hijriDateField('empIqama', '')}</div>
<div class="mcard" style="margin:12px 0;padding:14px;border:1px solid var(--gold);border-radius:var(--r)"><b><i class=ji data-i=stethoscope></i> الوثائق الصحية</b><div class="fr" style="margin-top:8px">
<div class="fg"><label><i class=ji data-i=stethoscope></i> انتهاء الشهادة الصحية</label>${hijriDateField('empHealth', '')}</div>
<div class="fg"><label><i class=ji data-i=award></i> انتهاء التثقيف الصحي</label>${hijriDateField('empHealthEdu', '')}</div>
</div></div>
<div class="fg">
<label><i class=ji data-i=camera></i> صورة الموظف (اختياري)</label>
<input type="file" id="empPhoto" accept="image/*">
</div>
<div class="fg"><label>الحالة</label><select id="empStatus"><option value="active">نشط</option><option value="inactive">غير نشط</option></select></div>
${STATE.currentUser?.role==='admin'?`<div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="empAutoCheckout"> <span>انصراف تلقائي عند نهاية الوردية <small class="text-muted">(لمن ينسى بصمة الخروج — متوقف حاليًا بقرار الإدارة)</small></span></label></div><div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="empAutoLock"> <span>🔒 قفل اليوم بعد الإغلاق <small class="text-muted">(لا تُقبل بصمات لاحقة)</small></span></label></div>`:''}
<div class="workflow-banner" style="margin-top:12px"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="empCreateAccount" checked onchange="toggleEmployeeAccountFields()"> إنشاء حساب دخول وربطه بالموظف الآن</label><div id="empAccountFields" class="fr" style="margin-top:10px"><div class="fg"><label>اسم المستخدم</label><input type="text" id="empUsername" placeholder="مثال: emp001"></div><div class="fg"><label>الدور والصلاحيات</label><select id="empRole">${Object.keys(ROLES).map(k=>`<option value="${k}" ${k==='employee'?'selected':''}>${ROLES[k].icon} ${ROLES[k].name}</option>`).join('')}</select></div><div class="fg"><label>كلمة المرور المؤقتة</label><input type="password" id="empPassword"></div></div></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="addEmployee()"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function addEmployee(){
const name=document.getElementById('empName')?.value.trim();
const employeeId=document.getElementById('empId')?.value.trim();
const department=document.getElementById('empDept')?.value;
const position=document.getElementById('empPosition')?.value.trim();
const phone=document.getElementById('empPhone')?.value.trim();
const email=document.getElementById('empEmail')?.value.trim();
const joinDate=document.getElementById('empJoinDate')?.value;
const salary=parseFloat(document.getElementById('empSalary')?.value)||0;
const status=document.getElementById('empStatus')?.value;
const shift_start=document.getElementById('empShiftStart')?.value||'09:00';
const shift_karim=parseFloat(document.getElementById('empShiftKarim')?.value)||10;
const iqamaExpiry=document.getElementById('empIqama')?.value||null;
const healthCertExpiry=document.getElementById('empHealth')?.value||null;
const healthEduExpiry=document.getElementById('empHealthEdu')?.value||null;
const photoFile=document.getElementById('empPhoto')?.files[0];
const createAccount=Boolean(document.getElementById('empCreateAccount')?.checked);
const accountUsername=document.getElementById('empUsername')?.value.trim();
const accountPassword=document.getElementById('empPassword')?.value||'';
const accountRole=document.getElementById('empRole')?.value||'employee';
if(!name||!employeeId){toast('أدخل الاسم والرقم الوظيفي','error');return;}
if(STATE.employees.find(e=>e.employeeId===employeeId)){toast('الرقم الوظيفي موجود بالفعل','error');return;}
if(createAccount&&(!accountUsername||!accountPassword)){toast('أدخل اسم المستخدم وكلمة المرور أو ألغِ خيار إنشاء الحساب','error');return;}
if(createAccount&&STATE.users.some(u=>u.username===accountUsername)){toast('اسم المستخدم موجود بالفعل','error');return;}
const newEmp = {
id:uid(),name,employeeId,department,position,phone,email,joinDate,salary,status,
deviceUserId:document.getElementById('empDeviceUserId')?.value.trim()||null,
shift_start,shift_karim,
userId:null,iqamaExpiry,healthCertExpiry,healthEduExpiry,photo:null,
...(STATE.currentUser?.role==='admin' ? { auto_checkout: Boolean(document.getElementById('empAutoCheckout')?.checked), auto_lock: Boolean(document.getElementById('empAutoLock')?.checked) } : {}),
digitalFingerprint: await generateDigitalFingerprint({id:Date.now(),employeeId,name,joinDate}),
cardId: null
};
try{
 const savedEmp = await persistCreate('employees', (saved)=>STATE.employees.push(saved), newEmp);
 if(photoFile){ await uploadEmployeePhoto(savedEmp.id, photoFile); }
 if(createAccount){
   const savedUser=await apiCreate('users',{username:accountUsername,password:accountPassword,name,role:accountRole,active:true});
   STATE.users.push(savedUser);
   await linkUserToEmployee(savedUser.id,savedEmp.id);
 }
 closeModal();renderPage();toast(createAccount?'تم إضافة الموظف وإنشاء حسابه وربطه بالصلاحيات':'تم إضافة الموظف بدون حساب دخول','success');
}catch(e){toast(e.message||'تعذر حفظ الموظف أو إنشاء حسابه','error');}
}
function editEmployee(id){
const emp=findEmployeeById(id);
if(!emp){return;}
const deptOptions=STATE.hrDepartments.map(d=>`<option value="${d.code}" ${emp.department===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`
<h3><i class=ji data-i=pencil></i> تعديل بيانات الموظف</h3>
<div style="text-align:center;margin-bottom:20px">
<div class="employee-avatar" style="width:100px;height:100px;font-size:40px;margin:0 auto 10px">${emp.photo?`<img src="${emp.photo}">`:emp.name.split(' ').map(n=>n[0]).join('').substring(0,2)}</div>
<label class="btn btn-blue btn-sm" style="cursor:pointer">
<i class=ji data-i=camera></i> تغيير الصورة
<input type="file" accept="image/*" style="display:none" onchange="handlePhotoUpload('${emp.id}', this.files[0]); setTimeout(()=>editEmployee('${emp.id}'), 1500)">
</label>
</div>
<div class="fr">
<div class="fg"><label>الاسم الكامل</label><input type="text" id="empName" value="${esc(emp.name)}"></div>
<div class="fg"><label>الرقم الوظيفي</label><input type="text" id="empId" value="${esc(emp.employeeId||'')}" readonly></div>
</div>
<div class="fr">
<div class="fg"><label><i class=ji data-i=user-check></i> رقم البصمة على الجهاز</label><input type="text" id="empDeviceUserId" value="${esc(emp.deviceUserId||'')}" placeholder="اتركه فارغًا للربط التلقائي"></div>
<div class="fg"></div>
</div>
<div class="fr">
<div class="fg"><label>القسم</label><select id="empDept">${deptOptions}</select></div>
<div class="fg"><label>المنصب</label><input type="text" id="empPosition" list="employeePositions" value="${esc(emp.position||'')}"><datalist id="employeePositions"><option value="كاشير"></option><option value="مساعد كاشير"></option><option value="مدير وردية الكاشير"></option><option value="موظف مطعم"></option></datalist></div>
</div>
<div class="fr">
<div class="fg"><label>رقم الهاتف</label><input type="tel" id="empPhone" value="${esc(emp.phone||'')}"></div>
<div class="fg"><label>البريد الإلكتروني</label><input type="email" id="empEmail" value="${esc(emp.email||'')}"></div>
</div>
<div class="fr">
<div class="fg"><label>تاريخ الالتحاق</label><input type="date" id="empJoinDate" value="${emp.joinDate||today()}"></div>
<div class="fg"><label>الراتب الأساسي</label><input type="number" id="empSalary" value="${emp.salary||0}" step="0.01"></div>
</div>
<div class="fr">
<div class="fg"><label><i class=ji data-i=clock></i> بداية الوردية</label><input type="time" id="empShiftStart" value="${esc(emp.shift_start||'09:00')}"></div>
<div class="fg"><label><i class=ji data-i=timer></i> ساعات الوردية</label><input type="number" id="empShiftKarim" min="1" max="24" step="0.5" value="${emp.shift_karim??10}" placeholder="10 أو 12"></div>
</div>
${STATE.currentUser?.role==='admin'?`<div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="empAutoCheckout" ${emp.auto_checkout?'checked':''}> <span>انصراف تلقائي عند نهاية الوردية <small class="text-muted">(لمن ينسى بصمة الخروج — مدير فقط — متوقف حاليًا بقرار الإدارة)</small></span></label></div><div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="empAutoLock" ${emp.auto_lock?'checked':''}> <span>🔒 قفل اليوم بعد الإغلاق <small class="text-muted">(لا تُقبل بصمات لاحقة لذلك اليوم — مدير فقط)</small></span></label></div>`:''}
<div class="fg"><label><i class=ji data-i=id-card></i> انتهاء الإقامة</label>${hijriDateField('empIqama', emp.iqamaExpiry || '')}</div>
<div class="mcard" style="margin:12px 0;padding:14px;border:1px solid var(--gold);border-radius:var(--r)"><b><i class=ji data-i=stethoscope></i> الوثائق الصحية</b><div class="fr" style="margin-top:8px">
<div class="fg"><label><i class=ji data-i=stethoscope></i> انتهاء الشهادة الصحية</label>${hijriDateField('empHealth', emp.healthCertExpiry || '')}</div>
<div class="fg"><label><i class=ji data-i=award></i> انتهاء التثقيف الصحي</label>${hijriDateField('empHealthEdu', emp.healthEduExpiry || '')}</div>
</div></div>
<div class="fg"><label>الحالة</label><select id="empStatus"><option value="active" ${emp.status==='active'?'selected':''}>نشط</option><option value="inactive" ${emp.status==='inactive'?'selected':''}>غير نشط</option></select></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="updateEmployee('${emp.id}')"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function updateEmployee(id){
const emp=findEmployeeById(id);
if(!emp){return;}
const name=document.getElementById('empName')?.value.trim();
const department=document.getElementById('empDept')?.value;
const position=document.getElementById('empPosition')?.value.trim();
const phone=document.getElementById('empPhone')?.value.trim();
const email=document.getElementById('empEmail')?.value.trim();
const joinDate=document.getElementById('empJoinDate')?.value;
const salary=parseFloat(document.getElementById('empSalary')?.value)||0;
const status=document.getElementById('empStatus')?.value;
const shift_start=document.getElementById('empShiftStart')?.value||'09:00';
const shift_karim=parseFloat(document.getElementById('empShiftKarim')?.value)||10;
const iqamaExpiry=document.getElementById('empIqama')?.value||null;
const healthCertExpiry=document.getElementById('empHealth')?.value||null;
const healthEduExpiry=document.getElementById('empHealthEdu')?.value||null;
const deviceUserId=document.getElementById('empDeviceUserId')?.value.trim()||null;
const auto_checkout = STATE.currentUser?.role==='admin' ? Boolean(document.getElementById('empAutoCheckout')?.checked) : undefined;
const auto_lock = STATE.currentUser?.role==='admin' ? Boolean(document.getElementById('empAutoLock')?.checked) : undefined;
const updPayload = {name,department,position,phone,email,joinDate,salary,status,shift_start,shift_karim,iqamaExpiry,healthCertExpiry,healthEduExpiry,deviceUserId};
if(auto_checkout !== undefined) {updPayload.auto_checkout = auto_checkout;}
if(auto_lock !== undefined) {updPayload.auto_lock = auto_lock;}
await persistUpdate('employees', id, updPayload);
Object.assign(emp, updPayload);
closeModal();renderPage();toast('تم تحديث البيانات','success');
}
async function deleteEmployee(id){
if(!confirm('حذف هذا الموظف؟')){return;}
await persistRemove('employees', id);
STATE.employees=STATE.employees.filter(e=>String(e.id)!==String(id));
renderPage();toast('تم الحذف','warning');
}
async function viewEmployeeDetails(id){
const emp=findEmployeeById(id);
if(!emp){return;}
try { await ensureEmployeeCardData(emp); }
catch(e){ toast(e.message, 'error'); }
const attendanceRecords=STATE.attendance.filter(a=>a.employeeId===emp.id).slice(-10);
const leaveRecords=STATE.leaveRequests.filter(l=>l.employeeId===emp.id).slice(-5);
const linkedUser=linkedUserForEmployee(emp);
const canUpload = ['admin','hr'].includes(STATE.currentUser?.role);
showModal(`
<h3><i class=ji data-i=user></i> تفاصيل الموظف</h3>
<div id="modalSmartCard"></div>
<div class="workflow-banner u-mt16"><strong><i class=ji data-i=user-check></i> بصمة الحضور:</strong> ${emp.deviceUserId?`<span class="badge bdg-green"><i class=ji data-i=circle-check></i> مربوط برقم البصمة ${esc(String(emp.deviceUserId))}</span>`:'<span class="badge bdg-orange"><i class=ji data-i=circle-x></i> غير مربوط</span> <button class="btn btn-blue btn-sm" style="margin-inline-start:8px" onclick="closeModal();editEmployee(this.dataset.eid)" data-eid="${emp.id}">ربط رقم البصمة</button>'}</div>
<div class="workflow-banner u-mt16"><strong><i class=ji data-i=key></i> حساب الدخول والصلاحيات:</strong> ${linkedUser?`@${esc(linkedUser.username)} — ${esc(ROLES[linkedUser.role]?.name||linkedUser.role)} · ${linkedUser.active!==false?'نشط':'موقوف'} <button class="btn btn-blue btn-sm" style="margin-inline-start:8px" onclick="closeModal();editUser(this.dataset.eid)" data-eid="${linkedUser.id}">تعديل الحساب</button>`:`غير منشأ <button class="btn btn-green btn-sm" style="margin-inline-start:8px" onclick="closeModal();showCreateEmployeeAccountModal(this.dataset.eid)" data-eid="${emp.id}">إنشاء حساب</button>`}</div>
<div class="tbl-wrap u-mt16">
<div class="tbl-hd"><h3><i class=ji data-i=timer></i> سجل الحضور والانصراف</h3><div class="u-row-wrap"><button class="btn btn-gold btn-sm" onclick="printLuxCard('${emp.id}')"><i class=ji data-i=id-card></i> البطاقة الفاخرة</button><button class="btn btn-green btn-sm" onclick="printEmployeeAttendanceDay('${emp.id}')"><i class=ji data-i=printer></i> اليوم</button><button class="btn btn-blue btn-sm" onclick="printEmployeeAttendanceMonth('${emp.id}')"><i class=ji data-i=calendar></i> الشهر كامل</button></div></div>
<div class="u-mt12" style="background:rgba(201,162,39,.06);border:1px solid rgba(201,162,39,.25);border-radius:10px;padding:12px">
<strong style="font-size:13px"><i class=ji data-i=calendar-search></i> بحث بفترة مخصصة (من — إلى):</strong>
<div class="u-row-wrap u-mt8" style="gap:8px;align-items:center">
<label style="font-size:12px">من</label><input type="date" id="empAttFrom" value="${new Date().toISOString().slice(0,10)}" style="padding:6px 8px;border-radius:8px;border:1px solid #d1d5db">
<label style="font-size:12px">إلى</label><input type="date" id="empAttTo" value="${new Date().toISOString().slice(0,10)}" style="padding:6px 8px;border-radius:8px;border:1px solid #d1d5db">
<button class="btn btn-blue btn-sm" onclick="searchEmployeeAttendanceRange('${emp.id}')"><i class=ji data-i=search></i> بحث</button>
<button class="btn btn-green btn-sm" onclick="printEmployeeAttendanceRange('${emp.id}')"><i class=ji data-i=printer></i> طباعة الفترة</button>
</div>
<div id="empAttRangeResults"></div>
</div>
${attendanceRecords.length>0?`
<div class="tbl-scroll u-mt12">
<table>
<thead><tr><th>التاريخ</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th></tr></thead>
<tbody>
${attendanceRecords.map(a=>{
const krm=a.checkIn&&a.checkOut?((new Date(`2000-01-01 ${a.checkOut}`)-new Date(`2000-01-01 ${a.checkIn}`))/3600000).toFixed(1):'—';
return `<tr><td>${fD(a.date)}</td><td class="c-green">${a.checkIn||'—'}</td><td class="c-red">${a.checkOut||'—'}</td><td class="c-gold">${krm} ساعة</td></tr>`;
}).join('')}
</tbody>
</table>
</div>
`:''}
</div>
${leaveRecords.length>0?`
<div class="tbl-wrap u-mt16">
<div class="tbl-hd"><h3><i class=ji data-i=calendar></i> آخر الإجازات</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>النوع</th><th>من</th><th>إلى</th><th>الحالة</th></tr></thead>
<tbody>
${leaveRecords.map(l=>{
const type=STATE.leaveTypes.find(t=>t.id===l.leaveTypeId);
return `<tr><td>${type?esc(type.name):'—'}</td><td>${fD(l.startDate)}</td><td>${fD(l.endDate)}</td><td><span class="badge ${l.status==='approved'?'bdg-green':l.status==='rejected'?'bdg-red':'bdg-orange'}">${l.status==='approved'?'<i class=ji data-i=circle-check></i> معتمد':l.status==='rejected'?'<i class=ji data-i=circle-x></i> مرفوض':'<i class=ji data-i=hourglass></i> معلق'}</span></td></tr>`;
}).join('')}
</tbody>
</table>
</div>
</div>
`:''}
<div class="modal-footer">
<button class="btn btn-sm" onclick="closeModal();editEmployee('${emp.id}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-gold" onclick="closeModal()">إغلاق</button>
</div>
`);
const modalCard = document.getElementById('modalSmartCard');
if(modalCard){ modalCard.innerHTML = await renderSmartCard(emp, { canUpload }); }
}
async function showSmartCardModal(empId){
const emp = findEmployeeById(empId);
if(!emp) {return;}
try { await ensureEmployeeCardData(emp); }
catch(e){ toast(e.message, 'error'); }
const canUpload = ['admin','hr'].includes(STATE.currentUser?.role);
showModal(`
<h3><i class=ji data-i=ticket></i> البطاقة الذكية - ${esc(emp.name)}</h3>
<div id="modalSmartCardView"></div>
<div class="modal-footer">
<button class="btn btn-gold" onclick="closeModal()">إغلاق</button>
</div>
`);
const container = document.getElementById('modalSmartCardView');
if(container){ container.innerHTML = await renderSmartCard(emp, { canUpload }); }
}
function exportEmployeesExcel(){
const data=[['الرقم الوظيفي','الاسم','القسم','المنصب','الهاتف','البريد','تاريخ الالتحاق','الراتب','الحالة','البصمة الرقمية','رقم البطاقة']];
STATE.employees.forEach(emp=>{
const dept=STATE.hrDepartments.find(d=>d.code===emp.department);
data.push([emp.employeeId||'',emp.name,dept?dept.name:'',emp.position||'',emp.phone||'',emp.email||'',emp.joinDate||'',emp.salary||0,emp.status==='active'?'نشط':'غير نشط',emp.digitalFingerprint||'',emp.cardId||'']);
});
const ws=XLSX.utils.aoa_to_sheet(data);
const wb=XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb,ws,'الموظفون');
XLSX.writeFile(wb,`employees_${today()}.xlsx`);
toast('تم التصدير','success');
}
// ─── استيراد شيت Excel احترافي (قالب + معاينة تحقق + تقرير) ───
const EMP_SHEET_COLS=['الرقم الوظيفي','الاسم','القسم','المنصب','الهاتف','البريد','تاريخ الالتحاق','الراتب','الحالة','انتهاء الإقامة','انتهاء الشهادة الصحية','انتهاء التثقيف الصحي'];
const empNormAr=s=>String(s||'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
function empSheetNormDate(v){
if(v==null||v==='') {return '';}
if(typeof v==='number'&&isFinite(v)&&v>20000&&v<80000){ const d=new Date(Math.round((v-25569)*86400*1000)); return isNaN(d)?'':d.toISOString().slice(0,10); }
const s=String(v).trim();
let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/); if(m) {return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;}
m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/); if(m) {return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
return s ? 'INVALID' : '';
}
function downloadEmpSheetTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([EMP_SHEET_COLS,
['EMP-201','أحمد محمد','الإنتاج','عامل','0500000001','a@x.com','2024-01-15',4500,'نشط','2027-01-01','2027-06-01','2027-06-01'],
['EMP-202','سارة علي','الإدارة','محاسبة','0500000002','','2023-03-01',7000,'نشط','','','']]);
ws['!cols']=EMP_SHEET_COLS.map(()=>({wch:20}));
XLSX.utils.book_append_sheet(wb,ws,'الموظفون');
XLSX.writeFile(wb,'نموذج_استيراد_الموظفين.xlsx');
}
function showEmpSheetImportModal(){
showModal(`
<h3><i class=ji data-i=file-text></i> استيراد الموظفين من Excel</h3>
<div class="note-panel"><strong><i class=ji data-i=clipboard-list></i> الأعمدة:</strong><br>${EMP_SHEET_COLS.join('، ')}</div>
<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);padding:12px;border-radius:var(--r);margin-bottom:14px;font-size:12px">
<i class=ji data-i=alert-triangle></i> <strong>تنبيه:</strong> الرقم الوظيفي الموجود مسبقًا سيُتخطى (لا تعديل) — الصفوف الناقصة (اسم/رقم) تُرفض في المعاينة قبل الاستيراد.
</div>
<div style="display:flex;gap:10px;margin-bottom:16px"><button class="btn btn-blue btn-sm" onclick="downloadEmpSheetTemplate()"><i class=ji data-i=arrow-down></i> تحميل القالب</button></div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="empSheetFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="empSheetPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="importEmpSheet()"><i class=ji data-i=inbox></i> استيراد المعتمد</button></div>`);
document.getElementById('empSheetFile').addEventListener('change',previewEmpSheetFile);
}
function previewEmpSheetFile(){
const file=document.getElementById('empSheetFile')?.files[0];
const prev=document.getElementById('empSheetPreview');
if(!file||!prev) {return;}
const reader=new FileReader();
reader.onload=function(e){
try{
const wb=XLSX.read(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const raw=data.filter((r,i)=>i>0&&(String(r[0]).trim()||String(r[1]).trim()));
const existingIds=new Set((STATE.employees||[]).map(x=>String(x.employeeId||'').trim()));
const deptByName=new Map((STATE.hrDepartments||[]).map(d=>[empNormAr(String(d.name||'')),d.code]));
const seen=new Set(); const rows=[];
for(const r of raw){
const o={id:String(r[0]||'').trim(),name:String(r[1]||'').trim(),dept:String(r[2]||'').trim(),pos:String(r[3]||'').trim(),phone:String(r[4]||'').trim(),email:String(r[5]||'').trim(),join:empSheetNormDate(r[6]),sal:parseFloat(r[7])||0,st:String(r[8]||'نشط').trim(),iq:empSheetNormDate(r[9]),hc:empSheetNormDate(r[10]),he:empSheetNormDate(r[11]),err:''};
if(!o.name||!o.id) {o.err='الاسم والرقم الوظيفي مطلوبان';}
else if(seen.has(o.id)) {o.err='رقم مكرر داخل الملف';}
else if(existingIds.has(o.id)) {o.err='موجود مسبقًا — سيُتخطى';}
else if(o.join==='INVALID'||o.iq==='INVALID'||o.hc==='INVALID'||o.he==='INVALID') {o.err='صيغة تاريخ غير صحيحة (YYYY-MM-DD)';}
else if(o.sal<0) {o.err='الراتب غير صحيح';}
seen.add(o.id);
if(!o.err&&o.dept){ const code=deptByName.get(empNormAr(o.dept))||(STATE.hrDepartments||[]).find(d=>String(d.code)===o.dept)?.code; o.deptCode=code||''; if(!code) {o.warn='قسم غير معروف — سيُترك فارغًا';} }
rows.push(o);
}
window._empSheetRows=rows;
const ok=rows.filter(x=>!x.err&&!(existingIds.has(x.id))).length;
const dup=rows.filter(x=>x.err&&x.err.includes('موجود')).length;
const bad=rows.filter(x=>x.err&&!x.err.includes('موجود')).length;
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${rows.length} صف — <span class="c-green">صالح: ${ok}</span> — <span class="text-muted">موجود: ${dup}</span> — <span class="c-red">مرفوض: ${bad}</span></div>
<table style="width:100%;font-size:12px;border-collapse:collapse"><tr class="u-faint"><th style="text-align:right;padding:4px">الرقم</th><th>الاسم</th><th>القسم</th><th>الراتب</th><th>الحالة</th></tr>
${rows.slice(0,8).map(x=>`<tr style="border-top:1px solid var(--border)"><td style="padding:4px">${esc(x.id||'—')}</td><td>${esc(x.name||'—')}${x.err?`<br><small class="c-red">${esc(x.err)}</small>`:''}${x.warn?`<br><small class="c-gold">${esc(x.warn)}</small>`:''}</td><td class="u-ta-c">${esc(x.dept||'—')}</td><td class="u-ta-c">${fN(x.sal)}</td><td class="u-ta-c">${x.err?'<span class="badge bdg-red">مرفوض</span>':existingIds.has(x.id)?'<span class="badge bdg-gray">موجود</span>':'<span class="badge bdg-green">جاهز</span>'}</td></tr>`).join('')}
${rows.length>8?`<tr><td colspan="5" style="color:var(--text3);text-align:center;padding:6px">... و${rows.length-8} صفوف أخرى</td></tr>`:''}</table></div>`;
}catch(err){ prev.innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
};
reader.readAsBinaryString(file);
}
async function importEmpSheet(){
const rows=(window._empSheetRows||[]).filter(x=>!x.err);
if(!rows.length){ toast('لا صفوف صالحة للاستيراد — ارفع الملف وعاين أولاً','error'); return; }
if(!confirm(`استيراد ${rows.length} موظف جديد؟`)) {return;}
showLoad();
let added=0, skipped=0; const errs=[];
try{
const existingIds=new Set((STATE.employees||[]).map(x=>String(x.employeeId||'').trim()));
for(const x of rows){
if(existingIds.has(x.id)){ skipped++; continue; }
try{
const saved=await persistCreate('employees',(s)=>STATE.employees.push(s),{
name:x.name,employeeId:x.id,department:x.deptCode||'',position:x.pos,phone:x.phone,email:x.email,
joinDate:x.join||today(),salary:x.sal,status:x.st.includes('غير')?'inactive':'active',
iqamaExpiry:x.iq||null,healthCertExpiry:x.hc||null,healthEduExpiry:x.he||null,
userId:null,photo:null,digitalFingerprint:null,cardId:null});
existingIds.add(x.id); added++;
}catch(e){ errs.push(`${x.id}: ${e.message||'فشل'}`); }
}
closeModal(); renderPage();
toast(`تم: ${added} جديد${skipped?` — تُخطي ${skipped} موجود`:''}${errs.length?` — أخطاء: ${errs.length}`:''}`, errs.length?'warning':'success');
if(errs.length) {console.warn('EmpSheet errors:', errs);}
}catch(e){ toast(e.message||'فشل الاستيراد','error'); }finally{ hideLoad(); }
}

export { renderEmployeesPage, empShiftChip, shiftEndText, renderEmployeesCards, searchEmployeeById, normalizeAr, revertAllInferred, revertInference, filterEmployees, showAddEmployeeModal, addEmployee, editEmployee, updateEmployee, deleteEmployee, viewEmployeeDetails, showSmartCardModal, exportEmployeesExcel, EMP_SHEET_COLS, empNormAr, empSheetNormDate, downloadEmpSheetTemplate, showEmpSheetImportModal, previewEmpSheetFile, importEmpSheet };
