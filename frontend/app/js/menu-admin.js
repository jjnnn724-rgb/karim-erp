/**
 * menu-admin.js — لوحة إدارة شاشة المنيو
 * الدخول بنفس حسابات النظام (admin/manager) عبر /api/auth/login،
 * الأصناف تُدار من شاشة الكاشير — هنا الإعدادات واستعراض ما يُعرض.
 */
/* eslint-disable no-unused-vars --
   هذا الملف سكربت عادي (يُحمَّل بـscript src لا type=module)، فدواله
   عالمية. معظمها يُستدعى من معالجات سطرية داخل menu-admin.html
   (onclick="catToggleAll(this)" ...)، وESLint لا يرى الاستدعاء من
   نص HTML داخل ملف آخر. مدقّق المعالجات السطرية (scripts/audit-inline-handlers.js)
   يتحقق من وجود كل معالج في نطاق عام. */
'use strict';

let TOKEN = sessionStorage.getItem('mb_token') || '';
let APP_KEY = sessionStorage.getItem('mb_app_key') || '';
let POLL = null;
let CUSTOM_BACKGROUND = '';
let WEEK_CATALOG = [];
let BUFFET_LAYOUT = { enabled: false, mains: [], soups: [], desserts: [], appetizers: [], salads: [], carving_by_day: [] };
let BUFFET_EDITOR_READY = false;

const $ = (id) => document.getElementById(id);

async function api(method, path, body) {
    const r = await fetch(path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' },
            TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {},
            APP_KEY ? { 'x-api-key': APP_KEY } : {}),
        body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) { showLogin('انتهت الجلسة — سجّل الدخول من جديد'); throw new Error('unauthorized'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { throw new Error(j.message || ('HTTP ' + r.status)); }
    return j;
}

function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.add('hidden'), 2600);
}

function showLogin(err) {
    TOKEN = ''; APP_KEY = '';
    sessionStorage.removeItem('mb_token'); sessionStorage.removeItem('mb_app_key');
    if (POLL) { clearInterval(POLL); POLL = null; }
    $('adminView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    const e = $('loginError');
    if (err) { e.textContent = err; e.classList.remove('hidden'); } else { e.classList.add('hidden'); }
}

function showAdmin() {
    $('loginView').classList.add('hidden');
    $('adminView').classList.remove('hidden');
    loadSettings();
    loadBoard();
    loadWeekly();
    if (!POLL) { POLL = setInterval(loadBoard, 30_000); } // صمام أمان — البث اللحظي هو الأساسي
    listenRealtime();
}

/* ─── مزامنة لحظية مع الشاشة عبر socket.io ─── */
function listenRealtime() {
    if (window._mbSocket) { return; }
    try {
        const socket = io({ transports: ['websocket', 'polling'] });
        window._mbSocket = socket;
        socket.on('connect', () => setLive(true));
        socket.on('disconnect', () => setLive(false));
        socket.on('menu_board_changed', () => { loadBoard(); flashSync(); });
        socket.on('entity_changed', (p) => { if (p && p.entity === 'posProducts') { loadBoard(); flashSync(); } });
    } catch (_) { /* السوكيت غير حرج — الفحص الدوري يغطي */ }
}
function setLive(ok) {
    const el = $('tbLive');
    if (el) { el.textContent = ok ? '● متصل — بث لحظي' : '● غير متصل'; el.classList.toggle('off', !ok); }
}
function flashSync() {
    const el = $('stSync');
    if (!el) { return; }
    el.textContent = 'تحديث ✓';
    el.classList.add('flash');
    setTimeout(() => { el.textContent = 'مباشر'; el.classList.remove('flash'); }, 1600);
}

/* ─── التبويبات والمعاينة ─── */
function showTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
    if (name === 'preview') {
        reloadPreview();
        requestAnimationFrame(fitPortraitPreview);
    }
}
function reloadPreview() {
    const f = $('previewFrame');
    if (f) {
        try { f.contentWindow.location.reload(); } catch (_) { const src = f.getAttribute('src'); if (src) { f.src = src; } }
        setTimeout(fitPortraitPreview, 120);
    }
}
function fitPortraitPreview() {
    const frame = $('previewFrame'), stage = frame && frame.closest('.preview-stage');
    if (!frame || !stage || !stage.clientWidth || !stage.clientHeight) { return; }
    const scale = Math.min(stage.clientWidth / 1080, stage.clientHeight / 1920);
    frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
}
async function togglePreviewFullscreen() {
    const stage = $('previewFrame') && $('previewFrame').closest('.preview-stage');
    if (!stage) { return; }
    try {
        if (document.fullscreenElement === stage) {
            await document.exitFullscreen();
        } else if (stage.requestFullscreen) {
            await stage.requestFullscreen();
        } else {
            toast('ملء الشاشة غير مدعوم في هذا المتصفح');
            return;
        }
        requestAnimationFrame(fitPortraitPreview);
    } catch (error) {
        toast('تعذّر تكبير المعاينة: ' + error.message);
    }
}
function reloadControl() {
    const f = $('controlFrame');
    if (f) { try { f.contentWindow.location.reload(); } catch (_) { const src = f.getAttribute('src'); if (src) { f.src = src; } } }
}

/* ─── المؤشرات (KPIs) ─── */
function renderStats(b, full) {
    const shown = (b.categories || []).reduce((n, c) => n + (c.items || []).length, 0);
    const cats = new Set((b.categories || []).map(c => c.name));
    const all = (full.items || []);
    const hidden = all.filter(i => !i.is_active || i.sold_out).length;
    const set = (id, v) => { const el = $(id); if (el) { el.textContent = v; } };
    set('stTotal', all.length);
    set('stCats', cats.size);
    set('stShown', shown);
    set('stHidden', hidden);
}

/* ─── ما يُعرض الآن ─── */
async function loadBoard() {
    try {
        const [b, full] = await Promise.all([
            api('GET', '/api/menu-board/public'),
            api('GET', '/api/menu-board/items').catch(() => ({ items: [] })),
        ]);
        WEEK_CATALOG = (full.items || []).filter(item => item.is_active !== false);
        renderWeeklyCatalogSelectors();
        const cats = [...new Set((full.items || []).map(i => i.category || 'أصناف أخرى'))].sort((a, c) => a.localeCompare(c, 'ar'));
        ALL_CATS = cats;
        renderPeriodCategoryOptions();
        if (SEL_CATS === undefined) {
            try {
                const s = await api('GET', '/api/menu-board/settings');
                SEL_CATS = Array.isArray(s.board_categories) ? s.board_categories : null;
            } catch (_) { SEL_CATS = null; }
        }
        renderCatPicker();
        renderGroups(b.categories || []);
        renderStats(b, full);
        renderBuffetEditor(BUFFET_EDITOR_READY ? readBuffetLayout() : b.settings.buffet_layout, full.items || []);
    } catch (e) {
        if (e.message !== 'unauthorized') { $('boardGroups').innerHTML = '<div class="loading">تعذر تحميل المنيو: ' + esc(e.message) + '</div>'; }
    }
}

let ALL_CATS = [];
let SEL_CATS;
function renderCatPicker() {
    let host = $('catPicker');
    if (!host) {
        host = document.createElement('div');
        host.id = 'catPicker';
        host.className = 'cat-picker';
        const box = $('boardGroups');
        box.parentElement.insertBefore(host, box);
    }
    const all = SEL_CATS === null || SEL_CATS === undefined;
    host.innerHTML = `<div class="cat-picker-title">التصنيفات المعروضة على الشاشة الخارجية ${all ? '<span class="count">الكل</span>' : `<span class="count">${(SEL_CATS || []).length} مختار</span>`}</div>`
        + `<label class="cat-opt"><input type="checkbox" ${all ? 'checked' : ''} onchange="catToggleAll(this)"> <b>كل المنيو</b></label>`
        + ALL_CATS.map(c => `<label class="cat-opt"><input type="checkbox" data-cat="${esc(c)}" ${all || (SEL_CATS || []).includes(c) ? 'checked' : ''} onchange="catToggle(this)"> ${esc(c)}</label>`).join('')
        + `<div class="cat-picker-actions"><span class="cat-picker-hint">التغيير لا يظهر على الشاشة قبل الحفظ</span><button class="btn gold" data-karim-action="saveCategories">حفظ الاختيار</button></div>`;
}
function catToggleAll(el) {
    SEL_CATS = el.checked ? null : [];
    renderCatPicker();
}
function catToggle(el) {
    const c = el.getAttribute('data-cat');
    let cur = SEL_CATS === null || SEL_CATS === undefined ? [...ALL_CATS] : [...SEL_CATS];
    if (el.checked) { if (!cur.includes(c)) {cur.push(c);} }
    else { cur = cur.filter(x => x !== c); }
    SEL_CATS = cur.length >= ALL_CATS.length ? null : cur;
    renderCatPicker();
}
async function saveCategories() {
    const button = document.querySelector('.cat-picker-actions .btn');
    if (button) { button.disabled = true; button.textContent = 'جارٍ الحفظ…'; }
    try {
        const saved = await api('PUT', '/api/menu-board/settings', { board_categories: SEL_CATS === undefined ? null : SEL_CATS });
        SEL_CATS = Array.isArray(saved.board_categories) ? saved.board_categories : null;
        renderCatPicker();
        toast(SEL_CATS === null ? 'تم الحفظ — الشاشة تعرض كل المنيو الآن' : SEL_CATS.length ? `تم الحفظ — الشاشة تعرض: ${SEL_CATS.join('، ')}` : 'تم الحفظ — لا توجد تصنيفات مختارة');
        loadBoard();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الحفظ: ' + e.message); }
        if (button && button.isConnected) { button.disabled = false; button.textContent = 'حفظ الاختيار'; }
    }
}
async function saveItem(id) {
    const nameEl = document.getElementById('name-' + id);
    const nameEnEl = document.getElementById('name-en-' + id);
    const priceEl = document.getElementById('price-' + id);
    const catEl = document.getElementById('cat-' + id);
    const unitEl = document.getElementById('unit-' + id);
    const showEl = document.getElementById('show-' + id);
    const price = Number(String(priceEl ? priceEl.value : '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(price) || price < 0 || price > 100000) { toast('السعر غير صالح'); return; }
    const body = { price, is_active: showEl ? showEl.checked : true };
    if (nameEl) { body.name_ar = nameEl.value; }
    if (nameEnEl) { body.name_en = nameEnEl.value; }
    if (catEl) { body.category = catEl.value; }
    if (unitEl) { body.unit = unitEl.value; }
    try {
        await api('PATCH', '/api/menu-board/items/' + encodeURIComponent(id), body);
        toast('تم الحفظ — الشاشة تتحدث لحظيًا');
        loadBoard();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الحفظ: ' + e.message); }
    }
}
async function addItem() {
    const name = ($('newName') ? $('newName').value : '').trim();
    const nameEn = ($('newNameEn') ? $('newNameEn').value : '').trim();
    const price = Number(String($('newPrice') ? $('newPrice').value : '').replace(/[^0-9.]/g, ''));
    const category = ($('newCat') ? $('newCat').value : '').trim();
    const unit = ($('newUnit') ? $('newUnit').value : '').trim();
    if (!name) { toast('اكتب اسم الصنف'); return; }
    if (!Number.isFinite(price) || price < 0 || price > 100000) { toast('السعر غير صالح'); return; }
    try {
        await api('POST', '/api/menu-board/items', { name_ar: name, name_en: nameEn, price, category: category || undefined, unit: unit || undefined });
        toast('اتضاف الصنف — ظهر على الشاشة لحظيًا');
        if ($('newName')) {$('newName').value = '';}
        if ($('newNameEn')) {$('newNameEn').value = '';}
        if ($('newPrice')) {$('newPrice').value = '';}
        if ($('newCat')) {$('newCat').value = '';}
        if ($('newUnit')) {$('newUnit').value = '';}
        loadBoard();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الإضافة: ' + e.message); }
    }
}
async function hideItem(id, name) {
    if (!confirm(`إخفاء «${name}» من الشاشة؟ (يبقى في الكاشير)`)) {return;}
    try {
        await api('PATCH', '/api/menu-board/items/' + encodeURIComponent(id), { is_active: false });
        toast('اتخفى من الشاشة');
        loadBoard();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الإخفاء: ' + e.message); }
    }
}
async function deleteItem(id, name) {
    if (!confirm(`حذف «${name}» نهائيًا من المنيو؟`)) {return;}
    try {
        await api('DELETE', '/api/menu-board/items/' + encodeURIComponent(id) + '?hard=1');
        toast('اتحذف نهائيًا');
        loadBoard();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الحذف: ' + (e.message || '')); }
    }
}
function renderGroups(categories) {
    const box = $('boardGroups');
    if (!categories.length) {
        box.innerHTML = '<div class="loading">لا توجد أصناف نشطة بعد — أضف أصنافًا من شاشة الكاشير «إدارة منيو المطعم» وستظهر هنا فورًا.</div>';
        return;
    }
    box.innerHTML = categories.map(cat => `
        <div class="cat-block">
            <div class="cat-name">${esc(cat.name)} <span class="count">${cat.items.length} صنف</span></div>
            <div class="items">
                ${cat.items.map(it => `
                    <div class="item-row edit">
                        <span class="n"><input type="text" id="name-${it.id}" value="${esc(it.name)}" maxlength="120" title="اسم الصنف" placeholder="اسم الصنف بالعربية"></span>
                        <span class="n"><input type="text" id="name-en-${it.id}" value="${esc(it.name_en || '')}" maxlength="120" title="English item name" placeholder="اسم الصنف بالإنجليزية"></span>
                        <span class="p"><input type="number" min="0" max="100000" step="0.5" id="price-${it.id}" value="${Number(it.price)}" title="السعر"> ${esc(it.unit || 'ريال')}</span>
                        <span class="p"><input type="text" id="cat-${it.id}" value="${esc(cat.name)}" maxlength="40" title="التصنيف" placeholder="التصنيف"></span>
                        <label class="show" title="إظهار/إخفاء من الشاشة"><input type="checkbox" id="show-${it.id}" checked> عرض</label>
                        <button class="btn gold sm" data-karim-action="saveItem" data-karim-arg0="${Number(it.id)}">حفظ</button>
                        <button class="btn ghost sm" data-karim-action="hideItem" data-karim-arg0="${Number(it.id)}" data-karim-arg1="${esc(it.name).replace(/'/g, "\'")}">إخفاء</button>
                        <button class="btn ghost sm danger" data-karim-action="deleteItem" data-karim-arg0="${Number(it.id)}" data-karim-arg1="${esc(it.name).replace(/'/g, "\'")}">حذف</button>
                    </div>`).join('')}
            </div>
        </div>`).join('');
}

/* ─── الإعدادات ─── */
async function loadSettings() {
    try {
        const s = await api('GET', '/api/menu-board/settings');
        $('setTitle').value = s.title || '';
        $('setSubtitle').value = s.subtitle || '';
        $('setBreakfastStart').value = s.breakfast_start || legacyStart(s.breakfast_hours, '05:00');
        $('setLunchStart').value = s.lunch_start || legacyStart(s.lunch_hours, '12:00');
        $('setDinnerStart').value = s.dinner_start || legacyStart(s.dinner_hours, '17:00');
        $('setBreakfastCategory').dataset.saved = s.breakfast_category || '';
        $('setLunchCategory').dataset.saved = s.lunch_category || '';
        $('setDinnerCategory').dataset.saved = s.dinner_category || '';
        $('setThemeStyle').value = s.theme_style || 'emerald';
        syncThemeSwatches();
        $('setFooter').value = s.footer_text || '';
        $('setBuffetPrice').value = s.buffet_price ?? 75;
        $('setBackgroundStyle').value = s.background_style || 'ivory';
        CUSTOM_BACKGROUND = s.custom_background || '';
        updateBackgroundPreview();
        renderPeriodCategoryOptions();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر تحميل الإعدادات: ' + e.message); }
    }
}

function syncThemeSwatches() {
    const selected = $('setThemeStyle').value;
    document.querySelectorAll('.theme-swatch').forEach(button => {
        const active = button.dataset.theme === selected;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
    });
}

function selectTheme(theme) {
    if (!['emerald', 'sapphire', 'ruby', 'midnight'].includes(theme)) { return; }
    $('setThemeStyle').value = theme;
    syncThemeSwatches();
}

function legacyStart(value, fallback) {
    const match = String(value || '').match(/^\s*((?:[01]\d|2[0-3]):[0-5]\d)/);
    return match ? match[1] : fallback;
}

function renderPeriodCategoryOptions() {
    for (const period of ['Breakfast', 'Lunch', 'Dinner']) {
        const select = $('set' + period + 'Category');
        if (!select) { continue; }
        const saved = select.dataset.saved || select.value || '';
        const options = ['<option value="">تلقائي حسب اسم التصنيف</option>'];
        if (saved && !ALL_CATS.includes(saved)) {
            options.push(`<option value="${esc(saved)}">التصنيف المحفوظ: ${esc(saved)}</option>`);
        }
        options.push(...ALL_CATS.map(category => `<option value="${esc(category)}">${esc(category)}</option>`));
        select.innerHTML = options.join('');
        select.value = saved;
        select.onchange = () => { select.dataset.saved = select.value; };
    }
}

const BUFFET_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function renderBuffetEditor(layout, items) {
    const host = $('buffetLayoutEditor');
    if (!host) {return;}
    const source = layout && typeof layout === 'object' ? layout : BUFFET_LAYOUT;
    BUFFET_LAYOUT = {
        enabled: Boolean(source.enabled),
        mains: Array.isArray(source.mains) ? source.mains.map(Number) : [],
        soups: Array.isArray(source.soups) ? source.soups.map(Number) : [],
        desserts: Array.isArray(source.desserts) ? source.desserts.map(Number) : [],
        appetizers: Array.isArray(source.appetizers) ? source.appetizers.map(Number) : [],
        salads: Array.isArray(source.salads) ? source.salads.map(Number) : [],
        carving_by_day: Array.isArray(source.carving_by_day) ? source.carving_by_day : [],
    };
    $('buffetLayoutEnabled').checked = BUFFET_LAYOUT.enabled;
    const activeItems = items.filter(item => item.is_active);
    if (!activeItems.length) {
        host.innerHTML = '<p class="hint">أضف أصنافًا نشطة من شاشة الكاشير أولًا.</p>';
        BUFFET_EDITOR_READY = false;
        return;
    }
    const optionMarkup = selected => `<option value="">— بدون صنف —</option>` + activeItems.map(item =>
        `<option value="${Number(item.id)}" ${selected === Number(item.id) ? 'selected' : ''}>${esc(item.name_ar || 'صنف بدون اسم')} · #${Number(item.id)}</option>`).join('');
    const group = (id, label, values, max, size) => `
        <label class="buffet-select-group">${label} <span class="count"><span id="${id}Count">${values.length}</span>${max ? ` / ${max}` : ''}</span>
            <select id="${id}" multiple size="${size}" data-max="${max || ''}">${activeItems.map(item =>
                `<option value="${Number(item.id)}" ${values.includes(Number(item.id)) ? 'selected' : ''}>${esc(item.name_ar || 'صنف بدون اسم')} · #${Number(item.id)}</option>`).join('')}
            </select>
        </label>`;
    const carvingDays = Array.from({ length: 7 }, (_, day) => {
        const entry = BUFFET_LAYOUT.carving_by_day.find(row => Number(row.day) === day) || {};
        return `<div class="carving-day"><b>${BUFFET_DAYS[day]}</b>
            <label>كاري الغداء<select id="carving-${day}-lunch">${optionMarkup(entry.lunch == null ? null : Number(entry.lunch))}</select></label>
            <label>كاري العشاء<select id="carving-${day}-dinner">${optionMarkup(entry.dinner == null ? null : Number(entry.dinner))}</select></label>
        </div>`;
    }).join('');
    host.innerHTML = `
        <div class="buffet-select-grid">
            ${group('buffetMains', 'الأطباق الرئيسية', BUFFET_LAYOUT.mains, 10, 6)}
            ${group('buffetSoups', 'الشوربات', BUFFET_LAYOUT.soups, 2, 4)}
            ${group('buffetSalads', 'السلطات', BUFFET_LAYOUT.salads, 8, 5)}
            ${group('buffetAppetizers', 'المقبلات', BUFFET_LAYOUT.appetizers, 8, 5)}
            ${group('buffetDesserts', 'الحلويات', BUFFET_LAYOUT.desserts, 8, 5)}
        </div>
        <div class="carving-editor"><h4>الكاري اليومي</h4>${carvingDays}</div>`;
    for (const id of ['buffetMains', 'buffetSoups', 'buffetSalads', 'buffetAppetizers', 'buffetDesserts']) {
        $(id).addEventListener('change', () => {
            const select = $(id);
            const max = Number(select.dataset.max);
            const selected = [...select.selectedOptions];
            if (selected.length > max) {
                selected[selected.length - 1].selected = false;
                toast(`الحد الأقصى لهذا القسم ${max} أصناف`);
            }
            $(id + 'Count').textContent = select.selectedOptions.length;
        });
    }
    BUFFET_EDITOR_READY = true;
}

function readBuffetLayout() {
    if (!BUFFET_EDITOR_READY) {
        return { ...BUFFET_LAYOUT, enabled: $('buffetLayoutEnabled') ? $('buffetLayoutEnabled').checked : BUFFET_LAYOUT.enabled };
    }
    const readIds = id => [...$(id).selectedOptions].map(option => Number(option.value)).filter(Number.isSafeInteger);
    const carving_by_day = BUFFET_DAYS.map((_, day) => {
        const lunch = $('carving-' + day + '-lunch').value;
        const dinner = $('carving-' + day + '-dinner').value;
        return { day, lunch: lunch || null, dinner: dinner || null };
    });
    return {
        enabled: $('buffetLayoutEnabled') ? $('buffetLayoutEnabled').checked : BUFFET_LAYOUT.enabled,
        mains: readIds('buffetMains'),
        soups: readIds('buffetSoups'),
        salads: readIds('buffetSalads'),
        appetizers: readIds('buffetAppetizers'),
        desserts: readIds('buffetDesserts'),
        carving_by_day,
    };
}

async function saveSettings() {
    const backgroundStyle = $('setBackgroundStyle').value;
    const starts = {
        breakfast: $('setBreakfastStart').value,
        lunch: $('setLunchStart').value,
        dinner: $('setDinnerStart').value,
    };
    if (!Object.values(starts).every(value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) ||
        !(starts.breakfast < starts.lunch && starts.lunch < starts.dinner)) {
        toast('رتّب مواعيد البداية: الإفطار ثم الغداء ثم العشاء.');
        return;
    }
    const body = {
        title: $('setTitle').value,
        subtitle: $('setSubtitle').value,
        breakfast_start: starts.breakfast,
        lunch_start: starts.lunch,
        dinner_start: starts.dinner,
        breakfast_hours: `${starts.breakfast} - ${starts.lunch}`,
        lunch_hours: `${starts.lunch} - ${starts.dinner}`,
        dinner_hours: `${starts.dinner} - ${starts.breakfast}`,
        breakfast_category: $('setBreakfastCategory').value || null,
        lunch_category: $('setLunchCategory').value || null,
        dinner_category: $('setDinnerCategory').value || null,
        footer_text: $('setFooter').value,
        buffet_price: $('setBuffetPrice').value,
        buffet_layout: readBuffetLayout(),
        background_style: backgroundStyle,
        theme_style: $('setThemeStyle').value,
        custom_background: backgroundStyle === 'custom' ? CUSTOM_BACKGROUND : '',
    };
    try {
        await api('PUT', '/api/menu-board/settings', body);
        BUFFET_LAYOUT = body.buffet_layout;
        BUFFET_EDITOR_READY = false;
        loadBoard();
        if (backgroundStyle !== 'custom') { CUSTOM_BACKGROUND = ''; }
        updateBackgroundPreview();
        $('settingsSaved').textContent = '✓ حُفظ — الشاشة تتحدث تلقائيًا';
        setTimeout(() => { $('settingsSaved').textContent = ''; }, 4000);
        toast('تم حفظ إعدادات العرض');
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الحفظ: ' + e.message); }
    }
}

function updateBackgroundPreview() {
    const preview = $('backgroundPreview');
    const isCustom = $('setBackgroundStyle').value === 'custom';
    preview.classList.toggle('hidden', !isCustom || !CUSTOM_BACKGROUND);
    preview.style.backgroundImage = isCustom && CUSTOM_BACKGROUND
        ? `linear-gradient(rgba(255,253,245,.45), rgba(250,244,228,.45)), url("${CUSTOM_BACKGROUND}")`
        : '';
    $('backgroundHint').textContent = isCustom
        ? (CUSTOM_BACKGROUND ? 'معاينة الصورة المخصصة التي ستظهر على شاشة العرض.' : 'اختر صورة للخلفية المخصصة قبل الحفظ.')
        : 'الخلفية المخصصة تُضغط تلقائيًا وتُحفظ في قاعدة بيانات النظام.';
}

function compressBackground(file) {
    return new Promise((resolve, reject) => {
        if (!file || file.size > 15 * 1024 * 1024) {
            reject(new Error('اختر صورة حجمها أقل من 15 ميجابايت'));
            return;
        }
        const url = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            if (!image.width || !image.height || image.width > 12000 || image.height > 12000) {
                reject(new Error('أبعاد الصورة أكبر من المسموح'));
                return;
            }
            const scale = Math.min(1, 1080 / image.width, 1920 / image.height);
            let width = Math.round(image.width * scale);
            let height = Math.round(image.height * scale);
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('تعذر تجهيز الصورة'));
                return;
            }
            try {
                for (let attempt = 0; attempt < 5; attempt++) {
                    canvas.width = width;
                    canvas.height = height;
                    context.drawImage(image, 0, 0, width, height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.76 - attempt * 0.08);
                    if (dataUrl.length <= 1_400_000) { resolve(dataUrl); return; }
                    width = Math.max(1, Math.round(width * 0.8));
                    height = Math.max(1, Math.round(height * 0.8));
                }
                reject(new Error('تعذر ضغط الصورة إلى الحجم المسموح'));
            } catch (e) {
                reject(new Error('تعذر تجهيز الصورة: ' + e.message));
            }
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('تعذر قراءة ملف الصورة'));
        };
        image.src = url;
    });
}

async function handleBackgroundUpload(file) {
    try {
        CUSTOM_BACKGROUND = await compressBackground(file);
        $('setBackgroundStyle').value = 'custom';
        updateBackgroundPreview();
        toast('تم تجهيز الخلفية — اضغط حفظ الإعدادات');
    } catch (e) {
        $('setBackgroundFile').value = '';
        toast(e.message);
    }
}

/* ─── منيو الأسبوع (7 أيام) ─── */
const WEEK_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
let WEEK_DATA = [];
let WEEK_DAY = new Date().getDay();
async function loadWeekly() {
    try {
        const r = await api('GET', '/api/menu-board/weekly');
        WEEK_DATA = Array.isArray(r.days) ? r.days : [];
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر تحميل المنيو الأسبوعي: ' + e.message); }
        WEEK_DATA = [];
    }
    renderWeekTabs();
    renderWeekDay();
}
function weekDay(d) {
    let x = WEEK_DATA.find(y => Number(y.day_of_week) === Number(d));
    if (!x) { x = { day_of_week: d, title: '', items: [], note: '' }; WEEK_DATA.push(x); }
    if (!Array.isArray(x.items)) {x.items = [];}
    return x;
}
function renderWeekTabs() {
    const host = $('weekTabs');
    if (!host) {return;}
    host.innerHTML = WEEK_AR.map((n, d) => {
        const c = (weekDay(d).items || []).length;
        return `<button class="day-tab${d === WEEK_DAY ? ' active' : ''}" data-karim-action="weekSelect" data-karim-arg0="${d}">${n}<span class="count">${c}</span></button>`;
    }).join('');
}
function weekSelect(d) {
    WEEK_DAY = d;
    renderWeekTabs();
    renderWeekDay();
}
function renderWeekDay() {
    const d = weekDay(WEEK_DAY);
    if ($('wkTitle')) {$('wkTitle').value = d.title || '';}
    if ($('wkNote')) {$('wkNote').value = d.note || '';}
    const host = $('weekItems');
    if (!host) {return;}
    host.innerHTML = (d.items || []).map((it, i) => `
        <div class="wk-row">
            <select class="wk-catalog" aria-label="اختيار صنف محفوظ" data-i="${i}" onchange="weekUseCatalogItem(this)">
                ${weeklyCatalogOptions(it)}
            </select>
            <input value="${esc(it.name || '')}" maxlength="120" placeholder="اسم الصنف" data-k="name" data-i="${i}">
            <input value="${esc(it.name_en || '')}" maxlength="120" placeholder="اسم الصنف بالإنجليزية" data-k="name_en" data-i="${i}">
            <input type="number" min="0" max="100000" step="0.5" value="${Number(it.price) || 0}" data-k="price" data-i="${i}" title="السعر">
            <input value="${esc(it.category || '')}" maxlength="40" placeholder="التصنيف" data-k="category" data-i="${i}">
            <input value="${esc(it.note || '')}" maxlength="120" placeholder="ملاحظة" data-k="note" data-i="${i}">
            <button class="btn ghost sm" data-karim-action="weekDelRow" data-karim-arg0="${i}">حذف</button>
        </div>`).join('') || '<div class="loading">لا أصناف لهذا اليوم — أضف من زر «＋ صنف».</div>';
}
function weeklyCatalogOptions(item) {
    const selected = WEEK_CATALOG.find(catalogItem =>
        String(catalogItem.id) === String(item.catalog_id || '')) || null;
    const label = catalogItem => `${catalogItem.name_ar || catalogItem.name || 'صنف'}${catalogItem.name_en ? ` · ${catalogItem.name_en}` : ''}`;
    const sectionNames = {
        soups: 'الشوربات', mains: 'الأطباق الرئيسية', desserts: 'الحلويات',
        appetizers: 'المقبلات', salads: 'السلطات',
    };
    const groups = new Map();
    WEEK_CATALOG.forEach(catalogItem => {
        const section = sectionNames[catalogItem.section] || catalogItem.category || 'أصناف أخرى';
        if (!groups.has(section)) { groups.set(section, []); }
        groups.get(section).push(catalogItem);
    });
    const options = [...groups].map(([section, items]) =>
        `<optgroup label="${esc(section)}">${items.map(catalogItem =>
            `<option value="${Number(catalogItem.id)}" ${selected && Number(selected.id) === Number(catalogItem.id) ? 'selected' : ''}>${esc(label(catalogItem))}</option>`).join('')}</optgroup>`);
    return '<option value="">— اختر من الأصناف المحفوظة —</option>' + options.join('');
}
function renderWeeklyCatalogSelectors() {
    document.querySelectorAll('.wk-catalog').forEach(select => {
        const rowIndex = Number(select.dataset.i);
        const current = weekDay(WEEK_DAY).items[rowIndex] || {};
        const value = select.value;
        select.innerHTML = weeklyCatalogOptions({ ...current, catalog_id: value || current.catalog_id });
        select.value = value || String(current.catalog_id || '');
    });
}
window.weekUseCatalogItem = select => {
    const catalogItem = WEEK_CATALOG.find(item => String(item.id) === select.value);
    if (!catalogItem) { return; }
    const rowIndex = Number(select.dataset.i);
    const item = weekDay(WEEK_DAY).items[rowIndex];
    if (!item) { return; }
    const sectionNames = {
        soups: 'الشوربات', mains: 'الأطباق الرئيسية', desserts: 'الحلويات',
        appetizers: 'المقبلات', salads: 'السلطات',
    };
    item.catalog_id = Number(catalogItem.id);
    item.name = catalogItem.name_ar || catalogItem.name || '';
    item.name_en = catalogItem.name_en || '';
    item.category = catalogItem.category || sectionNames[catalogItem.section] || item.category || '';
    if (!Number(item.price) && Number(catalogItem.price) > 0) { item.price = Number(catalogItem.price); }
    renderWeekDay();
    renderWeekTabs();
};
function weekReadRows() {
    const host = $('weekItems');
    if (!host) {return [];}
    const rows = [...host.querySelectorAll('.wk-row')];
    return rows.map(r => {
        const g = (k) => { const el = r.querySelector(`[data-k="${k}"]`); return el ? el.value : ''; };
        const select = r.querySelector('.wk-catalog');
        return {
            catalog_id: select && select.value ? Number(select.value) : null,
            name: g('name').trim(), name_en: g('name_en').trim(),
            price: Number(String(g('price')).replace(/[^0-9.]/g, '')) || 0,
            category: g('category').trim(), note: g('note').trim(),
        };
    }).filter(x => x.name);
}
function weekAddRow() {
    const d = weekDay(WEEK_DAY);
    d.items = d.items || [];
    d.items.push({ catalog_id: null, name: '', name_en: '', price: 0, category: '', note: '' });
    renderWeekDay();
    renderWeekTabs();
}
function weekDelRow(i) {
    const d = weekDay(WEEK_DAY);
    d.items = (d.items || []).filter((_, x) => x !== i);
    renderWeekDay();
    renderWeekTabs();
}
async function saveWeekly() {
    const d = weekDay(WEEK_DAY);
    d.title = $('wkTitle') ? $('wkTitle').value.trim() : (d.title || '');
    d.note = $('wkNote') ? $('wkNote').value.trim() : (d.note || '');
    d.items = weekReadRows();
    const payload = { days: WEEK_DATA.map(x => ({ day_of_week: Number(x.day_of_week), title: x.title || '', note: x.note || '', items: x.items || [] })) };
    try {
        await api('PUT', '/api/menu-board/weekly', payload);
        toast('اتحفظ منيو الأسبوع — الشاشة تتحدث لحظيًا');
        renderWeekTabs();
        renderWeekDay();
    } catch (e) {
        if (e.message !== 'unauthorized') { toast('تعذر الحفظ: ' + e.message); }
    }
}
function printWeekly() {
    const d = weekDay(WEEK_DAY);
    d.title = $('wkTitle') ? $('wkTitle').value.trim() : (d.title || '');
    d.note = $('wkNote') ? $('wkNote').value.trim() : (d.note || '');
    d.items = weekReadRows();
    printWeeklyFile(false);
}
function printWeeklyFile(all) {
    const days = all ? WEEK_DATA.slice().sort((a, c) => a.day_of_week - c.day_of_week) : [weekDay(WEEK_DAY)];
    const dayName = (d) => WEEK_AR[Number(d)] || '';
    const w = window.open('', '_blank');
    if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warning'); return; }
    const logoUrl = esc(new URL('assets/al-shurfa-logo.png', window.location.href).href);
    const sec = (d) => {
        const dd = typeof d === 'number' ? weekDay(d) : d;
        const items = dd.items || [];
        const cats = {};
        items.forEach(it => { const c = it.category || 'أطباقنا'; (cats[c] = cats[c] || []).push(it); });
        return `<section class="day">
            <div class="day-head"><span class="day-name">${esc(dayName(dd.day_of_week))}</span>${dd.title ? `<span class="day-title">${esc(dd.title)}</span>` : ''}</div>
            ${dd.note ? `<div class="day-note">${esc(dd.note)}</div>` : ''}
            ${Object.keys(cats).map(c => `<h3>${esc(c)}</h3><ul>${cats[c].map(it => `<li><span class="in">${esc(it.name)}${it.note ? ` <small>— ${esc(it.note)}</small>` : ''}</span><span class="dots"></span><span class="pr">${Number(it.price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></li>`).join('')}</ul>`).join('')}
        </section>`;
    };
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="UTF-8"><title>منيو الأسبوع — مطاعم الشرفه العالمي</title>
    <style>
    @import url('https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700;900&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Cairo',Tahoma,sans-serif;background:#fff;color:#2b2113;padding:36px 40px}
    .cover{text-align:center;border:3px double #9a7418;border-radius:18px;padding:30px 20px;margin-bottom:26px;background:linear-gradient(180deg,#fdfbf4,#f6efdb)}
    .cover-logo{display:block;width:88px;height:88px;object-fit:contain;margin:0 auto 10px}
    .cover h1{font-family:'Aref Ruqaa',serif;font-size:44px;color:#6d4c12;margin:6px 0}
    .cover h2{font-size:20px;color:#8a7648;letter-spacing:2px}
    .cover .rule{width:220px;height:2px;background:linear-gradient(90deg,transparent,#9a7418,transparent);margin:14px auto}
    .day{break-inside:avoid;border:1px solid #e3d5ae;border-radius:14px;padding:20px 24px;margin-bottom:20px;background:#fffdf7}
    .day-head{display:flex;align-items:baseline;gap:14px;border-bottom:2px solid #9a7418;padding-bottom:8px;margin-bottom:6px}
    .day-name{font-family:'Aref Ruqaa',serif;font-size:32px;color:#6d4c12}
    .day-title{font-size:17px;color:#8a7648}
    .day-note{font-size:13.5px;color:#8a7648;margin:6px 0}
    h3{font-size:17px;color:#fffdf7;background:linear-gradient(90deg,#8a6420,#c9a227);display:inline-block;padding:3px 16px;border-radius:999px;margin:12px 0 6px}
    ul{list-style:none}
    li{display:flex;align-items:baseline;gap:10px;padding:7px 2px;border-bottom:1px dotted #c9b98a;font-size:15.5px}
    li .in{font-weight:600} li .in small{color:#8a7648;font-weight:400}
    li .dots{flex:1;border-bottom:1px dotted #c9b98a;transform:translateY(-4px)}
    li .pr{font-weight:900;color:#6d4c12;white-space:nowrap}
    .foot{text-align:center;color:#8a7648;font-size:13px;margin-top:10px;border-top:1px solid #e3d5ae;padding-top:12px}
    @media print{body{padding:0}.day{break-inside:avoid}}
    </style></head><body>
    <div class="cover"><img class="cover-logo" src="${logoUrl}" alt="شعار مطاعم الشرفة العالمي"><h2>مطاعم الشرفة العالمي</h2><h1>${all ? 'منيو الأسبوع' : 'منيو ' + esc(dayName(WEEK_DAY))}</h1><div class="rule"></div><h2>ALSHORFA RESTAURANTS — WEEKLY BUFFET</h2></div>
    ${days.map(sec).join('')}
    <div class="foot">الأسعار شاملة الضريبة · نتشرف بخدمتكم — للحفظ PDF: طباعة ← حفظ كـ PDF</div>
    </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { try { w.print(); } catch (_) {} }, 600);
    }
function printWeeklyAll() {
    const d = weekDay(WEEK_DAY);
    d.title = $('wkTitle') ? $('wkTitle').value.trim() : (d.title || '');
    d.note = $('wkNote') ? $('wkNote').value.trim() : (d.note || '');
    d.items = weekReadRows();
    printWeeklyFile(true);
}

/* ─── الدخول ─── */
/* SSO: عند الفتح داخل نظام ERP (iframe) نستخدم جلسة الأدمن الحالية بلا تسجيل جديد */
function trySsoFromParent() {
    try {
        if (window.parent === window) { return false; } // فتح مباشر — لا والد
        const pw = window.parent;
        const jwt = pw._jwt || (pw.localStorage && pw.localStorage.getItem('token'));
        if (!jwt) { return false; }
        const role = pw._role || (pw.STATE && pw.STATE.currentUser && pw.STATE.currentUser.role);
        if (role && !['admin', 'manager', 'kitchen', 'sous_chef'].includes(role)) { return false; }
        TOKEN = jwt;
        APP_KEY = pw._appKey || '';
        sessionStorage.setItem('mb_token', TOKEN);
        sessionStorage.setItem('mb_app_key', APP_KEY);
        return true;
    } catch (_) { return false; } //跨越 origin — نتجاهل ونطلب تسجيل الدخول
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
        if (!['admin', 'manager', 'kitchen', 'sous_chef'].includes(role)) { throw new Error('هذه اللوحة للشيف أو المدير فقط'); }
        TOKEN = j.access_token; APP_KEY = j.app_key || '';
        sessionStorage.setItem('mb_token', TOKEN);
        sessionStorage.setItem('mb_app_key', APP_KEY);
        showAdmin();
    } catch (e) {
        showLogin(e.message);
    } finally {
        btn.disabled = false; btn.textContent = 'دخول';
    }
}

function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fN(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ─── ربط الأحداث ─── */
document.addEventListener('DOMContentLoaded', () => {
    window.addEventListener('resize', fitPortraitPreview);
    document.addEventListener('fullscreenchange', () => {
        const button = $('btnPreviewFullscreen');
        const active = document.fullscreenElement === ($('previewFrame') && $('previewFrame').closest('.preview-stage'));
        if (button) { button.textContent = active ? '⤢ تصغير المعاينة' : '⛶ تكبير المعاينة'; }
        requestAnimationFrame(fitPortraitPreview);
    });
    if (typeof ResizeObserver === 'function') {
        const stage = $('previewFrame') && $('previewFrame').closest('.preview-stage');
        if (stage) { new ResizeObserver(fitPortraitPreview).observe(stage); }
    }
    window.togglePreviewFullscreen = togglePreviewFullscreen;
    $('loginForm').addEventListener('submit', (ev) => {
        ev.preventDefault();
        doLogin($('username').value.trim(), $('password').value);
    });
    $('saveSettings').addEventListener('click', saveSettings);
    $('setBackgroundStyle').addEventListener('change', updateBackgroundPreview);
    $('setBackgroundFile').addEventListener('change', (ev) => handleBackgroundUpload(ev.target.files[0]));
    $('logoutBtn').addEventListener('click', () => showLogin());
    if (!TOKEN) { trySsoFromParent(); }
    if (TOKEN) {
        // جلسة محفوظة — تحقق سريع ثم افتح اللوحة
        api('GET', '/api/menu-board/settings').then(showAdmin).catch(() => showLogin());
    }
});
