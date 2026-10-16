/**
 * V2 — غطاء التحميل الحقيقي خلف علم `?v2overlay` (P0-3c)
 * ═══════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *   V2 يقرأ من الخادم بلا أي إشارة «جارٍ التحميل» على مستوى الصفحة: الشاشة
 *   تفرغ ثم تمتلئ، وعلى اتصال بطيء لا يعرف المستخدم أن هناك طلبًا جاريًا
 *   أصلًا. هذا الملف يضيف غطاءً واحدًا يقيس الطلبات الحقيقية على
 *   `window.fetch` — لا نموذجًا متوقعًا ولا مؤقّتًا وهميًا.
 *
 * WHAT IS COUNTED (وما لا يُحسب)
 *   كل نداء `fetch` يمرّ عبر `window.fetch` في هذه الصفحة يُحسب ما لم يطابق
 *   مسارًا مستثنى (`/notifications` و`/health`)، لأن الأول يجري نبضًا
 *   دوريًا والثاني فحص صحة — لا يجوز أن يرفعا الغطاء أبدًا. أي شكل طلب لا
 *   نعرف URL‑ه (Request بلا `url`) لا يُحسب: العدّ الخاطئ أسوأ من عدم العدّ.
 *
 * THE THRESHOLD IS THE FEATURE
 *   الغطاء لا يظهر قبل `THRESHOLD_MS` (400ms). طلبٌ أقصر من ذلك ينتهي قبل
 *   أن يراه أحد، فإظهاره وميضٌ مزعج لا إشارة. لذلك البرهان في الاختبار
 *   ليس «ظهر الغطاء» بل «لم يظهر لطلب 399ms».
 *
 * A BALANCED COUNTER, OR NOTHING
 *   العدّاد يزيد مرة عند البدء وينقص مرة واحدة بالضبط في كل خروج: نجاح، أو
 *   خطأ (رفض)، أو **مهلة** (`MAX_HOLD_MS`) لطلبٍ لا يستقرّ أبدًا. لو نقص
 *   المسار الأخير لَبقي الغطاء يغطّي الشاشة إلى الأبد بعد أسوأ حالة شبكية —
 *   ولهذا كل إطلاقٍ مغلّف بـ`released` فلا ينقص العدّاد مرتين لطلب واحد.
 *
 * REVERSIBILITY
 *   العلم مطفأ افتراضيًا. مع `?v2overlay=0` (أو غيابه) لا يلمس الملف
 *   `window.fetch` إطلاقًا ولا يُنشئ عقدةً واحدة — الصفحة تعود حرفيًا كما
 *   كانت قبل هذا البند. الإطفاء الفوري بلا git هو مستوى التراجع الأول.
 *
 * vm-friendly by contract: لا DOM ولا localStorage ولا مؤقّتات تُلمس وقت
 *   الاستيراد — كل تبعية تصل عبر installOverlay(win, ...).
 */

const FLAG_TRUE = new Set(['1', 'true', 'on']);

/** عتبة الظهور — القرار ٢ في عقد V2: 400ms. */
export const THRESHOLD_MS = 400;

/** سقف الاحتفاظ: طلبٌ لا يستقرّ يُحرَّر قسرًا حتى لا يُعلَّق الغطاء. */
export const MAX_HOLD_MS = 30000;

/** مسارات لا ترفع الغطاء: نبض الإشعارات وفحص الصحة. */
export const EXCLUDE = [/\/notifications(?:[/?#]|$)/, /\/health(?:[/?#]|$)/];

/** نص الغطاء — يُكتب نصًا (textContent) ولا يُفسَّر HTML. */
export const LOADING_LABEL = 'جارٍ التحميل…';

/** `?v2overlay=1|0` يغلب المخزّن؛ غياب الاثنين = إطفاء. */
export function overlayEnabled(search, stored) {
    const match = String(search || '').match(/(?:^|[?&])v2overlay=([^&]*)/);
    if (match) {return FLAG_TRUE.has(decodeURIComponent(match[1]).toLowerCase());}
    if (stored == null || stored === '') {return false;}
    return FLAG_TRUE.has(String(stored).toLowerCase());
}

/**
 * URL الطلب كما نقرؤه: نصٌّ كما هو، أو `Request.url`، وإلا '' (لا نعرف
 * فيُترك بلا عدّ). لا نحلّل ولا نطبّع — التطابق على ما يمرّ فعلًا.
 * @param {any} input الوسيط الأول لـfetch
 * @returns {string}
 */
export function urlOf(input) {
    if (typeof input === 'string') {return input;}
    if (input && typeof input.url === 'string') {return input.url;}
    return '';
}

/**
 * هل يُحسب هذا المسار؟ غير المستثنى فقط.
 * @param {string} url
 * @param {RegExp[]} [patterns]
 * @returns {boolean}
 */
export function shouldCount(url, patterns = EXCLUDE) {
    const u = String(url || '');
    if (u === '') {return false;}
    return !patterns.some((re) => re.test(u));
}

/**
 * ينصب الغطاء ويغلّف `window.fetch`. آمن للاستدعاء أكثر من مرة.
 * @param {any} win النافذة (تُحقن ليبقى الملف قابلًا للاختبار)
 * @param {{enabled?: boolean, threshold?: number, maxHold?: number, exclude?: RegExp[]}} [opts]
 * @returns {boolean} true فقط عند تركيب غطاء حقيقي
 */
export function installOverlay(win, opts = {}) {
    if (!opts.enabled) {return false;}
    const doc = win && win.document;
    if (!doc || typeof doc.createElement !== 'function' || !doc.body) {return false;}
    if (win.__v2Overlay) {return true;}
    const orig = win && win.fetch;
    if (typeof orig !== 'function') {return false;}

    const threshold = Number(opts.threshold) > 0 ? Number(opts.threshold) : THRESHOLD_MS;
    const maxHold = Number(opts.maxHold) > 0 ? Number(opts.maxHold) : MAX_HOLD_MS;
    const patterns = Array.isArray(opts.exclude) ? opts.exclude : EXCLUDE;

    let layer = null;
    let inflight = 0;
    let showTimer = null;
    let painted = false;

    /* الطبقة تحمل `.erp-v2` عمدًا: كل `--erp-*` معرَّف على `.erp-v2`
       (erp-tokens.css:26) وتحويلات الوضع الليلي على
       `[data-theme="dark"] .erp-v2` (erp-themes.css:26) — عقدةٌ مركّبة على
       <body> خارج هذا النطاق ترث صفر توكن، فيسقط z-index إلى auto
       والخلفية إلى شفاف وكل اختبار js يبقى أخضر. الصنف يورّث النطاق بلا
       لمس أي ملف موجود. */
    function ensureLayer() {
        if (layer) {return layer;}
        layer = doc.createElement('div');
        layer.className = 'erp-v2 erp-loading-layer';
        layer.hidden = true;
        layer.setAttribute('role', 'status');
        layer.setAttribute('aria-live', 'polite');
        layer.setAttribute('aria-busy', 'false');
        const card = doc.createElement('div');
        card.className = 'erp-loading__card';
        const spin = doc.createElement('span');
        spin.className = 'erp-loading__spinner';
        spin.setAttribute('aria-hidden', 'true');
        const label = doc.createElement('span');
        label.className = 'erp-loading__label';
        label.textContent = LOADING_LABEL;
        card.appendChild(spin);
        card.appendChild(label);
        layer.appendChild(card);
        doc.body.appendChild(layer);
        return layer;
    }

    /** دالة واحدة للرسم: idempotent، ولا تنشئ عقدة إلا عند أول ظهور. */
    function paint(on) {
        if (on === painted) {return;}
        painted = on;
        const el = ensureLayer();
        el.hidden = !on;
        el.setAttribute('aria-busy', on ? 'true' : 'false');
    }

    function arm() {
        if (showTimer !== null) {return;}
        showTimer = win.setTimeout(() => {
            showTimer = null;
            if (inflight > 0) {paint(true);}
        }, threshold);
    }

    function disarm() {
        if (showTimer !== null) {win.clearTimeout(showTimer); showTimer = null;}
    }

    function inc() {
        inflight += 1;
        if (inflight === 1) {arm();}
    }

    function dec() {
        inflight = Math.max(0, inflight - 1);
        if (inflight === 0) {disarm(); paint(false);}
    }

    win.fetch = function trackedFetch(...args) {
        if (!shouldCount(urlOf(args[0]), patterns)) {return orig.apply(this, args);}
        inc();
        let released = false;
        let hold = null;
        const release = () => {
            if (released) {return;}
            released = true;
            if (hold !== null) {win.clearTimeout(hold); hold = null;}
            dec();
        };
        let p;
        try {
            p = orig.apply(this, args);
        } catch (e) {
            // رفضٌ متزامن يخرج بلا promise — العدّاد يُعاد قبل إعادة الرمي.
            release();
            throw e;
        }
        if (!p || typeof p.then !== 'function') {release(); return p;}
        hold = win.setTimeout(release, maxHold);
        return p.then(
            (value) => {release(); return value;},
            (error) => {release(); throw error;},
        );
    };

    win.__v2Overlay = {
        show: () => paint(true),
        hide: () => paint(false),
        count: () => inflight,
        visible: () => painted,
        getLayer: () => layer,
        threshold,
        maxHold,
    };
    return true;
}
