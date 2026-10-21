/**
 * features/bulk-import.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// <i class=ji data-i=circle-check></i> BULK IMPORT - PROFESSIONAL WIZARD UI
// ============================================
let BULK_IMPORT_ROWS = [];
const BULK_AR_TO_EN = {'أ':'a','ا':'a','إ':'e','آ':'aa','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'z','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ى':'a','ة':'a','ء':'a','ئ':'y','ؤ':'w',' ':' ','_':'_','-':'-'};
function bulkTransliterate(name){ return name.split('').map(c => BULK_AR_TO_EN[c] ?? c).join('').toLowerCase().replace(/[^a-z0-9\s._-]/g,'').trim(); }
// توليد كلمة مرور من 6 أرقام (الحد الأدنى المقبول في السيرفر) لسهولة الحفظ
function bulkGenPassword(){
const digits = '0123456789';
let pass = '';
for(let i=0; i<6; i++){
pass += digits[Math.floor(Math.random()*digits.length)];
}
return pass;
}
function bulkGenUsername(name, index, fmt, prefix, usedUsernames){
const en = bulkTransliterate(name);
const parts = en.split(' ').filter(Boolean);
const first = parts[0] || 'user';
const num = String(index + 1).padStart(3, '0');
let base = '';
if(fmt === 'first_num') {base = first + (index + 1);}
else if(fmt === 'full_dot') {base = parts.join('.') || ('user' + (index + 1));}
else if(fmt === 'initials_num') {base = (first[0] || 'u') + num;}
else if(fmt === 'emp_num') {base = 'emp' + num;}
const uname = (prefix + base).replace(/[^a-z0-9._-]/g,'').slice(0,30) || ('user' + (index + 1));
let attempt = uname, suffix = 2;
while(usedUsernames.has(attempt)){ attempt = uname + suffix++; }
usedUsernames.add(attempt);
return attempt;
}
function showBulkImportModal(){
BULK_IMPORT_ROWS = [];
const roleOpts = Object.keys(ROLES).map(k => `<option value="${k}">${ROLES[k].icon} ${ROLES[k].name}</option>`).join('');
showModal(`
<div class="bulk-wizard">
<div class="bulk-wizard-header">
<h2><i class=ji data-i=user></i> استيراد موظفين جماعي</h2>
<p>ارفع ملف Excel/CSV أو اكتب الأسماء مباشرة — النظام يولّد يوزر وباسورد (6 أرقام) تلقائياً</p>
</div>
<div class="bulk-steps">
<div class="bulk-step active" id="bulkStep1">
<div class="bulk-step-num">1</div>
<div class="bulk-step-title">إدخال الأسماء</div>
</div>
<div class="bulk-step" id="bulkStep2">
<div class="bulk-step-num">2</div>
<div class="bulk-step-title">الإعدادات</div>
</div>
<div class="bulk-step" id="bulkStep3">
<div class="bulk-step-num">3</div>
<div class="bulk-step-title">المراجعة والتصدير</div>
</div>
</div>
<div class="bulk-step-body" id="bulkStepBody">
<!-- STEP 1: Input -->
<div id="bulkStep1Content">
<div class="bulk-dropzone" id="bulkDropzone" onclick="document.getElementById('bulkFileInput').click()">
<div class="bulk-dropzone-icon"><i class=ji data-i=folder-open></i></div>
<div class="bulk-dropzone-title">اسحب الملف هنا أو اضغط للاختيار</div>
<div class="bulk-dropzone-sub">Excel (.xlsx) • CSV • TXT — عمود واحد بالأسماء</div>
<div class="bulk-dropzone-formats">
<span>XLSX</span><span>XLS</span><span>CSV</span><span>TXT</span>
</div>
<input type="file" id="bulkFileInput" accept=".xlsx,.xls,.csv,.txt" style="display:none" onchange="bulkReadFile(this.files[0])">
</div>
<div class="bulk-or-divider">أو اكتب الأسماء يدوياً</div>
<div class="fg">
<textarea id="bulkNamesInput" rows="6" placeholder="أحمد محمد&#10;فاطمة علي&#10;محمود حسن&#10;..." style="font-family:inherit;resize:vertical"></textarea>
</div>
</div>
<!-- STEP 2: Options (hidden initially) -->
<div id="bulkStep2Content" style="display:none">
<div class="bulk-options-grid">
<div class="bulk-option-card">
<label><i class=ji data-i=file-text></i> تنسيق اسم المستخدم</label>
<div class="bulk-format-options" id="bulkFormatOptions">
<div class="bulk-format-opt selected" data-fmt="first_num" onclick="bulkSelectFormat(this)">
الاسم الأول + رقم
<span class="fmt-example">ahmed1</span>
</div>
<div class="bulk-format-opt" data-fmt="full_dot" onclick="bulkSelectFormat(this)">
الاسم كامل بنقطة
<span class="fmt-example">ahmed.ali</span>
</div>
<div class="bulk-format-opt" data-fmt="initials_num" onclick="bulkSelectFormat(this)">
أول حرف + رقم
<span class="fmt-example">a001</span>
</div>
<div class="bulk-format-opt" data-fmt="emp_num" onclick="bulkSelectFormat(this)">
emp + رقم
<span class="fmt-example">emp001</span>
</div>
</div>
</div>
<div class="bulk-option-card">
<label><i class=ji data-i=activity></i> الدور الافتراضي</label>
<select id="bulkRole">${roleOpts}</select>
</div>
<div class="bulk-option-card">
<label><i class=ji data-i=bookmark></i> بادئة اسم المستخدم (اختياري)</label>
<input type="text" id="bulkPrefix" placeholder="مثال: gv_">
</div>
<div class="bulk-option-card">
<label><i class=ji data-i=lock></i> طول كلمة المرور</label>
<div class="callout-gold">
<div class="callout-value">6 أرقام</div>
<div class="callout-caption">لسهولة الحفظ</div>
</div>
</div>
<div class="bulk-option-card">
<label><i class=ji data-i=user-check></i> رقم البصمة الأول</label>
<input type="number" id="bulkFpStart" min="1" step="1" value="1">
<div class="callout-caption">الرقم الوظيفي = رقم البصمة — يتخطى الأرقام المستخدمة تلقائيًا لمنع التعارض</div>
</div>
</div>
</div>
<!-- STEP 3: Preview (hidden initially) -->
<div id="bulkStep3Content" style="display:none">
<div class="bulk-stats-bar" id="bulkStatsBar"></div>
<div class="bulk-preview-table" id="bulkPreviewTable"></div>
</div>
</div>
<div class="bulk-action-bar" id="bulkActionBar">
<button class="btn btn-gold" id="bulkNextBtn" data-karim-action="bulkNextStep"><i class=ji data-i=zap></i> توليد المعاينة</button>
<button class="btn btn-red" id="bulkClearBtn" data-karim-action="bulkClearAll" style="display:none"><i class=ji data-i=trash></i> مسح الكل</button>
</div>
</div>
<div class="modal-footer">
<button class="btn" data-karim-action="closeModal">إلغاء</button>
<button class="btn btn-gold" id="bulkConfirmBtn" style="display:none" data-karim-action="bulkConfirmImport"><i class=ji data-i=circle-check></i> إضافة الكل للنظام</button>
</div>
`,'modal-wide');
// Setup drag & drop
setTimeout(bulkSetupDragDrop, 100);
}
function bulkSetupDragDrop(){
const dropzone = document.getElementById('bulkDropzone');
if(!dropzone) {return;}
['dragenter','dragover'].forEach(evt => {
dropzone.addEventListener(evt, (e) => {
e.preventDefault();
e.stopPropagation();
dropzone.classList.add('dragover');
});
});
['dragleave','drop'].forEach(evt => {
dropzone.addEventListener(evt, (e) => {
e.preventDefault();
e.stopPropagation();
dropzone.classList.remove('dragover');
});
});
dropzone.addEventListener('drop', (e) => {
const files = e.dataTransfer.files;
if(files && files.length > 0) {bulkReadFile(files[0]);}
});
}
function bulkSelectFormat(el){
document.querySelectorAll('.bulk-format-opt').forEach(o => o.classList.remove('selected'));
el.classList.add('selected');
}
function bulkGetSelectedFormat(){
const sel = document.querySelector('.bulk-format-opt.selected');
return sel ? sel.dataset.fmt : 'first_num';
}
let bulkCurrentStep = 1;
// أرقام البصمة/الوظيفية المستخدمة — بصيغها المختلفة لمنع أي تعارض
function bulkFpForms(v){
  const s = String(v ?? '').trim();
  if(!s) {return [];}
  const forms = [s];
  if(/^\d+$/.test(s)){
    const n = String(Number(s));
    if(!forms.includes(n)) {forms.push(n);}
    const p = s.padStart(3,'0');
    if(!forms.includes(p)) {forms.push(p);}
  }
  return forms;
}
function bulkUsedFpSet(){
  const s = new Set();
  (STATE.employees || []).forEach(e => {
    bulkFpForms(e.deviceUserId).forEach(f => s.add(f));
    if(/^\d+$/.test(String(e.employeeId || '').trim())) {bulkFpForms(e.employeeId).forEach(f => s.add(f));}
  });
  return s;
}
// تخصيص أرقام بصمة متتالية من رقم البداية مع تخطي المستخدم منها
function bulkAllocFp(start, count){
  const used = bulkUsedFpSet();
  (BULK_IMPORT_ROWS || []).forEach(r => { if(r.fp) {bulkFpForms(r.fp).forEach(f => used.add(f));} });
  const out = [];
  let n = Math.max(1, Math.floor(Number(start) || 1));
  while(out.length < count && n < 1000000){
    const k = String(n);
    if(!used.has(k)){ out.push(k); bulkFpForms(k).forEach(f => used.add(f)); }
    n++;
  }
  return out;
}
function bulkNextStep(){
if(bulkCurrentStep === 1){// Validate input
const text = (document.getElementById('bulkNamesInput')?.value || '').trim();
if(!text){ toast('أدخل أسماء الموظفين أولاً','error'); return; }
const names = text.split('\n').map(l => l.replace(/\t/g,' ').trim()).filter(l => l.length > 1);
if(names.length === 0){ toast('لم يتم العثور على أسماء صالحة','error'); return; }
// Move to step 2
bulkCurrentStep = 2;
document.getElementById('bulkStep1').classList.remove('active');
document.getElementById('bulkStep1').classList.add('completed');
document.getElementById('bulkStep2').classList.add('active');
document.getElementById('bulkStep1Content').style.display = 'none';
document.getElementById('bulkStep2Content').style.display = 'block';
document.getElementById('bulkNextBtn').innerHTML = '<i class=ji data-i=zap></i> توليد البيانات';
document.getElementById('bulkClearBtn').style.display = '';
}else if(bulkCurrentStep === 2){
// Generate users
const text = (document.getElementById('bulkNamesInput')?.value || '').trim();
const names = text.split('\n').map(l => l.replace(/\t/g,' ').trim()).filter(l => l.length > 1);
const fmt = bulkGetSelectedFormat();
const prefix = (document.getElementById('bulkPrefix')?.value || '').trim();
const role = document.getElementById('bulkRole').value;
const usedUsernames = new Set(STATE.users.map(u => u.username));
const fpStart = document.getElementById('bulkFpStart')?.value || 1;
const fps = bulkAllocFp(fpStart, names.length);
BULK_IMPORT_ROWS = names.map((name, i) => ({
name,
username: bulkGenUsername(name, i, fmt, prefix, usedUsernames),
password: bulkGenPassword(),
role,
fp: fps[i] || String(Math.max(1, Math.floor(Number(fpStart) || 1)) + i)
}));
// Move to step 3
bulkCurrentStep = 3;
document.getElementById('bulkStep2').classList.remove('active');
document.getElementById('bulkStep2').classList.add('completed');
document.getElementById('bulkStep3').classList.add('active');
document.getElementById('bulkStep2Content').style.display = 'none';
document.getElementById('bulkStep3Content').style.display = 'block';
bulkRenderPreview();
document.getElementById('bulkNextBtn').style.display = 'none';
document.getElementById('bulkClearBtn').innerHTML = '<i class=ji data-i=refresh></i> إعادة توليد';
document.getElementById('bulkConfirmBtn').style.display = '';
}
}
function bulkRenderPreview(){
const statsBar = document.getElementById('bulkStatsBar');
const previewTable = document.getElementById('bulkPreviewTable');
if(!statsBar || !previewTable) {return;}
const roleCount = {};
BULK_IMPORT_ROWS.forEach(r => { roleCount[r.role] = (roleCount[r.role]||0)+1; });
statsBar.innerHTML = `
<div class="bulk-stat">
<div class="bulk-stat-val">${BULK_IMPORT_ROWS.length}</div>
<div class="bulk-stat-lbl">إجمالي المستخدمين</div>
</div>
<div class="bulk-stat">
<div class="bulk-stat-val">${Object.keys(roleCount).length}</div>
<div class="bulk-stat-lbl">عدد الأدوار</div>
</div>
<div class="bulk-stat">
<div class="bulk-stat-val">6</div>
<div class="bulk-stat-lbl">أرقام كلمة المرور</div>
</div>
<div class="bulk-stat">
<div class="bulk-stat-val">${new Set(BULK_IMPORT_ROWS.map(r=>r.username)).size}</div>
<div class="bulk-stat-lbl">أسماء مستخدمين فريدة</div>
</div>
`;
previewTable.innerHTML = `
<table style="width:100%">
<thead>
<tr>
<th style="width:40px">#</th>
<th>الاسم</th>
<th>اسم المستخدم</th>
<th>كلمة المرور</th>
<th>رقم البصمة</th>
<th>الدور</th>
<th style="width:60px"></th>
</tr>
</thead>
<tbody>
${BULK_IMPORT_ROWS.map((u,i) => `
<tr>
<td class="row-num">${i+1}</td>
<td><strong>${esc(u.name)}</strong></td>
<td><span class="mono">${esc(u.username)}</span></td>
<td><span class="mono" style="color:var(--green);font-size:13px">${esc(u.password)}</span></td>
<td><span class="badge bdg-green"><i class=ji data-i=user-check></i> ${esc(u.fp || '—')}</span></td>
<td><span class="badge bdg-purple">${ROLES[u.role]?.icon||''} ${ROLES[u.role]?.name||u.role}</span></td>
<td><button class="btn btn-red btn-sm" data-karim-action="bulkDeleteRow" data-karim-arg0="${i}" title="حذف"><i class=ji data-i=trash></i></button></td>
</tr>
`).join('')}
</tbody>
</table>
`;
}
function bulkDeleteRow(i){
BULK_IMPORT_ROWS.splice(i,1);
if(BULK_IMPORT_ROWS.length === 0){
bulkClearAll();
return;
}
bulkRenderPreview();
}
function bulkClearAll(){
BULK_IMPORT_ROWS = [];
bulkCurrentStep = 1;
document.querySelectorAll('.bulk-step').forEach(s => { s.classList.remove('active','completed'); });
document.getElementById('bulkStep1').classList.add('active');
document.getElementById('bulkStep1Content').style.display = 'block';
document.getElementById('bulkStep2Content').style.display = 'none';
document.getElementById('bulkStep3Content').style.display = 'none';
document.getElementById('bulkNextBtn').style.display = '';
document.getElementById('bulkNextBtn').innerHTML = '<i class=ji data-i=zap></i> توليد المعاينة';
document.getElementById('bulkClearBtn').style.display = 'none';
document.getElementById('bulkClearBtn').innerHTML = '<i class=ji data-i=trash></i> مسح الكل';
document.getElementById('bulkConfirmBtn').style.display = 'none';
const namesInput = document.getElementById('bulkNamesInput');
if(namesInput) {namesInput.value = '';}
}
// حدود الاستيراد: ملف ضخم أو ملف Thousands الصفوف يستهلك ذاكرة جهاز
// الكاشير بالكامل (المتصفح يجمّد) — والقراءة تتم في المتصفح.
const BULK_IMPORT_MAX_BYTES = 20 * 1024 * 1024;   // 20MB
const BULK_IMPORT_MAX_ROWS = 20000;
function bulkReadFile(file){
if(!file) {return;}
if(typeof file.size === 'number' && file.size > BULK_IMPORT_MAX_BYTES){
toast(`حجم الملف يتجاوز الحد (${Math.round(BULK_IMPORT_MAX_BYTES/1024/1024)}MB) — اختر ملفًا أصغر`,'error');
return;
}
const ext = file.name.split('.').pop().toLowerCase();
const reader = new FileReader();
if(ext === 'xlsx' || ext === 'xls'){
reader.onload = e => {
try{
const wb = window.XLSXGuard.readWorkbook(e.target.result, { type: 'array' });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
if(rows.length > BULK_IMPORT_MAX_ROWS){
toast(`الملف يحوي ${rows.length} صفًا — الحد ${BULK_IMPORT_MAX_ROWS}`,'error');
return;
}
const names = rows.map(r => (r[0] || '').toString().trim()).filter(n => n.length > 1);
document.getElementById('bulkNamesInput').value = names.join('\n');
toast(`تم تحميل ${names.length} اسم من الملف`);
}catch(_){ toast('خطأ في قراءة الملف','error'); }
};
reader.readAsArrayBuffer(file);
}else{
reader.onload = e => {
const names = e.target.result.split(/[\n,;]/).map(l => l.trim()).filter(n => n.length > 1);
document.getElementById('bulkNamesInput').value = names.join('\n');
toast(`تم تحميل ${names.length} اسم من الملف`);
};
reader.readAsText(file, 'UTF-8');
}
}
async function bulkConfirmImport(){
if(BULK_IMPORT_ROWS.length === 0){ toast('لا توجد بيانات','error'); return; }
if(!confirm(`سيتم إضافة ${BULK_IMPORT_ROWS.length} من المستخدمين إلى النظام. هل تريد المتابعة؟`)) {return;}
const usedUsernames = new Set(STATE.users.map(u => u.username));
if(!STATE.employees) {STATE.employees = [];}
let added = 0, skipped = 0, failed = 0;
showLoad();
try {
  for(const [,row] of BULK_IMPORT_ROWS.entries()){
    if(usedUsernames.has(row.username)){ skipped++; continue; }
    // أمان أخير ضد تعارض رقم البصمة/الوظيفي
    const fpTaken = (STATE.employees || []).some(e =>
      bulkFpForms(e.deviceUserId).includes(String(row.fp)) ||
      String(e.employeeId || '').trim() === String(row.fp));
    if(fpTaken){ skipped++; continue; }
    try {
      const savedUser = await apiCreate('users', { username: row.username, password: row.password, role: row.role, name: row.name, active: true });
      const savedEmployee = await apiCreate('employees', {
        name: row.name,
        employeeId: String(row.fp),
        deviceUserId: String(row.fp),
        department: STATE.hrDepartments[0]?.code || '',
        position: ROLES[row.role]?.name || '',
        phone: '', email: '', joinDate: today(), salary: 0, status: 'active',
        userId: savedUser.id, iqamaExpiry: null, healthCertExpiry: null, healthEduExpiry: null,
        photo: null, digitalFingerprint: null, cardId: null,
      });
      usedUsernames.add(row.username);
      STATE.users.push(savedUser);
      STATE.employees.push(savedEmployee);
      added++;
    } catch(error) {
      failed++;
      console.error('Bulk account import failed:', row.username, error);
    }
  }
  renderPage();
  toast(`حُفظ ${added} حسابًا في قاعدة البيانات${skipped ? `، تم تجاهل ${skipped} مكرر` : ''}${failed ? `، وفشل ${failed}` : ''}`, failed ? 'warning' : 'success');
  bulkShowResultsModal();
} finally { hideLoad(); }
}
function bulkShowResultsModal(){
closeModal();
setTimeout(() => {
showModal(`
<h3><i class=ji data-i=circle-check></i> تم استيراد المستخدمين بنجاح</h3>
<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);padding:12px;border-radius:var(--r);margin-bottom:16px;font-size:13px">
<i class=ji data-i=alert-triangle></i> <strong>تنبيه مهم:</strong> احفظ نسخة من بيانات الدخول الآن — كلمات المرور (6 أرقام) لن تظهر مرة أخرى بنفس الشكل.
</div>
<div style="max-height:380px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--r)">
<table style="width:100%;border-collapse:collapse;font-size:13px">
<thead>
<tr style="background:var(--bg3);position:sticky;top:0">
<th class="u-p10">#</th>
<th class="u-p10">الاسم</th>
<th class="u-p10">اسم المستخدم</th>
<th class="u-p10">كلمة المرور</th>
<th class="u-p10">رقم البصمة</th>
<th class="u-p10">الدور</th>
</tr>
</thead>
<tbody>
${BULK_IMPORT_ROWS.map((u,i) => `
<tr style="border-top:1px solid var(--border)">
<td style="padding:10px;text-align:center">${i+1}</td>
<td class="u-p10"><strong>${esc(u.name)}</strong></td>
<td class="u-p10"><span class="mono" style="display:inline-block;padding:3px 8px;background:var(--bg3);border-radius:6px">${esc(u.username)}</span></td>
<td class="u-p10"><span class="mono" style="display:inline-block;padding:3px 8px;background:rgba(46,204,113,0.1);color:var(--green);border-radius:6px;font-size:14px;font-weight:900;letter-spacing:2px">${esc(u.password)}</span></td>
<td class="u-p10"><span class="badge bdg-green">${esc(u.fp || '—')}</span></td>
<td class="u-p10"><span class="badge bdg-purple">${ROLES[u.role]?.icon||''} ${ROLES[u.role]?.name||u.role}</span></td>
</tr>
`).join('')}
</tbody>
</table>
</div>
<div class="modal-footer" style="flex-wrap:wrap">
<button class="btn btn-blue btn-sm" data-karim-action="bulkExportExcel"><i class=ji data-i=inbox></i> تحميل Excel</button>
<button class="btn btn-sm" data-karim-action="bulkExportCSV"><i class=ji data-i=file-text></i> تحميل CSV</button>
<button class="btn btn-sm" data-karim-action="bulkExportJSON">{ } JSON</button>
<button class="btn btn-sm" data-karim-action="bulkCopyAllPasswords"><i class=ji data-i=clipboard-list></i> نسخ كل الباسوردات</button>
<button class="btn btn-sm" data-karim-action="bulkPrint"><i class=ji data-i=printer></i> طباعة جدول</button>
<button class="btn btn-green btn-sm" data-karim-action="bulkPrintSlips"><i class=ji data-i=ticket></i> طباعة قصاصات</button>
<button class="btn btn-gold" data-karim-action="closeModal"><i class=ji data-i=circle-check></i> تم</button>
</div>
`,'modal-wide');
}, 300);
}
function bulkExportExcel(){
const data = [['#','الاسم','اسم المستخدم','كلمة المرور','رقم البصمة','الدور']];
BULK_IMPORT_ROWS.forEach((u,i) => data.push([i+1, u.name, u.username, u.password, u.fp || '', ROLES[u.role]?.name || u.role]));
const ws = XLSX.utils.aoa_to_sheet(data);
ws['!cols'] = [{wch:4},{wch:25},{wch:20},{wch:10},{wch:12},{wch:18}];
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'مستخدمين');
XLSX.writeFile(wb, `bulk_users_${Date.now()}.xlsx`);
toast('تم تحميل ملف Excel','success');
}
function bulkExportCSV(){
let csv = '#,الاسم,اسم المستخدم,كلمة المرور,رقم البصمة,الدور\n';
BULK_IMPORT_ROWS.forEach((u,i) => {
csv += `${i+1},"${u.name}","${u.username}","${u.password}","${u.fp || ''}","${ROLES[u.role]?.name||u.role}"\n`;
});
const blob = new Blob(['\uFEFF'+csv], { type: 'text/csv;charset=utf-8' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `bulk_users_${Date.now()}.csv`;
a.click();
URL.revokeObjectURL(url);
toast('تم تحميل ملف CSV','success');
}
function bulkExportJSON(){
const data = BULK_IMPORT_ROWS.map((u,i) => ({
index: i+1,
name: u.name,
username: u.username,
password: u.password,
fingerprintId: u.fp || null,
role: u.role,
roleName: ROLES[u.role]?.name || u.role
}));
const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `bulk_users_${Date.now()}.json`;
a.click();
URL.revokeObjectURL(url);
toast('تم تحميل ملف JSON','success');
}
function bulkCopyAllPasswords(){
const text = BULK_IMPORT_ROWS.map((u,i) => `${i+1}. ${u.name} | ${u.username} | ${u.password}`).join('\n');
navigator.clipboard.writeText(text).then(() => {
toast('تم نسخ جميع البيانات','success');
}).catch(() => {
// Fallback
const ta = document.createElement('textarea');
ta.value = text;
document.body.appendChild(ta);
ta.select();
document.execCommand('copy');
document.body.removeChild(ta);
toast('تم نسخ جميع البيانات','success');
});
}
function bulkPrint(){
const printWin = (window.openInAppReport ? window.openInAppReport('معاينة الاستيراد') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
printWin.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>بيانات المستخدمين</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
<style>
body{font-family:'Cairo',sans-serif;padding:20px;direction:rtl}
h1{text-align:center;color:#d4a843;margin-bottom:10px}
.meta{text-align:center;color:#666;margin-bottom:20px;font-size:12px}
table{width:100%;border-collapse:collapse;margin-top:20px}
th,td{border:1px solid #000;padding:8px;text-align:center}
th{background:#d4a843;color:#000;font-weight:900}
.pass{font-family:monospace;font-size:16px;font-weight:900;letter-spacing:3px;color:#2ecc71}
.controls{text-align:center;margin-bottom:20px}
.controls button{padding:10px 25px;margin:0 10px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif}
.btn-print{background:#2ecc71;color:white}
.btn-close{background:#e74c3c;color:white}
@media print{.controls{display:none}}
</style></head><body>
<div class="controls">
<button class="btn-print" onclick="window.print()"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn-close" onclick="window.close()"><i class=ji data-i=circle-x></i> إغلاق</button>
</div>
<div style="text-align:center;margin-bottom:12px"><img src="${esc(getAbsoluteLogoSrc())}" style="width:64px;height:64px;object-fit:contain;background:#fff;border:2px solid #d4a843;border-radius:12px;padding:5px" alt="مطاعم الشرفه العالمي"></div>
<h1><i class=ji data-i=lock></i> بيانات دخول المستخدمين</h1>
<div class="meta">${STATE.settings.name} | تم الإنشاء: ${fDT(new Date().toISOString())}</div>
<table>
<thead><tr><th>#</th><th>الاسم</th><th>اسم المستخدم</th><th>كلمة المرور</th><th>رقم البصمة</th><th>الدور</th></tr></thead>
<tbody>
${BULK_IMPORT_ROWS.map((u,i) => `<tr>
<td>${i+1}</td>
<td>${esc(u.name)}</td>
<td style="direction:ltr">${esc(u.username)}</td>
<td class="pass">${esc(u.password)}</td>
<td style="font-weight:900">${esc(u.fp || '—')}</td>
<td>${ROLES[u.role]?.name||u.role}</td>
</tr>`).join('')}
</tbody>
</table>
</body></html>`);
printWin.document.close();
setTimeout(() => printWin.focus(), 500);
}
// قصاصات فردية: ورقة لكل موظف (الاسم + اليوزر + الباسورد + رقم البصمة) للتوزيع
function bulkPrintSlips(){
const printWin = (window.openInAppReport ? window.openInAppReport('معاينة الاستيراد') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
const slips = BULK_IMPORT_ROWS.map((u) => `
<div class="slip">
<div class="slip-head"><img src="${esc(getAbsoluteLogoSrc())}" alt=""><div><b>${STATE.settings.name}</b><small>بيانات الدخول الخاصة بك — سرية</small></div></div>
<div class="slip-name">${esc(u.name)}</div>
<div class="slip-row"><span>اسم المستخدم</span><b class="ltr">${esc(u.username)}</b></div>
<div class="slip-row"><span>كلمة المرور</span><b class="pass ltr">${esc(u.password)}</b></div>
<div class="slip-row"><span>رقم البصمة</span><b class="ltr">${esc(u.fp || '—')}</b></div>
<div class="slip-row"><span>الدور</span><b>${ROLES[u.role]?.name || u.role}</b></div>
<div class="slip-foot">سجّل هذا الرقم على جهاز البصمة بنفس رقم البصمة أعلاه</div>
</div>`).join('');
printWin.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>قصاصات دخول الموظفين</title>
<style>
body{font-family:'Cairo',Arial,sans-serif;padding:16px;direction:rtl;color:#222}
.controls{text-align:center;margin-bottom:14px}
.controls button{padding:10px 25px;margin:0 8px;border:none;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}
.btn-print{background:#2ecc71;color:#fff}
.btn-close{background:#e74c3c;color:#fff}
.slips{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.slip{border:2px dashed #999;border-radius:10px;padding:12px 14px;page-break-inside:avoid}
.slip-head{display:flex;align-items:center;gap:10px;border-bottom:1px solid #ddd;padding-bottom:8px;margin-bottom:8px}
.slip-head img{width:40px;height:40px;object-fit:contain}
.slip-head b{display:block;font-size:14px}
.slip-head small{color:#777;font-size:11px}
.slip-name{font-size:18px;font-weight:900;text-align:center;margin:4px 0 8px}
.slip-row{display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-top:1px dotted #ddd;font-size:13px}
.slip-row b{font-size:14px}
.slip-row .pass{font-family:monospace;font-size:18px;letter-spacing:3px;color:#0b8a4a}
.ltr{direction:ltr;unicode-bidi:embed}
.slip-foot{margin-top:8px;font-size:11px;color:#777;text-align:center}
@media print{.controls{display:none}body{padding:0}.slips{gap:10px}}
</style></head><body>
<div class="controls">
<button class="btn-print" onclick="window.print()">طباعة</button>
<button class="btn-close" onclick="window.close()">إغلاق</button>
</div>
<div class="slips">${slips}</div>
</body></html>`);
printWin.document.close();
setTimeout(() => printWin.focus(), 500);
}

export { BULK_IMPORT_ROWS, BULK_AR_TO_EN, bulkTransliterate, bulkGenPassword, bulkGenUsername, showBulkImportModal, bulkSetupDragDrop, bulkSelectFormat, bulkGetSelectedFormat, bulkNextStep, bulkFpForms, bulkUsedFpSet, bulkAllocFp, bulkRenderPreview, bulkDeleteRow, bulkClearAll, bulkReadFile, bulkConfirmImport, bulkShowResultsModal, bulkExportExcel, bulkExportCSV, bulkExportJSON, bulkCopyAllPasswords, bulkPrint, bulkPrintSlips };
