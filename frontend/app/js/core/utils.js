/**
 * core/utils.js — formatters, esc, load helpers, Hijri date system
 *   (extracted verbatim from app.js — EXTRACTION-003)
 * Bridge policy: all top-level bindings are mounted on window by js/main.js (BRIDGE-003).
 * External dependency: STATE (window.STATE) — read at call time only. Intl (builtin) used for Hijri.
 */
function uid(){ return Date.now() + Math.floor(Math.random()*9999); }
function esc(s){ return s ? String(s).replace(/[&<>"']/g, m =>
({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : ''; }
/**
 * مصدر صورة آمن للعرض في <img src> — إصلاح XSS (2026-10-01): esc() لا يحجب
 * javascript: (بلا محارف خاصة) فأي صورة مخزنة خبيثة كانت تنفذ عند العرض.
 * المسموح: data:image/* و http(s) ومسارات نسبية فقط — غيرها = سلسلة فارغة.
 */
function safeImgSrc(v){
const s = String(v || '').trim();
if (/^data:image\/(png|jpeg|gif|webp);base64,/i.test(s)) {return s;}
if (/^https?:\/\/[^"'<>\s]+$/i.test(s)) {return s;}
if (/^\/[^"'<>\s]*$/.test(s) || /^uploads\//i.test(s)) {return s;}
return '';
}
function today(){ return new Date().toISOString().split('T')[0]; }
function nowTime(){ return new Date().toTimeString().substring(0,5); }
function fN(n){ const v = parseFloat(n||0); return v.toLocaleString('en-US',{minimumFractionDigits:v%1!==0?2:0,maximumFractionDigits:2}); }
function fC(n){ return `${fN(n)} <span class="cur">${STATE.settings.currency}</span>`; }
function fD(d){ return d ? new Date(d).toLocaleDateString(STATE.lang==='en'?'en-US':'ar-EG',{day:'2-digit',month:'short',year:'numeric'}) : '—'; }
// التاريخ الهجري (أم القرى) — للشهادات والوثائق
function fHijri(d){
  if(!d) {return '—';}
  try{
    const dt = new Date(String(d).length <= 10 ? String(d) + 'T12:00:00' : d);
    if(Number.isNaN(dt.getTime())) {return '—';}
    return dt.toLocaleDateString('ar-SA-u-ca-islamic-umalqura', { day: 'numeric', month: 'long', year: 'numeric' });
  }catch(_){ return '—'; }
}
const HIJRI_MONTHS = ['محرم','صفر','ربيع الأول','ربيع الآخر','جمادى الأولى','جمادى الآخرة','رجب','شعبان','رمضان','شوال','ذو القعدة','ذو الحجة'];
// ميلادي → هجري {y,m,d} بتقويم أم القرى نفسه
function gregToHijriParts(iso){
  try{
    const dt = new Date(String(iso).length <= 10 ? String(iso) + 'T12:00:00' : iso);
    if(Number.isNaN(dt.getTime())) {return null;}
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(dt);
    const g = {};
    parts.forEach(p => { g[p.type] = p.value; });
    const y = parseInt((g.year || '').replace(/[^0-9]/g, ''), 10);
    const m = parseInt(g.month, 10), d = parseInt(g.day, 10);
    if(!y || !m || !d) {return null;}
    return { y, m, d };
  }catch(_){ return null; }
}
// هجري → ميلادي ISO (بحث ثنائي على تقويم أم القرى — دقيق)
function hijriToGregorian(hy, hm, hd){
  hy = Number(hy); hm = Number(hm); hd = Number(hd);
  if(!hy || !hm || !hd || hm < 1 || hm > 12 || hd < 1 || hd > 30) {return '';}
  const key = (parts) => {
    const g = {};
    parts.forEach(p => { g[p.type] = p.value; });
    return [parseInt((g.year || '').replace(/[^0-9]/g, ''), 10), parseInt(g.month, 10), parseInt(g.day, 10)].join('-');
  };
  const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', year: 'numeric' });
  const target = [hy, hm, hd].join('-');
  let lo = Date.UTC(2020, 0, 1), hi = Date.UTC(2042, 11, 31);
  for(let i = 0; i < 25 && lo <= hi; i++){
    const mid = Math.floor((lo + hi) / 2 / 86400000) * 86400000;
    const cur = key(fmt.formatToParts(new Date(mid)));
    if(cur === target){
      const d = new Date(mid);
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    }
    // مقارنة تسلسلية: حوّل cur لمقارنته (y,m,d) — بما أن التقويم رتيب يكفي الاتجاه
    const [cy, cm, cd] = cur.split('-').map(Number);
    if(cy < hy || (cy === hy && (cm < hm || (cm === hm && cd < hd)))) {lo = mid + 86400000;}
    else {hi = mid - 86400000;}
  }
  return '';
}
// حقل تاريخ هجري/ميلادي: زر تبديل + 3 قوائم هجري أو حقل ميلادي
// defaultMode='greg' يفتح لوحة الميلادي افتراضيًا (الإقامة: القيمة المصدري ميلادي)
function hijriDateField(prefix, gregValue, defaultMode){
  const cur = gregToHijriParts(gregValue) || gregToHijriParts(today());
  const nowH = gregToHijriParts(today()) || { y: 1447 };
  let years = '';
  for(let y = nowH.y - 1; y <= nowH.y + 10; y++) {years += `<option value="${y}" ${cur && cur.y === y ? 'selected' : ''}>${y}هـ</option>`;}
  const days = Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}" ${cur && cur.d === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  const months = HIJRI_MONTHS.map((m, i) => `<option value="${i + 1}" ${cur && cur.m === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
  const gregFirst = defaultMode === 'greg';
  return `
  <input type="hidden" id="${prefix}" value="${esc(gregValue || '')}">
  <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
    <button type="button" class="btn btn-xs btn-outline" id="${prefix}Toggle" data-karim-action="toggleDateMode" data-karim-arg0="${prefix}" title="تبديل بين هجري وميلادي">
      <i class=ji data-i=calendar></i> <span id="${prefix}ModeLabel">${gregFirst ? 'ميلادي' : 'هجري'}</span>
    </button>
    <small class="text-muted" id="${prefix}Greg">${esc(gregValue || '—')}</small>
  </div>
  <div id="${prefix}HijriPanel" ${gregFirst ? 'style="display:none"' : ''}>
    <div class="fr" style="gap:6px">
      <div class="fg"><label>اليوم</label><select id="${prefix}Hd" data-karim-action="syncHijriToGreg" data-karim-event="change" data-karim-arg0="${prefix}">${days}</select></div>
      <div class="fg"><label>الشهر</label><select id="${prefix}Hm" data-karim-action="syncHijriToGreg" data-karim-event="change" data-karim-arg0="${prefix}">${months}</select></div>
      <div class="fg"><label>السنة</label><select id="${prefix}Hy" data-karim-action="syncHijriToGreg" data-karim-event="change" data-karim-arg0="${prefix}">${years}</select></div>
    </div>
  </div>
  <div id="${prefix}GregPanel" ${gregFirst ? '' : 'style="display:none"'}>
    <input type="date" id="${prefix}GregInput" value="${esc(gregValue || '')}" data-karim-action="syncGregToHijri" data-karim-event="change" data-karim-arg0="${prefix}" class="input" style="width:100%">
  </div>`;
}
function toggleDateMode(prefix){
  const hijriPanel = document.getElementById(prefix + 'HijriPanel');
  const gregPanel = document.getElementById(prefix + 'GregPanel');
  const modeLabel = document.getElementById(prefix + 'ModeLabel');
  if(!hijriPanel || !gregPanel) {return;}
  const isHijri = hijriPanel.style.display !== 'none';
  if(isHijri){
    hijriPanel.style.display = 'none';
    gregPanel.style.display = '';
    modeLabel.textContent = 'ميلادي';
    // Sync current hijri value to greg input
    const hid = document.getElementById(prefix);
    const gregInput = document.getElementById(prefix + 'GregInput');
    if(hid && gregInput) {gregInput.value = hid.value || '';}
  } else {
    hijriPanel.style.display = '';
    gregPanel.style.display = 'none';
    modeLabel.textContent = 'هجري';
    // Sync greg input to hijri dropdowns
    const gregInput = document.getElementById(prefix + 'GregInput');
    if(gregInput) {syncGregToHijri(prefix);}
  }
}
function syncGregToHijri(prefix){
  const gregInput = document.getElementById(prefix + 'GregInput');
  if(!gregInput) {return;}
  const iso = gregInput.value;
  const hid = document.getElementById(prefix);
  if(hid) {hid.value = iso;}
  const g = document.getElementById(prefix + 'Greg');
  if(g) {g.textContent = iso || '—';}
  // Update hijri dropdowns
  const parts = gregToHijriParts(iso);
  if(parts){
    const hd = document.getElementById(prefix + 'Hd');
    const hm = document.getElementById(prefix + 'Hm');
    const hy = document.getElementById(prefix + 'Hy');
    if(hd) {hd.value = parts.d;}
    if(hm) {hm.value = parts.m;}
    if(hy) {hy.value = parts.y;}
  }
}
function syncHijriToGreg(prefix){
  const y = document.getElementById(prefix + 'Hy')?.value;
  const m = document.getElementById(prefix + 'Hm')?.value;
  const d = document.getElementById(prefix + 'Hd')?.value;
  const iso = hijriToGregorian(y, m, d);
  const hid = document.getElementById(prefix);
  if(hid) {hid.value = iso;}
  const g = document.getElementById(prefix + 'Greg');
  if(g) {g.textContent = iso || '—';}
}
function fDT(d){ return d ? new Date(d).toLocaleString(STATE.lang==='en'?'en-US':'ar-EG') : ''; }

// ═══ ذكاء البحث العربي (طلب المالك 2026-10-06: «بكتب بازنجان مش جايبها») ═══
// مفتاح بحث متسامح: يوحّد الهمزات والتاء والألف المقصورة ويطوي عائلات الحروف
// المتشابهة بالنقاط (ز/ذ، ص/ض، ط/ظ، س/ش، ت/ث، ج/ح/خ، ف/ق، ع/غ) — فتجد الصنف
// رغم الخطأ المطبعي الشائع في لمس النقاط على الكيبورد
function arSearchKey(s){
  return String(s||'').toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/[ىئی]/g,'ي').replace(/ؤ/g,'و').replace(/ک/g,'ك')
    .replace(/[ذز]/g,'ز').replace(/[ضص]/g,'ص').replace(/[ظط]/g,'ط').replace(/[شس]/g,'س')
    .replace(/[ثت]/g,'ت').replace(/[خج]/g,'ح').replace(/[قف]/g,'ف').replace(/[غع]/g,'ع')
    .replace(/\s+/g,' ').trim();
}
function arSearchIncludes(hay, q){
  const h = arSearchKey(hay), n = arSearchKey(q);
  return n.length > 0 && h.includes(n);
}

export { uid, esc, safeImgSrc, today, nowTime, fN, fC, fD, fHijri, HIJRI_MONTHS, gregToHijriParts, hijriToGregorian, hijriDateField, toggleDateMode, syncGregToHijri, syncHijriToGreg, fDT, arSearchKey, arSearchIncludes };
