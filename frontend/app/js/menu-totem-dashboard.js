/**
 * menu-totem-dashboard.js — لوحة تحكم شاشة المنيو الطولية (التوتم)
 * ────────────────────────────────────────────────────────────────────────────
 * مركز تحكّم كامل: محاكاة حقيقية للشاشة 1080×1920، محرّر البوفيه،
 * تبديل المظهر (سميز) والمواعيد، وزر «حفظ وعرض» ينشر التغيير على
 * الشاشة الحقيقية لحظيًا عبر سوكيت menu_board_changed.
 * المصادقة: حسابات النظام نفسها (/api/auth/login).
 */
'use strict';

const $ = (id) => document.getElementById(id);
let TOKEN = sessionStorage.getItem('mb_token') || '';
let APP_KEY = sessionStorage.getItem('mb_app_key') || '';
let ITEMS = [];                 // أصناف منيو الشاشة (جدول مستقل — لا كاشير)
let LAYOUT = {
    enabled: true, mains: [], breakfast_mains: [], lunch_mains: [], dinner_mains: [],
    soups: [], desserts: [], appetizers: [], salads: [], carving_by_day: [],
};
let SETTINGS = null;
let BOARD_CATEGORIES = [];
let SOCKET = null;
let DIRTY = false;              // تغييرات غير محفوظة
let AUTO_SAVE = null;           // مؤقّت الحفظ اللحظي التلقائي (800ms)
let AUTO_PREVIEW = null;        // مؤقّت تحديث المعاينة بعد الحفظ التلقائي

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MAIN_MEALS = [
    { id: 'breakfast_mains', ar: 'أطباق الفطار الرئيسية', en: 'BREAKFAST · MAIN COURSES' },
    { id: 'lunch_mains', ar: 'أطباق الغداء الرئيسية', en: 'LUNCH · MAIN COURSES' },
    { id: 'dinner_mains', ar: 'أطباق العشاء الرئيسية', en: 'DINNER · MAIN COURSES' },
];
/* تهريب نص للسمات — يمنع كسر HTML بأي اسم يكتبه المستخدم */
const escAttr = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escHtml = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* قرار المالك 2026-10-12: كل السيمز بنفس ديزاين النوار الفخم —
   7 درجات فاخرة (ذهبي/زمردي/ياقوتي/...) على قاعدة كحلي داكن موحّدة.
   الشاشة تثبت على noir مهما اختير — الدرجات تمييز بصري فاخر فقط. */
const BACKGROUNDS = [
    { id: 'noir',     ar: 'نوّار فخم ذهبي', en: 'Noir Royal Gold', css: 'linear-gradient(160deg,#072430,#061a2a 46%,#04121c)', gold: '#ffd469' },
    { id: 'ivory',    ar: 'نوار عاجي',      en: 'Noir Ivory',      css: 'linear-gradient(160deg,#0a2530,#071c26 46%,#04121c)', gold: '#ffe9b0' },
    { id: 'garden',   ar: 'نوار زمردي',     en: 'Noir Emerald',    css: 'linear-gradient(160deg,#07352a,#062a22 46%,#04121c)', gold: '#ffd469' },
    { id: 'champagne',ar: 'نوار شمبين',     en: 'Noir Champagne',  css: 'linear-gradient(160deg,#2a2410,#1c1a0c 46%,#0c0e08)', gold: '#ffe9b0' },
    { id: 'ocean',    ar: 'نوار محيطي',     en: 'Noir Ocean',      css: 'linear-gradient(160deg,#0a2038,#071728 46%,#04121c)', gold: '#ffd469' },
    { id: 'rose',     ar: 'نوار وردي',      en: 'Noir Rose',       css: 'linear-gradient(160deg,#2c1220,#200d18 46%,#0e0810)', gold: '#ffd4e0' },
    { id: 'night',    ar: 'نوار ليلي',      en: 'Noir Night',      css: 'linear-gradient(160deg,#101820,#0b1218 46%,#04080c)', gold: '#ffd469' },
];
const THEMES = [
    { id: 'emerald',  ar: 'زمردي',   en: 'Emerald',  c: '#0a8a4d' },
    { id: 'sapphire', ar: 'ياقوتي',  en: 'Sapphire', c: '#1467c2' },
    { id: 'ruby',     ar: 'ياقوتي أحمر', en: 'Ruby', c: '#d6335c' },
    { id: 'midnight', ar: 'ليل ملكي', en: 'Midnight', c: '#0b3d2e' },
];

/* ════════════ النافذة المنبثقة (تنبيه) ════════════ */
function toast(msg, ok) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (ok ? ' ok' : '');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hide'), 2800);
    t.classList.remove('hide');
}

/* ════════════ المصادقة ════════════ */
async function api(method, path, body) {
    const r = await fetch(path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {},
            APP_KEY ? { 'x-api-key': APP_KEY } : {}),
        body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { lock(); throw new Error('انتهت الجلسة'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { throw new Error(j.message || ('HTTP ' + r.status)); }
    return j;
}

function lock() {
    TOKEN = ''; APP_KEY = '';
    sessionStorage.removeItem('mb_token'); sessionStorage.removeItem('mb_app_key');
    $('loginOverlay').classList.remove('hidden');
    $('app').classList.add('locked');
}

async function unlock() {
    $('loginOverlay').classList.add('hidden');
    $('app').classList.remove('locked');
}

async function doLogin(u, p) {
    const btn = $('loginBtn');
    btn.disabled = true; btn.textContent = 'جارٍ الدخول…';
    try {
        const r = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) { throw new Error(j.message || 'بيانات الدخول غير صحيحة'); }
        const role = j.user && j.user.role;
        if (!['admin', 'manager', 'kitchen', 'sous_chef'].includes(role)) { throw new Error('هذه اللوحة للمدير أو الشيف فقط'); }
        TOKEN = j.access_token; APP_KEY = j.app_key || '';
        sessionStorage.setItem('mb_token', TOKEN); sessionStorage.setItem('mb_app_key', APP_KEY);
        await unlock();
        await boot();
    } catch (e) {
        $('loginError').textContent = e.message;
        $('loginError').classList.remove('hidden');
    } finally { btn.disabled = false; btn.textContent = 'دخول'; }
}

/* ════════════ التبويبات ════════════ */
function showTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
    if (name === 'screen') { refreshPreview(); }
}

/* ════════════ محاكاة الشاشة الحقيقية (1080×1920 بمقياس) ════════════ */
function fitPreview() {
    const wrap = $('previewWrap'), frame = $('previewFrame');
    if (!wrap || !frame) { return; }
    const pad = 8;
    const s = Math.min((wrap.clientWidth - pad) / 1080, (wrap.clientHeight - pad) / 1920);
    frame.style.transform = `translate(-50%,-50%) scale(${s})`;
    $('previewScale').textContent = Math.round(s * 100) + '%';
}
window.addEventListener('resize', fitPreview);

function refreshPreview() {
    const f = $('previewFrame');
    if (!f) { return; }
    // حفظ وضع اللغة الحالي عبر الرابط — إعادة تحميل المعاينة فقط
    f.src = '/app/menu-board.html';
    setTimeout(fitPreview, 120);
}

/* ════════════ المؤشرات ════════════ */
function renderStats(b) {
    const s = b.settings || {};
    const bs = b.buffet_sections || {};
    const all = [].concat(bs.mains || [], bs.soups || [], bs.desserts || [], bs.appetizers || [], bs.salads || []);
    $('kpiItems').textContent = all.length;
    $('kpiCats').textContent = (bs.enabled ? [bs.soups, bs.mains, bs.desserts, bs.appetizers, bs.salads].filter(a => a && a.length).length : (b.categories || []).length);
    $('kpiSold').textContent = all.filter(x => x.sold_out).length;
    $('kpiPrice').textContent = s.buffet_price ?? '—';
    $('kpiMode').textContent = bs.enabled ? 'بوفيه مفتوح' : 'تصنيفات';
    $('kpiMode').className = 'kpi-v ' + (bs.enabled ? 'good' : 'warn');
    const p = detectPeriod(s);
    const PN = { breakfast: 'الفطار', lunch: 'الغداء', dinner: 'العشاء' };
    $('kpiPeriod').textContent = p ? PN[p] : '—';
    document.querySelectorAll('#periodList li').forEach(li => li.classList.toggle('active', li.dataset.period === p));
    $('connBadge').className = 'badge badge-on'; $('connBadge').textContent = '● متصل';
}

function detectPeriod(s) {
    const now = new Date();
    const mins = now.getHours() * 60 + now.getMinutes();
    const rd = (v, fb) => { const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/); return m ? (+m[1]) * 60 + (+m[2]) : fb; };
    const b = rd(s.breakfast_start, 300), l = rd(s.lunch_start, 720), d = rd(s.dinner_start, 1020);
    if (mins >= d || mins < b) { return 'dinner'; }
    return mins >= l ? 'lunch' : 'breakfast';
}

/* ════════════ المظهر (سميز القالب) ════════════ */
function renderThemes() {
    $('bgSwatches').innerHTML = BACKGROUNDS.map(t => `
        <button type="button" class="swatch${SETTINGS.background_style === t.id ? ' active' : ''}" data-bg="${t.id}">
            <span class="sw-preview" style="background:${t.css}"><i style="color:${t.gold}">✦</i></span>
            <b>${t.ar}</b><small>${t.en}</small>
        </button>`).join('');
    $('themeSwatches').innerHTML = THEMES.map(t => `
        <button type="button" class="swatch sm${SETTINGS.theme_style === t.id ? ' active' : ''}" data-theme="${t.id}">
            <span class="sw-dot" style="background:${t.c}"></span><b>${t.ar}</b><small>${t.en}</small>
        </button>`).join('');
    $('bgSwatches').querySelectorAll('.swatch').forEach(el => el.onclick = () => {
        SETTINGS.background_style = el.dataset.bg; markDirty(); renderThemes();
    });
    $('themeSwatches').querySelectorAll('.swatch').forEach(el => el.onclick = () => {
        SETTINGS.theme_style = el.dataset.theme; markDirty(); renderThemes();
    });
}

/* ════════════ محرّر البوفيه — إضافة + أقسام مرتبة ════════════
   طلب المالك 2026-10-12: نموذج إضافة بخانتين (عربي/إنجليزي) فوق،
   والأقسام تحته — كل قسم يعرض أصنافه المختارة كبطاقات قابلة للإزالة
   + الأصناف المتاحة كشرائح. لا تداخل بين الأقسام. */
const SECTIONS = [
    { id: 'soups', ar: 'الشوربات', en: 'SOUPS', max: 2, hint: 'نوعان طازجان يُقدَّمان يوميًا' },
    { id: 'mains', ar: 'الأطباق الرئيسية', en: 'MAIN COURSES', max: 10, hint: 'حتى ١٠ أطباق تظهر في قلب البوفيه' },
    { id: 'desserts', ar: 'الحلويات الشرقية والغربية', en: 'DESSERTS', max: 8, hint: 'تشكيلة حلويات شرقية وغربية' },
    { id: 'appetizers', ar: 'المقبلات', en: 'APPETIZERS', max: 8, hint: 'قبلات مختارة بعناية الشيف' },
    { id: 'salads', ar: 'سلطات محلية وعالمية', en: 'SALADS', max: 8, hint: 'سلطات محلية وعالمية' },
];
let TR_TIMER = null;        // مؤقّت الترجمة الفورية
let TR_REQUEST = 0;         // يمنع نتيجة ترجمة قديمة من استبدال النص الحالي
let TR_CONTROLLER = null;
let EN_TOUCHED = false;     // هل عدّل المستخدم الإنجليزية يدويًا؟

/* ════════════ الترجمة الذكية للطعام ════════════
   طلب المالك 2026-10-12: ترجمة دقيقة وذكية.
   الطبقة 1 (فورية/بلا إنترنت): قاموس أطباق + مكوّنات + طرق طهي —
   تعطي أسماء مطاعم احترافية (Kabsa/Biryani/Mandi…) بدل الترجمة الحرفية.
   الطبقة 2 (احتياطية): MyMemory للأصناف غير المعروفة.
   • تطبيع تلقائي: أ/إ/آ→ا ة→ه ى→ي — «شوربه» تطابق «شوربة» */
const AR_NORM = s => (s || '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/ـ/g, '').replace(/\s+/g, ' ').trim();
const DISH_DICT = {
    'كبسة دجاج': 'Chicken Kabsa', 'كبسة لحم': 'Lamb Kabsa', 'كبسة سمك': 'Fish Kabsa',
    'كبسة': 'Kabsa', 'برياني دجاج': 'Chicken Biryani', 'برياني لحم': 'Lamb Biryani',
    'برياني': 'Biryani', 'مندي دجاج': 'Chicken Mandi', 'مندي لحم': 'Lamb Mandi',
    'مندي': 'Mandi', 'مضغوط دجاج': 'Chicken Madghout', 'مضغوط لحم': 'Lamb Madghout',
    'شوربة عدس': 'Lentil Soup', 'شوربة العدس': 'Lentil Soup',
    'شوربه عدس': 'Lentil Soup', 'شوربه العدس': 'Lentil Soup',
    'شوربة لسان عصفور': 'Orzo Soup', 'شوربه لسان عصفور': 'Orzo Soup',
    'شوربة شوفان': 'Oat Soup', 'شوربه شوفان': 'Oat Soup',
    'شوربة شعيرية': 'Vermicelli Soup', 'شوربه شعريه': 'Vermicelli Soup',
    'شوربة دجاج': 'Chicken Soup', 'شوربه دجاج': 'Chicken Soup',
    'شوربة خضار': 'Vegetable Soup', 'شوربه خضار': 'Vegetable Soup',
    'شوربة حريرة': 'Harira Soup', 'شوربه حريره': 'Harira Soup',
    'شوربة': 'Soup', 'شوربه': 'Soup',
    'مكرونة بشاميل': 'Bechamel Pasta', 'مكرونة': 'Pasta', 'بشاميل': 'Bechamel',
    'أيدام كاري': 'Curry Stew', 'أيدام': 'Stew', 'كاري': 'Curry',
    'دجاجة مشوية كاملة مع الأرز': 'Grilled Whole Chicken with Rice',
    'دجاجة مشوية كاملة': 'Grilled Whole Chicken',
    'نصف دجاجة مشوية مع الأرز': 'Grilled Chicken Half with Rice',
    'نصف دجاجة مشوية': 'Grilled Chicken Half',
    'ربع دجاجة مشوية مع الأرز': 'Grilled Chicken Quarter with Rice',
    'ربع دجاجة مشوية': 'Grilled Chicken Quarter',
    'دجاج مشوي': 'Grilled Chicken', 'دجاجة مشوية': 'Grilled Chicken',
    'لحم مشوي': 'Grilled Lamb', 'سمك مشوي': 'Grilled Fish',
    'كباب دجاج': 'Chicken Kebab', 'كباب لحم': 'Lamb Kebab', 'كباب': 'Kebab',
    'شيش طاووق': 'Shish Tawook', 'شاورما دجاج': 'Chicken Shawarma',
    'شاورما لحم': 'Meat Shawarma', 'شاورما': 'Shawarma',
    'مظبي دجاج': 'Chicken Madhbi', 'مظبي': 'Madhbi',
    'حنيذ لحم': 'Haneeth Lamb', 'حنيذ': 'Haneeth',
    'مقلوبة': 'Maqluba', 'قدرة': 'Qidra', 'زربيان': 'Zurbian',
    'عصيدة': 'Aseeda', 'جريش': 'Jareesh', 'قرصان': 'Qursan',
    'مرقوق': 'Marqouq', 'سليق': 'Saleeg', 'كوزي': 'Koozi',
    'محشي': 'Stuffed Vegetables', 'ورق عنب': 'Grape Leaves',
    'سمبوسة': 'Samosa', 'كبة': 'Kibbeh', 'فلافل': 'Falafel',
    'حمص': 'Hummus', 'متبل': 'Mutabbal', 'تبولة': 'Tabbouleh',
    'فتوش': 'Fattoush', 'سلطة خضراء': 'Green Salad', 'سلطة': 'Salad',
    'أرز أبيض': 'White Rice', 'أرز بخاري': 'Bukhari Rice', 'أرز': 'Rice',
    'خبز': 'Bread', 'تميس': 'Tamees',
    'كنافة': 'Kunafa', 'بقلاوة': 'Baklava', 'قطايف': 'Qatayef',
    'مهلبية': 'Muhallabia', 'أم علي': 'Umm Ali', 'لقيمات': 'Luqaimat',
    'حلويات شرقية': 'Oriental Desserts', 'حلويات غربية': 'Western Desserts',
    'عصير برتقال': 'Orange Juice', 'عصير': 'Juice',
    'شاي': 'Tea', 'شاي اخضر': 'Green Tea', 'شاي مغربي': 'Moroccan Tea',
    'قهوة عربية': 'Arabic Coffee', 'قهوة': 'Coffee', 'قهوة تركية': 'Turkish Coffee',
    'نسكافيه': 'Nescafe', 'كابتشينو': 'Cappuccino', 'لاتيه': 'Latte',
    'عصير افوكادو': 'Avocado Juice', 'عصير فراولة': 'Strawberry Juice',
    'كوكتيل فواكه': 'Fruit Cocktail', 'سموزي': 'Smoothie',
    'مشروبات غازية': 'Soft Drinks', 'مياه معدنية': 'Mineral Water',
    'سلطة يونانية': 'Greek Salad', 'سلطة الجرجير': 'Arugula Salad',
    'شوربة البصل': 'Onion Soup', 'شوربة الجمبري': 'Shrimp Soup',
    'شوربة السمك': 'Fish Soup', 'شوربة الذرة': 'Corn Soup',
    'كبسة نباتية': 'Vegetable Kabsa', 'برياني خضار': 'Vegetable Biryani',
    'دجاج بالكاري': 'Chicken Curry', 'لحم بالكاري': 'Lamb Curry',
    'دجاج بالعسل': 'Honey Chicken', 'دجاج بالثوم': 'Garlic Chicken',
    'سمك بالفرن': 'Baked Fish', 'سمك مقلي': 'Fried Fish',
    'فيليه سمك': 'Fish Fillet', 'جمبري مشوي': 'Grilled Shrimp',
    'جمبري مقلي': 'Fried Shrimp', 'كاليماري': 'Calamari',
    'مكرونة بالصلصة': 'Pasta with Sauce', 'مكرونة بالجبن': 'Mac and Cheese',
    'بيتزا': 'Pizza', 'بيتزا خضار': 'Vegetable Pizza',
    'برجر دجاج': 'Chicken Burger', 'برجر لحم': 'Beef Burger',
    'ساندوتش شاورما': 'Shawarma Sandwich', 'ساندوتش': 'Sandwich',
    'فطيرة': 'Pie', 'فطيرة جبن': 'Cheese Pie', 'فطيرة زعتر': 'Zaatar Pie',
    'مناقيش': 'Manakish', 'بيض': 'Eggs', 'بيض مقلي': 'Fried Eggs',
    'فول': 'Fava Beans', 'فول مدمس': 'Foul Medammes',
    'لبنة': 'Labneh', 'جبنة': 'Cheese', 'زعتر': 'Zaatar',
    'عسل': 'Honey', 'مربى': 'Jam', 'زبدة': 'Butter',
    'تمر': 'Dates', 'تمر سكري': 'Sukkari Dates',
    'فواكه مشكلة': 'Mixed Fruits', 'سلطة فواكه': 'Fruit Salad',
};
const MEAT_MAP = [
    [/دجاج|دجاجة|فراخ/i, 'Chicken'], [/لحم|لحمة|ضان|غنم/i, 'Lamb'],
    [/سمك|فيليه|هامور|شعور/i, 'Fish'], [/روبيان|جمبري/i, 'Shrimp'],
    [/كبدة/i, 'Liver'], [/كفتة/i, 'Kofta'],
];
const COOK_MAP = [
    [/مشو[ية]/i, 'Grilled'], [/مقل[ية]/i, 'Fried'], [/مسلوق[ة]?/i, 'Boiled'],
    [/محم[رة]/i, 'Roasted'], [/مدخن[ة]?/i, 'Smoked'], [/بالفرن/i, 'Baked'],
];
const PART_MAP = [
    [/كامل[ة]?/i, 'Whole'], [/نصف/i, 'Half'], [/ربع/i, 'Quarter'],
];
const EXTRA_MAP = [
    [/مع الأرز/i, 'with Rice'], [/مع الخضار/i, 'with Vegetables'],
    [/بالصلصة/i, 'with Sauce'], [/بالثوم/i, 'with Garlic'],
    [/حار[ة]?/i, 'Spicy'],
];

/* ترجمة ذكية: مطابقة حرفية → تركيب من القواميس → MyMemory */
function smartTranslate(ar) {
    const t = (ar || '').trim().replace(/\s+/g, ' ');
    if (!t) {return '';}
    if (DISH_DICT[t]) {return DISH_DICT[t];}
    /* مطابقة مُطبّعة: تتجاهل فروق أ/إ/آ ة/ه ى/ي */
    const nt = AR_NORM(t);
    for (const k of Object.keys(DISH_DICT)) {
        if (AR_NORM(k) === nt) {return DISH_DICT[k];}
    }
    /* تركيب ذكي: لحم + طريقة + جزء + إضافات */
    let meat = '', cook = '', part = ''; const extras = [];
    for (const [re, en] of MEAT_MAP) { if (re.test(t)) { meat = en; break; } }
    for (const [re, en] of COOK_MAP) { if (re.test(t)) { cook = en; break; } }
    for (const [re, en] of PART_MAP) { if (re.test(t)) { part = en; break; } }
    for (const [re, en] of EXTRA_MAP) { if (re.test(t)) { extras.push(en); } }
    /* اسم الطبق الأساسي (كبسة/برياني/شوربة/...) */
    let base = '';
    const bases = [
        [/كبسة/i, 'Kabsa'], [/برياني/i, 'Biryani'], [/مندي/i, 'Mandi'],
        [/شوربة/i, 'Soup'], [/مكرونة|باستا/i, 'Pasta'], [/سلطة/i, 'Salad'],
        [/أيدام/i, 'Stew'], [/كباب/i, 'Kebab'], [/شاورما/i, 'Shawarma'],
    ];
    for (const [re, en] of bases) { if (re.test(t)) { base = en; break; } }
    if (meat || base) {
        const bits = [];
        if (cook && base !== 'Soup') { bits.push(cook); }
        if (part && meat) { bits.push(part, meat); }
        else if (meat) { bits.push(meat); }
        if (base && base !== meat) {
            if (base === 'Soup' && /عدس/i.test(t)) { return 'Lentil Soup'; }
            if (base === 'Soup') { bits.push('Soup'); }
            else if (!bits.includes(base)) { bits.push(base); }
        }
        if (extras.length) { bits.push(extras[0]); }
        if (bits.length) {
            return bits.join(' ')
                .replace(/\b\w/g, c => c.toUpperCase())
                .replace(/\bWith\b/g, 'with');
        }
    }
    return null;   /* غير معروف → MyMemory */
}

/* ترجمة فورية عربي → إنجليزي أثناء الكتابة.
   الطبقة الذكية أولًا (فورية)، ثم MyMemory للغير معروف.
   تُملأ الخانة الإنجليزية فقط إذا لم يلمسها المستخدم يدويًا. */
async function autoTranslate(ar) {
    const en = $('newEn');
    if (!en || EN_TOUCHED) { return; }
    const t = (ar || '').trim();
    const request = TR_REQUEST;
    if (t.length < 2) { return; }
    const smart = smartTranslate(t);
    if (smart) {
        if (request === TR_REQUEST && $('newAr').value.trim() === t && !EN_TOUCHED) {
            en.value = smart;
            en.placeholder = 'الاسم بالإنجليزية (ترجمة ذكية ✓)';
            $('translationStatus').textContent = 'تمت الترجمة الذكية — يمكنك تعديل الاسم الإنجليزي قبل الإضافة.';
            $('translationStatus').className = 'translation-status is-success';
        }
        return;
    }
    en.placeholder = 'جارٍ الترجمة…';
    $('translationStatus').textContent = 'جارٍ ترجمة الصنف إلى الإنجليزية…';
    $('translationStatus').className = 'translation-status is-pending';
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    TR_CONTROLLER = controller;
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
    try {
        const r = await fetch('https://api.mymemory.translated.net/get?q='
            + encodeURIComponent(t) + '&langpair=ar|en', controller ? { signal: controller.signal } : {});
        if (!r.ok) { throw new Error('خدمة الترجمة غير متاحة الآن'); }
        const j = await r.json();
        const out = (j && j.responseData && j.responseData.translatedText || '').trim();
        if (request !== TR_REQUEST || $('newAr').value.trim() !== t || EN_TOUCHED) { return; }
        if (out && !/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID/i.test(out)) {
            en.value = out;
            en.placeholder = 'الاسم بالإنجليزية (تُرجم تلقائيًا)';
            $('translationStatus').textContent = 'تمت الترجمة تلقائيًا — راجع الاسم قبل إضافة الصنف.';
            $('translationStatus').className = 'translation-status is-success';
        } else {
            $('translationStatus').textContent = 'لم تتوفر ترجمة لهذا الاسم. اكتب الاسم الإنجليزي يدويًا قبل الإضافة.';
            $('translationStatus').className = 'translation-status is-error';
        }
    } catch (error) {
        if (request === TR_REQUEST && $('newAr').value.trim() === t) {
            $('translationStatus').textContent = 'تعذّرت الترجمة التلقائية. اكتب الاسم الإنجليزي يدويًا قبل الإضافة.';
            $('translationStatus').className = 'translation-status is-error';
            console.warn('Menu item translation failed:', error.message);
        }
    } finally {
        if (timeout) { clearTimeout(timeout); }
        if (TR_CONTROLLER === controller) { TR_CONTROLLER = null; }
        if (request === TR_REQUEST) { en.placeholder = 'الاسم بالإنجليزية (يُترجم تلقائيًا)'; }
    }
}

function scheduleTranslate() {
    clearTimeout(TR_TIMER);
    TR_REQUEST += 1;
    if (TR_CONTROLLER) { TR_CONTROLLER.abort(); TR_CONTROLLER = null; }
    if (!EN_TOUCHED) { $('newEn').value = ''; }
    const query = $('newAr') ? $('newAr').value.trim() : '';
    const status = $('translationStatus');
    if (status) {
        status.textContent = EN_TOUCHED
            ? 'سيبقى الاسم الإنجليزي الذي كتبته يدويًا دون تغيير.'
            : (query.length >= 2 ? 'سيُترجم الاسم تلقائيًا أثناء الكتابة.' : '');
        status.className = 'translation-status';
    }
    TR_TIMER = setTimeout(() => autoTranslate($('newAr') ? $('newAr').value : ''), 650);
}

/* إضافة صنف جديد للمنيو (جدول مستقل — لا يمس الكاشير) */
async function addMenuItem() {
    const ar = ($('newAr') || {}).value || '';
    const en = ($('newEn') || {}).value || '';
    const sec = ($('newSection') || {}).value || 'mains';
    if (!ar.trim()) { toast('اكتب اسم الصنف بالعربي أولًا', false); $('newAr').focus(); return; }
    const btn = $('btnAddItem');
    btn.disabled = true; btn.textContent = 'جارٍ الإضافة…';
    try {
        const j = await api('POST', '/api/menu-board/items', { name_ar: ar.trim(), name_en: en.trim(), section: sec });
        const item = j.item || j;
        if (item && item.id != null) {
            ITEMS.push({ id: Number(item.id), name_ar: item.name_ar || ar.trim(), name_en: item.name_en || en.trim(), section: sec, is_active: true });
            const def = SECTIONS.find(s => s.id === sec);
            const arr = LAYOUT[sec] || (LAYOUT[sec] = []);
            if (sec === 'mains') {
                toast('أُضيف إلى قائمة الأطباق الرئيسية — اختره لكل وجبة', true);
            } else if (def && arr.length >= def.max) { toast(`أُضيف للقائمة — الحد الأقصى ${def.max} صنف`, true); }
            else {
                /* صنف واحد لا يظهر في قسمين */
                SECTIONS.forEach(s2 => { if (s2.id !== sec) { LAYOUT[s2.id] = (LAYOUT[s2.id] || []).filter(x => Number(x) !== Number(item.id)); } });
                arr.push(Number(item.id));
            }
            $('newAr').value = ''; $('newEn').value = '';
            TR_REQUEST += 1;
            if (TR_CONTROLLER) { TR_CONTROLLER.abort(); TR_CONTROLLER = null; }
            EN_TOUCHED = false;
            renderBuffetEditor();
            markDirty();
            toast('✓ أُضيف الصنف', true);
            $('translationStatus').textContent = '';
            $('translationStatus').className = 'translation-status';
        }
    } catch (e) { toast('تعذّر الإضافة: ' + e.message, false); }
    finally { btn.disabled = false; btn.innerHTML = '＋ إضافة الصنف'; }
}

/* حذف صنف من المنيو (جدول مستقل — لا يمس الكاشير) */
const group = (id, label, en, values, max, hint, catalogSection = id) => {
    /* طلب المالك 2026-10-12: كل قسم يعرض «أصنافه فقط» — لا تختلط الأطباق
       الساخنة (mains) مع الشوربات ولا أي قسم مع آخر. الصنف المُضاف يظهر
       مفعّلًا (on)، وباقي أصناف نفس القسم تظهر بخافت لتُضاف بضغطة واحدة. */
    const mine = ITEMS.filter(it => String(it.section) === catalogSection);
    const chips = mine.length
        ? mine.map(it => {
            const name = it.name_ar || it.name_en || 'صنف';
            const search = `${name} ${it.name_en || ''}`;
            return `<button type="button" class="chip${values.includes(Number(it.id)) ? ' on' : ''}" data-id="${Number(it.id)}" data-search="${escAttr(search)}">
                <span>${escHtml(name)}</span><small>#${Number(it.id)}</small></button>`;
        }).join('')
        : `<p class="empty">لا توجد أصناف في «${label}» بعد — أضِف صنفًا من النموذج أعلاه واختر القسم المناسب.</p>`;
    return `
    <div class="ed-group${catalogSection === 'mains' ? ' ed-main-group' : ''}">
        <div class="ed-head"><b>${label}</b><span>${en}</span><em class="ed-count"><i id="c-${id}">${values.length}</i>${max ? ' / ' + max : ''}</em></div>
        <p class="ed-hint">${hint}</p>
        ${catalogSection === 'mains' && mine.length ? `<input class="ed-search" type="search" data-filter="${id}" placeholder="ابحث في قائمة الأطباق (${mine.length})…" aria-label="البحث في ${label}">` : ''}
        <div class="ed-chips" id="chips-${id}" data-max="${max || ''}" data-field="${id}">${chips}</div>
    </div>`;
};

function renderBuffetEditor() {
    const host = $('buffetEditor');
    /* نموذج الإضافة دائمًا ظاهر — حتى لو لا توجد أصناف بعد */
    const addForm = `
        <div class="ed-add">
            <div class="ed-head"><b>＋ إضافة صنف جديد للمنيو</b><span>ADD DISH</span></div>
            <p class="ed-hint">اكتب بالعربي — الإنجليزية تُترجم <b>تلقائيًا أثناء الكتابة</b> (يمكنك تعديلها يدويًا).</p>
            <div class="ed-add-row">
                <label class="ed-field ed-ar">الاسم بالعربي
                    <input id="newAr" type="text" dir="rtl" placeholder="مثال: كبسة دجاج" autocomplete="off">
                </label>
                <label class="ed-field ed-en">الاسم بالإنجليزية
                    <input id="newEn" type="text" dir="ltr" placeholder="الاسم بالإنجليزية (يُترجم تلقائيًا)" autocomplete="off">
                </label>
                <label class="ed-field ed-sec">القسم
                    <select id="newSection">
                        ${SECTIONS.map(s => `<option value="${s.id}">${s.ar}</option>`).join('')}
                    </select>
                </label>
                <button type="button" id="btnAddItem" class="btn btn-gold">＋ إضافة الصنف</button>
            </div>
            <p id="translationStatus" class="translation-status" aria-live="polite"></p>
        </div>`;
    if (!ITEMS.length) {
        host.innerHTML = addForm + '<p class="empty">لا توجد أصناف بعد — أضِف أول صنف من النموذج أعلاه.</p>';
        bindAddForm();
        return;
    }
    host.innerHTML = addForm + `
        <div class="ed-grid">
            ${MAIN_MEALS.map(meal => group(
                meal.id, meal.ar, meal.en, LAYOUT[meal.id] || [], 10,
                'اختر حتى ١٠ أطباق من قائمتك الرئيسية لهذه الوجبة.', 'mains',
            )).join('')}
            ${SECTIONS.filter(s => s.id !== 'mains')
        .map(s => group(s.id, s.ar, s.en, LAYOUT[s.id] || [], s.max, s.hint)).join('')}
        </div>
        <div class="ed-carving">
            <div class="ed-head"><b>ركن الشواء اليومي</b><span>CARVING STATION</span></div>
            <p class="ed-hint">اكتب اسم الركن يدويًا (مثال: لحم حنيذ على الفحم) — أو اختر من قائمة الأصناف المقترحة.</p>
            <datalist id="carvNames">${ITEMS.map(it => `<option value="${escAttr(it.name_ar || '')}"></option>`).join('')}</datalist>
            <div class="carv-grid">
                ${DAYS.map((d, i) => {
                    const row = (LAYOUT.carving_by_day || []).find(x => Number(x.day) === i) || {};
                    /* القيمة القديمة قد تكون رقم معرّف صنف — نحوّلها للاسم للعرض */
                    const val = v => {
                        if (v == null || v === '') { return ''; }
                        if (typeof v === 'string') { return v; }
                        const it = ITEMS.find(x => Number(x.id) === Number(v));
                        return it ? (it.name_ar || '') : '';
                    };
                    return `<div class="carv-day"><b>${d}</b>
                        <label>الغداء<input type="text" dir="rtl" list="carvNames" data-carv="${i}" data-slot="lunch" value="${escAttr(val(row.lunch))}" placeholder="اكتب اسم الركن…" autocomplete="off"></label>
                        <label>العشاء<input type="text" dir="rtl" list="carvNames" data-carv="${i}" data-slot="dinner" value="${escAttr(val(row.dinner))}" placeholder="اكتب اسم الركن…" autocomplete="off"></label>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    bindAddForm();
    bindChips(host);
}

/* ربط نموذج الإضافة: ترجمة فورية + زر الإضافة */
function bindAddForm() {
    const ar = $('newAr'), en = $('newEn');
    if (ar) {
        ar.oninput = () => scheduleTranslate();
        ar.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); addMenuItem(); } };
    }
    if (en) {
        en.oninput = () => {
            EN_TOUCHED = !!en.value.trim();
            if (EN_TOUCHED) {
                $('translationStatus').textContent = 'تم إدخال الاسم الإنجليزي يدويًا.';
                $('translationStatus').className = 'translation-status';
            } else { scheduleTranslate(); }
        };
        en.onkeydown = ev => { if (ev.key === 'Enter') { ev.preventDefault(); addMenuItem(); } };
    }
    const btn = $('btnAddItem');
    if (btn) { btn.onclick = addMenuItem; }
}

/* ربط شرائح الاختيار + أزرار الحذف */
function bindChips(host) {
    host.querySelectorAll('[data-filter]').forEach(input => {
        input.oninput = () => {
            const query = String(input.value || '').trim().toLocaleLowerCase();
            const box = $('chips-' + input.dataset.filter);
            if (!box) { return; }
            box.querySelectorAll('.chip').forEach(chip => {
                chip.hidden = query !== '' && !String(chip.dataset.search || '').toLocaleLowerCase().includes(query);
            });
        };
    });
    host.querySelectorAll('.ed-chips').forEach(box => box.querySelectorAll('.chip').forEach(chip => chip.onclick = () => {
        const field = box.dataset.field, max = Number(box.dataset.max) || 99;
        const id = Number(chip.dataset.id);
        const arr = LAYOUT[field];
        const at = arr.indexOf(id);
        if (at >= 0) { arr.splice(at, 1); }
        else {
            if (arr.length >= max) { toast(`الحد الأقصى ${max} في هذا القسم`, false); return; }
            /* صنف واحد لا يظهر في قسمين — نُزّله من أي قسم آخر أولًا */
            ['soups', 'desserts', 'appetizers', 'salads'].forEach(f => {
                if (f !== field && Array.isArray(LAYOUT[f])) { LAYOUT[f] = LAYOUT[f].filter(x => Number(x) !== id); }
            });
            arr.push(id);
        }
        chip.classList.toggle('on', at < 0);
        $('c-' + field).textContent = arr.length;
        markDirty();
        renderBuffetEditor();   /* إعادة الرسم لإخفاء الصنف من الأقسام الأخرى */
    }));
    /* ركن الشواء: خانة نص حر (يكتب الاسم يدويًا) — تُحفظ مباشرة */
    host.querySelectorAll('[data-carv]').forEach(inp => {
        inp.oninput = () => {
            const day = Number(inp.dataset.carv), slot = inp.dataset.slot;
            LAYOUT.carving_by_day = Array.from({ length: 7 }, (_, d) => {
                const cur = (LAYOUT.carving_by_day || []).find(x => Number(x.day) === d) || {};
                return { day: d, lunch: cur.lunch ?? null, dinner: cur.dinner ?? null };
            });
            const v = String(inp.value || '').trim();
            LAYOUT.carving_by_day[day][slot] = v || null;
            markDirty();
        };
    });
}

function markDirty() {
    DIRTY = true;
    $('saveBar').classList.add('on');
    /* حفظ تلقائي لحظي: 800ms بعد آخر تعديل → الشاشة الحقيقية تتلقّى
       menu_board_changed عبر السوكت وتحدّث نفسها خلال ثانية. */
    clearTimeout(AUTO_SAVE);
    AUTO_SAVE = setTimeout(() => { saveAndDisplay({ live: true }); }, 800);
}
function schedulePreview() {
    clearTimeout(AUTO_PREVIEW);
    AUTO_PREVIEW = setTimeout(() => { try { refreshPreview(); } catch (_) { /* معاينة اختيارية */ } }, 1200);
}

/* ════════════ المواعيد ════════════ */
function renderSchedule(s) {
    $('setTitle').value = s.title || '';
    $('setSubtitle').value = s.subtitle || '';
    $('setFooter').value = s.footer_text || '';
    $('setBuffetPrice').value = s.buffet_price ?? 75;
    const rd = (v, fb) => { const m = String(v || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/); return m ? `${m[1]}:${m[2]}` : fb; };
    $('setBreakfastStart').value = rd(s.breakfast_start, '05:00');
    $('setLunchStart').value = rd(s.lunch_start, '12:00');
    $('setDinnerStart').value = rd(s.dinner_start, '17:00');
    const categories = [...new Set(BOARD_CATEGORIES
        .map(category => typeof category === 'string' ? category : category && category.name)
        .filter(name => typeof name === 'string' && name.trim())
        .map(name => name.trim()))];
    [
        ['setBreakfastCategory', s.breakfast_category],
        ['setLunchCategory', s.lunch_category],
        ['setDinnerCategory', s.dinner_category],
    ].forEach(([id, selected]) => {
        const select = $(id);
        const names = categories.slice();
        if (selected && !names.includes(selected)) { names.push(selected); }
        select.innerHTML = '<option value="">تلقائي حسب اسم القسم</option>' +
            names.map(name => `<option value="${escAttr(name)}">${escHtml(name)}</option>`).join('');
        select.value = selected || '';
    });
    document.querySelectorAll('#pane-schedule input,#pane-schedule select,#pane-schedule textarea').forEach(el => {
        el.oninput = el.onchange = () => markDirty();
    });
}

/* ════════════ الحفظ والعرض ════════════
   opts.live = true  → حفظ صامت لحظي: بلا إعادة تحميل المحرّر (يحفظ
   موضع المؤشر أثناء الكتابة)، بلا تبديل تبويب، وبلا نوافذ منبثقة. */
async function saveAndDisplay(opts) {
    const live = !!(opts && opts.live === true);
    const btn = $('btnSave');
    const starts = {
        breakfast: $('setBreakfastStart').value,
        lunch: $('setLunchStart').value,
        dinner: $('setDinnerStart').value,
    };
    const categories = {
        breakfast: $('setBreakfastCategory').value,
        lunch: $('setLunchCategory').value,
        dinner: $('setDinnerCategory').value,
    };
    const chosenCategories = Object.values(categories).filter(Boolean);
    if (new Set(chosenCategories).size !== chosenCategories.length) {
        if (!live) {
            toast('اختر قسمًا مختلفًا لكل وجبة، أو اتركه على الاختيار التلقائي', false);
            showTab('schedule');
        }
        return;
    }
    const badTime = !Object.values(starts).every(v => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v)) ||
        !(starts.breakfast < starts.lunch && starts.lunch < starts.dinner);
    if (badTime) {
        if (live) { return; }   /* يبقى DIRTY ويُصحَّح يدويًا */
        toast('رتّب المواعيد: الإفطار ثم الغداء ثم العشاء', false); showTab('schedule'); return;
    }
    const body = {
        title: $('setTitle').value,
        subtitle: $('setSubtitle').value,
        breakfast_start: starts.breakfast, lunch_start: starts.lunch, dinner_start: starts.dinner,
        breakfast_category: categories.breakfast || null,
        lunch_category: categories.lunch || null,
        dinner_category: categories.dinner || null,
        breakfast_hours: `${starts.breakfast} - ${starts.lunch}`,
        lunch_hours: `${starts.lunch} - ${starts.dinner}`,
        dinner_hours: `${starts.dinner} - ${starts.breakfast}`,
        footer_text: $('setFooter').value,
        buffet_price: $('setBuffetPrice').value,
        background_style: SETTINGS.background_style,
        theme_style: SETTINGS.theme_style,
        buffet_layout: {
            enabled: LAYOUT.enabled,
            mains: LAYOUT.lunch_mains, breakfast_mains: LAYOUT.breakfast_mains,
            lunch_mains: LAYOUT.lunch_mains, dinner_mains: LAYOUT.dinner_mains,
            soups: LAYOUT.soups, desserts: LAYOUT.desserts,
            appetizers: LAYOUT.appetizers, salads: LAYOUT.salads,
            carving_by_day: LAYOUT.carving_by_day,
        },
    };

    /* ── المسار اللحظي: حفظ صامت لا يقطع الكتابة ── */
    if (live) {
        try {
            await api('PUT', '/api/menu-board/settings', body);
            DIRTY = false; $('saveBar').classList.remove('on');
            schedulePreview();
        } catch (e) {
            console.warn('auto-save failed:', e.message);
            toast('تعذّر الحفظ التلقائي: ' + e.message, false);
        }
        return;
    }

    btn.disabled = true; btn.innerHTML = '<i class="spin">↻</i> جارٍ الحفظ والعرض…';
    try {
        await api('PUT', '/api/menu-board/settings', body);
        DIRTY = false; $('saveBar').classList.remove('on');
        toast('✓ حُفظ وعُرض — الشاشة تحدّثت لحظيًا', true);
        try {
            await loadAll();
        } catch (e) {
            toast('تم الحفظ، لكن تعذر تحديث بيانات اللوحة: ' + e.message, false);
        }
        showTab('screen');
        setTimeout(refreshPreview, 220);
    } catch (e) { toast('تعذّر الحفظ: ' + e.message, false); }
    finally { btn.disabled = false; btn.innerHTML = '💾 حفظ وعرض على الشاشة'; }
}

/* ════════════ التحميل ════════════ */
/* تنظيف التخطيط: كل صنف يظهر في قسمه فقط — لا اختلاط إطلاقًا.
   طلب المالك 2026-10-12: الأطباق الساخنة (mains) لا تدخل قسم الشوربات
   ولا العكس، ولا يظهر الصنف في قسمين. نُنضّف التخطيط بعد كل تحميل. */
function normalizeLayout() {
    const secOf = new Map(ITEMS.map(it => [Number(it.id), String(it.section || '')]));
    const SECS = ['soups', 'desserts', 'appetizers', 'salads'];
    const normalizeMains = ids => {
        const used = new Set();
        return (ids || []).map(Number).filter(id => {
            if (secOf.get(id) !== 'mains' || used.has(id)) { return false; }
            used.add(id);
            return true;
        });
    };
    LAYOUT.mains = normalizeMains(LAYOUT.mains);
    MAIN_MEALS.forEach(meal => { LAYOUT[meal.id] = normalizeMains(LAYOUT[meal.id]); });
    const seen = new Set([
        ...LAYOUT.mains,
        ...MAIN_MEALS.flatMap(meal => LAYOUT[meal.id]),
    ]);
    SECS.forEach(s => {
        LAYOUT[s] = (LAYOUT[s] || []).map(Number).filter(id => {
            if (secOf.get(id) !== s) { return false; }   /* خارج قسمه → تُشطب */
            if (seen.has(id)) { return false; }           /* مكرر في قسم آخر → تُشطب */
            seen.add(id);
            return true;
        });
    });
}

async function loadAll() {
    const [items, s] = await Promise.all([
        api('GET', '/api/menu-board/items'),
        api('GET', '/api/menu-board/settings'),
    ]);
    ITEMS = (items.items || items || []).filter(x => x.is_active !== false);
    SETTINGS = s.settings || s;
    const lay = SETTINGS.buffet_layout || {};
    LAYOUT = {
        enabled: lay.enabled !== false,
        mains: (lay.mains || []).map(Number), soups: (lay.soups || []).map(Number),
        breakfast_mains: (lay.breakfast_mains || lay.mains || []).map(Number),
        lunch_mains: (lay.lunch_mains || lay.mains || []).map(Number),
        dinner_mains: (lay.dinner_mains || lay.mains || []).map(Number),
        desserts: (lay.desserts || []).map(Number), appetizers: (lay.appetizers || []).map(Number),
        salads: (lay.salads || []).map(Number),
        carving_by_day: Array.isArray(lay.carving_by_day) ? lay.carving_by_day : [],
    };
    normalizeLayout();
    renderBuffetEditor(); renderThemes(); renderSchedule(SETTINGS);
    // بيانات الشاشة العامة (عامة — بدون مصادقة)
    try {
        const r = await fetch('/api/menu-board/public', { cache: 'no-store' });
        if (r.ok) {
            const board = await r.json();
            BOARD_CATEGORIES = Array.isArray(board.categories) ? board.categories : [];
            renderStats(board);
            renderSchedule(SETTINGS);
        }
    } catch (_) { $('connBadge').className = 'badge badge-off'; $('connBadge').textContent = '● غير متصل'; }
}

/* ════════════ اللحظية: تحديثات منيو الشاشة فقط (لا كاشير) ════════════ */
function listen() {
    try {
        SOCKET = io({ transports: ['websocket', 'polling'] });
        SOCKET.on('connect', () => { $('connBadge').className = 'badge badge-on'; $('connBadge').textContent = '● متصل'; });
        SOCKET.on('disconnect', () => { $('connBadge').className = 'badge badge-off'; $('connBadge').textContent = '● منقطع'; });
        SOCKET.on('menu_board_changed', () => { if (!DIRTY) { loadAll().then(() => setTimeout(refreshPreview, 300)); } });
    } catch (_) {}
    setInterval(() => { if (!document.hidden && !DIRTY) { loadAll().catch(() => {}); } }, 30000);
}

/* ════════════ الساعة ════════════ */
function tickClock() {
    const n = new Date();
    $('clockTime').textContent = n.toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit', hour12: false });
    $('clockDate').textContent = n.toLocaleDateString('ar-SA', { weekday: 'long', day: 'numeric', month: 'long' });
}

async function boot() {
    await loadAll().catch(e => toast('تعذّر التحميل: ' + e.message, false));
    listen();
}

document.addEventListener('DOMContentLoaded', () => {
    tickClock(); setInterval(tickClock, 20000);
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
    $('btnSave').onclick = saveAndDisplay;
    $('btnRefreshPreview').onclick = () => { refreshPreview(); toast('أُعيد تحميل المعاينة', true); };
    $('btnFullscreen').onclick = () => {
        const el = document.documentElement;
        (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || function () {}).call(el);
    };
    $('btnToggleBuffet').onclick = () => { LAYOUT.enabled = !LAYOUT.enabled; markDirty(); toast(LAYOUT.enabled ? 'وضع البوفيه: مفعّل' : 'وضع البوفيه: متوقف', true); };
    $('loginForm').onsubmit = ev => { ev.preventDefault(); doLogin($('username').value.trim(), $('password').value); };
    $('logoutBtn').onclick = () => { lock(); };
    $('loginOverlay').addEventListener('click', e => { if (e.target === $('loginOverlay')) { /* يبقى مفتوحًا */ } });
    window.addEventListener('beforeunload', e => { if (DIRTY) { e.preventDefault(); e.returnValue = ''; } });
    if (TOKEN) { unlock().then(boot); } else { lock(); }
    setTimeout(fitPreview, 200);
});
