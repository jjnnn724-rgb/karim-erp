import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/**
 * كاميرا الوجه — نقل `portal-face.js` في القديم إلى React:
 * كشف وجه محلي، قصّ حول الصندوق، رفع صورة احتياطي، وجمع عيّنات.
 *
 * القواعد المنقولة:
 *  · لا شبكة هنا إطلاقًا: الكاميرا والكشف محليان، والإرسال في `portal-write.ts`.
 *  · face-api محلي من `/app/vendor/` (نفس ملف القديم) — لا CDN، وCSP يسمح
 *    بالمصدر نفسه فقط.
 *  · لقطة v2 وحدها تكفي لمحرك ArcFace على الخادم. محرك v1 (128-d) يحتاج
 *    descriptor من face-api؛ لذلك `requireDescriptor` يمنع إرسال لقطة ناقصة.
 *  · الوضع الصارم لا يقبل صورة من المعرض (`allowUpload:false`).
 *  · لا صور تُخزَّن: تُمرَّر للخادم الذي يستهلكها ويُهملها.
 *  · تنظيف كامل: المسار يتوقف عند الإغلاق أو الاكتمال — لا كاميرا تعمل بعده.
 */

const FACE_API_SRC = '/app/vendor/face-api.js?v=4.9.77';
const FACE_MODELS_URI = '/app/vendor/face-models';
const MAX_SAMPLES = 8;

const CAMERA_TRIES: MediaStreamConstraints[] = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
];

interface FaceBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface FaceDetection {
    detection: { box: FaceBox };
    descriptor?: Float32Array;
}

interface FaceEngine {
    tf: { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    nets: {
        tinyFaceDetector: { loadFromUri(uri: string): Promise<void> };
        faceLandmark68Net: { loadFromUri(uri: string): Promise<void> };
        faceRecognitionNet: { loadFromUri(uri: string): Promise<void> };
    };
    detectSingleFace(
        input: HTMLVideoElement | HTMLImageElement,
        options: unknown,
    ): { withFaceLandmarks(): { withFaceDescriptor(): Promise<FaceDetection | undefined> } };
    TinyFaceDetectorOptions: new (options: { inputSize: number; scoreThreshold: number }) => unknown;
}

let faceApiPromise: Promise<FaceEngine> | null = null;

function faceApiLoaded(): FaceEngine | null {
    return (globalThis as { faceapi?: FaceEngine }).faceapi ?? null;
}

function loadFaceApi(): Promise<FaceEngine> {
    const already = faceApiLoaded();
    if (already) {
        return Promise.resolve(already);
    }
    if (faceApiPromise) {
        return faceApiPromise;
    }
    faceApiPromise = new Promise<FaceEngine>((resolve, reject) => {
        const ready = async () => {
            try {
                const api = faceApiLoaded();
                if (!api) {
                    throw new Error('محرك الوجه غير متاح');
                }
                await api.tf.setBackend('webgl').catch(() => api.tf.setBackend('cpu'));
                await api.tf.ready();
                await Promise.all([
                    api.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URI),
                    api.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URI),
                    api.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URI),
                ]);
                resolve(api);
            } catch (error) {
                reject(error);
            }
        };
        const script = document.createElement('script');
        script.src = FACE_API_SRC;
        script.async = true;
        script.onload = ready;
        script.onerror = () => reject(new Error('تعذر تحميل محرك التعرف على الوجه'));
        document.head.appendChild(script);
    }).catch((error: unknown) => {
        faceApiPromise = null;
        throw error;
    });
    return faceApiPromise;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

function isSecureCameraContext(): boolean {
    if (globalThis.isSecureContext) {
        return true;
    }
    const host = globalThis.location?.hostname;
    return host === 'localhost' || host === '127.0.0.1';
}

async function openCameraStream(video: HTMLVideoElement): Promise<MediaStream> {
    if (!isSecureCameraContext()) {
        throw new Error('الكاميرا تحتاج اتصالًا آمنًا (HTTPS) — افتح النظام عبر https، أو ارفع صورة بالأسفل');
    }
    const media = globalThis.navigator?.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
        throw new Error('المتصفح لا يدعم الكاميرا — استخدم «رفع صورة» بالأسفل');
    }
    let lastError: unknown = null;
    let stream: MediaStream | null = null;
    for (const constraints of CAMERA_TRIES) {
        try {
            stream = await media.getUserMedia(constraints);
            break;
        } catch (error) {
            lastError = error;
        }
    }
    if (stream) {
        try {
            video.srcObject = stream;
            await video.play();
            return stream;
        } catch {
            stream.getTracks().forEach((track) => {
                track.stop();
            });
            video.srcObject = null;
            throw new Error('تم فتح الكاميرا لكن تعذر عرض الصورة — اضغط «إعادة تشغيل الكاميرا» أو تحقق من أذونات الموقع');
        }
    }
    const name = lastError instanceof Error ? lastError.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        throw new Error('مُنع الوصول للكاميرا — اسمح بها من إعدادات الموقع ثم أعد المحاولة');
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        throw new Error('لا توجد كاميرا متاحة — استخدم «رفع صورة» بالأسفل');
    }
    if (name === 'NotReadableError') {
        throw new Error('الكاميرا مشغولة بتطبيق آخر — أغلقه وأعد المحاولة');
    }
    throw new Error('تعذر تشغيل الكاميرا — جرّب «رفع صورة» بالأسفل');
}

/** قصّ الوجه حول الصندوق إلى 160×160 JPEG — السيرفر يتحقق ويستخرج المتجه. */
function cropFaceToJpeg(video: HTMLVideoElement, box: FaceBox): string | null {
    try {
        const vw = video.videoWidth || video.clientWidth || 640;
        const vh = video.videoHeight || video.clientHeight || 480;
        const margin = Math.max(box.width, box.height) * 0.28;
        const sx = Math.max(0, box.x - margin);
        const sy = Math.max(0, box.y - margin);
        const sw = Math.min(vw - sx, box.width + margin * 2);
        const sh = Math.min(vh - sy, box.height + margin * 2);
        if (sw < 20 || sh < 20) {
            return null;
        }
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        canvas.getContext('2d')?.drawImage(video, sx, sy, sw, sh, 0, 0, 160, 160);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
        return null;
    }
}

/** قصّ مركزي احتياطي (بلا كشف) — ArcFace على الخادم يتحقق من الوجه. */
function cropCenterToJpeg(video: HTMLVideoElement): string | null {
    try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const side = Math.min(vw, vh) * 0.8;
        const sx = (vw - side) / 2;
        const sy = (vh - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        canvas.getContext('2d')?.drawImage(video, sx, sy, side, side, 0, 0, 160, 160);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
        return null;
    }
}

/** لقطة ملف صورة إلى JPEG (بحد 480) — للكاميرا المحجوبة أو الجهاز بلا كاميرا. */
function fileToJpegDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => {
            try {
                const side = Math.max(image.width, image.height);
                const scale = Math.min(1, 480 / side);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(image.width * scale);
                canvas.height = Math.round(image.height * scale);
                canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            } catch (error) {
                URL.revokeObjectURL(url);
                reject(error instanceof Error ? error : new Error('تعذر قراءة الصورة'));
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('تعذر قراءة الصورة'));
        };
        image.src = url;
    });
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('تعذر قراءة الصورة'));
        image.src = src;
    });
}

async function detectFace(
    engine: FaceEngine,
    options: unknown,
    source: HTMLVideoElement | HTMLImageElement,
): Promise<FaceDetection | null> {
    try {
        const detection = await engine.detectSingleFace(source, options).withFaceLandmarks().withFaceDescriptor();
        return detection ?? null;
    } catch {
        return null;
    }
}

export interface FaceCaptureResult {
    images: string[];
    descriptors: number[][];
    sources: Array<'live' | 'upload'>;
}

export interface FaceCaptureDialogProps {
    open: boolean;
    title?: string;
    target?: number;
    wantDescriptors?: boolean;
    requireDescriptor?: boolean;
    allowUpload?: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete: (result: FaceCaptureResult) => void;
}

export function FaceCaptureDialog({
    open,
    title = 'التقاط الوجه',
    target = 1,
    wantDescriptors = true,
    requireDescriptor = false,
    allowUpload = true,
    onOpenChange,
    onComplete,
}: FaceCaptureDialogProps) {
    const max = Math.min(MAX_SAMPLES, Math.max(1, Number(target) || 1));
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const engineRef = useRef<FaceEngine | null>(null);
    const optionsRef = useRef<unknown>(null);
    const enginePromiseRef = useRef<Promise<FaceEngine | null> | null>(null);
    const imagesRef = useRef<string[]>([]);
    const descriptorsRef = useRef<number[][]>([]);
    const sourcesRef = useRef<Array<'live' | 'upload'>>([]);
    const cameraAttemptRef = useRef(0);
    const doneRef = useRef(false);
    const [message, setMessage] = useState('جارٍ تشغيل الكاميرا…');
    const [count, setCount] = useState(0);
    const [busy, setBusy] = useState(false);
    const [cameraFailed, setCameraFailed] = useState(false);

    const attachVideo = useCallback((video: HTMLVideoElement | null) => {
        videoRef.current = video;
        setVideoElement(video);
    }, []);

    const stopStream = useCallback(() => {
        try {
            streamRef.current?.getTracks().forEach((track) => {
                track.stop();
            });
        } catch {
            // مسار ميت أصلًا.
        }
        streamRef.current = null;
        if (videoRef.current) {
            try {
                videoRef.current.srcObject = null;
            } catch {
                // العنصر أُزيل.
            }
        }
    }, []);

    const finish = useCallback(() => {
        if (doneRef.current) {
            return;
        }
        doneRef.current = true;
        stopStream();
        onComplete({
            images: imagesRef.current.slice(),
            descriptors: descriptorsRef.current.slice(),
            sources: sourcesRef.current.slice(),
        });
    }, [onComplete, stopStream]);

    const addSample = useCallback(
        (image: string | null, descriptor: number[] | null, source: 'live' | 'upload'): boolean => {
            if (!image) {
                return false;
            }
            if (requireDescriptor && !descriptor) {
                setMessage('لم يُرصد وجه واضح — اقترب من الكاميرا وحسّن الإضاءة ثم أعد المحاولة');
                return false;
            }
            imagesRef.current.push(image);
            sourcesRef.current.push(source);
            if (descriptor) {
                descriptorsRef.current.push(descriptor);
            }
            setCount(imagesRef.current.length);
            return true;
        },
        [requireDescriptor],
    );

    useEffect(() => {
        if (!open || !videoElement) {
            return;
        }
        doneRef.current = false;
        imagesRef.current = [];
        descriptorsRef.current = [];
        sourcesRef.current = [];
        engineRef.current = null;
        optionsRef.current = null;
        enginePromiseRef.current = null;
        setCount(0);
        setBusy(false);
        setCameraFailed(false);
        setMessage('جارٍ تشغيل الكاميرا…');
        let cancelled = false;
        const cameraAttempt = ++cameraAttemptRef.current;

        const start = async () => {
            try {
                const stream = await openCameraStream(videoElement);
                if (cancelled || cameraAttempt !== cameraAttemptRef.current) {
                    stream.getTracks().forEach((track) => {
                        track.stop();
                    });
                    return;
                }
                streamRef.current = stream;
                setCameraFailed(false);
                setMessage(max > 1 ? `وجّه وجهك للكاميرا — سنلتقط ${max} لقطات متنوعة` : 'وجّه وجهك للكاميرا ثم اضغط «التقاط»');
            } catch (error) {
                if (!cancelled) {
                    const text = error instanceof Error ? error.message : 'تعذر تشغيل الكاميرا';
                    setCameraFailed(true);
                    setMessage(`${text} — يمكنك رفع صورة واضحة بدل الكاميرا.`);
                }
            }
            if (cancelled || !(wantDescriptors || requireDescriptor)) {
                return;
            }
            enginePromiseRef.current = withTimeout(loadFaceApi(), 12000)
                .then((engine) => {
                    if (cancelled) {
                        return null;
                    }
                    engineRef.current = engine;
                    optionsRef.current = new engine.TinyFaceDetectorOptions({
                        inputSize: 320,
                        scoreThreshold: 0.35,
                    });
                    if (streamRef.current) {
                        setMessage(max > 1 ? `محرك الوجه جاهز — سنلتقط ${max} لقطات` : '✅ محرك الوجه جاهز — اضغط «التقاط»');
                    }
                    return engine;
                })
                .catch(() => null);
        };

        void start();
        return () => {
            cancelled = true;
            cameraAttemptRef.current += 1;
            stopStream();
        };
    }, [open, videoElement, max, wantDescriptors, requireDescriptor, stopStream]);

    const retryCamera = async () => {
        const video = videoRef.current;
        if (!video || busy || doneRef.current) {
            return;
        }
        const cameraAttempt = ++cameraAttemptRef.current;
        stopStream();
        setCameraFailed(false);
        setMessage('جارٍ إعادة تشغيل الكاميرا…');
        try {
            const stream = await openCameraStream(video);
            if (cameraAttempt !== cameraAttemptRef.current || doneRef.current) {
                stream.getTracks().forEach((track) => {
                    track.stop();
                });
                return;
            }
            streamRef.current = stream;
            setMessage(max > 1 ? `وجّه وجهك للكاميرا — سنلتقط ${max} لقطات متنوعة` : 'وجّه وجهك للكاميرا ثم اضغط «التقاط»');
        } catch (error) {
            if (cameraAttempt === cameraAttemptRef.current && !doneRef.current) {
                const text = error instanceof Error ? error.message : 'تعذر تشغيل الكاميرا';
                setCameraFailed(true);
                setMessage(`${text} — يمكنك رفع صورة واضحة بدل الكاميرا.`);
            }
        }
    };

    const shoot = async () => {
        if (busy || doneRef.current) {
            return;
        }
        const video = videoRef.current;
        if (!video || !streamRef.current || !video.videoWidth) {
            setMessage('لا توجد كاميرا عاملة — استخدم «رفع صورة» بالأسفل');
            return;
        }
        setBusy(true);
        try {
            if (requireDescriptor && !engineRef.current && enginePromiseRef.current) {
                setMessage('جارٍ تجهيز محرك الوجه…');
                await enginePromiseRef.current;
            }
            if (requireDescriptor && !engineRef.current) {
                setMessage('تعذر تحميل محرك الوجه على هذا المتصفح — استخدم متصفحًا حديثًا (Chrome)');
                return;
            }
            const engine = engineRef.current;
            const detection = engine ? await detectFace(engine, optionsRef.current, video) : null;
            const image = detection ? cropFaceToJpeg(video, detection.detection.box) : cropCenterToJpeg(video);
            const descriptor = detection?.descriptor ? Array.from(detection.descriptor) : null;
            if (!addSample(image, descriptor, 'live')) {
                return;
            }
            if (imagesRef.current.length >= max) {
                finish();
                return;
            }
            setMessage(`تمت اللقطة ${imagesRef.current.length} من ${max} — حرّك رأسك قليلًا ثم التقط التالية`);
        } finally {
            setBusy(false);
        }
    };

    const pickFile = async (file: File | null) => {
        if (!file || doneRef.current) {
            return;
        }
        setBusy(true);
        try {
            const jpeg = await fileToJpegDataUrl(file);
            if (wantDescriptors && enginePromiseRef.current) {
                await enginePromiseRef.current;
            }
            let descriptor: number[] | null = null;
            const engine = engineRef.current;
            if (engine) {
                const image = await loadImage(jpeg);
                const detection = await detectFace(engine, optionsRef.current, image);
                descriptor = detection?.descriptor ? Array.from(detection.descriptor) : null;
            }
            if (!addSample(jpeg, descriptor, 'upload')) {
                return;
            }
            finish();
        } catch (error) {
            setMessage(error instanceof Error ? error.message : 'تعذر قراءة الصورة');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange} title={title} size="md" closeLabel="إغلاق الكاميرا">
            <div className="flex flex-col items-stretch gap-sm">
                <video
                    ref={attachVideo}
                    className="aspect-video w-full rounded-lg bg-black object-cover"
                    autoPlay
                    playsInline
                    muted
                    aria-label="كاميرا الوجه"
                />
                <p className="text-body-sm text-muted" role="status" aria-live="polite">
                    {message}
                </p>
                <progress className="w-full" max={max} value={count} hidden={max <= 1} aria-label="لقطات الوجه" />
                <div className="flex flex-wrap items-center gap-sm">
                    <Button variant="primary" loading={busy} onClick={() => void shoot()}>
                        التقاط
                    </Button>
                    {cameraFailed ? (
                        <Button variant="secondary" disabled={busy} onClick={() => void retryCamera()}>
                            إعادة تشغيل الكاميرا
                        </Button>
                    ) : null}
                    {allowUpload ? (
                        <label className="erp-button inline-flex h-9.5 cursor-pointer items-center justify-center rounded-md border border-hairline-strong bg-surface px-md font-semibold text-button-md text-ink shadow-card hover:bg-surface-hover">
                            رفع صورة
                            <input
                                type="file"
                                accept="image/*"
                                capture="user"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0] ?? null;
                                    event.target.value = '';
                                    void pickFile(file);
                                }}
                            />
                        </label>
                    ) : null}
                </div>
                <p className="text-body-xs text-muted">الصور لا تُخزَّن على الخادم — تُستخدم لحظيًا لاستخراج البصمة ثم تُهمل.</p>
            </div>
        </Dialog>
    );
}
