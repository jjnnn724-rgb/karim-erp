/**
 * V2 — «المنادي» · Callout
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   Every notification in this system already reaches the right person on the
 *   right device (backend/notification-service.js routes by role, department
 *   and user over Socket.IO rooms). What was missing is the one thing that
 *   makes a notification an *errand*: it called nobody by name.
 *
 *   This module turns the row into a call:
 *     «يا عبداللطيف، طلب صرف جديد من المخزن بانتظار اعتمادك.»
 *
 *   The name is the signed-in user's own registered name (`users.name`), so
 *   the warehouse manager, the HR head and the chef each hear their own name
 *   on their own device — never one broadcast text for everybody.
 *
 * WHY IT IS CLIENT-SIDE
 *   The name is already in the session. Sending it from the server would mean
 *   one row per recipient (it already is), a schema column, and a migration —
 *   all to repeat a string the browser already holds. Speech synthesis is a
 *   browser capability too (Web Speech API): no audio files, no network, no
 *   per-word cost, and nothing leaves the device.
 *
 * THE RULES (a voice in a working restaurant is a loaded gun)
 *   1. Muted by default? No — the owner asked that everyone hears their name,
 *      so the default is ON. But one tap silences this device for good
 *      (localStorage, per device, not per user: it is a property of the
 *      speaker in the room, not of the account).
 *   2. Customer-facing screens are silent, always: the cashier, the POS, the
 *      menu board, the goods scanner, the sign-in. A guest must never hear
 *      «يا عبداللطيف».
 *   3. Three calls per hour, twenty seconds apart — for ordinary notices.
 *      Priority requests (dispatch/procurement — category from the server
 *      payload) bypass the quota and always speak, with only a 4-second
 *      anti-overlap gap. The bell and the card still arrive regardless.
 *      Notification fatigue buries a system faster than any bug.
 *   4. Arabic voice only. No Arabic voice on the machine → silence, not
 *      gibberish read by a Latin voice.
 *   5. Nothing is spoken before the user's first paint of a *known* list, so
 *      a page reload never replays yesterday's calls.
 *   6. Quiet hours (2026-11-02, Phase 2): 23:00 → 07:00 local time the
 *      ordinary call stays on the screen and out of the room. Priority
 *      notices and escalation traffic still speak — they are the reason
 *      somebody is awake. Per device, one tap (`VOICE_QUIET_KEY='off').
 *
 * ROLLBACK
 *   Remove the import + the two calls in layout/shell-extras.js. The bell,
 *   the cards and the server routing are untouched by this file.
 */

/** Per-device speaker switch. Absent = 'on'. */
export const VOICE_PREF_KEY = 'karim_v2_voice';
/** Timestamps (ms) of the calls this device actually made. */
export const VOICE_LOG_KEY = 'karim_v2_voice_log';
/**
 * (2026-11-02 · المرحلة التانية) مفتاح «ساعات الهدوء» لكل جهاز.
 * الغياب = الميزة مفعّلة (افتراضيًا) — النداء العادي يصمت ليلًا، ويبقى
 * صوت الأولوية (طلب صرف/شراء) وحده الذي يتجاوز الهدوء.
 */
export const VOICE_QUIET_KEY = 'karim_v2_voice_quiet';
/**
 * (2026-11-02 · نداء الهاتف) إشعارات سبق نطقها — بصمة الإشعار (id) مع
 * وقت نطقه. إعادة وصول الإشعار نفسه (إعادة اتصال السوكت مثلًا) لا تُنطق
 * مرتين: صوتٌ مكرّر يُفقد النداء معناه ويُزعج الغرفة.
 */
export const VOICE_SEEN_KEY = 'karim_v2_voice_seen';

/** مهلة النطق: نداءٌ واحد يتجاوزها يُعدّ ملغى (لا يعيد الجرس). */
export const VOICE_DEDUPE_MS = 5 * 60 * 1000;

/** نافذة الهدوء بالساعة المحلية — تلتفّت حول منتصف الليل (23 → 7). */
export const QUIET_HOURS = Object.freeze({ start: 23, end: 7 });

export const MAX_PER_HOUR = 3;
export const MIN_GAP_MS = 20_000;
export const HOUR_MS = 3_600_000;

/** (2026-10-31) تصنيفات الأولوية — تتجاوز حصة الساعة وتنطق فورًا دائمًا.
    قيمها نفس قيم backend/notification-service.js PRIORITY_CATEGORIES. */
export const PRIORITY_CATEGORIES = Object.freeze(['dispatch', 'procurement', 'transfers']);
/** أدنى فاصل بين نداءين ذوي أولوية — ضد التراكب، لا ضد التذكير. */
export const MIN_PRIORITY_GAP_MS = 4_000;

export function isPriorityCategory(category) {
    return PRIORITY_CATEGORIES.includes(String(category || '').trim().toLowerCase());
}

/** لا صوت على شاشةٍ يراها عميل. المفاتيح هي نفسها مفاتيح التوجيه. */
export const SILENT_ROUTES = Object.freeze([
    'login',
    'pos',
    'cash-register',
    'cashier-sales',
    'cashier-monitor',
    'menu-board',
    'goods-scan',
]);

/** أقصى طولٍ للنداء: جملةٌ واحدة تُفهم، لا خطبة. */
export const MAX_CALL_CHARS = 140;

const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/**
 * أول كلمةٍ من الاسم المسجَّل — «عبداللطيف محمد» ← «عبداللطيف».
 * الاسم الكامل في النداء يبدو كخطابٍ رسمي؛ أول كلمةٍ هي النداء.
 */
export function firstName(name) {
    const full = clean(name);
    if (!full) {return '';}
    const first = full.split(' ')[0];
    /* حرفٌ واحد ليس اسمًا يُنادى به («م»)، فيُترك النداء بلا اسم. */
    return first.length >= 2 ? first : '';
}

export function salutation(name) {
    const first = firstName(name);
    return first ? `يا ${first}` : '';
}

/**
 * نص النداء: «يا فلان، <العنوان>. <التفصيل>».
 * العنوان هو الرسالة؛ التفصيل يُضاف فقط إن بقي متّسع.
 */
export function callText(name, title, message) {
    const head = salutation(name);
    const body = clean(title) || clean(message);
    if (!body) {return '';}
    const parts = [];
    if (head) {parts.push(head);}
    parts.push(/[.!؟]$/.test(body) ? body : `${body}.`);
    const detail = clean(title) ? clean(message) : '';
    let text = parts.join('، ');
    if (detail && text.length + detail.length + 2 <= MAX_CALL_CHARS) {
        text += ` ${/[.!؟]$/.test(detail) ? detail : `${detail}.`}`;
    }
    if (text.length > MAX_CALL_CHARS) {
        const cut = text.slice(0, MAX_CALL_CHARS);
        text = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).trim()}…`;
    }
    return text;
}

/** هل هذه الشاشة صامتة بطبيعتها؟ */
export function isSilentRoute(route) {
    return SILENT_ROUTES.includes(clean(route).toLowerCase());
}

/* ── النصّ الذي يُنطق (2026-11-02 · نداء الهاتف) ─────────────────────────
   «واقعي واحترافي» لا يعني صوتًا فقط: يعني أن يُقال ما يُقصد. نصُّ
   الجدول يحمل رموزًا لا يقرأها النطق الجيد — «ر.س»، «ط.ع»، «1,200»،
   التشكيل، الإيموجي — فتخرج من الفم مركّبةً غريبة. التطبيع أدناه يحوّل
   الرموز إلى ما يقوله الناس فعلًا، بلا أن يغيّر معنى الجملة. */

/**
 * اختصارات تُنطق كما تُقال، لا كما تُكتب في الجداول.
 * ملاحظة: `\b` في JavaScript حدودُ ASCII (`\w` = حروف لاتينية وأرقام فقط)،
 * فلا يطابق حرفًا عربيًّا أبدًا — Hence the manual boundary check below.
 */
const SPEECH_TOKENS = Object.freeze([
    ['ر.س', 'ريال'], ['ر س', 'ريال'],
    ['ج.م', 'جنيه'], ['ج م', 'جنيه'],
    ['د.إ', 'درهم'], ['د إ', 'درهم'],
    ['ر.ع', 'ريال'], ['ر ع', 'ريال'],
    ['ط.ع', 'طلب'], ['ط ع', 'طلب'],
    ['ط.ج', 'تجهيز'], ['ط ج', 'تجهيز'],
]);

/** رموزٌ تُنطق كما تُقرأ. */
const SPEECH_SYMBOLS = Object.freeze([
    [/\$/g, ' دولار'],
    [/€/g, ' يورو'],
    [/£/g, ' جنيه'],
]);

/** حرفٌ عربي (أو حرفٌ من امتداداته) — حدودُ الكلمة العربية. */
const ARABIC_WORD = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * يستبدل رمزًا داخل كلمة عربية فقط: «ر.س» تُنطق «ريال»، لكن «درس» تبقى
 * «درس» — الحدّ على الحرفين المجاورين لا على `\b`.
 */
function replaceToken(text, token, spoken) {
    if (!text.includes(token)) {return text;}
    let out = '';
    let i = 0;
    while (i < text.length) {
        const at = text.indexOf(token, i);
        if (at < 0) {out += text.slice(i); break;}
        const before = at > 0 ? text.charAt(at - 1) : '';
        const after = text.charAt(at + token.length) || '';
        out += text.slice(i, at);
        if ((!before || !ARABIC_WORD.test(before)) && (!after || !ARABIC_WORD.test(after))) {
            out += spoken;
        } else {
            out += token;
        }
        i = at + token.length;
    }
    return out;
}

/** تشكيلٌ وتطويلٌ لا يحملان معنى في النطق. */
const ARABIC_DIACRITICS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
/* الإيموجي وناقلُ التشكيل (ZWJ) ومُغيّرُ العرض (VS16) في صنفَين لا صنفٍ
   واحد: بوابة ESLint ترفض الخلط، فالأولُ رموزُ كاملة والثاني علاماتٌ
   تتعلّق بما قبلها — والمقصود واحد: لا يقرأ الفمُ شيئًا من هذا. */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]|[\u{FE0F}\u{200D}]/gu;
const URL_RE = /\bhttps?:\/\/\S+/gi;

/**
 * يحوّل نصًّا مكتوبًا إلى نصٍّ يُنطق نطقًا سليمة.
 * @param {string} text
 * @returns {string}
 */
export function speakableText(text) {
    let s = clean(text);
    if (!s) {return '';}
    s = s.replace(EMOJI, ' ').replace(URL_RE, ' ');
    s = s.replace(ARABIC_DIACRITICS, '');
    /* فاصل الآلاف يُقرأ «اثنان بعد ألف ومئتان» في بعض المحركات ⇒ تُحذف. */
    s = s.replace(/(\d),(\d{3})\b/g, '$1$2');
    for (const [token, spoken] of SPEECH_TOKENS) {s = replaceToken(s, token, spoken);}
    for (const [re, to] of SPEECH_SYMBOLS) {s = s.replace(re, to);}
    s = clean(s).replace(/\s+([،.؟!])/g, '$1');
    /* نهايةٌ سليمة تُريّح نبرة الصوت (جملةٌ بلا سكون تُقرأ كترديد). */
    if (!/[.!؟…]$/.test(s)) {s += '.';}
    return s;
}

/* ── التخزين: تفضيل الجهاز وسجلّ الحصّة ─────────────────────────────── */

export function readVoicePref(storage) {
    try {
        return storage && storage.getItem(VOICE_PREF_KEY) === 'off' ? 'off' : 'on';
    } catch {
        return 'on';
    }
}

export function writeVoicePref(storage, pref) {
    try {
        if (storage) {storage.setItem(VOICE_PREF_KEY, pref === 'off' ? 'off' : 'on');}
        return true;
    } catch {
        return false;
    }
}

/* ── ساعات الهدوء (2026-11-02) ────────────────────────────────────────
   لماذا ليلًا؟ المطعم لا ينام كلّه، لكن النداء العادي («وصل توريد»)
   ليس سببًا كافيًا للاستيقاظ الساعة الثالثة. أولوية الصرف/الشراء
   والحالات المُصعَّدة تتجاوز الهدوء — الإجراء المطلوب أهمّ من الهدوء.
   المفتاح للجهاز لا للحساب: صفة السماعة في الغرفة، كبقية المفاتيح. */

export function readQuietPref(storage) {
    try {
        return storage && storage.getItem(VOICE_QUIET_KEY) === 'off' ? 'off' : 'on';
    } catch {
        return 'on';
    }
}

export function writeQuietPref(storage, pref) {
    try {
        if (storage) {storage.setItem(VOICE_QUIET_KEY, pref === 'off' ? 'off' : 'on');}
        return true;
    } catch {
        return false;
    }
}

/**
 * هل الحين داخل نافذة الهدوء؟ تُحسب بساعة الجهاز المحلية — الشخص في
 * الغرفة هو المرجع لا UTC. النافذة قد تلتفّت حول منتصف الليل، و`start
 * === end` تعني «لا نافذة» فلا يُصمت شيء.
 *
 * @param {number} [now] ms منذ الحقبة
 * @param {{start:number,end:number}} [window]
 */
export function isQuietHour(now = Date.now(), window = QUIET_HOURS) {
    const start = Number(window && window.start);
    const end = Number(window && window.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) {return false;}
    let hour;
    try {hour = new Date(Number(now) || Date.now()).getHours();} catch {return false;}
    if (!Number.isFinite(hour)) {return false;}
    return start > end
        ? (hour >= start || hour < end)   // 23 → 7: تجاوز منتصف الليل
        : (hour >= start && hour < end);  // نافذة داخل اليوم الواحد
}

/** السجلّ الحقيقي فقط: أرقامٌ داخل الساعة الأخيرة، والأقدم يُهمَل. */
export function readVoiceLog(storage, now = Date.now()) {
    try {
        const raw = storage ? storage.getItem(VOICE_LOG_KEY) : null;
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) {return [];}
        return list.map(Number).filter((t) => Number.isFinite(t) && t > 0 && now - t < HOUR_MS);
    } catch {
        return [];
    }
}

export function pushVoiceLog(storage, at, now = Date.now()) {
    try {
        if (!storage) {return false;}
        const list = readVoiceLog(storage, now);
        list.push(Number(at) || now);
        storage.setItem(VOICE_LOG_KEY, JSON.stringify(list.slice(-MAX_PER_HOUR * 4)));
        return true;
    } catch {
        return false;
    }
}

/* ── بصمة النداء: لا يُنطق الإشعار الواحد مرتين ───────────────────────────
   إعادة اتصال السوكت أو تكرار الإرسال قد يُعيد الإشعار نفسه؛ نُنطقه مرّةً واحدة
   ونصمت في الثانية. المفتاح للجهاز، والTTL يخرج البصمة القديمة تلقائيًا. */

export function readVoiceSeen(storage, now = Date.now()) {
    try {
        const raw = storage ? storage.getItem(VOICE_SEEN_KEY) : null;
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) {return [];}
        return list
            .filter((e) => e && Number(e.at) > 0 && now - Number(e.at) < VOICE_DEDUPE_MS)
            .map((e) => String(e.id));
    } catch {
        return [];
    }
}

export function pushVoiceSeen(storage, id, now = Date.now()) {
    try {
        if (!storage || !id) {return false;}
        const list = readVoiceSeen(storage, now);
        list.push(String(id));
        storage.setItem(VOICE_SEEN_KEY, JSON.stringify(
            list.slice(-40).map((x) => ({id: x, at: now})),
        ));
        return true;
    } catch {
        return false;
    }
}

/** هل نُطق هذا الإشعار خلال المهلة؟ */
export function isDuplicateCall(storage, id, now = Date.now()) {
    if (!id) {return false;}
    return readVoiceSeen(storage, now).includes(String(id));
}

/**
 * بوابة الحصّة. تُقاس على نيّة النداء لا على نجاحه: جهازٌ بلا صوتٍ عربي
 * لا يفتح الباب لنداءٍ رابع. النداء ذو الأولوية (طلبات صرف/شراء) يستدعيها
 * بحصّة غير محدودة وفاصلٍ أقصر — الإجراء المطلوب أهم من حماية الأذن.
 */
export function canSpeak(now, log, opts = {}) {
    /* الأولوية تمرر Infinity صراحةً — Number.isFinite(Infinity) تساوي false
       فلا يُعتمد عليها في الكشف، والمقارنة المباشرة هي العقد. */
    const max = opts.maxPerHour === Infinity || Number.isFinite(opts.maxPerHour)
        ? opts.maxPerHour
        : MAX_PER_HOUR;
    const gap = Number(opts.minGapMs) || MIN_GAP_MS;
    const list = (Array.isArray(log) ? log : [])
        .map(Number)
        .filter((t) => Number.isFinite(t) && t > 0 && now - t < HOUR_MS);
    if (list.length >= max) {return { ok: false, reason: 'hourly-quota' };}
    const last = list.length ? Math.max(...list) : 0;
    if (last && now - last < gap) {return { ok: false, reason: 'too-soon' };}
    return { ok: true, reason: null };
}

/* ── الصوت ─────────────────────────────────────────────────────────── */

/** صوتٌ عربي فقط. غيابه يعني صمتًا، لا عربيةً بلكنة لاتينية. */
export function pickVoice(voices) {
    const list = Array.isArray(voices) ? voices : [];
    const arabic = list.filter((v) => v && /^ar\b/i.test(String(v.lang || '')));
    if (!arabic.length) {return null;}
    /* الترتيب: مصر ثم الخليج ثم أيّ عربي — أقرب لهجةٍ تسبق الأبعد. */
    return arabic.find((v) => /[-_]EG\b/i.test(String(v.lang || '')))
        || arabic.find((v) => /egypt|مصر/i.test(String(v.name || '')))
        || arabic.find((v) => /[-_]SA\b/i.test(String(v.lang || '')))
        || arabic.find((v) => /[-_]AE\b/i.test(String(v.lang || '')))
        || arabic[0];
}

/**
 * جسر النطق الأصلي (أندرويد) — بلجن `ArabicTts`.
 * WebView على أندرويد لا يعرض أصواتًا عادةً: لا قائمة أصوات، فلا نطق.
 * المحرك الأصلي (TextToSpeech) هو الوحيد الذي يقدّم صوتًا عربيًا حقيقيًا
 * على الهاتف — صوت الجهاز، بلا شبكة ولا خدمة خارجية. وغيابه يعني: نكتفي
 * بما يقدّمه المتصفح.
 */
export function nativeTts(env = {}) {
    if (env && env.native) {return env.native;}
    try {
        const cap = typeof window !== 'undefined' ? window.Capacitor : null;
        return cap && cap.Plugins ? (cap.Plugins.ArabicTts || null) : null;
    } catch {
        return null;
    }
}

/** سرعة النطق: أوضح قليلًا من الطبيعي — المطبخ صاخب. */
export const SPEECH_RATE = 0.95;
/** طبقة الصوت: لا نبرات حادّة ولا رنانة — صوت «نداء عمل» لا إعلان. */
export const SPEECH_PITCH = 1.0;

function synthOf(env) {
    if (env.synth) {return env.synth;}
    return typeof window !== 'undefined' ? window.speechSynthesis : null;
}

function utteranceOf(env) {
    if (env.Utterance) {return env.Utterance;}
    return typeof window !== 'undefined' ? window.SpeechSynthesisUtterance : null;
}

function safeVoices(synth) {
    try {
        const list = typeof synth.getVoices === 'function' ? synth.getVoices() : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/* ── قائمة الأصوات على الهاتف (2026-11-02) ───────────────────────────────
   محرك المتصفح يردّ قائمةً فارغة عند أول سؤالٍ له: الأصواتُ تُحمَّل بعد
   أول رسمٍ للصفحة، وعلى أندرويد بعد أول إيماءة مستخدم. من يسأل في تلك
   اللحظة يسمع صمتًا — والنداء الأول هو أشدُّ النداءات حاجةً إلى السماع.
   الحلُّ سماعُ التحديث لا سؤالُ المحرك: نستمع إلى `voiceschanged` مرةً
   واحدة عند استيراد الوحدة، ونخزّن آخر قائمة صحيحة، فيكون النداء الأول
   كالثامن. لا تغيير في القاعدة: صوتٌ عربيٌّ أو صمت — القائمة الفارغة
   «غير معروفة» لا «لا يوجد عربي». */
let voiceCache = [];
let voicesWired = false;

/** يقرأ الأصوات من المحرك ويحدّث المخزّن منها. لا يرمي أبدًا. */
export function refreshVoices(env = {}) {
    const list = safeVoices(synthOf(env));
    if (list.length) {voiceCache = list;}
    return list;
}

/** يربط المستمع مرة واحدة لكل محرك. يعيد false حين لا يوجد محرك. */
export function watchVoices(env = {}) {
    const synth = synthOf(env);
    if (!synth || voicesWired) {return Boolean(synth);}
    voicesWired = true;
    refreshVoices(env);
    if (typeof synth.addEventListener === 'function') {
        try {
            synth.addEventListener('voiceschanged', () => refreshVoices(env));
        } catch { voicesWired = false; }
    }
    return true;
}

/** آخرُ ما عُرف من أصوات المحرك (للتشخيص ولعرض حالة الصوت في القشرة). */
export function knownVoices() {
    return voiceCache;
}

function speakNow(text, env) {
    const synth = synthOf(env);
    const Utterance = utteranceOf(env);
    if (!synth || typeof synth.speak !== 'function' || typeof Utterance !== 'function') {return false;}
    const voice = pickVoice(env.voices || voiceCache || safeVoices(synth));
    if (!voice) {return false;}
    try {
        const u = new Utterance(text);
        u.lang = voice.lang || 'ar-EG';
        /* تعيين الصوت قد يرمي إن لم يكن SpeechSynthesisVoice حقيقيًا (كائنٌ من
           عالمٍ آخر أو صوتٌ اختفى بين القراءة والنطق). اللغة وحدها تكفي، فلا
           نُسقط النداء من أجل تزيين الصوت. */
        try {u.voice = voice;} catch { /* lang is enough */ }
        u.rate = 1;
        u.pitch = 1;
        if (typeof synth.cancel === 'function') {synth.cancel();} // لا تصطفّ نداءات فاتت
        synth.speak(u);
        return true;
    } catch {
        return false;
    }
}

/**
 * ينطق النصّ. `true` تعني «طُلب النطق» — لا «سُمِع»؛ المتصفح قد يمنع الصوت
 * قبل أول تفاعل، وحينها نصمت بلا استثناء.
 *
 * المسار: المحرك الأصلي على الهاتف (صوت عربي واقعي) ← ثم Web Speech في
 * المتصفح. ولا مسار يرمي استثناءً.
 */
export function speak(text, env = {}) {
    const said = speakableText(text);
    if (!said) {return false;}
    const native = nativeTts(env);
    if (native && typeof native.speak === 'function') {
        try {
            const p = native.speak({ text: said, rate: SPEECH_RATE, pitch: SPEECH_PITCH });
            if (p && typeof p.catch === 'function') {p.catch(() => {});}
            return true;
        } catch { /* native down ⇒ web engine */ }
    }
    const synth = synthOf(env);
    if (!synth) {return false;}
    if (!env.voices && !voiceCache.length && !safeVoices(synth).length
        && typeof synth.addEventListener === 'function' && !env.noWait) {
        /* قائمة الأصوات تُحمَّل بعد أول رسم. ننتظر أول تحديثٍ مرة واحدة،
           مع سقفٍ زمنيّ حتى لا يعلّق النداء. */
        let done = false;
        const retry = () => {
            if (done) {return;}
            done = true;
            speakNow(said, env);
        };
        try {synth.addEventListener('voiceschanged', retry, { once: true });} catch { /* older engines */ }
        try {setTimeout(retry, 1200);} catch { return false; }
        return true;
    }
    return speakNow(said, env);
}

/**
 * النداء الكامل: اسمٌ + نصّ + بوابة. لا يرمي استثناءً أبدًا — إشعارٌ لا
 * ينطق يجب ألّا يكسر الجرس.
 *
 * @param {{id?:string|number,name?:string,title?:string,message?:string,category?:string}} notice
 * @param {{pref?:string, quiet?:'on'|'off', quietHours?:{start:number,end:number},
 *          log?:number[], route?:string, now?:number, native?:object,
 *          synth?:object, Utterance?:Function, voices?:Array, storage?:object}} env
 * @returns {{spoken:boolean, reason:string|null, text:string, at:number|null}}
 */
export function announce(notice, env = {}) {
    const now = Number(env.now) || Date.now();
    const text = callText(notice && notice.name, notice && notice.title, notice && notice.message);
    const deny = (reason) => ({ spoken: false, reason, text, at: null });
    if (!text) {return deny('empty');}
    if (isSilentRoute(env.route)) {return deny('silent-route');}
    if (readVoicePref(env.storage) === 'off' || env.pref === 'off') {return deny('muted');}
    /* الإشعار نفسه مرّةً واحدة: تكرار الوصول لا يُعاد نطقه. */
    const noticeId = notice && notice.id != null ? String(notice.id) : '';
    if (noticeId && isDuplicateCall(env.storage, noticeId, now)) {return deny('duplicate');}
    /* مسار الأولوية يُحسب مرة واحدة: يتجاوز الحصّة وتجاوز الهدوء. */
    const priority = isPriorityCategory(notice && notice.category);
    const quietPref = env.quiet === 'on' || env.quiet === 'off'
        ? env.quiet
        : readQuietPref(env.storage);
    if (!priority && quietPref === 'on' && isQuietHour(now, env.quietHours)) {
        return deny('quiet-hours');
    }
    /* مسار الأولوية: حصّة الساعة لا تنطبق عليه — فاصل صغير ضد التراكب فقط */
    const gate = canSpeak(now, env.log || [], priority
        ? { maxPerHour: Infinity, minGapMs: MIN_PRIORITY_GAP_MS }
        : {});
    if (!gate.ok) {return deny(gate.reason);}
    if (!speak(text, env)) {return deny('no-arabic-voice');}
    /* البصمة تُسجَّل بعد القبول لا قبله: ندادٌ لم يُنطق (لا صوت عربي)
       لا يحرم الإشعار نفسه من النطق في المرّة التالية. */
    if (noticeId) {pushVoiceSeen(env.storage, noticeId, now);}
    return { spoken: true, reason: null, text, at: now };
}

/* السماع يبدأ مع استيراد الوحدة لا مع أول إشعار: من يسأل المحرك عن أصواته
   في لحظةٍ فارغة يخسر النداء، ومن يستمع إلى تحديثها لا يخسر شيئًا. وفي
   سياقٍ بلا نافذة (اختبارٌ في vm) لا تُلمس أيّ عابرة عامة. */
try {watchVoices();} catch { /* لا محرك نطق هنا */ }
