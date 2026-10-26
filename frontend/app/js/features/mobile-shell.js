/**
 * features/mobile-shell.js — هيكل الجوال: شريط تنقل سفلي + بطاقة البصمة الذاتية
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md (FR-M1..M6, S4–S6)
 * الخطة: docs/PLAN-safe-rollout-playbook-v1.md
 *
 * Bridge policy: bridged by main.js (BRIDGE-029) — مثل بقية الوحدات.
 *
 * قواعد السلامة:
 *   • التفعيل مشروط: (شاشة ≤ 900px) + دور ضمن أدوار الموظفين + MOBILE_UI_V2 ≠ false
 *   • المكتب (شاشة كبيرة) لا يتأثر إطلاقًا — body.mobile-shell-on لا يُضاف
 *   • زر البصمة يظهر فقط عندما يرجع السيرفر enabled=true من status endpoint
 *     (نفس المفتاح المركزي PUNCH_PORTAL_ENABLED — قرار إداري بنقرة)
 *   • الجيولوكيشن يُقرأ لحظة الضغط فقط — لا تتبع خلفي (خصوصية §5.5)
 */

const MOBILE_SHELL_ROLES = ['employee', 'cashier', 'kitchen', 'sous_chef', 'warehouse', 'dept_head', 'admin', 'manager', 'hr', 'accountant', 'owner'];
// أدوار الميدان: شاشتهم الأولى بوابة الموظف (البصمة) — أدوار الإدارة: لوحتهم التشغيلية
const FIELD_ROLES = ['employee', 'cashier', 'kitchen', 'sous_chef', 'warehouse', 'dept_head'];
const BACKOFFICE_NAV_CANDIDATES = [
    ['cfo', 'المالية', 'banknote'],
    ['employees', 'الموظفون', 'users'],
    ['attendance', 'الحضور', 'clock'],
    ['reports', 'التقارير', 'chart'],
];
const MOBILE_BP = '(max-width: 900px)';

let _punchStatus = null;       // كاش حالة البوابة من السيرفر
let _punchBusy = false;        // قفل منع النقر المزدوج أثناء الطلب
let _lastPunchResult = null;   // آخر نتيجة بصمة {cls:'ok'|'err', text} — تنجو من إعادة الرندر

// ─── أدوات ───────────────────────────────────────────────────────────────────

function shellActive() {
    const role = window.STATE?.currentUser?.role;
    if (!role || !MOBILE_SHELL_ROLES.includes(role)) {return false;}
    if (window.MOBILE_UI_V2 === false) {return false;} // مفتاح الواجهة (من السيرفر)
    return window.matchMedia(MOBILE_BP).matches;
}

/** معرّف جهاز مستقر (L4 ربط الجهاز) — يولد مرة واحدة ويُحفظ محليًا */
function mobileDeviceId() {
    let id = null;
    try { id = localStorage.getItem('punch_device_id'); } catch (_) {}
    if (!id) {
        id = (window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : 'dev-' + Date.now() + '-' + Math.floor(Math.random() * 1e9));
        try { localStorage.setItem('punch_device_id', id); } catch (_) {}
    }
    return id;
}

// ─── شريط التنقل السفلي (FR-M1) ──────────────────────────────────────────────

/** مرشّحات الشريط: تُفلتر حسب قوائم الدور المسموحة (نفس صلاحيات go()) */
function mobileNavItems() {
    const role = window.STATE?.currentUser?.role;
    const menus = window.ROLES?.[role]?.menus || [];
    const items = [];
    const isField = FIELD_ROLES.includes(role);
    const home = isField
        ? (menus.includes('employee-portal') ? 'employee-portal' : menus[0])
        : (menus.includes('dashboard') ? 'dashboard' : menus[0]);
    if (home) {items.push({ page: home, label: 'الرئيسية', icon: 'home', key: 'home' });}
    if (isField && menus.includes('employee-portal')) {
        items.push({ page: 'employee-portal', label: 'بصمتي', icon: 'clock', key: 'punch', punch: true });
    }
    const candidates = isField
        ? [['payroll', 'رواتبي', 'wallet'], ['leaves', 'طلبي', 'calendar'], ['dashboard', 'لوحتي', 'chart']]
        : BACKOFFICE_NAV_CANDIDATES;
    for (const cand of candidates) {
        if (menus.includes(cand[0]) && cand[0] !== home) {
            items.push({ page: cand[0], label: cand[1], icon: cand[2], key: cand[0] });
        }
        if (items.length >= 4) {break;}
    }
    items.push({ page: '__more', label: 'المزيد', icon: 'menu', key: '__more' });
    return items;
}

function renderMobileNav() {
    if (!shellActive()) {
        document.body.classList.remove('mobile-shell-on');
        const nav = document.getElementById('mobileNav');
        if (nav) {nav.remove();}
        return;
    }
    document.body.classList.add('mobile-shell-on');
    let nav = document.getElementById('mobileNav');
    if (!nav) {
        nav = document.createElement('nav');
        nav.id = 'mobileNav';
        nav.className = 'mobile-nav';
        document.body.appendChild(nav);
    }
    const current = window.STATE?.page;
    let activeUsed = false;
    nav.innerHTML = mobileNavItems().map((it) => {
        // عنصر نشط واحد فقط — الصفحات المتعددة العناصر (بوابة/بصمتي) تُبرز أولها
        const active = it.page === current && !activeUsed ? (activeUsed = true, ' active') : '';
        return `<button type="button" class="mnav-item${active}" data-mpage="${it.page}" data-mkey="${it.key}"
                    aria-label="${it.label}"><i class="ji" data-i="${it.icon}"></i><span>${it.label}</span></button>`;
    }).join('');
    nav.querySelectorAll('.mnav-item').forEach((b) => {
        b.addEventListener('click', () => mobileNavClick(b));
    });
}

function mobileNavClick(el) {
    const page = el.dataset.mpage;
    if (page === '__more') {
        if (typeof window.toggleSidebar === 'function') {window.toggleSidebar();}
        return;
    }
    if (typeof window.go === 'function') {window.go(page, el);}
    if (el.dataset.mkey === 'punch') {
        setTimeout(() => {
            const card = document.getElementById('punchCard');
            if (card) {card.scrollIntoView({ behavior: 'smooth', block: 'start' });}
        }, 250);
    }
}

// ─── بطاقة البصمة الذاتية (S5) ───────────────────────────────────────────────

async function refreshPunchStatus() {
    try {
        const s = await window.apiFetch('/attendance/portal/status');
        _punchStatus = s || {};
        if (typeof s.mobileV2 === 'boolean') {window.MOBILE_UI_V2 = s.mobileV2;}
    } catch (_) {
        _punchStatus = _punchStatus || { enabled: false, hasEmployeeProfile: false };
    }
    return _punchStatus;
}

function punchCardInnerHTML() {
    const s = _punchStatus || {};
    const enabled = Boolean(s.enabled) && Boolean(s.hasEmployeeProfile);
    const chip = enabled
        ? '<span class="punch-status-chip enabled">● البصمة الذاتية مفعّلة</span>'
        : '<span class="punch-status-chip disabled">● البصمة الذاتية غير متاحة حاليًا</span>';
    const btn = enabled
        ? `<button type="button" id="punchBtn" class="punch-btn">
             <i class="ji" data-i="clock"></i> تسجيل البصمة الآن
           </button>
           <div class="punch-meta">سيُثبّت وقت بصمتك من ساعة السيرفر — يلزم السماح بالموقع</div>
           <div id="punchResult" class="punch-result ${_lastPunchResult ? _lastPunchResult.cls : ''}">${_lastPunchResult ? _lastPunchResult.text : ''}</div>`
        : `<button type="button" id="punchBtn" class="punch-btn punch-btn-off" disabled>
             البصمة الذاتية غير مفعّلة بعد
           </button>
           <div class="punch-meta">${s.hasEmployeeProfile === false
               ? 'لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية'
               : 'سيُعلن عن تفعيلها من الإدارة'}</div>`;
    return `${chip}${btn}`;
}

function punchCardHTML() {
    return `<div class="punch-card" id="punchCard">${punchCardInnerHTML()}</div>`;
}

/**
 * يجلب حالة البوابة الحية ويحدّث البطاقة القائمة — الرندر الأول قد يسبق وصول
 * الحالة من السيرفر فتظهر البطاقة معطّلة رغم تفعيل الإدارة لها. آخر نتيجة
 * بصمة محفوظة في _lastPunchResult فتنجو من إعادة الرندر تلقائيًا.
 */
async function syncPunchCardState() {
    const card = document.getElementById('punchCard');
    if (!card) {return;}
    await refreshPunchStatus().catch(() => {});
    const live = document.getElementById('punchCard');
    if (!live) {return;}
    live.innerHTML = punchCardInnerHTML();
    const btn = document.getElementById('punchBtn');
    if (btn && !btn.disabled) {btn.addEventListener('click', mobileDoPunch);}
}

/** يُحقن بعد اكتمال رندر صفحة البوابة (يغلف window.renderPage) */
function injectPunchCard() {
    if (!shellActive() || window.STATE?.page !== 'employee-portal') {return;}
    const content = document.getElementById('content');
    if (!content || document.getElementById('punchCard')) {return;}
    content.insertAdjacentHTML('afterbegin', punchCardHTML());
    const btn = document.getElementById('punchBtn');
    if (btn && !btn.disabled) {btn.addEventListener('click', mobileDoPunch);}
    void syncPunchCardState();
}

// ─── بصمة الوجه (L5): كاميرا قوية + كشف مفتوح المصدر ────────────────────────
// UPGRADE 2026-10-01 — إصلاح «الكاميرا لا تعمل»:
//   1) MediaPipe Tasks-Vision FaceDetector (BlazeFace short-range — Apache-2.0، Google)
//      خفيف (~300KB wasm) ويعمل على CPU/الجوال بلا WebGL ثقيل — بديل face-api القديم.
//   2) face-api (TinyFaceDetector) يبقى كاحتياطي ثانٍ.
//   3) التقاط يدوي/رفع صورة كاحتياطي أخير — السيرفر (UltraFace + ArcFace R100)
//      يتحقق من الوجه ويستخرج البصمة، فلا يتعطل الموظف أبدًا.
//   4) معالجة أخطاء getUserMedia بالعربية (HTTPS/إذن/لا كاميرا) + قيود متدرجة.

let _faceApiPromise = null;
function loadFaceApiLib() {
    if (window.faceapi) {return Promise.resolve(window.faceapi);}
    if (_faceApiPromise) {return _faceApiPromise;}
    _faceApiPromise = new Promise((resolve, reject) => {
        const sc = document.createElement('script');
        sc.src = '/app/vendor/face-api.js';
        sc.onload = async () => {
            try {
                const fapi = window.faceapi;
                await fapi.tf.setBackend('webgl').catch(() => fapi.tf.setBackend('cpu'));
                await fapi.tf.ready();
                const uri = '/app/vendor/face-models';
                await Promise.all([
                    fapi.nets.tinyFaceDetector.loadFromUri(uri),
                    fapi.nets.faceLandmark68Net.loadFromUri(uri),
                    fapi.nets.faceRecognitionNet.loadFromUri(uri),
                ]);
                resolve(fapi);
            } catch (e) { reject(e); }
        };
        sc.onerror = () => reject(new Error('تعذر تحميل مكتبة التعرف على الوجه'));
        document.head.appendChild(sc);
    });
    return _faceApiPromise;
}

// ─── المحرك الأساسي: MediaPipe BlazeFace (مفتوح المصدر Apache-2.0) ───────────
let _mpDetectorPromise = null;
async function loadBlazeFaceDetector() {
    if (_mpDetectorPromise) {return _mpDetectorPromise;}
    _mpDetectorPromise = (async () => {
        // dynamic import — لا يكسر التشغيل دون إنترنت (يسقط للاحتياطي)
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm');
        const { FaceDetector, FilesetResolver } = vision;
        const fileset = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        // النموذج محليًا أولًا (يعمل دون إنترنت بعد أول تثبيت) ثم CDN
        const localModel = '/app/vendor/blaze_face_short_range.tflite';
        const cdnModel = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
        let modelUrl = cdnModel;
        try {
            const probe = await fetch(localModel, { method: 'HEAD' });
            if (probe.ok) {modelUrl = localModel;}
        } catch (_) {}
        const detector = await FaceDetector.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.4,
            minSuppressionThreshold: 0.3,
        });
        return detector;
    })();
    // فشل التحميل لا يرمي هنا — يُلتقط عند الاستدعاء ويسقط للاحتياطي
    _mpDetectorPromise.catch(() => { _mpDetectorPromise = null; });
    return _mpDetectorPromise;
}

/** تشغيل الكاميرا بقيود متدرجة + رسائل عربية واضحة */
async function openCameraStream(video) {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('الكاميرا تحتاج اتصالًا آمنًا (HTTPS) — افتح النظام عبر https أو من نفس الجهاز، أو استخدم «رفع صورة» بالأسفل');
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('المتصفح لا يدعم الكاميرا — استخدم «رفع صورة» بالأسفل أو متصفحًا حديثًا (Chrome)');
    }
    const tries = [
        { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
        { video: true, audio: false },
    ];
    let lastErr = null;
    for (const c of tries) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia(c);
            video.srcObject = stream;
            await video.play().catch(() => {});
            return stream;
        } catch (e) { lastErr = e; }
    }
    const n = lastErr?.name || '';
    const tag = (c) => c + (n ? ` [${n}]` : '');
    if (n === 'NotAllowedError' || n === 'SecurityError') {throw new Error(tag('مُنع الوصول للكاميرا — اسمح بالكاميرا من إعدادات الموقع/التطبيق ثم أعد المحاولة'));}
    if (n === 'NotFoundError' || n === 'OverconstrainedError') {throw new Error(tag('لا توجد كاميرا متاحة — استخدم «رفع صورة» بالأسفل'));}
    if (n === 'NotReadableError') {throw new Error(tag('الكاميرا مشغولة بتطبيق آخر — أغلقه وأعد المحاولة'));}
    throw new Error(tag('تعذر تشغيل الكاميرا (' + (lastErr?.message || n || 'خطأ غير معروف') + ') — جرّب «رفع صورة» بالأسفل'));
}

/** قصّ الوجه من الفيديو إلى JPEG base64 — يُرسل للسيرفر لمحرك ArcFace v2 */
function cropFaceToJpeg(video, box) {
    try {
        const vw = video.videoWidth || video.clientWidth || 640;
        const vh = video.videoHeight || video.clientHeight || 480;
        const m = Math.max(box.width, box.height) * 0.28;
        const sx = Math.max(0, box.x - m);
        const sy = Math.max(0, box.y - m);
        const sw = Math.min(vw - sx, box.width + m * 2);
        const sh = Math.min(vh - sy, box.height + m * 2);
        if (sw < 20 || sh < 20) {return null;}
        const c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        c.getContext('2d').drawImage(video, sx, sy, sw, sh, 0, 0, 160, 160);
        return c.toDataURL('image/jpeg', 0.85);
    } catch (_) { return null; }
}

/** قصّ مركزي احتياطي (بلا كشف) — السيرفر يتحقق عبر UltraFace */
function cropCenterToJpeg(video) {
    try {
        const vw = video.videoWidth || 640, vh = video.videoHeight || 480;
        const side = Math.min(vw, vh) * 0.8;
        const sx = (vw - side) / 2, sy = (vh - side) / 2;
        const c = document.createElement('canvas');
        c.width = 160; c.height = 160;
        c.getContext('2d').drawImage(video, sx, sy, side, side, 0, 0, 160, 160);
        return c.toDataURL('image/jpeg', 0.85);
    } catch (_) { return null; }
}

/** ملف صورة → JPEG base64 بمقاس 480 (لزر الرفع الاحتياطي) */
function fileToJpegDataUrl(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            try {
                const side = Math.max(img.width, img.height);
                const c = document.createElement('canvas');
                const max = 480;
                const scale = Math.min(1, max / side);
                c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
                c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
                URL.revokeObjectURL(url);
                resolve(c.toDataURL('image/jpeg', 0.85));
            } catch (e) { URL.revokeObjectURL(url); reject(e); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('تعذر قراءة الصورة')); };
        img.src = url;
    });
}

/**
 * يفتح الكاميرا ويجمع بصمة/بصمات وجه.
 * المحرك الأساسي: MediaPipe BlazeFace (مفتوح المصدر، قوي على الجوال) للكشف + قصّ،
 * والسيرفر يستخرج بصمة ArcFace-512 من اللقطة — لا حساسية لكاميرا/إضاءة العميل.
 * الاحتياطي: face-api القديم (descriptor) ثم التقاط يدوي/رفع صورة.
 * التسجيل يجمع 5 لقطات متنوعة — يحل شكوى «سجّل الوجه ولا يقبل».
 * @param {string} title
 * @param {number} [target=1] عدد العينات (1 = بصمة دخول/انصراف — 5 = تسجيل)
 * @returns {Promise<{descriptor?:number[], descriptors?:number[][], image?:string, images?:string[]}>}
 */
async function openFaceCameraAndGetDescriptor(title, target = 1) {
    return new Promise((resolve, reject) => {
        window.showModal(`
            <h3 style="margin-top:0"><i class=ji data-i="user"></i> ${title}</h3>
            <video id="faceVideo" autoplay playsinline muted
                   style="width:100%;max-width:420px;border-radius:14px;background:#000;transform:scaleX(-1)"></video>
            <div id="faceMsg" class="u-t14" style="margin:10px 0;color:var(--text2)">جارٍ تشغيل الكاميرا…</div>
            ${target > 1 ? `<div id="faceProg" style="height:6px;background:var(--bg3);border-radius:3px;overflow:hidden;margin-bottom:8px"><div id="faceProgBar" style="height:100%;width:0;background:var(--gold);transition:width .3s"></div></div>` : ''}
            <button type="button" id="faceCapture" class="btn btn-gold" style="width:100%">📸 التقاط البصمة</button>
            <label class="btn btn-sm" style="width:100%;margin-top:8px;text-align:center;cursor:pointer">📁 أو ارفع صورة واضحة للوجه
                <input type="file" id="faceUpload" accept="image/*" capture="user" style="display:none">
            </label>
            <button type="button" class="btn btn-sm" style="width:100%;margin-top:8px" data-karim-action="window.__faceCancel">إلغاء</button>
        `);
        let stream = null;
        let stopped = false;
        let mpDetector = null;   // MediaPipe BlazeFace
        let fapi = null;         // face-api احتياطي
        let fapiOpts = null;
        const cleanup = () => {
            stopped = true;
            try { stream?.getTracks().forEach((t) => t.stop()); } catch (_) {}
            try { mpDetector?.close?.(); } catch (_) {}
        };
        window.__faceCancel = () => { cleanup(); window.closeModal(); reject(new Error('FACE_CANCELLED')); };
        const say = (t) => { const m = document.getElementById('faceMsg'); if (m) {m.textContent = t;} };
        const setProg = (n) => { const b = document.getElementById('faceProgBar'); if (b) {b.style.width = Math.round((n / target) * 100) + '%';} };
        // كشف موحّد: يعيد {box:{x,y,width,height}, descriptor?} أو null
        const detect = async (video) => {
            // 1) MediaPipe BlazeFace — سريع وقوي على الجوال
            if (mpDetector) {
                try {
                    const now = performance.now();
                    const res = mpDetector.detectForVideo(video, now);
                    const det = res?.detections?.[0];
                    const bb = det?.boundingBox;
                    if (bb && (det?.categories?.[0]?.score ?? 1) >= 0.35) {
                        // BlazeFace يعيد إحداثيات بكسل + mirrored بسبب scaleX(-1) للعرض فقط — القص متماثل
                        return { box: { x: bb.originX, y: bb.originY, width: bb.width, height: bb.height }, descriptor: null };
                    }
                } catch (_) {}
            }
            // 2) face-api احتياطي — يعطي descriptor للمطابقة القديمة أيضًا
            if (fapi) {
                try {
                    const det = await fapi.detectSingleFace(video, fapiOpts).withFaceLandmarks().withFaceDescriptor();
                    if (det && det.detection.score > 0.4) {
                        return { box: det.detection.box, descriptor: Array.from(det.descriptor) };
                    }
                } catch (_) {}
            }
            return null;
        };
        const samplesImg = [];
        const samplesDesc = [];
        const finishResolve = (lastBox, lastDesc) => {
            const video = document.getElementById('faceVideo');
            const lastCrop = lastBox && video ? cropFaceToJpeg(video, lastBox) : (video ? cropCenterToJpeg(video) : null);
            if (target > 1) {
                if (lastCrop) {samplesImg.push(lastCrop); if (lastDesc) {samplesDesc.push(lastDesc);}}
                const images = samplesImg.slice(0, target);
                while (images.length < 1 && lastCrop) {images.push(lastCrop);}
                cleanup(); window.closeModal();
                resolve({ descriptors: samplesDesc.length ? samplesDesc : undefined, images });
                return;
            }
            cleanup(); window.closeModal();
            resolve({ descriptor: lastDesc || samplesDesc[0] || null, image: lastCrop || samplesImg[0] || null });
        };
        (async () => {
            const video = document.getElementById('faceVideo');
            if (!video) {cleanup(); return;}
            // الكاميرا أولًا (رسائل عربية واضحة عند الفشل + زر الرفع يبقى متاحًا)
            try {
                stream = await openCameraStream(video);
            } catch (camErr) {
                say(camErr.message);
            }
            // تحميل المحركات بالتوازي (مهلة 12 ثانية) — أيهما يجهز يُستخدم
            say('جارٍ تحميل محرك كشف الوجه (BlazeFace مفتوح المصدر)…');
            try { mpDetector = await Promise.race([
                loadBlazeFaceDetector(),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
            ]); } catch (_) { mpDetector = null; }
            if (!mpDetector) {
                try { fapi = await loadFaceApiLib(); fapiOpts = new fapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }); }
                catch (_) { fapi = null; }
            } else { // BlazeFace جاهز — حمّل face-api أيضًا بالخلفية للـ descriptor الاختياري
                loadFaceApiLib().then((f) => { fapi = f; fapiOpts = new f.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.35 }); }).catch(() => {});
            }
            if (!mpDetector && !fapi && !stream) {
                say('تعذر تشغيل الكاميرا والمحركات — ارفع صورة واضحة للوجه بالزر بالأسفل');
            } else if (!mpDetector && !fapi) {
                say('اضغط «التقاط البصمة» — سيتحقق السيرفر من الوجه تلقائيًا');
            } else {
                say(target > 1 ? 'وجّه وجهك للكاميرا — سنلتقط 5 لقطات متنوعة تلقائيًا' : 'وجّه وجهك للكاميرا ثم اضغط «التقاط البصمة»');
            }
            // زر الرفع الاحتياطي — يعمل حتى بلا كاميرا
            document.getElementById('faceUpload')?.addEventListener('change', async (ev) => {
                try {
                    const file = ev.target.files?.[0];
                    if (!file) {return;}
                    const jpeg = await fileToJpegDataUrl(file);
                    cleanup(); window.closeModal();
                    if (target > 1) {resolve({ images: [jpeg] });}
                    else {resolve({ descriptor: null, image: jpeg });}
                } catch (e) { say(e.message || 'تعذر قراءة الصورة'); }
            });
            // حلقة كشف حية للعرض فقط (تحديث الرسالة) — الالتقاط عند الضغط
            let lastSeen = 0, lastAutoAt = 0;
            const loop = async () => {
                if (stopped || !stream) {return;}
                try {
                    if (video.videoWidth > 0) {
                        const d = await detect(video);
                        if (d) {
                            lastSeen = Date.now();
                            if (target > 1) {
                                // التقاط تلقائي متنوع كل ~900ms
                                if (Date.now() - lastAutoAt > 900) {
                                    const crop = cropFaceToJpeg(video, d.box);
                                    if (crop) {
                                        samplesImg.push(crop); if (d.descriptor) {samplesDesc.push(d.descriptor);}
                                        lastAutoAt = Date.now(); setProg(samplesImg.length);
                                        say(`ممتاز — اللقطة ${samplesImg.length}/${target} — حرّك رأسك قليلًا…`);
                                        if (samplesImg.length >= target) {finishResolve(d.box, d.descriptor); return;}
                                    }
                                } else {say(`ثبّت — اللقطة ${samplesImg.length + 1}/${target}…`);}
                            } else {say('✅ وجه واضح — اضغط «التقاط البصمة»');}
                        } else if (Date.now() - lastSeen > 1500) {
                            say('أقرب وجهك للكاميرا في إضاءة جيدة…');
                        }
                    }
                } catch (_) {}
                if (!stopped) {setTimeout(loop, 350);}
            };
            loop();
            document.getElementById('faceCapture').onclick = async () => {
                if (!stream) {say('لا توجد كاميرا عاملة — السبب مكتوب أعلاه، أو استخدم «رفع صورة» بالأسفل'); return;}
                try {
                    const d = await detect(video);
                    if (d) {
                        if (target > 1) {
                            const crop = cropFaceToJpeg(video, d.box);
                            if (crop) {samplesImg.push(crop); if (d.descriptor) {samplesDesc.push(d.descriptor);} setProg(samplesImg.length);}
                            if (samplesImg.length >= target) {finishResolve(d.box, d.descriptor); return;}
                            say(`تمت اللقطة ${samplesImg.length}/${target} — ${target - samplesImg.length} متبقية…`);
                            return;
                        }
                        const crop = cropFaceToJpeg(video, d.box);
                        cleanup(); window.closeModal();
                        resolve({ descriptor: d.descriptor || null, image: crop });
                        return;
                    }
                    // بلا كشف — قصّ مركزي والسيرفر يتحقق (UltraFace)
                    const fallback = cropCenterToJpeg(video);
                    if (fallback) {
                        if (target > 1) {
                            samplesImg.push(fallback); setProg(samplesImg.length);
                            if (samplesImg.length >= target) {finishResolve(null, null); return;}
                            say(`تمت اللقطة ${samplesImg.length}/${target} (تحقق السيرفر)…`);
                            return;
                        }
                        cleanup(); window.closeModal();
                        resolve({ descriptor: null, image: fallback });
                    } else {say('لم نلتقط صورة — أعد المحاولة أو ارفع صورة');}
                } catch (e) {say(e.message || 'تعذر الالتقاط');}
            };
        })().catch((e) => { cleanup(); try {window.closeModal();} catch (_) {} reject(e); });
    });
}

/** تسجيل وجه جديد: 5 عينات متنوعة لمطابقة أقوى بأقل مسافة */
async function openFaceCameraForEnrollment(title) {
    return openFaceCameraAndGetDescriptor(title, 5);
}

/**
 * حفظ قالب الوجه مزدوجًا (v2 صور ArcFace + v1 متجهات) — البصمة تقبل أيهما جهز،
 * فيعمل التسجيل من أي كاميرا (جوال/مكتب) مع أي إعداد محرك. لا ترمي — ترجع النتيجة.
 * @param {number} targetUserId
 * @param {{images?: string[], image?: string, descriptors?: number[][], descriptor?: number[]}|number[][]} face
 * @returns {Promise<{v2: boolean, v1: boolean, v2Error?: string, v1Error?: string}>}
 */
async function saveFaceEnrollment(targetUserId, face) {
    const images = face?.images?.filter(Boolean) || (face?.image ? [face.image] : []);
    const descriptors = face?.descriptors || (Array.isArray(face) ? face : null);
    const saved = { v2: false, v1: false };
    if (images.length) {
        try {
            await window.apiFetch('/attendance/portal/face/enroll-v2', {
                method: 'POST', body: JSON.stringify({ targetUserId, images }),
            });
            saved.v2 = true;
        } catch (e) { saved.v2Error = e.message || 'فشل المحرك المتقدم'; }
    }
    if (descriptors) {
        try {
            await window.apiFetch('/attendance/portal/face/enroll', {
                method: 'POST', body: JSON.stringify({ targetUserId, descriptors }),
            });
            saved.v1 = true;
        } catch (e) { saved.v1Error = e.message || 'فشل المحرك الأساسي'; }
    }
    return saved;
}

/** رسالة عربية موحدة لنتيجة التسجيل المزدوج */
function faceEnrollMessage(saved) {
    if (saved.v2 && saved.v1) {return 'تم تسجيل الوجه بالمحركين — البصمة جاهزة من أي كاميرا';}
    if (saved.v2) {return 'تم تسجيل الوجه بالمحرك المتقدم' + (saved.v1Error ? ' (الأساسي: ' + saved.v1Error + ')' : '');}
    if (saved.v1) {return 'تم تسجيل الوجه بالمحرك الأساسي' + (saved.v2Error ? ' (المتقدم: ' + saved.v2Error + ')' : '');}
    return 'فشل التسجيل: ' + (saved.v2Error || saved.v1Error || 'لا لقطة صالحة');
}

// ─── بطاقة تسجيل وجوه الموظفين من كاميرا الجوال (admin/hr) ───────────────────
// تُحقن في بوابة الموظف على الجوال — المدير يسجل أي موظف بكاميرا هاتفه مباشرة.

function injectFaceEnrollCard() {
    if (!shellActive() || window.STATE?.page !== 'employee-portal') {return;}
    if (!['admin', 'hr'].includes(window.STATE?.currentUser?.role)) {return;}
    if (document.getElementById('faceEnrollCard')) {return;}
    const anchor = document.getElementById('punchCard');
    const html = `<div class="punch-card" id="faceEnrollCard" style="margin-top:12px">
        <span class="punch-status-chip enabled">📷 تسجيل وجوه الموظفين (إدارة)</span>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
            <select id="faceEnrollUser" style="flex:1;min-width:150px;padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:10px;color:var(--text);font-family:inherit">
                <option value="">— اختر الموظف —</option>
            </select>
        </div>
        <button type="button" id="faceEnrollBtn" class="btn btn-gold" style="width:100%;margin-top:8px">📷 تسجيل وجهه بكاميرا الجوال</button>
        <button type="button" id="faceRemoveBtn" class="btn btn-sm" style="width:100%;margin-top:8px">🗑️ إزالة قالب وجهه</button>
        <div id="faceEnrollResult" class="punch-result" style="margin-top:8px"></div>
        <div class="punch-meta">يُحفظ القالبان معًا — يعمل مع أي إعداد محرك. وجّه الكاميرا لوجه الموظف.</div>
    </div>`;
    if (anchor) {anchor.insertAdjacentHTML('afterend', html);}
    else {document.getElementById('content')?.insertAdjacentHTML('afterbegin', html);}
    refreshFaceEnrollUsers();
    document.getElementById('faceEnrollBtn')?.addEventListener('click', mobileEnrollFace);
    document.getElementById('faceRemoveBtn')?.addEventListener('click', mobileRemoveFace);
}

function refreshFaceEnrollUsers() {
    const sel = document.getElementById('faceEnrollUser');
    if (!sel) {return;}
    const list = (window.STATE?.employees || []).filter((e) => e.userId);
    const cur = sel.value;
    sel.innerHTML = '<option value="">— اختر الموظف —</option>' + list.map((e) =>
        `<option value="${e.userId}">${(e.name || '').replace(/</g, '&lt;')} (${e.employeeId || ''})</option>`).join('');
    if (cur) {sel.value = cur;}
}

function faceEnrollSay(text, ok) {
    const box = document.getElementById('faceEnrollResult');
    if (box) {
        box.className = 'punch-result ' + (ok ? 'ok' : 'err');
        box.textContent = text;
    }
    if (window.toast) {window.toast(text, ok ? 'ok' : 'error');}
}

async function mobileEnrollFace() {
    const userId = Number(document.getElementById('faceEnrollUser')?.value);
    if (!userId) {faceEnrollSay('اختر الموظف أولًا', false); return;}
    const name = (window.STATE?.employees || []).find((e) => Number(e.userId) === userId)?.name || '';
    const btn = document.getElementById('faceEnrollBtn');
    if (btn) {btn.disabled = true; btn.textContent = 'افتح الكاميرا ووجّهها لوجه الموظف…';}
    try {
        const face = await openFaceCameraForEnrollment('تسجيل وجه: ' + name);
        faceEnrollSay('جارٍ حفظ القالب…', true);
        const saved = await saveFaceEnrollment(userId, face);
        faceEnrollSay(faceEnrollMessage(saved), saved.v2 || saved.v1);
    } catch (e) {
        if (e.message !== 'FACE_CANCELLED') {faceEnrollSay(e.message || 'فشل التسجيل', false);}
    } finally {
        if (btn) {btn.disabled = false; btn.textContent = '📷 تسجيل وجهه بكاميرا الجوال';}
    }
}

async function mobileRemoveFace() {
    const userId = Number(document.getElementById('faceEnrollUser')?.value);
    if (!userId) {faceEnrollSay('اختر الموظف أولًا', false); return;}
    if (!window.confirm('إزالة قالب الوجه لهذا الموظف؟')) {return;}
    try {
        await window.apiFetch('/attendance/portal/face/enroll/' + userId, { method: 'DELETE' });
        faceEnrollSay('تمت إزالة القالب', true);
    } catch (e) { faceEnrollSay(e.message || 'فشلت الإزالة', false); }
}

/**
 * فحص التزييف الأصلي (Android فقط عبر بلجن MockLocationDetector v2):
 * يرجع { mocked, mockAppSelected, source, detail, ageS } — mocked دليل على
 * القراءة نفسها (كاش طازج ≤ 2 د أو إصلاح حي)، mockAppSelected إشارة ضبط تُسجَّل
 * ولا ترفض. يرجع null عند غياب البلجن (ويب/PWA). المهلة 9 ث لتغطية النافذة
 * الحية للبلجن (6.5 ث) دون تجاوز زمن جمع قراءات الموقع.
 */
async function checkNativeMockSignals() {
    try {
        const plugin = window.Capacitor?.Plugins?.MockLocationDetector;
        if (!plugin?.isMockLocation) {return null;}
        const r = await Promise.race([
            plugin.isMockLocation(),
            new Promise((res) => setTimeout(() => res(null), 9000)),
        ]);
        if (r && typeof r.mocked === 'boolean') {return r;}
        return null;
    } catch (_) { return null; }
}

/**
 * يجمع 6 إصلاحات GPS خلال ~9 ثوانٍ (watchPosition عالي الدقة) — السيرفر يحللها
 * (تجميد/انتقال/تشتت/دقة ثابتة/واقعية) فيرفض التزوير ويقيس بدقة أعلى من قناع واحد.
 * UPGRADE 2026-10-01:
 *   • يلتقط الحقول الكاملة: altitude/heading/speed/t — وقود فحوص الواقعية
 *   • مؤشر دقة حي (onFix) ليرى الموظف جودة الإشارة ويتحرك لمكان أفضل
 *   • محاولة ثانية تلقائية عند الفشل الأول (هوائيات داخلية بطيئة الالتقاط)
 * @param {(done:number,total:number,accuracy:number|null)=>void} [onFix]
 * @returns {Promise<Array|null>}
 */
function collectLocationFixes(onFix) {
    const TARGET = 6;
    const SESSION_MS = 9000;
    const once = () => new Promise((resolve) => {
        if (!navigator.geolocation) {resolve(null); return;}
        const fixes = [];
        const sendTime = Date.now();
        let settled = false;
        const done = (val) => { if (!settled) {settled = true; resolve(val);} };
        let wid = null;
        try {
            wid = navigator.geolocation.watchPosition((pos) => {
                const c = pos.coords || {};
                const numOrNull = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
                fixes.push({
                    lat: c.latitude,
                    lng: c.longitude,
                    accuracy: numOrNull(c.accuracy) ?? 999,
                    fixAgeS: Math.max(0, Math.round((sendTime - (pos.timestamp || Date.now())) / 1000)),
                    alt: numOrNull(c.altitude),
                    altAcc: numOrNull(c.altitudeAccuracy),
                    heading: numOrNull(c.heading),
                    speed: numOrNull(c.speed),
                    t: Number(pos.timestamp) || Date.now(),
                });
                try { onFix?.(fixes.length, TARGET, numOrNull(c.accuracy)); } catch (_) {}
                if (fixes.length >= TARGET) {
                    try {navigator.geolocation.clearWatch(wid);} catch (_) {}
                    done(fixes);
                }
            }, () => {
                try {navigator.geolocation.clearWatch(wid);} catch (_) {}
                done(fixes.length ? fixes : null);
            }, { enableHighAccuracy: true, maximumAge: 0, timeout: SESSION_MS });
        } catch (_) { done(null); return; }
        setTimeout(() => {
            try {navigator.geolocation.clearWatch(wid);} catch (_) {}
            done(fixes.length ? fixes : null);
        }, SESSION_MS + 500);
    });
    return (async () => {
        let fixes = await once();
        // محاولة ثانية عند الفشل التام فقط (لا عند النجاح الجزئي — لا نؤخر الطابور)
        if (!fixes) {fixes = await once();}
        return fixes;
    })();
}

async function mobileDoPunch(intent) {
    if (_punchBusy) {return;}
    _lastPunchResult = null; // بصمة جديدة تمسح نتيجة المحاولة السابقة
    const btn = document.getElementById('punchBtn');
    const resultBox = document.getElementById('punchResult');
    const setResult = (cls, text) => {
        // الحالة تُحفظ على مستوى الوحدة حتى تنجو رسالة النتيجة من إعادة رندر
        // الصفحة التي يفعلها نجاح البصمة (renderPage يعيد بناء البطاقة).
        _lastPunchResult = text ? { cls, text } : null;
        if (!resultBox) {return;}
        resultBox.className = `punch-result ${cls}`;
        resultBox.textContent = text;
    };

    // FR-M6: لا وعد نجاح كاذب — فحص الاتصال أولًا
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        setResult('err', 'لا يوجد اتصال بالشبكة — اتصل بشبكة المطعم وأعد المحاولة');
        return;
    }
    await refreshPunchStatus().catch(() => {}); // حالة حية (مفعّل؟ وجه مسجل؟)
    // لو عطّلت الإدارة الجيوفانس فلا يُشترط الموقع (L1 الشبكة تبقى إلزامية بالسيرفر)
    const geofenceOn = _punchStatus ? Boolean(_punchStatus.geofence) : true;
    if (!navigator.geolocation && geofenceOn) {
        setResult('err', 'جهازك لا يدعم تحديد الموقع — البصمة الذاتية تتطلب الموقع');
        return;
    }

    _punchBusy = true;
    if (btn) {btn.disabled = true; btn.textContent = 'جارٍ تحديد موقعك…';}

    const finish = () => {
        _punchBusy = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="ji" data-i="clock"></i> تسجيل البصمة الآن';
        }
    };

    const sendPunch = async (locPayload, faceDescriptor) => {
        try {
            const payload = {
                deviceId: mobileDeviceId(),
                intent: intent || null, // نيّة الزر (in/out) — المحرك الذكي يقرر
                location: locPayload,
            };
            if (faceDescriptor) {payload.faceDescriptor = faceDescriptor;}
            if (faceImage) {payload.faceImage = faceImage;}
            const res = await window.apiFetch('/attendance/portal/punch', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const action = res?.action === 'check_in' ? '✅ تم تسجيل الحضور'
                : res?.action === 'check_out' ? '✅ تم تسجيل الانصراف'
                    : '✅ تم تسجيل البصمة';
            try {
                // مزامنة STATE المحلي من سجل السيرفر (نفس ما كان يفعله المسار القديم)
                if (res?.record && typeof window.upsertStateEntity === 'function') {
                    window.upsertStateEntity('attendance', res.record);
                }
                if (typeof window.renderPage === 'function' && window.STATE?.page) {
                    window.renderPage();
                }
            } catch (_) {}
            setResult('ok', action);
            if (window.toast) {window.toast(action, 'ok');}
        } catch (e) {
            // رسائل الرفض من السيرفر عربية وجاهزة (PUNCH_OUT_OF_RANGE…)
            setResult('err', '✋ ' + (e.message || 'تم رفض البصمة'));
            if (window.toast) {window.toast(e.message || 'تم رفض البصمة', 'error');}
        } finally {
            finish();
        }
    };

    // تسجيل الرفض الذي يحدث على الجهاز قبل الوصول للسيرفر — لا رفض صامت خارج
    // punch_attempts (الشفافية جزء من العدالة). fire-and-forget: لا يؤخر النتيجة.
    const logClientReject = (reason, detail) => {
        try {
            window.apiFetch('/attendance/portal/punch/client-reject', {
                method: 'POST',
                body: JSON.stringify({ reason, detail: detail || null }),
            }).catch(() => {});
        } catch (_) {}
    };

    const geolocationError = (err) => {
        finish();
        const msgs = {
            1: 'مُنِع الوصول للموقع — اسمح بتحديد الموقع من إعدادات المتصفح',
            2: 'تعذر تحديد موقعك — تأكد من تشغيل خدمة الموقع وانتظر إشارة جيدة',
            3: 'انتهت مهلة تحديد الموقع — حاول من مكان مفتوح',
        };
        setResult('err', msgs[err?.code] || 'تعذر تحديد الموقع');
        if (window.toast) {window.toast(msgs[err?.code] || 'تعذر تحديد الموقع', 'error');}
    };

    // L5: إن كان الوجه مفعّلًا — الكاميرا أولًا ثم الموقع ثم الإرسال
    let descriptor = null;
    let faceImage = null; // لقطة الوجه المقصوصة — لمحرك ArcFace v2 على السيرفر
    if (_punchStatus?.faceEnabled) {
        if (_punchStatus.faceEnrolled === false) {
            setResult('err', 'لم يتم تسجيل وجهك بعد — راجع الموارد البشرية');
            finish();
            return;
        }
        btn.textContent = 'افتح الكاميرا وانظر للأسفل…';
        try {
            const face = await openFaceCameraAndGetDescriptor('تأكيد البصمة بالوجه');
            descriptor = face.descriptor || null;
            faceImage = face.image || null;
            if (!descriptor && !faceImage) {
                setResult('err', 'لم نلتقط صورة صالحة — أعد المحاولة في إضاءة جيدة');
                finish();
                return;
            }
        } catch (e) {
            finish();
            if (e.message !== 'FACE_CANCELLED') {setResult('err', e.message);}
            return;
        }
    }

    // L6: بصمة الجهاز (صباع/وجه الجهاز) — داخل تطبيق الأندرويد فقط: تربط طلب
    // البصمة بمالك الجهاز المربوط (L4). الويب/PWA يتجاوزها (لا منصة أصلية)
    // وطبقات السيرفر (الوجه/الشبكة/الجهاز) تبقى الحَكَم في الحالتين.
    if (window.Capacitor?.isNativePlatform?.()) {
        const Bio = window.Capacitor?.Plugins?.BiometricAuthNative;
        if (Bio) {
            try {
                const bio = await Bio.checkBiometry();
                if (bio.isAvailable) {
                    btn.textContent = 'أكِّد هويتك ببصمة الجهاز…';
                    try {
                        const authFn = typeof Bio.authenticate === 'function' ? Bio.authenticate
                            : (typeof Bio.internalAuthenticate === 'function' ? Bio.internalAuthenticate : null);
                        if (authFn) {
                            await authFn.call(Bio, {
                                reason: 'تأكيد هويتك قبل تسجيل البصمة',
                                androidTitle: 'Karim ERP',
                                title: 'Karim ERP',
                                allowDeviceCredential: false,
                            });
                        }
                    } catch (_) {
                        finish();
                        setResult('err', '✋ لم يتم تأكيد بصمة الجهاز — أعد المحاولة');
                        return;
                    }
                }
            } catch (_) { /* الإضافة غير متاحة على هذا الجهاز — طبقات السيرفر تحمي */ }
        }
    }

    if (!geofenceOn) {
        await sendPunch(null, descriptor); // الجيوفانس معطل إداريًا — L1 الشبكة يحمي السيرفر
        return;
    }
    // تحصين الموقع: 6 قراءات خلال ~9 ثوانٍ + فحص التزييف الأصلي (APK) —
    // السيرفر يحلل التجميد/الانتقال/التشتت/الدقة الثابتة/الواقعية ضد geolib.
    btn.textContent = 'جارٍ تحديد موقعك بدقة…';
    const [fixes, mockSignals] = await Promise.all([
        collectLocationFixes((done, total, acc) => {
            if (btn) {
                btn.textContent = acc != null
                    ? `تحديد الموقع ${done}/${total} — الدقة ${Math.round(acc)}م`
                    : `تحديد الموقع ${done}/${total}…`;
            }
        }),
        checkNativeMockSignals(),
    ]);
    // L1-native: دليل تزييف على القراءة نفسها (كاش طازج/إصلاح حي) → رفض فوري
    if (mockSignals?.mocked === true) {
        finish();
        logClientReject('PUNCH_LOCATION_MOCKED_CLIENT', mockSignals.detail);
        const mockWhy = mockSignals.source === 'live'
            ? 'قراءة GPS الحالية على جهازك معلَّمة كموقع مزيف'
            : 'آخر قراءة موقع على جهازك معلَّمة كموقع مزيف (أثر تطبيق تزييف حديث)';
        setResult('err', `✋ ${mockWhy} — أوقف تطبيقات تغيير الموقع، افتح «خرائط Google» قرب نافذة حتى يثبت موقعك الحقيقي، ثم أعد المحاولة`);
        if (window.toast) {window.toast('تم رصد موقع مزيف', 'error');}
        return;
    }
    // إشارة ضبط لا دليل تزييف: البصمة تُقبل لكن تُبلَّغ للسيرفر للتسجيل الإداري
    const spoofSignals = mockSignals?.mockAppSelected === true ? ['MOCK_APP_SELECTED'] : [];
    if (spoofSignals.length && window.toast) {
        window.toast('تنبيه: يوجد تطبيق موقع مزيف مُعد على جهازك — سيُسجَّل ذلك إداريًا', 'warning');
    }
    if (!fixes) {
        logClientReject('PUNCH_LOCATION_UNAVAILABLE_CLIENT', mockSignals?.detail || null);
        geolocationError({ code: 2 });
        return;
    }
    if (mockSignals !== null) {
        for (const f of fixes) {f.mocked = false;}
    }
    await sendPunch({ fixes, mocked: false, spoofSignals }, descriptor);
}

// ─── التركيب والتهيئة (S4) ───────────────────────────────────────────────────

function mobileShellRefresh() {
    // تُستدعى بعد كل رندر صفحة — تضبط ظهور الشريط وحالة العنصر النشط
    renderMobileNav();
    injectPunchCard();
    injectFaceEnrollCard();
    refreshFaceEnrollUsers();
    injectTopbarLogout();
}

/**
 * تصفير جلسة الجوال عند الخروج (إصلاح أمني 2026-10-01): حالة البوابة وآخر
 * نتيجة بصمة وشارة التنقل للدور السابق يجب ألا تتسرب للدخول التالي.
 */
function resetMobileShellSession() {
    _punchStatus = null;
    _lastPunchResult = null;
}

/**
 * زر خروج دائم في الشريط العلوي على الجوال — زر «خروج» يعيش في نهاية
 * القائمة الجانبية وقد يختفي تحت الشريط السفلي أو خارج الشاشة.
 */
function injectTopbarLogout() {
    if (!shellActive()) {
        const stale = document.getElementById('topbarLogout');
        if (stale) {stale.remove();}
        return;
    }
    const bar = document.querySelector('.topbar-right');
    if (!bar || document.getElementById('topbarLogout')) {return;}
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'topbarLogout';
    btn.className = 'topbar-btn';
    btn.setAttribute('data-tooltip', 'خروج');
    btn.setAttribute('aria-label', 'خروج');
    btn.setAttribute('role', 'button');
    btn.innerHTML = '<i class="ji" data-i="log-out"></i>';
    btn.addEventListener('click', () => { if (typeof window.doLogout === 'function') {window.doLogout();} });
    bar.insertBefore(btn, bar.firstChild);
}

function initMobileShell() {
    // اللف حول go(): مزامنة حالة عنصر الشريط النشط بعد كل تنقل
    if (typeof window.go === 'function' && !window.go.__mobileWrapped) {
        const origGo = window.go;
        window.go = function (_page, _el) {
            const r = origGo.apply(this, arguments);
            try {renderMobileNav();} catch (_) {}
            return r;
        };
        window.go.__mobileWrapped = true;
    }
    // اللف حول renderPage(): حقن بطاقة البصمة بعد رندر صفحة البوابة
    if (typeof window.renderPage === 'function' && !window.renderPage.__mobileWrapped) {
        const origRenderPage = window.renderPage;
        window.renderPage = async function () {
            const r = await origRenderPage.apply(this, arguments);
            try {mobileShellRefresh();} catch (_) {}
            return r;
        };
        window.renderPage.__mobileWrapped = true;
    } else {
        // لو لم يوجد renderPage بعد (ترتيب التحميل) — مراقبة #content مباشرة
        const content = document.getElementById('content');
        if (content && !window.__mobileContentObserver) {
            window.__mobileContentObserver = new MutationObserver(() => {
                try {mobileShellRefresh();} catch (_) {}
            });
            window.__mobileContentObserver.observe(content, { childList: true });
        }
    }
    // لافتة عدم الاتصال (FR-M6)
    window.addEventListener('offline', () => document.body.classList.add('mobile-offline'));
    window.addEventListener('online', () => document.body.classList.remove('mobile-offline'));
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        document.body.classList.add('mobile-offline');
    }
    // لافتة ثابتة في DOM (تصير مرئية بالـ CSS عند انقطاع الاتصال)
    if (!document.getElementById('mobileOfflineBar')) {
        const bar = document.createElement('div');
        bar.id = 'mobileOfflineBar';
        bar.className = 'mobile-offline-bar';
        bar.textContent = 'لا يوجد اتصال بالشبكة — البصمة والتحديثات لن تعمل';
        document.body.prepend(bar);
    }
    // الاستجابة الحية لدوران الجوال/تغيّر مقاس النافذة — الهيكل يُركَّب أو يُفكّ
    // فورًا بلا إعادة تحميل (shellActive يُقيَّم من جديد عند كل تغيّر breakpoint)
    try {
        const mq = window.matchMedia(MOBILE_BP);
        const onBreakpoint = () => { try {mobileShellRefresh();} catch (_) {} };
        if (typeof mq.addEventListener === 'function') {mq.addEventListener('change', onBreakpoint);}
        else if (typeof mq.addListener === 'function') {mq.addListener(onBreakpoint);} // سفاري القديم
    } catch (_) {}
    // داخل تطبيق الأندرويد (Capacitor) الهوامش الأصلية تعوّض أشرطة النظام —
    // قواعد env(safe-area-inset) في CSS تُعطَّل هنا لمنع مضاعفة الإزاحة
    try { if (window.Capacitor) {document.body.classList.add('in-capacitor');} } catch (_) {}
    // دخول سريع لحالة البوابة (يحدّث MOBILE_UI_V2 إن أرسلها السيرفر)
    if (window.STATE?.currentUser?.id) {refreshPunchStatus();}
    mobileShellRefresh();
}

// التهيئة بعد اكتمال الجسور (bridges) — DOMC ينتظر اكتمال main.js TLA
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileShell);
} else {
    setTimeout(initMobileShell, 0);
}

export {
    initMobileShell,
    mobileShellRefresh,
    resetMobileShellSession,
    mobileDoPunch,
    mobileDeviceId,
    renderMobileNav,
    refreshPunchStatus,
    loadFaceApiLib,
    loadBlazeFaceDetector,
    openCameraStream,
    cropFaceToJpeg,
    cropCenterToJpeg,
    fileToJpegDataUrl,
    checkNativeMockSignals,
    openFaceCameraAndGetDescriptor,
    openFaceCameraForEnrollment,
    saveFaceEnrollment,
    faceEnrollMessage,
    injectFaceEnrollCard,
    refreshFaceEnrollUsers,
    mobileEnrollFace,
    mobileRemoveFace,
};
