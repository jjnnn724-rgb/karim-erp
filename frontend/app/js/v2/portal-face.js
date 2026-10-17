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

const FACE_API_SRC = 'vendor/face-api.js?v=4.9.77';
const FACE_MODELS_URI = 'vendor/face-models';
const CAMERA_TRIES = [
    { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
];
const MAX_SAMPLES = 8;

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

/** @returns {Promise<MediaStream>} */
async function openCameraStream(video) {
    if (!isSecureCameraContext()) {
        throw new Error('الكاميرا تحتاج اتصالًا آمنًا (HTTPS) — افتح النظام عبر https، أو ارفع صورة بالأسفل');
    }
    const media = globalThis.navigator && globalThis.navigator.mediaDevices;
    if (!media || typeof media.getUserMedia !== 'function') {
        throw new Error('المتصفح لا يدعم الكاميرا — استخدم «رفع صورة» بالأسفل');
    }
    let lastErr = null;
    for (const constraints of CAMERA_TRIES) {
        try {
            const stream = await media.getUserMedia(constraints);
            video.srcObject = stream;
            await video.play().catch(() => {});
            return stream;
        } catch (e) { lastErr = e; }
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
 * @param {{title?: string, target?: number, wantDescriptors?: boolean, requireDescriptor?: boolean}} [opts]
 * @returns {Promise<{images: string[], descriptors: number[][]}>}
 */
export function captureFace(opts = {}) {
    const max = Math.min(MAX_SAMPLES, Math.max(1, Number(opts.target) || 1));
    const wantDescriptors = opts.wantDescriptors !== false;
    const requireDescriptor = opts.requireDescriptor === true;
    const title = String(opts.title || 'التقاط الوجه');

    return new Promise((resolve, reject) => {
        const host = document.createElement('div');
        host.className = 'erp-v2 erp-face-cam';
        host.setAttribute('role', 'dialog');
        host.setAttribute('aria-modal', 'true');
        host.setAttribute('aria-label', title);
        host.innerHTML = `
          <div class="erp-face-cam__panel">
            <div class="erp-face-cam__head">
              <h3 class="erp-face-cam__title" data-face-title></h3>
              <button type="button" class="erp-btn erp-btn--sm" data-face-cancel aria-label="إغلاق">✕</button>
            </div>
            <video class="erp-face-cam__video" data-face-video autoplay playsinline muted></video>
            <p class="erp-face-cam__msg erp-text-sm" data-face-msg role="status" aria-live="polite">جارٍ تشغيل الكاميرا…</p>
            <progress class="erp-face-cam__progress" data-face-progress max="${max}" value="0" hidden></progress>
            <div class="erp-face-cam__actions">
              <button type="button" class="erp-btn erp-btn--primary" data-face-shoot>التقاط</button>
              <label class="erp-btn erp-btn--sm erp-face-cam__upload">رفع صورة
                <input type="file" accept="image/*" capture="user" data-face-upload hidden>
              </label>
              <button type="button" class="erp-btn erp-btn--sm" data-face-cancel>إلغاء</button>
            </div>
            <p class="erp-text-xs erp-text-muted erp-face-cam__hint">الصور لا تُخزَّن على الخادم — تُستخدم لحظيًا لاستخراج البصمة ثم تُهمل.</p>
          </div>`;
        document.body.appendChild(host);

        const q = (sel) => host.querySelector(sel);
        const titleEl = q('[data-face-title]');
        if (titleEl) { titleEl.textContent = title; }
        const video = q('[data-face-video]');
        const msg = q('[data-face-msg]');
        const progress = q('[data-face-progress]');
        const shoot = q('[data-face-shoot]');
        const upload = q('[data-face-upload]');
        const images = [];
        const descriptors = [];

        let stream = null;
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
        const cleanup = () => {
            if (disposed) { return; }
            disposed = true;
            stopStream();
            document.removeEventListener('keydown', onKey);
            host.remove();
        };
        const finish = () => {
            cleanup();
            resolve({ images: images.slice(), descriptors: descriptors.slice() });
        };
        const fail = (error) => {
            cleanup();
            reject(error instanceof Error ? error : new Error(String(error || 'تعذر إكمال الالتقاط')));
        };
        const cancel = () => fail(new Error('FACE_CANCELLED'));

        function onKey(event) {
            if (event.key === 'Escape') { cancel(); }
        }
        document.addEventListener('keydown', onKey);
        host.querySelectorAll('[data-face-cancel]').forEach((btn) => {
            btn.addEventListener('click', cancel);
        });

        function addSample(image, descriptor) {
            if (!image) { return false; }
            if (requireDescriptor && !descriptor) {
                say('لم يُرصد وجه واضح — اقترب من الكاميرا وحسّن الإضاءة ثم أعد المحاولة');
                return false;
            }
            images.push(image);
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
                if (!addSample(image, descriptor)) { return; }
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
                if (!addSample(jpeg, descriptor)) { return; }
                cleanup();
                resolve({ images: images.slice(), descriptors: descriptors.slice() });
            } catch (e) {
                say((e && e.message) || 'تعذر قراءة الصورة');
            } finally {
                event.target.value = '';
            }
        }

        if (upload) { upload.addEventListener('change', onUpload); }

        (async () => {
            try {
                stream = await openCameraStream(video);
                say(max > 1
                    ? `وجّه وجهك للكاميرا — سنلتقط ${max} لقطات متنوعة`
                    : 'وجّه وجهك للكاميرا ثم اضغط «التقاط»');
            } catch (camErr) {
                say(`${camErr.message} — يمكنك رفع صورة واضحة بدل الكاميرا.`);
            }
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
