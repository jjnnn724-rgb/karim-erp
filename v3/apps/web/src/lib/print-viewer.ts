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
import { exportElementPdf } from './pdf-share';

const TOOLBAR = `
<div class="erp-print-toolbar" role="toolbar" aria-label="أدوات الطباعة والإغلاق">
  <button type="button" class="erp-pt" data-erp-pt="print" aria-label="طباعة">🖨</button>
  <button type="button" class="erp-pt erp-pt--share" data-erp-pt="share" aria-label="مشاركة PDF">⤴</button>
  <button type="button" class="erp-pt erp-pt--close" data-erp-pt="close" aria-label="إغلاق">✕</button>
</div>
<style>
.erp-print-toolbar{position:fixed;inset-block-end:22px;inset-inline-end:18px;z-index:2147483647;display:flex;gap:6px;direction:rtl;padding:5px;background:#131a12;border:1px solid rgb(200 162 74 / .45);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.45), 0 0 0 1px rgba(0,0,0,.3)}
.erp-pt{inline-size:34px;block-size:34px;border:0;border-radius:999px;display:grid;place-items:center;background:transparent;color:#e0c56f;font-size:15px;line-height:1;cursor:pointer;transition:background 140ms ease,color 140ms ease,transform 140ms ease}
.erp-pt:hover{background:rgb(200 162 74 / .25);color:#fff3c4;transform:translateY(-1px)}
.erp-pt--close{color:#f5a9a2}
.erp-pt--close:hover{background:rgb(224 82 82 / .3);color:#fff}
@media print{.erp-print-toolbar{display:none !important}}
@media (max-width:640px){.erp-print-toolbar{inset-block-end:12px;inset-inline-end:10px;padding:4px}.erp-pt{inline-size:30px;block-size:30px;font-size:14px}}
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
    // CSP في مستندات الخادم (script-src-attr 'none') تحظر كل inline handlers —
    // فنربط الأوامر بحوادث «خارج» المستند (النافذة الحالية) بدل السطّر في الورقة.
    try {
        const doc = win.document;
        // طباعة — المحاولة الأفضل على الأجهزة التي تدعمها (أندرويد WEBVIEW قد لا يدعم).
        doc?.querySelector('[data-erp-pt="print"]')?.addEventListener('click', () => {
            try { win.print(); } catch { shareInnerAsPdf(); }
        });
        // مشاركة PDF — المسار الموثوق على أندرويد/APK (html2canvas + jsPDF vendored + Capacitor Share).
        doc?.querySelector('[data-erp-pt="share"]')?.addEventListener('click', () => {
            shareInnerAsPdf();
        });
        // إغلاق — _close أولاً ثم الرجوع بالتاريخ كبديل.
        doc?.querySelector('[data-erp-pt="close"]')?.addEventListener('click', () => {
            try { win.close(); } catch { /* noop */ }
            try { if (!win.closed) { win.history.back(); } } catch { /* noop */ }
        });

        function shareInnerAsPdf(): void {
            const title = String(doc?.querySelector('title')?.textContent ?? doc?.title ?? 'Karim ERP').trim() || 'Karim ERP';
            const target = (doc?.querySelector('.sheet') as HTMLElement | null) ?? doc?.body ?? null;
            void exportElementPdf(target, title, { mode: 'share' })
                .then((result) => { if (!result.ok) { /* لا نقاطع التجربة - الشاشة مستطيعة الطباعة/الإغلاق */ } })
                .catch(() => { /* noop */ });
        }
    } catch { /* نافذة غير قابلة للوصول — المعالجة باليد */ }
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
