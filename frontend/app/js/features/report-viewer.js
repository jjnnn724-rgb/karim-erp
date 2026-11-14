/**
 * features/report-viewer.js — عارض التقارير داخل التطبيق (Enterprise 2026-10-03)
 * ────────────────────────────────────────────────────────────────────────────
 * المشكلة: كل التقارير تُفتح بـ window.open + document.write — وهذا لا يعمل
 * في WebView تطبيق أندرويد (Capacitor) فتظهر صفحة بيضاء.
 * الحل: نافذة وهمية بنفس واجهة window (document.write/writeln/close + print
 * + focus) تجمع الـ HTML وتعرضه داخل overlay + iframe (srcdoc) في نفس
 * الشاشة — يعمل على المتصفح والجوال والويب-فيو بالتساوي، مع زر طباعة
 * (iframe.contentWindow.print) وزر إغلاق.
 *
 * الاستخدام في المواضع القديمة (بدون تغيير أي منطق طباعة):
 *   const w = window.openInAppReport ? window.openInAppReport('عنوان') : window.open('', '_blank');
 *   w.document.write(html); w.document.close(); // يُعرض فورًا داخل التطبيق
 * وضع URL: window.openInAppReport('إيصال', url) — يعرض رابطًا جاهزًا.
 */
import { esc } from '../core/utils.js?v=4.9.321';
import { applyPrintSystem } from '../core/print-system.js?v=4.9.321';

let overlayEl = null;
let frameLoaded = false;
let pendingPrint = false;
let pdfBusyL = false;
let pdfScriptL = false;

/* ── تحميل/مشاركة PDF (2026-11-01 «حتى في الهاتف لازم مشاركة») ─────────
   المحرك الكلاسيكي js/pdf-share-legacy.js يُحقن كسولًا عند أول ضغطة،
   والمكتبتان (jsPDF + html2canvas-pro) تُحمَّلان من /app/js/vendor عند
   الطلب. على أندرويد-ويبفيو الحديث navigator.share متاح فيورق المشاركة
   فيها واتساب؛ وحيث لا توجد يُنزَّل الملف احتياطًا. */
function ensurePdfShareLegacy() {
    if (pdfScriptL || window.__karimPdfShare) { return Promise.resolve(window.__karimPdfShare || null); }
    return new Promise(function (resolve) {
        const tag = document.createElement('script');
        tag.src = '/app/js/pdf-share-legacy.js?v=4.9.321';
        tag.onload = function () { pdfScriptL = true; resolve(window.__karimPdfShare || null); };
        tag.onerror = function () { resolve(null); };
        document.head.appendChild(tag);
    });
}

function runLegacyPdf(mode, btn) {
    if (pdfBusyL) { return; }
    const original = btn.textContent;
    pdfBusyL = true;
    btn.disabled = true;
    btn.textContent = 'جارٍ التجهيز…';
    ensurePdfShareLegacy().then(function (share) {
        const frame = document.getElementById('inAppReportFrame');
        if (!share || !frame) { throw new Error('تعذر تحميل محرك PDF'); }
        const title = (document.getElementById('inAppReportTitle') || {}).textContent || 'تقرير';
        return share.buildFromFrame(frame).then(function (built) {
            if (!built.ok) { throw new Error(built.error || 'تعذر توليد PDF'); }
            const filename = share.filenameOf(title);
            if (mode === 'share') {
                return share.shareOrDownload(built.blob, filename, title).then(function (r) {
                    if (r === 'shared') { window.toast && window.toast('تمت مشاركة المستند', 'success'); }
                    else if (r === 'downloaded') { window.toast && window.toast('نُزّل الملف — أرفقه في المحادثة', 'success'); }
                });
            }
            if (!share.download(built.blob, filename)) { throw new Error('تعذر تنزيل الملف'); }
            window.toast && window.toast('تم تنزيل ملف PDF', 'success');
        });
    }).catch(function (e) {
        window.toast && window.toast((e && e.message) || 'تعذر توليد PDF', 'warning');
    }).finally(function () {
        pdfBusyL = false;
        btn.disabled = false;
        btn.textContent = original;
    });
}

function runLegacyWhatsapp(btn) {
    if (pdfBusyL) { return; }
    /* افتح واتساب داخل الإيماءة نفسها — الفتح المتأخر يحجبه المتصفح. */
    const waTitle = (document.getElementById('inAppReportTitle') || {}).textContent || 'تقرير';
    try { window.open('https://wa.me/?text=' + encodeURIComponent('📌 ' + waTitle + ' — من نظام مطاعم الشرفة'), '_blank'); } catch (_) { /* */ }
    pdfBusyL = true;
    btn.disabled = true;
    btn.textContent = 'جارٍ التجهيز…';
    ensurePdfShareLegacy().then(function (share) {
        const frame = document.getElementById('inAppReportFrame');
        if (!share || !frame) { throw new Error('تعذر تحميل محرك PDF'); }
        const title = (document.getElementById('inAppReportTitle') || {}).textContent || 'تقرير';
        return share.buildFromFrame(frame).then(function (built) {
            if (!built.ok) { throw new Error(built.error || 'تعذر توليد PDF'); }
            const filename = share.filenameOf(title);
            if (!share.download(built.blob, filename)) { throw new Error('تعذر تنزيل الملف'); }
            window.toast && window.toast('نُزّل الملف — أرفقه في محادثة واتساب المفتوحة', 'success');
        });
    }).catch(function (e) {
        window.toast && window.toast((e && e.message) || 'تعذر تجهيز الملف', 'warning');
    }).finally(function () {
        pdfBusyL = false;
        btn.disabled = false;
        btn.textContent = 'واتساب';
    });
}

function requestReportPrint() {
    const frame = document.getElementById('inAppReportFrame');
    if (!frame) {return;}
    if (!frameLoaded) {
        pendingPrint = true;
        return;
    }
    try {
        frame.contentWindow.focus();
        frame.contentWindow.print();
    } catch (_) {
        if (typeof window.toast === 'function') { window.toast('الطباعة غير مدعومة داخل التطبيق — التقط لقطة شاشة أو افتح من متصفح الجهاز', 'warning'); }
    }
}

function ensureOverlay(title) {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    frameLoaded = false;
    pendingPrint = false;
    overlayEl = document.createElement('div');
    overlayEl.id = 'inAppReportOverlay';
    overlayEl.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0b1220;display:flex;flex-direction:column';
    overlayEl.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#111c33;color:#fff;flex:none;border-bottom:2px solid #8fbfa9">
            <b id="inAppReportTitle" style="flex:1;font-family:inherit;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title || 'تقرير')}</b>
            <button data-act="print" style="padding:8px 16px;border:none;border-radius:8px;background:#2e9e5b;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">طباعة</button>
            <button data-act="pdf" style="padding:8px 14px;border:none;border-radius:8px;background:#0F5B46;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">تحميل PDF</button>
            <button data-act="share" style="padding:8px 14px;border:none;border-radius:8px;background:#0B4A39;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">مشاركة</button>
            <button data-act="whatsapp" style="padding:8px 14px;border:none;border-radius:8px;background:#1FA855;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">واتساب</button>
            <button data-act="close" style="padding:8px 16px;border:none;border-radius:8px;background:#c0392b;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">إغلاق</button>
        </div>
        <iframe id="inAppReportFrame" style="flex:1;border:0;width:100%;background:#fff"></iframe>`;
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('[data-act="close"]').addEventListener('click', () => closeReportOverlay());
    overlayEl.querySelector('[data-act="pdf"]').addEventListener('click', function () { runLegacyPdf('download', this); });
    overlayEl.querySelector('[data-act="share"]').addEventListener('click', function () { runLegacyPdf('share', this); });
    overlayEl.querySelector('[data-act="whatsapp"]').addEventListener('click', function () { runLegacyWhatsapp(this); });
    const frame = overlayEl.querySelector('#inAppReportFrame');
    frame.addEventListener('load', async () => {
        try {
            await applyPrintSystem(frame.contentDocument, { title });
        } catch (_) { /* PDF أو مستند خارجي بلا وصول — الطباعة كما هي */ }
        frameLoaded = true;
        if (pendingPrint) {
            pendingPrint = false;
            requestReportPrint();
        }
    });
    overlayEl.querySelector('[data-act="print"]').addEventListener('click', requestReportPrint);
    return frame;
}

export function closeReportOverlay() {
    if (overlayEl) { overlayEl.remove(); overlayEl = null; }
    frameLoaded = false;
    pendingPrint = false;
}

function renderReportOverlay(html, title) {
    const frame = ensureOverlay(title);
    frameLoaded = false;
    frame.srcdoc = html;
}

/** نافذة وهمية متوافقة مع أنماط window.open + document.write القائمة */
export function openInAppReport(title, url) {
    if (url) {
        const frame = ensureOverlay(title);
        frameLoaded = false;
        frame.src = url;
        return { document: { write() {}, writeln() {}, close() {} }, print: requestReportPrint, focus() {}, close() { closeReportOverlay(); } };
    }
    const chunks = [];
    return {
        document: {
            write: (...a) => chunks.push(a.join('')),
            writeln: (...a) => chunks.push(a.join('') + '\n'),
            close: () => renderReportOverlay(chunks.join(''), title),
        },
        print: requestReportPrint,
        focus() {},
        close() { closeReportOverlay(); },
    };
}

if (typeof window !== 'undefined') { window.openInAppReport = openInAppReport; }
