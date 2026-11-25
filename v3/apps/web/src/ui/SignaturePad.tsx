import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from './cn';

/**
 * لوحة التوقيع الإلكتروني — نظير `frontend/app/js/v2/signature.js` حرفًا بحرف:
 *
 *  • التوقيع **يُرسم تلقائيًا باسم صاحب الحساب** (مقفلًا) بتاريخ اليوم وخط
 *    الفعل التركوازي منحنٍ — فلا يحتاج المستخدم إلى معرفة الرسم ولا إلى قلم.
 *  • يمكن الرسم فوقه بالإصبع أو الماوس لتحسين الشكل (اختياري تمامًا).
 *  • القيمة المُرسلة `canvas.toDataURL('image/png')` — نفس ما يقرأه
 *    `requireSignature` من `signatureData` في الخادم.
 *
 * لماذا هذا التغيير؟ في V3 السابق كانت اللوحة فارغة وتطلب الرسم فقط، فكان
 * المستخدم يرى «تعذر رسم التوقيع» ولا يعرف ماذا يفعل. الآن الحقل يُملأ من
 * الحساب فورًا، ويبقى الرسم ميزة لا شرطًا.
 *
 * لا يفترض المكوّن نجاح الرسم: لو تعذّر الحصول على سياق 2D (بيئة اختبار أو
 * متصفح مقيد) يبقى التوقيع `null` ويظهر الخطأ الصريح عند الإرسال بدل توقيع
 * فارغ يُقبل على الخادم.
 */

const SIGNATURE_WIDTH = 900;
const SIGNATURE_HEIGHT = 240;

/*
 * احتياطي الهوية عند غياب الرموز (بيئة اختبار أو DOM بلا `styles.css`).
 * القيم تطابق عقد DESIGN.md: `#172B3B` حبر، `#0F766E` فعل، `#596E80` ثانوي،
 * `#FFFFFF` سطح. لا تُقرأ هذه القيم إلا إذا فشل `getPropertyValue`.
 */
const FALLBACK_INK = '#172B3B';
const FALLBACK_ACCENT = '#0F766E';
const FALLBACK_MUTED = '#596E80';
const FALLBACK_SURFACE = '#FFFFFF';

const DATE_FMT = new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** نفس تطبيع الخادم: تقليم + دمج المسافات. */
export function normalizeSignatureName(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ');
}

function readToken(element: HTMLElement, name: string, fallback: string): string {
    try {
        const value = window.getComputedStyle(element).getPropertyValue(name).trim();
        return value || fallback;
    } catch {
        return fallback;
    }
}

function signatureFont(size: number): string {
    return `700 ${String(size)}px 'Tajawal', 'Segoe UI', Tahoma, sans-serif`;
}

function textWidth(context: CanvasRenderingContext2D, text: string): number {
    try {
        const metrics = context.measureText(text);
        const width = Number(metrics?.width ?? 0);
        return Number.isFinite(width) ? width : 0;
    } catch {
        return 0;
    }
}

/**
 * يرسم توقيع الاسم على اللوحة.
 * @returns هل رُسم توقيع فعلي (اسم بطول حرفين على الأقل وسياق متاح)؟
 */
export function paintTypedSignature(canvas: HTMLCanvasElement, rawName: string): boolean {
    let context: CanvasRenderingContext2D | null = null;
    try {
        context = canvas.getContext('2d');
    } catch {
        return false;
    }
    if (!context) {
        return false;
    }

    const name = normalizeSignatureName(rawName);
    const ink = readToken(canvas, '--erp-ink', FALLBACK_INK);
    const accent = readToken(canvas, '--erp-primary', FALLBACK_ACCENT);
    const muted = readToken(canvas, '--erp-muted', FALLBACK_MUTED);
    const surface = readToken(canvas, '--erp-surface', FALLBACK_SURFACE);

    try {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = surface;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.direction = 'rtl';

        if (name.length < 2) {
            context.fillStyle = muted;
            context.font = "26px 'Tajawal', 'Segoe UI', Tahoma, sans-serif";
            context.fillText('التوقيع يظهر هنا بعد ضبط اسم الحساب', canvas.width / 2, canvas.height / 2 - 6);
            return false;
        }

        let size = 74;
        context.font = signatureFont(size);
        let width = textWidth(context, name);
        while (width > canvas.width - 140 && size > 30) {
            size -= 4;
            context.font = signatureFont(size);
            width = textWidth(context, name);
        }

        context.fillStyle = ink;
        context.fillText(name, canvas.width / 2, canvas.height * 0.4);

        const underline = Math.min(width || canvas.width * 0.5, canvas.width - 120);
        const y = canvas.height * 0.68;
        context.strokeStyle = accent;
        context.lineWidth = 2.5;
        context.lineCap = 'round';
        context.beginPath();
        context.moveTo(canvas.width / 2 - underline / 2, y);
        context.bezierCurveTo(
            canvas.width / 2 - underline / 6,
            y - 12,
            canvas.width / 2 + underline / 6,
            y + 12,
            canvas.width / 2 + underline / 2,
            y - 6,
        );
        context.stroke();

        context.fillStyle = muted;
        context.font = "20px 'Tajawal', 'Segoe UI', Tahoma, sans-serif";
        context.fillText(`توقيع إلكتروني • ${DATE_FMT.format(new Date())}`, canvas.width / 2, canvas.height * 0.87);
        return true;
    } catch {
        return false;
    }
}

export interface SignaturePadProps {
    /** عنوان اللوحة كما يراه الموقّع. */
    label: string;
    /** اسم صاحب الحساب — لا يُقبل غيره، والخادم يعيد الفحص. */
    name: string;
    /** يُنادى بكل تغيير: `data:image/png;base64,…` أو `null`. */
    onChange: (dataUrl: string | null) => void;
    /** معرّف الاختبار على الكانفس (للاختبارات الحارسة). */
    testId?: string;
    className?: string;
}

export function SignaturePad({ label, name, onChange, testId, className }: SignaturePadProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);
    const inkedRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const onChangeRef = useRef(onChange);
    const [inked, setInked] = useState(false);

    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    const emit = useCallback((): void => {
        const canvas = canvasRef.current;
        if (!canvas || !inkedRef.current) {
            onChangeRef.current(null);
            return;
        }
        try {
            onChangeRef.current(canvas.toDataURL('image/png'));
        } catch {
            onChangeRef.current(null);
        }
    }, []);

    /** يعيد رسم توقيع الاسم ويلغي أي شخبطة سابقة. */
    const repaint = useCallback((): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const painted = paintTypedSignature(canvas, name);
        inkedRef.current = painted;
        setInked(painted);
        emit();
    }, [name, emit]);

    useEffect(() => {
        repaint();
        let cancelled = false;
        // الخطوط قد تصل متأخرة؛ إعادة الرسم تُبقي القياسات صحيحة.
        const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
        if (fonts?.ready) {
            void fonts.ready.then(() => {
                if (!cancelled) {
                    repaint();
                }
            });
        }
        return () => {
            cancelled = true;
        };
    }, [repaint]);

    function context2d(): CanvasRenderingContext2D | null {
        try {
            return canvasRef.current?.getContext('2d') ?? null;
        } catch {
            return null;
        }
    }

    /** يحوّل إحداثيات المؤشر إلى مساحة الكانفس (الكانفس يُعرض بعرض مختلف). */
    function pointOf(event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
        const canvas = event.currentTarget;
        const rect = canvas.getBoundingClientRect();
        const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
        const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
        return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
    }

    function start(event: React.PointerEvent<HTMLCanvasElement>): void {
        event.preventDefault();
        try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
            // بعض المتصفحات القديمة لا تدعم الالتقاط — الرسم يظل يعمل.
        }
        drawingRef.current = true;
        const point = pointOf(event);
        lastPointRef.current = point;
        const context = context2d();
        if (context) {
            context.lineWidth = 2.5;
            context.strokeStyle = readToken(event.currentTarget, '--erp-ink', FALLBACK_INK);
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.beginPath();
            context.moveTo(point.x, point.y);
            context.lineTo(point.x + 0.5, point.y + 0.5);
            context.stroke();
        }
        inkedRef.current = true;
        setInked(true);
        emit();
    }

    function move(event: React.PointerEvent<HTMLCanvasElement>): void {
        if (!drawingRef.current) {
            return;
        }
        event.preventDefault();
        const point = pointOf(event);
        const last = lastPointRef.current ?? point;
        const context = context2d();
        if (context) {
            context.beginPath();
            context.moveTo(last.x, last.y);
            context.lineTo(point.x, point.y);
            context.stroke();
        }
        lastPointRef.current = point;
        emit();
    }

    function end(event?: React.PointerEvent<HTMLCanvasElement>): void {
        drawingRef.current = false;
        lastPointRef.current = null;
        if (event) {
            try {
                event.currentTarget.releasePointerCapture?.(event.pointerId);
            } catch {
                // لا شيء — الالتقاط لم يُمنح أصلًا.
            }
        }
    }

    return (
        <div className={cn('flex min-w-0 flex-col gap-xs', className)} data-erp-print-hide>
            <span className="text-label-md text-ink-secondary">{label}</span>
            <input
                type="text"
                readOnly
                tabIndex={-1}
                value={name}
                aria-label={`${label} — توقيع ${name || '—'}`}
                aria-readonly="true"
                className="h-9 w-full min-w-0 rounded-md border border-hairline bg-surface-sunken px-sm text-body-md text-ink"
            />
            <canvas
                ref={canvasRef}
                width={SIGNATURE_WIDTH}
                height={SIGNATURE_HEIGHT}
                role="img"
                aria-label={label}
                data-testid={testId}
                onPointerDown={start}
                onPointerMove={move}
                onPointerUp={end}
                onPointerCancel={end}
                onPointerLeave={end}
                className="block h-auto w-full max-w-full touch-none rounded-md border border-hairline-strong bg-surface select-none"
            />
            <div className="flex flex-wrap items-center justify-between gap-xs">
                <span className="text-caption text-faint">
                    {inked ? 'التوقيع جاهز باسم حسابك — يمكنك الرسم فوقه بإصبعك أو الماوس.' : 'اضبط اسم الحساب أولًا ليُرسم التوقيع.'}
                </span>
                <button
                    type="button"
                    onClick={repaint}
                    className="rounded-md border border-hairline-strong bg-surface px-sm py-xxs text-caption text-ink hover:bg-surface-hover"
                >
                    إعادة التوقيع
                </button>
            </div>
        </div>
    );
}
