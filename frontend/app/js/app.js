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
// ============================================
// YARASOFT POS IMPORT PAGE (استيراد فواتير نقاط البيع)
// ============================================
const YSSTATE = { tab:'status', status:null, log:[], review:[], mappings:null };

async function renderYarasoftPage(){
const content = document.getElementById('content');
const canWrite = ['admin','manager'].includes(STATE.currentUser?.role);
content.innerHTML = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
<h3 class="u-gold-strong"><i class=ji data-i=shopping-cart></i> استيراد فواتير Yarasoft</h3>
<div class="u-row-wrap">
${canWrite?`<button class="btn btn-green" onclick="ysRunNow()"><i class=ji data-i=refresh></i> تشغيل الآن</button>`:''}
<button class="btn btn-blue btn-sm" onclick="ysRefresh()"><i class=ji data-i=refresh></i> تحديث</button>
</div>
</div>
<div class="u-row-wrap" style="gap:8px;margin-bottom:14px" id="ysTabs">
<button class="btn btn-sm ${YSSTATE.tab==='status'?'btn-gold':''}" onclick="ysSetTab('status')"><i class=ji data-i=chart></i> الحالة والسجل</button>
<button class="btn btn-sm ${YSSTATE.tab==='review'?'btn-gold':''}" onclick="ysSetTab('review')"><i class=ji data-i=alert-triangle></i> مراجعة الأصناف</button>
<button class="btn btn-sm ${YSSTATE.tab==='sections'?'btn-gold':''}" onclick="ysSetTab('sections')"><i class=ji data-i=layout-grid></i> أقسام الإيرادات</button>
<button class="btn btn-sm ${YSSTATE.tab==='warehouse'?'btn-gold':''}" onclick="ysSetTab('warehouse')"><i class=ji data-i=package></i> مخازن يارا سوفت</button>
<button class="btn btn-sm ${YSSTATE.tab==='mappings'?'btn-gold':''}" onclick="ysSetTab('mappings')"><i class=ji data-i=tag></i> ربط المنتجات</button>
<button class="btn btn-sm ${YSSTATE.tab==='tools'?'btn-gold':''}" onclick="ysSetTab('tools')"><i class=ji data-i=settings></i> معاينة الصيغة</button>
</div>
<div id="ysBody"><div class="mcard u-empty"><div class="spinner"></div></div></div>`;
await ysRefresh();
}
async function ysRefresh(){
try{
const [status, log] = await Promise.all([
apiFetch('/yarasoft/status').catch(()=>null),
apiFetch('/yarasoft/log?limit=150').catch(()=>[])
]);
YSSTATE.status = status;
YSSTATE.log = Array.isArray(log)?log:[];
ysRenderBody();
ysLoadOracleBox();
}catch(e){
const body=document.getElementById('ysBody');
if(body) {body.innerHTML = `<div class="mcard u-empty">تعذر تحميل بيانات Yarasoft: ${esc(e.message)}</div>`;}
}
}
// ─── بطاقة الربط المباشر Oracle (قراءة حية من قاعدة يارسوفت) ───
async function ysLoadOracleBox(){
  const box = document.getElementById('ysOracleBox');
  if(!box) {return;}
  let o = null;
  try{ o = await apiFetch('/yarasoft/oracle/status').catch(()=>null); }catch(_){ o = null; }
  const d = o?.oracle;
  if(!d){ box.innerHTML = ''; return; }
  const canW = ['admin','manager'].includes(STATE.currentUser?.role);
  const stateBadge = !d.enabled ? '<span class="badge bdg-orange">معطّل (إعداد)</span>'
    : d.driver === false ? '<span class="badge bdg-red">بانتظار مكتبة oracledb</span>'
    : d.running ? '<span class="badge bdg-green">يعمل</span>' : '<span class="badge bdg-blue">جاهز</span>';
  box.innerHTML = `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=database></i> الربط المباشر — قاعدة يارسوفت (Oracle)</h3>
  <div class="u-row-wrap">${stateBadge}${canW ? `<button class="btn btn-green btn-sm" onclick="ysOraclePollNow()"><i class=ji data-i=zap></i> سحب الآن</button><button class="btn btn-gold btn-sm" onclick="ysOracleTest()"><i class=ji data-i=activity></i> فحص الاتصال</button><button class="btn btn-blue btn-sm" onclick="ysOracleImportItems()"><i class=ji data-i=package></i> استيراد الأصناف</button>` : ''}</div></div>
  <div style="padding:10px 14px" class="text-muted">الخادم <bdi dir="ltr">${esc(d.host)}:${d.port}/${esc(d.service)}</bdi> — المستخدم <bdi dir="ltr">${esc(d.hasUser ? 'مضبوط' : 'ناقص')}</bdi> — كلمة المرور <bdi>${d.hasPassword ? 'مضبوطة' : 'ناقصة'}</bdi> — Thick mode <bdi>${d.thick ? 'مفعّل' : '—'}</bdi>${d.lastOk ? ` — آخر سحب ناجح: ${esc(d.lastOk)}` : ''}${d.lastError ? `<br><b style="color:var(--red)">آخر خطأ:</b> ${esc(d.lastError)}` : ''}${d.driver === false ? `<br><small>يحتاج: <bdi dir="ltr">npm install oracledb</bdi> + Instant Client 12.2 (لقاعدة قديمة) ثم تفعيل YARASOFT_ORACLE_ENABLED — كلمة المرور لا تظهر هنا أبدًا.</small>` : `<br><small>المكتبة والربط جاهزان — كلمة المرور لا تظهر هنا أبدًا.</small>`}</div></div>`;
}
async function ysOracleImportItems(){
  showLoad();
  try{
    const p = await apiFetch('/yarasoft/oracle/import-items/preview');
    if(!p.ok){ toast(p.error || 'تعذرت المعاينة', 'error'); return; }
    hideLoad();
    if(!p.fresh){ toast(`لا جديد — ${p.skipped} صنف موجود مسبقًا`, 'success'); return; }
    if(!confirm(`استيراد ${p.fresh} صنف جديد من يارسوفت للمخزون؟\n(كمية صفر + ربط تلقائي — ${p.skipped} موجود يُتخطى)`)) {return;}
    showLoad();
    const r = await apiFetch('/yarasoft/oracle/import-items', { method: 'POST' });
    if(r.ok) {toast(`تم استيراد ${r.imported} صنف (تُخطي ${r.skipped})`, 'success');}
    else {toast(r.error || 'تعذر الاستيراد', 'error');}
    await window.loadData().catch(() => {});
  }catch(e){ toast(e.message || 'تعذر الاستيراد', 'error'); }
  finally{ hideLoad(); }
}
async function ysOraclePollNow(){
  showLoad();
  try{
    const r = await apiFetch('/yarasoft/oracle/poll-now', { method: 'POST' });
    if(r.ok !== false) {toast(`تم السحب الفوري — ${r.rows || 0} سطرًا من Oracle`, 'success');}
    else {toast(r.error || 'تعذر السحب', 'error');}
    await window.loadData().catch(()=>{});
    await ysRefresh();
  }catch(e){ toast(e.message || 'تعذر السحب الفوري', 'error'); }
  finally{ hideLoad(); }
}
// ─── محرك المزامنة الذكي (واجهة) ───
async function ysReconcile(){
const box=document.getElementById('ysSyncDocBody'); if(!box) {return;}
box.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/yarasoft/oracle/reconcile?days=14');
const rows=(d.rows||[]).map(r=>`<tr>
<td class="fw-bold">${esc(r.day)}</td><td>${fN(r.ora_cc)}</td><td>${fN(r.ora_b4)}</td>
<td class="c-green">${fN(r.local_count)}</td><td>${r.status==='ok'?'<span class="badge bdg-green">مكتمل ✓</span>':`<span class="badge bdg-red">ناقص ${fN((r.ora_cc+r.ora_b4)-r.local_count)}</span>`}</td>
</tr>`).join('');
box.innerHTML=`<div class="mcard" style="margin-bottom:8px">${d.overall==='ok'?'<span class="badge bdg-green">المزامنة سليمة ✓</span>':`<span class="badge bdg-red">يوجد فائت</span>`} <span class="text-muted">Oracle: <b>${fN(d.totalOra||0)}</b> — عندنا: <b>${fN(d.totalLocal||0)}</b> (آخر ${fN(d.days||14)} يوم، بدون كاشير 2)</span></div><div class="tbl-scroll" style="max-height:300px;overflow:auto"><table>
<thead><tr><th>اليوم</th><th>كاشير (Oracle)</th><th>شركات (Oracle)</th><th>عندنا</th><th>الحالة</th></tr></thead>
<tbody>${rows||'<tr><td colspan="5" class="u-empty-sm">لا بيانات</td></tr>'}</tbody></table></div>
${(d.missingDays||[]).length?`<div style="padding:10px 0"><span class="c-red fw-bold">أيام ناقصة: ${(d.missingDays||[]).join('، ')}</span> — دوس مزامنة الفائت للحاقها.</div>`:'<div class="c-green" style="padding:10px 0">كل الأيام مكتملة ✓</div>'}`;
}catch(e){ box.innerHTML=`<div class="mcard u-empty">${esc(e.message||'تعذر الفحص')}</div>`; }
}
async function ysCatchUp(){
if(!confirm('مزامنة كل الفواتير الفائتة (آخر 14 يوم)؟ قد تأخذ دقائق في الخلفية.')) {return;}
showLoad();
try{
const r=await apiFetch('/yarasoft/oracle/catch-up',{method:'POST',body:JSON.stringify({days:14})});
if(r.alreadyRunning){ toast('المزامنة شغالة بالفعل','info'); }
else {toast('بدأت المزامنة في الخلفية — تابع من هنا','success');}
ysCatchUpStatus(true);
}catch(e){ toast(e.message||'تعذر البدء','error'); }finally{ hideLoad(); }
}
async function ysCatchUpStatus(loop){
const box=document.getElementById('ysSyncDocBody'); if(!box) {return;}
try{
const d=await apiFetch('/yarasoft/oracle/catch-up/status');
const j=d.job||{};
const chunks=(j.chunks||[]).map(c=>`<tr><td>${esc(c.fromDay)} ← ${esc(c.toDay)}</td><td>${c.skipped?'<span class="badge bdg-gray">مغطى ✓</span>':'<span class="badge bdg-gold">اتسحب</span>'}</td><td>${fN(c.posted||0)}</td></tr>`).join('');
box.innerHTML=`<div class="mcard" style="margin-bottom:8px">${j.running?'<span class="badge bdg-gold">جارٍ اللحاق...</span>':`<span class="badge bdg-green">اكتمل ✓</span> — منشور: <b>${fN(j.posted||0)}</b> — مكرر متخطى: <b>${fN(j.dups||0)}</b>`}${j.error?` <span class="c-red">${esc(j.error)}</span>`:''}</div>
${chunks?`<div class="tbl-scroll" style="max-height:220px;overflow:auto"><table><thead><tr><th>المقطع</th><th>الحالة</th><th>منشور</th></tr></thead><tbody>${chunks}</tbody></table></div>`:''}
<div style="padding-top:8px"><button class="btn btn-blue btn-sm" onclick="ysReconcile()"><i class=ji data-i=chart></i> فحص الفجوات بعد المزامنة</button></div>`;
if(j.running && loop!==false) {setTimeout(()=>{ if(document.getElementById('ysSyncDocBody')) {ysCatchUpStatus(true);} },5000);}
}catch(e){ /* صامت */ }
}
async function ysOracleTest(){  showLoad();
  try{
    const r = await apiFetch('/yarasoft/oracle/test', { method: 'POST' });
    if(r.ok) {toast(`اتصال ناجح (${r.ms}ms) — ${r.version || 'Oracle'}`, 'success');}
    else {toast(`فشل: ${r.error}${r.hint ? ' — ' + r.hint : ''}`, 'error');}
    ysLoadOracleBox();
  }catch(e){ toast(e.message || 'تعذر الفحص', 'error'); }
  finally{ hideLoad(); }
}
function ysSetTab(tab){ YSSTATE.tab = tab; const t=document.getElementById('ysTabs'); if(t){ t.querySelectorAll('button').forEach((b,i)=>{ const tabs=['status','review','sections','warehouse','mappings','tools']; b.classList.toggle('btn-gold', tabs[i]===tab); }); } ysRenderBody(); }
function ysRenderBody(){
const body = document.getElementById('ysBody');
if(!body) {return;}
if(YSSTATE.tab==='status') {ysRenderStatus(body);}
else if(YSSTATE.tab==='review') {ysLoadReview(body);}
else if(YSSTATE.tab==='sections') {ysLoadSections(body);}
else if(YSSTATE.tab==='warehouse') {ysLoadWarehouse(body);}
else if(YSSTATE.tab==='mappings') {ysLoadMappings(body);}
else {ysRenderTools(body);}
}
function ysNetBadge(ok){
if(ok===true) {return '<span class="badge bdg-green"><i class=ji data-i=circle-check></i> الشبكة متاحة</span>';}
if(ok===false) {return '<span class="badge bdg-red"><i class=ji data-i=circle-x></i> المشاركة غير متاحة</span>';}
return '<span class="badge bdg-orange">لم يُفحص بعد</span>';
}
function ysRenderStatus(el){
const st = YSSTATE.status;
const eng = st?.engine || {};
const c = st?.logCounts || {};
el.innerHTML = `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=zap></i> المحرك</div><div class="mcard-val" style="font-size:18px">${eng.enabled?(eng.running?'<span class="c-green">يعمل</span>':'<span class="c-red">متوقف</span>'):'<span class="c-orange">معطّل</span>'} ${eng.dryRun?'<span class="badge bdg-blue">DRY_RUN</span>':'<span class="badge bdg-gold">فعلي</span>'}</div><small class="text-muted">${esc(eng.shareRoot||'')}</small></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=wifi></i> الشبكة</div><div style="margin-top:6px">${ysNetBadge(eng.networkOk)}</div><small class="text-muted">آخر فحص: ${eng.lastScanAt?zkFmtDate(eng.lastScanAt)+' '+zkFmtTime(eng.lastScanAt):'—'}</small></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> فواتير مستوردة</div><div class="mcard-val c-green">${fN(c.completed||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> تحتاج مراجعة</div><div class="mcard-val ${c.review||st?.openReviewItems?'c-orange':'c-green'}">${fN(st?.openReviewItems||c.review||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-x></i> فاشلة</div><div class="mcard-val ${c.failed?'c-red':'c-green'}">${fN(c.failed||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=copy></i> مكررات مكتشفة</div><div class="mcard-val c-blue">${fN(c.duplicates||0)}</div></div>
</div>
${eng.lastError?`<div class="mcard" style="border:1px solid var(--red)"><b style="color:var(--red)">آخر خطأ:</b> <span style="color:var(--text2)">${esc(eng.lastError)}</span><br><small class="text-muted">المحرك يعيد المحاولة تلقائيًا كل ${30} ثانية عند انقطاع الشبكة — لا تدخل مطلوب.</small></div>`:''}
<div id="ysOracleBox" style="margin-top:14px"><div class="mcard u-empty"><div class="spinner"></div></div></div>
<div class="tbl-wrap" style="margin-top:14px">
<div class="tbl-hd"><h3><i class=ji data-i=zap></i> محرك المزامنة الذكي — لحاق تلقائي بالفائت</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="ysReconcile()"><i class=ji data-i=chart></i> فحص الفجوات (14 يوم)</button><button class="btn btn-gold btn-sm" onclick="ysCatchUp()"><i class=ji data-i=refresh></i> مزامنة الفائت الآن</button></div></div>
<div style="padding:6px 14px" class="text-muted" style="font-size:12px">لو الجهاز اتقفل واشتغل، المحرك يلحق كل الفواتير الفائتة لوحده بعد الإقلاع بدقيقة — من غير أي زر.</div>
<div id="ysSyncDocBody" style="padding:0 14px 14px"><div class="text-muted">دوس فحص الفجوات لمقارنة ياراسوفت بالنظام يوم بيوم.</div></div>
</div>
<div class="tbl-wrap" style="margin-top:14px">
<div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> سجل استيراد الفواتير</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث في السجل..." oninput="ysTableSearch(this,'ysLogBody')" style="max-width:220px"><button class="btn btn-blue btn-sm" onclick="ysPrintLog()"><i class=ji data-i=printer></i> طباعة</button></div></div>
<div class="text-muted" style="padding:6px 14px;font-size:12px">كل ملف يُعالج مرة واحدة بالضبط (حماية بالهش + رقم الفاتورة + مرجع الإيراد)</div>
<div class="tbl-scroll"><table>
<thead><tr><th>الملف</th><th>رقم الفاتورة</th><th>الحالة</th><th>أصناف</th><th>الإجمالي</th><th>محاولات</th><th>المدة</th><th>التاريخ</th><th>خطأ</th><th></th></tr></thead>
<tbody id="ysLogBody">
${YSSTATE.log.map(l=>`
<tr>
<td class="u-maxw-260" title="${esc(l.source_file)}">${esc((l.source_file||'').split(/[\\\\/]/).pop())}</td>
<td>${l.external_invoice_number?`<span class="badge bdg-blue">${esc(l.external_invoice_number)}</span>`:'—'}</td>
<td>${ysStatusBadge(l.status)}</td>
<td>${l.items_count??'—'}</td>
<td class="c-gold">${l.total_amount!=null?fC(l.total_amount):'—'}</td>
<td>${l.retry_count||0}</td>
<td>${l.processing_duration_ms!=null?l.processing_duration_ms+'ms':'—'}</td>
<td>${l.created_at?zkFmtDate(l.created_at)+' '+zkFmtTime(l.created_at):'—'}</td>
<td class="u-maxw-200 text-muted" title="${esc(l.error_message||'')}">${l.error_message?esc(String(l.error_message).slice(0,60))+'…':'—'}</td>
<td>${['admin','manager'].includes(STATE.currentUser?.role)&&['FAILED','REQUIRES_REVIEW'].includes(l.status)?`<button class="btn btn-blue btn-sm" onclick="ysReprocess('${l.id}')"><i class=ji data-i=rotate-ccw></i> إعادة فتح</button>`:''} <button class="btn btn-sm" onclick="ysViewInvoice('${l.id}')"><i class=ji data-i=eye></i> عرض</button></td>
</tr>`).join('')||'<tr><td colspan="10" class="u-empty-sm">لا سجلات بعد — فعّل YARASOFT_ENABLED في .env وضع ملفات الفواتير في مجلد Invoices</td></tr>'}
</tbody></table></div>
</div>`;
}
function ysStatusBadge(s){
const map={
COMPLETED:'<span class="badge bdg-green"><i class=ji data-i=circle-check></i> مكتملة</span>',
DUPLICATE:'<span class="badge bdg-blue">مكررة</span>',
FAILED:'<span class="badge bdg-red"><i class=ji data-i=circle-x></i> فاشلة</span>',
REQUIRES_REVIEW:'<span class="badge bdg-orange">تحتاج مراجعة</span>',
NEEDS_MAPPING:'<span class="badge bdg-purple"><i class=ji data-i=layout-grid></i> قسم جديد — بانتظار الاعتماد</span>',
DRY_RUN:'<span class="badge bdg-purple">معاينة DRY_RUN</span>',
PROCESSING:'<span class="badge bdg-blue"><i class=ji data-i=refresh></i> قيد المعالجة</span>',
DETECTED:'<span class="badge bdg-gray">مكتشفة</span>'};
return map[s]||`<span class="badge bdg-gray">${esc(s||'—')}</span>`;
}
// ─── مكتبة موحدة: بحث فوري داخل أي جدول + طباعة تقارير بهوية karim ───
function ysTableSearch(inputEl, tbodyId){
const q = String(inputEl?.value || '').trim().toLowerCase();
const tb = document.getElementById(tbodyId);
if(!tb) {return;}
tb.querySelectorAll('tr').forEach(tr => {
tr.style.display = (!q || tr.innerText.toLowerCase().includes(q)) ? '' : 'none';
});
}
function ysPrintReport(title, subtitle, summaryPairs, headCols, bodyRows){
const win = window.open('', '_blank', 'width=1000,height=700');
if(!win){ toast('اسمح بالنوافذ المنبثقة للطباعة', 'error'); return; }
const dateStr = new Date().toLocaleString('ar-EG');
win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>${esc(title)}</title>
<style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}
.sheet{max-width:900px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:16px;margin-bottom:18px}
.head h1{margin:0 0 6px;color:#b45309;font-size:24px}.head p{margin:3px 0;color:#555;font-size:13px}
.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px}
.summary div{border:1px solid #ddd;border-radius:8px;padding:10px;text-align:center}
.summary b{display:block;font-size:17px;color:#7c3500;margin-top:4px}
.summary span{font-size:12px;color:#555}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:right;font-size:12px}
th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}
.controls{text-align:center;margin-bottom:20px}.controls button{border:0;border-radius:7px;padding:10px 24px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}
.controls button.secondary{background:#555}
@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body>
<div class="controls"><button onclick="window.print()">طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div>
<main class="sheet"><header class="head"><h1>${esc(STATE.settings?.name || 'Karim ERP')}</h1><p style="font-size:16px;font-weight:700;color:#111">${esc(title)}</p><p>${esc(subtitle || '')}</p><p>تاريخ التقرير: ${dateStr}</p></header>
${summaryPairs?.length ? `<section class="summary">${summaryPairs.map(p => `<div><span>${esc(p[0])}</span><b>${esc(String(p[1]))}</b></div>`).join('')}</section>` : ''}
<table><thead><tr>${headCols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${bodyRows || '<tr><td>لا بيانات</td></tr>'}</tbody></table>
</main></body></html>`);
win.document.close();
}
async function ysRunNow(){
showLoad();
try{
const r=await apiFetch('/yarasoft/run-now',{method:'POST'});
toast(r.ok?'تمت دورة الفحص — راجع السجل':'تعذر التشغيل','success');
await ysRefresh();
}catch(e){toast(e.message||'فشل التشغيل','error');}finally{hideLoad();}
}
async function ysReprocess(id){
showLoad();
try{
const r=await apiFetch(`/yarasoft/reprocess/${id}`,{method:'POST'});
toast(r.message||'أُعيد فتح الفاتورة','success');
await ysRefresh();
}catch(e){toast(e.message||'فشل','error');}finally{hideLoad();}
}
function ysPrintLog(){
const rows = (YSSTATE.log||[]).map(l=>`<tr><td>${esc((l.source_file||'').split(/[\\/]/).pop())}</td><td>${esc(l.external_invoice_number||'—')}</td><td>${esc(l.status||'—')}</td><td>${l.items_count??'—'}</td><td>${l.total_amount??'—'}</td><td>${esc(l.created_at||'')}</td></tr>`).join('');
const c = YSSTATE.status?.logCounts || {};
ysPrintReport('سجل استيراد فواتير Yarasoft', `${fN((YSSTATE.log||[]).length)} عملية`,
[['مكتملة', c.completed||0],['مكررة', c.duplicates||0],['فاشلة', c.failed||0],['بانتظار قسم', c.needs_mapping||0]],
['الملف','الفاتورة','الحالة','أصناف','الإجمالي','التاريخ'], rows);
}
async function ysViewInvoice(id){
showLoad();
try{
const d = await apiFetch(`/yarasoft/log/${id}/detail`);
hideLoad();
const p = d.payload || {};
const items = Array.isArray(p.items) ? p.items : [];
const rows = items.map((it,i)=>`<tr><td>${i+1}</td><td class="fw-bold">${esc(it.name||it.externalCode||'—')}</td><td>${esc(it.externalCode||'—')}</td><td>${fN(it.quantity||0)}</td><td class="c-gold">${fC(it.unitPrice||0)}</td><td class="c-gold fw-bold">${fC(it.total||0)}</td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا تفاصيل أصناف محفوظة لهذه الفاتورة (سجل قديم)</td></tr>';
YSSTATE.invDetail = { id, payload: p, total: d.total_amount };
showModal(`
<h3><i class=ji data-i=file-text></i> فاتورة ${esc(d.external_invoice_number||('رقم '+id))}</h3>
<div class="mcard" style="margin-bottom:12px">الحالة: ${ysStatusBadge(d.status)} — الإجمالي: <span class="c-gold fw-bold">${fC(d.total_amount||0)}</span>${p.sectionName?` — القسم: <b>${esc(p.sectionName)}</b>`:''}${p.customer?` — العميل: ${esc(p.customer)}`:''}<br><small class="text-muted">الملف: ${esc(d.source_file||'')} — ${esc(d.processed_at||d.created_at||'')}</small></div>
<div class="tbl-scroll"><table>
<thead><tr><th>#</th><th>الصنف</th><th>الكود</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إغلاق</button>
<button class="btn btn-blue" onclick="ysPrintInvoiceDetail()"><i class=ji data-i=printer></i> طباعة الفاتورة</button>
</div>`);
}catch(e){ hideLoad(); toast(e.message||'تعذر جلب التفاصيل','error'); }
}
function ysPrintInvoiceDetail(){
const d = YSSTATE.invDetail; if(!d) {return;}
const p = d.payload || {};
const items = Array.isArray(p.items) ? p.items : [];
const rows = items.map((it,i)=>`<tr><td>${i+1}</td><td>${esc(it.name||it.externalCode||'—')}</td><td>${fN(it.quantity||0)}</td><td>${fC(it.unitPrice||0)}</td><td>${fC(it.total||0)}</td></tr>`).join('');
ysPrintReport(`فاتورة ${esc(p.invoiceNumber||('رقم '+d.id))}`, `${p.sectionName?`القسم: ${p.sectionName} — `:''}${p.customer?`العميل: ${p.customer}`:''}`,
[['الأصناف', items.length],['الإجمالي', fC(items.reduce((s,it)=>s+Number(it.total||0),0))]],
['#','الصنف','الكمية','السعر','الإجمالي'], rows);
}
// ─── المراجعة ───
async function ysLoadReview(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{ YSSTATE.review = await apiFetch('/yarasoft/review?open=1'); }
catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
ysRenderReview(el);
}
function ysRenderReview(el){
const rows=(YSSTATE.review||[]).map(r=>`
<tr>
<td><span class="badge bdg-blue">${esc(r.external_invoice_number||'—')}</span></td>
<td>${esc(r.external_item_code||'—')}</td>
<td>${esc(r.external_barcode||'—')}</td>
<td class="fw-bold">${esc(r.item_name||'—')}</td>
<td>${fN(r.quantity||0)}</td>
<td>${esc(r.reason||'')}</td>
<td>${['admin','manager'].includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="ysResolveReview('${r.id}')"><i class=ji data-i=tag></i> ربط بمنتج</button>`:'—'}</td>
</tr>`).join('');
el.innerHTML=`
<div class="mcard" style="margin-bottom:12px"><b><i class=ji data-i=info></i> القاعدة:</b> <span style="color:var(--text2)">لن يُستبدل صنف غير مطابق بمنتج آخر أبدًا — اربطه يدويًا هنا وستُستورد فاتورته تلقائيًا بعد اكتمال كل أصنافها، ويُستخدم نفس الربط لكل الفواتير القادمة.</span></div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> أصناف بلا مطابقة (${fN((YSSTATE.review||[]).length)})</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث..." oninput="ysTableSearch(this,'ysReviewBody')" style="max-width:200px"><button class="btn btn-blue btn-sm" onclick="ysLoadReview(document.getElementById('ysBody'))"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" onclick="ysPrintReview()"><i class=ji data-i=printer></i> طباعة</button></div></div>
<div class="tbl-scroll"><table>
<thead><tr><th>الفاتورة</th><th>كود Yarasoft</th><th>الباركود</th><th>اسم الصنف</th><th>الكمية</th><th>السبب</th><th></th></tr></thead>
<tbody id="ysReviewBody">${rows||'<tr><td colspan="7" class="u-empty-sm">لا أصناف معلقة — كل الفواتير مستوردة ✓</td></tr>'}</tbody>
</table></div>
</div>`;
}
function ysPrintReview(){
const rows = (YSSTATE.review||[]).map(r=>`<tr><td>${esc(r.external_invoice_number||'—')}</td><td>${esc(r.external_item_code||'—')}</td><td>${esc(r.item_name||'—')}</td><td>${r.quantity||0}</td><td>${esc(r.reason||'')}</td></tr>`).join('');
ysPrintReport('أصناف Yarasoft بلا مطابقة', `${fN((YSSTATE.review||[]).length)} صنف معلق`,
[['معلقة', (YSSTATE.review||[]).length]],
['الفاتورة','الكود','الصنف','الكمية','السبب'], rows);
}
function ysResolveReview(id){
const products=STATE.inventory;
showModal(`
<h3><i class=ji data-i=tag></i> ربط الصنف بمنتج karim</h3>
<div class="fg"><label>المنتج الداخلي</label>
<select id="ysRevProduct" style="width:100%;padding:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text)">
${(products||[]).map(p=>`<option value="${p.id}">${esc(p.name)}${p.barcode?` — باركود ${esc(p.barcode)}`:''} — متوفر ${fN(p.qty||0)}</option>`).join('')}
</select></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="ysConfirmReview('${id}')"><i class=ji data-i=save></i> ربط ومتابعة الاستيراد</button>
</div>`);
}
async function ysConfirmReview(id){
const internalProductId=Number(document.getElementById('ysRevProduct')?.value);
if(!internalProductId){toast('اختر المنتج','error');return;}
showLoad();
try{
const r=await apiFetch(`/yarasoft/review/${id}/resolve`,{method:'POST',body:JSON.stringify({internalProductId})});
closeModal(); toast(r.message||'تم الربط','success');
await ysLoadReview(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشل الربط','error');}finally{hideLoad();}
}
// ─── روابط المنتجات ───
async function ysLoadMappings(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{ YSSTATE.mappings = await apiFetch('/yarasoft/mappings'); }
catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
ysRenderMappings(el);
}
function ysRenderMappings(el){
const canWrite=['admin','manager'].includes(STATE.currentUser?.role);
const rows=(YSSTATE.mappings||[]).map(m=>`
<tr>
<td><span class="badge bdg-blue">${esc(m.external_code||'—')}</span></td>
<td>${esc(m.external_barcode||'—')}</td>
<td class="fw-bold">${esc(m.product_name)}</td>
<td>${m.active?'<span class="badge bdg-green">نشط</span>':'<span class="badge bdg-gray">معطل</span>'}</td>
<td>${canWrite?`<button class="btn btn-red btn-sm" onclick="ysDeactivateMapping('${m.id}')"><i class=ji data-i=circle-x></i> تعطيل</button>`:'—'}</td>
</tr>`).join('');
el.innerHTML=`
${canWrite?`<div class="u-row-wrap" style="gap:8px;margin-bottom:12px"><button class="btn btn-gold" onclick="ysAddMappingModal()"><i class=ji data-i=plus></i> ربط جديد</button></div>`:''}
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=tag></i> ربط أكواد Yarasoft بمنتجات karim</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث..." oninput="ysTableSearch(this,'ysMapBody')" style="max-width:200px"><span class="text-muted">أولوية المطابقة: باركود ← كود خارجي ← ربط صريح ← رقم منتج داخلي</span></div></div>
<div class="tbl-scroll"><table>
<thead><tr><th>كود Yarasoft</th><th>باركود Yarasoft</th><th>منتج karim</th><th>الحالة</th><th></th></tr></thead>
<tbody id="ysMapBody">${rows||'<tr><td colspan="5" class="u-empty-sm">لا روابط صريحة بعد — المطابقة تعمل بالباركود تلقائيًا</td></tr>'}</tbody>
</table></div>
</div>`;
}
function ysAddMappingModal(){
const products=STATE.inventory;
showModal(`
<h3><i class=ji data-i=plus></i> ربط جديد</h3>
<div class="fr">
<div class="fg"><label>كود Yarasoft (اختياري)</label><input type="text" id="ysMapCode" placeholder="مثال: PLU-120"></div>
<div class="fg"><label>باركود Yarasoft (اختياري)</label><input type="text" id="ysMapBarcode" placeholder="مثال: 6281000000012"></div>
</div>
<div class="fg"><label>منتج karim</label>
<select id="ysMapProduct" style="width:100%;padding:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text)">
${(products||[]).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}
</select></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="ysSaveMapping()"><i class=ji data-i=save></i> حفظ</button>
</div>`);
}
async function ysSaveMapping(){
const externalCode=document.getElementById('ysMapCode')?.value.trim();
const externalBarcode=document.getElementById('ysMapBarcode')?.value.trim();
const internalProductId=Number(document.getElementById('ysMapProduct')?.value);
if(!externalCode&&!externalBarcode){toast('أدخل كودًا أو باركود خارجيًا','error');return;}
showLoad();
try{
await apiFetch('/yarasoft/mappings',{method:'POST',body:JSON.stringify({externalCode,externalBarcode,internalProductId})});
closeModal(); toast('حُفظ الربط','success');
await ysLoadMappings(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشل الحفظ','error');}finally{hideLoad();}
}
async function ysDeactivateMapping(id){
showLoad();
try{ await apiFetch(`/yarasoft/mappings/${id}`,{method:'DELETE'}); toast('عُطّل الربط','success'); await ysLoadMappings(document.getElementById('ysBody')); }
catch(e){toast(e.message||'فشل','error');}finally{hideLoad();}
}
// ─── أقسام إيرادات يارا سوفت (تصنيف من اليوم — كل قسم لوحده) ───
async function ysLoadSections(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const [map, unmapped] = await Promise.all([
apiFetch('/yarasoft/sections/map').catch(()=>[]),
apiFetch('/yarasoft/sections/unmapped').catch(()=>[])
]);
YSSTATE.secMap = Array.isArray(map)?map:[];
YSSTATE.secUnmapped = Array.isArray(unmapped)?unmapped:[];
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
ysRenderSections(el);
}
function ysRenderSections(el){
const canWrite=['admin','manager'].includes(STATE.currentUser?.role);
const mapRows=(YSSTATE.secMap||[]).map(m=>{
const profit=Number(m.posted_total||0)-Number(m.posted_expenses||0);
return `
<tr>
<td><span class="badge bdg-blue">${esc(m.src_table)}</span></td>
<td class="fw-bold"><a href="javascript:void(0)" onclick="ysOpenSecInvoices(${m.id},1)" title="اضغط لعرض فواتير القسم" style="color:inherit;text-decoration:underline dotted;cursor:pointer">${esc(m.display_ar)}</a></td>
<td><code>${esc(m.dept_code)}</code></td>
<td>${fN(m.posted_count||0)}</td>
<td class="c-green">${fC(m.posted_total||0)}</td>
<td class="c-red">${fC(m.posted_expenses||0)}</td>
<td class="fw-bold ${profit>=0?'c-green':'c-red'}">${fC(profit)}</td>
<td>${m.active?'<span class="badge bdg-green">نشط</span>':'<span class="badge bdg-gray">معطل</span>'}</td>
<td>${canWrite?`<button class="btn btn-sm" onclick="ysRenameSectionModal('${m.id}','${esc(m.display_ar)}')"><i class=ji data-i=pencil></i> تسمية</button>`:''}</td>
</tr>`;}).join('');
const unRows=(YSSTATE.secUnmapped||[]).map(u=>`
<tr>
<td><span class="badge bdg-blue">${esc(u.src_table)}</span></td>
<td class="fw-bold">${esc(u.src_name)}</td>
<td>${fN(u.invoices_count||0)}</td>
<td class="c-gold">${fC(u.total_amount||0)}</td>
<td class="text-muted">${u.last_seen?zkFmtDate(u.last_seen):'—'}</td>
<td>${canWrite?`<button class="btn btn-gold btn-sm" onclick="ysApproveSectionModal('${u.id}')"><i class=ji data-i=check></i> اعتماد قسم</button>`:'—'}</td>
</tr>`).join('');
el.innerHTML=`
<div class="mcard" style="margin-bottom:12px"><b><i class=ji data-i=info></i> القاعدة:</b> <span style="color:var(--text2)">الإيراد يأتي من بيع الكاشير فقط (CC) + البيع الخارجي للشركات (BILLS4) — فواتير الصرف الداخلي للأقسام (BILLS6) ليست إيرادًا ولا تُرحّل — أي كاشير جديد يتوقف هنا للاعتماد — سمِّ كل كاشير باسم منفذه بزر "تسمية" — اضغط على اسم أي قسم لعرض فواتيره ونقلها بين الأقسام.</span></div>
${ysCashierCards()}
<div id="ysSecDrill"></div>
${(YSSTATE.secUnmapped||[]).length?`<div class="tbl-wrap" style="margin-bottom:12px;border:1px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> أقسام جديدة بانتظار الاعتماد (${fN(YSSTATE.secUnmapped.length)})</h3></div>
<div class="tbl-scroll"><table>
<thead><tr><th>الجدول</th><th>الاسم في يارا سوفت</th><th>فواتير</th><th>الإجمالي</th><th>آخر ظهور</th><th></th></tr></thead>
<tbody>${unRows}</tbody>
</table></div></div>`:''}
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=layout-grid></i> خريطة الأقسام (${fN((YSSTATE.secMap||[]).length)})</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث في الأقسام..." oninput="ysTableSearch(this,'ysSecMapBody')" style="max-width:220px">${['admin','manager'].includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="ysManualSectionModal()"><i class=ji data-i=plus></i> قسم يدوي</button>`:''}<button class="btn btn-blue btn-sm" onclick="ysLoadSections(document.getElementById('ysBody'))"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-blue btn-sm" onclick="ysPrintSections()"><i class=ji data-i=printer></i> طباعة</button></div></div>
<div class="tbl-scroll"><table>
<thead><tr><th>الجدول</th><th>القسم</th><th>الكود</th><th>فواتير مرحلة</th><th>إيرادات تلقائية</th><th>مصروفات تلقائية</th><th>الصافي</th><th>الحالة</th><th></th></tr></thead>
<tbody id="ysSecMapBody">${mapRows||'<tr><td colspan="9" class="u-empty-sm">لا أقسام بعد</td></tr>'}</tbody>
</table></div>
</div>`;
}
function ysPrintSections(){
const total = (YSSTATE.secMap||[]).reduce((s,m)=>s+Number(m.posted_total||0),0);
const totalExp = (YSSTATE.secMap||[]).reduce((s,m)=>s+Number(m.posted_expenses||0),0);
const rows = (YSSTATE.secMap||[]).map(m=>{const p=Number(m.posted_total||0)-Number(m.posted_expenses||0);return `<tr><td>${esc(m.src_table)}</td><td>${esc(m.display_ar)}</td><td>${m.posted_count||0}</td><td>${fC(m.posted_total||0)}</td><td>${fC(m.posted_expenses||0)}</td><td>${fC(p)}</td></tr>`;}).join('');
ysPrintReport('خريطة أقسام إيرادات Yarasoft', `${fN((YSSTATE.secMap||[]).length)} قسمًا`,
[['الأقسام', (YSSTATE.secMap||[]).length],['إجمالي إيرادات', fC(total)],['إجمالي مصروفات', fC(totalExp)],['الصافي', fC(total-totalExp)]],
['الجدول','القسم','فواتير','إيرادات','مصروفات','الصافي'], rows);
}
// ─── كروت أقسام الكاشيرية + تفاصيل الفواتير + إعادة التصنيف ───
function ysCashierIcon(code){
if(code==='ys_cc_9') {return 'chef-hat';}
if(code==='ys_cc_45') {return 'shopping-cart';}
if(code==='ys_cc_1') {return 'banknote';}
if(code==='ys_cc_6') {return 'utensils';}
return 'layout-grid';
}
function ysCashierCards(){
const cards=(YSSTATE.secMap||[]).filter(m=>m.src_table==='CC'&&m.active);
if(!cards.length) {return '';}
return `<div class="stats-grid-premium kpi-grid-4" style="margin-bottom:12px">${cards.map(m=>`
<div class="metric-card-premium" onclick="ysOpenSecInvoices(${m.id},1)" data-tooltip="اضغط لعرض فواتير ${esc(m.display_ar)}">
<div class="kpi-top"><span class="kpi-label">${esc(m.display_ar)}</span><span class="kpi-chip"><i class=ji data-i=${ysCashierIcon(m.dept_code)}></i></span></div>
<div class="value">${fC(m.posted_total||0)}</div>
<div class="trend"><i class=ji data-i=receipt></i> ${fN(m.posted_count||0)} فاتورة — اضغط للتفاصيل</div>
</div>`).join('')}</div>`;
}
async function ysOpenSecInvoices(mapId, page){
const box=document.getElementById('ysSecDrill'); if(!box) {return;}
const m=(YSSTATE.secMap||[]).find(x=>Number(x.id)===Number(mapId)); if(!m) {return;}
YSSTATE.secInv=Object.assign({mapId:Number(mapId),page:page||1,limit:20,date_from:'',date_to:'',q:''},YSSTATE.secInv&&YSSTATE.secInv.mapId===Number(mapId)?{page:page||1}:null);
box.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
box.scrollIntoView({behavior:'smooth',block:'nearest'});
await ysSecInvReload();
}
async function ysSecInvReload(){
const box=document.getElementById('ysSecDrill'); const st=YSSTATE.secInv; if(!box||!st) {return;}
const m=(YSSTATE.secMap||[]).find(x=>Number(x.id)===Number(st.mapId)); if(!m) {return;}
const qs=new URLSearchParams({map_id:st.mapId,page:st.page,limit:st.limit||20});
if(st.date_from) {qs.set('date_from',st.date_from);}
if(st.date_to) {qs.set('date_to',st.date_to);}
if(st.q) {qs.set('q',st.q);}
let d;
try{ d=await apiFetch('/yarasoft/sections/invoices?'+qs.toString()); }
catch(e){ box.innerHTML=`<div class="mcard u-empty">${esc(e.message||'تعذر الجلب')}</div>`; return; }
YSSTATE.secInvData=d;
const canWrite=['admin','manager'].includes(STATE.currentUser?.role);
const targets=(YSSTATE.secMap||[]).filter(x=>x.active&&Number(x.id)!==Number(st.mapId)).map(x=>`<option value="${x.id}">${esc(x.display_ar)}</option>`).join('');
const rows=(d.rows||[]).map(r=>`<tr>
${canWrite?`<td><input type="checkbox" class="ysInvChk" value="${r.id}"></td>`:''}
<td><a href="javascript:void(0)" onclick="ysInvDetail('${esc(r.external_ref||'')}')" title="اضغط لعرض تفاصيل الفاتورة بالضبط" style="color:var(--gold);cursor:pointer"><code dir="ltr">${esc((r.external_ref||'').replace(/^ora:/,''))}</code></a></td>
<td>${esc(r.date||'—')}</td>
<td class="c-green fw-bold">${fC(r.amount||0)}</td>
<td class="text-muted" style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.notes||'')}">${esc(r.notes||'—')}</td>
<td>${r.import_status?`<span class="badge bdg-blue">${esc(r.import_status)}</span>`:'—'}</td>
</tr>`).join('');
const pages=[]; const tp=d.pages||1, cp=d.page||1;
for(let p=Math.max(1,cp-2);p<=Math.min(tp,cp+2);p++) {pages.push(`<button class="btn btn-sm ${p===cp?'btn-gold':''}" onclick="YSSTATE.secInv.page=${p};ysSecInvReload()">${fN(p)}</button>`);}
box.innerHTML=`<div class="tbl-wrap" style="margin-bottom:12px;border:1px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=receipt></i> فواتير: ${esc(m.display_ar)} (${fN(d.total||0)} فاتورة)</h3>
<div class="u-row-wrap">
<input type="date" id="ysInvFrom" class="inp" value="${esc(st.date_from||'')}" onchange="YSSTATE.secInv.date_from=this.value;YSSTATE.secInv.page=1;ysSecInvReload()" style="max-width:150px">
<input type="date" id="ysInvTo" class="inp" value="${esc(st.date_to||'')}" onchange="YSSTATE.secInv.date_to=this.value;YSSTATE.secInv.page=1;ysSecInvReload()" style="max-width:150px">
<input type="text" id="ysInvQ" class="inp" placeholder="بحث برقم الفاتورة..." value="${esc(st.q||'')}" onkeydown="if(event.key==='Enter'){YSSTATE.secInv.q=this.value;YSSTATE.secInv.page=1;ysSecInvReload()}" style="max-width:170px">
<button class="btn btn-blue btn-sm" onclick="YSSTATE.secInv={mapId:${st.mapId},page:1,limit:20};ysSecInvReload()"><i class=ji data-i=refresh></i> تصفير</button>
<button class="btn btn-sm" onclick="ysCloseSecDrill()">إغلاق ✕</button>
</div></div>
<div class="tbl-scroll" style="max-height:380px;overflow:auto"><table>
<thead><tr>${canWrite?'<th><input type="checkbox" onclick="ysSecInvToggleAll(this)"></th>':''}<th>رقم الفاتورة</th><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th><th>الحالة</th></tr></thead>
<tbody>${rows||`<tr><td colspan="6" class="u-empty-sm">لا فواتير مطابقة</td></tr>`}</tbody>
</table></div>
<div class="tbl-hd" style="border-top:1px solid var(--line)">
<div class="u-row-wrap">${pages.join('')}<span class="text-muted">صفحة ${fN(cp)} من ${fN(tp)}</span></div>
${canWrite?`<div class="u-row-wrap"><select id="ysInvTarget" class="inp" style="max-width:220px"><option value="">انقل المحدد إلى...</option>${targets}</select><button class="btn btn-gold btn-sm" onclick="ysSecInvReclassify()"><i class=ji data-i=send></i> نقل (إعادة تصنيف)</button></div>`:''}
</div></div>`;
}
function ysSecInvToggleAll(el){
document.querySelectorAll('.ysInvChk').forEach(c=>{c.checked=el.checked;});
}
async function ysSecInvReclassify(){
const ids=[...document.querySelectorAll('.ysInvChk:checked')].map(c=>Number(c.value)).filter(Boolean);
const toMapId=Number(document.getElementById('ysInvTarget')?.value);
if(!ids.length){toast('حدد فاتورة واحدة على الأقل','error');return;}
if(!toMapId){toast('اختر القسم المستهدف','error');return;}
if(!confirm(`نقل ${ids.length} فاتورة إلى القسم المختار؟`)) {return;}
showLoad();
try{
const r=await apiFetch('/yarasoft/sections/reclassify',{method:'POST',body:JSON.stringify({revenue_ids:ids,to_map_id:toMapId})});
toast(`اتنقل ${r.moved} فاتورة إلى ${r.to_name}`,'success');
await ysLoadSections(document.getElementById('ysBody'));
await ysOpenSecInvoices(YSSTATE.secInv.mapId,1);
}catch(e){toast(e.message||'فشل النقل','error');}finally{hideLoad();}
}
function ysCloseSecDrill(){const box=document.getElementById('ysSecDrill'); if(box) {box.innerHTML='';}}
async function ysInvDetail(ref){
if(!ref) {return;}
showLoad();
try{
const d=await apiFetch('/yarasoft/sections/invoice-detail?ref='+encodeURIComponent(ref));
YSSTATE.invFull=d; YSSTATE.invFullRef=ref;
const h=d.header||{};
const loc=d.local||{};
const lines=(d.lines||[]).map((l,i)=>`<tr><td>${fN(i+1)}</td><td>${esc(l.code||'—')}</td><td class="fw-bold">${esc(l.name||'—')}</td><td>${fN(l.qty||0)} ${esc(l.unit||'')}</td><td>${fC(l.price||0)}</td><td class="c-green fw-bold">${fC(l.total||0)}</td><td>${fC(l.vat||0)}${l.vat_rate?` (${fN(l.vat_rate)}%)`:''}</td></tr>`).join('');
const sum=(d.lines||[]).reduce((s,l)=>s+Number(l.total||0),0);
showModal(`
<h3><i class=ji data-i=receipt></i> فاتورة ${esc(String(ref).replace(/^ora:/,''))} ${d.live?'<span class="badge bdg-green">مباشر من يارا سوفت</span>':''}</h3>
<div class="mcard" style="margin-bottom:12px;line-height:2">
<b>القسم:</b> ${esc(loc.source||h.CSHR||'—')} &nbsp;•&nbsp; <b>الكاشير:</b> ${esc((h.CSHR||'').trim()||'—')} &nbsp;•&nbsp; <b>التاريخ:</b> ${esc(loc.date||'—')} &nbsp;•&nbsp; <b>الوردية:</b> ${h.SHFT_NO??h.SHIFT_ID??'—'}<br>
<b>الإجمالي:</b> <span class="c-green fw-bold">${fC(loc.amount??h.NET_VAL??sum)}</span> &nbsp;•&nbsp; <b>الخصم:</b> ${fC(h.DSCNT_VL??0)} &nbsp;•&nbsp; <b>المدفوع:</b> ${fC(h.PAYED??loc.amount??0)}
${h.NOTES?`<br><b>ملاحظات:</b> <span class="text-muted">${esc(h.NOTES)}</span>`:''}
</div>
<div class="tbl-wrap"><div class="tbl-hd"><h3>الأصناف (${fN((d.lines||[]).length)}) — الإجمالي ${fC(sum)}</h3></div>
<div class="tbl-scroll" style="max-height:320px;overflow:auto"><table>
<thead><tr><th>#</th><th>الكود</th><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th><th>الضريبة</th></tr></thead>
<tbody>${lines||'<tr><td colspan="7" class="u-empty-sm">لا أصناف مسجلة لهذه الفاتورة</td></tr>'}</tbody>
</table></div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button><button class="btn btn-blue" onclick="ysPrintInvDetail()"><i class=ji data-i=printer></i> طباعة الفاتورة</button></div>`);
}catch(e){toast(e.message||'تعذر جلب التفاصيل','error');}finally{hideLoad();}
}
function ysPrintInvDetail(){
const d=YSSTATE.invFull; if(!d) {return;}
const h=d.header||{}; const loc=d.local||{};
const rows=(d.lines||[]).map((l,i)=>`<tr><td>${fN(i+1)}</td><td>${esc(l.code||'—')}</td><td>${esc(l.name||'—')}</td><td>${fN(l.qty||0)} ${esc(l.unit||'')}</td><td>${fC(l.price||0)}</td><td>${fC(l.total||0)}</td></tr>`).join('');
const sum=(d.lines||[]).reduce((s,l)=>s+Number(l.total||0),0);
ysPrintReport(`فاتورة ${String(YSSTATE.invFullRef||'').replace(/^ora:/,'')}`, `${loc.source||''} — ${loc.date||''}`,
[['الكاشير',(h.CSHR||'').trim()||'—'],['الوردية',h.SHFT_NO??'—'],['الإجمالي',`${fN(loc.amount??h.NET_VAL??sum)} SAR`],['الخصم',`${fN(h.DSCNT_VL??0)} SAR`],['المدفوع',`${fN(h.PAYED??loc.amount??0)} SAR`],['الأصناف',fN((d.lines||[]).length)]],
['#','الكود','الصنف','الكمية','السعر','الإجمالي'], rows||'<tr><td colspan="6">لا أصناف مسجلة</td></tr>');
}
function ysApproveSectionModal(id){
const u=(YSSTATE.secUnmapped||[]).find(x=>String(x.id)===String(id));
if(!u) {return;}
const mergeOpts=(YSSTATE.secMap||[]).map(m=>`<option value="${m.id}">${esc(m.display_ar)} (${esc(m.src_table)})</option>`).join('');
showModal(`
<h3><i class=ji data-i=check></i> اعتماد قسم جديد</h3>
<div class="mcard" style="margin-bottom:12px">المصدر: <span class="badge bdg-blue">${esc(u.src_table)}</span> <b>${esc(u.src_name)}</b> — ${fN(u.invoices_count||0)} فاتورة بإجمالي <span class="c-gold">${fC(u.total_amount||0)}</span><br><small class="text-muted">اختر: قسم جديد مستقل، أو دمج في قسم موجود (للأخطاء الإملائية مثل مطبخ/مبطخ) — والاعتماد يرحّل الفواتير فورًا.</small></div>
<div class="fg"><label>الوضع</label><select id="ysSecMode" onchange="document.getElementById('ysSecMergeWrap').style.display=this.value==='merge'?'':'none';document.getElementById('ysSecNewWrap').style.display=this.value==='merge'?'none':''"><option value="new">قسم جديد مستقل</option><option value="merge">دمج في قسم موجود</option></select></div>
<div id="ysSecMergeWrap" style="display:none"><div class="fg"><label>ادمج في</label><select id="ysSecMerge">${mergeOpts}</select></div></div>
<div id="ysSecNewWrap"><div class="fr">
<div class="fg"><label>اسم القسم (عربي)</label><input type="text" id="ysSecAr" value="${esc(u.src_name)}"></div>
<div class="fg"><label>الاسم الإنجليزي (اختياري)</label><input type="text" id="ysSecEn" placeholder="Optional"></div>
</div></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="ysConfirmApproveSection('${u.id}')"><i class=ji data-i=check></i> اعتماد وترحيل</button>
</div>`);
}
async function ysConfirmApproveSection(id){
const mode=document.getElementById('ysSecMode')?.value||'new';
const body={};
if(mode==='merge'){ body.mergeMapId=Number(document.getElementById('ysSecMerge')?.value); if(!body.mergeMapId){toast('اختر القسم المستهدف','error');return;} }
else{ body.displayAr=document.getElementById('ysSecAr')?.value.trim(); body.displayEn=document.getElementById('ysSecEn')?.value.trim(); if(!body.displayAr){toast('أدخل اسم القسم','error');return;} }
showLoad();
try{
const r=await apiFetch(`/yarasoft/sections/unmapped/${id}/approve`,{method:'POST',body:JSON.stringify(body)});
closeModal(); toast(`اعتُمد القسم ورُحّلت ${r.reopenedInvoices||0} فاتورة`,'success');
await window.loadData().catch(()=>{});
await ysLoadSections(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشل الاعتماد','error');}finally{hideLoad();}
}
function ysRenameSectionModal(id, current){
showModal(`
<h3><i class=ji data-i=pencil></i> تسمية القسم</h3>
<div class="mcard" style="margin-bottom:12px"><small class="text-muted">مثال: كاشير 9 ← كاشير الأوبن بوفيه — كاشير 4 ← كاشير الكوفي شوب 1. التسمية تحدّث القسم وإيراداته المرحلة.</small></div>
<div class="fr">
<div class="fg"><label>الاسم الجديد (عربي)</label><input type="text" id="ysRenAr" value="${esc(current||'')}"></div>
<div class="fg"><label>الاسم الإنجليزي (اختياري)</label><input type="text" id="ysRenEn" placeholder="Optional"></div>
</div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="ysConfirmRenameSection('${id}')"><i class=ji data-i=save></i> حفظ التسمية</button>
</div>`);
}
async function ysConfirmRenameSection(id){
const displayAr=document.getElementById('ysRenAr')?.value.trim();
const displayEn=document.getElementById('ysRenEn')?.value.trim();
if(!displayAr){toast('أدخل الاسم الجديد','error');return;}
showLoad();
try{
await apiFetch(`/yarasoft/sections/map/${id}/rename`,{method:'POST',body:JSON.stringify({displayAr,displayEn})});
closeModal(); toast('حُفظت التسمية','success');
await window.loadData().catch(()=>{});
await ysLoadSections(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشلت التسمية','error');}finally{hideLoad();}
}
function ysManualSectionModal(){
showModal(`
<h3><i class=ji data-i=plus></i> قسم يدوي جديد</h3>
<div class="mcard" style="margin-bottom:12px"><small class="text-muted">للكاشيرات/المنافذ غير الموجودة في يارا سوفت (مثال: كاشير الأوبن بوفيه، كاشير الكوفي شوب 1) — للإدخال اليدوي في الإيرادات.</small></div>
<div class="fr">
<div class="fg"><label>اسم القسم (عربي)</label><input type="text" id="ysManAr" placeholder="مثال: كاشير الأوبن بوفيه"></div>
<div class="fg"><label>الاسم الإنجليزي (اختياري)</label><input type="text" id="ysManEn" placeholder="Optional"></div>
</div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="ysConfirmManualSection()"><i class=ji data-i=save></i> إنشاء القسم</button>
</div>`);
}
async function ysConfirmManualSection(){
const displayAr=document.getElementById('ysManAr')?.value.trim();
const displayEn=document.getElementById('ysManEn')?.value.trim();
if(!displayAr){toast('أدخل اسم القسم','error');return;}
showLoad();
try{
const r=await apiFetch('/yarasoft/sections/manual',{method:'POST',body:JSON.stringify({displayAr,displayEn})});
closeModal(); toast(`أُنشئ القسم: ${r.displayAr}`,'success');
await window.loadData().catch(()=>{});
await ysLoadSections(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشل الإنشاء','error');}finally{hideLoad();}
}
// ─── مخازن يارا سوفت (نسخ الأصناف + الأرصدة بمصفاة جودة) ───
async function ysLoadWarehouse(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
let cat=null, quar=[];
try{
cat = await apiFetch('/yarasoft/oracle/catalog-status').catch(()=>null);
quar = await apiFetch('/yarasoft/quality/quarantine').catch(()=>[]);
YSSTATE.quarCache = Array.isArray(quar)?quar:[];
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; return; }
const canWrite=['admin','manager'].includes(STATE.currentUser?.role);
const qRows=(Array.isArray(quar)?quar:[]).slice(0,50).map(q=>`
<tr>
<td><span class="badge bdg-orange">${esc(q.kind)}</span></td>
<td class="fw-bold">${esc(q.ref_code||'—')}</td>
<td>${q.qty??'—'}</td>
<td class="c-red">${q.value_amount??'—'}</td>
<td class="c-red">${q.unit_cost??'—'}</td>
<td class="text-muted">${esc(q.reason||'')}</td>
</tr>`).join('');
el.innerHTML=`
<div class="mcard" style="margin-bottom:12px"><b><i class=ji data-i=info></i> القاعدة:</b> <span style="color:var(--text2)">النسخ من يارا سوفت قراءة فقط — الأصناف تُنسخ بكمية صفر وربط تلقائي — الأرصدة تُنسخ بعد مصفاة الجودة، والقيم الشاذة تُعزل هنا ولا تدخل المخزون.</span></div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> أصناف مربوطة بالمخزون</div><div class="mcard-val c-blue">${fN(cat?.withQty||0)} بكمية / ${fN(cat?.zeroQty||0)} صفر</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=shopping-cart></i> مشتريات يارا سوفت</div><div class="mcard-val c-green">${fN(cat?.purchases?.n||0)}</div><small class="text-muted">${fC(cat?.purchases?.t||0)}</small></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> العملاء / الأصول</div><div class="mcard-val">${fN(cat?.customers||0)} / ${fN(cat?.assets||0)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> قيم معزولة (حجر)</div><div class="mcard-val ${(quar||[]).length?'c-orange':'c-green'}">${fN((quar||[]).length)}</div></div>
</div>
${canWrite?`<div class="u-row-wrap" style="gap:8px;margin:12px 0">
<button class="btn btn-gold" onclick="ysOracleImportItems()"><i class=ji data-i=package></i> نسخ الأصناف من يارا سوفت</button>
<button class="btn btn-purple" onclick="ysOrganizeCategories()"><i class=ji data-i=layout-grid></i> تنظيم الفئات من شجرة يارا سوفت</button>
<button class="btn btn-green" onclick="ysSyncBalances(false)"><i class=ji data-i=check></i> نسخ الأرصدة (السليمة فقط)</button>
<button class="btn btn-blue btn-sm" onclick="ysLoadWarehouse(document.getElementById('ysBody'))"><i class=ji data-i=refresh></i> تحديث</button>
</div>`:''}
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=shield></i> الحجر الصحي — قيم شاذة لم تدخل المخزون (${fN((quar||[]).length)})</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث..." oninput="ysTableSearch(this,'ysQuarBody')" style="max-width:200px"><button class="btn btn-blue btn-sm" onclick="ysPrintQuarantine()"><i class=ji data-i=printer></i> طباعة</button></div></div>
<div class="tbl-scroll"><table>
<thead><tr><th>النوع</th><th>الكود</th><th>الكمية</th><th>القيمة</th><th>سعر الوحدة</th><th>السبب</th></tr></thead>
<tbody id="ysQuarBody">${qRows||'<tr><td colspan="6" class="u-empty-sm">لا قيم معزولة — كل الأرصدة سليمة ✓</td></tr>'}</tbody>
</table></div>
</div>`;
}
function ysPrintQuarantine(){
YSSTATE.quarCache = YSSTATE.quarCache || [];
const rows = YSSTATE.quarCache.map(q=>`<tr><td>${esc(q.kind)}</td><td>${esc(q.ref_code||'—')}</td><td>${q.qty??'—'}</td><td>${q.value_amount??'—'}</td><td>${esc(q.reason||'')}</td></tr>`).join('');
ysPrintReport('الحجر الصحي لقيم مخازن يارا سوفت', `${fN(YSSTATE.quarCache.length)} قيمة معزولة`,
[['معزولة', YSSTATE.quarCache.length]],
['النوع','الكود','الكمية','القيمة','السبب'], rows);
}
async function ysOrganizeCategories(){
if(!confirm('تنظيم فئات أصناف المخزن حسب مجموعات يارا سوفت؟\n(يغيّر حقل الفئة فقط — الأكواد والباركود والكميات والمزامنة لا تُمس)')) {return;}
showLoad();
try{
const r=await apiFetch('/yarasoft/oracle/organize',{method:'POST'});
if(r.ok) {toast(`نُظمت الفئات: ${r.categorized} صنف في ${r.groups} مجموعة (سليم مسبقًا ${r.alreadyOk} — بلا مجموعة ${r.unmapped})`,'success');}
else {toast(r.error||'تعذر التنظيم','error');}
await window.loadData().catch(()=>{});
await ysLoadWarehouse(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشل التنظيم','error');}finally{hideLoad();}
}
async function ysSyncBalances(force){
if(!confirm(force?'إعادة كتابة كل الأرصدة من يارا سوفت (حتى غير الصفرية)؟':'نسخ أرصدة يارا سوفت السليمة للأصناف الصفرية فقط؟')) {return;}
showLoad();
try{
const r=await apiFetch('/yarasoft/oracle/sync-balances',{method:'POST',body:JSON.stringify({force})});
if(r.ok) {toast(`الأرصدة: طُبّق ${r.applied} — عُزل ${r.quarantined} — بلا ربط ${r.unmapped}`,'success');}
else {toast(r.error||'تعذر المزامنة','error');}
await window.loadData().catch(()=>{});
await ysLoadWarehouse(document.getElementById('ysBody'));
}catch(e){toast(e.message||'فشلت المزامنة','error');}finally{hideLoad();}
}
// ─── معاينة الصيغة (DRY RUN على نص ملصق) ───
function ysRenderTools(el){
el.innerHTML=`
<div class="mcard">
<h4 style="color:var(--gold);margin-bottom:8px"><i class=ji data-i=info></i> ضبط صيغة الملفات — بدون مخاطرة</h4>
<div style="color:var(--text2);line-height:1.9;font-size:13px">
• شغّل على جهاز الشبكة: <code>node tools/yarasoft-inspect.js --share "\\\\server\\Yarasoft\\pos"</code> — يفحص الملفات الفعلية ويقترح ملف تعريف الصيغة.<br>
• انسخ القيم المقترحة إلى <code>backend/yarasoft/format-profile.json</code> ثم أعد تشغيل الخادم.<br>
• ألصق هنا محتوى ملف فاتورة حقيقي لمعاينة التحليل والمطابقة — <b>قراءة فقط بلا أي كتابة</b>.<br>
• عند اكتمال الضبط: فعّل <code>YARASOFT_ENABLED=true</code> واترك <code>YARASOFT_DRY_RUN=true</code> أسبوعًا ثم أطفئه للانتقال الفعلي.
</div>
</div>
<div class="mcard" style="margin-top:12px">
<div class="fg"><label>ألصق محتوى ملف فاتورة للمعاينة</label>
<textarea id="ysPreviewText" rows="8" style="width:100%;padding:10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:monospace;direction:ltr" placeholder="InvoiceNo;Date;ItemCode;Qty;Price..."></textarea></div>
<button class="btn btn-blue" onclick="ysPreview()"><i class=ji data-i=eye></i> حلّل واعرض الحمولة</button>
<div id="ysPreviewResult" style="margin-top:12px"></div>
</div>`;
}
async function ysPreview(){
const text=document.getElementById('ysPreviewText')?.value||'';
if(!text.trim()){toast('ألصق محتوى ملفًا أولاً','error');return;}
const out=document.getElementById('ysPreviewResult');
out.innerHTML='<div class="spinner"></div>';
try{
const r=await apiFetch('/yarasoft/dry-run-preview',{method:'POST',body:JSON.stringify({text})});
const inv=(r.parsed?.invoices||[])[0]||{};
const match=inv.matching||{};
out.innerHTML=`
<div class="tbl-wrap"><div class="tbl-hd"><h3>نتيجة التحليل (${esc(r.parsed?.kind||'?')})</h3></div>
<div style="padding:12px;line-height:1.9;font-size:13px">
رقم الفاتورة: <b>${esc(inv.invoiceNumber||'— لم يُعثر عليه — حدد عمود invoiceNumber في ملف التعريف')}</b><br>
التاريخ: <b>${esc(inv.date||'—')}</b> · طريقة الدفع: <b>${esc(inv.paymentMethod||'—')}</b> · عدد الأصناف: <b>${fN((inv.items||[]).length)}</b><br>
مطابقة: <span class="badge bdg-green">${fN((match.resolved||[]).length)} صنفًا جاهزًا</span> <span class="badge bdg-orange">${fN((match.unmapped||[]).length) } يحتاج ربطًا</span>
${(match.unmapped||[]).length?`<div style="margin-top:8px">${match.unmapped.map(u=>`<span class="badge bdg-orange" style="margin:2px">${esc(u.name||u.code||u.barcode)} — ${esc(u.reason)}</span>`).join('')}</div>`:''}
${r.suggestedProfile?`<div style="margin-top:8px"><b>ملف تعريف مقترح:</b><pre style="background:var(--bg3);padding:10px;border-radius:8px;overflow:auto;direction:ltr">${esc(JSON.stringify(r.suggestedProfile,null,2))}</pre></div>`:''}
</div></div>`;
}catch(e){
out.innerHTML=`<div class="mcard" style="border:1px solid var(--orange)"><b style="color:var(--orange)">فشل التحليل:</b> ${esc(e.message)}</div>`;
}
}
// ============================================
// ORACLE DATA BROWSER PAGE
// ============================================
const ORADATA = { tables: [], selected: null, data: null, page: 1, search: '' };
// ============================================
// WHATSAPP ENGINE PAGE
// ============================================
const WASTATE = { tab:'overview', status:null, msgs:null, outbox:null, rules:null, logs:null, timer:null, qrTimer:null };
function waStateBadge(s){
const map={CONNECTED:'bdg-green',QR_REQUIRED:'bdg-gold',AUTHENTICATING:'bdg-blue',RECONNECTING:'bdg-orange',DISCONNECTED:'bdg-gray',LOGGED_OUT:'bdg-red',FAILED:'bdg-red',STOPPED:'bdg-gray',INITIALIZING:'bdg-blue'};
const ar={CONNECTED:'متصل',QR_REQUIRED:'بانتظار QR',AUTHENTICATING:'توثيق',RECONNECTING:'إعادة وصل',DISCONNECTED:'منقطع',LOGGED_OUT:'مسجل خروج',FAILED:'فشل',STOPPED:'متوقف',INITIALIZING:'تهيئة'};
return `<span class="badge ${map[s]||'bdg-gray'}">${ar[s]||s||'—'}</span>`;
}
async function renderWhatsappPage(){
if(!['admin','manager'].includes(STATE.currentUser?.role)){ document.getElementById('content').innerHTML='<div class="mcard">لا تملك صلاحية الوصول</div>'; return; }
try{ WASTATE.status=await apiFetch('/whatsapp/status'); }catch(e){ WASTATE.status=null; }
waRenderBody();
if(WASTATE.timer) {clearInterval(WASTATE.timer);}
WASTATE.timer=setInterval(()=>{ if(STATE.page!=='whatsapp'){ clearInterval(WASTATE.timer); WASTATE.timer=null; waQrStop(); return; } waRefreshStatus(true); },10000);
}
function waSetTab(t){ WASTATE.tab=t; waRenderBody(); }
async function waRefreshStatus(silent){
try{
const s=await apiFetch('/whatsapp/status');
WASTATE.status=s;
if(STATE.page==='whatsapp'&&WASTATE.tab==='overview'&&!silent) {waRenderBody();}
else if(STATE.page==='whatsapp'&&WASTATE.tab==='overview'){ const el=document.getElementById('waStateBox'); if(el) {el.innerHTML=waStateHtml();} }
if(s?.connection?.state==='CONNECTED') {waQrStop();}
else {
// خانة الـ QR كانت تتجمد على «متصل ✓» بعد أول اتصال لحظي ثم لا تتحدث عند السقوط
// لـ RECONNECTING — امسح الشارة الكاذبة ونبه المستخدم، واجلب تلقائيًا عند توقع QR
const box=document.getElementById('waQrBox');
if(box && box.innerHTML.includes('متصل ✓')) {
box.innerHTML='<span class="text-muted">الاتصال انقطع — دوس «جلب الرمز» بالأسفل</span>';
}
if((s?.connection?.state==='QR_REQUIRED'||s?.connection?.state==='LOGGED_OUT') && box && !WASTATE.qrTimer) {try{waQrPoll();}catch(_){}}
}
}catch(e){ if(!silent) {toast(e.message||'تعذر التحديث','error');} }
}
function waStateHtml(){
const st=WASTATE.status; if(!st) {return '<div class="mcard u-empty">تعذر الجلب</div>';}
const c=st.connection||{}, q=st.queue||{};
const down=['LOGGED_OUT','DISCONNECTED','FAILED','STOPPED'].includes(c.state);
const banner=(down||st.linkNeeded)?`<div class="mcard" style="border:2px solid var(--red);background:rgba(231,76,60,.08);margin-bottom:12px"><b style="color:var(--red)">⚠ الواتساب غير متصل${c.state==='LOGGED_OUT'?' — الجلسة انتهت ويلزم مسح QR جديد':''}</b><br><small class="text-muted">الردود التلقائية والتقارير متوقفة مؤقتًا — الرسائل محفوظة في الطابور وستُرسل عند عودة الاتصال. امسح الرمز من الأسفل بتليفون الإدارة.</small></div>`:'';
return `${banner}<div class="metrics-grid">
<div class="mcard"><div class="mcard-label">الحالة</div><div style="margin-top:6px">${waStateBadge(c.state)}</div><small class="text-muted">إعادة وصل: ${fN(c.reconnects||0)}${c.lastError?` — ${esc(String(c.lastError).slice(0,80))}`:''}</small></div>
<div class="mcard"><div class="mcard-label">آخر اتصال ناجح</div><div class="mcard-val" style="font-size:15px">${c.lastOkAt?esc(String(c.lastOkAt).replace('T',' ').slice(0,19)):'—'}</div></div>
<div class="mcard"><div class="mcard-label">وارد معلق</div><div class="mcard-val c-gold">${fN(q.inbox_pending||0)}</div></div>
<div class="mcard"><div class="mcard-label">صادر مستحق</div><div class="mcard-val c-blue">${fN(q.outbox_due||0)}</div></div>
<div class="mcard"><div class="mcard-label">ردود تلقائية</div><div class="mcard-val c-green">${fN(st.metrics?.replied||0)}</div></div>
<div class="mcard"><div class="mcard-label">مكرر مُتجاهَل</div><div class="mcard-val">${fN(st.metrics?.duplicates||0)}</div></div>
</div>`;
}
function waRenderBody(){
const body=document.getElementById('content'); if(!body) {return;}
const canWrite=['admin','manager'].includes(STATE.currentUser?.role);
const tabs=[['overview','الحالة والربط'],['inbox','الوارد'],['outbox','الصادر'],['campaigns','الحملات'],['rules','قواعد الرد'],['managers','أرقام الإدارة'],['logs','السجل'],['query','استعلامات']];
body.innerHTML=`
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px" id="waTabs">
${tabs.map(([k,l])=>`<button class="btn btn-sm ${WASTATE.tab===k?'btn-gold':''}" onclick="waSetTab('${k}')">${l}</button>`).join('')}
</div>
<div id="waBody"></div>`;
const el=document.getElementById('waBody');
if(WASTATE.tab==='overview') {waRenderOverview(el,canWrite);}
else if(WASTATE.tab==='inbox') {waLoadMsgs(el);}
else if(WASTATE.tab==='outbox') {waLoadOutbox(el);}
else if(WASTATE.tab==='campaigns') {waLoadCampaigns(el);}
else if(WASTATE.tab==='rules') {waLoadRules(el,canWrite);}
else if(WASTATE.tab==='managers') {waLoadManagers(el);}
else if(WASTATE.tab==='query') {waRenderQueryTab(el,canWrite);}
else {waLoadLogs(el);}
}
function waRenderOverview(el,canWrite){
const st=WASTATE.status, c=st?.connection||{};
el.innerHTML=`
<div class="mcard" style="margin-bottom:12px"><b><i class=ji data-i=info></i> التشغيل:</b> <span style="color:var(--text2)">المحرك داخل عملية السيرفر — يعيد الوصل تلقائيًا عند انقطاع الشبكة. الربط أول مرة بالـ QR من حساب واتساب حقيقي (الأجهزة المرتبطة).</span></div>
<div id="waStateBox">${waStateHtml()}</div>
<div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=zap></i> التحكم</h3></div>
<div style="padding:16px 20px;display:flex;gap:10px;flex-wrap:wrap">
${canWrite?`<button class="btn btn-green btn-sm" onclick="waDo('start')"><i class=ji data-i=play></i> بدء</button>
<button class="btn btn-sm" onclick="waDo('stop')"><i class=ji data-i=pause></i> إيقاف</button>
<button class="btn btn-blue btn-sm" onclick="waPairModal()"><i class=ji data-i=key></i> ربط برقم الهاتف</button>
<button class="btn btn-red btn-sm" onclick="waLogoutModal()"><i class=ji data-i=log-out></i> خروج ومسح الجلسة</button>`:''}
<button class="btn btn-blue btn-sm" onclick="waRefreshStatus()"><i class=ji data-i=refresh></i> تحديث الحالة</button>
</div></div>
${STATE.currentUser?.role==='admin'?`<div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=clock></i> التقارير المجدولة والتنبيهات</h3><div class="u-row-wrap"><button class="btn btn-gold btn-sm" onclick="waAutoTest()"><i class=ji data-i=send></i> تجربة إرسال الآن</button></div></div>
<div style="padding:16px 20px" id="waAutoBox"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>`:''}
<div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=camera></i> رمز الربط QR</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="waQrPoll(true)"><i class=ji data-i=refresh></i> جلب الرمز</button> <button class="btn btn-gold btn-sm" onclick="waQrRefresh()"><i class=ji data-i=sync></i> رمز جديد</button></div></div>
<div style="padding:20px;text-align:center" id="waQrBox"><span class="text-muted">دوس جلب الرمز ثم امسحه من واتساب ← الأجهزة المرتبطة ← ربط جهاز</span></div></div>`;
if(c.state==='QR_REQUIRED'||c.qrAvailable){setTimeout(()=>waQrPoll(true),500);}
if(STATE.currentUser?.role==='admin') {waAutoLoad();}
}
async function waDo(action){
showLoad();
try{
await apiFetch('/whatsapp/'+action,{method:'POST'});
toast('تم','success'); await waRefreshStatus();
}catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
function waQrStop(){ if(WASTATE.qrTimer){ clearInterval(WASTATE.qrTimer); WASTATE.qrTimer=null; } }
async function waQrPoll(manual){
const box=document.getElementById('waQrBox'); if(!box) {return;}
if(manual){ box.innerHTML='<span class="spinner"></span> جارٍ جلب الرمز...'; }
try{
const d=await apiFetch('/whatsapp/qr');
if(d.connected){ box.innerHTML='<span class="badge bdg-green">متصل ✓ — لا حاجة لرمز</span>'; waQrStop(); return; }
if(d.qr&&typeof QRCode!=='undefined'&&QRCode.toDataURL){
const url=await QRCode.toDataURL(d.qr,{width:230,margin:1});
box.innerHTML=`<img src="${url}" alt="QR" style="border:8px solid #fff;border-radius:8px"><div class="text-muted" style="margin-top:8px">امسح خلال دقيقة — يتحدث تلقائيًا</div>`;
}else if(d.qr){ box.innerHTML=`<textarea class="inp" rows="4" readonly>${esc(d.qr)}</textarea>`; }
else{ box.innerHTML='<span class="text-muted">لا رمز بعد — ابدأ المحرك أولًا</span>'; return; }
}catch(e){
const msg=String(e.message||'تعذر الجلب');
// 404 من السيرفر تحمل الحالة الآن — اعرضها بدل الفراغ حتى يفهم المستخدم ماذا يفعل
const m=msg.match(/QR_NOT_READY|AUTHENTICATING|STOPPED|FAILED|LOGGED_OUT|ENGINE_START_FAILED/i);
if(manual||m){
box.innerHTML=`<span class="text-muted">لا رمز بعد (${esc(msg.slice(0,120))}) — ${msg.includes('رمز جديد')||msg.includes('التحقق')?'دوس «رمز جديد» لمسح الجلسة القديمة وتوليد QR':'انتظر 20 ثانية ثم أعد «جلب الرمز»'}</span>`;
if(manual){ toast(msg,'error'); }
}else if(manual){ toast(msg,'error'); }
return;
}
waQrStop();
WASTATE.qrTimer=setInterval(()=>{ if(STATE.page!=='whatsapp'){ waQrStop(); return; } waQrPoll(); },15000);
}
async function waQrRefresh(){
const box=document.getElementById('waQrBox'); if(!box){return;}
try{
box.innerHTML='<span class="spinner"></span> جارٍ إنشاء رمز جديد...';
const d=await apiFetch('/whatsapp/qr/refresh',{method:'POST'});
toast(d.message||'تم','success');
await new Promise(r=>setTimeout(r,3000));
await waQrPoll(true);
}catch(e){ toast(e.message||'فشل التحديث','error'); }
}
function waPairModal() {
showModal(`<h3><i class=ji data-i=key></i> ربط برقم الهاتف</h3>
<div class="mcard" style="margin-bottom:12px"><small class="text-muted">أدخل رقم الهاتف بالصيغة الدولية بدون + (مثال: 9665XXXXXXXX) وسيظهر رمز من 8 خانات تدخله في واتساب.</small></div>
<div class="fg"><label>رقم الهاتف</label><input id="waPairPhone" dir="ltr" placeholder="9665XXXXXXXX"></div>
<div id="waPairOut" style="margin-top:10px"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button><button class="btn btn-gold" onclick="waPairGo()">طلب الرمز</button></div>`);
}
async function waPairGo(){
const phone=document.getElementById('waPairPhone')?.value.trim()||'';
showLoad();
try{
const r=await apiFetch('/whatsapp/pairing',{method:'POST',body:JSON.stringify({phone})});
document.getElementById('waPairOut').innerHTML=`<div class="mcard" style="text-align:center"><div class="mcard-label">رمز الربط</div><div class="mcard-val c-gold" dir="ltr" style="font-size:28px;letter-spacing:6px">${esc(r.code)}</div></div>`;
}catch(e){ toast(e.message||'تعذر','error'); }finally{ hideLoad(); }
}
function waLogoutModal(){
showModal(`<h3 class="u-red"><i class=ji data-i=alert-triangle></i> خروج ومسح الجلسة</h3>
<div class="mcard" style="margin-bottom:12px;line-height:2">سيتم تسجيل خروج الحساب ومسح بيانات الربط من السيرفر. للربط مجددًا ستحتاج QR جديد.<br><small class="text-muted">سجل الرسائل والقواعد في القاعدة محفوظ ولا يُمس.</small></div>
<div class="fg"><label>اكتب LOGOUT للتأكيد</label><input id="waLogoutConfirm" dir="ltr" placeholder="LOGOUT"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="waLogoutGo()">تنفيذ الخروج</button></div>`);
}
async function waLogoutGo(){
if(document.getElementById('waLogoutConfirm')?.value.trim()!=='LOGOUT'){ toast('اكتب LOGOUT','error'); return; }
showLoad();
try{ await apiFetch('/whatsapp/logout',{method:'POST',body:JSON.stringify({confirm:'LOGOUT'})}); closeModal(); toast('تم الخروج','success'); await waRefreshStatus(); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
// ─── أتمتة التقارير والتنبيهات (واجهة) ───
async function waAutoLoad(){
const box=document.getElementById('waAutoBox'); if(!box) {return;}
try{
const d=await apiFetch('/whatsapp/automation');
const s=d.settings||{};
const chk=(k,l)=>`<label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="waAuto_${k}" ${s[k]!==false?'checked':''}> <span>${l}</span></label>`;
box.innerHTML=`<div class="fr">
<div class="fg">${chk('dailyReport','التقرير الليلي التلقائي')}<small class="text-muted">يُدفع لأرقام الإدارة مرة يوميًا</small></div>
<div class="fg"><label>وقت الإرسال</label><input type="time" id="waAuto_time" value="${esc(s.dailyTime||'23:30')}"></div>
</div><div class="fr">
<div class="fg">${chk('alertDevice','تنبيه انقطاع البصمة')}</div>
<div class="fg">${chk('alertUnmapped','تنبيه أقسام تنتظر اعتمادًا')}</div>
<div class="fg">${chk('alertFailed','تنبيه فواتير فاشلة')}</div>
<div class="fg">${chk('alertDocs','تنبيه الوثائق المنتهية/القريبة')}</div>
<div class="fg">${chk('alertShifts','تنبيه ورديات مفتوحة من أمس')}</div>
</div>
<div style="margin-top:10px"><button class="btn btn-gold btn-sm" onclick="waAutoSave()"><i class=ji data-i=save></i> حفظ الإعدادات</button></div>`;
}catch(e){ box.innerHTML=`<div class="u-empty-sm">${esc(e.message||'تعذر الجلب')}</div>`; }
}
async function waAutoSave(){
const body={ dailyReport:document.getElementById('waAuto_dailyReport')?.checked!==false, dailyTime:document.getElementById('waAuto_time')?.value||'23:30', alertDevice:document.getElementById('waAuto_alertDevice')?.checked!==false, alertUnmapped:document.getElementById('waAuto_alertUnmapped')?.checked!==false, alertFailed:document.getElementById('waAuto_alertFailed')?.checked!==false, alertDocs:document.getElementById('waAuto_alertDocs')?.checked!==false, alertShifts:document.getElementById('waAuto_alertShifts')?.checked!==false };
showLoad();
try{ await apiFetch('/whatsapp/automation',{method:'POST',body:JSON.stringify(body)}); toast('حُفظت الإعدادات','success'); waAutoLoad(); }
catch(e){ toast(e.message||'فشل الحفظ','error'); }finally{ hideLoad(); }
}
async function waAutoTest(){
if(!confirm('إرسال التقرير الليلي الآن لأرقام الإدارة (تجربة)؟')) {return;}
showLoad();
try{ const r=await apiFetch('/whatsapp/automation/test',{method:'POST'}); toast(`اترسل لـ ${r.queued} محادثة`,'success'); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
async function waLoadMsgs(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/messages?limit=50');
const users=(STATE.users||[]).filter(u=>['admin','manager','auditor'].includes(u.role));
const rows=(d.rows||[]).map(m=>{
const jid=String(m.remote_jid||'');
const userOptions=users.map(u=>`<option value="${u.id}"${String(m.assigned_to||'')===String(u.id)?' selected':''}>${esc(u.name||u.username||u.id)}</option>`).join('');
return `<tr><td class="text-muted">${esc(String(m.created_at||'').replace('T',' ').slice(0,19))}</td><td><code dir="ltr">${esc(jid)}</code></td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(m.body||'—')}</td><td>${esc(m.status)}</td><td><select id="waChatStatus_${m.id}" class="inp" style="min-width:100px"><option value="open"${m.chat_status==='open'||!m.chat_status?' selected':''}>مفتوحة</option><option value="pending"${m.chat_status==='pending'?' selected':''}>معلقة</option><option value="resolved"${m.chat_status==='resolved'?' selected':''}>محلولة</option><option value="snoozed"${m.chat_status==='snoozed'?' selected':''}>مؤجلة</option></select></td><td><select id="waChatPriority_${m.id}" class="inp" style="min-width:90px"><option value="normal"${m.chat_priority==='normal'||!m.chat_priority?' selected':''}>عادية</option><option value="low"${m.chat_priority==='low'?' selected':''}>منخفضة</option><option value="high"${m.chat_priority==='high'?' selected':''}>عالية</option><option value="urgent"${m.chat_priority==='urgent'?' selected':''}>عاجلة</option></select></td><td><select id="waChatAssignee_${m.id}" class="inp" style="min-width:120px"><option value="">غير معين</option>${userOptions}</select><button class="btn btn-xs btn-gold" onclick="waChatMetaSave('${encodeURIComponent(jid)}',${m.id})">حفظ</button></td></tr>`;
}).join('');
el.innerHTML=`<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=inbox></i> الوارد (${fN(d.total||0)})</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="waLoadMsgs(document.getElementById('waBody'))"><i class=ji data-i=refresh></i> تحديث</button></div></div>
<div class="tbl-scroll"><table><thead><tr><th>الوقت</th><th>المحادثة</th><th>النص</th><th>المعالجة</th><th>حالة المحادثة</th><th>الأولوية</th><th>التعيين</th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="u-empty-sm">لا رسائل بعد</td></tr>'}</tbody></table></div></div>`;
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function waLoadCampaigns(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/campaigns');
const canAdmin=STATE.currentUser?.role==='admin';
const rows=(d.campaigns||[]).map(c=>`<tr><td>${esc(c.name)}</td><td><code>${esc(c.template_name)}</code></td><td>${esc(c.status)}</td><td>${c.consented||0}/${c.recipients||0}</td><td>${c.sent||0}</td><td>${c.scheduled_at?esc(String(c.scheduled_at).replace('T',' ').slice(0,16)):'فورًا بعد الاعتماد'}</td><td>${canAdmin&&['draft'].includes(c.status)?`<button class="btn btn-xs btn-green" onclick="waCampaignAction(${c.id},'approve')">اعتماد</button>`:''}${canAdmin&&['approved','running'].includes(c.status)?`<button class="btn btn-xs" onclick="waCampaignAction(${c.id},'pause')">إيقاف</button>`:''}${canAdmin&&!['completed','cancelled'].includes(c.status)?`<button class="btn btn-xs btn-red" onclick="waCampaignAction(${c.id},'cancel')">إلغاء</button>`:''}</td></tr>`).join('');
el.innerHTML=`${canAdmin?`<div class="tbl-wrap" style="margin-bottom:12px"><div class="tbl-hd"><h3><i class=ji data-i=send></i> حملة جديدة (Draft)</h3></div><div style="padding:16px 20px"><div class="fr"><div class="fg"><label>اسم الحملة</label><input id="waCampName" class="inp"></div><div class="fg"><label>اسم القالب</label><input id="waCampTemplate" class="inp" placeholder="اسم قالب محفوظ"></div><div class="fg"><label>وقت الجدولة اختياري</label><input id="waCampSchedule" type="datetime-local" class="inp"></div></div><div class="fg"><label>المستلمون: كل سطر رقم|موافقة|متغيرات (مثال: 9665...@s.whatsapp.net|yes|أحمد,123)</label><textarea id="waCampRecipients" class="inp" rows="5" dir="ltr"></textarea></div><button class="btn btn-gold" onclick="waCampaignCreate()">إنشاء Draft</button></div></div>`:''}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=send></i> الحملات</h3><button class="btn btn-blue btn-sm" onclick="waLoadCampaigns(document.getElementById('waBody'))">تحديث</button></div><div class="tbl-scroll"><table><thead><tr><th>الاسم</th><th>القالب</th><th>الحالة</th><th>الموافقة</th><th>تم الإرسال</th><th>الجدولة</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="7" class="u-empty-sm">لا حملات</td></tr>'}</tbody></table></div></div>`;
}catch(e){el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`;}
}
async function waCampaignCreate(){
const lines=(document.getElementById('waCampRecipients')?.value||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const recipients=lines.map(line=>{const [remote_jid,consent,vars='']=line.split('|');return {remote_jid:remote_jid.trim(),consent:['yes','true','1','نعم'].includes(String(consent||'').toLowerCase()),vars:vars.split(',').filter(Boolean)};});
const body={name:document.getElementById('waCampName')?.value.trim(),template_name:document.getElementById('waCampTemplate')?.value.trim(),scheduled_at:document.getElementById('waCampSchedule')?.value||undefined,recipients};
try{await apiFetch('/whatsapp/campaigns',{method:'POST',body:JSON.stringify(body)});toast('تم إنشاء Draft — يحتاج اعتماد المدير','success');waLoadCampaigns(document.getElementById('waBody'));}catch(e){toast(e.message||'فشل إنشاء الحملة','error');}
}
async function waCampaignAction(id,action){
if(action==='cancel'&&!confirm('إلغاء الحملة؟')){return;}
try{await apiFetch(`/whatsapp/campaigns/${id}/${action}`,{method:'POST'});toast('تم تحديث الحملة','success');waLoadCampaigns(document.getElementById('waBody'));}catch(e){toast(e.message||'فشل تحديث الحملة','error');}
}
async function waChatMetaSave(encodedJid, messageId){
const jid=decodeURIComponent(encodedJid);
const status=document.getElementById('waChatStatus_'+messageId)?.value;
const priority=document.getElementById('waChatPriority_'+messageId)?.value;
const assigned=document.getElementById('waChatAssignee_'+messageId)?.value;
try{ await apiFetch('/whatsapp/chats/'+encodedJid+'/meta',{method:'POST',body:JSON.stringify({status,priority,assigned_to:assigned||undefined})}); toast('تم تحديث المحادثة','success'); }
catch(e){ toast(e.message||'تعذر تحديث المحادثة','error'); }
}
async function waLoadOutbox(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/outbox');
const rows=(d.rows||[]).map(m=>`<tr><td class="text-muted">${esc(String(m.created_at||'').replace('T',' ').slice(0,19))}</td><td><code dir="ltr">${esc(m.remote_jid)}</code></td><td style="max-width:280px;overflow:hidden;text-overflow:ellipsis">${esc(m.preview||'')}</td><td>${esc(m.status)} (${m.attempts||0})</td><td class="text-muted">${esc(m.last_error||'—')}</td></tr>`).join('');
el.innerHTML=`<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=send></i> الصادر</h3></div>
<div class="tbl-scroll"><table><thead><tr><th>الوقت</th><th>إلى</th><th>النص</th><th>الحالة</th><th>خطأ</th></tr></thead><tbody>${rows||'<tr><td colspan="5" class="u-empty-sm">لا رسائل صادرة</td></tr>'}</tbody></table></div></div>
<div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=plus></i> إرسال رسالة</h3></div>
<div style="padding:16px 20px"><div class="fr"><div class="fg"><label>إلى (JID)</label><input id="waSendTo" dir="ltr" placeholder="9665XXXXXXXX@s.whatsapp.net"></div></div>
<div class="fg"><label>النص</label><textarea id="waSendBody" rows="3"></textarea></div>
<button class="btn btn-gold" onclick="waSendGo()"><i class=ji data-i=send></i> إرسال للطابور</button></div></div>`;
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function waSendGo(){
const to=document.getElementById('waSendTo')?.value.trim()||'';
const body=document.getElementById('waSendBody')?.value.trim()||'';
if(!to||!body){ toast('أدخل المستلم والنص','error'); return; }
showLoad();
try{ const r=await apiFetch('/whatsapp/send',{method:'POST',body:JSON.stringify({to,body})}); toast(`في الطابور #${r.id}`,'success'); waLoadOutbox(document.getElementById('waBody')); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
async function waLoadRules(el,canWrite){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/rules');
const rows=(d.rows||[]).map(r=>`<tr><td class="fw-bold">${esc(r.name)}</td><td><span class="badge bdg-blue">${esc(r.match_type)}</span></td><td><code>${esc(r.pattern)}</code></td><td style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(r.response||'—')}</td><td>${r.enabled?'<span class="badge bdg-green">مفعلة</span>':'<span class="badge bdg-gray">معطلة</span>'}</td><td>${canWrite?`<button class="btn btn-sm" onclick='waRuleModal(${r.id})'><i class=ji data-i=pencil></i></button> <button class="btn btn-red btn-sm" onclick="waRuleDel(${r.id})"><i class=ji data-i=trash></i></button>`:''}</td></tr>`).join('');
WASTATE.rules=d.rows||[];
el.innerHTML=`<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=zap></i> قواعد الرد التلقائي (${fN((d.rows||[]).length)})</h3><div class="u-row-wrap">${canWrite?`<button class="btn btn-gold btn-sm" onclick="waRuleModal('')"><i class=ji data-i=plus></i> قاعدة جديدة</button>`:''}<button class="btn btn-blue btn-sm" onclick="waLoadRules(document.getElementById('waBody'),${canWrite})"><i class=ji data-i=refresh></i> تحديث</button></div></div>
<div class="tbl-scroll"><table><thead><tr><th>الاسم</th><th>النوع</th><th>النمط</th><th>الرد</th><th>الحالة</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="6" class="u-empty-sm">لا قواعد</td></tr>'}</tbody></table></div></div>`;
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
function waRuleModal(id){
const r=id?((WASTATE.rules||[]).find(x=>String(x.id)===String(id))||{}):{};
showModal(`<h3><i class=ji data-i=zap></i> ${id?'تعديل قاعدة':'قاعدة جديدة'}</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input id="waRuleName" value="${esc(r.name||'')}"></div>
<div class="fg"><label>النوع</label><select id="waRuleType"><option value="exact"${r.match_type==='exact'?' selected':''}>مطابقة تامة</option><option value="contains"${r.match_type==='contains'?' selected':''}>يحتوي</option><option value="command"${r.match_type==='command'?' selected':''}>أمر + وسائط</option></select></div></div>
<div class="fg"><label>النمط</label><input id="waRulePattern" value="${esc(r.pattern||'')}"></div>
<div class="fg"><label>الرد (فارغ للأوامر المنفذة برمجيًا)</label><textarea id="waRuleResponse" rows="3">${esc(r.response||'')}</textarea></div>
<div class="fg"><label style="display:flex;gap:8px;align-items:center;cursor:pointer"><input type="checkbox" id="waRuleEnabled" ${r.enabled===false?'':'checked'}> مفعلة</label></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="waRuleSave('${id||''}')"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function waRuleSave(id){
const body={ name:document.getElementById('waRuleName')?.value.trim()||'', match_type:document.getElementById('waRuleType')?.value||'exact', pattern:document.getElementById('waRulePattern')?.value.trim()||'', response:document.getElementById('waRuleResponse')?.value||'', enabled:document.getElementById('waRuleEnabled')?.checked!==false };
if(!body.name||!body.pattern){ toast('الاسم والنمط مطلوبان','error'); return; }
if(id) {body.id=Number(id);}
showLoad();
try{ await apiFetch('/whatsapp/rules',{method:'POST',body:JSON.stringify(body)}); closeModal(); toast('حُفظت القاعدة','success'); waLoadRules(document.getElementById('waBody'),true); }
catch(e){ toast(e.message||'فشل الحفظ','error'); }finally{ hideLoad(); }
}
async function waRuleDel(id){
if(!confirm('تعطيل هذه القاعدة؟')) {return;}
showLoad();
try{ await apiFetch('/whatsapp/rules/'+id,{method:'DELETE'}); toast('عُطلت القاعدة','success'); waLoadRules(document.getElementById('waBody'),true); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
// ─── قايمة أرقام الإدارة (مصرح لهم بأمر «تقرير») ───
async function waLoadManagers(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/managers');
const rows=(d.numbers||[]).map(n=>`<tr><td class="fw-bold" dir="ltr">${esc(n)}</td>
<td><button class="btn btn-red btn-sm" onclick="waManagerDel('${esc(n)}')"><i class=ji data-i=trash></i> حذف</button></td></tr>`).join('');
el.innerHTML=`<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=users></i> أرقام الإدارة (${fN((d.numbers||[]).length)})</h3></div>
<div style="padding:16px 20px"><div class="mcard" style="margin-bottom:12px"><small class="text-muted">الأرقام دي بس اللي يرد عليها المحرك بأمر «تقرير». أي رقم تاني بيترد عليه "غير مصرح".</small></div>
<div class="fr"><div class="fg"><label>رقم جديد (دولي بدون +)</label><input id="waMgrNum" dir="ltr" placeholder="9665XXXXXXXX"></div>
<div class="fg"><label>&nbsp;</label><button class="btn btn-gold" onclick="waManagerAdd()"><i class=ji data-i=plus></i> إضافة الرقم</button></div></div></div>
<div class="tbl-scroll"><table><thead><tr><th>الرقم</th><th></th></tr></thead><tbody>${rows||'<tr><td colspan="2" class="u-empty-sm">لا أرقام بعد — ضيف رقمك الأول</td></tr>'}</tbody></table></div></div>`;
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function waManagerAdd(){
const n=document.getElementById('waMgrNum')?.value.trim()||'';
if(!n){ toast('أدخل الرقم','error'); return; }
showLoad();
try{ await apiFetch('/whatsapp/managers',{method:'POST',body:JSON.stringify({number:n})}); toast('اتضاف الرقم','success'); waLoadManagers(document.getElementById('waBody')); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
async function waManagerDel(n){
if(!confirm(`حذف الرقم ${n} من الإدارة؟`)) {return;}
showLoad();
try{ await apiFetch('/whatsapp/managers/'+encodeURIComponent(n),{method:'DELETE'}); toast('اتحذف','success'); waLoadManagers(document.getElementById('waBody')); }
catch(e){ toast(e.message||'فشل','error'); }finally{ hideLoad(); }
}
// ─── استعلامات النظام ───
async function waRenderQueryTab(el,canWrite){
const cats = await apiFetch('/whatsapp/query/categories').catch(()=>null);
const categories = cats?.categories || [];
el.innerHTML=`
<div class="mcard" style="margin-bottom:12px"><b><i class=ji data-i=search></i> محرك الاستعلامات الذكية</b><br><small class="text-muted">اسأل عن أي شيء في النظام بالعربية أو الإنجليزية — مثال: "حضور اليوم"، "إيرادات الشهر"، "المخزون"، "عدد الموظفين"</small></div>
<div class="fg" style="margin-bottom:12px">
<input id="waQueryInput" type="text" class="inp" placeholder="اكتب سؤالك... (مثال: حضور أحمد 1/9)" style="font-size:16px">
<button class="btn btn-gold" onclick="waDoQuery()" style="margin-top:8px"><i class=ji data-i=paper-plane></i> استعلام</button>
</div>
<div style="margin-bottom:12px"><div class="tbl-hd"><h4>⚡ استعلامات سريعة</h4></div>
<div style="padding:12px;display:flex;gap:8px;flex-wrap:wrap">
${categories.map(c=>`<button class="btn btn-sm btn-blue" onclick="document.getElementById('waQueryInput').value='${c.label} ';waDoQuery()">${c.label}</button>`).join('')}
</div></div>
<div id="waQueryResult"></div>`;
if(categories.length===0){document.getElementById('waQueryResult').innerHTML='<div class="mcard">جارٍ تحميل الفئات...</div>';}
}
async function waDoQuery(){
const input=document.getElementById('waQueryInput');
const question=input?.value?.trim();
const result=document.getElementById('waQueryResult');
if(!question){toast('اكتب سؤال','error');return;}
result.innerHTML='<div class="mcard"><div class="spinner"></div>جارٍ المعالجة...</div>';
try{
const d=await apiFetch('/whatsapp/query',{method:'POST',body:JSON.stringify({question})});
if(d.ok && d.result){
result.innerHTML=`<div class="mcard" style="border:2px solid var(--green);background:rgba(39,174,96,.06)"><b>✅ الاستجابة:</b><div style="margin-top:8px;line-height:1.8">${d.result}</div></div>`;
}else{
result.innerHTML=`<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">❌ ${d.message||'فشل الاستعلام'}</b></div>`;
}
}catch(e){result.innerHTML=`<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">خطأ: ${e.message}</b></div>`;}
}
async function waLoadLogs(el){
el.innerHTML='<div class="mcard u-empty"><div class="spinner"></div></div>';
try{
const d=await apiFetch('/whatsapp/logs');
const rows=(d.rows||[]).map(l=>`<tr><td class="text-muted">${esc(String(l.created_at||'').replace('T',' ').slice(0,19))}</td><td><span class="badge bdg-blue">${esc(l.kind)}</span></td><td><code>${esc(l.ref||'—')}</code></td><td class="text-muted">${esc(l.detail||'')}</td></tr>`).join('');
el.innerHTML=`<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> سجل الأحداث</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="waLoadLogs(document.getElementById('waBody'))"><i class=ji data-i=refresh></i> تحديث</button></div></div>
<div class="tbl-scroll"><table><thead><tr><th>الوقت</th><th>النوع</th><th>المرجع</th><th>التفاصيل</th></tr></thead><tbody>${rows||'<tr><td colspan="4" class="u-empty-sm">لا أحداث بعد</td></tr>'}</tbody></table></div></div>`;
}catch(e){ el.innerHTML=`<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function renderOracleDataPage(){
  const content = document.getElementById('content');
  content.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <h3 class="u-gold-strong"><i class=ji data-i=database></i> بيانات Oracle المنسوخة</h3>
    <div style="display:flex;gap:8px;align-items:center"><span id="oraLastRefresh" style="font-size:.75em;color:var(--muted)"></span><button class="btn btn-blue btn-sm" onclick="oraDataRefresh()"><i class=ji data-i=refresh></i> تحديث</button><button class="btn btn-green btn-sm" onclick="oraDataSync()"><i class=ji data-i=database></i> مزامنة</button></div>
  </div>
  <div id="oraDataBody"><div class="mcard u-empty"><div class="spinner"></div></div></div>`;
  await oraDataRefresh();
}
async function renderDailyLocksPage(){
  const content = document.getElementById('content');
  content.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
    <h3 class="u-gold-strong"><i class=ji data-i=lock></i> لوحة التقفيل اليومي</h3>
    <div style="display:flex;gap:8px;align-items:center">
      <input type="date" id="dlDate" class="inp" style="width:auto" value="">
      <button class="btn btn-blue btn-sm" onclick="renderDailyLocksPage()"><i class=ji data-i=refresh></i> تحديث</button>
    </div>
  </div>
  <div id="dlBody"><div class="mcard u-empty"><div class="spinner"></div></div></div>`;
  const dateInput = document.getElementById('dlDate'); if(dateInput){ dateInput.value = new Date().toISOString().slice(0,10); }
  await loadDailyLocks();
}
async function loadDailyLocks(){
  const body = document.getElementById('dlBody'); if(!body) {return;}
  const date = document.getElementById('dlDate')?.value || new Date().toISOString().slice(0,10);
  try {
    const r = await apiFetch(`/yara-reports/daily-locks?date=${date}`);
    if(!r.ok){ body.innerHTML = `<div class="mcard u-empty">${esc(r.error||'خطأ')}</div>`; return; }
    const d = r;
    const rows = d.rows || [];
    const totalNet = rows.reduce((s,x)=>s+x.net,0);
    const totalInv = rows.reduce((s,x)=>s+x.invoices,0);
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;margin-bottom:16px">
        <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--gold)">${d.date}</div><div class="text-muted" style="font-size:.8em">اليوم</div></div>
        <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--green)">${d.locked}</div><div class="text-muted" style="font-size:.8em">مقفّل</div></div>
        <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--red)">${d.unlocked}</div><div class="text-muted" style="font-size:.8em">مفتوح</div></div>
        <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--blue)">${fN(totalInv)}</div><div class="text-muted" style="font-size:.8em">فاتورة</div></div>
        <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--gold)">${fN(totalNet)}</div><div class="text-muted" style="font-size:.8em">صافي</div></div>
      </div>
      <div style="overflow-x:auto"><table class="tbl"><thead><tr>
        <th>القسم</th><th>مقفّل</th><th>إيراد</th><th>مرتجع</th><th>صافي</th><th>فاتورة</th><th>مرتجعات</th>
      </tr></thead><tbody>
        ${rows.map(x=>`<tr style="${x.lock_count>0?"":"opacity:.5"}">
          <td><b>${esc(x.dept_name)}</b> <code>${esc(x.dept_code)}</code></td>
          <td>${x.lock_count>0?'<span class="badge bdg-green">مقفّل</span>':'<span class="badge bdg-red">مفتوح</span>'}</td>
          <td>${fN(x.gross)}</td><td>${fN(x.refund)}</td><td><b>${fN(x.net)}</b></td><td>${x.invoices}</td><td>${x.refunds}</td>
        </tr>`).join('')}
      </tbody></table></div>
      <div class="summary" style="margin-top:16px">
        <div class="card"><small>الإجمالي</small><b>${fN(totalNet)}</b></div>
        <div class="card"><small>الفاتورات</small><b>${fN(totalInv)}</b></div>
        <div class="card green"><small>مقفّل</small><b>${d.locked}</b></div>
        <div class="card red"><small>مفتوح</small><b>${d.unlocked}</b></div>
      </div>
    `;
  } catch(e){ body.innerHTML = `<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function oraDataRefresh(){
  const body = document.getElementById("oraDataBody"); if(!body) {return;}
  try {
    const r = await apiFetch("/oracle-data/tables");
    if(!r.ok){ body.innerHTML = `<div class="mcard u-empty">${esc(r.error||"خطأ")}</div>`; return; }
    ORADATA.tables = r.tables || [];
    oraDataRender();
    const el = document.getElementById("oraLastRefresh"); if(el) el.textContent = "آخر تحديث: " + new Date().toLocaleString("ar-EG");
  } catch(e){ body.innerHTML = `<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
async function oraDataSync(){
  const body = document.getElementById("oraDataBody"); if(!body) {return;}
  body.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div> جاري المزامنة...</div>';
  try {
    const r = await apiFetch("/oracle-data/refresh", {method:"POST"});
    if(!r.ok){ body.innerHTML = `<div class="mcard u-empty">${esc(r.error||"خطأ")}</div>`; return; }
    await oraDataRefresh();
    document.getElementById("oraLastRefresh").textContent = "آخر مزامنة: " + new Date().toLocaleTimeString("ar-EG");
  } catch(e){ body.innerHTML = `<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
function oraDataRender(){
  const body = document.getElementById('oraDataBody'); if(!body) {return;}
  const tables = ORADATA.tables;
  const totalRows = tables.reduce((s,t)=>s+(t.live_count||0),0);
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px">
      <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--gold)">${fN(tables.length)}</div><div class="text-muted" style="font-size:.8em">جدول</div></div>
      <div class="mcard" style="text-align:center;padding:16px"><div style="font-size:1.5em;font-weight:700;color:var(--green)">${fN(totalRows)}</div><div class="text-muted" style="font-size:.8em">صف إجمالًا</div></div>
    </div>
    <div class="mcard" style="margin-bottom:14px;padding:10px"><input type="text" id="oraSearchBox" class="inp" placeholder="بحث في اسم الجدول..." oninput="oraDataFilter(this.value)" style="width:100%"></div>
    <div style="overflow-x:auto"><table class="tbl"><thead><tr>
      <th>الجدول (Oracle)</th><th>الجدول (karim)</th><th>الصفوف</th><th></th>
    </tr></thead><tbody id="oraTblList">
      ${tables.map(t=>`<tr data-name="${esc((t.oracle_name||'').toLowerCase())}">
        <td><b>${esc(t.oracle_name||'')}</b></td>
        <td><code style="font-size:.75em">${esc(t.pg_name||'')}</code></td>
        <td><span class="badge bdg-blue">${fN(t.live_count||0)}</span></td>
        <td><button class="btn btn-sm btn-blue" onclick="oraDataOpen('${esc(t.pg_name||'')}')"><i class=ji data-i=eye></i> عرض</button></td>
      </tr>`).join('')}
    </tbody></table></div>
    <div id="oraDataDetail" style="margin-top:16px"></div>`;
}
function oraDataFilter(q){
  const rows = document.querySelectorAll('#oraTblList tr');
  const ql = (q||'').toLowerCase();
  rows.forEach(r => { r.style.display = (r.dataset.name||'').includes(ql) ? '' : 'none'; });
}
async function oraDataOpen(pgName, page=1, search=''){
  ORADATA.selected = pgName; ORADATA.page = page; ORADATA.search = search;
  const det = document.getElementById('oraDataDetail'); if(!det) {return;}
  det.innerHTML = '<div class="mcard u-empty"><div class="spinner"></div></div>';
  try {
    const q = `?page=${page}&limit=50&search=${encodeURIComponent(search)}`;
    const r = await apiFetch(`/oracle-data/${encodeURIComponent(pgName.replace('ora_',''))}${q}`);
    if(!r.ok){ det.innerHTML = `<div class="mcard u-empty">${esc(r.error||'خطأ')}</div>`; return; }
    ORADATA.data = r;
    oraDataRenderDetail();
  } catch(e){ det.innerHTML = `<div class="mcard u-empty">${esc(e.message)}</div>`; }
}
function oraDataRenderDetail(){
  const det = document.getElementById('oraDataDetail'); if(!det) {return;}
  const d = ORADATA.data; if(!d) {return;}
  const cols = d.columns || [];
  det.innerHTML = `
    <div class="mcard" style="padding:12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <h4><i class=ji data-i=table></i> ${esc(d.table||'')}</h4>
        <div class="u-row-wrap"><div class="text-muted">${fN(d.total)} صف — صفحة ${d.page}/${d.totalPages}</div><button class="btn btn-blue btn-sm" onclick="oraDataPrint()"><i class=ji data-i=printer></i> طباعة</button></div>
      </div>
      <div style="margin-top:8px"><input type="text" id="oraDetailSearch" class="inp" placeholder="بحث..." value="${esc(ORADATA.search||'')}" onkeydown="if(event.key==='Enter')oraDataOpen('${esc(ORADATA.selected)}',1,this.value)" style="width:100%;max-width:400px"></div>
    </div>
    <div style="overflow-x:auto"><table class="tbl"><thead><tr>
      ${cols.map(c=>`<th>${esc(c)}</th>`).join('')}
    </tr></thead><tbody>
      ${(d.rows||[]).map(row=>`<tr>${cols.map(c=>`<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(String(row[c]||''))}">${esc(String(row[c]||''))}</td>`).join('')}</tr>`).join('')}
    </tbody></table></div>
    ${d.totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:12px">
      ${d.page > 1 ? `<button class="btn btn-sm btn-blue" onclick="oraDataOpen('${esc(ORADATA.selected)}',${d.page-1},'${esc(ORADATA.search||'')}')">السابق</button>` : ''}
      ${d.page < d.totalPages ? `<button class="btn btn-sm btn-blue" onclick="oraDataOpen('${esc(ORADATA.selected)}',${d.page+1},'${esc(ORADATA.search||'')}')">التالي</button>` : ''}
    </div>` : ''}`;
}
function oraDataPrint(){
const d = ORADATA.data; if(!d) {return;}
const cols = d.columns || [];
const rows = (d.rows||[]).map(row=>`<tr>${cols.map(c=>`<td>${esc(String(row[c]??''))}</td>`).join('')}</tr>`).join('');
ysPrintReport(`جدول ${d.table}`, `${fN(d.total)} صف — صفحة ${d.page} من ${d.totalPages}${ORADATA.search?` — بحث: ${ORADATA.search}`:''}`,
[['إجمالي الصفوف', fN(d.total)],['الصفحة', `${d.page}/${d.totalPages}`]],
cols, rows);
}
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
${attendanceRecords.length>0?`
<div class="tbl-wrap u-mt16">
<div class="tbl-hd"><h3><i class=ji data-i=timer></i> سجل الحضور والانصراف</h3><div class="u-row-wrap"><button class="btn btn-gold btn-sm" onclick="printLuxCard('${emp.id}')"><i class=ji data-i=id-card></i> البطاقة الفاخرة</button><button class="btn btn-green btn-sm" onclick="printEmployeeAttendanceDay('${emp.id}')"><i class=ji data-i=printer></i> اليوم</button><button class="btn btn-blue btn-sm" onclick="printEmployeeAttendanceMonth('${emp.id}')"><i class=ji data-i=calendar></i> الشهر كامل</button></div></div>
<div class="tbl-scroll">
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
</div>
`:''}
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
// ============================================
// WAREHOUSE
// ============================================
function renderWarehouse(){
if(!checkMenuAccessLocal('warehouse')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
const totalValue = STATE.inventory.reduce((s,i)=>s+(i.qty*i.avgCost),0);
const lowStock = STATE.inventory.filter(i=>Number(i.qty)<Number(i.minQty));
const allInvoices = (STATE.purchaseInvoices||[]).slice().reverse();
const totalWeight = STATE.inventory.reduce((s,i)=>s+(i.weight||0),0);
const whCats = [...new Set((STATE.inventory||[]).map(i=>String(i.category||'عام')))].sort((a,b)=>a.localeCompare(b,'ar'));
if(whCatFilter!=='all' && !whCats.includes(whCatFilter)) {whCatFilter='all';}
const whItems = (STATE.inventory||[])
.filter(i=>whCatFilter==='all'||String(i.category||'عام')===whCatFilter)
.sort((a,b)=>String(a.category||'').localeCompare(String(b.category||''),'ar')||String(a.name||'').localeCompare(String(b.name||''),'ar'));
const whCatOpts = whCats.map(c=>`<option value="${esc(c)}" ${whCatFilter===c?'selected':''}>${esc(c)}</option>`).join('');
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> ${t('wh.items')}</div><div class="mcard-val c-gold">${fN(STATE.inventory.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('wh.value')}</div><div class="mcard-val c-green">${fC(totalValue)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> ${t('wh.low')}</div><div class="mcard-val ${lowStock.length>0?'c-red':'c-green'}">${fN(lowStock.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=file-text></i> ${t('wh.invoices')}</div><div class="mcard-val c-blue">${fN(allInvoices.length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('wh.weight')}</div><div class="mcard-val c-teal">${fN(totalWeight)} كجم</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('wh.shelves')}</div><div class="mcard-val c-purple">${fN(STATE.shelves.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> ${t('wh.cats')}</div><div class="mcard-val c-orange">${fN(new Set(STATE.inventory.map(i=>i.category)).size)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> ${t('wh.lastMove')}</div><div class="mcard-val c-blue u-t14">${STATE.inventoryTx.length>0?fD(STATE.inventoryTx[STATE.inventoryTx.length-1].date):'—'}</div></div>
</div>
${whShortPanel()}
<div class="tbl-wrap">
<div class="tbl-hd">
<h3><i class=ji data-i=package></i> ${t('wh.invTitle')}</h3>
<div class="u-row-wrap">
<select class="inp" onchange="whCatFilter=this.value;renderPage()" style="max-width:200px" title="تصفية حسب الفئة"><option value="all">كل الفئات (${fN(STATE.inventory.length)})</option>${whCatOpts}</select>
<input type="text" class="inp" placeholder="بحث: اسم / باركود / فئة..." oninput="ysTableSearch(this,'whInvBody')" style="max-width:240px">
<button class="btn btn-blue btn-sm" onclick="whPrintInventory()"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-green btn-sm" onclick="showAddPurchaseInvoiceModal()"><i class=ji data-i=file-text></i> ${t('wh.invBill')}</button>
<button class="btn btn-gold btn-sm" onclick="showOpeningBalanceModal()" title="إدخال سريع لأرصدة بداية الفترة دفعة واحدة"><i class=ji data-i=flag></i> رصيد افتتاحي</button>
<button class="btn btn-blue btn-sm" onclick="showImportItemsCatalogModal()"><i class=ji data-i=inbox></i> ${t('wh.impCat')}</button>
<button class="btn btn-blue btn-sm" onclick="showBulkInventoryImportModal()"><i class=ji data-i=chart></i> ${t('wh.impStock')}</button>
<button class="btn btn-blue btn-sm" onclick="scanToAddInventoryItem()"><i class=ji data-i=camera></i> ${t('wh.scan')}</button>
<button class="btn btn-gold btn-sm" onclick="showAddItemModal()"><i class=ji data-i=plus></i> ${t('wh.new')}</button>
<button class="btn btn-red btn-sm" onclick="whBulkDelete()"><i class=ji data-i=trash></i> حذف المحدد</button>
<button class="btn btn-purple btn-sm" onclick="showInventoryAuditModal()"><i class=ji data-i=clipboard-list></i> ${t('wh.audit')}</button><button class="btn btn-blue btn-sm" onclick="showFiscalYearModal()"><i class=ji data-i=calendar></i> ${t('wh.fyear')}</button>
</div>
</div>
<div class="tbl-scroll">
<table>
<thead><tr><th><input type="checkbox" onchange="document.querySelectorAll('.wh-sel').forEach(c=>c.checked=this.checked)" title="تحديد الكل"></th><th>${t('wh.item')}</th><th>${t('wh.cat')}</th><th>${t('wh.unit')}</th><th>${t('wh.qty')}</th><th>${t('wh.w8')}</th><th>${t('wh.shelf')}</th><th>${t('wh.min')}</th><th>${t('wh.avg')}</th><th>${t('wh.val')}</th><th>${t('wh.status')}</th><th>${t('wh.actions')}</th></tr></thead>
<tbody id="whInvBody">
${whItems.map(item=>{
const isLow = Number(item.qty)<Number(item.minQty);
const shelf = STATE.shelves.find(s=>s.id===item.shelfId);
return `<tr>
<td><input type="checkbox" class="wh-sel" value="${esc(String(item.id))}"></td>
<td class="fw-bold">${esc(item.name)}${item.barcode?`<div style="font-size:10px;color:var(--text3);font-family:monospace;font-weight:400">${esc(item.barcode)}</div>`:''}</td>
<td class="c-gold">${esc(item.category||'—')}</td>
<td>${item.unit}</td>
<td class="${isLow?'c-red fw-bold':''}">${fN(item.qty)}</td>
<td class="c-teal">${fN(item.weight||0)}</td>
<td>${shelf?`<span class="badge bdg-purple">${esc(shelf.code)}</span>`:'<span class="text-muted">—</span>'}</td>
<td class="c-red">${fN(item.minQty)}</td>
<td class="c-gold">${fC(item.avgCost)}</td>
<td class="c-gold fw-bold">${fC(item.qty*item.avgCost)}</td>
<td><span class="badge ${isLow?'bdg-red':'bdg-green'}">${isLow?`<i class=ji data-i=alert-triangle></i> ${t('wh.lowSt')}`:`<i class=ji data-i=circle-check></i> ${t('wh.okSt')}`}</span></td>
<td style="display:flex;gap:4px"><button type="button" class="btn btn-sm" data-action="edit-inventory" data-id="${esc(String(item.id))}" onclick="editItem('${esc(String(item.id))}')"><i class=ji data-i=pencil></i> ${t('act.edit')}</button><button type="button" class="btn btn-red btn-sm" data-action="delete-inventory" data-id="${esc(String(item.id))}" onclick="deleteItem('${esc(String(item.id))}')"><i class=ji data-i=trash></i> ${t('act.delete')}</button></td>
</tr>`;
}).join('')||`<tr><td colspan="11" class="u-empty">${t('wh.noItems')}</td></tr>`}
</tbody>
</table>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=file-text></i> ${t('wh.invBills')}</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث: رقم / مورد..." oninput="ysTableSearch(this,'whBillsBody')" style="max-width:220px"></div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>عدد الأصناف</th><th>الإجمالي</th><th>طريقة الدفع</th><th>إجراءات</th></tr></thead>
<tbody id="whBillsBody">
${allInvoices.map(inv=>`<tr>
<td class="fw-bold">${esc(inv.invoiceNumber)}</td>
<td>${fD(inv.date)}</td>
<td>${esc(inv.supplierName||'—')}</td>
<td>${Array.isArray(inv.items)?inv.items.length:(typeof inv.items==='string'?(()=>{try{return JSON.parse(inv.items).length||0}catch(_){return 0}})():0)}</td>
<td class="c-gold fw-bold">${fC(inv.totalAmount)}</td>
<td><span class="badge bdg-blue">${getPaymentMethodLabel(inv.paymentMethod)}</span></td>
<td><button class="btn btn-blue btn-sm" onclick="viewPurchaseInvoice('${inv.id}')"><i class=ji data-i=eye></i> عرض</button></td>
</tr>`).join('')||'<tr><td colspan="7" class="u-empty">لا توجد فواتير</td></tr>'}
</tbody>
</table>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=chart></i> آخر حركات المخزون</h3><div class="u-row-wrap"><input type="text" class="inp" placeholder="بحث في الحركات..." oninput="ysTableSearch(this,'whTxBody')" style="max-width:220px"></div></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الصنف</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>القيمة</th><th>المرجع</th></tr></thead>
<tbody id="whTxBody">
${(STATE.inventoryTx||[]).slice().reverse().slice(0,20).map(tx=>`<tr>
<td>${fD(tx.date)}</td>
<td class="fw-bold">${esc(tx.itemName)}</td>
<td><span class="badge ${tx.type==='in'?'bdg-green':tx.type==='out'?'bdg-red':tx.type==='return'?'bdg-blue':'bdg-gold'}">${tx.type==='in'?'<i class=ji data-i=inbox></i> وارد':tx.type==='out'?'<i class=ji data-i=upload></i> صادر':tx.type==='return'?'<i class=ji data-i=undo></i> مرتجع':'<i class=ji data-i=flag></i> افتتاحي'}</span></td>
<td>${fN(tx.qty)}</td>
<td class="c-gold">${tx.cost?fC(tx.cost):'—'}</td>
<td class="c-gold">${tx.totalValue?fC(tx.totalValue):'—'}</td>
<td><small>${esc(tx.invoiceNumber||tx.dispatchId||tx.notes||'—')}</small></td>
</tr>`).join('')||'<tr><td colspan="7" class="u-empty">لا توجد حركات</td></tr>'}
</tbody>
</table>
</div>
</div>
${renderKitchenReturnsSection()}
${renderPRSection()}
`;
}
function getPaymentMethodLabel(method){return method==='cash'?'<i class=ji data-i=banknote></i> نقدي':method==='bank'?'<i class=ji data-i=landmark></i> بنكي':'<i class=ji data-i=credit-card></i> آجل';}
async function whBulkDelete(){
const ids=[...document.querySelectorAll('.wh-sel:checked')].map(c=>String(c.value));
if(!ids.length){toast('حدد صنفًا واحدًا على الأقل','error');return;}
if(!confirm(`حذف ${ids.length} صنفًا من المخزن؟\nالأصناف المرتبطة بحركات/وصفات لن تُحذف وستُذكر في النتيجة.`)){return;}
showLoad();
let ok=0; const blocked=[];
for(const id of ids){
try{ await persistRemove('inventory', id); ok++; }
catch(e){ const it=(STATE.inventory||[]).find(x=>String(x.id)===String(id)); blocked.push({id, name:it?it.name:id}); }
}
if(blocked.length && STATE.currentUser?.role==='admin' && confirm(`${blocked.length} صنفًا لها حركات ولم تُحذف.\nهل تريد الحذف النهائي لها مع كل حركاتها وسجلاتها؟ (لا يمكن التراجع)`)){
for(const b of blocked){
try{ await apiFetch(`/warehouse/inventory/${encodeURIComponent(b.id)}/force`,{method:'DELETE'}); ok++; b.forced=true; }
catch(e){ b.error=true; }
}
const stillBlocked=blocked.filter(b=>!b.forced);
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
toast(stillBlocked.length?`حُذف ${ok} — تعذّر ${stillBlocked.length}: ${stillBlocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا (منها حذف نهائي)`, stillBlocked.length?'error':'success');
return;
}
try{ await window.loadData().catch(()=>{}); }catch(_){}
hideLoad(); renderPage();
toast(blocked.length?`حُذف ${ok} — تعذّر ${blocked.length} (مرتبطة بحركات): ${blocked.slice(0,5).map(b=>b.name).join('، ')}`:`حُذف ${ok} صنفًا`, blocked.length?'error':'success');
}
function whPrintInventory(){
const rows = (STATE.inventory||[]).map((item,i)=>{
const shelf = STATE.shelves.find(s=>s.id===item.shelfId);
return `<tr><td>${i+1}</td><td>${esc(item.name)}${item.barcode?` — ${esc(item.barcode)}`:''}</td><td>${esc(item.category||'—')}</td><td>${fN(item.qty)}</td><td>${esc(item.unit||'')}</td><td>${fC(item.avgCost)}</td><td>${fC(item.qty*item.avgCost)}</td><td>${Number(item.qty)<Number(item.minQty)?'منخفض':'سليم'}</td></tr>`;}).join('');
const totalValue = STATE.inventory.reduce((s,x)=>s+(x.qty*x.avgCost),0);
const low = STATE.inventory.filter(x=>Number(x.qty)<Number(x.minQty)).length;
ysPrintReport('كشف أصناف المخزون', `${fN(STATE.inventory.length)} صنفًا`,
[['الأصناف', fN(STATE.inventory.length)],['إجمالي القيمة', fC(totalValue)],['منخفض المخزون', fN(low)]],
['#','الصنف','الفئة','الكمية','الوحدة','متوسط التكلفة','القيمة','الحالة'], rows);
}

// ═══ مركز المشتريات والموردين — دليل موردون، أرصدة مستحقة، دفعات، كشوف حساب ═══
const PCMT = { tab:'invoices', invFilter:'all', suppSearch:'', paySupplier:'', stmt:null, stmtSupplier:null, stmtFrom:'', stmtTo:'' };
const PCMT_CAN_WRITE = ['admin','manager','warehouse'];
const PCMT_CAN_PAY = ['admin','manager','accountant'];
const PCMT_PAY_LABELS = { cash:'نقدي', bank:'تحويل بنكي', card:'بطاقة', cheque:'شيك', credit:'آجل' };
function pcmtStatusBadge(st){
    const map = { paid:['bdg-green','مدفوعة'], partial:['bdg-gold','مسددة جزئياً'], unpaid:['bdg-red','غير مسددة'] };
    const [cls,label] = map[st]||['bdg-red',st||'غير مسددة'];
    return `<span class="badge ${cls}">${label}</span>`;
}
function pcmtInvoiceSupplier(inv){
    if(inv.supplierId){ const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(inv.supplierId)); if(s) {return s.name;} }
    return inv.supplierName||'—';
}
function pcmtInvoiceRemaining(inv){ return Math.max(0, Number(inv.totalAmount||0) - Number(inv.paidAmount||0)); }
async function refreshProcurementData(){
    try{
        const [suppliers, payments] = await Promise.all([
            apiFetch('/procurement/suppliers'),
            apiFetch('/procurement/payments')
        ]);
        STATE.suppliers = Array.isArray(suppliers)?suppliers:[];
        STATE.supplierPayments = Array.isArray(payments)?payments:[];
    }catch(e){ console.warn('[procurement] refresh failed:', e.message); }
    if(STATE.page==='procurement') {renderPage();}
}
window.refreshProcurementData = refreshProcurementData;
function renderProcurement(){
    const suppliers = STATE.suppliers||[];
    const active = suppliers.filter(s=>s.is_active);
    const invoices = (STATE.purchaseInvoices||[]).filter(i=>i.supplierId);
    const purchasesTotal = invoices.reduce((a,i)=>a+Number(i.totalAmount||0),0);
    const paymentsTotal = (STATE.supplierPayments||[]).reduce((a,p)=>a+Number(p.amount||0),0);
    const openingTotal = suppliers.reduce((a,s)=>a+Number(s.openingBalance||0),0);
    const dueTotal = openingTotal + purchasesTotal - paymentsTotal;
    const unpaid = invoices.filter(i=>pcmtInvoiceRemaining(i)>0);
    const tabs = [['invoices',t('prc.invoices'),'file-text'],['suppliers',t('prc.suppliers'),'users'],['payments',t('prc.payments'),'banknote']];
    let body='';
    if(PCMT.tab==='invoices') {body=pcmtInvoicesTab(invoices, unpaid);}
    else if(PCMT.tab==='suppliers') {body=pcmtSuppliersTab(suppliers);}
    else {body=pcmtPaymentsTab();}
    return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=shopping-cart></i> إجمالي المشتريات (مرتبطة بموردين)</div><div class="mcard-val c-gold">${fC(purchasesTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الدفعات</div><div class="mcard-val c-green">${fC(paymentsTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> الرصيد المستحق للموردين</div><div class="mcard-val ${dueTotal>0?'c-red':'c-green'}">${fC(dueTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> موردون نشطون</div><div class="mcard-val c-blue">${fN(active.length)} / ${fN(suppliers.length)}</div></div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=file-text></i> فواتير غير مسددة</div><div class="mcard-val ${unpaid.length?'c-red':'c-green'}">${fN(unpaid.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=coins></i> متبقٍ على الفواتير</div><div class="mcard-val c-red">${fC(unpaid.reduce((a,i)=>a+pcmtInvoiceRemaining(i),0))}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=landmark></i> أرصدة افتتاحية</div><div class="mcard-val c-teal">${fC(openingTotal)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> مصدر الحقيقة</div><div class="mcard-val u-t13">الرصيد = افتتاحي + فواتير − دفعات</div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd" style="gap:10px;flex-wrap:wrap">
${tabs.map(([k,label,icon])=>`<button class="btn btn-sm ${PCMT.tab===k?'btn-gold':''}" onclick="PCMT.tab='${k}';renderPage()"><i class=ji data-i=${icon}></i> ${label}</button>`).join('')}
<div class="fr"></div>
${PCMT.tab==='invoices'?`<select class="u-input" style="max-width:180px" onchange="PCMT.invFilter=this.value;renderPage()">
<option value="all" ${PCMT.invFilter==='all'?'selected':''}>كل الفواتير</option>
<option value="unpaid" ${PCMT.invFilter==='unpaid'?'selected':''}>غير مسددة</option>
<option value="partial" ${PCMT.invFilter==='partial'?'selected':''}>مسددة جزئياً</option>
<option value="paid" ${PCMT.invFilter==='paid'?'selected':''}>مدفوعة</option>
</select>`:''}
${PCMT.tab==='suppliers'?`<input class="u-input" style="max-width:220px" placeholder="بحث باسم المورد..." value="${esc(PCMT.suppSearch)}" oninput="PCMT.suppSearch=this.value;pcmtRerenderSuppliers()">`:''}
${PCMT.tab==='suppliers'&&PCMT_CAN_WRITE.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="showSupplierModal()"><i class=ji data-i=plus></i> مورد جديد</button>`:''}
${PCMT.tab==='payments'&&PCMT_CAN_PAY.includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="showPaymentModal()"><i class=ji data-i=plus></i> تسجيل دفعة</button>`:''}
</div>
${body}
</div>`;
}
function pcmtRerenderSuppliers(){
    const wrap=document.querySelector('.tbl-wrap'); if(!wrap) {return;}
    const old=wrap.innerHTML; wrap.innerHTML=pcmtSuppliersTab(STATE.suppliers||[]);
    void old;
}
function pcmtInvoicesTab(allInvoices, unpaid){
    let invoices = allInvoices.slice().reverse();
    if(PCMT.invFilter!=='all') {invoices = invoices.filter(i=>(i.paymentStatus||'unpaid')===PCMT.invFilter);}
    return `
<div class="tbl-scroll">
<table>
<thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>المورد</th><th>الإجمالي</th><th>المسدد</th><th>المتبقي</th><th>حالة السداد</th><th>إجراءات</th></tr></thead>
<tbody>
${invoices.map(inv=>{
const rem=pcmtInvoiceRemaining(inv);
const canPay=rem>0&&PCMT_CAN_PAY.includes(STATE.currentUser?.role);
return `<tr>
<td class="fw-bold">${esc(inv.invoiceNumber)}</td>
<td>${fD(inv.date)}</td>
<td class="c-gold">${esc(pcmtInvoiceSupplier(inv))}</td>
<td class="c-gold fw-bold">${fC(inv.totalAmount)}</td>
<td class="c-green">${fC(inv.paidAmount||0)}</td>
<td class="${rem>0?'c-red':'c-green'} fw-bold">${fC(rem)}</td>
<td>${pcmtStatusBadge(inv.paymentStatus)}</td>
<td style="display:flex;gap:4px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" onclick="viewPurchaseInvoice('${esc(String(inv.id))}')"><i class=ji data-i=eye></i> عرض</button>
${canPay?`<button class="btn btn-green btn-sm" onclick="payInvoiceFull('${esc(String(inv.id))}')"><i class=ji data-i=coins></i> تسديد</button>`:''}
<button class="btn btn-sm" onclick="printPurchaseInvoice('${esc(String(inv.id))}')"><i class=ji data-i=printer></i> طباعة</button>
</td>
</tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد فواتير مطابقة — أنشئ فاتورة شراء مرتبطة بمورد من صفحة المخزن</td></tr>'}
</tbody>
</table>
</div>`;
}
function pcmtSuppliersTab(suppliers){
    const q=String(PCMT.suppSearch||'').trim().toLowerCase();
    const rows=suppliers.filter(s=>!q||String(s.name||'').toLowerCase().includes(q));
    return `
<div class="tbl-scroll">
<table>
<thead><tr><th>المورد</th><th>الهاتف</th><th>نوع التوريد</th><th>عدد الفواتير</th><th>إجمالي المشتريات</th><th>إجمالي الدفعات</th><th>الرصيد المستحق</th><th>الحالة</th><th>إجراءات</th></tr></thead>
<tbody>
${rows.map(s=>{
const canW=PCMT_CAN_WRITE.includes(STATE.currentUser?.role);
const canP=PCMT_CAN_PAY.includes(STATE.currentUser?.role);
return `<tr ${s.is_active?'':'style="opacity:.55"'}>
<td class="fw-bold">${esc(s.name)}</td>
<td>${esc(s.phone||'—')}</td>
<td>${esc(s.category||'—')}</td>
<td>${fN(s.invoiceCount||0)}</td>
<td class="c-gold">${fC(s.purchasesTotal||0)}</td>
<td class="c-green">${fC(s.paymentsTotal||0)}</td>
<td class="${Number(s.dueTotal)>0?'c-red fw-bold':'c-green'}">${fC(s.dueTotal||0)}</td>
<td><span class="badge ${s.is_active?'bdg-green':'bdg-red'}">${s.is_active?'نشط':'موقوف'}</span></td>
<td style="display:flex;gap:4px;flex-wrap:wrap">
<button class="btn btn-blue btn-sm" onclick="openStatement('${esc(String(s.id))}')"><i class=ji data-i=file-text></i> كشف حساب</button>
${canP&&s.is_active?`<button class="btn btn-green btn-sm" onclick="showPaymentModal('${esc(String(s.id))}')"><i class=ji data-i=coins></i> دفعة</button>`:''}
${canW?`<button class="btn btn-sm" onclick="showSupplierModal('${esc(String(s.id))}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-purple btn-sm" onclick="toggleSupplier('${esc(String(s.id))}')"><i class=ji data-i=${s.is_active?'lock':'unlock'}></i> ${s.is_active?'إيقاف':'تفعيل'}</button>
<button class="btn btn-red btn-sm" onclick="deleteSupplier('${esc(String(s.id))}')"><i class=ji data-i=trash></i> حذف</button>`:''}
</td>
</tr>`;}).join('')||'<tr><td colspan="9" class="u-empty">لا يوجد موردون — أضف أول مورد من زر «مورد جديد»</td></tr>'}
</tbody>
</table>
</div>`;
}
function pcmtPaymentsTab(){
    let payments=STATE.supplierPayments||[];
    if(PCMT.paySupplier) {payments=payments.filter(p=>String(p.supplierId)===String(PCMT.paySupplier));}
    const canDel=STATE.currentUser?.role==='admin';
    return `
<div class="fr" style="margin-bottom:10px"><select class="u-input" style="max-width:240px" onchange="PCMT.paySupplier=this.value;renderPage()">
<option value="">كل الموردين</option>
${(STATE.suppliers||[]).map(s=>`<option value="${esc(String(s.id))}" ${String(PCMT.paySupplier)===String(s.id)?'selected':''}>${esc(s.name)}</option>`).join('')}
</select></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>المورد</th><th>المبلغ</th><th>الطريقة</th><th>الفاتورة المرتبطة</th><th>ملاحظات</th><th>سجّلها</th>${canDel?'<th>إجراءات</th>':''}</tr></thead>
<tbody>
${payments.map(p=>{
const inv=p.invoiceId?(STATE.purchaseInvoices||[]).find(i=>String(i.id)===String(p.invoiceId)):null;
return `<tr>
<td>${fD(p.date)}</td>
<td class="c-gold fw-bold">${esc(p.supplierName||'—')}</td>
<td class="c-green fw-bold">${fC(p.amount)}</td>
<td><span class="badge bdg-blue">${PCMT_PAY_LABELS[p.method]||p.method}</span></td>
<td>${inv?esc(inv.invoiceNumber||('#'+inv.id)):'—'}</td>
<td>${esc(p.notes||'—')}</td>
<td class="u-t12">${esc(p.createdBy||'—')}</td>
${canDel?`<td><button class="btn btn-red btn-sm" onclick="deletePayment('${esc(String(p.id))}')"><i class=ji data-i=trash></i> عكس</button></td>`:''}
</tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد دفعات مسجلة</td></tr>'}
</tbody>
</table>
</div>`;
}
function showSupplierModal(id){
    const s=id?(STATE.suppliers||[]).find(x=>String(x.id)===String(id)):null;
    showModal(`
<h3><i class=ji data-i=users></i> ${s?'تعديل مورد':'مورد جديد'}</h3>
<div class="fr"><div class="fg"><label>اسم المورد *</label><input type="text" id="suppName" value="${esc(s?.name||'')}" placeholder="مثال: مؤسسة اللحوم الطازجة"></div>
<div class="fg"><label>رقم الهاتف</label><input type="text" id="suppPhone" value="${esc(s?.phone||'')}" placeholder="05xxxxxxxx"></div></div>
<div class="fr"><div class="fg"><label>نوع التوريد</label><input type="text" id="suppCategory" value="${esc(s?.category||'')}" placeholder="لحوم / خضار / مشروبات..."></div>
<div class="fg"><label>الرصيد الافتتاحي المستحق</label><input type="number" id="suppOpening" value="${s?Number(s.openingBalance||0):0}" step="0.01" min="0"><small class="text-muted">ما عليه له قبل استخدام النظام</small></div></div>
<div class="fg"><label>العنوان</label><input type="text" id="suppAddress" value="${esc(s?.address||'')}"></div>
<div class="fg"><label>ملاحظات</label><textarea id="suppNotes" rows="2">${esc(s?.notes||'')}</textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="saveSupplier(${s?`'${esc(String(s.id))}'`:'null'})"><i class=ji data-i=save></i> حفظ</button></div>
`);
}
async function saveSupplier(id){
    const payload={ name:document.getElementById('suppName')?.value.trim(), phone:document.getElementById('suppPhone')?.value.trim(),
        category:document.getElementById('suppCategory')?.value.trim(), address:document.getElementById('suppAddress')?.value.trim(),
        notes:document.getElementById('suppNotes')?.value.trim(), openingBalance:document.getElementById('suppOpening')?.value };
    if(!payload.name||payload.name.length<2){ toast('اسم المورد مطلوب (حرفان على الأقل)','error'); return; }
    try{
        if(id){ const row=await apiFetch('/procurement/suppliers/'+id,{method:'PUT',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تم تحديث بيانات المورد','success'); }
        else{ const row=await apiFetch('/procurement/suppliers',{method:'POST',body:JSON.stringify(payload)}); upsertStateEntity('suppliers',row); toast('تمت إضافة المورد','success'); }
        closeModal(); renderPage();
    }catch(e){ toast(e.message||'تعذر حفظ المورد','error'); }
}
async function toggleSupplier(id){
    try{ const row=await apiFetch('/procurement/suppliers/'+id+'/toggle',{method:'POST'}); upsertStateEntity('suppliers',row); toast(row.is_active?'تم تفعيل المورد':'تم إيقاف المورد','info'); renderPage(); }
    catch(e){ toast(e.message||'تعذر تغيير الحالة','error'); }
}
async function deleteSupplier(id){
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(id));
    if(!confirm(`حذف المورد «${s?.name||''}» نهائيًا؟ لا يمكن الحذف إذا له فواتير أو دفعات (استخدم الإيقاف بدلًا منها).`)) {return;}
    try{
        await apiFetch('/procurement/suppliers/'+id,{method:'DELETE'});
        STATE.suppliers=(STATE.suppliers||[]).filter(x=>String(x.id)!==String(id));
        toast('تم حذف المورد','success'); renderPage();
    }catch(e){ toast(e.message||'تعذر حذف المورد — جرّب إيقافه','error'); }
}
function showPaymentModal(supplierId){
    const suppliers=(STATE.suppliers||[]).filter(s=>s.is_active);
    if(!suppliers.length){ toast('أضف مورداً واحداً على الأقل أولاً','warning'); return; }
    const selected=supplierId||String(suppliers[0].id);
    showModal(`
<h3><i class=ji data-i=coins></i> تسجيل دفعة لمورد</h3>
<div class="fr"><div class="fg"><label>المورد *</label><select id="paySupplier" onchange="pcmtOnSupplierChange()">${suppliers.map(s=>`<option value="${esc(String(s.id))}" ${String(selected)===String(s.id)?'selected':''}>${esc(s.name)} — مستحق ${fN(s.dueTotal)}</option>`).join('')}</select></div>
<div class="fg"><label>المبلغ *</label><input type="number" id="payAmount" step="0.01" min="0.01" placeholder="0.00"></div></div>
<div class="fr"><div class="fg"><label>طريقة الدفع</label><select id="payMethod"><option value="cash">نقدي</option><option value="bank">تحويل بنكي</option><option value="card">بطاقة</option><option value="cheque">شيك</option></select></div>
<div class="fg"><label>التاريخ</label><input type="date" id="payDate" value="${today()}"></div></div>
<div class="fg"><label>ربط بفاتورة (اختياري)</label><select id="payInvoice"><option value="">دفعة على الحساب العام</option>${pcmtUnpaidOptions(selected)}</select>
<small class="text-muted">عند الربط يجب ألا يتجاوز المبلغ المتبقي على الفاتورة</small></div>
<div class="fg"><label>ملاحظات</label><input type="text" id="payNotes" placeholder="مثال: دفعة أولى"></div>
<div id="payHint" class="u-t13 text-muted"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="savePayment()"><i class=ji data-i=save></i> حفظ الدفعة</button></div>
`);
    pcmtOnSupplierChange();
}
function pcmtUnpaidOptions(supplierId){
    return (STATE.purchaseInvoices||[])
        .filter(i=>String(i.supplierId)===String(supplierId)&&pcmtInvoiceRemaining(i)>0)
        .map(i=>`<option value="${esc(String(i.id))}">${esc(i.invoiceNumber)} — متبقٍ ${fN(pcmtInvoiceRemaining(i))}</option>`).join('');
}
function pcmtOnSupplierChange(){
    const sel=document.getElementById('paySupplier'); if(!sel) {return;}
    const invSel=document.getElementById('payInvoice'); if(!invSel) {return;}
    const cur=invSel.value;
    invSel.innerHTML='<option value="">دفعة على الحساب العام</option>'+pcmtUnpaidOptions(sel.value);
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(sel.value));
    const hint=document.getElementById('payHint');
    if(hint) {hint.innerHTML=s?`الرصيد المستحق حالياً لـ «${esc(s.name)}»: <strong class="${Number(s.dueTotal)>0?'c-red':'c-green'}">${fC(s.dueTotal)}</strong> (افتتاحي ${fN(s.openingBalance)} + فواتير ${fN(s.purchasesTotal)} − دفعات ${fN(s.paymentsTotal)})`:'';}
    if(cur) {invSel.value=cur;}
}
async function savePayment(){
    const payload={ supplierId:document.getElementById('paySupplier')?.value, amount:document.getElementById('payAmount')?.value,
        method:document.getElementById('payMethod')?.value||'cash', date:document.getElementById('payDate')?.value,
        invoiceId:document.getElementById('payInvoice')?.value||null, notes:document.getElementById('payNotes')?.value.trim() };
    if(!payload.supplierId){ toast('اختر المورد','error'); return; }
    if(!Number(payload.amount)||Number(payload.amount)<=0){ toast('أدخل مبلغاً أكبر من صفر','error'); return; }
    try{
        const result=await apiFetch('/procurement/payments',{method:'POST',body:JSON.stringify(payload)});
        upsertStateEntity('supplierPayments',result.payment);
        if(result.invoice) {upsertStateEntity('purchaseInvoices',result.invoice);}
        closeModal();
        toast(`تم تسجيل دفعة بقيمة ${fC(result.payment.amount)} — الرصيد المستحق الآن ${fC(result.supplierDueTotal||0)}`,'success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر تسجيل الدفعة','error'); }
}
async function payInvoiceFull(id){
    const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
    if(!inv) {return;}
    const rem=pcmtInvoiceRemaining(inv);
    if(rem<=0){ toast('الفاتورة مسددة بالكامل','info'); return; }
    if(!confirm(`تسديد كامل المتبقي على الفاتورة ${inv.invoiceNumber||''}: ${fN(rem)} ${STATE.settings.currency}؟`)) {return;}
    try{
        const result=await apiFetch('/procurement/invoices/'+id+'/pay',{method:'POST',body:JSON.stringify({method:'cash'})});
        upsertStateEntity('supplierPayments',result.payment);
        upsertStateEntity('purchaseInvoices',result.invoice);
        toast(`تم تسديد الفاتورة بالكامل (${fC(rem)})`,'success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر التسديد','error'); }
}
async function deletePayment(id){
    const p=(STATE.supplierPayments||[]).find(x=>String(x.id)===String(id));
    if(!p) {return;}
    if(!confirm(`عكس الدفعة بقيمة ${fN(p.amount)} ${STATE.settings.currency}؟ سيُعاد المبلغ إلى رصيد المورد المستحق${p.invoiceId?' وتُعاد حالة الفاتورة المرتبطة':''}.`)) {return;}
    try{
        const result=await apiFetch('/procurement/payments/'+id,{method:'DELETE'});
        STATE.supplierPayments=(STATE.supplierPayments||[]).filter(x=>String(x.id)!==String(id));
        if(result.invoice) {upsertStateEntity('purchaseInvoices',result.invoice);}
        toast('تم عكس الدفعة','success');
        await refreshProcurementData(); renderPage();
    }catch(e){ toast(e.message||'تعذر عكس الدفعة','error'); }
}
async function openStatement(id){
    const s=(STATE.suppliers||[]).find(x=>String(x.id)===String(id));
    if(!s) {return;}
    PCMT.stmtSupplier=s; PCMT.stmtFrom=''; PCMT.stmtTo=''; PCMT.stmt=null;
    showModal(`
<h3><i class=ji data-i=file-text></i> كشف حساب — ${esc(s.name)}</h3>
<div class="fr"><div class="fg"><label>من تاريخ</label><input type="date" id="stmtFrom" value="${PCMT.stmtFrom}"></div>
<div class="fg"><label>إلى تاريخ</label><input type="date" id="stmtTo" value="${PCMT.stmtTo}"></div>
<div class="fg"><label>&nbsp;</label><button class="btn btn-blue" onclick="loadStatement()"><i class=ji data-i=search></i> عرض الكشف</button></div></div>
<div id="stmtBody"><div class="u-empty" style="padding:24px">اختر الفترة (أو اتركها فارغة لكل الحركات) ثم اعرض الكشف</div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button><button class="btn btn-gold" onclick="printStatement()"><i class=ji data-i=printer></i> طباعة</button></div>
`,'modal-wide');
}
async function loadStatement(){
    const s=PCMT.stmtSupplier; if(!s) {return;}
    PCMT.stmtFrom=document.getElementById('stmtFrom')?.value||'';
    PCMT.stmtTo=document.getElementById('stmtTo')?.value||'';
    const body=document.getElementById('stmtBody'); if(!body) {return;}
    body.innerHTML='<div class="u-empty"><div class="spinner"></div></div>';
    try{
        const params=new URLSearchParams();
        if(PCMT.stmtFrom) {params.set('from',PCMT.stmtFrom);}
        if(PCMT.stmtTo) {params.set('to',PCMT.stmtTo);}
        const res=await apiFetch('/procurement/suppliers/'+s.id+'/statement'+(params.toString()?'?'+params:''));
        PCMT.stmt=res.statement;
        body.innerHTML=pcmtStatementHtml(res.supplier,res.statement);
    }catch(e){ body.innerHTML=`<div class="u-empty">${esc(e.message||'تعذر تحميل الكشف')}</div>`; }
}
function pcmtStatementHtml(supplier,stmt){
    const rows=stmt.rows.map(r=>`<tr>
<td>${fD(r.date)}</td>
<td>${r.type==='invoice'?'<span class="badge bdg-blue">فاتورة</span>':'<span class="badge bdg-green">دفعة</span>'}</td>
<td>${esc(r.ref)}</td>
<td class="c-red">${r.debit?fN(r.debit):'—'}</td>
<td class="c-green">${r.credit?fN(r.credit):'—'}</td>
<td class="fw-bold ${r.balance>0?'c-red':r.balance<0?'c-green':''}">${fN(r.balance)}</td>
</tr>`).join('')||'<tr><td colspan="6" class="u-empty">لا حركات في هذه الفترة</td></tr>';
    return `
<div class="u-t13 text-muted u-mb8">الرصيد الافتتاحي للفترة: <strong>${fN(stmt.openingBalance)}</strong> ${STATE.settings.currency} — الإجمالي: مدين ${fN(stmt.totals.debit)} / دائن ${fN(stmt.totals.credit)} — <strong>الرصيد الختامي: ${fN(stmt.totals.closing)}</strong></div>
<div class="tbl-scroll"><table>
<thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين (يزيد)</th><th>دائن (ينقص)</th><th>الرصيد</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><td colspan="3">إجمالي الفترة</td><td class="c-red fw-bold">${fN(stmt.totals.debit)}</td><td class="c-green fw-bold">${fN(stmt.totals.credit)}</td><td class="fw-bold">${fN(stmt.totals.closing)}</td></tr></tfoot>
</table></div>`;
}
function printStatement(){
    const s=PCMT.stmtSupplier, stmt=PCMT.stmt;
    if(!s||!stmt){ toast('اعرض الكشف أولاً ثم اطبعه','warning'); return; }
    const currency=esc(STATE.settings.currency||'SAR');
    const rows=stmt.rows.map(r=>`<tr><td>${fD(r.date)}</td><td>${r.type==='invoice'?'فاتورة شراء':'دفعة'}</td><td>${esc(r.ref)}</td><td>${r.debit?fN(r.debit):'—'}</td><td>${r.credit?fN(r.credit):'—'}</td><td>${fN(r.balance)}</td></tr>`).join('');
    const win=window.open('','_blank','width=900,height=1000');
    if(!win){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
    win.document.open();
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>كشف حساب — ${esc(s.name)}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccc;padding:8px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}@media print{.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button onclick="window.print()">طباعة</button><button onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'')}</h1><p>كشف حساب مورد</p><p>${esc(s.name)}${s.phone?' — '+esc(s.phone):''}</p></header><section class="meta"><div><b>من</b>${PCMT.stmtFrom||'البداية'}</div><div><b>إلى</b>${PCMT.stmtTo||'اليوم'}</div><div><b>الرصيد الافتتاحي</b>${fN(stmt.openingBalance)} ${currency}</div></section><table><thead><tr><th>التاريخ</th><th>النوع</th><th>المرجع</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead><tbody>${rows||'<tr><td colspan="6">لا حركات</td></tr>'}</tbody><tfoot><tr><td colspan="3">إجمالي الفترة</td><td>${fN(stmt.totals.debit)}</td><td>${fN(stmt.totals.credit)}</td><td>الختامي: ${fN(stmt.totals.closing)}</td></tr></tfoot></table></main></body></html>`);
    win.document.close(); win.focus();
}

// ═══ استوديو جرد المخزون الاحترافي — عدّ حي تُلقائي، فروقات فورية، أوراق طباعة ═══
const STOCK = { tab:'new', detail:null, dirty:{}, timers:{}, search:'', diffsOnly:false, scope:{mode:'all',category:'',search:''}, locationId:0, locations:null };
const STOCK_CAN_WRITE = ['admin','manager','warehouse'];
function stocktakStatusBadge(status){
    const map = { draft:['bdg-gold','مسودة قيد العد'], submitted:['bdg-blue','بانتظار الاعتماد'], approved:['bdg-green','معتمد'], cancelled:['bdg-red','ملغاة'] };
    const [cls,label] = map[status]||['bdg-gold',status];
    return `<span class="badge ${cls}">${label}</span>`;
}
function stocktakChipsHtml(){
    const d = STOCK.detail; if(!d) {return '';}
    const summary = stocktakClientSummary();
    const neg = summary.projected_variance_value < 0;
    return `<div class="st-chips">
        <span class="st-chip st-c-blue"><i class=ji data-i=package></i> معدود ${d.progress.counted} / ${d.progress.total}</span>
        <span class="st-chip ${summary.items_with_variance?'st-c-orange':'st-c-green'}"><i class=ji data-i=git-compare></i> أصناف بفروقات ${summary.items_with_variance}</span>
        <span class="st-chip st-c-red"><i class=ji data-i=trending-down></i> نقص ${summary.shortage_items}</span>
        <span class="st-chip st-c-green"><i class=ji data-i=trending-up></i> زيادة ${summary.surplus_items}</span>
        <span class="st-chip ${neg?'st-c-red':'st-c-green'}"><i class=ji data-i=coins></i> صافي الفروقات ${fC(summary.projected_variance_value)}</span>
        ${summary.stale_items?`<span class="st-chip st-c-orange" title="تغير رصيد هذه الأصناف بعد بدء الجلسة"><i class=ji data-i=alert-triangle></i> انحراف رصيد ${summary.stale_items}</span>`:''}
    </div>`;
}
function stocktakClientSummary(){
    const items = STOCK.detail?.items||[];
    const varianceItems = items.filter(i=>i.is_counted&&i.variance_qty!==0);
    return {
        items_with_variance: varianceItems.length,
        shortage_items: varianceItems.filter(i=>i.variance_qty<0).length,
        surplus_items: varianceItems.filter(i=>i.variance_qty>0).length,
        projected_variance_value: Math.round(varianceItems.reduce((s,i)=>s+Number(i.variance_value||0),0)*100)/100,
        stale_items: items.filter(i=>i.is_stale).length,
    };
}
async function showInventoryAuditModal(){
    STOCK.tab='new'; STOCK.detail=null; STOCK.search=''; STOCK.diffsOnly=false; STOCK.dirty={};
    showModal(`<h3><i class=ji data-i=clipboard-list></i> استوديو جرد المخزون</h3>
        <div class="st-tabs">
            <button class="st-tab" id="sttab-new" onclick="stocktakSetTab('new')"><i class=ji data-i=plus></i> جلسة جديدة</button>
            <button class="st-tab" id="sttab-count" onclick="stocktakSetTab('count')"><i class=ji data-i=clipboard-list></i> العد والفروقات</button>
            <button class="st-tab" id="sttab-history" onclick="stocktakSetTab('history')"><i class=ji data-i=history></i> سجل الجرد</button>
        </div>
        <div id="stocktakBody"><div class="text-muted" style="padding:26px;text-align:center">جارٍ التحميل…</div></div>`, 'modal-wide');
    stocktakRender();
}
function stocktakSetTab(tab){
    STOCK.tab=tab;
    ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t===tab);} });
    stocktakRender();
}
async function stocktakRender(){
    const body=document.getElementById('stocktakBody'); if(!body) {return;}
    body.innerHTML='<div class="text-muted" style="padding:26px;text-align:center">جارٍ التحميل…</div>';
    try{
        if(STOCK.tab==='new') {body.innerHTML = await stocktakHtmlNew();}
        else if(STOCK.tab==='count') {body.innerHTML = await stocktakHtmlCount();}
        else {body.innerHTML = await stocktakHtmlHistory();}
    }catch(e){ body.innerHTML=`<div class="audit-note">تعذر التحميل: ${esc(e.message)}</div>`; }
    if(document.getElementById('stSignature')) {afterModalSignatureInit('stSignature');}
    if(STOCK.tab==='new') {stocktakScopePreview();}
}
// ─── تبويب جلسة جديدة ───
// Task 20: منتقي مخزن الجرد — اللقطة والفروقات والاعتماد كلها على رصيد المخزن المختار
function stocktakScopeItems(){
    const {mode,category,search} = STOCK.scope;
    let items = STATE.inventory;
    if(mode==='category') {items = items.filter(i=>String(i.category||'')===String(category));}
    else if(mode==='search'){ const q=search.trim(); if(q) {items = items.filter(i=>String(i.name||'').includes(q)||String(i.barcode||'').includes(q));} }
    else if(mode==='in_stock') {items = items.filter(i=>Number(i.qty||0)>0);}
    return items;
}
async function stocktakScopePreview(){
    const el=document.getElementById('stScopePreview'); if(!el) {return;}
    const locId = Number(STOCK.locationId||0);
    const btn=document.getElementById('stStartBtn');
    if(locId>0){
        try{
            const params = new URLSearchParams({mode:STOCK.scope.mode||'all',category:STOCK.scope.category||'',search:STOCK.scope.search||''});
            const p = await apiFetch(`/warehouse/inventory/locations/${locId}/preview?${params}`);
            el.innerHTML = `<i class=ji data-i=clipboard-list></i> سيُدرج <strong>${fN(p.items_count)}</strong> صنف من مخزن الجرد المختار — رصيده المتوقع: <strong>${fN(p.on_hand_qty)}</strong> وحدة بقيمة <strong>${fC(p.on_hand_value)}</strong>`;
            if(btn) {btn.disabled = !p.items_count;}
        }catch(e){
            el.innerHTML = `<i class=ji data-i=clipboard-list></i> <span class="text-muted">تعذرت المعاينة الحية — سيحدد النطاق على الخادم عند بدء الجلسة</span>`;
        }
        return;
    }
    const items = stocktakScopeItems();
    const value = items.reduce((s,i)=>s+(Number(i.qty||0)*Number(i.avgCost||0)),0);
    el.innerHTML = `<i class=ji data-i=clipboard-list></i> سيُدرج <strong>${fN(items.length)}</strong> صنف في الجلسة — قيمة المخزون المتوقع جرده: <strong>${fC(value)}</strong>`;
    if(btn) {btn.disabled = !items.length;}
}
function stocktakSetLocation(id){
    STOCK.locationId = Number(id)||0;
    document.querySelectorAll('.st-loc').forEach(el=>el.classList.toggle('active', Number(el.dataset.loc)===STOCK.locationId));
    stocktakScopePreview();
}
async function stocktakLoadLocations(){
    if(Array.isArray(STOCK.locations) && STOCK.locations.length) {return STOCK.locations;}
    try{ STOCK.locations = await apiFetch('/warehouse/inventory/locations'); }catch(e){ STOCK.locations=[]; }
    return STOCK.locations;
}
function stocktakSetScope(mode, value=''){
    STOCK.scope = { mode, category: mode==='category'?(value||''):'', search: mode==='search'?(value||''):'' };
    ['stScopeCat','stScopeSearch'].forEach(id=>{ const el=document.getElementById(id); if(el) {el.style.display='none';} });
    if(mode==='category'){ const el=document.getElementById('stScopeCat'); if(el){ el.style.display=''; STOCK.scope.category=el.value; } }
    if(mode==='search'){ const el=document.getElementById('stScopeSearch'); if(el){ el.style.display=''; el.focus(); } }
    stocktakScopePreview();
}
async function stocktakHtmlNew(){
    let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
    const open = audits.filter(a=>['draft','submitted'].includes(a.status));
    const cats = [...new Set(STATE.inventory.map(i=>i.category).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ar'));
    const locations = await stocktakLoadLocations();
    if(!STOCK.locationId) {STOCK.locationId = Number(locations.find(l=>l.code==='MAIN-WAREHOUSE')?.id || locations[0]?.id || 0);}
    const locChips = locations.map(l=>`
        <div class="st-loc ${Number(l.id)===Number(STOCK.locationId)?'active':''}" data-loc="${l.id}" onclick="stocktakSetLocation('${l.id}')">
            <i class=ji data-i=package></i>
            <strong>${esc(l.name_ar)}</strong>
            <span>${l.dept_name?esc(l.dept_name)+' · ':''}${fN(l.items_count)} ${fN(l.items_count)} صنف · ${fC(l.on_hand_value)}</span>
        </div>`).join('');
    const openStrip = open.length?`<div class="st-resume"><i class=ji data-i=alert-circle></i> لديك جلسات جرد مفتوحة:
        ${open.slice(0,3).map(a=>`<button class="btn btn-gold btn-sm" onclick="stocktakOpenSession('${a.id}')">${esc(a.audit_number)} — متابعة العد</button>`).join('')}</div>`:'';
    return `${openStrip}
    <div class="audit-note"><strong>دورة جرد آمنة بثلاث خطوات — لكل مخزن على حدة</strong><br>
    <span class="text-muted">١) اختر المخزن وحدّد نطاق الجرد وابدأ الجلسة — ٢) عدّ الأصناف فعلياً (يُحفظ كل عدّ تلقائياً وتظهر الفروقات فوراً مقارنةً برصيد هذا المخزن) — ٣) اعتمد الفروقات فيُطبَّق على رصيد المخزن بحركات تصحيح موثّقة، وعجز المخزن يُسجَّل كلفة على القسم صاحبه. لا يتأثر أي رصيد قبل الاعتماد.</span></div>
    <h4 class="st-lochead"><i class=ji data-i=package></i> اختر مخزن الجرد</h4>
    <div class="st-loc-grid">${locChips||'<div class="text-muted">لا توجد مخازن مفعّلة</div>'}</div>
    <div class="st-scope-grid">
        <div class="st-scope active" onclick="stocktakSetScope('all')"><i class=ji data-i=package></i><strong>كل أصناف المخزن</strong><span>جرد شامل للمخزن المختار</span></div>
        <div class="st-scope" onclick="stocktakSetScope('in_stock')"><i class=ji data-i=box></i><strong>ذات رصيد فقط</strong><span>تجاهل أصناف الصفر في هذا المخزن</span></div>
        <div class="st-scope" onclick="stocktakSetScope('category')"><i class=ji data-i=folder></i><strong>فئة محددة</strong><span>جرد جزئي سريع</span></div>
        <div class="st-scope" onclick="stocktakSetScope('search')"><i class=ji data-i=search></i><strong>بحث بالاسم/الباركود</strong><span>أصناف مختارة</span></div>
    </div>
    <div class="fr">
        <div class="fg" id="stScopeCat" style="display:none"><label>الفئة</label><select onchange="STOCK.scope.category=this.value;stocktakScopePreview()"><option value="">— اختر الفئة —</option>${cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>
        <div class="fg" id="stScopeSearch" style="display:none"><label>بحث</label><input type="text" oninput="STOCK.scope.search=this.value;stocktakScopePreview()" placeholder="اسم الصنف أو الباركود"></div>
    </div>
    <div class="st-preview" id="stScopePreview"></div>
    <div class="fr">
        <div class="fg"><label>نوع الفترة</label><select id="stPeriodType"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly" selected>شهري</option><option value="custom">فترة مخصصة</option><option value="annual">سنوي</option></select></div>
        <div class="fg"><label>تاريخ العد</label><input type="date" id="stCountedAt" value="${today()}"></div>
        <div class="fg"><label>بداية الفترة</label><input type="date" id="stPeriodStart" value="${today()}"></div>
        <div class="fg"><label>نهاية الفترة</label><input type="date" id="stPeriodEnd" value="${today()}"></div>
    </div>
    <div class="fg"><label>ملاحظات الجلسة</label><input type="text" id="stNotes" placeholder="مثال: جرد نهاية الشهر — فرع الرئيسي"></div>
    <div class="modal-footer" style="margin-top:14px"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-purple" id="stStartBtn" onclick="stocktakStartSession()"><i class=ji data-i=play></i> بدء جلسة الجرد</button></div>`;
}
async function stocktakStartSession(){
    showLoad();
    try{
        const locId = Number(STOCK.locationId||0);
        if(!locId){ hideLoad(); toast('اختر مخزن الجرد أولاً','warning'); return; }
        const payload = {
            countedAt: document.getElementById('stCountedAt')?.value||today(),
            periodType: document.getElementById('stPeriodType')?.value||'custom',
            periodStart: document.getElementById('stPeriodStart')?.value||today(),
            periodEnd: document.getElementById('stPeriodEnd')?.value||today(),
            notes: document.getElementById('stNotes')?.value||'',
            locationId: locId,
            scopeFilter: { ...STOCK.scope },
        };
        const res = await apiFetch('/warehouse/inventory/audits',{method:'POST',body:JSON.stringify(payload)});
        toast(`بدأت جلسة الجرد ${res.audit.audit_number} على ${res.location?.name||'المخزن'} — ${res.itemCount} صنف`,'success');
        await stocktakOpenSession(res.audit.id);
    }catch(e){ toast(e.message||'تعذر بدء جلسة الجرد','error'); }
    finally{ hideLoad(); }
}
async function showFiscalYearModal(){
    try{
        const years=await apiFetch('/warehouse/fiscal-years');
        const current=years.find(y=>y.status==='open')||years[0];
        const canClose=STATE.currentUser?.role==='admin';
        const cards=years.map(y=>`<tr><td><strong>${esc(y.name||y.year_code)}</strong><div class="text-muted">${esc(String(y.start_date))} → ${esc(String(y.end_date))}</div></td><td><span class="badge ${y.status==='closed'?'bdg-green':'bdg-blue'}">${y.status==='closed'?'مغلقة':'مفتوحة'}</span></td><td>${y.status==='closed'?`إيرادات: ${fC(y.closing_snapshot?.revenue_total||0)}<br>صافي: ${fC(y.closing_snapshot?.net_result||0)}`:'بانتظار الإقفال'}</td><td>${y.status==='open'&&canClose?`<button class="btn btn-gold btn-sm" onclick="closeFiscalYear('${y.id}')"><i class=ji data-i=lock></i> إقفال السنة</button>`:''}${y.status==='closed'&&canClose?`<button class="btn btn-blue btn-sm" onclick="createNextFiscalYear('${y.id}')"><i class=ji data-i=plus></i> السنة التالية</button>`:''}</td></tr>`).join('');
        showModal(`<h3><i class=ji data-i=calendar></i> السنة المالية والإقفال</h3><div class="audit-note"><strong>${current?esc(current.name):'لا توجد سنة مالية'}</strong><br><span class="text-muted">لا يتم حذف المبيعات أو المصروفات. يحفظ النظام لقطة إقفال، قيمة المخزون، وترحيل الأرصدة الافتتاحية للسنة التالية.</span></div><div class="tbl-scroll"><table><thead><tr><th>السنة</th><th>الحالة</th><th>الملخص</th><th>الإجراء</th></tr></thead><tbody>${cards||'<tr><td colspan="4">لا توجد سنوات مالية</td></tr>'}</tbody></table></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button></div>`,'modal-wide');
    }catch(e){toast(e.message||'تعذر تحميل السنوات المالية','error');}
}
async function closeFiscalYear(id){
    if(!confirm('سيتم إقفال السنة بعد التحقق من إغلاق الورديات واعتماد الجرد. لا يمكن تكرار الإقفال. هل تريد المتابعة؟')) {return;}
    try{showLoad();await apiFetch(`/warehouse/fiscal-years/${id}/close`,{method:'POST'});toast('تم إقفال السنة المالية وحفظ لقطة الأرصدة','success');await showFiscalYearModal();}catch(e){toast(e.message||'تعذر إقفال السنة المالية','error');}finally{hideLoad();}
}
async function createNextFiscalYear(id){
    if(!confirm('سيتم إنشاء السنة التالية وترحيل أرصدة المخزون الافتتاحية. هل تريد المتابعة؟')) {return;}
    try{showLoad();await apiFetch(`/warehouse/fiscal-years/${id}/create-next`,{method:'POST'});toast('تم إنشاء السنة التالية وترحيل الأرصدة','success');await showFiscalYearModal();}catch(e){toast(e.message||'تعذر إنشاء السنة التالية','error');}finally{hideLoad();}
}
// ─── تبويب العد والفروقات (استوديو العد الحي) ───
async function stocktakOpenSession(id){
    showLoad();
    try{
        STOCK.detail = await apiFetch(`/warehouse/inventory/audits/${id}`);
        STOCK.dirty = {}; STOCK.search=''; STOCK.diffsOnly=false;
        STOCK.tab = 'count';
        ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t==='count');} });
        stocktakRender();
    }catch(e){ toast(e.message||'تعذر فتح جلسة الجرد','error'); }
    finally{ hideLoad(); }
}
async function stocktakRefreshDetail(){
    if(!STOCK.detail) {return;}
    try{ STOCK.detail = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}`); stocktakRender(); }
    catch(e){ toast(e.message||'تعذر تحديث الجلسة','error'); }
}
function stocktakCountFilter(){
    const items = STOCK.detail?.items||[];
    const q = STOCK.search.trim();
    let out = items;
    if(q) {out = out.filter(i=>String(i.item_name||'').includes(q)||String(i.barcode||'').includes(q)||String(i.category||'').includes(q));}
    if(STOCK.diffsOnly) {out = out.filter(i=>i.is_counted&&i.variance_qty!==0);}
    return out;
}
function stocktakRowHtml(item, locked){
    const counted = item.is_counted;
    const dirty = STOCK.dirty[item.item_id] !== undefined;
    const state = dirty?'st-dirty':counted?'st-saved':'st-uncounted';
    const diffCls = counted&&item.variance_qty!==0?(item.variance_qty<0?'st-var-neg':'st-var-pos'):'';
    const varText = counted?(item.variance_qty===0?'مطابق':(item.variance_qty>0?'+':'')+fN(item.variance_qty)):'لم يُعدّ';
    return `<tr class="st-row ${state}" id="strow-${item.item_id}">
        <td><strong>${esc(item.item_name)}</strong><div class="st-sub">${esc(item.category||'—')} · ${esc(item.unit||'وحدة')}${item.barcode?` · <span class="st-bc">${esc(item.barcode)}</span>`:''}</div></td>
        <td class="c st-sys">${fN(item.system_qty)}</td>
        <td class="c"><input type="number" class="st-count-input" id="stc-${item.item_id}" min="0" step="0.001" inputmode="decimal" value="${counted?item.counted_qty:''}" placeholder="${item.system_qty}" ${locked?'disabled':''} oninput="stocktakCountChanged(${item.item_id})" onchange="stocktakSaveCount(${item.item_id},true)"></td>
        <td class="c st-var ${diffCls}" id="stv-${item.item_id}">${varText}</td>
        <td class="c st-val ${diffCls}" id="stvv-${item.item_id}">${counted?fC(item.variance_value):'—'}</td>
        <td><input type="text" class="st-note" id="stn-${item.item_id}" value="${esc(item.notes||'')}" placeholder="ملاحظة" ${locked?'disabled':''} onchange="stocktakSaveCount(${item.item_id},true)"></td>
        <td class="c">${counted&&!locked?`<button class="st-clear" title="مسح العد وإرجاعه إلى غير معدود" onclick="stocktakClearCount(${item.item_id})"><i class=ji data-i=x></i></button>`:''}</td>
    </tr>`;
}
function stocktakRowsTbodyHtml(){
    const d = STOCK.detail; if(!d) {return '';}
    const locked = d.audit.status!=='draft';
    const items = stocktakCountFilter();
    if(!items.length) {return '<tr><td colspan="7" class="c text-muted" style="padding:22px">لا توجد أصناف مطابقة للبحث في هذه الجلسة</td></tr>';}
    return items.map(item=>stocktakRowHtml(item,locked)).join('');
}
function stocktakStaleBanner(){
    const stale = (STOCK.detail?.items||[]).filter(i=>i.is_stale);
    if(!stale.length) {return '';}
    return `<div class="st-stale"><i class=ji data-i=alert-triangle></i> <strong>تنبيه انحراف الرصيد:</strong> تغير رصيد ${stale.length} صنف في النظام بعد بدء الجلسة (مثال: ${esc(stale.slice(0,2).map(i=>i.item_name).join('، '))}). سيمنع النظام الاعتماد حتى تبدأ جلسة جديدة تلتقط الأرصدة الحالية.</div>`;
}
async function stocktakHtmlCount(){
    if(!STOCK.detail){
        let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
        const open = audits.filter(a=>['draft','submitted'].includes(a.status));
        return `<div class="st-empty"><i class=ji data-i=clipboard-list></i><p>لا توجد جلسة جرد مفتوحة الآن.</p><p class="text-muted">ابدأ جلسة جديدة من تبويب «جلسة جديدة»، أو تابع إحدى الجلسات المفتوحة:</p>
        ${open.length?open.slice(0,5).map(a=>`<button class="btn btn-gold btn-sm" onclick="stocktakOpenSession('${a.id}')">${esc(a.audit_number)} (${a.item_count||0} صنف)</button>`).join(''):'<span class="text-muted">لا توجد جلسات مفتوحة</span>'}</div>`;
    }
    const {audit,progress} = STOCK.detail;
    const locked = audit.status!=='draft';
    const canWrite = STOCK_CAN_WRITE.includes(STATE.currentUser?.role);
    const locChip = STOCK.detail.location_name?`· <span class="badge bdg-blue">${esc(STOCK.detail.location_name)}</span>`:'';
    const statusStrip = {
        submitted:`<div class="st-locked"><i class=ji data-i=lock></i> الجلسة أُرسلت للاعتماد — العد مقفل. يمكن للمدير اعتماد الفروقات أو إلغاء الجلسة.</div>`,
        approved:`<div class="st-approved"><i class=ji data-i=circle-check></i> اعتُمدت الجلسة وطُبّقت الفروقات على الأرصدة بتاريخ ${esc(String(audit.approved_at||'').slice(0,16).replace('T',' '))}.</div>`,
        cancelled:`<div class="st-locked"><i class=ji data-i=x-circle></i> أُلغيت الجلسة (${esc(audit.cancel_reason||'بدون سبب')}) — لا أثر على الأرصدة.</div>`,
    }[audit.status]||'';
    return `
    <div class="st-head">
        <div><strong class="st-num">${esc(audit.audit_number)}</strong><div class="st-sub">أنشأها ${esc(audit.created_by)} — ${esc(String(audit.counted_at).slice(0,10))} ${locChip}</div></div>
        <div class="st-progresswrap"><div class="st-progresstxt"><span id="stProgressTxt">${progress.counted} / ${progress.total}</span><span>${progress.percent}%</span></div><div class="progress-premium" style="height:10px"><div class="progress-premium-bar" id="stProgressBar" style="width:${progress.percent}%"></div></div></div>
        ${stocktakChipsHtml()}
    </div>
    ${statusStrip}${stocktakStaleBanner()}
    <div class="st-toolbar">
        <div class="st-search"><i class=ji data-i=search></i><input type="text" id="stSearchInput" placeholder="بحث بالاسم أو الباركود أو الفئة…" value="${esc(STOCK.search)}" oninput="stocktakOnSearch(this.value)"></div>
        <label class="st-diffsonly"><input type="checkbox" ${STOCK.diffsOnly?'checked':''} onchange="stocktakToggleDiffs(this.checked)"> الفروقات فقط</label>
        <button class="btn btn-sm" onclick="stocktakScanCount()"><i class=ji data-i=camera></i> مسح باركود</button>
        <button class="btn btn-blue btn-sm" onclick="stocktakPrint('count-sheet')"><i class=ji data-i=printer></i> ورقة الجرد</button>
        <button class="btn btn-sm" onclick="stocktakRefreshDetail()"><i class=ji data-i=refresh></i> تحديث</button>
    </div>
    <div class="tbl-scroll" style="max-height:42vh">
        <table class="st-table"><thead><tr><th>الصنف</th><th class="c">رصيد النظام</th><th class="c" style="min-width:130px">العدّ الفعلي</th><th class="c">الفرق</th><th class="c">قيمة الفرق</th><th style="min-width:120px">ملاحظة</th><th class="c"></th></tr></thead>
        <tbody id="stTbody">${stocktakRowsTbodyHtml()}</tbody></table>
    </div>
    ${locked?`<div class="modal-footer" style="margin-top:12px"><button class="btn" onclick="stocktakPrint('report')"><i class=ji data-i=printer></i> طباعة التقرير</button>${audit.status==='submitted'&&canWrite?`<button class="btn btn-gold" onclick="stocktakCancelSession()"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button><button class="btn btn-purple" onclick="stocktakApproveSession()"><i class=ji data-i=circle-check></i> اعتماد وتطبيق الفروقات</button>`:''}</div>`
    :canWrite?`
    ${signaturePadMarkup('stSignature','توقيع مسؤول الجرد / المعتمد')}
    <div class="modal-footer" style="margin-top:12px">
        <button class="btn btn-gold" onclick="stocktakCancelSession()"><i class=ji data-i=x-circle></i> إلغاء الجلسة</button>
        <button class="btn btn-blue" onclick="stocktakSubmitSession()"><i class=ji data-i=send></i> إرسال للاعتماد</button>
        <button class="btn btn-purple" onclick="stocktakApproveSession()"><i class=ji data-i=circle-check></i> اعتماد فوري وتطبيق الفروقات</button>
    </div>`:`<div class="text-muted" style="text-align:center;padding:10px">دورك يسمح بالمشاهدة والعد فقط — الاعتماد يتطلب مديراً.</div>`}`;
}
function stocktakOnSearch(value){
    STOCK.search = value;
    const tbody = document.getElementById('stTbody');
    if(tbody) {tbody.innerHTML = stocktakRowsTbodyHtml();}
}
function stocktakToggleDiffs(checked){
    STOCK.diffsOnly = !!checked;
    const tbody = document.getElementById('stTbody');
    if(tbody) {tbody.innerHTML = stocktakRowsTbodyHtml();}
}
function stocktakScanCount(){
    if(!STOCK.detail||STOCK.detail.audit.status!=='draft'){ toast('العد متاح في الجلسات المسودة فقط','warning'); return; }
    openScanner({ title:'<i class=ji data-i=camera></i> مسح باركود صنف', onDecode:(val)=>{
        const code = String(val||'').trim();
        const item = (STOCK.detail?.items||[]).find(i=>String(i.barcode||'')===code);
        if(!item){ toast('لا يوجد صنف بهذا الباركود في الجلسة','warning'); return; }
        STOCK.search = code; STOCK.diffsOnly=false;
        const input=document.getElementById('stSearchInput'); if(input) {input.value=code;}
        stocktakToggleDiffs(false);
        setTimeout(()=>{ const c=document.getElementById(`stc-${item.item_id}`); if(c){ c.focus(); c.select(); } },150);
        toast(`الصنف: ${item.item_name}`,'success');
    }});
}
function stocktakCountChanged(itemId){
    STOCK.dirty[itemId] = true;
    const row = document.getElementById(`strow-${itemId}`);
    if(row){ row.classList.add('st-dirty'); row.classList.remove('st-saved'); }
    clearTimeout(STOCK.timers[itemId]);
    STOCK.timers[itemId] = setTimeout(()=>stocktakSaveCount(itemId,false), 900);
}
async function stocktakSaveCount(itemId, manual){
    const input = document.getElementById(`stc-${itemId}`);
    if(!input||!STOCK.detail) {return;}
    if(input.value===''){ if(manual) {toast('أدخل الكمية المعدودة أولاً — أو امسح العد بزر ×','warning');} return; }
    const value = Number(input.value);
    if(!Number.isFinite(value)||value<0){ toast('الكمية المعدودة غير صالحة','error'); return; }
    clearTimeout(STOCK.timers[itemId]); delete STOCK.dirty[itemId];
    try{
        const res = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}/counts/${itemId}`,{method:'PUT',body:JSON.stringify({countedQty:value,notes:document.getElementById(`stn-${itemId}`)?.value||''})});
        stocktakApplyItem(res.item); stocktakApplyProgress(res.counted_items);
        const row=document.getElementById(`strow-${itemId}`);
        if(row){ row.classList.remove('st-dirty'); row.classList.remove('st-uncounted'); row.classList.add('st-saved'); }
    }catch(e){ STOCK.dirty[itemId]=true; toast(e.message||'تعذر حفظ العد','error'); }
}
function stocktakApplyItem(item){
    const local = (STOCK.detail?.items||[]).find(i=>Number(i.item_id)===Number(item.item_id));
    if(local){
        Object.assign(local,{ counted_qty:Number(item.counted_qty), variance_qty:Number(item.variance_qty), variance_value:Number(item.variance_value), notes:item.notes||null, is_counted:true });
    }
    const qty = Number(item.variance_qty);
    const v = document.getElementById(`stv-${item.item_id}`);
    if(v){ v.textContent = qty===0?'مطابق':(qty>0?'+':'')+fN(qty); v.classList.toggle('st-var-neg',qty<0); v.classList.toggle('st-var-pos',qty>0); }
    const vv = document.getElementById(`stvv-${item.item_id}`);
    if(vv){ vv.innerHTML = fC(Number(item.variance_value)); vv.classList.toggle('st-var-neg',Number(item.variance_value)<0); vv.classList.toggle('st-var-pos',Number(item.variance_value)>0); }
}
function stocktakApplyProgress(countedItems){
    const d=STOCK.detail; if(!d) {return;}
    d.progress.counted = countedItems;
    d.progress.remaining = d.progress.total - countedItems;
    d.progress.percent = d.progress.total?Math.round((countedItems/d.progress.total)*100):0;
    const bar=document.getElementById('stProgressBar'); if(bar) {bar.style.width=d.progress.percent+'%';}
    const txt=document.getElementById('stProgressTxt'); if(txt) {txt.textContent=`${d.progress.counted} / ${d.progress.total}`;}
    const head=document.querySelector('.st-head'); if(head){ const old=head.querySelector('.st-chips'); if(old) {old.remove();} head.insertAdjacentHTML('beforeend',stocktakChipsHtml()); }
}
async function stocktakClearCount(itemId){
    if(!STOCK.detail) {return;}
    try{
        const res = await apiFetch(`/warehouse/inventory/audits/${STOCK.detail.audit.id}/counts/${itemId}`,{method:'DELETE'});
        const local = (STOCK.detail.items||[]).find(i=>Number(i.item_id)===Number(itemId));
        if(local) {Object.assign(local,{ counted_qty:local.system_qty, variance_qty:0, variance_value:0, is_counted:false, notes:null });}
        stocktakApplyProgress(res.counted_items);
        const tbody=document.getElementById('stTbody'); if(tbody) {tbody.innerHTML=stocktakRowsTbodyHtml();}
        toast('مُسح العد — الصنف عاد إلى «غير معدود»','success');
    }catch(e){ toast(e.message||'تعذر مسح العد','error'); }
}
async function stocktakSavePending(){
    const ids = Object.keys(STOCK.dirty);
    for(const id of ids){ clearTimeout(STOCK.timers[id]); await stocktakSaveCount(Number(id),false); }
    return ids.length;
}
async function stocktakSubmitSession(){
    const d=STOCK.detail;
    if(!d||d.audit.status!=='draft') {return;}
    await stocktakSavePending();
    const sig = readSignaturePad('stSignature'); if(!sig) {return;}
    const signerName = readSignerName('stSignature'); if(!signerName) {return;}
    if(!confirm('سيتم إرسال الجلسة للاعتماد وتثبيت العد والتوقيع. متابعة؟')) {return;}
    showLoad();
    try{
        await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/submit`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});
        toast('أُرسلت الجلسة للاعتماد — العد مقفل الآن','success');
        await stocktakRefreshDetail();
    }catch(e){ toast(e.message||'تعذر إرسال الجلسة','error'); }
    finally{ hideLoad(); }
}
async function stocktakApproveSession(){
    const d=STOCK.detail;
    if(!d||!['draft','submitted'].includes(d.audit.status)) {return;}
    await stocktakSavePending();
    const sig = readSignaturePad('stSignature'); if(!sig) {return;}
    const signerName = readSignerName('stSignature'); if(!signerName) {return;}
    const summary = stocktakClientSummary();
    if(!confirm(`سيتم تطبيق الفروقات على أرصدة المخزون:\n— أصناف بفروقات: ${summary.items_with_variance} (نقص ${summary.shortage_items} / زيادة ${summary.surplus_items})\n— صافي قيمة الفروقات: ${summary.projected_variance_value}\nتُسجَّل حركات تصحيح موثّقة ولا يمكن التراجع. متابعة؟`)) {return;}
    showLoad();
    try{
        if(d.audit.status==='draft') {await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/submit`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});}
        const result = await apiFetch(`/warehouse/inventory/audits/${d.audit.id}/approve`,{method:'POST',body:JSON.stringify({signatureData:sig,signerName})});
        for(const change of (result.stockChanges||[])){ const local=STATE.inventory.find(i=>String(i.id)===String(change.id)); if(local) {Object.assign(local,change);} }
        for(const tx of (result.transactions||[])) {upsertStateEntity('inventoryTx',tx);}
        toast(`اعتُمد الجرد وطُبّقت ${result.transactions?.length||0} حركة تصحيح على الأرصدة`,'success');
        await stocktakRefreshDetail();
    }catch(e){ toast(e.message||'تعذر اعتماد الجرد — لم يُطبق أي تغيير','error'); }
    finally{ hideLoad(); }
}
async function stocktakCancelSession(){
    const d=STOCK.detail;
    if(d){ await stocktakCancelById(d.audit.id); return; }
    toast('لا توجد جلسة مفتوحة','warning');
}
async function stocktakCancelById(id){
    const reason = prompt('سبب إلغاء جلسة الجرد (مطلوب):');
    if(reason===null) {return;}
    if(reason.trim().length<3){ toast('سبب الإلغاء مطلوب (3 أحرف على الأقل)','warning'); return; }
    if(!confirm('سيتم إلغاء الجلسة دون أي تأثير على أرصدة المخزون. متابعة؟')) {return;}
    showLoad();
    try{
        await apiFetch(`/warehouse/inventory/audits/${id}/cancel`,{method:'POST',body:JSON.stringify({reason:reason.trim()})});
        toast('أُلغيت جلسة الجرد','success');
        if(STOCK.detail&&Number(STOCK.detail.audit.id)===Number(id)){ STOCK.detail=null; STOCK.tab='history'; ['new','count','history'].forEach(t=>{ const el=document.getElementById(`sttab-${t}`); if(el) {el.classList.toggle('active',t==='history');} }); }
        stocktakRender();
    }catch(e){ toast(e.message||'تعذر إلغاء الجلسة','error'); }
    finally{ hideLoad(); }
}
async function stocktakPrintById(id, kind){
    try{
        const res = await fetch(API_BASE+`/warehouse/inventory/audits/${id}/${kind}`,{headers:{'Authorization':'Bearer '+(window._jwt||'')}});
        if(!res.ok) {throw new Error('فشل تحميل المستند');}
        const html = await res.text();
        const frame=document.createElement('iframe');
        frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        document.body.appendChild(frame);
        frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
        setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){} setTimeout(()=>frame.remove(),2000); },500);
    }catch(e){ toast(e.message||'تعذر الطباعة','error'); }
}
function stocktakPrint(kind){
    if(!STOCK.detail){ toast('افتح جلسة أولاً','warning'); return; }
    stocktakPrintById(STOCK.detail.audit.id, kind);
}
// ─── تبويب سجل الجرد ───
async function stocktakHtmlHistory(){
    let audits=[]; try{ audits=await apiFetch('/warehouse/inventory/audits'); }catch(e){ console.warn(e); }
    const rows = audits.map(a=>{
        const counted = a.counted_items!=null?a.counted_items:null;
        const variance = Number(a.total_variance_value||0);
        const actions = [`<button class="btn btn-blue btn-sm" onclick="stocktakOpenSession('${a.id}')"><i class=ji data-i=eye></i> فتح</button>`];
        if(a.status!=='cancelled') {actions.push(`<button class="btn btn-sm" onclick="stocktakPrintById('${a.id}','report')"><i class=ji data-i=printer></i> تقرير</button>`);}
        if(['draft','submitted'].includes(a.status)&&STOCK_CAN_WRITE.includes(STATE.currentUser?.role)) {actions.push(`<button class="btn btn-gold btn-sm" onclick="stocktakCancelById('${a.id}')"><i class=ji data-i=x-circle></i> إلغاء</button>`);}
        return `<tr>
            <td><strong>${esc(a.audit_number)}</strong><div class="st-sub">${esc(String(a.created_at||'').slice(0,16).replace('T',' '))}</div></td>
            <td>${esc(String(a.counted_at||'').slice(0,10))}</td>
            <td>${esc(a.created_by)}</td>
            <td class="c">${counted!=null?`${counted} / ${a.item_count||0}`:fN(a.item_count||0)}</td>
            <td class="c" style="color:${variance<0?'var(--red)':variance>0?'var(--green)':'inherit'}">${variance?fC(variance):'—'}</td>
            <td class="c">${stocktakStatusBadge(a.status)}</td>
            <td><div class="st-actions">${actions.join('')}</div></td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" class="c text-muted" style="padding:22px">لا توجد جلسات جرد بعد — ابدأ الأولى من تبويب «جلسة جديدة»</td></tr>';
    return `<div class="tbl-scroll" style="max-height:56vh">
        <table><thead><tr><th>رقم الجلسة</th><th>تاريخ العد</th><th>المنشئ</th><th class="c">معدود / الأصناف</th><th class="c">صافي الفروقات</th><th class="c">الحالة</th><th>إجراءات</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    <div class="audit-note" style="margin-top:12px"><span class="text-muted">الجلسات المعتمدة ظهرت فروقاتها كحركات تصحيح في سجل المخزون، والملغاة دون أي أثر. اضغط «فتح» لعرض تفاصيل أي جلسة وطباعة تقريرها.</span></div>`;
}

function inventoryUnitOptions(selected='كجم'){ const opts=[['kg','كجم'],['g','جرام'],['l','لتر'],['ml','مل'],['piece','قطعة/وحدة']]; const aliases={كجم:'kg',كيلو:'kg',جرام:'g',غرام:'g',لتر:'l',مل:'ml',وحدة:'piece',قطعة:'piece',حبة:'piece'}; const current=aliases[String(selected||'').trim()]||selected; return opts.map(([value,label])=>`<option value="${value}" ${current===value?'selected':''}>${label}</option>`).join(''); }
function showAddItemModal(prefillBarcode=''){
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}">${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=package></i> إضافة صنف جديد</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="itemName"></div><div class="fg"><label>الفئة</label><input type="text" id="itemCategory"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="itemBarcode" value="${esc(prefillBarcode)}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" onclick="scanForItemBarcodeField('itemBarcode')"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="itemUnit">${inventoryUnitOptions('kg')}</select><small class="text-muted">مثال: زيت باللتر، أرز بالكجم، دجاج بالقطعة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="itemMinQty" value="5" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الكمية الافتتاحية</label><input type="number" id="itemQty" value="0" step="0.01"></div><div class="fg"><label>سعر الشراء</label><input type="number" id="itemPrice" value="0" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="itemWeight" value="0" step="0.01"></div><div class="fg"><label>الرف</label><select id="itemShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addInventoryItem()"><i class=ji data-i=save></i> حفظ</button></div>`);
}
function scanForItemBarcodeField(inputId){
openScanner({
title:'<i class=ji data-i=camera></i> مسح باركود / QR الصنف',
instruction:'وجّه الكاميرا نحو باركود أو QR الصنف',
onDecode:(code)=>{
const el=document.getElementById(inputId);
if(el){ el.value=code; toast('تم مسح الكود','success'); }
}
});
}
function scanToAddInventoryItem(){
openScanner({
title:'<i class=ji data-i=camera></i> مسح صنف للمخزون',
instruction:'وجّه الكاميرا نحو باركود أو QR الصنف',
onDecode:(code)=>{
const existing=STATE.inventory.find(i=>i.barcode && i.barcode===code);
if(existing){ showQuickStockInModal(existing.id, code); }
else{ showAddItemModal(code); }
}
});
}
function showQuickStockInModal(itemId, scannedCode){
const item=STATE.inventory.find(i=>i.id===itemId);
if(!item) {return;}
showModal(`<h3><i class=ji data-i=package></i> ${esc(item.name)}</h3>
<div style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:12px">
<div>الكمية الحالية: <strong class="c-gold">${fN(item.qty)} ${item.unit}</strong></div>
<div class="u-sub">الباركود الممسوح: ${esc(scannedCode)}</div>
</div>
<div class="fg"><label>الكمية المضافة</label><input type="number" id="quickStockQty" value="1" step="0.01"></div>
<div class="fg"><label>سعر الشراء (اختياري)</label><input type="number" id="quickStockPrice" value="${item.avgCost}" step="0.01"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmQuickStockIn('${item.id}')"><i class=ji data-i=save></i> إضافة للمخزون</button></div>`);
setTimeout(()=>{ document.getElementById('quickStockQty')?.focus(); document.getElementById('quickStockQty')?.select(); },50);
}
async function confirmQuickStockIn(itemId){
if(confirmQuickStockIn._busy){return;}
const item=STATE.inventory.find(i=>i.id===itemId);
if(!item) {return;}
const qty=parseFloat(document.getElementById('quickStockQty')?.value)||0;
const price=parseFloat(document.getElementById('quickStockPrice')?.value)||item.avgCost;
if(qty<=0){ toast('أدخل كمية صحيحة','error'); return; }
confirmQuickStockIn._busy=true;
const oldValue=item.qty*item.avgCost;
const newValue=qty*price;
const newQty=item.qty+qty;
const newAvgCost=newQty>0?(oldValue+newValue)/newQty:price;
try{
const result = await apiFetch(`/warehouse/inventory/${encodeURIComponent(item.id)}/receipt`, {method:'POST',body:JSON.stringify({qty,price,unit:item.unit})});
Object.assign(item, result.inventory || {qty:newQty,avgCost:newAvgCost});
if(!STATE.inventoryTx){STATE.inventoryTx=[];}
if(result.transaction){STATE.inventoryTx.push(result.transaction);}
closeModal(); renderPage();
toast(`تم إضافة ${fN(qty)} ${item.unit} إلى ${item.name}`,'success');
addNotification('مسح مخزون',`تم إضافة ${fN(qty)} ${item.unit} لصنف ${item.name} عبر المسح`,'success');
}catch(e){ toast(e.message||'فشل تحديث المخزون في قاعدة البيانات','error'); }
finally{ confirmQuickStockIn._busy=false; }
}
async function addInventoryItem(){
if(addInventoryItem._busy){return;}
const name=document.getElementById('itemName')?.value.trim();
const category=document.getElementById('itemCategory')?.value.trim();
const barcode=document.getElementById('itemBarcode')?.value.trim()||'';
const unit=document.getElementById('itemUnit')?.value||'قطعة';
const minQty=parseFloat(document.getElementById('itemMinQty')?.value)||5;
const qty=parseFloat(document.getElementById('itemQty')?.value)||0;
const price=parseFloat(document.getElementById('itemPrice')?.value)||0;
const weight=parseFloat(document.getElementById('itemWeight')?.value)||0;
const shelfId=document.getElementById('itemShelf')?.value||null;
if(!name){toast('أدخل اسم الصنف','error');return;}
if(STATE.inventory.find(i=>i.name===name)){toast('هذا الصنف موجود بالفعل','error');return;}
if(barcode && STATE.inventory.find(i=>i.barcode && i.barcode===barcode)){toast('هذا الباركود مستخدم لصنف آخر بالفعل','error');return;}
addInventoryItem._busy=true;
try{
const newItem = await persistCreate('inventory', (saved)=>STATE.inventory.push(saved), {id:uid(),name,category,unit,qty,avgCost:price,minQty,weight,shelfId,barcode});
if(qty>0){
if(!STATE.inventoryTx){STATE.inventoryTx=[];}
await persistCreate('inventoryTx', (saved)=>STATE.inventoryTx.push(saved), {id:uid(),itemId:newItem.id,itemName:name,qty:qty,type:'initial',date:today(),cost:price,totalValue:qty*price,notes:'رصيد افتتاحي'});
}
closeModal();renderPage();toast('تم إضافة الصنف','success');
}catch(e){ toast(e.message||'فشل حفظ الصنف في قاعدة البيانات','error'); }
finally{ addInventoryItem._busy=false; }
}
function editItem(id){
const item=STATE.inventory.find(i=>String(i.id)===String(id));
if(!item){return;}
const shelfOptions = STATE.shelves.map(s=>`<option value="${s.id}" ${item.shelfId==s.id?'selected':''}>${esc(s.code)} - ${esc(s.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل الصنف</h3>
<div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="eiName" value="${esc(item.name)}"></div><div class="fg"><label>الفئة</label><input type="text" id="eiCategory" value="${esc(item.category||'')}"></div></div>
<div class="fg"><label>الباركود / QR</label><div style="display:flex;gap:8px"><input type="text" id="eiBarcode" value="${esc(item.barcode||'')}" placeholder="امسح أو اكتب يدوياً" class="u-flex1"><button type="button" class="btn btn-blue btn-sm" onclick="scanForItemBarcodeField('eiBarcode')"><i class=ji data-i=camera></i> مسح</button></div></div>
<div class="fr"><div class="fg"><label>وحدة الشراء والتخزين</label><select id="eiUnit">${inventoryUnitOptions(item.unit)}</select><small class="text-muted">يجب أن تطابق وحدة السعر في الفاتورة</small></div><div class="fg"><label>الحد الأدنى</label><input type="number" id="eiMin" value="${item.minQty}" step="0.01"></div></div>
<div class="fr"><div class="fg"><label>الوزن (كجم)</label><input type="number" id="eiWeight" value="${item.weight||0}" step="0.01"></div><div class="fg"><label>الرف</label><select id="eiShelf"><option value="">بدون رف</option>${shelfOptions}</select></div></div>
<div style="background:var(--bg3);padding:12px;margin:12px 0;border-radius:var(--r)">
<div>الكمية الحالية: <strong class="c-gold">${fN(item.qty)} ${item.unit}</strong></div>
<div>متوسط السعر: <strong class="c-gold">${fC(item.avgCost)}</strong></div>
</div>
<div class="modal-footer"><button type="button" class="btn btn-red" onclick="deleteItem('${esc(String(id))}')"><i class=ji data-i=trash></i> حذف</button><button type="button" class="btn" onclick="closeModal()">إلغاء</button><button type="button" class="btn btn-gold" onclick="updateInventoryItem('${esc(String(id))}')"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function updateInventoryItem(id){
const item=STATE.inventory.find(i=>String(i.id)===String(id));
if(!item){return;}
const barcode=document.getElementById('eiBarcode')?.value.trim()||'';
if(barcode && STATE.inventory.find(i=>String(i.id)!==String(id) && i.barcode && i.barcode===barcode)){toast('هذا الباركود مستخدم لصنف آخر بالفعل','error');return;}
const name=document.getElementById('eiName')?.value.trim();
const category=document.getElementById('eiCategory')?.value.trim();
const unit=document.getElementById('eiUnit')?.value||'قطعة';
const minQty=parseFloat(document.getElementById('eiMin')?.value)||5;
const weight=parseFloat(document.getElementById('eiWeight')?.value)||0;
const shelfId=document.getElementById('eiShelf')?.value||null;
try{
const saved = await persistUpdate('inventory', id, {name,category,barcode,unit,minQty,weight,shelfId,qty:item.qty,avgCost:item.avgCost});
Object.assign(item, saved || {name,category,barcode,unit,minQty,weight,shelfId});
closeModal();renderPage();toast('تم التحديث','success');
}catch(e){ toast(e.message||'فشل تحديث الصنف في قاعدة البيانات','error'); }
}
async function deleteItem(id, force){
id=String(id);
const item=(STATE.inventory||[]).find(i=>String(i.id)===String(id));
if(!force && !confirm(`حذف الصنف "${item?.name||id}"؟`)){return;}
if(force && !confirm(`حذف نهائي لـ "${item?.name||id}" مع كل حركاته وسجلاته؟\nلا يمكن التراجع — سجلات هذا الصنف ستُمحى من الدفاتر.`)){return;}
try{
if(force) {await apiFetch(`/warehouse/inventory/${encodeURIComponent(id)}/force`,{method:'DELETE'});}
else {await persistRemove('inventory', id);}
STATE.inventory=STATE.inventory.filter(i=>String(i.id)!==String(id));
if(STATE.inventoryTx){STATE.inventoryTx=STATE.inventoryTx.filter(tx=>String(tx.itemId)!==String(id));}
closeModal();renderPage();toast(force?'تم الحذف النهائي مع الحركات':'تم الحذف','warning');
}catch(e){
const m=String(e.message||'');
if(!force&&(m.includes('INVENTORY_HAS_MOVEMENTS')||m.includes('حركات مخزون'))){
if(confirm(`"${item?.name||id}" له حركات مخزون.\nهل تريد الحذف النهائي مع كل حركاته وسجلاته؟ (لا يمكن التراجع)`)) {return deleteItem(id,true);}
return;
}
if(m.includes('violates foreign key')||m.includes('23503'))
{toast('لا يمكن حذف هذا الصنف: مرتبط بحركات مخزون أو وصفات أو فواتير — احتفظ به للحفاظ على سلامة الدفاتر','error');}
else {toast(m||'فشل الحذف من قاعدة البيانات','error');}
}
}
// Purchase Invoice
let currentInvoiceItems = [];
function showAddPurchaseInvoiceModal(){
currentInvoiceItems = [];
renderInvoiceItemsList();
showModal(`
<h3><i class=ji data-i=file-text></i> فاتورة مشتريات جديدة</h3>
<div class="fr">
<div class="fg"><label>رقم الفاتورة</label><input type="text" id="invoiceNumber" placeholder="INV-001"></div>
<div class="fg"><label>تاريخ الفاتورة</label><input type="date" id="invoiceDate" value="${today()}"></div>
</div>
<div class="fr">
<div class="fg"><label>المورد <small class="text-muted">(اختياري — يربط الفاتورة بالحساب)</small></label><select id="invoiceSupplierSel" onchange="pcmtInvoiceSupplierChanged()"><option value="">بدون ربط (اسم حر)</option>${(STATE.suppliers||[]).filter(s=>s.is_active).map(s=>`<option value="${esc(String(s.id))}">${esc(s.name)}</option>`).join('')}</select></div>
<div class="fg" id="invoiceSupplierNameWrap" style="display:none"><label>اسم المورد</label><input type="text" id="supplierName"></div>
<div class="fg" id="invoiceSupplierPhoneWrap" style="display:none"><label>رقم الهاتف</label><input type="text" id="supplierPhone"></div>
</div>
<div style="margin:16px 0">
<div style="font-weight:700;margin-bottom:12px"><i class=ji data-i=package></i> الأصناف</div>
<div id="invoiceItemsList"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addInvoiceItemRow()"><i class=ji data-i=plus></i> إضافة صنف</button>
</div>
<div class="fr">
<div class="fg"><label>إجمالي الفاتورة <small class="text-muted">(محسوب تلقائيًا)</small></label><input type="number" id="invoiceTotal" readonly aria-readonly="true" title="يُحسب تلقائيًا من كمية وسعر كل صنف" onclick="focusInvoiceEntryField()" style="background:var(--gold-d);color:var(--gold);font-weight:800;cursor:pointer"><small class="text-muted">اكتب الكمية والسعر في سطور الأصناف، وسيتم تحديث الإجمالي تلقائيًا.</small></div>
<div class="fg"><label>طريقة الدفع</label><select id="paymentMethod" onchange="pcmtInvoicePaidChanged()"><option value="cash">نقدي (مسدد)</option><option value="bank">تحويل بنكي (مسدد)</option><option value="credit">آجل (غير مسدد)</option></select></div>
</div>
<div class="fr">
<div class="fg"><label>المسدد الآن</label><input type="number" id="invoicePaidAmount" step="0.01" min="0" value="0" oninput="pcmtInvoicePaidChanged(true)"><small class="text-muted">اتركه 0 للآجل — سيحدد حالة السداد تلقائياً</small></div>
<div class="fg"><label>حالة السداد المتوقعة</label><div id="invoiceStatusPreview"><span class="badge bdg-red">غير مسددة</span></div></div>
</div>
<div class="fg"><label>ملاحظات</label><textarea id="invoiceNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="savePurchaseInvoice()"><i class=ji data-i=save></i> حفظ الفاتورة</button></div>
`);
}
function pcmtInvoiceSupplierChanged(){
    const sel=document.getElementById('invoiceSupplierSel'); if(!sel) {return;}
    const linked=String(sel.value)!=='';
    const nameWrap=document.getElementById('invoiceSupplierNameWrap');
    const phoneWrap=document.getElementById('invoiceSupplierPhoneWrap');
    if(nameWrap) {nameWrap.style.display=linked?'none':'';}
    if(phoneWrap) {phoneWrap.style.display=linked?'none':'';}
    pcmtInvoicePaidChanged();
}
function pcmtInvoicePaidChanged(fromInput){
    const totalEl=document.getElementById('invoiceTotal');
    const paidEl=document.getElementById('invoicePaidAmount');
    const prev=document.getElementById('invoiceStatusPreview');
    if(!paidEl||!prev) {return;}
    if(!fromInput){
        const method=document.getElementById('paymentMethod')?.value||'cash';
        paidEl.value=method==='credit'?'0':(totalEl?.value||'0');
    }
    const total=Number(totalEl?.value||0);
    const paid=Math.min(Math.max(Number(paidEl.value||0),0),total);
    let badge;
    if(total<=0||paid>=total) {badge='<span class="badge bdg-green">مدفوعة</span>';}
    else if(paid<=0) {badge='<span class="badge bdg-red">غير مسددة</span>';}
    else {badge=`<span class="badge bdg-gold">مسددة جزئياً — متبقٍ ${fN(total-paid)}</span>`;}
    prev.innerHTML=badge;
}
function addInvoiceItemRow(){ currentInvoiceItems.push({id:uid(),itemName:'',itemId:null,qty:1,price:0,total:0,unit:'وحدة',weight:''}); renderInvoiceItemsList(); }
function removeInvoiceItemRow(index){ currentInvoiceItems.splice(index,1); renderInvoiceItemsList(); }
function updateInvoiceItem(index,field,value){
const item = currentInvoiceItems[index];
if(field==='itemName'){
const invItem = STATE.inventory.find(i=>i.name===value);
if(invItem){
item.itemName=invItem.name; item.itemId=invItem.id; item.unit=invItem.unit||'وحدة'; item.price=invItem.avgCost; item.weight='';
const priceInput=document.getElementById(`item_price_${index}`);
if(priceInput) {priceInput.value=invItem.avgCost;}
const unitInput=document.getElementById(`item_unit_${index}`);
if(unitInput) {unitInput.value=item.unit;}
}else{ item.itemName=value; }
}else if(field==='qty'){ item.qty=parseFloat(value)||0; }
else if(field==='unit'){ item.unit=String(value||'').trim()||'وحدة'; }
else if(field==='price'){ item.price=parseFloat(value)||0; }
else if(field==='weight'){ item.weight=String(value||'').trim()===''?'':(parseFloat(value)||0); }
item.total = item.qty * item.price;
const totalEl=document.getElementById(`item_total_${index}`);
if(totalEl) {totalEl.innerHTML=fC(item.total);}
updateInvoiceTotal();
}
function updateInvoiceTotal(){
const total = currentInvoiceItems.reduce((sum,item)=>sum+item.total,0);
const totalInput=document.getElementById('invoiceTotal');
if(totalInput) {totalInput.value=total.toFixed(2);}
// حالة السداد التوقّعية تتبع الإجمالي الحي (النقدي يُسدد كاملًا تلقائيًا)
pcmtInvoicePaidChanged();
}
function focusInvoiceEntryField(){
const firstEditable=document.querySelector('#invoiceItemsList input[type="number"]');
if(firstEditable){firstEditable.focus();firstEditable.select();toast('الإجمالي محسوب تلقائيًا؛ اكتب الكمية أو السعر في سطر الصنف','info');return;}
addInvoiceItemRow();
setTimeout(()=>{const next=document.querySelector('#invoiceItemsList input[type="number"]');if(next){next.focus();next.select();}},0);
}
function renderInvoiceItemsList(){
 const container=document.getElementById('invoiceItemsList');
 if(!container){return;}
 if(currentInvoiceItems.length===0){
  container.innerHTML='<div style="padding:20px;text-align:center;color:var(--text3);background:var(--bg3);border-radius:var(--r)"><i class=ji data-i=package></i> أضف صنفاً بالنقر على زر "إضافة صنف"</div>';
  return;
 }
 const unitOptions=['وحدة','كجم','كيلوجرام','جرام','شوال','كيس','علبة','كرتون','عبوة','لتر'].map(unit=>`<option value="${unit}"></option>`).join('');
 const rows=currentInvoiceItems.map((item,idx)=>{
  const inventoryOptions=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (${esc(i.unit||'وحدة')}) — ${fN(i.avgCost)} ${STATE.settings.currency}</option>`).join('');
  return `<div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-end;flex-wrap:wrap">
  <div style="flex:2;min-width:180px;position:relative"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><input type="text" id="item_name_${idx}" value="${esc(item.itemName)}" placeholder="ابحث عن صنف..." class="u-input" onchange="updateInvoiceItem(${idx},'itemName',this.value)" list="inventoryList${idx}"><datalist id="inventoryList${idx}">${inventoryOptions}</datalist></div>
  <div class="u-flex1" style="min-width:100px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input type="number" id="item_qty_${idx}" value="${item.qty}" step="0.01" min="0" placeholder="الكمية" class="u-input" onchange="updateInvoiceItem(${idx},'qty',this.value)"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوحدة</small><input type="text" id="item_unit_${idx}" value="${esc(item.unit||'وحدة')}" list="invoiceUnitOptions" placeholder="كجم / شوال / علبة" class="u-input" onchange="updateInvoiceItem(${idx},'unit',this.value)"></div>
  <div class="u-flex1" style="min-width:110px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الوزن الإجمالي (كجم)</small><input type="number" id="item_weight_${idx}" value="${item.weight??''}" min="0" step="0.01" placeholder="اختياري" class="u-input" onchange="updateInvoiceItem(${idx},'weight',this.value)"></div>
  <div class="u-flex1" style="min-width:105px"><small style="display:block;margin-bottom:4px;color:var(--text3)">سعر الوحدة</small><input type="number" id="item_price_${idx}" value="${item.price}" min="0" step="0.01" placeholder="السعر" class="u-input" onchange="updateInvoiceItem(${idx},'price',this.value)"></div>
  <div style="flex:1;min-width:95px;text-align:center;font-weight:800;color:var(--gold)"><small style="display:block;margin-bottom:4px;color:var(--text3)">الإجمالي</small><span id="item_total_${idx}">${fC(item.total)}</span></div>
  <button type="button" onclick="removeInvoiceItemRow(${idx})" style="background:var(--red);color:white;border:none;border-radius:8px;padding:8px 12px;cursor:pointer" title="حذف الصنف"><i class=ji data-i=x></i></button>
  </div>`;
 }).join('');
 container.innerHTML=`<datalist id="invoiceUnitOptions">${unitOptions}</datalist><div class="text-muted" style="font-size:12px;margin-bottom:10px">الوحدة مرنة ويمكن كتابتها مثل: كجم، شوال، علبة أو كرتون. الوزن الإجمالي اختياري بالكيلوجرام.</div>${rows}`;
}
async function savePurchaseInvoice(){
const invoiceNumber = document.getElementById('invoiceNumber')?.value.trim() || `INV-${uid()}`;
const invoiceDate = document.getElementById('invoiceDate')?.value || today();
const supplierName = document.getElementById('supplierName')?.value.trim() || '';
const supplierPhone = document.getElementById('supplierPhone')?.value.trim() || '';
const supplierSel = document.getElementById('invoiceSupplierSel')?.value || '';
const paymentMethod = document.getElementById('paymentMethod')?.value || 'cash';
const paidAmountRaw = document.getElementById('invoicePaidAmount')?.value;
const notes = document.getElementById('invoiceNotes')?.value.trim() || '';
const validItems = currentInvoiceItems.filter(item=>item.itemName && item.qty>0 && item.price>=0);
if(validItems.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
try{
const result=await apiFetch('/warehouse/purchase-invoices',{method:'POST',body:JSON.stringify({
invoiceNumber,date:invoiceDate,supplierName,supplierPhone,paymentMethod,notes,
supplierId:supplierSel||null,
paidAmount:(paidAmountRaw!==''&&paidAmountRaw!=null)?Number(paidAmountRaw):undefined,
items:validItems.map(item=>({...item}))
})});
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
let msg = `تم إضافة فاتورة شراء بقيمة ${fC(result.totalAmount||0)} وتحديث المخزون`;
if(result.invoice?.supplierId){ msg += ` — الحالة: ${(result.invoice.paymentStatus==='paid')?'مدفوعة':(result.invoice.paymentStatus==='partial')?'مسددة جزئياً':'غير مسددة'}`; await refreshProcurementData(); }
if((result.createdNames||[]).length > 0){
msg += ` — تم إنشاء ${result.createdNames.length} صنف جديد: ${result.createdNames.slice(0,3).join('،')}${result.createdNames.length>3?` (+${result.createdNames.length-3})`:''}`;
}
toast(msg,'success');
}catch(e){ toast(e.message||'تعذر حفظ فاتورة الشراء','error'); }
}
// ═══ الرصيد الافتتاحي: إدخال سريع دفعة واحدة → فاتورة شراء آجلة على مورد الافتتاح ═══
let openingRows=[];
let openingImportPreview={rows:[],errors:[],fileName:''};
function openingSupplier(){
return (STATE.suppliers||[]).find(s=>s.category==='افتتاحي'||/افتتاحي/.test(s.name||''))
|| { id:null, name:'رصيد افتتاحي - بداية الفترة' };
}
function showOpeningBalanceModal(){
openingRows=[{name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}];
renderOpeningRows();
const sup=openingSupplier();
showModal(`<h3><i class=ji data-i=flag></i> رصيد افتتاحي — بداية الفترة</h3>
<div class="workflow-banner"><i class=ji data-i=info></i> أدخل جردك دفعة واحدة: <strong>الاسم + الكمية + الوحدة + سعر الشراء</strong> — واللحوم أضف <strong>عدد الكراتين</strong>. تُحفظ كفاتورة آجلة (مسدد 0) على المورد <strong>${esc(sup.name)}</strong> بلا حركة نقدية.</div>
<div class="callout-blue u-my16"><div class="fw-bold"><i class=ji data-i=file-text></i> إدخال احترافي من Excel</div><div class="text-muted u-t12 u-my8">حمّل النموذج، املأ الأصناف، ثم ارفع الملف لمراجعته قبل إضافته للفاتورة.</div><div class="u-row-wrap"><button type="button" class="btn btn-blue btn-sm" onclick="downloadOpeningTemplate()"><i class=ji data-i=arrow-down></i> تحميل النموذج</button><label class="btn btn-green btn-sm" style="cursor:pointer"><i class=ji data-i=inbox></i> رفع شيت Excel<input type="file" id="openingExcelFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="previewOpeningExcel(this.files[0])"></label></div><div id="openingImportPreview" class="u-mt8"></div></div>
<div id="openingRows" style="margin-top:12px"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addOpeningRow()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="callout-gold u-my16"><div class="fw-bold">إجمالي الرصيد الافتتاحي</div><div class="callout-value" id="openingTotal">${fC(0)}</div></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="saveOpeningBalance()"><i class=ji data-i=save></i> حفظ الرصيد الافتتاحي</button></div>`);
renderOpeningRows();
updateOpeningTotal();
}
function downloadOpeningTemplate(){
const data=[['اسم الصنف','الكمية','الوحدة','سعر الشراء','الكراتين','الفئة'],['دجاج','50','كجم','25','4','لحوم'],['مشروم','12','علبة','18','','معلبات'],['دقيق','20','كيس','3.5','','حبوب']];
const ws=XLSX.utils.aoa_to_sheet(data); ws['!cols']=[{wch:24},{wch:16},{wch:16},{wch:12},{wch:18}];
const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'الرصيد الافتتاحي');
XLSX.writeFile(wb,`نموذج_الرصيد_الافتتاحي_${today()}.xlsx`); toast('تم تحميل نموذج الرصيد الافتتاحي','success');
}
function openingHeaderKey(value){
return String(value||'').trim().toLowerCase().replace(/[\s_()-]/g,'').replace(/[أإآ]/g,'ا');
}
function previewOpeningExcel(file){
if(!file){return;}
const reader=new FileReader();
reader.onload=e=>{
try{
const wb=XLSX.read(e.target.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
if(data.length<2){throw new Error('الملف لا يحتوي على صفوف بيانات بعد عناوين الأعمدة');}
const headers=data[0].map(openingHeaderKey);
const findHeader=names=>{const keys=names.map(openingHeaderKey); return headers.findIndex(h=>keys.includes(h));};
const nameIdx=findHeader(['اسم الصنف','الصنف','اسم','item','name']);
const qtyIdx=findHeader(['الكميةكجم','الكمية','كمية','qty','quantity']);
const unitIdx=findHeader(['الوحدة','وحدة','unit','uom']);
const priceIdx=findHeader(['سعر الشراء','سعر','التكلفة','price','cost']);
const boxesIdx=findHeader(['الكراتين','كراتين','عدد الكراتين','boxes','cartons']);
const categoryIdx=findHeader(['الفئة','التصنيف','category','cat']);
if(nameIdx<0||qtyIdx<0||priceIdx<0){throw new Error('الأعمدة المطلوبة هي: اسم الصنف، الكمية، الوحدة، سعر الشراء');}
const rows=[],errors=[];
data.slice(1).forEach((row,index)=>{
const line=index+2, name=String(row[nameIdx]||'').trim(), qty=Number(row[qtyIdx]), price=Number(row[priceIdx]), rawBoxes=boxesIdx>=0?String(row[boxesIdx]??'').trim():'';
if(!name&&!rawBoxes&&!String(row[qtyIdx]??'').trim()&&!String(row[priceIdx]??'').trim()){return;}
const rowErrors=[];
if(!name){rowErrors.push('اسم الصنف مفقود');}
if(!Number.isFinite(qty)||qty<=0){rowErrors.push('الكمية يجب أن تكون أكبر من صفر');}
if(!Number.isFinite(price)||price<0){rowErrors.push('سعر الشراء غير صحيح');}
let boxes=null;
if(rawBoxes!==''){boxes=Number(rawBoxes); if(!Number.isInteger(boxes)||boxes<=0){rowErrors.push('الكراتين عدد صحيح أكبر من صفر');}}
if(boxes!==null&&isOpeningMeatRow({name,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()} )===false){rowErrors.push('الكراتين مسموحة لأصناف اللحوم فقط');}
if(rowErrors.length){errors.push({line,message:rowErrors.join('،')}); return;}
rows.push({name,qty,unit:String(unitIdx>=0?row[unitIdx]||'':'').trim()||'كجم',price,boxes,category:String(categoryIdx>=0?row[categoryIdx]||'':'').trim()||'عام'});
});
openingImportPreview={rows,errors,fileName:file.name}; renderOpeningImportPreview();
}catch(error){openingImportPreview={rows:[],errors:[{line:'—',message:error.message||'تعذر قراءة الملف'}],fileName:file.name}; renderOpeningImportPreview();}
};
reader.readAsArrayBuffer(file);
}
function renderOpeningImportPreview(){
const el=document.getElementById('openingImportPreview'); if(!el){return;}
const p=openingImportPreview;
if(!p.fileName){el.innerHTML=''; return;}
el.innerHTML=`<div class="u-t12"><strong>${esc(p.fileName)}</strong> — ${p.rows.length} صف صالح${p.errors.length?`، <span class="c-red">${p.errors.length} صف يحتاج تصحيحًا</span>`:'، جاهز للإضافة'}</div>${p.errors.length?`<div class="c-red u-t12 u-my8">${p.errors.slice(0,8).map(e=>`الصف ${e.line}: ${esc(e.message)}`).join('<br>')}${p.errors.length>8?'<br>...':''}</div>`:''}<button type="button" class="btn btn-green btn-sm u-mt8" onclick="appendOpeningImportRows()" ${p.rows.length?'':'disabled'}><i class=ji data-i=plus></i> إضافة ${p.rows.length} صف إلى الجرد</button>`;
}
function appendOpeningImportRows(){
if(!openingImportPreview.rows.length){toast('لا توجد صفوف صالحة للإضافة','error'); return;}
openingRows=openingRows.filter(r=>r.name||r.qty||r.price||r.category||r.boxes);
openingRows.push(...openingImportPreview.rows); openingImportPreview={rows:[],errors:[],fileName:''};
renderOpeningRows(); updateOpeningTotal(); renderOpeningImportPreview(); toast('تمت إضافة الصفوف الصحيحة إلى الجرد، راجعها قبل الحفظ','success');
}
function renderOpeningRows(){
const c=document.getElementById('openingRows'); if(!c){return;}
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (${esc(i.unit||'وحدة')})</option>`).join('');
c.innerHTML=openingRows.map((r,idx)=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px;border:1px solid var(--border)">
<div class="fr" style="align-items:flex-end">
<div class="fg" style="flex:2;min-width:160px"><label>الصنف *</label><input type="text" class="u-input" value="${esc(r.name)}" placeholder="اسم الصنف" list="openingInvList" oninput="updateOpeningRow(${idx},'name',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الكمية *</label><input type="number" class="u-input" value="${r.qty}" min="0" step="0.001" placeholder="0" style="font-weight:700" oninput="updateOpeningRow(${idx},'qty',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الوحدة *</label><input type="text" id="openingUnit_${idx}" class="u-input" value="${esc(r.unit||'كجم')}" placeholder="كجم، علبة، كيس..." oninput="updateOpeningRow(${idx},'unit',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>سعر الشراء *</label><input type="number" class="u-input" value="${r.price}" min="0" step="0.01" placeholder="0" oninput="updateOpeningRow(${idx},'price',this.value)"></div>
<div class="fg" id="openingBoxesField_${idx}" style="flex:1;min-width:80px;display:${isOpeningMeatRow(r)?'':'none'}"><label>كراتين (للحوم فقط)</label><input type="number" class="u-input" value="${r.boxes}" min="0" step="1" placeholder="—" oninput="updateOpeningRow(${idx},'boxes',this.value)"></div>
<div class="fg" style="flex:1;min-width:90px"><label>الفئة</label><input type="text" id="openingCategory_${idx}" class="u-input" value="${esc(r.category)}" placeholder="لحوم، خضار، مشروبات..." oninput="updateOpeningRow(${idx},'category',this.value)"></div>
<button type="button" class="btn btn-sm btn-red" onclick="removeOpeningRow(${idx})" title="حذف السطر"><i class=ji data-i=x></i></button>
</div></div>`).join('')+`<datalist id="openingInvList">${invOpts}</datalist>`;
}
function isOpeningMeatRow(row){
return /لحوم|لحم|لحمة|meat/i.test(String(row?.category||''));
}
function updateOpeningBoxesVisibility(idx){
const row=openingRows[idx]; if(!row){return;}
const field=document.getElementById(`openingBoxesField_${idx}`); const meat=isOpeningMeatRow(row);
if(field){field.style.display=meat?'':'none';}
if(!meat&&row.boxes!==''){
row.boxes='';
const input=field?.querySelector('input'); if(input){input.value='';}
}
}
function syncOpeningRowWithInventory(idx){
const row=openingRows[idx]; if(!row||!row.name){return;}
const item=(STATE.inventory||[]).find(i=>String(i.name||'').trim().toLowerCase()===String(row.name||'').trim().toLowerCase());
if(!item){return;}
if(item.unit){row.unit=String(item.unit); const unitEl=document.getElementById(`openingUnit_${idx}`); if(unitEl){unitEl.value=row.unit;}}
if(item.category){row.category=String(item.category); const categoryEl=document.getElementById(`openingCategory_${idx}`); if(categoryEl){categoryEl.value=row.category;}}
updateOpeningBoxesVisibility(idx);
}
function addOpeningRow(){ openingRows.push({name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}); renderOpeningRows(); }
function removeOpeningRow(idx){ if(openingRows.length<=1){ openingRows[0]={name:'',qty:'',unit:'كجم',price:'',boxes:'',category:''}; } else { openingRows.splice(idx,1); } renderOpeningRows(); updateOpeningTotal(); }
function updateOpeningRow(idx,field,value){
const r=openingRows[idx]; if(!r){return;}
if(field==='name'||field==='unit'||field==='category'){ r[field]=String(value||''); }
else if(field==='qty'){ r.qty=value===''?'':(parseFloat(value)||0); }
else if(field==='price'){ r.price=value===''?'':(parseFloat(value)||0); }
else if(field==='boxes'){ r.boxes=value===''?'':(parseInt(value)||0); }
if(field==='name'){ syncOpeningRowWithInventory(idx); }
if(field==='name'||field==='category'){ updateOpeningBoxesVisibility(idx); }
updateOpeningTotal();
}
function updateOpeningTotal(){
const t=openingRows.reduce((s,r)=>s+((parseFloat(r.qty)||0)*(parseFloat(r.price)||0)),0);
const el=document.getElementById('openingTotal'); if(el){el.innerHTML=fC(t);}
}
async function saveOpeningBalance(){
const items=openingRows.map(r=>({name:String(r.name||'').trim(),qty:parseFloat(r.qty)||0,unit:String(r.unit||'').trim()||'كجم',price:parseFloat(r.price)||0,boxes:r.boxes===''||r.boxes==null?null:(parseInt(r.boxes)||0),category:String(r.category||'').trim()||'عام'}))
.filter(r=>r.name&&r.qty>0&&r.price>=0);
if(!items.length){ toast('أدخل صنفًا واحدًا على الأقل: اسم + كمية + سعر','error'); return; }
const bad=items.find(r=>r.boxes!==null&&!(r.boxes>0));
if(bad){ toast(`عدد الكراتين للصنف "${bad.name}" يجب أن يكون أكبر من صفر أو اتركه فارغًا`,'error'); return; }
const sup=openingSupplier();
const invoiceNumber=`OPEN-${today().replace(/-/g,'')}-${String(Math.floor(Math.random()*900)+100)}`;
try{
showLoad();
const result=await apiFetch('/warehouse/purchase-invoices',{method:'POST',body:JSON.stringify({
invoiceNumber,date:today(),supplierName:sup.name,supplierPhone:'',paymentMethod:'credit',paidAmount:0,
notes:'رصيد افتتاحي بداية الفترة',supplierId:sup.id||null,
items:items.map(r=>({itemName:r.name,qty:r.qty,unit:r.unit,price:r.price,category:r.category,
...(r.boxes?{packagingQty:r.boxes,packagingUom:'كرتون'}:{})}))
})});
upsertStateEntity('purchaseInvoices',result.invoice);
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast(`تم حفظ الرصيد الافتتاحي: ${items.length} صنف بقيمة ${fC(result.totalAmount||0)}`,'success');
addNotification('رصيد افتتاحي',`تم إدخال ${items.length} صنف كرصيد بداية الفترة`,'success');
}catch(e){ toast(e.message||'تعذر حفظ الرصيد الافتتاحي','error'); }
finally{ hideLoad(); }
}
function viewPurchaseInvoice(id){
const inv = (STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
if(!inv){ toast('الفاتورة غير موجودة في قاعدة البيانات','warning'); return; }
let invoiceItems=Array.isArray(inv.items)?inv.items:[];
if(typeof inv.items==='string'){try{const parsed=JSON.parse(inv.items); if(Array.isArray(parsed)) {invoiceItems=parsed;}}catch(_){} }
showModal(`
<h3><i class=ji data-i=file-text></i> تفاصيل فاتورة الشراء</h3>
<div class="fr">
<div class="details-item"><strong>رقم الفاتورة:</strong><div>${esc(inv.invoiceNumber)}</div></div>
<div class="details-item"><strong>التاريخ:</strong><div>${fD(inv.date)}</div></div>
</div>
<div class="fr">
<div class="details-item"><strong>المورد:</strong><div>${esc(inv.supplierName||'—')}</div></div>
<div class="details-item"><strong>الهاتف:</strong><div>${esc(inv.supplierPhone||'—')}</div></div>
</div>
<div class="details-item"><strong>طريقة الدفع:</strong><div>${getPaymentMethodLabel(inv.paymentMethod)}</div></div>
${inv.supplierId?`<div class="fr">
<div class="details-item"><strong>المسدد:</strong><div class="c-green fw-bold">${fC(inv.paidAmount||0)}</div></div>
<div class="details-item"><strong>المتبقي:</strong><div class="${pcmtInvoiceRemaining(inv)>0?'c-red':'c-green'} fw-bold">${fC(pcmtInvoiceRemaining(inv))}</div></div>
</div>
<div class="details-item"><strong>حالة السداد:</strong><div>${pcmtStatusBadge(inv.paymentStatus)}${pcmtInvoiceRemaining(inv)>0?` <button class="btn btn-green btn-sm" onclick="closeModal();payInvoiceFull('${esc(String(inv.id))}')"><i class=ji data-i=coins></i> تسديد المتبقي</button>`:''}</div></div>`:''}
<div class="tbl-wrap" style="margin-top:14px">
<div class="tbl-hd"><h3><i class=ji data-i=package></i> الأصناف</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead>
<tbody>
${invoiceItems.map(item=>`<tr><td class="fw-bold">${esc(item.itemName)}</td><td>${esc(item.unit||'—')}</td><td>${fN(item.qty)}</td><td class="c-teal">${fN(item.weight||0)} كجم</td><td>${fC(item.price)}</td><td class="c-gold fw-bold">${fC(item.total||(item.qty*item.price))}</td></tr>`).join('')}
</tbody>
</table>
</div>
</div>
<div class="details-item"><strong>إجمالي الفاتورة:</strong><div class="c-gold fw-bold">${fC(inv.totalAmount)}</div></div>
<div class="details-item"><strong>ملاحظات:</strong><div>${esc(inv.notes||'—')}</div></div>
<div class="modal-footer"><button class="btn btn-blue" onclick="printPurchaseInvoice('${inv.id}')"><i class=ji data-i=printer></i> طباعة الفاتورة</button>${['admin','manager'].includes(STATE.currentUser?.role)?`<button class="btn btn-red" onclick="voidPurchaseInvoice('${inv.id}')"><i class=ji data-i=trash></i> حذف الفاتورة</button>`:''}<button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>
`);
}
async function voidPurchaseInvoice(id, force){
const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
if(!inv){return;}
if(!force && !confirm(`حذف فاتورة الشراء ${inv.invoiceNumber||''} (${fC(inv.totalAmount||0)})؟\nسيُعكس أثرها على المخزون تلقائيًا.\n${Number(inv.paidAmount||0)>0?'تحذير: عليها مبلغ مسدد — سيُرفض الحذف.':''}`)){return;}
showLoad();
try{
const r=await apiFetch(`/warehouse/purchase-invoices/${encodeURIComponent(id)}/void`,{method:'POST',body:JSON.stringify(force?{force:true}:{})});
STATE.purchaseInvoices=(STATE.purchaseInvoices||[]).filter(x=>String(x.id)!==String(id));
await window.loadData().catch(()=>{});
closeModal();renderPage();
toast(`حُذفت الفاتورة ${r.invoiceNumber||''} وعُكس مخزون ${r.reversedItems||0} صنفًا${r.deletedPayments?` وحُذفت ${r.deletedPayments} دفعة مرتبطة`:''}`,'success');
}catch(e){
const m=String(e.message||'');
if(!force&&(m.includes('مسدد')||m.includes('دفعات'))){
if(confirm(`${m}\n\nهل تريد الحذف القسري؟ (سيُحذف المسدد/الدفعات المرتبطة بهذه الفاتورة نهائيًا — لا يمكن التراجع)`)) {return voidPurchaseInvoice(id,true);}
return;
}
toast(m||'تعذر حذف الفاتورة','error');
}finally{hideLoad();}
}
function printPurchaseInvoice(id){
 const inv=(STATE.purchaseInvoices||[]).find(x=>String(x.id)===String(id));
 if(!inv){toast('الفاتورة غير موجودة في قاعدة البيانات','warning');return;}
 let items=Array.isArray(inv.items)?inv.items:[];
 if(typeof inv.items==='string'){try{const parsed=JSON.parse(inv.items);if(Array.isArray(parsed)){items=parsed;}}catch(_){} }
 const paymentLabel={cash:'نقدي',bank:'تحويل بنكي',credit:'آجل'}[inv.paymentMethod]||'—';
 const statusLabel={paid:'مدفوعة',partial:'مسددة جزئياً',unpaid:'غير مسددة'}[inv.paymentStatus]||'غير مسددة';
 const currency=esc(STATE.settings.currency||'SAR');
 const rows=items.map(item=>`<tr><td>${esc(item.itemName||'—')}</td><td>${esc(item.unit||'—')}</td><td>${fN(item.qty)}</td><td>${fN(item.weight||0)} كجم</td><td>${fN(item.price)} ${currency}</td><td>${fN(item.total||(Number(item.qty||0)*Number(item.price||0)))} ${currency}</td></tr>`).join('')||'<tr><td colspan="6">لا توجد أصناف</td></tr>';
 const win=window.open('','_blank','width=900,height=1000');
 if(!win){toast('اسمح بالنوافذ المنبثقة لطباعة الفاتورة','warning');return;}
 win.document.open();
 win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>فاتورة شراء ${esc(inv.invoiceNumber||'')}</title><style>body{font-family:Cairo,Tahoma,Arial,sans-serif;color:#111;background:#fff;margin:0;padding:28px;direction:rtl}.sheet{max-width:820px;margin:auto}.head{text-align:center;border-bottom:3px solid #b45309;padding-bottom:18px;margin-bottom:22px}.head h1{margin:0 0 8px;color:#b45309;font-size:26px}.head p{margin:4px 0;color:#555}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}.meta div{border:1px solid #ddd;border-radius:8px;padding:10px}.meta b{display:block;color:#555;font-size:12px;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ccc;padding:9px;text-align:right}th{background:#f7ead8;color:#7c3500}tfoot td{font-weight:700;background:#fafafa}.notes{margin-top:20px;border-top:1px solid #ddd;padding-top:12px;min-height:40px}.controls{text-align:center;margin-bottom:22px}.controls button{border:0;border-radius:7px;padding:10px 22px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff}.controls button.secondary{background:#555}@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:12mm}}</style></head><body><div class="controls"><button onclick="window.print()">طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>فاتورة شراء</p><p>${esc(inv.invoiceNumber||'—')}</p></header><section class="meta"><div><b>التاريخ</b>${fD(inv.date)}</div><div><b>المورد</b>${esc(inv.supplierName||'—')}</div><div><b>الهاتف</b>${esc(inv.supplierPhone||'—')}</div><div><b>طريقة الدفع</b>${paymentLabel}</div><div><b>حالة السداد</b>${statusLabel}</div><div><b>المسدد / المتبقي</b>${fN(inv.paidAmount||0)} / ${fN(Math.max(0,Number(inv.totalAmount||0)-Number(inv.paidAmount||0)))} ${currency}</div></section><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>الوزن</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="5">إجمالي الفاتورة</td><td>${fN(inv.totalAmount)} ${currency}</td></tr></tfoot></table><div class="notes"><b>ملاحظات:</b> ${esc(inv.notes||'—')}</div></main></body></html>`);
 win.document.close();
 win.focus();
}
// Import Catalog
function showImportItemsCatalogModal(){
showModal(`
<h3><i class=ji data-i=inbox></i> استيراد قائمة الأصناف من Excel</h3>
<div class="note-panel">
<strong><i class=ji data-i=clipboard-list></i> صيغة الملف:</strong><br>
الأعمدة: اسم الصنف، الفئة، الوحدة، الحد الأدنى
</div>
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-blue btn-sm" onclick="downloadItemsCatalogTemplate()"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="catalogExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="catalogPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="importItemsCatalog()"><i class=ji data-i=inbox></i> استيراد</button></div>
`);
document.getElementById('catalogExcelFile').addEventListener('change',previewCatalogFile);
}
function downloadItemsCatalogTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([['اسم الصنف','الفئة','الوحدة','الحد الأدنى'],['دجاج','لحوم','كجم',5],['أرز','حبوب','كيس',10],['زيت','زيوت','لتر',3]]);
ws['!cols']=[{wch:20},{wch:15},{wch:10},{wch:12}];
XLSX.utils.book_append_sheet(wb,ws,'الأصناف');
XLSX.writeFile(wb,'نموذج_قائمة_الأصناف.xlsx');
}
function previewCatalogFile(){
const file=document.getElementById('catalogExcelFile')?.files[0];
if(!file){return;}
const reader=new FileReader();
reader.onload=function(e){
try{
const wb=XLSX.read(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const rows=data.filter((r,i)=>i>0&&r[0]);
const prev=document.getElementById('catalogPreview');
if(!prev){return;}
if(rows.length===0){ prev.innerHTML='<div class="u-red"><i class=ji data-i=alert-triangle></i> لا توجد بيانات</div>'; return; }
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${rows.length} صنف</div>${rows.slice(0,5).map(r=>`<div class="preview-row"><i class=ji data-i=package></i> ${r[0]} | ${r[1]||'—'} | ${r[2]||'قطعة'} | حد أدنى: ${r[3]||5}</div>`).join('')}${rows.length>5?`<div style="color:var(--text3);font-size:12px;margin-top:6px">... و${rows.length-5} أصناف أخرى</div>`:''}</div>`;
}catch(err){ document.getElementById('catalogPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
};
reader.readAsBinaryString(file);
}
function importItemsCatalog(){
const file=document.getElementById('catalogExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
const reader=new FileReader();
reader.onload=async function(e){
try{
const wb=XLSX.read(e.target.result,{type:'binary'});
const ws=wb.Sheets[wb.SheetNames[0]];
const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
const rows=data.filter((r,i)=>i>0&&String(r[0]).trim());
let added=0, skipped=0;
for(const r of rows){
const name=String(r[0]).trim();
if(!name){continue;}
if(STATE.inventory.find(i=>i.name===name)){ skipped++; continue; }
const item = {name,category:String(r[1]||'').trim()||'عام',unit:String(r[2]||'').trim()||'قطعة',qty:0,avgCost:0,minQty:parseFloat(r[3])||5,weight:0,shelfId:null};
await persistCreate('inventory', (saved)=>STATE.inventory.push(saved), item);
added++;
}
closeModal(); renderPage();
toast(`تم استيراد ${added} صنف جديد${skipped>0?` (${skipped} مكرر تم تجاهله)`:''}`,'success');
}catch(err){ toast('خطأ في معالجة الملف','error'); }
};
reader.readAsBinaryString(file);
}
// Bulk Inventory Import
function showBulkInventoryImportModal(){
showModal(`
<h3><i class=ji data-i=chart></i> استيراد المخزون من Excel</h3>
<div class="note-panel">
<strong><i class=ji data-i=clipboard-list></i> صيغة الملف:</strong><br>
الأعمدة: اسم الصنف، الفئة، الوحدة، الكمية، سعر الشراء، الحد الأدنى
</div>
<div style="background:rgba(243,156,18,0.1);border:1px solid rgba(243,156,18,0.3);padding:12px;border-radius:var(--r);margin-bottom:14px;font-size:12px">
<i class=ji data-i=alert-triangle></i> <strong>تنبيه:</strong> إذا كان الصنف موجوداً مسبقاً، سيتم تحديث كميته وسعره فقط.
</div>
<div style="display:flex;gap:10px;margin-bottom:16px">
<button class="btn btn-blue btn-sm" onclick="downloadInventoryTemplate()"><i class=ji data-i=arrow-down></i> تحميل نموذج Excel</button>
</div>
<div class="fg"><label>اختر ملف Excel أو CSV</label><input type="file" id="inventoryExcelFile" accept=".xlsx,.xls,.csv" class="u-input"></div>
<div id="inventoryImportPreview" class="u-mt12"></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="importBulkInventory()"><i class=ji data-i=inbox></i> استيراد المخزون</button></div>
`);
document.getElementById('inventoryExcelFile').addEventListener('change',previewInventoryFile);
}
function downloadInventoryTemplate(){
const wb=XLSX.utils.book_new();
const ws=XLSX.utils.aoa_to_sheet([['اسم الصنف','الفئة','الوحدة','الكمية','سعر الشراء','الحد الأدنى'],['دجاج','لحوم','كجم',50,25,10],['أرز','حبوب','كيس',100,3.5,20],['زيت نخيل','زيوت','لتر',30,8,5]]);
ws['!cols']=[{wch:20},{wch:15},{wch:10},{wch:10},{wch:12},{wch:12}];
XLSX.utils.book_append_sheet(wb,ws,'المخزون');
XLSX.writeFile(wb,'نموذج_استيراد_المخزون.xlsx');
}
function parseInventoryImportCell(value) {
    if (value === null || value === undefined) {return '';} 
    return String(value).replace(/\uFEFF/g, '').trim();
}
function parseInventoryImportNumber(value, fallback = 0) {
    if (value === null || value === undefined || value === '') {return fallback;}
    const raw = parseInventoryImportCell(value).replace(/[,\s]/g, '');
    const normalized = raw.replace(/[٠-٩]/g, ch => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch)).replace(/[\u0660-\u0669]/g, ch => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    const num = Number(normalized.replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(num) ? num : fallback;
}
async function readInventoryImportRows(file) {
    if (!file) {return [];} 
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const result = e.target && e.target.result;
                if (!result) { resolve([]); return; }
                const isCsv = /\.csv$/i.test(file.name || '');
                const book = XLSX.read(result, { type: isCsv ? 'string' : 'binary' });
                const sheet = book.Sheets[book.SheetNames[0]];
                const allRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                const rows = Array.isArray(allRows) ? allRows.filter((row) => Array.isArray(row) ? row.some((cell) => parseInventoryImportCell(cell) !== '') : parseInventoryImportCell(row) !== '') : [];
                resolve(rows);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = function () { reject(new Error('FILE_READ_FAILED')); };
        if (/\.csv$/i.test(file.name || '')) { reader.readAsText(file, 'UTF-8'); }
        else { reader.readAsBinaryString(file); }
    });
}
function inventoryImportRowsFromSheet(rows) {
    if (!rows.length) {return [];} 
    const headerRow = rows[0].map((cell) => parseInventoryImportCell(cell).toLowerCase());
    const headerHasNames = headerRow.some((cell) => /^(اسم|اسم\s*الصنف|item|product|name)$/.test(cell));
    const startIndex = headerHasNames ? 1 : 0;
    return rows.slice(startIndex).map((row) => {
        const item = Array.isArray(row) ? row : [row];
        const category = parseInventoryImportCell(item[1] || '');
        return {
            name: parseInventoryImportCell(item[0]),
            category: category || 'عام',
            unit: parseInventoryImportCell(item[2] || ''),
            qty: parseInventoryImportNumber(item[3], 0),
            price: parseInventoryImportNumber(item[4], 0),
            minQty: parseInventoryImportNumber(item[5], 5),
        };
    }).filter((row) => row.name && row.qty >= 0 && row.price >= 0);
}
function previewInventoryFile(){
const file=document.getElementById('inventoryExcelFile')?.files[0];
if(!file){return;}
readInventoryImportRows(file).then((rows) => {
try{
const list = inventoryImportRowsFromSheet(rows);
const prev=document.getElementById('inventoryImportPreview');
if(!prev){return;}
if(!list.length){ prev.innerHTML='<div class="u-red"><i class=ji data-i=alert-triangle></i> لا توجد بيانات صالحة</div>'; return; }
const totalValue=list.reduce((s,r)=>s+((r.qty||0)*(r.price||0)),0);
prev.innerHTML=`<div class="preview-scroll"><div class="u-gold-strong u-mb8">معاينة: ${list.length} صنف | إجمالي القيمة: ${fC(totalValue)}</div><table style="width:100%;font-size:12px;border-collapse:collapse"><tr class="u-faint"><th style="text-align:right;padding:4px">الصنف</th><th>الكمية</th><th>السعر</th><th>القيمة</th></tr>${list.slice(0,6).map(r=>`<tr style="border-top:1px solid var(--border)"><td style="padding:4px">${esc(String(r.name))}</td><td class="u-ta-c">${fN(r.qty||0)} ${r.unit || ''}</td><td class="u-ta-c">${fC(r.price||0)}</td><td style="text-align:center;color:var(--gold)">${fC((r.qty||0)*(r.price||0))}</td></tr>`).join('')}${list.length>6?`<tr><td colspan="4" style="color:var(--text3);text-align:center;padding:6px">... و${list.length-6} أصناف أخرى</td></tr>`:''}</table></div>`;
}catch(err){ document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; }
}).catch(() => { document.getElementById('inventoryImportPreview').innerHTML='<div class="u-red"><i class=ji data-i=circle-x></i> خطأ في قراءة الملف</div>'; });
}
async function importBulkInventory(){
const file=document.getElementById('inventoryExcelFile')?.files[0];
if(!file){ toast('اختر ملف Excel أولاً','error'); return; }
try{
const rows = await readInventoryImportRows(file);
const items = inventoryImportRowsFromSheet(rows).map((row) => ({
    name: String(row.name).trim(),
    category: String(row.category || 'عام').trim() || 'عام',
    unit: String(row.unit || 'قطعة').trim() || 'قطعة',
    qty: Number(row.qty) || 0,
    price: Number(row.price) || 0,
    minQty: Number(row.minQty) || 5,
})).filter((row) => row.name && row.qty > 0 && row.price >= 0);
if(!items.length){toast('لا توجد صفوف صالحة للاستيراد','error'); return;}
const existingNames=new Set(STATE.inventory.map(i=>String(i.name||'').toLowerCase()));
const result=await apiFetch('/warehouse/inventory/bulk-receipt',{method:'POST',body:JSON.stringify({items})});
(result.inventory||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
const added=items.filter(item=>!existingNames.has(item.name.toLowerCase())).length;
const updated=items.length-added;
closeModal(); renderPage();
toast(`تم الاستيراد: ${added} صنف جديد، ${updated} صنف محدَّث`,'success');
}catch(err){ toast('خطأ في معالجة الملف','error'); }
}
// ============================================
// SHELVES
// ============================================
function renderShelves(){
if(!checkMenuAccessLocal('shelves')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const totalItems = STATE.inventory.length;
const assignedItems = STATE.inventory.filter(i=>i.shelfId).length;
const emptyShelves = STATE.shelves.filter(s=>!STATE.inventory.some(i=>i.shelfId===s.id)).length;
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=archive></i> ${t('shv.total')}</div><div class="mcard-val c-teal">${fN(STATE.shelves.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> ${t('shv.assigned')}</div><div class="mcard-val c-gold">${fN(assignedItems)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> رفوف فارغة</div><div class="mcard-val ${emptyShelves>0?'c-orange':'c-green'}">${fN(emptyShelves)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> نسبة الإشغال</div><div class="mcard-val c-purple">${totalItems>0?fN((assignedItems/totalItems*100).toFixed(1))+'%':'0%'}</div></div>
</div>
<div class="u-row-between">
<h3 class="u-gold-strong"><i class=ji data-i=archive></i> إدارة الرفوف</h3>
<button class="btn btn-gold" onclick="showAddShelfModal()"><i class=ji data-i=plus></i> إضافة رف</button>
</div>
<div class="shelf-grid">
${STATE.shelves.map(shelf=>{
const items = STATE.inventory.filter(i=>i.shelfId===shelf.id);
const totalQty = items.reduce((s,i)=>s+i.qty,0);
const totalValue = items.reduce((s,i)=>s+(i.qty*i.avgCost),0);
return `
<div class="shelf-card">
<div class="shelf-header">
<span class="shelf-icon">${shelf.icon||'<i class=ji data-i=archive></i>'}</span>
<div class="shelf-name">${esc(shelf.name)}</div>
<span class="shelf-count">${items.length}</span>
</div>
<div style="font-size:11px;color:var(--text3);margin-bottom:10px"><i class=ji data-i=map-pin></i> ${esc(shelf.location||'—')} | <i class=ji data-i=chart></i> السعة: ${shelf.capacity||'—'}</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
<div class="dstat"><div class="dstat-lbl">الكمية</div><div class="dstat-val c-gold">${fN(totalQty)}</div></div>
<div class="dstat"><div class="dstat-lbl">القيمة</div><div class="dstat-val c-green">${fC(totalValue)}</div></div>
</div>
<div class="shelf-items">
${items.slice(0,5).map(item=>`
<div class="shelf-item">
<span>${esc(item.name)}</span>
<span class="c-gold fw-bold">${fN(item.qty)} ${item.unit}</span>
</div>
`).join('')}
${items.length>5?`<div style="font-size:11px;color:var(--text3);text-align:center;padding:4px">... و${items.length-5} أصناف أخرى</div>`:''}
${items.length===0?'<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px">الرف فارغ</div>':''}
</div>
<div style="display:flex;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
<button class="btn btn-sm u-flex1" onclick="editShelf('${shelf.id}')"><i class=ji data-i=pencil></i> تعديل</button>
<button class="btn btn-red btn-sm u-flex1" onclick="deleteShelf('${shelf.id}')"><i class=ji data-i=trash></i> حذف</button>
</div>
</div>
`;
}).join('')||'<div class="mcard u-empty-grid">لا توجد رفوف</div>'}
</div>
`;
}
function showAddShelfModal(){
showModal(`
<h3><i class=ji data-i=plus></i> إضافة رف جديد</h3>
<div class="fr">
<div class="fg"><label>اسم الرف</label><input type="text" id="shelfName" placeholder="مثال: الرف A1"></div>
<div class="fg"><label>الكود</label><input type="text" id="shelfCode" placeholder="A1" maxlength="5"></div>
</div>
<div class="fr">
<div class="fg"><label>الموقع</label><input type="text" id="shelfLocation" placeholder="المخزن الرئيسي"></div>
<div class="fg"><label>السعة</label><input type="number" id="shelfCapacity" value="50"></div>
</div>
<div class="fg"><label>الأيقونة</label><input type="text" id="shelfIcon" value="<i class=ji data-i=archive></i>" maxlength="2"></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="addShelf()"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function addShelf(){
const name=document.getElementById('shelfName')?.value.trim();
const code=document.getElementById('shelfCode')?.value.trim().toUpperCase();
const location=document.getElementById('shelfLocation')?.value.trim();
const capacity=parseInt(document.getElementById('shelfCapacity')?.value)||50;
const icon=document.getElementById('shelfIcon')?.value||'<i class=ji data-i=archive></i>';
if(!name||!code){ toast('أدخل الاسم والكود','error'); return; }
if(STATE.shelves.find(s=>s.code===code)){ toast('الكود موجود بالفعل','error'); return; }
await persistCreate('shelves', (saved)=>STATE.shelves.push(saved), {id:uid(),name,code,location,capacity,icon});
closeModal(); renderPage();
toast('تم إضافة الرف','success');
}
function editShelf(id){
const shelf=STATE.shelves.find(s=>s.id==id);
if(!shelf){return;}
showModal(`
<h3><i class=ji data-i=pencil></i> تعديل الرف</h3>
<div class="fg"><label>اسم الرف</label><input type="text" id="shelfName" value="${esc(shelf.name)}"></div>
<div class="fr">
<div class="fg"><label>الموقع</label><input type="text" id="shelfLocation" value="${esc(shelf.location||'')}"></div>
<div class="fg"><label>السعة</label><input type="number" id="shelfCapacity" value="${shelf.capacity||50}"></div>
</div>
<div class="fg"><label>الأيقونة</label><input type="text" id="shelfIcon" value="${shelf.icon||'<i class=ji data-i=archive></i>'}" maxlength="2"></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="updateShelf('${id}')"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function updateShelf(id){
const shelf=STATE.shelves.find(s=>s.id==id);
if(!shelf){return;}
const name=document.getElementById('shelfName')?.value.trim();
const location=document.getElementById('shelfLocation')?.value.trim();
const capacity=parseInt(document.getElementById('shelfCapacity')?.value)||50;
const icon=document.getElementById('shelfIcon')?.value||'<i class=ji data-i=archive></i>';
await persistUpdate('shelves', id, {name,location,capacity,icon});
Object.assign(shelf, {name,location,capacity,icon});
closeModal(); renderPage();
toast('تم التحديث','success');
}
async function deleteShelf(id){
if(!confirm('حذف هذا الرف؟ سيتم إزالة تعيين الأصناف منه.')){return;}
await persistRemove('shelves', id);
STATE.shelves=STATE.shelves.filter(s=>s.id!=id);
renderPage();
toast('تم الحذف','warning');
}
// ============================================
// WEIGHT
// ============================================
let currentWeight = 0;
let weightUnit = 'kg';
function renderWeight(){
if(!checkMenuAccessLocal('weight')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const totalReadings = (STATE.weightReadings||[]).length;
const totalWeight = (STATE.weightReadings||[]).reduce((s,r)=>s+(r.weight||0),0);
const todayReadings = (STATE.weightReadings||[]).filter(r=>r.date===today()).length;
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=scale></i> ${t('w8.today')}</div><div class="mcard-val c-teal">${fN(todayReadings)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> ${t('w8.total')}</div><div class="mcard-val c-gold">${fN(totalReadings)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> إجمالي الوزن</div><div class="mcard-val c-blue">${fN(totalWeight)} كجم</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=refresh></i> آخر قراءة</div><div class="mcard-val c-purple u-t14">${STATE.weightReadings?.length?fDT(STATE.weightReadings[STATE.weightReadings.length-1].timestamp):'—'}</div></div>
</div>
<div class="weight-display">
<div class="weight-label"><i class=ji data-i=scale></i> الميزان الرقمي</div>
<div class="weight-value" id="weightValue">${fN(currentWeight)}</div>
<div class="weight-unit" id="weightUnit">${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'}</div>
<div class="weight-controls">
<button class="weight-btn" onclick="adjustWeight(-1)">- 1</button>
<button class="weight-btn" onclick="adjustWeight(-0.1)">- 0.1</button>
<button class="weight-btn active" onclick="resetWeight()"><i class=ji data-i=refresh></i> تصفير</button>
<button class="weight-btn" onclick="adjustWeight(0.1)">+ 0.1</button>
<button class="weight-btn" onclick="adjustWeight(1)">+ 1</button>
</div>
<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="btn btn-gold" onclick="recordWeight()"><i class=ji data-i=file-text></i> تسجيل القراءة</button>
<button class="btn btn-blue" onclick="recordWeightToItem()"><i class=ji data-i=package></i> إضافة لصنف</button>
</div>
<div style="margin-top:15px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
<button class="weight-btn ${weightUnit==='kg'?'active':''}" onclick="setWeightUnit('kg')">كجم</button>
<button class="weight-btn ${weightUnit==='g'?'active':''}" onclick="setWeightUnit('g')">جرام</button>
<button class="weight-btn ${weightUnit==='lb'?'active':''}" onclick="setWeightUnit('lb')">رطل</button>
</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=chart></i> سجل القراءات</h3></div>
<div class="tbl-scroll">
<table>
<thead><tr><th>التاريخ</th><th>الوقت</th><th>الوزن</th><th>الوحدة</th><th>الصنف</th><th>ملاحظات</th></tr></thead>
<tbody>
${(STATE.weightReadings||[]).slice().reverse().slice(0,30).map(r=>`<tr>
<td>${fD(r.date)}</td>
<td>${r.time||'—'}</td>
<td class="c-teal fw-bold">${fN(r.weight)}</td>
<td>${r.unit==='kg'?'كجم':r.unit==='g'?'جرام':'رطل'}</td>
<td>${esc(r.itemName||'—')}</td>
<td class="text-muted">${esc(r.notes||'—')}</td>
</tr>`).join('')||'<tr><td colspan="6" class="u-empty">لا توجد قراءات</td></tr>'}
</tbody>
</table>
</div>
</div>
`;
}
function adjustWeight(val){
currentWeight = Math.max(0, currentWeight + val);
currentWeight = parseFloat(currentWeight.toFixed(3));
const el = document.getElementById('weightValue');
if(el) {el.textContent = fN(currentWeight);}
}
function resetWeight(){
currentWeight = 0;
const el = document.getElementById('weightValue');
if(el) {el.textContent = '0';}
}
function setWeightUnit(unit){
weightUnit = unit;
const el = document.getElementById('weightUnit');
if(el) {el.textContent = unit==='kg'?'كجم':unit==='g'?'جرام':'رطل';}
document.querySelectorAll('.weight-btn').forEach(b=>{
if(b.textContent.includes('كجم')||b.textContent.includes('جرام')||b.textContent.includes('رطل')){
b.classList.remove('active');
}
});
event.target.classList.add('active');
}
async function recordWeight(){
if(currentWeight<=0){ toast('الوزن يجب أن يكون أكبر من صفر','error'); return; }
const notes = prompt('ملاحظات (اختياري):') || '';
if(!STATE.weightReadings) {STATE.weightReadings = [];}
const wr = {id:uid(), date:today(), time:nowTime(), timestamp:new Date().toISOString(),
weight:currentWeight, unit:weightUnit, itemName:null, notes,
recordedBy:STATE.currentUser?.username||'unknown'};
await persistCreate('weightReadings', (saved)=>STATE.weightReadings.push(saved), wr);
toast(`تم تسجيل الوزن: ${fN(currentWeight)} ${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'}`,'success');
resetWeight();
renderPage();
}
function recordWeightToItem(){
if(currentWeight<=0){ toast('الوزن يجب أن يكون أكبر من صفر','error'); return; }
const itemOptions = STATE.inventory.map(i=>`<option value="${i.id}">${esc(i.name)} (${i.unit})</option>`).join('');
showModal(`
<h3><i class=ji data-i=package></i> إضافة الوزن لصنف</h3>
<div class="fg"><label>الصنف</label><select id="weightItem">${itemOptions}</select></div>
<div class="fg"><label>الوزن المقاس</label><input type="number" id="recordedWeight" value="${currentWeight}" step="0.01" readonly style="background:var(--gold-d);color:var(--gold);font-weight:800"></div>
<div class="fg"><label>ملاحظات</label><textarea id="weightNotes" rows="2"></textarea></div>
<div class="modal-footer">
<button class="btn" onclick="closeModal()">إلغاء</button>
<button class="btn btn-gold" onclick="confirmRecordWeightToItem()"><i class=ji data-i=save></i> حفظ</button>
</div>
`);
}
async function confirmRecordWeightToItem(){
const itemId = document.getElementById('weightItem')?.value;
const weight = parseFloat(document.getElementById('recordedWeight')?.value);
const notes = document.getElementById('weightNotes')?.value.trim();
const item = STATE.inventory.find(i=>i.id==itemId);
if(!item){ toast('الصنف غير موجود','error'); return; }
if(!STATE.weightReadings) {STATE.weightReadings = [];}
const wr2 = {id:uid(), date:today(), time:nowTime(), timestamp:new Date().toISOString(),
weight, unit:weightUnit, itemId:item.id, itemName:item.name, notes,
recordedBy:STATE.currentUser?.username||'unknown'};
await persistCreate('weightReadings', (saved)=>STATE.weightReadings.push(saved), wr2);
item.weight = (item.weight||0) + (weightUnit==='kg'?weight:weightUnit==='g'?weight/1000:weight*0.453592);
item.weight = parseFloat(item.weight.toFixed(3));
await persistUpdate('inventory', item.id, {weight:item.weight});
closeModal();
toast(`تم إضافة ${fN(weight)} ${weightUnit==='kg'?'كجم':weightUnit==='g'?'جرام':'رطل'} إلى ${item.name}`,'success');
resetWeight();
renderPage();
}
// ============================================
// KITCHEN & DISPATCH
// ============================================
let kitchenOverviewLoading = false;
async function refreshKitchenOverview(){ if(kitchenOverviewLoading){return;} kitchenOverviewLoading=true; try{STATE.kitchenOps=await apiFetch('/kitchen/overview'); renderPage();}catch(e){toast(e.message||'تعذر تحديث لوحة المطبخ','error')}finally{kitchenOverviewLoading=false;} }
let kitchenProductionRows=[];
let kitchenProductionDestinationsRows=[];
function kitchenProductionDestinations(){
 const rows=[];
 (kitchenProductionDestinationsRows.length?kitchenProductionDestinationsRows:(STATE.departments||[])).filter(d=>String(d.code||'').toLowerCase()!=='kitchen'&&!String(d.name||'').includes('مطبخ')).forEach(d=>rows.push({value:`department|${d.id}|${d.name}`,label:`قسم: ${d.name}`}));
 rows.push({value:'custom|custom|',label:'جهة مخصصة اختيارية'});
 return rows;
}
let kitchenProductionMaterials=[];
let kitchenProductionMaterialRows=[];
async function showKitchenProductionModal(){
 let productsList=[],materialsList=[],destinationsList=[];
 const [productsResult,materialsResult,destinationsResult]=await Promise.allSettled([apiFetch('/pos/products'),apiFetch('/kitchen/production-materials'),apiFetch('/kitchen/production-destinations')]);
 if(productsResult.status==='fulfilled') {productsList=productsResult.value;} else {toast(productsResult.reason?.message||'تعذر تحميل المنتجات النهائية','error');}
 if(materialsResult.status==='fulfilled') {materialsList=materialsResult.value;} else {toast(materialsResult.reason?.message||'تعذر تحميل رصيد مخزن المطبخ','error');}
 if(destinationsResult.status==='fulfilled') {destinationsList=destinationsResult.value;} else {toast(destinationsResult.reason?.message||'تعذر تحميل أقسام التوزيع','error');}
 kitchenProductionMaterials=Array.isArray(materialsList)?materialsList:[];
 kitchenProductionDestinationsRows=Array.isArray(destinationsList)?destinationsList:[];
 const products= (Array.isArray(productsList)?productsList:[]).filter(p=>p.is_active!==false).map(p=>`<option value="${esc(String(p.id))}" data-name="${esc(p.name_ar||p.name_en||'منتج')}" data-unit="${esc(p.unit||'وحدة')}">${esc(p.name_ar||p.name_en||'منتج')} — ${esc(p.unit||'وحدة')}</option>`).join('');
 const materialMessage=kitchenProductionMaterials.length?'اختر المكونات من رصيد مخزن المطبخ':'لا توجد أصناف متاحة في مخزن المطبخ؛ استلم المواد أولًا';
 const destinationOptions=kitchenProductionDestinations();
 kitchenProductionRows=destinationOptions.filter(x=>x.value.startsWith('department|')).slice(0,2).map(x=>({destination:x.value,quantity:''}));
 if(!kitchenProductionRows.length) {kitchenProductionRows=[{destination:'custom|custom|',quantity:''}];}
 kitchenProductionMaterialRows=[{inventory_id:'',quantity:'',waste_percent:'0'}];
 showModal(`<h3><i class=ji data-i=cooking-pot></i> أمر إنتاج وتوزيع المطبخ</h3><p class="text-muted">الأمر مستقل عن الوصفة وعن كتالوج البيع. اكتب اسم المنتج النهائي يدويًا، أو اختر منتجًا مسجلًا اختياريًا، ثم حدد المكونات والكميات من رصيد مخزن المطبخ.</p><div class="fg"><label>اسم المنتج النهائي</label><input type="text" id="kitchenProductionProductName" placeholder="مثال: دجاج مطهي أو صينية لحم"></div><div class="fr"><div class="fg"><label>منتج مسجل اختياري</label><select id="kitchenProductionProduct"><option value="">بدون ربط بمنتج مسجل</option>${products}</select></div><div class="fg"><label>الوحدة</label><input type="text" id="kitchenProductionProductUnit" value="وحدة" placeholder="حبة، كجم، صينية..."></div></div><div class="fg"><label>إجمالي الكمية المنتجة</label><input type="number" id="kitchenProductionQty" min="0.01" step="0.01" placeholder="مثال: 50 حبة" oninput="updateKitchenProductionTotal()"></div><div class="workflow-banner"><strong><i class=ji data-i=package></i> مكونات أمر الإنتاج اليدوي</strong><small style="display:block;margin-top:4px">${esc(materialMessage)}. مثال: أرز 40 كجم، لحم 20 كجم، هالك 5%.</small></div><div id="kitchenProductionMaterialRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenProductionMaterialRow()"><i class=ji data-i=plus></i> إضافة مكون</button><div class="workflow-banner u-mt12"><strong><i class=ji data-i=split></i> توزيع المنتج النهائي</strong><small style="display:block;margin-top:4px">يجب أن يساوي مجموع التوزيع إجمالي الإنتاج.</small></div><div id="kitchenProductionDistributionRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenProductionDistributionRow()"><i class=ji data-i=plus></i> إضافة جهة</button><div id="kitchenProductionDistributionSummary" class="text-muted u-mt8"></div><div class="fg"><label>ملاحظات الأمر</label><textarea id="kitchenProductionNotes" rows="2" placeholder="وردية الصباح، دفعة الغداء، رقم المناسبة..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenProduction()" ${kitchenProductionMaterials.length?'':'disabled'}>حفظ أمر الإنتاج والتوزيع</button></div>`);
 renderKitchenProductionMaterialRows();renderKitchenProductionRows();
}
function setKitchenProductionMaterialField(index,field,value){if(kitchenProductionMaterialRows[index]){kitchenProductionMaterialRows[index][field]=value;}}
function addKitchenProductionMaterialRow(){kitchenProductionMaterialRows.push({inventory_id:'',quantity:'',waste_percent:'0'});renderKitchenProductionMaterialRows();}
function removeKitchenProductionMaterialRow(index){if(kitchenProductionMaterialRows.length<=1){return;}kitchenProductionMaterialRows.splice(index,1);renderKitchenProductionMaterialRows();}
function renderKitchenProductionMaterialRows(){
 const container=document.getElementById('kitchenProductionMaterialRows');if(!container){return;}
 const options=kitchenProductionMaterials.map(m=>`<option value="${esc(String(m.inventory_id))}">${esc(m.name)} — متاح ${fN(m.available)} ${esc(m.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenProductionMaterialRows.map((row,index)=>`<div class="production-distribution-row fr" style="align-items:end;margin-top:8px"><div class="fg"><label>المكون ${index+1}</label><select onchange="setKitchenProductionMaterialField(${index},'inventory_id',this.value)"><option value="">اختر مكونًا من المخزن</option>${options}</select></div><div class="fg"><label>الكمية</label><input type="number" min="0.001" step="0.001" value="${esc(row.quantity||'')}" placeholder="الكمية" oninput="setKitchenProductionMaterialField(${index},'quantity',this.value)"></div><div class="fg"><label>الهالك %</label><input type="number" min="0" max="100" step="0.01" value="${esc(row.waste_percent||'0')}" oninput="setKitchenProductionMaterialField(${index},'waste_percent',this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenProductionMaterialRow(${index})"><i class=ji data-i=x></i></button></div>`).join('');
 kitchenProductionMaterialRows.forEach((row,index)=>{const select=container.querySelectorAll('select')[index];if(select){select.value=String(row.inventory_id||'');}});
}
function addKitchenProductionDistributionRow(){kitchenProductionRows.push({destination:'channel|custom|',quantity:''});renderKitchenProductionRows();}
function removeKitchenProductionDistributionRow(index){if(kitchenProductionRows.length<=1){return;}kitchenProductionRows.splice(index,1);renderKitchenProductionRows();}
function syncKitchenProductionDestination(select,index){kitchenProductionRows[index].destination=select.value;renderKitchenProductionRows();}
function setKitchenProductionCustomName(index,value){if(kitchenProductionRows[index]){kitchenProductionRows[index].customName=String(value||'').trim();}}
function setKitchenProductionDistributionQty(index,value){if(kitchenProductionRows[index]){kitchenProductionRows[index].quantity=value;}updateKitchenProductionTotal();}
function renderKitchenProductionRows(){
 const container=document.getElementById('kitchenProductionDistributionRows');if(!container){return;}
 const options=kitchenProductionDestinations();
 container.innerHTML=kitchenProductionRows.map((row,index)=>{const selected=String(row.destination||'custom|custom|');const parts=selected.split('|');const isCustom=parts[0]==='custom';return `<div class="production-distribution-row fr" data-row-index="${index}" style="align-items:end;margin-top:8px"><div class="fg"><label>الجهة ${index+1}</label><select class="kitchen-production-destination" onchange="syncKitchenProductionDestination(this,${index})">${options.map(o=>`<option value="${esc(o.value)}" ${o.value===selected?'selected':''}>${esc(o.label)}</option>`).join('')}</select>${isCustom?`<input class="kitchen-production-custom" type="text" value="${esc(parts[2]||'')}" placeholder="اكتب اسم الجهة" oninput="setKitchenProductionCustomName(${index},this.value)">`:''}</div><div class="fg"><label>الكمية</label><input class="kitchen-production-distribution-qty" type="number" min="0.01" step="0.01" value="${esc(row.quantity||'')}" oninput="setKitchenProductionDistributionQty(${index},this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenProductionDistributionRow(${index})"><i class=ji data-i=x></i></button></div>`;}).join('');updateKitchenProductionTotal();
}
function updateKitchenProductionTotal(){const total=Number(document.getElementById('kitchenProductionQty')?.value||0),allocated=kitchenProductionRows.reduce((s,r)=>s+Number(r.quantity||0),0),el=document.getElementById('kitchenProductionDistributionSummary');if(el){const diff=Number((total-allocated).toFixed(4));el.innerHTML=`الموزع: <strong>${fN(allocated)}</strong> من <strong>${fN(total)}</strong> ${diff===0?'<span class="c-green">✓ مكتمل</span>':`<span class="c-orange">المتبقي: ${fN(diff)}</span>`}`;}}
async function submitKitchenProduction(){
 const productSelect=document.getElementById('kitchenProductionProduct'),productId=productSelect?.value||null,typedProductName=document.getElementById('kitchenProductionProductName')?.value.trim()||'',selectedOption=productSelect?.selectedOptions?.[0],productName=typedProductName||selectedOption?.dataset?.name||'',productUnit=document.getElementById('kitchenProductionProductUnit')?.value.trim()||selectedOption?.dataset?.unit||'وحدة',qty=Number(document.getElementById('kitchenProductionQty')?.value||0),notes=document.getElementById('kitchenProductionNotes')?.value||'';
 if((!productId&&!productName)||qty<=0){toast('اكتب اسم المنتج النهائي والكمية المنتجة','warning');return;}
 const materials=kitchenProductionMaterialRows.map(row=>({inventory_id:Number(row.inventory_id),quantity:Number(row.quantity||0),waste_percent:Number(row.waste_percent||0)})).filter(x=>x.inventory_id&&x.quantity>0);
 if(!materials.length||materials.length!==kitchenProductionMaterialRows.length){toast('أضف كل مكونات أمر الإنتاج وحدد كمياتها','warning');return;}
 if(new Set(materials.map(x=>x.inventory_id)).size!==materials.length){toast('لا تكرر نفس المكون؛ اجمع كميته في سطر واحد','warning');return;}
 if(materials.some(x=>x.waste_percent<0||x.waste_percent>100)){toast('نسبة الهالك يجب أن تكون بين 0 و100%','warning');return;}
 const distributions=kitchenProductionRows.map(row=>{const p=String(row.destination||'').split('|');return {destination_type:p[0],destination_code:p[1],destination_name:p[0]==='custom'?(row.customName||''):p[2],department_id:p[0]==='department'?Number(p[1]):null,quantity:Number(row.quantity||0)};}).filter(x=>x.quantity>0);
 const allocated=distributions.reduce((s,x)=>s+x.quantity,0);if(!distributions.length||Math.abs(allocated-qty)>0.0001){toast(`يجب أن يساوي مجموع التوزيع ${fN(allocated)} إجمالي الإنتاج ${fN(qty)}`,'error');return;}
 if(distributions.some(x=>x.destination_type==='custom'&&!x.destination_name)){toast('اكتب اسم الجهة المخصصة','error');return;}
 try{showLoad();const result=await apiFetch('/kitchen/production',{method:'POST',body:JSON.stringify({product_id:productId?Number(productId):null,product_name:productName,product_unit:productUnit,produced_qty:qty,notes,materials,distributions})});closeModal();await refreshKitchenOverview();toast(`تم تسجيل إنتاج ${fN(qty)} وتوزيعه على ${result.distributions?.length||distributions.length} جهات مع خصم المكونات من مخزن المطبخ`,'success');}catch(e){toast(e.message||'تعذر تسجيل الإنتاج والتوزيع','error')}finally{hideLoad();}
}
let kitchenGovernance={audits:[],documents:[]};
let kitchenGovernanceLoading=false;
async function refreshKitchenGovernance(){if(kitchenGovernanceLoading){return;}kitchenGovernanceLoading=true;try{const [audits,documents]=await Promise.all([apiFetch('/kitchen/audits'),apiFetch('/kitchen/documents')]);kitchenGovernance={audits:Array.isArray(audits)?audits:[],documents:Array.isArray(documents)?documents:[]};renderPage()}catch(e){toast(e.message||'تعذر تحميل مستندات وجرد المطبخ','error')}finally{kitchenGovernanceLoading=false}}
function showKitchenAuditCreateModal(){showModal(`<h3><i class=ji data-i=clipboard-list></i> إنشاء جرد ذكي للمطبخ</h3><p class="text-muted">سيتم التقاط رصيد مخزن المطبخ الحالي كرصيد نظامي، ثم تدخل الكميات الفعلية قبل الإرسال للاعتماد.</p><div class="workflow-banner"><i class=ji data-i=info></i> إذا ظهر «لا توجد أرصدة في مخزن المطبخ»، افتح سجل أذونات الصرف واستلم إذنًا معتمدًا ووقّعه من المطبخ أولًا.</div><div class="fg"><label>دورية الجرد</label><select id="kitchenAuditPeriod"><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري</option><option value="custom">فترة مخصصة</option><option value="annual">سنوي</option></select></div><div class="fr"><div class="fg"><label>بداية الفترة</label><input type="date" id="kitchenAuditPeriodStart" value="${today()}"></div><div class="fg"><label>نهاية الفترة</label><input type="date" id="kitchenAuditPeriodEnd" value="${today()}"></div></div><div class="fg"><label>ملاحظات</label><textarea id="kitchenAuditNotes" rows="3" placeholder="وردية، سبب الجرد، أسماء فريق العد..."></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="createKitchenAudit()">إنشاء جلسة الجرد</button></div>`)}
async function createKitchenAudit(){try{showLoad();const audit=await apiFetch('/kitchen/audits',{method:'POST',body:JSON.stringify({period:document.getElementById('kitchenAuditPeriod')?.value,period_start:document.getElementById('kitchenAuditPeriodStart')?.value||today(),period_end:document.getElementById('kitchenAuditPeriodEnd')?.value||today(),notes:document.getElementById('kitchenAuditNotes')?.value||''})});closeModal();await refreshKitchenGovernance();openKitchenAuditCount(audit.id)}catch(e){toast(e.message||'تعذر إنشاء الجرد','error')}finally{hideLoad()}}
function openKitchenAuditCount(id){
 const a=(kitchenGovernance.audits||[]).find(x=>String(x.id)===String(id));if(!a){toast('جلسة الجرد غير موجودة','error');return}
 const items=Array.isArray(a.items)?a.items:[];
 const periodLabel=({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period;
 const start=String(a.period_start||'').slice(0,10),end=String(a.period_end||'').slice(0,10);
 const distributions=(STATE.kitchenOps?.distributions||[]).filter(x=>{const day=String(x.created_at||'').slice(0,10);return (!start||day>=start)&&(!end||day<=end);});
 const distributionMarkup=`<div class="workflow-banner u-mt12"><strong><i class=ji data-i=split></i> حركة الإنتاج والتوزيع خلال الفترة</strong><div class="tbl-scroll u-mt8"><table><thead><tr><th>المنتج</th><th>الجهة</th><th>الكمية</th></tr></thead><tbody>${distributions.map(x=>`<tr><td>${esc(x.product_name||'—')}</td><td>${esc(x.destination_name||x.destination_code||'—')}</td><td class="c-gold fw-bold">${fN(x.allocated_qty)}</td></tr>`).join('')||'<tr><td colspan="3">لا توجد حركة إنتاج موزعة في هذه الفترة</td></tr>'}</tbody></table></div></div>`;
 showModal(`<h3><i class=ji data-i=calculator></i> جرد ${periodLabel} — ${esc(a.audit_number)}</h3><div class="audit-mobile-note">الفترة: ${esc(String(a.period_start||'—'))} إلى ${esc(String(a.period_end||'—'))}. أدخل الكمية الفعلية لكل صنف.</div>${distributionMarkup}<div class="tbl-scroll tbl-sticky-first"><table class="kitchen-audit-table"><thead><tr><th>الصنف</th><th>الرصيد النظامي</th><th>الفعلي</th><th>الفرق</th></tr></thead><tbody>${items.map(x=>`<tr><td class="fw-bold">${esc(x.item_name||'—')}<small class="text-muted"> ${esc(x.unit||'')}</small></td><td>${fN(x.system_qty)}</td><td><input class="kitchen-count-input" data-item-id="${x.id}" type="number" min="0" step="0.001" value="${Number(x.counted_qty||0)}"></td><td class="audit-variance c-gold">${(Number(x.counted_qty||0)-Number(x.system_qty||0)).toFixed(3)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد أرصدة في مخزن المطبخ</td></tr>'}</tbody></table></div>${a.status==='draft'?signaturePadMarkup('kitchenAuditSubmitSignature','توقيع مسؤول العد والإرسال'):''}<div class="modal-footer"><button class="btn" onclick="closeModal()">إغلاق</button>${a.status==='draft'?`<button class="btn btn-blue" onclick="saveKitchenAuditCount('${a.id}')">حفظ العد</button><button class="btn btn-gold" onclick="submitKitchenAudit('${a.id}')">إرسال بتوقيع</button>`:''}</div>`);if(a.status==='draft'){afterModalSignatureInit('kitchenAuditSubmitSignature');}
}
async function saveKitchenAuditCount(id){const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));try{showLoad();await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});await refreshKitchenGovernance();closeModal();toast('تم حفظ كميات الجرد','success')}catch(e){toast(e.message||'تعذر حفظ العد','error')}finally{hideLoad()}}
async function submitKitchenAudit(id){try{showLoad();const items=[...document.querySelectorAll('.kitchen-count-input')].map(x=>({id:Number(x.dataset.itemId),counted_qty:Number(x.value||0)}));await apiFetch(`/kitchen/audits/${id}/count`,{method:'POST',body:JSON.stringify({items})});const signatureData=readSignaturePad('kitchenAuditSubmitSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditSubmitSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/submit`,{method:'POST',body:JSON.stringify({signatureData,signerName})});closeModal();await refreshKitchenGovernance();toast('تم إرسال الجرد للاعتماد','success')}catch(e){toast(e.message||'تعذر إرسال الجرد','error')}finally{hideLoad()}}
async function approveKitchenAudit(id){if(!confirm('سيتم تسجيل فروقات الجرد في دفتر المخزون. هل تريد الاعتماد؟')){return;}showModal(`<h3><i class=ji data-i=pen-tool></i> اعتماد جرد المطبخ</h3><div class="workflow-banner">سيتم تطبيق الفروقات في دفتر المخزون ولا يمكن اعتماد الجرد مرة أخرى.</div>${signaturePadMarkup('kitchenAuditApprovalSignature','توقيع مسؤول اعتماد الجرد')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmKitchenAuditApproval('${id}')">اعتماد وتوقيع</button></div>`);afterModalSignatureInit('kitchenAuditApprovalSignature');}
async function confirmKitchenAuditApproval(id){try{showLoad();const signatureData=readSignaturePad('kitchenAuditApprovalSignature');if(!signatureData){return;}const signerName=readSignerName('kitchenAuditApprovalSignature');if(!signerName){return;}await apiFetch(`/kitchen/audits/${id}/approve`,{method:'POST',body:JSON.stringify({signatureData,signerName})});await refreshKitchenGovernance();closeModal();toast('تم اعتماد الجرد وترحيل الفروقات','success')}catch(e){toast(e.message||'تعذر اعتماد الجرد','error')}finally{hideLoad()}}
function renderKitchenGovernance(){const audits=kitchenGovernance.audits||[],docs=kitchenGovernance.documents||[];const canApprove=['admin','manager','auditor'].includes(STATE.currentUser?.role);return `<div class="kitchen-governance-grid"><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> الجرد الذكي</h3><button class="btn btn-gold btn-sm" onclick="showKitchenAuditCreateModal()"><i class=ji data-i=plus></i> جرد جديد</button></div><div class="tbl-scroll"><table><thead><tr><th>الرقم</th><th>الدورية والفترة</th><th>الأصناف</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${audits.map(a=>`<tr><td class="fw-bold">${esc(a.audit_number)}</td><td>${({daily:'يومي',weekly:'أسبوعي',monthly:'شهري',custom:'مخصص',annual:'سنوي'})[a.period]||a.period}<small class="text-muted">${a.period_start?`<br>${esc(String(a.period_start))} → ${esc(String(a.period_end||a.period_start))}`:''}</small></td><td>${fN(a.total_items)}</td><td><span class="badge ${a.status==='approved'?'bdg-green':a.status==='submitted'?'bdg-orange':'bdg-blue'}">${a.status==='approved'?'معتمد':a.status==='submitted'?'بانتظار الاعتماد':'مسودة'}</span></td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="openKitchenAuditCount('${a.id}')">عرض/عد</button>${canApprove&&a.status==='submitted'?`<button class="btn btn-green btn-sm" onclick="approveKitchenAudit('${a.id}')">اعتماد</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد جلسات جرد بعد</td></tr>'}</tbody></table></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=package></i> مستندات حركة المطبخ</h3><span class="badge bdg-blue">${fN(docs.length)} مستند</span></div><div class="tbl-scroll"><table><thead><tr><th>المستند</th><th>من</th><th>إلى</th><th>التاريخ</th><th>الأصناف</th></tr></thead><tbody>${docs.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td>${esc(d.source_name||'—')}</td><td>${esc(d.destination_name||'—')}</td><td>${fD(d.created_at)}</td><td>${Array.isArray(d.items)?d.items.map(i=>`${esc(i.item_name||'—')} (${fN(i.received_qty||i.requested_qty)})`).join('، '):'—'}</td></tr>`).join('')||'<tr><td colspan="5" class="text-center">لا توجد تحويلات مسجلة للمطبخ</td></tr>'}</tbody></table></div></div></div>`}

let kitchenTransferStock={source:null,destination:null,items:[]};
let kitchenTransferRows=[];
async function showKitchenStockReceiveModal(){
 try{
  const stock=await apiFetch('/kitchen/stock');
  kitchenTransferStock=stock||{source:null,destination:null,items:[]};
 }catch(e){toast(e.message||'تعذر قراءة أرصدة المخزن الرئيسي','error');return;}
 if(!kitchenTransferStock.source||!kitchenTransferStock.destination){toast('موقع المخزن الرئيسي أو مخزن المطبخ غير مهيأ','error');return;}
 kitchenTransferRows=[{inventory_id:'',qty:''}];
 showModal(`<h3><i class=ji data-i=package></i> استلام مواد في مخزن المطبخ</h3><div class="workflow-banner">هذا المسار الإداري مخصص للتحويلات الاستثنائية فقط. المواد المعتادة للمطبخ تدخل من خلال إذن الصرف المعتمد واستلامه بالتوقيع.</div><div class="text-muted" style="margin-bottom:12px">من: <strong>${esc(kitchenTransferStock.source.name_ar||'المخزن الرئيسي')}</strong> ← إلى: <strong>${esc(kitchenTransferStock.destination.name_ar||'مخزن المطبخ')}</strong></div><div id="kitchenTransferRows"></div><button type="button" class="btn btn-blue btn-sm" onclick="addKitchenTransferRow()"><i class=ji data-i=plus></i> إضافة صنف</button><div class="fg u-mt16"><label>ملاحظات التحويل</label><textarea id="kitchenTransferNotes" rows="2" placeholder="مثال: تجهيز وردية الغداء"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenStockReceive()"><i class=ji data-i=inbox></i> استلام المواد</button></div>`);
 renderKitchenTransferRows();
}
function addKitchenTransferRow(){kitchenTransferRows.push({inventory_id:'',qty:''});renderKitchenTransferRows();}
function removeKitchenTransferRow(index){if(kitchenTransferRows.length<=1){kitchenTransferRows[0]={inventory_id:'',qty:''};}else{kitchenTransferRows.splice(index,1);}renderKitchenTransferRows();}
function renderKitchenTransferRows(){
 const container=document.getElementById('kitchenTransferRows');if(!container){return;}
 const options=(kitchenTransferStock.items||[]).map(item=>`<option value="${item.inventory_id}" data-max="${item.available}">${esc(item.name)} — متاح ${fN(item.available)} ${esc(item.unit||'وحدة')}</option>`).join('');
 container.innerHTML=kitchenTransferRows.map((row,index)=>`<div class="kitchen-transfer-row" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px"><div style="flex:2;min-width:220px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الصنف</small><select class="u-input kitchen-transfer-item" onchange="updateKitchenTransferRow(${index},'inventory_id',this.value);syncKitchenTransferMax(this)"><option value="">اختر صنفًا من المخزن الرئيسي</option>${options}</select></div><div style="flex:1;min-width:120px"><small style="display:block;margin-bottom:4px;color:var(--text3)">الكمية</small><input class="u-input kitchen-transfer-qty" type="number" min="0.001" step="0.001" value="${row.qty||''}" placeholder="الكمية" onchange="updateKitchenTransferRow(${index},'qty',this.value)"></div><button type="button" class="btn btn-red btn-sm" onclick="removeKitchenTransferRow(${index})" title="حذف"><i class=ji data-i=x></i></button></div>`).join('');
 kitchenTransferRows.forEach((row,index)=>{const select=container.querySelectorAll('.kitchen-transfer-item')[index];if(select){select.value=String(row.inventory_id||'');}const qty=container.querySelectorAll('.kitchen-transfer-qty')[index];if(qty){qty.value=row.qty||'';}});
}
function updateKitchenTransferRow(index,field,value){if(!kitchenTransferRows[index]){return;}kitchenTransferRows[index][field]=field==='qty'?(Number(value)||0):String(value||'');}
function syncKitchenTransferMax(select){const row=select?.closest('.kitchen-transfer-row');const max=Number(select?.options?.[select.selectedIndex]?.dataset?.max||0);const input=row?.querySelector('.kitchen-transfer-qty');if(input){input.max=max||'';if(Number(input.value)>max){input.value=max;}}}
async function submitKitchenStockReceive(){
 const items=kitchenTransferRows.map(row=>({inventory_id:Number(row.inventory_id),qty:Number(row.qty)})).filter(row=>Number.isInteger(row.inventory_id)&&row.inventory_id>0&&row.qty>0);
 if(!items.length){toast('اختر صنفًا وأدخل كمية صحيحة','warning');return;}
 try{showLoad();const result=await apiFetch('/kitchen/transfers/receive',{method:'POST',body:JSON.stringify({source_location_id:kitchenTransferStock.source.id,destination_location_id:kitchenTransferStock.destination.id,reference:`KITCHEN-${uid()}`,notes:document.getElementById('kitchenTransferNotes')?.value.trim()||'',items})});closeModal();await refreshKitchenOverview();await refreshKitchenGovernance();toast(`تم استلام ${fN(result.items?.length||items.length)} صنف في مخزن المطبخ`,'success');}catch(e){toast(e.message||'تعذر استلام مواد المطبخ؛ تحقق من رصيد المخزن الرئيسي','error')}finally{hideLoad();}
}
function renderKitchenDispatchRegister(){
    const rows=(STATE.dispatches||[]).filter(d=>{
        const code=String(d.deptCode||d.departmentCode||'').toLowerCase();
        const name=String(d.deptName||d.departmentName||'').toLowerCase();
        return code==='kitchen'||code==='مطبخ'||name.includes('مطبخ')||name.includes('kitchen');
    }).slice().reverse();
    const statusLabel={pending:'بانتظار اعتماد المخزن',approved:'معتمد — بانتظار استلام المطبخ',partially_received:'مستلم جزئيًا',received:'مستلم ومغلق',rejected:'مرفوض من الإدارة'};
    const statusClass={pending:'bdg-orange',approved:'bdg-green',partially_received:'bdg-blue',received:'bdg-green',rejected:'bdg-red'};
    return `<div class="tbl-wrap kitchen-dispatch-register"><div class="tbl-hd"><div><h3><i class=ji data-i=clipboard-list></i> أذونات الصرف الواردة للمطبخ</h3><small class="text-muted">بعد اعتماد المخزن: راجع الكميات، ثم سجّل الاستلام بتوقيع مسؤول المطبخ.</small></div><span class="badge bdg-blue">${fN(rows.length)} إذن</span></div><div class="tbl-scroll"><table><thead><tr><th>الإذن</th><th>الأصناف والكميات</th><th>التاريخ</th><th>الحالة</th><th>إجراء المطبخ</th></tr></thead><tbody>${rows.map(d=>`<tr><td class="fw-bold">#${esc(String(d.id))}</td><td>${(d.items||[]).map(i=>{const cw=i.catchWeightEnabled||i.actualWeight;return `${esc(i.itemName||i.name||'—')} (${fN(i.approvedQty??i.qty)}${cw&&i.packagingQty?` ${esc(i.catchWeightUom||'كجم')} / ${fN(i.packagingQty)} ${esc(i.packagingUom||'كرتون')}`:''})`;}).join('، ')||'—'}</td><td>${fD(d.date)}</td><td><span class="badge ${statusClass[d.status]||'bdg-orange'}">${statusLabel[d.status]||esc(d.status||'غير محدد')}</span>${d.kitchenReceivedBy?`<small class="text-muted" style="display:block;margin-top:4px"><i class=ji data-i=signature></i> ${esc(d.kitchenReceivedBy)}</small>`:''}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="viewDispatchDetails('${esc(String(d.id))}')"><i class=ji data-i=eye></i> عرض</button>${d.status==='approved'&&['admin','manager','kitchen'].includes(STATE.currentUser?.role)?`<button class="btn btn-gold btn-sm" onclick="openReceiveModal('${esc(String(d.id))}')"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}${['approved','partially_received','received'].includes(d.status)?`<button class="btn btn-sm" onclick="printDispatchNote('${esc(String(d.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد أذونات صرف مسجلة للمطبخ بعد</td></tr>'}</tbody></table></div></div>`;
}
function renderKitchenDistributionRegister(){
 const rows=(STATE.kitchenOps?.distributions||[]).slice();
 const totals={};rows.forEach(r=>{const key=r.destination_name||r.destination_code||'—';totals[key]=(totals[key]||0)+Number(r.allocated_qty||0);});
 const totalCards=Object.entries(totals).map(([name,qty])=>`<span class="badge bdg-blue" style="margin-inline-end:6px">${esc(name)}: ${fN(qty)}</span>`).join('');
 return `<div class="tbl-wrap"><div class="tbl-hd"><div><h3><i class=ji data-i=split></i> توزيع الإنتاج حسب الجهة</h3><small class="text-muted">يوضح أين ذهب كل منتج بعد استهلاكه من مخزن المطبخ.</small></div><div>${totalCards||'<span class="text-muted">لا توجد توزيعات</span>'}</div></div><div class="tbl-scroll"><table><thead><tr><th>المنتج</th><th>الجهة</th><th>النوع</th><th>الكمية</th><th>التاريخ</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="fw-bold">${esc(r.product_name||'—')}</td><td>${esc(r.destination_name||r.destination_code||'—')}</td><td>${r.destination_type==='department'?'قسم':r.destination_type==='channel'?'قناة':'مخصصة'}</td><td class="c-gold fw-bold">${fN(r.allocated_qty)}</td><td>${fD(r.created_at)}</td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد توزيعات إنتاج بعد</td></tr>'}</tbody></table></div></div>`;
}
function renderKitchen(){
 if(!checkMenuAccessLocal('kitchen')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
 const ops=STATE.kitchenOps||{locations:[],batches:[],exceptions:[],policies:[]};
 const policy=ops.policies?.[0]; const modeLabel={flexible:'مرن',monitor:'مراقب',strict:'صارم'}[policy?.operation_mode||'monitor'];
 const pending=STATE.dispatches.filter(d=>d.status==='pending');
 if(!STATE.kitchenOps&&!kitchenOverviewLoading) {setTimeout(refreshKitchenOverview,0);} if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); } if(!kitchenGovernance.audits&&!kitchenGovernanceLoading) {setTimeout(refreshKitchenGovernance,0);}
   return `<div class="kitchen-page"><div class="kitchen-page-head"><div><div class="eyebrow">KITCHEN PRODUCTION CONTROL</div><h3><i class=ji data-i=chef-hat></i> ${t('kit.title')}</h3><p>${t('kit.sub')}</p></div><div class="kitchen-actions"><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=package></i> ${t('kit.req')}</button><button class="btn btn-blue" onclick="showKitchenProductionModal()"><i class=ji data-i=cooking-pot></i> ${t('kit.prod')}</button><button class="btn" onclick="refreshKitchenOverview()"><i class=ji data-i=refresh></i> ${t('act.refresh')}</button></div></div><div class="metrics-grid kitchen-kpis"><div class="mcard"><div class="mcard-label">${t('kit.policy')}</div><div class="mcard-val c-gold" style="font-size:20px">${modeLabel}</div><small class="text-muted">${t('kit.flexNote')}</small></div><div class="mcard"><div class="mcard-label">${t('kit.openProd')}</div><div class="mcard-val c-blue">${fN((ops.batches||[]).filter(b=>['draft','open'].includes(b.status)).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.exceptions')}</div><div class="mcard-val c-orange">${fN((ops.exceptions||[]).length)}</div></div><div class="mcard"><div class="mcard-label">${t('kit.pendingReq')}</div><div class="mcard-val c-purple">${fN(pending.length)}</div></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=cooking-pot></i> أوامر الإنتاج</h3></div><div class="tbl-scroll tbl-sticky-first"><table><thead><tr><th>الوصفة</th><th>الموقع</th><th>المخطط</th><th>المنتج</th><th>المتبقي</th><th>الحالة</th></tr></thead><tbody>${(ops.batches||[]).map(b=>`<tr><td class="fw-bold">${esc(b.product_name||'—')}</td><td>${esc(b.location_name||'—')}</td><td>${fN(b.planned_qty)}</td><td class="c-green">${fN(b.produced_qty)}</td><td class="c-gold">${fN(b.remaining_qty)}</td><td><span class="badge ${b.status==='closed'?'bdg-blue':b.status==='cancelled'?'bdg-red':'bdg-green'}">${b.status==='closed'?'مغلق — موزع':b.status==='cancelled'?'ملغى':'مفتوح'}</span></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد أوامر إنتاج بعد</td></tr>'}</tbody></table></div></div>${renderKitchenDistributionRegister()}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> استثناءات البيع أو الإنتاج</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الكمية</th><th>السياسة</th><th>السبب</th><th>الحالة</th></tr></thead><tbody>${(ops.exceptions||[]).map(e=>`<tr><td>${esc(e.product_name||'—')}</td><td>${fN(e.quantity)}</td><td>${esc(e.operation_mode)}</td><td>${esc(e.reason)}</td><td><span class="badge bdg-orange">تحتاج مراجعة</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty-sm">لا توجد استثناءات مفتوحة</td></tr>'}</tbody></table></div></div>${renderKitchenDispatchRegister()}${renderKitchenReturnsSection()}${renderPRSection()}${renderKitchenGovernance()}</div>`;
}
// ═══ Task 19: أدوات سلسلة اعتماد طلبات الصرف (رئيس القسم → الشيف العمومي → المخازن) ═══
function myDeptCode(){ return STATE.currentUser?.dept_code || null; }
function isDeptHead(){ return STATE.currentUser?.role==='dept_head'; }
function deptNameByCode(code){ const d=(STATE.departments||[]).find(x=>String(x.code)===String(code)); return d?d.name:(code||'—'); }
function dispatchChainStage(d){
// المرحلة الحالية من السلسلة لعرضها في الواجهة
if(d.status==='pending') {return d.needsChefApproval?t('stg.chefWait'):t('stg.whWait');}
if(d.status==='chef_approved') {return t('stg.chefDone');}
if(d.status==='approved') {return t('stg.dispensed');}
if(d.status==='partially_received') {return t('stg.partial');}
if(d.status==='received') {return t('stg.received');}
if(d.status==='rejected') {return t('stg.rejected');}
return '—';
}
function renderDeptHeadDashboard(){
const my=myDeptCode();
// Task 28: لوحة القسم الحية — تُجلب مرة واحدة وتُعرض فوق الملخص المحلي فور وصولها
if(STATE.currentUser?.role==='dept_head' && !STATE.deptPanel) {loadDeptPanel();}
const panel=STATE.deptPanel;
const mine=STATE.dispatches.filter(d=>String(d.deptCode)===String(my));
const pending=mine.filter(d=>d.status==='pending').length;
const chefOk=mine.filter(d=>d.status==='chef_approved').length;
const awaitingReceive=mine.filter(d=>['approved','partially_received'].includes(d.status)).length;
const received=mine.filter(d=>['received','partially_received'].includes(d.status)).length;
const myCost=deptExpenseBreakdown(my).total;
const myDeptName=deptNameByCode(my)||'قسمك';
// Task 28: بطاقات مصادر الكلفة من الخادم الحي (صرف مخزني / عكس صرف / فروق جرد / يدوي)
let panelHtml='';
if(panel && panel.scope && String(panel.scope.deptCode||'')===String(my||'')){
const src=panel.expenses?.bySource||{};
const labels=panel.expenses?.labels||{};
const card=(key,icon,colorCls)=>{const row=src[key];const total=row?row.total:0;const cnt=row?row.count:0;return `<div class="metric-card-premium"><div class="kpi-top"><span class="kpi-label">${esc(labels[key]||key)}</span><span class="kpi-chip"><i class=ji data-i=${icon}></i></span></div><div class="value ${total<0?'c-red':''}">${fC(total)}</div><div class="trend"><i class=ji data-i=chart></i> ${cnt} حركة</div></div>`;};
const sourcesHtml=['dispatch','dispatch_return','stocktaking','manual'].map(k=>card(k, k==='dispatch'?'package':k==='dispatch_return'?'undo':k==='stocktaking'?'clipboard-list':'wallet')).join('');
const subDepts=Array.isArray(panel.subDepartments)?panel.subDepartments:[];
panelHtml=`
<div class="u-row-between" style="margin-top:22px"><h3 class="u-gold-strong"><i class=ji data-i=chart></i> كلفة ${esc(panel.department?.name||myDeptName)} حسب المصدر</h3><span class="badge bdg-blue"><i class=ji data-i=activity></i> مباشر من الخادم</span></div>
<div class="stats-grid-premium kpi-grid-4">${sourcesHtml}</div>
${subDepts.length?`<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=building></i> الأقسام التابعة</h3></div><div class="tbl-scroll"><table><thead><tr><th>القسم</th><th>الكود</th></tr></thead><tbody>${subDepts.map(s=>`<tr><td>${esc(s.name)}</td><td class="mono">${esc(s.code)}</td></tr>`).join('')}</tbody></table></div></div>`:''}
<div class="text-muted" style="margin-top:8px;font-size:12px">إجمالي كلفة النطاق: <strong class="c-gold">${fC(panel.expenses?.total||0)}</strong> — محدث عند ${esc(String(panel.generatedAt||'').slice(11,19)||'—')}</div>`;
}
return `
<div class="workflow-banner" style="margin-bottom:18px"><i class=ji data-i=chef-hat></i> لوحة رئيس القسم: <strong>${esc(myDeptName)}</strong> — تنشئ طلب الصرف، يعتمده <strong>الشيف العمومي</strong>، ثم تصرفه <strong>المخازن</strong>، ويستلمه قسمك من مخزنه الخاص.</div>
<div class="stats-grid-premium kpi-grid-4">
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">طلباتي بانتظار الشيف</span><span class="kpi-chip"><i class=ji data-i=hourglass></i></span></div><div class="value">${pending}</div><div class="trend"><i class=ji data-i=clipboard-list></i> من إجمالي ${mine.length} طلب</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">معتمدة بانتظار المخازن</span><span class="kpi-chip"><i class=ji data-i=circle-check></i></span></div><div class="value">${chefOk}</div><div class="trend"><i class=ji data-i=package></i> جاهزة للصرف</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">بانتظار استلام قسمي</span><span class="kpi-chip"><i class=ji data-i=inbox></i></span></div><div class="value">${awaitingReceive}</div><div class="trend"><i class=ji data-i=archive></i> تُستلم في مخزن القسم</div></div>
  <div class="metric-card-premium" onclick="go('dispatch')"><div class="kpi-top"><span class="kpi-label">كلفة قسمي (الإجمالي)</span><span class="kpi-chip"><i class=ji data-i=banknote></i></span></div><div class="value">${fC(myCost)}</div><div class="trend"><i class=ji data-i=chart></i> مستلمة: ${received} طلب</div></div>
</div>
${panelHtml}
<div class="u-row-between" style="margin-top:22px"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> آخر طلبات ${esc(myDeptName)}</h3><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=plus></i> طلب صرف جديد</button></div>
<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الأصناف</th><th>التاريخ</th><th>المرحلة</th><th>الحالة</th></tr></thead><tbody>${mine.slice(-8).reverse().map(d=>`<tr><td>${esc(String(d.id)).slice(-6)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join('، ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td></tr>`).join('')||'<tr><td colspan="5" class="u-empty">لا توجد طلبات بعد — أنشئ طلبك الأول</td></tr>'}</tbody></table></div></div>`;
}
// Task 28: جلب لوحة القسم الحية — صامتة عند الفشل (اللوحة تعمل بالبيانات المحلية)
async function loadDeptPanel(){
try{
STATE.deptPanel = await apiFetch('/warehouse/dept-panel');
if(STATE.page==='dashboard') {renderPage();}
}catch(e){ console.warn('dept-panel:', e.message); }
}
function renderDispatch(){
if(!checkMenuAccessLocal('dispatch')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(prCanSee()&&!STATE._prLoaded&&!STATE._prLoading){ STATE._prLoading=true; setTimeout(()=>refreshPurchaseRequests().finally(()=>{ STATE._prLoading=false; }),0); }
const role=STATE.currentUser?.role; const my=myDeptCode();
// رئيس القسم يرى طلبات قسمه فقط — باقي الأدوار ترى الكل
const dispatches = [...STATE.dispatches].reverse().filter(d=>isDeptHead()?String(d.deptCode)===String(my):true);
const chefQueue=dispatches.filter(d=>d.status==='pending'&&d.needsChefApproval).length;
const warehouseQueue=dispatches.filter(d=>d.status==='chef_approved'||(d.status==='pending'&&!d.needsChefApproval)).length;
const chainBanner=!isDeptHead()?`<div class="workflow-banner" style="margin-bottom:14px"><i class=ji data-i=clipboard-list></i> سلسلة الاعتماد: <strong>رئيس القسم</strong> ينشئ الطلب ← <strong>الشيف العمومي</strong> يعتمده ← <strong>المخازن</strong> تصرف وتخصم ← القسم يستلم من مخزنه الخاص.</div>`:'';
const canDecideChef=['admin','manager','kitchen'].includes(role);
const canDecideWarehouse=['admin','manager','warehouse'].includes(role);
const canReceive=['admin','manager','kitchen'].includes(role);
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=clipboard-list></i> ${t('pg.dispatch')}${isDeptHead()?` — ${esc(deptNameByCode(my))}`:''}</h3><button class="btn btn-gold" onclick="showDispatchRequestModal()"><i class=ji data-i=package></i> ${t('dsp.new')}</button></div>${chainBanner}${canDecideChef||canDecideWarehouse?`<div class="fr u-mb12"><span class="badge bdg-orange"><i class=ji data-i=chef-hat></i> ${t('dsp.chefWait')}: ${chefQueue}</span><span class="badge bdg-blue"><i class=ji data-i=package></i> ${t('dsp.whWait')}: ${warehouseQueue}</span></div>`:''}<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> ${isDeptHead()?t('dsp.mine'):t('dsp.all')}</h3></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('dsp.dept')}</th><th>${t('dsp.items')}</th><th>${t('dsp.date')}</th><th>${t('dsp.stage')}</th><th>${t('dsp.status')}</th><th>${t('dsp.by')}</th><th>${t('dsp.actions')}</th></tr></thead><tbody>${dispatches.map((d,idx)=>{const canWarehouse=d.status==='pending'&&!d.needsChefApproval||d.status==='chef_approved';return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(d.deptName)}</td><td>${(d.items||[]).map(i=>`${esc(i.itemName)} (${fN(i.qty)})`).join(', ')}</td><td>${fD(d.date)}</td><td>${esc(dispatchChainStage(d))}</td><td><span class="badge ${dispatchStatusClass(d.status)}">${dispatchStatusLabel(d.status)}</span></td><td>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</td><td style="display:flex;gap:6px;flex-wrap:wrap">${d.status==='pending'&&d.needsChefApproval&&canDecideChef?`<button class="btn btn-green btn-sm" onclick="openChefApproveModal('${esc(String(d.id))}')"><i class=ji data-i=chef-hat></i> اعتماد الشيف</button><button type="button" class="btn btn-red btn-sm" onclick="openChefRejectModal('${esc(String(d.id))}')"><i class=ji data-i=circle-x></i> رفض الشيف</button>`:''}${canWarehouse&&canDecideWarehouse&&!['rejected'].includes(d.status)?`<button class="btn btn-green btn-sm" onclick="openApproveModal('${esc(String(d.id))}')"><i class=ji data-i=circle-check></i> اعتماد المخازن</button><button type="button" class="btn btn-red btn-sm" onclick="openRejectModal('${esc(String(d.id))}')"><i class=ji data-i=circle-x></i> رفض وتوقيع</button>`:''}${d.status==='pending'&&canDecideWarehouse?`<button type="button" class="btn btn-sm" onclick="deleteDispatch('${esc(String(d.id))}')" title="حذف طلب معلّق لم يُعتمد بعد"><i class=ji data-i=trash></i> حذف</button>`:''}${d.status==='approved'&&(canReceive||(isDeptHead()&&String(d.deptCode)===String(my)))?`<button type="button" class="btn btn-gold btn-sm" onclick="openReceiveModal('${esc(String(d.id))}')"><i class=ji data-i=inbox></i> استلام وتوقيع</button>`:''}<button type="button" class="btn btn-blue btn-sm" onclick="viewDispatchDetails('${esc(String(d.id))}')"><i class=ji data-i=eye></i> عرض</button>${['approved','partially_received','received'].includes(d.status)?`<button type="button" class="btn btn-sm" onclick="printDispatchNote('${esc(String(d.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="8" class="u-empty">لا توجد طلبات</td></tr>'}</tbody></table></div></div>${renderKitchenReturnsSection()}${renderPRSection()}`;
}
// ═══ طلبات شراء النواقص: أمين المخزن ينشئ (تلقائي + يدوي) → الشيف يوقّع → المدير العام يعتمد نهائيًا ═══
// طلب فقط بلا حركة مخزون — كل توقيع مقفل على اسم صاحب الحساب (signerName) ويُتحقق منه في الخادم.
function prCanSee(){ return ['admin','manager','warehouse','kitchen','accountant'].includes(STATE.currentUser?.role); }
function prCanCreate(){ return ['admin','manager','warehouse','kitchen','dept_head'].includes(STATE.currentUser?.role); }
function prCanReceive(){ return ['admin','manager','warehouse'].includes(STATE.currentUser?.role); }
function prCanChef(){ return ['admin','manager','kitchen'].includes(STATE.currentUser?.role); }
function prCanGM(){ return ['admin','manager'].includes(STATE.currentUser?.role); }
function prCanCancel(){ return ['admin','manager','warehouse','kitchen'].includes(STATE.currentUser?.role); }
function prCanDelete(){ return ['admin','manager'].includes(STATE.currentUser?.role); }
async function deletePR(id){
if(!prCanDelete()){ toast('حذف طلبات الشراء للإدارة فقط','error'); return; }
if(!confirm('حذف نهائي لهذا الطلب؟ لا يمكن التراجع.')) {return;}
try{ showLoad();
await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}`,{method:'DELETE'});
STATE.purchaseRequests=(STATE.purchaseRequests||[]).filter(x=>String(x.id)!==String(id));
closeModal(); renderPage(); toast('حُذف الطلب نهائيًا','info');
}catch(e){ toast(e.message||'تعذر حذف الطلب','error'); }
finally{ hideLoad(); }
}
async function deleteDispatch(id){
if(!['admin','manager','warehouse'].includes(STATE.currentUser?.role)){ toast('حذف أذونات الصرف للمخازن والإدارة فقط','error'); return; }
if(!confirm('حذف طلب الصرف المعلق نهائيًا؟ (المعتمد/المستلم لا يُحذف — يُعالج بالإرجاع)')) {return;}
try{ showLoad();
await apiRemove('dispatches', id);
STATE.dispatches=(STATE.dispatches||[]).filter(x=>String(x.id)!==String(id));
closeModal(); renderPage(); toast('حُذف طلب الصرف المعلق','info');
}catch(e){ toast(e.message||'تعذر حذف طلب الصرف','error'); }
finally{ hideLoad(); }
}
function prStatusLabel(s){ return ({pending:'بانتظار الشيف',chef_approved:'اعتمدها الشيف — بانتظار المدير العام',approved:'معتمدة نهائيًا ؟ بانتظار المخزن',fulfilled:'مستلم ومغلق',rejected:'مرفوضة',cancelled:'ملغاة'})[s]||s||'—'; }
function prStatusClass(s){ return s==='approved'?'bdg-green':s==='fulfilled'?'bdg-teal':s==='chef_approved'?'bdg-blue':s==='pending'?'bdg-orange':s==='rejected'?'bdg-red':'bdg-purple'; }
async function refreshPurchaseRequests(){
try{ STATE.purchaseRequests=await apiFetch('/warehouse/purchase-requests'); STATE._prLoaded=true; }
catch(e){ console.warn('[pr] refresh failed:', e.message); }
if(['warehouse','dispatch'].includes(STATE.page)) {renderPage();}
}
function renderPRSection(){
if(!prCanSee()) {return '';}
const rows=(STATE.purchaseRequests||[]).slice().reverse();
const pendChef=rows.filter(r=>r.status==='pending').length;
const pendGM=rows.filter(r=>r.status==='chef_approved').length;
return `<div class="tbl-wrap" style="margin-top:18px"><div class="tbl-hd"><div><h3><i class=ji data-i=shopping-cart></i> طلبات شراء النواقص</h3><small class="text-muted">المطبخ/المخزن ينشئ ← الشيف يوقّع ← المدير العام يعتمد ← المخزن يستلم ويُدخل البضاعة.</small></div><div class="u-row-wrap">${prCanCreate()?`<button class="btn btn-gold btn-sm" onclick="openPRCreateModal()"><i class=ji data-i=plus></i> طلب شراء جديد</button>`:''}<button class="btn btn-blue btn-sm" onclick="refreshPurchaseRequests()"><i class=ji data-i=refresh></i> تحديث</button><span class="badge bdg-orange">بانتظار الشيف: ${fN(pendChef)}</span><span class="badge bdg-blue">بانتظار المدير: ${fN(pendGM)}</span></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>الرقم</th><th>الأصناف</th><th>الحالة</th><th>المنشئ</th><th>توقيع الشيف</th><th>اعتماد المدير</th><th>استلام المخزن</th><th>إجراءات</th></tr></thead><tbody>${rows.map((r,idx)=>{const items=Array.isArray(r.items)?r.items:[];return `<tr><td>${idx+1}</td><td class="fw-bold">${esc(r.request_number||('#'+r.id))}</td><td>${items.map(i=>`${esc(i.itemName||i.name||'—')} (${fN(i.requestedQty??i.qty)})`).join('، ')||'—'}</td><td><span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></td><td>${esc(r.creator_name||'—')}</td><td>${r.chef_approved_name?`<span class="badge bdg-blue">${esc(r.chef_approved_name)}</span>`:'—'}</td><td>${r.gm_approved_name?`<span class="badge bdg-green">${esc(r.gm_approved_name)}</span>`:'—'}</td><td>${r.wh_received_name?`<span class="badge bdg-teal">${esc(r.wh_received_name)}</span>`:'—'}</td><td style="display:flex;gap:5px;flex-wrap:wrap"><button class="btn btn-blue btn-sm" onclick="viewPRDetails('${esc(String(r.id))}')"><i class=ji data-i=eye></i> عرض</button>${r.status==='pending'&&prCanChef()?`<button class="btn btn-green btn-sm" onclick="openPRChefApproveModal('${esc(String(r.id))}')"><i class=ji data-i=chef-hat></i> توقيع الشيف</button><button class="btn btn-red btn-sm" onclick="openPRChefRejectModal('${esc(String(r.id))}')"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='chef_approved'&&prCanGM()?`<button class="btn btn-gold btn-sm" onclick="openPRGMApproveModal('${esc(String(r.id))}')"><i class=ji data-i=circle-check></i> اعتماد المدير العام</button><button class="btn btn-red btn-sm" onclick="openPRGMRejectModal('${esc(String(r.id))}')"><i class=ji data-i=circle-x></i> رفض</button>`:''}${r.status==='approved'&&prCanReceive()?`<button class="btn btn-teal btn-sm" onclick="openPRReceiveModal('${esc(String(r.id))}')"><i class=ji data-i=inbox></i> استلام المخزن</button>`:''}${r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel()?`<button class="btn btn-red btn-sm" onclick="cancelPR('${esc(String(r.id))}')"><i class=ji data-i=x-circle></i> إلغاء</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red btn-sm" onclick="deletePR('${esc(String(r.id))}')"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}${['approved','chef_approved','pending','fulfilled'].includes(r.status)?`<button class="btn btn-sm" onclick="printPR('${esc(String(r.id))}')"><i class=ji data-i=printer></i> طباعة</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="9" class="u-empty-sm">لا توجد طلبات شراء بعد — أنشئ طلبًا من نواقص المخزن</td></tr>'}</tbody></table></div></div>`;
}
async function openPRCreateModal(){
if(!prCanCreate()){ toast('إنشاء طلبات الشراء للمطبخ والمخازن والإدارة','error'); return; }
try{
showLoad();
const shortages=await apiFetch('/warehouse/purchase-requests/shortages');
const invNames=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">`).join('');
const rowsHtml=(shortages||[]).map((s,idx)=>`<tr><td><input type="checkbox" class="pr-sel" data-idx="${idx}" checked></td><td class="fw-bold">${esc(s.itemName)}</td><td>${esc(s.unit||'')}</td><td class="c-red">${fN(s.currentQty)}</td><td>${fN(s.minQty)}</td><td><input type="number" class="pr-qty" data-idx="${idx}" data-item-id="${s.itemId}" data-name="${esc(s.itemName)}" data-unit="${esc(s.unit||'وحدة')}" min="0" step="0.001" value="${Number(s.suggestedQty||0)}" style="max-width:110px"></td></tr>`).join('')||'<tr><td colspan="6" class="u-empty-sm">لا توجد نواقص حاليًا (كل الأصناف فوق الحد الأدنى) — أضف يدويًا بالأسفل</td></tr>';
PR_SHORT_CACHE=shortages||[];
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب شراء نواقص جديد</h3><div class="workflow-banner">علّم على أصناف النواقص وعدّل الكمية المطلوبة، أو أضف أصنافًا يدويًا (خضار وغيرها) — بعد الإنشاء يوقّع <strong>الشيف</strong> ثم يعتمد <strong>المدير العام</strong> ثم يستلم <strong>المخزن</strong>.</div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> نواقص المخزن (${fN((shortages||[]).length)})</h3></div><div class="tbl-scroll" style="max-height:300px;overflow:auto"><table><thead><tr><th><input type="checkbox" checked onchange="document.querySelectorAll('.pr-sel').forEach(c=>c.checked=this.checked)"></th><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>المطلوب شراؤه</th></tr></thead><tbody>${rowsHtml}</tbody></table></div></div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=plus></i> إضافة يدوية</h3><button type="button" class="btn btn-blue btn-sm" onclick="prAddManualRow()"><i class=ji data-i=plus></i> صف جديد</button></div><div id="prManualRows"></div><datalist id="prInvNames">${invNames}</datalist></div><div class="fg"><label>القسم الطالب (تُحسب عليه التكلفة عند التسليم المباشر)</label>${isDeptHead()?`<input type="hidden" id="prDept" value="${esc(myDeptCode()||'')}"><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled>`:((STATE.currentUser?.role==='kitchen')?`<input type="hidden" id="prDept" value="kitchen"><input type="text" value="المطبخ" readonly disabled>`:`<select id="prDept">${(STATE.departments||[]).filter(d=>!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen').map((d,i)=>`<option value="${esc(d.code)}" ${i===0?'selected':''}>${esc(d.name||d.code)}</option>`).join('')}</select>`)}</div><div class="fg u-mt12"><label>ملاحظات الطلب (اختياري)</label><textarea id="prNotes" rows="2" placeholder="مثال: أولوية للسلطات قبل نهاية الأسبوع"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRCreate()"><i class=ji data-i=shopping-cart></i> إنشاء الطلب</button></div>`);
}catch(e){ toast(e.message||'تعذر جلب النواقص','error'); }
finally{ hideLoad(); }
}
function prAddManualRow(){
const box=document.getElementById('prManualRows'); if(!box) {return;}
const div=document.createElement('div'); div.className='fr u-mt8 pr-manual';
div.innerHTML=`<div class="fg" style="flex:2"><label>الصنف</label><input type="text" class="pr-m-name" list="prInvNames" placeholder="اسم الصنف"></div><div class="fg"><label>الوحدة</label><input type="text" class="pr-m-unit" value="وحدة" style="max-width:90px"></div><div class="fg"><label>الكمية المطلوبة</label><input type="number" class="pr-m-qty" min="0" step="0.001" value="0" style="max-width:110px"></div><button type="button" class="btn btn-red btn-sm" onclick="this.parentElement.remove()" title="حذف الصف"><i class=ji data-i=trash></i></button>`;
box.appendChild(div);
}
async function confirmPRCreate(){
const items=[];
document.querySelectorAll('.pr-sel:checked').forEach(cb=>{
const input=document.querySelector(`.pr-qty[data-idx="${cb.dataset.idx}"]`); if(!input) {return;}
const qty=Number(input.value);
if(Number.isFinite(qty)&&qty>0) {items.push({itemId:Number(input.dataset.itemId)||null,itemName:input.dataset.name,unit:input.dataset.unit||'وحدة',requestedQty:qty});}
});
document.querySelectorAll('.pr-manual').forEach(row=>{
const name=row.querySelector('.pr-m-name')?.value.trim();
const qty=Number(row.querySelector('.pr-m-qty')?.value);
const unit=row.querySelector('.pr-m-unit')?.value.trim()||'وحدة';
if(name&&Number.isFinite(qty)&&qty>0) {items.push({itemName:name,unit,requestedQty:qty});}
});
if(!items.length){ toast('اختر صنفًا واحدًا على الأقل بكمية موجبة','error'); return; }
try{
showLoad();
const saved=await apiFetch('/warehouse/purchase-requests',{method:'POST',body:JSON.stringify({items,notes:document.getElementById('prNotes')?.value.trim()||'',deptCode:document.getElementById('prDept')?.value||''})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast(`أُنشئ طلب الشراء ${saved.request_number} — بانتظار توقيع الشيف`,'success');
addNotification('طلب شراء نواقص',`${saved.request_number} بانتظار توقيع الشيف`,'info');
}catch(e){ toast(e.message||'تعذر إنشاء طلب الشراء','error'); }
finally{ hideLoad(); }
}
function openPRChefApproveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const itemsHtml=(Array.isArray(r.items)?r.items:[]).map(i=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(i.itemName||i.name)}</strong><span class="badge bdg-blue">${fN(i.requestedQty??i.qty)} ${esc(i.unit||'')}</span></div>${i.currentQty!=null?`<small class="text-muted">الرصيد: ${fN(i.currentQty)} — الحد الأدنى: ${fN(i.minQty??'—')}</small>`:''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> توقيع الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">توقيعك يحيل الطلب إلى <strong>المدير العام</strong> للاعتماد النهائي — لا يحرك أي مخزون.</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="prChefNotes" rows="2"></textarea></div>${signaturePadMarkup('prChefSignature','توقيع الشيف العمومي — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRChefApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> توقيع وإحالة للمدير العام</button></div>`);
afterModalSignatureInit('prChefSignature');
}
async function confirmPRChefApprove(id){
const signatureData=readSignaturePad('prChefSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prChefSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('prChefNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast('وقّع الشيف — الطلب الآن بانتظار المدير العام','success');
}catch(e){ toast(e.message||'تعذر توقيع الشيف','error'); }
finally{ hideLoad(); }
}
function openPRChefRejectModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prChefRejReason" rows="3" placeholder="مثال: الكمية مبالغ فيها / الصنف متوفر ببديل"></textarea></div>${signaturePadMarkup('prChefRejSignature','توقيع الشيف على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmPRChefReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('prChefRejSignature');
}
async function confirmPRChefReject(id){
const reason=document.getElementById('prChefRejReason')?.value.trim();
if(!reason||reason.length<3){ toast('سبب الرفض مطلوب (3 أحرف على الأقل)','error'); return; }
const signatureData=readSignaturePad('prChefRejSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prChefRejSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/chef-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage(); toast('رفض الشيف الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض الطلب','error'); }
finally{ hideLoad(); }
}
function openPRGMApproveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const itemsHtml=(Array.isArray(r.items)?r.items:[]).map(i=>`<div style="background:var(--bg3);padding:10px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(i.itemName||i.name)}</strong><span class="badge bdg-blue">${fN(i.requestedQty??i.qty)} ${esc(i.unit||'')}</span></div></div>`).join('');
showModal(`<h3><i class=ji data-i=crown></i> اعتماد المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="workflow-banner">وقّع الشيف <strong>${esc(r.chef_approved_name||'—')}</strong> بتاريخ ${esc(fDT(r.chef_approved_at))} — اعتمادك نهائي ويُغلق الطلب (طلب فقط بلا حركة مخزون).</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات المدير العام (اختياري)</label><textarea id="prGMNotes" rows="2"></textarea></div>${signaturePadMarkup('prGMSignature','توقيع المدير العام — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRGMApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> اعتماد نهائي</button></div>`);
afterModalSignatureInit('prGMSignature');
}
async function confirmPRGMApprove(id){
const signatureData=readSignaturePad('prGMSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prGMSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('prGMNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage();
toast('اعتمد المدير العام الطلب نهائيًا','success');
addNotification('اعتماد طلب شراء',`${saved.request_number} معتمد نهائيًا من المدير العام`,'success');
}catch(e){ toast(e.message||'تعذر اعتماد المدير العام','error'); }
finally{ hideLoad(); }
}
function openPRGMRejectModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض المدير العام — ${esc(r.request_number||('#'+r.id))}</h3><div class="fg"><label>سبب الرفض</label><textarea id="prGMRejReason" rows="3"></textarea></div>${signaturePadMarkup('prGMRejSignature','توقيع المدير العام على الرفض — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmPRGMReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('prGMRejSignature');
}
async function confirmPRGMReject(id){
const reason=document.getElementById('prGMRejReason')?.value.trim();
if(!reason||reason.length<3){ toast('سبب الرفض مطلوب (3 أحرف على الأقل)','error'); return; }
const signatureData=readSignaturePad('prGMRejSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prGMRejSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/gm-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('purchaseRequests',saved); closeModal(); renderPage(); toast('رفض المدير العام الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض الطلب','error'); }
finally{ hideLoad(); }
}
function openPRReceiveModal(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r){return;}
const rows=(Array.isArray(r.items)?r.items:[]).map((i,ix)=>{
return '<div class="edit-row-item" style="flex-wrap:wrap;align-items:flex-end">'
+ '<div style="flex:2;min-width:160px"><strong>' + esc(i.itemName||i.name) + '</strong><br><small class="text-muted">المطلوب: ' + fN(i.requestedQty??i.qty) + ' ' + esc(i.unit||'') + '</small></div>'
+ '<div class="fg" style="min-width:100px"><label>المستلم</label><input type="number" class="pr-recv-qty" data-idx="' + ix + '" value="' + fN(i.requestedQty??i.qty) + '" min="0" step="0.001" style="max-width:100px"></div>'
+ '<div class="fg" style="min-width:100px"><label>سعر الوحدة</label><input type="number" class="pr-recv-cost" data-idx="' + ix + '" value="0" min="0" step="0.01" style="max-width:100px"></div>' + '<label style="min-width:96px;font-size:12px;align-self:center"><input type="checkbox" class="pr-recv-direct" data-idx="' + ix + '"> مباشر للقسم</label></div>';
}).join('');
showModal('<h3><i class=ji data-i=inbox></i> استلام المخزن</h3><div class="workflow-banner">اعتمد المدير العام <strong>' + esc(r.gm_approved_name||'—') + '</strong> — سجّل المستلم فعليًا لكل صنف (صفر للغير مستلم) وسعر الشراء: <strong>البضاعة تدخل المخزون فور التوقيع.</strong></div><div>' + rows + '</div><div class="fg"><label>طريقة التسليم</label><div class="fr"><label><input type="radio" name="prDeliver" value="stock" checked onchange="prDeliverModeSync(this.value)"> دخول المخزن (مخزون)</label><label><input type="radio" name="prDeliver" value="direct" onchange="prDeliverModeSync(this.value)"> تسليم مباشر للقسم (مصروف فوري)</label></div><small class="text-muted">القسم المستلم: ' + esc(r.dept_name||r.dept_code||'—') + '</small></div><div class="fg u-mt12"><label>ملاحظات الاستلام (اختياري)</label><textarea id="prRecvNotes" rows="2"></textarea></div>' + signaturePadMarkup('prRecvSignature','توقيع أمين المخزن — '+esc(accountSignatureName())) + '<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmPRReceive(\'' + esc(String(id)) + '\')">توقيع ودخول مخزني</button></div>');
afterModalSignatureInit('prRecvSignature');
window._prRecvItems=Array.isArray(r.items)?r.items:[];
prFreshSuggest();
}
function prDeliverModeSync(v){
document.querySelectorAll('.pr-recv-direct').forEach(cb=>{cb.checked=(v==='direct');});
}
function prFreshSuggest(){
const keys=['دجاج','لحم','لحوم','سمك','خضار','طماطم','خيار','بقدونس','فاكه','فواكه','حليب','ألبان','البان','طازج','بيض','كزبرة','نعناع','جرجير','خس','بطاطس','بصل','كبدة','كبد'];
document.querySelectorAll('.pr-recv-direct').forEach((cb,ix)=>{
const nm=String(((window._prRecvItems||[])[ix]||{}).itemName||((window._prRecvItems||[])[ix]||{}).name||'');
if(keys.some(k=>nm.includes(k))){cb.checked=true;}
});
}
async function confirmPRReceive(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r){return;}
const reqItems=Array.isArray(r.items)?r.items:[];
const items=reqItems.map((i,ix)=>{
const q=document.querySelector('.pr-recv-qty[data-idx="' + ix + '"]');
const c=document.querySelector('.pr-recv-cost[data-idx="' + ix + '"]');
const w=document.querySelector('.pr-recv-direct[data-idx="' + ix + '"]');
return {itemName:i.itemName||i.name,receivedQty:Number(q&&q.value),unitCost:Number(c&&c.value)||0,direct:!!(w&&w.checked)};
});
const signatureData=readSignaturePad('prRecvSignature'); if(!signatureData) {return;}
const signerName=readSignerName('prRecvSignature'); if(!signerName) {return;}
try{ showLoad();
const saved=await apiFetch('/warehouse/purchase-requests/' + encodeURIComponent(id) + '/warehouse-receive',{method:'POST',body:JSON.stringify({items:items,deliverMode:((document.querySelector('input[name="prDeliver"]:checked')||{}).value||'stock'),notes:(document.getElementById('prRecvNotes')||{}).value||'',signatureData:signatureData,signerName:signerName})});
upsertStateEntity('purchaseRequests',saved);
((saved&&saved.stockChanges)||[]).forEach(row=>upsertStateEntity('inventory',row));
((saved&&saved.transactions)||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
closeModal(); renderPage();
toast('وقع المخزن ودخلت البضاعة المخزون','success');
}catch(e){ toast(e.message||'تعذر تسجيل الاستلام','error'); }
finally{ hideLoad(); }
}
async function cancelPR(id){
if(!confirm('إلغاء طلب الشراء المعلّق؟')) {return;}
try{ showLoad();
const saved=await apiFetch(`/warehouse/purchase-requests/${encodeURIComponent(id)}/cancel`,{method:'POST',body:JSON.stringify({})});
upsertStateEntity('purchaseRequests',saved); renderPage(); toast('أُلغي طلب الشراء','info');
}catch(e){ toast(e.message||'تعذر إلغاء الطلب','error'); }
finally{ hideLoad(); }
}
function viewPRDetails(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const items=Array.isArray(r.items)?r.items:[];
const chain=`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=user></i> أنشأ <strong>${esc(r.creator_name||'—')}</strong> الطلب بتاريخ ${esc(fDT(r.created_at))}.</div>`
+(r.chef_approved_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=chef-hat></i> وقّع الشيف <strong>${esc(r.chef_approved_name)}</strong> بتاريخ ${esc(fDT(r.chef_approved_at))}${r.chef_notes?` — ${esc(r.chef_notes)}`:''}.</div>`:`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=hourglass></i> بانتظار توقيع الشيف.</div>`)
+(r.gm_approved_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=crown></i> اعتمد المدير العام <strong>${esc(r.gm_approved_name)}</strong> بتاريخ ${esc(fDT(r.gm_approved_at))} اعتمادًا نهائيًا${r.gm_notes?` — ${esc(r.gm_notes)}`:''}.</div>`:(r.status==='chef_approved'?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=hourglass></i> بانتظار اعتماد المدير العام.</div>`:''))
+(r.wh_received_name?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=inbox></i> استلم المخزن <strong>${esc(r.wh_received_name)}</strong> بتاريخ ${esc(fDT(r.wh_received_at))} — دخلت البضاعة المخزون.</div>`:'')+(r.status==='rejected'?`<div class="workflow-banner" style="margin-top:8px"><i class=ji data-i=circle-x></i> مرفوض بواسطة <strong>${esc(r.rejected_name||'—')}</strong>: ${esc(r.rejection_reason||'—')}</div>`:'');
showModal(`<h3><i class=ji data-i=shopping-cart></i> طلب الشراء ${esc(r.request_number||('#'+r.id))} — <span class="badge ${prStatusClass(r.status)}">${prStatusLabel(r.status)}</span></h3><div class="u-row-wrap" style="margin:8px 0"><span class="badge bdg-blue"><span class="badge bdg-blue">القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')}</span></span>${r.deliver_mode?`<span class="badge ${r.deliver_mode==='direct'?'bdg-gold':'bdg-teal'}">${r.deliver_mode==='direct'?'تسليم مباشر (مصروف فوري)':r.deliver_mode==='mixed'?'تسليم مختلط':'دخول مخزن'}</span>`:''}</div><div class="tbl-wrap" style="margin-top:12px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> الأصناف (${fN(items.length)})</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>المطلوب</th><th>الرصيد وقت الإنشاء</th></tr></thead><tbody>${items.map(i=>`<tr><td class="fw-bold">${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'—')}</td><td class="c-gold fw-bold">${fN(i.requestedQty??i.qty)}</td><td>${i.currentQty!=null?fN(i.currentQty):'—'}</td></tr>`).join('')}</tbody></table></div></div>${r.notes?`<div class="details-item" style="margin-top:10px"><strong>ملاحظات الطلب:</strong><div>${esc(r.notes)}</div></div>`:''}${chain}<div class="modal-footer">${(r.status==='pending'&&prCanCreate()||r.status==='chef_approved'&&prCanCancel())?`<button class="btn btn-red" onclick="closeModal();cancelPR('${esc(String(r.id))}')"><i class=ji data-i=x-circle></i> إلغاء الطلب</button>`:''}${prCanDelete()&&!['approved','fulfilled'].includes(r.status)?`<button class="btn btn-red" onclick="deletePR('${esc(String(r.id))}')"><i class=ji data-i=trash></i> حذف نهائي</button>`:''}<button class="btn btn-blue" onclick="printPR('${esc(String(r.id))}')"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
}
function printPR(id){
const r=(STATE.purchaseRequests||[]).find(x=>String(x.id)===String(id)); if(!r) {return;}
const items=Array.isArray(r.items)?r.items:[];
const sigBlock=(label,who,at)=>`<div style="text-align:center;min-width:160px"><div style="height:44px"></div><div style="border-top:1px solid #333;padding-top:5px;font-size:12px;color:#444">${label}${who?`<br><b style="color:#222">${esc(who)}</b>${at?`<br><small>${esc(fDT(at))}</small>`:''}`:'<br>........'}</div></div>`;
const w=window.open('','_blank'); if(!w){ toast('اسمح بالنوافذ المنبثقة للطباعة','warning'); return; }
w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>طلب شراء ${esc(r.request_number||'')}</title><style>body{font-family:'Cairo',sans-serif;padding:40px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #000;padding:8px;text-align:center}th{background:#f0f0f0}</style></head><body><h1 class="u-ta-c">${esc(STATE.settings.name)}</h1><h2 class="u-ta-c">طلب شراء نواقص — ${esc(r.request_number||('#'+r.id))}</h2><p><strong>الحالة:</strong> ${esc(prStatusLabel(r.status))} | <strong>التاريخ:</strong> ${esc(fD(r.created_at))} | <strong>القسم الطالب:</strong> القسم الطالب: ${esc(r.dept_name||r.dept_code||'—')} | <strong>المنشئ:</strong> ${esc(r.creator_name||'—')}</p><table><thead><th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية المطلوبة</th></thead><tbody>${items.map((i,ix)=>`<tr><td>${ix+1}</td><td>${esc(i.itemName||i.name)}</td><td>${esc(i.unit||'')}</td><td>${fN(i.requestedQty??i.qty)}</td></tr>`).join('')}</tbody></table><p><strong>ملاحظات:</strong> ${esc(r.notes||'لا توجد')}</p>${r.rejection_reason?`<p><strong>سبب الرفض:</strong> ${esc(r.rejection_reason)} (${esc(r.rejected_name||'—')})</p>`:''}<div style="margin-top:48px"><div style="display:flex;justify-content:space-between;gap:16px">${sigBlock('توقيع أمين المخزن',r.creator_name,r.created_at)}${sigBlock('توقيع الشيف',r.chef_approved_name,r.chef_approved_at)}${sigBlock('اعتماد المدير العام',r.gm_approved_name,r.gm_approved_at)}${sigBlock('استلام المخزن',r.wh_received_name,r.wh_received_at)}</div></div></body></html>`);
w.document.close();
}
function renderKitchenReturnsSection(){
// رئيس القسم يرى مرتجعات قسمه فقط
const returns = (STATE.kitchenReturns||[]).slice().reverse().filter(r=>isDeptHead()?String(r.deptCode)===String(myDeptCode()):true);
const totalValue = returns.reduce((sum,item)=>sum+(parseFloat(item.totalValue)||0),0);
const canReturn=['admin','manager','warehouse','kitchen','dept_head'].includes(STATE.currentUser?.role);
const canDelete=['admin','manager','warehouse'].includes(STATE.currentUser?.role);
return `
<div class="tbl-wrap" style="margin-top:18px">
<div class="tbl-hd"><h3><i class=ji data-i=undo></i> سجل المرتجعات</h3>${canReturn?`<button class="btn btn-gold btn-sm" onclick="showKitchenReturnModal()"><i class=ji data-i=undo></i> إرجاع جديد</button>`:''}</div>
<div class="tbl-scroll">
<table>
<thead><tr><th>#</th><th>القسم</th><th>طلب الصرف</th><th>الأصناف</th><th>السبب</th><th>التاريخ</th><th>القيمة</th>${canDelete?'<th>حذف</th>':''}</tr></thead>
<tbody>
${returns.map((ret,idx)=>`<tr>
<td>${idx+1}</td>
<td class="fw-bold">${esc(ret.deptName||'—')}</td>
<td class="c-gold">#${ret.dispatchId||'—'}</td>
<td>${(ret.items||[]).map(item=>`${esc(item.name||item.itemName)} (${fN(item.qty)})`).join(', ')}</td>
<td>${esc(ret.reason||'—')}</td>
<td>${fD(ret.date)}</td>
<td class="c-blue fw-bold">${fC(ret.totalValue||0)}</td>
${canDelete?`<td><button class="btn btn-red btn-sm" onclick="deleteKitchenReturn('${esc(ret.id)}')" title="حذف المرتجع"><i class=ji data-i=trash></i></button></td>`:''}
</tr>`).join('')||'<tr><td colspan="7" class="u-empty-sm">لا توجد مرتجعات</td></tr>'}
</tbody>
<tfoot>
<tr>
<td colspan="6" class="u-num-l"><i class=ji data-i=banknote></i> الإجمالي المعكوس</td>
<td class="c-blue fw-bold">${fC(totalValue)}</td>
${canDelete?'<td></td>':''}
</tr>
</tfoot>
</table>
</div>
</div>
`;
}
async function deleteKitchenReturn(id){
if(!confirm('تأكيد حذف سجل المرتجع؟ لا يمكن التراجع.')) {return;}
try{
showLoad();
const result=await apiFetch('/warehouse/returns/'+encodeURIComponent(id),{method:'DELETE'});
upsertStateEntity('kitchenReturns',result); // سيزيله من STATE
renderPage();
toast('تم حذف سجل المرتجع','success');
}catch(e){ toast(e.message||'تعذر الحذف','error'); }
finally{ hideLoad(); }
}
function getDispatchDepartments(){
const departments=[...(STATE.departments||[])];
const hasKitchen=departments.some(d=>{const code=String(d.code||'').toLowerCase();const name=String(d.name||d.name_ar||'').toLowerCase();return code==='kitchen'||code==='مطبخ'||name.includes('مطبخ')||name.includes('kitchen');});
if(STATE.page==='kitchen'&&!hasKitchen) {departments.unshift({code:'kitchen',name:'المطبخ',icon:'<i class=ji data-i=cooking-pot></i>',_fallback:true});}
return departments;
}
function showDispatchRequestModal(){
const dispatchDepartments=getDispatchDepartments();
 // رئيس القسم: قسمه فقط وطلب يمر إجباريًا بالشيف العمومي
const deptField=isDeptHead()
 ? `<input type="hidden" id="dispatchDept" value="${esc(myDeptCode()||'')}"><div class="fg"><label>القسم الطالب</label><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled></div><div class="workflow-banner"><i class=ji data-i=chef-hat></i> سيُرسل طلبك إلى <strong>الشيف العمومي</strong> للاعتماد أولًا، ثم إلى <strong>المخازن</strong> للصرف، ويستلمه قسمك من مخزنه الخاص.</div>`
 : `<div class="fg"><label>القسم الطالب</label><select id="dispatchDept">${dispatchDepartments.map((d,i)=>`<option value="${d.code}" ${i===0?'selected':''}>${esc(d.name||d.name_ar||d.code)}</option>`).join('')}</select></div>`;
 showModal(`<h3><i class=ji data-i=package></i> طلب صرف جديد</h3>${deptField}<div class="workflow-banner"><i class=ji data-i=info></i> ابحث عن الصنف وحدد الكمية — أصناف <strong>الوزن المتغير</strong> تُطلب <strong>بالكرتون</strong> ويُحدد وزنها عند الصرف.</div><label style="margin-top:10px">الأصناف المطلوبة <span class="badge bdg-blue" id="dispCount">1</span></label><div id="dispatchItemsContainer">${dispRowHtml()}</div><button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addDispatchItemField()"><i class=ji data-i=plus></i> إضافة صنف</button><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=clipboard-list></i> ملخص الطلب</div><div class="callout-value u-t14" id="dispSummary">—</div></div><div class="fg u-mt8"><label>ملاحظات</label><textarea id="dispNotes" rows="2" placeholder="ملاحظة للمخزن (اختياري)"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitDispatchRequest()"><i class=ji data-i=upload></i> إرسال الطلب</button></div>`);
updateDispSummary();
}
// صف صنف ببحث فوري (اسم/باركود) بدل القائمة المنسدلة — يعمل مع آلاف الأصناف
function dispRowHtml(){
return `<div class="dispatch-item" style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:10px;border:1px solid var(--border)">
<div style="position:relative;margin-bottom:8px">
<input type="text" class="dispatch-item-search u-input-f2" placeholder="🔍 ابحث: اسم الصنف أو الباركود..." autocomplete="off" oninput="dispFilterItems(this)" onfocus="dispFilterItems(this)" onblur="setTimeout(()=>dispHideList(this),200)" style="width:100%;font-size:15px;padding:10px 12px">
<input type="hidden" class="dispatch-item-name" value="">
<input type="hidden" class="dispatch-item-catch" value="">
<input type="hidden" class="dispatch-item-pkguom" value="">
<div class="dispatch-item-list" style="display:none;position:absolute;top:100%;right:0;left:0;z-index:50;background:var(--bg2);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.35)"></div>
</div>
<div class="fr" style="align-items:flex-end">
<div class="fg" style="flex:1;min-width:120px"><label>الكمية</label><input type="number" class="dispatch-item-qty u-input-f1" placeholder="الكمية" min="0.001" step="0.001" style="font-size:16px;font-weight:700" oninput="updateDispSummary()"></div>
<div class="fg pkg-wrap" style="flex:1;min-width:120px;display:none"><label>عدد الكراتين *</label><input type="number" class="dispatch-item-pkg u-input-f1" placeholder="عدد الكراتين" min="1" step="1" style="font-size:16px;font-weight:700" oninput="updateDispSummary()"></div>
<div style="display:flex;flex-direction:column;gap:2px;min-width:86px"><span class="row-unit badge bdg-green">قطعة</span><small class="row-avail text-muted"></small><small class="row-cwest text-muted" style="display:none"></small></div>
<button type="button" class="btn btn-sm btn-red" onclick="removeDispatchItem(this)" title="حذف الصنف"><i class=ji data-i=x></i></button>
</div>
</div>`;
}
function updateDispSummary(){
const rows=[...document.querySelectorAll('.dispatch-item')];
const countEl=document.getElementById('dispCount');
if(countEl) {countEl.textContent=rows.length;}
const parts=[];
rows.forEach(row=>{
const name=row.querySelector('.dispatch-item-name')?.value?.trim()||'صنف جديد';
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const uom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
if(boxes>0) {parts.push(`${name}: ${fN(boxes)} ${uom}`);}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const unit=row.querySelector('.row-unit')?.textContent?.trim()||'';
if(qty>0) {parts.push(`${name}: ${fN(qty)} ${unit}`);}
}
});
const s=document.getElementById('dispSummary');
if(s) {s.innerHTML=parts.length?parts.map(esc).join(' • '):'—';}
}
function dispFilterItems(input){
const row=input?.closest('.dispatch-item'); if(!row) {return;}
const list=row.querySelector('.dispatch-item-list'); if(!list) {return;}
const q=String(input.value||'').trim().toLowerCase();
const matches=(STATE.inventory||[]).filter(i=>!q||String(i.name||'').toLowerCase().includes(q)||(i.barcode&&String(i.barcode).includes(q))).slice(0,30);
list.innerHTML=matches.map(i=>{const cw=i.catch_weight_enabled?1:0;return `<div onmousedown="dispPickItem(this)" data-name="${esc(i.name)}" data-unit="${esc(i.unit||'قطعة')}" data-max="${i.qty}" data-catch="${cw}" data-pkguom="${esc(i.packaging_uom||'كرتون')}" data-avgbox="${i.packaging_qty_per_base||''}" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid var(--border)"><b>${esc(i.name)}</b>${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}${i.barcode?` <small class="text-muted">${esc(i.barcode)}</small>`:''}<div class="text-muted" style="font-size:11px">متاح: ${fN(i.qty)} ${esc(i.unit||'')}</div></div>`;}).join('')||'<div class="text-muted" style="padding:8px">لا نتائج مطابقة</div>';
list.style.display='';
}
function dispHideList(input){ const l=input?.closest('.dispatch-item')?.querySelector('.dispatch-item-list'); if(l) {l.style.display='none';} }
function dispPickItem(el){
const row=el?.closest('.dispatch-item'); if(!row) {return;}
const isCw=el.dataset.catch==='1';
row.querySelector('.dispatch-item-name').value=el.dataset.name||'';
row.querySelector('.dispatch-item-search').value=el.dataset.name||'';
row.querySelector('.dispatch-item-catch').value=isCw?'1':'';
row.querySelector('.dispatch-item-pkguom').value=el.dataset.pkguom||'كرتون';
const qtyInput=row.querySelector('.dispatch-item-qty');
const pkgInput=row.querySelector('.dispatch-item-pkg');
const pkgWrap=row.querySelector('.pkg-wrap');
const cwNote=row.querySelector('.row-cwest');
if(isCw){
row.querySelector('.row-unit').textContent=el.dataset.pkguom||'كرتون';
if(qtyInput){qtyInput.placeholder='ملاحظة للمخزن (اختياري)';qtyInput.min='0';qtyInput.style.display='none';}
if(pkgWrap){pkgWrap.style.display='';}
if(cwNote){cwNote.style.display='';cwNote.textContent='الوزن يُحدد على الميزان عند الصرف';}
}else{
row.querySelector('.row-unit').textContent=el.dataset.unit||'قطعة';
if(qtyInput){qtyInput.placeholder='الكمية';qtyInput.min='0.001';}
if(pkgWrap){pkgWrap.style.display='none';}
if(pkgInput){pkgInput.value='';}
if(cwNote){cwNote.style.display='none';cwNote.textContent='';}
}
const av=row.querySelector('.row-avail'); if(av) {av.textContent=`متاح: ${fN(el.dataset.max||0)}`;}
el.parentElement.style.display='none';
updateDispSummary();
}
function addDispatchItemField(){
const container=document.getElementById('dispatchItemsContainer');
if(!container){return;}
const div=document.createElement('div');
div.innerHTML=dispRowHtml();
container.appendChild(div.firstElementChild);
updateDispSummary();
}
function syncDispatchRowUnit(select){ const row=select?.closest('.dispatch-item'); const unit=select?.options?.[select.selectedIndex]?.dataset?.unit||'قطعة'; if(row) {row.querySelector('.row-unit').textContent=unit;} }
function removeDispatchItem(btn){ const row=btn?.closest('.dispatch-item'); if(!row){return;} const container=row.parentElement; if(container.querySelectorAll('.dispatch-item').length<=1){ row.querySelector('.dispatch-item-qty').value=''; const p=row.querySelector('.dispatch-item-pkg'); if(p){p.value='';} updateDispSummary(); return; } row.remove(); updateDispSummary(); }
async function submitDispatchRequest(){
const deptCode=document.getElementById('dispatchDept')?.value;
if(!deptCode){ toast('حدد القسم الطالب','error'); return; }
const dept=getDispatchDepartments().find(d=>d.code===deptCode) || {code:deptCode,name:deptNameByCode(deptCode)};
const items=[];
const notes=document.getElementById('dispNotes')?.value.trim();
document.querySelectorAll('.dispatch-item').forEach(row=>{
const name=row.querySelector('.dispatch-item-name')?.value?.trim();
const isCw=row.querySelector('.dispatch-item-catch')?.value==='1';
const pkgUom=row.querySelector('.dispatch-item-pkguom')?.value||'كرتون';
if(isCw){
const boxes=parseInt(row.querySelector('.dispatch-item-pkg')?.value)||0;
const estKg=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
if(name&&boxes>0) {items.push({itemName:name,qty:boxes,unit:pkgUom,packagingQty:boxes,packagingUom:pkgUom,estWeightKg:estKg||null});}
}else{
const qty=parseFloat(row.querySelector('.dispatch-item-qty')?.value)||0;
const unit=row.querySelector('.row-unit')?.textContent?.trim()||'قطعة';
if(name&&qty>0) {items.push({itemName:name,qty,unit});}
}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
const disp = {id:uid(),deptCode,deptName:dept?.name||'قسم غير معروف',items,status:'pending',date:today(),createdBy:STATE.currentUser?.username||'unknown',notes};
await persistCreate('dispatches', (saved)=>STATE.dispatches.push(saved), disp);
closeModal(); renderPage(); buildNav();
toast(isDeptHead()?'تم إرسال طلب الصرف — بانتظار اعتماد الشيف العمومي':'تم إرسال طلب الصرف');
addNotification('طلب صرف جديد',`طلب صرف من ${dept?.name||'قسم'}${isDeptHead()?' — بانتظار اعتماد الشيف العمومي':''}`,'info');
}
// ═══ Task 19: اعتماد/رفض الشيف العمومي ═══
function openChefApproveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const warnings=(d.items||[]).map(item=>{const inv=STATE.inventory.find(i=>i.name===item.itemName);const avail=inv?Number(inv.qty):0;const isCw=Boolean(inv?.catch_weight_enabled);const req=Number(item.qty)||0;return {item,avail,req,short:isCw?false:avail<req,isCw};});
const itemsHtml=warnings.map(w=>`<div style="background:var(--bg3);padding:12px;border-radius:var(--r);margin-bottom:8px"><div class="u-row-between"><strong>${esc(w.item.itemName)}</strong>${w.isCw?' <span class="badge bdg-blue">وزن متغير</span>':''}<span class="badge ${w.short?'bdg-red':'bdg-green'}">المتاح: ${fN(w.avail)} كجم</span></div><div class="text-muted" style="margin-top:4px">المطلوب: ${fN(w.req)} ${esc(w.item.unit||'')}${w.isCw?` — الوزن الفعلي من الميزان عند الصرف`:''}</div>${w.short?'<div style="color:var(--orange);margin-top:4px"><i class=ji data-i=alert-triangle></i> الرصيد أقل من المطلوب — المخازن ستقرر الكمية المعتمدة عند الصرف</div>':''}</div>`).join('');
showModal(`<h3><i class=ji data-i=chef-hat></i> اعتماد الشيف العمومي — ${esc(d.deptName)}</h3><div class="workflow-banner">اعتمادك ينقل الطلب إلى <strong>المخازن</strong> للصرف والخصم — لا يُخصم أي مخزون بهذه الخطوة.</div><div>${itemsHtml}</div><div class="fg u-mt12"><label>ملاحظات الشيف (اختياري)</label><textarea id="chefNotes" rows="2"></textarea></div>${signaturePadMarkup('chefApprovalSignature','توقيع الشيف العمومي')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmChefApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> اعتماد وإحالة للمخازن</button></div>`);
afterModalSignatureInit('chefApprovalSignature');
}
async function confirmChefApprove(id){
const signatureData=readSignaturePad('chefApprovalSignature'); if(!signatureData){return;}
const signerName=readSignerName('chefApprovalSignature'); if(!signerName){return;}
try{showLoad();
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-approve`,{method:'POST',body:JSON.stringify({notes:document.getElementById('chefNotes')?.value.trim()||'',signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();buildNav();
toast('تم اعتماد الطلب وإحالته للمخازن','success');
addNotification('اعتماد الشيف',`إذن #${id} صار بانتظار صرف المخازن`,'success');
}catch(e){toast(e.message||'تعذر اعتماد الطلب','error')}finally{hideLoad();}
}
function openChefRejectModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض الشيف العمومي — ${esc(d.deptName)}</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>الأصناف:</strong> ${(d.items||[]).map(i=>esc(i.itemName)).join('، ')}</div><div class="fg"><label>سبب الرفض</label><textarea id="chefRejReason" rows="3" placeholder="مثال: الكمية كبيرة على احتياج القسم / الصنف غير مناسب"></textarea></div>${signaturePadMarkup('chefRejectionSignature','توقيع الشيف العمومي على الرفض')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmChefReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);
afterModalSignatureInit('chefRejectionSignature');
}
async function confirmChefReject(id){
const reason=document.getElementById('chefRejReason')?.value.trim();
if(!reason){ toast('أدخل سبب الرفض','error'); return; }
const signatureData=readSignaturePad('chefRejectionSignature'); if(!signatureData){return;}
const signerName=readSignerName('chefRejectionSignature'); if(!signerName){return;}
try{showLoad();
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/chef-reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();buildNav();
toast('تم رفض الطلب وسيظهر لرئيس القسم','warning');
addNotification('رفض الشيف',`إذن #${id} مرفوض: ${reason}`,'warning');
}catch(e){toast(e.message||'تعذر رفض الطلب','error')}finally{hideLoad();}
}
const SIGNATURE_PADS = Object.create(null);
const SIGNATURE_DATE_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn',{year:'numeric',month:'2-digit',day:'2-digit'});
// ═══ توقيع صاحب الحساب فقط: الحقل مقفل على اسم الدخول ولا يقبل أي اسم آخر ═══
function accountSignatureName(){ return String(STATE.currentUser?.name||'').trim() || String(STATE.currentUser?.username||'').trim() || ''; }
function normalizeSigName(v){ return String(v||'').trim().replace(/\s+/g,' '); }
function signatureNameMatchesAccount(typed){
const t=normalizeSigName(typed).toLowerCase(); if(!t) {return false;}
const cands=[STATE.currentUser?.name,STATE.currentUser?.username].map(v=>normalizeSigName(v).toLowerCase()).filter(Boolean);
return cands.includes(t);
}
function readSignerName(id){
const state=SIGNATURE_PADS[id];
const v=state?.input?.value ?? document.getElementById(`${id}-input`)?.value ?? '';
return normalizeSigName(v);
}
function signaturePadMarkup(id, title='التوقيع الإلكتروني'){
const locked=accountSignatureName();
return `<div class="signature-panel"><div class="fr"><label><i class=ji data-i=pen-tool></i> ${title}</label></div><input type="text" class="signature-input" id="${id}-input" autocomplete="off" spellcheck="false" maxlength="60" value="${esc(locked)}" readonly tabindex="-1" aria-readonly="true" aria-label="${title} — توقيع ${esc(locked)}"><canvas id="${id}" width="900" height="220" aria-label="${title}"></canvas><small class="text-muted">التوقيع مقفل باسم حسابك (<strong>${esc(locked||'—')}</strong>) — لا يمكن توقيع أي اسم آخر. التوقيع موثّق بتاريخ اليوم.</small></div>`;
}
function signatureFont(size){ return `700 ${size}px 'Aref Ruqaa','Cairo',cursive`; }
function paintTypedSignature(id){
const state=SIGNATURE_PADS[id]; if(!state||!state.ctx) {return;}
const {canvas,ctx,input}=state; const name=(input?.value||'').trim();
ctx.clearRect(0,0,canvas.width,canvas.height);
state.hasInk=name.length>=2;
ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.direction='rtl';
if(!state.hasInk){
ctx.fillStyle='#9aa1ad'; ctx.font="26px 'Cairo',sans-serif";
ctx.fillText('التوقيع يظهر هنا بعد كتابة الاسم', canvas.width/2, canvas.height/2 - 8);
return;
}
let size=68; ctx.font=signatureFont(size);
while(ctx.measureText(name).width > canvas.width-130 && size>30){ size-=4; ctx.font=signatureFont(size); }
const nameW=Math.min(ctx.measureText(name).width, canvas.width-110);
ctx.fillStyle='#1f2430';
ctx.fillText(name, canvas.width/2, 88);
ctx.strokeStyle='#b45309'; ctx.lineWidth=2.5; ctx.lineCap='round';
const uy=148;
ctx.beginPath();
ctx.moveTo(canvas.width/2 - nameW/2, uy);
ctx.bezierCurveTo(canvas.width/2 - nameW/6, uy-12, canvas.width/2 + nameW/6, uy+12, canvas.width/2 + nameW/2, uy-6);
ctx.stroke();
ctx.fillStyle='#6b7280'; ctx.font="20px 'Cairo',sans-serif";
ctx.fillText(`توقيع إلكتروني • ${SIGNATURE_DATE_FMT.format(new Date())}`, canvas.width/2, 188);
}
function initSignaturePad(id){
const canvas=document.getElementById(id); if(!canvas) {return;}
const input=document.getElementById(`${id}-input`);
SIGNATURE_PADS[id]={canvas,ctx:canvas.getContext('2d'),input,hasInk:false};
// قفل الحقل على اسم الحساب — أي محاولة لتغييره عبر الأدوات تُرفض عند القراءة في الخادم أيضًا
if(input){ input.value=accountSignatureName(); input.setAttribute('readonly',''); input.addEventListener('input',()=>{ const want=accountSignatureName(); if(input.value!==want) {input.value=want;} paintTypedSignature(id); }); }
paintTypedSignature(id);
if(document.fonts?.load){
document.fonts.load("700 68px 'Aref Ruqaa'")
.then(()=>document.fonts.ready)
.then(()=>paintTypedSignature(id))
.catch(()=>{});
}
}
function clearSignaturePad(id){
const state=SIGNATURE_PADS[id]; if(!state) {return;}
// لا مسح لاسم آخر — إعادة القفل على اسم الحساب فقط
if(state.input){ state.input.value=accountSignatureName(); }
paintTypedSignature(id);
}
function readSignaturePad(id){
const state=SIGNATURE_PADS[id];
const typed=readSignerName(id);
const locked=accountSignatureName();
if(!normalizeSigName(typed) || !normalizeSigName(locked) || !signatureNameMatchesAccount(typed)){
toast(`التوقيع باسم حسابك فقط (${locked||'—'}) — لا يجوز توقيع أي اسم آخر`,'error');
if(state?.input) {state.input.value=locked;}
paintTypedSignature(id);
return null;
}
if(state?.input && state.input.value!==locked) {state.input.value=locked;}
if(!state?.hasInk){ paintTypedSignature(id); if(!state?.hasInk){ toast('تعذر تجهيز التوقيع — أعد فتح النافذة','error'); return null; } }
paintTypedSignature(id);
return state.canvas.toDataURL('image/png');
}
function afterModalSignatureInit(...ids){setTimeout(()=>ids.forEach(initSignaturePad),0);}
function dispatchStatusLabel(status){return ({pending:`<i class=ji data-i=hourglass></i> ${t('st.pending')}`,chef_approved:`<i class=ji data-i=chef-hat></i> ${t('st.chefOk')}`,approved:`<i class=ji data-i=circle-check></i> ${t('st.approved')}`,partially_received:`<i class=ji data-i=dot-orange></i> ${t('st.partial')}`,received:`<i class=ji data-i=package></i> ${t('st.received')}`,rejected:`<i class=ji data-i=circle-x></i> ${t('st.rejected')}`})[status]||'—';}
function dispatchStatusClass(status){return status==='pending'?'bdg-orange':status==='chef_approved'?'bdg-purple':(['approved','received'].includes(status)?'bdg-green':status==='partially_received'?'bdg-blue':'bdg-red');}
function openApproveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
let itemsHtml=''; let total=0;
d.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const maxQty=inv?inv.qty:0;
const isCatchWeight = inv?.catch_weight_enabled;
const pkgUom = inv?.packaging_uom||item.packagingUom||'كرتون';
if(!isCatchWeight){
const val=Math.min(item.qty,maxQty)*(inv?.avgCost||0);
total+=val;
itemsHtml+=`<div style="background:var(--bg3);padding:15px;border-radius:var(--r);margin-bottom:10px">
<div class="fr"><div><strong>${esc(item.itemName)}</strong></div>
<div>المتاح: ${fN(maxQty)} | المطلوب: ${fN(item.qty)}</div></div>
<div class="fr">
<div class="fg"><label>الكمية المعتمدة</label><input type="number" id="apQty_${idx}" value="${Math.min(item.qty,maxQty)}" step="0.01" min="0" max="${maxQty}" oninput="updateApproveTotal()"></div>
<div class="fg"><label>القيمة</label><div id="apVal_${idx}" class="c-gold fw-bold">${fC(val)}</div></div></div>
${maxQty<item.qty?`<div class="text-muted" style="color:var(--orange)"><i class=ji data-i=alert-triangle></i> الكمية المطلوبة أكبر من المتوفر</div>`:''}</div>`;
return;
}
// Catch Weight: الطلب بالكرتون — أوزن وصرف بالكيلو الفعلي (بلا أي تقدير)
const reqBoxes=Number(item.packagingQty??item.qty)||0;
itemsHtml+=`<div style="background:var(--bg3);padding:15px;border-radius:var(--r);margin-bottom:10px">
<div class="fr"><div><strong>${esc(item.itemName)}</strong> <span class="badge bdg-blue">وزن متغير</span></div>
<div>المطلوب: <b class="c-gold">${fN(reqBoxes)} ${esc(pkgUom)}</b> | المتاح: ${fN(maxQty)} كجم</div></div>
<div class="fr">
<input type="hidden" id="apQty_${idx}" value="0">
<div class="fg"><label>عدد الكراتين المصروفة *</label><input type="number" id="apPkgQty_${idx}" value="${reqBoxes||''}" step="1" min="1" placeholder="عدد الكراتين" oninput="updateApproveTotal()"></div>
<div class="fg"><label>الوزن الفعلي بالكيلو (الميزان) *</label><input type="number" id="apWeight_${idx}" step="0.001" min="0.001" max="${maxQty}" placeholder="أوزن الكراتين وأدخل الوزن" oninput="updateApproveTotal()"></div>
<div class="fg"><label>القيمة (على الفعلي)</label><div id="apVal_${idx}" class="c-gold fw-bold">${fC(0)}</div></div></div>
<div class="text-muted" id="apAvg_${idx}" style="font-size:12px"></div></div>`;
});
showModal(`<h3><i class=ji data-i=circle-check></i> الموافقة على طلب صرف - ${esc(d.deptName)}</h3><div class="workflow-banner">اعتماد المخزن يخصم الكمية من المخزون ويسجل تكلفة القسم في نفس المعاملة.</div><div id="approveItems">${itemsHtml}</div><div class="callout-gold u-my16"><div class="fw-bold"><i class=ji data-i=banknote></i> القيمة الإجمالية</div><div class="callout-value" id="approveTotal">${fC(total)}</div></div><div class="fg"><label>ملاحظات</label><textarea id="approveNotes" rows="2"></textarea></div>${signaturePadMarkup('warehouseApprovalSignature','توقيع أمين المخزن المعتمد')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmApprove('${esc(String(id))}')"><i class=ji data-i=circle-check></i> تأكيد الموافقة</button></div>`);
window.updateApproveTotal=function(){
let t=0;
const disp=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!disp){return;}
disp.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const isCatchWeight = inv?.catch_weight_enabled;
if(isCatchWeight){
const weight=parseFloat(document.getElementById(`apWeight_${idx}`)?.value)||0;
const boxes=parseFloat(document.getElementById(`apPkgQty_${idx}`)?.value)||0;
const val=weight*(inv?.avgCost||0);
t+=val;
const valEl=document.getElementById(`apVal_${idx}`);
if(valEl) {valEl.innerHTML=fC(val);}
const avgEl=document.getElementById(`apAvg_${idx}`);
if(avgEl) {avgEl.textContent=(weight>0&&boxes>0)?`متوسط الكرتون المحسوب: ${fN(weight/boxes)} كجم`:'';}
return;
}
const qty=parseFloat(document.getElementById(`apQty_${idx}`)?.value)||0;
const val=qty*(inv?.avgCost||0);
t+=val;
const valEl=document.getElementById(`apVal_${idx}`);
if(valEl) {valEl.innerHTML=fC(val);}
});
const totalEl=document.getElementById('approveTotal');
if(totalEl) {totalEl.innerHTML=fC(t);}
};
afterModalSignatureInit('warehouseApprovalSignature');
}
async function confirmApprove(id){
try{
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){toast('تعذر العثور على طلب الصرف — حدّث الصفحة وحاول مجددًا','error');return;}
const approvedItems=[];
let hasError=false;
const approveNotes=document.getElementById('approveNotes')?.value.trim()||'';
const signatureData=readSignaturePad('warehouseApprovalSignature'); if(!signatureData){return;}
const signerName=readSignerName('warehouseApprovalSignature'); if(!signerName){toast('اسم الموقّع مطلوب — يجب أن يطابق اسم حسابك','error');return;}
d.items.forEach((item,idx)=>{
const inv=STATE.inventory.find(i=>i.name===item.itemName);
const isCw=Boolean(inv?.catch_weight_enabled);
if(isCw){
const actualWeight=parseFloat(document.getElementById(`apWeight_${idx}`)?.value)||0;
const packagingQty=parseFloat(document.getElementById(`apPkgQty_${idx}`)?.value)||0;
if(!(actualWeight>0)){ hasError=true; toast(`أدخل الوزن الفعلي بالكيلو للصنف "${item.itemName}"`,'error'); return; }
if(!(packagingQty>0)){ hasError=true; toast(`أدخل عدد الكراتين المصروفة للصنف "${item.itemName}"`,'error'); return; }
if(actualWeight>Number(inv?.qty||0)){ hasError=true; toast(`الوزن الفعلي من "${item.itemName}" أكبر من المتوفر (${fN(inv.qty)} كجم)`,'error'); return; }
const val=actualWeight*(Number(inv?.avgCost)||0);
approvedItems.push({name:item.itemName,itemName:item.itemName,unit:inv?.catch_weight_uom||'kg',requestedQty:actualWeight,requestedPackagingQty:Number(item.packagingQty??item.qty)||null,approvedQty:actualWeight,avgCost:Number(inv?.avgCost)||0,approvedValue:val,
actualWeight,packagingQty,packagingUom:inv?.packaging_uom||'كرتون',catchWeightUom:inv?.catch_weight_uom||'kg'});
return;
}
const approvedQty=parseFloat(document.getElementById(`apQty_${idx}`)?.value);
if(isNaN(approvedQty)||approvedQty<0){ hasError=true; return; }
if(inv&&approvedQty>Number(inv.qty)){ hasError=true; toast(`الكمية المعتمدة من "${item.itemName}" أكبر من المتوفر`,'error'); return; }
if(approvedQty>0){
const val=approvedQty*(Number(inv?.avgCost)||0);
approvedItems.push({name:item.itemName,itemName:item.itemName,unit:item.unit,requestedQty:item.qty,approvedQty,avgCost:Number(inv?.avgCost)||0,approvedValue:val,
actualWeight:null,packagingQty:null,packagingUom:null,catchWeightUom:inv?.catch_weight_uom||'kg'});
}
});
if(hasError||approvedItems.length===0){ toast('تحقق من البيانات','error'); return; }
try{
const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/approve`,{method:'POST',body:JSON.stringify({approvedItems,approveNotes,signatureData,signerName})});
upsertStateEntity('dispatches',result.dispatch);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تمت الموافقة وحُسبت مصاريف القسم بقيمة ${fC(result.totalValue||0)}`,'success');
addNotification('تمت الموافقة',`تم اعتماد طلب الصرف من ${d.deptName} وتسجيل تكلفته على القسم`,'success');
}catch(e){ toast(e.message||'تعذر اعتماد طلب الصرف','error'); }
}catch(err){ console.error('[confirmApprove]',err); toast('خطأ غير متوقع أثناء الاعتماد: '+(err?.message||err),'error'); }
}
function openRejectModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
showModal(`<h3><i class=ji data-i=circle-x></i> رفض طلب صرف</h3><div style="background:rgba(231,76,60,0.1);padding:12px;border-radius:var(--r);margin-bottom:16px"><strong>القسم:</strong> ${esc(d.deptName)}<br><strong>الأصناف:</strong> ${d.items.length}</div><div class="fg"><label>سبب الرفض</label><textarea id="rejReason" rows="3"></textarea></div>${signaturePadMarkup('warehouseRejectionSignature','توقيع أمين المخزن على الرفض')}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-red" onclick="confirmReject('${esc(String(id))}')"><i class=ji data-i=circle-x></i> تأكيد الرفض</button></div>`);afterModalSignatureInit('warehouseRejectionSignature');
}
async function confirmReject(id){
const reason=document.getElementById('rejReason')?.value.trim();
if(!reason){ toast('أدخل سبب الرفض','error'); return; }
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
try{
  const signatureData=readSignaturePad('warehouseRejectionSignature'); if(!signatureData){return;}
  const signerName=readSignerName('warehouseRejectionSignature'); if(!signerName){return;}
  const rejectedBy=STATE.currentUser?.username||'unknown';
  const rejectedDate=new Date().toISOString();
  const response=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/reject`,{method:'POST',body:JSON.stringify({reason,signatureData,signerName})});
 const saved=response.dispatch;
 upsertStateEntity('dispatches', saved||{...d,status:'rejected',rejectionReason:reason,rejectedBy,rejectedDate});
 closeModal(); renderPage();
 toast('تم رفض الطلب','warning');
}catch(e){ toast(e.message||'تعذر رفض طلب الصرف','error'); }
}
function openReceiveModal(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id)); if(!d){return;}
const items=d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items||[];
const itemsHtml=items.map((item,idx)=>{const approved=Number(item.approvedQty??item.qty)||0;const isCw=Boolean(item.catchWeightEnabled||item.actualWeight);const apBoxes=Number(item.packagingQty)||0;const pkgUom=item.packagingUom||'كرتون';return `<div style="background:var(--bg3);padding:14px;border-radius:var(--r);margin-bottom:10px"><div class="fr"><strong>${esc(item.itemName||item.name)}</strong>${isCw?' <span class="badge bdg-blue">وزن متغير</span>':''}<span class="badge bdg-blue">المعتمد: ${fN(approved)} ${esc(item.unit||'')}${isCw&&apBoxes>0?` (${fN(apBoxes)} ${esc(pkgUom)})`:''}</span></div><div class="fr"><div class="fg u-mt8"><label>الوزن المستلم فعليًا (كجم)</label><input type="number" id="receivedQty_${idx}" min="0" max="${approved}" step="0.001" value="${approved}"></div>${isCw?`<div class="fg u-mt8"><label>عدد الكراتين المستلمة</label><input type="number" id="receivedPkg_${idx}" min="0" max="${apBoxes||''}" step="1" value="${apBoxes||''}"></div>`:''}</div></div>`;}).join('');
showModal(`<h3><i class=ji data-i=inbox></i> استلام إذن الصرف — ${esc(d.deptName)}</h3><div class="workflow-banner">الاستلام والتوقيع باسم حسابك فقط (<strong>${esc(accountSignatureName()||'—')}</strong>) — لا يمكن توقيع أي اسم آخر. راجع الكميات ثم أكّد. لا يمكن تسجيل الاستلام مرتين.</div><div>${itemsHtml}</div><div class="fg"><label>ملاحظات الاستلام</label><textarea id="receiptNotes" rows="2" placeholder="أي عجز أو تلف أو ملاحظة عند الاستلام"></textarea></div>${signaturePadMarkup('kitchenReceiptSignature','توقيع المستلم — '+esc(accountSignatureName()))}<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="confirmReceive('${esc(String(id))}')"><i class=ji data-i=inbox></i> تأكيد الاستلام والتوقيع</button></div>`);
afterModalSignatureInit('kitchenReceiptSignature');
}
async function confirmReceive(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id)); if(!d){return;}
const signatureData=readSignaturePad('kitchenReceiptSignature'); if(!signatureData){return;}
const signerName=readSignerName('kitchenReceiptSignature'); if(!signerName){return;}
const items=d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items||[];
const receivedItems=[]; let invalid=false;
items.forEach((item,idx)=>{const approved=Number(item.approvedQty??item.qty)||0;const received=Number(document.getElementById(`receivedQty_${idx}`)?.value);if(!Number.isFinite(received)||received<0||received>approved){invalid=true;}const isCw=Boolean(item.catchWeightEnabled||item.actualWeight);const apBoxes=Number(item.packagingQty)||0;const pkgRaw=document.getElementById(`receivedPkg_${idx}`)?.value;const recvPkg=isCw?(pkgRaw===''||pkgRaw==null?apBoxes:Number(pkgRaw)):null;if(isCw&&(!Number.isFinite(recvPkg)||recvPkg<0||recvPkg>apBoxes)){invalid=true;}receivedItems.push({itemName:item.itemName||item.name,receivedQty:received,...(isCw?{receivedPackagingQty:recvPkg}:{}),notes:''});});
if(invalid){toast('تحقق من كميات الاستلام؛ لا تتجاوز الكمية المعتمدة','error');return;}
try{showLoad();const result=await apiFetch(`/warehouse/dispatches/${encodeURIComponent(id)}/receive`,{method:'POST',body:JSON.stringify({items:receivedItems,notes:document.getElementById('receiptNotes')?.value.trim()||'',signatureData,signerName})});upsertStateEntity('dispatches',result.dispatch);closeModal();renderPage();toast('تم تسجيل استلام المطبخ بالتوقيع','success');addNotification('استلام مطبخ',`تم استلام طلب الصرف #${id} وتوثيقه`,'success');}catch(e){toast(e.message||'تعذر تسجيل استلام المطبخ','error')}finally{hideLoad();}
}
function viewDispatchDetails(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const statusLabel=dispatchStatusLabel(d.status);
const sourceItems=(d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items)||[];
const receiptAudit=d.kitchenReceivedAt?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=signature></i> تم استلام الإذن وتوقيعه من ${esc(d.deptName)} بواسطة <strong>${esc(d.kitchenReceivedBy||'—')}</strong> بتاريخ ${esc(fDT(d.kitchenReceivedAt))}.<br><small>التوقيع الإلكتروني محفوظ ضمن سجل الإذن.</small></div>`:'<div class="workflow-banner" style="margin-top:14px">الإذن معتمد من المخازن ولم يتم تسجيل استلام القسم وتوقيعه بعد.</div>';
const chefAudit=d.chefApprovedAt?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=chef-hat></i> اعتمد <strong>الشيف العمومي</strong> الطلب بواسطة <strong>${esc(d.chefApprovedBy||'—')}</strong> بتاريخ ${esc(fDT(d.chefApprovedAt))} وأحاله إلى المخازن.</div>`:(d.needsChefApproval?`<div class="workflow-banner" style="margin-top:14px"><i class=ji data-i=hourglass></i> الطلب مقدم من <strong>رئيس القسم</strong> — بانتظار اعتماد الشيف العمومي قبل وصوله للمخازن.</div>`:'');
showModal(`<h3><i class=ji data-i=clipboard-list></i> تفاصيل طلب الصرف #${d.id}</h3><div class="fr"><div class="details-item"><strong>القسم:</strong><div>${esc(d.deptName)}</div></div><div class="details-item"><strong>الحالة:</strong><div>${statusLabel}</div></div></div><div class="fr"><div class="details-item"><strong>التاريخ:</strong><div>${fD(d.date)}</div></div><div class="details-item"><strong>الطالب:</strong><div>${esc(d.createdBy||'—')}${d.creatorRole==='dept_head'?' <span class="badge bdg-purple">رئيس قسم</span>':''}</div></div></div><div class="details-list" style="margin-top:10px"><div class="details-item"><strong>المرحلة الحالية:</strong><div>${esc(dispatchChainStage(d))}</div></div></div><div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=package></i> التفاصيل</h3></div><div class="tbl-scroll"><table><thead><tr><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>القيمة</th></tr></thead><tbody>${sourceItems.map(item=>{const cw=item.catchWeightEnabled||item.actualWeight;const q=cw&&item.packagingQty?`${fN(item.approvedQty||item.qty||0)} ${esc(item.catchWeightUom||item.unit||'كجم')} <small class="text-muted">(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(item.approvedQty||item.qty||0)}`;return `<tr><td class="fw-bold">${esc(item.itemName||item.name)}${cw?' <span class="badge bdg-blue">وزن متغير</span>':''}</td><td>${esc(item.unit||'—')}</td><td>${q}</td><td class="c-gold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;}).join('')}</tbody></table></div></div><div class="details-list"><div class="details-item"><strong>ملاحظات الطلب:</strong><div>${esc(d.notes||'—')}</div></div>${d.approveNotes?`<div class="details-item"><strong>ملاحظات الاعتماد:</strong><div>${esc(d.approveNotes)}</div></div>`:''}${d.rejectionReason?`<div class="details-item"><strong>سبب الرفض:</strong><div>${esc(d.rejectionReason)}</div></div>`:''}</div>${chefAudit}${receiptAudit}<div class="modal-footer"><button class="btn btn-gold" onclick="closeModal()">إغلاق</button></div>`);
}
function printDispatchNote(id){
const d=STATE.dispatches.find(x=>String(x.id)===String(id));
if(!d){return;}
const dept=STATE.departments.find(x=>x.code===d.deptCode);
const printWindow=window.open('','_blank');
if(!printWindow){ toast('اسمح بالنوافذ المنبثقة لطباعة إذن الصرف','warning'); return; }
const sigBlock=(label,dataUrl,who,at)=>`<div style="text-align:center;min-width:170px;flex:1">${dataUrl?`<img src="${dataUrl}" style="height:54px;object-fit:contain;margin-bottom:2px" alt="${label}">`:'<div style="height:54px"></div>'}<div style="border-top:1.5px solid #333;padding-top:5px;font-size:12px;color:#444">${label}${who?`<br><b style="color:#111">${esc(who)}</b>`:''}${at?`<br><small>${esc(at)}</small>`:''}</div></div>`;
const pItems=(d.approvedItems&&d.approvedItems.length?d.approvedItems:d.items)||[];
const pTotal=pItems.reduce((s,i)=>s+Number(i.approvedValue||0),0);
const pStatusAr={pending:'بانتظار الاعتماد',chef_approved:'معتمد من الشيف — بانتظار المخازن',approved:'معتمد من المخازن',partially_received:'مستلم جزئيًا',received:'مستلم',rejected:'مرفوض'}[d.status]||d.status||'—';
const pRow=(item,idx)=>{const cw=item.catchWeightEnabled||item.actualWeight;const qty=item.approvedQty??item.qty??0;const qtyCell=cw&&item.packagingQty?`${fN(qty)} ${esc(item.catchWeightUom||item.unit||'كجم')}<br><small>(${fN(item.packagingQty)} ${esc(item.packagingUom||'كرتون')})</small>`:`${fN(qty)} ${esc(item.unit||'')}`;const price=Number(item.avgCost)||0;return `<tr><td>${idx+1}</td><td style="text-align:right">${esc(item.name||item.itemName)}${cw?' <small>⚖ وزن متغير</small>':''}</td><td>${qtyCell}</td><td>${price?fC(price):'—'}</td><td class="c-gold fw-bold">${item.approvedValue?fC(item.approvedValue):'—'}</td></tr>`;};
const pChain=[d.createdBy?['الطلب',d.createdBy,d.date||d.requestedAt]:null,d.chefApprovedBy?['اعتماد الشيف',d.chefApprovedBy,d.chefApprovedAt]:null,d.warehouseApprovedBy?['اعتماد المخزن',d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate]:null,d.kitchenReceivedBy?['الاستلام',d.kitchenReceivedBy,d.kitchenReceivedAt]:null].filter(Boolean);
printWindow.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>إذن صرف #${d.id}</title><style>*{box-sizing:border-box}body{font-family:'Cairo',Tahoma,Arial,sans-serif;color:#1a1a1a;background:#fff;margin:0;padding:32px 36px;direction:rtl}.sheet{max-width:800px;margin:auto}.head{display:flex;align-items:center;gap:16px;border-bottom:3px double #b45309;padding-bottom:14px;margin-bottom:16px}.doc-logo{width:74px;height:74px;object-fit:contain;background:#fff;border:2px solid #d4a843;border-radius:14px;padding:5px}.head h1{margin:0;color:#7c3500;font-size:24px}.head p{margin:2px 0;color:#666;font-size:13px}.doc-title{text-align:center;margin:14px 0 4px}.doc-title h2{margin:0;font-size:21px;letter-spacing:.5px}.doc-title .st{display:inline-block;margin-top:6px;padding:3px 14px;border:1.5px solid #b45309;border-radius:20px;font-size:12px;color:#7c3500}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:14px 0}.meta div{border:1px solid #e2d5bd;border-radius:8px;padding:7px 10px;background:#fdf9f0}.meta b{display:block;color:#7c3500;font-size:11px;margin-bottom:2px}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}th,td{border:1px solid #999;padding:8px;text-align:center}th{background:#7c3500;color:#fff}td small{color:#555}tfoot td{font-weight:800;background:#fdf3df}.chain{display:flex;gap:8px;margin-top:14px}.chain div{flex:1;border:1px solid #e2d5bd;border-radius:8px;padding:6px;font-size:11px;text-align:center;background:#fdf9f0}.chain b{display:block;color:#7c3500}.notes{margin-top:12px;border:1px dashed #bbb;border-radius:8px;padding:8px 12px;font-size:13px;min-height:44px}.sigs{display:flex;gap:14px;margin-top:34px}.foot{margin-top:18px;text-align:center;font-size:11px;color:#888;border-top:1px solid #ddd;padding-top:8px}.controls{text-align:center;margin-bottom:18px}.controls button{border:0;border-radius:7px;padding:10px 26px;margin:0 5px;font:inherit;cursor:pointer;background:#b45309;color:#fff;font-weight:700}.controls button.secondary{background:#555}@media print{body{padding:0}.controls{display:none!important}@page{size:A4;margin:11mm}}</style></head><body><div class="controls"><button onclick="window.print()">🖨 طباعة</button><button class="secondary" onclick="window.close()">إغلاق</button></div><main class="sheet"><header class="head"><img class="doc-logo" src="${esc(getAbsoluteLogoSrc())}" alt="الشعار"><div><h1>${esc(STATE.settings.name||'مطاعم الشرفه العالمي')}</h1><p>نظام إدارة المخازن والمطاعم</p></div></header><div class="doc-title"><h2>إذن صرف مخزن</h2><span class="st">${esc(pStatusAr)}</span></div><section class="meta"><div><b>رقم الإذن</b>#${esc(String(d.id))}</div><div><b>القسم الطالب</b>${esc(dept?dept.name:d.deptName||'—')}</div><div><b>تاريخ الطلب</b>${esc(fD(d.date))}</div><div><b>تاريخ الاعتماد</b>${esc(d.warehouseApprovedAt||d.approvedDate?fD(d.warehouseApprovedAt||d.approvedDate):'—')}</div></section><table><thead><tr><th style="width:36px">#</th><th>الصنف</th><th>الكمية المعتمدة</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>${pItems.map(pRow).join('')||'<tr><td colspan="5">لا أصناف</td></tr>'}</tbody><tfoot><tr><td colspan="4">الإجمالي (${pItems.length} صنف)</td><td>${fC(pTotal)}</td></tr></tfoot></table>${pChain.length?`<section class="chain">${pChain.map(c=>`<div><b>${esc(c[0])}</b>${esc(c[1])}<br><small>${esc(c[2]?fDT(c[2]):'')}</small></div>`).join('')}</section>`:''}<div class="notes"><b>ملاحظات الطلب:</b> ${esc(d.notes||'—')}${d.approveNotes?`<br><b>ملاحظات الاعتماد:</b> ${esc(d.approveNotes)}`:''}${d.receiptNotes?`<br><b>ملاحظات الاستلام:</b> ${esc(d.receiptNotes)}`:''}</div><div class="sigs">${sigBlock('توقيع الطالب',null,d.createdBy,d.date)}${sigBlock('توقيع أمين المخزن',d.warehouseApprovalSignatureData,d.warehouseApprovedBy,d.warehouseApprovedAt||d.approvedDate)}${sigBlock('توقيع المستلم',d.kitchenReceiptSignatureData,d.kitchenReceivedBy,d.kitchenReceivedAt)}</div><div class="foot">مستند مخزني معتمد إلكترونيًا — ${esc(STATE.settings.name||'')} — طُبع بتاريخ ${esc(fDT(new Date().toISOString()))}</div></main></body></html>`);
printWindow.document.close();
printWindow.print();
}
// Kitchen Returns
function showKitchenReturnModal(){
const approvedDispatches = STATE.dispatches.filter(d=>d.status==='approved');
if(!approvedDispatches.length){
/* إرجاع مباشر: بلا إذن صرف مسبق — القسم + أصناف المخزون */
const depts=(STATE.departments||[]).filter(d=>!String(d.code||'').startsWith('ys_') && d.code !== 'kitchen' && d.code !== 'external_sales' && d.parent_code !== 'kitchen');
const deptField=isDeptHead()
? `<input type="hidden" id="returnDeptDirect" value="${esc(myDeptCode()||'')}"><div class="fg"><label>القسم المُرجِع</label><input type="text" value="${esc(deptNameByCode(myDeptCode()))}" readonly disabled></div>`
: `<div class="fg"><label>القسم المُرجِع</label><select id="returnDeptDirect" class="u-input">${depts.map((d,i)=>`<option value="${esc(d.code)}" ${i===0?'selected':''}>${esc(d.name||d.code)}</option>`).join('')}</select></div>`;
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (رصيد ${fN(i.qty)} ${esc(i.unit||'')})</option>`).join('');
showModal(`
<h3><i class=ji data-i=undo></i> إرجاع مباشر للمخزن</h3>
<div class="workflow-banner">لا توجد طلبات صرف معتمدة — سيُسجَّل إرجاعًا مباشرًا من القسم إلى المخزن الرئيسي مع عكس مصروف القسم.</div>
${deptField}
<div class="fg"><label>سبب الإرجاع</label>
<select id="returnReason" class="u-input">
<option value="فائض إنتاج">فائض إنتاج</option>
<option value="تغيير قائمة">تغيير قائمة</option>
<option value="انتهاء الوردية">انتهاء الوردية</option>
<option value="خطأ في الصرف">خطأ في الصرف</option>
<option value="أخرى">أخرى</option>
</select></div>
<div id="returnItemsContainer"><div class="edit-row-item">
<select class="ret-item-name u-input-f2">${invOpts||'<option value="">لا أصناف بالمخزن</option>'}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>
</div></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addDirectReturnItemField()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitDirectReturn()"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
`);
return;
}
showModal(`
<h3><i class=ji data-i=undo></i> إرجاع من المطبخ للمخزن</h3>
<div class="fg"><label>طلب الصرف</label>
<select id="returnDispatch" class="u-input">
${approvedDispatches.map(d=>`<option value="${d.id}">#${d.id} - ${esc(d.deptName)} - ${fD(d.date)}</option>`).join('')}
</select></div>
<div class="fg"><label>سبب الإرجاع</label>
<select id="returnReason" class="u-input">
<option value="فائض إنتاج">فائض إنتاج</option>
<option value="تغيير قائمة">تغيير قائمة</option>
<option value="انتهاء الوردية">انتهاء الوردية</option>
<option value="خطأ في الصرف">خطأ في الصرف</option>
<option value="أخرى">أخرى</option>
</select></div>
<div id="returnItemsContainer"></div>
<button type="button" class="btn btn-blue btn-sm u-mt8" onclick="addReturnItemField()"><i class=ji data-i=plus></i> إضافة صنف</button>
<div class="fg u-mt16"><label>ملاحظات</label><textarea id="returnNotes" rows="2"></textarea></div>
<div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="submitKitchenReturn()"><i class=ji data-i=undo></i> تأكيد الإرجاع</button></div>
`);
refreshReturnItems();
document.getElementById('returnDispatch').addEventListener('change',refreshReturnItems);
}
function refreshReturnItems(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>d.id==dispatchId);
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
container.innerHTML = `<div class="edit-row-item">
<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>
</div>`;
}
function addReturnItemField(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>d.id==dispatchId);
const container = document.getElementById('returnItemsContainer');
if(!container||!dispatch){return;}
const items = dispatch.approvedItems || dispatch.items || [];
const options = items.map(i=>`<option value="${esc(i.itemName)}" data-unit="${esc(i.unit)}" data-max="${i.approvedQty||i.qty}">${esc(i.itemName)} (${fN(i.approvedQty||i.qty)} ${i.unit})</option>`).join('');
const div = document.createElement('div');
div.className = 'edit-row-item';
div.innerHTML = `<select class="ret-item-name u-input-f2">${options}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>`;
container.appendChild(div);
}
function addDirectReturnItemField(){
const container=document.getElementById('returnItemsContainer');
if(!container){return;}
const invOpts=(STATE.inventory||[]).map(i=>`<option value="${esc(i.name)}">${esc(i.name)} (رصيد ${fN(i.qty)} ${esc(i.unit||'')})</option>`).join('');
const div=document.createElement('div');
div.className='edit-row-item';
div.innerHTML=`<select class="ret-item-name u-input-f2">${invOpts}</select>
<input type="number" class="ret-item-qty u-input-f1" placeholder="الكمية" min="0.01" step="0.01">
<button type="button" class="btn btn-sm btn-red" onclick="this.closest('.edit-row-item').remove()"><i class=ji data-i=x></i></button>`;
container.appendChild(div);
}
async function submitDirectReturn(){
const deptCode=document.getElementById('returnDeptDirect')?.value;
const reason=document.getElementById('returnReason')?.value;
const notes=document.getElementById('returnNotes')?.value.trim();
if(!deptCode){ toast('اختر القسم المُرجِع','error'); return; }
const items=[];
document.querySelectorAll('#returnItemsContainer .edit-row-item').forEach(row=>{
const name=row.querySelector('.ret-item-name')?.value;
const qty=parseFloat(row.querySelector('.ret-item-qty')?.value)||0;
if(name&&qty>0){items.push({name,qty});}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
try{
const result=await apiFetch('/warehouse/returns',{method:'POST',body:JSON.stringify({deptCode,reason,notes,items})});
upsertStateEntity('kitchenReturns',result.return);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تم الإرجاع المباشر وإعادة ${fC(result.totalValue||0)} للمخزن`,'success');
}catch(e){ toast(e.message||'تعذر تنفيذ الإرجاع','error'); }
}
async function submitKitchenReturn(){
const dispatchId = document.getElementById('returnDispatch')?.value;
const dispatch = STATE.dispatches.find(d=>String(d.id)===String(dispatchId));
const reason = document.getElementById('returnReason')?.value;
const notes = document.getElementById('returnNotes')?.value.trim();
if(!dispatch){ toast('اختر طلب صرف','error'); return; }
const items = [];
// Rows are created with class 'edit-row-item' (refreshReturnItems/addReturnItemField) —
// the old '.return-item' selector matched nothing, so kitchen returns were impossible.
document.querySelectorAll('#returnItemsContainer .edit-row-item').forEach(row=>{
const name = row.querySelector('.ret-item-name')?.value;
const qty = parseFloat(row.querySelector('.ret-item-qty')?.value)||0;
if(name && qty>0) {items.push({name,qty});}
});
if(items.length===0){ toast('أضف صنفًا واحدًا على الأقل','error'); return; }
try{
const result=await apiFetch('/warehouse/returns',{method:'POST',body:JSON.stringify({dispatchId,reason,notes,items})});
upsertStateEntity('kitchenReturns',result.return);
(result.stockChanges||[]).forEach(row=>upsertStateEntity('inventory',row));
(result.transactions||[]).forEach(row=>upsertStateEntity('inventoryTx',row));
(result.expenses||[]).forEach(row=>upsertStateEntity('expenses',row));
closeModal(); renderPage();
toast(`تم الإرجاع وإعادة ${fC(result.totalValue||0)} للمخزن وعكس مصروف القسم`,'success');
addNotification('إرجاع للمخزن',`تم عكس مصروف القسم من طلب الصرف #${dispatch.id}`,'success');
}catch(e){ toast(e.message||'تعذر تنفيذ الإرجاع','error'); }
}
// ============================================
// RECIPES
// ============================================
async function syncRecipeToCashier(recipeId){
  try {
    const result = await apiFetch('/pos/recipes/sync-legacy', {method:'POST', body:JSON.stringify({recipe_id:recipeId})});
    return result?.product || null;
  } catch (e) {
    console.warn('[recipe-sync]', e);
    toast('تم حفظ الوصفة لكن تعذر مزامنتها مع الكاشير','warning');
    return null;
  }
}
function renderRecipes(){
if(!checkMenuAccessLocal('recipes')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
return `<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=utensils></i> الوصفات</h3><button class="btn btn-gold" onclick="showAddRecipeModal()"><i class=ji data-i=plus></i> وصفة جديدة</button></div><div class="dept-grid">${STATE.recipes.map(r=>{const d=STATE.departments.find(x=>x.code===r.deptId), catalog=recipeCatalogRow(r.id);return `<div class="mcard recipe-card">${catalog.image_url?`<img class="recipe-thumb" src="${esc(catalog.image_url)}" alt="${esc(r.name)}" loading="lazy">`:''}<div><div class="recipe-name">${esc(r.name)}</div>${d?`<div class="recipe-dept">${deptIcon(d)} ${esc(d.name)}</div>`:''}</div><div class="dept-stats"><div class="dstat"><div class="dstat-lbl">سعر البيع</div><div class="dstat-val c-green">${fC(r.sellingPrice)}</div></div><div class="dstat"><div class="dstat-lbl">التكلفة</div><div class="dstat-val c-red">${fC(r.totalCost)}</div></div><div class="dstat"><div class="dstat-lbl">نسبة التكلفة</div><div class="dstat-val c-orange">${fN(Number(r.costRatio || 0).toFixed(1))}%</div></div></div><div class="fr"><button class="btn btn-gold btn-sm" onclick="openRecipeManager('${r.id}')"><i class=ji data-i=settings></i> المكونات والصورة</button><button class="btn btn-sm" onclick="editRecipe('${r.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteRecipe('${r.id}')"><i class=ji data-i=trash></i></button></div></div>`;}).join('')||'<div class="mcard u-empty">لا توجد وصفات</div>'}</div>`;
}
let recipeManagerState = { recipeId:null, productId:null, recipe:null, ingredients:[], inventory:[], unitOptions:[] };
function recipeCatalogRow(recipeId){ return STATE.recipeCatalog?.[String(recipeId)] || {}; }
function recipeUnitInfo(value){ return recipeManagerState.unitOptions.find(x => x.value === value) || {value, label:value || 'وحدة', family:value === 'g' || value === 'kg' ? 'mass' : value === 'ml' || value === 'l' ? 'volume' : 'count', factor:value === 'kg' || value === 'l' ? 1000 : 1}; }
function recipeNormalizeUnit(value){ const v=String(value||'').trim().toLowerCase(); const aliases={كيلو:'kg',كجم:'kg',كغ:'kg',كيلوجرام:'kg',جرام:'g',غرام:'g',جم:'g',لتر:'l',مل:'ml',وحدة:'piece',قطعة:'piece',حبة:'piece'}; return aliases[v]||v||'piece'; }
function recipeConvertQty(qty, from, to, inventory={}){ const a=recipeUnitInfo(recipeNormalizeUnit(from)), b=recipeUnitInfo(recipeNormalizeUnit(to)), n=Number(qty||0); if(a.family===b.family) {return n*Number(a.factor||1)/Number(b.factor||1);} if((a.family==='mass'&&b.family==='volume')||(a.family==='volume'&&b.family==='mass')){ const weight=Number(inventory?.weight||0)||((b.value==='l')?1:0); if(!(weight>0)) {throw new Error('وحدات غير متوافقة');} const massGrams=weight*1000; return a.family==='mass' ? n*Number(a.factor||1)/massGrams : n*Number(a.factor||1)*massGrams; } throw new Error('وحدات غير متوافقة'); }
function recipeDefaultUnit(inv){ const u=recipeNormalizeUnit(inv?.unit); return recipeManagerState.unitOptions.some(x=>x.value===u) ? u : 'piece'; }
function recipeManagerCost(){ return recipeManagerState.ingredients.reduce((sum,item)=>{ const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(item.inventory_id)); try { const q=recipeConvertQty(item.quantity_per_unit,item.unit,inv?.unit,inv); return sum + q*(1+Number(item.waste_percent||0)/100)*Number(inv?.avgCost||inv?.avg_cost||0); } catch (_) { return sum; } },0); }
function renderRecipeManagerIngredients(){
 const host=document.getElementById('recipe-manager-ingredients'); if(!host){return;}
 host.innerHTML=recipeManagerState.ingredients.map((item,index)=>{ const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(item.inventory_id))||{}; let lineCost=0, converted='—'; try { const q=recipeConvertQty(item.quantity_per_unit,item.unit,inv.unit,inv); lineCost=q*(1+Number(item.waste_percent||0)/100)*Number(inv.avgCost||0); converted=`${fN(q)} ${esc(inv.unit||'وحدة')}`; } catch (_) { lineCost=NaN; }
 const invFamily=recipeUnitInfo(recipeNormalizeUnit(inv.unit)).family; const currentQty=Number(item.quantity_per_unit||0); const portionControl=invFamily==='count'?`<label class="recipe-portion-field"><span>حصة الاستخدام</span><select onchange="updateRecipeManagerPortion(${index},this.value)"><option value="custom" ${![0.25,0.5,1].includes(currentQty)?'selected':''}>كمية مخصصة</option><option value="0.25" ${currentQty===0.25?'selected':''}>ربع حبة (0.25)</option><option value="0.5" ${currentQty===0.5?'selected':''}>نصف حبة (0.50)</option><option value="1" ${currentQty===1?'selected':''}>حبة كاملة (1)</option></select></label>`:''; const units=recipeManagerState.unitOptions.filter(u=>!inv.unit || u.family===invFamily || (invFamily==='volume'&&u.family==='mass') || (invFamily==='mass'&&u.family==='volume')).map(u=>`<option value="${u.value}" ${recipeNormalizeUnit(item.unit)===u.value?'selected':''}>${esc(u.label)}</option>`).join('');
 return `<article class="recipe-ingredient-card"><div class="recipe-ingredient-main"><div class="recipe-ingredient-title"><span class="recipe-ingredient-icon"><i class=ji data-i=utensils></i></span><div><strong>${esc(inv.name||item.inventory_name||'مكون')}</strong><small>تكلفة ${fC(inv.avgCost||0)} لكل ${esc(inv.unit||'وحدة')}</small></div></div><button class="btn btn-red btn-sm recipe-delete-ingredient" onclick="removeRecipeManagerIngredient(${index})">حذف</button></div><div class="recipe-ingredient-fields">${portionControl}<label><span>الكمية المستخدمة</span><input type="number" min="0.0001" step="0.0001" value="${Number(item.quantity_per_unit||0)}" oninput="updateRecipeManagerQty(${index},this.value)" aria-label="كمية المكون"></label><label><span>وحدة الاستخدام</span><select onchange="updateRecipeManagerUnit(${index},this.value)" aria-label="وحدة المكون">${units}</select></label><label><span>الهدر %</span><input type="number" min="0" max="100" step="0.01" value="${Number(item.waste_percent||0)}" oninput="updateRecipeManagerWaste(${index},this.value)" aria-label="هدر المكون"></label></div><div class="recipe-ingredient-result"><span>سيُخصم من المخزن: <b>${converted}</b></span><strong>${Number.isFinite(lineCost)?fC(lineCost):'وحدات غير متوافقة'}</strong></div></article>`}).join('')||'<div class="text-muted" style="padding:18px;text-align:center">لم تتم إضافة مكونات بعد</div>';
 const count=document.getElementById('recipe-components-count'); if(count) {count.textContent=`${recipeManagerState.ingredients.length} مكونات`;} const cost=recipeManagerCost(), price=Number(recipeManagerState.recipe?.sellingPrice||0), profit=price-cost, margin=price>0?profit/price*100:0; const total=document.getElementById('recipe-manager-total-cost'); if(total){total.innerHTML=fC(cost);} const profitEl=document.getElementById('recipe-manager-profit'); if(profitEl){profitEl.innerHTML=`${fC(profit)} <small>(${fN(margin.toFixed(1))}%)</small>`;} const suggested=document.getElementById('recipe-manager-suggested-price'); if(suggested) {suggested.innerHTML=fC(cost/(1-0.30)||0);}
}
function updateRecipeManagerPortion(index,value){ if(value!=='custom'&&recipeManagerState.ingredients[index]){ recipeManagerState.ingredients[index].quantity_per_unit=Number(value); recipeManagerState.ingredients[index].unit='piece'; } renderRecipeManagerIngredients(); }
function updateRecipeManagerQty(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].quantity_per_unit=Number(value||0);} renderRecipeManagerIngredients(); }
function updateRecipeManagerUnit(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].unit=value;} renderRecipeManagerIngredients(); }
function updateRecipeManagerWaste(index,value){ if(recipeManagerState.ingredients[index]){recipeManagerState.ingredients[index].waste_percent=Number(value||0);} renderRecipeManagerIngredients(); }
function removeRecipeManagerIngredient(index){ recipeManagerState.ingredients.splice(index,1); renderRecipeManagerIngredients(); }
function addRecipeManagerIngredient(){ const id=document.getElementById('recipe-manager-inventory')?.value; if(!id){return;} if(recipeManagerState.ingredients.some(x=>String(x.inventory_id)===String(id))){toast('هذا المكون موجود بالفعل','warning');return;} const inv=recipeManagerState.inventory.find(x=>String(x.id)===String(id)); recipeManagerState.ingredients.push({inventory_id:Number(id),inventory_name:inv?.name,inventory_unit:inv?.unit,quantity_per_unit:1,unit:recipeDefaultUnit(inv),waste_percent:0,notes:null}); renderRecipeManagerIngredients(); }
async function uploadRecipeManagerImage(){ const file=document.getElementById('recipe-manager-image')?.files?.[0]; if(!recipeManagerState.productId){toast('احفظ الوصفة أولاً قبل رفع الصورة','warning');return;} if(!file){toast('اختر صورة أولاً','warning');return;} const form=new FormData();form.append('image',file);showLoad();try{const res=await fetch(`${API_BASE}/pos/products/${recipeManagerState.productId}/image`,{method:'POST',headers:window._jwt?{Authorization:`Bearer ${window._jwt}`}:{},body:form});const data=await res.json().catch(()=>({}));if(!res.ok){throw new Error(data.message||data.error||'تعذر رفع الصورة');}const row=recipeCatalogRow(recipeManagerState.recipeId);row.image_url=data.image_url;STATE.recipeCatalog[String(recipeManagerState.recipeId)]=row;const img=document.getElementById('recipe-manager-image-preview');if(img){img.innerHTML=`<img src="${esc(data.image_url)}" alt="صورة الوصفة">`;}toast('تم حفظ صورة الوصفة في قاعدة البيانات');}catch(e){toast(e.message||'تعذر رفع الصورة','error')}finally{hideLoad();}}
async function openRecipeManager(recipeId){try{showLoad();const sync=await apiFetch('/pos/recipes/sync-legacy',{method:'POST',body:JSON.stringify({recipe_id:recipeId})});const productId=sync.product?.id;if(!productId){throw new Error('تعذر إنشاء صنف الكاشير للوصفة');}const [ingredients,inventory,unitOptions]=await Promise.all([apiFetch(`/pos/products/${productId}/ingredients`),apiFetch('/pos/ingredients'),apiFetch('/pos/recipe-units')]);recipeManagerState={recipeId,productId,recipe:STATE.recipes.find(r=>String(r.id)===String(recipeId)),ingredients:Array.isArray(ingredients)?ingredients:[],inventory:Array.isArray(inventory)?inventory:[],unitOptions:Array.isArray(unitOptions)?unitOptions:[]};const catalog=recipeCatalogRow(recipeId);catalog.product_id=productId;catalog.image_url=sync.product.image_url||catalog.image_url;STATE.recipeCatalog[String(recipeId)]=catalog;const options=recipeManagerState.inventory.map(i=>`<option value="${i.id}">${esc(i.name)} — ${fN(i.avgCost||0)} ${STATE.settings.currency} / ${esc(i.unit||'وحدة')}</option>`).join('');showModal(`<div class="recipe-editor-shell"><header class="recipe-editor-header"><div><span class="recipe-editor-kicker">إدارة قائمة الطعام</span><h3><i class=ji data-i=utensils></i> ${esc(recipeManagerState.recipe?.name||'وصفة جديدة')}</h3><p>اضبط الصورة والمكونات والتكلفة من المخزن في مكان واحد.</p></div><button class="recipe-editor-close" onclick="closeModal()" aria-label="إغلاق">×</button></header><section class="recipe-editor-top"><div class="recipe-editor-media"><div id="recipe-manager-image-preview" class="recipe-image-preview">${catalog.image_url?`<img src="${esc(catalog.image_url)}" alt="صورة الوصفة">`:'<div class="recipe-image-empty"><span><i class=ji data-i=camera></i></span><b>لا توجد صورة</b><small>أضف صورة الوجبة لتمييزها في الكاشير</small></div>'}</div><div class="recipe-image-actions"><label class="recipe-file-label">اختيار صورة<input id="recipe-manager-image" type="file" accept="image/jpeg,image/png,image/webp"></label><button class="btn btn-gold" onclick="uploadRecipeManagerImage()">رفع الصورة</button></div></div><div class="recipe-editor-stats"><div class="recipe-stat"><span>سعر البيع</span><strong>${fC(recipeManagerState.recipe?.sellingPrice||0)}</strong></div><div class="recipe-stat"><span>تكلفة الوجبة</span><strong id="recipe-manager-total-cost">0</strong></div><div class="recipe-stat recipe-stat-profit"><span>الربح المتوقع</span><strong id="recipe-manager-profit">0</strong></div><div class="recipe-stat recipe-stat-suggested"><span>سعر مقترح · نسبة تكلفة 30%</span><strong id="recipe-manager-suggested-price">0</strong></div></div></section><section class="recipe-editor-section"><div class="recipe-section-heading"><div><span class="recipe-step">01</span><div><h4>إضافة مكونات الوجبة</h4><p>اختر الصنف من المخزن ثم حدد الكمية ووحدة الاستخدام.</p></div></div><span class="recipe-live-badge">حساب مباشر</span></div><div class="recipe-editor-add"><select id="recipe-manager-inventory"><option value="">اختر مكونًا من المخزن</option>${options}</select><button class="btn btn-gold" onclick="addRecipeManagerIngredient()"><i class=ji data-i=plus></i> إضافة مكون</button></div></section><section class="recipe-editor-section recipe-components-section"><div class="recipe-section-heading"><div><span class="recipe-step">02</span><div><h4>مكونات الوصفة</h4><p>كل تكلفة محسوبة بعد التحويل إلى وحدة المخزن.</p></div></div><span class="recipe-components-count" id="recipe-components-count"></span></div><div id="recipe-manager-ingredients" class="recipe-ingredients-list"></div></section><footer class="recipe-editor-footer"><button class="btn recipe-cancel-btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold recipe-save-btn" onclick="saveRecipeManager()">حفظ الوصفة والتكلفة</button></footer></div>`,'recipe-manager-modal');renderRecipeManagerIngredients();}catch(e){toast(e.message||'تعذر فتح إدارة الوصفة','error')}finally{hideLoad();}}
async function saveRecipeManager(){const invalid=recipeManagerState.ingredients.some(x=>!Number.isFinite(Number(x.quantity_per_unit))||Number(x.quantity_per_unit)<=0);if(invalid){toast('كل كميات المكونات يجب أن تكون أكبر من صفر','error');return;}try{showLoad();const result=await apiFetch(`/pos/products/${recipeManagerState.productId}/ingredients`,{method:'PUT',body:JSON.stringify({ingredients:recipeManagerState.ingredients})});const recipe=recipeManagerState.recipe,totalCost=Number(result.total_cost||recipeManagerCost()),price=Number(recipe.sellingPrice||0);const saved=await persistUpdate('recipes',recipe.id,{name:recipe.name,deptId:recipe.deptId,sellingPrice:price,totalCost,costRatio:price>0?totalCost/price*100:0});Object.assign(recipe,saved||{totalCost,costRatio:price>0?totalCost/price*100:0});closeModal();await loadData();renderPage();toast(`تم حفظ التكلفة ${fN(totalCost)} ${STATE.settings.currency} والربح ${fN(price-totalCost)} ${STATE.settings.currency}`);}catch(e){toast(e.message||'تعذر حفظ مكونات الوصفة','error')}finally{hideLoad();}}
function showAddRecipeModal(){
const deptOpts=STATE.departments.map(d=>`<option value="${d.code}">${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=plus></i> إضافة وصفة</h3><div class="fg"><label>اسم الوصفة</label><input type="text" id="recipeName"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" step="0.01"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="addRecipe()"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function addRecipe(){
const name=document.getElementById('recipeName')?.value.trim(),
deptId=document.getElementById('recDept')?.value,
price=parseFloat(document.getElementById('recipePrice')?.value)||0,
cost=parseFloat(document.getElementById('recCost')?.value)||0;
if(!name){ toast('أدخل اسم الوصفة','error'); return; }
const costRatio=price>0?(cost/price*100):0;
let savedRecipe;
await persistCreate('recipes', (saved)=>{ savedRecipe=saved; STATE.recipes.push(saved); }, {id:uid(),name,deptId,sellingPrice:price,totalCost:cost,costRatio});
if(savedRecipe?.id) {await syncRecipeToCashier(savedRecipe.id);}
closeModal(); renderPage();
toast('تم إضافة الوصفة');
}
function editRecipe(id){
const r=STATE.recipes.find(x=>String(x.id)===String(id));
if(!r){return;}
const deptOpts=STATE.departments.map(d=>`<option value="${d.code}" ${r.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل وصفة</h3><div class="fg"><label>الاسم</label><input type="text" id="recipeName" value="${esc(r.name)}"></div><div class="fr"><div class="fg"><label>القسم</label><select id="recDept">${deptOpts}</select></div><div class="fg"><label>سعر البيع</label><input type="number" id="recipePrice" value="${r.sellingPrice}" step="0.01"></div></div><div class="fg"><label>التكلفة</label><input type="number" id="recCost" value="${r.totalCost}" step="0.01"></div><div class="modal-footer"><button class="btn" onclick="closeModal()">إلغاء</button><button class="btn btn-gold" onclick="updateRecipe('${id}')"><i class=ji data-i=save></i> حفظ</button></div>`);
}
async function updateRecipe(id){
const r=STATE.recipes.find(x=>String(x.id)===String(id));
if(!r){return;}
const name=document.getElementById('recipeName')?.value.trim();
const deptId=document.getElementById('recDept')?.value;
const sellingPrice=parseFloat(document.getElementById('recipePrice')?.value)||0;
const totalCost=parseFloat(document.getElementById('recCost')?.value)||0;
const costRatio=sellingPrice>0?(totalCost/sellingPrice*100):0;
const savedRecipe = await persistUpdate('recipes', id, {name,deptId,sellingPrice,totalCost,costRatio});
Object.assign(r, savedRecipe || {name,deptId,sellingPrice,totalCost,costRatio});
await syncRecipeToCashier(id);
closeModal(); renderPage();
toast('تم التحديث');
}
async function deleteRecipe(id){
if(!confirm('حذف الوصفة؟')){return;}
await persistRemove('recipes', id);
STATE.recipes=STATE.recipes.filter(r=>String(r.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}
// ============================================
// REVENUES & EXPENSES
// ============================================
function renderRevenues(){
if(!checkMenuAccessLocal('revenues')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const q = String(revFilterSearch||'').trim().toLowerCase();
const filtered = STATE.revenues.filter(r=>{
if(revFilterDept!=='all'&&String(r.deptId)!==revFilterDept) {return false;}
const d=String(r.date||'').slice(0,10);
if(revFilterFrom&&d<revFilterFrom) {return false;}
if(revFilterTo&&d>revFilterTo) {return false;}
if(q && !(`${r.source||''} ${r.notes||''} ${r.deptId||''}`.toLowerCase().includes(q))) {return false;}
return true;
});
const totalRev = filtered.reduce((s,r)=>s+Number(r.amount||0),0);
const hasFilter=revFilterDept!=='all'||revFilterFrom||revFilterTo||q;
const deptOpts=STATE.departments.map(d=>`<option value="${esc(d.code)}" ${revFilterDept===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=banknote></i> ${t('pg.revenues')}</h3><div class="u-row-wrap"><button class="btn btn-blue btn-sm" onclick="revPrintFiltered()"><i class=ji data-i=printer></i> طباعة</button><button class="btn btn-gold btn-sm" onclick="showAddRevenueModal()"><i class=ji data-i=plus></i> ${t('rev.add')}</button></div></div><div class="fr" style="align-items:end;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div class="fg"><label>${t('exp.dept')}</label><select onchange="revFilterDept=this.value;renderPage()"><option value="all" ${revFilterDept==='all'?'selected':''}>${t('exp.allDepts')}</option>${deptOpts}</select></div><div class="fg"><label>${t('exp.fromDate')}</label><input type="date" value="${revFilterFrom}" onchange="revFilterFrom=this.value;renderPage()"></div><div class="fg"><label>${t('exp.toDate')}</label><input type="date" value="${revFilterTo}" onchange="revFilterTo=this.value;renderPage()"></div><div class="fg"><label>بحث</label><input type="text" placeholder="المصدر أو ملاحظات..." value="${esc(revFilterSearch)}" oninput="revFilterSearch=this.value;renderPage();const s=document.getElementById('revSearchBox');if(s){s.focus();s.setSelectionRange(s.value.length,s.value.length);}" id="revSearchBox"></div>${hasFilter?`<button class="btn btn-sm" onclick="revFilterDept='all';revFilterFrom='';revFilterTo='';revFilterSearch='';renderPage()"><i class=ji data-i=rotate-ccw></i> ${t('exp.clearFilter')}</button>`:''}<div class="mcard" style="padding:8px 14px;margin-inline-start:auto"><div class="mcard-label" style="font-size:11px">${t('exp.netShown')} (${fN(filtered.length)} ${t('exp.items')})</div><div class="mcard-val c-gold" style="font-size:18px">${fC(totalRev)}</div></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('rev.source')}</th><th>${t('rev.dept')}</th><th>${t('rev.amount')}</th><th>${t('rev.date')}</th><th>${t('rev.notes')}</th><th></th></tr></thead><tbody>${filtered.slice().reverse().map((r,i)=>{const d=STATE.departments.find(x=>x.code===r.deptId);return `<tr><td>${filtered.length-i}</td><td class="fw-bold">${esc(r.source)}</td><td class="c-gold">${d?`${deptIcon(d)} ${esc(d.name)}`:'—'}</td><td class="c-gold fw-bold">${fC(r.amount)}</td><td class="text-muted">${fD(r.date)}</td><td class="text-muted"><span class="revenue-note-clean">${esc(formatRevenueNote(r.notes||r.source||'—'))}</span></td><td><button class="btn btn-sm" onclick="editRevenue('${r.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteRevenue('${r.id}')"><i class=ji data-i=trash></i></button></td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">' + t('rev.noData') + '</td></tr>'}</tbody><tfoot><tr><td colspan="4" class="u-num-l"><i class=ji data-i=banknote></i> ${t('rev.total')}</td><td colspan="3" class="c-gold fw-bold">${fC(totalRev)}</td></tr></tfoot></table></div></div>`;
}
const revFilterDept='all',revFilterFrom='',revFilterTo='',revFilterSearch='';
let whCatFilter='all';
let whShortFilter='all'; // all | out | low — فلتر لوحة النواقص الشاملة
async function refreshWhShortages(silent){
try{
const rows=await apiFetch('/warehouse/purchase-requests/shortages');
const invById=new Map((STATE.inventory||[]).map(i=>[String(i.id),i]));
STATE._whShort=(Array.isArray(rows)?rows:[]).map(s=>{
const it=invById.get(String(s.itemId))||{};
const qty=Number(s.currentQty||0), min=Number(s.minQty||0), cost=Number(it.avgCost||0);
return { id:s.itemId, name:s.itemName||it.name||'—', unit:s.unit||it.unit||'', qty, min, cost,
category:it.category||'عام', gap:Math.max(0,min-qty), gapVal:Math.max(0,min-qty)*cost,
noCost:!(cost>0), out:qty<=0 };
});
STATE._whShortAt=new Date().toISOString();
}catch(e){ if(!silent){toast(e.message||'تعذر جلب النواقص','error');} }
if(STATE.page==='warehouse'){renderPage();}
}
function whPrintShortages(){
const rows=whShortRows();
const out=rows.filter(r=>r.out).length;
const refill=rows.reduce((s,r)=>s+r.gapVal,0);
const noCost=rows.filter(r=>r.noCost&&r.gap>0).length;
ysPrintReport('كشف نواقص المخزن الشامل', `${rows.length} صنفًا (نافذ ${out} • منخفض ${rows.length-out})${noCost?` • ${noCost} بلا تكلفة مدخلة`:''}`,
[['الأصناف الناقصة',fN(rows.length)],['نافذ تمامًا',fN(out)],['قيمة التعبئة حتى الحد',noCost&&refill<=0?'— (التكلفة غير مدخلة)':fC(refill)]],
['#','الصنف','الفئة','الوحدة','الرصيد','الحد الأدنى','العجز','قيمة العجز','الحالة'],
rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.name)}</td><td>${esc(r.category)}</td><td>${esc(r.unit)}</td><td>${fN(r.qty)}</td><td>${fN(r.min)}</td><td>${fN(r.gap)}</td><td>${r.noCost&&r.gap>0?'—':fC(r.gapVal)}</td><td>${r.out?'نافذ':'منخفض'}</td></tr>`).join(''));
}
function whShortRows(){
const all=STATE._whShort||[];
if(whShortFilter==='out'){return all.filter(r=>r.out);}
if(whShortFilter==='low'){return all.filter(r=>!r.out);}
return all;
}
function whShortPanel(){
const all=STATE._whShort;
if(!all){ if(!STATE._whShortLoading){STATE._whShortLoading=true; setTimeout(()=>refreshWhShortages(true).finally(()=>{STATE._whShortLoading=false;}),0);} return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> كل الأصناف الناقصة وخلاصة المخزن</h3></div><div class="mcard u-empty"><div class="spinner"></div></div></div>`; }
const out=all.filter(r=>r.out), low=all.filter(r=>!r.out);
const totalVal=(STATE.inventory||[]).reduce((s,i)=>s+(Number(i.qty||0)*Number(i.avgCost||0)),0);
const refill=all.reduce((s,r)=>s+r.gapVal,0);
const noCostCount=all.filter(r=>r.noCost&&r.gap>0).length;
const refillTxt=noCostCount&&refill<=0?'—':fC(refill);
const rows=whShortRows();
const fBtn=(k,l)=>`<button class="btn btn-sm ${whShortFilter===k?'btn-gold':''}" onclick="whShortFilter='${k}';renderPage()">${l}</button>`;
return `<div class="tbl-wrap" style="border:2px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> كل الأصناف الناقصة وخلاصة المخزن</h3>
<div class="u-row-wrap">${fBtn('all',`الكل (${fN(all.length)})`)}${fBtn('out',`نافذ (${fN(out.length)})`)}${fBtn('low',`منخفض (${fN(low.length)})`)}
<button class="btn btn-blue btn-sm" onclick="refreshWhShortages()"><i class=ji data-i=refresh></i> تحديث</button>
<button class="btn btn-blue btn-sm" onclick="whPrintShortages()"><i class=ji data-i=printer></i> طباعة الكشف</button>
${prCanCreate()?`<button class="btn btn-gold btn-sm" onclick="openPRCreateModal()"><i class=ji data-i=shopping-cart></i> طلب شراء من النواقص</button>`:''}
</div></div>
<div class="metrics-grid" style="padding:12px 16px 0">
<div class="mcard"><div class="mcard-label">نافذ تمامًا</div><div class="mcard-val c-red">${fN(out.length)}</div></div>
<div class="mcard"><div class="mcard-label">منخفض (فوق الصفر)</div><div class="mcard-val c-orange">${fN(low.length)}</div></div>
<div class="mcard"><div class="mcard-label">قيمة التعبئة حتى الحد</div><div class="mcard-val c-gold">${refillTxt}</div></div>
<div class="mcard"><div class="mcard-label">قيمة المخزون الكلية</div><div class="mcard-val c-green">${fC(totalVal)}</div></div>
</div>
${noCostCount?`<div class="audit-banner"><i class=ji data-i=alert-triangle></i> <strong>${fN(noCostCount)} صنفًا بلا تكلفة مدخلة</strong> — قيمة التعبئة غير محسوبة لها. أدخل أسعار الشراء عند الاستلام لتظهر القيمة الحقيقية.</div>`:''}
<div class="tbl-scroll tbl-sticky-first" style="margin-top:12px"><table><thead><tr><th>#</th><th>الصنف</th><th>الفئة</th><th>الوحدة</th><th>الرصيد</th><th>الحد الأدنى</th><th>العجز</th><th>قيمة العجز</th><th>الحالة</th></tr></thead>
<tbody>${rows.map((r,i)=>`<tr><td>${i+1}</td><td class="fw-bold">${esc(r.name)}</td><td class="c-gold">${esc(r.category)}</td><td>${esc(r.unit)}</td>
<td class="c-red fw-bold">${fN(r.qty)}</td><td>${fN(r.min)}</td><td class="c-orange fw-bold">${fN(r.gap)}</td><td class="c-gold">${r.noCost&&r.gap>0?'—':fC(r.gapVal)}</td>
<td><span class="badge ${r.out?'bdg-red':'bdg-orange'}">${r.out?'⛔ نافذ':'⚠ منخفض'}</span></td></tr>`).join('')||'<tr><td colspan="9" class="u-empty-sm">لا نواقص — المخزون كله فوق الحد ✓</td></tr>'}</tbody></table></div>
<div style="padding:8px 16px"><small class="text-muted">آخر تحديث: ${STATE._whShortAt?esc(String(STATE._whShortAt).replace('T',' ').slice(0,19)):'—'} • العجز = الحد − الرصيد • قيمة العجز بمتوسط التكلفة</small></div>
</div>`;
}
function revPrintFiltered(){
const q = String(revFilterSearch||'').trim().toLowerCase();
const filtered = STATE.revenues.filter(r=>{
if(revFilterDept!=='all'&&String(r.deptId)!==revFilterDept) {return false;}
const d=String(r.date||'').slice(0,10);
if(revFilterFrom&&d<revFilterFrom) {return false;}
if(revFilterTo&&d>revFilterTo) {return false;}
if(q && !(`${r.source||''} ${r.notes||''} ${r.deptId||''}`.toLowerCase().includes(q))) {return false;}
return true;
});
const deptName = revFilterDept==='all' ? 'كل الأقسام' : (STATE.departments.find(x=>x.code===revFilterDept)?.name || revFilterDept);
const rows = filtered.slice().reverse().map((r,i)=>{const d=STATE.departments.find(x=>x.code===r.deptId);return `<tr><td>${filtered.length-i}</td><td>${esc(r.source)}</td><td>${esc(d?d.name:'—')}</td><td>${fC(r.amount)}</td><td>${esc(r.date||'')}</td></tr>`;}).join('');
ysPrintReport('كشف الإيرادات', `${deptName}${revFilterFrom||revFilterTo?` — من ${revFilterFrom||'البداية'} إلى ${revFilterTo||'اليوم'}`:''}`,
[['عدد البنود', fN(filtered.length)],['الإجمالي', fC(filtered.reduce((s,r)=>s+Number(r.amount||0),0))]],
['#','المصدر','القسم','المبلغ','التاريخ'], rows);
}
// Optional preselectedDept opens the modal with that department already selected
function showAddRevenueModal(preselectedDept){
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${preselectedDept&&d.code===preselectedDept?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=banknote></i> ${t('rev.addTitle')}</h3><div class="fg"><label>${t('rev.source')}</label><input type="text" id="revSource"></div><div class="fr"><div class="fg"><label>${t('rev.dept')}</label><select id="revDept">${opts}</select></div><div class="fg"><label>${t('rev.amount')}</label><input type="number" id="revAmount" step="0.01"></div></div><div class="fg"><label>${t('rev.date')}</label><input type="date" id="revDate" value="${today()}"></div><div class="fg"><label>${t('rev.notes')}</label><textarea id="revNotes"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="addRevenue()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function addRevenue(){
const deptId=document.getElementById('revDept')?.value,
amount=parseFloat(document.getElementById('revAmount')?.value),
date=document.getElementById('revDate')?.value,
source=document.getElementById('revSource')?.value.trim(),
notes=document.getElementById('revNotes')?.value.trim();
if(!deptId||isNaN(amount)||amount<=0||!source){ toast('بيانات غير صحيحة','error'); return; }
try{
await persistCreate('revenues', (saved)=>STATE.revenues.push(saved), {id:uid(),deptId,amount,date,source,notes});
closeModal(); renderPage();
toast('تم إضافة الإيراد');
addNotification('إيراد جديد',`تم إضافة إيراد بقيمة ${fC(amount)}`,'success');
}catch(e){ toast(e.message||'فشل حفظ الإيراد في قاعدة البيانات','error'); }
}
function editRevenue(id){
const r=STATE.revenues.find(x=>String(x.id)===String(id));
if(!r){return;}
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${r.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> ${t('rev.editTitle')}</h3><div class="fg"><label>${t('rev.source')}</label><input type="text" id="revSource" value="${esc(r.source)}"></div><div class="fr"><div class="fg"><label>${t('rev.dept')}</label><select id="revDept">${opts}</select></div><div class="fg"><label>${t('rev.amount')}</label><input type="number" id="revAmount" value="${r.amount}" step="0.01"></div></div><div class="fg"><label>${t('rev.date')}</label><input type="date" id="revDate" value="${r.date}"></div><div class="fg"><label>${t('rev.notes')}</label><textarea id="revNotes">${esc(r.notes||'')}</textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="updateRevenue('${id}')"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function updateRevenue(id){
const r=STATE.revenues.find(x=>String(x.id)===String(id));
if(!r){return;}
const deptId=document.getElementById('revDept')?.value;
const amount=parseFloat(document.getElementById('revAmount')?.value);
const date=document.getElementById('revDate')?.value;
const source=document.getElementById('revSource')?.value.trim();
const notes=document.getElementById('revNotes')?.value.trim();
try{
const saved = await persistUpdate('revenues', id, {deptId,amount,date,source,notes});
Object.assign(r, saved || {deptId,amount,date,source,notes});
closeModal(); renderPage();
toast('تم التحديث');
}catch(e){ toast(e.message||'فشل تحديث الإيراد في قاعدة البيانات','error'); }
}
async function deleteRevenue(id){
if(!confirm('حذف هذا الإيراد؟')){return;}
try{
await persistRemove('revenues', id);
STATE.revenues=STATE.revenues.filter(x=>String(x.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}catch(e){ toast(e.message||'فشل الحذف من قاعدة البيانات','error'); }
}
function renderExpenses(){
if(!checkMenuAccessLocal('expenses')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const filtered=STATE.expenses.filter(e=>{
if(expenseFilterDept!=='all'&&String(e.deptId)!==expenseFilterDept) {return false;}
const d=String(e.date||'').slice(0,10);
if(expenseFilterFrom&&d<expenseFilterFrom) {return false;}
if(expenseFilterTo&&d>expenseFilterTo) {return false;}
return true;
});
const filteredTotal=filtered.reduce((s,e)=>s+Number(e.amount||0),0);
const hasFilter=expenseFilterDept!=='all'||expenseFilterFrom||expenseFilterTo;
const deptOpts=STATE.departments.map(d=>`<option value="${esc(d.code)}" ${expenseFilterDept===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
return `<div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=wallet></i> ${t('pg.expenses')}</h3><button class="btn btn-gold btn-sm" onclick="showAddExpenseModal()"><i class=ji data-i=plus></i> ${t('exp.add')}</button></div><div class="fr" style="align-items:end;padding:10px 14px;border-bottom:1px solid var(--border);flex-wrap:wrap"><div class="fg"><label>${t('exp.dept')}</label><select onchange="expenseFilterDept=this.value;renderPage()"><option value="all" ${expenseFilterDept==='all'?'selected':''}>${t('exp.allDepts')}</option>${deptOpts}</select></div><div class="fg"><label>${t('exp.fromDate')}</label><input type="date" value="${expenseFilterFrom}" onchange="expenseFilterFrom=this.value;renderPage()"></div><div class="fg"><label>${t('exp.toDate')}</label><input type="date" value="${expenseFilterTo}" onchange="expenseFilterTo=this.value;renderPage()"></div>${hasFilter?`<button class="btn btn-sm" onclick="expenseFilterDept='all';expenseFilterFrom='';expenseFilterTo='';renderPage()"><i class=ji data-i=rotate-ccw></i> ${t('exp.clearFilter')}</button>`:''}<div class="mcard" style="padding:8px 14px;margin-inline-start:auto"><div class="mcard-label" style="font-size:11px">${t('exp.netShown')} (${fN(filtered.length)} ${t('exp.items')})</div><div class="mcard-val ${filteredTotal<0?'c-green':'c-red'}" style="font-size:18px">${fC(filteredTotal)}</div></div></div><div class="tbl-scroll"><table><thead><tr><th>#</th><th>${t('exp.desc')}</th><th>${t('exp.dept')}</th><th>${t('exp.amount')}</th><th>${t('exp.type')}</th><th>${t('exp.date')}</th><th></th></tr></thead><tbody>${filtered.slice().reverse().map((e,i)=>{const d=STATE.departments.find(x=>x.code===e.deptId);const isAuto=e.autoGenerated;const amountClass=Number(e.amount||0)<0?'c-green':'c-red';const typeLabel=isCountCorrectionExpense(e)?'<i class=ji data-i=clipboard-list></i> فرق جرد':isStockMovementExpense(e)?(Number(e.amount||0)<0?'<i class=ji data-i=undo></i> عكس صرف':'<i class=ji data-i=zap></i> صرف مخزون'):isAuto?'<i class=ji data-i=zap></i> تلقائي':'<i class=ji data-i=pen-tool></i> يدوي';const badgeClass=isCountCorrectionExpense(e)?'bdg-blue':typeLabel==='<i class=ji data-i=undo></i> عكس صرف'?'bdg-green':isAuto?'bdg-blue':'bdg-gold';return `<tr><td>${filtered.length-i}</td><td class="fw-bold">${esc(e.desc)}</td><td class="c-gold">${d?`${deptIcon(d)} ${esc(d.name)}`:'—'}</td><td class="${amountClass} fw-bold">${fC(e.amount)}</td><td><span class="badge ${badgeClass}">${typeLabel}</span></td><td class="text-muted">${fD(e.date)}</td><td>${isAuto?'<span class="text-muted"><i class=ji data-i=lock></i></span>':`<button class="btn btn-sm" onclick="editExpense('${e.id}')"><i class=ji data-i=pencil></i></button><button class="btn btn-red btn-sm" onclick="deleteExpense('${e.id}')"><i class=ji data-i=trash></i></button>`}</td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد بيانات</td></tr>'}</tbody></table></div></div>`;
}
const expenseFilterDept='all',expenseFilterFrom='',expenseFilterTo='';
// Optional preselectedDept opens the modal with that department already selected
function showAddExpenseModal(preselectedDept){
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${preselectedDept&&d.code===preselectedDept?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=wallet></i> ${t('exp.addTitle')}</h3><div class="fg"><label>${t('exp.desc')}</label><input type="text" id="expDesc"></div><div class="fr"><div class="fg"><label>${t('exp.dept')}</label><select id="expDept">${opts}</select></div><div class="fg"><label>${t('exp.category')}</label><select id="expCategory"><option value="مواد خام">مواد خام</option><option value="رواتب">رواتب</option><option value="تشغيل">تشغيل</option><option value="أخرى">أخرى</option></select></div></div><div class="fr"><div class="fg"><label>${t('exp.amount')}</label><input type="number" id="expAmount" step="0.01"></div><div class="fg"><label>${t('exp.date')}</label><input type="date" id="expDate" value="${today()}"></div></div><div class="fg"><label>${t('exp.notes')}</label><textarea id="expNotes"></textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="addExpense()"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function addExpense(){
const deptId=document.getElementById('expDept')?.value,
amount=parseFloat(document.getElementById('expAmount')?.value),
date=document.getElementById('expDate')?.value,
desc=document.getElementById('expDesc')?.value.trim(),
category=document.getElementById('expCategory')?.value,
notes=document.getElementById('expNotes')?.value.trim();
if(!deptId||isNaN(amount)||amount<=0||!desc){ toast('بيانات غير صحيحة','error'); return; }
try{
await persistCreate('expenses', (saved)=>STATE.expenses.push(saved), {id:uid(),deptId,amount,date,desc,category,notes,autoGenerated:false});
closeModal(); renderPage();
toast('تم إضافة المصروف');
}catch(e){ toast(e.message||'فشل حفظ المصروف في قاعدة البيانات','error'); }
}
function editExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(!e||e.autoGenerated){ if(e?.autoGenerated) {toast('لا يمكن تعديل المصاريف التلقائية','error');} return; }
const opts=STATE.departments.map(d=>`<option value="${d.code}" ${e.deptId===d.code?'selected':''}>${esc(d.name)}</option>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> ${t('exp.editTitle')}</h3><div class="fg"><label>${t('exp.desc')}</label><input type="text" id="expDesc" value="${esc(e.desc)}"></div><div class="fr"><div class="fg"><label>${t('exp.dept')}</label><select id="expDept">${opts}</select></div><div class="fg"><label>${t('exp.category')}</label><select id="expCategory"><option value="مواد خام" ${e.category==='مواد خام'?'selected':''}>مواد خام</option><option value="رواتب" ${e.category==='رواتب'?'selected':''}>رواتب</option><option value="تشغيل" ${e.category==='تشغيل'?'selected':''}>تشغيل</option><option value="أخرى" ${e.category==='أخرى'?'selected':''}>أخرى</option></select></div></div><div class="fr"><div class="fg"><label>${t('exp.amount')}</label><input type="number" id="expAmount" value="${e.amount}" step="0.01"></div><div class="fg"><label>${t('exp.date')}</label><input type="date" id="expDate" value="${e.date}"></div></div><div class="fg"><label>${t('exp.notes')}</label><textarea id="expNotes">${esc(e.notes||'')}</textarea></div><div class="modal-footer"><button class="btn" onclick="closeModal()">${t('act.cancel')}</button><button class="btn btn-gold" onclick="updateExpense('${id}')"><i class=ji data-i=save></i> ${t('act.save')}</button></div>`);
}
async function updateExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(!e){return;}
const deptId=document.getElementById('expDept')?.value;
const amount=parseFloat(document.getElementById('expAmount')?.value);
const date=document.getElementById('expDate')?.value;
const desc=document.getElementById('expDesc')?.value.trim();
const category=document.getElementById('expCategory')?.value;
const notes=document.getElementById('expNotes')?.value.trim();
try{
const saved = await persistUpdate('expenses', id, {deptId,amount,date,desc,category,notes});
Object.assign(e, saved || {deptId,amount,date,desc,category,notes});
closeModal(); renderPage();
toast('تم التحديث');
}catch(err){ toast(err.message||'فشل تحديث المصروف في قاعدة البيانات','error'); }
}
async function deleteExpense(id){
const e=STATE.expenses.find(x=>String(x.id)===String(id));
if(e?.autoGenerated){ toast('لا يمكن حذف المصاريف التلقائية','error'); return; }
if(!confirm('حذف؟')){return;}
try{
await persistRemove('expenses', id);
STATE.expenses=STATE.expenses.filter(x=>String(x.id)!==String(id));
renderPage();
toast('تم الحذف','warning');
}catch(err){ toast(err.message||'فشل الحذف من قاعدة البيانات','error'); }
}
// ============================================
// COST ANALYSIS
// ============================================
const costAnalysisFrom='',costAnalysisTo='';
function renderCostAnalysis(){
if(!checkMenuAccessLocal('cost-analysis')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
const from=costAnalysisFrom||null,to=costAnalysisTo||null;
let totalRev=0, totalExp=0, totMat=0, totCnt=0, totOps=0;
const details = STATE.departments.map(d=>{const s=calcStats(d.code,from,to);const bd=deptExpenseBreakdown(d.code,from,to);totalRev+=s.rev;totalExp+=s.exp;totMat+=bd.materials;totCnt+=bd.countAdj;totOps+=bd.operating;return{...d,...s,bd};});
const avgCost = totalRev>0?(totalExp/totalRev*100):0;
const inPeriod=e=>{const d=String(e.date||'').slice(0,10);if(!d){return false;}if(from&&d<from){return false;}if(to&&d>to){return false;}return true;};
const categories = {};
STATE.expenses.filter(inPeriod).forEach(e=>{const cat=e.category||'أخرى';categories[cat]=(categories[cat]||0)+Number(e.amount||0);});
setTimeout(()=>{
const ctx1=document.getElementById('costBarChart');
if(ctx1 && typeof Chart!=='undefined'){
if(STATE.charts.costBar){STATE.charts.costBar.destroy();}
STATE.charts.costBar = new Chart(ctx1,{type:'bar',data:{labels:details.map(d=>d.name),datasets:[{label:'الإيرادات',data:details.map(d=>d.rev),backgroundColor:'#2ecc7188',borderColor:'#2ecc71',borderWidth:1},{label:'التكلفة الإجمالية',data:details.map(d=>d.exp),backgroundColor:'#e74c3c88',borderColor:'#e74c3c',borderWidth:1}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
const ctx2=document.getElementById('costPieChart');
if(ctx2 && Object.keys(categories).length && typeof Chart!=='undefined'){
if(STATE.charts.costPie){STATE.charts.costPie.destroy();}
STATE.charts.costPie = new Chart(ctx2,{type:'pie',data:{labels:Object.keys(categories),datasets:[{data:Object.values(categories),backgroundColor:['#d4a843','#e74c3c','#2ecc71','#3498db','#9b59b6']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}}}});
}
},100);
return `<div class="u-row-between u-mb12"><div class="fr" style="align-items:end"><div class="fg"><label>من تاريخ</label><input type="date" value="${costAnalysisFrom}" onchange="costAnalysisFrom=this.value;renderPage()"></div><div class="fg"><label>إلى تاريخ</label><input type="date" value="${costAnalysisTo}" onchange="costAnalysisTo=this.value;renderPage()"></div><button class="btn btn-sm" onclick="costAnalysisFrom='';costAnalysisTo='';renderPage()"><i class=ji data-i=rotate-ccw></i> كل الفترة</button></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> إجمالي الإيرادات</div><div class="mcard-val c-gold">${fC(totalRev)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> إجمالي التكاليف</div><div class="mcard-val c-red">${fC(totalExp)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=chart></i> متوسط نسبة التكلفة</div><div class="mcard-val ${avgCost<50?'c-green':avgCost<75?'c-orange':'c-red'}">${fN(avgCost.toFixed(1))}%</div></div></div><div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> صرف مخزون (صافي المرتجعات)</div><div class="mcard-val c-blue">${fC(totMat)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=clipboard-list></i> عجز / زيادة الجرد</div><div class="mcard-val ${totCnt>0?'c-red':totCnt<0?'c-green':''}">${fC(totCnt)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=pen-tool></i> مصروفات تشغيلية</div><div class="mcard-val c-orange">${fC(totOps)}</div></div></div><div class="charts-grid"><div class="chart-card"><div class="chart-title"><i class=ji data-i=chart></i> الإيرادات مقابل التكلفة حسب القسم</div><div class="chart-box"><canvas id="costBarChart"></canvas></div></div><div class="chart-card"><div class="chart-title"><i class=ji data-i=pie></i> توزيع بنود التكلفة بالتصنيف</div><div class="chart-box"><canvas id="costPieChart"></canvas></div></div></div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> تفاصيل كلفة الأقسام</h3></div><div class="tbl-scroll"><table><thead><tr><th>القسم</th><th>الإيرادات</th><th>صرف مخزون</th><th>فرق جرد</th><th>تشغيلية</th><th>التكلفة الإجمالية</th><th>نسبة التكلفة</th><th>التقييم</th></tr></thead><tbody>${details.map(d=>`<tr><td class="fw-bold">${deptIcon(d)} ${esc(d.name)}</td><td class="c-gold">${fC(d.rev)}</td><td class="c-blue">${fC(d.bd.materials)}</td><td class="${d.bd.countAdj>0?'c-red':d.bd.countAdj<0?'c-green':'text-muted'}">${fC(d.bd.countAdj)}</td><td class="c-orange">${fC(d.bd.operating)}</td><td class="c-red fw-bold">${fC(d.exp)}</td><td class="c-orange">${fN(d.costRatio.toFixed(1))}%</td><td class="${d.costRatio<30?'c-green':d.costRatio<50?'c-orange':'c-red'} fw-bold">${d.costRatio<30?'ممتاز':d.costRatio<50?'جيد':d.costRatio<70?'متوسط':'مرتفع'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
// ============================================
// P&L — قائمة الأرباح والخسائر الحية (تُبنى من الحركات المسجّلة فعليًا)
// ============================================
let pnlFrom='', pnlTo='', PNL_DATA=null, PNL_LOADING=false;
const PNL_PRESETS = [
  ['today','اليوم'],['yesterday','أمس'],['last7','آخر 7 أيام'],
  ['thismonth','هذا الشهر'],['lastmonth','الشهر الماضي'],['custom','مخصص']
];
function pnlPresetRange(kind){
  const t=new Date();
  const iso=d=>d.toISOString().slice(0,10);
  if(kind==='today') {return [iso(t),iso(t)];}
  if(kind==='yesterday'){const y=new Date(t);y.setDate(y.getDate()-1);return [iso(y),iso(y)];}
  if(kind==='last7'){const s=new Date(t);s.setDate(s.getDate()-6);return [iso(s),iso(t)];}
  if(kind==='thismonth') {return [iso(new Date(t.getFullYear(),t.getMonth(),1)),iso(t)];}
  if(kind==='lastmonth') {return [iso(new Date(t.getFullYear(),t.getMonth()-1,1)),iso(new Date(t.getFullYear(),t.getMonth(),0))];}
  return [pnlFrom,pnlTo];
}
function pnlActivePreset(){
  for(const [k] of PNL_PRESETS){
    if(k==='custom') {continue;}
    const [f,t]=pnlPresetRange(k);
    if(f===pnlFrom&&t===pnlTo) {return k;}
  }
  return 'custom';
}
async function pnlLoad(){
  PNL_LOADING=true;
  try{
    const p=new URLSearchParams();
    if(pnlFrom) {p.set('from',pnlFrom);}
    if(pnlTo) {p.set('to',pnlTo);}
    PNL_DATA=await apiFetch('/finance/pnl?'+p.toString());
    if(pnlFrom!==PNL_DATA.period.from||pnlTo!==PNL_DATA.period.to){
      pnlFrom=PNL_DATA.period.from; pnlTo=PNL_DATA.period.to;
    }
  }catch(e){ toast(e.message||'تعذر تحميل قائمة الدخل','error'); PNL_DATA=null; }
  finally{ PNL_LOADING=false; }
  if(STATE.page==='pnl') {renderPage();}
}
function pnlRefresh(){ PNL_DATA=null; pnlLoad(); }
function pnlCmpChip(key,label,goodWhenUp=true){
  const c=(PNL_DATA&&PNL_DATA.comparison)||{}; const v=c[key];
  if(!v||v.previous==null) {return '';}
  const d=Number(v.delta||0), p=v.pct;
  const up=d>0, neutral=Math.abs(d)<0.005;
  const good=neutral?null:(up===goodWhenUp);
  const color=neutral?'text-muted':(good?'c-green':'c-red');
  const arrow=neutral?'−':(up?'<i class=ji data-i=trending-up></i>':'<i class=ji data-i=trending-down></i>');
  const pctTxt=(p==null||!Number.isFinite(p))?'':` (${fN(Math.abs(p).toFixed(1))}%)`;
  return `<div class="trend ${good===true?'trend-up':good===false?'trend-down':''}">${arrow} <span class="${color}">${neutral?'دون تغيير':`${fN(Math.abs(d))} ${esc(label)}${pctTxt}`}</span> <span class="text-muted">مقابل الفترة السابقة</span></div>`;
}
function renderPnl(){
if(!checkMenuAccessLocal('pnl')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
if(!PNL_DATA&&!PNL_LOADING){ setTimeout(pnlLoad,0); return '<div class="u-empty"><div class="spinner"></div></div>'; }
if(!PNL_DATA) {return '<div class="u-empty"><div class="spinner"></div></div>';}
const st=PNL_DATA.statement, cmp=PNL_DATA.comparison||{};
const rev=st.revenue, gp=st.gross_profit, np=st.net_profit;
const otherCosts=Number((st.shrinkage.amount||0))+Number(st.operating.total||0)+Number(st.payroll.total||0);
const cogsPct=rev.total>0?((st.cogs.net/rev.total)*100):0;
const otherPct=rev.total>0?((otherCosts/rev.total)*100):0;
const marginChip=(m)=>m==null?'<span class="text-muted">بلا إيراد</span>':`هامش ${fN(Number(m).toFixed(1))}%`;
const deptRows=(st.by_department||[]).map(d=>`<tr>
<td class="fw-bold">${esc(d.name)}<div class="u-faint u-t12">${esc(d.code)}</div></td>
<td class="c-gold">${fC(d.revenue)}</td>
<td class="c-blue">${fC(d.cogs)}</td>
<td class="${d.shrinkage>0?'c-red':d.shrinkage<0?'c-green':'text-muted'}">${fC(d.shrinkage)}</td>
<td class="c-orange">${fC(d.operating)}</td>
<td class="fw-bold ${d.net>=0?'c-green':'c-red'}">${fC(d.net)}</td>
<td class="c-orange">${d.margin_pct==null?'—':fN(Number(d.margin_pct).toFixed(1))+'%'}</td></tr>`).join('');
const daily=st.daily_series||[];
return `
<div class="u-row-between u-mb12"><div class="fr" style="align-items:end">
<div class="fr" style="gap:6px;flex-wrap:wrap">
${PNL_PRESETS.map(([k,label])=>`<button class="btn btn-sm ${pnlActivePreset()===k?'btn-gold':''}" onclick="pnlApplyPreset('${k}')">${label}</button>`).join('')}
</div>
<div class="fg"><label>من</label><input type="date" value="${esc(pnlFrom)}" onchange="pnlFrom=this.value;pnlRefresh()"></div>
<div class="fg"><label>إلى</label><input type="date" value="${esc(pnlTo)}" onchange="pnlTo=this.value;pnlRefresh()"></div>
<button class="btn btn-sm" onclick="pnlPrint()" data-tooltip="طباعة قائمة دخل A4"><i class=ji data-i=printer></i> طباعة</button>
<button class="btn btn-sm btn-blue" onclick="pnlExportExcel()" data-tooltip="تصدير Excel"><i class=ji data-i=download></i> Excel</button>
</div></div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> صافي الإيرادات (قبل الضريبة)</div><div class="mcard-val c-gold">${fC(rev.total)}</div>
<div class="trend"><i class=ji data-i=receipt></i> ${fN(rev.invoice_count)} فاتورة كاشير + ${fN(rev.manual_count)} إيراد يدوي</div>${pnlCmpChip('revenue','إيراد',true)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=package></i> تكلفة المواد (COGS)</div><div class="mcard-val c-red">${fC(st.cogs.net)}</div>
<div class="trend"><i class=ji data-i=chart></i> ${fN(cogsPct.toFixed(1))}% من الإيراد</div>${pnlCmpChip('cogs','تكلفة',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=trending-up></i> مجمل الربح</div><div class="mcard-val ${gp.amount>=0?'c-green':'c-red'}">${fC(gp.amount)}</div>
<div class="trend">${marginChip(gp.margin_pct)}</div>${pnlCmpChip('gross_profit','مجمل',true)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=gem></i> صافي الربح التشغيلي</div><div class="mcard-val ${np.amount>=0?'c-green':'c-red'}">${fC(np.amount)}</div>
<div class="trend">${marginChip(np.margin_pct)}</div>${pnlCmpChip('net_profit','صافي',true)}</div>
</div>
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=clipboard-list></i> فروق الجرد (عجز/زيادة)</div><div class="mcard-val ${st.shrinkage.amount>0?'c-red':st.shrinkage.amount<0?'c-green':''}">${fC(st.shrinkage.amount)}</div>
<div class="trend">${fN(st.shrinkage.count)} حركة جرد</div>${pnlCmpChip('shrinkage','فروق',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=wallet></i> مصاريف تشغيلية</div><div class="mcard-val c-orange">${fC(st.operating.total)}</div>
<div class="trend">${fN(st.operating.count)} مصروف بـ ${fN(st.operating.items.length)} فئة</div>${pnlCmpChip('operating','تشغيلية',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> الرواتب والأجور</div><div class="mcard-val c-teal">${fC(st.payroll.total)}</div>
<div class="trend">${st.payroll.count?`${fN(st.payroll.count)} مسير — ${st.payroll.months.join(', ')}`:'لا مسيرات رواتب داخل الفترة'}</div>${pnlCmpChip('payroll','رواتب',false)}</div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=percent></i> ضريبة القيمة المضافة المحصلة</div><div class="mcard-val c-blue">${fC(rev.vat_collected)}</div>
<div class="trend">التزام للهيئة — خارج حساب الربح</div>${pnlCmpChip('revenue','إجمالي',true)}</div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=file-text></i> قائمة الدخل — ${fD(st.period.from)} إلى ${fD(st.period.to)}</h3><span class="u-faint u-t12">كل الأرقام من حركات مسجّلة فعليًا (لا إدخال يدوي)</span></div>
<div class="tbl-scroll"><table>
<thead><tr><th style="width:55%">البند</th><th>المبلغ</th><th style="width:16%">% من الإيراد</th></tr></thead>
<tbody>
<tr class="pnl-sec"><td colspan="3">أولًا: الإيرادات</td></tr>
<tr class="pnl-sub"><td>صافي مبيعات الكاشير (بعد الخصم، قبل الضريبة)</td><td class="c">${fC(rev.pos_net)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sub"><td>الإيرادات اليدوية/الأخرى</td><td class="c">${fC(rev.manual)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>إجمالي الإيرادات الصافية</td><td class="c-gold fw-bold">${fC(rev.total)}</td><td class="c">100%</td></tr>
<tr class="pnl-sub"><td>ضريبة القيمة المضافة المحصلة (التزام — ليست إيرادًا)</td><td class="c-blue">${fC(rev.vat_collected)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sec"><td colspan="3">ثانيًا: تكلفة المبيعات (COGS)</td></tr>
<tr class="pnl-sub"><td>صرف مخزون مواد للأقسام</td><td class="c">${fC(st.cogs.dispatch)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-sub"><td>مرتجعات الأقسام للمخزن</td><td class="c ${st.cogs.returns<0?'c-green':''}">${fC(st.cogs.returns)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>صافي تكلفة المواد المستهلكة</td><td class="c-red fw-bold">${fC(st.cogs.net)}</td><td class="c">${fN(cogsPct.toFixed(1))}%</td></tr>
<tr class="pnl-total"><td>مجمل الربح</td><td class="fw-bold ${gp.amount>=0?'c-green':'c-red'}">${fC(gp.amount)}</td><td class="c">${gp.margin_pct==null?'—':fN(Number(gp.margin_pct).toFixed(1))+'%'}</td></tr>
<tr class="pnl-sec"><td colspan="3">ثالثًا: المصاريف التشغيلية والتكاليف الأخرى</td></tr>
<tr class="pnl-sub"><td>صافي فروق الجرد (عجز/زيادة)</td><td class="c ${st.shrinkage.amount>0?'c-red':st.shrinkage.amount<0?'c-green':''}">${fC(st.shrinkage.amount)}</td><td class="c text-muted">—</td></tr>
${st.operating.items.map(it=>`<tr class="pnl-sub"><td>${esc(it.category)} <span class="text-muted u-t12">(${fN(it.count)})</span></td><td class="c">${fC(it.amount)}</td><td class="c text-muted">—</td></tr>`).join('')||( '<tr class="pnl-sub"><td class="text-muted">لا توجد مصاريف تشغيلية في الفترة</td><td class="c">—</td><td class="c text-muted">—</td></tr>')}
<tr class="pnl-sub"><td>الرواتب والأجور</td><td class="c">${fC(st.payroll.total)}</td><td class="c text-muted">—</td></tr>
<tr class="pnl-total"><td>إجمالي المصاريف التشغيلية والتكاليف الأخرى</td><td class="c-orange fw-bold">${fC(otherCosts)}</td><td class="c">${fN(otherPct.toFixed(1))}%</td></tr>
<tr class="pnl-net"><td>صافي الربح التشغيلي</td><td class="fw-bold ${np.amount>=0?'c-green':'c-red'}">${fC(np.amount)}</td><td class="c">${np.margin_pct==null?'—':fN(Number(np.margin_pct).toFixed(1))+'%'}</td></tr>
</tbody></table></div>
</div>
<div class="charts-grid">
<div class="chart-card"><div class="chart-title"><i class=ji data-i=chart></i> الإيراد مقابل التكاليف يوميًا</div><div class="chart-box"><canvas id="pnlTrendChart"></canvas></div></div>
<div class="chart-card"><div class="chart-title"><i class=ji data-i=building></i> الربح الصافي حسب القسم</div><div class="chart-box"><canvas id="pnlDeptChart"></canvas></div></div>
</div>
<div class="tbl-wrap">
<div class="tbl-hd"><h3><i class=ji data-i=building></i> ربحية الأقسام</h3><span class="u-faint u-t12">الرواتب تُحتسب على مستوى المنشأة</span></div>
<div class="tbl-scroll"><table>
<thead><tr><th>القسم</th><th>الإيرادات</th><th>تكلفة المواد</th><th>فروق جرد</th><th>تشغيلية</th><th>الصافي</th><th>الهامش</th></tr></thead>
<tbody>${deptRows||'<tr><td colspan="7" class="text-muted c">لا حركات أقسام في الفترة</td></tr>'}</tbody>
</table></div>
</div>`;
}
function pnlApplyPreset(kind){
  if(kind==='custom') {return;}
  const [f,t]=pnlPresetRange(kind);
  pnlFrom=f; pnlTo=t; pnlRefresh();
}
function pnlInitCharts(){
  if(!PNL_DATA||STATE.page!=='pnl'||typeof Chart==='undefined') {return;}
  const st=PNL_DATA.statement;
  const daily=st.daily_series||[];
  const c1=document.getElementById('pnlTrendChart');
  if(c1){
    if(STATE.charts.pnlTrend) {STATE.charts.pnlTrend.destroy();}
    STATE.charts.pnlTrend=new Chart(c1,{type:'line',data:{
      labels:daily.map(d=>d.date.slice(5)),
      datasets:[
        {label:'الإيرادات',data:daily.map(d=>d.revenue),borderColor:'#2f9e72',backgroundColor:'#2f9e7222',fill:true,tension:.35},
        {label:'تكلفة المواد',data:daily.map(d=>d.cogs),borderColor:'#e74c3c',backgroundColor:'#e74c3c11',fill:true,tension:.35},
        {label:'تكاليف أخرى',data:daily.map(d=>d.opex),borderColor:'#b8862d',backgroundColor:'transparent',borderDash:[5,4],tension:.35}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}},scales:{x:{ticks:{color:'#9aa0b4'}},y:{ticks:{color:'#9aa0b4'}}}}});
  }
  const c2=document.getElementById('pnlDeptChart');
  if(c2){
    const depts=st.by_department||[];
    if(STATE.charts.pnlDept) {STATE.charts.pnlDept.destroy();}
    STATE.charts.pnlDept=new Chart(c2,{type:'bar',data:{
      labels:depts.map(d=>d.name),
      datasets:[
        {label:'الإيرادات',data:depts.map(d=>d.revenue),backgroundColor:'#2f9e7288',borderRadius:6},
        {label:'تكلفة المواد',data:depts.map(d=>d.cogs),backgroundColor:'#e74c3c88',borderRadius:6},
        {label:'الصافي',data:depts.map(d=>d.net),backgroundColor:'#b8862dcc',borderRadius:6}
      ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#9aa0b4'}}},scales:{x:{ticks:{color:'#9aa0b4'}},y:{ticks:{color:'#9aa0b4'}}}}});
  }
}
async function pnlPrint(){
  try{
    const p=new URLSearchParams();
    if(pnlFrom) {p.set('from',pnlFrom);}
    if(pnlTo) {p.set('to',pnlTo);}
    const res=await fetch(API_BASE+'/finance/pnl/print?'+p.toString(),{headers:{'Authorization':'Bearer '+(window._jwt||'')}});
    if(!res.ok) {throw new Error('فشل تحميل المستند');}
    const html=await res.text();
    const frame=document.createElement('iframe');
    frame.style.cssText='position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    frame.contentDocument.open(); frame.contentDocument.write(html); frame.contentDocument.close();
    setTimeout(()=>{ try{ frame.contentWindow.focus(); frame.contentWindow.print(); }catch(e){} setTimeout(()=>frame.remove(),2000); },500);
  }catch(e){ toast(e.message||'تعذر الطباعة','error'); }
}
function pnlExportExcel(){
  if(!PNL_DATA){ toast('لا بيانات للتصدير','warning'); return; }
  const st=PNL_DATA.statement, cmp=PNL_DATA.comparison||{};
  const cur=(k)=>{const v=cmp[k];return v&&v.previous!=null?[v.current,v.previous,v.delta??'',v.pct??'']:['','','',''];};
  const data=[
    [`قائمة الأرباح والخسائر — ${st.period.from} إلى ${st.period.to}`],
    ['البند','القيمة (ريال)','% من الإيراد','الفترة السابقة','الفرق','التغير %'],
    ['صافي مبيعات الكاشير',st.revenue.pos_net,'','','',''],
    ['الإيرادات اليدوية/الأخرى',st.revenue.manual,'','','',''],
    ['إجمالي الإيرادات الصافية',st.revenue.total,'100',...cur('revenue')],
    ['ضريبة القيمة المضافة المحصلة (التزام)',st.revenue.vat_collected,'','','',''],
    ['صرف مخزون مواد للأقسام',st.cogs.dispatch,'','','',''],
    ['مرتجعات الأقسام للمخزن',st.cogs.returns,'','','',''],
    ['صافي تكلفة المواد (COGS)',st.cogs.net,st.revenue.total?((st.cogs.net/st.revenue.total)*100).toFixed(1):'',...cur('cogs')],
    ['مجمل الربح',st.gross_profit.amount,st.gross_profit.margin_pct??'',...cur('gross_profit')],
    ['صافي فروق الجرد',st.shrinkage.amount,'','','',''],
    ...st.operating.items.map(it=>[`مصروف تشغيلي — ${it.category}`,it.amount,'','','','']),
    ['الرواتب والأجور',st.payroll.total,'','','',''],
    ['صافي الربح التشغيلي',st.net_profit.amount,st.net_profit.margin_pct??'',...cur('net_profit')],
    [],
    ['ربحية الأقسام'],
    ['القسم','الإيرادات','تكلفة المواد','فروق جرد','تشغيلية','الصافي','الهامش %'],
    ...(st.by_department||[]).map(d=>[d.name,d.revenue,d.cogs,d.shrinkage,d.operating,d.net,d.margin_pct??'']),
    [],
    ['السلسلة اليومية'],
    ['التاريخ','الإيرادات','تكلفة المواد','تكاليف أخرى'],
    ...(st.daily_series||[]).map(d=>[d.date,d.revenue,d.cogs,d.opex])
  ];
  const ws=XLSX.utils.aoa_to_sheet(data);
  ws['!cols']=[{wch:38},{wch:16},{wch:14},{wch:16},{wch:14},{wch:12}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'قائمة الدخل');
  XLSX.writeFile(wb,`pnl_${st.period.from}_${st.period.to}.xlsx`);
  toast('تم تحميل ملف Excel','success');
}
window.pnlApplyPreset=pnlApplyPreset; window.pnlRefresh=pnlRefresh; window.pnlPrint=pnlPrint; window.pnlExportExcel=pnlExportExcel;

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
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-x></i> الغائبون اليوم</div><div class="mcard-val ${absentToday>0?'c-red':'c-green'}">${fN(absentToday)}</div></div>
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
const isAdmin=['admin','hr','manager'].includes(STATE.currentUser.role);
if(!isAdmin){
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
const lateCount=rangeRecords.filter(a=>a.late).length;
const inferredCount=rangeRecords.filter(a=>a.checkin_inferred||a.checkout_inferred).length;
const totalDays=new Set(rangeRecords.map(a=>a.date)).size;
const totalKarim=rangeRecords.reduce((s,a)=>s+(a.workMinutes?Number(a.workMinutes)/60:0),0);
const activeEmployees=STATE.employees.filter(e=>e.status==='active');
// ─── ترقيم صفحات الجدول (100 صف/صفحة) + فهارس — يمنع تهنيج المتصفح ───
const empMap=new Map((STATE.employees||[]).map(e=>[String(e.id),e]));
const deptMap=new Map((STATE.hrDepartments||[]).map(d=>[String(d.code),d]));
const attQ=String(STATE.attSearch||'').trim().toLowerCase();
const normAr=s=>String(s||'').replace(/[أإآ]/g,'ا').replace(/ة/g,'ه').toLowerCase();
const nq=normAr(attQ);
const filteredRecs=(nq?rangeRecords.filter(a=>{const e=empMap.get(String(a.employeeId));return e&&normAr(`${e.name} ${e.employeeId||''} ${e.department||''}`).includes(nq);}):rangeRecords)
.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:0);
const ATT_PS=100;
const attPages=Math.max(1,Math.ceil(filteredRecs.length/ATT_PS));
if(STATE.attPage>attPages){STATE.attPage=attPages;}
if(!STATE.attPage||STATE.attPage<1){STATE.attPage=1;}
const pageRecs=filteredRecs.slice((STATE.attPage-1)*ATT_PS,STATE.attPage*ATT_PS);
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=users></i> إجمالي الموظفين</div><div class="mcard-val c-gold">${fN(activeEmployees.length)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> سجلات الحضور</div><div class="mcard-val c-green">${fN(presentCount)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=alert-triangle></i> المتأخرون</div><div class="mcard-val ${lateCount>0?'c-red':'c-green'}">${fN(lateCount)}</div></div>
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
<button class="btn btn-gold btn-sm" onclick="scanAttendanceKiosk()"><i class=ji data-i=camera></i> مسح بطاقة موظف</button>
<button class="btn btn-blue btn-sm" onclick="exportAttendanceExcel()"><i class=ji data-i=inbox></i> تصدير Excel</button>
<button class="btn btn-green btn-sm" onclick="printMonthlyAttendance()"><i class=ji data-i=printer></i> كشف شهري مجمع (طباعة)</button>
<button class="btn btn-blue btn-sm" onclick="runStrictAuditUI()"><i class=ji data-i=shield-check></i> تدقيق صارم</button>
<button class="btn btn-gold btn-sm" onclick="attGapsToggle()"><i class=ji data-i=alert-triangle></i> مراجعة نواقص الشهر</button>
${STATE.currentUser?.role==='admin' ? `<button class="btn btn-red btn-sm" onclick="revertAllInferred()" title="إلغاء كل الاستكمال التلقائي"><i class=ji data-i=undo></i> إلغاء الاستكمال للكل</button>` : ''}
<span class="text-muted" style="margin-inline-start:auto">صفحة ${fN(STATE.attPage)} من ${fN(attPages)} — ${fN(filteredRecs.length)} سجل</span>
<button class="btn btn-sm" ${STATE.attPage<=1?'disabled':''} onclick="attPageGo(-1)">السابق</button>
<button class="btn btn-sm" ${STATE.attPage>=attPages?'disabled':''} onclick="attPageGo(1)">التالي</button>
</div>
<div class="tbl-scroll tbl-sticky-first">
<table>
<thead><tr><th>التاريخ</th><th>الموظف</th><th>الكود</th><th>القسم</th><th>الحضور</th><th>الانصراف</th><th>ساعات العمل</th><th>المصدر</th><th>الحالة</th></tr></thead>
<tbody id="attTodayBody">
${filteredRecs.length===0?'<tr><td colspan=9 style="text-align:center;padding:30px;color:var(--faint)">لا توجد سجلات في الفترة المحددة</td></tr>':''}
${pageRecs.map(record=>{
const emp=empMap.get(String(record.employeeId));
if(!emp) {return '';}
const dept=deptMap.get(String(emp.department));
const inferredBadge='<span class="badge bdg-orange" title="قيمة مستكملة تلقائيًا">~ تلقائي</span>';
const krm=record.workMinutes!=null?(Number(record.workMinutes)/60).toFixed(1):(record.checkIn&&record.checkOut?(((new Date('2000-01-01 '+record.checkOut)-new Date('2000-01-01 '+record.checkIn))/3600000)>=0?((new Date('2000-01-01 '+record.checkOut)-new Date('2000-01-01 '+record.checkIn))/3600000).toFixed(1):'—'):'—');
const status=record.checkIn?(record.checkOut?(record.early_leave?'<i class=ji data-i=hourglass></i> انصراف مبكر':'<i class=ji data-i=circle-check></i> مكتمل'):'<i class=ji data-i=dot-green></i> حاضر'):(record.checkOut?'<i class=ji data-i=alert-triangle></i> بصمة ناقصة':'<i class=ji data-i=dot-gray></i> غائب');
const statusClass=record.checkIn?(record.checkOut?(record.early_leave?'bdg-orange':'bdg-green'):'bdg-blue'):(record.checkOut?'bdg-blue':'bdg-orange');
const recSource=record?(record.source==='device'?'<span class="badge bdg-blue">بصمة</span>':record.source==='qr'?'<span class="badge bdg-green">QR</span>':record.source==='backfill'?'<span class="badge bdg-purple">أرشيف</span>':'<span class="badge bdg-gray">يدوي</span>'):'—';
return `<tr data-date="${record.date}">
<td class="text-muted">${fD(record.date)}</td>
<td class="fw-bold">${esc(emp.name)}</td>
<td class="text-muted">${esc(emp.employeeId ?? '—')}</td>
<td>${dept?esc(dept.name):'—'}</td>
<td class="c-green">${record.checkIn?esc(record.checkIn)+(record.checkin_inferred?' '+inferredBadge:''):'—'}</td>
<td class="c-red">${record.checkOut?esc(record.checkOut)+(record.checkout_inferred?' '+inferredBadge:''):'—'}</td>
<td class="c-gold">${krm} ساعة</td>
<td>${recSource}</td>
<td><span class="badge ${statusClass}">${status}</span>${(record && (record.checkin_inferred || record.checkout_inferred) && STATE.currentUser?.role==='admin') ? ` <button class="btn btn-sm" title="إلغاء الاستكمال التلقائي" onclick="revertInference('${record.id}')">↩</button>` : ''}${['admin','manager','hr'].includes(STATE.currentUser?.role)?` <button class="btn btn-gold btn-sm" title="تصحيح بصمة نسيها الموظف" onclick="attCorrectModal('${record.id}')"><i class=ji data-i=pencil></i> تصحيح</button>`:''}</td>
</tr>`;
}).join('')}
</tbody>
</table>
</div>
</div>
${attExceptionsBox()}
`;
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
// ─── صندوق الاستثناءات: غياب/تأخير/انصراف مبكر/بصمة ناقصة في مكان واحد ───
function attExceptionsBox(){
  const d = today();
  const leaves = (STATE.leaveRequests || []).filter(l => l.status === 'approved' && String(l.startDate) <= d && d <= String(l.endDate));
  const excused = new Set(leaves.map(l => String(l.employeeId)));
  const rows = [];
  const typeMeta = {
    absent: { label: 'غائب', cls: 'bdg-red' },
    late: { label: 'متأخر', cls: 'bdg-orange' },
    early: { label: 'انصراف مبكر', cls: 'bdg-orange' },
    missing: { label: 'بصمة ناقصة', cls: 'bdg-blue' },
  };
  (STATE.employees || []).filter(e => e.status === 'active').forEach(emp => {
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
  if(!rows.length) {return `<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=shield-check></i> صندوق الاستثناءات — اليوم</h3><span class="badge bdg-green">لا استثناءات</span></div></div>`;}
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
    return (diff / 60).toFixed(1);
  };
  return `<div class="tbl-wrap" style="margin-top:14px"><div class="tbl-hd"><h3><i class=ji data-i=siren></i> صندوق الاستثناءات — اليوم (${open} مفتوح)</h3></div>
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
if(!rec){ gaps.push({emp,date:d,type:'absent',label:'غائب تمامًا',rec:null}); }
else if(rec.checkIn&&!rec.checkOut&&!rec.checkout_inferred){ gaps.push({emp,date:d,type:'missOut',label:'نسي بصمة الخروج',rec}); }
else if(!rec.checkIn&&rec.checkOut){ gaps.push({emp,date:d,type:'missIn',label:'نسي بصمة الدخول',rec}); }
}
});
return gaps;
}
function attNextDay(iso){ const d=new Date(iso+'T12:00:00'); d.setDate(d.getDate()+1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
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
const typeMeta={absent:['غائب تمامًا','bdg-red'],missOut:['نسي الخروج','bdg-orange'],missIn:['نسي الدخول','bdg-orange']};
box.innerHTML=`<div class="tbl-wrap" style="margin-top:14px;border:1px solid var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=alert-triangle></i> نواقص الفترة (${fN(gaps.length)}) — غائب: ${fN(byType.absent)} • نسي خروج: ${fN(byType.missOut)} • نسي دخول: ${fN(byType.missIn)}</h3>
<div class="u-row-wrap"><input type="search" class="inp" id="attGapsSearch" placeholder="بحث بالاسم أو الكود..." value="${esc(STATE.attGapsQ||'')}" oninput="attGapsSearch(this.value)" style="max-width:200px"><small class="text-muted">العطلات الأسبوعية ظاهرة أيضًا — عدّها بعينك قبل المعالجة</small><button class="btn btn-sm" onclick="STATE.attGapsQ='';attGapsToggle()">إخفاء ✕</button></div></div>
<div class="tbl-scroll" style="max-height:380px;overflow:auto"><table>
<thead><tr><th>التاريخ</th><th>الموظف</th><th>النوع</th><th>الحضور</th><th>الانصراف</th><th></th></tr></thead>
<tbody>${gaps.slice(0,300).map((g,i)=>{ const m=typeMeta[g.type]; return `<tr>
<td class="text-muted">${fD(g.date)}</td><td class="fw-bold">${esc(g.emp.name)}</td>
<td><span class="badge ${m[1]}">${m[0]}</span></td>
<td class="c-green">${g.rec?.checkIn?esc(g.rec.checkIn):'—'}</td>
<td class="c-red">${g.rec?.checkOut?esc(g.rec.checkOut):'—'}</td>
<td><button class="btn btn-gold btn-sm" onclick='attResolveModal("${g.emp.id}","${g.date}")'><i class=ji data-i=gavel></i> معالجة</button></td>
</tr>`; }).join('')||'<tr><td colspan="6" class="u-empty-sm">لا نواقص — الشهر مقفل نضيف ✓</td></tr>'}</tbody></table></div>
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
const late=ci?toMin(ci)>toMin(shiftStart):false;
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
const late=ci?toMin(ci)>toMin(shiftStart):!!rec.late;
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
const emp=STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(!emp){ toast('لم يتم ربط حسابك بملف موظف','error'); return; }
const todayDate=today();
const existing=STATE.attendance.find(a=>a.employeeId===emp.id&&a.date===todayDate);
if(existing?.checkIn){ toast('تم تسجيل الحضور مسبقاً','warning'); return; }
const now=new Date();
const timeStr=now.toTimeString().substring(0,5);
const workStartHour=STATE.settings.workStartHour||9;
// فترة سماح 30 دقيقة مقابل بداية وردية الموظف نفسه
const gS = emp.shift_start && /^\d{1,2}:\d{2}$/.test(emp.shift_start) ? emp.shift_start.split(':').map(Number) : null;
const sMin = gS ? gS[0] * 60 + gS[1] : workStartHour * 60;
const late=(now.getHours()*60+now.getMinutes()) > (sMin + 30);
if(existing){ await persistUpdate('attendance', existing.id, {checkIn:timeStr, late}); existing.checkIn=timeStr; existing.late=late; }
else{ const rec={id:uid(),employeeId:emp.id,date:todayDate,checkIn:timeStr,checkOut:null,late,notes:''}; await persistCreate('attendance', (saved)=>STATE.attendance.push(saved), rec); }
renderPage(); buildNav();
toast(`تم تسجيل الحضور ${late?'(متأخر)':''}`,'success');
addNotification('تسجيل حضور',`تم تسجيل حضورك في ${timeStr}`,'success');
}
async function checkOut(){
const emp=STATE.employees.find(e=>e.userId===STATE.currentUser.id);
if(!emp){ toast('لم يتم ربط حسابك','error'); return; }
const todayDate=today();
const record=STATE.attendance.find(a=>a.employeeId===emp.id&&a.date===todayDate);
if(!record?.checkIn){ toast('لم يتم تسجيل الحضور','error'); return; }
if(record.checkOut){ toast('تم تسجيل الانصراف مسبقاً','warning'); return; }
const timeStr=new Date().toTimeString().substring(0,5);
const nowMin=new Date().getHours()*60+new Date().getMinutes();
const eS = emp.shift_start && /^\d{1,2}:\d{2}$/.test(emp.shift_start) ? emp.shift_start.split(':').map(Number) : [9,0];
const eHours = Number(emp.shift_karim) > 0 ? Number(emp.shift_karim) : 10;
const eEnd = eS[0]*60+eS[1]+Math.round(eHours*60);
let oMin = nowMin;
if(eEnd > 24*60 && oMin < 12*60) {oMin += 24*60;}
const earlyLeave = (eEnd - oMin) > 30;
await persistUpdate('attendance', record.id, {checkOut:timeStr, early_leave: earlyLeave});
record.checkOut=timeStr; record.early_leave=earlyLeave;
renderPage();
toast('تم تسجيل الانصراف','success');
addNotification('تسجيل انصراف',`تم تسجيل انصرافك في ${timeStr}`,'success');
}
function exportAttendanceExcel(){
const attFrom=STATE.attFrom||'', attTo=STATE.attTo||'';
const filtered=STATE.attendance.filter(a=>(!attFrom||a.date>=attFrom)&&(!attTo||a.date<=attTo));
const data=[['التاريخ','الموظف','الكود','القسم','الحضور','الانصراف','ساعات العمل','المصدر','متأخر','انصراف مبكر']];
filtered.sort((a,b)=>a.date>b.date?-1:a.date<b.date?1:a.employeeId-b.employeeId).forEach(a=>{
const emp=findEmployeeById(a.employeeId);
const dept=STATE.hrDepartments.find(d=>d.code===emp?.department);
const krm=a.workMinutes!=null?(Number(a.workMinutes)/60).toFixed(1):a.checkIn&&a.checkOut?((new Date('2000-01-01 '+a.checkOut)-new Date('2000-01-01 '+a.checkIn))/3600000).toFixed(1):'';
const src=a.source==='device'?'بصمة':a.source==='qr'?'QR':a.source==='backfill'?'أرشيف':'يدوي';
data.push([a.date,emp?.name||'',emp?.employeeId||'',dept?.name||'',a.checkIn||'',a.checkOut||'',krm,src,a.late?'نعم':'لا',a.early_leave?'نعم':'لا']);
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
const LEAVE_STAGE_LABELS={employee:'الموظف',direct_manager:'المدير المباشر',operations_manager:'مدير التشغيل',general_manager:'المدير العام',hr:'شؤون العاملين'};
function leaveWorkflowStatusLabel(status){return {in_progress:'قيد الاعتماد',returned:'عاد للموظف للتعديل',completed:'معتمد نهائيًا',rejected:'مرفوض'}[status]||status||'غير محدد';}
function leaveWorkflowStatusClass(status){return {in_progress:'bdg-orange',returned:'bdg-purple',completed:'bdg-green',rejected:'bdg-red'}[status]||'bdg-orange';}
function renderLeaveWorkflowTimeline(leave){
 const events=Array.isArray(leave.events)?leave.events:[];const current=leave.current_stage||'direct_manager';
 const stages=['direct_manager','operations_manager','general_manager','hr'];
 return `<div class="leave-timeline">${stages.map((stage,index)=>{const event=events.find(e=>e.stage===stage&&['approve','reject','return'].includes(e.action));const reached=events.some(e=>e.stage===stage);const active=current===stage&&leave.workflow_status==='in_progress';return `<div class="leave-step ${active?'active':reached?'done':''}"><div class="leave-step-dot">${reached&&!active?'<i class=ji data-i=circle-check></i>':index+1}</div><div><strong>${LEAVE_STAGE_LABELS[stage]}</strong><small>${active?'متوقف هنا':event?.action==='approve'?'تمت الموافقة':event?.action==='reject'?'مرفوض':event?.action==='return'?'أعيد للموظف':'بانتظار الإجراء'}</small>${event?.note?`<em>${esc(event.note)}</em>`:''}</div></div>`;}).join('')}</div>`;
}
async function refreshLeaveWorkflow(){if(leaveWorkflowLoading){return;}leaveWorkflowLoading=true;try{leaveWorkflowData=await apiFetch('/hr/leave-workflow');leaveWorkflowLoaded=true;renderPage();}catch(e){toast(e.message||'تعذر تحميل مسار الإجازات','error')}finally{leaveWorkflowLoading=false;}}
function workflowForLeave(id){return leaveWorkflowData.find(l=>String(l.id)===String(id))||STATE.leaveRequests.find(l=>String(l.id)===String(id));}
function leaveCanAct(leave){if(!leave||leave.workflow_status!=='in_progress'){return false;}const role=STATE.currentUser?.role;if(role==='admin'){return true;}if(role==='hr'&&leave.current_stage==='hr'){return true;}if(role==='manager'&&['direct_manager','operations_manager'].includes(leave.current_stage)){return true;}return false;}
function renderLeavesPage(){
 const isPrivileged=['admin','hr','manager'].includes(STATE.currentUser.role);if(!leaveWorkflowLoaded&&!leaveWorkflowLoading){setTimeout(refreshLeaveWorkflow,0);}
 const leavesToShow=leaveWorkflowLoaded?leaveWorkflowData:STATE.leaveRequests;const pendingCount=leavesToShow.filter(l=>l.workflow_status==='in_progress'||(!l.workflow_status&&l.status==='pending')).length;
 return `<div class="metrics-grid"><div class="mcard"><div class="mcard-label"><i class=ji data-i=calendar></i> ${t('lv.total')}</div><div class="mcard-val c-gold">${fN(leavesToShow.length)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=hourglass></i> ${t('lv.pending')}</div><div class="mcard-val c-orange">${fN(pendingCount)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-check></i> ${t('lv.approved')}</div><div class="mcard-val c-green">${fN(leavesToShow.filter(l=>l.workflow_status==='completed'||l.status==='approved').length)}</div></div><div class="mcard"><div class="mcard-label"><i class=ji data-i=circle-x></i> مرفوضة</div><div class="mcard-val c-red">${fN(leavesToShow.filter(l=>l.workflow_status==='rejected'||l.status==='rejected').length)}</div></div></div><div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=calendar></i> دورة اعتماد الإجازات</h3><button class="btn btn-gold" onclick="showAddLeaveModal()"><i class=ji data-i=plus></i> طلب إجازة</button></div><div class="workflow-banner"><strong><i class=ji data-i=git-branch></i> مسار الاعتماد:</strong> الموظف ← المدير المباشر ← مدير التشغيل ← المدير العام ← شؤون العاملين</div><div class="tbl-wrap"><div class="tbl-hd"><h3><i class=ji data-i=clipboard-list></i> متابعة الطلبات</h3><small class="text-muted">المرحلة الحالية والملاحظات والإجراء المطلوب تظهر في كل طلب.</small></div><div class="tbl-scroll"><table><thead><tr><th>الموظف</th><th>نوع الإجازة</th><th>الفترة</th><th>المرحلة الحالية</th><th>الحالة</th><th>آخر ملاحظة</th><th>إجراءات</th></tr></thead><tbody>${leavesToShow.slice().reverse().map(l=>{const emp=findEmployeeById(l.employeeId);const type=STATE.leaveTypes.find(t=>String(t.id)===String(l.leaveTypeId));const days=Math.ceil((new Date(l.endDate)-new Date(l.startDate))/86400000)+1;const canAct=leaveCanAct(l);return `<tr><td class="fw-bold">${esc(l.employee_name||emp?.name||'—')}</td><td>${l.leave_type_icon||type?.icon||''} ${esc(l.leave_type_name||type?.name||'—')}</td><td>${fD(l.startDate)} — ${fD(l.endDate)}<small class="text-muted" style="display:block">${days} يوم</small></td><td><span class="badge ${canAct?'bdg-blue':'bdg-purple'}">${LEAVE_STAGE_LABELS[l.current_stage]||'—'}</span></td><td><span class="badge ${leaveWorkflowStatusClass(l.workflow_status||l.status)}">${leaveWorkflowStatusLabel(l.workflow_status||l.status)}</span></td><td class="u-maxw-260">${esc(l.current_note||l.reason||'—')}</td><td style="display:flex;gap:5px;flex-wrap:wrap">${canAct?`<button class="btn btn-green btn-sm" onclick="advanceLeaveWorkflow('${l.id}','approve')"><i class=ji data-i=circle-check></i> اعتماد</button><button class="btn btn-red btn-sm" onclick="advanceLeaveWorkflow('${l.id}','reject')"><i class=ji data-i=circle-x></i> رفض</button><button class="btn btn-sm" onclick="advanceLeaveWorkflow('${l.id}','return')"><i class=ji data-i=corner-up-left></i> إعادة</button>`:''}<button class="btn btn-blue btn-sm" onclick="viewLeaveDetails('${l.id}')"><i class=ji data-i=eye></i> عرض</button></td></tr>`;}).join('')||'<tr><td colspan="7" class="u-empty">لا توجد طلبات</td></tr>'}</tbody></table></div></div>`;
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
  <div class="u-row-wrap"><input type="month" id="payrunMonth" value="${curMonth}">${canWrite ? `<button class="btn btn-gold btn-sm" onclick="runPayrollGen()"><i class=ji data-i=zap></i> توليد المسير</button>` : ''}</div></div>
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
window.showDispatchRequestModal=showDispatchRequestModal; window.addDispatchItemField=addDispatchItemField; window.removeDispatchItem=removeDispatchItem; window.submitDispatchRequest=submitDispatchRequest; window.updateDispSummary=updateDispSummary; window.dispFilterItems=dispFilterItems; window.dispHideList=dispHideList; window.dispPickItem=dispPickItem; window.loadDeptPanel=loadDeptPanel;
window.openApproveModal=openApproveModal; window.openRejectModal=openRejectModal; window.confirmApprove=confirmApprove; window.confirmReject=confirmReject; window.openReceiveModal=openReceiveModal; window.confirmReceive=confirmReceive; window.clearSignaturePad=clearSignaturePad; window.printDispatchNote=printDispatchNote; window.viewDispatchDetails=viewDispatchDetails; window.deleteDispatch=deleteDispatch;
window.showAddRecipeModal=showAddRecipeModal; window.addRecipe=addRecipe; window.editRecipe=editRecipe; window.updateRecipe=updateRecipe; window.deleteRecipe=deleteRecipe; window.openRecipeManager=openRecipeManager; window.addRecipeManagerIngredient=addRecipeManagerIngredient; window.removeRecipeManagerIngredient=removeRecipeManagerIngredient; window.updateRecipeManagerQty=updateRecipeManagerQty; window.updateRecipeManagerPortion=updateRecipeManagerPortion; window.updateRecipeManagerUnit=updateRecipeManagerUnit; window.updateRecipeManagerWaste=updateRecipeManagerWaste; window.uploadRecipeManagerImage=uploadRecipeManagerImage; window.saveRecipeManager=saveRecipeManager;
window.showAddUserModal=showAddUserModal; window.addUser=addUser; window.editUser=editUser; window.updateUser=updateUser; window.deleteUser=deleteUser; window.showCreateEmployeeAccountModal=showCreateEmployeeAccountModal; window.toggleEmployeeAccountFields=toggleEmployeeAccountFields;
window.saveSettings=saveSettings; window.handleLogoUpload=handleLogoUpload; window.resetLogo=resetLogo;
window.closeModal=closeModal;
window.generateReport=generateReport; window.updateDateInputs=updateDateInputs; window.printReportOnly=printReportOnly;
window.exportAllData=exportAllData; window.resetAllData=resetAllData;
window.showNotifications=showNotifications; window.markNotificationRead=markNotificationRead; window.clearAllNotifications=clearAllNotifications; window.toggleChatPanel=toggleChatPanel; window.sendChatMsg=sendChatMsg; window.pickChatPeer=pickChatPeer; window.backToChatUsers=backToChatUsers;
window.showImportItemsCatalogModal=showImportItemsCatalogModal; window.downloadItemsCatalogTemplate=downloadItemsCatalogTemplate; window.importItemsCatalog=importItemsCatalog; window.previewCatalogFile=previewCatalogFile;
window.showKitchenReturnModal=showKitchenReturnModal; window.addDirectReturnItemField=addDirectReturnItemField; window.submitDirectReturn=submitDirectReturn; window.openPRReceiveModal=openPRReceiveModal; window.confirmPRReceive=confirmPRReceive; window.prDeliverModeSync=prDeliverModeSync; window.prFreshSuggest=prFreshSuggest;
window.addReturnItemField=addReturnItemField; window.submitKitchenReturn=submitKitchenReturn; window.refreshReturnItems=refreshReturnItems; window.refreshKitchenOverview=refreshKitchenOverview; window.showKitchenProductionModal=showKitchenProductionModal; window.submitKitchenProduction=submitKitchenProduction; window.addKitchenProductionMaterialRow=addKitchenProductionMaterialRow; window.removeKitchenProductionMaterialRow=removeKitchenProductionMaterialRow; window.setKitchenProductionMaterialField=setKitchenProductionMaterialField; window.addKitchenProductionDistributionRow=addKitchenProductionDistributionRow; window.removeKitchenProductionDistributionRow=removeKitchenProductionDistributionRow; window.syncKitchenProductionDestination=syncKitchenProductionDestination; window.setKitchenProductionCustomName=setKitchenProductionCustomName; window.setKitchenProductionDistributionQty=setKitchenProductionDistributionQty; window.updateKitchenProductionTotal=updateKitchenProductionTotal;
window.showBulkInventoryImportModal=showBulkInventoryImportModal; window.downloadInventoryTemplate=downloadInventoryTemplate; window.importBulkInventory=importBulkInventory; window.previewInventoryFile=previewInventoryFile;
window.showAddEmployeeModal=showAddEmployeeModal; window.addEmployee=addEmployee; window.editEmployee=editEmployee; window.updateEmployee=updateEmployee; window.deleteEmployee=deleteEmployee; window.viewEmployeeDetails=viewEmployeeDetails; window.filterEmployees=filterEmployees; window.exportEmployeesExcel=exportEmployeesExcel; window.showSmartCardModal=showSmartCardModal; window.switchPortalEmployee=switchPortalEmployee;
// تصديرات البطاقة الذكية: نُقلت إلى js/features/smart-card.js (يجسر عبر js/main.js — BRIDGE-008)
window.checkIn=checkIn; window.checkOut=checkOut; window.exportAttendanceExcel=exportAttendanceExcel; window.printEmployeeAttendanceDay=printEmployeeAttendanceDay; window.printEmployeeAttendanceMonth=printEmployeeAttendanceMonth;
// ZKTECO biometric page (بصمة الحضور)
// تصديرات البصمة (ZKTECO): نُقلت إلى js/features/zkteco.js (يجسر عبر js/main.js — BRIDGE-010)
window.showAddLeaveModal=showAddLeaveModal; window.addLeaveRequest=addLeaveRequest; window.approveLeave=approveLeave; window.rejectLeave=rejectLeave; window.returnLeaveToEmployee=returnLeaveToEmployee; window.advanceLeaveWorkflow=advanceLeaveWorkflow; window.refreshLeaveWorkflow=refreshLeaveWorkflow; window.viewLeaveDetails=viewLeaveDetails;
window.showAddHRDeptModal=showAddHRDeptModal; window.addHRDept=addHRDept; window.editHRDept=editHRDept; window.updateHRDept=updateHRDept; window.deleteHRDept=deleteHRDept;
window.exportPayrollExcel=exportPayrollExcel;
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
