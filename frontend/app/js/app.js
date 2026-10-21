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

// جسر الشريط الجانبي للهاتف ومطابقة المقاسات (Responsive Sidebar Bridge)
function toggleSidebar(){
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) {return;}
    if (window.matchMedia('(max-width: 900px)').matches){
        sidebar.classList.toggle('mobile-open');
    } else {
        sidebar.classList.toggle('collapsed');
    }
}
// showDatabaseRestoreInfo(): نُقل إلى js/features/settings-users.js (يجسر عبر window.showDatabaseRestoreInfo)
// uiPreferencesPayload(): نُقل إلى js/core/storage.js (يجسر عبر window.uiPreferencesPayload)
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
    // NOTE (2026-09-30): no setTimeout-throw guard here — a throw inside a timer
    // callback is UNCAUGHT by definition (5× "Uncaught Error: TIMEOUT" in console).
    // Per-request timeout is already enforced by apiFetch (30s AbortController).
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
    return rows;
};
const apiCreate = (entity, body)    => apiFetch(`/${entity}`, { method: 'POST', body: JSON.stringify(body) });
const apiUpdate = (entity, id, body)=> apiFetch(`/${entity}/${id}`, { method: 'PUT', body: JSON.stringify(body) });
const apiRemove = (entity, id, force) => apiFetch(`/${entity}/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' });
// ADMIN FULL-CONTROL (2026-10-01): حذف نهائي لأي سجل — للأدمن فقط.
// الاستخدام: await adminForceRemove('expenses', id) أو persistRemove('inventoryTx', id, true)
// السيرفر يتحقق من دور admin ويوثّق الحذف في admin_delete_audit.
const adminForceRemove = (entity, id) => apiFetch(`/${entity}/${id}?force=1`, { method: 'DELETE' });

// Optimistic-UI helper used by every add/edit/delete function below:
// hit the real DB endpoint first: only touch local STATE + re-render once
// PostgreSQL confirms the write, so the UI never shows data that didn't
// actually persist.

// Double-submit guard (مرآة لحارس السيرفر): الضغط المتكرر لا يُرسل أصلًا.
// قفل للطلبات الجارية + ذاكرة «أُنشئ للتو» 90 ثانية للكيانات المالية.
const _createInflight = new Map();
const _createRecent = new Map();
const CREATE_RECENT_MS = 90_000;
function _createSig(body) {
    const norm = (v) => {
        if (v === null || v === undefined) return '';
        if (Array.isArray(v)) return v.map(norm);
        if (typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) {
                if (['requestedAt','createdAt','updatedAt','id','requestId','timestamp','_t','clientId','nonce'].includes(k)) {continue;}
                out[k] = norm(v[k]);
            }
            return out;
        }
        if (typeof v === 'string') {
            const s = v.trim();
            return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
        }
        return v;
    };
    try { return JSON.stringify(norm(body ?? {})); } catch (_) { return String(Math.random()); }
}
async function persistCreate(entity, localArrayPush, body) {
    const { id, ...cleanBody } = body;   // strip id — server auto-generates it
    const guarded = ['dispatches','revenues','expenses','purchaseInvoices','inventoryTx','kitchenReturns','salary_advances','payroll_adjustments','weightReadings','recipes'].includes(entity);
    let key = null;
    if (guarded) {
        const now = Date.now();
        for (const [k, v] of _createRecent) { if (now - v.at > 120_000) {_createRecent.delete(k);} }
        key = entity + '|' + _createSig(cleanBody);
        if (_createInflight.has(key)) {throw new Error('نفس الطلب قيد التنفيذ الآن — انتظر النتيجة');}
        const prev = _createRecent.get(key);
        if (prev && now - prev.at < CREATE_RECENT_MS) {throw new Error('تم تسجيل هذا الطلب للتو — تحقق من القائمة قبل إعادة المحاولة');}
        _createInflight.set(key, true);
    }
    try {
        const saved = await apiCreate(entity, cleanBody);
        if (key) {_createRecent.set(key, { at: Date.now(), id: saved?.id ?? null });}
        localArrayPush(saved);
        return saved;
    } finally {
        if (key) {_createInflight.delete(key);}
    }
}
async function persistUpdate(entity, id, body) {
    return apiUpdate(entity, id, body);
}
async function persistRemove(entity, id, force) {
    if (force) {return adminForceRemove(entity, id);}
    return apiRemove(entity, id);
}
// حذف نهائي للأدمن مع تأكيد موحّد — يُستخدم لأي سجل في السيستم كاملًا.
async function adminDeleteAny(entity, id, label) {
    if (window.STATE?.currentUser?.role !== 'admin') {window.toast?.('الحذف النهائي للأدمن فقط', 'error'); return false;}
    if (!window.confirm(`⚠️ حذف نهائي ${label || ('#' + id)} من ${entity}؟\nسيُحذف نهائيًا ويُوثّق باسمك. هل أنت متأكد؟`)) {return false;}
    try {
        if (typeof window.showLoad === 'function') {window.showLoad();}
        await adminForceRemove(entity, id);
        window.toast?.('حُذف نهائيًا (موثّق باسم الأدمن)', 'info');
        return true;
    } catch (e) {window.toast?.(e.message || 'تعذر الحذف النهائي', 'error'); return false;}
    finally {if (typeof window.hideLoad === 'function') {window.hideLoad();}}
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
    'wh-invoices': '<i class=ji data-i=file-text></i>',
    'wh-moves': '<i class=ji data-i=chart></i>',
    'wh-returns': '<i class=ji data-i=undo></i>',
    'wh-prs': '<i class=ji data-i=clipboard-list></i>',
    'roster': '<i class=ji data-i=calendar-clock></i>',
    shelves: '<i class=ji data-i=archive></i>',
    weight: '<i class=ji data-i=scale></i>',
    kitchen: '<i class=ji data-i=chef-hat></i>',
    dispatch: '<i class=ji data-i=clipboard-list></i>',
    recipes: '<i class=ji data-i=utensils></i>',
    procurement: '<i class=ji data-i=shopping-cart></i>',
    'veg-requests': '<i class=ji data-i=shopping-cart></i>',
    reports: '<i class=ji data-i=chart></i>',
    settings: '<i class=ji data-i=settings></i>',
    users: '<i class=ji data-i=users></i>',
    branches: '<i class=ji data-i=building></i>',
    'hr-dashboard': '<i class=ji data-i=users></i>',
    employees: '<i class=ji data-i=user></i>',
    leaves: '<i class=ji data-i=calendar></i>',
    attendance: '<i class=ji data-i=timer></i>',
    zkteco: '<i class=ji data-i=user-check></i>',
    yarasoft: '<i class=ji data-i=shopping-cart></i>',
    'cashier-monitor': '<i class=ji data-i=chart></i>',
    'oracle-data': '<i class=ji data-i=database></i>',
    whatsapp: '<i class=ji data-i=send></i>',
    'employee-portal': '<i class=ji data-i=home></i>',
    'hr-departments': '<i class=ji data-i=building></i>',
    payroll: '<i class=ji data-i=banknote></i>',
    permissions: '<i class=ji data-i=key></i>',
    'query': '<i class=ji data-i=search></i>',
    professional: '<i class=ji data-i=credit-card></i>',
    'sales-analyzer': '<i class=ji data-i=chart></i>',
    'received-analyzer': '<i class=ji data-i=package></i>',
    'wh-vs-pos': '<i class=ji data-i=bar-chart></i>',
    'menu-board': '<i class=ji data-i=tv></i> شاشات المنيو'
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
<div class="insight-item insight-item--clickable ${!n.read?'notif-unread':''}" data-karim-action="openNotification" data-karim-arg0="${String(n.id).replace(/'/g,"\'")}">
<div class="insight-icon">${n.type==='success'?'<i class=ji data-i=circle-check></i>':n.type==='error'?'<i class=ji data-i=circle-x></i>':n.type==='warning'?'<i class=ji data-i=alert-triangle></i>':'<i class=ji data-i=info></i>'}</div>
<div class="insight-content">
<div class="insight-text">${esc(n.title)}${!n.read?' <span class="badge bdg-blue">جديد</span>':''}</div>
<div class="insight-meta">${esc(n.message)} • ${fDT(n.date)}</div>
</div>
</div>`).join('')}
</div>
<div class="modal-footer">
<button class="btn btn-blue btn-sm" data-karim-action="markAllNotificationsRead"><i class=ji data-i=check></i> تعليم الكل كمقروء</button>
<button class="btn btn-red btn-sm" data-karim-action="clearAllNotifications"><i class=ji data-i=trash></i> مسح الكل</button>
<button class="btn btn-gold" data-karim-action="closeModal">إغلاق</button>
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
panel.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--bg3)"><span id="chatHead"><strong><i class=ji data-i=message></i> شات الطاقم</strong></span><span class="u-row-wrap"><button class="btn btn-sm" id="chatBackBtn" style="display:none" data-karim-action="backToChatUsers">الموظفون</button><button class="btn btn-sm" data-karim-action="toggleChatPanel">إغلاق</button></span></div>
<div id="chatMsgs" style="flex:1;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;min-height:180px"></div>
<div id="chatInputRow" style="display:none;gap:6px;padding:10px 12px;border-top:1px solid var(--line)"><input id="chatInput" class="inp" placeholder="اكتب رسالتك..." maxlength="1000" style="flex:1"><button class="btn btn-gold btn-sm" data-karim-action="sendChatMsg"><i class=ji data-i=send></i></button></div>`;
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
<div class="insight-item insight-item--clickable" data-karim-action="pickChatPeer" data-karim-arg0="${esc(String(u.id))}">
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
// عنقود التخزين (initDatabase + fan-out + saveData): نُقل إلى js/core/storage.js (يجسر عبر js/main.js — BRIDGE-025)
// العمود الفقري (doLogin/refreshSession/go/buildNav/renderPage/enterApp): نُقل إلى js/features/auth-navigation.js (يجسر عبر js/main.js — BRIDGE-026)
// نظام النوافذ + راوتر الصفحات: نُقل إلى js/features/page-router.js (يجسر عبر js/main.js — BRIDGE-027)
// ============================================
// كتلة كشف دوال الدخول + ربط زر الدخول: نُقلت إلى نهاية main.js (BRIDGE-028 — بعد اكتمال كل الجسور)

// ============================================
// INITIALIZATION
// READINESS GATE (2026-09-30): main.js يحسم window.__karimReady بعد اكتمال
// كل الجسور. سكربت defer كلاسيكي يعمل قبل ذلك كان يسقط بـ ReferenceError
// (showAddRevenueModal/updateLogoDisplay is not defined) ويوقف app.js كله.
function whenBridgesReady(timeoutMs) {
  if (window.__karimBridgesReady) {return Promise.resolve();}
  const timeout = new Promise((res) => setTimeout(res, timeoutMs || 15000));
  const evt = new Promise((res) => document.addEventListener('karim:bridges-ready', res, { once: true }));
  const ready = (window.__karimReady && typeof window.__karimReady.then === 'function') ? window.__karimReady : Promise.resolve();
  return Promise.race([evt, timeout, ready]);
}
// ============================================
window.addEventListener('DOMContentLoaded',async ()=>{
await whenBridgesReady();
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
// Top-level bare identifiers below resolve via window — they exist only AFTER
// main.js bridges settle. Wrapped + gated instead of executing at parse time.
// Export remaining non-login functions (keep for safety / backward compat)
function bridgeAppGlobals(){
// (export repointed to main.js bridge)
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
// (export repointed to main.js bridge)
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

// حزمة التحسينات v10: نُقلت إلى js/ui/enhancement.js — مستمع DOMC الخاص بها بقي هنا (BRIDGE-024)
// <i class=ji data-i=play></i> Initialize enhancements
document.addEventListener('DOMContentLoaded', () => {
  whenBridgesReady().then(() => { try { hideSplash(); } catch (_) {} });
  setTimeout(() => { try { hideSplash(); } catch (_) {} }, 3000); // Fallback in case hideSplash is delayed
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
// ADMIN FULL-CONTROL (2026-10-01): دوال الحذف النهائي للأدمن — أي سجل في السيستم.
window.apiRemove = apiRemove;
window.adminForceRemove = adminForceRemove;
window.adminDeleteAny = adminDeleteAny;
window.persistRemove = persistRemove;
} // bridgeAppGlobals
whenBridgesReady().then(()=>{ try{ bridgeAppGlobals(); }catch(e){ console.error('[app-bridge]', e); } });

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
