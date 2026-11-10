import { writeErrorMessage } from './write';

/**
 * تصدير PDF ومشاركته — نظير `js/v2/pdf-share.js` في V2.
 *
 * القواعد المنقولة حرفيًّا:
 *  1. **لا CDN**: المكتبتان من `/app/js/vendor` على الأصل نفسه (نفس ملفي V2)
 *     وتُحمَّلان عند أول ضغطة زر فقط، فلا يدفع ثمنها من لا يصدّر.
 *  2. **PDF صوري متعدد الصفحات A4**: التقاط العنصر بـ`html2canvas` (scale 2،
 *     خلفية بيضاء)، تقطيع اللوحة الطويلة إلى صفحات A4 بدون تمطيط، وكل صفحة
 *     JPEG 0.92 داخل `jsPDF` بوحدة pt — نفس `buildPdfFromFrame` في V2.
 *  3. **اسم الملف** بنفس الصيغة: «عنوان التقرير YYYY-MM-DD HH-mm.pdf».
 *  4. **المشاركة أولًا**: ورقة مشاركة النظام (واتساب…) عبر Web Share API،
 *     والتنزيل بديلًا حيث لا مشاركة ملفات. الإلغاء ليس فشلًا.
 *  5. **لا يرمي أبدًا**: كل فشل يعيد `{ok:false, error}` برسالة عربية، فيفيق
 *     الزر من حالة الانتظار مهما حدث.
 */

const VENDOR_BASE = '/app/js/vendor';
const HTML2CANVAS_SRC = `${VENDOR_BASE}/html2canvas-pro.min.js`;
const JSPDF_SRC = `${VENDOR_BASE}/jspdf.umd.min.js`;

export interface PdfDocument {
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } };
    addPage: () => void;
    addImage: (
        image: string,
        format: string,
        x: number,
        y: number,
        width: number,
        height: number,
        alias?: string,
        compression?: string,
    ) => void;
    output: (type: 'blob') => Blob;
}

interface Html2CanvasOptions {
    scale?: number;
    backgroundColor?: string;
    useCORS?: boolean;
    logging?: boolean;
    windowWidth?: number;
    windowHeight?: number;
}

interface JsPdfGlobal {
    jsPDF: new (options?: { unit?: string; format?: string; orientation?: string; compress?: boolean }) => PdfDocument;
}

interface PdfGlobals {
    html2canvas?: (element: HTMLElement, options?: Html2CanvasOptions) => Promise<HTMLCanvasElement>;
    jspdf?: JsPdfGlobal;
}

function pdfGlobals(): PdfGlobals {
    return (typeof window === 'undefined' ? {} : (window as unknown as PdfGlobals)) ?? {};
}

/** اسم ملف آمن من عنوان التقرير — نفسه حرفيًّا في V2 (`buildFilename`). */
export function buildFilename(title: unknown, now: Date = new Date()): string {
    const clean = String(title || 'تقرير')
        .replace(/[\\/:*?"<>|؟،؛]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60);
    const pad = (value: number): string => String(value).padStart(2, '0');
    const day = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const hour = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
    return `${clean || 'تقرير'} ${day} ${hour}.pdf`;
}

/** مخطط تقطيع لوحة طويلة إلى صفوف A4 — نفس `slicePages` في V2 (بكسل). */
export function slicePages(canvasW: number, canvasH: number, pageW: number, pageH: number): { y: number; h: number }[] {
    if (!canvasW || !canvasH || !pageW || !pageH) {
        return [];
    }
    const pageHpx = Math.floor(canvasW * (pageH / pageW));
    if (pageHpx <= 0) {
        return [];
    }
    const pages: { y: number; h: number }[] = [];
    for (let y = 0; y < canvasH; y += pageHpx) {
        pages.push({ y, h: Math.min(pageHpx, canvasH - y) });
    }
    return pages;
}

/** هل يسمح المتصفح بمشاركة الملفات (جوال/أندرويد غالبًا)؟ */
export function canShareFiles(): boolean {
    try {
        return (
            typeof navigator !== 'undefined' &&
            typeof navigator.share === 'function' &&
            typeof navigator.canShare === 'function'
        );
    } catch {
        return false;
    }
}

let libPromise: Promise<boolean> | null = null;

function loadScript(src: string, isReady: () => boolean): Promise<boolean> {
    if (isReady()) {
        return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
        const tag = document.createElement('script');
        tag.src = src;
        tag.async = true;
        tag.onload = () => {
            resolve(isReady());
        };
        tag.onerror = () => {
            resolve(false);
        };
        document.head.appendChild(tag);
    });
}

/** تحميل المكتبتين مرة واحدة لكل جلسة (نفس ملفي V2 من الأصل نفسه). */
export function ensurePdfLibs(): Promise<boolean> {
    if (!libPromise) {
        libPromise = (async () => {
            const canvasOk = await loadScript(HTML2CANVAS_SRC, () => typeof pdfGlobals().html2canvas === 'function');
            const pdfOk = await loadScript(JSPDF_SRC, () => typeof pdfGlobals().jspdf?.jsPDF === 'function');
            return canvasOk && pdfOk;
        })();
    }
    return libPromise;
}

export type PdfBuildResult = { ok: true; blob: Blob } | { ok: false; error: string };

/** بناء PDF من عنصر حيّ (صفحة/بطاقة/تقرير) — نفس منطق V2 بلا iframe. */
export async function buildPdfFromElement(
    element: HTMLElement | null,
    options: { scale?: number } = {},
): Promise<PdfBuildResult> {
    try {
        if (!element) {
            return { ok: false, error: 'لا يوجد مستند معروض للتصدير' };
        }
        if (!(await ensurePdfLibs())) {
            return { ok: false, error: 'تعذر تحميل محرك PDF — تحقق من الاتصال ثم أعد المحاولة' };
        }
        const globals = pdfGlobals();
        const html2canvas = globals.html2canvas;
        const jsPdf = globals.jspdf?.jsPDF;
        if (!html2canvas || !jsPdf) {
            return { ok: false, error: 'تعذر تحميل محرك PDF — تحقق من الاتصال ثم أعد المحاولة' };
        }
        const scale = Math.min(2, Math.max(1, Number(options.scale) || 2));
        const canvas = await html2canvas(element, {
            scale,
            backgroundColor: '#ffffff',
            useCORS: true,
            logging: false,
            windowWidth: document.documentElement.scrollWidth,
            windowHeight: document.documentElement.scrollHeight,
        });
        if (!canvas || !canvas.width || !canvas.height) {
            return { ok: false, error: 'تعذر رسم المستند للتصدير' };
        }
        const pdf = new jsPdf({ unit: 'pt', format: 'a4', orientation: 'portrait', compress: true });
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const pages = slicePages(canvas.width, canvas.height, pageW, pageH);
        if (pages.length === 0) {
            return { ok: false, error: 'المستند فارغ' };
        }
        for (let index = 0; index < pages.length; index += 1) {
            const page = pages[index];
            if (!page) {
                continue;
            }
            if (index > 0) {
                pdf.addPage();
            }
            const slice = document.createElement('canvas');
            slice.width = canvas.width;
            slice.height = page.h;
            const context = slice.getContext('2d');
            if (!context) {
                return { ok: false, error: 'تعذر تقطيع الصفحات' };
            }
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, slice.width, slice.height);
            context.drawImage(canvas, 0, page.y, canvas.width, page.h, 0, 0, canvas.width, page.h);
            const image = slice.toDataURL('image/jpeg', 0.92);
            // الصفحة الأخيرة قد تكون أقصر — تُرسم بطولها الحقيقي لا ممطوطة.
            const drawH = (page.h / canvas.width) * pageW;
            pdf.addImage(image, 'JPEG', 0, 0, pageW, drawH, undefined, 'FAST');
        }
        const blob = pdf.output('blob');
        if (!blob || !blob.size) {
            return { ok: false, error: 'تعذر توليد ملف PDF' };
        }
        return { ok: true, blob };
    } catch (error) {
        return { ok: false, error: writeErrorMessage(error, 'تعذر توليد PDF') };
    }
}

/** تنزيل Blob بجهاز المستخدم — نفس `downloadBlob`. */
export function downloadBlob(blob: Blob, filename: string): boolean {
    try {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => {
            try {
                URL.revokeObjectURL(url);
            } catch {
                /* لا شيء */
            }
        }, 4000);
        return true;
    } catch {
        return false;
    }
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled' | 'retry' | 'failed';

/** مشاركة الملف عبر ورقة النظام، والتنزيل بديلًا — نفس `shareBlob`. */
export async function shareBlob(blob: Blob, filename: string, title: string): Promise<ShareResult> {
    try {
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (canShareFiles()) {
            let shareable = false;
            try {
                shareable = navigator.canShare({ files: [file] });
            } catch {
                shareable = false;
            }
            if (shareable) {
                await navigator.share({ files: [file], title: title || filename });
                return 'shared';
            }
        }
        return downloadBlob(blob, filename) ? 'downloaded' : 'failed';
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'AbortError') {
            return 'cancelled';
        }
        if (name === 'NotAllowedError') {
            return 'retry';
        }
        return downloadBlob(blob, filename) ? 'downloaded' : 'failed';
    }
}

export type ExportMode = 'download' | 'share';

export interface ExportResult {
    ok: boolean;
    mode?: ShareResult | 'downloaded';
    error?: string;
}

/** السطر الأمامي: يبني PDF من العنصر ثم يحمّله أو يشاركه (`exportReportPdf`). */
export async function exportElementPdf(
    element: HTMLElement | null,
    title: string,
    options: { mode?: ExportMode } = {},
): Promise<ExportResult> {
    const built = await buildPdfFromElement(element);
    if (!built.ok) {
        return built;
    }
    const filename = buildFilename(title);
    if (options.mode === 'share') {
        const mode = await shareBlob(built.blob, filename, title);
        return { ok: mode !== 'failed', mode };
    }
    return { ok: downloadBlob(built.blob, filename), mode: 'downloaded' };
}
