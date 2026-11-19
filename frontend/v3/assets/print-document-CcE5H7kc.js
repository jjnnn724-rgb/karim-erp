const o=`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>جارٍ تجهيز المستند</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;padding:24px;color:#475467">
جارٍ تجهيز المستند…
</body></html>`;function c(e){const t=window.open("","_blank");return t?(t.document.open(),t.document.write(o),t.document.close(),t.document.title=e,t):null}function n(e,t){e.document.open(),e.document.write(t),e.document.close(),e.focus()}function l(e,t){n(e,t),e.print()}export{c as o,l as p,n as w};
