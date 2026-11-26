import{V as R,W as T,X as L,Y as N,Z as j,f as O,g as P,$ as I}from"./index-Ctf9SANy.js";import{w as z}from"./attendance-RYKDal_N.js";const D=62,F=/^\d{4}-\d{2}-\d{2}$/;function S(t){return F.test(String(t||""))}function k(t,n,a=D){if(!S(String(t||""))||!S(String(n||"")))return[];const u=[],m=new Date(`${String(n).slice(0,10)}T12:00:00`);for(let l=new Date(`${String(t).slice(0,10)}T12:00:00`);l<=m&&u.length<a;l.setDate(l.getDate()+1))u.push(`${l.getFullYear()}-${String(l.getMonth()+1).padStart(2,"0")}-${String(l.getDate()).padStart(2,"0")}`);return u}const h=R().nullable().optional(),o=T([R(),I()]).nullable().optional(),K=L({employee:L({id:T([R(),I()]).nullable().optional(),name:h,employeeId:h,position:h,shift_start:h,shift_karim:o,day_off:o}).passthrough().nullable().optional(),records:N(L({date:h,checkIn:h,checkOut:h,workMinutes:o,lateMinutes:o,arrivalLateRawMinutes:o,earlyLeaveRawMinutes:o,needsReview:j().nullable().optional()}).passthrough()).nullable().optional(),summary:L({from:h,to:h,daysPresent:o,completeDays:o,lateDays:o,rawLateDays:o,reviewDays:o,reviewMinutes:o,totalMinutes:o,totalLateMinutes:o,totalRawLateMinutes:o,totalKarim:o}).passthrough().nullable().optional()}).passthrough();async function C(t,n,a,u){const m=new URLSearchParams({employee_id:String(t),from:n,to:a});return O(K,`/api/hr/attendance/report?${m.toString()}`,P(),u?{signal:u}:{})}const A={absent:{label:"لم يحضر",tone:"danger"},"day-off":{label:"راحة أسبوعية",tone:"neutral"},review:{label:"يحتاج مراجعة",tone:"warning"},"no-in":{label:"بلا حضور",tone:"warning"},"no-out":{label:"بلا انصراف",tone:"warning"},late:{label:"تأخير",tone:"danger"},"within-grace":{label:"ضمن السماح",tone:"info"},"in-time":{label:"في الموعد",tone:"success"}};function s(t){return String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function E(t){const n=Math.max(0,Math.round(Number(t)||0));return`${Math.floor(n/60)}:${String(n%60).padStart(2,"0")}`}function G(t){const{employeeName:n,employeeCode:a,department:u,position:m,report:l}=t,{summary:r,rows:y}=l,f=t.generatedAt??new Date,w=e=>String(e).padStart(2,"0"),g=`${w(f.getDate())}/${w(f.getMonth()+1)}/${f.getFullYear()} ${w(f.getHours())}:${w(f.getMinutes())}`,i=(e,b)=>`<div class="stat"><strong>${s(b)}</strong><span>${s(e)}</span></div>`,p=y.map(e=>{const b=A[e.state]??A.review,v=[e.arrivalLateRaw>0?`دخول ${M(e.arrivalLateRaw)}`:"",e.earlyLeaveRaw>0?`انصراف ${M(e.earlyLeaveRaw)}`:""].filter(Boolean).join(" · "),d=e.lateMinutes>0&&e.lateMinutes!==e.arrivalLateRaw+e.earlyLeaveRaw?`محسَب ${M(e.lateMinutes)}`:"",_=[v,d].filter(Boolean).map(s).join(" · ");return`<tr>
                <td class="numeric">${s(e.date)}</td>
                <td>${s(z(e.date))}</td>
                <td class="numeric">${s(e.checkIn||"—")}</td>
                <td class="numeric">${s(e.checkOut||"—")}</td>
                <td class="numeric">${s(E(e.minutes))}</td>
                <td>${_||"—"}</td>
                <td>${s(b.label)}</td>
            </tr>`}).join(""),x=Number.isFinite(r.totalKarim)?r.totalKarim.toLocaleString("en-US",{maximumFractionDigits:2}):"—",$=`كشف حضور وانصراف — ${n}`;return`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${s($)}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;color:#172b3b;background:#fff;font:14px 'Tajawal','Segoe UI',Tahoma,Arial,sans-serif}
.sheet{max-width:1100px;margin:auto}.head{border-bottom:3px solid #0f766e;padding-bottom:14px;margin-bottom:16px}
h1{margin:0 0 8px;color:#102a43;font-size:22px}.identity,.period,.stats{display:flex;flex-wrap:wrap;gap:8px 18px}
.identity{color:#596e80}.identity strong{color:#172b3b}.period{justify-content:center;margin:14px 0;color:#102a43;font-weight:700}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(125px,1fr));margin:12px 0}
.stat{display:flex;flex-direction:column;gap:3px;border:1px solid #dce5ec;border-radius:8px;padding:8px 10px;background:#f3f6fa}
.stat strong{font-size:17px;color:#102a43}.stat span{font-size:12px;color:#596e80}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #dce5ec;padding:7px 8px;text-align:right}
th{background:#102a43;color:#f0f6fa;white-space:nowrap}tbody tr:nth-child(even){background:#f3f6fa}.numeric{direction:ltr;unicode-bidi:embed;text-align:center}
.foot{margin-top:12px;color:#596e80;font-size:11px}.actions{margin:0 auto 16px;max-width:1100px}
@media print{body{padding:0}.sheet{max-width:none}thead{display:table-header-group}tr{break-inside:avoid}}
</style></head><body>
<main class="sheet"><header class="head"><h1>${s($)}</h1>
<div class="identity"><span>رقم الموظف: <strong>${s(a||"—")}</strong></span>
<span>القسم: <strong>${s(u||"—")}</strong></span><span>الوظيفة: <strong>${s(m||"—")}</strong></span></div></header>
<div class="period">الفترة: <span class="numeric">${s(r.from)}</span> — <span class="numeric">${s(r.to)}</span></div>
<section class="stats" aria-label="ملخص الحضور">
${i("أيام الحضور",r.daysPresent)}${i("أيام مكتملة",r.completeDays)}
${i("عليها تأخير",r.rawLateDays)}${i("أيام التأخير المحتسب",r.lateDays)}
${i("التأخير الفعلي",r.totalRawLateMinutes>0?M(r.totalRawLateMinutes):"—")}
${i("التأخير المحتسب",r.totalLateMinutes>0?M(r.totalLateMinutes):"—")}
${i("إجمالي الساعات",x)}
</section>
<table><thead><tr><th>التاريخ</th><th>اليوم</th><th>الحضور</th><th>الانصراف</th><th>الساعات</th><th>التأخير</th><th>الحالة</th></tr></thead>
<tbody>${p||'<tr><td colspan="7">لا أيام في هذه الفترة</td></tr>'}</tbody></table>
<p class="foot">تاريخ إنشاء التقرير: ${s(g)}${l.truncated?" · الكشف محدود بـ 62 يومًا":""}</p>
</main></body></html>`}function c(t){const n=Number(t??0);return Number.isFinite(n)?Math.round(n):0}function H(t,n){return t==null||!S(n)?!1:new Date(`${n}T12:00:00`).getDay()===t}function B(t,n){const a=t.summary??{},u=Array.isArray(t.records)?t.records:[],m=new Map;for(const g of u){const i=String(g?.date??"").slice(0,10);S(i)&&m.set(i,g)}const l=String(a.from??"").slice(0,10),r=String(a.to??"").slice(0,10);let y=k(l,r);const f=y.length===D&&k(l,r,D+1).length>D;return y.length||(y=[...m.keys()].sort()),{rows:y.map(g=>{const i=H(n,g),p=m.get(g);if(!p)return{date:g,state:i?"day-off":"absent",weeklyOff:i,minutes:0,lateMinutes:0,arrivalLateRaw:0,earlyLeaveRaw:0,withinGrace:!1,checkIn:"",checkOut:""};const x=String(p.checkIn||"").trim(),$=String(p.checkOut||"").trim(),e=Math.max(0,c(p.lateMinutes)),b=Math.max(0,c(p.arrivalLateRawMinutes)),v=Math.max(0,c(p.earlyLeaveRawMinutes));let d;return!x&&i?d="day-off":p.needsReview?d="review":x?$?e>0?d="late":b>0||v>0?d="within-grace":d="in-time":d="no-out":d="no-in",{date:g,state:d,checkIn:x,checkOut:$,weeklyOff:i,minutes:Math.max(0,c(p.workMinutes)),lateMinutes:e,arrivalLateRaw:b,earlyLeaveRaw:v,withinGrace:d==="within-grace"}}),truncated:f,summary:{from:l,to:r,daysPresent:c(a.daysPresent),completeDays:c(a.completeDays),rawLateDays:c(a.rawLateDays),lateDays:c(a.lateDays),reviewDays:c(a.reviewDays),reviewMinutes:c(a.reviewMinutes),totalRawLateMinutes:c(a.totalRawLateMinutes),totalLateMinutes:c(a.totalLateMinutes),totalKarim:Number(a.totalKarim??0)}}}function M(t){return`${t.toLocaleString("en-US")} د`}export{A,G as e,C as f,M as m,B as r};
