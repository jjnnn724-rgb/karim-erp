/**
 * features/settings-users.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// SETTINGS
// ============================================
function renderSettings(){
if(!checkMenuAccessLocal('settings')) {return '<div class="mcard"><i class=ji data-i=circle-x></i> لا تملك صلاحية الوصول</div>';}
 // PERF: الأقسام أسفل الشاشة تُحمَّل كسولاً عند الاقتراب منها (IntersectionObserver)
// — صفحة الإعدادات تُفتح فورًا بدل انتظار 5 طلبات متوازية (شكوى بطء فتح النوافذ)
// FIX 2026-10-01: lazyPanel كانت تبحث عن العناصر أثناء توليد سلسلة الـ HTML —
// أي قبل إدراجها في الصفحة — فلم يُسجَّل الـ observer إطلاقًا وبقيت الأقسام
// عالقة على «جارٍ التحميل...» للأبد (شكوى: بطاقات الموظفين/البصمة/النسخ لا تفتح).
// التأجيل بـ setTimeout(0) يشغّل الربط بعد إدراج العناصر فعليًا.
const lazyPanel = (id, loader) => {
    setTimeout(() => {
        const el = document.getElementById(id);
        if (!el) {return;}
        if (!('IntersectionObserver' in window)) {setTimeout(loader, 0); return;}
        const io = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) {io.disconnect(); loader();}
        }, { rootMargin: '250px' });
        io.observe(el);
    }, 0);
};
// ZATCA hub loads itself into #zatcaHub once this template is painted
lazyPanel('zatcaHub', loadZatcaHub);
// KOT settings load themselves into #kotSettingsBody the same way
lazyPanel('kotSettingsBody', loadKotSettings);
// Card settings load themselves into #cardSettingsBody the same way
lazyPanel('cardSettingsBody', loadCardSettings);
// Punch portal admin panel loads itself into #punchSettingsBody (SPEC-employee-pwa-attendance-geofence-v1, S7-S8)
lazyPanel('punchSettingsBody', loadPunchSettingsUI);
// Backup list loads itself into #sysBackupList (admin only)
if (STATE.currentUser?.role==='admin') {lazyPanel('sysBackupList', sysLoadBackups);}
return `
<div class="metrics-grid">
<div class="mcard"><div class="mcard-label"><i class=ji data-i=store></i> ${t('set.restaurant')}</div><div class="mcard-val c-gold">${esc(STATE.settings.name)}</div></div>
<div class="mcard"><div class="mcard-label"><i class=ji data-i=banknote></i> ${t('set.currency')}</div><div class="mcard-val c-gold">${esc(STATE.settings.currency)}</div></div>
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
<input type="file" id="logoFileInput" accept="image/*" style="display:none" data-karim-action="handleLogoUpload" data-karim-event="change" data-karim-args="[event]">
<button class="btn btn-gold btn-sm" onclick="document.getElementById('logoFileInput').click()"><i class=ji data-i=folder></i> ${t('set.uploadLogo')}</button>
<button class="btn btn-red btn-sm u-mt8" data-karim-action="resetLogo"><i class=ji data-i=refresh></i> ${t('set.removeLogo')}</button>
</div>
</div>
</div>
<div class="fg"><label><i class=ji data-i=alarm></i> ${t('set.workStart')}</label><input type="number" id="settingsWorkStart" value="${STATE.settings.workStartHour||9}" min="0" max="23"></div>
<div class="fg"><label><i class=ji data-i=flag></i> إظهار زر "رصيد افتتاحي" في شاشة المخزون</label><label style="display:flex;align-items:center;gap:6px;margin-top:6px"><input type="checkbox" id="settingsOpeningVisible" ${STATE.settings.opening_balance_visible!==false?'checked':''}> مفعل</label></div>
<div class="fg"><label><i class=ji data-i=layers></i> توحيد واجهة الكاشير (توجيه تدريجي)</label>
<select id="settingsPosLegacyMode" style="max-width:320px">
<option value="off" ${(STATE.settings.pos_legacy_mode||'off')==='off'?'selected':''}>إيقاف — كل المسارات تعمل كما هي (الافتراضي)</option>
<option value="banner" ${STATE.settings.pos_legacy_mode==='banner'?'selected':''}>تنبيه على الشاشة القديمة "ستُوقف قريبًا"</option>
<option value="redirect" ${STATE.settings.pos_legacy_mode==='redirect'?'selected':''}>تحويل الشاشة القديمة إلى الواجهة الرسمية</option>
</select>
<small class="text-muted" style="display:block;margin-top:6px">لا يُحذف أي مسار. التحويل يتم فقط إذا حُدِّد المسار الرسمي أدناه.</small></div>
<div class="fg"><label><i class=ji data-i=link></i> مسار واجهة الكاشير الرسمية</label>
<input type="text" id="settingsPosOfficialPath" value="${esc(STATE.settings.pos_official_path||'')}" placeholder="/app/cashier/" maxlength="255" dir="ltr">
<small class="text-muted" style="display:block;margin-top:6px">مسار داخلي يبدأ بـ/ فقط (مثال: /app/cashier/). يُتجاهل أي مسار خارجي.</small></div>
<button class="btn btn-gold" data-karim-action="saveSettings"><i class=ji data-i=save></i> ${t('set.save')}</button>
</div>
</div>
</div>
${STATE.currentUser?.role==='admin'?`
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=eye></i> إدارة ظهور القائمة الجانبية</h3></div><div style="padding:16px">
<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px">
${['cfo','revenues','expenses','cost-analysis','pnl','departments','warehouse','wh-invoices','wh-moves','wh-returns','wh-prs','shelves','weight','kitchen','dispatch','recipes','procurement','hr-dashboard','employees','leaves','attendance','zkteco','payroll','hr-departments','employee-portal','roster','reports','users','permissions','yarasoft','oracle-data','whatsapp'].map(k=>`<label style="display:flex;align-items:center;gap:8px;padding:6px;cursor:pointer;border-radius:8px;background:var(--bg3)"><input type="checkbox" class="navVisBox" value="${k}" ${(String(STATE.settings.hidden_nav_pages||'').split(',').map(x=>x.trim()).includes(k))?'checked':''}> <span>${esc(t('pg.'+k)||k)}</span></label>`).join('')}
</div>
<small class="text-muted" style="display:block;margin-top:10px">المُعلَّم = مخفي من القائمة الجانبية لكل المستخدمين (عرض فقط — الصفحات تبقى تعمل عبر الروابط الداخلية). الرئيسية والإعدادات لا يُخفيان. سجل الصرف مخفي افتراضيًا.</small>
<button class="btn btn-gold btn-sm u-mt12" data-karim-action="saveNavVisibility"><i class=ji data-i=save></i> حفظ ظهور القوائم</button>
</div></div>`:''}
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=landmark></i> ربط هيئة الزكاة</h3></div><div id="zatcaHub" style="padding:24px"><div class="mcard u-empty">جارٍ التحميل...</div></div></div>
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=printer></i> تذاكر المطبخ</h3></div><div id="kotSettingsBody" style="padding:24px"><div class="mcard u-empty">جارٍ التحميل...</div></div></div>
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=id-card></i> بطاقات الموظفين</h3></div><div id="cardSettingsBody" style="padding:24px"><div class="mcard u-empty">جارٍ التحميل...</div></div></div>
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=timer></i> البصمة الذاتية</h3></div><div id="punchSettingsBody" style="padding:24px"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=save></i> النسخ الاحتياطي الكامل والاستعادة</h3><div class="u-row-wrap"><button class="btn btn-green btn-sm" data-karim-action="sysDoBackup"><i class=ji data-i=save></i> نسخة احتياطية الآن</button><button class="btn btn-gold btn-sm" onclick="document.getElementById('sysUploadInput')?.click()"><i class=ji data-i=upload></i> رفع نسخة خارجية</button><input type="file" id="sysUploadInput" accept=".sql" style="display:none" data-karim-action="sysUploadBackup" data-karim-event="change" data-karim-pass="element"><button class="btn btn-blue btn-sm" data-karim-action="sysLoadBackups"><i class=ji data-i=refresh></i> تحديث القائمة</button></div></div>
<div style="padding:16px 24px"><small class="text-muted">النسخة تشمل قاعدة البيانات كاملة + الإعدادات — انسخ أحدث ملف على فلاشة خارجية للأمان من ضبط المصنع. الاستعادة تمسح الحالي (بنعمل نسخة أمان تلقائيًا أولًا).</small><div id="sysBackupList" style="margin-top:12px"><div class="mcard u-empty"><div class="spinner"></div></div></div></div>
</div>
<div class="tbl-wrap" style="margin-top:32px"><div class="tbl-hd"><h3><i class=ji data-i=inbox></i> تصدير وتصفير</h3></div>
<div style="padding:24px">
<div style="display:flex;gap:12px;flex-wrap:wrap">
<button class="btn btn-green btn-sm" data-karim-action="exportAllData"><i class=ji data-i=inbox></i> تصدير قراءة البيانات (JSON)</button>
<button class="btn btn-blue btn-sm" data-karim-action="showDatabaseRestoreInfo"><i class=ji data-i=archive></i> إرشادات استعادة قاعدة البيانات</button>
<button class="btn btn-red" data-karim-action="resetAllData"><i class=ji data-i=trash></i> مسح جميع البيانات</button>
${STATE.currentUser?.role==='admin'?`<button class="btn btn-red" style="border:2px solid var(--red);font-weight:900" data-karim-action="showOperationalResetModal"><i class=ji data-i=alert-triangle></i> تصفير شامل (كل السستم)</button>`:''}
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
<button class="btn btn-gold" data-karim-action="saveCardSettings"><i class=ji data-i=save></i> حفظ إعدادات البطاقات</button>
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
        <strong><i class=ji data-i=alert-triangle></i> تحذير نهائي — لا يمكن التراجع</strong><br>
        سيتم حذف：<strong>كل شيء</strong> — الرواتب، الحضور، الإجازات، الموظفين، الإيرادات، المصاريف، طلبات الصرف، فواتير المبيعات، فواتير المشتريات، الأصناف، المخزون، الوصفات، حركات المخزون، الورديات، الإشعارات، العملاء، الموردين، الأصول، دليل الحسابات، جداول Oracle المنسوخة، وكل رقم في السستم.<br><br>
        سيبقى فقط：<strong>مدير النظام + المحاسب</strong> (admin/admin12345 + admin1/123456) والإعدادات الأساسية وسجل التدقيق.<br><br>
        <strong style="color:var(--red)">أكّد أخذ نسخة احتياطية (backup) قبل التنفيذ!</strong>
      </div>
      <div class="fg"><label>سبب التصفير الشامل</label><textarea id="resetReason" rows="3" placeholder="اكتب سبباً واضحاً لا يقل عن 10 أحرف"></textarea></div>
      <div class="fg"><label>اكتب CONFIRM PRODUCTION RESET للتأكيد</label><input id="resetConfirmation" autocomplete="off" placeholder="CONFIRM PRODUCTION RESET"></div>
      <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--red);font-weight:700"><input type="checkbox" id="resetForce" checked> <span>تصفير إجباري: يمسح كل حساب term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term term</span></label></div>
      <div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="executeOperationalReset"><i class=ji data-i=alert-triangle></i> تنفيذ التصفير الشامل</button></div>`);
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
async function saveNavVisibility(){
const hidden=Array.from(document.querySelectorAll('.navVisBox:checked')).map(x=>x.value).join(',');
try{
await apiUpdate('settings','main_settings',{name:STATE.settings.name||'مطاعم الشرفه العالمي',hidden_nav_pages:hidden});
Object.assign(STATE.settings,{hidden_nav_pages:hidden,hiddenNavPages:hidden});
if(typeof window.buildNav==='function'){window.buildNav();}
toast('تم تحديث ظهور القوائم لكل المستخدمين','success');
}catch(e){ toast(e.message||'فشل حفظ ظهور القوائم','error'); }
}
async function saveSettings(){
const payload={
  name:document.getElementById('settingsName')?.value.trim()||STATE.settings.name,
  currency:document.getElementById('settingsCurrency')?.value.trim()||'SAR',
  logo:STATE.settings.logo||'<i class=ji data-i=utensils></i>',
  workStartHour:parseInt(document.getElementById('settingsWorkStart')?.value)||9,
  opening_balance_visible:document.getElementById('settingsOpeningVisible')?.checked !== false,
  // سياسة توحيد مسار POS — تُحفظ في main_settings (migration 104)
  pos_legacy_mode:['off','banner','redirect'].includes(document.getElementById('settingsPosLegacyMode')?.value)
    ? document.getElementById('settingsPosLegacyMode').value : 'off',
  pos_official_path:(document.getElementById('settingsPosOfficialPath')?.value||'').trim().slice(0,255),
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
const ZATCA_STATUS_LABEL = { queued:'بالانتظار', processing:'قيد الإرسال', reported:'مُبلّغة', failed:'فشلت', dead_letter:'فشل نهائي', skipped_cancelled:'ملغاة', skipped_disabled:'موقوفة' };

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
    <button class="btn ${c.enabled?'btn-red':'btn-green'} btn-sm" data-karim-action="zatcaToggle" data-karim-args="[! 0 ]"><i class=ji data-i=${c.enabled?'pause':'play'}></i> ${c.enabled?'إيقاف الربط':'تفعيل الربط'}</button>
    <button class="btn btn-blue btn-sm" data-karim-action="zatcaTest"><i class=ji data-i=wifi></i> اختبار الاتصال</button>
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
  <div class="fg"><label>البيئة</label><select id="ztEnv" data-karim-action="zatcaEnvChanged" data-karim-event="change">${envOptions}</select></div>
  <div class="fg"><label>عنوان الـ API (اختياري — يتبع البيئة تلقائيًا)</label><input id="ztApiBase" value="${esc(c.api_base||'')}" placeholder="${esc(c.default_api_base||'')}" dir="ltr"></div>
  <div class="fg"><label>اسم الحل البرمجي</label><input id="ztSolution" value="${esc(c.solution_name||'')}" placeholder="Karim ERP"></div>
  <div class="fg"><label>الرقم التعريفي / السجل المدني (اختياري — للفردية)</label><input id="ztEid" value="${esc(c.eid&&c.eid!=='••••'?c.eid:'')}" placeholder="1xxxxxxxxx" dir="ltr"></div>
  <div class="fg"><label>أقصى عدد محاولات لكل فاتورة</label><input id="ztMaxAttempts" type="number" min="1" max="50" value="${c.max_attempts||10}"></div>
  <div class="fg"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ztPoll" ${c.poll_in_server!==false?'checked':''}> <span>مزامنة الإبلاغ تلقائيًا من داخل الخادم (موصى بها)</span></label></div>
</div>
<div class="zatca-actions-row">
  <button class="btn btn-gold" data-karim-action="zatcaSave"><i class=ji data-i=save></i> حفظ بيانات الربط</button>
  <button class="btn ${c.has_csr?'':'btn-blue'}" data-karim-action="zatcaGenerateCsr"><i class=ji data-i=key></i> ${c.has_csr?'إعادة توليد CSR':'توليد CSR'}</button>
  <button class="btn ${c.has_csid?'':'btn-gold'}" data-karim-action="zatcaCsidModal"><i class=ji data-i=shield-check></i> ${c.has_csid?'إعادة طلب شهادة CSID':'طلب شهادة CSID برمز OTP'}</button>
  <button class="btn" data-karim-action="zatcaCsidManualModal"><i class=ji data-i=clipboard></i> إدخال شهادة يدويًا</button>
  ${c.has_csid?`<button class="btn btn-red" data-karim-action="zatcaCsidClear"><i class=ji data-i=trash></i> حذف الشهادة</button>`:''}
  <button class="btn btn-blue" data-karim-action="zatcaApplyVat"><i class=ji data-i=building></i> تطبيق الرقم الضريبي على كل الأقسام</button>
</div>
<div class="zatca-hint">
  <b>خطوات الربط الحقيقية مع منصة Fatoora:</b>
  ① احفظ بيانات المنشأة أعلاه → ② ولّد CSR → ③ ادخل منصة fatoora.zatca.gov.sa واطلب رمز OTP لجهاز الامتثال → ④ أدخل OTP هنا لاستلام شهادة CSID → ⑤ فعّل الربط. بعدها كل فاتورة كاشير تُبلّغ تلقائيًا للهيئة.
  ${c.has_private_key?'<span class="zatca-warn">ملاحظة: المفتاح الخاص محفوظ في قاعدة البيانات للبيئات التجريبية — في الإنتاج استخدم HSM.</span>':''}
</div>`:''}
<div class="tbl-hd" style="margin-top:18px"><h4><i class=ji data-i=database></i> مراقبة طابور الإبلاغ الضريبي</h4></div>
<div class="zatca-queue-tools">
  <button class="btn btn-sm" data-karim-action="loadZatcaQueue"><i class=ji data-i=refresh></i> تحديث</button>
  ${can?`<button class="btn btn-blue btn-sm" data-karim-action="zatcaRetry" data-karim-args="[&quot;failed&quot;]"><i class=ji data-i=undo></i> إعادة محاولة الفاشلة</button>
  <button class="btn btn-sm" data-karim-action="zatcaRetry" data-karim-args="[&quot;all&quot;]"><i class=ji data-i=history></i> إعادة جدولة الكل</button>`:''}
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
  await apiFetch('/zatca/toggle',{method:'POST',body:JSON.stringify({enabled:enable})});
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
    <div class="modal-footer"><button class="btn btn-gold" data-karim-action="zatcaCopyCsr"><i class=ji data-i=copy></i> نسخ CSR</button><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);
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
  <div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="zatcaRequestCsid"><i class=ji data-i=send></i> إرسال الطلب للهيئة</button></div>`);
}

async function zatcaRequestCsid(){
const otp=document.getElementById('zatcaOtp')?.value.trim();
if(!/^\d{6}$/.test(otp||'')){ toast('أدخل رمز OTP المكوّن من 6 أرقام','error'); return; }
try {
  showLoad('جارٍ إرسال الطلب للهيئة…');
  await apiFetch('/zatca/csid',{method:'POST',body:JSON.stringify({otp})});
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
  <div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="zatcaCsidManualSubmit"><i class=ji data-i=save></i> حفظ الشهادة</button></div>`);
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
  ${can?`<button class="btn btn-gold" data-karim-action="saveKotSettings"><i class=ji data-i=save></i> حفظ إعدادات التذاكر</button>`:''}
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
<td>${f.shaOk===true?'<span class="badge bdg-green">سليمة</span>':f.shaOk===false?'<span class="badge bdg-red">تالفة!</span>':f.hasSha?'<span class="badge bdg-gray">بصمة موجودة</span>':'<span class="badge bdg-gray">بلا بصمة</span>'}</td>
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
<div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-red" data-karim-action="sysConfirmRestore" data-karim-arg0="${esc(file)}"><i class=ji data-i=archive></i> تنفيذ الاستعادة</button></div>`);
}
async function sysConfirmRestore(file){
const c=document.getElementById('sysRestoreConfirm')?.value.trim();
if(c!=='RESTORE'){ toast('اكتب RESTORE للتأكيد','error'); return; }
const restoreEnv=document.getElementById('sysRestoreEnv')?.checked===true;
if(!confirm('تأكيد نهائي: الاستعادة هتمسح الوضع الحالي وترجع النسخة؟')) {return;}
showLoad();
try{
await apiFetch('/system/restore',{method:'POST',body:JSON.stringify({file,confirm:'RESTORE',restoreEnv})});
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
// خزنة كلمات المرور: عرض النسخة المسجلة (أدمن فقط — مسار محمي على الخادم)
async function viewUserPassword(id){
const u=STATE.users.find(x=>String(x.id)===String(id));
if(!u){return;}
try{
const r=await apiFetch('/users/'+id+'/password');
if(!r.available){
showModal(`<h3><i class=ji data-i=key></i> كلمة مرور ${esc(u.name)}</h3><div class="workflow-banner">لا توجد نسخة محفوظة لهذا الحساب (أُنشئ قبل تفعيل الخزنة). افتح «تعديل الحساب» وحدد كلمة مرور جديدة وستُسجَّل تلقائيًا وتظهر هنا بعدها.</div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button></div>`);
return;
}
showModal(`<h3><i class=ji data-i=key></i> كلمة مرور ${esc(u.name)}</h3><div class="workflow-banner">اسم المستخدم: <strong>@${esc(u.username)}</strong> — هذه النسخة تُحدَّث تلقائيًا مع كل تعيين كلمة مرور لهذا الحساب.</div><div style="text-align:center;margin:18px 0"><div class="mono" style="font-size:26px;font-weight:bold;letter-spacing:2px;color:var(--gold,#c9a227)">${esc(r.password)}</div></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إغلاق</button><button class="btn btn-gold" data-karim-action="copyResetCode" data-karim-arg0="${esc(r.password)}"><i class=ji data-i=copy></i> نسخ</button></div>`);
}catch(_){ toast('تعذر جلب كلمة المرور — حاول مرة أخرى','error'); }
}
function renderUserCards(users){
if(!users || !users.length) {return '<div class="mcard u-empty-grid">' + t('user.noResult') + '</div>';}
return users.map(u=>{const role=ROLES[u.role];const emp=linkedEmployeeForUser(u.id);const active=u.active!==false;const deptLine=u.role==='dept_head'?`<br><strong>قسمه:</strong> <span class="badge bdg-blue">${esc(deptNameByCode(u.dept_code))}</span>`:'';return `<div class="mcard"><div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><div style="width:48px;height:48px;border-radius:50%;background:var(--gold-d);display:flex;align-items:center;justify-content:center;font-size:22px">${role?.icon||'<i class=ji data-i=user></i>'}</div><div class="u-flex1"><div class="fw-bold">${esc(u.name)}</div><div class="text-muted" style="font-size:11px">@${esc(u.username)}</div></div><span class="badge ${active?'bdg-green':'bdg-red'}">${active?'نشط':'موقوف'}</span></div><div class="details-item" style="margin-top:8px"><strong>الدور:</strong> ${role?.name||esc(u.role)}${deptLine}<br><strong>الموظف المرتبط:</strong> ${emp?`${esc(emp.name)} — ${esc(emp.employeeId||'')}`:'<span class="text-muted">غير مربوط</span>'}</div><div class="fr u-mt12"><button class="btn btn-sm u-flex1" data-karim-action="editUser" data-karim-arg0="${u.id}"><i class=ji data-i=pencil></i> تعديل الحساب</button><button class="btn btn-sm" data-karim-action="viewUserPassword" data-karim-arg0="${u.id}" title="عرض كلمة المرور المسجلة"><i class=ji data-i=eye></i></button>${active&&u.id!==STATE.currentUser.id?`<button class="btn btn-sm" data-karim-action="issueResetCode" data-karim-arg0="${u.id}" title="توليد رمز استعادة لكلمة المرور (10 دقائق، استخدام واحد)"><i class=ji data-i=key></i></button>`:''}${u.id!==STATE.currentUser.id?`<button class="btn btn-red btn-sm" data-karim-action="deleteUser" data-karim-arg0="${u.id}"><i class=ji data-i=trash></i></button>`:''}</div></div>`;}).join('');
}
function renderUsers(){
if(STATE.currentUser.role!=='admin') {return '<div class="mcard"><i class=ji data-i=circle-x></i> هذه الصفحة للمدير فقط</div>';}
return `<div class="u-row-between"><div><h3 class="u-gold-strong"><i class=ji data-i=users></i> ${t('pg.users')}</h3><small class="text-muted">الحساب للدخول والصلاحيات، والموظف للسجل الوظيفي والحضور والراتب.</small></div><div style="display:flex;gap:10px"><button class="btn btn-green" data-karim-action="showBulkImportModal"><i class=ji data-i=inbox></i> استيراد جماعي</button><button class="btn btn-gold" data-karim-action="showAddUserModal"><i class=ji data-i=plus></i> مستخدم جديد</button></div></div><div><div class="emp-search-row">
<div class="smart-search">
<input type="text" id="userSearch" placeholder="${t('user.searchPh')}" data-karim-action="filterUsers" data-karim-event="input" data-karim-action="if" data-karim-event="keydown" data-karim-args="[event.key===&#39;Enter&#39;]" data-karim-also="filterUsers">
</div>
<button class="btn btn-blue btn-sm" data-karim-action="filterUsers"><i class=ji data-i=search></i> ${t('act.search')}</button>
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
const deptSrc=(STATE.hrDepartments&&STATE.hrDepartments.length?STATE.hrDepartments:(STATE.departments||[]));
const deptBoxes=deptSrc.map(d=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:8px"><input type="checkbox" class="userDeptBox" value="${esc(d.code)}"> <span>${esc(d.name||d.name_ar||d.code)}</span></label>`).join('');
showModal(`<h3><i class=ji data-i=plus></i> إضافة مستخدم وربطه بموظف</h3><div class="workflow-banner">الحساب يحدد تسجيل الدخول والصلاحيات، والربط يوصله بالسجل الوظيفي والحضور والراتب.</div><div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="userName" value="${esc(linkedEmployee?.name||'')}"></div><div class="fg"><label>اسم المستخدم</label><input type="text" id="userUsername"></div></div><div class="fr"><div class="fg"><label>كلمة المرور</label><input type="password" id="userPassword"></div><div class="fg"><label>الدور</label><select id="userRole" data-karim-action="toggleUserDeptField" data-karim-event="change">${roleOpts}</select></div></div><div class="fr"><div class="fg" id="userDeptField" style="display:none"><label>قسم الرئيس <small>(إجباري لرئيس القسم)</small></label><div id="userDeptBoxes" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg3)">${deptBoxes}</div><small class="text-muted">اختر قسمًا أو أكثر — رئيس قسم لأكثر من قسم مدعوم</small></div><div class="fg"><label>الموظف المرتبط</label><select id="userEmployee">${employeeAccountOptions(employeeId||'',null)}</select></div></div><div class="fr"><div class="fg"><label>حالة الحساب</label><select id="userActive"><option value="true" selected>نشط</option><option value="false">موقوف</option></select></div><div></div></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="addUser"><i class=ji data-i=save></i> حفظ وربط الحساب</button></div>`);
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
const deptCode=role==='dept_head'?(Array.from(document.querySelectorAll('#userDeptBoxes input[type=checkbox]:checked')).map(x=>x.value).join(',')||null):null;
if(!name||!username||!password){ toast('أكمل الاسم واسم المستخدم وكلمة المرور','error'); return; }
if(role==='dept_head'&&!deptCode){ toast('اختر قسمًا واحدًا على الأقل لرئيس القسم','error'); return; }
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
const deptSrc=(STATE.hrDepartments&&STATE.hrDepartments.length?STATE.hrDepartments:(STATE.departments||[]));
const currentDepts=String(u.dept_code||'').split(',').map(x=>x.trim()).filter(Boolean);
const deptBoxes=deptSrc.map(d=>`<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-radius:8px"><input type="checkbox" class="userDeptBox" value="${esc(d.code)}" ${currentDepts.includes(String(d.code))?'checked':''}> <span>${esc(d.name||d.name_ar||d.code)}</span></label>`).join('');
showModal(`<h3><i class=ji data-i=pencil></i> تعديل حساب المستخدم</h3><div class="workflow-banner">اسم المستخدم ثابت كمعرّف دخول. يمكنك تعديل الاسم، الدور، الحالة، كلمة المرور، والموظف المرتبط.</div><div class="fr"><div class="fg"><label>الاسم</label><input type="text" id="userName" value="${esc(u.name)}"></div><div class="fg"><label>اسم المستخدم</label><input type="text" id="userUsername" value="${esc(u.username)}" readonly></div></div><div class="fr"><div class="fg"><label>كلمة المرور الجديدة <small>(اتركها فارغة دون تغيير)</small></label><input type="password" id="userPassword"></div><div class="fg"><label>الدور والصلاحيات</label><select id="userRole" data-karim-action="toggleUserDeptField" data-karim-event="change">${roleOpts}</select></div></div><div class="fr"><div class="fg" id="userDeptField" style="display:${u.role==='dept_head'?'':'none'}"><label>قسم الرئيس <small>(إجباري لرئيس القسم)</small></label><div id="userDeptBoxes" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--bg3)">${deptBoxes}</div><small class="text-muted">اختر قسمًا أو أكثر — رئيس قسم لأكثر من قسم مدعوم</small></div><div class="fg"><label>الموظف المرتبط</label><select id="userEmployee">${employeeAccountOptions(emp?.id||'',u.id)}</select></div></div><div class="fr"><div class="fg"><label>حالة الحساب</label><select id="userActive"><option value="true" ${u.active!==false?'selected':''}>نشط</option><option value="false" ${u.active===false?'selected':''}>موقوف</option></select></div><div></div></div><div class="modal-footer"><button class="btn" data-karim-action="closeModal">إلغاء</button><button class="btn btn-gold" data-karim-action="updateUser" data-karim-arg0="${id}"><i class=ji data-i=save></i> حفظ التعديل</button></div>`);
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
const deptCode=role==='dept_head'?(Array.from(document.querySelectorAll('#userDeptBoxes input[type=checkbox]:checked')).map(x=>x.value).join(',')||null):null;
if(role==='dept_head'&&!deptCode){ toast('اختر قسمًا واحدًا على الأقل لرئيس القسم','error'); return; }
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

// ═══════════════════════════════════════════════════════════════════════════
// PUNCH PORTAL ADMIN PANEL — SPEC-employee-pwa-attendance-geofence-v1 (S7–S8)
// الإعدادات تنعكس فورًا (السيرفر يقرأها حيًا) — بلا إعادة تشغيل.
// ═══════════════════════════════════════════════════════════════════════════
const _punchAdminState = { settings: {}, attempts: [], summary: null };

async function loadPunchSettingsUI(){
const body=document.getElementById('punchSettingsBody');
if(!body){return;}
try{
const [sRes, aRes] = await Promise.all([
apiFetch('/attendance/portal/settings-admin'),
apiFetch('/attendance/portal/attempts?limit=50'),
]);
_punchAdminState.settings = {};
(sRes.settings||[]).forEach(r=>{ _punchAdminState.settings[r.key] = r.value; });
_punchAdminState.attempts = aRes.attempts||[];
_punchAdminState.summary = aRes.summary||null;
body.innerHTML = renderPunchAdminHTML();
loadPunchAttemptsTable();
renderPunchFacesList();
loadPunchDevices();
}catch(e){ body.innerHTML = `<div class="mcard u-empty">تعذر تحميل لوحة البصمة: ${esc(e.message)}</div>`; }
}

function punchKv(key){ return _punchAdminState.settings?.[key]; }
function punchBool(key){ return ['true','1','on'].includes(String(punchKv(key)||'false').toLowerCase()); }
function punchChecked(key){ return punchBool(key) ? 'checked' : ''; }

function renderPunchAdminHTML(){
const hasCoords = punchKv('punch_restaurant_lat') && punchKv('punch_restaurant_lng');
const geoOn = punchBool('punch_geofence_enabled');
const portalOn = punchBool('punch_portal_enabled');
return `
<div class="fg" style="display:flex;gap:18px;flex-wrap:wrap">
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchPortalEnabled" ${punchChecked('punch_portal_enabled')}> <b>تفعيل البصمة الذاتية للموظفين</b></label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchGeofenceEnabled" ${punchChecked('punch_geofence_enabled')}> <b>قيد الموقع الجغرافي (Geofence)</b></label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchDeviceBinding" ${punchChecked('punch_device_binding')}> <b>ربط جهاز واحد بكل موظف</b></label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchDeviceAutoRebind" ${punchChecked('punch_device_auto_rebind') || punchKv('punch_device_auto_rebind') == null ? 'checked' : ''}> <b>الربط التلقائي للجهاز الجديد</b> — أول بصمة ناجحة من جهاز جديد تربطه فورًا بلا رفض «جهاز غير مسجل» (موصى به)</label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchSelfieEnabled" ${punchChecked('punch_selfie_enabled')}> <b>لقطة تحقق مع البصمة</b></label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchFaceEnabled" ${punchChecked('punch_face_enabled')}> <b>محرك الوجه الأساسي (v1 — يعمل مع أي كاميرا)</b></label>
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchFaceV2Enabled" ${punchChecked('punch_face_v2_enabled')}> <b>محرك الوجه المتقدم (ArcFace 512-d على السيرفر) — القوالب الجديدة تُسجَّل به تلقائيًا</b></label>
</div>
<div class="fg" style="margin-top:10px">
<label>عتبة المطابقة (أقل = أشد صرامة — ارفعها قليلًا لو رُفضت وجوه صحيحة في إضاءة مختلفة)</label>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
<label>الأساسي (0.3-0.9):</label>
<input type="number" id="punchFaceThreshold" value="${esc(punchKv('punch_face_threshold')||'0.55')}" min="0.3" max="0.9" step="0.01" style="width:100px">
<label>المتقدم (0.2-0.8):</label>
<input type="number" id="punchFaceV2Threshold" value="${esc(punchKv('punch_face_v2_threshold')||'0.42')}" min="0.2" max="0.8" step="0.01" style="width:100px">
</div>
</div>
<div class="fg" style="margin-top:14px">
<label><i class=ji data-i=map-pin></i> إحداثيات المطعم (تُلتقط وأنت داخل المطعم)</label>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px">
<input id="punchLat" value="${esc(punchKv('punch_restaurant_lat')||'')}" placeholder="خط العرض" style="width:150px">
<input id="punchLng" value="${esc(punchKv('punch_restaurant_lng')||'')}" placeholder="خط الطول" style="width:150px">
<button class="btn btn-blue btn-sm" data-karim-action="captureRestaurantLocation"><i class=ji data-i=map-pin></i> أنا هنا — التقط الموقع</button>
</div>
</div>
<div class="fg" style="margin-top:10px">
<label>نطاق البصمة المسموح (متر) — من 50 إلى 500</label>
<input type="number" id="punchRadius" value="${esc(punchKv('punch_radius_meters')||'120')}" min="50" max="500" style="width:150px">
</div>
<div class="fg" style="margin-top:10px">
<label>أقصى دقة موقع مقبولة (متر) وأقدم إصلاح GPS (ثانية)</label>
<div style="display:flex;gap:10px">
<input type="number" id="punchMaxAcc" value="${esc(punchKv('punch_max_accuracy_m')||'50')}" min="10" max="200" style="width:150px">
<input type="number" id="punchMaxAge" value="${esc(punchKv('punch_max_fix_age_s')||'30')}" min="5" max="120" style="width:150px">
</div>
</div>
<div class="fg" style="margin-top:10px;border:1px solid var(--gold);border-radius:10px;padding:10px 14px">
<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="punchTeleportCheck" ${punchChecked('punch_teleport_check') || punchKv('punch_teleport_check') == null ? 'checked' : ''}> <b>🛡️ فحص التنقل المستحيل — رفض القفزات بين بصمتين (مشاركة حسابات/تزييف متنقل)</b></label>
<div style="display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap">
<label>أقصى سرعة بين بصمتين (كم/س):</label>
<input type="number" id="punchMaxTeleportKmh" value="${esc(punchKv('punch_max_teleport_kmh')||'250')}" min="50" max="1000" style="width:120px">
<small class="text-muted">الافتراضي 250 — فوق أي سيارة داخل المدينة. القفزة الأصغر تُقبل.</small>
</div>
</div>
<div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
<button class="btn btn-gold" data-karim-action="savePunchSettings"><i class=ji data-i=save></i> حفظ الإعدادات (ينعكس فورًا)</button>
${(!hasCoords&&geoOn)?'<span class="u-red">⚠ الجيوفانس مفعّل بلا إحداثيات — البصمة ستُرفض! التقط الموقع أو أطفئ الجيوفانس.</span>':''}
${portalOn?'<span style="color:#2ecc71;font-weight:700">● الميزة مفعّلة الآن — الموظفون يبصمون</span>':'<span class="text-muted">● الميزة مغلقة — الموظفون لا يرون زر البصمة</span>'}
</div>
<div class="tbl-wrap" style="margin-top:18px;border-color:var(--gold)">
<div class="tbl-hd"><h3><i class=ji data-i=user></i> تسجيل بصمة الوجه</h3></div>
<div style="padding:16px 24px">
<div id="punchFacesList" style="margin-bottom:12px"></div>
<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
<select id="punchFaceUser" style="padding:8px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text);max-width:280px">
<option value="">— اختر الموظف —</option>
${(STATE.employees||[]).filter(e=>e.userId).map(e=>`<option value="${e.userId}">${esc(e.name)} (${esc(e.employeeId||"")})</option>`).join("")}
</select>
<button class="btn btn-gold btn-sm" data-karim-action="enrollPunchFace"><i class=ji data-i=camera></i> تسجيل الوجه بالكاميرا</button>
</div>
<small class="text-muted" style="display:block;margin-top:8px">يُحسب متجه الوجه من كاميرا حية ويُخزن كأرقام فقط — لا تُحفظ أي صورة. الوجه المقيد جغرافيًا مثل بقية البصمة.</small>
</div>
</div>
<div class="tbl-wrap" style="margin-top:18px">
<div class="tbl-hd"><h3><i class=ji data-i=activity></i> الأجهزة المربوطة (ربط الجهاز L4)</h3>
<div class="u-row-wrap"><button class="btn btn-blue btn-sm" data-karim-action="loadPunchDevices"><i class=ji data-i=refresh></i> تحديث</button></div>
</div>
<div style="padding:16px 24px">
<div id="punchDevicesList">جارٍ التحميل…</div>
<small class="text-muted" style="display:block;margin-top:8px">«فك الربط» يسمح بالبصمة من جهاز جديد فورًا — والبصمة التالية تربط الجهاز الجديد تلقائيًا. لو «الربط التلقائي» مفعّل فالربط يتم وحده بلا تدخل.</small>
</div>
</div>
<div class="tbl-wrap" style="margin-top:18px">
<div class="tbl-hd"><h3><i class=ji data-i=activity></i> سجل محاولات البصمة</h3>
<div class="u-row-wrap">
<select id="punchAttemptsFilter" data-karim-action="loadPunchAttempts" data-karim-event="change" style="padding:6px 10px;background:var(--bg3);border:1px solid var(--border);border-radius:8px;color:var(--text)">
<option value="">كل المحاولات</option>
<option value="rejected">المرفوضة فقط</option>
<option value="accepted">المقبولة فقط</option>
</select>
<button class="btn btn-blue btn-sm" data-karim-action="loadPunchAttempts"><i class=ji data-i=refresh></i> تحديث</button>
</div>
</div>
<div style="padding:16px 24px">
<div id="punchAttemptsSummary" style="margin-bottom:12px"></div>
<div id="punchAttemptsTable"></div>
</div>
</div>
`;
}

function renderPunchAttemptsSummary(){
const sm = _punchAdminState.summary || {};
const box = document.getElementById('punchAttemptsSummary');
if(!box){return;}
const items = [
['مقبولة (24س)', sm.accepted_24h ?? 0, '#2ecc71'],
['مرفوضة (24س)', sm.rejected_24h ?? 0, (sm.rejected_24h ?? 0) > 0 ? '#e67e22' : '#9aa0ac'],
['خارج النطاق (7 أيام)', sm.out_of_range_7d ?? 0, '#e67e22'],
['جهاز غير مطابق (7 أيام)', sm.device_mismatch_7d ?? 0, '#e74c3c'],
];
box.innerHTML = `<div style="display:flex;gap:12px;flex-wrap:wrap">${items.map(([l,v,c]) =>
`<div class="mcard" style="padding:10px 16px;margin:0"><div style="font-size:12px;color:var(--text2)">${l}</div><div style="font-size:22px;font-weight:900;color:${c}">${v}</div></div>`).join('')}</div>`;
}

async function loadPunchAttemptsTable(){
const tbl = document.getElementById('punchAttemptsTable');
if(!tbl){return;}
const filter = document.getElementById('punchAttemptsFilter')?.value || '';
try{
const res = await apiFetch('/attendance/portal/attempts?limit=50' + (filter?`&decision=${filter}`:''));
_punchAdminState.attempts = res.attempts||[];
_punchAdminState.summary = res.summary||null;
renderPunchAttemptsSummary();
const rows = _punchAdminState.attempts;
if(!rows.length){ tbl.innerHTML = '<div class="mcard u-empty">لا محاولات مسجلة بعد</div>'; return; }
tbl.innerHTML = `<div style="overflow-x:auto"><table class="keep-table" style="width:100%;font-size:13px">
<thead><tr><th>الوقت</th><th>المستخدم</th><th>القرار</th><th>السبب</th><th>المسافة</th><th>الدقة</th><th>الثقة</th><th>IP</th></tr></thead>
<tbody>${rows.map(a=>{
const dt = a.attempted_at ? new Date(a.attempted_at).toLocaleString('ar-EG',{dateStyle:'short',timeStyle:'short'}) : '—';
const okRow = a.decision==='accepted';
const trust = a.trust_score != null ? Number(a.trust_score) : null;
const trustCell = trust == null ? '—' : `<b style="color:${trust >= 80 ? '#2ecc71' : trust >= 50 ? '#e67e22' : '#e74c3c'}">${trust}%</b>`;
const reason = a.reject_code === 'PUNCH_LOCATION_TELEPORT' && a.teleport_kmh != null
? `تنقل مستحيل (${esc(String(a.teleport_kmh))} كم/س)` : esc(a.reject_code||'—');
return `<tr style="border-top:1px solid var(--border)">
<td>${esc(dt)}</td>
<td>${esc(a.username||'—')}</td>
<td>${okRow?'<b style="color:#2ecc71">مقبولة</b>':'<b style="color:#e74c3c">مرفوضة</b>'}</td>
<td>${reason}${a.trust_signals ? `<br><small class="text-muted">${esc(String(a.trust_signals))}</small>` : ''}</td>
<td>${a.distance_m!=null?esc(String(a.distance_m))+'م':'—'}</td>
<td>${a.accuracy_m!=null?esc(String(a.accuracy_m))+'م':'—'}</td>
<td>${trustCell}</td>
<td>${esc(a.remote_ip||'—')}</td>
</tr>`;}).join('')}</tbody></table></div>`;
}catch(e){ tbl.innerHTML = `<div class="mcard u-empty">تعذر تحميل السجل: ${esc(e.message)}</div>`; }
}

async function loadPunchAttempts(){
await loadPunchAttemptsTable();
}

async function captureRestaurantLocation(){
if(!navigator.geolocation){ toast('جهازك لا يدعم تحديد الموقع','error'); return; }
toast('جارٍ التقاط الموقع — اطلب أقصى دقة وانتظر…','info');
navigator.geolocation.getCurrentPosition(async (pos)=>{
try{
await apiFetch('/attendance/portal/settings-admin', { method:'PUT', body: JSON.stringify({
punch_restaurant_lat: pos.coords.latitude,
punch_restaurant_lng: pos.coords.longitude,
})});
toast('تم حفظ إحداثيات المطعم بدقة ' + Math.round(pos.coords.accuracy) + 'م','success');
await loadPunchSettingsUI();
}catch(e){ toast(e.message||'فشل الحفظ','error'); }
}, (err)=>{
toast(err.code===1?'مُنِع الوصول للموقع — اسمح به من المتصفح':'تعذر تحديد الموقع','error');
}, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}

async function savePunchSettings(){
const body = {
punch_portal_enabled: document.getElementById('punchPortalEnabled')?.checked || false,
punch_geofence_enabled: document.getElementById('punchGeofenceEnabled')?.checked || false,
punch_device_binding: document.getElementById('punchDeviceBinding')?.checked || false,
punch_device_auto_rebind: document.getElementById('punchDeviceAutoRebind')?.checked ?? true,
punch_selfie_enabled: document.getElementById('punchSelfieEnabled')?.checked || false,
punch_face_enabled: document.getElementById('punchFaceEnabled')?.checked || false,
punch_face_v2_enabled: document.getElementById('punchFaceV2Enabled')?.checked || false,
punch_face_threshold: document.getElementById('punchFaceThreshold')?.value || '0.55',
punch_face_v2_threshold: document.getElementById('punchFaceV2Threshold')?.value || '0.42',
punch_radius_meters: document.getElementById('punchRadius')?.value || '120',
punch_max_accuracy_m: document.getElementById('punchMaxAcc')?.value || '50',
punch_max_fix_age_s: document.getElementById('punchMaxAge')?.value || '30',
punch_teleport_check: document.getElementById('punchTeleportCheck')?.checked ?? true,
punch_max_teleport_kmh: document.getElementById('punchMaxTeleportKmh')?.value || '250',
punch_restaurant_lat: document.getElementById('punchLat')?.value ?? '',
punch_restaurant_lng: document.getElementById('punchLng')?.value ?? '',
};
try{
await apiFetch('/attendance/portal/settings-admin', { method:'PUT', body: JSON.stringify(body) });
toast('تم حفظ إعدادات البصمة — تنعكس على الموظفين فورًا','success');
await loadPunchSettingsUI();
}catch(e){ toast(e.message||'فشل الحفظ','error'); }
}

function renderPunchFacesList(){
const box = document.getElementById('punchFacesList');
if(!box){return;}
box.innerHTML = window.__punchFaces?.length
? window.__punchFaces.map(f=>`<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--border);border-radius:10px;padding:8px 12px;margin-bottom:6px">
<span><b>${esc(f.name||f.username||('موظف '+f.user_id))}</b> <small class="text-muted">سُجل ${esc(String(f.enrolled_at||'').slice(0,10))}</small> ${f.engine === 'v2' ? '<span class="badge bdg-blue">متقدم</span>' : '<span class="badge bdg-gray">أساسي</span>'}</span>
<button class="btn btn-red btn-sm" data-karim-action="removePunchFace" data-karim-arg0="${f.user_id}"><i class=ji data-i=trash></i> إزالة</button>
</div>`).join('')
: '<small class="text-muted">لا وجوه مسجلة بعد</small>';
}

async function refreshPunchFaces(){
try{ const r = await apiFetch('/attendance/portal/face/list'); window.__punchFaces = r.faces||[]; }
catch(_){ window.__punchFaces = []; }
renderPunchFacesList();
}

async function enrollPunchFace(){
const userId = Number(document.getElementById('punchFaceUser')?.value);
if(!userId){ toast('اختر الموظف أولًا','error'); return; }
try{
toast('جارٍ فتح الكاميرا — انظر للكاميرا بثبات…','info');
// نفس الحفظ المزدوج المستخدم في الجوال (v2 صور + v1 متجهات) — البصمة تقبل أيهما جهز
const face = await window.openFaceCameraForEnrollment('تسجيل وجه: ' + (STATE.employees.find(e=>e.userId===userId)?.name||''));
const saved = await window.saveFaceEnrollment(userId, face);
if (saved.v2 || saved.v1) {
toast(window.faceEnrollMessage ? window.faceEnrollMessage(saved) : 'تم تسجيل الوجه بنجاح','success');
if (!punchBool('punch_face_enabled') && !punchBool('punch_face_v2_enabled')) {
toast('⚠️ تنبيه: محركا الوجه مطفآن في الإعدادات — فعّل أحدهما وإلا ستُرفض البصمات','error');
}
await refreshPunchFaces();
} else {
toast('فشل التسجيل: ' + (saved.v2Error || saved.v1Error || 'لا لقطة صالحة'),'error');
}
}catch(e){ if(e.message!=='FACE_CANCELLED'){ toast(e.message||'فشل التسجيل','error'); } }
}

async function removePunchFace(userId){
if(!confirm('متأكد من إزالة بصمة الوجه لهذا الموظف؟')){return;}
try{
await apiFetch('/attendance/portal/face/enroll/'+userId, { method:'DELETE' });
toast('تم إزالة الوجه','success');
await refreshPunchFaces();
}catch(e){ toast(e.message||'فشل','error'); }
}

async function loadPunchDevices(){
const box = document.getElementById('punchDevicesList');
if(!box){return;}
try{
const r = await apiFetch('/attendance/portal/punch-devices');
const rows = r.devices||[];
if(!rows.length){ box.innerHTML = '<div class="mcard u-empty">لا أجهزة مربوطة — أول بصمة من كل موظف تربط جهازه تلقائيًا</div>'; return; }
box.innerHTML = `<div style="overflow-x:auto"><table class="keep-table" style="width:100%;font-size:13px">
<thead><tr><th>المستخدم</th><th>الجهاز</th><th>IP الربط</th><th>آخر ظهور</th><th></th></tr></thead>
<tbody>${rows.map(d=>{
const when = d.last_seen_at || d.bound_at;
const dt = when ? new Date(when).toLocaleString('ar-EG',{dateStyle:'short',timeStyle:'short'}) : '—';
return `<tr style="border-top:1px solid var(--border)">
<td><b>${esc(d.name||d.username||('مستخدم #'+d.user_id))}</b>${d.username?`<br><small class="text-muted">${esc(d.username)}</small>`:''}</td>
<td><code>${esc(String(d.device_id||'').slice(0,12))}…</code></td>
<td>${esc(d.bound_ip||'—')}</td>
<td>${esc(dt)}</td>
<td><button class="btn btn-red btn-sm" data-karim-action="unbindPunchDevice" data-karim-arg0="${Number(d.user_id)}"><i class=ji data-i=trash></i> فك الربط</button></td>
</tr>`;}).join('')}</tbody></table></div>`;
}catch(e){ box.innerHTML = `<div class="mcard u-empty">تعذر تحميل الأجهزة: ${esc(e.message)}</div>`; }
}

async function unbindPunchDevice(userId){
if(!confirm('فك ربط أجهزة هذا المستخدم؟ البصمة التالية من أي جهاز ستُربط تلقائيًا.')){return;}
try{
const r = await apiFetch('/attendance/portal/punch-devices/'+userId, { method:'DELETE' });
toast('تم فك الربط ('+(r.unbound||0)+' جهاز) — البصمة التالية تربط من جديد','success');
await loadPunchDevices();
}catch(e){ toast(e.message||'فشل فك الربط','error'); }
}
export { saveNavVisibility, enrollPunchFace, removePunchFace, refreshPunchFaces, renderSettings, loadCardSettings, saveCardSettings, showOperationalResetModal, executeOperationalReset, handleLogoUpload, resetLogo, saveSettings, ZATCA_WRITE, ZATCA_STATUS_LABEL, renderZatcaHub, loadZatcaHub, zatcaSave, zatcaToggle, zatcaTest, zatcaEnvChanged, zatcaGenerateCsr, zatcaCopyCsr, zatcaCsidModal, zatcaRequestCsid, loadZatcaQueue, zatcaRetry, zatcaCsidManualModal, zatcaCsidManualSubmit, zatcaCsidClear, zatcaApplyVat, KOT_CAN_WRITE, renderKotSettings, loadKotSettings, saveKotSettings, exportAllData, showDatabaseRestoreInfo, sysFmtBytes, sysLoadBackups, sysDoBackup, sysUploadBackup, sysRestoreModal, sysConfirmRestore, resetAllData, linkedEmployeeForUser, linkedUserForEmployee, employeeAccountOptions, linkUserToEmployee, toggleEmployeeAccountFields, showCreateEmployeeAccountModal, renderUserCards, renderUsers, filterUsers, viewUserPassword, showAddUserModal, toggleUserDeptField, addUser, editUser, updateUser, deleteUser, loadPunchSettingsUI, savePunchSettings, captureRestaurantLocation, loadPunchAttempts, loadPunchDevices, unbindPunchDevice };
