/**
 * V2 — Shell extras · الجرس واللمبات واللغة والأزرار السريعة (W5)
 * ═══════════════════════════════════════════════════════════════════════
 * Mirrors the legacy shell chrome (index.html:55/76-101/187/208 + app.js
 * bell/FAB + auth-navigation toggleLang/password): notification bell for
 * admin (same doors), server/DB lamps from /health, AR/EN direction switch
 * on the same localStorage key (karim-i18n.js:32 — V2 screens stay Arabic-
 * first, the switch is shell-level), quick buttons (POS/menu/dispatch per
 * role), FAB with the same 4 role-gated actions, change-password dialog
 * with the same field names, offline bar on online/offline events.
 * Everything is additive: no legacy file is touched.
 */

import {
    fetchNotifications, markNotificationsRead,
    markAllNotificationsRead, clearNotifications, fetchHealth, fetchServerInfo, changePassword,
} from '../data/shell-repo.js?v=4.9.330';
import { fetchServerControl, serverControlAction } from '../data/settings-repo.js?v=4.9.330';
import { ensureRealtimeSocket } from '../realtime.js?v=4.9.330';
import {
    announce, pickVoice, pushVoiceLog, readVoiceLog, readVoicePref, writeVoicePref, isPriorityCategory,
    readQuietPref, writeQuietPref, QUIET_HOURS, nativeTts,
} from '../callout.js?v=4.9.330';
import { installSoundUnlock, playCue, cueForType, readSoundPref, writeSoundPref } from '../sounds.js?v=4.9.330';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HEALTH_MS = 60_000;
const SERVER_INFO_MS = 5 * 60_000;
const NOTIF_MS = 60_000;

const FAB_ACTIONS = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: 'chart', roles: ['admin', 'manager', 'hr', 'accountant', 'dept_head'] },
    { id: 'dispatch', label: 'طلب صرف', icon: 'package', roles: ['admin', 'manager', 'kitchen', 'sous_chef', 'dept_head', 'warehouse'] },
    { id: 'revenues', label: 'إضافة إيراد', icon: 'banknote', roles: ['admin', 'manager', 'accountant'] },
    { id: 'expenses', label: 'إضافة مصروف', icon: 'wallet', roles: ['admin', 'manager', 'accountant'] },
];

/* ── قنوات الجرس المصنّف (2026-10-31) ────────────────────────────────
   الترتيب ثابت: الكل ← قنوات الأولوية (قيمها نفس تصنيفات الخادم
   notification-service.js) ← عام. الأيقونات من نفس مجموعة ji المستخدمة
   في الشل — لا أيقونة جديدة خارجها. */
const NOTIF_CHANNELS = [
    { id: 'dispatch', label: 'طلبات الصرف', icon: 'package' },
    { id: 'procurement', label: 'طلبات الشراء', icon: 'clipboard-list' },
    { id: 'transfers', label: 'التحويلات', icon: 'arrow-left-right' },
];
const NOTIF_GENERAL = { id: 'general', label: 'عام', icon: 'inbox' };

/** نقية: تصنيف الصف → قناة الجرس. القيم الغريبة والقديمة كلها «عام». */
export function notifChannelOf(notif) {
    const category = String((notif && notif.category) || '').trim().toLowerCase();
    return NOTIF_CHANNELS.some((c) => c.id === category) ? category : NOTIF_GENERAL.id;
}

/** نقية: وقت نسبي بالعربية — «قبل لحظات / X دقيقة / X ساعة / أمس / التاريخ». */
export function relTime(value, now = Date.now()) {
    const t = new Date(value || '').getTime();
    if (!value || Number.isNaN(t)) {return '';}
    const diff = Math.max(0, now - t);
    const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;
    if (diff < MIN) {return 'قبل لحظات';}
    if (diff < HOUR) {return `قبل ${Math.floor(diff / MIN)} دقيقة`;}
    if (diff < DAY) {return `قبل ${Math.floor(diff / HOUR)} ساعة`;}
    if (diff < 2 * DAY) {return 'أمس';}
    return new Date(t).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' });
}

function currentLang() {
    try {return localStorage.getItem('karim_lang') || 'ar';}
    catch {return 'ar';}
}

/**
 * @param {{mountBoundary:(name:string, node:Node)=>void, navigate:(key:string)=>void, onToast?: (m:string)=>void}} shell
 * @param {{getRole:()=>string|null, getUserName:()=>string, isLive:()=>boolean, hasSession?:()=>boolean}} [ctx]
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountShellExtras(shell, ctx = {}) {
    const getRole = typeof ctx.getRole === 'function' ? ctx.getRole : () => null;
    const toast = typeof ctx.onToast === 'function' ? ctx.onToast : (m) => console.info('[V2 shell]', m);
    /* سؤال المضيف (حوار نظام التصميم)؛ والافتراضي للمونتاج المعزول. */
    const confirmFn = typeof ctx.confirm === 'function'
        ? ctx.confirm
        : (m) => Promise.resolve(typeof window !== 'undefined' && window.confirm ? window.confirm(m) : false);
    /* Fixture mode (v2.html without ?live=1) must issue no request at all —
       contract line 77. Every network-backed extra (bell, health lamps and
       their timers) reads this door; the sign-in flips isLive() and the host
       calls refresh() again, so the same mount becomes live without remount.
       `hasSession` keeps ?live=1 with no session equally silent: the login
       gate owns the screen, so probing /notifications or /health/ready only
       returns 401 and litters the console. */
    const hasSession = typeof ctx.hasSession === 'function' ? ctx.hasSession : () => true;
    const live = () => (typeof ctx.isLive === 'function' ? ctx.isLive() : false) && hasSession();

    const disposers = [];
    const on = (target, ev, fn) => {
        target.addEventListener(ev, fn);
        disposers.push(() => target.removeEventListener(ev, fn));
    };
    on(window, 'v2:realtime-version', (event) => {
        const version = event.detail || {};
        toast(`نسخة العميل غير متوافقة — الحد الأدنى ${version.minClientVersion || 'غير معروف'}؛ حدّث التطبيق`);
    });

    /* ── فتح السماعة بأول إيماءة ────────────────────────────────────────
       سياسة التشغيل التلقائي: النغمات تُفتح بأول نقرة/ضغطة (installSoundUnlock)،
       والنطق يُسخَّن بنُطقٍ صامت داخل الإيماءة نفسها — فبحلول أول إشعار
       تكون السماعة مفتوحة، وفي APK الـ WebView يسمح تلقائيًا أصلًا. */
    disposers.push(installSoundUnlock());
    try {
        window.addEventListener('pointerdown', () => {
            try {
                const synth = window.speechSynthesis;
                const U = window.SpeechSynthesisUtterance;
                if (synth && U) {
                    const warm = new U(' ');
                    warm.volume = 0;
                    warm.lang = 'ar-EG';
                    synth.speak(warm);
                }
            } catch { /* الصمت خيار مشروع */ }
        }, { once: true });
    } catch { /* */ }

    /* ── «المنادي»: نداءٌ فوري باسم صاحبه ───────────────────────────────
       السوكِت يسلّم الصفَّ الشخصي لحظة إنشائه (realtime.js → v2:notification)،
       فننطق «يا عبداللطيف، …» على جهازه وحده. الاستطلاع يبقى شبكةَ أمان.
       (2026-10-31) التأجيل 350ms حتى تُسمَع نغمة الوصول أولًا ثم النداء. */
    const speakLater = (notice) => {
        setTimeout(() => { try { speakNotice(notice); } catch { /* المنادي خدمة */ } }, 350);
    };
    on(window, 'v2:notification', (event) => {
        if (!live()) {return;}
        speakLater(event.detail || {});
    });

    /* ── Language switch (same key as legacy) ─────────────────────────── */
    const langBtn = document.createElement('button');
    langBtn.type = 'button';
    langBtn.className = 'erp-btn erp-btn--sm';
    const paintLang = () => {
        const lang = currentLang();
        langBtn.innerHTML = `<i class="ji" data-i="globe" aria-hidden="true"></i><span>${lang === 'ar' ? 'EN' : 'عربي'}</span>`;
        langBtn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    };
    paintLang();
    on(langBtn, 'click', () => {
        const next = currentLang() === 'ar' ? 'en' : 'ar';
        try {localStorage.setItem('karim_lang', next);} catch { /* private mode */ }
        document.documentElement.lang = next;
        document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
        try {document.dispatchEvent(new CustomEvent('karim-lang-changed', { detail: { lang: next } }));} catch { /* noop */ }
        paintLang();
        toast(next === 'ar' ? 'الواجهة عربية (شاشات V2 عربية أولًا)' : 'Shell is English-ready (V2 screens stay Arabic-first)');
        try {shell.closeMore?.();} catch { /* host decides */ }
    });

    /* ── Health lamps ─────────────────────────────────────────────────── */
    const lamps = document.createElement('span');
    lamps.className = 'erp-shell__lamps';
    lamps.setAttribute('role', 'status');
    lamps.setAttribute('aria-label', 'حالة الخادم وقاعدة البيانات');
    const dot = (ok, label) => `<span class="erp-lamp" role="img" data-ok="${ok === true ? '1' : (ok === false ? '0' : 'x')}" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
    const serverInfo = document.createElement('span');
    serverInfo.className = 'erp-server-info erp-text-sm';
    serverInfo.setAttribute('role', 'status');
    serverInfo.setAttribute('aria-live', 'polite');
    serverInfo.textContent = 'حالة إصدار الخادم غير معروفة';
    const formatServerTime = (value) => {
        if (!value || Number.isNaN(new Date(value).getTime())) {return '—';}
        return new Date(value).toLocaleString(currentLang() === 'en' ? 'en-US' : 'ar-EG', {
            dateStyle: 'short', timeStyle: 'short',
        });
    };
    async function paintServerInfo() {
        if (!live()) {serverInfo.textContent = ''; return;}
        serverInfo.textContent = 'جارٍ فحص إصدار الخادم…';
        try {
            const info = await fetchServerInfo();
            if (info.upToDate) {
                serverInfo.dataset.current = '1';
                serverInfo.textContent = `الخادم محدّث · يعمل منذ ${formatServerTime(info.startedAt)}`;
                serverInfo.title = `آخر تعديل للكود: ${formatServerTime(info.codeMtime)}`;
            } else {
                serverInfo.dataset.current = '0';
                serverInfo.textContent = `الخادم يعمل بكود قديم · منذ ${formatServerTime(info.startedAt)}`;
                serverInfo.title = `يوجد كود أحدث على القرص (${formatServerTime(info.codeMtime)}). أعد تشغيل خدمة الخادم ثم حدّث الصفحة.`;
            }
        } catch (error) {
            serverInfo.dataset.current = 'x';
            serverInfo.textContent = 'تعذّر فحص إصدار الخادم';
            serverInfo.title = error && error.message ? error.message : 'تعذّر الاتصال بخدمة حالة الخادم';
            console.warn('[V2 shell] server version check failed:', error);
        }
    }
    async function paintHealth() {
        if (!live()) {return;}
        try {
            const h = await fetchHealth();
            /* Never surface the wire token (`ok`) — the two lamps already say
               which side is down, and this line translates the same fact. */
            const summary = h.db === true
                ? 'الخادم وقاعدة البيانات يعملان'
                : (h.db === false
                    ? 'الخادم يعمل · قاعدة البيانات لا تستجيب'
                    : 'الخادم يعمل · حالة القاعدة غير معلنة');
            lamps.innerHTML = `${dot(true, 'الخادم يعمل')}`
                + dot(h.db, h.db === true ? 'قاعدة البيانات متصلة' : (h.db === false ? 'قاعدة البيانات لا تستجيب' : 'حالة القاعدة غير معلنة'))
                + `<span class="erp-text-sm erp-text-muted">${esc(summary)}</span>`;
        } catch {
            lamps.innerHTML = `${dot(false, 'الخادم لا يستجيب')}${dot(null, 'غير معروف')}`;
        }
    }
    const healthTimer = setInterval(() => {
        if (!live() || document.hidden) {return;}
        paintHealth();
    }, HEALTH_MS);
    disposers.push(() => clearInterval(healthTimer));
    const serverInfoTimer = setInterval(() => {
        if (!live() || document.hidden) {return;}
        paintServerInfo();
    }, SERVER_INFO_MS);
    disposers.push(() => clearInterval(serverInfoTimer));

    /* ── Notifications bell (every authenticated session — the server
       scopes the list to its owner, notification-routes.js:52, and routes
       approval notices to kitchen/warehouse via dispatch-notifier.js) ── */
    const bellWrap = document.createElement('span');
    bellWrap.className = 'erp-shell__bell';
    let notifTimer = null;
    let notifOpen = false;
    /* معرّفات سبق أن نُودِي بها — السوكِت والاستطلاع يسلّمان نفس الصف،
       فلا ينطق النداء مرتين. وأول رسمٍ لا ينطق شيئًا: فتح الصفحة ليس حدثًا. */
    const calledIds = new Set();
    let seenNotifIds = null;
    /* (2026-10-31) الجرس المصنّف: القناة المعروضة + آخر قائمة محمَّلة
       (التبويب يفلتر محليًا بلا إعادة طلب)، ومعرّفات سبق أن نُودِي لها
       بنغمة — السوكت والاستطلاع يسلّمان نفس الصف فلا نغمة مرتين. */
    let notifFilter = 'all';
    let notifCache = [];
    let notifUnread = 0;
    const cuedIds = new Set();

    /** 'ok' | 'native' | 'no-arabic' | 'unsupported' | 'unknown' — لحالة الزر. */
    function voiceSupport() {
        /* المحرك الأصلي (أندرويد) أوّلًا: صوته عربيّ حقيقيّ، فلا داعي لبحث
           أصوات WebView (قائمتها فارغة أصلًا على أندرويد). */
        if (nativeTts()) {return 'native';}
        if (typeof window === 'undefined' || !window.speechSynthesis) {return 'unsupported';}
        let voices;
        try {voices = window.speechSynthesis.getVoices() || [];} catch {voices = [];}
        if (!voices.length) {return 'unknown';}
        return pickVoice(voices) ? 'ok' : 'no-arabic';
    }

    /**
     * النداء: اسم المستخدم المسجَّل + عنوان الإشعار، بحدود الحصّة والشاشات
     * الصامتة. لا يرمي استثناءً أبدًا — إشعارٌ لا ينطق يجب ألّا يكسر الجرس.
     */
    function speakNotice(notice) {
        const id = String((notice && notice.id) ?? '');
        if (id && calledIds.has(id)) {return;}
        if (id) {
            calledIds.add(id);
            if (calledIds.size > 200) {calledIds.clear(); calledIds.add(id);}
        }
        try {
            const result = announce(
                { id, name: ctx.getUserName ? ctx.getUserName() : '', title: notice && notice.title, message: notice && notice.message, category: notice && notice.category },
                {
                    storage: window.localStorage,
                    log: readVoiceLog(window.localStorage),
                    route: typeof ctx.getScreen === 'function' ? ctx.getScreen() : '',
                }
            );
            if (result.spoken) {pushVoiceLog(window.localStorage, result.at);}
        } catch { /* المنادي خدمة، لا شرط */ }
    }

    /**
     * نغمة الوصول: الطلبات (صرف/شراء) تنادي بنغمة الانتباه، والباقي يرآ نوعه.
     * dedupe بالمعرّف مثل المنادي — السوكت والاستطلاع لا يكرران نغمة صفٍّ واحد.
     */
    function arrivalCue(notice) {
        const id = String((notice && notice.id) ?? '');
        if (id && cuedIds.has(id)) {return;}
        if (id) {
            cuedIds.add(id);
            if (cuedIds.size > 200) {cuedIds.clear(); cuedIds.add(id);}
        }
        try {
            const isPriority = Boolean(notice && notice.priority) || isPriorityCategory(notice && notice.category);
            playCue(isPriority ? 'priority' : cueForType(notice && notice.type));
        } catch { /* النغمة خدمة، لا شرط */ }
    }

    function bellHtml(unread) {
        return `<button type="button" class="erp-icon-btn" data-v2-bell aria-label="الإشعارات${unread ? ` (${unread} جديد)` : ''}">`
            + `<i class="ji" data-i="bell" aria-hidden="true"></i>`
            + (unread ? `<span class="erp-badge" data-tone="danger" data-v2-unread>${unread > 99 ? '99+' : unread}</span>` : '')
            + `</button><div data-v2-notif-panel hidden></div>`;
    }

    async function paintBell() {
        if (!live()) {bellWrap.innerHTML = ''; return;}
        let unread = 0;
        try {
            const n = await fetchNotifications();
            unread = n.unread;
            /* الاستطلاع شبكة أمانٍ لا مصدر الحدث: إن وصل صفٌّ جديد بينما
               السوكِت مقطوع، ينطق هنا. أول قائمةٍ تُقرأ تُسجَّل بلا نطق. */
            const list = Array.isArray(n.list) ? n.list : [];
            notifCache = list;
            notifUnread = Number(unread) || 0;
            if (seenNotifIds) {
                const fresh = list.filter((x) => !x.read && !seenNotifIds.has(String(x.id)));
                if (fresh.length) {
                    /* نغمة الوصول أولًا ثم النداء — نفس خط أنابيب السوكت */
                    arrivalCue(fresh[0]);
                    speakLater(fresh[0]);
                }
            }
            seenNotifIds = new Set(list.map((x) => String(x.id)));
        } catch { /* badge stays silent on failure */ }
        const wasOpen = notifOpen;
        bellWrap.innerHTML = bellHtml(unread);
        if (wasOpen) {openNotifPanel();}
    }

    async function openNotifPanel() {
        const panel = bellWrap.querySelector('[data-v2-notif-panel]');
        if (!panel) {return;}
        notifOpen = true;
        panel.hidden = false;
        /* The dropdown is absolutely positioned inside the bell (a fixed
           ancestor would be hijacked by the header's backdrop-filter). On a
           phone the bell sits near the inline start, so anchoring the panel's
           start edge to it pushed 200px of the panel off-screen; flip to the
           other edge and clamp to the viewport instead. */
        const bell = bellWrap.getBoundingClientRect();
        const width = Math.min(380, window.innerWidth - 24);
        const gutter = 12;
        const rtl = getComputedStyle(document.documentElement).direction === 'rtl';
        let left = rtl ? bell.left : bell.right - width;
        if (left < gutter || left + width > window.innerWidth - gutter) {
            left = rtl ? bell.right - width : bell.left;
        }
        left = Math.max(gutter, Math.min(left, window.innerWidth - width - gutter));
        panel.style.width = `${Math.round(width)}px`;
        panel.style.left = `${Math.round(left - bell.left)}px`;
        panel.style.right = 'auto';
        panel.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const n = await fetchNotifications();
            notifCache = Array.isArray(n.list) ? n.list : [];
            notifUnread = Number(n.unread) || 0;
            renderNotifPanel();
        } catch (e) {
            panel.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر التحميل')}</p>`;
        }
    }

    /** رسم اللوحة من آخر قائمة محمَّلة — التبويب يفلتر محليًا بلا إعادة طلب. */
    function renderNotifPanel() {
        const panel = bellWrap.querySelector('[data-v2-notif-panel]');
        if (!panel || !notifOpen) {return;}
        /* التبويبات: الكل ← قنوات الأولوية ← عام — بعدّاد غير المقروء
           داخل الصفحة المحمَّلة (الخادم يعيد آخر 50 صفًّا). */
        const counts = { all: 0, general: 0 };
        for (const c of NOTIF_CHANNELS) {counts[c.id] = 0;}
        for (const x of notifCache) {
            if (x && !x.read) {
                counts.all += 1;
                counts[notifChannelOf(x)] += 1;
            }
        }
        const channels = [{ id: 'all', label: 'الكل', icon: 'bell' }, ...NOTIF_CHANNELS, NOTIF_GENERAL];
        const tabs = channels.map((c) => {
            const count = c.id === 'all' ? counts.all : counts[c.id];
            return `<button type="button" class="erp-notif-tab${notifFilter === c.id ? ' erp-notif-tab--on' : ''}" data-v2-tab="${c.id}" aria-pressed="${notifFilter === c.id ? 'true' : 'false'}">`
                + `<i class="ji" data-i="${c.icon}" aria-hidden="true"></i><span>${c.label}</span>`
                + (count ? `<span class="erp-notif-tab__n">${count > 99 ? '99+' : count}</span>` : '')
                + `</button>`;
        }).join('');
        const filtered = notifFilter === 'all'
            ? notifCache
            : notifCache.filter((x) => notifChannelOf(x) === notifFilter);
        const items = filtered.map((x) => {
            const ch = NOTIF_CHANNELS.find((c) => c.id === notifChannelOf(x)) || NOTIF_GENERAL;
            const when = relTime(x.created_at || x.date);
            return `<div class="erp-notif${x.read ? '' : ' erp-notif--unread'}" data-v2-notif="${esc(String(x.id))}" data-tone="${esc(String(x.type || 'info'))}" role="button" tabindex="0" title="${x.link ? `فتح ${esc(x.link)}` : 'تعليم كمقروء'}">`
                + `<span class="erp-notif__ico" data-channel="${ch.id}" aria-hidden="true"><i class="ji" data-i="${ch.icon}"></i></span>`
                + `<span class="erp-notif__body"><span><b>${esc(x.title)}</b>${x.read ? '' : ' <span class="erp-badge" data-tone="info">جديد</span>'}</span>`
                + `<span class="erp-text-sm erp-text-muted">${esc(x.message || '')}</span></span>`
                + `<span class="erp-notif__meta erp-text-sm erp-text-muted">${esc(when)}</span></div>`;
        }).join('') || '<p class="erp-text-sm erp-text-muted">لا توجد إشعارات في هذه القناة</p>';
        const pref = readVoicePref(window.localStorage);
        const soundPref = readSoundPref(window.localStorage);
        const quietPref = readQuietPref(window.localStorage);
        const support = voiceSupport();
        const hint = support === 'no-arabic'
            ? '<p class="erp-text-sm erp-text-muted" data-v2-voice-hint>لا يوجد صوت عربي على هذا الجهاز — النداء يظهر نصًّا بلا نطق.</p>'
            : support === 'unsupported'
                ? '<p class="erp-text-sm erp-text-muted" data-v2-voice-hint>هذا المتصفح لا يدعم نطق النص.</p>'
                : '';
        panel.innerHTML = `<div class="erp-notif-head"><b>الإشعارات${notifUnread ? ` (${notifUnread} جديد)` : ''}</b>`
            + `<span class="erp-grow"></span>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-sound aria-pressed="${soundPref === 'off' ? 'false' : 'true'}" title="نغمة الوصول على هذا الجهاز">${soundPref === 'off' ? 'النغمة مكتومة' : 'النغمة مفعّلة'}</button>`
            /* زرُّ سماعٍ فوريّ: على الموبايل قد يُسكِت النغمةَ مفتاحُ الصامت أو
               سياسةُ التشغيل التلقائي، ولا سبيل للمستخدم إلى التمييز بلا سماع. */
            + '<button type="button" class="erp-btn erp-btn--sm" data-v2-sound-test title="اسمع النغمة على هذا الجهاز الآن">جرّب</button>'
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-voice aria-pressed="${pref === 'off' ? 'false' : 'true'}" title="نداء صوتي باسمك على هذا الجهاز">${pref === 'off' ? 'الصوت مكتوم' : 'الصوت مفعّل'}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-quiet aria-pressed="${quietPref === 'off' ? 'false' : 'true'}" title="الهدوء ليلًا من ${QUIET_HOURS.start}:00 إلى ${QUIET_HOURS.end}:00 على هذا الجهاز — طلبات الصرف والشراء تتجاوزه">${quietPref === 'off' ? 'ليلًا: الصوت مفتوح' : 'ليلًا: هدوء'}</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-notif-readall>تعليم الكل كمقروء</button>`
            + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-notif-clear>مسح الكل</button></div>`
            + hint
            + `<div class="erp-notif-tabs" role="tablist" aria-label="قنوات الإشعارات">${tabs}</div>`
            + `<div class="erp-notif-list">${items}</div>`;
        panel.scrollIntoView({ block: 'nearest' });
    }

    function closeNotifPanel() {
        notifOpen = false;
        const panel = bellWrap.querySelector('[data-v2-notif-panel]');
        if (panel) {panel.hidden = true; panel.innerHTML = '';}
    }

    bellWrap.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-bell]')) {
            if (notifOpen) {closeNotifPanel();}
            else {await openNotifPanel();}
            return;
        }
        if (event.target.closest('[data-v2-voice]')) {
            const next = readVoicePref(window.localStorage) === 'off' ? 'on' : 'off';
            writeVoicePref(window.localStorage, next);
            toast(next === 'off' ? 'النداء الصوتي مكتوم على هذا الجهاز' : 'النداء الصوتي مفعّل على هذا الجهاز');
            await openNotifPanel();
            return;
        }
        if (event.target.closest('[data-v2-sound]')) {
            const next = readSoundPref(window.localStorage) === 'off' ? 'on' : 'off';
            writeSoundPref(window.localStorage, next);
            toast(next === 'off' ? 'نغمات الوصول مكتومة على هذا الجهاز' : 'نغمات الوصول مفعّلة على هذا الجهاز');
            if (next === 'on') {try {playCue('notify', { ignoreGap: true });} catch { /* */ }} // تأكيد مسموع
            renderNotifPanel();
            return;
        }
        if (event.target.closest('[data-v2-sound-test]')) {
            let played = false;
            try { played = playCue('priority', { ignoreGap: true }); } catch { /* النغمة خدمة، لا شرط */ }
            toast(played
                ? 'نغمة تجريبية — إن لم تسمعها فمفتاح الصامت في الهاتف يُسكت التطبيق'
                : 'لم تصدر النغمة: اضغط داخل الصفحة أولًا (فتحُ الصوت يحتاج لمسة) ثم أعد المحاولة');
            return;
        }
        if (event.target.closest('[data-v2-quiet]')) {
            const next = readQuietPref(window.localStorage) === 'off' ? 'on' : 'off';
            writeQuietPref(window.localStorage, next);
            /* المُبدِّل يطرأ في الحال لا في إعادة الرسم التالية: الـ render
               يقرأ المفتاح من التخزين، والمستخدم يجب أن يرى أثر لمسه فورًا. */
            const btn = event.target.closest('[data-v2-quiet]');
            if (btn) {
                btn.setAttribute('aria-pressed', next === 'off' ? 'false' : 'true');
                btn.textContent = next === 'off' ? 'ليلًا: الصوت مفتوح' : 'ليلًا: هدوء';
            }
            toast(next === 'off'
                ? `المنادي ينادي ليلًا أيضًا على هذا الجهاز (تجاوز ${QUIET_HOURS.start}:00–${QUIET_HOURS.end}:00)`
                : `المنادي يصمت ليلًا من ${QUIET_HOURS.start}:00 إلى ${QUIET_HOURS.end}:00 على هذا الجهاز — طلبات الصرف والشراء تبقى تنادي`);
            renderNotifPanel();
            return;
        }
        const tab = event.target.closest('[data-v2-tab]');
        if (tab) {
            notifFilter = String(tab.dataset.v2Tab || 'all');
            renderNotifPanel();
            return;
        }
        if (event.target.closest('[data-v2-notif-readall]')) {
            try {
                await markAllNotificationsRead();
                toast('تم تعليم كل الإشعارات كمقروءة');
                await paintBell();
                closeNotifPanel();
            } catch (e) {toast((e && e.message) || 'تعذر التعليم');}
            return;
        }
        if (event.target.closest('[data-v2-notif-clear]')) {
            try {
                await clearNotifications();
                toast('تم مسح جميع إشعاراتك');
                await paintBell();
                closeNotifPanel();
            } catch (e) {toast((e && e.message) || 'تعذر المسح');}
            return;
        }
        const item = event.target.closest('[data-v2-notif]');
        if (item) {
            const id = item.dataset.v2Notif;
            try {await markNotificationsRead([id]);} catch { /* badge refresh covers */ }
            closeNotifPanel();
            await paintBell();
            /* (2026-10-31) افتح وجهة الإشعار — link مفتاح تنقّل في V2
               ('dispatch'، 'wh-prs'). مفتاح غير معروف لا يكسر شيئًا:
               تعليم المقروء والرجوع للجرس هو السلوك الأصلي. */
            const row = notifCache.find((x) => String(x.id) === String(id));
            if (row && row.link) {
                try {shell.navigate(String(row.link));} catch { /* الجرس يبقى الهدف */ }
            }
        }
    });

    function startNotifPoll() {
        if (notifTimer) {clearInterval(notifTimer); notifTimer = null;}
        if (!live()) {return;}
        notifTimer = setInterval(() => {
            if (document.hidden || notifOpen) {return;}
            paintBell();
        }, NOTIF_MS);
    }
    disposers.push(() => { if (notifTimer) {clearInterval(notifTimer);} });

    /* ── دفع فوري لإشعارات الاعتماد (سوكت) ──────────────────────────────
       الاعتمادات تُبثّ عبر حدث notification إلى غرفة user:<id>
       (notification-service.js:160-174) — الـ polling وحده كان يأخّر الجرس
       حتى دقيقة. الجسر (v2/realtime.js) يفتح الاتصال بنفس عقد المصافحة
       ويعيد register_user عند كل reconnect؛ هنا نشترك ونجدّد الجرس فورًا.
       في وضع fixture لا يُفتح اتصال إطلاقًا (عقد السطر 77). */
    let rtSocket = null;
    let rtBound = false;
    function onPushedNotification(row) {
        paintBell();
        /* (2026-10-31) نغمة الوصول قبل التوست — الطلبات بنغمة الانتباه.
           النداء الصوتي يأتي من مستمع v2:notification (سوكت) بمؤخرة 350ms. */
        arrivalCue(row);
        const t = row && (row.title || row.message);
        if (!document.hidden && t) {toast(String(t));}
    }
    async function startNotifPush() {
        if (!live() || rtBound) {return;}
        const s = await ensureRealtimeSocket();
        if (!s || rtBound) {return;}
        rtSocket = s;
        rtBound = true;
        s.on('notification', onPushedNotification);
    }
    function stopNotifPush() {
        if (rtSocket && rtBound) {
            try {rtSocket.off('notification', onPushedNotification);} catch { try {rtSocket.removeListener('notification', onPushedNotification);} catch { /* detached */ } }
        }
        rtSocket = null;
        rtBound = false;
    }
    disposers.push(stopNotifPush);

    /* NOTIFICATION PUSH IS NOT BOOT WORK (2026-10-29): فتح socket.io كلَّه
       (37KB سكربت + اتصال دائم) كان يبدأ مع أول رسم للشل، قبل أن يرى
       المستخدم لوحته. هنا يُؤجَّل إلى ما بعد أول رسم وأول خمول. لا يتأخر
       إشعار فعليًا: الجرس يستطلع كل دقيقة، و`/api/rt/events` يعيد كل حدث
       فات بعد الاتصال (realtime.js: resumeEvents)، فالفقرة كلها مغطاة. */
    let pushTimer = 0;
    let pushTimerIsIdle = false;
    function cancelNotifPush() {
        if (!pushTimer) {return;}
        if (pushTimerIsIdle && typeof window.cancelIdleCallback === 'function') {
            try {window.cancelIdleCallback(pushTimer);} catch { /* not idle */ }
        }
        clearTimeout(pushTimer);
        pushTimer = 0;
        pushTimerIsIdle = false;
    }
    function scheduleNotifPush() {
        if (!live() || rtBound || pushTimer) {return;}
        const run = () => { pushTimer = 0; void startNotifPush(); };
        if (typeof window.requestIdleCallback === 'function') {
            pushTimerIsIdle = true;
            pushTimer = window.requestIdleCallback(run, { timeout: 2500 });
        } else {
            pushTimerIsIdle = false;
            pushTimer = setTimeout(run, 1200);
        }
    }
    disposers.push(cancelNotifPush);

    /* ── Quick buttons: POS / menu boards / dispatch ──────────────────── */
    const quick = document.createElement('span');
    quick.className = 'erp-shell__quick';
    let quickSection = null;
    function paintQuick() {
        const role = String(getRole() || '');
        const posRoles = ['admin', 'manager', 'accountant', 'cashier'];
        const disRoles = ['admin', 'manager', 'kitchen', 'sous_chef', 'dept_head', 'warehouse'];
        quick.innerHTML = ''
            + (posRoles.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="pos"><i class="ji" data-i="receipt" aria-hidden="true"></i><span>الكاشير</span></button>` : '')
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="menu-board"><i class="ji" data-i="eye" aria-hidden="true"></i><span>شاشات المنيو</span></button>`
            + (disRoles.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="dispatch"><i class="ji" data-i="package" aria-hidden="true"></i><span>طلب صرف</span></button>` : '')
            /* البند ٩ قرّر «لا بطاقة في القائمة» لمسح الباركود — الزر السريع
               باب اكتشاف لا يخترق مرآة الصلاحيات؛ اختيار المستخدم يفعّل
               المسح على هذا الجهاز فقط، والشاشة تتحقق من الدور والخادم. */
            + (disRoles.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="goods-scan"><i class="ji" data-i="barcode" aria-hidden="true"></i><span>مسح بضاعة</span></button>` : '');
        if (quickSection) {quickSection.hidden = quick.childElementCount === 0;}
    }
    quick.addEventListener('click', (event) => {
        const b = event.target.closest('[data-v2-quick]');
        if (!b) {return;}
        const k = b.dataset.v2Quick;
        if (k === 'goods-scan') {window.localStorage.setItem('karim_v2_scan', '1');}
        try {shell.closeMore?.();} catch { /* host decides */ }
        shell.navigate(k);
    });

    /* ── FAB: the same 4 role-gated actions ───────────────────────────── */
    const fabHost = document.createElement('div');
    fabHost.className = 'erp-fab-host';
    let fabOpen = false;
    function paintFab() {
        const role = String(getRole() || '');
        const items = FAB_ACTIONS.filter((a) => a.roles.includes(role));
        if (!items.length) {fabHost.innerHTML = ''; return;}
        fabHost.innerHTML = `<button type="button" class="erp-fab" data-v2-fab aria-label="إجراءات سريعة" aria-expanded="${fabOpen}">+</button>`
            + `<div class="erp-fab-menu" data-v2-fab-menu${fabOpen ? '' : ' hidden'}>`
            + items.map((a) => `<button type="button" class="erp-fab-action" data-v2-fab-go="${a.id}"><i class="ji" data-i="${a.icon}" aria-hidden="true"></i><span>${esc(a.label)}</span></button>`).join('')
            + `</div>`;
    }
    fabHost.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-fab]')) {
            fabOpen = !fabOpen;
            paintFab();
            return;
        }
        const go = event.target.closest('[data-v2-fab-go]');
        if (go) {
            fabOpen = false;
            paintFab();
            shell.navigate(go.dataset.v2FabGo);
        }
    });

    /* ── Change password ──────────────────────────────────────────────── */
    const pwBtn = document.createElement('button');
    pwBtn.type = 'button';
    pwBtn.className = 'erp-btn erp-btn--sm';
    pwBtn.innerHTML = '<i class="ji" data-i="key" aria-hidden="true"></i><span>تغيير كلمة المرور</span>';
    pwBtn.setAttribute('aria-label', 'تغيير كلمة المرور');
    /* `.erp-v2 .erp-pop` only matches through an ancestor carrying .erp-v2, and
       this host is appended to document.body — outside #erp-v2-root. Without the
       class the rule is dead and the panel paints as unstyled HTML at the bottom
       of the document (same scope defect, same remedy as toast.js:108 and
       overlay.js:114). .erp-v2 paints --erp-background, but the host stays
       zero-height here: its only child is position:fixed. */
    const pwPanelHost = document.createElement('div');
    pwPanelHost.className = 'erp-v2';
    function closePwPanel() {
        if (!pwPanelHost.isConnected) {return;}
        pwPanelHost.remove();
        /* Opening this dialog closes the control centre, so `pwBtn` may now be
           inside a hidden panel; return focus to the control-centre trigger. */
        const target = pwBtn.getClientRects().length
            ? pwBtn
            : document.querySelector('[data-erp-more-toggle]');
        target?.focus({ preventScroll: true });
    }
    on(pwPanelHost, 'keydown', (event) => {
        if (event.key === 'Escape') {event.preventDefault(); closePwPanel();}
    });
    on(pwBtn, 'click', () => {
        if (pwPanelHost.isConnected) {closePwPanel(); return;}
        try {shell.closeMore?.();} catch { /* host decides */ }
        pwPanelHost.innerHTML = `<div class="erp-pop" role="dialog" aria-labelledby="erp-pw-title"><h4 id="erp-pw-title">تغيير كلمة المرور</h4>`
            + `<label class="erp-text-sm erp-text-muted">الحالية<input class="erp-input" type="password" data-v2-pw="cur" autocomplete="current-password"></label>`
            + `<label class="erp-text-sm erp-text-muted">الجديدة (8+ حرف ورقم)<input class="erp-input" type="password" data-v2-pw="next" autocomplete="new-password"></label>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-pw-err role="alert"></div>`
            + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pw-go>حفظ</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pw-x>إلغاء</button></div></div>`;
        document.body.appendChild(pwPanelHost);
        const header = document.querySelector('.erp-shell__header');
        const pop = pwPanelHost.querySelector('.erp-pop');
        if (header && pop) {
            pop.style.top = `${Math.max(8, Math.round(header.getBoundingClientRect().bottom + 8))}px`;
        }
        pwPanelHost.querySelector('[data-v2-pw="cur"]')?.focus();
    });
    pwPanelHost.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-pw-x]')) {closePwPanel(); return;}
        if (!event.target.closest('[data-v2-pw-go]')) {return;}
        const cur = pwPanelHost.querySelector('[data-v2-pw="cur"]')?.value || '';
        const next = pwPanelHost.querySelector('[data-v2-pw="next"]')?.value || '';
        const err = pwPanelHost.querySelector('[data-v2-pw-err]');
        if (next.length < 12 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
            if (err) {err.textContent = 'الجديدة ضعيفة: 12 حرفًا على الأقل مع حرف ورقم';}
            return;
        }
        try {
            await changePassword({ current_password: cur, new_password: next });
            pwPanelHost.remove();
            toast('تم تغيير كلمة المرور');
        } catch (e) {
            if (err) {err.textContent = (e && e.message) || 'تعذر التغيير';}
        }
    });
    disposers.push(() => pwPanelHost.remove());

    /* ── Offline bar ──────────────────────────────────────────────────── */
    const offBar = document.createElement('div');
    offBar.className = 'erp-offline-bar';
    offBar.setAttribute('role', 'status');
    offBar.hidden = navigator.onLine !== false;
    offBar.innerHTML = '<span>لا يوجد اتصال — التغييرات المحفوظة محليًا ستُرسل عند عودة الشبكة</span>';
    const goOff = () => {offBar.hidden = false;};
    const goOn = () => {offBar.hidden = true; toast('عاد الاتصال');};
    on(window, 'offline', goOff);
    on(window, 'online', goOn);
    document.body.appendChild(offBar);
    disposers.push(() => offBar.remove());

    /* ── التحكم بالسيرفر (أدمن فقط — أعلى الشاشة في كل الصفحات) ─────────
       شريحة دائمة في رأس النظام: لمبة الحالة + زرا إيقاف/تشغيل خدمة
       KarimERP-Server عبر البروكسي المحروس (/api/server-control — أدمن
       حصرًا، حد استخدام، وتأكيد STOP على الخادم). التشغيل بعد إيقافٍ
       كامل تعمله الخدمة المرافقة الدائمة على 127.0.0.1:5011 — لا
       PostgreSQL ولا النفق في نطاق هذين الزرين. */
    const serverChip = document.createElement('span');
    serverChip.className = 'erp-srvctl erp-no-print';
    serverChip.setAttribute('role', 'group');
    serverChip.setAttribute('aria-label', 'التحكم بخدمة السيرفر');
    /* شريحة تُركَّب قبل أول فحص: فراغٌ في الرأس أسوأ من رسالة انتظار،
       فتبدأ بحالة محايدة تُستبدل فور أول ردٍّ صالح. */
    serverChip.innerHTML = `<span class="erp-lamp" role="img" data-ok="x" aria-label="جارٍ فحص حالة الخدمة"></span>`
        + `<span class="erp-srvctl__state">جارٍ فحص الخدمة…</span>`;
    let srvBusy = false;
    let srvPoll = 0;
    let srvMounted = false;                 // لا شريحةً فارغة لغير الأدمن
    /* كل حالات خدمة ويندوز كما تعيدها `sc queryex`: أربع حالاتٍ فقط كانت
       معروفة، فـNOT_INSTALLED وUNKNOWN وPAUSED… كلها تسقط في الفرع
       الاحتياطي وتطبع «غير معروف» في رأس كل صفحة للأدمن. */
    const SRV_STATES = {
        RUNNING: ['1', 'السيرفر يعمل'],
        STOPPED: ['0', 'السيرفر متوقف'],
        START_PENDING: ['x', 'جارٍ التشغيل…'],
        STOP_PENDING: ['x', 'جارٍ الإيقاف…'],
        PAUSED: ['x', 'الخدمة موقوفة مؤقتًا'],
        PAUSE_PENDING: ['x', 'جارٍ الإيقاف المؤقت…'],
        CONTINUE_PENDING: ['x', 'جارٍ استئناف العمل…'],
        NOT_INSTALLED: ['0', 'الخدمة غير مثبّتة'],
        UNKNOWN: ['x', 'تعذّر قراءة حالة الخدمة'],
    };
    let srvPainted = false;                // هل رُسمت حالة حقيقية يومًا؟
    function paintSrv(state, note) {
        srvPainted = true;
        const known = SRV_STATES[state];
        // لا نصّ «غير معروف» عارٍ: الحالة الخام تبقى في title للتشخيص.
        const [ok, label] = known || ['x', note || 'تعذّر قراءة حالة الخدمة'];
        const hint = known ? label : `الحالة الخام: ${state || '—'}`;
        serverChip.innerHTML = `<span class="erp-lamp" role="img" data-ok="${ok}" aria-label="حالة السيرفر: ${esc(label)}"></span>`
            + `<span class="erp-srvctl__state" title="${esc(hint)}">${esc(label)}</span>`
            + (state === 'RUNNING'
                ? `<button type="button" class="erp-btn erp-btn--sm erp-srvctl__btn" data-srv="stop" title="إيقاف خدمة السيرفر كاملة"><i class="ji" data-i="circle-x" aria-hidden="true"></i><span>إيقاف</span></button>`
                : '')
            + (state === 'STOPPED'
                ? `<button type="button" class="erp-btn erp-btn--sm erp-srvctl__btn erp-srvctl__btn--start" data-srv="start" title="تشغيل خدمة السيرفر"><i class="ji" data-i="play" aria-hidden="true"></i><span>تشغيل</span></button>`
                : '');
    }
    async function paintSrvStatus() {
        if (!live() || getRole() !== 'admin' || srvBusy) {return;}
        if (!srvMounted) {
            try {shell.mountBoundary('server-control', serverChip); srvMounted = true;}
            catch { /* host decides */ }
        }
        try {
            const res = await fetchServerControl();
            if (!res || res.available === false) {
                serverChip.innerHTML = `<span class="erp-lamp" role="img" data-ok="x" aria-label="التحكم غير متاح"></span>`
                    + `<span class="erp-srvctl__state" title="${esc((res && res.message) || '')}">تحكم غير متاح</span>`;
                return;
            }
            /* جسم الردّ هو { control, service:{state,installed,pid}, erp, … }
               (server-control.js snapshot()) — لا حقل `state` في الجذر. قراءة
               res.state كانت تمنح '' دائمًا، فالشريحة ترسم «غير معروف» في كل
               مرة ولو كانت الخدمة تعمل. */
            const svc = res.service || {};
            paintSrv(svc.installed === false ? 'NOT_INSTALLED' : String(svc.state || 'UNKNOWN'));
        } catch (e) {
            /* الشبكة ترجع لاحقًا: آخر حالة معروفة تبقى كما هي — ما لم تكن
               رُسمت أصلًا، فلا يبقى «جارٍ الفحص» وعودًا كاذبًا إلى الأبد. */
            if (!srvPainted) {
                serverChip.innerHTML = `<span class="erp-lamp" role="img" data-ok="x" aria-label="تعذّر فحص حالة الخدمة"></span>`
                    + `<span class="erp-srvctl__state" title="${esc((e && e.message) || '')}">تعذّر فحص الخدمة</span>`;
            }
        }
    }
    async function srvAction(action) {
        if (srvBusy) {return;}
        let confirm = '';
        if (action === 'stop') {
            confirm = String(window.prompt('إيقاف خدمة السيرفر يقطع النظام عن كل المستخدمين فورًا.\nقاعدة البيانات والنفق يبقيان كما هما.\nاكتب STOP للتأكيد:') || '').trim().toUpperCase();
            if (confirm !== 'STOP') {return;}
        } else if (!await confirmFn('تشغيل خدمة السيرفر الآن؟')) {return;}
        srvBusy = true;
        paintSrv(action === 'stop' ? 'STOP_PENDING' : 'START_PENDING');
        try {
            const res = await serverControlAction(action, confirm);
            toast((res && res.message) || (action === 'stop'
                ? 'تم إرسال الإيقاف — النظام ينزل خلال ثوانٍ'
                : 'تم إرسال التشغيل — انتظر عودة اللمبة الخضراء'));
        } catch (e) {
            toast((e && e.message) || 'تعذر تنفيذ الأمر', 'error');
        } finally {
            let ticks = 0;
            clearInterval(srvPoll);
            srvPoll = setInterval(() => {
                ticks += 1;
                srvBusy = false;
                paintSrvStatus();
                if (ticks >= 6) {clearInterval(srvPoll);}
            }, 4000);
        }
    }
    on(serverChip, 'click', (event) => {
        const b = event.target.closest('[data-srv]');
        if (b) {srvAction(String(b.dataset.srv));}
    });
    disposers.push(() => {clearInterval(srvPoll); serverChip.remove();});
    /* التركيب يحدث داخل paintSrvStatus للأدمن فقط — لا شريحةً فارغة لغيره. */

    /* ── Mount + refresh ──────────────────────────────────────────────── */
    try {shell.mountBoundary('notifications', bellWrap);} catch { /* host decides */ }
    try {
        const panel = shell.root && shell.root.querySelector('[data-erp-more]');
        if (panel) {
            panel.querySelector('[data-erp-more-status]')?.append(lamps, serverInfo);
            const quickHost = panel.querySelector('[data-erp-more-quick]');
            if (quickHost) {
                quickSection = panel.querySelector('[data-erp-more-quick-section]');
                quickHost.appendChild(quick);
            }
            panel.querySelector('[data-erp-more-lang]')?.appendChild(langBtn);
            panel.querySelector('[data-erp-more-account]')?.appendChild(pwBtn);
            // «النظام الحالي» — كان شريطًا فوق الصفحة فحُذف (طلب المالك)،
            // فصار بابًا في مركز التحكّم لكل الأدوار لا للأدمن وحده.
            const legacySection = document.createElement('section');
            legacySection.className = 'erp-shell__more-section';
            const legacyHead = document.createElement('h3');
            legacyHead.className = 'erp-shell__more-label';
            legacyHead.textContent = 'النظام';
            const legacyRow = document.createElement('div');
            legacyRow.className = 'erp-shell__more-row';
            const legacyLink = document.createElement('a');
            legacyLink.className = 'erp-btn erp-btn--sm';
            legacyLink.href = 'index.html';
            legacyLink.innerHTML = '<i class="ji" data-i="external" aria-hidden="true"></i><span>النظام الحالي</span>';
            legacyRow.appendChild(legacyLink);
            legacySection.appendChild(legacyHead);
            legacySection.appendChild(legacyRow);
            panel.appendChild(legacySection);
        }
    } catch { /* header layout is the shell's own */ }
    document.body.appendChild(fabHost);

    function refresh() {
        paintLang();
        paintQuick();
        paintFab();
        if (!live()) {
            bellWrap.innerHTML = '';
            lamps.innerHTML = '<span class="erp-text-sm erp-text-muted">وضع المعاينة — لا اتصال بخادم</span>';
            serverInfo.textContent = '';
            serverChip.innerHTML = '';
            startNotifPoll();
            return;
        }
        paintBell();
        paintHealth();
        paintServerInfo();
        paintSrvStatus();
        startNotifPoll();
        scheduleNotifPush();
    }
    refresh();
    /* استطلاع حالة السيرفر: نبضات سريعة أول 30 ثانية (الجلسة قد تجهز بعد
       الإقلاع — فالشريحة تظهر خلال ثوانٍ لا نصف دقيقة)، ثم كل 30 ثانية.
       مؤقّت srvPoll يغطي ثواني ما بعد أوامر الإيقاف/التشغيل. */
    let srvFastTicks = 0;
    const srvStatusTimer = setInterval(() => {
        srvFastTicks += 1;
        paintSrvStatus();
        if (srvFastTicks >= 10) {
            clearInterval(srvStatusTimer);
            disposers.push(() => 0);
            const slow = setInterval(paintSrvStatus, 30_000);
            disposers.push(() => clearInterval(slow));
        }
    }, 3_000);
    disposers.push(() => clearInterval(srvStatusTimer));

    return {
        refresh,
        destroy() {
            disposers.forEach((fn) => { try {fn();} catch { /* detached */ } });
            try {bellWrap.remove();} catch { /* noop */ }
            try {fabHost.remove();} catch { /* noop */ }
        },
    };
}
