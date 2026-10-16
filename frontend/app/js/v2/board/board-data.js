/**
 * V2 — Board data model · نموذج بيانات لوحة المنيو (البند ٨)
 * ═══════════════════════════════════════════════════════════════════════
 * Why this file exists: the legacy board (js/menu-board.js) mixes the data
 * rules with a fixed 1080×1920 canvas and one uniform Math.min scale, so its
 * pagination is welded to that canvas (10 items = 5 rows × 2 cols). On any
 * other portrait ratio the canvas is letterboxed and the type shrinks with
 * it. This module keeps the *rules* and drops the canvas: pages are cut to
 * whatever the screen actually fits, which is passed in as `capacity`.
 *
 * Rules ported from the legacy file (behaviour must match, measured):
 *   • period boundaries: <period>_start, else parse <period>_hours,
 *     else 05:00 / 12:00 / 17:00 — dinner wraps past midnight.
 *   • a category belongs to a period only if settings.<period>_category
 *     names it, otherwise by its Arabic/English name.
 *   • the current period's pages are the only ones in rotation; if the
 *     current period has no items, rotate everything so the screen never
 *     goes empty.
 *
 * Pure by contract: no DOM, no fetch, no timers, no storage. Everything that
 * reads the outside world is passed in as an argument, so all of it is
 * testable with plain values.
 *
 * Honesty rule (owner: «دقيق»): the public API gives NO price for category
 * items and hardcodes sold_out=false. Nothing here invents a price or a
 * sold-out state — a price renders only when the payload carried one.
 */

export const PERIODS = ['breakfast', 'lunch', 'dinner'];

export const PERIOD_NAMES = {
    breakfast: { ar: 'الفطار', en: 'Breakfast' },
    lunch: { ar: 'الغداء', en: 'Lunch' },
    dinner: { ar: 'العشاء', en: 'Dinner' },
};

export const DEFAULT_STARTS = { breakfast: '05:00', lunch: '12:00', dinner: '17:00' };

/** Dwell: current period gets more screen time (legacy 20s vs 14s). */
export const DWELL_DEFAULT_MS = 14_000;
export const DWELL_CURRENT_MS = 20_000;
export const POLL_MS = 30_000;
export const FETCH_TIMEOUT_MS = 5_000;

/** Own storage namespace — never shares a key with the legacy board page. */
export const BOARD_CACHE_KEY = 'karim_v2_board_last_response';
export const BOARD_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const LANGUAGE_KEY = 'karim_v2_board_language';

/** Floor/cap for measured pagination — guards a 0-height container. */
export const MIN_ITEMS_PER_PAGE = 2;
export const MAX_ITEMS_PER_PAGE = 60;

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(value) {
    return HHMM.test(String(value || '')) ? Number(String(value).slice(0, 2)) * 60 + Number(String(value).slice(3, 5)) : null;
}

/** '05:00 - 11:30' → [300, 690]; anything else → null. */
export function parseHours(range) {
    const m = String(range || '').match(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/);
    return m ? [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])] : null;
}

/** Start minutes of a period: explicit start → legacy range → documented default. */
export function startMinutes(settings, period) {
    const s = settings || {};
    const direct = toMinutes(s[`${period}_start`]);
    if (direct !== null) { return direct; }
    const legacy = parseHours(s[`${period}_hours`]);
    return legacy ? legacy[0] : toMinutes(DEFAULT_STARTS[period]);
}

/** Same three labels the header strip shows, always as 'HH:MM'. */
export function scheduleStarts(settings) {
    const pad = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    return PERIODS.reduce((acc, p) => { acc[p] = pad(startMinutes(settings, p)); return acc; }, {});
}

/** t = minutes since local midnight. Dinner owns the wrap past midnight. */
export function periodAtMinute(t, settings) {
    const minute = Number.isFinite(t) ? t : 0;
    const breakfast = startMinutes(settings, 'breakfast');
    const lunch = startMinutes(settings, 'lunch');
    const dinner = startMinutes(settings, 'dinner');
    if (minute >= dinner || minute < breakfast) { return 'dinner'; }
    return minute >= lunch ? 'lunch' : 'breakfast';
}

export function categoryPeriod(name) {
    const c = String(name || '');
    if (c.includes('فطار') || c.includes('فطور')) { return 'breakfast'; }
    if (c.includes('غدا') || c.includes('غداء') || /lunch/i.test(c)) { return 'lunch'; }
    if (c.includes('عشا') || c.includes('عشاء') || /dinner/i.test(c)) { return 'dinner'; }
    return null;
}

/** Latin caption under an Arabic title — same table as the legacy board. */
export const CAT_EN = {
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

const CHUNK_SUFFIX = /\s+\(\d+\/\d+\)\s*$/;
export function catEn(title) {
    const base = String(title || '').replace(CHUNK_SUFFIX, '').trim();
    if (base.includes('بوفيه اليوم') || base.includes('منيو اليوم')) { return 'TODAY SPECIAL · OPEN BUFFET'; }
    return CAT_EN[base] || '';
}
export function catTitleEn(title) {
    const base = String(title || '').replace(CHUNK_SUFFIX, '').trim();
    return catEn(title) || base;
}

/** Both languages always on screen (owner decision 2026-10-15): primary + small secondary. */
export function bilingual(item, language) {
    const ar = String(item && item.name || '').trim();
    const en = String(item && item.name_en || '').trim();
    const primary = language === 'en' ? (en || ar) : (ar || en);
    const secondary = language === 'en' ? (ar && ar !== primary ? ar : '') : (en && en !== primary ? en : '');
    return { primary, secondary };
}

export function priceOf(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** Measured pagination lives here — the renderer only supplies the number. */
export function sanitizeCapacity(capacity) {
    const n = Math.floor(Number(capacity));
    if (!Number.isFinite(n) || n <= 0) { return MIN_ITEMS_PER_PAGE; }
    return Math.min(MAX_ITEMS_PER_PAGE, Math.max(MIN_ITEMS_PER_PAGE, n));
}

export function chunk(items, capacity) {
    const size = sanitizeCapacity(capacity);
    const out = [];
    for (let i = 0; i < items.length; i += size) { out.push(items.slice(i, i + size)); }
    return out;
}

/**
 * Category pages — legacy order kept (payload order is already breakfast/lunch/
 * dinner first, server-side), assignment by settings beats name matching.
 */
export function buildPages({ categories, settings, capacity = 10, language = 'ar' } = {}) {
    const cap = sanitizeCapacity(capacity);
    const assigned = new Map();
    for (const period of PERIODS) {
        const name = settings && settings[`${period}_category`];
        if (name) { assigned.set(String(name), period); }
    }
    const out = [];
    for (const cat of categories || []) {
        const items = (cat && cat.items || []).filter((it) => it && String(it.name || it.name_en || '').trim());
        if (!items.length) { continue; }
        const period = assigned.get(cat.name) || categoryPeriod(cat.name);
        const chunks = chunk(items, cap);
        chunks.forEach((slice, i) => {
            const suffix = chunks.length > 1 ? `  (${i + 1}/${chunks.length})` : '';
            out.push({
                kind: 'category',
                title: String(cat.name || '') + suffix,
                title_en: catTitleEn(cat.name) + suffix,
                period,
                note: null,
                items: slice.map((it) => ({
                    ...bilingual(it, language),
                    image: it.image || null,
                    soldOut: Boolean(it.sold_out),
                    price: priceOf(it.price),
                })),
            });
        });
    }
    return out;
}

/** Today's weekly menu carries real prices — the only place prices exist. */
export function buildWeeklyPages({ weekly, capacity = 10, period = null, dayName = '', language = 'ar' } = {}) {
    if (!weekly || !Array.isArray(weekly.items) || !weekly.items.length) { return []; }
    const items = weekly.items
        .map((x) => ({
            ...bilingual(x, language),
            image: x.image || null,
            soldOut: Boolean(x.sold_out),
            price: priceOf(x.price),
            note: String(x.note || '').trim() || null,
        }))
        .filter((x) => x.primary);
    const chunks = chunk(items, capacity);
    const baseAr = String(weekly.title || '').trim() || "منيو اليوم";
    const baseEn = String(weekly.title || '').trim() ? catTitleEn(weekly.title) : "Today's Menu";
    return chunks.map((slice, i) => ({
        kind: 'weekly',
        title: baseAr + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''),
        title_en: baseEn + (chunks.length > 1 ? ` (${i + 1}/${chunks.length})` : ''),
        period,
        note: String(weekly.note || '').trim() || dayName || null,
        items: slice,
    }));
}

/** Rotation rules of the legacy scheduler, written as data (see header). */
export function cyclePlan({ pages, period, index, dwellDefault = DWELL_DEFAULT_MS, dwellCurrent = DWELL_CURRENT_MS } = {}) {
    const list = pages || [];
    if (!list.length) { return { indices: [], next: null, dwellMs: dwellDefault, scope: 'empty' }; }
    const inPeriod = list.map((p, i) => (p.period === period ? i : -1)).filter((i) => i !== -1);
    if (inPeriod.length) {
        if (!inPeriod.includes(index)) { return { indices: inPeriod, next: inPeriod[0], dwellMs: dwellCurrent, scope: 'period' }; }
        if (inPeriod.length === 1) { return { indices: inPeriod, next: null, dwellMs: dwellCurrent, scope: 'period' }; }
        const pos = inPeriod.indexOf(index);
        return { indices: inPeriod, next: inPeriod[(pos + 1) % inPeriod.length], dwellMs: dwellCurrent, scope: 'period' };
    }
    return { indices: list.map((_, i) => i), next: (index + 1) % list.length, dwellMs: dwellDefault, scope: 'all' };
}

export function dominantIndex(pages, period) {
    const idx = (pages || []).findIndex((p) => p.period === period);
    return idx === -1 ? 0 : idx;
}

/* ─── Buffet ───────────────────────────────────────────────────────────────
   ترتيب المالك حرفيًا (2026-10-16): الشوربتان ← ركن الشواء (كارفن) ← الأطباق
   العشرة ← جملتا الحلويات والسلطات ← سعر البوفيه — وكل هذا في صفحة واحدة
   («كل اللي قولتلك عليه في صفحة واحدة»): لا تقطيع ولا تدوير ولا حذف صنف.
   ما لا يدخل يصغُر بالمقياس المحلي في ‎erp-board.css‎ لا يُسقَط. الباب يضع
   سقوفًا (soups ٢، mains ١٠) فالسقوف هنا حرسٌ لا قرار. المقبلات ليست في
   ترتيبه: الباب يرسلها واللوحة لا ترسمها (في القديمة كان يسقطها الرسم بلا
   قرار من أحد).
   ──────────────────────────────────────────────────────────────────────── */
export const MAX_BUFFET_MAINS = 10;
export const MAX_BUFFET_SOUPS = 2;
/** عمودان للأطباق العشرة على كل الشاشات الطولية: خمسة صفوف متماثلة لا صفٌّ يتيم. */
export const BUFFET_MAINS_COLUMNS = 2;

export const BUFFET_SECTIONS = {
    soups: { ar: 'الشوربات', en: 'Soups' },
    carving: { ar: 'ركن الشواء', en: 'Carving Station' },
    mains: { ar: 'الأطباق الرئيسية', en: 'Main Courses' },
};

/**
 * الحلويات والسلطات جملتان ثابتتان لا قائمتا أصناف (المالك 2026-10-16:
 * «جملة السلطات والحلويات المتنوعة فقط جملة ثابتة»). تُرسم الجملة ما دام
 * لوحها فيه صنفٌ واحد على الأقل — شاشةٌ تدّعي تنوعًا لا يوجد تُخطئ في حق
 * الزبون، والمالك ملي‌ء الباب قبل أن يطلب الجملة.
 */
export const BUFFET_FIXED_LINES = {
    desserts: { ar: 'مجموعة متنوعة من الحلويات الشرقية والغربية', en: 'A variety of Eastern & Western desserts' },
    salads: { ar: 'مجموعة متنوعة من السلطات الشرقية والغربية', en: 'A variety of Eastern & Western salads' },
};

export function buffetPeriodKey(period) {
    return period === 'dinner' ? 'dinner' : 'lunch';
}

const named = (list) => (list || []).filter((it) => it && String(it.name || it.name_en || '').trim());

/**
 * The whole fixed composition as data: `top` panels (شوربات / ركن الشواء),
 * `mains` ≤ ١٠, `lines` (جملتان), and the grid numbers the renderer needs.
 * Returns null when the gate has nothing to draw for this period.
 */
export function buffetPage(sections, period) {
    const s = sections || {};
    const key = buffetPeriodKey(period);
    const panel = (name, items) => ({ key: name, ar: BUFFET_SECTIONS[name].ar, en: BUFFET_SECTIONS[name].en, items });
    const top = [];
    const soups = named(s.soups).slice(0, MAX_BUFFET_SOUPS);
    if (soups.length) { top.push(panel('soups', soups)); }
    const carve = (s.carving && s.carving[key]) || null;
    if (carve && String(carve.name || carve.name_en || '').trim()) { top.push(panel('carving', [carve])); }
    const mains = named((s.mains_by_period && s.mains_by_period[key]) || s.mains).slice(0, MAX_BUFFET_MAINS);
    const lines = ['desserts', 'salads']
        .filter((name) => named(s[name]).length)
        .map((name) => ({ key: name, ar: BUFFET_FIXED_LINES[name].ar, en: BUFFET_FIXED_LINES[name].en }));
    if (!top.length && !mains.length) { return null; }
    const cols = BUFFET_MAINS_COLUMNS;
    return { top, mains, lines, cols, rows: Math.ceil(mains.length / cols), topCols: Math.max(1, top.length) };
}

export function isBuffetEnabled(sections) {
    const s = sections || {};
    const byPeriod = s.mains_by_period || {};
    return Boolean(s.enabled) && PERIODS.some((p) => (byPeriod[p] || []).length > 0);
}

/* ─── Ticker (same content contract as the legacy footer) ────────────────── */
export const DEFAULT_FOOTERS = [
    'الأسعار شاملة الضريبة · Prices include tax · نتشرف بخدمتكم على مدار اليوم',
    'نتمنى لكم زيارة سعيدة وطعامًا شهيًا · Have a pleasant visit and enjoy your meal',
];

export function buffetPriceLine(settings) {
    const raw = Number(settings && settings.buffet_price);
    const price = Number.isFinite(raw) ? raw : 75;
    const shown = price.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `بوفيه مفتوح · OPEN BUFFET · ${shown} ريال / SAR per person`;
}

/**
 * شريط السعر تحت السلطات (طلب المالك 2026-10-16): «أقدر أغيره ويكون مخزّن» —
 * والخادم يخزّنه فعلًا في `menu_board_settings.buffet_price` (Migration 097،
 * و`menu-board-routes.js:262` يرسله، و`:490` يتحقّق منه، و`menu-admin.js:282`
 * يحرّره). لا شيء هنا يُختَرع: رقمٌ غير رقمٍ يعود إلى ٧٥ كما في كل الطبقات.
 */
export function buffetPriceParts(settings) {
    const raw = Number(settings && settings.buffet_price);
    const price = Number.isFinite(raw) ? raw : 75;
    return {
        value: price.toLocaleString('en-US', { maximumFractionDigits: 2 }),
        currency: { ar: 'ريال', en: 'SAR' },
        per: { ar: 'للفرد', en: 'per person' },
        label: { ar: 'سعر البوفيه', en: 'BUFFET PRICE' },
    };
}

export function tickerText(settings) {
    const s = settings || {};
    const configured = String(s.footer_text || '').trim();
    const extra = configured && !DEFAULT_FOOTERS.includes(configured) ? configured : '';
    return [buffetPriceLine(s), extra, DEFAULT_FOOTERS[1]].filter(Boolean).join('  ✦  ') + '  ✦';
}

/* ─── Payload validation / fingerprint / cache freshness ─────────────────── */
export function isValidPayload(data) {
    return Boolean(data && typeof data === 'object' && data.settings && Array.isArray(data.categories));
}

/**
 * البصمة وحدها لا ترى البوفيه: خادم اللوحة القديمة يبني `version` من
 * أصناف المنيو + الإعدادات + المنيو الأسبوعي فقط (menu-board-routes.js:400)،
 * وتخطيط البوفيه جدول منفصل لا يغيّر تلك النسخة. فلو اعتمدنا عليها وحدها
 * ظلت الشاشة تعرض المنيو العادي بعد تفعيل البوفيه حتى يُعاد فتح الصفحة.
 * هذا الطابع يضيف ما تُرسمه الشاشة فعلًا، وبلا أسماء كاملة كي يبقى رخيصًا.
 */
export function buffetStamp(sections) {
    const s = sections || {};
    const byPeriod = s.mains_by_period || {};
    const periodCount = PERIODS.map((p) => (byPeriod[p] || []).length).join('/');
    const carve = s.carving || {};
    const one = (v) => (v ? `${v.id ?? ''}:${String(v.name || v.name_en || '').length}` : '');
    const len = (k) => (Array.isArray(s[k]) ? s[k].length : 0);
    /* المقبلات خارج الطابع: اللوحة لا ترسمها، فتغيّرُها لا يستحق إعادة رسم */
    return `${Boolean(s.enabled)}|m${periodCount}|c${one(carve.lunch)}/${one(carve.dinner)}|s${len('soups')}|l${len('salads')}|d${len('desserts')}`;
}

export function fingerprint(data) {
    const d = data || {};
    return `${String(d.version)}|${JSON.stringify(d.settings)}|${buffetStamp(d.buffet_sections)}`;
}

export function isCacheFresh(cached, now = Date.now(), maxAge = BOARD_CACHE_MAX_AGE_MS) {
    if (!cached || typeof cached !== 'object') { return false; }
    const age = now - Number(cached.savedAt);
    return Number.isFinite(age) && age >= 0 && age <= maxAge && isValidPayload(cached.data);
}

export function normalizeLanguage(value) {
    return String(value || '').toLowerCase() === 'en' ? 'en' : 'ar';
}

/** Portrait bands: the layout changes structure, never scales a fixed canvas. */
export function aspectBand(width, height) {
    const w = Number(width); const h = Number(height);
    if (!(w > 0) || !(h > 0)) { return 'classic'; }
    const r = h / w;
    if (r < 1.5) { return 'wide'; }
    if (r < 1.9) { return 'classic'; }
    if (r < 2.15) { return 'tall'; }
    return 'super';
}

export function columnsForBand(band, width) {
    const w = Number(width) || 0;
    if (band === 'wide') { return w >= 1500 ? 3 : 2; }
    if (band === 'classic') { return w >= 1700 ? 3 : 2; }
    return 2;
}

/**
 * أرضية الراحة للبطاقة: لا صنف أقصر من ١٦٪ من أصغر بُعد في الشاشة.
 * القياس وحده يملأ أي شاشة حتى لو صارت البطاقة شرريطًا؛ المالك قرّر
 * كثافة ١٠ أصناف على 1080×1920 (قرار 2026-10-15) — هذه الأرضية تحفظ
 * تلك الكثافة على الشاشات القياسية وتترك الشاشات الأطول تملأ نفسها
 * فعلًا (٩:٢٠ تأخذ أصنافًا أكثر، لا أصغر).
 */
export const MIN_CARD_CQMIN = 16;

export function comfortRowHeight(minDimension, cqmin = MIN_CARD_CQMIN) {
    const m = Number(minDimension);
    const c = Number(cqmin);
    if (!(m > 0) || !(c > 0)) { return 0; }
    return (m / 100) * c;
}

/** Rows that fit a box — pure math over measured pixels, no DOM here. */
export function rowsForBox({ height, itemHeight, gap }) {
    const h = Number(height); const ih = Number(itemHeight); const g = Number(gap);
    if (!(h > 0) || !(ih > 0)) { return 1; }
    const step = ih + (Number.isFinite(g) ? g : 0);
    return Math.max(1, Math.floor((h + (Number.isFinite(g) ? g : 0)) / step));
}

export function capacityForBox(box, columns) {
    const cols = Math.max(1, Math.floor(Number(columns) || 1));
    return sanitizeCapacity(rowsForBox(box) * cols);
}
