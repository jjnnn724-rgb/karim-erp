/**
 * print-viewer.ts — مغلّف «عرض التبويب» المتماسك لكل نوافذ الطباعة.
 *
 * المشكلة التي يحلها: الخادم يرجع مستندًا نظيفًا بلا أي أدوات تحكّم — فتتحول
 * النافذة الواحدة إلى «طريق مسدود» ولا يسمح المتصفح بالخروج منها (حظر
 * window.close() على الصفحات التي لم تُفتح بأمرٍ من سكربت، وقائمة السرعات
 * غير مغلقة). هذا يطوّر المستند نفسه إلى جلسة عرض مكتملة:
 *   · زر «🖨 طباعة» وطباعة ذاتية بعد تحميل الصفحة (اختياري).
 *   · زر «✕ إغلاق» — window.close() حين يُسمح، وإلا رجوعًا بالتاريخ.
 *   · شريط أدوات ثابت (position: fixed) يختفي تمامًا أثناء الطباعة.
 *   · صفة دور toolbar + تسمية واضحة عربية — نأمل أن تبقى الصفحة قابلة للتشغيل
 *     باللوحة المفاتيح حتى على غير واجهة المستخدم.
 *
 * الاستدعاءات تمر عبر `printViewerDocument` أو `printViewerHtml` (يفتح تبويبًا مُعَدًّا).
 */
import { writeHtmlDocument } from './print-document';

const TOOLBAR = `
<div class="erp-print-toolbar" role="toolbar" aria-label="أدوات الطباعة والإغلاق">
  <button type="button" class="erp-pt erp-pt--print" onclick="window.print()">🖨 طباعة</button>
  <button type="button" class="erp-pt erp-pt--close" onclick="try{window.close();if(!window.closed){history.back();}}catch(e){history.back()}">✕ إغلاق</button>
</div>
<style>
.erp-print-toolbar{position:fixed;inset-block-start:12px;inset-inline-end:14px;z-index:2147483647;display:flex;gap:10px;direction:rtl}
.erp-pt{border:0;border-radius:999px;padding:11px 22px;font:800 14px/1 'Tajawal','IBM Plex Sans Arabic','Cairo',Tahoma,sans-serif;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4);transition:transform 120ms ease,filter 120ms ease}
.erp-pt:hover{transform:translateY(-1px);filter:brightness(1.06)}
.erp-pt--print{background:#c8a24a;color:#1b1205}
.erp-pt--close{background:#131a12;color:#fff8e0;border:1px solid #c8a24a}
@media print{.erp-print-toolbar{display:none !important}}
</style>`;

export interface PrintViewerOptions {
    /** اطبع تلقائيًا بعد تحميل المستند (افتراضي: true). */
    autoPrint?: boolean;
    /** مللي ثانية قبل الطباعة التلقائية (افتراضي: 350ms). */
    printDelayMs?: number;
}

function injectViewer(html: string): string {
    const withToolbar = html.includes('erp-print-toolbar') ? html : (() => {
        // إدراج بعد دخول <body> إن وُجد؛ وإلا بعد <head>؛ وإلا في البداية.
        const bodyOpen = /<body[^>]*>/i.exec(html);
        if (bodyOpen) {
            const at = bodyOpen.index;
            return html.slice(0, at + bodyOpen[0].length) + TOOLBAR + html.slice(at + bodyOpen[0].length);
        }
        const headOpen = /<head[^>]*>/i.exec(html);
        if (headOpen) {
            const at = headOpen.index;
            return html.slice(0, at + headOpen[0].length) + TOOLBAR + html.slice(at + headOpen[0].length);
        }
        return TOOLBAR + html;
    })();
    return withToolbar;
}

/** اطبع مستندًا خادمياً داخل تبويب مُعَدّ مع أدوات إغلاق وطباعة صريحة. */
export function printViewerDocument(win: Window, html: string, opts: PrintViewerOptions = {}): boolean {
    if (!win || win.closed) { return false; }
    const autoPrint = opts.autoPrint !== false;
    const delay = typeof opts.printDelayMs === 'number' ? opts.printDelayMs : 350;
    writeHtmlDocument(win, injectViewer(html));
    if (autoPrint) {
        window.setTimeout(() => { try { win.print(); } catch { /* المستخدم يغلق يدويًا */ } }, delay);
    }
    return true;
}

/** نفس السابق لكن يفتح تبويبًا جديدًا بنفسه (بديلٌ لـ openBlankTab لمن يملك النقرة). */
export function printViewerHtml(html: string, opts: PrintViewerOptions = {}): boolean {
    const win = typeof window !== 'undefined' ? window.open('', '_blank', 'width=980,height=1100') : null;
    if (!win) { return false; }
    return printViewerDocument(win, html, opts);
}
