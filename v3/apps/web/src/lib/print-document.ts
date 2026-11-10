/**
 * نافذة مستند الطباعة — تُفتح في النقر نفسه (قبل أي جلب) حتى لا يحجبها
 * مانع النوافذ، ثم تُكتب الورقة بعد وصولها من الخادم.
 */

const PLACEHOLDER = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>جارٍ تجهيز المستند</title></head>
<body style="font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;padding:24px;color:#475467">
جارٍ تجهيز المستند…
</body></html>`;

/** تبويب فارغ جاهز للكتابة؛ `null` إن منع المتصفح النوافذ المنبثقة. */
export function openBlankTab(title: string): Window | null {
    const win = window.open('', '_blank');
    if (!win) {
        return null;
    }
    win.document.open();
    win.document.write(PLACEHOLDER);
    win.document.close();
    win.document.title = title;
    return win;
}

/** يكتب مستند HTML كاملًا (من الخادم أو مبنيًا هنا) في التبويب. */
export function writeHtmlDocument(win: Window, html: string): void {
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
}

/** ورقة الخادم تُطبع فورًا: زرّها «طباعة» لا «عرض». */
export function printHtmlDocument(win: Window, html: string): void {
    writeHtmlDocument(win, html);
    win.print();
}
