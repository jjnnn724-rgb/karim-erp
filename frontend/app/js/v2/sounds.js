/**
 * V2 — «نغمات الوصول» · Arrival Sounds
 * ═══════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS IS
 *   الإشعار وصل — لكن الصمت يعني أنه لم يُلحظ. هذا الملف هو نغمة الوصول:
 *   نغمات مركّبة بالكامل عبر Web Audio (لا ملفات صوت، لا شبكة، لا تراخيص)،
 *   بنفس فلسفة AudioEngine في الشاشة القديمة لكن بعزل نغمي:
 *     priority  → نغمة انتباه ثلاثية للطلبات (صرف/شراء) — لا تُخطئها الأذن
 *     notify    → نغمة هادئة للإشعارات العامة
 *     success / warning / error → مرآة نوع الإشعار
 *
 * THE RULES
 *   1. مفتاح لكل جهاز (localStorage، كالمنادي — صفة السماعة لا صفة الحساب).
 *      الافتراضي مفعّل؛ زر في لوحة الجرس يكتم هذا الجهاز وحده.
 *   2. فتح الصوت بأول تفاعل (pointerdown/keydown) — سياسة التشغيل التلقائي
 *      في المتصفحات تشترط إيماءة؛ وفي APK الـ WebView يسمح تلقائيًا أصلًا
 *      (MainActivity.setMediaPlaybackRequiresUserGesture(false)).
 *   3. تباعد أدنى بين النغمات (1.2 ث) — انفجار إشعارات لا يصنع ضجيجًا.
 *      الأولوية تعبر الفاصل لكن لا تتراكم نغمات متلاصقة.
 *   4. الصوت يُشغَّل حتى والتبس خفي — غرضه أن يُسمع، لا أن يُرى.
 *   5. المستمعون لا يُزالون بعد أول إيماءة، ويُوقَظ السياق عند العودة إلى
 *      الصفحة: قفلُ الشاشة أو تبديلُ التطبيق يُعلّق السياق، ومستمعٌ أُزيل
 *      مرةً واحدة يترك الهاتفَ أصمَّ حتى إعادة تحميل الصفحة.
 *   6. شبكةُ أمانٍ من عنصر <audio> بنغمةٍ مُولَّدة في الذاكرة، واهتزازٌ قصير:
 *      Web Audio وحده لا يكفي على الموبايل (مفتاح الصامت، WebView، سياقٌ عالق).
 *
 * ROLLBACK
 *   أزل الاستيراد والاستدعاءين في layout/shell-extras.js — لا شيء آخر يمسّه.
 */

/** مفتاح كتم النغمات لهذا الجهاز. غيابه = 'on'. */
export const SOUND_PREF_KEY = 'karim_v2_sound';

/** أدنى تباعد بين نغمتين (مللي ثانية) — ضد انفجار الإشعارات. */
export const MIN_CUE_GAP_MS = 1200;

/** التعريفات النغمية — بيانات خالصة (هرتز/ثوان) لعقد الاختبار والضبط. */
export const CUES = Object.freeze({
  /* الانتباه: لا-دو-الصاعد الثلاثي السريع — مميزة عن كل نغمات النظام */
  priority: Object.freeze({
    gain: 0.16,
    notes: Object.freeze([
      Object.freeze({ f: 880.0, t: 0, d: 0.11 }),
      Object.freeze({ f: 1174.66, t: 0.09, d: 0.14 }),
      Object.freeze({ f: 1567.98, t: 0.19, d: 0.2 }),
    ]),
  }),
  /* الهادئة: مي الطويلة الوحيدة */
  notify: Object.freeze({
    gain: 0.11,
    notes: Object.freeze([Object.freeze({ f: 659.25, t: 0, d: 0.16 })]),
  }),
  success: Object.freeze({
    gain: 0.12,
    notes: Object.freeze([Object.freeze({ f: 523.25, t: 0, d: 0.1 }), Object.freeze({ f: 783.99, t: 0.09, d: 0.16 })]),
  }),
  warning: Object.freeze({
    gain: 0.13,
    notes: Object.freeze([Object.freeze({ f: 440.0, t: 0, d: 0.12 }), Object.freeze({ f: 440.0, t: 0.18, d: 0.12 })]),
  }),
  error: Object.freeze({
    gain: 0.13,
    notes: Object.freeze([Object.freeze({ f: 329.63, t: 0, d: 0.14 }), Object.freeze({ f: 246.94, t: 0.13, d: 0.2 })]),
  }),
});

/** نوع الإشعار (info/success/warning/error) → نغمة الوصول المكافئة. */
export function cueForType(type) {
  const map = { info: 'notify', success: 'success', warning: 'warning', error: 'error' };
  return map[String(type)] || 'notify';
}

/* ── تفضيل الجهاز ─────────────────────────────────────────────────── */

/**
 * التخزينُ الفعليّ: ما مرّره الاختبار، وإلا تخزينُ هذا المتصفح. الخيارُ صفةُ
 * الجهاز لا صفةُ الحساب — وقراءتُه من مخزنٍ غير مخزنِ الكتم تُبقي النغمةَ
 * مسموعةً رغم زرّ «مكتومة»، وهو عطلٌ صامت في شاشةٍ يُعوَّل فيها على الأذن.
 */
function storeOf(storage) {
  if (storage) {
    return storage;
  }
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readSoundPref(storage) {
  try {
    const s = storeOf(storage);
    return s && s.getItem(SOUND_PREF_KEY) === 'off' ? 'off' : 'on';
  } catch {
    return 'on';
  }
}

export function writeSoundPref(storage, pref) {
  try {
    const s = storeOf(storage);
    if (s) {
      s.setItem(SOUND_PREF_KEY, pref === 'off' ? 'off' : 'on');
    }
    return Boolean(s);
  } catch {
    return false;
  }
}

/* ── السياق الصوتي ────────────────────────────────────────────────── */

let ctx = null;

function audioCtxOf(env) {
  if (env && env.ctx) {
    return env.ctx;
  }
  if (ctx) {
    return ctx;
  }
  const win = (env && env.window) || (typeof window !== 'undefined' ? window : null);
  const AC = win ? win.AudioContext || win.webkitAudioContext : null;
  if (!AC) {
    return null;
  }
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** حالة السياق كما يُعلنها — «suspended» بعد القفل، و«interrupted» على iOS. */
function ctxStateOf(ac) {
  try {
    return String(ac.state || 'running');
  } catch {
    return 'running';
  }
}

/** إيقاظٌ لا يرمي ولا ينتظر: الوعدُ يُهمَل عن قصد — النغمةُ التالية تكشف النتيجة. */
function wakeCtx(ac) {
  if (!ac) {
    return;
  }
  try {
    if (typeof ac.resume === 'function' && ctxStateOf(ac) !== 'running') {
      const p = ac.resume();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          /* سيُعاد في الإيماءة التالية */
        });
      }
    }
  } catch {
    /* لا شيء — الصمت خيار مشروع */
  }
}

/* ── شبكةُ الأمان: نغمةٌ من WAV مُولَّد في الذاكرة ─────────────────────
   Web Audio يبقى الأصل (لا ملفات ولا شبكة)، لكنه على الهاتف يُسكَت في
   حالاتٍ حقيقية: سياقٌ عالقٌ في «suspended» بعد قفل الشاشة أو تبديل
   التطبيق، أو WebView لا يمنحه التشغيل التلقائي. عنصرُ <audio> مُفتوحٌ
   بإيماءة المستخدم يعزف حين يعجز السياق — وهو ما يجعل النغمة مسموعةً
   على الموبايل فعلًا. النغمةُ نفسُها تُركَّب PCM وتُغلَّف WAV مرة واحدة. */

const WAV_RATE = 8000;
const wavCache = new Map();
const audioCache = new Map();

/** النغمة كموجات WAV 16بت أحادية — بلا ملفٍ ولا طلب شبكة. */
function wavDataUri(spec) {
  try {
    const total = spec.notes.reduce((a, n) => Math.max(a, n.t + n.d), 0) + 0.06;
    const frames = Math.max(1, Math.ceil(total * WAV_RATE));
    const pcm = new Int16Array(frames);
    for (const note of spec.notes) {
      const start = Math.floor(note.t * WAV_RATE);
      const len = Math.floor(note.d * WAV_RATE);
      for (let i = 0; i < len && start + i < frames; i += 1) {
        const t = i / WAV_RATE;
        /* هجومٌ قصير ثم تلاشٍ أسّي — نغمةٌ لا طقطقة. */
        const env = Math.min(1, t / 0.012) * Math.exp(-t * 6.2);
        const at = start + i;
        pcm[at] = pcm[at] + Math.round(Math.sin(2 * Math.PI * note.f * t) * env * spec.gain * 32767);
      }
    }
    const bytes = new Uint8Array(44 + frames * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (off, text) => {
      for (let i = 0; i < text.length; i += 1) {
        bytes[off + i] = text.charCodeAt(i);
      }
    };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + frames * 2, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, WAV_RATE, true);
    view.setUint32(28, WAV_RATE * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, frames * 2, true);
    for (let i = 0; i < frames; i += 1) {
      view.setInt16(44 + i * 2, pcm[i], true);
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    const encode = typeof window !== 'undefined' ? window.btoa : null;
    return encode ? `data:audio/wav;base64,${encode(binary)}` : '';
  } catch {
    return '';
  }
}

function fallbackEl(kind, env) {
  const key = String(kind);
  const cached = audioCache.get(key);
  if (cached) {
    return cached;
  }
  const spec = CUES[key];
  if (!spec) {
    return null;
  }
  const Ctor = (env && env.Audio) || (typeof window !== 'undefined' ? window.Audio : null);
  if (!Ctor) {
    return null;
  }
  let uri = wavCache.get(key);
  if (!uri) {
    uri = wavDataUri(spec);
    if (!uri) {
      return null;
    }
    wavCache.set(key, uri);
  }
  let el = null;
  try {
    el = new Ctor(uri);
    el.preload = 'auto';
    if (typeof el.setAttribute === 'function') {
      el.setAttribute('playsinline', '');
    }
  } catch {
    /* عنصرٌ مرفوض لا يمنع النغمة التالية */
  }
  if (el) {
    audioCache.set(key, el);
  }
  return el;
}

/** تشغيلٌ صامتٌ داخل الإيماءة نفسها يفتح العنصر لما يأتي بعدها. */
function unlockFallback(env) {
  for (const kind of Object.keys(CUES)) {
    const el = fallbackEl(kind, env);
    if (!el) {
      continue;
    }
    const restore = () => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {
        /* */
      }
      try {
        el.volume = 1;
      } catch {
        /* */
      }
    };
    try {
      el.volume = 0;
      const p = el.play();
      if (p && typeof p.then === 'function') {
        p.then(restore).catch(restore);
      } else {
        restore();
      }
    } catch {
      restore();
    }
  }
}

function playFallback(kind, env) {
  const el = fallbackEl(kind, env);
  if (!el) {
    return false;
  }
  try {
    el.currentTime = 0;
    try {
      el.volume = 1;
    } catch {
      /* iOS يمسك مستوى الصوت */
    }
    const p = el.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        /* رفض تشغيلٍ تلقائيّ */
      });
    }
    return true;
  } catch {
    return false;
  }
}

/* الاهتزاز: مفتاحُ الصامت في الهاتف يُسكت النغمة، والاهتزازُ يبقى دليلًا
   ماديًّا على وصول الإشعار. لا يرمي أبدًا ولا يكسر إن لم يُدعم. */
const VIBRATION = Object.freeze({
  priority: Object.freeze([0, 120, 70, 120, 70, 180]),
  notify: Object.freeze([0, 45]),
  success: Object.freeze([0, 40]),
  warning: Object.freeze([0, 70, 60, 70]),
  error: Object.freeze([0, 110, 60, 110]),
});

function buzz(kind, env) {
  if (env && env.vibrate === false) {
    return false;
  }
  const nav = (env && env.navigator) || (typeof navigator !== 'undefined' ? navigator : null);
  try {
    if (nav && typeof nav.vibrate === 'function') {
      return nav.vibrate(VIBRATION[String(kind)] || VIBRATION.notify) !== false;
    }
  } catch {
    /* غير مدعوم */
  }
  return false;
}

/**
 * فتح/إيقاظ السياق الصوتي (idempotent). يُستدعى من كل إيماءة مستخدم ومن
 * عودة الصفحة إلى الواجهة، ومنه تُصدر كل النغمات لاحقًا. `true` = سياقٌ موجود.
 */
export function primeSound(env = {}) {
  const ac = audioCtxOf(env);
  wakeCtx(ac);
  /* العنصرُ الصوتي يُفتح في الإيماءة نفسها، فيبقى جاهزًا حين يعجز السياق. */
  unlockFallback(env);
  return Boolean(ac);
}

/** آخر لحظة نغمة فعلية — ضد التكدس. */
let lastCueAt = 0;

/** جدولةُ نغمةٍ على سياقٍ عامل — ترجع false إن عجز السياق عن البناء. */
function scheduleCue(ac, spec, env) {
  if (typeof ac.createOscillator !== 'function' || typeof ac.createGain !== 'function') {
    return false;
  }
  const t0 = Number(env.at) || ac.currentTime + 0.01;
  for (const note of spec.notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = note.f;
    const start = t0 + note.t;
    const end = start + note.d;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(spec.gain, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
  return true;
}

/**
 * تشغيل نغمة وصول. `true` = صدر شيء (نغمة أو اهتزاز) — لا يعني سُمِع بالضرورة.
 * لا يرمي استثناءً أبدًا — نغمة فائتة لا تكسر الجرس.
 */
export function playCue(kind, env = {}) {
  if (readSoundPref(env.storage) === 'off') {
    return false;
  }
  const key = String(kind);
  const spec = CUES[key] || null;
  if (!spec) {
    return false;
  }
  const now = Number(env.now) || Date.now();
  /* الأولويةُ تعبر الفاصل: طلبُ صرفٍ لا يُؤجَّل لأن إشعارًا عامًّا سبقه
       بجزءٍ من الثانية. الباقي يُباعد لئلا يصير الانفجارُ ضجيجًا. */
  if (!env.ignoreGap && key !== 'priority' && now - lastCueAt < MIN_CUE_GAP_MS) {
    return false;
  }
  lastCueAt = now;

  const ac = audioCtxOf(env);
  let played = false;
  /* السياقُ العالق لا يسمع شيئًا مهما جدولنا فيه — والعنصر الصوتي يعزف الآن. */
  if (ac && ctxStateOf(ac) === 'running') {
    try {
      played = scheduleCue(ac, spec, env);
    } catch {
      played = false;
    }
  }
  wakeCtx(ac);
  if (!played) {
    played = playFallback(key, env);
  }
  buzz(key, env);
  return played;
}

/**
 * مستمعو الإيماء والعودة (يُثبَّتون مرة عند إقلاع الشل) — يفتحون السياق.
 * يعيد دالة تنظيف (للـ disposers).
 */
export function installSoundUnlock(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || typeof w.addEventListener !== 'function') {
    return () => {};
  }
  /* لا يُزال المستمع بعد أول إيماءة: القفلُ أو تبديلُ التطبيق أو انتهاءُ
       مكالمةٍ يُعلّق السياق، ومستمعٌ أُزيل يترك الهاتف أصمَّ حتى إعادة تحميل. */
  const unlock = () => {
    primeSound();
  };
  const gestures = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'];
  for (const ev of gestures) {
    try {
      w.addEventListener(ev, unlock, { capture: true, passive: true });
    } catch {
      try {
        w.addEventListener(ev, unlock, true);
      } catch {
        /* محرك قديم */
      }
    }
  }
  const wake = () => {
    try {
      if (!w.document || w.document.visibilityState !== 'hidden') {
        primeSound();
      }
    } catch {
      primeSound();
    }
  };
  for (const ev of ['visibilitychange', 'pageshow', 'focus']) {
    try {
      w.addEventListener(ev, wake);
    } catch {
      /* */
    }
  }
  return () => {
    for (const ev of gestures) {
      try {
        w.removeEventListener(ev, unlock, true);
      } catch {
        /* */
      }
    }
    for (const ev of ['visibilitychange', 'pageshow', 'focus']) {
      try {
        w.removeEventListener(ev, wake);
      } catch {
        /* */
      }
    }
  };
}
