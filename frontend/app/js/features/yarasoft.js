/**
 * features/yarasoft.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
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

export { YSSTATE, renderYarasoftPage, ysRefresh, ysLoadOracleBox, ysOracleImportItems, ysOraclePollNow, ysReconcile, ysCatchUp, ysCatchUpStatus, ysOracleTest, ysSetTab, ysRenderBody, ysNetBadge, ysRenderStatus, ysStatusBadge, ysTableSearch, ysPrintReport, ysRunNow, ysReprocess, ysPrintLog, ysViewInvoice, ysPrintInvoiceDetail, ysLoadReview, ysRenderReview, ysPrintReview, ysResolveReview, ysConfirmReview, ysLoadMappings, ysRenderMappings, ysAddMappingModal, ysSaveMapping, ysDeactivateMapping, ysLoadSections, ysRenderSections, ysPrintSections, ysCashierIcon, ysCashierCards, ysOpenSecInvoices, ysSecInvReload, ysSecInvToggleAll, ysSecInvReclassify, ysCloseSecDrill, ysInvDetail, ysPrintInvDetail, ysApproveSectionModal, ysConfirmApproveSection, ysRenameSectionModal, ysConfirmRenameSection, ysManualSectionModal, ysConfirmManualSection, ysLoadWarehouse, ysPrintQuarantine, ysOrganizeCategories, ysSyncBalances, ysRenderTools, ysPreview };
