// ============================================
// CONFIG & STATE
// ============================================
// CONFIG: نُقل إلى js/core/config.js (يجسر عبر js/main.js — BRIDGE-007)
const DB_NAME = 'RestaurantDB';
const DB_VERSION = 2;
// API_BASE: نُقل إلى js/core/api.js (BRIDGE-006)

// سجل الكيانات (DATABASE-BACKED ENTITY API): نُقل إلى js/core/state.js (BRIDGE-005)

// apiFetch — عميل API الموحّد: نُقل إلى js/core/api.js (يجسر عبر js/main.js — BRIDGE-006)
// ─── قارئ أخطاء الخادم الموحد ───
// الخادم يرسل شكلين: متداخل {error:{code,message}} (المعالج العام) أو مسطح
// {error:'CODE', message?} (نقاط الدخول). لا نعرض أبدًا كائنًا ([object Object])
// ولا HTML خام — دائمًا نص عربي نظيف.
const SERVER_CODE_AR = {
    INVALID_CREDENTIALS: 'بيانات تسجيل الدخول غير صحيحة',
    PASSWORD_MIGRATION_REQUIRED: 'كلمة المرور تحتاج ترحيلًا أمنيًا — تواصل مع مسؤول النظام',
    PASSWORD_CHANGE_REQUIRED: 'يجب تغيير كلمة المرور قبل المتابعة',
    ACCOUNT_DISABLED: 'تم إيقاف هذا الحساب — تواصل مع المسؤول',
    TOKEN_EXPIRED: 'انتهت الجلسة — سجّل الدخول مجددًا',
    TOKEN_INVALID: 'جلسة غير صالحة — سجّل الدخول مجددًا',
    UNAUTHORIZED: 'غير مصرح — سجّل الدخول مجددًا',
    FORBIDDEN: 'لا تملك صلاحية هذه العملية',
    API_KEY_REQUIRED: 'خطأ إعداد الاتصال — حدّث الصفحة',
    API_KEY_INVALID: 'خطأ إعداد الاتصال — حدّث الصفحة',
    RATE_LIMITED: 'محاولات كثيرة — انتظر قليلًا وحاول مجددًا',
    CATCH_WEIGHT_REQUIRED: 'صنف الوزن المتغير: أدخل الوزن الفعلي وعدد الكراتين',
    INSUFFICIENT_STOCK: 'الرصيد المتاح لا يكفي',
    NOT_FOUND: 'العنصر غير موجود',
    VALIDATION_ERROR: 'بيانات غير صالحة — تحقق من الحقول',
    INTERNAL_ERROR: 'حدث خطأ داخلي في النظام — حاول مجددًا',
};
// serverErrorInfo/SERVER_CODE_AR: نُقلا إلى js/core/api.js (BRIDGE-006)
function serverMessage(data, fallback){
    const info = serverErrorInfo(data);
    return info.message || (info.code && SERVER_CODE_AR[info.code]) || fallback;
}
// ─── جلسة مفتوحة دائمة: رمز التحديث محفوظ محليًا + تجديد صامت ───
const KARIM_RT_KEY = 'karim_rt_v1';
function KARIM_RTget(){ try { return localStorage.getItem(KARIM_RT_KEY) || ''; } catch (_) { return ''; } }
function KARIM_RTset(rt){ try { if (rt) {localStorage.setItem(KARIM_RT_KEY, rt);} } catch (_) {} }
function KARIM_RTclear(){ try { localStorage.removeItem(KARIM_RT_KEY); } catch (_) {} }
let _refreshInflight = null;
function refreshSession(){
    if (_refreshInflight) {return _refreshInflight;}
    const rt = KARIM_RTget();
    if (!rt) {return Promise.resolve(false);}
    _refreshInflight = (async () => {
        try {
            const r = await fetch(API_BASE + '/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.access_token) { KARIM_RTclear(); return false; }
            window._jwt = d.access_token;
            if (d.app_key) {window._appKey = d.app_key;}
            if (d.refresh_token) {KARIM_RTset(d.refresh_token);}
            if (d.user) {STATE.currentUser = { id: d.user.id, username: d.user.username, role: d.user.role, name: d.user.name, dept_code: d.user.dept_code || null };}
            return true;
        } catch (_) { return false; }
        finally { _refreshInflight = null; }
    })();
    return _refreshInflight;
}
const apiList = async (entity) => {
    const pageSize = 1000; // matches server MAX_LIMIT — fewer round-trips, less 429 pressure at boot
    const rows = [];
    let page = 1;
    const listTimeout = setTimeout(() => { throw new Error('TIMEOUT'); }, 45000);
    while (page <= 1000) {
        const response = await apiFetch(`/${entity}?page=${page}&limit=${pageSize}&sort=id&order=asc`);
        const pageRows = response && Array.isArray(response.data)
            ? response.data
            : (Array.isArray(response) ? response : []);
        rows.push(...pageRows);
        const totalPages = Number(response?.pagination?.totalPages || 0);
        if (pageRows.length === 0 || (totalPages > 0 && page >= totalPages) || pageRows.length < pageSize) {break;}
        page += 1;
    }
    clearTimeout(listTimeout);
    return rows;
};
const apiCreate = (entity, body)    => apiFetch(`/${entity}`, { method: 'POST', body: JSON.stringify(body) });
const apiUpdate = (entity, id, body)=> apiFetch(`/${entity}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
const apiRemove = (entity, id)      => apiFetch(`/${entity}/${id}`, { method: 'DELETE' });

// Optimistic-UI helper used by every add/edit/delete function below:
// hit the real DB endpoint first: only touch local STATE + re-render once
// PostgreSQL confirms the write, so the UI never shows data that didn't
// actually persist.
async function persistCreate(entity, localArrayPush, body) {
    const { id, ...cleanBody } = body;   // strip id — server auto-generates it
    const saved = await apiCreate(entity, cleanBody);
    localArrayPush(saved);
    return saved;
}
async function persistUpdate(entity, id, body) {
    return apiUpdate(entity, id, body);
}
async function persistRemove(entity, id) {
    return apiRemove(entity, id);
}
function upsertStateEntity(entity, row) {
    if (!row || !STATE[entity]) {return;}
    const index = STATE[entity].findIndex(item => String(item.id) === String(row.id));
    if (index >= 0) {STATE[entity][index] = { ...STATE[entity][index], ...row };}
    else {STATE[entity].push(row);}
}
const db = null;
// ROLES: نُقل إلى js/core/config.js (يجسر عبر js/main.js — BRIDGE-007)
const ALL_PERMISSIONS = {
menus: {
    dashboard: '<i class=ji data-i=chart></i>',
    cfo: '<i class=ji data-i=briefcase></i>',
    revenues: '<i class=ji data-i=banknote></i>',
    expenses: '<i class=ji data-i=wallet></i>',
    'cost-analysis': '<i class=ji data-i=trending-up></i>',
    'pnl': '<i class=ji data-i=gem></i>',
    departments: '<i class=ji data-i=building></i>',
    warehouse: '<i class=ji data-i=package></i>',
    shelves: '<i class=ji data-i=archive></i>',
    weight: '<i class=ji data-i=scale></i>',
    kitchen: '<i class=ji data-i=chef-hat></i>',
    dispatch: '<i class=ji data-i=clipboard-list></i>',
    recipes: '<i class=ji data-i=utensils></i>',
    procurement: '<i class=ji data-i=shopping-cart></i>',
    reports: '<i class=ji data-i=chart></i>',
    settings: '<i class=ji data-i=settings></i>',
    users: '<i class=ji data-i=users></i>',
    'hr-dashboard': '<i class=ji data-i=users></i>',
    employees: '<i class=ji data-i=user></i>',
    leaves: '<i class=ji data-i=calendar></i>',
    attendance: '<i class=ji data-i=timer></i>',
    zkteco: '<i class=ji data-i=user-check></i>',
    yarasoft: '<i class=ji data-i=shopping-cart></i>',
    'oracle-data': '<i class=ji data-i=database></i>',
    whatsapp: '<i class=ji data-i=send></i>',
    'employee-portal': '<i class=ji data-i=home></i>',
    'hr-departments': '<i class=ji data-i=building></i>',
    payroll: '<i class=ji data-i=banknote></i>',
    'query': '<i class=ji data-i=search></i>',
    professional: '<i class=ji data-i=credit-card></i>'
}
};

// STATE المركزي + جسر window.STATE: نُقلا إلى js/core/state.js (يجسر عبر js/main.js — BRIDGE-005)
// ============================================
// UTILS
// ============================================
// المنسقات ونظام التاريخ الهجري (uid..fDT): نُقلت إلى js/core/utils.js (يجسر عبر js/main.js — BRIDGE-003)
// toast: نُقل إلى js/ui/toast.js (يجسر عبر js/main.js — BRIDGE-004)
function cleanNotificationText(value, max=320){
  let text = value == null ? '' : String(value);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') { text = parsed.message || parsed.title || parsed.error || parsed.detail || text; }
  } catch (_) {}
  text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
// showLoad/hideLoad: نُقلا إلى js/ui/toast.js (يجسر عبر js/main.js — BRIDGE-004)
function destroyCharts(){ Object.values(STATE.charts).forEach(c=>{try{c.destroy();}catch(e){}}); STATE.charts={}; }
function metricCard(label,value,cls){ return `<div class="mcard"><div class="mcard-label">${label}</div><div class="mcard-val ${cls}">${value}</div></div>`; }
// سياسة الإشعارات على الشاشة: الجرس والشارة والمركز ومنبثقات الأحداث لمدير النظام فقط.
// البيانات تتدفق في الخلفية للجميع (لا يُمس أي منطق عمل أو أصوات).
function notifAdmin(){ return STATE.currentUser?.role==='admin'; }
function addNotification(title,message,type='info'){
if(!notifAdmin()) {return;}
const tempId=`temp-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const payload={title:cleanNotificationText(title,120),message:cleanNotificationText(message),type:String(type||'info'),date:new Date().toISOString(),read:false};
STATE.notifications.unshift({id:tempId,...payload});
if(STATE.notifications.length>50) {STATE.notifications = STATE.notifications.slice(0,50);}
updateNotificationBadge();
// Task 20: يُحفظ في صندوق صاحب الجهاز نفسه (user_id=الطالب) عبر مسار الإشعارات الجديد
apiFetch('/notifications',{method:'POST',body:JSON.stringify({title:payload.title,message:payload.message,type:payload.type})}).then(saved=>{
  const local=STATE.notifications.find(n=>n.id===tempId);
  if(local&&saved) {Object.assign(local,saved);}
}).catch(error=>console.warn('Notification persistence failed:',error.message));
}
function updateNotificationBadge(){
const bell=document.querySelector('.notification-bell');
if(bell){ bell.style.display=notifAdmin()?'':'none'; }
if(!notifAdmin()) {return;}
const unread = STATE.notifications.filter(n=>!n.read).length;
const badge = document.getElementById('notifBadge');
if(badge){ badge.textContent = unread>99?'99+':unread; badge.style.display = unread>0?'flex':'none'; }
}
// ═══ Task 20: صندوق الإشعارات الموجّه — لكل مستخدم صندوقه من قاعدة البيانات ═══
async function refreshNotifications(){
if(!notifAdmin()){ STATE.notifications=[]; return; }
try{
const data = await apiFetch('/notifications');
STATE.notifications = (data.notifications||[]).map(n=>({id:n.id,title:cleanNotificationText(n.title,120),message:cleanNotificationText(n.message),type:n.type,date:n.created_at||n.date,read:!!n.read,entity:n.entity||null,entity_id:n.entity_id||null,link:n.link||null}));
updateNotificationBadge();
}catch(e){ console.warn('Notifications load failed:', e.message); }
}
function navigateNotification(n){
const page = String(n?.link||'').trim();
if(page && ROLES[STATE.currentUser?.role]?.menus?.includes(page)){
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
  go(page, navItem);
  return true;
}
return false;
}
async function showNotifications(){
if(!notifAdmin()){ toast('عرض الإشعارات متاح لمدير النظام فقط','info'); return; }
await refreshNotifications();
const notifs = STATE.notifications.slice(0,50);
const unread = STATE.notifications.filter(n=>!n.read).length;
const html = `
<h3><i class=ji data-i=bell></i> الإشعارات ${unread>0?`<span class="badge bdg-red">${unread} جديد</span>`:''}</h3>
<div class="notif-scroll">
${notifs.length===0?'<div class="u-empty">لا توجد إشعارات — كل إجراء في سلسلة الصرف سيصلك هنا لحظيًا</div>':
notifs.map(n=>`
<div class="insight-item insight-item--clickable ${!n.read?'notif-unread':''}" onclick="openNotification('${String(n.id).replace(/'/g,"\\'")}')">
<div class="insight-icon">${n.type==='success'?'<i class=ji data-i=circle-check></i>':n.type==='error'?'<i class=ji data-i=circle-x></i>':n.type==='warning'?'<i class=ji data-i=alert-triangle></i>':'<i class=ji data-i=info></i>'}</div>
<div class="insight-content">
<div class="insight-text">${esc(n.title)}${!n.read?' <span class="badge bdg-blue">جديد</span>':''}</div>
<div class="insight-meta">${esc(n.message)} • ${fDT(n.date)}</div>
</div>
</div>`).join('')}
</div>
<div class="modal-footer">
<button class="btn btn-blue btn-sm" onclick="markAllNotificationsRead()"><i class=ji data-i=check></i> تعليم الكل كمقروء</button>
<button class="btn btn-red btn-sm" onclick="clearAllNotifications()"><i class=ji data-i=trash></i> مسح الكل</button>
<button class="btn btn-gold" onclick="closeModal()">إغلاق</button>
</div>`;
showModal(html);
}
async function openNotification(id){
const n=STATE.notifications.find(x=>String(x.id)===String(id));
if(!n) {return;}
if(!n.read){ await markNotificationRead(id); }
closeModal();
if(!navigateNotification(n)) {renderPage();}
}
async function markAllNotificationsRead(){
try{ await apiFetch('/notifications/read-all',{method:'POST'}); STATE.notifications.forEach(n=>{n.read=true;}); updateNotificationBadge(); closeModal(); toast('تم تعليم كل الإشعارات كمقروءة','success'); }catch(e){ toast(e.message||'تعذر تعليم الإشعارات','error'); }
}
async function markNotificationRead(id){ const n=STATE.notifications.find(x=>String(x.id)===String(id)); if(!n){return;} try { if(!String(id).startsWith('temp-')&&!String(id).startsWith('rt-')) {await apiFetch('/notifications/read',{method:'POST',body:JSON.stringify({ids:[id]})});} n.read=true; updateNotificationBadge(); } catch(e) { toast(e.message||'تعذر تحديث الإشعار','error'); } }
async function clearAllNotifications(){ try { await apiFetch('/notifications',{method:'DELETE'}); STATE.notifications=[]; updateNotificationBadge(); closeModal(); toast('تم مسح جميع إشعاراتك','success'); } catch(e) { toast(e.message||'تعذر مسح الإشعارات','error'); } }
// ─── الشات الداخلي الخاص 1-1 (اختيار موظف — لا عام) ───
// حفظ دائم + توصيل للطرفين فقط. الشارة للجميع؛ المنبثق للأدمن فقط (سياسة الإشعارات).
const CHATSTATE={open:false,unread:0,messages:[],loaded:false,sockHooked:false,peer:null,users:[]};
function chatIsOn(){ return !!(STATE.currentUser&&STATE.currentUser.id); }
function ensureChatUI(){
if(document.getElementById('chatFab')) {return;}
const fab=document.createElement('button');
fab.id='chatFab';
fab.innerHTML='<i class=ji data-i=message></i><span id="chatUnread" class="badge bdg-red" style="display:none;position:absolute;top:-6px;left:-6px">0</span>';
fab.title='شات الطاقم الداخلي';
fab.style.cssText='position:fixed;bottom:18px;left:18px;z-index:9000;width:52px;height:52px;border-radius:50%;border:2px solid var(--gold);background:var(--bg2);color:var(--gold);font-size:22px;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center';
fab.onclick=toggleChatPanel;
document.body.appendChild(fab);
const panel=document.createElement('div');
panel.id='chatPanel';
panel.style.cssText='position:fixed;bottom:82px;left:18px;z-index:9000;width:min(360px,92vw);max-height:55vh;display:none;flex-direction:column;background:var(--bg2);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden';
panel.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--bg3)"><span id="chatHead"><strong><i class=ji data-i=message></i> شات الطاقم</strong></span><span class="u-row-wrap"><button class="btn btn-sm" id="chatBackBtn" style="display:none" onclick="backToChatUsers()">الموظفون</button><button class="btn btn-sm" onclick="toggleChatPanel()">إغلاق</button></span></div>
<div id="chatMsgs" style="flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:180px"></div>
<div id="chatInputRow" style="display:none;gap:6px;padding:10px 12px;border-top:1px solid var(--line)"><input id="chatInput" class="inp" placeholder="اكتب رسالتك..." maxlength="1000" style="flex:1"><button class="btn btn-gold btn-sm" onclick="sendChatMsg()"><i class=ji data-i=send></i></button></div>`;
document.body.appendChild(panel);
const inp=document.getElementById('chatInput');
if(inp){ inp.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){ sendChatMsg(); } }); }
hookChatSocket();
}
function hookChatSocket(){
const s=window._rtSocket;
if(!s||CHATSTATE.sockHooked) {return;}
try{
s.on('chat:new',(m)=>{ onChatNew(m); });
CHATSTATE.sockHooked=true;
}catch(_){}
}
function chatUpdateBadge(){
const b=document.getElementById('chatUnread');
if(!b) {return;}
b.style.display=CHATSTATE.unread>0?'flex':'none';
b.textContent=CHATSTATE.unread>99?'99+':CHATSTATE.unread;
}
function chatRender(){
const box=document.getElementById('chatMsgs'); if(!box) {return;}
const me=STATE.currentUser?.id;
box.innerHTML=CHATSTATE.messages.map(m=>{
const mine=String(m.from_user_id)===String(me);
return `<div style="align-self:${mine?'flex-start':'flex-end'};max-width:85%;background:${mine?'var(--gold)':'var(--bg3)'};color:${mine?'#111':'var(--text)'};border-radius:10px;padding:7px 10px"><div style="font-size:11px;opacity:.75">${esc(m.from_name||'—')} · ${fDT(m.created_at)}</div><div style="white-space:pre-wrap;word-break:break-word">${esc(m.body||'')}</div></div>`;
}).join('')||'<div class="u-empty-sm">لا رسائل بعد — ابدأ التحية 👋</div>';
box.scrollTop=box.scrollHeight;
}
function chatPeerName(id){
const u=(CHATSTATE.users||[]).find(x=>String(x.id)===String(id));
return u?(u.name||u.username||('#'+id)):('#'+id);
}
function chatRenderUsers(){
const box=document.getElementById('chatMsgs'); if(!box) {return;}
const head=document.getElementById('chatHead');
if(head){ head.innerHTML='<strong><i class=ji data-i=message></i> اختر موظفًا</strong>'; }
const back=document.getElementById('chatBackBtn'); if(back){ back.style.display='none'; }
const row=document.getElementById('chatInputRow'); if(row){ row.style.display='none'; }
const list=CHATSTATE.users||[];
box.innerHTML=list.length?list.map(u=>`
<div class="insight-item insight-item--clickable" onclick="pickChatPeer('${esc(String(u.id))}')">
<div class="insight-icon">${u.online?'<i class=ji data-i=dot-green></i>':'<i class=ji data-i=dot-red></i>'}</div>
<div class="insight-content"><div class="insight-text">${esc(u.name||u.username||'—')} ${u.online?'<span class="badge bdg-green">متصل</span>':'<span class="text-muted">غير متصل</span>'}</div>
<div class="insight-meta">${esc(u.role||'')} · ${esc(u.username||'')}</div></div>
</div>`).join(''):'<div class="u-empty-sm">لا موظفين آخرين</div>';
}
async function loadChatUsers(){
const box=document.getElementById('chatMsgs'); if(!box) {return;}
box.innerHTML='<div class="u-empty-sm"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/chat/users');
CHATSTATE.users=Array.isArray(d.users)?d.users:[];
}catch(e){ CHATSTATE.users=[]; box.innerHTML='<div class="u-empty-sm">تعذر تحميل موظفي الشات — تحقق من الاتصال ثم أعد فتحه</div>'; }
chatRenderUsers();
}
async function pickChatPeer(id){
CHATSTATE.peer=String(id);
CHATSTATE.messages=[]; CHATSTATE.loaded=false;
const u=(CHATSTATE.users||[]).find(x=>String(x.id)===String(id));
const head=document.getElementById('chatHead');
if(head){ head.innerHTML=`<strong>${esc(u?(u.name||u.username):('موظف '+id))}</strong> ${u&&u.online?'<span class="badge bdg-green">متصل</span>':''}`; }
const back=document.getElementById('chatBackBtn'); if(back){ back.style.display=''; }
const row=document.getElementById('chatInputRow'); if(row){ row.style.display='flex'; }
const box=document.getElementById('chatMsgs'); if(box){ box.innerHTML='<div class="u-empty-sm"><div class="spinner"></div></div>'; }
try{
const d=await apiFetch('/chat/history?with='+encodeURIComponent(id));
CHATSTATE.messages=Array.isArray(d.messages)?d.messages:[];
CHATSTATE.loaded=true;
}catch(e){ CHATSTATE.messages=[]; }
chatRender();
const inp=document.getElementById('chatInput'); if(inp){ setTimeout(()=>inp.focus(),60); }
}
function backToChatUsers(){
CHATSTATE.peer=null; CHATSTATE.messages=[]; CHATSTATE.loaded=false;
loadChatUsers();
}
async function toggleChatPanel(){
const p=document.getElementById('chatPanel'); if(!p) {return;}
CHATSTATE.open=!CHATSTATE.open;
p.style.display=CHATSTATE.open?'flex':'none';
if(CHATSTATE.open){
CHATSTATE.unread=0; chatUpdateBadge();
hookChatSocket();
if(CHATSTATE.peer){ pickChatPeer(CHATSTATE.peer); }
else { loadChatUsers(); }
}
}
function onChatNew(m){
if(!m||!m.id) {return;}
const me=String(STATE.currentUser?.id||'');
const involves=String(m.from_user_id)===me||String(m.to_user_id)===me;
if(!involves) {return;}
if(CHATSTATE.open&&CHATSTATE.peer&&(String(m.from_user_id)===String(CHATSTATE.peer)||String(m.to_user_id)===String(CHATSTATE.peer))){
if(CHATSTATE.messages.some(x=>String(x.id)===String(m.id))) {return;}
CHATSTATE.messages.push(m);
if(CHATSTATE.messages.length>100){ CHATSTATE.messages=CHATSTATE.messages.slice(-100); }
chatRender();
return;
}
CHATSTATE.unread++; chatUpdateBadge();
if(STATE.currentUser?.role==='admin'){ toast(`💬 ${m.from_name||''}: ${String(m.body||'').slice(0,80)}`,'info'); }
try{ AudioEngine.playChat(); }catch(_){}
}
async function sendChatMsg(){
if(!CHATSTATE.peer){ toast('اختر موظفًا أولًا','error'); return; }
const inp=document.getElementById('chatInput');
const body=inp?.value.trim()||'';
if(!body) {return;}
inp.value='';
try{
const d=await apiFetch('/chat/send',{method:'POST',body:JSON.stringify({body,to_user_id:Number(CHATSTATE.peer)})});
if(d.message){ onChatNew(d.message); }
chatRender();
const box=document.getElementById('chatMsgs'); if(box){ box.scrollTop=box.scrollHeight; }
}catch(e){ toast(e.message||'تعذر الإرسال','error'); if(inp){inp.value=body;} }
}
// ============================================
// STORAGE
// ============================================
async function initDatabase() {
    const response = await fetch(API_BASE + '/health');
    if (!response.ok) {throw new Error('فشل الاتصال بالخادم');}
    const data = await response.json();
    const dbComp = data.components?.find(x => x.component === 'database');
    if (data.status !== 'ok' && dbComp?.status !== 'ok') {throw new Error(serverMessage(data, 'قاعدة البيانات غير متاحة'));}
    console.log('%c[HRP] Backend connected — ' + (data.checks?.realtime?.connectedClients ?? data.connectedClients ?? 0) + ' device(s) online', 'color:#08875c;font-weight:bold');
    return true;
}
// ═══════════════════════════════════════════════════════════════
//  saveData — نسخة محسّنة (Debounced + Coalesced + Retry)
//  • عند الإضافة/الحذف المتتالي: تُجمَع الطلبات في POST واحد
//  • مقاومة انقطاع الشبكة: 3 محاولات مع backoff تصاعدي
//  • لا تحجب واجهة المستخدم مهما كان الحجم
// ═══════════════════════════════════════════════════════════════
const _SAVE_DEBOUNCE_MS = 250;
let _saveTimer = null;
let _saveInFlight = null;   // Promise للحفظ الجاري
let _savePending = false;   // هل هناك تغييرات لم تُحفظ بعد؟
let _saveAbortCtrl = null;

function uiPreferencesPayload(){ return { lang: STATE.lang === 'en' ? 'en' : 'ar', theme: STATE.theme === 'light' ? 'light' : 'dark' }; }
async function _doSaveOnce() {
    if (_saveAbortCtrl) { try { _saveAbortCtrl.abort(); } catch(_){} }
    _saveAbortCtrl = new AbortController();
    const stateStr = JSON.stringify(uiPreferencesPayload());
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await fetch(API_BASE + '/state', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: stateStr,
                signal: _saveAbortCtrl.signal,
                keepalive: stateStr.length < 60_000 // للمساعدة عند إغلاق الصفحة
            });
            if (response.ok) {return true;}
            let message = 'فشل حفظ البيانات في قاعدة البيانات';
            try {
                const data = await response.json();
                const m = serverMessage(data, null);
                if (m) {message = m;}
            } catch (e) {}
            // خطأ 4xx: لا نُعيد المحاولة
            if (response.status >= 400 && response.status < 500) {
                throw new Error(message);
            }
            throw new Error(message);
        } catch (e) {
            if (e.name === 'AbortError') {return false;} // تم إلغاؤه لصالح طلب أحدث
            if (attempt === maxAttempts) {
                console.error('Save error (final):', e);
                if(window.toast) {toast('تعذر الحفظ — ستتم المحاولة تلقائياً', 'error');}
                return false;
            }
            // Exponential backoff: 300ms → 800ms → 2s
            await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt - 1)));
        }
    }
    return false;
}

async function _flushSave() {
    if (_saveInFlight) {
        // هناك حفظ جارٍ — علّم أن هناك تغييرات جديدة، وسنعيد المحاولة بعد الانتهاء
        _savePending = true;
        return _saveInFlight;
    }
    _saveInFlight = (async () => {
        try {
            do {
                _savePending = false;
                await _doSaveOnce();
            } while (_savePending);
        } finally {
            _saveInFlight = null;
        }
    })();
    return _saveInFlight;
}

async function saveData(immediate = false) {
    if (immediate) {
        if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
        return _flushSave();
    }
    // Debounce: امنع طوفان الطلبات عند النقرات المتتالية
    if (_saveTimer) {clearTimeout(_saveTimer);}
    return new Promise((resolve) => {
        _saveTimer = setTimeout(() => {
            _saveTimer = null;
            _flushSave().then(resolve);
        }, _SAVE_DEBOUNCE_MS);
    });
}

// حفظ فوري عند إغلاق الصفحة (يستفيد من keepalive في _doSaveOnce)
window.addEventListener('beforeunload', () => {
    if (_saveTimer || _saveInFlight || _savePending) {
        try {
            navigator.sendBeacon &&
              navigator.sendBeacon(API_BASE + '/state',
                new Blob([JSON.stringify(uiPreferencesPayload())], {type:'application/json'}));
        } catch(_){}
    }
});
async function loadData() {
    // Only UI/session-level preferences still come from the single-row blob
    // (kept for backward compatibility with the classic /api/state route).
    try {
        const legacy = await fetch(API_BASE + '/state');
        if (legacy.ok) {
            const data = await legacy.json();
            // لغة الجهاز المحفوظة تتفوق على القيمة المشتركة في الخادم
            const localLang = readLangLocal();
            if (localLang) { STATE.lang = localLang; }
            else if (data) {
                if (data.lang) {STATE.lang = data.lang;}
            }
            if (data) {
                if (data.theme) {STATE.theme = data.theme;}
            }
        }
    } catch (e) { /* non-fatal — settings table below is authoritative anyway */ }

    // Settings: real row in the `settings` table (id = 'main_settings').
    try {
        const s = await apiFetch('/settings/main_settings');
        if (s) {STATE.settings = s;}
    } catch (e) {
        console.warn('Could not load settings from DB, using defaults:', e.message);
    }

    // Every business entity now comes directly from its own PostgreSQL
    // table via the authenticated REST API — this is the real source of
    // truth (see PERSISTED_ENTITIES above).
    const bootExclusions = ROLE_ENTITY_EXCLUSIONS[STATE.currentUser?.role] || [];
    const bootEntities = PERSISTED_ENTITIES.filter(e => !bootExclusions.includes(e));
    const nonAttendance = bootEntities.filter(e => e !== 'attendance');
    const results = await Promise.allSettled(nonAttendance.map(e => apiList(e)));
    let anyLoaded = false;
    nonAttendance.forEach((entity, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            STATE[entity] = entity === 'recipes'
                ? r.value.map(recipe => ({
                    ...recipe,
                    sellingPrice: Number(recipe.sellingPrice || 0),
                    totalCost: Number(recipe.totalCost || 0),
                    costRatio: Number(recipe.costRatio || 0),
                }))
                : r.value;
            anyLoaded = true;
        } else {
            console.error(`<i class=ji data-i=alert-triangle></i> Failed to load "${entity}" from PostgreSQL:`, r.reason?.message || r.reason);
        }
    });
    // Attendance: load from month start (old history was purged on owner request)
    try {
        const d1 = new Date(); d1.setDate(1);
        const attFrom = STATE.attFrom || d1.toISOString().slice(0, 10);
        const attTo = STATE.attTo || today();
        const attRes = await apiFetch(`/attendance/range?from=${attFrom}&to=${attTo}&limit=30000`);
        STATE.attendance = Array.isArray(attRes?.data) ? attRes.data : [];
        anyLoaded = true;
    } catch (e) {
        console.warn('Could not load attendance range:', e.message);
        try { STATE.attendance = await apiList('attendance'); } catch (_) { STATE.attendance = []; }
    }
    try {
        const catalog = await apiFetch('/pos/recipes/catalog');
        STATE.recipeCatalog = Object.fromEntries((Array.isArray(catalog) ? catalog : []).map(row => [String(row.recipe_id), row]));
    } catch (e) {
        console.warn('Could not load recipe catalog:', e.message);
    }
    try { STATE.kitchenOps = await apiFetch('/kitchen/overview'); } catch (e) { console.warn('Could not load kitchen overview:', e.message); }
    await refreshProcurementData();
    return anyLoaded;
}
// Production mode: no client-side seed data. All business entities are loaded from PostgreSQL above.

// عنقود البطاقة الذكية + تقارير الحضور المطبوعة: نُقل إلى js/features/smart-card.js (يجسر عبر js/main.js — BRIDGE-008)
// عنقود الاستيراد الجماعي: نُقل إلى js/features/bulk-import.js (يجسر عبر js/main.js — BRIDGE-009)
// ============================================
// AUTH & NAVIGATION
// ============================================
async function completeRequiredPasswordChange(accessToken, currentPassword){
  const nextPassword = window.prompt('لأمان النظام، يجب تغيير كلمة المرور الأولية الآن. أدخل كلمة مرور جديدة من 12 حرفًا على الأقل وتحتوي على حروف وأرقام:');
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

// ─── استعادة كلمة المرور الذاتية (رمز لمرة واحدة يصدره المدير) ──────────────
function showForgotPasswordModal(){
showModal(`<h3><i class=ji data-i=key></i> استعادة كلمة المرور</h3><div class="workflow-banner">نسيت كلمة المرور؟ أدخل اسم المستخدم، ثم اطلب من المدير توليد <strong>رمز استعادة من 6 أرقام</strong> (صالح 10 دقائق)، وأدخل الرمز مع كلمة المرور الجديدة.</div><div class="fr"><div class="fg"><label>اسم المستخدم</label><input type="text" id="fpUsername" autocomplete="username" autocapitalize="none" spellcheck="false"></div><div class="fg"><label>رمز الاستعادة (6 أرقام)</label><input type="text" id="fpCode" inputmode="numeric" maxlength="6" placeholder="______"></div></div><div class="fr"><div class="fg"><label>كلمة المرور الجديدة <small>(12 حرفًا على الأقل مع حروف وأرقام)</small></label><input type="password" id="fpNew"></div><div class="fg"><label>تأكيد كلمة المرور الجديدة</label><input type="password" id="fpNew2"></div></div><div id="fpError" class="form-error" style="display:none" role="alert"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitForgotPassword()"><i class=ji data-i=key></i> تغيير كلمة المرور</button></div>`);
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
}catch(e){ fpFail('تعذر الاتصال بالخادم — حاول مرة أخرى'); }
}
async function issueResetCode(userId){
const u=STATE.users.find(x=>String(x.id)===String(userId));
if(!u) {return;}
try{
const r=await fetch(API_BASE+'/auth/forgot-password/request-code',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json',...(window._jwt?{Authorization:'Bearer '+window._jwt}:{})},body:JSON.stringify({username:u.username})});
const data=await r.json().catch(()=>({}));
if(!r.ok){ toast(serverMessage(data, 'تعذر إصدار رمز الاستعادة'),'error'); return; }
showModal(`<h3><i class=ji data-i=key></i> رمز استعادة لكلمة المرور</h3><div class="workflow-banner">أعطِ هذا الرمز للموظف <strong>${esc(data.user_name||u.name)}</strong> (@${esc(data.username)}) ليغيّر كلمة مروره بنفسه من شاشة الدخول عبر زر «نسيت كلمة المرور؟».</div><div style="text-align:center;margin:18px 0"><div class="mono" style="font-size:40px;letter-spacing:10px;font-weight:bold;color:var(--gold,#c9a227)">${esc(data.code)}</div><small class="text-muted">صالح 10 دقائق · استخدام واحد فقط · إصدار رمز جديد يُبطل هذا الرمز</small></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button><button class="btn btn-gold" onclick="copyResetCode('${esc(data.code)}')"><i class=ji data-i=copy></i> نسخ الرمز</button></div>`);
}catch(e){ toast('تعذر الاتصال بالخادم','error'); }
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
loadData().then(()=>{
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
STATE.deptPanel = null;
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
const NAV_GROUPS = [
 {id:'main', title:'nav.grp.main', keys:['dashboard']},
 {id:'finance', title:'nav.grp.finance', keys:['cfo','revenues','expenses','cost-analysis','pnl']},
 {id:'ops', title:'nav.grp.ops', keys:['departments','warehouse','shelves','weight','kitchen','dispatch','recipes','procurement']},
 {id:'hr', title:'nav.grp.hr', keys:['hr-dashboard','employees','leaves','attendance','zkteco','payroll','hr-departments','employee-portal']},
 {id:'sys', title:'nav.grp.sys', keys:['reports','settings','users','yarasoft','oracle-data','whatsapp','query','professional']},
];
function buildNav(){
applyI18nMaps();
try{ applyLangAttrs(); }catch(_){}
const container = document.getElementById('navContainer');
const role = ROLES[STATE.currentUser?.role];
const allowedMenus = role?role.menus:[];
const itemHtml = (key, name) => {
let badge = '';
if(key==='dispatch'){ // شارة الصرف: عدد الطلبات التي تنتظر إجراء من هذا الدور تحديدًا
const r=STATE.currentUser?.role; const myDept=STATE.currentUser?.dept_code;
const actionable=STATE.dispatches.filter(d=>{
  if(r==='dept_head') {return d.deptCode===myDept && ['pending','chef_approved'].includes(d.status);}
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
    if(!allowedMenus.includes(key) || !(key in ALL_PERMISSIONS.menus)) {continue;}
    items += itemHtml(key, ALL_PERMISSIONS.menus[key]);
    emitted.add(key);
  }
  if(items) {html += `<div class="nav-section">${t(g.title)}</div>${items}`;}
}
// Safety net: any allowed menu not covered above renders under the main header
for(const [key,name] of Object.entries(ALL_PERMISSIONS.menus)){
  if(allowedMenus.includes(key) && !emitted.has(key)){
    if(!html.includes('nav-fallback')) {html += `<div class="nav-section nav-fallback">${t('nav.main')}</div>`;}
    html += itemHtml(key, name);
  }
}
container.innerHTML = html;
}
function go(page,el){
const role = ROLES[STATE.currentUser?.role];
if(!role || !role.menus.includes(page)){ toast('لا تملك صلاحية الوصول','error'); return; }
STATE.page = page; destroyCharts();
document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
if(el) {el.classList.add('active');}
const titles = {dashboard:t('pg.dashboard'),cfo:t('pg.cfo'),revenues:t('pg.revenues'),expenses:t('pg.expenses'),'cost-analysis':t('pg.cost-analysis'),pnl:t('pg.pnl'),departments:t('pg.departments'),warehouse:t('pg.warehouse'),procurement:t('pg.procurement'),shelves:t('pg.shelves'),weight:t('pg.weight'),dispatch:t('pg.dispatch'),kitchen:t('pg.kitchen'),recipes:t('pg.recipes'),reports:t('pg.reports'),settings:t('pg.settings'),users:t('pg.users'),'hr-dashboard':t('pg.hr-dashboard'),employees:t('pg.employees'),leaves:t('pg.leaves'),attendance:t('pg.attendance'),zkteco:t('pg.zkteco'),yarasoft:t('pg.yarasoft'),'oracle-data':t('pg.oracle-data'),'whatsapp':t('pg.whatsapp'),'employee-portal':t('pg.employee-portal'),'hr-departments':t('pg.hr-departments'),payroll:t('pg.payroll')};
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
function toggleLang(){ STATE.lang = STATE.lang==='ar'?'en':'ar'; persistLangLocal(); if(['admin','manager'].includes(STATE.currentUser?.role)) {saveData();} applyLangAttrs(); buildNav(); renderPage(); }
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
const materials=sum(rows.filter(isStockMovementExpense));
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
function checkMenuAccessLocal(menuKey){ if(!STATE.currentUser) {return false;} const role=ROLES[STATE.currentUser.role]; return role?role.menus.includes(menuKey):false; }
// ============================================
// DASHBOARD
// ============================================
const dashboardChartDays = 30;
const dashboardChartDept = 'all';
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
 return `<section class="dashboard-analytics" style="margin-top:30px"><div class="section-header"><div><div class="section-title"><i class=ji data-i=chart></i> التحليلات التفاعلية</div><div class="text-muted" style="font-size:12px;margin-top:4px">بيانات مباشرة من النظام — اضغط على عناصر الرسم للتفاصيل</div></div><div style="display:flex;gap:8px;flex-wrap:wrap"><select id="dashboardChartDays" class="form-control" onchange="dashboardChartDays=this.value;renderPage()"><option value="7" ${dashboardChartDays==='7'?'selected':''}>آخر 7 أيام</option><option value="30" ${String(dashboardChartDays)==='30'?'selected':''}>آخر 30 يومًا</option><option value="90" ${String(dashboardChartDays)==='90'?'selected':''}>آخر 90 يومًا</option><option value="all" ${dashboardChartDays==='all'?'selected':''}>كل الفترة</option></select><select id="dashboardChartDept" class="form-control" onchange="dashboardChartDept=this.value;renderPage()"><option value="all">كل الأقسام</option>${deptOptions}</select></div></div><div class="dashboard-chart-grid"><div class="mcard chart-panel"><div class="chart-panel-title">الإيرادات والمصروفات حسب القسم</div><div class="chart-canvas-wrap"><canvas id="dashboardDeptChart"></canvas></div></div><div class="mcard chart-panel"><div class="chart-panel-title">اتجاه الإيرادات والنتيجة</div><div class="chart-canvas-wrap"><canvas id="dashboardTrendChart"></canvas></div></div><div class="mcard chart-panel"><div class="chart-panel-title">توزيع المصروفات التشغيلية</div><div class="chart-canvas-wrap chart-doughnut"><canvas id="dashboardExpenseChart"></canvas></div></div></div></section>`;
}
function initDashboardCharts(){
 if(STATE.page!=='dashboard'||typeof Chart==='undefined') {return;}
 // لوحات بلا رسوم بيانية (لوحة رئيس القسم مثلًا) — لا تنشئ رسمًا على كانفس غير موجود
 if(!document.getElementById('dashboardDeptChart')) {return;}
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
const unlinked=t.unlinkedEmployees?` · <b style="color:var(--orange)">${fN(t.unlinkedEmployees)} موظف غير مربوط</b>`:' · كل الموظفين مربوطون ✓';
el.innerHTML=`
<div class="mini-chart-header"><div><div class="u-sub-strong">بصمة الحضور — علامة الربط</div></div><div class="kpi-chip"><i class=ji data-i=user-check></i></div></div>
<div style="font-size:17px;font-weight:800;color:${stateCls};display:flex;align-items:center;gap:8px">${dot} ${stateTxt}</div>
<div class="u-sub">أجهزة متصلة: ${fN(online)}/${fN(devices.length)} · موظفون مربوطون: ${fN(t.linkedEmployees||0)}${unlinked}</div>`;
}catch(e){
el.innerHTML=`<div class="mini-chart-header"><div><div class="u-sub-strong">بصمة الحضور — علامة الربط</div></div><div class="kpi-chip"><i class=ji data-i=user-check></i></div></div><div class="u-sub" style="color:var(--orange)">تعذر جلب حالة البصمة — راجع صفحة بصمة الحضور</div>`;
}
}
function renderDashboard(){
const role = STATE.currentUser?.role;
if(role==='employee'){ return renderEmployeeDashboard(); }
if(role==='dept_head'){ return renderDeptHeadDashboard(); }
let totalRev=0,totalExp=0;
const deptStats = STATE.departments.map(d=>{const s=calcStats(d.code);totalRev+=s.rev;totalExp+=s.exp;return{...d,...s};});
const profit = totalRev-totalExp;
const costRatio = totalRev>0?(totalExp/totalRev*100):0;
const pendingDisp = STATE.dispatches.filter(d=>d.status==='pending').length;
const lowStock = STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty)).length;
const today = new Date();
const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
const monthlyRev = STATE.revenues.filter(r=>new Date(r.date)>=startOfMonth).reduce((s,r)=>s+Number(r.amount||0),0);
const monthlyExp = STATE.expenses.filter(e=>new Date(e.date)>=startOfMonth && Number(e.amount||0)>0).reduce((s,e)=>s+Number(e.amount||0),0);
const profitTrend = totalRev>0 ? Math.round(((profit/totalRev)*100)*10)/10 : 0;

let html = '';

html += renderExpiryAlertBanner();

// ── Financial KPIs — fixed 4-column rhythm, neutral chips, semantic color only ──
if(role!=='hr'){
html += `
<div class="stats-grid-premium kpi-grid-4">
  <div class="metric-card-premium" onclick="go('revenues')" data-tooltip="اضغط لعرض الإيرادات" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiRev')}">
    <div class="kpi-top"><span class="kpi-label">${t('db.kpiRev')}</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div>
    <div class="value">${fC(totalRev)}</div>
    <div class="trend"><i class=ji data-i=calendar></i> ${t('db.thisMonth')}: ${fC(monthlyRev)}</div>
  </div>
  <div class="metric-card-premium" onclick="go('expenses')" data-tooltip="اضغط لعرض المصاريف" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiExp')}">
    <div class="kpi-top"><span class="kpi-label">${t('db.kpiExp')}</span><span class="kpi-chip"><i class=ji data-i=wallet></i></span></div>
    <div class="value">${fC(totalExp)}</div>
    <div class="trend"><i class=ji data-i=calendar></i> ${t('db.thisMonth')}: ${fC(monthlyExp)}</div>
  </div>
  <div class="metric-card-premium" onclick="go('pnl')" data-tooltip="اضغط لعرض قائمة الأرباح والخسائر" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiProfit')}">
    <div class="kpi-top"><span class="kpi-label">${t('db.kpiProfit')}</span><span class="kpi-chip"><i class=ji data-i=gem></i></span></div>
    <div class="value ${profit<0?'c-red':''}">${fC(profit)}</div>
    <div class="trend ${profitTrend>=0?'trend-up':'trend-down'}">${profitTrend>=0?'<i class=ji data-i=trending-up></i>':'<i class=ji data-i=trending-down></i>'} ${t('db.margin')} ${fN(profitTrend)}%</div>
  </div>
  <div class="metric-card-premium" onclick="go('cost-analysis')" data-tooltip="اضغط لعرض تحليل التكاليف" role="button" tabindex="0" data-kb-activate aria-label="${t('db.kpiCost')}">
    <div class="kpi-top"><span class="kpi-label">${t('db.kpiCost')}</span><span class="kpi-chip"><i class=ji data-i=chart></i></span></div>
    <div class="value">${fN(costRatio.toFixed(1))}%</div>
    <div class="progress-premium ${costRatio<=65?'is-ok':costRatio<=85?'is-warn':'is-bad'}" style="margin-top:10px"><div class="progress-premium-bar" style="width:${Math.min(costRatio,100)}%"></div></div>
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
  <div class="mini-chart-card" onclick="go('employees')" role="button" tabindex="0" data-kb-activate aria-label="${t('db.totalEmp')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.totalEmp')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=users></i></div>
    </div>
    <div class="u-panel-title">${fN(totalEmp)}</div>
    <div class="u-sub">${t('db.activeInSys')}</div>
  </div>
  <div class="mini-chart-card" onclick="go('attendance')" role="button" tabindex="0" data-kb-activate aria-label="${t('db.presentToday')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.presentToday')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=circle-check></i></div>
    </div>
    <div class="u-panel-title">${fN(presentToday)}</div>
    <div class="u-sub">${t('db.ofTotal')} ${fN(totalEmp)} ${t('db.emp')}</div>
  </div>
  <div class="mini-chart-card" onclick="go('leaves')" role="button" tabindex="0" data-kb-activate aria-label="${t('db.pendingLeaves')}">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">${t('db.pendingLeaves')}</div></div>
      <div class="kpi-chip"><i class=ji data-i=hourglass></i></div>
    </div>
    <div style="font-size:22px;font-weight:700;color:${pendingLeaves>0?'var(--orange)':'var(--text)'}">${fN(pendingLeaves)}</div>
    <div class="u-sub">${t('db.pendingApproval')}</div>
  </div>
  <div class="mini-chart-card" onclick="go('payroll')" role="button" tabindex="0" data-kb-activate aria-label="إجمالي الرواتب">
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
  <div class="mini-chart-card" onclick="go('dispatch')" role="button" tabindex="0" data-kb-activate aria-label="طلبات صرف">
    <div class="mini-chart-header">
      <div><div class="u-sub-strong">طلبات صرف</div></div>
      <div class="kpi-chip"><i class=ji data-i=clipboard-list></i></div>
    </div>
    <div style="font-size:22px;font-weight:700;color:${pendingDisp>0?'var(--orange)':'var(--text)'}">${fN(pendingDisp)}</div>
    <div class="u-sub">${pendingDisp>0?'<i class=ji data-i=hourglass></i> معلق':'<i class=ji data-i=circle-check></i> لا يوجد'}</div>
  </div>
  <div class="mini-chart-card" onclick="go('warehouse')" role="button" tabindex="0" data-kb-activate aria-label="مخزون منخفض">
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
html += `<div id="zkDashStatus" class="mini-chart-card" style="margin-top:14px;cursor:pointer;min-height:110px" onclick="go('zkteco')" data-tooltip="اضغط لفتح صفحة بصمة الحضور" role="button" tabindex="0" data-kb-activate aria-label="حالة بصمة الحضور"><div class="spinner"></div></div>`;
setTimeout(loadZkDashboardStatus, 60);
}
// ─── موجز المدير (لوحة التحكم) ───
async function mgrBriefLoad(){
const box=document.getElementById('mgrBriefBox'); if(!box) {return;}
try{
const b=await apiFetch('/manager/briefing');
const cashRows=(b.cashiers||[]).map(c=>`<tr><td class="fw-bold">${esc(c.name)}</td><td>${fN(c.invoices)}</td><td class="c-green">${fC(c.total)}</td></tr>`).join('');
const outRows=(b.stockOut||[]).slice(0,5).map(s=>`<tr><td>${esc(s.name)}</td><td class="c-red">نافذ</td></tr>`).join('');
const fcRows=(b.forecast||[]).slice(0,5).map(s=>`<tr><td>${esc(s.name)}</td><td class="c-gold">${fN(s.days_cover)} يوم</td></tr>`).join('');
const p=b.pending||{};
box.innerHTML=`<div class="tbl-hd"><h3><i class=ji data-i=briefcase></i> موجز المدير — ${esc(b.day||'')} (مباشر)</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="mgrBriefLoad()"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" onclick="go('reports')"><i class=ji data-i=chart></i> التقارير</button></div></div>
<div style="padding:16px 20px">
<div class="stats-grid-premium kpi-grid-4" style="margin-bottom:12px">
<div class="metric-card-premium" onclick="go('revenues')"><div class="kpi-top"><span class="kpi-label">مبيعات الكاشيرية</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(b.cashiersTotal?.total||0)}</div><div class="trend">${fN(b.cashiersTotal?.invoices||0)} فاتورة اليوم${(b.cashiersY&&Number(b.cashiersY.total)>0)?` — أمس ${fC(b.cashiersY.total)}`:''}</div></div>
<div class="metric-card-premium" onclick="go('expenses')"><div class="kpi-top"><span class="kpi-label">مصاريف اليوم</span><span class="kpi-chip"><i class=ji data-i=wallet></i></span></div><div class="value">${fC(b.expenses?.total||0)}</div><div class="trend">${fN(b.expenses?.count||0)} عملية</div></div>
<div class="metric-card-premium" onclick="go('warehouse')"><div class="kpi-top"><span class="kpi-label">نواقص المخزن</span><span class="kpi-chip"><i class=ji data-i=alert-triangle></i></span></div><div class="value">${fN((b.stockOut||[]).length+(b.stockLow||[]).length)}</div><div class="trend">نافذ ${(b.stockOut||[]).length} • سينفد ${(b.forecast||[]).length}</div></div>
<div class="metric-card-premium" onclick="go('attendance')"><div class="kpi-top"><span class="kpi-label">الحضور</span><span class="kpi-chip"><i class=ji data-i=timer></i></span></div><div class="value">${fN(b.attendance?.checked_in||0)}</div><div class="trend">نسي خروج ${fN(b.attendance?.missing_out||0)} • نسي دخول ${fN(b.attendance?.missing_in||0)}</div></div>
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
html += `<div class="tbl-wrap" style="margin-top:14px" id="mgrBriefBox"><div class="tbl-hd"><h3><i class=ji data-i=briefcase></i> موجز المدير — اليوم مباشرة من السستم</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="mgrBriefLoad()"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" onclick="go('reports')"><i class=ji data-i=chart></i> التقارير</button></div></div><div style="padding:16px 20px"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>`;
setTimeout(mgrBriefLoad, 120);
}

// <i class=ji data-i=building></i> Department Performance
if(role==='admin'||role==='manager'){
html += `
<div class="section-header" style="margin-top:30px">
  <div class="section-title"><i class=ji data-i=building></i> أداء الأقسام</div>
  <button class="btn btn-gold btn-sm" onclick="go('cost-analysis')"><i class=ji data-i=chart></i> تحليل مفصل <i class=ji data-i=arrow-left></i></button>
</div>
<div class="dept-grid">`;
html += deptStats.map((d)=>{
  const efficiency = d.rev>0 ? Math.min(100, Math.max(0, 100 - d.costRatio)) : 0;
  return `<div class="dept-card" onclick="go('departments')">
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
  <button class="btn btn-gold" onclick="showAddRevenueModal()"><i class=ji data-i=plus></i> إيراد</button>
  <button class="btn" onclick="showAddExpenseModal()"><i class=ji data-i=wallet></i> مصروف</button>
  <button class="btn" onclick="showDispatchRequestModal()"><i class=ji data-i=package></i> طلب صرف</button>
  <button class="btn" onclick="generateReport();go('reports')"><i class=ji data-i=chart></i> تقرير</button>
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
<div class="quick-actions">
<button class="quick-action-btn" onclick="go('leaves')"><i class=ji data-i=calendar></i> طلب إجازة</button>
<button class="quick-action-btn" onclick="go('attendance')"><i class=ji data-i=timer></i> سجل الحضور</button>
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
const h = (new Date(`2000-01-01 ${a.checkOut}`) - new Date(`2000-01-01 ${a.checkIn}`))/3600000;
return sum + h;
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
const krm = a.checkIn&&a.checkOut?((new Date(`2000-01-01 ${a.checkOut}`)-new Date(`2000-01-01 ${a.checkIn}`))/3600000).toFixed(1):'—';
const src = a.source==='device'?'<span class="badge bdg-blue"><i class=ji data-i=user-check></i> بصمة</span>':a.source==='qr'?'<span class="badge bdg-green">QR</span>':'<span class="badge bdg-gray">يدوي</span>';
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
// عنقود البصمة (ZKTECO): نُقل إلى js/features/zkteco.js (يجسر عبر js/main.js — BRIDGE-010)
// عنقود استيراد يارسوفت: نُقل إلى js/features/yarasoft.js (يجسر عبر js/main.js — BRIDGE-016)
// ============================================
// ORACLE DATA BROWSER PAGE
// ============================================
const ORADATA = { tables: [], selected: null, data: null, page: 1, search: '' };
// عنقود محرك واتساب: نُقل إلى js/features/whatsapp.js (يجسر عبر js/main.js — BRIDGE-017)
// ============================================
// DEPARTMENTS
// ============================================
const DEPARTMENT_ICON_OPTIONS=[['building','مبنى'],['store','متجر'],['chef-hat','مطبخ'],['package','مخزن'],['banknote','حسابات'],['users','موظفون'],['chart','تقارير'],['utensils','مطعم']];
function normalizeDepartmentIcon(value){const raw=String(value||'').trim();const match=raw.match(/data-i=["']?([a-z0-9-]+)/i);const key=match?match[1]:raw;return window.KARIM_ICONS&&KARIM_ICONS[key]?key:'building';}
function departmentIconOptions(selected){const key=normalizeDepartmentIcon(selected);return DEPARTMENT_ICON_OPTIONS.map(([value,label])=>`<option value="${value}" ${value===key?'selected':''}>${label}</option>`).join('');}
function deptIcon(d){ return ico(normalizeDepartmentIcon(d&&d.icon)); }
function deptIconMarkup(d){ return deptIcon(d); }
function renderDepartments(){
if(!checkMenuAccessLocal('departments')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
setTimeout(loadCashiersLive, 60);
if(window._cashLiveTimer) {clearInterval(window._cashLiveTimer);}
if(window._cashLiveAgoTimer) {clearInterval(window._cashLiveAgoTimer);}
window._cashLiveTimer = setInterval(()=>{ if(document.getElementById('cashLiveBoard')) {loadCashiersLive(true);} }, 30000);
window._cashLiveAgoTimer = setInterval(()=>{
const el=document.getElementById('cashLiveAgo');
if(el&&window._cashLiveAt){ const s=Math.max(0,Math.round((Date.now()-window._cashLiveAt)/1000)); el.textContent=`منذ ${s} ث`; }
const clk=document.getElementById('cashLiveClock');
if(clk){ try{ clk.textContent=new Intl.DateTimeFormat('ar-SA',{timeZone:'Asia/Riyadh',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true}).format(new Date()); }catch(_){} }
},1000);
return `<div id="cashLiveBoard"><div class="mcard"><div class="spinner"></div><div class="u-sub">جاري تحميل لوحة الكاشيرية الحية...</div></div></div><div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=building></i> ${t('dept.title')}</h3><button class="btn btn-gold" onclick="showAddDepartmentModal()"><i class=ji data-i=plus></i> ${t('dept.add')}</button></div><div class="dept-grid">${STATE.departments.filter(d=>!HIDDEN_DEPTS.includes(String(d.code))).map(d=>{const s=calcStats(d.code);const parent=STATE.departments.find(x=>x.code===d.parent_code);const kidCount=STATE.departments.filter(x=>x.parent_code===d.code).length;return `<div class="dept-card" onclick="openDepartmentDetail('${d.code}')"><div class="dept-hd"><span class="dept-ic">${deptIconMarkup(d)}</span><div class="dept-info"><div class="dept-name">${esc(d.name)}</div><div class="dept-code">${d.code}${parent?` · <span class="badge bdg-blue" title="مصروفات وإيرادات هذا القسم تُرحَّل إلى ${esc(parent.name)}">تابع: ${esc(parent.name)}</span>`:''}${kidCount?` · <span class="badge bdg-green" title="يشمل ${kidCount} قسم فرعي">+${kidCount} فرعي</span>`:''}</div></div><div class="dept-badge">${t('dept.cost')} ${fN(s.costRatio.toFixed(1))}%</div></div><div class="dept-stats"><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=banknote></i> ${t('dept.revenue')}</div><div class="dstat-val c-gold">${fC(s.rev)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=wallet></i> ${t('dept.expense')}</div><div class="dstat-val c-red">${fC(s.exp)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=gem></i> ${t('dept.profit')}</div><div class="dstat-val ${s.profit>=0?'c-green':'c-red'}">${fC(s.profit)}</div></div></div><div class="u-footer-sep"><button class="btn btn-sm u-flex1" onclick="event.stopPropagation();editDepartment('${d.code}')"><i class=ji data-i=pencil></i> ${t('dept.edit')}</button><button class="btn btn-red btn-sm u-flex1" onclick="event.stopPropagation();deleteDepartment('${d.code}')"><i class=ji data-i=trash></i> ${t('dept.delete')}</button></div></div>`;}).join('')}</div>`;
}
/* لوحة الكاشيرية الحية — يومية لايف من إيرادات يارا سوفت المباشرة + تنقل بالأيام */
const CASHIER_ICONS = { '1': 'receipt', '2': 'store', '4': 'shopping-cart', '5': 'ticket', '6': 'banknote', '9': 'utensils' };
const HIDDEN_CASHIERS = ['2']; /* كاشير خارج الحسابات — مخفي من اللوحة (بياناته محفوظة) */
const HIDDEN_DEPTS = ['ys_cc_2', 'kitchen', 'yarasoft_pos']; /* أقسام نظامية مخفية من الشبكة (بياناتها محفوظة): كاشير خارج الحسابات + المطبخ التشغيلي + احتياطي الفواتير */
let CASH_LIVE_DATE = '';
function cashTodayStr(){ try{ return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }catch(_){ return new Date().toISOString().slice(0,10); } }
function cashShiftDate(dateStr, delta){
try{ const t=new Date(dateStr+'T12:00:00Z').getTime()+delta*86400000; return new Date(t).toISOString().slice(0,10); }catch(_){ return dateStr; }
}
function cashTime(iso){
if(!iso) {return '—';}
try{ const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }catch(_){ return '—'; }
}
function cashNavDay(delta){
const base=CASH_LIVE_DATE||cashTodayStr();
let next=cashShiftDate(base, delta);
if(next>cashTodayStr()) {next=cashTodayStr();}
CASH_LIVE_DATE=(next===cashTodayStr())?'':next;
loadCashiersLive();
}
function cashPickDay(val){
if(!val) {return;}
CASH_LIVE_DATE=(val>=cashTodayStr())?'':val;
loadCashiersLive();
}
/* رسم أعمدة SVG خالص (بلا CDN — يعمل أوفلاين) */
function cashBarsSVG(hourly, w, h, color){
const vals=Array.isArray(hourly)?hourly.map(v=>Number(v)||0):[];
const peak=Math.max(1,...vals);
const n=vals.length||24;
const bw=w/n;
let rects='';
for(let i=0;i<n;i++){
const bh=Math.max(1.5,(vals[i]/peak)*(h-8));
const x=(i*bw+0.8).toFixed(1);
const y=(h-bh).toFixed(1);
const isPeak=vals[i]===peak&&peak>0;
rects+=`<rect x="${x}" y="${y}" width="${(bw-1.6).toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${isPeak?'var(--gold)':color}" opacity="${isPeak?1:0.75}" class="${isPeak?'cash-peak':'cash-bar'}" style="animation-delay:${(i*22)}ms"><title>${String(i).padStart(2,'0')}:00 — ${fC(vals[i])}</title></rect>`;
}
return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto;display:block" preserveAspectRatio="none">${rects}</svg>`;
}
async function loadCashiersLive(silent){
const box=document.getElementById('cashLiveBoard'); if(!box) {return;}
const scY=window.scrollY;
try{
const qs=CASH_LIVE_DATE?`?date=${encodeURIComponent(CASH_LIVE_DATE)}`:'';
const [d, t] = await Promise.all([
apiFetch('/yara-reports/cashiers-live'+qs),
apiFetch('/yara-reports/cashiers-today'+qs).catch(()=>null),
]);
window._cashLiveAt=Date.now();
// تخطي إعادة الرسم عند ثبات البيانات — يمنع قفز الصفحة أثناء التمرير لأسفل
try{
const sig=JSON.stringify([d?.day_total,d?.cashiers_total,(d?.cashiers||[]).map(c=>[c.cashier_no,c.today_invoices,c.today_total,c.last_at])]);
if(silent&&window._cashLiveSig===sig){ return; }
window._cashLiveSig=sig;
}catch(_){}
const day=d?.today||cashTodayStr();
const isToday=!CASH_LIVE_DATE;
const total=Number(d?.day_total?.total||t?.total?.net||0);
const list=(d?.cashiers||[]).filter(c=>!HIDDEN_CASHIERS.includes(String(c.cashier_no)));
const tByNo={}; (t?.cashiers||[]).forEach(c=>{ tByNo[String(c.no)]=c; });
const ranked=list.slice().sort((a,b)=>Number(b.today_total||0)-Number(a.today_total||0));
const medals=['🥇','🥈','🥉'];
const IDLE_MIN=45;
const idleMin=(iso)=>{ if(!iso) {return null;} const ms=Date.now()-new Date(iso).getTime(); return ms>=0?Math.floor(ms/60000):null; };
const idleTxt=(m)=>{ if(m===null) {return 'لا فواتير اليوم';} if(m<60) {return `خامل منذ ${m} د`;} const h=Math.floor(m/60); return `خامل منذ ${h} س ${m%60} د`; };
const cards=ranked.map((c,idx)=>{
const ccTotal=Number(d?.cashiers_total?.total||total);
const share=ccTotal>0?Math.min(100,(Number(c.today_total||0)/ccTotal)*100):0;
const isNew=c.delta_pct===null||c.delta_pct===undefined;
const up=!isNew&&Number(c.delta_pct)>=0;
const icon=CASHIER_ICONS[String(c.cashier_no)]||'receipt';
const best=idx===0&&Number(c.today_total||0)>0;
const live=tByNo[String(c.cashier_no)]||{};
const hourly=Array.isArray(live.hourly)?live.hourly:[];
const pay=live.pay||{};
const payTotal=Number(pay.cash||0)+Number(pay.span||0)+Number(pay.credit||0)+Number(pay.mobile||0);
const cashShare=payTotal>0?Math.round((Number(pay.cash||0)/payTotal)*100):0;
const idle=idleMin(c.last_at);
const isIdle=idle!==null&&idle>=IDLE_MIN&&Number(c.today_invoices||0)>0;
const prevT=window._cashPrevTot?window._cashPrevTot[String(c.cashier_no)]:undefined;
const justSold=prevT!==undefined&&Number(c.today_total||0)!==Number(prevT);
return `<div class="dept-card${justSold?' cash-new':''}" style="cursor:pointer;${best?'border:2px solid var(--gold);box-shadow:0 0 18px #f5b30133':''}${isIdle?';border:2px solid var(--red)':''}" onclick="openCashierLive('${esc(c.cashier_no)}')" title="اضغط لعرض أصناف وفواتير ${esc(c.name)} اليوم">
<div class="dept-hd"><span class="dept-ic"><i class=ji data-i=${icon}></i></span>
<div class="dept-info"><div class="dept-name">${idx<3?medals[idx]+' ':''}${esc(c.name)}</div>
<div class="dept-code">كاشير ${esc(c.cashier_no)} · ${fN(c.today_invoices)} فاتورة · حصة ${share.toFixed(0)}%${live.shift?` · وردية ${esc(live.shift)}`:''}</div></div>
<div class="dept-badge ${isNew?'c-gold':(up?'c-green':'c-red')}" title="مقابل إجمالي يوم أمس الكامل — ليست مقارنة عادلة أثناء اليوم">${isNew?'• جديد':`${up?'▲':'▼'} ${fN(Math.abs(Number(c.delta_pct)))}%`}</div></div>
${isIdle?`<div class="badge bdg-red" style="margin:4px 0">⚠ ${idleTxt(idle)} — راجع الكاشير</div>`:''}
<div class="dstat-val c-gold" style="font-size:26px;margin:6px 0">${fC(Number(c.today_total||0))}</div>
${cashBarsSVG(hourly,120,30,'var(--green)')}
<div class="u-footer-sep" style="font-size:12px"><span class="text-muted">متوسط الفاتورة: ${fC(Number(live.avg||0))}</span><span class="text-muted">نقدي ${cashShare}%</span></div>
<div style="height:9px;border-radius:99px;background:var(--bg3);overflow:hidden"><div style="height:100%;width:${share.toFixed(1)}%;border-radius:99px;background:linear-gradient(90deg,var(--gold),var(--green));transition:width .8s"></div></div>
<div class="u-footer-sep" style="font-size:12px"><span class="text-muted">أمس: ${fC(Number(c.yday_total||0))} (${fN(c.yday_invoices)} فاتورة)</span><span class="text-muted">آخر فاتورة: ${cashTime(c.last_at)}</span></div>
</div>`;}).join('');
const heroHourly=Array.isArray(t?.hourly)?t.hourly:[];
const heroInvoices=fN(d?.cashiers_total?.invoices||t?.total?.invoices||0);
const heroAvg=(Number(d?.cashiers_total?.invoices||0)>0)?Number(d.cashiers_total.total)/Number(d.cashiers_total.invoices):0;
const idleCount=ranked.filter(c=>{const m=idleMin(c.last_at);return m!==null&&m>=IDLE_MIN&&Number(c.today_invoices||0)>0;}).length;
const _hh=(Array.isArray(heroHourly)?heroHourly.map(v=>Number(v)||0):[]).filter(v=>v>0);
const _rate=_hh.length?_hh.reduce((s,v)=>s+v,0)/_hh.length:0;
let _nowH=12; try{_nowH=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Riyadh',hour:'numeric',hour12:false}).format(new Date()));}catch(_){}
const _proj=Math.round(Number(d?.cashiers_total?.total||0)+_rate*Math.max(0,23-_nowH));
box.innerHTML=`<div class="mcard" style="margin-bottom:14px;background:linear-gradient(135deg,var(--bg2),transparent)">
<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=zap></i> الكاشيرية لايف</h3>
<div class="u-row-wrap">
${isToday?'<span class="badge bdg-green"><span class="pulse-dot"></span> مباشر</span>':'<span class="badge bdg-blue">عرض تاريخي</span>'}
<span class="badge bdg-gold"><i class=ji data-i=clock></i> <span id="cashLiveClock">--:--</span></span>
<span class="u-faint" style="font-size:11px">آخر تحديث <span id="cashLiveAgo">الآن</span> · تلقائي كل 30 ث</span>
<button class="btn btn-sm" onclick="cashNavDay(-1)" title="اليوم السابق"><i class=ji data-i=arrow-left></i></button>
<input type="date" value="${esc(day)}" max="${esc(cashTodayStr())}" onchange="cashPickDay(this.value)" style="background:var(--bg3);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:5px 8px">
<button class="btn btn-sm" onclick="cashNavDay(1)" title="اليوم التالي" ${isToday?'disabled style="opacity:.4"':''}><i class=ji data-i=arrow-left style="transform:scaleX(-1)"></i></button>
${isToday?'':'<button class="btn btn-sm btn-gold" onclick="CASH_LIVE_DATE=\'\';loadCashiersLive()">اليوم</button>'}
<button class="btn btn-sm" onclick="loadCashiersLive()" title="تحديث الآن"><i class=ji data-i=refresh></i></button>
</div></div>
<div class="u-row-wrap" style="margin-top:10px">
<div class="report-summary-card" style="min-width:150px"><h4>مبيعات اليوم</h4><div class="value c-gold">${fC(Number(d?.cashiers_total?.total||0))}</div></div>
<div class="report-summary-card" style="min-width:120px"><h4>الفواتير</h4><div class="value c-blue">${heroInvoices}</div></div>
<div class="report-summary-card" style="min-width:130px"><h4>متوسط الفاتورة</h4><div class="value c-teal">${fC(heroAvg)}</div></div>
<div class="report-summary-card" style="min-width:120px"><h4>كل المصادر</h4><div class="value">${fC(total)}</div></div>
<div class="report-summary-card" style="min-width:130px"><h4>متوقع الإغلاق ≈</h4><div class="value c-gold" title="تقدير بإيقاع ساعات اليوم">${fC(_proj)}</div></div>
<div class="report-summary-card" style="min-width:120px"><h4>كاشيرية خاملة</h4><div class="value ${idleCount>0?'c-red':'c-green'}">${fN(idleCount)}</div></div>
</div>
<div class="report-section" style="margin-top:10px"><h3><i class=ji data-i=chart></i> نبض المبيعات اليوم (بالساعة — بتوقيت الرياض)</h3>${cashBarsSVG(heroHourly,480,90,'var(--green)')}<div class="u-row-between u-faint" style="font-size:11px"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div></div>
<div class="dept-grid" style="margin-top:10px">${cards||'<div class="text-muted">لا توجد كاشيرية مفعّلة</div>'}</div>
<div class="u-sub" style="margin-top:8px">اضغط أي بطاقة لعرض الأصناف والفواتير · تنقّل بالأسهم أو اختر أي يوم لعرض إيراده ومقارنته بسابقه</div></div>`;
window._cashPrevTot=Object.fromEntries(ranked.map(c=>[String(c.cashier_no),Number(c.today_total||0)]));
// استعادة التمرير بعد اكتمال التخطيط (فريم + مهلة للخطوط/الصور) — لا قفز مع الفواتير
try{
const keepY=scY;
const restore=()=>{ try{ if(Math.abs(window.scrollY-keepY)>2){ window.scrollTo(0,keepY); } }catch(_){} };
if(typeof requestAnimationFrame==='function'){ requestAnimationFrame(()=>requestAnimationFrame(restore)); }
else { restore(); }
setTimeout(restore,350);
}catch(_){}
}catch(e){ if(!silent){ box.innerHTML=`<div class="mcard u-empty">تعذر تحميل لوحة الكاشيرية: ${esc(e.message)}</div>`; } }
}
/* دريل داون الكاشير: أصنافه + فواتيره اليوم */
async function openCashierLive(no){
const day=CASH_LIVE_DATE||cashTodayStr();
showModal(`<h3><i class=ji data-i=zap></i> كاشير ${esc(no)} — ${esc(day)}</h3><div class="u-empty-sm"><div class="spinner"></div> جارٍ التحميل...</div>`);
try{
const [items, invs]=await Promise.all([
apiFetch(`/yara-reports/cashier-items?from=${day}&to=${day}&cashier=${encodeURIComponent(no)}&view=items`),
apiFetch(`/yara-reports/cashier-items?from=${day}&to=${day}&cashier=${encodeURIComponent(no)}&view=invoices&limit=10`),
]);
const top=(Array.isArray(items.rows)?items.rows:[]).slice(0,8);
const invRows=Array.isArray(invs.rows)?invs.rows:[];
const sum=items.totals||{};
showModal(`<h3><i class=ji data-i=zap></i> ${esc((items.cashiers&&items.cashiers[0]&&items.cashiers[0].name)||('كاشير '+no))} — ${esc(day)}</h3>
<div class="workflow-banner">الفواتير: <strong>${fN(sum.invoice_count||invs.total||0)}</strong> — الصافي: <strong>${fC(sum.net||0)}</strong></div>
<h4 style="margin:10px 0 6px"><i class=ji data-i=package></i> الأكثر مبيعًا اليوم</h4>
<table class="report-table"><thead><tr><th>الصنف</th><th>الكمية</th><th>متوسط السعر</th><th>الصافي</th></tr></thead><tbody>
${top.length?top.map(r=>`<tr><td><strong>${esc(r.item_name||'—')}</strong><br><small class="ltr-inline">${esc(r.item_code||'')}</small></td><td>${fN(r.qty||0)}</td><td class="amount-cell">${fC(r.avg_price||0)}</td><td class="amount-cell amount-gold"><strong>${fC(r.net||0)}</strong></td></tr>`).join(''):'<tr><td colspan="4" class="u-empty-sm">لا مبيعات اليوم بعد</td></tr>'}
</tbody></table>
<h4 style="margin:10px 0 6px"><i class=ji data-i=receipt></i> أحدث الفواتير</h4>
<table class="report-table"><thead><tr><th>الفاتورة</th><th>الصافي</th><th>الأصناف</th></tr></thead><tbody>
${invRows.length?invRows.map(r=>`<tr><td><a href="#" onclick="ysCashierInvoiceDetail('${esc(r.doc_no)}');return false;" class="mono"><strong>${esc(r.doc_no)}</strong></a></td><td class="amount-cell amount-gold">${fC(r.net||0)}</td><td>${fN(r.lines||0)}</td></tr>`).join(''):'<tr><td colspan="3" class="u-empty-sm">لا فواتير</td></tr>'}
</tbody></table>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button></div>`);
}catch(e){ showModal(`<h3>كاشير ${esc(no)}</h3><div class="u-empty-sm">تعذر التحميل: ${esc(e.message||e)}</div><div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button></div>`); }
}
function deptParentOptions(selected, exclude){
return `<option value="">— قسم رئيسي (بلا أب) —</option>` + (STATE.departments||[])
.filter(d=>d.code!==exclude)
.map(d=>`<option value="${esc(d.code)}" ${String(selected)===String(d.code)?'selected':''}>${esc(d.name)} (${esc(d.code)})</option>`).join('');
}
function showAddDepartmentModal(){
showModal(`<h3><i class=ji data-i=plus></i> إضافة قسم</h3><div class="fr"><div class="fg"><label>اسم القسم</label><input type="text" id="deptName"></div><div class="fg"><label>الكود (3 أحرف)</label><input type="text" id="deptCode" maxlength="3"></div></div><div class="fg"><label>أيقونة القسم</label><select id="deptIcon">${departmentIconOptions('building')}</select></div><div class="fg"><label>القسم الأب (اختياري — مصروف هذا القسم يُرحَّل إليه)</label><select id="deptParent">${deptParentOptions('', '')}</select></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addDepartment()"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function addDepartment(){
const code=document.getElementById('deptCode')?.value.trim().toUpperCase(),
name=document.getElementById('deptName')?.value.trim(),
icon=normalizeDepartmentIcon(document.getElementById('deptIcon')?.value);
if(!code||!name){ toast('أكمل جميع الحقول المطلوبة','error'); return; }
if(STATE.departments.find(d=>d.code===code)){ toast('الكود موجود بالفعل','error'); return; }
const colors=['#e91e63','#ff9800','#2ecc71','#795548','#009688','#673ab7','#d32f2f'];
const color=colors[STATE.departments.length%colors.length];
const parent_code=document.getElementById('deptParent')?.value||null;
try{
await persistCreate('departments', (saved)=>STATE.departments.push(saved), {id:uid(),code,name,icon,color,parent_code});
closeModal(); renderPage();
toast('تم إضافة القسم');
}catch(e){ toast(e.message||'فشل حفظ القسم في قاعدة البيانات','error'); }
}
function editDepartment(code){
const d=STATE.departments.find(x=>x.code===code);
if(!d){return;}
showModal(`<h3><i class=ji data-i=pencil></i> تعديل القسم</h3><div class="fg"><label>اسم القسم</label><input type="text" id="deptName" value="${esc(d.name)}"></div><div class="fg"><label>أيقونة القسم</label><select id="deptIcon">${departmentIconOptions(d.icon)}</select></div><div class="fg"><label>القسم الأب (اختياري — مصروف هذا القسم يُرحَّل إليه)</label><select id="deptParent">${deptParentOptions(d.parent_code||'', code)}</select></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="updateDepartment('${code}')"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function updateDepartment(code){
const d=STATE.departments.find(x=>x.code===code);
if(!d) {return;}
const name=document.getElementById('deptName')?.value.trim();
const icon=normalizeDepartmentIcon(document.getElementById('deptIcon')?.value);
const parent_code=document.getElementById('deptParent')?.value||null;
try{
const saved = await persistUpdate('departments', d.id, {name,icon,parent_code});
Object.assign(d, saved || {name,icon,parent_code});
closeModal(); renderPage();
toast('تم التحديث');
}catch(e){ toast(e.message||'فشل تحديث القسم في قاعدة البيانات','error'); }
}
async function deleteDepartment(code){
const d0=STATE.departments.find(x=>x.code===code);
const revN=d0?(STATE.revenues||[]).filter(r=>String(r.deptId)===String(code)).length:0;
const expN=d0?(STATE.expenses||[]).filter(e=>String(e.deptId)===String(code)).length:0;
if(!confirm(`تحذير: حذف القسم «${d0?d0.name:code}» سيحذف نهائيًا:\n• ${revN} سجل إيرادات\n• ${expN} سجل مصروفات\n(حذف مرتبط تلقائيًا من قاعدة البيانات ولا يمكن التراجع)\n\nاكتب «حذف» للتأكيد؟`)){return;}
const ack=prompt('للتأكيد النهائي، اكتب: حذف');
if(ack!=='حذف'){toast('أُلغي الحذف','info');return;}
const d=d0;
if(!d) {return;}
try{
// DB has ON DELETE CASCADE on revenues/expenses.deptId → departments.code,
// so PostgreSQL removes the related rows automatically; we just mirror
// that locally after confirmation from the server.
await persistRemove('departments', d.id);
STATE.departments=STATE.departments.filter(x=>x.code!==code);
STATE.revenues=STATE.revenues.filter(r=>r.deptId!==code);
STATE.expenses=STATE.expenses.filter(e=>e.deptId!==code);
renderPage();
toast('تم الحذف','warning');
}catch(e){ toast(e.message||'فشل الحذف من قاعدة البيانات','error'); }
}
function renderDepartmentDetail(){
const dept=STATE.departments.find(d=>d.code===STATE.dept);
if(!dept) {return '<div class="mcard">القسم غير موجود</div>';}
const from=deptDetailFrom||null,to=deptDetailTo||null;
const s=calcStats(dept.code,from,to);
const bd=deptExpenseBreakdown(dept.code,from,to);
const inRangeRows=rows=>rows.filter(r=>{const d=String(r.date||'').slice(0,10);if(from&&d<from){return false;}if(to&&d>to){return false;}return true;});
const deptCodes=deptWithChildren(dept.code);
const revs=inRangeRows(STATE.revenues.filter(r=>deptCodes.has(String(r.deptId)))).slice().reverse().slice(0,10);
const exps=bd.rows.slice().reverse().slice(0,10);
const periodChip=(from||to)?`<span class="badge bdg-blue"><i class=ji data-i=calendar-days></i> ${from?'من '+fD(from):'كل الفترة'} ${to?'إلى '+fD(to):''}</span>`:'';
return `<div style="background:var(--bg2);border-radius:var(--r2);padding:24px;margin-bottom:20px"><div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap"><span style="font-size:56px;background:${dept.color}20;padding:14px;border-radius:18px">${dept.icon}</span><div><div style="font-size:24px;font-weight:900">${esc(dept.name)}</div><div class="text-muted">${dept.code}</div></div><div class="dept-badge" style="font-size:13px;padding:8px 16px">نسبة التكلفة: ${fN(s.costRatio.toFixed(1))}%</div>${periodChip}</div><div class="fr u-mt12" style="align-items:end;max-width:520px"><div class="fg"><label><i class=ji data-i=calendar-days></i> من تاريخ</label><input type="date" id="deptDetailFromInput" value="${deptDetailFrom}" onchange="deptDetailFrom=this.value;renderPage()"></div><div class="fg"><label>إلى تاريخ</label><input type="date" id="deptDetailToInput" value="${deptDetailTo}" onchange="deptDetailTo=this.value;renderPage()"></div><button class="btn btn-sm" onclick="deptDetailFrom='';deptDetailTo='';renderPage()"><i class=ji data-i=rotate-ccw></i> كل الفترة</button></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> الإيرادات</div><div class="mcard-val c-gold">${fC(s.rev)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> التكلفة الإجمالية</div><div class="mcard-val c-red">${fC(s.exp)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=gem></i> صافي الربح</div><div class="mcard-val ${s.profit>=0?'c-green':'c-red'}">${fC(s.profit)}</div></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> صرف مخزون (صافي المرتجعات)</div><div class="mcard-val c-blue">${fC(bd.materials)}</div><small class="text-muted">كل ما صُرف للقسم من المخزن بقيمة المواد</small></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=clipboard-list></i> عجز / زيادة الجرد</div><div class="mcard-val ${bd.countAdj>0?'c-red':bd.countAdj<0?'c-green':''}">${fC(bd.countAdj)}</div><small class="text-muted">فروق الجرد على مخزن القسم — تُحمَّل على كلفته</small></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=pen-tool></i> مصروفات تشغيلية</div><div class="mcard-val c-orange">${fC(bd.operating)}</div><small class="text-muted">رواتب، تشغيل، مصروفات يدوية مسجلة على القسم</small></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=banknote></i> آخر الإيرادات</h3><button class="btn btn-green btn-sm" onclick="showAddRevenueModal('${dept.code}')"><i class=ji data-i=plus></i> إيراد</button></div><div class="tbl-scroll"><table><thead><tr><th>المصدر</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${revs.map(r=>`<tr><td class="fw-bold">${esc(r.source)}</td><td class="c-gold">${fC(r.amount)}</td><td class="text-muted">${fD(r.date)}</td></tr>`).join('')||'<tr><td colspan="3" class="u-empty-xs">لا توجد بيانات</td></tr>'}</tbody></table></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=wallet></i> آخر بنود التكلفة</h3><button class="btn btn-red btn-sm" onclick="showAddExpenseModal('${dept.code}')"><i class=ji data-i=plus></i> مصروف</button></div><div class="tbl-scroll"><table><thead><tr><th>البيان</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>${exps.map(e=>{const neg=Number(e.amount||0)<0;const stock=isStockMovementExpense(e);const cnt=isCountCorrectionExpense(e);const label=cnt?'<i class=ji data-i=clipboard-list></i> فرق جرد':stock?'<i class=ji data-i=package></i> صرف مخزون':'<i class=ji data-i=pen-tool></i> يدوي';const badgeCls=cnt?'bdg-blue':stock?'bdg-gold':'bdg-orange';return `<tr><td class="fw-bold">${esc(e.desc)}</td><td><span class="badge ${badgeCls}">${label}</span></td><td class="${neg?'c-green':'c-red'} fw-bold">${fC(e.amount)}</td><td class="text-muted">${fD(e.date)}</td></tr>`;}).join('')||'<tr><td colspan="4" class="u-empty-xs">لا توجد بيانات</td></tr>'}</tbody></table></div></div>`;
}
// عنقود الموارد البشرية (لوحة HR + الحضور + الإجازات + أقسام HR + الرواتب): نُقل إلى js/features/hr.js (يجسر عبر js/main.js — BRIDGE-015)
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
<select id="reportType" onchange="generateReport()">
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
<option value="yara-departments">إيرادات الأقسام من يارا (يومي/شهري/سنوي)</option>
<option value="yara-cashiers">مبيعات الكاشيرية من يارا (تفصيلي per كاشير)</option>
</select>
</div>
<div class="fg" id="deptSelectGroup" style="display:none">
<label>اختر القسم</label>
<select id="reportDeptSelect" onchange="generateReport()">
${STATE.departments.map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('')}
</select>
</div>
<div class="fg">
<label>الفترة الزمنية</label>
<select id="reportPeriod" onchange="updateDateInputs()">
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
<button class="btn btn-gold" onclick="generateReport()"><i class=ji data-i=refresh></i> تحديث</button>
<button class="btn btn-blue" onclick="printReportOnly()"><i class=ji data-i=printer></i> طباعة</button>
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
const reportTypeNames={general:'الشامل',department:'الأقسام المفصل',kitchen:'أداء المطبخ',returns:'المرتجعات',warehouse:'المخازن والمخزون',hr:'الموارد البشرية','dept-specific':'قسم محدد'};
let html=`
<div class="report-header">
<div class="report-logo">${logoMarkup('report-logo-image')}</div>
<h1>${STATE.settings.name}</h1>
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
html+=`<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=chart></i> تم إنشاء هذا التقرير بواسطة <strong>${STATE.settings.name}</strong></div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${fDT(new Date().toISOString())} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
container.innerHTML=html;
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
let tableHtml='';
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
<h1>${STATE.settings.name}</h1>
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
if(!raw.includes('[AUTO:POS]')){return raw;}
const invoice=(raw.match(/invoice=([^|]+)/)||[])[1]?.trim();
const cashier=(raw.match(/cashier=([^|]+)/)||[])[1]?.trim();
const items=(raw.match(/items=([^|]+)/)||[])[1]?.trim();
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
function generateDepartmentReport(startDate,endDate){
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
function generateWarehouseReport(startDate,endDate){
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
<h1>${STATE.settings.name}</h1>
<div class="subtitle">إيرادات الأقسام من يارا سوفت (${groupNames[group]})</div>
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
</tr>`).join(''):`<tr><td colspan="6" class="u-empty-sm">لا توجد إغلاقات يومية ضمن الفترة — شغّل التعبئة من صفحة استيراد Yarasoft</td></tr>`}
</tbody>
</table>
</div>
<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=chart></i> تم إنشاء هذا التقرير بواسطة <strong>${STATE.settings.name}</strong></div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${fDT(new Date().toISOString())} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
}catch(err){
console.error('Yara dept report error:',err);
container.innerHTML=`<div class="u-empty-sm">تعذر تحميل التقرير: ${esc(err.message||err)}</div>`;
}
}
// ─── مبيعات الكاشيرية من يارا سوفت (تفصيلي: كاشير × صنف / فواتير) ───
let YCASH={cashier:'',view:'items',page:1};
async function generateYaraCashiersReport(startDate,endDate,periodLabel,container){
try{
const params=new URLSearchParams({from:startDate,to:endDate,view:YCASH.view,limit:'100'});
if(YCASH.cashier){params.set('cashier',YCASH.cashier);}
if(YCASH.view==='invoices'){params.set('page',String(YCASH.page));}
const data=await apiFetch('/yara-reports/cashier-items?'+params.toString());
container.innerHTML=renderYaraCashiersHtml(data,startDate,endDate,periodLabel);
}catch(err){
console.error('Yara cashiers report error:',err);
container.innerHTML=`<div class="mcard" style="padding:24px;text-align:center"><div style="font-weight:800;margin-bottom:8px">تعذر تحميل تقرير الكاشيرية</div><div class="u-faint">${esc(err.message||'تحقق من اتصال قاعدة يارا سوفت')}</div></div>`;
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
let tableHtml='';
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
</tr>`).join(''):`<tr><td colspan="9" class="u-empty-sm">لا توجد أصناف مباعة ضمن الفترة — وسّع الفترة أو تحقق من سحب يارا</td></tr>`}
</tbody>
</table>
</div>`;
}else{
const pg=`<div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-top:10px" class="no-print">
<button class="btn btn-sm" ${data.page<=1?'disabled':''} onclick="YCASH.page=${(data.page||1)-1};generateReport()">السابق</button>
<span class="u-faint">صفحة ${fN(data.page||1)} من ${fN(data.pages||1)} — ${fN(data.total||0)} فاتورة</span>
<button class="btn btn-sm" ${data.page>=data.pages?'disabled':''} onclick="YCASH.page=${(data.page||1)+1};generateReport()">التالي</button>
</div>`;
tableHtml=`
<div class="report-section">
<h3><i class=ji data-i=receipt></i> فواتير الكاشيرية (الأحدث أولًا — اضغط رقم الفاتورة للتفصيل)</h3>
<table class="report-table">
<thead><tr><th>رقم الفاتورة</th><th>اليوم</th><th>الكاشير</th><th>الوردية</th><th>الأصناف</th><th>الإجمالي</th><th>الخصم</th><th>الصافي</th><th>المدفوع</th></tr></thead>
<tbody>
${rows.length?rows.map(r=>`<tr>
<td><a href="#" onclick="ysCashierInvoiceDetail('${esc(r.doc_no)}');return false;" class="mono"><strong>${esc(r.doc_no)}</strong></a></td>
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
<h1>${STATE.settings.name}</h1>
<div class="subtitle">مبيعات الكاشيرية من يارا سوفت — حي من قاعدة الكاشير</div>
<div class="meta">
<span><i class=ji data-i=calendar></i> الفترة: <strong>${periodLabel}</strong></span>
<span><i class=ji data-i=calendar-days></i> من: <strong>${fD(startDate)}</strong></span>
<span><i class=ji data-i=calendar-days></i> إلى: <strong>${fD(endDate)}</strong></span>
<span><i class=ji data-i=clock></i> تاريخ الإصدار: <strong>${generatedAt}</strong></span>
</div>
</div>
<div class="report-filter-bar no-print" style="margin-bottom:12px">
<div class="fg"><label>الكاشير</label><select id="yCashierSel" onchange="YCASH.cashier=this.value;YCASH.page=1;generateReport()">${cashierOpts}</select></div>
<div class="fg"><label>العرض</label><select id="yCashierView" onchange="YCASH.view=this.value;YCASH.page=1;generateReport()">
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
<div class="report-footer"><div style="margin-bottom:8px"><i class=ji data-i=shopping-cart></i> المصدر: قاعدة يارا سوفت Oracle مباشرة (CC_BILLS3 + CC_BILL_ENTER3) — الكاشير 2 الداخلي مستثنى</div><div><i class=ji data-i=calendar></i> تاريخ الإنشاء: ${generatedAt} | <i class=ji data-i=user></i> بواسطة: ${STATE.currentUser?.name||'النظام'}</div></div>`;
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
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button></div>`);
}catch(e){ toast(e.message||'تعذر جلب تفاصيل الفاتورة','error'); }
}
function printReportOnly(){
const reportContent=document.getElementById('reportContent');
if(!reportContent||!reportContent.innerHTML.trim()){ toast('يرجى إنشاء التقرير أولاً','warning'); return; }
const printWindow=window.open('','_blank');
const reportHTML=reportContent.innerHTML;
printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>تقرير - ${STATE.settings.name}</title><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700;800;900&family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Cairo','Tajawal',sans-serif;background:white;color:#000;direction:rtl;padding:10px;font-size:9pt;line-height:1.45}.report-header{text-align:center;padding:16px 12px;margin-bottom:14px;border-bottom:2px double #000}.report-header h1{font-size:18pt;color:#d4a843;margin-bottom:4px;font-weight:800}.report-header .subtitle{font-size:10pt;color:#333;margin-bottom:4px;font-weight:600}.report-header .meta{display:flex;justify-content:center;gap:10px;margin-top:8px;padding-top:8px;border-top:1px solid #ddd;font-size:8pt;color:#555;flex-wrap:wrap}.report-logo{width:44px;height:44px;margin:0 auto 8px;border-radius:10px;border:1px solid #d4a843;display:flex;align-items:center;justify-content:center;font-size:22px;overflow:hidden}.report-logo img{width:100%;height:100%;object-fit:cover}.report-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:14px}.report-summary-card{border:1px solid #ddd;border-radius:6px;padding:8px;text-align:center;border-top:2px solid #d4a843;break-inside:avoid}.report-summary-card h4{font-size:7.5pt;color:#555;text-transform:uppercase;margin-bottom:4px;font-weight:700}.report-summary-card .value{font-size:13pt;font-weight:800;color:#000}.report-section{margin:14px 0;break-inside:avoid}.report-section h3{font-size:11pt;font-weight:800;color:#d4a843;margin-bottom:7px;padding-bottom:4px;border-bottom:1px solid #d4a843}.report-table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:8.5pt;line-height:1.3}.report-table th{background:#f0f0f0;color:#000;font-weight:800;padding:5px 6px;text-align:right;border:1px solid #000;font-size:8pt}.report-table td{padding:5px 6px;border:1px solid #ddd;color:#000}.report-table tbody tr:nth-child(even){background:#f9f9f9}.report-table tfoot td{background:#e0e0e0;font-weight:800;color:#000;border:1px solid #000;padding:6px 8px;font-size:9pt}.report-footer{margin-top:12px;padding:8px;background:#f9f9f9;border-radius:6px;text-align:center;font-size:7.5pt;color:#555;border:1px solid #ddd}svg.ji,i.ji{width:14px!important;height:14px!important;display:inline-block;vertical-align:-0.2em;flex:none}.report-summary-card svg.ji,.report-section h3 svg.ji,.report-table th svg.ji,.report-table td svg.ji{width:12px!important;height:12px!important}.c-gold,.amount-gold{color:#d4a843!important}.c-red,.amount-red{color:#e74c3c!important}.c-green,.amount-green{color:#2ecc71!important}.c-orange{color:#f39c12!important}.c-blue{color:#3498db!important}.c-teal{color:#1abc9c!important}.badge{display:inline-block;padding:2px 8px;border-radius:15px;font-size:8pt;font-weight:700;border:1px solid}.bdg-green{background:rgba(46,204,113,0.1);color:#2ecc71;border-color:rgba(46,204,113,0.3)}.bdg-red{background:rgba(231,76,60,0.1);color:#e74c3c;border-color:rgba(231,76,60,0.3)}.fw-bold{font-weight:700}.print-controls{text-align:center;margin-bottom:20px;padding:15px;background:#f0f0f0;border-radius:8px}.print-controls button{padding:10px 25px;margin:0 10px;border:none;border-radius:6px;font-size:12pt;font-weight:700;cursor:pointer;font-family:'Cairo',sans-serif}.btn-print{background:#2ecc71;color:white}.btn-close{background:#e74c3c;color:white}@media print{@page{size:A4;margin:1cm}body{padding:0}.print-controls{display:none!important}}</style></head><body><div class="print-controls"><button class="btn-print" onclick="window.print()"><i class=ji data-i=printer></i> طباعة التقرير</button><button class="btn-close" onclick="window.close()"><i class=ji data-i=circle-x></i> إغلاق</button></div>${reportHTML}</body></html>`);
printWindow.document.close();
setTimeout(()=>{ printWindow.focus(); },500);
}
// ============================================
// SETTINGS
// ============================================
function renderSettings(){
if(!checkMenuAccessLocal('settings')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
// ZATCA hub loads itself into #zatcaHub once this template is painted
setTimeout(()=>{ if(document.getElementById('zatcaHub')) {loadZatcaHub();} }, 0);
// KOT settings load themselves into #kotSettingsBody the same way
setTimeout(()=>{ if(document.getElementById('kotSettingsBody')) {loadKotSettings();} }, 0);
// Card settings load themselves into #cardSettingsBody the same way
setTimeout(()=>{ if(document.getElementById('cardSettingsBody')) {loadCardSettings();} }, 0);
// Backup list loads itself into #sysBackupList (admin only)
setTimeout(()=>{ if(document.getElementById('sysBackupList') && STATE.currentUser?.role==='admin') {sysLoadBackups();} }, 0);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=store></i> ${t('set.restaurant')}</div><div class="mcard-val c-gold">${esc(STATE.settings.name)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('set.currency')}</div><div class="mcard-val c-gold">${STATE.settings.currency}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=image></i> ${t('set.logo')}</div><div class="mcard-val c-gold"><i class=ji data-i=circle-check></i> ${t('set.uploaded')}</div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=settings></i> ${t('set.title')}</h3></div>
<div style="padding:24px">
<div class="fg"><label>${t('set.name')}</label><input id="settingsName" value="${esc(STATE.settings.name)}"></div>
<div class="fg"><label>${t('set.curCode')}</label><input id="settingsCurrency" value="${STATE.settings.currency}" maxlength="3"></div>
<div class="fg">
<label><i class=ji data-i=image></i> ${t('set.logoSys')}</label>
<div style="display:flex;gap:12px;align-items:center;margin-top:8px">
<div id="logoPreview" style="width:80px;height:80px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid var(--border)">${logoMarkup('settings-logo-preview')}</div>
<div class="u-flex1">
<input type="file" id="logoFileInput" accept="image/*" style="display:none" onchange="handleLogoUpload(event)">
<button class="btn btn-gold btn-sm" onclick="document.getElementById('logoFileInput').click()"><i class=ji data-i=folder></i> ${t('set.uploadLogo')}</button>
<button class="btn btn-red btn-sm u-mt8" onclick="resetLogo()"><i class=ji data-i=refresh></i> ${t('set.removeLogo')}</button>
</div>
</div>
</div>
<div class="fg"><label><i class=ji data-i=alarm></i> ${t('set.workStart')}</label><input type="number" id="settingsWorkStart" value="${STATE.settings.workStartHour||9}" min="0" max="23"></div>
<button class="btn btn-gold" onclick="saveSettings()"><i class=ji data-i=save></i> ${t('set.save')}</button>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=landmark></i> ربط هيئة الزكاة والضريبة والجمارك (ZATCA / Fatoora)</h3></div>
<div style="padding:24px">
<div id="zatcaHub"><div class="mcard u-empty">جارٍ تحميل حالة ربط ZATCA…</div></div>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=printer></i> تذاكر تجهيز المطبخ (KOT)</h3></div>
<div style="padding:24px" id="kotSettingsBody">
<div class="mcard u-empty">جارٍ تحميل إعدادات تذاكر المطبخ…</div>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=id-card></i> بطاقات الموظفين (QR + تحقق)</h3></div>
<div style="padding:24px" id="cardSettingsBody">
<div class="mcard u-empty">جارٍ تحميل إعدادات البطاقات…</div>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=save></i> النسخ الاحتياطي الكامل والاستعادة</h3><div class="u-row-wrap"><button class="btn btn-green btn-sm" onclick="sysDoBackup()"><i class=ji data-i=save></i> نسخة احتياطية الآن</button><button class="btn btn-gold btn-sm" onclick="document.getElementById('sysUploadInput')?.click()"><i class=ji data-i=upload></i> رفع نسخة خارجية</button><input type="file" id="sysUploadInput" accept=".sql" style="display:none" onchange="sysUploadBackup(this)"><button class="btn btn-blue btn-sm" onclick="sysLoadBackups()"><i class=ji data-i=refresh></i> تحديث القائمة</button></div></div>
<div style="padding:16px 24px"><small class="text-muted">النسخة تشمل قاعدة البيانات كاملة + الإعدادات — انسخ أحدث ملف على فلاشة خارجية للأمان من ضبط المصنع. الاستعادة تمسح الحالي (بنعمل نسخة أمان تلقائيًا أولًا).</small><div id="sysBackupList" style="margin-top:12px"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=inbox></i> تصدير وتصفير</h3></div>
<div style="padding:24px">
<div style="display:flex;gap:12px;flex-wrap:wrap">
<button class="btn btn-green btn-sm" onclick="exportAllData()"><i class=ji data-i=inbox></i> تصدير قراءة البيانات (JSON)</button>
<button class="btn btn-blue btn-sm" onclick="showDatabaseRestoreInfo()"><i class=ji data-i=archive></i> إرشادات استعادة قاعدة البيانات</button>
<button class="btn btn-red" onclick="resetAllData()"><i class=ji data-i=trash></i> مسح جميع البيانات</button>
${STATE.currentUser?.role==='admin'?`<button class="btn btn-red" style="border:2px solid var(--red);font-weight:900" onclick="showOperationalResetModal()"><i class=ji data-i=alert-triangle></i> تصفير شامل (كل السستم)</button>`:''}
</div>
</div>
</div>
`;
}
async function loadCardSettings(){
const box=document.getElementById('cardSettingsBody');
if(!box) {return;}
try{
const s=await apiFetch('/hr/card-settings');
box.innerHTML=`
<div class="fg"><label><i class=ji data-i=link></i> رابط التحقق (يُطبع في QR البطاقة)</label>
<input id="cardVerifyBase" dir="ltr" value="${esc(s.verifyBase||'')}" placeholder="https://192.168.1.165:5000">
<small class="text-muted">عنوان السيرفر اللي الموبايلات توصله عند المسح (IP مكتب / Tailscale / دومين). بدون / في الآخر.</small></div>
<div class="fg"><label><i class=ji data-i=phone></i> رقم الطوارئ على البطاقة</label>
<input id="cardEmergency" dir="ltr" value="${esc(s.emergencyPhone||'')}" placeholder="+966-5X-XXX-XXXX"></div>
<button class="btn btn-gold" onclick="saveCardSettings()"><i class=ji data-i=save></i> حفظ إعدادات البطاقات</button>
<small class="text-muted" style="display:block;margin-top:8px">البطاقات الجديدة تستخدم الرابط المحفوظ تلقائيًا — لا حاجة لأي كود.</small>`;
}catch(e){ box.innerHTML=`<div class="mcard u-empty">تعذر تحميل إعدادات البطاقات: ${esc(e.message||e)}</div>`; }
}
async function saveCardSettings(){
try{
await apiFetch('/hr/card-settings',{method:'PUT',body:JSON.stringify({verifyBase:document.getElementById('cardVerifyBase')?.value||'',emergencyPhone:document.getElementById('cardEmergency')?.value||''})});
toast('تم حفظ إعدادات البطاقات','success');
}catch(e){ toast(e.message||'تعذر الحفظ','error'); }
}
function showOperationalResetModal(){
    if(STATE.currentUser?.role!=='admin'){ toast('هذا الإجراء متاح لمدير النظام فقط','error'); return; }
    showModal(`<h3 class="u-red"><i class=ji data-i=alert-triangle></i> تصفير شامل — كل السستم</h3>
      <div style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.45);padding:16px;border-radius:var(--r);line-height:2;margin-bottom:16px">
        <strong>⚠ تحذير نهائي — لا يمكن التراجع</strong><br>
        سيتم حذف：<strong>كل شيء</strong> — الرواتب، الحضور، الإجازات، الموظفين، الإيرادات، المصاريف، طلبات الصرف، فواتير المبيعات، فواتير المشتريات، الأصناف، المخزون، الوصفات، حركات المخزون، الورديات، الإشعارات، العملاء، الموردين، الأصول، دليل الحسابات، جداول Oracle المنسوخة، وكل رقم في السستم.<br><br>
        سيبقى فقط：<strong>مدير النظام + المحاسب</strong> (admin/admin12345 + admin1/123456) والإعدادات الأساسية وسجل التدقيق.<br><br>
        <strong style="color:var(--red)">أكّد أخذ نسخة احتياطية (backup) قبل التنفيذ!</strong>
      </div>
      <div class="fg"><label>سبب التصفير الشامل</label><textarea id="resetReason" rows="3" placeholder="اكتب سبباً واضحاً لا يقل عن 10 أحرف"></textarea></div>
      <div class="fg"><label>اكتب CONFIRM PRODUCTION RESET للتأكيد</label><input id="resetConfirmation" autocomplete="off" placeholder="CONFIRM PRODUCTION RESET"></div>
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--red);font-weight:700"><input type="checkbox" id="resetForce" checked> <span>تصفير إجباري: يمسح كل حساب term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term</span></label></div>
      <div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="executeOperationalReset()"><i class=ji data-i=alert-triangle></i> تنفيذ التصفير الشامل</button></div>`);
}
async function executeOperationalReset(){
    const confirmation=document.getElementById('resetConfirmation')?.value.trim();
    const reason=document.getElementById('resetReason')?.value.trim();
    const force=document.getElementById('resetForce')?.checked === true;
    if(confirmation!=='CONFIRM PRODUCTION RESET'){ toast('اكتب العبارة CONFIRM PRODUCTION RESET كما هي تماماً','error'); return; }
    if(!reason || reason.length<10){ toast('اكتب سبباً واضحاً لا يقل عن 10 أحرف','error'); return; }
    if(!confirm('⚠ تحذير نهائي: سيتم حذف كل شيء في السستم — كل رقم، كل فاتورة، كل صنف، كل موظف، كل جدول Oracle. لا يمكن التراجع. هل أنت متأكد 100%؟')) {return;}
    try{
        const result=await apiFetch('/warehouse/system/reset-all',{method:'POST',body:JSON.stringify({confirmation,reason,force,scope:'full'})});
        closeModal(); toast(`تم التصفير الشامل — كل السستم رجع للصفر${result.reset?.reset_number?` — رقم العملية ${result.reset.reset_number}`:''}`,'success');
        await loadData(); renderPage();
    }catch(e){ toast(e.message||'تعذر التصفير؛ لم يتم تغيير البيانات','error'); }
}
function handleLogoUpload(e){
const file=e.target.files?.[0];
if(!file){return;}
if(file.size>2*1024*1024){ toast('حجم الصورة كبير جداً (حد أقصى 2MB)','error'); return; }
const reader=new FileReader();
reader.onload=async (evt)=>{
try {
  const logoB64=evt.target.result;
  await apiUpdate('settings','main_settings',{logoB64});
  STATE.settings.logoB64=logoB64;
  const preview=document.getElementById('logoPreview');
  if(preview) {preview.innerHTML=`<img src="${logoB64}" style="width:100%;height:100%;object-fit:cover">`;}
  updateLogoDisplay();
  toast('تم رفع الشعار وحفظه في قاعدة البيانات','success');
} catch(e) { toast(e.message||'تعذر حفظ الشعار','error'); }
};
reader.readAsDataURL(file);
}
async function resetLogo(){
try {
  await apiUpdate('settings','main_settings',{logoB64:null,logo:'<i class=ji data-i=utensils></i>'});
  STATE.settings.logoB64=null;
  STATE.settings.logo='<i class=ji data-i=utensils></i>';
  const preview=document.getElementById('logoPreview');
  if(preview) {preview.innerHTML=logoMarkup('settings-logo-preview');}
  updateLogoDisplay();
  toast('تم إزالة الشعار من قاعدة البيانات','info');
} catch(e) { toast(e.message||'تعذر إزالة الشعار','error'); }
}
async function saveSettings(){
const payload={
  name:document.getElementById('settingsName')?.value.trim()||STATE.settings.name,
  currency:document.getElementById('settingsCurrency')?.value.trim()||'SAR',
  logo:STATE.settings.logo||'<i class=ji data-i=utensils></i>',
  workStartHour:parseInt(document.getElementById('settingsWorkStart')?.value)||9,
};
try {
  const saved=await apiUpdate('settings','main_settings',payload);
  Object.assign(STATE.settings,saved);
  document.getElementById('restNameDisplay').textContent=STATE.settings.name;
  updateLogoDisplay();
  toast('تم حفظ الإعدادات في قاعدة البيانات','success');
} catch(e) { toast(e.message||'تعذر حفظ الإعدادات','error'); }
}

// ═══════════════════ ZATCA Integration Hub (settings screen) ═══════════════════
// Everything about the tax-authority link is managed from here: enable/disable,
// seller data, environment, CSR/CSID onboarding, live queue monitor and retries.
const ZATCA_WRITE = () => ['admin','manager'].includes(STATE.currentUser?.role);
const ZATCA_STATUS_LABEL = { queued:'بالانتظار', processing:'قيد الإرسال', reported:'مُبلّغة ✓', failed:'فشلت', dead_letter:'فشل نهائي', skipped_cancelled:'ملغاة', skipped_disabled:'موقوفة' };

function renderZatcaHub(){
const d=STATE.zatca; if(!d) {return '<div class="mcard u-empty">جارٍ التحميل…</div>';}
const c=d.config||{}, q=d.queue||{};
const can=ZATCA_WRITE();
const envOptions=(c.environments||[]).map(e=>`<option value="${e.value}" ${e.value===c.environment?'selected':''}>${esc(e.label)}</option>`).join('');
const queueChips=Object.entries(q).filter(([k,v])=>v>0||['queued','reported','failed','dead_letter'].includes(k)).map(([k,v])=>`<span class="zatca-chip ${k==='reported'?'ok':k==='queued'?'':(k==='failed'||k==='dead_letter')?'bad':'muted'}">${ZATCA_STATUS_LABEL[k]||k}: <b>${v}</b></span>`).join('')||'<span class="zatca-chip muted">لا مهام بعد</span>';
return `
<div class="zatca-status ${c.enabled?'on':''}">
  <div class="zs-main">
    <span class="zatca-pill ${c.enabled?'on':'off'}"><i class=ji data-i=${c.enabled?'zap':'pause'}></i> ${c.enabled?'الربط مفعّل — يتم الإرسال لهيئة الزكاة':'الربط موقوف — لا يُرسل أي شيء للهيئة'}</span>
    <span class="zatca-pill muted"><i class=ji data-i=sliders></i> ${esc(c.environment_label||'—')}</span>
    ${c.has_csid?`<span class="zatca-pill ok"><i class=ji data-i=shield-check></i> شهادة CSID جاهزة</span>`:`<span class="zatca-pill warn"><i class=ji data-i=alert-triangle></i> لا شهادة CSID بعد</span>`}
  </div>
  <div class="zs-queue">${queueChips}</div>
  ${can?`<div class="zs-actions">
    <button class="btn ${c.enabled?'btn-red':'btn-green'} btn-sm" onclick="zatcaToggle(!${c.enabled?'true':'false'})"><i class=ji data-i=${c.enabled?'pause':'play'}></i> ${c.enabled?'إيقاف الربط':'تفعيل الربط'}</button>
    <button class="btn btn-blue btn-sm" onclick="zatcaTest()"><i class=ji data-i=wifi></i> اختبار الاتصال</button>
    <span id="zatcaTestResult" class="zatca-test-result"></span>
  </div>`:''}
</div>
${can?`
<div class="zatca-grid">
  <div class="fg"><label>اسم المنشأة (يظهر للهيئة)</label><input id="ztSeller" value="${esc(c.seller_name||'')}" placeholder="مطاعم الشرفه العالمي"></div>
  <div class="fg"><label>الرقم الضريبي (15 رقمًا)</label><input id="ztVat" value="${esc(c.vat_number||'')}" maxlength="15" inputmode="numeric" placeholder="3xxxxxxxxxxxxxx"></div>
  <div class="fg"><label>السجل التجاري / رقم المنشأة</label><input id="ztCrn" value="${esc(c.crn||'')}" placeholder="1xxxxxxxxx"></div>
  <div class="fg"><label>الفرع</label><input id="ztBranch" value="${esc(c.branch_name||'')}" placeholder="الفرع الرئيسي"></div>
  <div class="fg u-col2"><label>العنوان</label><input id="ztAddress" value="${esc(c.address||'')}" placeholder="الرياض — حي — شارع"></div>
  <div class="fg"><label>البيئة</label><select id="ztEnv" onchange="zatcaEnvChanged()">${envOptions}</select></div>
  <div class="fg"><label>عنوان الـ API (اختياري — يتبع البيئة تلقائيًا)</label><input id="ztApiBase" value="${esc(c.api_base||'')}" placeholder="${esc(c.default_api_base||'')}" dir="ltr"></div>
  <div class="fg"><label>اسم الحل البرمجي</label><input id="ztSolution" value="${esc(c.solution_name||'')}" placeholder="Karim ERP"></div>
  <div class="fg"><label>الرقم التعريفي / السجل المدني (اختياري — للفردية)</label><input id="ztEid" value="${esc(c.eid&&c.eid!=='••••'?c.eid:'')}" placeholder="1xxxxxxxxx" dir="ltr"></div>
  <div class="fg"><label>أقصى عدد محاولات لكل فاتورة</label><input id="ztMaxAttempts" type="number" min="1" max="50" value="${c.max_attempts||10}"></div>
  <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ztPoll" ${c.poll_in_server!==false?'checked':''}> <span>مزامنة الإبلاغ تلقائيًا من داخل الخادم (موصى بها)</span></label></div>
</div>
<div class="zatca-actions-row">
  <button class="btn btn-gold" onclick="zatcaSave()"><i class=ji data-i=save></i> حفظ بيانات الربط</button>
  <button class="btn ${c.has_csr?'':'btn-blue'}" onclick="zatcaGenerateCsr()"><i class=ji data-i=key></i> ${c.has_csr?'إعادة توليد CSR':'توليد CSR'}</button>
  <button class="btn ${c.has_csid?'':'btn-gold'}" onclick="zatcaCsidModal()"><i class=ji data-i=shield-check></i> ${c.has_csid?'إعادة طلب شهادة CSID':'طلب شهادة CSID برمز OTP'}</button>
  <button class="btn" onclick="zatcaCsidManualModal()"><i class=ji data-i=clipboard></i> إدخال شهادة يدويًا</button>
  ${c.has_csid?`<button class="btn btn-red" onclick="zatcaCsidClear()"><i class=ji data-i=trash></i> حذف الشهادة</button>`:''}
  <button class="btn btn-blue" onclick="zatcaApplyVat()"><i class=ji data-i=building></i> تطبيق الرقم الضريبي على كل الأقسام</button>
</div>
<div class="zatca-hint">
  <b>خطوات الربط الحقيقية مع منصة Fatoora:</b>
  ① احفظ بيانات المنشأة أعلاه → ② ولّد CSR → ③ ادخل منصة fatoora.zatca.gov.sa واطلب رمز OTP لجهاز الامتثال → ④ أدخل OTP هنا لاستلام شهادة CSID → ⑤ فعّل الربط. بعدها كل فاتورة كاشير تُبلّغ تلقائيًا للهيئة.
  ${c.has_private_key?'<span class="zatca-warn">ملاحظة: المفتاح الخاص محفوظ في قاعدة البيانات للبيئات التجريبية — في الإنتاج استخدم HSM.</span>':''}
</div>`:''}
<div class="tbl-hd" style="margin-top:18px"><h4><i class=ji data-i=database></i> مراقبة طابور الإبلاغ الضريبي</h4></div>
<div class="zatca-queue-tools">
  <button class="btn btn-sm" onclick="loadZatcaQueue()"><i class=ji data-i=refresh></i> تحديث</button>
  ${can?`<button class="btn btn-blue btn-sm" onclick="zatcaRetry('failed')"><i class=ji data-i=undo></i> إعادة محاولة الفاشلة</button>
  <button class="btn btn-sm" onclick="zatcaRetry('all')"><i class=ji data-i=history></i> إعادة جدولة الكل</button>`:''}
</div>
<div id="zatcaQueueBox"><div class="mcard u-empty">جارٍ تحميل الطابور…</div></div>
`;
}

async function loadZatcaHub(){
try {
  STATE.zatca=await apiFetch('/zatca/settings');
  const el=document.getElementById('zatcaHub');
  if(el) {el.innerHTML=renderZatcaHub();}
  loadZatcaQueue();
} catch(e) {
  const el=document.getElementById('zatcaHub');
  if(el) {el.innerHTML=`<div class="mcard u-empty c-red">تعذر تحميل إعدادات ZATCA: ${esc(e.message||'')}</div>`;}
}
}

async function zatcaSave(){
const payload={
  seller_name:document.getElementById('ztSeller')?.value.trim()||null,
  vat_number:document.getElementById('ztVat')?.value.trim()||null,
  crn:document.getElementById('ztCrn')?.value.trim()||null,
  branch_name:document.getElementById('ztBranch')?.value.trim()||null,
  address:document.getElementById('ztAddress')?.value.trim()||null,
  environment:document.getElementById('ztEnv')?.value||null,
  api_base:document.getElementById('ztApiBase')?.value.trim()||null,
  solution_name:document.getElementById('ztSolution')?.value.trim()||null,
  eid:document.getElementById('ztEid')?.value.trim()||null,
  max_attempts:parseInt(document.getElementById('ztMaxAttempts')?.value)||10,
  poll_in_server:document.getElementById('ztPoll')?.checked!==false,
};
try {
  await apiFetch('/zatca/settings',{method:'PUT',body:JSON.stringify(payload)});
  toast('تم حفظ بيانات ربط ZATCA','success');
  await loadZatcaHub();
} catch(e) { toast(e.response?.message||e.message||'تعذر الحفظ','error'); }
}

async function zatcaToggle(enable){
if(!enable && !confirm('إيقاف الربط يجمّد الإبلاغ الضريبي مؤقتًا — الفواتير تبقى محفوظة وتُرسل عند إعادة التفعيل. متابعة؟')) {return;}
try {
  const r=await apiFetch('/zatca/toggle',{method:'POST',body:JSON.stringify({enabled:enable})});
  toast(enable?'تم تفعيل ربط ZATCA — سيبدأ الإبلاغ تلقائيًا':'تم إيقاف ربط ZATCA — الطابور مجمّد', enable?'success':'info');
  await loadZatcaHub();
} catch(e) { toast(e.response?.message||e.message||'تعذر تغيير الحالة','error'); }
}

async function zatcaTest(){
const el=document.getElementById('zatcaTestResult');
if(el) {el.textContent='جارٍ اختبار الاتصال…';}
try {
  const apiBase=document.getElementById('ztApiBase')?.value.trim()||undefined;
  const r=await apiFetch('/zatca/test',{method:'POST',body:JSON.stringify(apiBase?{api_base:apiBase}:{})});
  if(el) {el.innerHTML=r.ok?`<span class="c-green"><i class=ji data-i=circle-check></i> تستجيب (HTTP ${r.http_status}) — ${r.latency_ms}ms</span>`:`<span class="c-red"><i class=ji data-i=circle-x></i> ${esc(r.message||r.error||'تعذر الاتصال')}</span>`;}
} catch(e) { if(el) {el.innerHTML=`<span class="c-red">${esc(e.message||'فشل الاختبار')}</span>`;} }
}

function zatcaEnvChanged(){
const sel=document.getElementById('ztEnv');
const base=document.getElementById('ztApiBase');
const env=STATE.zatca?.config?.environments?.find(e=>e.value===sel?.value);
if(env&&base) {base.placeholder=env.api_base||'';}
}

async function zatcaGenerateCsr(){
try {
  showLoad('جارٍ توليد CSR…');
  const r=await apiFetch('/zatca/csr',{method:'POST',body:JSON.stringify({})});
  await loadZatcaHub();
  showModal(`<h3><i class=ji data-i=key></i> تم توليد CSR حقيقي (EC P-256)</h3>
    <div class="fg"><label>الموضوع (Subject)</label><input readonly dir="ltr" value="${esc([r.subject.C,r.subject.SN,r.subject.O,r.subject.OU,r.subject.UID,r.subject.CN].filter(Boolean).join(', '))}"></div>
    <div class="fg"><label>محتوى CSR — انسخه لمنصة Fatoora عند الحاجة</label><textarea readonly dir="ltr" rows="8" style="font-family:monospace;font-size:10px">${esc(r.csr_pem)}</textarea></div>
    <div class="modal-footer"><button class="btn btn-gold" onclick="zatcaCopyCsr()"><i class=ji data-i=copy></i> نسخ CSR</button><button class="btn" onclick="closeModal()">إغلاق</button></div>`);
} catch(e) { toast(e.response?.message||e.message||'تعذر توليد CSR — احفظ الرقم الضريبي أولاً','error'); }
finally { hideLoad(); }
}

function zatcaCopyCsr(){
const ta=document.querySelector('#modals textarea[readonly]');
if(!ta) {return;}
ta.select();
try { navigator.clipboard.writeText(ta.value); } catch(_){ document.execCommand('copy'); }
toast('تم نسخ CSR','success');
}

function zatcaCsidModal(){
showModal(`<h3><i class=ji data-i=shield-check></i> طلب شهادة الامتثال CSID</h3>
  <div class="fg"><label>رمز OTP من منصة Fatoora (6 أرقام)</label><input id="zatcaOtp" inputmode="numeric" maxlength="6" placeholder="######" autocomplete="off"></div>
  <div class="zatca-hint">ادخل إلى fatoora.zatca.gov.sa ← «الأجهزة والبرمجيات» ← «إنشاء رمز OTP» ثم أدخله هنا. سيُرسل CSR المولّد إلى الهيئة فعليًا ويُحفظ الرد.</div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="zatcaRequestCsid()"><i class=ji data-i=send></i> إرسال الطلب للهيئة</button></div>`);
}

async function zatcaRequestCsid(){
const otp=document.getElementById('zatcaOtp')?.value.trim();
if(!/^\d{6}$/.test(otp||'')){ toast('أدخل رمز OTP المكوّن من 6 أرقام','error'); return; }
try {
  showLoad('جارٍ إرسال الطلب للهيئة…');
  const r=await apiFetch('/zatca/csid',{method:'POST',body:JSON.stringify({otp})});
  closeModal(); await loadZatcaHub();
  toast('تم استلام شهادة CSID بنجاح — يمكنك تفعيل الربط الآن','success');
} catch(e) {
  const errs=e.response?.errors;
  const detail=Array.isArray(errs)?errs.map(x=>`${x.code||''} ${x.message||''}`).join(' — '):(typeof errs==='string'?errs:'');
  toast(e.response?.message||detail||e.message||'فشل طلب الشهادة','error');
} finally { hideLoad(); }
}

async function loadZatcaQueue(){
const box=document.getElementById('zatcaQueueBox');
if(!box) {return;}
try {
  const d=await apiFetch('/zatca/queue?limit=20');
  STATE.zatcaQueue=d;
  if(!d.data?.length){ box.innerHTML=`<div class="mcard u-empty">لا مهام في طابور ZATCA بعد — ستظهر الفواتير هنا بعد تفعيل الربط</div>`; return; }
  box.innerHTML=`<div class="tbl-wrap"><table class="data-table"><thead><tr><th>الفاتورة</th><th>القسم</th><th>الإجمالي</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>أُبلغت</th></tr></thead><tbody>
  ${d.data.map(r=>`<tr>
    <td class="mono">#${r.invoice_counter}</td>
    <td>${esc(r.department_name||'—')}</td>
    <td>${fN(r.total_amount)} ${STATE.settings.currency}</td>
    <td><span class="zatca-chip ${r.status==='reported'?'ok':(r.status==='failed'||r.status==='dead_letter')?'bad':'muted'}">${ZATCA_STATUS_LABEL[r.status]||r.status}</span></td>
    <td>${r.attempts}/${r.max_attempts}</td>
    <td class="zatca-err" title="${esc(r.last_error||'')}">${esc((r.last_error||'').slice(0,60)||'—')}</td>
    <td>${r.reported_at?fDT(r.reported_at):'—'}</td>
  </tr>`).join('')}
  </tbody></table></div>`;
} catch(e) {
  box.innerHTML=`<div class="mcard u-empty c-red">تعذر تحميل الطابور: ${esc(e.message||'')}</div>`;
}
}

async function zatcaRetry(scope){
if(!confirm(scope==='all'?'إعادة جدولة كل الفواتير الفاشلة والنهائية للإرسال من جديد؟':'إعادة محاولة الفواتير الفاشلة فقط؟')) {return;}
try {
  showLoad('جارٍ إعادة الجدولة…');
  const r=await apiFetch('/zatca/queue/retry',{method:'POST',body:JSON.stringify({scope})});
  toast(`تمت إعادة جدولة ${r.requeued} فاتورة`,'success');
  await loadZatcaHub();
} catch(e) { toast(e.response?.message||e.message||'تعذر إعادة الجدولة','error'); }
finally { hideLoad(); }
}
function zatcaCsidManualModal(){
showModal(`<h3><i class=ji data-i=clipboard></i> إدخال شهادة CSID يدويًا</h3>
  <div class="fg"><label>رمز الشهادة (binarySecurityToken) من منصة Fatoora</label><textarea id="zatcaManualCsid" rows="6" dir="ltr" style="font-family:monospace;font-size:11px" placeholder="MIIC…"></textarea></div>
  <div class="fg"><label>الرقم الضريبي (اختياري — يُحفظ مع الشهادة إن كان فارغًا في الضبط)</label><input id="zatcaManualVat" inputmode="numeric" maxlength="20" placeholder="300000000000003" dir="ltr"></div>
  <div class="zatca-hint">استخدم هذا المسار إذا أتممت تسجيل جهاز الفوترة على منصة fatoora.zatca.gov.sa ونسخت الشهادة من البوابة مباشرة. تُحفظ الشهادة فورًا ويصبح التفعيل متاحًا.</div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="zatcaCsidManualSubmit()"><i class=ji data-i=save></i> حفظ الشهادة</button></div>`);
}

async function zatcaCsidManualSubmit(){
const csid=document.getElementById('zatcaManualCsid')?.value.trim();
const vat=document.getElementById('zatcaManualVat')?.value.trim()||undefined;
if(!csid){ toast('الصق رمز الشهادة أولاً','error'); return; }
try {
  showLoad('جارٍ حفظ الشهادة…');
  await apiFetch('/zatca/csid/manual',{method:'POST',body:JSON.stringify({csid,vat_number:vat})});
  closeModal(); await loadZatcaHub();
  toast('تم حفظ شهادة CSID — يمكنك تفعيل الربط الآن','success');
} catch(e) { toast(e.response?.message||e.message||'تعذر حفظ الشهادة','error'); }
finally { hideLoad(); }
}

async function zatcaCsidClear(){
if(!confirm('حذف شهادة CSID المحفوظة؟ سيتوقف الإبلاغ للهيئة حتى تُدخل شهادة جديدة.')) {return;}
try {
  await apiFetch('/zatca/csid/manual',{method:'POST',body:JSON.stringify({clear:true})});
  toast('تم حذف الشهادة','success');
  await loadZatcaHub();
} catch(e) { toast(e.response?.message||e.message||'تعذر حذف الشهادة','error'); }
}

async function zatcaApplyVat(){
const vat=document.getElementById('ztVat')?.value.trim();
if(!/\d{15}/.test((vat||'').replace(/\D/g,''))){ toast('احفظ الرقم الضريبي (15 رقمًا) أولاً','error'); return; }
if(!confirm(`سيتم تطبيق الرقم الضريبي ${vat} على جميع الأقسام/الفروع حتى تظهر الفواتير ورموز QR متوافقة. متابعة؟`)) {return;}
try {
  showLoad('جارٍ تطبيق الرقم الضريبي…');
  const r=await apiFetch('/zatca/apply-vat',{method:'POST',body:JSON.stringify({vat_number:vat})});
  toast(`تم تحديث ${r.updated} قسماً بالرقم الضريبي الموحّد`,'success');
} catch(e) { toast(e.response?.message||e.message||'تعذر التطبيق','error'); }
finally { hideLoad(); }
}

window.zatcaSave=zatcaSave; window.zatcaToggle=zatcaToggle; window.zatcaTest=zatcaTest; window.zatcaEnvChanged=zatcaEnvChanged;
window.zatcaGenerateCsr=zatcaGenerateCsr; window.zatcaCsidModal=zatcaCsidModal; window.zatcaRequestCsid=zatcaRequestCsid;
window.zatcaCsidManualModal=zatcaCsidManualModal; window.zatcaCsidManualSubmit=zatcaCsidManualSubmit;
window.zatcaCsidClear=zatcaCsidClear; window.zatcaApplyVat=zatcaApplyVat;
window.zatcaCopyCsr=zatcaCopyCsr; window.loadZatcaQueue=loadZatcaQueue; window.zatcaRetry=zatcaRetry;
// Live queue monitor — refresh every 15s only while the settings screen shows the queue box
setInterval(()=>{ if(document.getElementById('zatcaQueueBox')) {loadZatcaQueue();} }, 15000);
// ═══════════════════ Kitchen Order Tickets (KOT) — settings screen ═══════════════════
// تذاكر تجهيز المطبخ: عند كل بيع تُطبع تذكرة لكل قسم تجهيز (بدون أسعار) تلقائيًا،
// والمالك يتحكم بها من هنا: تفعيل/إيقاف، عدد النسخ، إظهار اسم الضيف/الملاحظات.
const KOT_CAN_WRITE = () => ['admin','manager'].includes(STATE.currentUser?.role);
function renderKotSettings(cfg){
const can=KOT_CAN_WRITE();
return `
<div class="zatca-status ${cfg.kot_enabled?'on':''}" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
  <span class="zatca-pill ${cfg.kot_enabled?'on':'off'}"><i class=ji data-i=${cfg.kot_enabled?'printer':'pause'}></i> ${cfg.kot_enabled?'التذاكر مفعّلة — تُطبع تلقائيًا عند كل بيع':'التذاكر موقوفة — لن تُطبع أي تذكرة تجهيز'}</span>
  <span class="zatca-pill muted"><i class=ji data-i=info></i> تذكرة لكل قسم تجهيز (المطبخ/السلطات/الحلواني/الخباز…) بلا أسعار</span>
  ${cfg.updated_at?`<span class="zatca-pill muted"><i class=ji data-i=clock></i> آخر تحديث: ${new Date(cfg.updated_at).toLocaleString('ar-EG')} ${cfg.updated_by?`— بواسطة ${esc(cfg.updated_by)}`:''}</span>`:''}
</div>
<div class="zatca-grid" style="margin-top:12px">
  <div class="fg">
    <label style="display:flex;align-items:center;gap:8px;cursor:${can?'pointer':'not-allowed'}">
      <input type="checkbox" id="kotEnabled" ${cfg.kot_enabled?'checked':''} ${can?'':'disabled'} style="width:18px;height:18px">
      تفعيل تذاكر تجهيز المطبخ عند البيع
    </label>
  </div>
  <div class="fg">
    <label>عدد نسخ التذكرة لكل قسم</label>
    <select id="kotCopies" ${can?'':'disabled'}>
      ${[1,2,3].map(n=>`<option value="${n}" ${Number(cfg.kot_copies)===n?'selected':''}>${n} ${n===1?'نسخة':'نسخ'}</option>`).join('')}
    </select>
  </div>
  <div class="fg">
    <label style="display:flex;align-items:center;gap:8px;cursor:${can?'pointer':'not-allowed'}">
      <input type="checkbox" id="kotNotes" ${cfg.kot_include_notes?'checked':''} ${can?'':'disabled'} style="width:18px;height:18px">
      إظهار اسم الضيف/الملاحظات على التذكرة
    </label>
  </div>
</div>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
  ${can?`<button class="btn btn-gold" onclick="saveKotSettings()"><i class=ji data-i=save></i> حفظ إعدادات التذاكر</button>`:''}
  <span style="font-size:8.5pt;color:var(--muted,#888)">تُطبع على طابعات <b>kot-&lt;رقم القسم&gt;</b> — ويمكن عرضها من شاشة المطبخ عبر صفحة التذاكر لكل فاتورة.</span>
</div>`;
}
async function loadKotSettings(){
try {
  const cfg=await apiFetch('/pos/kot/settings');
  const el=document.getElementById('kotSettingsBody');
  if(el) {el.innerHTML=renderKotSettings(cfg);}
} catch(e) {
  const el=document.getElementById('kotSettingsBody');
  if(el) {el.innerHTML=`<div class="mcard u-empty c-red">تعذر تحميل إعدادات تذاكر المطبخ: ${esc(e.message||'')}</div>`;}
}
}
async function saveKotSettings(){
const payload={
  kot_enabled:document.getElementById('kotEnabled')?.checked!==false,
  kot_copies:parseInt(document.getElementById('kotCopies')?.value)||1,
  kot_include_notes:document.getElementById('kotNotes')?.checked!==false,
};
try {
  const saved=await apiFetch('/pos/kot/settings',{method:'PUT',body:JSON.stringify(payload)});
  const el=document.getElementById('kotSettingsBody');
  if(el) {el.innerHTML=renderKotSettings(saved);}
  toast(saved.kot_enabled?'تم الحفظ — التذاكر مفعّلة':'تم الحفظ — التذاكر موقوفة','success');
} catch(e) { toast(e.message||'تعذر حفظ إعدادات التذاكر','error'); }
}
window.loadKotSettings=loadKotSettings; window.saveKotSettings=saveKotSettings;
function exportAllData(){
const data={version:CONFIG.VERSION,exportDate:new Date().toISOString(),departments:STATE.departments,revenues:STATE.revenues,expenses:STATE.expenses,inventory:STATE.inventory,inventoryTx:STATE.inventoryTx,dispatches:STATE.dispatches,recipes:STATE.recipes,purchaseInvoices:STATE.purchaseInvoices,kitchenReturns:STATE.kitchenReturns,users:STATE.users,employees:STATE.employees,attendance:STATE.attendance,leaveRequests:STATE.leaveRequests,hrDepartments:STATE.hrDepartments,leaveTypes:STATE.leaveTypes,shelves:STATE.shelves,weightReadings:STATE.weightReadings,settings:STATE.settings};
const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
const url=URL.createObjectURL(blob);
const a=document.createElement('a');
a.href=url;
a.download=`backup_${STATE.settings.name.replace(/\s/g,'_')}_${today()}.json`;
a.click();
URL.revokeObjectURL(url);
toast('تم التصدير','success');
}
function showDatabaseRestoreInfo(){
toast('استخدم قسم النسخ الاحتياطي الكامل بالأعلى — الاستعادة بزر واحد','info');
const el=document.getElementById('sysBackupList'); if(el) {sysLoadBackups();}
if(el) {el.scrollIntoView({behavior:'smooth',block:'nearest'});}
}
// ─── النسخ الاحتياطي الكامل والاستعادة (زر واحد) ───
function sysFmtBytes(b){ b=Number(b||0); if(b<1048576) {return `${(b/1024).toFixed(1)}KB`;} if(b<1073741824) {return `${(b/1048576).toFixed(1)}MB`;} return `${(b/1073741824).toFixed(2)}GB`; }
async function sysLoadBackups(){
const box=document.getElementById('sysBackupList'); if(!box) {return;}
box.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/system/backups');
const rows=(d.files||[]).map((f,i)=>`<tr>
<td class="fw-bold">${esc(f.file)} ${i===0?'<span class="badge bdg-green">الأحدث</span>':''}</td>
<td>${sysFmtBytes(f.bytes)}</td>
<td class="text-muted">${esc(String(f.mtime||'').replace('T',' ').slice(0,19))}</td>
<td>${f.shaOk===true?'<span class="badge bdg-green">سليمة ✓</span>':f.shaOk===false?'<span class="badge bdg-red">تالفة!</span>':'<span class="badge bdg-gray">بلا بصمة</span>'}</td>
<td>${f.manifest?'<span class="badge bdg-blue">كاملة + إعدادات</span>':'<span class="text-muted">قاعدة فقط</span>'}</td>
<td><button class="btn btn-gold btn-sm" onclick="sysRestoreModal('${esc(f.file)}')" ${f.shaOk===false?'disabled':''}><i class=ji data-i=archive></i> استعادة</button></td>
</tr>`).join('');
box.innerHTML=`<div class="tbl-scroll"><table><thead><tr><th>الملف</th><th>الحجم</th><th>التاريخ</th><th>السلامة</th><th>المحتوى</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="u-empty-sm">لا نسخ بعد — دوس نسخة احتياطية الآن</td></tr>'}</tbody></table></div>
<small class="text-muted">مجلد النسخ: <code dir="ltr">${esc(d.dir||'')}</code> — انسخ أحدث ملف لفلاشة خارجية قبل أي ضبط مصنع.</small>`;
}catch(e){ box.innerHTML=`<div class="mcard u-empty">${esc(e.message||'تعذر الجلب')}</div>`; }
}
async function sysDoBackup(){
if(!confirm('عمل نسخة احتياطية كاملة الآن (قاعدة البيانات + الإعدادات)؟')) {return;}
showLoad();
try{
const d=await apiFetch('/system/backup',{method:'POST'});
closeModal(); toast(`تمت النسخة — ${(d.files||[]).length} نسخة محفوظة`,'success');
await sysLoadBackups();
}catch(e){ toast(e.message||'فشل النسخ','error'); }finally{ hideLoad(); }
}
async function sysUploadBackup(input){
const f=input?.files?.[0]; if(!f) {return;}
if(!/\.sql$/i.test(f.name)){ toast('ارفع ملف نسخة .sql فقط','error'); input.value=''; return; }
if(!confirm(`رفع النسخة "${f.name}" لقائمة النسخ؟`)){ input.value=''; return; }
const form=new FormData(); form.append('file',f,f.name);
showLoad();
try{
const res=await fetch(API_BASE+'/system/upload',{method:'POST',headers:window._jwt?{Authorization:'Bearer '+window._jwt}:{},body:form});
const d=await res.json().catch(()=>({}));
if(!res.ok) {throw new Error(d.message||d.error||'فشل الرفع');}
toast(`اترفعت النسخة: ${d.file}`,'success');
await sysLoadBackups();
}catch(e){ toast(e.message||'فشل الرفع','error'); }finally{ hideLoad(); input.value=''; }
}
function sysRestoreModal(file){
showModal(`
<h3 class="u-red"><i class=ji data-i=alert-triangle></i> استعادة نسخة كاملة</h3>
<div class="mcard" style="margin-bottom:12px;line-height:2">الملف: <code dir="ltr">${esc(file)}</code><br>
<small class="text-muted">هنعمل <b>نسخة أمان تلقائية</b> للوضع الحالي أولًا، ونتحقق من سلامة الملف، وبعدين نرجع كل شيء زي ما كان. بعد الاستعادة أعد تشغيل خدمة السيرفر.</small></div>
<div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="sysRestoreEnv"> <span>استعادة ملف الإعدادات أيضًا (.env)</span></label></div>
<div class="fg"><label>اكتب RESTORE للتأكيد</label><input id="sysRestoreConfirm" autocomplete="off" placeholder="RESTORE" dir="ltr"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="sysConfirmRestore('${esc(file)}')"><i class=ji data-i=archive></i> تنفيذ الاستعادة</button></div>`);
}
async function sysConfirmRestore(file){
const c=document.getElementById('sysRestoreConfirm')?.value.trim();
if(c!=='RESTORE'){ toast('اكتب RESTORE للتأكيد','error'); return; }
const restoreEnv=document.getElementById('sysRestoreEnv')?.checked===true;
if(!confirm('تأكيد نهائي: الاستعادة هتمسح الوضع الحالي وترجع النسخة؟')) {return;}
showLoad();
try{
const r=await apiFetch('/system/restore',{method:'POST',body:JSON.stringify({file,confirm:'RESTORE',restoreEnv})});
closeModal(); toast('تمت الاستعادة — أعد تشغيل خدمة السيرفر الآن','success');
await sysLoadBackups();
}catch(e){ toast(e.message||'فشلت الاستعادة','error'); }finally{ hideLoad(); }
}
async function resetAllData(){
if(!confirm('سيتم حذف جميع البيانات التشغيلية ولا يمكن التراجع. هل تريد المتابعة؟')||!confirm('تأكيد نهائي')){return;}
showLoad();
try{
const response = await fetch(API_BASE + '/state',{method:'DELETE'});
if(!response.ok) {throw new Error('فشل تصفير قاعدة البيانات');}
location.reload();
}catch(err){
hideLoad();
console.error('Reset error:',err);
toast('تعذر تصفير قاعدة البيانات','error');
}
}
// ============================================
// USERS
// ============================================
function linkedEmployeeForUser(userId){return STATE.employees.find(e=>String(e.userId)===String(userId))||null;}
function linkedUserForEmployee(employee){return STATE.users.find(u=>String(u.id)===String(employee?.userId))||null;}
function employeeAccountOptions(selectedId=null,userId=null){return `<option value="">بدون موظف</option>${STATE.employees.filter(e=>!e.userId||String(e.userId)===String(userId)).map(e=>`<option value="${e.id}" ${String(e.id)===String(selectedId)?'selected':''}>${esc(e.name)} — ${esc(e.employeeId||'')}</option>`).join('')}`;}
async function linkUserToEmployee(userId,employeeId){const result=await apiFetch(`/users/${encodeURIComponent(userId)}/employee`,{method:'PUT',body:JSON.stringify({employeeId:employeeId||null})});(result.previousEmployees||[]).forEach(e=>upsertStateEntity('employees',{...e,userId:null}));if(result.employee){upsertStateEntity('employees',result.employee);}return result;}
function toggleEmployeeAccountFields(){const enabled=Boolean(document.getElementById('empCreateAccount')?.checked);const box=document.getElementById('empAccountFields');if(box){box.style.display=enabled?'grid':'none';}}
function showCreateEmployeeAccountModal(employeeId){showAddUserModal(employeeId);}
function renderUserCards(users){
if(!users || !users.length) {return '<div class="mcard u-empty-grid">' + t('user.noResult') + '</div>';}
return users.map(u=>{const role=ROLES[u.role];const emp=linkedEmployeeForUser(u.id);const active=u.active!==false;const deptLine=u.role==='dept_head'?`<br><strong>قسمه:</strong> <span class="badge bdg-blue">${esc(deptNameByCode(u.dept_code))}</span>`:'';return `<div class="mcard"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div style="width:48px;height:48px;border-radius:50%;background:var(--gold-d);display:flex;align-items:center;justify-content:center;font-size:22px">${role?.icon||'<i class=ji data-i=user></i>'}</div><div class="u-flex1"><div class="fw-bold">${esc(u.name)}</div><div class="text-muted" style="font-size:11px">@${esc(u.username)}</div></div><span class="badge ${active?'bdg-green':'bdg-red'}">${active?'نشط':'موقوف'}</span></div><div class="details-item" style="margin-top:8px"><strong>الدور:</strong> ${role?.name||esc(u.role)}${deptLine}<br><strong>الموظف المرتبط:</strong> ${emp?`${esc(emp.name)} — ${esc(emp.employeeId||'')}`:'<span class="text-muted">غير مربوط</span>'}</div><div class="fr u-mt12"><button class="btn btn-sm u-flex1" onclick="editUser('${u.id}')"><i class=ji data-i=pencil></i> تعديل الحساب</button>${active&&u.id!==STATE.currentUser.id?`<button class="btn btn-sm" onclick="issueResetCode('${u.id}')" title="توليد رمز استعادة لكلمة المرور (10 دقائق، استخدام واحد)"><i class=ji data-i=key></i></button>`:''}${u.id!==STATE.currentUser.id?`<button class="btn btn-red btn-sm" onclick="deleteUser('${u.id}')"><i class=ji data-i=trash></i></button>`:''}</div></div>`;}).join('');
}
function renderUsers(){
if(STATE.currentUser.role!=='admin') {return '<div class="mcard"><i class=ji data-i=circle-x></i> هذه الصفحة للمدير فقط</div>';}
return `<div class="u-row-between"><div><h3 class="u-gold-strong"><i class=ji data-i=users></i> ${t('pg.users')}</h3><small class="text-muted">الحساب للدخول والصلاحيات، والموظف للسجل الوظيفي والحضور والراتب.</small></div><div style="display:flex;gap:10px"><button class="btn btn-green" onclick="showBulkImportModal()"><i class=ji data-i=inbox></i> استيراد جماعي</button><button class="btn btn-gold" onclick="showAddUserModal()"><i class=ji data-i=plus></i> مستخدم جديد</button></div></div><div><div class="emp-search-row">
<div class="smart-search">
<input type="text" id="userSearch" placeholder="${t('user.searchPh')}" oninput="filterUsers()" onkeydown="if(event.key==='Enter')filterUsers()">
</div>
<button class="btn btn-blue btn-sm" onclick="filterUsers()"><i class=ji data-i=search></i> ${t('act.search')}</button>
</div><div class="dept-grid" id="usersGrid">${renderUserCards(STATE.users)}</div>`;
}
function filterUsers(){
const q = normalizeAr(document.getElementById('userSearch')?.value || '');
const grid = document.getElementById('usersGrid');
if(!grid) {return;}
if(!q){ grid.innerHTML = renderUserCards(STATE.users); return; }
const filtered = (STATE.users || []).filter(u => {
  const emp = (typeof linkedEmployeeForUser === 'function') ? linkedEmployeeForUser(u.id) : null;
  return normalizeAr(u.name).includes(q) || normalizeAr(u.username).includes(q)
    || normalizeAr(u.role).includes(q) || normalizeAr(emp ? emp.name : '').includes(q);
});
grid.innerHTML = renderUserCards(filtered);
}
function showAddUserModal(employeeId=null){
const linkedEmployee=employeeId?STATE.employees.find(e=>String(e.id)===String(employeeId)):null;
const roleOpts=Object.keys(ROLES).map(k=>`<option value="${k}">${ROLES[k].icon} ${ROLES[k].name}</option>`).join('');
const deptOpts=(STATE.departments||[]).map(d=>`<option value="${esc(d.code)}">${esc(d.name||d.name_ar||d.code)}</option>`).join('');
showModal(`<h3><i class=ji data-i=plus></i> إضافة مستخدم وربطه بموظف</h3><div class="workflow-banner">الحساب يحدد تسجيل الدخول والصلاحيات، والربط يوصله بالسجل الوظيفي والحضور والراتب.</div><div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="userName" value="${esc(linkedEmployee?.name||'')}"></div><div class="fg"><label>اسم المستخدم</label><input type="text" id="userUsername"></div></div><div class="fr"><div class="fg"><label>كلمة المرور</label><input type="password" id="userPassword"></div><div class="fg"><label>الدور</label><select id="userRole" onchange="toggleUserDeptField()">${roleOpts}</select></div></div><div class="fr"><div class="fg" id="userDeptField" style="display:none"><label>قسم الرئيس <small>(إجباري لرئيس القسم)</small></label><select id="userDeptCode"><option value="">— اختر القسم —</option>${deptOpts}</select></div><div class="fg"><label>الموظف المرتبط</label><select id="userEmployee">${employeeAccountOptions(employeeId||'',null)}</select></div></div><div class="fr"><div class="fg"><label>حالة الحساب</label><select id="userActive"><option value="true" selected>نشط</option><option value="false">موقوف</option></select></div><div></div></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addUser()"><i class=ji data-i=save></i> حفظ وربط الحساب</button></div>`);
}
function toggleUserDeptField(){
const roleEl=document.getElementById('userRole'); const field=document.getElementById('userDeptField');
if(!roleEl||!field) {return;}
field.style.display = roleEl.value==='dept_head'?'':'none';
}
async function addUser(){
const name=document.getElementById('userName')?.value.trim(),
username=document.getElementById('userUsername')?.value.trim(),
password=document.getElementById('userPassword')?.value,
role=document.getElementById('userRole')?.value,
employeeId=document.getElementById('userEmployee')?.value||null,
active=document.getElementById('userActive')?.value!=='false';
const deptCode=role==='dept_head'?(document.getElementById('userDeptCode')?.value||null):null;
if(!name||!username||!password){ toast('أكمل الاسم واسم المستخدم وكلمة المرور','error'); return; }
if(role==='dept_head'&&!deptCode){ toast('اختر قسم رئيس القسم','error'); return; }
if(STATE.users.find(u=>u.username===username)){ toast('اسم المستخدم موجود بالفعل','error'); return; }
try{
 const payload={username,password,role,name,active};
 if(role==='dept_head') {payload.dept_code=deptCode;}
 const saved=await apiCreate('users',payload);
 STATE.users.push(saved);
 if(employeeId) {await linkUserToEmployee(saved.id,employeeId);}
 closeModal(); renderPage();
 toast(employeeId?'تم إنشاء الحساب وربطه بالموظف بنجاح':'تم إنشاء الحساب ويمكن ربطه بموظف من التعديل','success');
}catch(e){ toast(e.message||'تعذر إنشاء الحساب أو ربطه','error'); }
}
function editUser(id){
const u=STATE.users.find(x=>String(x.id)===String(id));
if(!u){return;}
const emp=linkedEmployeeForUser(u.id);
const roleOpts=Object.keys(ROLES).map(k=>`<option value="${k}" ${u.role===k?'selected':''}>${ROLES[k].icon} ${ROLES[k].name}</option>`).join('');
const deptOpts=(STATE.departments||[]).map(d=>`<option value="${esc(d.code)}" ${String(u.dept_code||'')===String(d.code)?'selected':''}>${esc(d.name||d.name_ar||d.code)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل حساب المستخدم</h3><div class="workflow-banner">اسم المستخدم ثابت كمعرّف دخول. يمكنك تعديل الاسم، الدور، الحالة، كلمة المرور، والموظف المرتبط.</div><div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="userName" value="${esc(u.name)}"></div><div class="fg"><label>اسم المستخدم</label><input type="text" id="userUsername" value="${esc(u.username)}" readonly></div></div><div class="fr"><div class="fg"><label>كلمة المرور الجديدة <small>(اتركها فارغة دون تغيير)</small></label><input type="password" id="userPassword"></div><div class="fg"><label>الدور والصلاحيات</label><select id="userRole" onchange="toggleUserDeptField()">${roleOpts}</select></div></div><div class="fr"><div class="fg" id="userDeptField" style="display:${u.role==='dept_head'?'':'none'}"><label>قسم الرئيس <small>(إجباري لرئيس القسم)</small></label><select id="userDeptCode"><option value="">— اختر القسم —</option>${deptOpts}</select></div><div class="fg"><label>الموظف المرتبط</label><select id="userEmployee">${employeeAccountOptions(emp?.id||'',u.id)}</select></div></div><div class="fr"><div class="fg"><label>حالة الحساب</label><select id="userActive"><option value="true" ${u.active!==false?'selected':''}>نشط</option><option value="false" ${u.active===false?'selected':''}>موقوف</option></select></div><div></div></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="updateUser('${id}')"><i class=ji data-i=save></i> حفظ التعديل</button></div>`);
}
async function updateUser(id){
const u=STATE.users.find(x=>String(x.id)===String(id));
if(!u){return;}
const name=document.getElementById('userName')?.value.trim();
const role=document.getElementById('userRole')?.value;
const newPw=document.getElementById('userPassword')?.value;
const employeeId=document.getElementById('userEmployee')?.value||null;
const active=document.getElementById('userActive')?.value!=='false';
if(!name||!role){ toast('أكمل بيانات المستخدم','error'); return; }
const deptCode=role==='dept_head'?(document.getElementById('userDeptCode')?.value||null):null;
if(role==='dept_head'&&!deptCode){ toast('اختر قسم رئيس القسم','error'); return; }
try {
  const payload={name,role,active};
  if(role==='dept_head') {payload.dept_code=deptCode;}
  if(newPw) {payload.password=newPw;}
  const saved=await apiUpdate('users',id,payload);
  Object.assign(u,saved);
  await linkUserToEmployee(id,employeeId);
  if(STATE.currentUser?.id===u.id) {STATE.currentUser={...STATE.currentUser,...saved};}
  closeModal(); buildNav(); renderPage();
  toast('تم حفظ تعديل الحساب وربط الموظف في قاعدة البيانات','success');
} catch(e) { toast(e.message||'تعذر تعديل المستخدم أو الربط','error'); }
}
async function deleteUser(id){
if(String(id)===String(STATE.currentUser?.id)){ toast('لا يمكن حذف حسابك','error'); return; }
if(!confirm('حذف هذا المستخدم؟')){return;}
try {
  await persistRemove('users',id);
  STATE.users=STATE.users.filter(u=>String(u.id)!==String(id));
  STATE.employees.forEach(emp=>{if(String(emp.userId)===String(id)) {emp.userId=null;}});
  renderPage();
  toast('تم حذف المستخدم من قاعدة البيانات','warning');
} catch(e) { toast(e.message||'تعذر حذف المستخدم','error'); }
}
// ============================================
// CFO — لوحة المدير المالي + دفتر القيود + ميزان المراجعة
// ============================================
const CFO_STATE = { summary: null, tb: null, journal: [], chart: [], from: '', to: '' };
function cfoCanWrite(){ return ['admin', 'accountant'].includes(STATE.currentUser?.role); }
async function renderCfoPage(){
  const content = document.getElementById('content');
  const canWrite = cfoCanWrite();
  const now = new Date();
  if(!CFO_STATE.from) {CFO_STATE.from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;}
  if(!CFO_STATE.to) {CFO_STATE.to = today();}
  content.innerHTML = '<div class="u-empty"><div class="spinner"></div></div>';
  try{
    const [summary, tb, journal, chart] = await Promise.all([
      apiFetch(`/accounting/cfo-summary?from=${CFO_STATE.from}&to=${CFO_STATE.to}`),
      apiFetch(`/accounting/trial-balance?from=${CFO_STATE.from}&to=${CFO_STATE.to}`),
      apiFetch('/accounting/journal?limit=30'),
      apiFetch('/accounting/chart'),
    ]);
    CFO_STATE.summary = summary; CFO_STATE.tb = tb; CFO_STATE.journal = journal; CFO_STATE.chart = chart;
  }catch(e){
    content.innerHTML = `<div class="mcard u-empty">${esc(e.message || 'تعذر تحميل بيانات المحاسبة')}</div>`;
    return;
  }
  const s = CFO_STATE.summary;
  const tb = CFO_STATE.tb;
  content.innerHTML = `
  <div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=briefcase></i> ${t('pg.cfo')}</h3>
  <div class="u-row-wrap">
    <input type="date" id="cfoFrom" value="${CFO_STATE.from}" onchange="CFO_STATE.from=this.value">
    <input type="date" id="cfoTo" value="${CFO_STATE.to}" onchange="CFO_STATE.to=this.value">
    <button class="btn btn-blue btn-sm" onclick="renderCfoPage()"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button>
    <button class="btn btn-sm" onclick="cfoPrintSummary()"><i class=ji data-i=printer></i> ${t('cfo.printSum')}</button>
    ${canWrite ? `<button class="btn btn-gold btn-sm" onclick="cfoJournalModal()"><i class=ji data-i=plus></i> ${t('cfo.manual')}</button>
    <button class="btn btn-green btn-sm" onclick="cfoPostPayroll()"><i class=ji data-i=banknote></i> ${t('cfo.postPayroll')}</button>` : ''}
  </div></div>
  <div class="metrics-grid">
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('cfo.revenue')}</div><div class="mcard-val c-green">${fC(s.revenue.total)}</div><small class="text-muted">${fN(s.revenue.count)} ${t('cfo.ops')}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> ${t('cfo.expenses')}</div><div class="mcard-val c-red">${fC(s.expenses.total)}</div><small class="text-muted">${fN(s.expenses.count)} ${t('cfo.ops')}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=gem></i> ${t('cfo.net')}</div><div class="mcard-val ${s.net_approx >= 0 ? 'c-green' : 'c-red'}">${fC(s.net_approx)}</div><small class="text-muted">إيراد − مصروف − رواتب مفتوحة ${fC(s.payroll_open)}</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('cfo.cash')}</div><div class="mcard-val c-blue">${fC(s.cash_position)}</div><small class="text-muted">${fN(s.journal_entries)} قيدًا مرحّلًا</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=receipt></i> ${t('cfo.invoices')}</div><div class="mcard-val c-gold">${fC(s.pos.total)}</div><small class="text-muted">${fN(s.pos.invoices)} فاتورة</small></div>
    <div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('cfo.tb')}</div><div class="mcard-val ${tb.balanced ? 'c-green' : 'c-red'}">${tb.balanced ? t('cfo.balanced') : t('cfo.unbalanced')}</div><small class="text-muted">${t('cfo.debit')} ${fC(tb.total_debit)} = ${t('cfo.credit')} ${fC(tb.total_credit)}</small></div>
  </div>
  <div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=scale></i> ${t('cfo.tbTitle')} (${esc(CFO_STATE.from)} → ${esc(CFO_STATE.to)})</h3>
  <div class="u-row-wrap"><button class="btn btn-sm" onclick="cfoPrintTB()"><i class=ji data-i=printer></i> ${t('cfo.printTB')}</button><button class="btn btn-blue btn-sm" onclick="cfoExportTB()"><i class=ji data-i=inbox></i> ${t('cfo.excel')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.code')}</th><th>${t('cfo.account')}</th><th>${t('cfo.type')}</th><th>${t('cfo.debit')}</th><th>${t('cfo.credit')}</th><th>${t('cfo.balance')}</th></tr></thead><tbody>
  ${tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).map(a => {
    const bal = Number(a.debit) - Number(a.credit);
    return `<tr><td class="mono">${esc(a.code)}</td><td class="fw-bold">${esc(a.name_ar)}</td><td>${esc(a.type)}</td><td>${fC(a.debit)}</td><td>${fC(a.credit)}</td><td class="fw-bold">${fC(bal)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="u-empty-sm">لا حركات في الفترة — رحّل المبيعات تلقائيًا من الكاشير أو أدخل قيدًا يدويًا</td></tr>'}
  </tbody></table></div></div>
  <div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=book></i> ${t('cfo.journalTitle')}</h3>
  <div class="u-row-wrap"><button class="btn btn-sm" onclick="cfoPrintJournal()"><i class=ji data-i=printer></i> ${t('cfo.printJ')}</button></div></div>
  <div class="tbl-scroll"><table><thead><tr><th>${t('cfo.entryNo')}</th><th>${t('cfo.date')}</th><th>${t('cfo.memo')}</th><th>${t('cfo.source')}</th><th>${t('cfo.lines')}</th><th>${t('cfo.st')}</th><th></th></tr></thead><tbody>
  ${(CFO_STATE.journal || []).map(j => `<tr${j.status !== 'posted' ? ' style="opacity:.55"' : ''}><td class="mono">${esc(j.entry_no)}</td><td>${fD(j.date)}</td><td>${esc(j.memo || '—')}${j.created_by_name ? `<br><small class="text-muted">${t('cfo.by')} @${esc(j.created_by_name)}</small>` : ''}</td><td><span class="badge bdg-blue">${esc(j.source_type)}${j.source_id ? ' #' + esc(j.source_id) : ''}</span></td><td>${(j.lines || []).map(l => `<div><span class="mono">${esc(l.account_code)}</span> ${Number(l.debit) ? `<span class="c-green">${t('cfo.debit')} ${fC(l.debit)}</span>` : `<span class="c-red">${t('cfo.credit')} ${fC(l.credit)}</span>`}</div>`).join('')}</td><td>${j.status === 'posted' ? `<span class="badge bdg-green">${t('cfo.posted')}</span>` : `<span class="badge bdg-gray">${t('cfo.voided')}</span>`}</td><td>${(j.status === 'posted' && typeof cfoCanWrite === 'function' && cfoCanWrite()) ? `<button class="btn btn-red btn-sm" onclick="cfoVoidEntry('${j.id}')">${t('cfo.voidBtn')}</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="u-empty-sm">لا قيود بعد</td></tr>'}
  </tbody></table></div></div>`;
}
function cfoJournalModal(){
  const opts = (CFO_STATE.chart || []).filter(c => c.is_postable && c.is_active).map(c => `<option value="${esc(c.code)}">${esc(c.code)} — ${esc(c.name_ar)}</option>`).join('');
  const row = (i) => `<tr><td><select id="jlAcc${i}" style="width:100%">${opts}</select></td><td><input type="number" id="jlDr${i}" min="0" step="0.01" style="width:100%"></td><td><input type="number" id="jlCr${i}" min="0" step="0.01" style="width:100%"></td></tr>`;
  showModal(`<h3><i class=ji data-i=plus></i> قيد يدوي متوازن</h3>
  <div class="fr"><div class="fg"><label>التاريخ</label><input type="date" id="jlDate" value="${today()}"></div>
  <div class="fg"><label>البيان</label><input type="text" id="jlMemo" placeholder="شرح القيد"></div></div>
  <table style="width:100%"><thead><tr><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${row(0)}${row(1)}${row(2)}${row(3)}</tbody></table>
  <div class="text-muted" style="font-size:12px;margin-top:8px">اترك السطور الزائدة فارغة — يجب تساوي المدين والدائن.</div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="cfoSaveJournal()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`, 'modal-wide');
}
async function cfoSaveJournal(){
  const lines = [];
  for(let i = 0; i < 4; i++){
    const account_code = document.getElementById('jlAcc' + i)?.value;
    const debit = parseFloat(document.getElementById('jlDr' + i)?.value) || 0;
    const credit = parseFloat(document.getElementById('jlCr' + i)?.value) || 0;
    if(account_code && (debit > 0 || credit > 0)) {lines.push({ account_code, debit, credit });}
  }
  showLoad();
  try{
    await apiFetch('/accounting/journal', { method: 'POST', body: JSON.stringify({ date: document.getElementById('jlDate')?.value, memo: document.getElementById('jlMemo')?.value, lines }) });
    closeModal(); toast('تم ترحيل القيد', 'success'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر ترحيل القيد', 'error'); }
  finally{ hideLoad(); }
}
async function cfoPostPayroll(){
  showModal(`<h3><i class=ji data-i=banknote></i> ${t('cfo.payTitle')}</h3>
  <div class="fg"><label>${t('cfo.month')} (YYYY-MM)</label><input type="month" id="cfoPayMonth" value="${new Date().toISOString().slice(0, 7)}"></div>
  <div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="cfoConfirmPostPayroll()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function cfoConfirmPostPayroll(){
  const m = document.getElementById('cfoPayMonth')?.value || '';
  if(!/^\d{4}-\d{2}$/.test(m)){ toast('الشهر بصيغة YYYY-MM', 'error'); return; }
  showLoad();
  try{
    const r = await apiFetch('/accounting/post-payroll', { method: 'POST', body: JSON.stringify({ month: m }) });
    closeModal(); toast(`رُحّلت رواتب ${m}: ${r.total}`, 'success'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر الترحيل', 'error'); }
  finally{ hideLoad(); }
}
async function cfoVoidEntry(id){
  if(!confirm(t('cfo.confirmVoid'))) {return;}
  showLoad();
  try{
    await apiFetch(`/accounting/journal/${id}/void`, { method: 'POST', body: JSON.stringify({}) });
    toast('أُلغي القيد (يبقى للمراجعة)', 'warning'); await renderCfoPage();
  }catch(e){ toast(e.message || 'تعذر الإلغاء', 'error'); }
  finally{ hideLoad(); }
}
function cfoPrintShell(title, body){
  const w = window.open('', '_blank');
  if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
  w.document.write(`<!DOCTYPE html><html dir="${STATE.lang === 'en' ? 'ltr' : 'rtl'}"><head><meta charset="UTF-8"><title>${esc(title)}</title>
  <style>body{font-family:'Cairo',Arial,sans-serif;padding:28px;color:#1a1a1a}
  .hd{text-align:center;border-bottom:3px solid #b45309;padding-bottom:14px;margin-bottom:18px}
  .hd h1{margin:0 0 4px;color:#b45309;font-size:24px}.hd p{margin:3px 0;color:#555;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:8px;text-align:center;font-size:13px}
  th{background:#f4ead2}.tot td{font-weight:900;background:#fafafa}
  .sig{display:flex;justify-content:space-between;margin-top:48px}.sig div{border-top:1px solid #555;padding-top:6px;width:28%;text-align:center;font-size:12px}
  .controls{text-align:center;margin-bottom:16px}.controls button{padding:9px 22px;margin:0 6px;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-family:inherit}.btn-print{background:#2e9e5b;color:#fff}.btn-close{background:#c0392b;color:#fff}
  @media print{.controls{display:none}body{padding:0}}</style></head><body>
  <div class="controls"><button class="btn-print" onclick="window.print()">طباعة</button><button class="btn-close" onclick="window.close()">إغلاق</button></div>
  <div class="hd"><h1>${esc(STATE.settings.name)}</h1><p>${esc(title)}</p><p>${esc(CFO_STATE.from)} → ${esc(CFO_STATE.to)}</p></div>
  ${body}
  <div class="sig"><div>إعداد المحاسب</div><div>مراجعة المدير المالي</div><div>اعتماد الإدارة</div></div>
  </body></html>`);
  w.document.close();
  setTimeout(() => w.focus(), 400);
}
function cfoPrintTB(){
  const tb = CFO_STATE.tb; if(!tb) {return;}
  const rows = tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).map(a =>
    `<tr><td>${esc(a.code)}</td><td>${esc(a.name_ar)}</td><td>${esc(a.type)}</td><td>${fN(a.debit)}</td><td>${fN(a.credit)}</td><td>${fN(Number(a.debit) - Number(a.credit))}</td></tr>`).join('');
  cfoPrintShell(`${t('cfo.tbTitle')} — ${tb.balanced ? t('cfo.balanced') : t('cfo.unbalanced')}`,
    `<table><thead><tr><th>${t('cfo.code')}</th><th>${t('cfo.account')}</th><th>${t('cfo.type')}</th><th>${t('cfo.debit')}</th><th>${t('cfo.credit')}</th><th>${t('cfo.balance')}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr class="tot"><td colspan="3">${t('rev.total')}</td><td>${fN(tb.total_debit)}</td><td>${fN(tb.total_credit)}</td><td></td></tr></tfoot></table>`);
}
function cfoPrintJournal(){
  const rows = (CFO_STATE.journal || []).map(j =>
    `<tr><td>${esc(j.entry_no)}</td><td>${esc(String(j.date).slice(0, 10))}</td><td>${esc(j.memo || '—')}</td><td>${esc(j.source_type)}${j.source_id ? ' #' + esc(String(j.source_id)).slice(-8) : ''}</td><td>${(j.lines || []).map(l => `${esc(l.account_code)}: ${Number(l.debit) ? 'مدين ' + fN(l.debit) : 'دائن ' + fN(l.credit)}`).join('<br>')}</td><td>${j.status === 'posted' ? t('cfo.posted') : t('cfo.voided')}</td></tr>`).join('');
  cfoPrintShell(t('cfo.journalTitle'), `<table><thead><tr><th>${t('cfo.entryNo')}</th><th>${t('cfo.date')}</th><th>${t('cfo.memo')}</th><th>${t('cfo.source')}</th><th>${t('cfo.lines')}</th><th>${t('cfo.st')}</th></tr></thead><tbody>${rows}</tbody></table>`);
}
function cfoPrintSummary(){
  const s = CFO_STATE.summary; if(!s) {return;}
  const kv = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  cfoPrintShell(t('pg.cfo'), `<table><tbody>
  ${kv(t('cfo.revenue'), fC(s.revenue.total))}${kv(t('cfo.expenses'), fC(s.expenses.total))}
  ${kv(t('cfo.net'), fC(s.net_approx))}${kv(t('cfo.cash'), fC(s.cash_position))}
  ${kv(t('cfo.invoices'), fC(s.pos.total) + ` (${s.pos.invoices})`)}
  ${(s.top_expense_categories || []).map(c => kv('— ' + esc(c.category), fC(c.total))).join('')}
  </tbody></table>`);
}
function cfoExportTB(){
  const tb = CFO_STATE.tb; if(!tb) {return;}
  const data = [[t('cfo.code'), t('cfo.account'), t('cfo.type'), t('cfo.debit'), t('cfo.credit'), t('cfo.balance')]];
  tb.accounts.filter(a => Number(a.debit) || Number(a.credit)).forEach(a =>
    data.push([a.code, a.name_ar, a.type, Number(a.debit), Number(a.credit), Number(a.debit) - Number(a.credit)]));
  data.push(['', '', '', tb.total_debit, tb.total_credit, '']);
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TB');
  XLSX.writeFile(wb, `trial-balance_${CFO_STATE.from}_${CFO_STATE.to}.xlsx`);
  toast('تم تحميل ميزان المراجعة', 'success');
}
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
case 'procurement': html=renderProcurement(); break;
case 'shelves': html=renderShelves(); break;
case 'weight': html=renderWeight(); break;
case 'dispatch': html=renderDispatch(); break;
case 'kitchen': html=renderKitchen(); break;
case 'recipes': html=renderRecipes(); break;
case 'reports': html=renderReports(); break;
case 'settings': html=renderSettings(); break;
case 'users': html=renderUsers(); break;
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
updateDateInputs();
generateReport();
},100);
}
}
// PWA — تثبيت + شريط عدم الاتصال: نُقل إلى js/core/pwa.js (يجسر عبر js/main.js — BRIDGE-001)

// ============================================
// CRITICAL GLOBAL FUNCTIONS (Login Screen)
// MUST be exposed before DOMContentLoaded to ensure
// inline onclick handlers on the login page always work,
// even if initialization inside DOMContentLoaded throws.
// ============================================
(function exposeLoginCriticalGlobals(){
  const w = window;
  // Auth & login
  w.doLogin = doLogin;
  w.doLogout = doLogout;
  w.completeRequiredPasswordChange = typeof completeRequiredPasswordChange !== 'undefined' ? completeRequiredPasswordChange : null;
  w.enterApp = typeof enterApp !== 'undefined' ? enterApp : null;
  // Forgot password flow
  w.showForgotPasswordModal = showForgotPasswordModal;
  w.submitForgotPassword = typeof submitForgotPassword !== 'undefined' ? submitForgotPassword : null;
  w.fpFail = typeof fpFail !== 'undefined' ? fpFail : null;
  w.issueResetCode = typeof issueResetCode !== 'undefined' ? issueResetCode : null;
  w.copyResetCode = typeof copyResetCode !== 'undefined' ? copyResetCode : null;
  // Session refresh & tokens
  w.KARIM_RTget = KARIM_RTget;
  w.KARIM_RTset = KARIM_RTset;
  w.KARIM_RTclear = KARIM_RTclear;
  w.refreshSession = refreshSession;
  // UI toggles used before/after login
  w.toggleLang = toggleLang;
  w.toggleTheme = toggleTheme;
  w.toggleSidebar = typeof toggleSidebar !== 'undefined' ? toggleSidebar : null;
  w.toggleFabMenu = typeof toggleFabMenu !== 'undefined' ? toggleFabMenu : null;
  // PWA — extracted to js/core/pwa.js (bridged by js/main.js — BRIDGE-001)
  // Navigation (used by FAB menu even before login)
  w.go = typeof go !== 'undefined' ? go : function(){};
  // Modals & toasts
  w.closeModal = typeof closeModal !== 'undefined' ? closeModal : function(){};
  // toast → js/ui/toast.js (BRIDGE-004 — main.js يعرّفها على window قبل app.js)
  w.showModal = typeof showModal !== 'undefined' ? showModal : function(){};
  // showLoad → js/ui/toast.js (BRIDGE-004)
  // hideLoad → js/ui/toast.js (BRIDGE-004)
  // Health/init
  w.initDatabase = initDatabase;
  // I18n login screen
  w.applyLoginI18n = applyLoginI18n;
  w.applyLangAttrs = applyLangAttrs;
  // Date helpers
  w.toggleDateMode = typeof toggleDateMode !== 'undefined' ? toggleDateMode : function(){};
  w.syncGregToHijri = typeof syncGregToHijri !== 'undefined' ? syncGregToHijri : function(){};
  w.syncHijriToGreg = typeof syncHijriToGreg !== 'undefined' ? syncHijriToGreg : function(){};
  // Command palette (keyboard shortcut Ctrl+K)
  w.openCommandPalette = typeof openCommandPalette !== 'undefined' ? openCommandPalette : function(){};
  w.closeCommandPalette = typeof closeCommandPalette !== 'undefined' ? closeCommandPalette : function(){};
  w.handleCommandKey = typeof handleCommandKey !== 'undefined' ? handleCommandKey : function(){};
  // FAB actions visible even before login
  w.showDispatchRequestModal = typeof showDispatchRequestModal !== 'undefined' ? showDispatchRequestModal : function(){};
  w.showAddRevenueModal = typeof showAddRevenueModal !== 'undefined' ? showAddRevenueModal : function(){};
  w.showAddExpenseModal = typeof showAddExpenseModal !== 'undefined' ? showAddExpenseModal : function(){};
  // Notifications
  w.showNotifications = showNotifications;
  w.markAllNotificationsRead = markAllNotificationsRead;
  w.clearAllNotifications = clearAllNotifications;
  w.markNotificationRead = markNotificationRead;
  w.openNotification = typeof openNotification !== 'undefined' ? openNotification : function(){};
  w.navigateNotification = typeof navigateNotification !== 'undefined' ? navigateNotification : function(){};
  w.refreshNotifications = typeof refreshNotifications !== 'undefined' ? refreshNotifications : function(){};
  w.updateNotificationBadge = updateNotificationBadge;

  const loginButton = document.getElementById('loginBtn');
  if (loginButton && !loginButton.dataset.loginBound) {
    loginButton.addEventListener('click', doLogin);
    loginButton.dataset.loginBound = 'true';
  }
  const passwordInput = document.getElementById('lp');
  if (passwordInput && !passwordInput.dataset.loginBound) {
    passwordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { doLogin(); }
    });
    passwordInput.dataset.loginBound = 'true';
  }
})();

// ============================================
// INITIALIZATION
// ============================================
window.addEventListener('DOMContentLoaded',async ()=>{
showLoad();
// Keep the login screen responsive while the health check runs in the background.
hideLoad();
try{
// Health is public; protected entities must wait until login succeeds.
await initDatabase();
document.documentElement.setAttribute('data-theme',STATE.theme||'light');
pwaUpdateOfflineBar();
hideLoad();
document.getElementById('loginTitle').textContent=STATE.settings.name;
const loginSub=document.getElementById('loginSub');
if(loginSub){ const verEl=document.getElementById('loginVersion'); if(verEl) {verEl.textContent=CONFIG.VERSION;} }
updateLogoDisplay();
updateNotificationBadge();
// جلسة مفتوحة دائمة: استعادة صامتة من رمز التحديث المحفوظ (بلا شاشة دخول)
if (KARIM_RTget() && !STATE.currentUser) {
  try {
    if (await refreshSession()) {
      await enterApp();
      document.getElementById('login').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('restNameDisplay').textContent = STATE.settings.name;
      updateLogoDisplay();
      updateDateDisplay();
      updateRoleIndicator();
      buildNav(); renderPage();
      updateQuickDispatchButton();
      updateNotificationBadge();
      if (typeof window._rtRegisterUser === 'function') {window._rtRegisterUser();}
      refreshNotifications();
    }
  } catch (_) { /* يبقى على شاشة الدخول */ }
}
}catch(err){
hideLoad();
console.error('Initialization error:',err);
// Even if health check fails the first time, keep the login screen
// interactive so the user can retry once the server is up.
try{
  const loginScreen = document.getElementById('login');
  if(loginScreen){ loginScreen.style.display = loginScreen.style.display || 'block'; }
  const loginBtn = document.getElementById('loginBtn');
  if(loginBtn){ loginBtn.disabled = false; loginBtn.removeAttribute('aria-busy'); }
  const loginVersion = document.getElementById('loginVersion');
  if(loginVersion){ loginVersion.textContent = CONFIG.VERSION; }
  updateLogoDisplay();
}catch(_){}
toast((err&&err.message)?('مشكلة في الاتصال: '+err.message):'قاعدة البيانات غير متاحة — جرّب مرة أخرى بعد لحظات','warning');
const content = document.getElementById('content');
if(content){
content.innerHTML = `<div class="mcard" style="margin:20px"><h3 class="u-orange">⚠ تأخر في الاتصال بالخادم</h3><div style="color:var(--text2);line-height:1.9">يمكنك محاولة تسجيل الدخول الآن. إذا استمرت المشكلة، تأكد من تشغيل الخادم ثم أعد تحميل الصفحة.</div></div>`;
}
}
});
// Export remaining non-login functions (keep for safety / backward compat)
window.doLogin=doLogin; window.doLogout=doLogout; window.go=go; window.toggleLang=toggleLang; window.toggleTheme=toggleTheme; window.toggleSidebar=toggleSidebar;
window.showAddRevenueModal=showAddRevenueModal; window.addRevenue=addRevenue; window.editRevenue=editRevenue; window.updateRevenue=updateRevenue; window.deleteRevenue=deleteRevenue;
window.showAddExpenseModal=showAddExpenseModal; window.addExpense=addExpense; window.editExpense=editExpense; window.updateExpense=updateExpense; window.deleteExpense=deleteExpense;
window.showAddDepartmentModal=showAddDepartmentModal; window.addDepartment=addDepartment; window.editDepartment=editDepartment; window.updateDepartment=updateDepartment; window.deleteDepartment=deleteDepartment;
window.showAddItemModal=showAddItemModal; window.addInventoryItem=addInventoryItem; window.editItem=editItem; window.updateInventoryItem=updateInventoryItem; window.deleteItem=deleteItem;
window.showAddPurchaseInvoiceModal=showAddPurchaseInvoiceModal; window.addInvoiceItemRow=addInvoiceItemRow; window.removeInvoiceItemRow=removeInvoiceItemRow; window.updateInvoiceItem=updateInvoiceItem; window.savePurchaseInvoice=savePurchaseInvoice; window.viewPurchaseInvoice=viewPurchaseInvoice; window.printPurchaseInvoice=printPurchaseInvoice; window.showInventoryAuditModal=showInventoryAuditModal; window.showFiscalYearModal=showFiscalYearModal; window.closeFiscalYear=closeFiscalYear; window.createNextFiscalYear=createNextFiscalYear;
window.stocktakSetTab=stocktakSetTab; window.stocktakSetScope=stocktakSetScope; window.stocktakStartSession=stocktakStartSession; window.stocktakOpenSession=stocktakOpenSession; window.stocktakSaveCount=stocktakSaveCount; window.stocktakCountChanged=stocktakCountChanged; window.stocktakClearCount=stocktakClearCount; window.stocktakSubmitSession=stocktakSubmitSession; window.stocktakApproveSession=stocktakApproveSession; window.stocktakCancelSession=stocktakCancelSession; window.stocktakCancelById=stocktakCancelById; window.stocktakPrint=stocktakPrint; window.stocktakPrintById=stocktakPrintById; window.stocktakOnSearch=stocktakOnSearch; window.stocktakToggleDiffs=stocktakToggleDiffs; window.stocktakScanCount=stocktakScanCount; window.stocktakRefreshDetail=stocktakRefreshDetail;
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
window.showAddUserModal=showAddUserModal; window.addUser=addUser; window.editUser=editUser; window.updateUser=updateUser; window.deleteUser=deleteUser; window.showCreateEmployeeAccountModal=showCreateEmployeeAccountModal; window.toggleEmployeeAccountFields=toggleEmployeeAccountFields;
window.saveSettings=saveSettings; window.handleLogoUpload=handleLogoUpload; window.resetLogo=resetLogo;
window.closeModal=closeModal;
window.generateReport=generateReport; window.updateDateInputs=updateDateInputs; window.printReportOnly=printReportOnly;
window.exportAllData=exportAllData; window.resetAllData=resetAllData;
window.showNotifications=showNotifications; window.markNotificationRead=markNotificationRead; window.clearAllNotifications=clearAllNotifications; window.toggleChatPanel=toggleChatPanel; window.sendChatMsg=sendChatMsg; window.pickChatPeer=pickChatPeer; window.backToChatUsers=backToChatUsers;
window.showImportItemsCatalogModal=showImportItemsCatalogModal; window.downloadItemsCatalogTemplate=downloadItemsCatalogTemplate; window.importItemsCatalog=importItemsCatalog; window.previewCatalogFile=previewCatalogFile;
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
window.showBulkInventoryImportModal=showBulkInventoryImportModal; window.downloadInventoryTemplate=downloadInventoryTemplate; window.importBulkInventory=importBulkInventory; window.previewInventoryFile=previewInventoryFile;
 window.switchPortalEmployee=switchPortalEmployee;;
// تصديرات البطاقة الذكية: نُقلت إلى js/features/smart-card.js (يجسر عبر js/main.js — BRIDGE-008)
 window.printEmployeeAttendanceDay=printEmployeeAttendanceDay;; window.printEmployeeAttendanceMonth=printEmployeeAttendanceMonth;;
// ZKTECO biometric page (بصمة الحضور)
// تصديرات البصمة (ZKTECO): نُقلت إلى js/features/zkteco.js (يجسر عبر js/main.js — BRIDGE-010)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
window.showAddShelfModal=showAddShelfModal; window.addShelf=addShelf; window.editShelf=editShelf; window.updateShelf=updateShelf; window.deleteShelf=deleteShelf;
window.adjustWeight=adjustWeight; window.resetWeight=resetWeight; window.setWeightUnit=setWeightUnit; window.recordWeight=recordWeight; window.recordWeightToItem=recordWeightToItem; window.confirmRecordWeightToItem=confirmRecordWeightToItem;
// <i class=ji data-i=circle-check></i> Bulk Import Functions
window.showBulkImportModal=showBulkImportModal; window.bulkReadFile=bulkReadFile; window.bulkNextStep=bulkNextStep; window.bulkClearAll=bulkClearAll; window.bulkDeleteRow=bulkDeleteRow; window.bulkConfirmImport=bulkConfirmImport; window.bulkSelectFormat=bulkSelectFormat; window.bulkExportExcel=bulkExportExcel; window.bulkExportCSV=bulkExportCSV; window.bulkExportJSON=bulkExportJSON; window.bulkCopyAllPasswords=bulkCopyAllPasswords; window.bulkPrint=bulkPrint;

// ============================================
// <i class=ji data-i=palette></i> ENHANCEMENT PACK v10.0 - JS
// ============================================

// <i class=ji data-i=search></i> Command Palette Data & Functions
const COMMAND_ITEMS = [
  {icon:'<i class=ji data-i=chart></i>',title:'لوحة التحكم',subtitle:'عرض الإحصائيات والتقارير السريعة',action:()=>go('dashboard',null),shortcut:'G D'},
  {icon:'<i class=ji data-i=banknote></i>',title:'الإيرادات',subtitle:'إدارة الإيرادات',action:()=>go('revenues',null),shortcut:'G R'},
  {icon:'<i class=ji data-i=wallet></i>',title:'المصاريف',subtitle:'إدارة المصاريف',action:()=>go('expenses',null),shortcut:'G E'},
  {icon:'<i class=ji data-i=package></i>',title:'المخزن',subtitle:'إدارة المخزون',action:()=>go('warehouse',null),shortcut:'G W'},
  {icon:'<i class=ji data-i=chef-hat></i>',title:'المطبخ',subtitle:'إدارة المطبخ',action:()=>go('kitchen',null)},
  {icon:'<i class=ji data-i=clipboard-list></i>',title:'سجل الصرف',subtitle:'عرض طلبات الصرف',action:()=>go('dispatch',null)},
  {icon:'<i class=ji data-i=utensils></i>',title:'الوصفات',subtitle:'إدارة الوصفات',action:()=>go('recipes',null)},
  {icon:'<i class=ji data-i=trending-up></i>',title:'تحليل التكاليف',subtitle:'الإيرادات مقابل المصاريف',action:()=>go('cost-analysis',null),shortcut:'G C'},
  {icon:'<i class=ji data-i=gem></i>',title:'الأرباح والخسائر',subtitle:'قائمة الدخل الحية من الحركات الفعلية',action:()=>go('pnl',null),shortcut:'G P'},
  {icon:'<i class=ji data-i=building></i>',title:'الأقسام',subtitle:'إدارة الأقسام',action:()=>go('departments',null)},
  {icon:'<i class=ji data-i=user></i>',title:'إدارة الموظفين',subtitle:'قائمة الموظفين',action:()=>go('employees',null),shortcut:'G E'},
  {icon:'<i class=ji data-i=timer></i>',title:'الحضور والانصراف',subtitle:'سجل الحضور',action:()=>go('attendance',null)},
  {icon:'<i class=ji data-i=calendar></i>',title:'الإجازات',subtitle:'طلبات الإجازات',action:()=>go('leaves',null)},
  {icon:'<i class=ji data-i=banknote></i>',title:'الرواتب',subtitle:'إدارة الرواتب',action:()=>go('payroll',null)},
  {icon:'<i class=ji data-i=chart></i>',title:'التقارير',subtitle:'إنشاء التقارير',action:()=>go('reports',null)},
  {icon:'<i class=ji data-i=settings></i>',title:'الإعدادات',subtitle:'إعدادات النظام',action:()=>go('settings',null)},
  {icon:'<i class=ji data-i=users></i>',title:'المستخدمين',subtitle:'إدارة المستخدمين',action:()=>go('users',null)},
  {icon:'<i class=ji data-i=plus></i>',title:'إضافة إيراد',subtitle:'إضافة إيراد جديد',action:()=>showAddRevenueModal(),shortcut:'A R'},
  {icon:'<i class=ji data-i=plus></i>',title:'إضافة مصروف',subtitle:'إضافة مصروف جديد',action:()=>showAddExpenseModal(),shortcut:'A E'},
  {icon:'<i class=ji data-i=package></i>',title:'طلب صرف جديد',subtitle:'إنشاء طلب صرف جديد',action:()=>showDispatchRequestModal(),shortcut:'A D'},
  {icon:'<i class=ji data-i=globe></i>',title:'تبديل اللغة',subtitle:'التبديل بين العربية والإنجليزية',action:()=>toggleLang(),shortcut:'L'},
  {icon:'<i class=ji data-i=moon></i>',title:'تبديل المظهر',subtitle:'تبديل المظهر الفاتح/الداكن',action:()=>toggleTheme(),shortcut:'T'},
  {icon:'<i class=ji data-i=log-out></i>',title:'تسجيل الخروج',subtitle:'الخروج من النظام',action:()=>doLogout(),shortcut:'Q'},
];

let commandPaletteSelected = 0;
let commandPaletteFiltered = [];

function openCommandPalette(){
  document.getElementById('commandPalette').classList.add('show');
  document.getElementById('commandInput').value='';
  document.getElementById('commandInput').focus();
  filterCommands('');
}
function closeCommandPalette(){
  document.getElementById('commandPalette').classList.remove('show');
}
function filterCommands(query){
  const q = query.toLowerCase().trim();
  commandPaletteFiltered = COMMAND_ITEMS.filter(item =>
    item.title.includes(q) || (item.subtitle&&item.subtitle.toLowerCase().includes(q)) || item.icon.includes(q)
  );
  commandPaletteSelected = 0;
  renderCommandResults();
}
function renderCommandResults(){
  const container = document.getElementById('commandResults');
  if(commandPaletteFiltered.length === 0){
    container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text3)">لا توجد نتائج</div>';
    return;
  }
  container.innerHTML = commandPaletteFiltered.map((item, idx) => `
    <div class="command-item ${idx === commandPaletteSelected ? 'selected' : ''}" onclick="executeCommand(${idx})">
      <div class="command-item-icon">${item.icon}</div>
      <div class="command-item-text">
        <div class="command-item-title">${item.title}</div>
        ${item.subtitle ? `<div class="command-item-subtitle">${item.subtitle}</div>` : ''}
      </div>
      ${item.shortcut ? `<span class="command-item-shortcut">${item.shortcut}</span>` : ''}
    </div>
  `).join('');
}
function executeCommand(idx){
  if(commandPaletteFiltered[idx]){
    commandPaletteFiltered[idx].action();
    closeCommandPalette();
  }
}
function handleCommandKey(e){
  if(e.key === 'Escape'){ closeCommandPalette(); return; }
  if(e.key === 'ArrowDown'){
    e.preventDefault();
    commandPaletteSelected = Math.min(commandPaletteSelected + 1, commandPaletteFiltered.length - 1);
    renderCommandResults();
    return;
  }
  if(e.key === 'ArrowUp'){
    e.preventDefault();
    commandPaletteSelected = Math.max(commandPaletteSelected - 1, 0);
    renderCommandResults();
    return;
  }
  if(e.key === 'Enter'){
    e.preventDefault();
    executeCommand(commandPaletteSelected);
    return;
  }
}
document.getElementById('commandInput')?.addEventListener('input', (e)=>filterCommands(e.target.value));
document.getElementById('commandInput')?.addEventListener('keydown', handleCommandKey);
document.getElementById('commandPalette')?.addEventListener('click',(e)=>{ if(e.target.id==='commandPalette') {closeCommandPalette();} });

// <i class=ji data-i=target></i> FAB Functions
function toggleFabMenu(){
  const menu = document.getElementById('fabMenu');
  if(menu) {menu.classList.toggle('show');}
}
document.addEventListener('click',(e)=>{
  const fab = document.getElementById('fabBtn');
  const menu = document.getElementById('fabMenu');
  if(fab && menu && !fab.contains(e.target) && !menu.contains(e.target)){
    menu.classList.remove('show');
  }
});

// Keyboard activation for shell controls marked data-kb-activate
// (div-based buttons keep their inline onclick untouched; Enter/Space
// simply replays a click so mouse behavior is 100% unchanged).
document.addEventListener('keydown', (e) => {
  if(e.key !== 'Enter' && e.key !== ' ') {return;}
  const t = e.target && e.target.closest ? e.target.closest('[data-kb-activate]') : null;
  if(!t) {return;}
  const tag = e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {return;}
  e.preventDefault();
  t.click();
});

// <i class=ji data-i=keyboard></i> Global Keyboard Shortcuts
let keyboardSequence = '';
let keyboardTimeout = null;
document.addEventListener('keydown', (e) => {
  // Ignore when typing in inputs
  const tag = e.target.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable){
    if(e.ctrlKey && e.key === 'k'){
      e.preventDefault();
      openCommandPalette();
    }
    return;
  }
  // Ctrl+K - Command Palette
  if((e.ctrlKey || e.metaKey) && e.key === 'k'){
    e.preventDefault();
    openCommandPalette();
    return;
  }
  // Slash - Command Palette
  if(e.key === '/' && !e.ctrlKey){
    e.preventDefault();
    openCommandPalette();
    return;
  }
  // ? - Show shortcuts help
  if(e.key === '?' && e.shiftKey){
    e.preventDefault();
    showShortcutsHelp();
    return;
  }
  // Ctrl+/ - Toggle sidebar
  if(e.ctrlKey && e.key === '/'){
    e.preventDefault();
    toggleSidebar();
    return;
  }
  // Escape - Close command palette / FAB
  if(e.key === 'Escape'){
    closeCommandPalette();
    const menu = document.getElementById('fabMenu');
    if(menu) {menu.classList.remove('show');}
    closeModal();
    return;
  }
  // Single key shortcuts (only when not in input)
  if(!e.ctrlKey && !e.metaKey && !e.altKey){
    const key = e.key.toLowerCase();
    // Gmail-style sequences (g then letter)
    if(keyboardSequence === 'g'){
      const map = {d:'dashboard',r:'revenues',e:'employees',w:'warehouse',c:'cost-analysis'};
      if(map[key]){ e.preventDefault(); go(map[key], null); keyboardSequence = ''; return; }
    }
    if(key === 'g'){
      keyboardSequence = 'g';
      clearTimeout(keyboardTimeout);
      keyboardTimeout = setTimeout(()=>{ keyboardSequence = ''; }, 800);
      return;
    }
    // Single shortcuts
    const singleMap = {
      'l': ()=>toggleLang(),
      't': ()=>toggleTheme(),
      'q': ()=>doLogout(),
      'n': ()=>{ if(typeof showAddRevenueModal==='function') {showAddRevenueModal();} }
    };
    if(singleMap[key]){
      e.preventDefault();
      singleMap[key]();
      keyboardSequence = '';
      return;
    }
  }
});

function showShortcutsHelp(){
  showModal(`
    <h3 style="color:var(--gold);font-weight:900;margin-bottom:20px"><i class=ji data-i=keyboard></i> اختصارات لوحة المفاتيح</h3>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=search></i> البحث</div>
        <div class="u-t13"><kbd class="u-chip">Ctrl + K</kbd> أو <kbd class="u-chip">/</kbd> فتح لوحة الأوامر</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=globe></i> اللغة والوضع</div>
        <div class="u-t13"><kbd class="u-chip">L</kbd> تبديل اللغة</div>
        <div class="u-t13"><kbd class="u-chip">T</kbd> تبديل المظهر</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=chart></i> التنقل السريع</div>
        <div class="u-t13"><kbd class="u-chip">G D</kbd> لوحة التحكم</div>
        <div class="u-t13"><kbd class="u-chip">G R</kbd> الإيرادات</div>
        <div class="u-t13"><kbd class="u-chip">G E</kbd> الموظفين</div>
        <div class="u-t13"><kbd class="u-chip">G W</kbd> المخزن</div>
      </div>
      <div class="glass u-pad-card">
        <div class="u-num-hero"><i class=ji data-i=zap></i> أخرى</div>
        <div class="u-t13"><kbd class="u-chip">Ctrl + /</kbd> طي القائمة</div>
        <div class="u-t13"><kbd class="u-chip">?</kbd> عرض هذه المساعدة</div>
        <div class="u-t13"><kbd class="u-chip">Esc</kbd> إغلاق النوافذ</div>
        <div class="u-t13"><kbd class="u-chip">Q</kbd> تسجيل الخروج</div>
      </div>
    </div>
    <div class="modal-footer" style="margin-top:20px">
      <button class="btn btn-gold" onclick="closeModal()">فهمت</button>
    </div>
  `, 'modal-lg');
}

// <i class=ji data-i=party></i> Confetti Celebration
function celebrate(){
  const colors = ['#d4a843','#f0c96b','#2ecc71','#3498db','#9b59b6','#e74c3c'];
  const emojis = ['<i class=ji data-i=party></i>','<i class=ji data-i=party></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>','<i class=ji data-i=star></i>'];
  for(let i = 0; i < 50; i++){
    setTimeout(()=>{
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.left = Math.random() * window.innerWidth + 'px';
      conf.style.top = '-20px';
      conf.style.background = colors[Math.floor(Math.random()*colors.length)];
      conf.style.fontSize = (Math.random() * 20 + 10) + 'px';
      if(Math.random() > 0.5) {conf.textContent = emojis[Math.floor(Math.random()*emojis.length)];}
      conf.style.transform = `rotate(${Math.random()*360}deg)`;
      document.body.appendChild(conf);
      const x = (Math.random() - 0.5) * 200;
      const y = window.innerHeight + 50;
      conf.style.setProperty('--x', x + 'px');
      conf.style.setProperty('--y', y + 'px');
      setTimeout(()=>conf.remove(), 2000);
    }, i * 30);
  }
}

// <i class=ji data-i=star></i> Particle Effect on click
document.addEventListener('click', (e) => {
  // Don't spawn particles on buttons/inputs to avoid noise
  if(e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) {return;}
  if(Math.random() > 0.85){ // Only sometimes
    spawnParticle(e.clientX, e.clientY, '<i class=ji data-i=star></i>');
  }
});
function spawnParticle(x, y, emoji){
  const p = document.createElement('div');
  p.className = 'particle';
  p.textContent = emoji;
  p.style.left = x + 'px';
  p.style.top = y + 'px';
  const xMove = (Math.random() - 0.5) * 100;
  const yMove = -Math.random() * 80 - 20;
  p.style.setProperty('--x', xMove + 'px');
  p.style.setProperty('--y', yMove + 'px');
  document.body.appendChild(p);
  setTimeout(()=>p.remove(), 1000);
}

// <i class=ji data-i=play></i> Splash Screen Hide
function hideSplash(){
  const splash = document.getElementById('splashScreen');
  if(splash){
    setTimeout(()=>{
      splash.classList.add('hide');
      setTimeout(()=>splash.remove(), 800);
    }, 2200);
  }
}

// <i class=ji data-i=clock></i> Live Clock
let _liveClockTimer = null;
function startLiveClock(){
  // Re-rendering the dashboard used to start a NEW untracked 1s interval on
  // every render — dozens of timers accumulating CPU and touching removed DOM.
  if (_liveClockTimer) {clearInterval(_liveClockTimer);}
  function update(){
    const el = document.getElementById('liveClock');
    if(el){
      const now = new Date();
      el.textContent = now.toLocaleTimeString('en-US',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
    }
    const dateEl = document.getElementById('liveDate');
    if(dateEl){
      const now = new Date();
      const days = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
      dateEl.textContent = `${days[now.getDay()]} · ${now.toLocaleDateString('en-GB')}`;
    }
  }
  update();
  _liveClockTimer = setInterval(update, 1000);
}

// <i class=ji data-i=palette></i> Welcome Banner Injection (for Dashboard)
function injectWelcomeBanner(){
  const content = document.getElementById('content');
  if(!content || !STATE.currentUser) {return;}
  // Only on dashboard
  if(STATE.page !== 'dashboard') {return;}
  const role = STATE.currentUser.role;
  const name = STATE.currentUser.name || 'مستخدم';
  const greeting = (()=>{
    const h = new Date().getHours();
    if(h < 12) {return 'صباح الخير';}
    if(h < 18) {return 'مساء الخير';}
    return 'مساء النور';
  })();
  const roleIcon = (ROLES[role]||{}).icon || '<i class=ji data-i=user></i>';
  const banner = document.createElement('div');
  banner.className = 'welcome-banner';
  banner.innerHTML = `
    <div class="welcome-icon">${roleIcon}</div>
    <div class="welcome-text">
      <div class="welcome-title">${greeting}، ${name} <i class=ji data-i=user-check></i></div>
      <div class="welcome-sub">إليك ملخص سريع لنشاطك اليوم</div>
      <div id="liveDate" style="color:var(--text3);font-size:12px;margin-top:4px"></div>
    </div>
    <div class="welcome-time" id="liveClock">00:00:00</div>
  `;
  content.insertBefore(banner, content.firstChild);
  startLiveClock();
}

// <i class=ji data-i=target></i> Enhanced toast
const _origToast = window.toast || toast;
function enhancedToast(msg, type='success'){
  const container = document.getElementById('toasts');
  if(!container) {return;}
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  const icons = {success:'<i class=ji data-i=circle-check></i>',error:'<i class=ji data-i=circle-x></i>',warning:'<i class=ji data-i=alert-triangle></i>',info:'<i class=ji data-i=info></i>'};
  t.innerHTML = `<span style="font-size:18px">${icons[type]||'<i class=ji data-i=info></i>'}</span><span style="flex:1;font-size:13px">${msg}</span>`;
  container.appendChild(t);
  setTimeout(()=>{
    t.classList.add('removing');
    setTimeout(()=>t.remove(), 300);
  }, 3000);
  if(type === 'success' && Math.random() > 0.7){
    setTimeout(()=>spawnParticle(window.innerWidth/2, 100, '<i class=ji data-i=party></i>'), 100);
  }
}
window.enhancedToast = enhancedToast;

// <i class=ji data-i=chart></i> Animated Counter
function animateCounter(element, target, duration = 1500, prefix = '', suffix = ''){
  if(!element) {return;}
  const start = 0;
  const startTime = performance.now();
  function update(now){
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * easeOut;
    element.textContent = prefix + (Number.isInteger(target) ? Math.floor(current).toLocaleString('en-US') : current.toFixed(1).toLocaleString('en-US')) + suffix;
    if(progress < 1) {requestAnimationFrame(update);}
    else {element.textContent = prefix + (Number.isInteger(target) ? target.toLocaleString('en-US') : target.toFixed(1).toLocaleString('en-US')) + suffix;}
  }
  requestAnimationFrame(update);
}

// <i class=ji data-i=star></i> Auto-enhance page on render
const _origRenderPage = window.renderPage;
window.renderPage = async function(){
  if(_origRenderPage) {await _origRenderPage();}
  setTimeout(()=>{
    // Auto-inject welcome banner on dashboard
    if(STATE.page === 'dashboard'){
      injectWelcomeBanner();
    }
    // Add live-dot to topbar time
    const pageTitle = document.getElementById('pageTitle');
    if(pageTitle && !pageTitle.querySelector('.live-dot')){
      // Already styled
    }
    // Auto-number stats with animation
    document.querySelectorAll('.mcard-val, .metric-card-premium .value').forEach(el => {
      const txt = el.textContent;
      const numMatch = txt.match(/[\d,]+\.?\d*/);
      if(numMatch){
        const num = parseFloat(numMatch[0].replace(/,/g, ''));
        if(!isNaN(num) && num < 1000000){
          // Skip animation for static elements to avoid disruption
        }
      }
    });
  }, 50);
};

// <i class=ji data-i=play></i> Initialize enhancements
document.addEventListener('DOMContentLoaded', () => {
  hideSplash();
  setTimeout(hideSplash, 3000); // Fallback in case hideSplash is delayed
  // Add keyboard shortcut hint to topbar
  setTimeout(()=>{
    const topbarRight = document.querySelector('.topbar-right');
    if(topbarRight && !document.getElementById('shortcutBtn')){
      const btn = document.createElement('div');
      btn.id = 'shortcutBtn';
      btn.className = 'topbar-btn';
      btn.style.cssText = 'cursor:pointer;background:var(--gold-d);border:1px solid var(--gold);color:var(--gold);font-weight:700';
      btn.innerHTML = '<i class=ji data-i=search></i> Ctrl+K';
      btn.onclick = openCommandPalette;
      btn.title = 'افتح لوحة الأوامر (Ctrl+K)';
      topbarRight.insertBefore(btn, topbarRight.firstChild);
    }
  }, 500);
});

// Export new functions globally
window.openCommandPalette = openCommandPalette;
window.closeCommandPalette = closeCommandPalette;
window.toggleFabMenu = toggleFabMenu;
window.celebrate = celebrate;
window.showShortcutsHelp = showShortcutsHelp;
window.animateCounter = animateCounter;

// <i class=ji data-i=play></i> Init particle background for login
(function initLoginParticles(){
  if(!document.getElementById('login')) {return;}
  const login = document.getElementById('login');
  // Add animated grid background
  const grid = document.createElement('div');
  grid.style.cssText = 'position:absolute;inset:0;background-image:linear-gradient(rgba(212,168,67,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(212,168,67,0.03) 1px,transparent 1px);background-size:50px 50px;pointer-events:none;z-index:0';
  login.insertBefore(grid, login.firstChild);
})();

// لغة الجهاز المحفوظة تُطبق فور تحميل الصفحة (حتى شاشة الدخول)
try{const _L=readLangLocal();if(_L){STATE.lang=_L;}applyLangAttrs();}catch(_){}
