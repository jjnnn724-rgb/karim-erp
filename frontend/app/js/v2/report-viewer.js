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
 *   • الإغلاق من زر X في أعلى الشريط وحده. لا Escape ولا نقرة على الخلفية:
 *     مستند قيد القراءة أو الطباعة لا يجوز أن يختفي بضغطة عابرة، والـX هو
 *     العقد الوحيد الذي يراه المستخدم ويقصده. التركيز يعود إلى من فتحه.
 *   • querySelector داخل الوهمية يعيد null عن قصد: أزرار المستند المولّد
 *     زخرفية الآن، وشريط العارض هو مصدر الطباعة والإغلاق الوحيد.
 *   • الطباعة تنتظر load الـiframe ثم تنادي contentWindow.print؛ عند
 *     الرفض يظهر تنبيه واضح بدل فشل صامت.
 */

import { applyPrintSystem } from '../core/print-system.js?v=4.9.296';
import { trapFocus } from './focus-trap.js?v=4.9.296';
import {
    buildFilename, buildPdfFromFrame, canShareFiles, downloadBlob, shareBlob, whatsappUrl,
} from './pdf-share.js?v=4.9.296';

const OVERLAY_CLASS = 'erp-report-viewer';
const OPEN_CLASS = 'erp-report-viewer-open';
const TITLE_ID = 'erp-report-viewer-title';

let host = null;
let frame = null;
let titleEl = null;
let lastFocus = null;
let releaseTrap = null;
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

/* ── تصدير PDF ومشاركته (2026-10-31 / 11-01) ───────────────────────────
   غلاف واحد بحالة انتظار + **كاش توليد مسبق**: الـPDF يُبنى بعد حمول
   المستند على الخمول، فنقرة «مشاركة» تنادي ورقة النظام داخل مهلة
   التفاعل (المشاركة تموت لو تأخر التوليد ثوانٍ — عيب الموبايل الحقيقي)،
   و«واتساب» لسطح المكتب حيث لا توجد ورقة مشاركة ملفات أصلًا. */
let pdfBusy = false;
let pdfCache = null;          /* { seq, title, promise } — يُبطل عند كل رسم */
let pdfPrebuildTimer = 0;

function toastOk(message) {
    if (typeof window !== 'undefined' && typeof window.toast === 'function') {
        window.toast(message, 'success');
    }
}

function pdfCacheFor(title) {
    if (pdfCache && pdfCache.seq === loadedSeq && loadedSeq === renderSeq) {return pdfCache.promise;}
    const promise = buildPdfFromFrame(frame);
    pdfCache = { seq: loadedSeq, title, promise };
    return promise;
}

function schedulePdfPrebuild() {
    if (pdfPrebuildTimer) {clearTimeout(pdfPrebuildTimer);}
    pdfPrebuildTimer = setTimeout(() => {
        pdfPrebuildTimer = 0;
        if (!frame || loadedSeq !== renderSeq) {return;}
        try { void pdfCacheFor(titleEl ? titleEl.textContent : 'تقرير'); } catch { /* */ }
    }, 1500);
}

async function runPdfExport(mode, btn, label) {
    if (pdfBusy || !frame) {return;}
    pdfBusy = true;
    btn.disabled = true;
    btn.textContent = 'جارٍ التجهيز…';
    try {
        const title = titleEl ? titleEl.textContent : 'تقرير';
        const built = await pdfCacheFor(title);
        if (!built || !built.ok) {
            warn((built && built.error) || 'تعذر توليد PDF');
            return;
        }
        const filename = buildFilename(title);
        if (mode === 'share') {
            const result = await shareBlob(built.blob, filename, title);
            if (result === 'shared') {toastOk('تمت مشاركة المستند');}
            else if (result === 'cancelled') { /* أغلق الورقة بنفسه */ }
            else if (result === 'retry') {toastOk('المستند جاهز — اضغط «مشاركة» مرة أخرى');}
            else if (result === 'downloaded') {toastOk('لا ورقة مشاركة على هذا الجهاز — نُزّل الملف، وزر «واتساب» يفتحه لك');}
            else {warn('تعذر تنزيل الملف');}
        } else if (downloadBlob(built.blob, filename)) {
            toastOk('تم تنزيل ملف PDF');
        } else {
            warn('تعذر تنزيل الملف');
        }
    } catch (_) {
        warn('تعذر توليد PDF');
    } finally {
        pdfBusy = false;
        btn.disabled = false;
        btn.textContent = label;
    }
}

/* واتساب لسطح المكتب (حيث لا ورقة مشاركة): نزّل الملف وافتح واتساب —
   المرفق جاهز في مجلد التنزيلات بضغطة إرفاق واحدة. */
async function runWhatsapp(btn) {
    if (pdfBusy || !frame) {return;}
    /* افتح واتساب داخل إيماءة النقرة نفسها: الفتح بعد توليدٍ يستغرق
       ثوانيًا يفقد الصلاحية فيحجب المتصفح الصفحة (شكوى المالك). الملف
       يُبنى ويُنزَّل بعدها والتبويب يتحمّل بالتوازي. */
    const waTitle = titleEl ? titleEl.textContent : 'تقرير';
    try { window.open(whatsappUrl(waTitle), '_blank', 'noopener'); } catch { /* مانع النوافذ — الملف سيُنزَّل */ }
    pdfBusy = true;
    btn.disabled = true;
    btn.textContent = 'جارٍ التجهيز…';
    try {
        const title = waTitle;
        const built = await pdfCacheFor(title);
        if (!built || !built.ok) {
            warn((built && built.error) || 'تعذر توليد PDF');
            return;
        }
        const filename = buildFilename(title);
        if (!downloadBlob(built.blob, filename)) {warn('تعذر تنزيل الملف'); return;}
        toastOk('نُزّل الملف — أرفقه في محادثة واتساب المفتوحة');
    } catch (_) {
        warn('تعذر تجهيز الملف');
    } finally {
        pdfBusy = false;
        btn.disabled = false;
        btn.textContent = 'واتساب';
    }
}

/* Close is the X in the top bar and nothing else: no Escape, no backdrop.
   A document under review (or mid-print) must not vanish on a stray key. */

function render(html) {
    if (!frame) {return;}
    renderSeq += 1;
    loadedSeq = renderSeq - 1;
    pdfCache = null; /* مستند جديد — الكاش القديم بلا معنى */
    frame.srcdoc = html;
}

export function closeReportViewer() {
    if (host && host.parentNode) {host.parentNode.removeChild(host);}
    host = null;
    frame = null;
    titleEl = null;
    printPending = false;
    pdfCache = null;
    if (pdfPrebuildTimer) {clearTimeout(pdfPrebuildTimer); pdfPrebuildTimer = 0;}
    releaseTrap?.();
    releaseTrap = null;
    if (typeof document !== 'undefined') {
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

    /* تصدير PDF حقيقي (2026-10-31 بطلب المالك: «استعلام المبيعات عايز احملها
       pdf واي مكان في طباعة اقدر اعمله شير pdf»): زران — تحميل مباشر،
       ومشاركة عبر ورقة النظام (واتساب/بريد…) مع تنزيل احتياطي حيث لا
       توجد مشاركة ملفات. كلاهما يلتقط المستند المعروض كما هو. */
    const pdfBtn = doc.createElement('button');
    pdfBtn.type = 'button';
    pdfBtn.className = 'erp-btn erp-btn--sm';
    pdfBtn.setAttribute('data-v2-report-action', 'pdf');
    pdfBtn.setAttribute('title', 'تنزيل المستند ملف PDF بمقاس A4');
    pdfBtn.textContent = 'تحميل PDF';

    const shareBtn = doc.createElement('button');
    shareBtn.className = 'erp-btn erp-btn--sm';
    shareBtn.setAttribute('data-v2-report-action', 'share');
    shareBtn.setAttribute('title', 'مشاركة المستند PDF عبر تطبيقات الجهاز (واتساب…)');
    shareBtn.textContent = 'مشاركة';

    /* واتساب لسطح المكتب فقط: حيث لا ورقة مشاركة ملفات، الزر ينزّل
       المستند ويفتح واتساب مباشرة. على الهاتف ورقة النظام فيها واتساب
       فلا حاجة للزر (يتخفى تلقائيًا حسب قدرة الجهاز). */
    let waBtn = null;
    if (!canShareFiles()) {
        waBtn = doc.createElement('button');
        waBtn.type = 'button';
        waBtn.className = 'erp-btn erp-btn--sm';
        waBtn.setAttribute('data-v2-report-action', 'whatsapp');
        waBtn.setAttribute('title', 'تنزيل الملف وفتح واتساب لإرفاقه في المحادثة');
        waBtn.textContent = 'واتساب';
    }

    const closeBtn = doc.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'erp-icon-btn erp-modal-x';
    closeBtn.setAttribute('data-v2-report-action', 'close');
    closeBtn.setAttribute('aria-label', 'إغلاق المستند');
    closeBtn.setAttribute('title', 'إغلاق');
    closeBtn.textContent = '×';

    frame = doc.createElement('iframe');
    frame.className = 'erp-report-viewer__frame';
    frame.setAttribute('title', title || 'مستند');
    frame.setAttribute('referrerpolicy', 'no-referrer');

    frame.addEventListener('load', async () => {
        const seq = renderSeq;
        try {
            await applyPrintSystem(frame.contentDocument, {
                title: titleEl ? titleEl.textContent : title,
            });
        } catch (_) { /* PDF أو مستند خارجي بلا وصول — الطباعة كما هي */ }
        if (seq !== renderSeq) {return;}
        loadedSeq = renderSeq;
        schedulePdfPrebuild();
        if (printPending) {
            printPending = false;
            printFrame();
        }
    });
    printBtn.addEventListener('click', requestPrint);
    pdfBtn.addEventListener('click', () => { void runPdfExport('download', pdfBtn, 'تحميل PDF'); });
    shareBtn.addEventListener('click', () => { void runPdfExport('share', shareBtn, 'مشاركة'); });
    if (waBtn) {waBtn.addEventListener('click', () => { void runWhatsapp(waBtn); });}
    closeBtn.addEventListener('click', closeReportViewer);

    bar.appendChild(titleEl);
    bar.appendChild(printBtn);
    bar.appendChild(pdfBtn);
    if (waBtn) {bar.appendChild(waBtn);} else {bar.appendChild(shareBtn);}
    bar.appendChild(closeBtn);
    host.appendChild(bar);
    host.appendChild(frame);
    doc.body.appendChild(host);
    doc.documentElement.classList.add(OPEN_CLASS);
    releaseTrap = trapFocus(host);
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
