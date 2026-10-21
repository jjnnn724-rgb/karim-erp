/**
 * features/auth-navigation.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// AUTH & NAVIGATION
// ============================================
async function completeRequiredPasswordChange(accessToken, currentPassword){
  const nextPassword = window.prompt('لأمان النظام، يجب تغيير كلمة المرور الأولية الآن. أدخل كلمة مرور جديدة من 8 حروف على الأقل وتحتوي على حروف وأرقام:');
  if(!nextPassword) {throw new Error('تم إلغاء تغيير كلمة المرور الإلزامي.');}
  const confirmPassword = window.prompt('أعد إدخال كلمة المرور الجديدة للتأكيد:');
  if(nextPassword !== confirmPassword) {throw new Error('كلمتا المرور غير متطابقتين.');}
  const response = await fetch(API_BASE + '/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ current_password: currentPassword, new_password: nextPassword }),
  });
  const result = await response.json().catch(() => ({}));
  if(!response.ok || !result.access_token) {throw new Error(result.message || 'تعذر تغيير كلمة المرور.');}
  toast('تم تغيير كلمة المرور بنجاح', 'success');
  return result;
}

// ─── تغيير كلمة المرور الذاتي (أي مستخدم مسجل — مدير أو موظف — من الشريط العلوي) ──
function showChangeMyPasswordModal(){
showModal(`<h3><i class=ji data-i=key></i> تغيير كلمة المرور</h3><div class="fr"><div class="fg"><label>كلمة المرور الحالية</label><input type="password" id="cpCurrent" autocomplete="current-password"></div><div class="fg"><label>كلمة المرور الجديدة <small>(8 حروف على الأقل مع حروف وأرقام)</small></label><input type="password" id="cpNew" autocomplete="new-password"></div><div class="fg"><label>تأكيد كلمة المرور الجديدة</label><input type="password" id="cpNew2" autocomplete="new-password"></div></div><div id="cpError" class="form-error" style="display:none" role="alert"></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" id="cpSubmitBtn" data-karim-action="submitChangeMyPassword"><i class=ji data-i=key></i> تغيير كلمة المرور</button></div>`);
setTimeout(()=>document.getElementById('cpCurrent')?.focus(),80);
}
function cpFail(message){
const errEl=document.getElementById('cpError');
if(errEl){ errEl.textContent=message; errEl.style.display='block'; }
toast(message,'error');
}
async function submitChangeMyPassword(){
const cur=document.getElementById('cpCurrent')?.value||'';
const np=document.getElementById('cpNew')?.value||'';
const np2=document.getElementById('cpNew2')?.value||'';
if(!cur||!np){ cpFail('أكمل كلمة المرور الحالية والجديدة'); return; }
if(np.length<8||!/[A-Za-z]/.test(np)||!/\d/.test(np)){ cpFail('كلمة المرور الجديدة يجب أن تكون 8 حروف على الأقل مع حروف وأرقام'); return; }
if(np!==np2){ cpFail('كلمتا المرور غير متطابقتين'); return; }
if(np===cur){ cpFail('اختر كلمة مرور مختلفة عن كلمة المرور الحالية'); return; }
const btn=document.getElementById('cpSubmitBtn');
if(btn){ btn.disabled=true; }
try{
const r=await fetch(API_BASE+'/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...(window._jwt?{Authorization:'Bearer '+window._jwt}:{})},body:JSON.stringify({current_password:cur,new_password:np})});
const data=await r.json().catch(()=>({}));
if(!r.ok){ cpFail(serverMessage(data,'تعذر تغيير كلمة المرور — تحقق من كلمة المرور الحالية')); return; }
// تدوير الجلسة: الخادم ألغى refresh القديم وأصدر بدلًا منه — حدّث المخزن المحلي
window._jwt = data.access_token || window._jwt;
if (data.app_key) {window._appKey = data.app_key;}
if (data.refresh_token) {KARIM_RTset(data.refresh_token);}
if (data.user && STATE.currentUser) {STATE.currentUser.name = data.user.name || STATE.currentUser.name;}
closeModal();
toast('تم تغيير كلمة المرور بنجاح','success');
}catch(_){ cpFail('تعذر الاتصال بالخادم — حاول مرة أخرى'); }
finally { if(btn){ btn.disabled=false; } }
}

// ─── استعادة كلمة المرور الذاتية (رمز لمرة واحدة يصدره المدير) ──────────────
function showForgotPasswordModal(){
showModal(`<h3><i class=ji data-i=key></i> استعادة كلمة المرور</h3><div class="workflow-banner">نسيت كلمة المرور؟ أدخل اسم المستخدم، ثم اطلب من المدير توليد <strong>رمز استعادة من 6 أرقام</strong> (صالح 10 دقائق)، وأدخل الرمز مع كلمة المرور الجديدة.</div><div class="fr"><div class="fg"><label>اسم المستخدم</label><input type="text" id="fpUsername" autocomplete="username" autocapitalize="none" spellcheck="false"></div><div class="fg"><label>رمز الاستعادة (6 أرقام)</label><input type="text" id="fpCode" inputmode="numeric" maxlength="6" placeholder="______"></div></div><div class="fr"><div class="fg"><label>كلمة المرور الجديدة <small>(8 حروف على الأقل مع حروف وأرقام)</small></label><input type="password" id="fpNew"></div><div class="fg"><label>تأكيد كلمة المرور الجديدة</label><input type="password" id="fpNew2"></div></div><div id="fpError" class="form-error" style="display:none" role="alert"></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="submitForgotPassword"><i class=ji data-i=key></i> تغيير كلمة المرور</button></div>`);
setTimeout(()=>document.getElementById('fpUsername')?.focus(),80);
}
function fpFail(message){
const errEl=document.getElementById('fpError');
if(errEl){ errEl.textContent=message; errEl.style.display='block'; }
toast(message,'error');
}
async function submitForgotPassword(){
const username=document.getElementById('fpUsername')?.value.trim()||'';
const code=document.getElementById('fpCode')?.value.trim()||'';
const np=document.getElementById('fpNew')?.value||'';
const np2=document.getElementById('fpNew2')?.value||'';
if(!username||!code||!np){ fpFail('أكمل اسم المستخدم والرمز وكلمة المرور الجديدة'); return; }
if(!/^\d{6}$/.test(code)){ fpFail('الرمز يتكون من 6 أرقام'); return; }
if(np!==np2){ fpFail('كلمتا المرور غير متطابقتين'); return; }
try{
const r=await fetch(API_BASE+'/auth/forgot-password/reset',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({username,code,new_password:np})});
const data=await r.json().catch(()=>({}));
if(!r.ok){ fpFail(serverMessage(data, 'تعذر تغيير كلمة المرور — تحقق من الرمز')); return; }
closeModal();
toast('تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة','success');
}catch(_){ fpFail('تعذر الاتصال بالخادم — حاول مرة أخرى'); }
}
async function issueResetCode(userId){
const u=STATE.users.find(x=>String(x.id)===String(userId));
if(!u) {return;}
try{
const r=await fetch(API_BASE+'/auth/forgot-password/request-code',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...(window._jwt?{Authorization:'Bearer '+window._jwt}:{})},body:JSON.stringify({username:u.username})});
const data=await r.json().catch(()=>({}));
if(!r.ok){ toast(serverMessage(data, 'تعذر إصدار رمز الاستعادة'),'error'); return; }
showModal(`<h3><i class=ji data-i=key></i> رمز استعادة لكلمة المرور</h3><div class="workflow-banner">أعطِ هذا الرمز للموظف <strong>${esc(data.user_name||u.name)}</strong> (@${esc(data.username)}) ليغيّر كلمة مروره بنفسه من شاشة الدخول عبر زر «نسيت كلمة المرور؟».</div><div style="text-align:center;margin:18px 0"><div class="mono" style="font-size:40px;letter-spacing:10px;font-weight:bold;color:var(--gold,#c9a227)">${esc(data.code)}</div><small class="text-muted">صالح 10 دقائق · استخدام واحد فقط · إصدار رمز جديد يُبطل هذا الرمز</small></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button><button class="btn btn-gold" data-karim-action="copyResetCode" data-karim-arg0="${esc(data.code)}"><i class=ji data-i=copy></i> نسخ الرمز</button></div>`);
}catch(_){ toast('تعذر الاتصال بالخادم','error'); }
}
function copyResetCode(code){
if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(code).then(()=>toast('نُسخ الرمز','success')).catch(()=>{}); }
}
// Login validation visuals: red border + focus follow the error container (#lerr).
// Cleared on every new attempt; success hides the form entirely.
function markLoginInvalid(focusId){
  for(const id of ['lu','lp']){
    const el = document.getElementById(id);
    if(el){ el.setAttribute('aria-invalid', id===focusId || !focusId ? 'true' : 'false'); }
  }
  const f = focusId && document.getElementById(focusId);
  if(f){ try{ f.focus({ preventScroll: false }); }catch(_){} }
}
function clearLoginInvalid(){
  for(const id of ['lu','lp']){ document.getElementById(id)?.removeAttribute('aria-invalid'); }
}
async function doLogin(){
const username = document.getElementById('lu')?.value.trim()||'';
const password = document.getElementById('lp')?.value.trim()||'';
const loginBtn = document.getElementById('loginBtn');
const errorEl = document.getElementById('lerr');
if(!username||!password){
  if(errorEl){ errorEl.textContent = 'أدخل اسم المستخدم وكلمة المرور'; errorEl.style.display = 'block'; }
  toast('أدخل اسم المستخدم وكلمة المرور','error');
  markLoginInvalid(!username ? 'lu' : 'lp');
  return;
}
if(loginBtn?.disabled) {return;}
clearLoginInvalid();
if(errorEl){ errorEl.textContent = ''; errorEl.style.display = 'none'; }
if(loginBtn){ loginBtn.disabled = true; loginBtn.setAttribute('aria-busy','true'); loginBtn.dataset.originalHTML = loginBtn.innerHTML; loginBtn.innerHTML = '<i class=ji data-i=hourglass></i> جارٍ التحقق...'; }
// <i class=ji data-i=alert-triangle></i> SECURITY: authenticate via JWT endpoint, NOT against local STATE.users.
// The server validates credentials (bcrypt-hashed) and returns an access_token.
try {
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15000);
const r = await fetch(API_BASE + '/auth/login', {
method: 'POST',
headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
body: JSON.stringify({ username, password }),
signal: controller.signal
});
        clearTimeout(timeout);
        const data = await r.json().catch(() => ({}));
        if (data.password_change_required && data.access_token) {
          try {
            const rotated = await completeRequiredPasswordChange(data.access_token, password);
            Object.assign(data, rotated);
          } catch (rotationError) {
            const message = rotationError.message || 'يجب تغيير كلمة المرور قبل الدخول.';
            if(errorEl){ errorEl.textContent = message; errorEl.style.display = 'block'; }
            toast(message,'error');
            return;
          }
        }
        if (!r.ok || !data.access_token) {
  const message = serverMessage(data, 'بيانات تسجيل الدخول غير صحيحة');
  if(errorEl){ errorEl.textContent = message; errorEl.style.display = 'block'; }
  toast(message,'error');
  markLoginInvalid('lp');
  return;
}
// Keep the JWT in memory only; the refresh token persists locally for an always-open session.
window._jwt = data.access_token;
if (data.app_key) {window._appKey = data.app_key;}
if (data.refresh_token) {KARIM_RTset(data.refresh_token);}
const user = { id: data.user.id, username: data.user.username, role: data.user.role, name: data.user.name, dept_code: data.user.dept_code || null };
STATE.currentUser = user;
} catch (e) {
const message = e.name === 'AbortError' ? 'انتهت مهلة الاتصال بالخادم' : 'فشل الاتصال بالخادم';
if(errorEl){ errorEl.textContent = message; errorEl.style.display = 'block'; }
toast(message,'error');
return;
} finally {
  if(loginBtn){ loginBtn.disabled = false; loginBtn.removeAttribute('aria-busy'); loginBtn.innerHTML = loginBtn.dataset.originalHTML || '<i class=ji data-i=lock></i> تسجيل الدخول'; }
}
// Load protected business data only after a valid JWT exists.
await enterApp();
}
async function enterApp(){
document.getElementById('login').style.display = 'none';
document.getElementById('app').style.display = 'block';
// إصلاح أمني 2026-10-01: صفحة الدور السابق (أدمن) كانت تُعرض للدخول التالي —
// ابدأ دائمًا من أول قائمة دور المستخدم الحالي
try{
const home = window.ROLES?.[STATE.currentUser?.role]?.menus?.[0];
if(home) {STATE.page = home;}
}catch(_){}
document.getElementById('restNameDisplay').textContent = STATE.settings.name;
document.getElementById('loginTitle').textContent = STATE.settings.name;
updateLogoDisplay();
updateDateDisplay();
updateRoleIndicator();
buildNav(); renderPage();
updateQuickDispatchButton();
updateNotificationBadge();
try{ ensureChatUI(); hookChatSocket(); setTimeout(()=>{try{hookChatSocket();}catch(_){}},5000); }catch(_){}
toast(`مرحبًا ${STATE.currentUser.name}`,'success');

// Render the authenticated shell immediately. Large business datasets continue
// loading in the background, then the current page is refreshed with real data.
loadData().then(async ()=>{
  try {
    const me = await apiFetch('/permissions/me');
    STATE.permissions = { grants: me.grants || [], denies: me.denies || [], menus: me.menus || [], deniedMenus: me.deniedMenus || [] };
  } catch (_) { STATE.permissions = { grants: [], denies: [], menus: [], deniedMenus: [] }; }
  document.getElementById('restNameDisplay').textContent = STATE.settings.name;
  document.getElementById('loginTitle').textContent = STATE.settings.name;
  updateLogoDisplay();
  buildNav(); renderPage();
  updateQuickDispatchButton();
  updateNotificationBadge();
  refreshNotifications();
}).catch((e)=>{
  console.error('Post-login data load failed:', e);
  toast('تم الدخول، ويجري تحميل بعض البيانات في الخلفية.', 'warning');
});
// Task 20: سجّل هوية المستخدم على غرف الإشعارات + اجلب صندوقه من قاعدة البيانات
if (typeof window._rtStart === 'function') {window._rtStart();}
if (typeof window._rtRegisterUser === 'function') {window._rtRegisterUser();}
refreshNotifications();
}
function doLogout(){
const oldJwt = window._jwt;
window._jwt = null;
window._appKey = null;
KARIM_RTclear();
try{ document.getElementById('chatFab')?.remove(); document.getElementById('chatPanel')?.remove(); }catch(_){}
CHATSTATE.open=false; CHATSTATE.unread=0; CHATSTATE.messages=[]; CHATSTATE.loaded=false; CHATSTATE.sockHooked=false;
if (oldJwt) {fetch(API_BASE + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + oldJwt } }).catch(() => {});}
STATE.currentUser = null;
try{ applyTopbarRoleGates(); }catch(_){}
STATE.deptPanel = null;
STATE.permissions = { grants: [], denies: [], menus: [], deniedMenus: [] };
// إصلاح أمني 2026-10-01 (تسرب قائمة الأدمن): الخروج كان يترك القوائم والمحتوى
// وحالة الجوال للدور السابق — الدخول التالي (موظف) يرى بقايا الأدمن. تنظيف شامل:
STATE.page = 'dashboard';
try{
const nc = document.getElementById('navContainer'); if(nc) {nc.innerHTML='';}
const cc = document.getElementById('content'); if(cc) {cc.innerHTML='';}
document.getElementById('mobileNav')?.remove();
document.getElementById('punchCard')?.remove();
document.getElementById('faceEnrollCard')?.remove();
document.getElementById('mobileOfflineBar')?.remove();
document.getElementById('topbarLogout')?.remove();
document.getElementById('modals') && (document.getElementById('modals').innerHTML='');
document.body.classList.remove('mobile-shell-on','mobile-offline');
if(window.__mobileContentObserver){ try{window.__mobileContentObserver.disconnect();}catch(_){} window.__mobileContentObserver=null; }
if(typeof window.resetMobileShellSession==='function'){ window.resetMobileShellSession(); }
if(Array.isArray(STATE.notifications)) {STATE.notifications=[];}
try{ updateNotificationBadge(); }catch(_){}
try{ window.closeModal && window.closeModal(); }catch(_){}
}catch(_){}
const password = document.getElementById('lp');
const errorEl = document.getElementById('lerr');
if(password) {password.value = '';}
if(errorEl){ errorEl.textContent = ''; errorEl.style.display = 'none'; }
document.getElementById('login').style.display = 'flex';
document.getElementById('app').style.display = 'none';
destroyCharts();
}
function getLogoSrc(){
const configured = String(STATE.settings?.logoB64 || '');
return /^data:image\//i.test(configured) ? configured : CONFIG.LOGO_PATH;
}
function getAbsoluteLogoSrc(){
const src = getLogoSrc();
return src.startsWith('data:') ? src : new URL(src, window.location.origin).href;
}
function logoMarkup(className='print-brand-logo', alt='مطاعم الشرفه العالمي'){
return `<img class="${esc(className)}" src="${esc(getAbsoluteLogoSrc())}" alt="${esc(alt)}" loading="eager">`;
}
function updateLogoDisplay(){
const logoEl = document.getElementById('logoDisplay'), loginLogo = document.getElementById('loginLogo');
if(logoEl) {logoEl.innerHTML = logoMarkup('sidebar-brand-logo');}
if(loginLogo) {loginLogo.innerHTML = logoMarkup('login-brand-logo');}
}
// Grouping map: menu key → section (display only; roles, badges, handlers untouched).
// Unknown keys fall back to their current section so nothing can disappear.
// صفحات مخفية من القائمة الجانبية — إخفاء عرض فقط:
// الصفحات نفسها تعمل عبر الروابط والأزرار الداخلية (مثال: طلب صرف) —
// ولإخفاء أي صفحة أضفها للقائمة دي. (2026-10-01: رجعت 'dispatch' للظهور بطلب المالك)
// صفحات مخفية من القائمة بطلب المالك — الإخفاء عرض فقط (الصفحات تعمل عبر الروابط)
const NAV_HIDDEN_PAGES = []; // احتياطي فقط — مصدر الإخفاء: settings.hidden_nav_pages (يُدار من شاشة الإعدادات)
const NAV_GROUPS = [
 {id:'main', title:'nav.grp.main', keys:['dashboard']},
 {id:'finance', title:'nav.grp.finance', keys:['cfo','revenues','expenses','cost-analysis','pnl']},
  {id:'ops', title:'nav.grp.ops', keys:['departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','veg-requests','shelves','weight','kitchen','dispatch','recipes','procurement']},
 {id:'hr', title:'nav.grp.hr', keys:['hr-dashboard','employees','leaves','attendance','zkteco','payroll','hr-departments','employee-portal','roster','dept-employees']},
  {id:'sys', title:'nav.grp.sys', keys:['reports','settings','users','branches','permissions','yarasoft','oracle-data','whatsapp','query','professional','sales-analyzer','received-analyzer','wh-vs-pos']},
];
function userMenus(){
    // الفعالة = (الدور ∪ المنح) − المسحوب. السحب يغلب الدور والمنح معًا (عدا المدير).
    const role = ROLES[STATE.currentUser?.role];
    const base = role ? role.menus.slice() : [];
    const extra = Array.isArray(STATE.permissions?.menus) ? STATE.permissions.menus : [];
    const denied = new Set(Array.isArray(STATE.permissions?.deniedMenus) ? STATE.permissions.deniedMenus : []);
    if (STATE.currentUser?.role === 'admin') {denied.clear();}
    return [...new Set([...base, ...extra])].filter((m) => !denied.has(m));
}
// ─── بوابات الأدوار للشريط العلوي (طلب المالك 2026-09-29) ──────────────────
// زر الكاشير POS + لمبتا حالة الخادم/قاعدة البيانات + قائمة الإجراءات السريعة
// تُضبط حسب دور الجلسة — تُستدعى من buildNav (بعد كل دخول/تبديل لغة/خروج).
function applyTopbarRoleGates(){
const role = STATE.currentUser?.role || null;
const on = (el, roles) => { if(el) {el.style.display = roles.includes(role) ? '' : 'none';} };
// زر الكاشير POS: للإدارة العليا + مدير الحسابات + الكاشير فقط
on(document.querySelector('a[href="/app/pos.html"]'), ['admin','accountant','cashier']);
// زر شاشات المنيو: للإدارة والشيفات والمديرين
on(document.getElementById('menuDashboardTopbarBtn'), ['admin','manager','kitchen','sous_chef']);
// بوابة الواجهة الجديدة V2: الإدارة العليا والمدير فقط أثناء بناء التكافؤ
// (V2 يغطي 224 من 341 نقطة نهاية = 66%) — لا تظهر لبقية الأدوار قبل اكتمالها.
on(document.getElementById('v2ShellTopbarBtn'), ['admin','manager']);
// لمبتا الحالة (الخادم + قاعدة البيانات): للإدارة العامة فقط
on(document.getElementById('rt-badge'), ['admin']);
// قائمة الإجراءات السريعة (FAB): كل إجراء لدوره
on(document.querySelector('.fab-action[aria-label="لوحة التحكم"]'), ['admin','manager','hr','accountant','dept_head']);
on(document.querySelector('.fab-action[aria-label="طلب صرف"]'), ['admin','manager','kitchen','sous_chef','dept_head','warehouse']);
on(document.querySelector('.fab-action[aria-label="إضافة إيراد"]'), ['admin','manager','accountant']);
on(document.querySelector('.fab-action[aria-label="إضافة مصروف"]'), ['admin','manager','accountant']);
// زر الـ FAB نفسه يختفي لو لم يتبقَّ أي إجراء متاح (موظف/كاشير)
const anyFab = ['admin','manager','hr','accountant','dept_head','kitchen','sous_chef','warehouse'].includes(role);
on(document.getElementById('fabBtn'), anyFab ? ['admin','manager','hr','accountant','dept_head','kitchen','sous_chef','warehouse'] : []);
}

function buildNav(){
applyI18nMaps();
try{ applyLangAttrs(); }catch(_){}
const container = document.getElementById('navContainer');
const allowedMenus = userMenus();
// إخفاء ديناميكي يديره الأدمن من شاشة الإعدادات (settings.hidden_nav_pages)
// حراسة: الرئيسية والإعدادات لا يُخفيان (منع حجب النظام عن نفسه)
const dynamicHidden = new Set(String(STATE.settings?.hidden_nav_pages || '').split(',').map(x => x.trim()).filter(Boolean));
dynamicHidden.delete('dashboard');
dynamicHidden.delete('settings');
const itemHtml = (key, name) => {
let badge = '';
if(key==='dispatch'){ // شارة الصرف: عدد الطلبات التي تنتظر إجراء من هذا الدور تحديدًا
const r=STATE.currentUser?.role; const myDepts=String(STATE.currentUser?.dept_code||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
const actionable=STATE.dispatches.filter(d=>{
  if(r==='dept_head') {return myDepts.includes(String(d.deptCode||'').trim().toLowerCase()) && ['pending','chef_approved'].includes(d.status);}
  if(r==='kitchen') {return d.status==='pending' && d.needsChefApproval;}
  if(['admin','manager'].includes(r)) {return d.status==='pending';}
  if(r==='warehouse') {return d.status==='chef_approved' || (d.status==='pending' && !d.needsChefApproval);}
  return false;
});
if(actionable.length>0) {badge = `<span class="nav-badge">${actionable.length}</span>`;} }
if(key==='leaves'){ const p=STATE.leaveRequests.filter(l=>l.status==='pending').length; if(p>0) {badge = `<span class="nav-badge">${p}</span>`;} }
const mLabel = name.match(/^<i class=ji data-i=([a-z0-9-]+)><\/i>\s*(.*)$/i);
const navIconName = mLabel ? mLabel[1] : null;
const navLabelText = mLabel ? mLabel[2] : name;
const isActive = STATE.page===key;
return `<div class="nav-item ${isActive?'active':''}" data-page="${key}" onclick="go('${key}',this)" role="button" tabindex="0" data-kb-activate aria-label="${navLabelText}"${isActive?' aria-current="page"':''}><span class="nav-icon">${navIconName&&window.ico?ico(navIconName):''}</span><span>${navLabelText}</span>${badge}</div>`;
};
let html = '';
const emitted = new Set();
for(const g of NAV_GROUPS){
  let items = '';
  for(const key of g.keys){
    if(NAV_HIDDEN_PAGES.includes(key) || dynamicHidden.has(key) || !allowedMenus.includes(key) || !(key in ALL_PERMISSIONS.menus)) {continue;}
    items += itemHtml(key, ALL_PERMISSIONS.menus[key]);
    emitted.add(key);
  }
  if(items) {html += `<div class="nav-section">${t(g.title)}</div>${items}`;}
}
// Safety net: any allowed menu not covered above renders under the main header
for(const [key,name] of Object.entries(ALL_PERMISSIONS.menus)){
  if(allowedMenus.includes(key) && !emitted.has(key)){
    if(NAV_HIDDEN_PAGES.includes(key) || dynamicHidden.has(key)) {continue;} // نفس قواعد الإخفاء
    if(!html.includes('nav-fallback')) {html += `<div class="nav-section nav-fallback">${t('nav.main')}</div>`;}
    html += itemHtml(key, name);
  }
}
container.innerHTML = html;
try{ applyTopbarRoleGates(); }catch(_){}
}
function go(page,el){
const role = ROLES[STATE.currentUser?.role];
if(!role || !role.menus.includes(page)){ toast('لا تملك صلاحية الوصول','error'); return; }
STATE.page = page; destroyCharts();
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
if(el) {el.classList.add('active');}
const titles = {dashboard:t('pg.dashboard'),cfo:t('pg.cfo'),revenues:t('pg.revenues'),expenses:t('pg.expenses'),'cost-analysis':t('pg.cost-analysis'),pnl:t('pg.pnl'),departments:t('pg.departments'),warehouse:t('pg.warehouse'),'wh-invoices':t('pg.wh-invoices'),'wh-moves':t('pg.wh-moves'),'wh-returns':t('pg.wh-returns'),'wh-prs':t('pg.wh-prs'),procurement:t('pg.procurement'),'veg-requests':'طلب شراء خضار','roster':t('pg.roster'),'dept-employees':'موظفو قسمي',shelves:t('pg.shelves'),weight:t('pg.weight'),dispatch:t('pg.dispatch'),kitchen:t('pg.kitchen'),recipes:t('pg.recipes'),reports:t('pg.reports'),settings:t('pg.settings'),users:t('pg.users'),'hr-dashboard':t('pg.hr-dashboard'),employees:t('pg.employees'),leaves:t('pg.leaves'),attendance:t('pg.attendance'),zkteco:t('pg.zkteco'),yarasoft:t('pg.yarasoft'),'cashier-monitor':'متابعة الكاشير','sales-analyzer':'تحليل مبيعات الكاشيرية','received-analyzer':'استلام المخازن','wh-vs-pos':'مقارنة الصرف والمبيعات','query':'محرك الاستعلامات','professional':'البطاقة الفاخرة','oracle-data':t('pg.oracle-data'),'whatsapp':t('pg.whatsapp'),'employee-portal':t('pg.employee-portal'),'hr-departments':t('pg.hr-departments'),payroll:t('pg.payroll'),permissions:t('pg.permissions'),branches:t('pg.branches')};
document.getElementById('pageTitle').textContent = titles[page]||page;
renderPage();
}
// Department detail is a sub-page of الأقسام, not a menu entry — no role's
// menus list contains it, so routing through go() always blocked the card
// click. Open it directly (the caller is already inside the permission-gated
// departments page), mirroring what renderPage's case 'departmentDetail' needs.
const deptDetailFrom='',deptDetailTo='';
function openDepartmentDetail(code){
STATE.dept = code;
STATE.page = 'departmentDetail';
destroyCharts();
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
const departmentsNav = document.querySelector('.nav-item[data-page="departments"]');
if(departmentsNav) {departmentsNav.classList.add('active');}
const titleEl = document.getElementById('pageTitle');
if(titleEl) {titleEl.textContent = t('pg.departmentDetail');}
renderPage();
}
function toggleSidebar(){ const sidebar=document.getElementById('sidebar'); if(!sidebar) {return;} if(window.matchMedia('(max-width: 900px)').matches){ sidebar.classList.toggle('mobile-open'); } else { sidebar.classList.toggle('collapsed'); } }
function toggleLang(){ STATE.lang = STATE.lang==='ar'?'en':'ar'; persistLangLocal(); if(['admin','manager'].includes(STATE.currentUser?.role)) {saveData();} applyLangAttrs(); buildNav(); renderPage(); // مرآة طبقة KarimI18n (js/karim-i18n.js): نفس مفتاح localStorage — إبقاؤها متزامنة كي تُعاد ترجمة عقد [data-i18n] ويظل money() باللغة الصحيحة
try{ if(window.KarimI18n) {window.KarimI18n.setLang(STATE.lang);} }catch(_){} }
function toggleTheme(){ STATE.theme = STATE.theme==='dark'?'light':'dark'; document.documentElement.setAttribute('data-theme',STATE.theme); if(['admin','manager'].includes(STATE.currentUser?.role)) {saveData();} }
function isOperatingExpense(e){ const t=String(e?.adjustmentType||e?.adjustment_type||'').toLowerCase(); return !['dispatch','dispatch_return','transfer','receipt','stock_transfer','inventory_transfer','kitchen_return','count_correction'].includes(t); }
function accountingExpenseAmount(e){ return isOperatingExpense(e) ? Number(e?.amount||0) : 0; }
function isStockMovementExpense(e){ return ['dispatch','dispatch_return','receipt','stock_transfer','inventory_transfer','kitchen_return'].includes(String(e?.adjustmentType||e?.adjustment_type||'').toLowerCase()); }
function isCountCorrectionExpense(e){ return String(e?.adjustmentType||e?.adjustment_type||'').toLowerCase()==='count_correction'; }
// كلفة القسم الحقيقية = كل ما تحمّله: صرف المخزون (صافي المرتجعات) + فروق الجرد + المصروفات التشغيلية.
// لا نُسقط حركة المخزون من الكلفة — هي جوهر كلفة القسم في المطاعم.
function deptExpenseBreakdown(deptId,fromDate,toDate){
const inRange=(r)=>{ if(!fromDate&&!toDate) {return true;} const d=String(r.date||'').slice(0,10); if(!d) {return false;} if(fromDate&&d<fromDate) {return false;} if(toDate&&d>toDate) {return false;} return true; };
// يشمل الأقسام الفرعية: مصروف الفرع يُسمع في الأب
const codes = deptWithChildren(deptId);
const rows=STATE.expenses.filter(e=>codes.has(String(e.deptId))&&inRange(e));
const sum=list=>list.reduce((s,e)=>s+Number(e.amount||0),0);
const materials=Math.max(0,sum(rows.filter(isStockMovementExpense)));
const countAdj=sum(rows.filter(isCountCorrectionExpense));
const operating=sum(rows.filter(e=>!isStockMovementExpense(e)&&!isCountCorrectionExpense(e)));
return {materials,countAdj,operating,total:materials+countAdj+operating,rows};
}
// شجرة الأقسام: القسم + كل فروعه (آمن ضد الدورات) — لمصروف/إيراد الأب الشامل
function deptWithChildren(code){
  const root = String(code);
  const out = new Set([root]);
  const kids = new Map();
  (STATE.departments || []).forEach(d => {
    const p = d.parent_code ? String(d.parent_code) : '';
    if(!p || p === String(d.code)) {return;}
    if(!kids.has(p)) {kids.set(p, []);}
    kids.get(p).push(String(d.code));
  });
  const stack = [root];
  while(stack.length){
    const c = stack.pop();
    for(const k of (kids.get(c) || [])){
      if(!out.has(k)){ out.add(k); stack.push(k); }
    }
  }
  return out;
}
function calcStats(deptId, fromDate, toDate){ 
// Optional [fromDate, toDate] filter — reports that declare a period must
// actually restrict the figures to it (the dept-specific report passed dates
// that were silently discarded, showing all-time numbers instead)
const inRange=(r)=>{
if(!fromDate&&!toDate) {return true;}
const d=String(r.date||r.createdAt||r.created_at||'').slice(0,10);
if(!d) {return false;}
if(fromDate&&d<fromDate) {return false;}
if(toDate&&d>toDate) {return false;}
return true;
};
const rev=STATE.revenues.filter(r=>deptWithChildren(deptId).has(String(r.deptId))&&inRange(r)).reduce((s,r)=>s+Number(r.amount||0),0); 
// كلفة شاملة: صرف المخزون + فروق الجرد + المصروفات التشغيلية (بدون استبعاد أي بند)
const exp=deptExpenseBreakdown(deptId,fromDate,toDate).total; 
return {rev,exp,profit:rev-exp,costRatio:rev>0?(exp/rev)*100:0}; 
}
function updateDateDisplay(){ const el=document.getElementById('dateDisp'); if(el) {el.textContent = new Date().toLocaleDateString(STATE.lang==='en'?'en-US':'ar-EG-u-nu-latn',{weekday:'short',day:'numeric',month:'short'});} }
function updateRoleIndicator(){ if(!STATE.currentUser) {return;} const role=ROLES[STATE.currentUser.role]||{icon:null,name:STATE.currentUser.role}; const el=document.getElementById('roleIndicator'); if(!el) {return;} el.textContent=''; if(role.icon && role.icon.indexOf('<i class=ji')===0){ const wrap=document.createElement('span'); wrap.innerHTML=role.icon; el.appendChild(wrap.firstChild); el.appendChild(document.createTextNode(' '+role.name)); } else { el.textContent=role.name; } }
function updateQuickDispatchButton(){ const btn=document.getElementById('quickDispatchBtn'); if(!btn) {return;} btn.style.display = STATE.currentUser && ['admin','kitchen','manager','dept_head'].includes(STATE.currentUser.role)?'inline-flex':'none'; }
function checkMenuAccessLocal(menuKey){ if(!STATE.currentUser) {return false;} if(userMenus().includes(menuKey)) {return true;} const role=ROLES[STATE.currentUser.role]; return role?role.menus.includes(menuKey):false; }
// عنقود لوحة التحكم: نُقل إلى js/features/dashboard.js (يجسر عبر js/main.js — BRIDGE-022)
// عنقود بوابة الموظف: نُقل إلى js/features/employee-portal.js (يجسر عبر js/main.js — BRIDGE-023)
// عنقود البصمة (ZKTECO): نُقل إلى js/features/zkteco.js (يجسر عبر js/main.js — BRIDGE-010)
// عنقود استيراد يارسوفت: نُقل إلى js/features/yarasoft.js (يجسر عبر js/main.js — BRIDGE-016)
// ORADATA (حالة متصفح بيانات أوراكل): نُقل إلى js/features/whatsapp.js — التبويب الخاص بها هناك (BRIDGE-017)
// عنقود محرك واتساب: نُقل إلى js/features/whatsapp.js (يجسر عبر js/main.js — BRIDGE-017)
// عنقود الأقسام: نُقل إلى js/features/departments.js (يجسر عبر js/main.js — BRIDGE-018)
// عنقود التقارير: نُقل إلى js/features/reports.js (يجسر عبر js/main.js — BRIDGE-019)
// عنقود الإعدادات والمستخدمين: نُقل إلى js/features/settings-users.js (يجسر عبر js/main.js — BRIDGE-020)
// عنقود المدير المالي: نُقل إلى js/features/cfo.js (يجسر عبر js/main.js — BRIDGE-021)

// showChangeMyPasswordModal و submitChangeMyPassword مستدعاة من معالج
// سطري داخل index.html (onclick="showChangeMyPasswordModal()") — والملف
// يُحمَّل كوحدة عبر safeBridge، فبلا تصديرهما لا تصلان إلى window
// فيسقط الزر بـReferenceError ولا يستطيع المستخدم تغيير كلمة مروره.
export { applyTopbarRoleGates, completeRequiredPasswordChange, showChangeMyPasswordModal, submitChangeMyPassword, showForgotPasswordModal, fpFail, submitForgotPassword, issueResetCode, copyResetCode, markLoginInvalid, clearLoginInvalid, doLogin, enterApp, doLogout, getLogoSrc, getAbsoluteLogoSrc, logoMarkup, updateLogoDisplay, NAV_GROUPS, buildNav, go, deptDetailFrom, deptDetailTo, openDepartmentDetail, toggleSidebar, toggleLang, toggleTheme, isOperatingExpense, accountingExpenseAmount, isStockMovementExpense, isCountCorrectionExpense, deptExpenseBreakdown, deptWithChildren, calcStats, updateDateDisplay, updateRoleIndicator, updateQuickDispatchButton, checkMenuAccessLocal };
