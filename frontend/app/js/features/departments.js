/**
 * features/departments.js — extracted verbatim from app.js (see docs/esm-migration/MIGRATION_CHANGE_LOG.md).
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (see BRIDGE log).
 */
// ============================================
// DEPARTMENTS
// ============================================
const DEPARTMENT_ICON_OPTIONS=[['building','مبنى'],['store','متجر'],['chef-hat','مطبخ'],['package','مخزن'],['banknote','حسابات'],['users','موظفون'],['chart','تقارير'],['utensils','مطعم']];
function normalizeDepartmentIcon(value){const raw=String(value||'').trim();const match=raw.match(/data-i=["']?([a-z0-9-]+)/i);const key=match?match[1]:raw;return window.KARIM_ICONS&&KARIM_ICONS[key]?key:'building';}
function departmentIconOptions(selected){const key=normalizeDepartmentIcon(selected);return DEPARTMENT_ICON_OPTIONS.map(([value,label])=>`<option value="${value}" ${value===key?'selected':''}>${label}</option>`).join('');}
function deptIcon(d){ return ico(normalizeDepartmentIcon(d&&d.icon)); }
function deptIconMarkup(d){ return deptIcon(d); }
/* بطاقة المطبخ العام — تجميعية: إيراد ومصروف المطبخ + كل أقسامه الفرعية
   (حلواني، سلطات، خباز، مطبخ ساخن، استيورد، صالة ساخنة...) في مكان واحد.
   كل إذن صرف لأي قسم فرعي يظهر مصروفًا في قسمه ومُجمَّعًا هنا تلقائيًا. */
function kitchenRollupCard(){
const kitchen=(STATE.departments||[]).find(d=>String(d.code)==='kitchen');
if(!kitchen) {return '';}
const s=calcStats('kitchen');
const kids=(STATE.departments||[]).filter(d=>String(d.parent_code||'')==='kitchen');
const kidBadges=kids.map(k=>{const ks=calcStats(k.code);return `<span class="badge bdg-blue" title="مصروف ${fC(ks.exp)} • إيراد ${fC(ks.rev)}">${esc(k.icon||'•')} ${esc(k.name)}: ${fC(ks.exp)}</span>`;}).join(' ');
return `<div class="dept-card u-mt16" style="grid-column:1/-1;border:2px solid #c9a227;background:linear-gradient(135deg,rgba(201,162,39,.08),rgba(201,162,39,.02));cursor:pointer" onclick="openDepartmentDetail('kitchen')">
<div class="dept-hd"><span class="dept-ic" style="font-size:26px">🍳</span><div class="dept-info"><div class="dept-name" style="font-size:18px">المطبخ العام <span class="badge bdg-gold">بطاقة تجميعية</span></div><div class="dept-code">الإيراد من كاشير البوفيه (9) والمبيعات المباشرة • المصروف من أذون الصرف لكل الأقسام الفرعية</div></div>
<div class="dept-badge">${t('dept.cost')} ${fN(s.costRatio.toFixed(1))}%</div></div>
<div class="dept-stats"><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=banknote></i> إجمالي الإيراد</div><div class="dstat-val c-gold">${fC(s.rev)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=wallet></i> إجمالي المصروف (أذون الصرف)</div><div class="dstat-val c-red">${fC(s.exp)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=gem></i> الصافي</div><div class="dstat-val ${s.profit>=0?'c-green':'c-red'}">${fC(s.profit)}</div></div></div>
${kids.length?`<div class="u-mt8" style="font-size:12px;display:flex;flex-wrap:wrap;gap:6px">${kidBadges}</div>`:''}
</div>`;
}
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
return `<div id="cashLiveBoard"><div class="mcard"><div class="spinner"></div><div class="u-sub">جاري تحميل لوحة الكاشيرية الحية...</div></div></div>${kitchenRollupCard()}<div class="u-row-between"><h3 class="u-gold-strong"><i class=ji data-i=building></i> ${t('dept.title')}</h3><button class="btn btn-gold" onclick="showAddDepartmentModal()"><i class=ji data-i=plus></i> ${t('dept.add')}</button></div><div class="dept-grid">${STATE.departments.filter(d=>!HIDDEN_DEPTS.includes(String(d.code))).map(d=>{const s=calcStats(d.code);const parent=STATE.departments.find(x=>x.code===d.parent_code);const kidCount=STATE.departments.filter(x=>x.parent_code===d.code).length;return `<div class="dept-card" onclick="openDepartmentDetail('${d.code}')"><div class="dept-hd"><span class="dept-ic">${deptIconMarkup(d)}</span><div class="dept-info"><div class="dept-name">${esc(d.name)}</div><div class="dept-code">${d.code}${parent?` · <span class="badge bdg-blue" title="مصروفات وإيرادات هذا القسم تُرحَّل إلى ${esc(parent.name)}">تابع: ${esc(parent.name)}</span>`:''}${kidCount?` · <span class="badge bdg-green" title="يشمل ${kidCount} قسم فرعي">+${kidCount} فرعي</span>`:''}</div></div><div class="dept-badge">${t('dept.cost')} ${fN(s.costRatio.toFixed(1))}%</div></div><div class="dept-stats"><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=banknote></i> ${t('dept.revenue')}</div><div class="dstat-val c-gold">${fC(s.rev)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=wallet></i> ${t('dept.expense')}</div><div class="dstat-val c-red">${fC(s.exp)}</div></div><div class="dstat"><div class="dstat-lbl"><i class=ji data-i=gem></i> ${t('dept.profit')}</div><div class="dstat-val ${s.profit>=0?'c-green':'c-red'}">${fC(s.profit)}</div></div></div><div class="u-footer-sep"><button class="btn btn-sm u-flex1" onclick="event.stopPropagation();editDepartment('${d.code}')"><i class=ji data-i=pencil></i> ${t('dept.edit')}</button><button class="btn btn-red btn-sm u-flex1" onclick="event.stopPropagation();deleteDepartment('${d.code}')"><i class=ji data-i=trash></i> ${t('dept.delete')}</button></div></div>`;}).join('')}</div>`;
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
const sig=JSON.stringify([d?.day_total,d?.cashiers_total,(d?.cashiers||[]).map(c=>[c.cashier_no,c.today_invoices,c.today_total,c.last_at]),(t?.cashiers||[]).map(c=>[c.no,c.invoices,c.net])]);
if(silent&&window._cashLiveSig===sig){ return; }
window._cashLiveSig=sig;
}catch(_){}
const day=d?.today||cashTodayStr();
const isToday=!CASH_LIVE_DATE;
const total=Number(d?.day_total?.total||t?.total?.net||0);
const tByNo={}; (t?.cashiers||[]).forEach(c=>{ tByNo[String(c.no)]=c; });
// دمج مباشر أوراكل: أي بيع في 1/4/5/6/9 يظهر فورا حتى قبل مزامنة المحلي (1 دقيقة)
const list=(d?.cashiers||[]).filter(c=>!HIDDEN_CASHIERS.includes(String(c.cashier_no))).slice();
for(const oc of (t?.cashiers||[])){
const no=String(oc.no);
if(HIDDEN_CASHIERS.includes(no)) continue;
const found=list.find(c=>String(c.cashier_no)===no);
if(!found){
list.push({cashier_no:no,name:oc.name||('كاشير '+no),dept_code:'',today_invoices:oc.invoices||0,today_total:oc.net||0,yday_invoices:0,yday_total:0,delta_pct:null,last_at:null,live:true});
}else{
// لو المباشر أعلى (بيع لسه ما اتزامنش) اعرض الأعلى فورا
if(Number(oc.net||0)>Number(found.today_total||0)){found.today_total=oc.net;found.today_invoices=Math.max(Number(found.today_invoices||0),Number(oc.invoices||0));found.live=true;}
}
}
const ranked=list.slice().sort((a,b)=>Math.max(Number(b.today_total||0),Number((tByNo[String(b.cashier_no)]||{}).net||0))-Math.max(Number(a.today_total||0),Number((tByNo[String(a.cashier_no)]||{}).net||0)));
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

export { DEPARTMENT_ICON_OPTIONS, normalizeDepartmentIcon, departmentIconOptions, deptIcon, deptIconMarkup, renderDepartments, CASHIER_ICONS, HIDDEN_CASHIERS, HIDDEN_DEPTS, CASH_LIVE_DATE, cashTodayStr, cashShiftDate, cashTime, cashNavDay, cashPickDay, cashBarsSVG, loadCashiersLive, openCashierLive, deptParentOptions, showAddDepartmentModal, addDepartment, editDepartment, updateDepartment, deleteDepartment, renderDepartmentDetail };
