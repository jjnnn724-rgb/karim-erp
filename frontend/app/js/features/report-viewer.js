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
import { esc } from '../core/utils.js?v=4.9.13';
import { addCompanyPrintLogo } from '../core/print-branding.js?v=4.9.169';

let overlayEl = null;
let frameLoaded = false;
let pendingPrint = false;

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
        <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#111c33;color:#fff;flex:none;border-bottom:2px solid #c9a227">
            <b style="flex:1;font-family:inherit;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(title || 'تقرير')}</b>
            <button data-act="print" style="padding:8px 16px;border:none;border-radius:8px;background:#2e9e5b;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">طباعة</button>
            <button data-act="close" style="padding:8px 16px;border:none;border-radius:8px;background:#c0392b;color:#fff;font-weight:700;font-family:inherit;cursor:pointer">إغلاق</button>
        </div>
        <iframe id="inAppReportFrame" style="flex:1;border:0;width:100%;background:#fff"></iframe>`;
    document.body.appendChild(overlayEl);
    overlayEl.querySelector('[data-act="close"]').addEventListener('click', () => closeReportOverlay());
    const frame = overlayEl.querySelector('#inAppReportFrame');
    frame.addEventListener('load', () => {
        if (frame.contentDocument) { addCompanyPrintLogo(frame.contentDocument); }
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
