/**
 * V2 — عارض مستندات داخل التطبيق (بديل window.open للطباعة)
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *   كل شاشات الطباعة في V2 كانت تفتح نافذة فارغة وتكتب فيها HTML. هذا
 *   يعمل في متصفح سطح المكتب، لكن WebView تطبيق أندرويد يحجب النافذة أو
 *   يعرض صفحة بيضاء — نفس العلة التي أنشأ لها القديم
 *   features/report-viewer.js. العارض هنا يعيد النافذة الوهمية نفسها
 *   (document.write/open/close + print/focus/close) فوق in-app overlay
 *   بـ iframe srcdoc، فلا يلزم تغيير منطق توليد أي مستند.
 *
 * CONTRACT
 *   • لا innerHTML ولا معالج سطري: كل عقدة تُبنى بـ createElement، وأزرار
 *     الشريط تُربط بـ addEventListener — صفحة V2 تمنع onclick أصلًا.
 *   • Escape يغلق، والتركيز يعود إلى العنصر الذي فتح العارض.
 *   • querySelector داخل الوهمية يعيد null عن قصد: أزرار المستند المولّد
 *     زخرفية الآن، وشريط العارض هو مصدر الطباعة والإغلاق الوحيد.
 *   • الطباعة تنتظر load الـiframe ثم تنادي contentWindow.print؛ عند
 *     الرفض يظهر تنبيه واضح بدل فشل صامت.
 */

import { addV2PrintBranding } from './print-branding.js?v=4.9.131';

const OVERLAY_CLASS = 'erp-report-viewer';
const OPEN_CLASS = 'erp-report-viewer-open';
const TITLE_ID = 'erp-report-viewer-title';

let host = null;
let frame = null;
let titleEl = null;
let lastFocus = null;
let printPending = false;
let renderSeq = 0;
let loadedSeq = 0;

function warn(message) {
    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
        window.toast(message, 'warning');
    }
}

function printFrame() {
    if (!frame || !frame.contentWindow) {return;}
    try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
    } catch (_) {
        warn('الطباعة غير مدعومة داخل التطبيق — التقط لقطة شاشة أو افتح من متصفح الجهاز');
    }
}

function requestPrint() {
    if (!frame) {return;}
    if (loadedSeq !== renderSeq) {
        printPending = true;
        return;
    }
    printFrame();
}

/* Escape must work wherever focus went: the print button, the page body, or
   the report iframe itself (printFrame focuses that document, and a reader
   may click inside it). A listener on the host alone misses all three. */
function onEscape(event) {
    if (event.key !== 'Escape') {return;}
    event.preventDefault();
    closeReportViewer();
}

function render(html) {
    if (!frame) {return;}
    renderSeq += 1;
    loadedSeq = renderSeq - 1;
    frame.srcdoc = html;
}

export function closeReportViewer() {
    if (host && host.parentNode) {host.parentNode.removeChild(host);}
    host = null;
    frame = null;
    titleEl = null;
    printPending = false;
    if (typeof document !== 'undefined') {
        document.removeEventListener('keydown', onEscape, true);
        document.documentElement.classList.remove(OPEN_CLASS);
    }
    if (lastFocus && typeof lastFocus.focus === 'function') {
        try {lastFocus.focus();} catch (_) { /* العنصر لم يعد في الصفحة */ }
    }
    lastFocus = null;
}

function ensureHost(title) {
    const doc = document;
    const previousFocus = lastFocus;
    if (host) {closeReportViewer();}
    lastFocus = previousFocus && previousFocus.isConnected ? previousFocus : doc.activeElement;
    host = doc.createElement('div');
    host.className = `erp-v2 ${OVERLAY_CLASS}`;
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-labelledby', TITLE_ID);

    const bar = doc.createElement('div');
    bar.className = 'erp-report-viewer__bar';
    titleEl = doc.createElement('strong');
    titleEl.className = 'erp-report-viewer__title';
    titleEl.id = TITLE_ID;
    titleEl.textContent = title || 'مستند';

    const printBtn = doc.createElement('button');
    printBtn.type = 'button';
    printBtn.className = 'erp-btn erp-btn--primary erp-btn--sm';
    printBtn.setAttribute('data-v2-report-action', 'print');
    printBtn.textContent = 'طباعة';

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'erp-btn erp-btn--sm';
    closeBtn.setAttribute('data-v2-report-action', 'close');
    closeBtn.textContent = 'إغلاق';

    frame = doc.createElement('iframe');
    frame.className = 'erp-report-viewer__frame';
    frame.setAttribute('title', title || 'مستند');
    frame.setAttribute('referrerpolicy', 'no-referrer');

    frame.addEventListener('load', () => {
        if (frame.contentDocument) {addV2PrintBranding(frame.contentDocument);}
        loadedSeq = renderSeq;
        try {frame.contentDocument.addEventListener('keydown', onEscape);} catch (_) { /* مستند غير متاح */ }
        if (printPending) {
            printPending = false;
            printFrame();
        }
    });
    printBtn.addEventListener('click', requestPrint);
    closeBtn.addEventListener('click', closeReportViewer);
    doc.addEventListener('keydown', onEscape, true);

    bar.appendChild(titleEl);
    bar.appendChild(printBtn);
    bar.appendChild(closeBtn);
    host.appendChild(bar);
    host.appendChild(frame);
    doc.body.appendChild(host);
    doc.documentElement.classList.add(OPEN_CLASS);
    printBtn.focus();
    return frame;
}

/**
 * نافذة وهمية متوافقة مع open + document.write/open/close + print/focus/close.
 * @param {string} title عنوان الشريط
 * @param {string} [url] وضع رابط جاهز (iframe.src) بدل كتابة HTML
 */
export function openInAppReport(title, url) {
    const target = ensureHost(title);
    if (url) {
        renderSeq += 1;
        loadedSeq = renderSeq - 1;
        target.src = url;
    }
    const chunks = [];
    return {
        document: {
            open() {chunks.length = 0;},
            write(...args) {chunks.push(args.join(''));},
            writeln(...args) {chunks.push(`${args.join('')}\n`);},
            close() {render(chunks.join(''));},
            querySelector() {return null;},
            querySelectorAll() {return [];},
        },
        print: requestPrint,
        focus() {},
        close: closeReportViewer,
    };
}
