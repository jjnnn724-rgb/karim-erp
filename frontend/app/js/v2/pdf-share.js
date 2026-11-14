/**
 * V2 — محرك تصدير PDF ومشاركته (2026-10-31 بطلب المالك)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   «استعلام المبيعات عايز احملها pdf واي مكان في طباعة اقدر انسخه او
 *   اعمله شير pdf» — هذا المحرك يلتقط أي مستند معروض في عارض التقارير
 *   (report-viewer.js — وكل طباعات V2 الـ27 شاشة تمر عبره) ويحوّله إلى
 *   ملف PDF حقيقي متعدد الصفحات بمقاس A4، ثم:
 *     • «تحميل PDF»  → تنزيل مباشر بجهاز المستخدم
 *     • «مشاركة PDF» → ورقة مشاركة النظام (واتساب/تيليجرام/بريد…) عبر
 *       Web Share API — وتنزيل تلقائي حيث لا توجد مشاركة ملفات.
 *
 * WHY IMAGE-BASED PDF
 *   التقاط العرض كما يراه المستخدم (canvas) يعني عربيةً كاملة التشكيل
 *   والإكساء الفاخر للأوراق بلا أي مكتبة خطوط أو bidi — الورقة هي هي.
 *   النص داخلها صورة عالية الدقة (scale 2)؛ للتقارير والمشاركة هذا هو
 *   المقصود، وليس بديلًا عن الأرشفة النصية إن جاء يومها.
 *
 * THE RULES
 *   1. لا CDN: المكتبتان من /app/js/vendor (CSP script-src 'self').
 *   2. لا يُحمَّل شيء لمن لن يصدّر: المكتبات عند أول ضغطة زر (vendor.js).
 *   3. لا يرمي أبدًا: كل فشل يعيد {ok:false, error} برسالة عربية — الزر
 *      يفيق من حالة الانتظار مهما حدث.
 *   4. صفوف A4 تُقصّ عند حدود الصفحة بلا تمديد مشوّه (slice، لا squash).
 *
 * ROLLBACK
 *   أزِل الاستيراد والزرين في report-viewer.js — لا شيء آخر يمسّه.
 */

import { ensureVendor } from './vendor.js?v=4.9.321';

/* ── أدوات نقية (لعقد الاختبار) ─────────────────────────────────────── */

/** نقية: اسم ملف آمن من عنوان التقرير — عربي مقروء، بلا محارف ممنوعة. */
export function buildFilename(title, now = new Date()) {
    const clean = String(title || 'تقرير')
        .replace(/[\\/:*?"<>|؟،؛]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const hour = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
    return `${clean || 'تقرير'} ${day} ${hour}.pdf`;
}

/** نقية: مخطط تقطيع لوحة طويلة إلى صفوف A4 — يُعيد {y,h} بالبكسل لكل صفحة. */
export function slicePages(canvasW, canvasH, pageW, pageH) {
    if (!canvasW || !canvasH || !pageW || !pageH) {return [];}
    const pageHpx = Math.floor(canvasW * (pageH / pageW));
    if (pageHpx <= 0) {return [];}
    const pages = [];
    for (let y = 0; y < canvasH; y += pageHpx) {
        pages.push({ y, h: Math.min(pageHpx, canvasH - y) });
    }
    return pages;
}

/** هل يسمح هذا المتصفح بمشاركة ملفات؟ (أندرويد/جوال غالبًا نعم). */
export function canShareFiles() {
    try {
        return typeof navigator !== 'undefined'
            && typeof navigator.share === 'function'
            && typeof navigator.canShare === 'function';
    } catch {
        return false;
    }
}

/* ── التوليد ────────────────────────────────────────────────────────── */

/** تحميل المكتبتين في سياق الصفحة الأب (مرة واحدة لكل جلسة). */
async function ensurePdfLibs() {
    const okCanvas = await ensureVendor('Html2CanvasPro');
    const okPdf = await ensureVendor('JsPDF');
    return okCanvas && okPdf
        && typeof window.html2canvas === 'function'
        && typeof window.jspdf?.jsPDF === 'function';
}

/**
 * يلتقط مستند الـiframe (srcdoc بنفس المنشأ) ويركّب PDF متعدد الصفحات.
 * @param {HTMLIFrameElement} frame عارض التقارير
 * @param {{scale?:number}} [opts]
 * @returns {Promise<{ok:true, blob:Blob}|{ok:false, error:string}>}
 */
export async function buildPdfFromFrame(frame, opts = {}) {
    try {
        if (!frame || !frame.contentDocument || !frame.contentDocument.body) {
            return { ok: false, error: 'لا يوجد مستند معروض للتصدير' };
        }
        if (!await ensurePdfLibs()) {
            return { ok: false, error: 'تعذر تحميل محرك PDF — تحقق من الاتصال ثم أعد المحاولة' };
        }
        const doc = frame.contentDocument;
        const target = doc.querySelector('.rp-sheet, .sheet, .a4') || doc.body;
        const scale = Math.min(2, Math.max(1, Number(opts.scale) || 2));
        const canvas = await window.html2canvas(target, {
            scale,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false,
            windowWidth: doc.documentElement.scrollWidth,
            windowHeight: doc.documentElement.scrollHeight,
        });
        if (!canvas || !canvas.width || !canvas.height) {
            return { ok: false, error: 'تعذر رسم المستند للتصدير' };
        }
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const pages = slicePages(canvas.width, canvas.height, pageW, pageH);
        if (!pages.length) {return { ok: false, error: 'المستند فارغ' };}
        for (let i = 0; i < pages.length; i++) {
            const { y, h } = pages[i];
            if (i > 0) {pdf.addPage();}
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = h;
            const ctx = slice.getContext('2d');
            if (!ctx) {return { ok: false, error: 'تعذر تقطيع الصفحات' };}
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, slice.width, slice.height);
            ctx.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
            const img = slice.toDataURL('image/jpeg', 0.92);
            /* الصفحة الأخيرة قد تكون أقصر — تُرسم بطولها الحقيقي لا ممطوطة */
            const drawH = (h / canvas.width) * pageW;
            pdf.addImage(img, 'JPEG', 0, 0, pageW, drawH, undefined, 'FAST');
        }
        const blob = pdf.output('blob');
        if (!blob || !blob.size) {return { ok: false, error: 'تعذر توليد ملف PDF' };}
        return { ok: true, blob };
    } catch (error) {
        return { ok: false, error: (error && error.message) || 'تعذر توليد PDF' };
    }
}

/** تنزيل Blob بجهاز المستخدم. */
export function downloadBlob(blob, filename) {
    try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try {URL.revokeObjectURL(url);} catch { /* */ } }, 4000);
        return true;
    } catch {
        return false;
    }
}

/**
 * مشاركة ملف PDF عبر ورقة النظام (واتساب وغيرها). يعيد 'shared' |
 * 'downloaded' (احتياط حيث لا مشاركة ملفات) | 'failed'.
 */
export async function shareBlob(blob, filename, title) {
    try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (canShareFiles()) {
            let shareable = false;
            try {shareable = navigator.canShare({ files: [file] });} catch { shareable = false; }
            if (shareable) {
                await navigator.share({ files: [file], title: title || filename });
                return 'shared';
            }
        }
        return downloadBlob(blob, filename) ? 'downloaded' : 'failed';
    } catch (error) {
        /* AbortError = المستخدم أغلق ورقة المشاركة — ليس فشلًا.
           NotAllowedError = توليد الـPDF أكل مهلة التفاعل قبل النداء —
           النسخة صارت مخبأة فالضغطة الثانية تشارك فورًا (لا تنزيل صامت
           يُخفي أن المشاركة ممكنة على الهاتف). */
        if (error && error.name === 'AbortError') {return 'cancelled';}
        if (error && error.name === 'NotAllowedError') {return 'retry';}
        return downloadBlob(blob, filename) ? 'downloaded' : 'failed';
    }
}

/**
 * رابط واتساب جاهز بنص التقرير — لسطح المكتب حيث لا توجد ورقة مشاركة
 * ملفات: يُنزَّل الملف ويُفتح واتساب والمستخدم يُرفق الملف في المحادثة.
 */
export function whatsappUrl(title) {
    const text = `📌 ${String(title || 'تقرير').trim()} — من نظام مطاعم الشرفة`;
    return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * السطر الأمامي للعارض: يبني PDF من الـiframe ثم يحمّله أو يشاركه.
 * @returns {Promise<{ok:boolean, mode?:string, error?:string}>}
 */
export async function exportReportPdf(frame, title, { mode = 'download' } = {}) {
    const built = await buildPdfFromFrame(frame);
    if (!built.ok) {return built;}
    const filename = buildFilename(title);
    if (mode === 'share') {
        const result = await shareBlob(built.blob, filename, title);
        return { ok: result !== 'failed', mode: result };
    }
    return { ok: downloadBlob(built.blob, filename), mode: 'downloaded' };
}
