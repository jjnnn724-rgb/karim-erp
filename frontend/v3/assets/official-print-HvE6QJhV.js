import{b8 as S}from"./index-CpaWCKvs.js";import{p as O}from"./print-viewer-CnSnu9Jm.js";const e=t=>String(t??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),g="شركة مطاعم الشرفة العالمي",j="AL SHURFA AL ALAMI RESTAURANTS",m="نظام Karim ERP للإدارة المتكاملة",i="#c8a24a",b="#fff3c4",C="#e0c56f",n="#0d0f0b",D="#1c241c",x="#14231f",$="#faf8ee";function R(){return new Date().toISOString().slice(0,10)}function M(){const t=new Date,s=r=>String(r).padStart(2,"0");return`${t.getFullYear()}-${s(t.getMonth()+1)}-${s(t.getDate())} ${s(t.getHours())}:${s(t.getMinutes())}`}function N(t){const s=new Date,r=R().replace(/-/g,""),c=String(s.getTime()%1e4).padStart(4,"0");return`${String(t||"doc").replace(/[^A-Za-z0-9]/g,"").slice(0,6).toUpperCase()||"DOC"}-${r}-${c}`}function E(t){return`<div class="signatures">${t.map(s=>`
        <div class="sig-box">
            <span class="sig-role">${e(s.role)}</span>
            <span class="sig-line"></span>
            <span class="sig-name">${e(s.name??"التوقيع / التاريخ")}</span>
        </div>`).join("")}</div>`}function T(t){const s=t.from??"",r=t.to??"",c=t.ref??N(t.title),f=t.signatures??[{role:"إعداد الطلب"},{role:"مراجعة المسؤول"},{role:"الاعتماد"}],u=t.kpis?.length?`<div class="kpis">${t.kpis.map(o=>`
            <div class="kpi"><span class="kpi-label">${e(o.label)}</span>
                <strong class="kpi-value">${e(o.value)}</strong>
                ${o.hint?`<span class="kpi-hint">${e(o.hint)}</span>`:""}
            </div>`).join("")}</div>`:"",y=t.sections.map(o=>{const d=[];if(d.push(`<h2 class="section-title">${e(o.heading)}</h2>`),o.columns&&o.rows?.length){const l=o.columns,k=Array.isArray(o.totalsRow)&&o.totalsRow.length>0;d.push(`
            <table class="sheet">
              <thead><tr>${l.map(a=>`<th style="${a.width?`width:${a.width};`:""}text-align:${a.align??"right"}">${e(a.header)}</th>`).join("")}</tr></thead>
              <tbody>
${o.rows.map(a=>`                <tr>${l.map(p=>`<td style="text-align:${p.align??"right"}">${e(a[p.key])}</td>`).join("")}</tr>`).join(`
`)}
${k&&o.totalsRow?`                <tr class="totals-row">${o.totalsRow.map((a,p)=>{const h=l[p],z=h?.key??String(p),A=typeof a=="string"?a:a[z];return`<td style="text-align:${h?.align??"right"}">${e(A)}</td>`}).join("")}</tr>`:""}
              </tbody>
            </table>`)}return o.list?.length&&d.push(`<ul class="bullets">${o.list.map(l=>`<li>${e(l)}</li>`).join("")}</ul>`),o.note&&d.push(`<p class="section-note">${e(o.note)}</p>`),`<section class="sheet-section">${d.join(`
`)}</section>`}).join(`
`),w=t.notes?.length?`<div class="notes">${t.notes.map(o=>`<p>◆ ${e(o)}</p>`).join("")}</div>`:"",v=M();return`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${e(t.title)} — ${e(g)}</title>
<style>
  @page { size: A4 portrait; margin: 11mm 12mm 14mm 12mm; }
  * { box-sizing: border-box; }
  body {
      margin: 0; padding: 24px 12px 48px; direction: rtl;
      font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, sans-serif;
      color: ${x}; background: #e9ebe8; font-size: 10pt;
  }
  .sheet {
      max-width: 830px; margin: auto; background: #fff;
      border: 1px solid #d8d2c2; border-radius: 16px;
      box-shadow: 0 14px 40px rgb(15 32 27 / 0.18);
      padding: 0 0 16px; overflow: hidden;
  }
  /* ── الشريط الافتتاحي: كربون × ذهبي ── */
  .sheet-head {
      display: flex; align-items: center; gap: 18px;
      background: linear-gradient(135deg, ${n} 0%, #131a12 55%, ${D} 100%);
      border-bottom: 4px solid ${i}; padding: 18px 26px;
  }
  .sheet-logo {
      width: 80px; height: 80px; object-fit: contain; flex: 0 0 auto;
      background: #fff; border: 2px solid ${i}; border-radius: 14px;
      padding: 5px; box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
  }
  .sheet-brand { display: flex; flex-direction: column; gap: 3px; }
  .sheet-company-ar { font-size: 19.5pt; font-weight: 900; color: #f5efdc; letter-spacing: -0.01em; line-height: 1.18; }
  .sheet-company-en { font-size: 7.5pt; font-weight: 800; letter-spacing: 0.22em; color: ${i}; text-transform: uppercase; }
  .sheet-company-sub { font-size: 6.5pt; color: rgb(245 239 220 / 0.55); }
  .sheet-ref { margin-inline-start: auto; text-align: end; color: #d9cfa8; font-size: 7pt; line-height: 1.75; }
  .sheet-ref b { display: block; font-size: 12pt; color: ${b}; font-variant-numeric: tabular-nums; letter-spacing: 0.05em; }
  /* ── ترويسة المستند ── */
  .doc-headline {
      position: relative; display: flex; align-items: center; justify-content: center; gap: 18px;
      padding: 16px 24px 4px; border-bottom: 1px solid #e3ded0;
  }
  .doc-eyebrow { position: absolute; inset-block-start: 10px; inset-inline-start: 28px; font-size: 6.5pt; letter-spacing: 0.30em; font-weight: 800; color: #8a6b2f; }
  .doc-title { margin: 8px 0 0; font-size: 26pt; font-weight: 900; color: ${n}; }
  .doc-sub { font-size: 8pt; color: #6b6556; }
  .stamp {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 6px 16px; border-radius: 999px; font-size: 10pt; font-weight: 900;
      background: ${n}; color: ${b}; border: 1.8px solid ${i};
      box-shadow: 0 2px 10px rgb(0 0 0 / 0.22);
  }
  .period-line { text-align: center; font-size: 9pt; color: #34362c; padding: 5px 0; border-block-start: 1px solid #e3ded0; border-block-end: 1px solid #e3ded0; margin-block: 4px 8px; background: ${$}; }
  .period-line b { color: #4b3810; }
  /* ── شبكة KPI العصرية ── */
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 6px; padding: 12px 26px 4px; }
  .kpi {
      border: 1px solid #e2ddd0; border-block-start: 4px solid ${i}; border-radius: 10px;
      background: #fdfcf8; padding: 6px 10px; text-align: center;
  }
  .kpi-label { font-size: 7pt; font-weight: 800; color: #8a6b2f; display: block; letter-spacing: 0.03em; }
  .kpi-value { font-size: 15pt; font-weight: 900; color: ${x}; font-variant-numeric: tabular-nums; }
  .kpi-hint { font-size: 6pt; color: #8a8672; display: block; margin-top: 1px; }
  /* ── الأقسام ── */
  .sheet-section { padding: 8px 26px 0; break-inside: avoid; page-break-inside: avoid; }
  .section-title {
      font-size: 11pt; font-weight: 900; color: ${n};
      border-bottom: 2.4px solid ${i}; padding-bottom: 4px; margin-bottom: 6px; letter-spacing: 0.01em;
  }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 8.5pt; }
  .sheet thead th {
      background: ${n}; color: ${C}; font-size: 8pt; font-weight: 800; letter-spacing: 0.04em;
      border: 1px solid ${n}; padding: 5px 7px; text-align: right;
  }
  .sheet td { border: 1px solid #d9d5c8; padding: 4px 7px; text-align: right; font-variant-numeric: tabular-nums; }
  .sheet tbody tr:nth-child(even) td { background: ${$}; }
  .sheet .totals-row td {
      background: ${n} !important; color: ${b}; font-weight: 900;
      border: 1px solid ${n}; font-size: 9pt; padding: 6px 7px;
  }
  .bullets { margin: 4px 0 0; padding-inline-start: 22px; font-size: 8pt; }
  .bullets li { margin-bottom: 2px; }
  .section-note { font-size: 7.5pt; color: #6b6556; border: 1px dashed #c8ae74; border-radius: 6px; padding: 4px 8px; margin-top: 6px; background: #fffdf4; }
  /* ── ملاحظات ختامية ── */
  .notes { margin: 10px 26px 0; border: 1px solid #e2ddd0; border-inline-start: 4px solid ${i};
      border-radius: 10px; background: #fdfaf0; padding: 8px 12px; font-size: 7.6pt; color: #5c563f; line-height: 1.9; }
  .notes p { margin: 0 0 2px; }
  .notes p:last-child { margin-bottom: 0; }
  /* ── سطر التوقيع الرسمي ── */
  .signatures { display: flex; gap: 14px; padding: 14px 26px 0; break-inside: avoid; }
  .sig-box {
      flex: 1; border: 1px solid #e2ddd0; border-block-start: 3px solid ${i}; border-radius: 10px;
      background: #fdfcf8; padding: 8px 8px 10px; display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center;
  }
  .sig-role { font-size: 8.5pt; font-weight: 800; color: #4b4433; }
  .sig-line { width: 78%; border-bottom: 1.6px dotted #a89e7c; height: 34px; }
  .sig-name { font-size: 6.5pt; color: #8a8672; }
  /* ── ذيل الورقة ── */
  .sheet-foot {
      margin-top: 12px; border-top: 1.6px solid ${i}; padding: 8px 26px 0;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      font-size: 6.5pt; color: #6b6556;
  }
  .sheet-foot b { color: ${x}; }
  @media print {
      body { padding: 0; background: #fff; }
      .sheet { box-shadow: none; border: 0; border-radius: 0; max-width: none; }
      .sheet-head, .sheet thead th, .totals-row td, .status-stamp, .stamp {
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
  }
</style></head><body>
<article class="sheet">
  <header class="sheet-head">
    <img class="sheet-logo" src="${S}" alt="شعار الشركة" />
    <div class="sheet-brand">
      <div class="sheet-company-ar">${g}</div>
      <div class="sheet-company-en" lang="en" dir="ltr">${j}</div>
      <div class="sheet-company-sub">${m}</div>
    </div>
    <div class="sheet-ref">
      <small>رقم المستند</small>
      <b dir="ltr">${e(c)}</b>
      <span>زمن الطباعة: <span dir="ltr">${e(v)}</span></span>
    </div>
  </header>

  <div class="doc-headline">
    <span class="doc-eyebrow" lang="en" dir="ltr">${e(t.englishTitle??"OFFICIAL DOCUMENT")}</span>
    <div>
      <h1 class="doc-title">${e(t.title)}</h1>
      ${t.subtitle?`<div class="doc-sub">${e(t.subtitle)}</div>`:""}
    </div>
    ${t.stamp?`<span class="stamp">${e(t.stamp)}</span>`:""}
  </div>
  ${s||r?`<div class="period-line">الفترة: <b>${e(s||"بداية السجل")}</b> ← <b>${e(r||"اليوم")}</b></div>`:""}

  ${u}
  ${y}
  ${w}
  ${E(f)}

  <footer class="sheet-foot">
    <span><b>${g}</b> — ${m}</span>
    <span>مستند رسمي داخلي — للاستخدام الرسمي فقط</span>
    <span dir="ltr">${e(c)}</span>
  </footer>
</article>
</body></html>`}function P(t){const s=T(t);return O(s,{autoPrint:!0,printDelayMs:350})}export{T as b,P as p};
