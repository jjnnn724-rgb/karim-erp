/**
 * V2 — كاميرا البصمة الذاتية (P2-3)
 * ═══════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *   القديم (features/mobile-shell.js:350-555) يملك كاميرا كاملة: كشف وجه
 *   محلي، قصّ، رفع صورة احتياطي، وجمع 5 عينات للتسجيل. البوابة في V2 كانت
 *   قراءة فقط، وأبواب punch/face/enroll تحتاج هذه اللقطات. المنطق هنا مستقل
 *   عن الشاشة حتى تبقى الشاشة عرضًا وربطًا، وحتى يُختبر المصدر وحده.
 *
 * CONTRACT
 *   • لا شبكة هنا إطلاقًا: الكاميرا والكشف محليان، والإرسال في portal-repo.
 *   • face-api محلي من `vendor/` (نفس ملف القديم) — لا CDN: CSP `script-src
 *     'self'` يمنع البعيد، وV2 لا تضيف أصلًا خارجيًا لأجل ميزة.
 *   • لقطة v2 وحدها تكفي لمحرك ArcFace على الخادم. محرك v1 (128-d) يحتاج
 *     descriptor من face-api؛ لذلك `requireDescriptor` يمنع إرسال لقطة ناقصة
 *     بدل أن يرفضها الخادم بغموض.
 *   • لا صور تُخزَّن: اللقطات تُمرَّر للمستودع ثم للخادم الذي يستهلكها ويُهملها.
 *   • كل مستمع حدث عبر addEventListener، والتنظيف يوقف المسار ويُزيل العقدة —
 *     لا كاميرا تعمل بعد الإغلاق.
 */

import { trapFocus } from './focus-trap.js?v=4.9.412';

const FACE_API_SRC = 'vendor/face-api.js?v=4.9.77';
const FACE_MODELS_URI = 'vendor/face-models';
const MAX_SAMPLES = 8;
const FACING_STORAGE_KEY = 'karim.faceCapture.facingMode'; // نفس مفتاح V3 — الاختيار ينتقل بين الواجهتين

/** الافتراضي 2026-11-18: «الخلفية» — المالك أبلغ أن الخلفية هي الشغالة على أجهزة المطعم */
function getPreferredFacing() {
    try {
        const saved = globalThis.localStorage && globalThis.localStorage.getItem(FACING_STORAGE_KEY);
        return saved === 'user' ? 'user' : 'environment';
    } catch (_) { return 'environment'; }
}
function persistFacing(facing) {
    try { globalThis.localStorage && globalThis.localStorage.setItem(FACING_STORAGE_KEY, facing); } catch (_) { /* وضع خاص */ }
}
function otherFacing(facing) { return facing === 'user' ? 'environment' : 'user'; }
function facingLabel(facing) { return facing === 'user' ? 'الأمامية' : 'الخلفية'; }
/** المفضلة بمقاسين، ثم الأخرى كاحتياطي، ثم أي كاميرا */
function cameraTries(preferred) {
    const other = otherFacing(preferred);
    return [
        { constraints: { video: { facingMode: preferred, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }, facing: preferred },
        { constraints: { video: { facingMode: preferred, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }, facing: preferred },
        { constraints: { video: { facingMode: other, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }, facing: other },
        { constraints: { video: { facingMode: other, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }, facing: other },
        { constraints: { video: true, audio: false }, facing: null },
    ];
}

let _faceApiPromise = null;

function faceApiLoaded() {
    return typeof globalThis !== 'undefined' && Boolean(globalThis.faceapi);
}

/**
 * يحمّل face-api المحلي مرة واحدة. لا يرمي للـcaller إن كان الكشف اختياريًا.
 * @returns {Promise<any>}
 */
export function loadFaceApi() {
    if (faceApiLoaded()) { return Promise.resolve(globalThis.faceapi); }
    if (_faceApiPromise) { return _faceApiPromise; }
    _faceApiPromise = new Promise((resolve, reject) => {
        const ready = async () => {
            try {
                const api = globalThis.faceapi;
                if (!api) { throw new Error('محرك الوجه غير متاح'); }
                await api.tf.setBackend('webgl').catch(() => api.tf.setBackend('cpu'));
                await api.tf.ready();
                await Promise.all([
                    api.nets.tinyFaceDetector.loadFromUri(FACE_MODELS_URI),
                    api.nets.faceLandmark68Net.loadFromUri(FACE_MODELS_URI),
                    api.nets.faceRecognitionNet.loadFromUri(FACE_MODELS_URI),
                ]);
                resolve(api);
            } catch (e) { reject(e); }
        };
        const script = document.createElement('script');
        script.src = FACE_API_SRC;
        script.async = true;
        script.onload = ready;
        script.onerror = () => reject(new Error('تعذر تحميل محرك التعرف على الوجه'));
        document.head.appendChild(script);
    }).catch((e) => {
        _faceApiPromise = null;
        throw e;
    });
    return _faceApiPromise;
}

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
}

function isSecureCameraContext() {
    if (globalThis.isSecureContext) { return true; }
    const host = globalThis.location && globalThis.location.hostname;
    return host === 'localhost' || host === '127.0.0.1';
}

/** @returns {Promise<{stream: MediaStream, facing: 'user'|'environment'|null}>} */
async function openCameraStream(video, preferred = 'environment') {
    if (!isSecureCameraContext()) {
        throw new Error('الكاميرا تحتاج اتصالًا آمنًا (HTTPS) — افتح النظام عبر https، أو ارفع صورة بالأسفل');
    }
    const media = globalThis.navigator && globalThis.navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
        throw new Error('المتصفح لا يدعم الكاميرا — استخدم «رفع صورة» بالأسفل');
    }
    let lastErr = null;
    let opened = null;
    for (const attempt of cameraTries(preferred)) {
        try {
            const stream = await media.getUserMedia(attempt.constraints);
            opened = { stream, facing: attempt.facing };
            break;
        } catch (e) { lastErr = e; }
    }
    if (opened) {
        video.srcObject = opened.stream;
        await video.play().catch(() => {});
        return opened;
    }
    const name = (lastErr && lastErr.name) || '';
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
export function cropFaceToJpeg(video, box) {
    try {
        const vw = video.videoWidth || video.clientWidth || 640;
        const vh = video.videoHeight || video.clientHeight || 480;
        const margin = Math.max(box.width, box.height) * 0.28;
        const sx = Math.max(0, box.x - margin);
        const sy = Math.max(0, box.y - margin);
        const sw = Math.min(vw - sx, box.width + margin * 2);
        const sh = Math.min(vh - sy, box.height + margin * 2);
        if (sw < 20 || sh < 20) { return null; }
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        canvas.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, 160, 160);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch (_) { return null; }
}

/** قصّ مركزي احتياطي (بلا كشف) — UltraFace على الخادم يتحقق من الوجه. */
export function cropCenterToJpeg(video) {
    try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const side = Math.min(vw, vh) * 0.8;
        const sx = (vw - side) / 2;
        const sy = (vh - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        canvas.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, 160, 160);
        return canvas.toDataURL('image/jpeg', 0.85);
    } catch (_) { return null; }
}

/** لقطة ملف صورة إلى JPEG (بحد 480) — للكاميرا المحجوبة أو الجهاز بلا كاميرا. */
export function fileToJpegDataUrl(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            try {
                const side = Math.max(img.width, img.height);
                const scale = Math.min(1, 480 / side);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
        img.src = url;
    });
}

/** @param {string} src @returns {Promise<HTMLImageElement>} */
function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('تعذر قراءة الصورة'));
        img.src = src;
    });
}

async function detectFace(fapi, options, source) {
    try {
        const det = await fapi
            .detectSingleFace(source, options)
            .withFaceLandmarks()
            .withFaceDescriptor();
        return det || null;
    } catch (_) { return null; }
}

/**
 * يفتح كاميرا الوجه ويجمع لقطة (بصمة) أو حتى 5 عينات (تسجيل).
 * `allowUpload:false` يخفي «رفع صورة» — وضع البصمة الصارم لا يقبل صورة من المعرض.
 * @param {{title?: string, target?: number, wantDescriptors?: boolean, requireDescriptor?: boolean,
 *          allowUpload?: boolean}} [opts]
 * @returns {Promise<{images: string[], descriptors: number[][], sources: Array<'live'|'upload'>}>}
 */
export function captureFace(opts = {}) {
    const max = Math.min(MAX_SAMPLES, Math.max(1, Number(opts.target) || 1));
    const wantDescriptors = opts.wantDescriptors !== false;
    const requireDescriptor = opts.requireDescriptor === true;
    const allowUpload = opts.allowUpload !== false;
    const title = String(opts.title || 'التقاط الوجه');

    return new Promise((resolve, reject) => {
        const host = document.createElement('div');
        /* مَن فتح الكاميرا يعود إليه التركيز عند الإغلاق، والتركيز يدخل الحوار
           ويُحبس فيه: هو يعلن aria-modal، والكاميرا تفتح فوق الصفحة كلها. */
        const opener = document.activeElement;
        host.className = 'erp-v2 erp-face-cam';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-label', title);
        host.tabIndex = -1;
        host.innerHTML = `
          <div class="erp-face-cam__panel">
            <div class="erp-face-cam__head">
              <h3 class="erp-face-cam__title" data-face-title></h3>
              <button type="button" class="erp-icon-btn erp-modal-x" data-face-cancel aria-label="إغلاق الكاميرا" title="إغلاق">
                <i class="ji" data-i="x" aria-hidden="true"></i></button>
            </div>
            <video class="erp-face-cam__video" data-face-video autoplay playsinline muted></video>
            <p class="erp-face-cam__msg erp-text-sm" data-face-msg role="status" aria-live="polite">جارٍ تشغيل الكاميرا…</p>
            <progress class="erp-face-cam__progress" data-face-progress max="${max}" value="0" hidden></progress>
            <div class="erp-face-cam__actions">
              <button type="button" class="erp-btn erp-btn--sm" data-face-switch-cam
                      title="اضغط للتبديل بين الكاميرا الأمامية والخلفية">🔄 الكاميرا: الخلفية</button>
              <button type="button" class="erp-btn erp-btn--primary" data-face-shoot>التقاط</button>
              ${allowUpload ? `<label class="erp-btn erp-btn--sm erp-face-cam__upload">رفع صورة
                <input type="file" accept="image/*" capture="environment" data-face-upload hidden>
              </label>` : ''}
            </div>
            <p class="erp-text-xs erp-text-muted erp-face-cam__hint">الصور لا تُخزَّن على الخادم — تُستخدم لحظيًا لاستخراج البصمة ثم تُهمل.</p>
          </div>`;
        document.body.appendChild(host);
        const releaseTrap = trapFocus(host);
        host.focus();

        const q = (sel) => host.querySelector(sel);
        const titleEl = q('[data-face-title]');
        if (titleEl) { titleEl.textContent = title; }
        const video = q('[data-face-video]');
        const msg = q('[data-face-msg]');
        const progress = q('[data-face-progress]');
        const shoot = q('[data-face-shoot]');
        const upload = q('[data-face-upload]');
        const switchCam = q('[data-face-switch-cam]');
        const images = [];
        const descriptors = [];
        /** أصل كل لقطة: 'live' من الكاميرا أو 'upload' من الملف — السيرفر يرفض المرفوعة في الوضع الصارم */
        const sources = [];

        let stream = null;
        let facing = getPreferredFacing();
        /** الاتجاه الذي فُتحت فعليًا (قد يختلف عن facing عند الاحتياطي) — للمرآة وعنوان الزر */
        let openedFacing = null;
        let disposed = false;
        let busy = false;
        let fapi = null;
        let detectorOptions = null;
        let enginePromise = null;

        const say = (text) => { if (msg) { msg.textContent = text; } };
        const paintProgress = () => {
            if (!progress) { return; }
            progress.hidden = max <= 1;
            progress.value = images.length;
        };
        const stopStream = () => {
            try { stream?.getTracks().forEach((track) => track.stop()); } catch (_) { /* متجاهَل عمدًا */ }
            stream = null;
            try { if (video) { video.srcObject = null; } } catch (_) { /* متجاهَل عمدًا */ }
        };
        /** مرآة العرض: أمامية فقط — الخلفية تُعرض كما هي. ويحدّث زر التبديل ورفع الصورة. */
        const applyFacingUI = () => {
            const effective = openedFacing || facing;
            if (video) { video.classList.toggle('erp-face-cam__video--no-mirror', effective !== 'user'); }
            if (switchCam) {
                switchCam.textContent = `🔄 الكاميرا: ${facingLabel(effective)}`;
                switchCam.setAttribute('aria-label', `الكاميرا ${facingLabel(effective)} — اضغط للتبديل إلى ${facingLabel(otherFacing(facing))}`);
            }
            if (upload) { upload.setAttribute('capture', facing); }
        };
        /** فتح/إعادة فتح الكاميرا بالاتجاه المختار — لقطات سابقة تبقى كما هي */
        const startCamera = async () => {
            stopStream();
            try {
                const opened = await openCameraStream(video, facing);
                stream = opened.stream;
                openedFacing = opened.facing;
                applyFacingUI();
                const intro = max > 1
                    ? `وجّه وجهك للكاميرا — سنلتقط ${max} لقطات متنوعة`
                    : 'وجّه وجهك للكاميرا ثم اضغط «التقاط»';
                say(opened.facing && opened.facing !== facing
                    ? `تعذرت الكاميرا ${facingLabel(facing)} — فُتحت ${facingLabel(opened.facing)} بدلًا منها. ${intro}`
                    : intro);
                return true;
            } catch (camErr) {
                applyFacingUI();
                say(`${camErr.message} — يمكنك رفع صورة واضحة بدل الكاميرا.`);
                return false;
            }
        };
        const cleanup = () => {
            if (disposed) { return; }
            disposed = true;
            stopStream();
            releaseTrap();
            host.remove();
            if (opener && typeof opener.focus === 'function' && opener.isConnected) {
                try { opener.focus(); } catch (_) { /* أُزيل العنصر */ }
            }
        };
        const finish = () => {
            cleanup();
            resolve({ images: images.slice(), descriptors: descriptors.slice(), sources: sources.slice() });
        };
        const fail = (error) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error || 'تعذر إكمال الالتقاط')));
        };
        const cancel = () => fail(new Error('FACE_CANCELLED'));

        /* الإغلاق من X أعلى النافذة وحده — لا Escape ولا زر إلغاء ثانٍ:
           الكاميرا تبقى حتى يقرر المستخدم الإغلاق صراحةً. */
        host.querySelectorAll('[data-face-cancel]').forEach((btn) => {
            btn.addEventListener('click', cancel);
        });

        function addSample(image, descriptor, source) {
            if (!image) { return false; }
            // لقطة مطابقة بايتيًا لعيّنة سابقة ليست «صورة جديدة»: السيرفر يرفض البصمة
            // كلها PUNCH_FACE_REPLAY. نمنعها هنا — خبرة المستخدم: حرّك رأسك قليلًا.
            if (images.includes(image)) {
                say('التقطت نفس الصورة — حرّك رأسك قليلًا ثم التقط اللقطة التالية');
                return false;
            }
            if (requireDescriptor && !descriptor) {
                say('لم يُرصد وجه واضح — اقترب من الكاميرا وحسّن الإضاءة ثم أعد المحاولة');
                return false;
            }
            images.push(image);
            sources.push(source === 'upload' ? 'upload' : 'live');
            if (descriptor) { descriptors.push(descriptor); }
            paintProgress();
            return true;
        }

        async function onShoot() {
            if (disposed || busy) { return; }
            if (!stream || !video || !video.videoWidth) {
                say('لا توجد كاميرا عاملة — استخدم «رفع صورة» بالأسفل');
                return;
            }
            busy = true;
            if (shoot) { shoot.disabled = true; }
            try {
                if (requireDescriptor && !fapi && enginePromise) {
                    say('جارٍ تجهيز محرك الوجه…');
                    await enginePromise;
                }
                if (requireDescriptor && !fapi) {
                    say('تعذر تحميل محرك الوجه على هذا المتصفح — استخدم متصفحًا حديثًا (Chrome)');
                    return;
                }
                const det = fapi && detectorOptions ? await detectFace(fapi, detectorOptions, video) : null;
                const image = det
                    ? cropFaceToJpeg(video, det.detection.box)
                    : cropCenterToJpeg(video);
                const descriptor = det && det.descriptor ? Array.from(det.descriptor) : null;
                if (!addSample(image, descriptor, 'live')) { return; }
                if (images.length >= max) { finish(); return; }
                say(`تمت اللقطة ${images.length} من ${max} — حرّك رأسك قليلًا ثم التقط التالية`);
            } finally {
                busy = false;
                if (!disposed && shoot) { shoot.disabled = false; }
            }
        }

        if (shoot) { shoot.addEventListener('click', onShoot); }

        async function onUpload(event) {
            const file = event.target.files?.[0];
            if (!file || disposed) { return; }
            try {
                const jpeg = await fileToJpegDataUrl(file);
                let descriptor = null;
                if (wantDescriptors && enginePromise) {
                    try { await enginePromise; } catch (_) { /* اللقطة وحدها قد تكفي v2 */ }
                }
                if (fapi && detectorOptions) {
                    const img = await loadImage(jpeg);
                    const det = await detectFace(fapi, detectorOptions, img);
                    descriptor = det && det.descriptor ? Array.from(det.descriptor) : null;
                }
                if (disposed) { return; }
                if (!addSample(jpeg, descriptor, 'upload')) { return; }
                cleanup();
                resolve({ images: images.slice(), descriptors: descriptors.slice(), sources: sources.slice() });
            } catch (e) {
                say((e && e.message) || 'تعذر قراءة الصورة');
            } finally {
                event.target.value = '';
            }
        }

        if (upload) { upload.addEventListener('change', onUpload); }

        if (switchCam) {
            switchCam.addEventListener('click', async () => {
                if (disposed || busy) { return; }
                facing = otherFacing(facing);
                openedFacing = null;
                persistFacing(facing);
                say('جارٍ تبديل الكاميرا…');
                await startCamera();
            });
        }
        applyFacingUI();

        (async () => {
            await startCamera();
            if (disposed || !(wantDescriptors || requireDescriptor)) { return; }
            enginePromise = withTimeout(loadFaceApi(), 12000)
                .then((api) => {
                    fapi = api;
                    detectorOptions = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 });
                    if (!disposed && stream) { say(max > 1 ? `محرك الوجه جاهز — سنلتقط ${max} لقطات` : '✅ محرك الوجه جاهز — اضغط «التقاط»'); }
                    return api;
                })
                .catch(() => null);
        })();
    });
}
