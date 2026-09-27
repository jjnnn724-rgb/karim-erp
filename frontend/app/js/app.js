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
// عنقود الأقسام: نُقل إلى js/features/departments.js (يجسر عبر js/main.js — BRIDGE-018)
// عنقود التقارير: نُقل إلى js/features/reports.js (يجسر عبر js/main.js — BRIDGE-019)
// عنقود الإعدادات والمستخدمين: نُقل إلى js/features/settings-users.js (يجسر عبر js/main.js — BRIDGE-020)
// عنقود المدير المالي: نُقل إلى js/features/cfo.js (يجسر عبر js/main.js — BRIDGE-021)
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
// (export repointed to main.js bridge)
window.showAddItemModal=showAddItemModal; window.addInventoryItem=addInventoryItem; window.editItem=editItem; window.updateInventoryItem=updateInventoryItem; window.deleteItem=deleteItem;
window.showAddPurchaseInvoiceModal=showAddPurchaseInvoiceModal; window.addInvoiceItemRow=addInvoiceItemRow; window.removeInvoiceItemRow=removeInvoiceItemRow; window.updateInvoiceItem=updateInvoiceItem; window.savePurchaseInvoice=savePurchaseInvoice; window.viewPurchaseInvoice=viewPurchaseInvoice; window.printPurchaseInvoice=printPurchaseInvoice; window.showInventoryAuditModal=showInventoryAuditModal; window.showFiscalYearModal=showFiscalYearModal; window.closeFiscalYear=closeFiscalYear; window.createNextFiscalYear=createNextFiscalYear;
window.stocktakSetTab=stocktakSetTab; window.stocktakSetScope=stocktakSetScope; window.stocktakStartSession=stocktakStartSession; window.stocktakOpenSession=stocktakOpenSession; window.stocktakSaveCount=stocktakSaveCount; window.stocktakCountChanged=stocktakCountChanged; window.stocktakClearCount=stocktakClearCount; window.stocktakSubmitSession=stocktakSubmitSession; window.stocktakApproveSession=stocktakApproveSession; window.stocktakCancelSession=stocktakCancelSession; window.stocktakCancelById=stocktakCancelById; window.stocktakPrint=stocktakPrint; window.stocktakPrintById=stocktakPrintById; window.stocktakOnSearch=stocktakOnSearch; window.stocktakToggleDiffs=stocktakToggleDiffs; window.stocktakScanCount=stocktakScanCount; window.stocktakRefreshDetail=stocktakRefreshDetail;
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
window.closeModal=closeModal;
// (export repointed to main.js bridge)
// (export repointed to main.js bridge)
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
