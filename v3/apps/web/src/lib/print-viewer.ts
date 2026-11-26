/**
 * print-viewer.ts — المنفذ الوحيد «لطباعة / معاينة أي مستند».
 *
 * قوانينه:
 *   · تقرير على شاشة حقيقية (ورق/شاشة): النافذة تُفتح بتبويب مستقل فيه الشريط المعدني بنافذة الحريّة
 *     (رخيصة HAX script-safe: كل CSP آمنة لأن المناول يُبنى من النافذة الخارجية لا من السطر داخل الورقة).
 *   · داخل WebView فقط (APK أُندرويد / iOS): المستند يظهر **داخل الغطاء full-screen**
 *     لأن تبويبًا جديدًا لا يُفتح (أو لا يستجيب window.close) — المُستخدم يكسب حرية الخروج بالفعل.
 *
 * الورقة تظل نظيفة من أي كود وتنسيق فقط — والشريط (3 أيقونات فقط) يُحقن بعد الكتابة.
 */

import { exportElementPdf } from './pdf-share';
import { withPrintBrand } from './print-brand';
import { writeHtmlDocument } from './print-document';

export interface PrintViewerOptions {
    autoPrint?: boolean;
    printDelayMs?: number;
}

const OVERLAY_ID = 'erp-print-overlay';

function isNativeBridge(): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    const w = window as typeof window & { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };
    const platform = w.Capacitor?.getPlatform?.();
    return Boolean(w.Capacitor?.isNativePlatform?.()) || platform === 'android' || platform === 'ios';
}

/* ── الغطاء للأجهزة الأصلية (full-screen iframe فوق الشاشة الحالية) ── */
function openNativeOverlay(html: string, opts: PrintViewerOptions): boolean {
    let root = document.getElementById(OVERLAY_ID);
    if (root) {
        root.remove();
    }
    root = document.createElement('div');
    root.id = OVERLAY_ID;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'معاينة الطباعة');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;background:#050a09;border:0;';

    const style = document.createElement('style');
    style.textContent = `
#erp-print-overlay .erp-pt-overlay{position:absolute;inset-block-end:18px;inset-inline-end:12px;z-index:3;display:flex;gap:6px;padding:5px;background:#131a12;border:1px solid rgb(200 162 74 / .45);border-radius:999px;box-shadow:0 10px 30px rgba(0,0,0,.45)}
#erp-print-overlay .erp-ptx{inline-size:36px;block-size:36px;border:0;border-radius:999px;display:grid;place-items:center;background:transparent;color:#e0c56f;font-size:15px;line-height:1;cursor:pointer;transition:background .14s ease,color .14s ease,transform .14s ease}
#erp-print-overlay .erp-ptx:hover{background:rgb(200 162 74 / .25);color:#fff3c4}
#erp-print-overlay .erp-ptx--close{color:#f5a9a2}
#erp-print-overlay .erp-ptx--close:hover{background:rgb(224 82 82 / .3);color:#fff}
@media print{#erp-print-overlay{display:none !important}}`;

    const frame = document.createElement('iframe');
    frame.title = 'معاينة الطباعة';
    frame.setAttribute('sandbox', 'allow-same-origin allow-print');
    frame.style.cssText = 'flex:1;inline-size:100%;block-size:100%;border:0;background:#ffffff;';
    frame.srcdoc = withPrintBrand(html);

    const toolbar = document.createElement('div');
    toolbar.className = 'erp-pt-overlay';
    toolbar.innerHTML = `<button type="button" class="erp-ptx erp-ptx--print" data-erp-pt="print" aria-label="طباعة">🖨</button>
<button type="button" class="erp-ptx erp-ptx--share" data-erp-pt="share" aria-label="مشاركة PDF">⤴</button>
<button type="button" class="erp-ptx erp-ptx--close" data-erp-pt="close" aria-label="إغلاق">✕</button>`;

    root.append(style, frame, toolbar);
    document.body.append(root);

    toolbar.querySelector<HTMLButtonElement>('[data-erp-pt="print"]')?.addEventListener('click', () => {
        try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
        } catch {
            /* لا يدعم الطباعة */
        }
    });
    toolbar.querySelector<HTMLButtonElement>('[data-erp-pt="share"]')?.addEventListener('click', () => {
        void shareInnerAsPdf(frame.contentDocument);
    });
    toolbar.querySelector<HTMLButtonElement>('[data-erp-pt="close"]')?.addEventListener('click', () => root?.remove());

    if (opts.autoPrint !== false) {
        // طباعة متزامنة افتراضية — يتيح للمستخدم الكشف من نفس دورة النقرة ويمنح المتصفح وقتًا للتحميل قبل الطباعة فقط للأوراق المبنية من العناصر الداخلية.
        try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
        } catch {
            /* لا يدعم الطباعة */
        }
    }
    return true;
}

async function shareInnerAsPdf(doc: Document | null | undefined): Promise<void> {
    if (!doc) {
        return;
    }
    const target = (doc.querySelector('.sheet') as HTMLElement | null) ?? doc.body ?? null;
    if (!target) {
        return;
    }
    const title = String(doc.querySelector('title')?.textContent ?? doc.title ?? 'Karim ERP').trim() || 'Karim ERP';
    try {
        await exportElementPdf(target, title, { mode: 'share' });
    } catch {
        /* noop للمستخدم */
    }
}

/** سواقة الورقة المستقلة لالمتصفح: حقن الشريط + ربطه من النافذة الخارجية. */
export function printViewerDocument(win: Window, html: string, opts: PrintViewerOptions = {}): boolean {
    if (!win || win.closed) {
        return openNativeOverlay(html, opts);
    }
    const autoPrint = opts.autoPrint !== false;
    const delay = typeof opts.printDelayMs === 'number' ? opts.printDelayMs : 0;
    writeHtmlDocument(win, injectViewer(html));
    try {
        const doc = win.document;
        doc?.querySelector('[data-erp-pt="print"]')?.addEventListener('click', () => {
            try {
                win.print();
            } catch {
                void shareInnerAsPdf(win.document);
            }
        });
        doc?.querySelector('[data-erp-pt="share"]')?.addEventListener('click', () => {
            void shareInnerAsPdf(win.document);
        });
        const closeViewer = () => {
            try {
                win.close();
            } catch {
                /* المتصفح يرفض إغلاق تبويب فتحه المستخدم — ننتقل لصفحة آمنة بدل تركه عالقًا. */
            }
            // إن بقي التبويب مفتوحًا (بعض المتصفحات ترفض close على تبويب مستقل)،
            // نبدّله بصفحة ختامية واضحة يستطيع المستخدم إغلاقها بلا قلق.
            window.setTimeout(() => {
                if (win.closed) {
                    return;
                }
                try {
                    win.document.open();
                    win.document.write(
                        '<!doctype html><html dir="rtl" lang="ar"><meta charset="utf-8">' +
                            '<title>تم الإغلاق</title><body style="font-family:Tajawal,Arial,sans-serif;display:grid;place-items:center;min-height:70vh;background:#f5f7fa;color:#102a43">' +
                            '<div style="text-align:center"><h1 style="font-size:24px">تم إغلاق المستند</h1>' +
                            '<p>يمكنك إغلاق هذا التبويب بأمان والعودة إلى النظام.</p></div></body></html>',
                    );
                    win.document.close();
                    try {
                        window.focus();
                    } catch {
                        /* noop */
                    }
                } catch {
                    /* لا وصول للتبويب — المستخدم يتولّاه بنفسه */
                }
            }, 250);
        };
        doc?.querySelector('[data-erp-pt="close"]')?.addEventListener('click', closeViewer);
        doc?.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                closeViewer();
            }
        });
    } catch {
        /* نافذة غير قابلة للوصول */
    }
    if (autoPrint) {
        if (delay > 0) {
            window.setTimeout(() => {
                try {
                    win.print();
                } catch {
                    /* noop */
                }
            }, delay);
        } else {
            // الوضع الافتراضي: اطبع في نفس دورة النقرة — المتصفح يتعامل مع الكشف بلا تدهور في الخبرة.
            try {
                win.focus();
                win.print();
            } catch {
                /* noop */
            }
        }
    }
    return true;
}

/** المنفذ الموحد الطباعة/المعاينة — يعمل على Android/iOS (WebView) والمتصفح معًا. */
export function printSmart(html: string, opts: PrintViewerOptions = {}): boolean {
    if (typeof window === 'undefined') {
        return false;
    }
    if (isNativeBridge()) {
        return openNativeOverlay(html, opts);
    }
    const win = window.open('', '_blank', 'width=980,height=1100');
    if (!win) {
        return openNativeOverlay(html, opts);
    }
    return printViewerDocument(win, html, opts);
}

/* ── حقن الشريط CSP-safe ── */
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

function injectViewer(html: string): string {
    if (html.includes('erp-print-toolbar')) {
        return html;
    }
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
}
