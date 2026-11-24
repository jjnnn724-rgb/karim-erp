/**
 * pdf-share-legacy.js — محرك تصدير PDF ومشاركته للشاشة القديمة (APK/متصفح)
 * ────────────────────────────────────────────────────────────────────────
 * (2026-11-01) «حتى في الهاتف لازم مشاركة» — نفس قدرات js/v2/pdf-share.js
 * لكن كلاسيكيًا (بلا modules) ليعمل في الشل القديم. يُحمَّل كسولًا عند أول
 * ضغطة زر من عارض features/report-viewer.js، ويحمّل المكتبتين من
 * /app/js/vendor (CSP script-src 'self') عند الطلب.
 *
 * الواجهة: window.__karimPdfShare = { ensureLibs, buildFromFrame,
 *   download, shareOrDownload, whatsappUrl, filenameOf }
 * لا يرمي أبدًا — كل فشل يعيد {ok:false, error} برسالة عربية.
 */
(function () {
    'use strict';

    const VENDOR = {
        jspdf: '/app/js/vendor/jspdf.umd.min.js?v=4.9.323',
        h2c: '/app/js/vendor/html2canvas-pro.min.js?v=4.9.323',
    };

    function loadScript(src) {
        return new Promise(function (resolve) {
            const tag = document.createElement('script');
            tag.src = src;
            tag.onload = function () { resolve(true); };
            tag.onerror = function () { resolve(false); };
            document.head.appendChild(tag);
        });
    }

    function ensureLibs() {
        let chain = Promise.resolve(true);
        if (!window.jspdf) {
            chain = chain.then(function () { return loadScript(VENDOR.jspdf); });
        }
        return chain.then(function () {
            if (!window.html2canvas) { return loadScript(VENDOR.h2c); }
            return true;
        }).then(function () {
            return Boolean(window.jspdf && window.jspdf.jsPDF && window.html2canvas);
        }).catch(function () { return false; });
    }

    function pad(n) { return String(n).length < 2 ? '0' + n : String(n); }

    function filenameOf(title) {
        const clean = String(title || 'تقرير').replace(/[\\/:*?"<>|؟،؛]+/g, ' ')
            .replace(/\s+/g, ' ').trim().slice(0, 60) || 'تقرير';
        const now = new Date();
        return clean + ' ' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
            + ' ' + pad(now.getHours()) + '-' + pad(now.getMinutes()) + '.pdf';
    }

    function slicePages(canvasW, canvasH, pageW, pageH) {
        if (!canvasW || !canvasH || !pageW || !pageH) { return []; }
        const pageHpx = Math.floor(canvasW * (pageH / pageW));
        if (pageHpx <= 0) { return []; }
        const pages = [];
        for (let y = 0; y < canvasH; y += pageHpx) {
            pages.push({ y: y, h: Math.min(pageHpx, canvasH - y) });
        }
        return pages;
    }

    function buildFromFrame(frame) {
        return ensureLibs().then(function (ok) {
            if (!ok || !frame || !frame.contentDocument || !frame.contentDocument.body) {
                return { ok: false, error: 'تعذر تحميل محرك PDF أو لا مستند معروض' };
            }
            const doc = frame.contentDocument;
            const target = doc.querySelector('.rp-sheet, .sheet, .a4') || doc.body;
            return window.html2canvas(target, {
                scale: 2,
                backgroundColor: '#ffffff',
                useCORS: true,
                logging: false,
                windowWidth: doc.documentElement.scrollWidth,
                windowHeight: doc.documentElement.scrollHeight,
            }).then(function (canvas) {
                if (!canvas || !canvas.width) { return { ok: false, error: 'تعذر رسم المستند' }; }
                const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
                const pageW = pdf.internal.pageSize.getWidth();
                const pageH = pdf.internal.pageSize.getHeight();
                const pages = slicePages(canvas.width, canvas.height, pageW, pageH);
                for (let i = 0; i < pages.length; i++) {
                    if (i > 0) { pdf.addPage(); }
                    const slice = document.createElement('canvas');
                    slice.width = canvas.width;
                    slice.height = pages[i].h;
                    const ctx = slice.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, slice.width, slice.height);
                    ctx.drawImage(canvas, 0, pages[i].y, canvas.width, pages[i].h, 0, 0, canvas.width, pages[i].h);
                    pdf.addImage(slice.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, (pages[i].h / canvas.width) * pageW, undefined, 'FAST');
                }
                const blob = pdf.output('blob');
                if (!blob || !blob.size) { return { ok: false, error: 'تعذر توليد ملف PDF' }; }
                return { ok: true, blob: blob };
            });
        }).catch(function (e) {
            return { ok: false, error: (e && e.message) || 'تعذر توليد PDF' };
        });
    }

    function download(blob, filename) {
        try {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(function () { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
            return true;
        } catch (_) { return false; }
    }

    function shareOrDownload(blob, filename, title) {
        /* (2026-11-01) ترتيب القنوات في الـ APK (WebView بلا navigator.share):
           1) @capacitor/share + @capacitor/filesystem — ورقة المشاركة الأصلية
              بواتساب (تشتغل بعد بناء APK 4.9.2).
           2) navigator.share — متصفح الهاتف.
           3) تنزيل احتياطي. */
        const file = new File([blob], filename, { type: 'application/pdf' });
        const cap = window.Capacitor && window.Capacitor.Plugins;
        if (cap && cap.Share && cap.Filesystem && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
            return cap.Filesystem.writeFile({
                path: filename,
                data: blob,
                directory: 'CACHE',
                recursive: true,
            }).then(function (res) {
                return cap.Share.share({ title: title || filename, url: res.uri, dialogTitle: 'مشاركة التقرير' })
                    .then(function () { return 'shared'; })
                    .catch(function (e) {
                        if (e && e.message && /cancel/i.test(String(e.message))) { return 'cancelled'; }
                        return download(blob, filename) ? 'downloaded' : 'failed';
                    });
            }).catch(function (e) {
                if (e && e.message && /cancel/i.test(String(e.message))) { return 'cancelled'; }
                return download(blob, filename) ? 'downloaded' : 'failed';
            });
        }
        try {
            if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
                return navigator.share({ files: [file], title: title || filename })
                    .then(function () { return 'shared'; })
                    .catch(function (e) {
                        if (e && e.name === 'AbortError') { return 'cancelled'; }
                        return download(blob, filename) ? 'downloaded' : 'failed';
                    });
            }
        } catch (_) { /* اسقط للاحتياط */ }
        return Promise.resolve(download(blob, filename) ? 'downloaded' : 'failed');
    }

    function whatsappUrl(title) {
        return 'https://wa.me/?text=' + encodeURIComponent('📌 ' + String(title || 'تقرير').trim() + ' — من نظام مطاعم الشرفة');
    }

    window.__karimPdfShare = {
        ensureLibs: ensureLibs,
        buildFromFrame: buildFromFrame,
        download: download,
        shareOrDownload: shareOrDownload,
        whatsappUrl: whatsappUrl,
        filenameOf: filenameOf,
    };
})();
