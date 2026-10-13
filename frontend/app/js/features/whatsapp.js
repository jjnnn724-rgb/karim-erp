/**
 * features/whatsapp.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// WHATSAPP ENGINE PAGE
// ============================================
// ORACLE DATA BROWSER PAGE
// ============================================
const ORADATA = { tables: [], selected: null, data: null, page: 1, search: '' };
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
const banner=(down||st.linkNeeded)?`<div class="mcard" style="border:2px solid var(--red);background:rgba(231,76,60,.08);margin-bottom:12px"><b style="color:var(--red)"><i class=ji data-i=alert-triangle></i> الواتساب غير متصل${c.state==='LOGGED_OUT'?' — الجلسة انتهت ويلزم مسح QR جديد':''}</b><br><small class="text-muted">الردود التلقائية والتقارير متوقفة مؤقتًا — الرسائل محفوظة في الطابور وستُرسل عند عودة الاتصال. امسح الرمز من الأسفل بتليفون الإدارة.</small></div>`:'';
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
if(d.connected){ box.innerHTML='<span class="badge bdg-green">متصل — لا حاجة لرمز</span>'; waQrStop(); return; }
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
}
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
<div style="margin-bottom:12px"><div class="tbl-hd"><h4><i class=ji data-i=zap></i> استعلامات سريعة</h4></div>
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
result.innerHTML=`<div class="mcard" style="border:2px solid var(--green);background:rgba(39,174,96,.06)"><b>الاستجابة:</b><div style="margin-top:8px;line-height:1.8">${esc(String(d.result))}</div></div>`;
}else{
result.innerHTML=`<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)"><i class=ji data-i=circle-x></i> ${esc(String(d.message||'فشل الاستعلام'))}</b></div>`;
}
}catch(e){result.innerHTML=`<div class="mcard" style="border:2px solid var(--red)"><b style="color:var(--red)">خطأ: ${esc(String(e.message||'خطأ غير معروف'))}</b></div>`;}
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
    const el = document.getElementById("oraLastRefresh"); if(el) {el.textContent = "آخر تحديث: " + new Date().toLocaleString("ar-EG");}
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
// عنقود الإيرادات والمصاريف + تحليل التكاليف + الأرباح والخسائر: نُقل إلى js/features/finance.js (يجسر عبر js/main.js — BRIDGE-014)

export { WASTATE, waStateBadge, renderWhatsappPage, waSetTab, waRefreshStatus, waStateHtml, waRenderBody, waRenderOverview, waDo, waQrStop, waQrPoll, waQrRefresh, waPairModal, waPairGo, waLogoutModal, waLogoutGo, waAutoLoad, waAutoSave, waAutoTest, waLoadMsgs, waLoadCampaigns, waCampaignCreate, waCampaignAction, waChatMetaSave, waLoadOutbox, waSendGo, waLoadRules, waRuleModal, waRuleSave, waRuleDel, waLoadManagers, waManagerAdd, waManagerDel, waRenderQueryTab, waDoQuery, waLoadLogs, renderOracleDataPage, renderDailyLocksPage, loadDailyLocks, oraDataRefresh, oraDataSync, oraDataRender, oraDataFilter, oraDataOpen, oraDataRenderDetail, oraDataPrint };
