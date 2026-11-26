const n=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" role="img" aria-label="مطاعم الشرفة العالمي" style="block-size:46px;inline-size:auto">
  <g fill="#B08D57" text-anchor="middle" font-family="Amiri,'Aref Ruqaa','Times New Roman',serif">
    <circle cx="132" cy="22" r="2.6"/><circle cx="150" cy="16" r="3"/><circle cx="168" cy="22" r="2.6"/>
    <path d="M96 34 H204" stroke="#B08D57" stroke-width="1.4" fill="none"/>
    <text x="150" y="74" font-size="46" font-weight="700">الشرفة</text>
    <text x="150" y="103" font-size="15">مطاعم الشرفة العالمي</text>
  </g>
  <g fill="#B08D57" text-anchor="middle" font-family="Cinzel,Georgia,serif">
    <text x="150" y="124" font-size="11" font-weight="700" letter-spacing="1.6">AL SHURFA AL ALAMI</text>
    <text x="150" y="140" font-size="8.5" font-weight="600" letter-spacing="3.4">RESTAURANTS</text>
  </g>
</svg>`,r=`<div class="karim-print-brand" data-print-brand>${n}<span class="karim-print-brand__rule"></span></div>`,a=`
.karim-print-brand{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-block:0 14px;padding-block-end:10px;border-block-end:2px solid #B08D57;direction:rtl}
.karim-print-brand__rule{flex:1;block-size:1px;background:linear-gradient(90deg,#B08D57,transparent);opacity:.65}
@media print{.karim-print-brand{break-inside:avoid;print-color-adjust:exact;-webkit-print-color-adjust:exact}}
`;function l(i){if(!i||i.includes("data-print-brand"))return i;let e=i;return/<head[^>]*>/i.test(e)?e=e.replace(/<head[^>]*>/i,t=>`${t}<style>${a}</style>`):e=`<head><meta charset="utf-8"><style>${a}</style></head>${e}`,/<body[^>]*>/i.test(e)?e=e.replace(/<body[^>]*>/i,t=>`${t}${r}`):e=e.replace(/<(main|html)[^>]*>/i,t=>`${t}${r}`),e}export{l as w};
