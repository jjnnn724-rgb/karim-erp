/**
 * menu-board.js — شاشة منيو المول (Digital Signage)
 * ────────────────────────────────────────────────────────────────────────────
 * المنيو يُقرأ من منيو الكاشير (pos_products) عبر /api/menu-board/public —
 * تعديلات المطبخ تصل لحظيًا عبر بث entity_changed (posProducts) على السوكيت،
 * مع فحص دوري كل 30 ثانية كصمام أمان.
 * العرض: صفحة لكل تصنيف (فطار/غدا/عشا أولًا) بتدوير تلقائي ومدة أطول
 * للفترة الحالية حسب ساعة الجهاز.
 */
'use strict';

const STAGE_W = 1080, STAGE_H = 1920;
const DWELL_DEFAULT = 14_000;   // مدة بقاء الصفحة الواحدة
const DWELL_CURRENT = 20_000;   // مدة أطول لصفحة الفترة الحالية
const POLL_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_ITEMS_PER_PAGE = 10;  // صفحة تتسع لـ 10 أصناف (5 صفوف × عمودين) — قرار المالك 2026-10-15
const BOARD_CACHE_KEY = 'menu_board_last_successful_response';
const BOARD_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const TV_PERFORMANCE_MODE = !/(?:^|[?&])tv=full(?:&|$)/.test(location.search);
if (TV_PERFORMANCE_MODE) { document.documentElement.classList.add('tv-performance'); }

const $ = (id) => document.getElementById(id);
function readLanguagePreference() {
    try { return localStorage.getItem('menu_board_language') === 'en' ? 'en' : 'ar'; }
    catch (error) {
        console.warn('[menu-board] language preference unavailable:', error.message);
        return 'ar';
    }
}
let board = null;               // آخر بيانات ({version, settings, categories})
let version = null;             // بصمة البيانات الحالية — نتجنب إعادة الرسم بلا تغيير
let pages = [];                 // [{title, note, items, period?}]
let loadError = false;
let pageIdx = 0;
let cycleTimer = null;
let periodNow = null;
let language = readLanguagePreference();

function text(ar, en) {
    return language === 'en' ? en : ar;
}

function setTickerText(value) {
    $('footerText').textContent = value;
    $('footerTextClone').textContent = value;
}

function applyLanguage() {
    document.documentElement.lang = language;
    document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
    $('stage').dataset.language = language;
    const toggle = $('languageToggle');
    toggle.textContent = language === 'en' ? 'العربية' : 'English';
    toggle.setAttribute('aria-label', language === 'en' ? 'التبديل إلى العربية' : 'Switch to English');
    document.title = language === 'en'
        ? 'Al-Shorfa Al-Alami Restaurants — Menu'
        : 'مطاعم الشرفه العالمي — شاشة العرض';
    if (!board) {
        setTickerText('الأسعار شاملة الضريبة · Prices include tax · نتشرف بخدمتكم');
    }
    /* ثنائي دائم (قرار المالك 2026-10-15): الفترة بالعربي والإنجليزي معاً،
       والمختار أساسي والآخر صغيراً بجانبه. */
    const periodNames = {
        breakfast: { ar: 'الفطار', en: 'Breakfast' },
        lunch: { ar: 'الغداء', en: 'Lunch' },
        dinner: { ar: 'العشاء', en: 'Dinner' },
    };
    document.querySelectorAll('.period').forEach(el => {
        const name = el.querySelector('.period-name');
        if (!name) { return; }
        const p = periodNames[el.dataset.period] || { ar: '', en: '' };
        name.innerHTML = language === 'en'
            ? `${esc(p.en)}<small dir="rtl" lang="ar">${esc(p.ar)}</small>`
            : `${esc(p.ar)}<small dir="ltr" lang="en">${esc(p.en)}</small>`;
    });
    setConn(!$('connState').classList.contains('off'));
    tickClock();
    if (board) { applySettings(board.settings); }
    if (board) { render(); }
}

/* ─── التكييف مع أي دقة شاشة: مقياس المسرح ─── */
function fitStage() {
    const s = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    document.getElementById('stage').style.transform = `scale(${s})`;
}
window.addEventListener('resize', fitStage);

/* ─── الساعة والتاريخ + فترة الوجبة الحالية ─── */
function tickClock() {
    const now = new Date();
    const locale = language === 'en' ? 'en-US' : 'ar-SA-u-ca-gregory-nu-latn';
    const t = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const d = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('clockTime').textContent = t;
    $('clockDate').textContent = d;
    // الفترة الحالية تُشتق من مواعيد الإعدادات نفسها (تتغير معها)
    const p = computeCurrentPeriod();
    if (p !== periodNow) {
        periodNow = p;
        document.querySelectorAll('.period').forEach(el => {
            el.classList.toggle('current', el.dataset.period === p);
        });
        updateRibbons();
        updateBuffetCarving();
        if (board && board.buffet_sections && board.buffet_sections.mains_by_period) {
            render();
        }
        scheduleCycle(true); // الانقلاب التلقائي: وقت الفطار يعرض الفطار ووقت الغداء الغداء…
    }
}

/* تحويل '05:00 - 11:30' إلى دقائق [بداية، نهاية] */
function parseHours(s) {
    const m = String(s || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
    if (!m) { return null; }
    return [(+m[1]) * 60 + (+m[2]), (+m[3]) * 60 + (+m[4])];
}

function computeCurrentPeriod() {
    const s = (board && board.settings) || {};
    const now = new Date();
    return periodAtMinute(now.getHours() * 60 + now.getMinutes(), s);
}

function periodAtMinute(t, s) {
    const readStart = (value, range, fallback) => {
        const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
        if (match) { return Number(match[1]) * 60 + Number(match[2]); }
        const legacy = parseHours(range);
        return legacy ? legacy[0] : fallback;
    };
    const breakfast = readStart(s.breakfast_start, s.breakfast_hours, 5 * 60);
    const lunch = readStart(s.lunch_start, s.lunch_hours, 12 * 60);
    const dinner = readStart(s.dinner_start, s.dinner_hours, 17 * 60);
    if (t >= dinner || t < breakfast) { return 'dinner'; }
    return t >= lunch ? 'lunch' : 'breakfast';
}

/* ─── جلب البيانات ─── */
async function fetchBoard() {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
        const r = await fetch('/api/menu-board/public', {
            cache: 'no-store',
            ...(controller ? { signal: controller.signal } : {}),
        });
        if (!r.ok) { throw new Error('HTTP ' + r.status); }
        return await r.json();
    } finally {
        if (timeout) { clearTimeout(timeout); }
    }
}

function applySettings(s) {
    if (!s) { return; }
    if ($('brandTitle')) { $('brandTitle').textContent = s.title || 'مطاعم الشرفه العالمي'; }
    if ($('brandSub')) { $('brandSub').textContent = s.subtitle || ''; }
    const starts = scheduleStarts(s);
    $('hoursBreakfast').textContent = `${starts.breakfast} - ${starts.lunch}`;
    $('hoursLunch').textContent = `${starts.lunch} - ${starts.dinner}`;
    $('hoursDinner').textContent = `${starts.dinner} - ${starts.breakfast}`;
    const stage = $('stage');
    /* قرار المالك 2026-10-12: كل السيمز بنفس ديزاين النوار الفخم —
       مهما كانت الخلفية المحفوظة، الشاشة تثبت على noir الفاخر */
    const backgroundStyle = 'noir';
    stage.dataset.theme = ['emerald', 'sapphire', 'ruby', 'midnight'].includes(s.theme_style) ? s.theme_style : 'emerald';
    stage.dataset.background = backgroundStyle;
    /* خلفية مخصصة محذوفة — النوار الفخم ثابت (قرار المالك 2026-10-12) */
    stage.style.backgroundImage = '';
    stage.style.backgroundSize = '';
    stage.style.backgroundPosition = '';
    if (!TV_PERFORMANCE_MODE) { startAmbientTints(stage); }
    const buffetPrice = Number.isFinite(Number(s.buffet_price)) ? Number(s.buffet_price) : 75;
    /* ثنائي دائم: سطر البوفيه باللغتين في الوضعين */
    const buffetN = buffetPrice.toLocaleString('en-US', { maximumFractionDigits: 2 });
    const priceLine = `بوفيه مفتوح · OPEN BUFFET · ${buffetN} ريال / SAR per person`;
    const defaultFooter = 'الأسعار شاملة الضريبة · Prices include tax · نتشرف بخدمتكم على مدار اليوم';
    const wish = 'نتمنى لكم زيارة سعيدة وطعامًا شهيًا · Have a pleasant visit and enjoy your meal';
    const configuredFooter = String(s.footer_text || '').trim();
    const footer = configuredFooter === defaultFooter || configuredFooter === wish ? '' : configuredFooter;
    setTickerText([priceLine, footer, wish].filter(Boolean).join('  ✦  ') + '  ✦');
}

/* ════════════ نَفَس الخلفية: تبدّل ألوان تلقائيًا بانتقال ناعم ════════════
   طلب المالك 2026-10-12: «ألوان الخلفية تتبدّل اتوماتيك باحترافية جميلة».
   6 درجات نوار فخم — نفس البنية (4 هالات + قاعدة كحلية) حتى يكون
   التبديل crossfade مثاليًا بلا قطع. الإطار الذهبي وألوان الأقسام
   تبقى ثابتة تمامًا: تتغير «الخلفية فقط». */
const NOIR_TINTS = [
    /* 0 · ذهبي ملكي (الافتراضي) */
    'radial-gradient(900px 640px at 74% 4%, rgba(255,171,46,.20), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(63,215,245,.17), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(46,230,160,.16), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(185,140,255,.15), transparent 58%),'
  + 'linear-gradient(168deg,#072430 0%,#061a2a 46%,#04121c 100%)',
    /* 1 · زمردي ملكي */
    'radial-gradient(900px 640px at 74% 4%, rgba(46,230,160,.20), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(182,230,60,.15), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(63,215,245,.16), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(255,212,105,.15), transparent 58%),'
  + 'linear-gradient(168deg,#052a20 0%,#062018 46%,#03140e 100%)',
    /* 2 · ياقوتي */
    'radial-gradient(900px 640px at 74% 4%, rgba(63,150,245,.20), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(63,215,245,.17), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(185,140,255,.16), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(255,212,105,.14), transparent 58%),'
  + 'linear-gradient(168deg,#061f38 0%,#05162a 46%,#030c18 100%)',
    /* 3 · ياقوت وردي */
    'radial-gradient(900px 640px at 74% 4%, rgba(255,122,184,.19), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(185,140,255,.16), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(255,171,46,.16), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(63,215,245,.13), transparent 58%),'
  + 'linear-gradient(168deg,#2a0c1e 0%,#1c0816 46%,#0e0410 100%)',
    /* 4 · بنفسجي ملكي */
    'radial-gradient(900px 640px at 74% 4%, rgba(185,140,255,.20), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(255,122,184,.15), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(63,215,245,.16), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(255,212,105,.14), transparent 58%),'
  + 'linear-gradient(168deg,#1c1238 0%,#140c28 46%,#0a0616 100%)',
    /* 5 · شمبين ذهبي */
    'radial-gradient(900px 640px at 74% 4%, rgba(255,212,105,.21), transparent 58%),'
  + 'radial-gradient(780px 620px at 4% 22%, rgba(255,171,46,.17), transparent 56%),'
  + 'radial-gradient(860px 660px at 96% 78%, rgba(232,169,27,.15), transparent 56%),'
  + 'radial-gradient(700px 560px at 50% 104%, rgba(182,230,60,.12), transparent 58%),'
  + 'linear-gradient(168deg,#2a2010 0%,#1c150a 46%,#0e0a05 100%)',
];
const NOIR_TINT_MS = 20000;   /* مدة البقاء لكل درجة — 20 ثانية */

let _tintTimer = null, _tintSide = 'a', _tintIdx = 0;
function startAmbientTints(stage) {
    if (_tintTimer) { return; }                     /* لا تشغّل دورة ثانية */
    const el = stage || $('stage');
    if (!el) { return; }
    /* البداية: الطبقة A بالدرجة الأولى فورًا */
    el.style.setProperty('--i-tint-a', NOIR_TINTS[0]);
    el.style.setProperty('--i-tint-b', NOIR_TINTS[NOIR_TINTS.length - 1]);
    el.dataset.tintSide = 'a';
    _tintSide = 'a'; _tintIdx = 0;
    _tintTimer = setInterval(() => {
        if (document.hidden) { return; }            /* لا نستهلك معالج والشاشة مخفية */
        _tintIdx = (_tintIdx + 1) % NOIR_TINTS.length;
        /* نكتب الدرجة الجديدة في الطبقة المعتمة ثم نُبدّل الشفافية —
           الـ CSS يحوّلها خلال 3 ثوانٍ = crossfade احترافي */
        _tintSide = _tintSide === 'a' ? 'b' : 'a';
        el.style.setProperty(_tintSide === 'a' ? '--i-tint-a' : '--i-tint-b', NOIR_TINTS[_tintIdx]);
        el.dataset.tintSide = _tintSide;
    }, NOIR_TINT_MS);
}

function scheduleStarts(settings) {
    const s = settings || {};
    const readStart = (value, range, fallback) => {
        if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''))) { return value; }
        const legacy = parseHours(range);
        return legacy ? `${String(Math.floor(legacy[0] / 60)).padStart(2, '0')}:${String(legacy[0] % 60).padStart(2, '0')}` : fallback;
    };
    return {
        breakfast: readStart(s.breakfast_start, s.breakfast_hours, '05:00'),
        lunch: readStart(s.lunch_start, s.lunch_hours, '12:00'),
        dinner: readStart(s.dinner_start, s.dinner_hours, '17:00'),
    };
}

/* ─── بناء الصفحات: تصنيف لكل صفحة (تقسيم لو زادت عن 8) ─── */
const CAT_EN = {
    'فطار': 'BREAKFAST', 'الفطار': 'BREAKFAST', 'فطور': 'BREAKFAST', 'الإفطار': 'BREAKFAST',
    'غدا': 'LUNCH', 'غداء': 'LUNCH', 'الغداء': 'LUNCH',
    'عشا': 'DINNER', 'عشاء': 'DINNER', 'العشاء': 'DINNER', 'الشوربة': 'SOUPS', 'الشوربات': 'SOUPS',
    'الحساء': 'SOUPS', 'الأطباق الساخنة': 'HOT DISHES', 'المقبلات': 'APPETIZERS',
    'السلطات': 'SALADS', 'السلطات والمقبلات': 'SALADS & APPETIZERS',
    'المشاوي': 'GRILLS', 'المشويات': 'GRILLS', 'الأرز': 'RICE',
    'الحبوب': 'LEGUMES', 'العصائر': 'FRESH JUICES', 'العصائر الطبيعية': 'FRESH JUICES',
    'أصناف أخرى': 'OTHER ITEMS',
    'الحلويات': 'DESSERTS', 'المشروبات': 'BEVERAGES', 'المشروبات الساخنة': 'HOT DRINKS',
    'الخبز': 'BREADS', 'المخبوزات': 'BAKERY', 'الفطائر': 'PANCAKES',
    'السندويشات': 'SANDWICHES', 'اللحوم': 'MEATS', 'الدواجن': 'POULTRY',
    'الأسماك': 'SEAFOOD', 'المندي': 'MANDI', 'المشاوي المشكلة': 'ASSORTED GRILLS',
};
function catEn(title) {
    const base = String(title || '').replace(/\s+\(\d+\/\d+\)\s*$/, '').trim();
    if (base.includes('بوفيه اليوم') || base.includes('منيو اليوم')) { return 'TODAY SPECIAL · OPEN BUFFET'; }
    return CAT_EN[base] || '';
}
function catTitleEn(title) {
    const base = String(title || '').replace(/\s+\(\d+\/\d+\)\s*$/, '').trim();
    return catEn(title) || base;
}
function categoryPeriod(cat) {
    const c = String(cat || '');
    if (c.includes('فطار') || c.includes('فطور')) { return 'breakfast'; }
    if (c.includes('غدا') || c.includes('غداء') || /lunch/i.test(c)) { return 'lunch'; }
    if (c.includes('عشا') || c.includes('عشاء') || /dinner/i.test(c)) { return 'dinner'; }
    return null;
}

function buildPages(categories, settings) {
    const out = [];
    const assigned = new Map();
    for (const period of ['breakfast', 'lunch', 'dinner']) {
        const category = settings && settings[`${period}_category`];
        if (category) { assigned.set(String(category), period); }
    }
    for (const cat of categories || []) {
        const items = (cat.items || []).slice();
        if (!items.length) { continue; }
        const period = assigned.get(cat.name) || categoryPeriod(cat.name);
        const chunkSize = MAX_ITEMS_PER_PAGE;
        const chunks = Math.ceil(items.length / chunkSize);
        for (let c = 0; c < chunks; c++) {
            out.push({
                title: cat.name + (chunks > 1 ? `  (${c + 1}/${chunks})` : ''),
                title_en: catTitleEn(cat.name) + (chunks > 1 ? `  (${c + 1}/${chunks})` : ''),
                period,
                items: items.slice(c * chunkSize, (c + 1) * chunkSize),
            });
        }
    }
    return out;
}

function render() {
    const host = $('pageHost');
    host.innerHTML = '';
    const dots = $('pageDots');
    dots.innerHTML = '';
    if (board && board.buffet_sections && board.buffet_sections.enabled) {
        dots.style.display = 'none';
        const sections = board.buffet_sections;
        /* ثنائي دائم: الأساسي حسب اللغة، واللغة الأخرى ظاهرة تحته دائماً */
        const renderItems = (items, className) => (items || []).map((item, index) => {
            const ar = item.name || '';
            const en = item.name_en || '';
            const primary = language === 'en' ? (en || ar) : ar;
            const secondary = language === 'en' ? (ar && ar !== primary ? ar : '') : (en || '');
            return `
            <div class="${className}${item.sold_out ? ' sold-out' : ''}">
                <span class="buffet-number">${String(index + 1).padStart(2, '0')}</span>
                <span class="buffet-item-name">${esc(primary)}${secondary ? `<em class="buffet-item-en">${esc(secondary)}</em>` : ''}${item.sold_out ? `<small>${text('نفدت الكمية', 'Sold out')}</small>` : ''}</span>
            </div>`;
        }).join('');
        const carvingItem = item => {
            if (!item) { return `<span class="buffet-empty">${text('سيُعلن عنه لاحقًا', 'To be announced')}</span>`; }
            const ar = item.name || '';
            const en = item.name_en || '';
            const primary = language === 'en' ? (en || ar) : ar;
            const secondary = language === 'en' ? (ar && ar !== primary ? ar : '') : (en || '');
            return `<span class="buffet-item-name">${esc(primary)}${secondary ? `<em class="buffet-item-en">${esc(secondary)}</em>` : ''}${item.sold_out ? `<small>${text('نفدت الكمية', 'Sold out')}</small>` : ''}</span>`;
        };
        const has = x => Array.isArray(x) && x.length > 0;
        /* عدّ حقيقي لكل قسم بدل الأرقام الثابتة (10/2) */
        const n = a => has(a) ? (language === 'en' ? `${a.length} choices` : `${a.length} ${text('أصناف', 'choices')}`) : '';
        /* لوحة قسم — تُخفى تمامًا إذا كانت فارغة حتى لا تفرغ الشاشة */
        const panel = (cls, ar, en, countLabel, inner) => countLabel === null ? '' : `
                <section class="buffet-panel ${cls}">
                    <div class="buffet-section-heading"><b>${text(ar, en)}</b><span>${en.toUpperCase()} · ${countLabel || text('قريبًا', 'Soon')}</span></div>
                    ${inner}
                </section>`;
        /* الأقسام الصغيرة: شبكة إن وُجدت أصناف — وشريط جملة متحرّكة إن كانت فارغة */
        const note = (ar, en) => `
                        <div class="buffet-note"><div class="buffet-note-track">
                            <span class="buffet-note-text">${ar}<em>${en}</em></span>
                            <span class="buffet-note-text" aria-hidden="true">${ar}<em>${en}</em></span>
                        </div></div>`;
        const smallPanel = (cls, ar, en, items, noteAr, noteEn) => `
                    <section class="buffet-panel buffet-small-section ${cls}">
                        <div class="buffet-section-heading"><b>${text(ar, en)}</b><span>${en.toUpperCase()} · ${has(items) ? n(items) : text('تشكيلة يومية متجدّدة', 'Fresh daily')}</span></div>
                        ${has(items) ? `<div class="buffet-small-grid">${renderItems(items, 'buffet-small-item')}</div>` : note(noteAr, noteEn)}
                    </section>`;
        const bottomParts = [
            smallPanel('buffet-salads', 'سلطات محلية وعالمية', 'Local & World Salads', sections.salads,
                'ويوجد مجموعة متنوّعة من السلطات الشرقية والعالمية',
                'A variety of oriental & world salads'),
        ];
        const currentMains = sections.mains_by_period && sections.mains_by_period[periodNow || 'lunch'] || sections.mains;
        /* صفوف الشبكة: ثابتة الترتيب — الأقسام الفارغة تعرض الجملة المتحرّكة */
        const rows = ['.82fr', '.72fr', '2.4fr', '.66fr', '.6fr'];
        host.innerHTML = `
            <div class="buffet-page" style="grid-template-rows:${rows.join(' ')}">
                ${panel('buffet-soups', 'الشوربات', 'Soups', n(sections.soups), `<div class="buffet-soup-grid">${renderItems(sections.soups, 'buffet-soup-item')}</div>`)}
                ${panel('buffet-carving', 'ركن الشواء', 'Carving Station', text('يتغيّر يوميًا', 'Changes daily'), `
                    <div class="carving-current" data-period="lunch">${carvingItem(sections.carving.lunch)}</div>
                    <div class="carving-current" data-period="dinner">${carvingItem(sections.carving.dinner)}</div>
                    ${!sections.carving.lunch && !sections.carving.dinner ? `<div class="carving-current active">${carvingItem(null)}</div>` : ''}`)}
                ${panel('buffet-mains', 'الأطباق الرئيسية', 'Main Courses', n(currentMains), `<div class="buffet-main-grid">${renderItems(currentMains, 'buffet-main-item')}</div>`)}
                ${panel('buffet-desserts', 'الحلويات الشرقية والغربية', 'Oriental & Western Desserts', has(sections.desserts) ? n(sections.desserts) : text('تشكيلة يومية متجدّدة', 'Fresh daily'), has(sections.desserts) ? `<div class="buffet-small-grid">${renderItems(sections.desserts, 'buffet-small-item')}</div>` : note('ويوجد مجموعة متنوّعة من الحلويات الشرقية والغربية', 'A fine selection of oriental & western desserts'))}
                ${bottomParts.join('')}
            </div>`;
        $('pageIndicator').textContent = text('بوفيه مفتوح', 'Open Buffet');
        updateBuffetCarving();
        return;
    }
    dots.style.display = '';
    if (!pages.length) {
        const message = loadError
            ? text('تعذّر الاتصال بخادم المنيو — جارٍ إعادة المحاولة', 'Cannot connect to the menu server — retrying')
            : text('المنيو يُحدَّث حاليًا — تابعونا', 'Menu is being updated — please check back soon');
        host.innerHTML = `<div class="page active empty"><div class="empty-note">${message}</div></div>`;
        $('pageIndicator').textContent = '—';
        return;
    }
    pages.forEach((pg, i) => {
        const JEWELS = ['jewel-cyan', 'jewel-emerald', 'jewel-gold', 'jewel-violet'];
        const el = document.createElement('div');
        el.className = 'page ' + JEWELS[i % JEWELS.length];
        el.dataset.idx = String(i);
        el.dataset.period = pg.period || '';
        const grid = pg.items.map((it, j) => `
            <div class="item${it.sold_out ? ' sold-out' : ''}${it.image ? ' has-img' : ''}" style="--i:${j}">
                <div class="item-top">
                    <span class="item-bullet">${String(j + 1).padStart(2, '0')}</span>
                    ${it.image ? `<img class="item-thumb" src="${esc(it.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}
                    <div class="item-copy">
                    <span class="item-name">${esc(language === 'en' ? (it.name_en || it.name) : it.name)}${it.sold_out && language === 'ar' ? `<span class="sold-note">${text('نفدت الكمية', 'Sold out')}</span>` : ''}</span>
                    <span class="item-en">${esc(language === 'en' ? (it.name || '') : (it.name_en || ''))}${it.sold_out && language === 'en' ? `<span class="sold-note">${text('نفدت الكمية', 'Sold out')}</span>` : ''}</span>
                    </div>
                </div>
            </div>`).join('');
        el.innerHTML = `
            <div class="cat-header">
                <div class="cat-title">${esc(language === 'en' ? (pg.title_en || catTitleEn(pg.title)) : pg.title)}</div>
                <div class="cat-en">${language === 'en' ? '' : esc(catEn(pg.title))}</div>
                <div class="now-ribbon"><span class="nr-dot"></span> ${text('يُقدم الآن', 'Now serving')}</div>
                ${pg.note ? `<div class="cat-note">${esc(pg.note)}</div>` : ''}
            </div>
            <div class="items-grid">${grid}</div>`;
        host.appendChild(el);
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.style.setProperty('--dwell', Math.round(DWELL_DEFAULT / 1000) + 's');
        dot.addEventListener('click', () => { showPage(pages.indexOf(pg)); });
        dots.appendChild(dot);
    });
    showPage(dominantIndex());
}

function updateBuffetCarving() {
    const selectedPeriod = periodNow === 'dinner' ? 'dinner' : 'lunch';
    document.querySelectorAll('.carving-current').forEach(el => {
        el.classList.toggle('active', el.dataset.period === selectedPeriod);
    });
}

/* الصفحة المهيمنة: صفحة فترة الوجبة الحالية (وقت الفطار يعرض الفطار…) */
function dominantIndex() {
    const idx = pages.findIndex(p => p.period === periodNow);
    return idx === -1 ? 0 : idx;
}

function showPage(idx) {
    if (!pages.length || (board && board.buffet_sections && board.buffet_sections.enabled)) { return; }
    pageIdx = ((idx % pages.length) + pages.length) % pages.length;
    document.querySelectorAll('#pageHost .page').forEach(el => {
        el.classList.toggle('active', Number(el.dataset.idx) === pageIdx);
    });
    document.querySelectorAll('.page-dots .dot').forEach((el, i) => {
        el.classList.toggle('active', i === pageIdx);
        if (i === pageIdx) { // إعادة تشغيل شريط التقدم
            el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
        }
    });
    $('pageIndicator').textContent = `${pageIdx + 1} / ${pages.length}`;
    updateRibbons();
    scheduleCycle();
}

/* لافتة «يُقدم الآن» على صفحة الفترة الحالية فقط */
function updateRibbons() {
    document.querySelectorAll('#pageHost .page').forEach(el => {
        const ribbon = el.querySelector('.now-ribbon');
        if (ribbon) { ribbon.classList.toggle('show', el.dataset.period === periodNow); }
    });
}

function scheduleCycle(_reset) {
    if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
    if (!pages.length || (board && board.buffet_sections && board.buffet_sections.enabled)) { return; }
    // نلتزم بصفحات فترة الوجبة الحالية — الانقلاب يحدث تلقائيًا عند تغيّر الوقت
    const dom = pages.map((p, i) => ({ p, i })).filter(x => x.p.period === periodNow).map(x => x.i);
    if (dom.length) {
        if (!dom.includes(pageIdx)) { showPage(dom[0]); return; }
        if (dom.length > 1) {
            const pos = dom.indexOf(pageIdx);
            cycleTimer = setTimeout(() => showPage(dom[(pos + 1) % dom.length]), DWELL_CURRENT);
        }
        // صفحة واحدة مهيمنة: تبقى ثابتة على الشاشة
        return;
    }
    // لا أصناف للفترة الحالية: ندور على باقي الصفحات حتى لا تفرغ الشاشة
    cycleTimer = setTimeout(() => showPage(pageIdx + 1), DWELL_DEFAULT);
}

function applyBoardData(data) {
    if (!data || typeof data !== 'object' || !data.settings || !Array.isArray(data.categories)) {
        throw new Error('Invalid menu board response');
    }
    const nextVersion = data.version + '|' + JSON.stringify(data.settings);
    if (nextVersion === version) { return false; }
    version = nextVersion;
    board = data;
    applySettings(data.settings);
    pages = buildPages(data.categories, data.settings);
    if (data.weekly_today && Array.isArray(data.weekly_today.items) && data.weekly_today.items.length) {
        const wt = data.weekly_today;
        const witems = wt.items.map(x => ({ name: x.name, name_en: x.name_en || '', price: Number(x.price) || 0, unit: null, note: x.note || null }));
        const chunks = [];
        for (let c = 0; c < witems.length; c += MAX_ITEMS_PER_PAGE) { chunks.push(witems.slice(c, c + MAX_ITEMS_PER_PAGE)); }
        const dayName = new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' });
        const weeklyPages = chunks.map((ch, ci) => ({
            title: (wt.title || text('منيو اليوم', "Today's Menu")) + (chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''),
            title_en: (wt.title ? catTitleEn(wt.title) : "Today's Menu") + (chunks.length > 1 ? ` (${ci + 1}/${chunks.length})` : ''),
            note: (wt.note || dayName) || null,
            period: periodNow,
            items: ch,
            weekly: true,
        }));
        pages = [...weeklyPages, ...pages];
    }
    render();
    tickClock();
    return true;
}

function cacheBoard(data) {
    try {
        localStorage.setItem(BOARD_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
    } catch (error) {
        console.warn('[menu-board] menu cache unavailable:', error.message);
    }
}

function restoreCachedBoard() {
    try {
        const saved = localStorage.getItem(BOARD_CACHE_KEY);
        if (!saved) { return; }
        const cached = JSON.parse(saved);
        const age = Date.now() - Number(cached.savedAt);
        if (!Number.isFinite(age) || age < 0 || age > BOARD_CACHE_MAX_AGE) { return; }
        if (applyBoardData(cached.data)) { setConn(false); }
    } catch (error) {
        console.warn('[menu-board] cached menu could not be restored:', error.message);
    }
}

/* ─── التحديث: طلب واحد فقط وإعادة البناء عند تغيّر البصمة ─── */
let refreshInProgress = false;
let refreshQueued = false;
async function refresh({ background = false } = {}) {
    if (refreshInProgress) {
        refreshQueued = true;
        return;
    }
    refreshInProgress = true;
    try {
        const data = await fetchBoard();
        applyBoardData(data);
        cacheBoard(data);
        setConn(true);
        loadError = false;
    } catch (e) {
        console.error('[menu-board] refresh failed:', e);
        setConn(false);
        if (!board || !pages.length) {
            loadError = true;
            render();
        }
    } finally {
        refreshInProgress = false;
        if (background && !board && !pages.length) {
            render();
        }
        if (refreshQueued) {
            refreshQueued = false;
            void refresh({ background: true });
        }
    }
}

function setConn(ok) {
    const el = $('connState');
    el.textContent = ok ? text('● مباشر', '● Live') : text('● غير متصل', '● Offline');
    el.className = 'conn ' + (ok ? 'live' : 'off');
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* ─── اللحظية: بث تعديلات منيو الكاشير + فحص دوري ─── */
function listenRealtime() {
    setInterval(refresh, POLL_MS);
    if (TV_PERFORMANCE_MODE) { return; }
    const socketScript = document.createElement('script');
    socketScript.src = '/socket.io/socket.io.js';
    socketScript.async = true;
    socketScript.onload = connectRealtime;
    socketScript.onerror = () => console.warn('[menu-board] realtime unavailable; periodic refresh remains active');
    document.head.appendChild(socketScript);
}

function connectRealtime() {
    try {
        const socket = io({ transports: ['websocket', 'polling'] });
        socket.on('connect', () => { setConn(true); void refresh({ background: true }); });
        socket.on('disconnect', () => { setConn(false); });
        socket.on('entity_changed', (p) => {
            if (p && p.entity === 'posProducts') { refresh(); }
        });
        socket.on('menu_board_changed', () => { refresh(); });
    } catch (_) { /* السوكيت غير حرج — الفحص الدوري يغطي */ }
}

/* ─── تشغيل ─── */
function start() {
    restoreCachedBoard();
    fitStage();
    applyLanguage();
    if (!board && !pages.length) {
        render();
    }
    $('languageToggle').addEventListener('click', () => {
        language = language === 'ar' ? 'en' : 'ar';
        try { localStorage.setItem('menu_board_language', language); }
        catch (error) { console.warn('[menu-board] language preference could not be saved:', error.message); }
        applyLanguage();
    });
    tickClock();
    setInterval(tickClock, 1000);
    refresh({ background: true });
    listenRealtime();
    // إبقاء الشاشة مستيقظة (شاشات العرض)
    try {
        if (navigator.wakeLock && navigator.wakeLock.request) {
            navigator.wakeLock.request('screen').catch(() => {});
        }
    } catch (_) {}
    // إعادة تحميل يومية 04:00 صباحًا للنظافة (ذاكرة المتصفح)
    const now = new Date();
    const next4 = new Date(now); next4.setHours(4, 0, 0, 0);
    if (next4 <= now) { next4.setDate(next4.getDate() + 1); }
    setTimeout(() => location.reload(), next4 - now);
    // نقر مزدوج = ملء الشاشة (تشغيل على شاشة العرض)
    document.addEventListener('dblclick', () => {
        if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); }
        else { document.documentElement.requestFullscreen().catch(() => {}); }
    });
    window.addEventListener('online', refresh);
}
document.addEventListener('DOMContentLoaded', start);
