/**
 * v2-callout.test.js — «المنادي»: نداءٌ باسم صاحبه
 * ═════════════════════════════════════════════════════════════════════════
 * الفكرة: كل إشعار في النظام يصل لصاحبه أصلًا (notification-service يوجّه
 * بالدور والقسم والمستخدم عبر غرف Socket.IO). الناقص كان أن يناديه باسمه.
 *
 * ما يُثبَّت هنا هو العقد الذي يجعل الصوت آمنًا في مطعم شغّال:
 *   ١. الاسم — أول كلمةٍ من الاسم المسجَّل، والاسم الفارغ لا يُنطق.
 *   ٢. الشاشات الصامتة — الكاشير والتوتم لا ينطقان أبدًا، مهما وصل.
 *   ٣. الحصّة — ٣ نداءات/ساعة، ٢٠ ثانية بين الواحد والتالي.
 *   ٤. الصوت العربي — لا صوت عربي = صمت، لا عربيةٌ بلكنة لاتينية.
 *   ٥. عدم التكرار — السوكِت والاستطلاع يسلّمان نفس الصف، فيُنطق مرة واحدة.
 *   ٦. الوصل — realtime يبثّ v2:notification، والجرس ينادي، وpreview يعطيه الشاشة.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CALL = path.join(APP, 'js', 'v2', 'callout.js');
const SOUNDS = path.join(APP, 'js', 'v2', 'sounds.js');
const RT = path.join(APP, 'js', 'v2', 'realtime.js');
const EXTRAS = path.join(APP, 'js', 'v2', 'layout', 'shell-extras.js');
const PREVIEW = path.join(APP, 'js', 'v2', 'preview.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** تحميل وحدة ESM في سياق vm — نفس نمط tests/v2-routing.test.js. */
function loadCallout() {
    const names = [
        'VOICE_PREF_KEY', 'VOICE_LOG_KEY', 'MAX_PER_HOUR', 'MIN_GAP_MS', 'HOUR_MS',
        'VOICE_QUIET_KEY', 'QUIET_HOURS', 'readQuietPref', 'writeQuietPref', 'isQuietHour',
        'PRIORITY_CATEGORIES', 'MIN_PRIORITY_GAP_MS', 'isPriorityCategory',
        'SILENT_ROUTES', 'MAX_CALL_CHARS', 'firstName', 'salutation', 'callText',
        'isSilentRoute', 'readVoicePref', 'writeVoicePref', 'readVoiceLog', 'pushVoiceLog',
        'canSpeak', 'pickVoice', 'speak', 'announce',
        'VOICE_SEEN_KEY', 'VOICE_DEDUPE_MS', 'readVoiceSeen', 'pushVoiceSeen', 'isDuplicateCall',
        'speakableText', 'nativeTts', 'SPEECH_RATE', 'SPEECH_PITCH',
    ];
    const src = read(CALL)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '')
        + `\n;Object.assign(globalThis, {${names.join(', ')}});`;
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error, Set, Map, JSON,
        Date, Math, setTimeout, clearTimeout,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: CALL });
    return context;
}

const memoryStorage = (seed = {}) => {
    const data = { ...seed };
    return {
        data,
        getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
        setItem: (k, v) => { data[k] = String(v); },
    };
};

/** سينثس وهميّ: يسجّل ما طُلب نطقه، ويعلن صوتًا عربيًا. */
const fakeSynth = (voices) => {
    const spoken = [];
    return {
        spoken,
        getVoices: () => voices,
        speak: (u) => { spoken.push(u); },
        cancel: () => {},
    };
};
const AR_EG = { lang: 'ar-EG', name: 'Microsoft Hoda' };
const AR_SA = { lang: 'ar-SA', name: 'Microsoft Naayf' };
const EN_US = { lang: 'en-US', name: 'Microsoft Zira' };
class FakeUtterance {
    constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.rate = 1; this.pitch = 1; }
}

describe('المنادي — الاسم والنداء', () => {
    test('أول كلمةٍ من الاسم المسجَّل، ولا نداء بحرف', () => {
        const m = loadCallout();
        expect(m.firstName('عبداللطيف محمد')).toBe('عبداللطيف');
        expect(m.firstName('  عبداللطيف   محمد  ')).toBe('عبداللطيف');
        expect(m.firstName('')).toBe('');
        expect(m.firstName(null)).toBe('');
        expect(m.firstName('م')).toBe('');
        expect(m.salutation('عبداللطيف')).toBe('يا عبداللطيف');
        expect(m.salutation('')).toBe('');
    });

    test('نصّ النداء: اسمٌ + عنوان، والتفصيل إن بقي متّسع', () => {
        const m = loadCallout();
        expect(m.callText('عبداللطيف', 'طلب صرف جديد من المخزن بانتظار اعتمادك', ''))
            .toBe('يا عبداللطيف، طلب صرف جديد من المخزن بانتظار اعتمادك.');
        expect(m.callText('عبداللطيف', 'طلب صرف', 'ثلاثة أصناف'))
            .toBe('يا عبداللطيف، طلب صرف. ثلاثة أصناف.');
        expect(m.callText('', 'طلب صرف', '')).toBe('طلب صرف.');
        expect(m.callText('', '', '')).toBe('');
        // لا خطبة: السقف يُحترم، والقطع عند كلمة
        const long = m.callText('عبداللطيف', 'ا'.repeat(40) + ' ' + 'ب'.repeat(200), '');
        expect(long.length).toBeLessThanOrEqual(m.MAX_CALL_CHARS);
        expect(long.endsWith('…')).toBe(true);
    });

    test('الشاشات الصامتة: عميلٌ لا يسمع نداءً داخليًا', () => {
        const m = loadCallout();
        for (const key of m.SILENT_ROUTES) {
            expect({ key, silent: m.isSilentRoute(key) }).toEqual({ key, silent: true });
        }
        expect(m.isSilentRoute('REPORTS')).toBe(false);
        expect(m.isSilentRoute('')).toBe(false);
        expect(m.isSilentRoute(undefined)).toBe(false);
        // كل مفتاح صامت مسارٌ حقيقي في الراوتر — لا اسمٌ مخترع
        const routingSrc = strip(read(path.join(APP, 'js', 'v2', 'routing.js')));
        const navSrc = strip(read(path.join(APP, 'js', 'v2', 'layout', 'nav-model.js')));
        for (const key of m.SILENT_ROUTES) {
            const inRoutes = routingSrc.includes(`'${key}'`);
            const inNav = navSrc.includes(`'${key}'`);
            expect({ key, routed: inRoutes || inNav }).toEqual({ key, routed: true });
        }
    });
});

describe('المنادي — الحصّة والصوت', () => {
    test('٣ نداءات في الساعة، و٢٠ ثانية بينها', () => {
        const m = loadCallout();
        const now = 1_700_000_000_000;
        expect(m.canSpeak(now, [])).toEqual({ ok: true, reason: null });
        expect(m.canSpeak(now, [now - 5_000])).toEqual({ ok: false, reason: 'too-soon' });
        expect(m.canSpeak(now, [now - 60_000, now - 120_000, now - 180_000]))
            .toEqual({ ok: false, reason: 'hourly-quota' });
        // ما خرج من الساعة لا يُحتسب
        expect(m.canSpeak(now, [now - 3_600_001, now - 3_700_000, now - 3_800_000]))
            .toEqual({ ok: true, reason: null });
    });

    test('تفضيل الجهاز: مفعّل افتراضيًا، والكتم يُحترم ويُكتب', () => {
        const m = loadCallout();
        expect(m.readVoicePref(memoryStorage())).toBe('on');
        expect(m.readVoicePref(memoryStorage({ [m.VOICE_PREF_KEY]: 'off' }))).toBe('off');
        expect(m.readVoicePref(null)).toBe('on');
        const s = memoryStorage();
        expect(m.writeVoicePref(s, 'off')).toBe(true);
        expect(m.readVoicePref(s)).toBe('off');
        expect(m.writeVoicePref(s, 'on')).toBe(true);
        expect(m.readVoicePref(s)).toBe('on');
        // تخزين يرمي (وضع خاص) لا يكسر شيئًا
        const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
        expect(m.readVoicePref(broken)).toBe('on');
        expect(m.readVoiceLog(broken)).toEqual([]);
        expect(m.pushVoiceLog(broken, 1)).toBe(false);
    });

    test('السجلّ يحتفظ بالساعة الأخيرة فقط', () => {
        const m = loadCallout();
        const now = 1_700_000_000_000;
        const s = memoryStorage({ [m.VOICE_LOG_KEY]: JSON.stringify([now - 7_200_000, now - 1_000]) });
        expect(m.readVoiceLog(s, now)).toEqual([now - 1_000]);
        m.pushVoiceLog(s, now, now);
        expect(JSON.parse(s.data[m.VOICE_LOG_KEY])).toEqual([now - 1_000, now]);
        // سجلٌّ تالف لا يرمي
        expect(m.readVoiceLog(memoryStorage({ [m.VOICE_LOG_KEY]: 'not json' }), now)).toEqual([]);
    });

    test('الصوت العربي فقط: EG ثم أي عربي ثم صمت', () => {
        const m = loadCallout();
        expect(m.pickVoice([EN_US, AR_SA, AR_EG])).toBe(AR_EG);
        expect(m.pickVoice([EN_US, AR_SA])).toBe(AR_SA);
        expect(m.pickVoice([EN_US])).toBeNull();
        expect(m.pickVoice([])).toBeNull();
        expect(m.pickVoice(null)).toBeNull();
    });

    test('speak لا يرمي حين لا يوجد دعم', () => {
        const m = loadCallout();
        expect(m.speak('يا عبداللطيف', { synth: null, Utterance: FakeUtterance })).toBe(false);
        expect(m.speak('', { synth: fakeSynth([AR_EG]), Utterance: FakeUtterance })).toBe(false);
    });

    test('صوتٌ غير قابلٍ للتعيين لا يُسقط النداء — اللغة تكفي', () => {
        const m = loadCallout();
        class StrictUtterance {
            constructor(text) { this.text = text; this.lang = ''; this.rate = 1; this.pitch = 1; }
            set voice(_v) { throw new Error('not a real SpeechSynthesisVoice'); }
        }
        const synth = fakeSynth([AR_EG]);
        expect(m.speak('يا عبداللطيف', { synth, Utterance: StrictUtterance, voices: [AR_EG] })).toBe(true);
        expect(synth.spoken.length).toBe(1);
        expect(synth.spoken[0].lang).toBe('ar-EG');
    });
});

describe('المنادي — announce', () => {
    const notice = { name: 'عبداللطيف', title: 'طلب صرف جديد من المخزن بانتظار اعتمادك', message: '' };

    test('النداء السعيد: ينطق بالاسم وبصوت عربي', () => {
        const m = loadCallout();
        const synth = fakeSynth([EN_US, AR_EG]);
        const res = m.announce(notice, {
            synth, Utterance: FakeUtterance, voices: [EN_US, AR_EG],
            storage: memoryStorage({ [m.VOICE_QUIET_KEY]: 'off' }), log: [], route: 'dispatch', now: 1000,
        });
        expect(res.spoken).toBe(true);
        expect(res.text).toBe('يا عبداللطيف، طلب صرف جديد من المخزن بانتظار اعتمادك.');
        expect(synth.spoken.length).toBe(1);
        expect(synth.spoken[0].lang).toBe('ar-EG');
        expect(synth.spoken[0].voice).toBe(AR_EG);
    });

    test('كل بوابةٍ تمنع النطق بسببها المعلن', () => {
        const m = loadCallout();
        const base = {
            synth: fakeSynth([AR_EG]), Utterance: FakeUtterance, voices: [AR_EG],
            storage: memoryStorage({ [m.VOICE_QUIET_KEY]: 'off' }), log: [], route: 'dispatch', now: 1000,
        };
        expect(m.announce(notice, { ...base, route: 'cashier-sales' }).reason).toBe('silent-route');
        expect(m.announce(notice, { ...base, storage: memoryStorage({ [m.VOICE_PREF_KEY]: 'off' }) }).reason).toBe('muted');
        expect(m.announce(notice, { ...base, log: [990, 980, 970] }).reason).toBe('hourly-quota');
        expect(m.announce(notice, { ...base, log: [995] }).reason).toBe('too-soon');
        expect(m.announce(notice, { ...base, voices: [EN_US] }).reason).toBe('no-arabic-voice');
        expect(m.announce({ name: '', title: '', message: '' }, base).reason).toBe('empty');
        // ولم يُنطق شيء في أي حالة
        expect(base.synth.spoken.length).toBe(0);
    });

    test('مسار الأولوية: طلبٌ ذو تصنيف ينطق رغم امتلاء حصة الساعة (2026-10-31)', () => {
        const m = loadCallout();
        const now = 1_700_000_000_000;
        // canSpeak على الحدّ: العادية تمنع بالحصة، والأولوية تعبرها بفاصل ٤ ثوانٍ
        const saturated = [now - 60_000, now - 120_000, now - 180_000];
        const priorityOpts = { maxPerHour: Infinity, minGapMs: m.MIN_PRIORITY_GAP_MS };
        expect(m.canSpeak(now, saturated)).toEqual({ ok: false, reason: 'hourly-quota' });
        expect(m.canSpeak(now, saturated, priorityOpts)).toEqual({ ok: true, reason: null });
        expect(m.canSpeak(now, [now - 3_000], priorityOpts)).toEqual({ ok: false, reason: 'too-soon' });
        expect(m.canSpeak(now, [now - 4_001], priorityOpts)).toEqual({ ok: true, reason: null });
        // isPriorityCategory: قيم الخادم فقط، وغير مسموح = عادية
        expect(m.isPriorityCategory('dispatch')).toBe(true);
        expect(m.isPriorityCategory('procurement')).toBe(true);
        expect(m.isPriorityCategory('Dispatch')).toBe(true);
        expect(m.isPriorityCategory('alert')).toBe(false);
        expect(m.isPriorityCategory(null)).toBe(false);
        // announce: حصةٌ مكتملة لا تصمت طلبًا ذا أولوية
        const synth = fakeSynth([AR_EG]);
        const spoken = m.announce(
            { name: 'سيف', title: 'طلب صرف جديد', message: 'طلب صرف من المخازن — بانتظار اعتماد المخازن', category: 'dispatch' },
            {
                synth, Utterance: FakeUtterance, voices: [AR_EG],
                storage: memoryStorage(),
                log: [now - 60_000, now - 120_000, now - 180_000], // ٣/ساعة مكتملة
                route: 'dispatch', now,
            },
        );
        expect(spoken.spoken).toBe(true);
        expect(synth.spoken.length).toBe(1);
        // والأولوية لا تكسر الشاشات الصامتة — باب العميل مغلق دائمًا
        const silent = m.announce(
            { name: 'سيف', title: 'طلب صرف جديد', message: '', category: 'dispatch' },
            {
                synth, Utterance: FakeUtterance, voices: [AR_EG],
                storage: memoryStorage(), log: [now - 60_000, now - 120_000, now - 180_000],
                route: 'cashier-sales', now,
            },
        );
        expect(silent.spoken).toBe(false);
        expect(silent.reason).toBe('silent-route');
    });

    test('إشعار لا ينطق لا يكسر الجرس: لا استثناءات', () => {
        const m = loadCallout();
        const exploding = {
            getVoices() { throw new Error('boom'); },
            speak() { throw new Error('boom'); },
            cancel() { throw new Error('boom'); },
        };
        expect(() => m.announce(notice, { synth: exploding, Utterance: FakeUtterance, storage: null, log: [] })).not.toThrow();
        expect(() => m.announce(null, {})).not.toThrow();
    });
});

describe('المنادي — ساعات الهدوء (2026-11-02)', () => {
    /** وقتٌ بساعة محلية معلومة — كسر اعتماد الاختبار على منطقة الزمن. */
    const atLocalHour = (h, min = 0) => new Date(2026, 0, 15, h, min, 0, 0).getTime();
    const notice = { name: 'عبداللطيف', title: 'طلب صرف جديد من المخزن بانتظار اعتمادك', message: '' };

    test('النافذة تلتفّت حول منتصف الليل، وبدايتها داخلها ونهايتها خارجها', () => {
        const m = loadCallout();
        expect(m.QUIET_HOURS).toEqual({ start: 23, end: 7 });
        // 23 → 7
        expect(m.isQuietHour(atLocalHour(23))).toBe(true);
        expect(m.isQuietHour(atLocalHour(0))).toBe(true);
        expect(m.isQuietHour(atLocalHour(6, 59))).toBe(true);
        expect(m.isQuietHour(atLocalHour(7))).toBe(false);
        expect(m.isQuietHour(atLocalHour(22, 59))).toBe(false);
        expect(m.isQuietHour(atLocalHour(12))).toBe(false);
        // نافذة داخل اليوم الواحد
        expect(m.isQuietHour(atLocalHour(9), { start: 9, end: 17 })).toBe(true);
        expect(m.isQuietHour(atLocalHour(16), { start: 9, end: 17 })).toBe(true);  // 16 داخل 9..17
        expect(m.isQuietHour(atLocalHour(17), { start: 9, end: 17 })).toBe(false);
        expect(m.isQuietHour(atLocalHour(8), { start: 9, end: 17 })).toBe(false);
        // start === end = لا نافذة (صوت دائمًا)، وأي نافذة فاسدة لا تُصمت شيئًا
        expect(m.isQuietHour(atLocalHour(3), { start: 5, end: 5 })).toBe(false);
        expect(m.isQuietHour(atLocalHour(3), { start: 'x', end: 7 })).toBe(false);
        expect(m.isQuietHour(atLocalHour(3), null)).toBe(false);
    });

    test('مفتاح الهدوء للجهاز: مفعّل افتراضيًا، وتخزينٌ عاطل لا يكسر شيئًا', () => {
        const m = loadCallout();
        expect(m.readQuietPref(memoryStorage())).toBe('on');
        expect(m.readQuietPref(memoryStorage({ [m.VOICE_QUIET_KEY]: 'off' }))).toBe('off');
        expect(m.readQuietPref(null)).toBe('on');
        const broken = { getItem() { throw new Error('nope'); }, setItem() { throw new Error('nope'); } };
        expect(m.readQuietPref(broken)).toBe('on');
        expect(m.writeQuietPref(broken, 'off')).toBe(false);
        const s = memoryStorage();
        expect(m.writeQuietPref(s, 'off')).toBe(true);
        expect(m.readQuietPref(s)).toBe('off');
        expect(m.writeQuietPref(s, 'on')).toBe(true);
        expect(m.readQuietPref(s)).toBe('on');
    });

    test('ليلًا: النداء العادي صامت، والأولوية تتجاوز الهدوء', () => {
        const m = loadCallout();
        const night = atLocalHour(2);
        const env = (extra = {}) => ({
            synth: fakeSynth([AR_EG]), Utterance: FakeUtterance, voices: [AR_EG],
            storage: memoryStorage(), log: [], route: 'dispatch', now: night, ...extra,
        });
        // عادي + هدء مفعّل افتراضيًا → صمت معلن
        const quiet = m.announce(notice, env());
        expect(quiet.reason).toBe('quiet-hours');
        expect(quiet.spoken).toBe(false);
        // كتم الجهاز يسبق الهدوء (سببه هو المعلن)
        expect(m.announce(notice, env({ storage: memoryStorage({ [m.VOICE_PREF_KEY]: 'off' }) })).reason).toBe('muted');
        // الشاشة الصامتة تسبق الهدوء — باب العميل مغلق قبل أي حساب
        expect(m.announce(notice, env({ route: 'cashier-sales' })).reason).toBe('silent-route');
        // جهازٌ أطفأ الهدوء ينطق
        const off = m.announce(notice, env({ storage: memoryStorage({ [m.VOICE_QUIET_KEY]: 'off' }) }));
        expect(off.spoken).toBe(true);
        // الأولوية (صرف/شراء) تتجاوز الهدوء — لهذا يستيقظ أحد أصلًا
        const priority = m.announce(
            { ...notice, category: 'dispatch' },
            env(),
        );
        expect(priority.spoken).toBe(true);
        // نهارًا: عاديٌّ ينطق بلا تدخّل
        const day = m.announce(notice, env({ now: atLocalHour(12) }));
        expect(day.spoken).toBe(true);
    });
});

describe('المنادي — الوصل في القشرة', () => {
    test('realtime يبثّ v2:notification ويفكّه عند إعادة التركيب', () => {
        const src = strip(read(RT));
        expect(src).toMatch(/CustomEvent\('v2:notification'/);
        expect(src).toMatch(/\.on\('notification', acceptNotification\)/);
        expect(src).toMatch(/\.off\('notification', acceptNotification\)/);
    });

    test('الجرس ينادي مرة واحدة لكل معرّف، ولا ينطق عند أول رسم', () => {
        const src = strip(read(EXTRAS));
        expect(src).toMatch(/from '\.\.\/callout\.js\?v=[0-9.]+'/);
        // بوابة عدم التكرار
        expect(src).toMatch(/calledIds\.has\(id\)/);
        // أول قائمةٍ تُسجَّل بلا نطق: النطق مشروط بوجود القائمة السابقة
        expect(src).toMatch(/if \(seenNotifIds\) \{/);
        // المصدران: السوكِت والاستطلاع — وخط الأنابيب: نغمة الوصول أولًا
        // ثم المناداة مؤجلة 350ms (2026-10-31)
        expect(src).toMatch(/on\(window, 'v2:notification'/);
        expect(src).toMatch(/arrivalCue\(fresh\[0\]\)/);
        expect(src).toMatch(/speakLater\(fresh\[0\]\)/);
        expect(src).toMatch(/arrivalCue\(row\)/);
        // مفتاح الكتم في لوحة الإشعارات
        expect(src).toMatch(/data-v2-voice/);
        expect(src).toMatch(/writeVoicePref\(window\.localStorage/);
    });

    test('الجرس المصنّف: قنوات الأولوية تتجاوز الحصة والنغمة تنفصل عن النداء', () => {
        const callout = read(CALL);
        // قيم الأولوية متطابقة مع الخادم (notification-service.js)
        expect(callout).toMatch(/PRIORITY_CATEGORIES = Object\.freeze\(\['dispatch', 'procurement', 'transfers'\]\)/);
        expect(callout).toMatch(/MIN_PRIORITY_GAP_MS = 4_000/);
        expect(callout).toMatch(/isPriorityCategory/);
        // المسار: الأولوية بلا حصة (maxPerHour: Infinity) وفاصل قصير
        expect(callout).toMatch(/maxPerHour: Infinity, minGapMs: MIN_PRIORITY_GAP_MS/);
        // محرك النغمات: نغمة انتباه خاصة بالطلبات + فاصل ضد الانفجار
        const sounds = read(SOUNDS);
        expect(sounds).toMatch(/priority:/);
        expect(sounds).toMatch(/MIN_CUE_GAP_MS = 1200/);
        expect(sounds).toMatch(/SOUND_PREF_KEY = 'karim_v2_sound'/);
        const extras = strip(read(EXTRAS));
        // الجرس المصنّف: تبويبات القنوات + مفتاح كتم النغمة + الأولوية تُقرأ من الـ payload
        expect(extras).toMatch(/data-v2-tab/);
        expect(extras).toMatch(/data-v2-sound/);
        expect(extras).toMatch(/readSoundPref\(window\.localStorage/);
        expect(extras).toMatch(/isPriorityCategory\(notice && notice\.category\)/);
        expect(extras).toMatch(/playCue\(isPriority \? 'priority' : cueForType/);
    });

    test('ساعات الهدوء: مفتاحٌ للجهاز، زرٌّ في لوحة الجرس، وبوابةً تسبق الحصّة', () => {
        const callout = read(CALL);
        expect(callout).toMatch(/VOICE_QUIET_KEY = 'karim_v2_voice_quiet'/);
        expect(callout).toMatch(/QUIET_HOURS = Object\.freeze\(\{ start: 23, end: 7 \}\)/);
        // البوابة داخل announce بعد الكتم وقبل حصّة الساعة
        expect(callout).toMatch(/deny\('quiet-hours'\)/);
        expect(callout).toMatch(/!priority && quietPref === 'on' && isQuietHour\(now, env\.quietHours\)/);
        const extras = strip(read(EXTRAS));
        expect(extras).toMatch(/data-v2-quiet/);
        expect(extras).toMatch(/readQuietPref\(window\.localStorage/);
        expect(extras).toMatch(/writeQuietPref\(window\.localStorage/);
    });

    test('المضيف يمرّر الشاشة الحالية للمنادي', () => {
        const src = strip(read(PREVIEW));
        expect(src).toMatch(/getScreen: \(\) => navStatus\.current/);
    });
});

/* ── نداء الهاتف (2026-11-02) ────────────────────────────────────────────
   طلب المالك: صوتٌ «ذكيّ واحترافيّ» يصل الموظف على هاتفه، والتوكن يبقى
   على الجهاز ولا يخرج إلا بخروج. البلجن الأصلي (ArabicTts) هو ما يجعل
   الهاتف ينطق أصلًا: WebView على أندرويد بلا أصوات، فالنطق في المتصفح
   صمتٌ على الهاتف — وهذا هو سبب «الصوت واقعي»requirement. */
describe('المنادي — نداء الهاتف (المحرك الأصلي)', () => {
    const PLUGIN = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'karimerp', 'app', 'ArabicTtsPlugin.java');
    const MAIN = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'com', 'karimerp', 'app', 'MainActivity.java');
    const MANIFEST = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
    const LEGACY_RT = path.join(APP, 'js', 'realtime.js');
    const MAIN_JS = path.join(APP, 'js', 'main.js');

    test('المحرك الأصلي: بلجن مسجَّل باسم ArabicTts ومسجَّل في MainActivity', () => {
        const src = read(PLUGIN);
        expect(src).toMatch(/@CapacitorPlugin\(name = "ArabicTts"\)/);
        expect(src).toMatch(/public class ArabicTtsPlugin extends Plugin/);
        expect(src).toMatch(/new TextToSpeech\(getContext\(\)/);
        expect(read(MAIN)).toMatch(/registerPlugin\(ArabicTtsPlugin\.class\)/);
    });

    test('المحرك الأصلي: صوتٌ عربيّ فقط، وأفضل صوتٍ متاح (جودة + لهجة + شبكة)', () => {
        const src = read(PLUGIN);
        expect(src).toMatch(/"ar"\.equalsIgnoreCase\(loc\.getLanguage\(\)\)/);
        expect(src).toMatch(/v\.getQuality\(\) >= Voice\.QUALITY_HIGH/);
        expect(src).toMatch(/KEY_FEATURE_NETWORK_SYNTHESIS/);
        expect(src).toMatch(/new Locale\("ar", "EG"\)/);
    });

    test('المحرك الأصلي: لا يرمي — كل نداءٍ نتيجةٌ (نُطق أو سببُ تعذّر)', () => {
        const src = read(PLUGIN);
        expect(src).toMatch(/call\.resolve\(result\(false, "engine-timeout"\)\)/);
        expect(src).toMatch(/"engine-unavailable"/);
        expect(src).toMatch(/call\.resolve\(result\(true, ""\)\)/);
        expect(src).not.toMatch(/throw new RuntimeException/);
    });

    test('أندرويد 11+ يرى محرّك النطق: <queries> في المانيفست', () => {
        const xml = read(MANIFEST);
        expect(xml).toMatch(/<queries>/);
        expect(xml).toMatch(/android\.intent\.action\.TTS_SERVICE/);
    });

    test('المحرك الأصلي أوّلًا، والمتصفح احتياطًا — لا_engine بلا صوت', () => {
        const callout = loadCallout();
        const spoken = [];
        const native = { speak: (opts) => { spoken.push(opts); return Promise.resolve({ spoken: true }); } };
        expect(callout.nativeTts({ native })).toBe(native);
        expect(callout.speak('يا سيف، طلب صرف جديد', { native })).toBe(true);
        expect(spoken.length).toBe(1);
        expect(spoken[0].text).toBe('يا سيف، طلب صرف جديد.');
        expect(spoken[0].rate).toBe(callout.SPEECH_RATE);
        /* بلا بلجن: يعود إلى Web Speech */
        const synth = fakeSynth([AR_EG]);
        expect(callout.speak('يا سيف، طلب صرف جديد', { synth, Utterance: FakeUtterance, voices: [AR_EG] })).toBe(true);
        expect(synth.spoken.length).toBe(1);
    });

    test('النصّ يُهيّأ للنطق: عملاتٌ تُنطق، وأرقامٌ بلا فواصل، وتشكيلٌ يُمحى', () => {
        const callout = loadCallout();
        expect(callout.speakableText('طلب صرف 150 ر.س')).toContain('ريال');
        expect(callout.speakableText('إجمالي 1,250 ر.س')).toContain('1250');
        expect(callout.speakableText('مُحَمَّد')).toBe('محمد.');
        expect(callout.speakableText('وصل التوريد')).toBe('وصل التوريد.');
        expect(callout.speakableText('تسجيل https://x.test/a')).not.toContain('http');
        /* «ر.س» تُنطق، لكن كلمةً عربيةً تحوي الرمز تبقى كما هي */
        expect(callout.speakableText('درس الرياضيات')).toBe('درس الرياضيات.');
        expect(callout.speakableText('طلب ط.ع جديد')).toContain('طلب طلب جديد');
    });

    test('الإشعار نفسه لا يُنطق مرتين (بصمة محفوظة للجهاز)', () => {
        const callout = loadCallout();
        const store = memoryStorage();
        const native = { speak: () => Promise.resolve({ spoken: true }) };
        /* ساعةٌ معلومة نهارًا ونافذة هدوءٍ معطّلة: الاختبار للبصمة لا للساعة
           الحقيقية — ليلًا كان يرفض النداءَ بسببٍ غير سببه المعلن. */
        const now = new Date(2026, 0, 15, 12, 0, 0, 0).getTime();
        const env = { storage: store, native, now, quietHours: { start: 0, end: 0 } };
        const first = callout.announce({ id: 42, name: 'سيف', title: 'طلب صرف' }, env);
        expect(first.spoken).toBe(true);
        const second = callout.announce({ id: 42, name: 'سيف', title: 'طلب صرف' }, { ...env, now: now + 1000 });
        expect(second.spoken).toBe(false);
        expect(second.reason).toBe('duplicate');
        /* إشعارٌ آخر = نداءٌ جديد */
        const other = callout.announce({ id: 43, name: 'سيف', title: 'طلب شراء' }, { ...env, now: now + 2000 });
        expect(other.spoken).toBe(true);
    });

    test('واجهة التطبيق القديمة (الهاتف) تستعمل المحرك المشترك نفسه', () => {
        const main = strip(read(MAIN_JS));
        expect(main).toMatch(/window\.KarimCallout = \{/);
        expect(main).toMatch(/from '\.\/v2\/callout\.js\?v=[0-9.]+'/);
        const rt = strip(read(LEGACY_RT));
        expect(rt).toMatch(/window\.KarimCallout/);
        expect(rt).toMatch(/engine\.announce\(/);
    });

    test('التوكن لا يمسّ المحرك الصوتي — النطق محليٌّ بالكامل', () => {
        const src = read(PLUGIN);
        expect(src).not.toMatch(/jwt|token|Authorization|api-key/i);
    });
});
