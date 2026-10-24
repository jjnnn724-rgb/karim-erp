/**
 * menu-board-routes.js — شاشة منيو المول (Digital Signage)
 * ────────────────────────────────────────────────────────────────────────────
 * نظام مستقل تمامًا عن الكاشير (قرار المالك 2026-10-12 — نهائي):
 * أصناف شاشة المنيو تعيش في جدولها الخاص menu_board_items — لا قراءة
 * ولا كتابة في pos_products إطلاقًا. إضافة/حذف صنف هنا لا يمس الكاشير.
 *
 * المسارات:
 *   GET  /api/menu-board/public   عام (بدون x-api-key) — بيانات العرض فقط
 *   GET  /api/menu-board/settings  إعدادات العرض (admin/manager)
 *   PUT  /api/menu-board/settings  تعديل الإعدادات (admin/manager)
 *   GET  /api/menu-board/items     أصناف المنيو المستقلة
 *   POST /api/menu-board/items     إضافة صنف (جدول مستقل)
 *   PATCH /api/menu-board/items/:id  تعديل صنف
 *   DELETE /api/menu-board/items/:id حذف صنف (جدول مستقل فقط)
 *
 * لا يعرض أي بيانات حساسة: أسماء الأصناف والتصنيفات فقط.
 */
const express = require('express');
const { jwtAuth, requireRole } = require('./cashier-module/jwt-middleware');
const { pool } = require('./shared-pool');
const { logger } = require('./logger');

const router = express.Router();

const SETTINGS_ID = 1;
const MAX_BACKGROUND_LENGTH = 1_400_000;
const MAX_V2_STATE_LENGTH = 1_500_000;
const PUBLIC_BOARD_CACHE_TTL_MS = 15_000;
const publicBoardCache = { expiresAt: 0, payload: null };
let v2StateTableReady = null;
const BACKGROUND_STYLES = new Set(['ivory', 'garden', 'champagne', 'ocean', 'rose', 'night', 'noir', 'custom']);
const THEME_STYLES = new Set(['emerald', 'sapphire', 'ruby', 'midnight']);
const MENU_SECTIONS = new Set(['soups', 'mains', 'desserts', 'appetizers', 'salads', 'carving']);

/* ─── جدول أصناف المنيو المستقل — لا علاقة له بالكاشير إطلاقًا ─── */
async function ensureMenuItemsTable() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS menu_board_items (
            id SERIAL PRIMARY KEY,
            name_ar VARCHAR(120) NOT NULL,
            name_en VARCHAR(120),
            section VARCHAR(20) NOT NULL DEFAULT 'mains',
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT true,
            image_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_menu_board_items_section
        ON menu_board_items (section, sort_order, id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_menu_board_items_active
        ON menu_board_items (is_active) WHERE is_active = true`);
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNonNegative(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validV2Dish(item) {
    return isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.nameAr === 'string' &&
        typeof item.nameEn === 'string' &&
        typeof item.descriptionAr === 'string' &&
        typeof item.descriptionEn === 'string' &&
        ['soups', 'carving', 'main', 'salads', 'desserts', 'beverages'].includes(item.category) &&
        Array.isArray(item.mealTypes) && item.mealTypes.length <= 4 &&
        item.mealTypes.every(meal => ['breakfast', 'lunch', 'dinner', 'lounge'].includes(meal)) &&
        Array.isArray(item.daysAvailable) && item.daysAvailable.length <= 7 &&
        item.daysAvailable.every(day => ['saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday'].includes(day)) &&
        typeof item.isAvailable === 'boolean' &&
        typeof item.image === 'string';
}

function validV2Carving(item) {
    return isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.nameAr === 'string' &&
        typeof item.nameEn === 'string';
}

function sanitizeV2State(value) {
    const buffet = value && value.buffet;
    const pricing = buffet && buffet.pricing;
    const settings = value && value.settings;
    const sections = buffet && [buffet.soups, buffet.mainDishes];
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !isRecord(buffet) || !isRecord(pricing) ||
        !Array.isArray(buffet.soups) || !Array.isArray(buffet.mainDishes) ||
        buffet.soups.length > 500 || buffet.mainDishes.length > 500 ||
        !isRecord(buffet.carvingSchedule) ||
        Object.values(buffet.carvingSchedule).some(day => !isRecord(day) ||
            typeof day.nameAr !== 'string' || typeof day.nameEn !== 'string') ||
        !isRecord(buffet.salads) || !Array.isArray(buffet.salads.itemsListAr) ||
        !Array.isArray(buffet.salads.itemsListEn) ||
        !isRecord(buffet.desserts) || !Array.isArray(buffet.desserts.itemsListAr) ||
        !Array.isArray(buffet.desserts.itemsListEn) ||
        (buffet.dishLibrary !== undefined && (!isRecord(buffet.dishLibrary) ||
            !Array.isArray(buffet.dishLibrary.soups) ||
            !Array.isArray(buffet.dishLibrary.carvings) ||
            !Array.isArray(buffet.dishLibrary.mainDishes) ||
            buffet.dishLibrary.soups.length > 500 ||
            buffet.dishLibrary.mainDishes.length > 500 ||
            buffet.dishLibrary.carvings.length > 500 ||
            !buffet.dishLibrary.soups.every(validV2Dish) ||
            !buffet.dishLibrary.mainDishes.every(validV2Dish) ||
            !buffet.dishLibrary.carvings.every(validV2Carving))) ||
        (buffet.mealMenus !== undefined && (!isRecord(buffet.mealMenus) ||
            Object.values(buffet.mealMenus).some(menu => !isRecord(menu) ||
                !Array.isArray(menu.soupIds) || !menu.soupIds.every(id => typeof id === 'string') ||
                !Array.isArray(menu.mainDishIds) || !menu.mainDishIds.every(id => typeof id === 'string') ||
                (menu.carvingNameAr !== undefined && typeof menu.carvingNameAr !== 'string') ||
                (menu.carvingNameEn !== undefined && typeof menu.carvingNameEn !== 'string')))) ||
        (buffet.textMenus !== undefined && (!isRecord(buffet.textMenus) ||
            Object.keys(buffet.textMenus).length > 30 ||
            Object.values(buffet.textMenus).some(text => typeof text !== 'string' || text.length > 20_000))) ||
        !Array.isArray(value.schedules) || value.schedules.length > 20 ||
        !isRecord(settings) ||
        !Number.isSafeInteger(value.lastUpdated) || value.lastUpdated < 0 ||
        !finiteNonNegative(pricing.adultPrice) ||
        !finiteNonNegative(pricing.childPrice) ||
        typeof pricing.currency !== 'string' ||
        sections.some(items => !items.every(validV2Dish)) ||
        Object.entries(settings).some(([key, setting]) =>
            key === 'screenTexts'
                ? !isRecord(setting) || Object.values(setting).some(text => typeof text !== 'string')
                : key === 'carvingByDay'
                    ? !isRecord(setting)
                    : typeof setting !== 'string' && typeof setting !== 'boolean' &&
                        !(typeof setting === 'number' && Number.isFinite(setting)) && setting !== null) ||
        value.schedules.some(schedule => !isRecord(schedule) ||
            !['breakfast', 'lunch', 'dinner', 'lounge'].includes(schedule.meal) ||
            typeof schedule.startTime !== 'string' || !validTime(schedule.startTime) ||
            typeof schedule.endTime !== 'string' || !validTime(schedule.endTime) ||
            typeof schedule.nameAr !== 'string' || typeof schedule.nameEn !== 'string')) {
        throw new Error('INVALID_V2_STATE');
    }
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > MAX_V2_STATE_LENGTH) {
        throw new Error('V2_STATE_TOO_LARGE');
    }
    const state = JSON.parse(serialized);
    state.settings.erpUrl = '';
    state.settings.erpSyncEnabled = false;
    state.settings.esp32IpAddress = '';
    return state;
}

function ensureV2StateTable() {
    if (!v2StateTableReady) {
        v2StateTableReady = (async () => {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS menu_board_v2_state (
                    id SMALLINT PRIMARY KEY CHECK (id = 1),
                    payload JSONB,
                    version BIGINT NOT NULL DEFAULT 0 CHECK (version >= 0),
                    updated_at TIMESTAMPTZ,
                    updated_by BIGINT
                )`);
            await pool.query(`
                INSERT INTO menu_board_v2_state (id, payload, version)
                VALUES (1, NULL, 0)
                ON CONFLICT (id) DO NOTHING`);
        })().catch((error) => {
            v2StateTableReady = null;
            throw error;
        });
    }
    return v2StateTableReady;
}

/* ─── ترحيل لمرة واحدة: نسخ أصناف البوفيه الحالية من الكاشير ───
   تُنسخ الأسماء فقط إلى الجدول المستقل، وتُعاد كتابة buffet_layout
   بالمُعرّفات الجديدة. الكاشير لا يُمس إطلاقًا (قراءة فقط هنا). */
async function migrateFromCashierOnce() {
    const flag = await pool.query(
        `SELECT value FROM menu_board_settings_meta WHERE key = 'migrated_from_cashier'`)
        .catch(() => ({ rows: [] }));
    if (flag.rows && flag.rows.length) {return false;}
    await pool.query(`
        CREATE TABLE IF NOT EXISTS menu_board_settings_meta (
            key VARCHAR(60) PRIMARY KEY, value TEXT, at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`);
    const done = await pool.query(
        `SELECT value FROM menu_board_settings_meta WHERE key = 'migrated_from_cashier'`)
        .catch(() => ({ rows: [] }));
    if (done.rows && done.rows.length) {return false;}
    const count = await pool.query(`SELECT count(*) AS n FROM menu_board_items`)
        .then(r => Number(r.rows[0].n)).catch(() => 0);
    if (count > 0) {
        await pool.query(`INSERT INTO menu_board_settings_meta (key, value)
            VALUES ('migrated_from_cashier', 'skipped-nonempty') ON CONFLICT DO NOTHING`);
        return false;
    }
    const settings = await loadSettings().catch(() => null);
    const layout = (settings && settings.buffet_layout) || emptyBuffetLayout();
    const oldIds = [...new Set([
        ...(layout.mains || []), ...(layout.soups || []), ...(layout.desserts || []),
        ...(layout.appetizers || []), ...(layout.salads || []),
        ...(layout.carving_by_day || []).flatMap(d => [d && d.lunch, d && d.dinner].filter(Boolean)),
    ].map(Number).filter(id => Number.isSafeInteger(id) && id > 0))];
    if (!oldIds.length) {
        await pool.query(`INSERT INTO menu_board_settings_meta (key, value)
            VALUES ('migrated_from_cashier', 'empty') ON CONFLICT DO NOTHING`);
        return false;
    }
    const prods = await pool.query(
        `SELECT id, name_ar, name_en FROM pos_products WHERE id = ANY($1::int[])`, [oldIds])
        .then(r => r.rows).catch(() => []);
    if (!prods.length) {
        await pool.query(`INSERT INTO menu_board_settings_meta (key, value)
            VALUES ('migrated_from_cashier', 'no-source') ON CONFLICT DO NOTHING`);
        return false;
    }
    const guessSection = pid => {
        if ((layout.soups || []).map(Number).includes(Number(pid))) {return 'soups';}
        if ((layout.desserts || []).map(Number).includes(Number(pid))) {return 'desserts';}
        if ((layout.appetizers || []).map(Number).includes(Number(pid))) {return 'appetizers';}
        if ((layout.salads || []).map(Number).includes(Number(pid))) {return 'salads';}
        return 'mains';
    };
    const idMap = new Map();
    let order = 0;
    for (const p of prods) {
        order += 1;
        const r = await pool.query(
            `INSERT INTO menu_board_items (name_ar, name_en, section, sort_order, is_active)
             VALUES ($1, $2, $3, $4, true) RETURNING id`,
            [p.name_ar || p.name_en || 'صنف', p.name_en || null, guessSection(p.id), order]);
        idMap.set(Number(p.id), Number(r.rows[0].id));
    }
    const remap = arr => (arr || []).map(id => idMap.get(Number(id))).filter(Boolean);
    const newLayout = {
        enabled: Boolean(layout.enabled),
        mains: remap(layout.mains),
        soups: remap(layout.soups),
        desserts: remap(layout.desserts),
        appetizers: remap(layout.appetizers),
        salads: remap(layout.salads),
        carving_by_day: Array.from({ length: 7 }, (_, day) => {
            const row = (layout.carving_by_day || []).find(x => Number(x && x.day) === day) || {};
            const one = v => (v == null || v === '') ? null : (idMap.get(Number(v)) || null);
            return { day, lunch: one(row.lunch), dinner: one(row.dinner) };
        }),
    };
    await pool.query(`UPDATE menu_board_settings SET buffet_layout = $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [JSON.stringify(newLayout), SETTINGS_ID]);
    await pool.query(`INSERT INTO menu_board_settings_meta (key, value)
        VALUES ('migrated_from_cashier', $1) ON CONFLICT DO NOTHING`, [`${prods.length}-items`]);
    try { logger.info(`[menu-board] migrated ${prods.length} items from cashier to independent table`); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    return true;
}

function validTime(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {return false;}
    return true;
}

function emptyBuffetLayout() {
    return {
        enabled: false,
        mains: [],
        breakfast_mains: [],
        lunch_mains: [],
        dinner_mains: [],
        soups: [],
        desserts: [],
        appetizers: [],
        salads: [],
        carving_by_day: Array.from({ length: 7 }, (_, day) => ({ day, lunch: null, dinner: null })),
    };
}

function cleanBuffetLayout(value) {
    if (value === undefined) {return emptyBuffetLayout();}
    let layout = value;
    if (typeof layout === 'string') {
        try { layout = JSON.parse(layout); } catch (e) { throw new Error('INVALID_BUFFET_LAYOUT', { cause: e }); }
    }
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) { throw new Error('INVALID_BUFFET_LAYOUT'); }
    if (layout.enabled !== undefined && typeof layout.enabled !== 'boolean') { throw new Error('INVALID_BUFFET_ENABLED'); }
    const cleanIds = (input, max, field) => {
        if (!Array.isArray(input)) { throw new Error(`INVALID_BUFFET_${field.toUpperCase()}`); }
        const ids = input.map(Number);
        if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length || ids.length > max) {
            throw new Error(`INVALID_BUFFET_${field.toUpperCase()}`);
        }
        return ids;
    };
    const carvingInput = Array.isArray(layout.carving_by_day) ? layout.carving_by_day : [];
    /* طلب المالك 2026-10-12: ركن الشواء يُكتب اسمه نصًا حرًا (مثال: لحم حنيذ).
       نقبل النص الطويل والرقم (معرّف صنف قديم) معًا. */
    const cleanCarving = v => {
        if (v === null || v === undefined) { return null; }
        const s = String(v).trim();
        if (!s) { return null; }
        if (/^\d+$/.test(s)) { const n = Number(s); return Number.isSafeInteger(n) && n > 0 ? s : null; }
        return s.slice(0, 120);
    };
    const carvingByDay = Array.from({ length: 7 }, (_, day) => {
        const row = carvingInput.find(item => Number(item && item.day) === day) || {};
        return { day, lunch: cleanCarving(row.lunch), dinner: cleanCarving(row.dinner) };
    });
    const cleaned = {
        enabled: layout.enabled === true,
        mains: cleanIds(layout.mains, 10, 'mains'),
        breakfast_mains: cleanIds(layout.breakfast_mains === undefined ? layout.mains : layout.breakfast_mains, 10, 'breakfast_mains'),
        lunch_mains: cleanIds(layout.lunch_mains === undefined ? layout.mains : layout.lunch_mains, 10, 'lunch_mains'),
        dinner_mains: cleanIds(layout.dinner_mains === undefined ? layout.mains : layout.dinner_mains, 10, 'dinner_mains'),
        soups: cleanIds(layout.soups, 2, 'soups'),
        desserts: cleanIds(layout.desserts, 8, 'desserts'),
        appetizers: cleanIds(layout.appetizers === undefined ? [] : layout.appetizers, 8, 'appetizers'),
        salads: cleanIds(layout.salads, 8, 'salads'),
        carving_by_day: carvingByDay,
    };
    /* ملاحظة المالك 2026-10-12: لا نرمي هنا — القراءة يجب أن تنجح دائمًا
       بأي عدد أصناف (حتى لو ناقص)، والشاشة تعرض المتاح. الشرط الصارم
       10+2 يُفحص عند الحفظ فقط إن لزم، لا عند كل قراءة. */
    return cleaned;
}

function collectBuffetProductIds(layout) {
    const carvingIds = layout.carving_by_day.flatMap(day => [day.lunch, day.dinner])
        .filter(value => typeof value === 'string' && /^\d+$/.test(value))
        .map(Number);
    return [
        ...layout.mains,
        ...layout.breakfast_mains,
        ...layout.lunch_mains,
        ...layout.dinner_mains,
        ...layout.soups,
        ...layout.desserts,
        ...layout.appetizers,
        ...layout.salads,
        ...carvingIds,
    ];
}

function cleanText(v, max) {
    const s = String(v == null ? '' : v).trim();
    return s.slice(0, max);
}

function cleanBoardCategories(value) {
    if (value === null) {return null;}
    if (!Array.isArray(value)) {throw new Error('INVALID_CATEGORIES');}
    return value.map(x => cleanText(x, 40)).filter(Boolean).slice(0, 60);
}

function boardCategorySelected(name, selectedCategories) {
    return !Array.isArray(selectedCategories) ||
        selectedCategories.includes(String(name || '').trim());
}

/** قراءة الإعدادات مع سقوط آمن على الافتراضي لو الجدول/الصف غير جاهز */
async function loadSettings() {
    try {
        const r = await pool.query(`SELECT * FROM menu_board_settings WHERE id = $1`, [SETTINGS_ID]);
        if (r.rows.length) {
            const s = r.rows[0];
            let cats = null;
            try {
                const raw = s.board_categories;
                const arr = Array.isArray(raw) ? raw : (typeof raw === 'string' ? JSON.parse(raw) : null);
                if (Array.isArray(arr)) {cats = arr.map(x => String(x || '').trim()).filter(Boolean).slice(0, 60);}
            } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            return {
                title: s.title,
                subtitle: s.subtitle,
                breakfast_hours: s.breakfast_hours,
                lunch_hours: s.lunch_hours,
                dinner_hours: s.dinner_hours,
                breakfast_start: s.breakfast_start || '05:00',
                lunch_start: s.lunch_start || '12:00',
                dinner_start: s.dinner_start || '17:00',
                breakfast_category: s.breakfast_category || null,
                lunch_category: s.lunch_category || null,
                dinner_category: s.dinner_category || null,
                footer_text: s.footer_text,
                board_categories: cats,
                buffet_price: Number(s.buffet_price ?? 75),
                background_style: s.background_style || 'noir',
                theme_style: s.theme_style || 'emerald',
                buffet_layout: cleanBuffetLayout(s.buffet_layout),
                custom_background: s.custom_background || '',
                background_updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : '',
            };
        }
    } catch (e) {
        logger.warn('[menu-board] settings load failed, using defaults:', e.message);
    }
    return {
        title: 'مطاعم الشرفه العالمي',
        subtitle: 'مطعم و مطابخ الشرفه',
        breakfast_hours: '05:00 - 11:30',
        lunch_hours: '12:00 - 16:30',
        dinner_hours: '17:00 - 24:00',
        breakfast_start: '05:00',
        lunch_start: '12:00',
        dinner_start: '17:00',
        breakfast_category: null,
        lunch_category: null,
        dinner_category: null,
        footer_text: 'نتمنى لكم زيارة سعيدة وطعامًا شهيًا',
        board_categories: null,
        buffet_price: 75,
        background_style: 'noir',
        theme_style: 'emerald',
        buffet_layout: emptyBuffetLayout(),
        custom_background: '',
        background_updated_at: '',
    };
}

/** المنيو المعروض: الأصناف النشطة من جدول المنيو المستقل (لا كاشير) */
async function loadBoard() {
    const [itemRes, settings] = await Promise.all([
        pool.query(`
            SELECT id, name_ar, name_en, section, sort_order, image_url
              FROM menu_board_items
             WHERE is_active = true
             ORDER BY section, sort_order, id
        `).catch(() => ({ rows: [] })),
        loadSettings(),
    ]);
    const rows = itemRes.rows || [];
    // اختيار المالك: تصنيفات محددة للشاشة الخارجية (فارغ/null = كل المنيو)
    // التصنيفات بترتيب ثابت معروف (فطار/غدا/عشا) أولًا ثم البقية بترتيب ظهورها
    const KNOWN = ['فطار', 'فطور', 'غدا', 'غداء', 'عشا', 'عشاء'];
    const byCategory = new Map();
    for (const p of rows) {
        const cat = cleanText(p.section, 40) || 'أصناف أخرى';
        if (!boardCategorySelected(cat, settings.board_categories)) {continue;}
        if (!byCategory.has(cat)) {byCategory.set(cat, []);}
        byCategory.get(cat).push({
            id: p.id,
            name: cleanText(p.name_ar, 120) || cleanText(p.name_en, 120),
            name_en: cleanText(p.name_en, 120) || null,
            image: p.image_url || null,
            sold_out: false,
        });
    }
    const categories = [...byCategory.keys()].sort((a, b) => {
        const ia = KNOWN.indexOf(a), ib = KNOWN.indexOf(b);
        if (ia !== -1 || ib !== -1) {return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);}
        return a.localeCompare(b, 'ar');
    }).map(name => ({ name, items: byCategory.get(name) }));
    const productsById = new Map(rows.map(product => [Number(product.id), {
        id: Number(product.id),
        name: cleanText(product.name_ar, 120) || cleanText(product.name_en, 120),
        name_en: cleanText(product.name_en, 120) || null,
        image: product.image_url || null,
        sold_out: false,
    }]));
    const layout = settings.buffet_layout || emptyBuffetLayout();
    /* ── تنظيف التخطيط على مستوى الـ API: كل صنف في قسمه فقط ──
       طلب المالك 2026-10-12: لا تدخل الأطباق الساخنة (mains) قسم الشوربات
       ولا أي قسم آخر — ولو التخزين القديم به خطأ، الشاشة لا تراه أبدًا. */
    const SEC_OF = new Map(rows.map(r => [Number(r.id), cleanText(r.section, 40)]));
    const pickSection = (ids, sec, max, seen = new Set()) => {
        const out = [];
        for (const raw of (ids || [])) {
            const id = Number(raw);
            if (!Number.isSafeInteger(id) || id <= 0) { continue; }
            if (SEC_OF.get(id) !== sec) { continue; }   /* خارج قسمه → لا يظهر */
            if (seen.has(id)) { continue; }              /* مكرر في قسم آخر → يظهر مرة واحدة */
            if (out.length >= max) { continue; }
            seen.add(id);
            out.push(id);
        }
        return out;
    };
    const selectItems = ids => ids.map(id => productsById.get(Number(id))).filter(Boolean);
    const mainSelections = {
        breakfast: layout.breakfast_mains === undefined ? layout.mains : layout.breakfast_mains,
        lunch: layout.lunch_mains === undefined ? layout.mains : layout.lunch_mains,
        dinner: layout.dinner_mains === undefined ? layout.mains : layout.dinner_mains,
    };
    const mainsByPeriod = Object.fromEntries(Object.entries(mainSelections).map(([period, ids]) => [
        period,
        selectItems(pickSection(ids, 'mains', 10)),
    ]));
    const reservedMainIds = new Set([
        ...(layout.mains || []),
        ...Object.values(mainSelections).flat(),
    ].map(Number));
    const otherSectionIds = new Set(reservedMainIds);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short' }).format(new Date());
    const carvingToday = layout.carving_by_day[dayMap[weekday]] || { lunch: null, dinner: null };
    /* ركن الشواء: نص حر مكتوب يدويًا، أو رقم معرّف صنف قديم */
    const carveValue = v => {
        if (v === null || v === undefined || v === '') { return null; }
        if (typeof v === 'string' && !/^\d+$/.test(v.trim())) {
            const t = cleanText(v, 120);
            return t ? { id: null, name: t, name_en: null, image: null, sold_out: false } : null;
        }
        return productsById.get(Number(v)) || null;
    };
    const buffetSections = {
        mains: selectItems(pickSection(layout.mains, 'mains', 10)),
        mains_by_period: mainsByPeriod,
        soups: selectItems(pickSection(layout.soups, 'soups', 2, otherSectionIds)),
        carving: {
            lunch: carveValue(carvingToday.lunch),
            dinner: carveValue(carvingToday.dinner),
        },
        desserts: selectItems(pickSection(layout.desserts, 'desserts', 8, otherSectionIds)),
        appetizers: selectItems(pickSection(layout.appetizers, 'appetizers', 8, otherSectionIds)),
        salads: selectItems(pickSection(layout.salads, 'salads', 8, otherSectionIds)),
    };
    buffetSections.enabled = layout.enabled && Object.values(mainsByPeriod).some(items => items.length > 0);
    // نسخة الإصدار: أحدث تحديث صنف + تحديث الإعدادات — الشاشة تقارنها لتقرر إعادة الرسم
    const vRes = await pool.query(`
        SELECT COALESCE(MAX(updated_at)::text, '') AS v FROM menu_board_items WHERE is_active = true
    `).catch(() => ({ rows: [{ v: '' }] }));
    const sRes = await pool.query(`SELECT COALESCE(MAX(updated_at)::text,'') AS s FROM menu_board_settings WHERE id = 1`).catch(() => ({ rows: [{ s: '' }] }));
    const wRes = await pool.query(`SELECT COALESCE(MAX(updated_at)::text,'') AS w FROM menu_weekly`).catch(() => ({ rows: [{ w: '' }] }));
    const version = `${vRes.rows[0].v}|${rows.length}|${sRes.rows[0].s}|${(settings.board_categories || []).join(',')}|${wRes.rows[0].w}`;
    // منيو اليوم الأسبوعي (بتوقيت الرياض) — يتصدر الشاشة عند وجوده
    let weeklyToday = null;
    try {
        const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short' }).format(new Date());
        const w = await pool.query(`SELECT title, items, note FROM menu_weekly WHERE day_of_week = $1`, [dayMap[wd] ?? 0]);
        if (w.rows[0] && Array.isArray(w.rows[0].items) && w.rows[0].items.length) {
            weeklyToday = { title: w.rows[0].title, note: w.rows[0].note, items: w.rows[0].items };
        }
    } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
    return { version, settings, categories, buffet_sections: buffetSections, weekly_today: weeklyToday };
}

async function getPublicBoardCached() {
    const now = Date.now();
    if (publicBoardCache.payload && now < publicBoardCache.expiresAt) {
        return publicBoardCache.payload;
    }
    const board = await loadBoard();
    publicBoardCache.payload = board;
    publicBoardCache.expiresAt = now + PUBLIC_BOARD_CACHE_TTL_MS;
    return board;
}

function register(app, opts = {}) {
    ensureV2StateTable().catch(e => {
        try { logger.error('[menu-board] v2 state table init failed:', e.message); } catch (_) { /* logging only */ }
    });
    /* جدول المنيو المستقل + ترحيل لمرة واحدة من الكاشير (قراءة فقط) */
    ensureMenuItemsTable()
        .then(() => migrateFromCashierOnce())
        .then(() => { try { opts.io.emit('menu_board_changed', { at: new Date().toISOString() }); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ } })
        .catch(e => { try { logger.error('[menu-board] independent table init failed:', e.message); } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ } });
    // ─── عام: بيانات العرض للشاشة (معلومات منيو علنية بطبيعتها — معروضة في المول) ───
    app.get('/api/menu-board/public', async (req, res) => {
        try {
            const board = await getPublicBoardCached();
            if (board.settings.custom_background) {
                board.settings.custom_background_url = `/api/menu-board/background?v=${encodeURIComponent(board.settings.background_updated_at)}`;
            }
            delete board.settings.custom_background;
            delete board.settings.background_updated_at;
            res.set({
                'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
                'X-Menu-Board-Cache': 'hit'
            });
            res.json(board);
        } catch (e) {
            logger.error('[menu-board] public load failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    router.get('/v2-state', async (req, res) => {
        try {
            await ensureV2StateTable();
            const result = await pool.query(
                `SELECT payload, version, updated_at
                   FROM menu_board_v2_state
                  WHERE id = 1`);
            const row = result.rows[0];
            res.set('Cache-Control', 'no-store');
            res.json({
                state: row?.payload || null,
                version: Number(row?.version || 0),
                updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
            });
        } catch (e) {
            logger.error('[menu-board] v2 state load failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر تحميل بيانات v2' });
        }
    });

    router.put('/v2-state', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        const expectedVersion = req.body?.expectedVersion;
        if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
            return res.status(422).json({ error: 'INVALID_VERSION', message: 'إصدار البيانات المطلوب غير صالح' });
        }

        let state;
        try {
            state = sanitizeV2State(req.body?.state);
        } catch (e) {
            const tooLarge = e.message === 'V2_STATE_TOO_LARGE';
            return res.status(422).json({
                error: tooLarge ? 'V2_STATE_TOO_LARGE' : 'INVALID_V2_STATE',
                message: tooLarge ? 'حجم بيانات v2 أكبر من المسموح' : 'بنية بيانات v2 غير صالحة',
            });
        }

        let client;
        let transactionOpen = false;
        try {
            await ensureV2StateTable();
            client = await pool.connect();
            await client.query('BEGIN');
            transactionOpen = true;
            const current = await client.query(
                `SELECT version FROM menu_board_v2_state WHERE id = 1 FOR UPDATE`);
            const currentVersion = Number(current.rows[0]?.version || 0);
            if (currentVersion !== expectedVersion) {
                await client.query('ROLLBACK');
                transactionOpen = false;
                return res.status(409).json({
                    error: 'VERSION_CONFLICT',
                    message: 'تغيرت البيانات في جهاز آخر. حدّث النسخة قبل الحفظ.',
                    version: currentVersion,
                });
            }

            const result = await client.query(
                `UPDATE menu_board_v2_state
                    SET payload = $1::jsonb,
                        version = version + 1,
                        updated_at = CURRENT_TIMESTAMP,
                        updated_by = $2
                  WHERE id = 1
              RETURNING version, updated_at`,
                [JSON.stringify(state), req.user?.id || null]);
            await client.query('COMMIT');
            transactionOpen = false;

            const saved = result.rows[0];
            try {
                if (opts.io) {
                    opts.io.emit('menu_board_v2_state_changed', {
                        version: Number(saved.version),
                        updatedAt: new Date(saved.updated_at).toISOString(),
                    });
                }
            } catch (e) {
                logger.warn('[menu-board] v2 change notification failed:', e.message);
            }
            res.json({
                version: Number(saved.version),
                updatedAt: new Date(saved.updated_at).toISOString(),
            });
        } catch (e) {
            if (transactionOpen && client) {
                await client.query('ROLLBACK').catch(() => {});
            }
            logger.error('[menu-board] v2 state save failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر حفظ بيانات v2' });
        } finally {
            if (client) {
                client.release();
            }
        }
    });

    app.get('/api/menu-board/background', async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT custom_background FROM menu_board_settings WHERE id = $1`,
                [SETTINGS_ID]);
            const dataUrl = result.rows[0]?.custom_background || '';
            const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
            if (!match) {return res.status(404).end();}
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Content-Type': 'image/jpeg',
                'X-Content-Type-Options': 'nosniff',
            });
            res.send(Buffer.from(match[1], 'base64'));
        } catch (e) {
            logger.error('[menu-board] background load failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    // ─── إعدادات العرض (الشيف هو المتحكم — قرار المالك) ───
    router.get('/settings', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        res.json(await loadSettings());
    });

    router.put('/settings', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        const b = req.body || {};
        const categoriesProvided = Object.prototype.hasOwnProperty.call(b, 'board_categories');
        let cats = null;
        if (categoriesProvided) {
            try {
                cats = cleanBoardCategories(b.board_categories);
            } catch (e) {
                return res.status(422).json({ error: e.message, message: 'التصنيفات يجب أن تكون قائمة أو اختيار كل المنيو' });
            }
        }
        try {
            const current = await loadSettings();
            const savedCategories = categoriesProvided ? cats : current.board_categories;
            const buffetPrice = b.buffet_price === undefined ? current.buffet_price : Number(b.buffet_price);
            if (b.buffet_price === null || (typeof b.buffet_price === 'string' && !b.buffet_price.trim())) {
                return res.status(422).json({ error: 'INVALID_PRICE', message: 'سعر البوفيه غير صالح' });
            }
            if (!Number.isFinite(buffetPrice) || buffetPrice < 0 || buffetPrice > 100000) {
                return res.status(422).json({ error: 'INVALID_PRICE', message: 'سعر البوفيه غير صالح' });
            }
            const backgroundStyle = b.background_style === undefined ? current.background_style : cleanText(b.background_style, 16);
            if (!BACKGROUND_STYLES.has(backgroundStyle)) {
                return res.status(422).json({ error: 'INVALID_BACKGROUND_STYLE', message: 'نمط الخلفية غير صالح' });
            }
            const themeStyle = b.theme_style === undefined ? current.theme_style : cleanText(b.theme_style, 16);
            if (!THEME_STYLES.has(themeStyle)) {
                return res.status(422).json({ error: 'INVALID_THEME_STYLE', message: 'ثيم الشاشة غير صالح' });
            }
            let buffetLayout;
            try {
                buffetLayout = b.buffet_layout === undefined
                    ? current.buffet_layout
                    : cleanBuffetLayout(b.buffet_layout);
            } catch (e) {
                return res.status(422).json({ error: e.message, message: 'راجع عدد الأصناف والأقسام المحددة في تخطيط البوفيه' });
            }
            const buffetProductIds = collectBuffetProductIds(buffetLayout);
            if (buffetProductIds.length) {
                const activeProducts = await pool.query(
                    `SELECT id FROM menu_board_items WHERE is_active = true AND id = ANY($1::int[])`,
                    [buffetProductIds]);
                if (activeProducts.rows.length !== new Set(buffetProductIds).size) {
                    return res.status(422).json({ error: 'INVALID_BUFFET_PRODUCT', message: 'يجب اختيار أصناف نشطة فقط في تخطيط البوفيه' });
                }
            }
            const starts = {
                breakfast_start: b.breakfast_start === undefined ? current.breakfast_start : b.breakfast_start,
                lunch_start: b.lunch_start === undefined ? current.lunch_start : b.lunch_start,
                dinner_start: b.dinner_start === undefined ? current.dinner_start : b.dinner_start,
            };
            if (!Object.values(starts).every(validTime)) {
                return res.status(422).json({ error: 'INVALID_SCHEDULE', message: 'أوقات الوجبات غير صالحة' });
            }
            const startMinutes = Object.values(starts).map(value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)));
            if (!(startMinutes[0] < startMinutes[1] && startMinutes[1] < startMinutes[2])) {
                return res.status(422).json({ error: 'INVALID_SCHEDULE', message: 'رتّب بداية الإفطار ثم الغداء ثم العشاء خلال اليوم' });
            }
            const mealCategories = {};
            for (const period of ['breakfast', 'lunch', 'dinner']) {
                const key = `${period}_category`;
                const selected = b[key] === undefined ? current[key] : b[key];
                if (selected !== null && selected !== '' && typeof selected !== 'string') {
                    return res.status(422).json({ error: 'INVALID_MEAL_CATEGORY', message: 'تصنيف الوجبة غير صالح' });
                }
                mealCategories[key] = selected ? cleanText(selected, 40) : null;
            }
            const customBackground = b.custom_background === undefined ? current.custom_background : b.custom_background;
            if (typeof customBackground !== 'string' || customBackground.length > MAX_BACKGROUND_LENGTH ||
                (customBackground && !/^data:image\/jpeg;base64,[A-Za-z0-9+/]*={0,2}$/.test(customBackground))) {
                return res.status(422).json({ error: 'INVALID_BACKGROUND_IMAGE', message: 'صورة الخلفية غير صالحة أو حجمها أكبر من المسموح' });
            }
            if (backgroundStyle === 'custom' && !customBackground) {
                return res.status(422).json({ error: 'BACKGROUND_IMAGE_REQUIRED', message: 'ارفع صورة للخلفية المخصصة أولًا' });
            }
            const row = {
                title: b.title === undefined ? current.title : (cleanText(b.title, 80) || 'مطاعم الشرفه العالمي'),
                subtitle: b.subtitle === undefined ? current.subtitle : cleanText(b.subtitle, 160),
                breakfast_hours: b.breakfast_hours === undefined ? current.breakfast_hours : (cleanText(b.breakfast_hours, 40) || '05:00 - 11:30'),
                lunch_hours: b.lunch_hours === undefined ? current.lunch_hours : (cleanText(b.lunch_hours, 40) || '12:00 - 16:30'),
                dinner_hours: b.dinner_hours === undefined ? current.dinner_hours : (cleanText(b.dinner_hours, 40) || '17:00 - 24:00'),
                footer_text: b.footer_text === undefined ? current.footer_text : cleanText(b.footer_text, 240),
                buffet_price: buffetPrice,
                background_style: backgroundStyle,
                theme_style: themeStyle,
                buffet_layout: buffetLayout,
                custom_background: customBackground,
                ...starts,
                ...mealCategories,
            };
            await pool.query(`
                INSERT INTO menu_board_settings (id, title, subtitle, breakfast_hours, lunch_hours, dinner_hours, footer_text, board_categories, buffet_price, background_style, custom_background, theme_style, breakfast_start, lunch_start, dinner_start, breakfast_category, lunch_category, dinner_category, buffet_layout, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, NOW())
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, subtitle = EXCLUDED.subtitle,
                    breakfast_hours = EXCLUDED.breakfast_hours, lunch_hours = EXCLUDED.lunch_hours,
                    dinner_hours = EXCLUDED.dinner_hours, footer_text = EXCLUDED.footer_text,
                    board_categories = CASE WHEN $20::boolean THEN $8::jsonb ELSE menu_board_settings.board_categories END,
                    buffet_price = EXCLUDED.buffet_price,
                    background_style = EXCLUDED.background_style,
                    custom_background = EXCLUDED.custom_background,
                    theme_style = EXCLUDED.theme_style,
                    breakfast_start = EXCLUDED.breakfast_start,
                    lunch_start = EXCLUDED.lunch_start,
                    dinner_start = EXCLUDED.dinner_start,
                    breakfast_category = EXCLUDED.breakfast_category,
                    lunch_category = EXCLUDED.lunch_category,
                    dinner_category = EXCLUDED.dinner_category,
                    buffet_layout = EXCLUDED.buffet_layout,
                    updated_at = NOW()
            `, [SETTINGS_ID, row.title, row.subtitle, row.breakfast_hours, row.lunch_hours, row.dinner_hours, row.footer_text, savedCategories === null ? null : JSON.stringify(savedCategories), row.buffet_price, row.background_style, row.custom_background, row.theme_style, row.breakfast_start, row.lunch_start, row.dinner_start, row.breakfast_category, row.lunch_category, row.dinner_category, JSON.stringify(row.buffet_layout), categoriesProvided]);
            publicBoardCache.expiresAt = 0;
            try { if (opts.io) {opts.io.emit('menu_board_changed', { at: new Date().toISOString() });} } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.json({ ...row, board_categories: savedCategories });
        } catch (e) {
            logger.error('[menu-board] settings save failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR', message: 'تعذر حفظ الإعدادات' });
        }
    });

    // ─── المنيو الأسبوعي (7 أيام) ───
    router.get('/weekly', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        try {
            const r = await pool.query(`SELECT day_of_week, title, items, note, updated_at FROM menu_weekly ORDER BY day_of_week`);
            const byDay = new Map(r.rows.map(x => [Number(x.day_of_week), x]));
            res.json({
                days: [0, 1, 2, 3, 4, 5, 6].map(d => ({
                    day_of_week: d,
                    title: byDay.get(d)?.title || '',
                    items: Array.isArray(byDay.get(d)?.items) ? byDay.get(d).items : [],
                    note: byDay.get(d)?.note || '',
                })),
            });
        } catch (e) {
            logger.error('[menu-board] weekly load failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    router.put('/weekly', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        const days = Array.isArray(req.body?.days) ? req.body.days : null;
        if (!days) {return res.status(422).json({ error: 'INVALID_WEEKLY', message: 'أرسل مصفوفة days' });}
        const clean = [];
        for (const d of days) {
            const dow = Number(d.day_of_week);
            if (!Number.isInteger(dow) || dow < 0 || dow > 6) {return res.status(422).json({ error: 'INVALID_DAY', message: 'اليوم من 0 (الأحد) إلى 6 (السبت)' });}
            const items = (Array.isArray(d.items) ? d.items : []).slice(0, 120).map(it => ({
                catalog_id: Number.isSafeInteger(Number(it.catalog_id)) && Number(it.catalog_id) > 0 ? Number(it.catalog_id) : null,
                name: cleanText(it.name, 120),
                name_en: cleanText(it.name_en, 120),
                price: Math.max(0, Math.min(100000, Number(it.price) || 0)),
                category: cleanText(it.category, 40) || null,
                note: cleanText(it.note, 120) || null,
            })).filter(it => it.name);
            clean.push({ dow, title: cleanText(d.title, 120), items, note: cleanText(d.note, 240) });
        }
        try {
            for (const c of clean) {
                await pool.query(
                    `INSERT INTO menu_weekly (day_of_week, title, items, note, updated_at)
                     VALUES ($1, $2, $3::jsonb, $4, NOW())
                     ON CONFLICT (day_of_week) DO UPDATE SET title = EXCLUDED.title, items = EXCLUDED.items, note = EXCLUDED.note, updated_at = NOW()`,
                    [c.dow, c.title, JSON.stringify(c.items), c.note]);
            }
            publicBoardCache.expiresAt = 0;
            try { if (opts.io) {opts.io.emit('menu_board_changed', { at: new Date().toISOString() });} } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.json({ ok: true, days: clean.length });
        } catch (e) {
            logger.error('[menu-board] weekly save failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });
    router.get('/items', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        try {
            await ensureMenuItemsTable();
            const r = await pool.query(`
                SELECT id, name_ar, name_en, section, sort_order, is_active, image_url,
                       false AS sold_out
                  FROM menu_board_items ORDER BY section, sort_order, id LIMIT 500`);
            res.json({ items: r.rows });
        } catch (e) {
            logger.error('[menu-board] items load failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    router.patch('/items/:id', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        const pid = Number(req.params.id);
        if (!Number.isInteger(pid) || pid <= 0) {return res.status(422).json({ error: 'INVALID_ID' });}
        const b = req.body || {};
        const sets = [];
        const vals = [pid];
        if (b.is_active !== undefined) {
            vals.push(Boolean(b.is_active)); sets.push(`is_active = $${vals.length}`);
        }
        if (b.name_ar !== undefined) {
            const nm = cleanText(b.name_ar, 120);
            if (!nm) {return res.status(422).json({ error: 'INVALID_NAME', message: 'الاسم فارغ' });}
            vals.push(nm); sets.push(`name_ar = $${vals.length}`);
        }
        if (b.name_en !== undefined) {
            const nameEn = cleanText(b.name_en, 120);
            vals.push(nameEn || null); sets.push(`name_en = $${vals.length}`);
        }
        if (b.section !== undefined) {
            const sec = cleanText(b.section, 20) || 'mains';
            if (!MENU_SECTIONS.has(sec)) {return res.status(422).json({ error: 'INVALID_SECTION', message: 'القسم غير صالح' });}
            vals.push(sec); sets.push(`section = $${vals.length}`);
        }
        if (!sets.length) {return res.status(422).json({ error: 'NOTHING_TO_UPDATE' });}
        try {
            const r = await pool.query(
                `UPDATE menu_board_items SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
                  WHERE id = $1 RETURNING id, name_ar, name_en, section, sort_order, is_active, image_url`, vals);
            if (!r.rows.length) {return res.status(404).json({ error: 'NOT_FOUND' });}
            publicBoardCache.expiresAt = 0;
            try { if (opts.io) {opts.io.emit('menu_board_changed', { at: new Date().toISOString() });} } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.json(r.rows[0]);
        } catch (e) {
            logger.error('[menu-board] item patch failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    // ─── إضافة صنف جديد لمنيو الشاشة (جدول مستقل — لا يمس الكاشير إطلاقًا) ───
    router.post('/items', jwtAuth, requireRole('admin', 'manager', 'kitchen', 'sous_chef'), async (req, res) => {
        const b = req.body || {};
        const nm = cleanText(b.name_ar || b.name, 120);
        const nameEn = cleanText(b.name_en, 120) || null;
        if (!nm) {return res.status(422).json({ error: 'INVALID_NAME', message: 'اسم الصنف مطلوب' });}
        const sec = cleanText(b.section, 20) || 'mains';
        if (!MENU_SECTIONS.has(sec)) {return res.status(422).json({ error: 'INVALID_SECTION', message: 'القسم غير صالح' });}
        try {
            await ensureMenuItemsTable();
            const maxOrder = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM menu_board_items WHERE section = $1`, [sec])
                .then(r => Number(r.rows[0].m)).catch(() => 0);
            const r = await pool.query(
                `INSERT INTO menu_board_items (name_ar, name_en, section, sort_order, is_active)
                 VALUES ($1, $2, $3, $4, true) RETURNING id, name_ar, name_en, section, sort_order, is_active, image_url`,
                [nm, nameEn, sec, maxOrder + 1]);
            publicBoardCache.expiresAt = 0;
            try { if (opts.io) {opts.io.emit('menu_board_changed', { at: new Date().toISOString() });} } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.status(201).json(r.rows[0]);
        } catch (e) {
            logger.error('[menu-board] item create failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    // ─── حذف صنف من منيو الشاشة (الجدول المستقل فقط — الكاشير لا يُمس) ───
    router.delete('/items/:id', jwtAuth, requireRole('admin', 'manager'), async (req, res) => {
        const pid = Number(req.params.id);
        if (!Number.isInteger(pid) || pid <= 0) {return res.status(422).json({ error: 'INVALID_ID' });}
        try {
            const r = await pool.query(`DELETE FROM menu_board_items WHERE id = $1 RETURNING id`, [pid]);
            if (!r.rows.length) {return res.status(404).json({ error: 'NOT_FOUND' });}
            publicBoardCache.expiresAt = 0;
            try { if (opts.io) {opts.io.emit('menu_board_changed', { at: new Date().toISOString() });} } catch (_) { /* best-effort: الخطأ لا يوقف المسار */ }
            res.json({ ok: true, id: pid });
        } catch (e) {
            logger.error('[menu-board] item delete failed:', e.message);
            res.status(500).json({ error: 'INTERNAL_ERROR' });
        }
    });

    app.use('/api/menu-board', router);
}

module.exports = {
    register,
    cleanBoardCategories,
    boardCategorySelected,
    cleanBuffetLayout,
    emptyBuffetLayout,
    collectBuffetProductIds,
    sanitizeV2State,
};
