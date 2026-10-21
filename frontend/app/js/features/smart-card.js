/**
 * features/smart-card.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// SMART CARD UTILS
// ============================================
function generateFingerprintSync(emp){
const data = `${emp.id}|${emp.employeeId||''}|${emp.name}|${emp.joinDate||''}`;
let hash = 0;
for(let i=0;i<data.length;i++){
const chr = data.charCodeAt(i);
hash = ((hash<<5)-hash)+chr;
hash |= 0;
}
const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8,'0');
const timestamp = Date.now().toString(16).toUpperCase().slice(-8);
return `${hex}-${timestamp}`.substring(0,16);
}
async function generateDigitalFingerprint(emp){
try{
const data = `${emp.id}-${emp.employeeId}-${emp.name}-${emp.joinDate}-${Date.now()}-${Math.random()}`;
const encoder = new TextEncoder();
const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
const hashArray = Array.from(new Uint8Array(hashBuffer));
return hashArray.map(b=>b.toString(16).padStart(2,'0')).join('').substring(0,16).toUpperCase();
}catch(_){ return generateFingerprintSync(emp); }
}
function findEmployeeById(id){ return STATE.employees.find(e=>String(e.id)===String(id)) || (STATE.deptEmployees||[]).find(e=>String(e.id)===String(id)); }
// شارة الدوام المجدول (2026-10-01): التعديل بتاريخ مستقبلي لا يسمع في البطاقة
// فورًا بتصميم النظام — بدل الالتباس نعرض "مجدول من تاريخ كذا" تحت الدوام الحالي.
// تملأ لاحقًا بلا حجب (نفس نمط QR) — أي فشل = لا شارة (صمت آمن).
function fillScheduledShiftBadge(empId){
try{
apiFetch('/hr/shift-schedule/' + encodeURIComponent(empId)).then((r)=>{
const box = document.getElementById('schedBadge-' + empId);
if(!box) {return;}
const next = Array.isArray(r.scheduled) ? r.scheduled[0] : null;
if(!next) {return;}
const extra = (r.scheduled||[]).length > 1 ? ` (+${(r.scheduled||[]).length - 1})` : '';
box.innerHTML = `<br><small style="color:#b45309;background:#fef3c7;border-radius:6px;padding:1px 8px;font-size:11px">⏳ مجدول من ${esc(String(next.effective_from||'').slice(0,10))}: ${esc(String(next.shift_start||'').slice(0,5))} (${esc(String(next.shift_karim ?? ''))}س)${extra}</small>`;
}).catch(()=>{});
}catch(_){}
}
async function ensureEmployeeCardData(emp){
if(!emp) {return;}
try{
const card = await apiFetch(`/hr/employees/${emp.id}/card`);
if(card?.employee){
Object.assign(emp, {
 digitalFingerprint: card.employee.digitalFingerprint || emp.digitalFingerprint,
 cardId: card.employee.cardId || emp.cardId,
 qrVersion: card.employee.qrVersion || emp.qrVersion,
 cardIssuedAt: card.employee.cardIssuedAt || emp.cardIssuedAt,
 cardStatus: card.employee.cardStatus || emp.cardStatus,
});
}
if(card?.qrPayload) {emp.qrPayload = card.qrPayload;}
return;
}catch(e){
// STRICT: never invent card data. A missing/unreadable card is an error, not a guess.
// Callers display this message loudly and continue with local data when possible.
throw new Error('تعذر تحميل بيانات بطاقة الموظف من الخادم — ' + (e.message || 'تحقق من الاتصال وصلاحياتك'), { cause: e });
}
}
const qrCache = new Map();
async function generateQRDataURL(text, size=200){
const key = `${text}_${size}`;
if(qrCache.has(key)){return qrCache.get(key);}
if(typeof QRCode === 'undefined') {return null;}
try{ const url = await QRCode.toDataURL(text, { width: size, margin: 1, color: { dark: '#0a0b0d', light: '#ffffff' }, errorCorrectionLevel: 'M' }); qrCache.set(key, url); return url; }
catch(_){ return null; }
}
function getEmployeeQRData(emp){
return JSON.stringify(emp.qrPayload || { system:CONFIG.APP_NAME, version:CONFIG.VERSION, type:'employee_card', cardId:emp.cardId, employeeId:emp.employeeId, employeeName:emp.name, department:emp.department, position:emp.position, fingerprint:emp.digitalFingerprint, issued:new Date().toISOString().split('T')[0] });
}
// QR بشري مقروء: مسحه بالجوال يعرض بيانات حقيقية لا أكواد (لا يصلح للحضور — للحضور امسح رمز النظام)
function getEmployeeHumanQRData(emp){
const dept = (STATE.hrDepartments||[]).find(d=>d.code===emp.department);
return [
STATE.settings.name + ' — بطاقة موظف',
'الاسم: ' + (emp.name || '—'),
'الرقم الوظيفي: ' + (emp.employeeId || '—'),
'القسم: ' + (dept ? dept.name : '—'),
'المنصب: ' + (emp.position || '—'),
'رقم البصمة: ' + (emp.deviceUserId || '—'),
'رقم البطاقة: ' + (emp.cardId || '—'),
].join('\n');
}
async function uploadEmployeePhoto(empId, file){
if(!file) {return;}
if(file.size > 3*1024*1024){ toast('حجم الصورة كبير جداً (حد أقصى 3MB)','error'); return; }
const emp = findEmployeeById(empId);
if(!emp){ toast('الموظف غير موجود','error'); return; }
// إصلاح 2026-10-01: النسخة القديمة كانت بلا try/catch (أي فشل = صمت تام)
// ولا تحدّث STATE (الصورة محفوظة لكن لا تظهر حتى تحديث الصفحة)
try{
const dataUrl = await new Promise((resolve, reject)=>{
const reader = new FileReader();
reader.onerror = ()=>reject(new Error('تعذر قراءة ملف الصورة'));
reader.onload = (evt)=>{
const img = new Image();
img.onerror = ()=>reject(new Error('ملف الصورة تالف — اختر صورة أخرى'));
img.onload = ()=>{
try{
const canvas = document.createElement('canvas');
const maxSize = 300;
let w = img.width, h = img.height;
if(!w || !h) {reject(new Error('ملف الصورة تالف — اختر صورة أخرى')); return;}
if(w>h){ if(w>maxSize){ h*=maxSize/w; w=maxSize; } }
else{ if(h>maxSize){ w*=maxSize/h; h=maxSize; } }
canvas.width = Math.round(w); canvas.height = Math.round(h);
canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
resolve(canvas.toDataURL('image/jpeg', 0.85));
}catch(e){ reject(e); }
};
img.src = evt.target.result;
};
reader.readAsDataURL(file);
});
const saved = await persistUpdate('employees', empId, { photo: dataUrl });
// تحديث فوري محليًا + في STATE — تظهر في الحساب لحظيًا بلا انتظار التحديث
const finalPhoto = (saved && saved.photo) || dataUrl;
try{ emp.photo = finalPhoto; }catch(_){}
try{ if(typeof upsertStateEntity === 'function'){ upsertStateEntity('employees', { id: empId, photo: finalPhoto }); } }catch(_){}
toast('✅ تم حفظ الصورة — ظاهرة الآن في حساب الموظف','success');
renderPage();
}catch(e){ toast(e.message||'فشل رفع الصورة — أعد المحاولة','error'); }
}
function handlePhotoUpload(empId, file){ if(file) {uploadEmployeePhoto(empId, file);} }
// ============================================
// SMART CARD RENDER
// ============================================
async function renderSmartCard(emp, options = {}){
if(!emp) {return '<div class="mcard"><i class=ji data-i=circle-x></i> الموظف غير موجود</div>';}
try{
// Load card data and QR async — render card HTML first for speed
ensureEmployeeCardData(emp).catch(()=>{});
const dept = (STATE.hrDepartments||[]).find(d=>d.code===emp.department);
// M21 fix: scope attendance to current month so last month's stale late flags don't drag the rate down
const now = new Date();
const monthPrefix = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
const myAttendance = (STATE.attendance||[]).filter(a=>a.employeeId===emp.id && a.checkIn && String(a.date||'').startsWith(monthPrefix));
const myLeaves = (STATE.leaveRequests||[]).filter(l=>l.employeeId===emp.id);
const approvedLeaves = myLeaves.filter(l=>l.status==='approved').length;
const totalDaysWorked = myAttendance.length;
const shiftStartStr = String(emp.shift_start || '09:00');
const shiftMatch = shiftStartStr.match(/^(\d{1,2}):(\d{2})$/);
const shiftStartMin = shiftMatch ? parseInt(shiftMatch[1]) * 60 + parseInt(shiftMatch[2]) : 540;
const shiftKarim = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
const GRACE_MIN = 15; // سماحية 15 دقيقة (قرار المالك 2026-10-10 — نفس shift-day.js)
// FIX 2026-10-11: recompute lateness from raw checkIn times instead of trusting
// stale `late` booleans (old shift rules left 8 false positives on id=84).
const isActuallyLate = (a) => {
    if (!a.checkIn) {return false;}
    const [h, m] = String(a.checkIn).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {return false;}
    return (h * 60 + m) > (shiftStartMin + GRACE_MIN);
};
const lateRecords = myAttendance.filter(isActuallyLate);
const totalLateMinutes = myAttendance.reduce((sum, a) => {
    if (!a.checkIn) {return sum;}
    const [h, m] = String(a.checkIn).split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) {return sum;}
    const arrival = Math.max(0, h * 60 + m - shiftStartMin - GRACE_MIN);
    let early = 0;
    if (a.checkOut) {
        const [oh, om] = String(a.checkOut).split(':').map(Number);
        if (Number.isFinite(oh) && Number.isFinite(om)) {
            const endRaw = shiftStartMin + Math.round(shiftKarim * 60);
            let out = oh * 60 + om;
            const inMin = h * 60 + m;
            if (out < inMin) {out += 24 * 60;}
            if (endRaw > 24 * 60 && out < 12 * 60) {out += 24 * 60;}
            if (out >= inMin) {early = Math.max(0, endRaw - out - GRACE_MIN);}
        }
    }
    return sum + arrival + early;
}, 0);
const lateDays = lateRecords.length;
const attendanceRate = totalDaysWorked > 0 ? ((totalDaysWorked - lateDays) / totalDaysWorked * 100).toFixed(1) : 100;
const onTimeRate = totalDaysWorked > 0 ? (((totalDaysWorked - lateDays) / totalDaysWorked) * 100).toFixed(1) : 100;
const initials = String(emp.name || '؟').split(' ').map(n=>n[0]).join('').substring(0,2);
const qrData = getEmployeeQRData(emp);
// QR generated async — store in global cache, card renders first, QR updates via script tag
window.__QR_URLS__ = window.__QR_URLS__ || {};
const qrUrl = window.__QR_URLS__[emp.id] || null;
generateQRDataURL(qrData, 220).then(u => { window.__QR_URLS__[emp.id] = u; }).catch(()=>{});
const canUploadPhoto = options.canUpload !== false && (STATE.currentUser?.role==='admin' || STATE.currentUser?.role==='hr' || emp.userId===STATE.currentUser?.id);
// Badge/rank based on attendance
let badge = '', badgeKey = '', badgeColor = '';
if (attendanceRate >= 95) { badge = 'ممتاز'; badgeKey = 'badgeExcellent'; badgeColor = 'bdg-green'; }
else if (attendanceRate >= 85) { badge = 'ممتاز'; badgeKey = 'badgeExcellent'; badgeColor = 'bdg-blue'; }
else if (attendanceRate >= 70) { badge = 'جيد'; badgeKey = 'badgeGood'; badgeColor = 'bdg-gold'; }
else { badge = 'يحتاج تحسين'; badgeKey = 'badgeNeedsImprove'; badgeColor = 'bdg-red'; }
// Salary after delay deductions (10 min = 1 hour deduction)
const delayDeductionHours = Math.round(totalLateMinutes / 60);
const netSalary = Math.max(0, (emp.salary || 0) - (delayDeductionHours * (emp.salary ? emp.salary / (totalDaysWorked * 10) : 0)));
const joinDate = emp.joinDate ? fD(emp.joinDate) : '—';
const iqamaExpiry = emp.iqamaExpiry ? fD(emp.iqamaExpiry) : '—';
const healthExpiry = emp.healthCertExpiry ? fD(emp.healthCertExpiry) : '—';
const shiftLabel = emp.shift_start ? `${emp.shift_start} — ${emp.shift_karim || '10 س'}` : '—';
const daysUntilIqama = Math.max(0, Math.ceil((new Date(emp.iqamaExpiry||Date.now()) - Date.now()) / 86400000));
const daysUntilHealth = Math.max(0, Math.ceil((new Date(emp.healthCertExpiry||Date.now()) - Date.now()) / 86400000));
return `
<style>
.smart-card-stat.late .stat-value{color:#c0392b;font-weight:700}
.smart-card-stat.late{border-left:3px solid #e74c3c;padding-left:6px}
.smart-card-stat .stat-value{color:#0f172a;font-weight:800;font-size:16px}
.smart-card-stat .stat-label{color:#64748b;font-size:10px;margin-top:2px}
.smart-card-stat .stat-icon{color:#C9A961;font-size:14px}
.smart-card-stat{display:flex;flex-direction:column;align-items:center;gap:2px}
.smart-card{font-family:'Cairo','IBM Plex Sans Arabic',sans-serif}
.progress-bar{height:6px;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-top:4px}
.progress-fill{height:100%;border-radius:3px;transition:width .5s}
.progress-green{background:linear-gradient(90deg,#27ae60,#2ecc71)}
.progress-blue{background:linear-gradient(90deg,#3498db,#2e86de)}
.progress-gold{background:linear-gradient(90deg,#f39c12,#e67e22)}
.progress-red{background:linear-gradient(90deg,#e74c3c,#c0392b)}
.badge-pill{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.badge-green{background:rgba(39,174,96,.12);color:#27ae60;border:1px solid rgba(39,174,96,.3)}
.badge-blue{background:rgba(52,152,219,.12);color:#2980b9;border:1px solid rgba(52,152,219,.3)}
.badge-gold{background:rgba(243,156,18,.12);color:#d68910;border:1px solid rgba(243,156,18,.3)}
.badge-red{background:rgba(231,76,60,.12);color:#c0392b;border:1px solid rgba(231,76,60,.3)}
.smart-card-section{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;font-weight:600}
.smart-card-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0}
.smart-card-value{font-weight:700;font-size:13px;color:#0f172a}
.smart-card-warning{font-size:9px;color:#e74c3c;font-weight:600}
</style>
<div class="smart-card-wrapper">
<div class="smart-card">
<div class="smart-card-header" style="background:linear-gradient(135deg,#1a1a2e 0%,#C9A961 100%);padding:20px 16px;border-radius:12px 12px 0 0;color:#fff;position:relative">
<div style="display:flex;align-items:center;gap:12px">
${emp.photo ? `<img src="${emp.photo}" alt="${esc(emp.name)}" style="width:56px;height:56px;border-radius:50%;border:3px solid rgba(255,255,255,.5);object-fit:cover">` : `<div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;border:3px solid rgba(255,255,255,.5)">${initials}</div>`}
${canUploadPhoto ? `<label class="photo-upload-btn" title="رفع صورة" style="position:absolute;bottom:4px;right:4px;background:rgba(255,255,255,.3);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer"><i class=ji data-i=camera></i><input type="file" accept="image/*" style="display:none" data-karim-action="handlePhotoUpload" data-karim-event="change" data-karim-arg0="${emp.id}" data-karim-pass="files.0"></label>` : ''}
<div style="flex:1">
<div style="font-size:18px;font-weight:800;line-height:1.2">${esc(emp.name)}</div>
<div style="font-size:12px;opacity:.85">${esc(emp.position||'—')} • ${dept?esc(dept.name):''}</div>
<div style="margin-top:6px"><span class="badge-pill ${badgeColor}" data-t="pc.${badgeKey}">${badge}</span> <span style="font-size:10px;opacity:.7;margin-right:4px">${esc(emp.employeeId||emp.id)}</span></div>
</div>
<div style="position:absolute;top:12px;left:12px"><div class="status-dot ${emp.status==='active'?'active':'inactive'}" style="width:12px;height:12px;border-radius:50%;border:2px solid #fff"></div></div>
</div>
</div>
<div class="smart-card-info" style="padding:12px 16px">
<div class="smart-card-section" data-t="pc.contactInfo"></div>
<div class="smart-card-row"><span><i class=ji data-i=id-card style="color:#C9A961"></i> <span data-t="pc.employeeId">الرقم الوظيفي</span></span><span class="smart-card-value">${esc(emp.employeeId||'—')}</span></div>
<div class="smart-card-row"><span><i class=ji data-i=building style="color:#C9A961"></i> <span data-t="pg.departments">القسم</span></span><span class="smart-card-value">${dept?esc(dept.name):'—'}</span></div>
<div class="smart-card-row"><span><i class=ji data-i=phone style="color:#C9A961"></i> <span data-t="common.phone">الهاتف</span></span><span class="smart-card-value">${esc(emp.phone||'—')}</span></div>
<div class="smart-card-row"><span><i class=ji data-i=calendar style="color:#C9A961"></i> <span data-t="common.joinDate">تاريخ الانضمام</span></span><span class="smart-card-value">${joinDate}</span></div>
</div>
<div style="padding:12px 16px;border-top:1px solid #f1f5f9">
<div class="smart-card-section" data-t="pc.periodInsurance"></div>
<div class="smart-card-row"><span><i class=ji data-i=clock style="color:#C9A961"></i> <span data-t="pc.workStart">الدوام</span></span><span class="smart-card-value">${shiftLabel}<span id="schedBadge-${emp.id}"></span></span></div>
<div class="smart-card-row"><span><i class=ji data-i=id-card style="color:#C9A961"></i> الإقامة</span><span class="smart-card-value" style="${daysUntilIqama<30?'color:#e74c3c;font-weight:700':''}">${iqamaExpiry}${daysUntilIqama<30?' <i class=ji data-i=alert-triangle></i> بعد '+daysUntilIqama+' يوم':''}</span></div>
<div class="smart-card-row"><span><i class=ji data-i=heart style="color:#C9A961"></i> شهادة صحية</span><span class="smart-card-value" style="${daysUntilHealth<30?'color:#e74c3c;font-weight:700':''}">${healthExpiry}${daysUntilHealth<30?' <i class=ji data-i=alert-triangle></i> بعد '+daysUntilHealth+' يوم':''}</span></div>
</div>
<div style="padding:12px 16px;border-top:1px solid #f1f5f9;background:#fafbfc">
<div class="smart-card-section" data-t="pc.performance"></div>
<div style="display:flex;gap:12px;margin:8px 0">
<div style="flex:1;text-align:center;padding:8px 4px;background:#fff;border-radius:8px;border:1px solid #e2e8f0">
<div style="font-size:20px;font-weight:800;color:#27ae60">${attendanceRate}%</div>
<div style="font-size:9px;color:#64748b" data-t="pc.attendanceRate">نسبة الحضور</div>
<div class="progress-bar"><div class="progress-fill ${attendanceRate>=90?'progress-green':attendanceRate>=75?'progress-blue':'progress-red'}" style="width:${attendanceRate}%"></div></div>
</div>
<div style="flex:1;text-align:center;padding:8px 4px;background:#fff;border-radius:8px;border:1px solid #e2e8f0">
<div style="font-size:20px;font-weight:800;color:#3498db">${onTimeRate}%</div>
<div style="font-size:9px;color:#64748b" data-t="pc.onTimeRate">في الموعد</div>
<div class="progress-bar"><div class="progress-fill ${onTimeRate>=90?'progress-green':onTimeRate>=75?'progress-blue':'progress-red'}" style="width:${onTimeRate}%"></div></div>
</div>
</div>
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
<div style="flex:1;text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid #f1f5f9">
<div style="font-size:16px;font-weight:700;color:#0f172a">${fN(totalDaysWorked)}</div>
<div style="font-size:9px;color:#64748b" data-t="pc.workDays">أيام العمل</div>
</div>
<div style="flex:1;text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid #f1f5f9">
<div style="font-size:16px;font-weight:700;color:#c0392b">${fN(lateDays)}</div>
<div style="font-size:9px;color:#64748b" data-t="pc.lateDays">أيام متأخر</div>
</div>
<div style="flex:1;text-align:center;padding:6px;background:#fff;border-radius:6px;border:1px solid #f1f5f9">
<div style="font-size:16px;font-weight:700;color:#0f172a">${fN(approvedLeaves)}</div>
<div style="font-size:9px;color:#64748b" data-t="pc.approvedLeaves">إجازات معتمدة</div>
</div>
</div>
</div>
<div style="padding:12px 16px;border-top:1px solid #f1f5f9">
<div class="smart-card-section" data-t="pc.payroll"></div>
<div style="display:flex;justify-content:space-between;align-items:center">
<div><div style="font-size:22px;font-weight:800;color:#C9A961">💵 ${fN(Math.round(netSalary))}</div><div style="font-size:9px;color:#64748b">${STATE.settings.currency||'ر.س'}</div></div>
<div style="text-align:right;font-size:11px;color:#64748b">
<div data-t="pc.basicSalary">الأساسي: </div><b>${fN(emp.salary||0)}</b>
<div data-t="pc.delayDeduction">خصم التأخير: </div><b style="color:#e74c3c">-${Math.round(delayDeductionHours*(emp.salary/(totalDaysWorked*10))||0)}</b>
<div data-t="pc.net">صافي: </div><b style="color:#27ae60">${fN(Math.round(netSalary))}</b>
</div>
</div>
</div>
<div class="smart-card-qr" title="رمز QR - امسح للتحقق" style="padding:16px;text-align:center;background:#fff;border-top:1px solid #f1f5f9;overflow:hidden">
${qrUrl ? `<img src="${qrUrl}" alt="QR Code" style="max-width:200px;width:100%;height:auto;margin:0 auto;display:block;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;padding:4px">` : `<div class="qr-loading" id="qr-placeholder-${emp.id}" style="padding:12px;color:#94a3b8">جارٍ التحميل...</div>`}
<script>setTimeout(()=>{const e=document.getElementById('qr-placeholder-${emp.id}');if(e&&window.__QR_URLS__&&window.__QR_URLS__['${emp.id}']){e.outerHTML='<img src=\\"'+window.__QR_URLS__['${emp.id}']+'\\" alt=\\"QR Code\\" style=\\"max-width:200px;width:100%;height:auto;margin:0 auto;display:block;object-fit:contain;border:1px solid #e2e8f0;border-radius:8px;padding:4px\\""}},500)</script>
</div>
<div class="smart-card-fingerprint" style="display:none">${emp.digitalFingerprint||'—'}</div>
</div>
</div>
<div class="smart-card-actions" style="padding:12px 16px;display:flex;gap:8px;flex-wrap:wrap;border-top:1px solid #f1f5f9">
<button class="btn btn-gold btn-sm" data-karim-action="showFullQRModal" data-karim-arg0="${emp.id}"><i class=ji data-i=smartphone></i> QR كبير</button>
<button class="btn btn-blue btn-sm" data-karim-action="printSmartCard" data-karim-arg0="${emp.id}"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-sm" data-karim-action="downloadSmartCard" data-karim-arg0="${emp.id}"><i class=ji data-i=save></i> حفظ</button>
<input type="month" id="empAttMonth" value="${new Date().toISOString().slice(0,7)}" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;background:var(--bg2);color:var(--text);font-family:inherit" title="اختر الشهر المطلوب طباعة كشفه">
<button class="btn btn-sm btn-green-soft" data-karim-action="printEmployeeAttendanceDay" data-karim-arg0="${emp.id}"><i class=ji data-i=printer></i> كشف اليوم</button>
<button class="btn btn-sm btn-blue" data-karim-action="printEmployeeAttendanceMonth" data-karim-arg0="${emp.id}"><i class=ji data-i=calendar></i> كشف الشهر</button>
<button class="btn btn-sm btn-purple" data-karim-action="regenerateFingerprint" data-karim-arg0="${emp.id}"><i class=ji data-i=refresh></i> تجديد</button>
</div>
</div>`;
} catch(e) {
console.error('[renderSmartCard]', e);
return `<div class="mcard"><i class=ji data-i=circle-x></i> تعذر عرض بطاقة الموظف — ${esc(e.message || 'خطأ غير متوقع')}</div>`;
}
}
async function showFullQRModal(empId){
const emp = findEmployeeById(empId);
if(!emp) {return;}
try { await ensureEmployeeCardData(emp); }
catch(e){ toast(e.message, 'error'); return; }
const qrUrl = await generateQRDataURL(getEmployeeQRData(emp), 400);
const humanUrl = await generateQRDataURL(getEmployeeHumanQRData(emp), 400);
showModal(`
<h3><i class=ji data-i=smartphone></i> رموز الموظف</h3>
<div class="u-row-wrap" style="gap:14px;justify-content:center">
<div class="qr-full-wrap" style="text-align:center">
<img src="${qrUrl}" class="qr-full-img" alt="رمز النظام">
<div class="qr-full-meta">رمز النظام — للحضور عبر الكشك</div>
</div>
<div class="qr-full-wrap" style="text-align:center">
<img src="${humanUrl}" class="qr-full-img" alt="رمز البيانات">
<div class="qr-full-meta">رمز البيانات — مسحه بالجوال يعرض بيانات مقروءة</div>
</div>
</div>
<div class="u-empty-xs">
<div class="qr-full-info">
<div class="qr-full-name">${esc(emp.name)}</div>
<div class="qr-full-meta">${esc(emp.employeeId||'')} • ${esc(emp.position||'')}</div>
<div class="qr-full-fp"><i class=ji data-i=lock></i> ${emp.digitalFingerprint||'—'}</div>
</div>
</div>
<div class="modal-footer" style="flex-wrap:wrap">
<button class="btn btn-blue btn-sm" data-karim-action="downloadQRImage" data-karim-arg0="${emp.id}"><i class=ji data-i=save></i> تحميل رمز النظام</button>
<button class="btn btn-green btn-sm" data-karim-action="downloadHumanQRImage" data-karim-arg0="${emp.id}"><i class=ji data-i=save></i> تحميل رمز البيانات</button>
<button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button>
</div>`);
}
async function downloadHumanQRImage(empId){
const emp = findEmployeeById(empId);
if(!emp) {return;}
await ensureEmployeeCardData(emp);
const qrUrl = await generateQRDataURL(getEmployeeHumanQRData(emp), 500);
const a = document.createElement('a');
a.href = qrUrl;
a.download = `QR_DATA_${emp.employeeId||emp.id}.png`;
a.click();
toast('تم تحميل رمز البيانات','success');
}
async function downloadQRImage(empId){
const emp = findEmployeeById(empId);
if(!emp) {return;}
await ensureEmployeeCardData(emp);
const qrData = getEmployeeQRData(emp);
const qrUrl = await generateQRDataURL(qrData, 500);
const a = document.createElement('a');
a.href = qrUrl;
a.download = `QR_${emp.employeeId||emp.id}_${emp.name.replace(/\s/g,'_')}.png`;
a.click();
toast('تم تحميل صورة QR','success');
}

function localDateOnly(date = new Date()) {
    // yyyy-mm-dd in LOCAL time — toISOString() shifts the date backwards for
    // UTC+ timezones (Riyadh) when called on local midnight
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function reportDateRangeForMonth(date = new Date()) {
const year = date.getFullYear();
const month = date.getMonth();
return { from: `${year}-${String(month+1).padStart(2,'0')}-01`, to: localDateOnly(new Date(year, month+1, 0)) };
}
async function fetchEmployeeAttendanceReport(empId, from, to){
return apiFetch(`/hr/attendance/report?employee_id=${encodeURIComponent(empId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}
function formatHoursFromMinutes(totalMinutes, digits = 1) {
const minutes = Number(totalMinutes || 0);
if (!Number.isFinite(minutes) || minutes <= 0) {return `0.${'0'.repeat(digits)} ساعة` ;}
return `${(minutes / 60).toFixed(digits)} ساعة`;
}
function formatLateSummary({ totalMinutes = 0, _lateDays = 0 } = {}) {
const minutes = Number(totalMinutes || 0);
if (!Number.isFinite(minutes) || minutes <= 0) {return '—';}
return `${formatHoursFromMinutes(minutes, 1)} <small>(${Math.round(minutes)} دقيقة)</small>`;
}
function formatLateRow({ lateMinutes = 0, _lateDays = 0 } = {}) {
const minutes = Number(lateMinutes || 0);
if (!Number.isFinite(minutes) || minutes <= 0) {return '—';}
if (minutes < 60) {return `${Math.round(minutes)} دقيقة`;}
return `${(minutes / 60).toFixed(1)} ساعة <small>(${Math.round(minutes)} دقيقة)</small>`;
}
function formatAttendanceStatus({ checkIn, checkOut, lateMinutes = 0, earlyLeaveMinutes = 0, workMinutes = null }) {
const hasCheckIn = !!(checkIn && String(checkIn).trim());
const hasCheckOut = !!(checkOut && String(checkOut).trim());
if (!hasCheckIn && !hasCheckOut) {return 'بلا حضور';}
if (!hasCheckIn) {return 'بلا حضور';}
if (!hasCheckOut) {return 'بلا انصراف';}
if (hasCheckIn && hasCheckOut && Number(workMinutes) === 0) {return 'يحتاج مراجعة';}
const late = Number(lateMinutes || 0);
const early = Number(earlyLeaveMinutes || 0);
if (late > 0 && early > 0) {return `تأخير دخول ${late} د • خروج مبكر ${early} د`;}
if (late > 0) {return `تأخير دخول ${late} د`;}
if (early > 0) {return `خروج مبكر ${early} د`;}
return 'في الوقت';
}
const fmtHM = (mins) => { const m = Math.max(0, Math.round(Number(mins) || 0)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
// لوجو مضمن base64 لنوافذ الطباعة (ملف URL قد يُحجب بشهادة HTTPS) — يُجلب مرة ويُحفظ
let __printLogoCache = null;
async function printLogoDataUrl(){
if (__printLogoCache) {return __printLogoCache;}
try {
const res = await fetch(getAbsoluteLogoSrc());
if (!res.ok) {throw new Error('logo fetch');}
const blob = await res.blob();
__printLogoCache = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = () => resolve(null); fr.readAsDataURL(blob); });
} catch (_) {__printLogoCache = null;}
return __printLogoCache || getAbsoluteLogoSrc();
}
async function printAttendanceReport(report, title, existingWin=null){
const employee = report.employee || {};
const s = report.summary || {};
// اسم اليوم لتاريخ YYYY-MM-DD (محلي — لا يعتمد وحدات أخرى)
const scWeekday = (iso) => { const names=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']; const d=new Date(String(iso||'')+'T12:00:00'); return Number.isNaN(d.getTime())?'—':names[d.getDay()]; };
// ساعات الوردية المتوقعة للموظف (10/12/8...) — أساس حكم الميعاد (shift_karim أولًا)
const shiftMin = (Number(employee.shift_karim) > 0 ? Number(employee.shift_karim) : Number(employee.shift_hours) > 0 ? Number(employee.shift_hours) : 10) * 60;
const GRACE = 15; // سماحية قرار المالك 2026-10-10
const todayIsoP = today();
const empNumId = employee.id;
const isLeaveDay = (iso) => (STATE.leaveRequests||[]).some(l => l.status==='approved' && String(l.employeeId)===String(empNumId) && String(l.startDate)<=iso && iso<=String(l.endDate));
let onTimeDays = 0, shortTotal = 0, missDays = 0;
const recByDate = new Map((report.records || []).map(r => [String(r.date || ''), r]));
// كل أيام الفترة (بما فيها الغياب): يوم الغياب صف كامل شرط
const rangeDays = [];
if (/^\d{4}-\d{2}-\d{2}$/.test(s.from || '') && /^\d{4}-\d{2}-\d{2}$/.test(s.to || '')) {
    const d0 = new Date(s.from + 'T12:00:00'), d1 = new Date(s.to + 'T12:00:00');
    for (let d = new Date(d0); d <= d1 && rangeDays.length < 62; d.setDate(d.getDate() + 1)) {
        rangeDays.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
}
const dayList = rangeDays.length ? rangeDays : [...recByDate.keys()];
const rows = dayList.map(iso => {
const r = recByDate.get(iso);
if (iso > todayIsoP) {
    return `<tr style="color:#94a3b8"><td>${esc(iso)}</td><td style="color:#94a3b8">${scWeekday(iso)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
}
if (!r) {
    if (isLeaveDay(iso)) {
        return `<tr><td>${esc(iso)}</td><td style="color:#64748b">${scWeekday(iso)}</td><td colspan="4" style="color:#3498db">إجازة معتمدة</td><td>—</td></tr>`;
    }
    const off = employee.day_off ?? employee.dayOff;
    if (off !== null && off !== undefined && off !== '' && Number(off) === new Date(iso+'T12:00:00').getDay()) {
        return `<tr><td>${esc(iso)}</td><td style="color:#64748b">${scWeekday(iso)}</td><td colspan="4" style="color:#16a34a">راحة أسبوعية</td><td>—</td></tr>`;
    }
    missDays++;
    return `<tr><td>${esc(iso)}</td><td style="color:#64748b">${scWeekday(iso)}</td><td>—</td><td>—</td><td>—</td><td style="color:#b45309">— لا يبصم</td><td>—</td></tr>`;
}
if (r.on_leave || r.onLeave) {
    return `<tr><td>${esc(iso)}</td><td style="color:#64748b">${scWeekday(iso)}</td><td colspan="4" style="color:#3498db">إجازة معتمدة</td><td>—</td></tr>`;
}
const minutes = Number(r.workMinutes || 0);
const krm = fmtHM(minutes);
const hasIn = !!(r.checkIn && String(r.checkIn).trim());
const hasOut = !!(r.checkOut && String(r.checkOut).trim());
let cell, style;
if (!hasIn) {cell = 'بلا حضور'; style = 'color:#f59e0b;font-weight:700';}
else if (!hasOut) {cell = 'بلا انصراف'; style = 'color:#f59e0b;font-weight:700';}
else if (minutes === 0) {cell = 'يحتاج مراجعة'; style = 'color:#f59e0b;font-weight:700';}
else {
const short = Math.max(0, shiftMin - minutes - GRACE);
if (short <= 0) {cell = 'في الميعاد'; style = 'color:#27ae60'; onTimeDays++;}
else {cell = `تأخير ${fmtHM(short)}`; style = 'color:#c0392b;font-weight:700'; shortTotal += short;}
}
const src = r.source==='device' ? 'بصمة' : r.source==='qr' ? 'QR' : r.source==='portal' ? 'كاميرا التطبيق' : r.source==='backfill' ? 'أرشيف' : 'يدوي';
return `<tr><td>${esc(r.date||'')}</td><td style="color:#64748b">${scWeekday(r.date)}</td><td dir="ltr">${esc(r.checkIn||'—')}</td><td dir="ltr">${esc(r.checkOut||'—')}</td><td>${krm}</td><td style="${style}">${cell}</td><td>${esc(src)}</td></tr>`;
}).join('') || '<tr><td colspan="7">لا توجد سجلات في الفترة المحددة</td></tr>';
const win = existingWin || (window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!win){ toast('اسمح بالنوافذ المنبثقة لطباعة التقرير','warning'); return; }
const logoSrc = await printLogoDataUrl();
const fromTo = s.from && s.to ? `${s.from} → ${s.to}` : '';
win.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>${esc(title)} - ${esc(employee.name||'')}</title><style>
body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;padding:0;margin:0;color:#1a1a2e;background:#f8f7f5}
.header{background:linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%);color:#fff;padding:22px 28px;display:flex;align-items:center;gap:16px}
.header img{width:58px;height:58px;object-fit:contain;background:#fff;border-radius:12px;padding:5px;box-shadow:0 4px 12px rgba(0,0,0,.3)}
.header h1{margin:0;font-size:22px;color:#f5d76e}.header p{margin:4px 0 0;color:#cbd5e1;font-size:13px}
.container{padding:22px 28px}
.employee-card{background:#fff;border-radius:14px;padding:16px 20px;display:flex;gap:24px;align-items:center;box-shadow:0 2px 12px rgba(0,0,0,.06);border-right:4px solid #c9a227;margin-bottom:18px}
.employee-card .avatar{width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#c9a227,#f5d76e);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px;font-weight:800}
.employee-card .info{flex:1}.employee-card .info strong{font-size:16px;color:#0f172a}.employee-card .info small{color:#64748b}
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:18px 0}
.summary .card{background:#fff;border-radius:12px;padding:14px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.05);border-top:3px solid #e2e8f0}
.summary .card.late{border-top-color:#e74c3c}.summary .card b{display:block;font-size:20px;color:#0f172a;margin-top:4px}.summary .card small{color:#64748b;font-size:11px}
.summary .card b.gold{color:#9a7417}.summary .card b.red{color:#c0392b}
table{width:100%;border-collapse:collapse;margin-top:14px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.05)}
th{background:#0f172a;color:#f5d76e;padding:10px;font-size:12px}td{padding:9px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:13px}tr:last-child td{border:none}
.footer{margin-top:18px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:10px}
@media print{body{background:#fff}.header{print-color-adjust:exact;-webkit-print-color-adjust:exact}button{display:none}}
</style></head><body>
<div class="header"><img src="${esc(logoSrc)}" alt="logo" data-karim-imgerror="hide"><div><h1>${esc(STATE.settings.name)}</h1><p>${esc(title)} — ${fromTo} • الوردية المتوقعة: ${(shiftMin / 60).toFixed(2).replace(/\.00$/, '')} س/يوم</p></div></div>
<div class="container">
<div class="employee-card"><div class="avatar">${esc((employee.name||'?').trim()[0]||'?')}</div><div class="info"><strong>${esc(employee.name||'—')}</strong><br><small>الرقم الوظيفي: ${esc(employee.employeeId||'—')} • المنصب: ${esc(employee.position||'—')} ${employee.shift_start?`• الوردية: ${esc(employee.shift_start)}${employee.shift_hours?` (${esc(employee.shift_hours)} س)`:''}`:''}</small></div><div style="text-align:left;color:#475569;font-size:12px">الفترة<br><strong style="color:#0f172a">${fromTo||'—'}</strong></div></div>
<div class="summary"><div class="card"><small>أيام الحضور</small><b>${s.daysPresent||0}</b></div><div class="card"><small>أيام مكتملة</small><b>${s.completeDays||0}</b></div><div class="card"><small>أيام في الميعاد</small><b style="color:#27ae60">${onTimeDays}</b></div><div class="card"><small>إجمالي التأخير</small><b class="red">${shortTotal > 0 ? fmtHM(shortTotal) : '—'}</b></div><div class="card"><small>إجمالي الساعات</small><b class="gold">${s.totalHours||0}</b></div></div>
<table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th><th>المصدر</th></tr></thead><tbody>${rows}</tbody></table>
<div class="footer">يوم العمل حسب وردية الموظف (${(shiftMin / 60).toFixed(2).replace(/\.00$/, '')} س) • أيام في الميعاد (${onTimeDays}) • إجمالي التأخير ${shortTotal > 0 ? fmtHM(shortTotal) : '—'} • أيام بلا بصمة (${missDays}) &nbsp;|&nbsp; تم التوليد: ${new Date().toLocaleString('ar-EG')}</div>
</div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
win.document.close();
}
async function runStrictAuditUI(){
const from=document.getElementById('attFrom')?.value||'';
const month=(from||today()).slice(0,7);
showModal(`<h3><i class=ji data-i=shield-check></i> التدقيق الصارم — ${esc(month)}</h3><div id="strictAuditBody"><div class="u-mt12 text-muted">جارٍ فحص سلامة البيانات...</div></div><div class="modal-footer"><button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button></div>`);
const box=document.getElementById('strictAuditBody');
try{
const res=await apiFetch(`/hr/strict-audit?month=${encodeURIComponent(month)}`);
const rows=(res.checks||[]).map(c=>{
const badge=c.status==='PASS'?'bdg-green':c.status==='WARN'?'bdg-gold':'bdg-red';
const icon=c.status==='PASS'?'circle-check':c.status==='WARN'?'alert-triangle':'circle-x';
let extra='';
if(c.detail&&c.detail.length){extra=`<br><small class="text-muted">${c.detail.map(d=>`${esc(d.emp||'')}${d.lateDays!=null?` (${d.lateDays}/${d.days})`:''}`).join('، ')}</small>`;}
return `<tr><td style="text-align:right">${esc(c.name)}${extra}</td><td><span class="badge ${badge}"><i class=ji data-i=${icon}></i> ${c.status==='PASS'?'سليم':c.status==='WARN'?'تنبيه':'فشل'}</span></td><td><b>${c.count}</b></td></tr>`;
}).join('');
box.innerHTML=`<div class="tbl-scroll"><table><thead><tr><th style="text-align:right">الفحص</th><th>الحالة</th><th>العدد</th></tr></thead><tbody>${rows||'<tr><td colspan="3">لا نتائج</td></tr>'}</tbody></table></div>
<div class="u-mt12" style="padding:10px;border-radius:8px;${res.ok?'background:#ecfdf5;color:#166534':'background:#fef2f2;color:#991b1b'}">${res.ok?'<i class=ji data-i=circle-check></i> كل الفحوصات سليمة — البيانات معتمدة':'<i class=ji data-i=circle-x></i> يوجد فشل — راجع البنود أعلاه قبل الاعتماد'}</div>`;
if(!res.ok){toast('التدقيق الصارم رصد مخالفات — راجع التفاصيل', 'error');}
}catch(e){ if(box){box.innerHTML=`<div class="u-mt12" style="color:#c0392b">تعذر تشغيل التدقيق: ${esc(e.message||'خطأ غير متوقع')}</div>`;} toast(e.message||'تعذر تشغيل التدقيق الصارم','error'); }
}
async function printMonthlyAttendance(){
const role = String((STATE && STATE.currentUser && STATE.currentUser.role) || '').trim().toLowerCase();
if (role && !['admin', 'hr', 'manager'].includes(role)) {
    toast('هذا التقرير متاح فقط للإدارة / المدير / الموارد البشرية', 'warning');
    return;
}
const from=document.getElementById('attFrom')?.value||'';
const month=(from||today()).slice(0,7);
console.log('[printMonthlyAttendance] month:', month, 'attFrom exists:', !!document.getElementById('attFrom'));
const printWin=(window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة التقرير - تم منع النوافذ المنبثقة','warning'); console.log('[printMonthlyAttendance] popup blocked'); return; }
try{
console.log('[printMonthlyAttendance] fetching data for month:', month);
const data=await apiFetch(`/hr/attendance/monthly?month=${encodeURIComponent(month)}&detail=1`);
console.log('[printMonthlyAttendance] data received:', data ? 'OK' : 'NULL', data?.employees?.length || 0, 'employees');
const emps=Array.isArray(data.employees)?data.employees:[];
const WORK_DAY = Number(data.workDayMinutes || 600);
// ═══ قرار المالك: المعيار هو إتمام ساعات الوردية — «إجمالي التأخير» = العجز عن إتمامها ═══
const totDeficitMin = emps.reduce((s,e)=>s+Number(e.deficitMinutes||0),0);
const totShortDays = emps.reduce((s,e)=>s+Number(e.shortDays||0),0);
const totCompleteDays = emps.reduce((s,e)=>s+Number(e.completeWorkDays||0),0);
const totLateMin = totDeficitMin;   // توافق مع أسماء القالب أدناه
const totLateDays = totShortDays;
const totReviewDays = emps.reduce((s,e)=>s+Number(e.reviewDays||0),0);
const totReviewMin = emps.reduce((s,e)=>s+Number(e.reviewMinutes||0),0);
const lateSummary = formatLateSummary({ totalMinutes: totLateMin, lateDays: totLateDays });
const tot=emps.reduce((s,e)=>({days:s.days+(e.days||0),late:s.late+(e.late||0),karimHours:s.karimHours+(e.karimHours||0)}),{days:0,late:0,karimHours:0});
// ─── التفصيل اليومي لكل موظف (اليوم + شرط الغياب) — من سجلات الحضور المحلية ───
const WD_AR = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const wdOfM = (iso) => { const d = new Date(String(iso||'')+'T12:00:00'); return Number.isNaN(d.getTime())?'—':WD_AR[d.getDay()]; };
const dimM = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
const codeToId = new Map(emps.map(x => [String(x.employeeId||''), x.id]));
for (const x of (STATE.employees||[])) { if (!codeToId.has(String(x.employeeId||''))) {codeToId.set(String(x.employeeId||''), x.id);} }
// التفصيل من السيرفر مباشرة (كامل الشهر — لا يعتمد على ذاكرة الجوال الناقصة)
const attByEmp = new Map();
for (const a of (Array.isArray(data.days) ? data.days : [])) {
    const k = String(a.employeeId);
    if (!attByEmp.has(k)) {attByEmp.set(k, new Map());}
    attByEmp.get(k).set(a.date, a);
}
const srvLeave = (data.leaveDays && typeof data.leaveDays === 'object') ? data.leaveDays : {};
const onLeaveM = (sid, iso) => {
    const arr = srvLeave[String(sid)];
    if (Array.isArray(arr) && arr.includes(iso)) {return true;}
    return (STATE.leaveRequests||[]).some(l => l.status==='approved' && String(l.employeeId)===String(sid) && String(l.startDate)<=iso && iso<=String(l.endDate));
};
const todayIso = today();
const joinOf = (e) => { const j = e.joinDate || e.join_date || ''; return /^\d{4}-\d{2}-\d{2}$/.test(String(j)) ? String(j) : ''; };
// الراحة الأسبوعية: 0=الأحد … 6=السبت (نفس ترميز التقويم) — اليوم المطابق يُعرض «راحة أسبوعية» ولا يُحسب غيابًا
const wdIdx = (iso) => { const d = new Date(String(iso||'')+'T12:00:00'); return Number.isNaN(d.getTime()) ? -1 : d.getDay(); };
const isWeeklyOff = (e, iso) => { const o = e.day_off ?? e.dayOff; return o !== null && o !== undefined && o !== '' && Number(o) === wdIdx(iso); };
const toMinM = (t) => { const m = String(t||'').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1])*60+Number(m[2]) : null; };
const dayDetail = (e, counter) => {
    const sid = codeToId.get(String(e.employeeId||''));
    const recs = (sid != null && attByEmp.get(String(sid))) || new Map();
    const shiftMin = Number(e.workDayMinutes || WORK_DAY || 600);
    const jd = joinOf(e);
    let h = '';
    for (let d = 1; d <= dimM; d++) {
        const iso = `${month}-${String(d).padStart(2,'0')}`;
        const future = iso > todayIso;
        const r = recs.get(iso);
        const leave = !future && sid != null && onLeaveM(sid, iso);
        const leaveRow = r && (r.on_leave || r.onLeave);
        if (future) {
            h += `<tr style="color:#94a3b8"><td>${iso}</td><td>${wdOfM(iso)}</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`;
            continue;
        }
        if (!r) {
            if (leave) {
                h += `<tr><td>${iso}</td><td>${wdOfM(iso)}</td><td colspan="3" style="color:#3498db">إجازة معتمدة</td><td>—</td></tr>`;
            } else if (isWeeklyOff(e, iso)) {
                h += `<tr><td>${iso}</td><td>${wdOfM(iso)}</td><td colspan="3" style="color:#16a34a">راحة أسبوعية</td><td>—</td></tr>`;
            } else if (jd && iso < jd) {
                h += `<tr style="color:#94a3b8"><td>${iso}</td><td>${wdOfM(iso)}</td><td>—</td><td>—</td><td>—</td><td>قبل التعيين</td></tr>`;
            } else {
                if (counter) {counter.n++;}
                h += `<tr><td>${iso}</td><td>${wdOfM(iso)}</td><td>—</td><td>—</td><td>—</td><td style="color:#b45309">— لا يبصم</td></tr>`;
            }
            continue;
        }
        if (leave || leaveRow) {
            h += `<tr><td>${iso}</td><td>${wdOfM(iso)}</td><td colspan="3" style="color:#3498db">إجازة معتمدة</td><td>—</td></tr>`;
            continue;
        }
        const ci = toMinM(r.checkIn), co = toMinM(r.checkOut);
        let hrs = '—', st = 'يحتاج مراجعة', sc = 'color:#f59e0b';
        if (ci != null && co != null) {
            let w = co - ci; if (w < 0) {w += 1440;}
            hrs = `${Math.floor(w/60)}:${String(w%60).padStart(2,'0')}`;
            // سماحية 15 دقيقة (قرار المالك 2026-10-10)
            const net = (shiftMin - w) - 15;
            if (net <= 0) {st = 'في الميعاد'; sc = 'color:#27ae60';}
            else {st = `تأخير ${Math.floor(net/60)}:${String(net%60).padStart(2,'0')}`; sc = 'color:#c0392b;font-weight:700';}
        } else if (ci != null) {st = 'بلا انصراف';}
        else if (co != null) {st = 'بلا حضور';}
        h += `<tr><td>${iso}</td><td>${wdOfM(iso)}</td><td dir="ltr">${esc(r.checkIn||'—')}</td><td dir="ltr">${esc(r.checkOut||'—')}</td><td>${hrs}</td><td style="${sc}">${st}</td></tr>`;
    }
    return h;
};
const rows=emps.map(e=>{
const lm = Number(e.deficitMinutes||0);
const sd = Number(e.shortDays||0);
const lv = Number(e.leaveDays||0);
const rv = Number(e.reviewDays||0);
const deficitCell = sd>0?`<span style="color:#c0392b;font-weight:700">${sd} يوم • ${formatLateRow({ lateMinutes: lm })}${rv > 0 ? ` <small>+${rv} قيد المراجعة</small>` : ''}</span>`:(rv > 0 ? `<span style="color:#f59e0b;font-weight:700">${rv} قيد المراجعة</span>`:'<span style="color:#27ae60">✓ كامل</span>');
const ctr = { n: 0 };
const detHtml = dayDetail(e, ctr);
const missCell = ctr.n > 0 ? `<span style="color:#b45309;font-weight:700">${fN(ctr.n)} يوم</span>` : '—';
return `<tr><td style="text-align:right"><strong>${esc(e.name||'—')}</strong><br><small style="color:#64748b">${esc(e.employeeId||'')}${e.position?` • ${esc(e.position)}`:''}${e.shift_start?` • الوردية ${esc(e.shift_start)} • ${Number(e.workDayMinutes||600)/60}س`:''}</small></td><td>${fN(e.days||0)}</td><td><span style="color:#16a34a;font-weight:700">${fN(e.completeWorkDays||0)}</span></td><td>${deficitCell}</td><td>${sd > 0 ? `<span style="color:#c0392b;font-weight:700">${fN(sd)} يوم</span>` : '<span style="color:#27ae60">—</span>'}</td><td>${lv > 0 ? `<span style="color:#3498db;font-weight:700">${lv} يوم</span>` : '—'}</td><td>${missCell}</td><td class="c-gold" style="font-weight:700">${Number(e.karimHours||0).toFixed(1)}</td></tr><tr class="det"><td colspan="8" style="padding:0 0 10px;background:#f8fafc"><div style="font-weight:700;font-size:11px;color:#0f172a;padding:8px 10px 0">التفصيل اليومي — ${esc(e.name||'')}</div><table class="days"><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead><tbody>${detHtml}</tbody></table></td></tr>`;
}).join('')||'<tr><td colspan="8" class="u-empty-sm">لا توجد سجلات في هذا الشهر</td></tr>';
const lateAuditStatus = totLateDays >= 0 && totLateMin >= 0 && emps.every(e => Number(e.lateMinutes || 0) >= 0) ? 'متوازن داخليًا' : 'يتطلب مراجعة يدوية';
const lateAuditColor = totLateDays >= 0 && totLateMin >= 0 && emps.every(e => Number(e.lateMinutes || 0) >= 0) ? '#16a34a' : '#d97706';
const lateAuditText = totLateDays >= 0 && totLateMin >= 0 && emps.every(e => Number(e.lateMinutes || 0) >= 0) ? 'التقرير متوازن داخليًا - لا توجد تناقضات في الحسابات الأساسية' : 'التقرير يحتاج مراجعة يدوية - يوجد عدد كبير من القيم الشاذة أو غير المتوقعة';
const anomalous = emps.filter(e => Number(e.deficitMinutes || 0) >= 600 || Number(e.shortDays || 0) >= 5).slice(0, 12);
const anomalousCount = anomalous.length;
const topAnomalies = [...emps].sort((a, b) => Number(b.deficitMinutes || 0) - Number(a.deficitMinutes || 0)).slice(0, 5);
const anomaliesHtml = anomalous.length ? `<div class="anomalies"><div class="title">موظفون يحتاجون مراجعة (${anomalousCount})</div><ul>${anomalous.map(e => `<li><strong>${esc(e.name || '—')}</strong> • ${esc(e.employeeId || '')} • ${Number(e.deficitMinutes || 0)} دقيقة عجز / ${Number(e.shortDays || 0)} يوم</li>`).join('')}</ul></div>` : '<div class="anomalies ok"><div class="title">لا توجد قيم شاذة في هذا الشهر</div></div>';
const topAnomaliesHtml = topAnomalies.length ? `<div class="top-anomalies"><div class="title">أعلى 5 حالات تأخير</div><ul>${topAnomalies.map((e, i) => `<li><span>${i + 1}. ${esc(e.name || '—')}</span><strong>${Number(e.lateMinutes || 0)} د</strong></li>`).join('')}</ul></div>` : '<div class="top-anomalies ok"><div class="title">لا توجد حالات عالية</div></div>';
printWin.document.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>كشف الحضور الشهري ${esc(month)}</title><style>
body{font-family:'Cairo','Segoe UI',Tahoma,sans-serif;padding:0;margin:0;color:#1a1a2e;background:#f8f7f5}
.header{background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;padding:20px 28px;display:flex;align-items:center;gap:14px}
.header img{width:52px;height:52px;object-fit:contain;background:#fff;border-radius:12px;padding:4px}
.header h1{margin:0;font-size:20px;color:#f5d76e}.header p{margin:4px 0 0;color:#cbd5e1;font-size:12px}
.container{padding:20px 28px}
.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:16px 0}
.summary .card{background:#fff;border-radius:12px;padding:12px;text-align:center;box-shadow:0 1px 6px rgba(0,0,0,.05);border-top:3px solid #e2e8f0}
.summary .card.late{border-top-color:#e74c3c}.summary .card b{display:block;font-size:18px;color:#0f172a;margin-top:4px}
.summary .card b.red{color:#c0392b}
.audit{margin:0 0 14px;background:#fff;border:1px solid #e5e7eb;border-right:4px solid ${lateAuditColor};border-radius:12px;padding:12px 14px;box-shadow:0 1px 6px rgba(0,0,0,.04)}
.audit .status{display:flex;align-items:center;justify-content:space-between;gap:8px;font-weight:700;font-size:12px;color:${lateAuditColor};margin-bottom:8px}
.audit .status .dot{width:10px;height:10px;border-radius:50%;background:${lateAuditColor};display:inline-block}
.audit .msg{font-size:11px;line-height:1.8;color:#475569}
.validation{margin:0 0 14px;background:#fff;border:1px solid #e5e7eb;border-right:4px solid #f59e0b;border-radius:12px;padding:12px 14px;box-shadow:0 1px 6px rgba(0,0,0,.04)}
.validation .title{font-weight:700;color:#7c4a00;font-size:12px;margin-bottom:8px}
.validation ul{margin:0;padding-right:18px;color:#475569;font-size:11px;line-height:1.8}
.validation li{margin:0}
.anomalies,.top-anomalies{margin:0 0 14px;background:#fff3cd;border:1px solid #f5d76e;border-right:4px solid #d97706;border-radius:12px;padding:12px 14px;box-shadow:0 1px 6px rgba(0,0,0,.04)}
.anomalies.ok,.top-anomalies.ok{background:#ecfdf5;border-color:#86efac;border-right-color:#16a34a}
.anomalies .title,.top-anomalies .title{font-weight:700;color:#7c2d12;font-size:12px;margin-bottom:8px}
.anomalies.ok .title,.top-anomalies.ok .title{color:#166534}
.anomalies ul,.top-anomalies ul{margin:0;padding-right:18px;color:#3f3f46;font-size:11px;line-height:1.8}
.anomalies li,.top-anomalies li{margin:0;display:flex;justify-content:space-between;gap:10px;list-style:none}
.anomalies li{display:block}
.anomalies strong{color:#0f172a}
.summary-inline{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 14px}
.summary-inline .mini{background:#fff;border-radius:12px;padding:10px 12px;box-shadow:0 1px 5px rgba(0,0,0,.04);text-align:center;border-top:3px solid #e2e8f0}
.summary-inline .mini.warn{border-top-color:#d97706}
.summary-inline .mini b{display:block;font-size:18px;color:#0f172a;margin-top:4px}
.summary-inline .mini small{color:#64748b;font-size:10px}
table{width:100%;border-collapse:collapse;margin-top:12px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,.05)}
th{background:#0f172a;color:#f5d76e;padding:10px;font-size:11px}td{padding:8px;border-bottom:1px solid #f1f5f9;text-align:center;font-size:12px}
table.days{margin-top:6px}table.days th{background:#334155;color:#e2e8f0;padding:6px;font-size:10px}table.days td{padding:5px;font-size:11px}
tr.det td{border:none}
.footer{margin-top:16px;text-align:center;color:#94a3b8;font-size:11px;border-top:1px solid #e2e8f0;padding-top:8px}
@media print{body{background:#fff}.header{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
</style></head><body><div class="header"><img src="${esc(getAbsoluteLogoSrc())}" alt="logo"><div><h1>كشف الحضور والانصراف الشهري المجمع</h1><p>شهر ${esc(month)} — ${emps.length} موظف • يوم العمل حسب وردية الموظف</p></div></div><div class="container"><div class="summary"><div class="card"><small>إجمالي أيام الحضور</small><b>${fN(emps.reduce((s,e)=>s+(e.days||0),0))}</b></div><div class="card"><small>أيام مكتملة الدوام ✓</small><b>${fN(totCompleteDays)}</b></div><div class="card late"><small>عجز الساعات (لم يكمل دوامه)</small><b class="red">${lateSummary}</b></div><div class="card"><small>إجمالي الساعات</small><b>${Number(tot.karimHours).toFixed(1)}</b></div><div class="card"><small>الموظفون</small><b>${emps.length}</b></div></div><div class="summary-inline"><div class="mini"><small>الحالات الشاذة</small><b>${anomalousCount}</b></div><div class="mini warn"><small>عتبة المراجعة</small><b>600 د</b></div><div class="mini"><small>حالة التقرير</small><b>${lateAuditStatus === 'متوازن داخليًا' ? 'موافق' : 'مراجعة'}</b></div></div><div class="audit"><div class="status"><span><span class="dot"></span> ${lateAuditStatus}</span></div><div class="msg">${lateAuditText}</div></div><div class="validation"><div class="title">معيار التحقق الاحترافي</div><ul><li>المعتمد = إتمام ساعات الوردية: الدخول المبكر يغطي الانصراف المبكر والتأخير يُمتص بالبقاء</li><li>عدد أيام التأخير مستقل عن مجموع الدقائق</li><li>لا يوجد خلط بين عدد الأيام والساعات</li><li>الورديات الليلية تُحسب حسب وقت الوردية</li><li>القيم الشاذة تُراجع يدويًا قبل الاعتماد</li></ul></div>${topAnomaliesHtml}${anomaliesHtml}<table><thead><tr><th style="text-align:right">الموظف</th><th>أيام الحضور</th><th>مكتملة الدوام</th><th>نقص الدوام (يوم/د)</th><th>أيام بعجز</th><th>إجازات</th><th>بلا بصمة</th><th>الساعات</th></tr></thead><tbody>${rows}</tbody></table><div class="footer">المعتمد = إتمام ساعات الوردية (10/12 ساعة) • نقص الدوام: ${totShortDays} يوم • ${totDeficitMin} دقيقة${totReviewDays > 0 ? ` • قيد المراجعة: ${totReviewDays} يوم (${totReviewMin} د)` : ''} &nbsp;|&nbsp; تم التوليد: ${new Date().toLocaleString('ar-EG')}</div></div><script>window.onload=()=>setTimeout(()=>window.print(),300)</script></body></html>`);
printWin.document.close();
} catch(e){ 
    console.error('[printMonthlyAttendance] error:', e);
    if (printWin && !printWin.closed) {printWin.close();}
    toast(e.message || 'تعذر تحميل الكشف الشهري - ' + e.toString(), 'error'); 
}
}
async function printLuxCard(empId){
const printWin=(window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة البطاقة','warning'); return; }
try{
const res=await fetch(API_BASE+`/hr/employees/${encodeURIComponent(empId)}/lux-card`,{headers:{'Authorization':'Bearer '+window._jwt, ...(window._appKey?{'x-api-key':window._appKey}:{})}});
if(!res.ok) {
let msg=`تعذر توليد البطاقة (${res.status})`;
try{ const e=await res.clone().json(); if(e&&(e.message||e.error)){msg=e.message||e.error;} }catch(_){}
throw new Error(msg);
}
printWin.document.write(await res.text());
printWin.document.close();
}catch(e){ try{printWin.close();}catch(_){} toast(e.message||'تعذر توليد البطاقة','error'); }
}
async function printEmployeeAttendanceDay(empId, date = today()){
const printWin=(window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة التقرير','warning'); return; }
try{ const report = await fetchEmployeeAttendanceReport(empId, date, date); printAttendanceReport(report, `كشف حضور وانصراف يوم ${date}`, printWin); }
catch(e){ toast(e.message||'تعذر تحميل كشف اليوم','error'); }
}
async function printEmployeeAttendanceMonth(empId, date = new Date()){
// FIX 2026-10-01: قراءة الشهر من منتقي الشهر في البطاقة — كان يطبع الشهر
// الحالي حصرًا فتطلع كشوف بداية الشهر فارغة رغم أن الشهر الماضي مليء (شكوى اسحاق)
const picked = document.getElementById('empAttMonth')?.value;
if (picked && /^\d{4}-\d{2}$/.test(picked)) { const [y, m] = picked.split('-'); date = new Date(Number(y), Number(m) - 1, 1); }
const range = reportDateRangeForMonth(date);
const printWin=(window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة التقرير','warning'); return; }
try{ const report = await fetchEmployeeAttendanceReport(empId, range.from, range.to); printAttendanceReport(report, `كشف حضور وانصراف الشهر ${range.from.slice(0,7)}`, printWin); }
catch(e){ toast(e.message||'تعذر تحميل كشف الشهر','error'); }
}
// بحث حضور الموظف بفترة مخصصة (من — إلى) من داخل بطاقة الموظف
async function searchEmployeeAttendanceRange(empId){
const from=document.getElementById('empAttFrom')?.value||'';
const to=document.getElementById('empAttTo')?.value||'';
if(!from||!to){toast('اختر تاريخ البداية والنهاية','warning');return;}
if(to<from){toast('تاريخ النهاية يسبق تاريخ البداية','warning');return;}
const box=document.getElementById('empAttRangeResults');
if(!box){return;}
box.innerHTML='<div class="u-mt12 text-muted">جارٍ تحميل السجل...</div>';
try{
const report=await fetchEmployeeAttendanceReport(empId,from,to);
box.innerHTML=renderAttendanceRangeBlock(report);
}catch(e){
box.innerHTML=`<div class="u-mt12" style="color:#c0392b;font-size:13px">${esc(e.message||'تعذر جلب سجل الحضور')}</div>`;
}
}
function renderAttendanceRangeBlock(report){
const s=report.summary||{};
const employee=report.employee||{};
const shiftMin=(Number(employee.shift_hours)>0?Number(employee.shift_hours):10)*60;
let onTimeDays=0, shortTotal=0;
const cardByDate = new Map((report.records||[]).map(r=>[String(r.date||''), r]));
const cardDays = [];
if (/^\d{4}-\d{2}-\d{2}$/.test(s.from||'') && /^\d{4}-\d{2}-\d{2}$/.test(s.to||'')) {
    const d0 = new Date(s.from+'T12:00:00'), d1 = new Date(s.to+'T12:00:00');
    for (let d = new Date(d0); d <= d1 && cardDays.length < 62; d.setDate(d.getDate()+1)) {
        cardDays.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
    }
}
const cardList = cardDays.length ? cardDays : [...cardByDate.keys()];
const wdOf = (iso) => { const names=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']; const d=new Date(String(iso||'')+'T12:00:00'); return Number.isNaN(d.getTime())?'—':names[d.getDay()]; };
const rows=(cardList).map(iso=>{
const r = cardByDate.get(iso);
if (!r) {
    return `<tr style="background:rgba(231,76,60,.06)"><td>${esc(iso)}</td><td style="color:#64748b">${wdOf(iso)}</td><td>—</td><td>—</td><td>—</td><td style="color:#c0392b;font-weight:700">لم يحضر</td></tr>`;
}
const minutes=Number(r.workMinutes||0);
const krm=fmtHM(minutes);
const hasIn=!!(r.checkIn&&String(r.checkIn).trim());
const hasOut=!!(r.checkOut&&String(r.checkOut).trim());
let statusTxt, statusStyle;
if(!hasIn){statusTxt='بلا حضور';statusStyle='color:#f59e0b;font-weight:700';}
else if(!hasOut){statusTxt='بلا انصراف';statusStyle='color:#f59e0b;font-weight:700';}
else if(minutes===0){statusTxt='يحتاج مراجعة';statusStyle='color:#f59e0b;font-weight:700';}
else{const short=shiftMin-minutes;if(short<=0){statusTxt='في الميعاد';statusStyle='color:#27ae60';onTimeDays++;}else{statusTxt=`تأخير ${fmtHM(short)}`;statusStyle='color:#c0392b;font-weight:700';shortTotal+=short;}}
const review=r.needsReview?' <span class="badge bdg-orange">مراجعة</span>':'';
const wd=(()=>{ const names=['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']; const d=new Date(String(r.date||'')+'T12:00:00'); return Number.isNaN(d.getTime())?'—':names[d.getDay()]; })();
return `<tr><td>${esc(r.date||'')}</td><td style="color:#64748b">${wd}</td><td class="c-green" dir="ltr">${esc(r.checkIn||'—')}</td><td class="c-red" dir="ltr">${esc(r.checkOut||'—')}</td><td class="c-gold">${krm}</td><td style="${statusStyle}">${statusTxt}${review}</td></tr>`;
}).join('')||'<tr><td colspan="6" style="text-align:center;color:#64748b">لا توجد سجلات في هذه الفترة</td></tr>';
return `<div class="u-mt12" style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;text-align:center">
<div style="background:#fff;border-radius:8px;padding:8px;border-top:3px solid #16a34a"><small style="color:#64748b">أيام الحضور</small><b style="display:block;font-size:18px">${s.daysPresent||0}</b></div>
<div style="background:#fff;border-radius:8px;padding:8px;border-top:3px solid #2563eb"><small style="color:#64748b">أيام مكتملة</small><b style="display:block;font-size:18px">${s.completeDays||0}</b></div>
<div style="background:#fff;border-radius:8px;padding:8px;border-top:3px solid #16a34a"><small style="color:#64748b">أيام في الميعاد</small><b style="display:block;font-size:18px;color:#27ae60">${onTimeDays}</b></div>
<div style="background:#fff;border-radius:8px;padding:8px;border-top:3px solid #e74c3c"><small style="color:#64748b">إجمالي التأخير</small><b style="display:block;font-size:15px;color:#c0392b">${shortTotal>0?fmtHM(shortTotal):'—'}</b></div>
<div style="background:#fff;border-radius:8px;padding:8px;border-top:3px solid #c9a227"><small style="color:#64748b">إجمالي الساعات</small><b style="display:block;font-size:18px;color:#9a7417">${s.totalHours||0}</b></div>
</div>
<div class="tbl-scroll u-mt8">
<table>
<thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>الحالة</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</div>
<small style="color:#94a3b8;display:block;margin-top:6px">الفترة: ${esc(s.from||'')} — ${esc(s.to||'')} ${Number(s.reviewDays||0)>0?` • قيد المراجعة: ${s.reviewDays} يوم (${s.reviewMinutes||0} د)`:''}</small>`;
}
async function printEmployeeAttendanceRange(empId){
const from=document.getElementById('empAttFrom')?.value||'';
const to=document.getElementById('empAttTo')?.value||'';
if(!from||!to){toast('اختر تاريخ البداية والنهاية أولًا','warning');return;}
if(to<from){toast('تاريخ النهاية يسبق تاريخ البداية','warning');return;}
const printWin=(window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة التقرير','warning'); return; }
try{
const report=await fetchEmployeeAttendanceReport(empId,from,to);
printAttendanceReport(report,`كشف حضور وانصراف للفترة ${from} — ${to}`,printWin);
}catch(e){ printWin.close(); toast(e.message||'تعذر طباعة كشف الفترة','error'); }
}
async function regenerateFingerprint(empId){
if(!confirm('تجديد بطاقة QR؟ سيصبح الرمز القديم غير صالح.')) {return;}
const emp = findEmployeeById(empId);
if(!emp) {return;}
try{
const card = await apiFetch(`/hr/employees/${empId}/qr/regenerate`, {method:'POST'});
Object.assign(emp, card.employee || {});
emp.qrPayload = card.qrPayload || null;
renderPage();
toast('تم تجديد بطاقة QR وحفظها','success');
}catch(e){toast(e.message||'تعذر تجديد بطاقة QR','error');}
}
async function printSmartCard(empId){
const printWin = (window.openInAppReport ? window.openInAppReport('كشف الحضور') : window.open('', '_blank'));
if(!printWin){ toast('اسمح بالنوافذ المنبثقة لطباعة البطاقة','warning'); return; }
const emp = findEmployeeById(empId);
if(!emp) {return;}
await ensureEmployeeCardData(emp);
const dept = STATE.hrDepartments.find(d=>d.code===emp.department);
const initials = emp.name.split(' ').map(n=>n[0]).join('').substring(0,2);
const qrData = getEmployeeQRData(emp);
const qrPromise = (typeof QRCode !== 'undefined') ? QRCode.toDataURL(qrData, {width:200,margin:1,color:{dark:'#000',light:'#fff'}}) : Promise.resolve(null);
qrPromise.then(qrUrl=>{
printWin.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>بطاقة الموظف - ${emp.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:85.6mm 54mm;margin:0}
body{font-family:'Cairo',sans-serif;background:#f0f0f0;padding:20px;direction:rtl}
.card{width:85.6mm;height:54mm;background:linear-gradient(135deg,#1a1d24 0%,#0f1115 100%);color:#fff;border-radius:3mm;padding:5mm;position:relative;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.3);margin:0 auto}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1.2mm;background:linear-gradient(90deg,#d4a843,#f0c96b,#d4a843)}
.card-inner{display:grid;grid-template-columns:25mm 1fr 22mm;gap:3mm;height:35mm;align-items:center}
.photo{width:24mm;height:24mm;border-radius:50%;border:1px solid #d4a843;overflow:hidden;background:linear-gradient(135deg,#d4a843,#f0c96b);display:flex;align-items:center;justify-content:center;font-size:12pt;font-weight:900;color:#0a0b0d}
.photo img{width:100%;height:100%;object-fit:cover}
.info{min-width:0}
.name{font-size:9pt;font-weight:900;color:#f0c96b;margin-bottom:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.position{font-size:6.5pt;color:#fff;margin-bottom:1.5mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.meta{font-size:5.5pt;color:#ccc;line-height:1.55}
.qr{width:21mm;height:21mm;background:#fff;padding:1.5mm;border-radius:2mm;display:flex;align-items:center;justify-content:center}
.qr img{width:100%;height:100%;object-fit:contain}
.footer{position:absolute;bottom:3mm;left:5mm;right:5mm;display:flex;justify-content:space-between;font-size:5pt;color:#999;border-top:1px solid rgba(212,168,67,0.2);padding-top:1.5mm}.footer-logo{width:5mm;height:5mm;object-fit:contain;background:#fff;border-radius:1mm;padding:.5mm;vertical-align:middle;margin-left:1mm}
.fingerprint{font-family:monospace;font-size:5pt;color:#f0c96b;letter-spacing:.4px;margin-top:1mm;white-space:nowrap}
.controls{text-align:center;margin:20px}
.controls button{padding:10px 25px;margin:0 10px;border:none;border-radius:6px;font-size:12pt;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif}
.btn-print{background:#2ecc71;color:white}
.btn-close{background:#e74c3c;color:white}
@media print{body{background:white;padding:0}.controls{display:none}.card{box-shadow:none;page-break-inside:avoid}}
</style></head><body>
<div class="controls">
<button class="btn-print" data-karim-action="print"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn-close" data-karim-action="closeWindow"><i class=ji data-i=circle-x></i> إغلاق</button>
</div>
<div class="card">
<div class="card-inner">
<div class="photo">${emp.photo?`<img src="${emp.photo}">`:initials}</div>
<div class="info">
<div class="name">${esc(emp.name)}</div>
<div class="position">${esc(emp.position||'—')} ${dept?'• '+esc(dept.name):''}</div>
<div class="meta">
<i class=ji data-i=id-card></i> ${esc(emp.employeeId||'—')}<br>
<i class=ji data-i=calendar></i> ${fD(emp.joinDate)}<br>
<i class=ji data-i=phone></i> ${esc(emp.phone||'—')}
</div>
<div class="fingerprint" style="margin-top:4px"><i class=ji data-i=lock></i> ${emp.digitalFingerprint||'—'}</div>
</div>
<div class="qr">${qrUrl?`<img src="${qrUrl}">`:'<div style="font-size:8pt;color:#999">QR</div>'}</div>
</div>
<div class="footer">
<span><img class="footer-logo" src="${esc(getAbsoluteLogoSrc())}" alt="">${esc(STATE.settings.name)}</span>
<span>GV-${String(emp.employeeId||emp.id).replace(/\D/g,'').padStart(6,'0')}</span>
</div>
</div>
</body></html>`);
printWin.document.close();
setTimeout(()=>{printWin.focus();},500);
});
}
async function downloadSmartCard(empId){
const emp = findEmployeeById(empId);
if(!emp) {return;}
await ensureEmployeeCardData(emp);
const dept = STATE.hrDepartments.find(d=>d.code===emp.department);
const initials = emp.name.split(' ').map(n=>n[0]).join('').substring(0,2);
const qrData = getEmployeeQRData(emp);
const qrUrl = await generateQRDataURL(qrData, 200);
const canvas = document.createElement('canvas');
canvas.width = 800; canvas.height = 450;
const ctx = canvas.getContext('2d');
const grad = ctx.createLinearGradient(0,0,800,450);
grad.addColorStop(0,'#1a1d24'); grad.addColorStop(0.5,'#0f1115'); grad.addColorStop(1,'#1a1d24');
ctx.fillStyle = grad; ctx.fillRect(0,0,800,450);
const goldGrad = ctx.createLinearGradient(0,0,800,0);
goldGrad.addColorStop(0,'#d4a843'); goldGrad.addColorStop(0.5,'#f0c96b'); goldGrad.addColorStop(1,'#d4a843');
ctx.fillStyle = goldGrad; ctx.fillRect(0,0,800,4);
ctx.save();
ctx.beginPath();
ctx.arc(130,180,80,0,Math.PI*2);
ctx.closePath();
ctx.clip();
if(emp.photo){
const img = new Image();
img.onload = ()=>{ ctx.drawImage(img,50,100,160,160); drawRestOfCard(); };
img.src = emp.photo;
}else{
ctx.fillStyle = '#d4a843';
ctx.fillRect(50,100,160,160);
ctx.fillStyle = '#0a0b0d';
ctx.font = '900 60px Cairo';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText(initials,130,180);
drawRestOfCard();
}
ctx.restore();
function drawRestOfCard(){
ctx.strokeStyle = '#d4a843'; ctx.lineWidth = 3;
ctx.beginPath(); ctx.arc(130,180,80,0,Math.PI*2); ctx.stroke();
ctx.fillStyle = '#f0c96b';
ctx.font = '900 32px Cairo';
ctx.textAlign = 'right';
ctx.fillText(emp.name, 760, 80);
ctx.fillStyle = '#ffffff';
ctx.font = '600 18px Cairo';
ctx.fillText(`${emp.position||'—'} ${dept?'• '+dept.name:''}`, 760, 110);
ctx.fillStyle = '#9aa0b4';
ctx.font = '500 15px Cairo';
// Canvas fills draw raw text — icon markup was being painted literally on the card
ctx.fillText(`رقم الموظف: ${emp.employeeId||'—'}`, 760, 150);
ctx.fillText(`تاريخ التعيين: ${fD(emp.joinDate)}`, 760, 180);
ctx.fillText(`هاتف: ${emp.phone||'—'}`, 760, 210);
ctx.fillStyle = '#f0c96b';
ctx.font = '700 14px Courier New';
ctx.fillText(`بصمة: ${emp.digitalFingerprint||'—'}`, 760, 250);
if(qrUrl){
const qrImg = new Image();
qrImg.onload = ()=>{
ctx.fillStyle = '#ffffff';
ctx.fillRect(640,280,140,140);
ctx.drawImage(qrImg,650,290,120,120);
finalizeCard();
};
qrImg.src = qrUrl;
}else{ finalizeCard(); }
}
function finalizeCard(){
ctx.fillStyle = 'rgba(212,168,67,0.2)';
ctx.fillRect(30,400,740,1);
ctx.fillStyle = '#5c6280';
ctx.font = '500 12px Cairo';
ctx.textAlign = 'right';
ctx.fillText(`<i class=ji data-i=building></i> ${STATE.settings.name}`, 760, 430);
ctx.textAlign = 'left';
ctx.fillText(`GV-${String(emp.employeeId||emp.id).replace(/\D/g,'').padStart(6,'0')}`, 40, 430);
const link = document.createElement('a');
link.download = `SmartCard_${emp.employeeId||emp.id}_${emp.name.replace(/\s/g,'_')}.png`;
link.href = canvas.toDataURL('image/png');
link.click();
toast('تم حفظ البطاقة كصورة','success');
}
}

export { localDateOnly, generateFingerprintSync, generateDigitalFingerprint, findEmployeeById, ensureEmployeeCardData, qrCache, generateQRDataURL, getEmployeeQRData, getEmployeeHumanQRData, uploadEmployeePhoto, handlePhotoUpload, fillScheduledShiftBadge, renderSmartCard, showFullQRModal, downloadHumanQRImage, downloadQRImage, reportDateRangeForMonth, fetchEmployeeAttendanceReport, formatHoursFromMinutes, formatLateSummary, formatLateRow, formatAttendanceStatus, printAttendanceReport, runStrictAuditUI, printMonthlyAttendance, printLuxCard, printEmployeeAttendanceDay, printEmployeeAttendanceMonth, searchEmployeeAttendanceRange, printEmployeeAttendanceRange, regenerateFingerprint, printSmartCard, downloadSmartCard };
