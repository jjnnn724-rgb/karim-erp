const API = '';
const CURRENCY = 'SAR'; // عملة العرض — مصدر وحيد لكل شاشات الكاشير
let accessToken = null;
let currentUser = null;
let currentSession = null;
let currentDepartment = null;
let departments = [];
let products = [];
let catalogProducts = [];
let categories = [];
let currentCategory = 'all';
let cart = [];
let cartDiscount = { type: null, value: 0 };
let heldOrders = [];
let recipeIngredients = [];
let inventoryIngredients = [];
let activeShift = null;
let buffetConfig = null;
let buffetLive = null;
let buffetLiveTimer = null;
let buffetInvTab = 'held';
let lastBuffetReport = null;
let currentProductImageUrl = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ─── XSS Safety ────────────────────────────────────────────
// Product names, department names, user names, held-order previews and
// server error messages all originate from the database or from user
// input elsewhere in the app (e.g. an admin renaming a product). They are
// rendered here via innerHTML for layout convenience, so every such value
// MUST be escaped before interpolation — otherwise a malicious product/
// department name becomes stored XSS that runs in every cashier's browser
// (and can exfiltrate the in-memory access token).
function escapeHtml(value) {
    if (value === null || value === undefined) {return '';}
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showScreen(id) {
    $$('.screen').forEach((screen) => screen.classList.add('hidden'));
    $(`#${id}`).classList.remove('hidden');
    if (id === 'pos-screen') {setMobileCartOpen(false);}
}

// ─── PWA: تثبيت + شريط عدم الاتصال ───
let _posPwaPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    _posPwaPrompt = e;
    const b = document.getElementById('posInstallBtn');
    if (b) {b.style.display = '';}
});
async function posPwaInstall() {
    if (_posPwaPrompt) {
        _posPwaPrompt.prompt();
        try { await _posPwaPrompt.userChoice; } catch (_) {}
        _posPwaPrompt = null;
        const b = document.getElementById('posInstallBtn');
        if (b) {b.style.display = 'none';}
    }
}
function posPwaOfflineBar() {
    const b = document.getElementById('posOfflineBar');
    if (b) {b.style.display = navigator.onLine ? 'none' : '';}
    posRtSetLive(navigator.onLine);
}
window.addEventListener('online', posPwaOfflineBar);
window.addEventListener('offline', posPwaOfflineBar);

function setMobileCartOpen(open) {
    const posScreen = $('#pos-screen');
    const toggle = $('#mobile-cart-toggle');
    if (!posScreen || !toggle) {return;}
    posScreen.classList.toggle('mobile-cart-open', Boolean(open));
    toggle.setAttribute('aria-expanded', String(Boolean(open)));
    toggle.classList.toggle('active', Boolean(open));
    toggle.innerHTML = open ? '<i class=ji data-i=x></i> إخفاء السلة <span id="mobile-cart-count">' + ($('#mobile-cart-count')?.textContent || '0') + '</span>' : '<i class=ji data-i=shopping-cart></i> السلة <span id="mobile-cart-count">' + ($('#mobile-cart-count')?.textContent || '0') + '</span>';
}

function toggleMobileCart() {
    setMobileCartOpen(!$('#pos-screen')?.classList.contains('mobile-cart-open'));
}

function updateMobileCartCount() {
    const count = $('#mobile-cart-count');
    if (count) {count.textContent = String(cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0));}
}

function showModal(id) {
    $(`#${id}`).classList.remove('hidden');
}

function hideModal(id) {
    $(`#${id}`).classList.add('hidden');
}

function fmtMoney(n) {
    return Number(n || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function fmtQty(n) {    return Number(n || 0).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
    });
}

function isManagerRole() {
    return ['admin', 'manager'].includes(currentUser?.role);
}

function resetCartDiscount() {
    cartDiscount = { type: null, value: 0 };
}

function showToast(message, type = 'info') { /* notifications disabled */ return; }
window.toast = showToast;

function showLoading(text = 'جارٍ المعالجة...') {
    $('#loading-text').textContent = text;
    $('#loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    $('#loading-overlay').classList.add('hidden');
}

async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (accessToken) {headers.Authorization = `Bearer ${accessToken}`;}
    if (posAppKeyGet()) {headers['x-api-key'] = posAppKeyGet();}
    if (opts.idempotencyKey) {headers['Idempotency-Key'] = opts.idempotencyKey;}
    if (window._rtSocket && window._rtSocket.connected) {headers['x-socket-id'] = window._rtSocket.id || '';}
    // لاتيني فقط: المتصفح يرفض الترويسات غير Latin-1 (خطأ ISO-8859-1)
    try {
        const ua = navigator.userAgent || '';
        const dev = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows PC' : 'POS terminal';
        headers['x-device-name'] = 'POS (' + dev + (currentDepartment && currentDepartment.id ? ' dept-' + currentDepartment.id : '') + ')';
    } catch (_) {}

    const doFetch = async () => {
        const h = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
        if (accessToken) {h.Authorization = `Bearer ${accessToken}`;}
        if (posAppKeyGet()) {h['x-api-key'] = posAppKeyGet();}
        if (opts.idempotencyKey) {h['Idempotency-Key'] = opts.idempotencyKey;}
        if (window._rtSocket && window._rtSocket.connected) {h['x-socket-id'] = window._rtSocket.id || '';}
        try {
            const ua = navigator.userAgent || '';
            const dev = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows PC' : 'POS terminal';
            h['x-device-name'] = 'POS (' + dev + (currentDepartment && currentDepartment.id ? ' dept-' + currentDepartment.id : '') + ')';
        } catch (_) {}
        return fetch(`${API}${path}`, { ...opts, headers: h });
    };
    let res = await doFetch();
    if (res.status === 401 && !opts._retried && posRTget()) {
        if (await posRefreshSession()) {
            res = await doFetch();
            if (res.status !== 401) {
                const d2 = await res.json().catch(() => ({}));
                if (!res.ok) {throw Object.assign(new Error(d2.message || d2.error || 'Request failed'), { response: d2, status: res.status });}
                return d2;
            }
        }
        posRTclear();
        posLogoutToLogin();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw Object.assign(new Error(data.message || data.error || 'Request failed'), {
            response: data,
            status: res.status,
        });
    }
    return data;
}

// ─── مفتاح التطبيق (x-api-key): يُسلَّم مع الدخول/التجديد ويُرفق بكل طلب ────
const POS_APP_KEY = 'karim_pos_appkey_v1';
let posAppKey = '';
function posAppKeyGet(){ return posAppKey || ''; }
function posAppKeySet(k){ posAppKey = String(k || ''); try { if (posAppKey) {localStorage.setItem(POS_APP_KEY, posAppKey);} else {localStorage.removeItem(POS_APP_KEY);} } catch (_) {} }
try { posAppKey = String(localStorage.getItem(POS_APP_KEY) || ''); } catch (_) {}
// ─── جلسة مفتوحة دائمة لشاشة الكاشير: حفظ رمز التحديث + تجديد صامت ───
const POS_RT_KEY = 'karim_pos_rt_v1';
function posRTget(){ try { return localStorage.getItem(POS_RT_KEY) || ''; } catch (_) { return ''; } }
function posRTset(rt){ try { if (rt) {localStorage.setItem(POS_RT_KEY, rt);} } catch (_) {} }
function posRTclear(){ try { localStorage.removeItem(POS_RT_KEY); } catch (_) {} }
let _posRefreshInflight = null;
function posRefreshSession(){
    if (_posRefreshInflight) {return _posRefreshInflight;}
    const rt = posRTget();
    if (!rt) {return Promise.resolve(false);}
    _posRefreshInflight = (async () => {
        try {
            const r = await fetch(`${API}/api/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: rt }),
            });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.access_token) { posRTclear(); return false; }
            accessToken = d.access_token;
            if (d.app_key) {posAppKeySet(d.app_key);}
            if (d.refresh_token) {posRTset(d.refresh_token);}
            if (d.user) {currentUser = d.user;}
            return true;
        } catch (_) { return false; }
        finally { _posRefreshInflight = null; }
    })();
    return _posRefreshInflight;
}
function posLogoutToLogin(){
    accessToken = null; currentUser = null; currentSession = null;
    posRTclear(); posAppKeySet('');
    const pe = $('#password'); if (pe) {pe.value = '';}
    showScreen('login-screen');
}

async function completeRequiredPasswordChange(result, currentPassword) {
    const nextPassword = window.prompt('يجب تغيير كلمة المرور الأولية قبل فتح الكاشير. أدخل كلمة مرور جديدة من 12 حرفًا على الأقل وتحتوي على حروف وأرقام:');
    if (!nextPassword) {throw new Error('تم إلغاء تغيير كلمة المرور الإلزامي.');}
    const confirmPassword = window.prompt('أعد إدخال كلمة المرور الجديدة للتأكيد:');
    if (nextPassword !== confirmPassword) {throw new Error('كلمتا المرور غير متطابقتين.');}
    accessToken = result.access_token;
    return api('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: currentPassword, new_password: nextPassword }),
    });
}

function productIcon(name, category) {
    const n = (name || '').toLowerCase();
    const c = (category || '').toLowerCase();
    if (c.includes('وجبات') || c.includes('رئيسية')) {return '<i class=ji data-i=utensils></i>';}
    if (c.includes('مشويات')) {return '<i class=ji data-i=flame></i>';}
    if (c.includes('مقبلات')) {return '<i class=ji data-i=cooking-pot></i>';}
    if (c.includes('سلطات')) {return '<i class=ji data-i=salad></i>';}
    if (c.includes('شوربات')) {return '<i class=ji data-i=cooking-pot></i>';}
    if (c.includes('مياه')) {return '<i class=ji data-i=droplet></i>';}
    if (c.includes('غازية')) {return '<i class=ji data-i=cup-soda></i>';}
    if (c.includes('عصائر')) {return '<i class=ji data-i=cup-soda></i>';}
    if (c.includes('ساخنة')) {return '<i class=ji data-i=coffee></i>';}
    if (n.includes('دجاج') || n.includes('مندي') || n.includes('شاورما')) {return '<i class=ji data-i=drumstick></i>';}
    if (n.includes('لحم') || n.includes('كباب') || n.includes('مشوي')) {return '<i class=ji data-i=beef></i>';}
    if (n.includes('سمك') || n.includes('روبيان')) {return '<i class=ji data-i=fish></i>';}
    if (n.includes('عصير') || n.includes('ليمون') || c.includes('مشروب')) {return '<i class=ji data-i=cup-soda></i>';}
    if (n.includes('قهوة') || n.includes('شاي') || n.includes('كرك')) {return '<i class=ji data-i=coffee></i>';}
    if (n.includes('سلطة') || n.includes('خضار')) {return '<i class=ji data-i=salad></i>';}
    if (n.includes('أرز') || n.includes('ارز') || n.includes('كبسة')) {return '<i class=ji data-i=rice></i>';}
    if (n.includes('خبز') || n.includes('فلافل')) {return '<i class=ji data-i=bread></i>';}
    if (n.includes('حلو') || n.includes('كيك') || n.includes('كنافة')) {return '<i class=ji data-i=cake></i>';}
    return '<i class=ji data-i=utensils></i>';
}

function normalizeProduct(product) {
    return {
        ...product,
        id: Number(product.id),
        department_id: product.department_id !== null && product.department_id !== undefined ? Number(product.department_id) : null,
        legacy_inventory_id: product.legacy_inventory_id !== null && product.legacy_inventory_id !== undefined ? Number(product.legacy_inventory_id) : null,
        price: Number(product.price || 0),
        cost_price: product.cost_price !== null && product.cost_price !== undefined ? Number(product.cost_price) : null,
        stock_quantity: Number(product.stock_quantity || 0),
        min_stock_level: Number(product.min_stock_level || 0),
        vat_rate: Number(product.vat_rate || 15),
        is_active: Boolean(product.is_active),
    };
}

function buildDiscountedCartItems(items = cart, discountState = cartDiscount) {
    const normalized = items.map((item) => ({
        product_id: Number(item.product_id),
        name: item.name,
        barcode: item.barcode || null,
        quantity: Number(item.quantity || 0),
        unit_price: Number(item.unit_price || 0),
        discount: Number(item.discount || 0),
        vat_rate: Number(item.vat_rate || 15),
    }));

    const subtotalBeforeCartDiscount = normalized.reduce((sum, item) => {
        const lineNet = Math.max(0, (item.quantity * item.unit_price) - item.discount);
        return sum + lineNet;
    }, 0);

    let discountAmount = 0;
    if (discountState?.type === 'percent') {
        discountAmount = subtotalBeforeCartDiscount * (Number(discountState.value || 0) / 100);
    } else if (discountState?.type === 'fixed') {
        discountAmount = Number(discountState.value || 0);
    }
    discountAmount = Number(Math.max(0, Math.min(discountAmount, subtotalBeforeCartDiscount)).toFixed(2));

    let remaining = discountAmount;
    const lastIndex = normalized.length - 1;

    return normalized.map((item, index) => {
        const baseNet = Math.max(0, (item.quantity * item.unit_price) - item.discount);
        let allocatedCartDiscount = 0;
        if (discountAmount > 0 && baseNet > 0) {
            if (index === lastIndex) {
                allocatedCartDiscount = remaining;
            } else {
                allocatedCartDiscount = Number(((baseNet / subtotalBeforeCartDiscount) * discountAmount).toFixed(2));
                allocatedCartDiscount = Math.min(allocatedCartDiscount, remaining);
            }
            remaining = Number((remaining - allocatedCartDiscount).toFixed(2));
        }

        const finalDiscount = Number((item.discount + allocatedCartDiscount).toFixed(2));
        const netSubtotal = Number(Math.max(0, (item.quantity * item.unit_price) - finalDiscount).toFixed(2));
        const vatAmount = Number((netSubtotal * (item.vat_rate / 100)).toFixed(2));

        return {
            ...item,
            allocated_cart_discount: allocatedCartDiscount,
            final_discount: finalDiscount,
            line_subtotal: netSubtotal,
            vat_amount: vatAmount,
            line_total_with_vat: Number((netSubtotal + vatAmount).toFixed(2)),
        };
    });
}

function calculateTotals() {
    const pricedItems = buildDiscountedCartItems();
    const subtotalBeforeDiscount = pricedItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const discount = pricedItems.reduce((sum, item) => sum + item.final_discount, 0);
    const afterDiscount = pricedItems.reduce((sum, item) => sum + item.line_subtotal, 0);
    const tax = pricedItems.reduce((sum, item) => sum + item.vat_amount, 0);
    const total = afterDiscount + tax;

    return {
        items: pricedItems,
        subtotalBeforeDiscount: Number(subtotalBeforeDiscount.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        afterDiscount: Number(afterDiscount.toFixed(2)),
        tax: Number(tax.toFixed(2)),
        total: Number(total.toFixed(2)),
    };
}

function clearPayments() {    ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'].forEach((id) => {
        $('#' + id).value = '0';
    });
    ['pay-card-ref', 'pay-wallet-ref', 'pay-bank-ref'].forEach((id) => {
        $('#' + id).value = '';
    });
    refreshPaymentChannels();
}

// قراءة مبلغ من حقل — تطبيع الأرقام العربية (٠-٩)، الفاصلة العربية (٫)، وفواصل الآلاف
function parseAmount(value) {
    let s = String(value ?? '').trim();
    if (!s) {return 0;}
    s = s.replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
        .replace(/[٫]/g, '.')
        .replace(/[٬,\s]/g, '');
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? n : 0;
}

function totalPaid() {
    return parseAmount($('#pay-cash').value)
        + parseAmount($('#pay-card').value)
        + parseAmount($('#pay-wallet').value)
        + parseAmount($('#pay-bank').value);
}

function refreshPaymentChannels() {
    const fieldMap = {
        cash: 'pay-cash',
        card: 'pay-card',
        wallet: 'pay-wallet',
        bank_transfer: 'pay-bank',
    };
    $$('.pay-channel').forEach((channel) => {
        const method = channel.dataset.method;
        const fieldId = fieldMap[method];
        if (!fieldId) {return;}
        const value = parseAmount($('#' + fieldId).value);
        channel.classList.toggle('active', value > 0);
    });
}

function updateOverviewStats() {
    if (isOpenBuffetDepartment()) { renderBuffetLive(); return; }
    setStatLabels(false);
    $('#stat-products-count').textContent = fmtQty(products.length);
    $('#stat-available-count').textContent = fmtQty(products.filter((product) => Number(product.ingredient_count || 0) === 0 || Number(product.stock_quantity) > 0).length);
    $('#stat-low-stock-count').textContent = fmtQty(products.filter((product) => Number(product.ingredient_count || 0) > 0 && product.stock_quantity > 0 && product.stock_quantity <= Math.max(product.min_stock_level || 0, 5)).length);
    $('#stat-held-count').textContent = fmtQty(heldOrders.length);
}

function updateTotals() {
    const totals = calculateTotals();
    $('#cart-subtotal').textContent = fmtMoney(totals.subtotalBeforeDiscount);
    $('#cart-discount').textContent = `- ${fmtMoney(totals.discount)}`;
    $('#cart-tax').textContent = fmtMoney(totals.tax);
    $('#cart-total').textContent = `${fmtMoney(totals.total)} ${CURRENCY}`;
    updatePaymentTotal();
}

function updatePaymentTotal() {
    const totals = calculateTotals();
    const paid = totalPaid();
    const change = paid - totals.total;
    $('#pay-total').textContent = fmtMoney(paid);
    $('#pay-change').textContent = fmtMoney(Math.max(0, change));
    $('#pay-change').style.color = change >= -0.01 ? '#4ade80' : '#f87171';
    $('#complete-sale-btn').disabled = cart.length === 0 || paid < totals.total - 0.01;
    refreshPaymentChannels();
}

function renderCategories() {
    const container = $('#category-tabs');
    const labels = { all: '<i class=ji data-i=package></i> الكل' };
    container.innerHTML = categories.map((category) => {
        const active = category === currentCategory ? 'active' : '';
        return `<button class="cat-tab ${active}" data-cat="${escapeHtml(category)}">${labels[category] || escapeHtml(category)}</button>`;
    }).join('');

    $$('.cat-tab').forEach((button) => {
        button.addEventListener('click', () => {
            currentCategory = button.dataset.cat;
            renderCategories();
            renderProducts($('#product-search').value);
        });
    });
}

function isOpenBuffetDepartment() {
    const dept = departments.find((entry) => Number(entry.id) === Number(currentDepartment?.id));
    const text = `${dept?.code || ''} ${dept?.name_ar || dept?.name || ''}`.toLowerCase();
    return text.includes('open_buffet') || text.includes('بوفيه') || text.includes('buffet');
}

function buffetTierIcon(tier) {
    if (tier?.tier === 'adult') {return 'users';}
    if (tier?.tier === 'child') {return 'user';}
    if (tier?.tier === 'hospitality') {return 'party';}
    return 'star';
}

function renderBuffetPeople() {
    const grid = $('#products-grid');
    $('#category-tabs').innerHTML = '';
    const tiers = (Array.isArray(buffetConfig?.tiers) ? buffetConfig.tiers : []).filter((tier) => tier.is_active !== false);
    grid.innerHTML = `<div class="buffet-mode-header">
            <strong><i class=ji data-i=party></i> كاشير البوفيه المفتوح</strong>
            <span>اضغط البطاقة لإضافة فرد — البيع بعدد الأشخاص لا الأصناف</span>
            <div id="buffet-live-strip" class="buffet-live-strip"><span class="buffet-live-dot"></span><span>جارٍ تحميل العداد الحي…</span></div>
        </div>
        ${tiers.map((tier) => {
            const free = Number(tier.price) === 0;
            return `<button type="button" class="product-card buffet-person-card ${tier.tier === 'hospitality' ? 'buffet-hosp' : ''}" data-id="${tier.id}">
                <div class="product-icon"><i class="ji" data-i="${buffetTierIcon(tier)}"></i></div>
                <div class="product-name">${escapeHtml(tier.name_ar)}</div>
                <div class="product-meta">${tier.tier === 'hospitality' && free ? 'ضيافة مجانية' : 'فرد واحد'}</div>
                <div class="product-price">${free ? 'مجاناً' : `${fmtMoney(tier.price)} <span class="currency">${CURRENCY}</span>`}</div>
                <div class="buffet-add-label">+ إضافة فرد</div>
            </button>`;
        }).join('') || '<div class="pos-empty-grid">لم يتم إعداد أسعار البوفيه بعد — استخدم زر قائمة الأسعار</div>'}`;
    $$('.buffet-person-card').forEach((card) => card.addEventListener('click', () => addToCart(Number(card.dataset.id))));
    loadBuffetLive().catch(() => {});
}

function buffetToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
}

async function loadBuffetLive() {
    if (!isOpenBuffetDepartment() || !currentSession?.session_id) {return;}
    try {
        const query = new URLSearchParams({ session_id: String(currentSession.session_id) });
        buffetLive = await api(`/api/pos/buffet/live?${query.toString()}`);
        renderBuffetLive();
    } catch (err) {
        console.warn('Buffet live counter failed:', err);
    }
}

function renderBuffetLive() {
    const strip = $('#buffet-live-strip');
    if (strip) {
        if (!buffetLive?.daily) {
            strip.innerHTML = '<span class="buffet-live-dot"></span><span>العداد الحي غير متاح حاليًا</span>';
        } else {
            const d = buffetLive.daily;
            strip.innerHTML = `
                <span class="buffet-live-dot"></span>
                <span class="buffet-live-pill"><strong>${fmtQty(d.covers_total)}</strong> فرد اليوم</span>
                <span class="buffet-live-pill"><strong>${fmtMoney(d.revenue)}</strong> ${CURRENCY}</span>
                <span class="buffet-live-pill"><strong>${fmtQty(d.invoices_count)}</strong> فاتورة</span>
                ${buffetLive.shift ? `<span class="buffet-live-pill shift"><strong>${fmtQty(buffetLive.shift.covers_total)}</strong> فرد الوردية</span>` : ''}
                ${d.voided?.count ? `<span class="buffet-live-pill warn">${fmtQty(d.voided.count)} ملغاة</span>` : ''}
            `;
        }
    }
    // Buffet-mode stat chips: categories / today covers / hospitality covers / held
    const labels = ['فئات البوفيه', 'أفراد اليوم', 'ضيافة اليوم', 'معلق'];
    $$('#pos-stats .stat-chip .label').forEach((el, i) => { if (labels[i]) {el.textContent = labels[i];} });
    $('#stat-products-count').textContent = fmtQty((buffetConfig?.tiers || []).filter((t) => t.is_active !== false).length);
    $('#stat-available-count').textContent = fmtQty(buffetLive?.daily?.covers_total || 0);
    $('#stat-low-stock-count').textContent = fmtQty(buffetLive?.daily?.covers_by_tier?.hospitality?.covers || 0);
    $('#stat-held-count').textContent = fmtQty(heldOrders.length);
}

function setStatLabels(buffetMode) {
    const labels = buffetMode
        ? ['فئات البوفيه', 'أفراد اليوم', 'ضيافة اليوم', 'معلق']
        : ['أصناف المنيو', 'المتاح', 'منخفض', 'معلق'];
    $$('#pos-stats .stat-chip .label').forEach((el, i) => { if (labels[i]) {el.textContent = labels[i];} });
}

function startBuffetLiveTimer() {
    stopBuffetLiveTimer();
    buffetLiveTimer = setInterval(() => {
        if (!isOpenBuffetDepartment()) { stopBuffetLiveTimer(); return; }
        loadBuffetLive().catch(() => {});
    }, 60000);
}

function stopBuffetLiveTimer() {
    if (buffetLiveTimer) { clearInterval(buffetLiveTimer); buffetLiveTimer = null; }
}

function renderProducts(filter = '') {
    const grid = $('#products-grid');
    const search = String(filter || '').trim().toLowerCase();
    const filtered = products.filter((product) => {
        const categoryMatch = currentCategory === 'all' || product.category === currentCategory;
        const searchMatch = !search
            || (product.name_ar || '').toLowerCase().includes(search)
            || (product.barcode || '').toLowerCase().includes(search)
            || (product.category || '').toLowerCase().includes(search);
        return categoryMatch && searchMatch;
    });

    if (filtered.length === 0) {
        grid.innerHTML = `<div class="pos-empty-grid">
            <div class="pos-empty-icon"><i class=ji data-i=search></i></div>
            <div>لا توجد أصناف مطابقة</div>
        </div>`;
        return;
    }

    grid.innerHTML = filtered.map((product) => {
        const stock = Number(product.stock_quantity);
        const recipeManaged = Number(product.ingredient_count || 0) > 0;
        const lowThreshold = Math.max(Number(product.min_stock_level || 0), 5);
        const stockClass = recipeManaged && stock <= 0 ? 'out' : recipeManaged && stock <= lowThreshold ? 'low' : '';
        const stockLabel = recipeManaged && stock <= 0 ? 'نفذ من مكونات المخزن' : recipeManaged && stock <= lowThreshold ? `${fmtQty(stock)} متبقي` : '';
        const outOfStock = recipeManaged && stock <= 0;
        const icon = productIcon(product.name_ar, product.category);
        const image = product.image_url ? `<img src="${escapeHtml(product.image_url)}" alt="${escapeHtml(product.name_ar)}" loading="lazy">` : icon;

        return `
            <div class="product-card ${outOfStock ? 'out-of-stock' : ''}" data-id="${product.id}">
                ${stockLabel ? `<div class="product-stock ${stockClass}">${stockLabel}</div>` : ''}
                <div class="product-icon ${product.image_url ? 'has-product-image' : ''}">${image}</div>
                <div class="product-name">${escapeHtml(product.name_ar)}</div>
                <div class="product-price">${fmtMoney(product.price)} <span class="currency">${CURRENCY}</span></div>
                ${product.barcode ? `<div class="product-meta">${escapeHtml(product.barcode)}</div>` : ''}
            </div>
        `;
    }).join('');

    $$('.product-card').forEach((card) => {
        card.addEventListener('click', () => {
            if (card.classList.contains('out-of-stock')) {
                showToast('هذا الصنف غير متاح حاليًا', 'warning');
                return;
            }
            addToCart(Number(card.dataset.id));
        });
    });
}

function renderCart() {
    const container = $('#cart-items');
    const totals = calculateTotals();

    if (cart.length === 0) {
        container.innerHTML = `<div class="cart-empty">
            <div class="cart-empty-icon"><i class=ji data-i=shopping-cart></i></div>
            <div class="cart-empty-text">السلة فارغة<br><small>اضغط على صنف لإضافته</small></div>
        </div>`;
        $('#cart-count').textContent = '0';
        updateMobileCartCount();
        $('#hold-order-btn').disabled = true;
        $('#clear-cart-btn').disabled = true;
        $('#discount-btn').disabled = true;
    } else {
        container.innerHTML = totals.items.map((item, index) => `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${escapeHtml(item.name)}</div>
                    <div class="cart-item-price">
                        ${fmtMoney(item.unit_price)} × ${fmtQty(item.quantity)}
                        ${item.final_discount > 0 ? `<span class="discount-note">خصم ${fmtMoney(item.final_discount)}</span>` : ''}
                    </div>
                    <div class="cart-item-total">${fmtMoney(item.line_subtotal)} ${CURRENCY}</div>
                </div>
                <div class="cart-item-controls">
                    <button class="qty-btn" onclick="changeQty(${index}, -1)">−</button>
                    <span class="cart-item-qty">${fmtQty(item.quantity)}</span>
                    <button class="qty-btn" onclick="changeQty(${index}, 1)">+</button>
                    <button class="qty-btn remove" onclick="removeFromCart(${index})"><i class=ji data-i=x></i></button>
                </div>
            </div>
        `).join('');

        $('#cart-count').textContent = String(cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
        updateMobileCartCount();
        $('#hold-order-btn').disabled = false;
        $('#clear-cart-btn').disabled = false;
        $('#discount-btn').disabled = false;
    }

    updateTotals();
}

function buffetPriceRowHtml(t) {
    const isCore = Boolean(t.is_core);
    const key = isCore ? t.tier : `custom_${t.id}`;
    const disabled = t.is_active === false;
    return `<div class="buffet-price-row ${disabled ? 'inactive' : ''}" data-key="${key}" data-id="${t.id}" data-core="${isCore ? 1 : 0}" data-name="${escapeHtml(t.name_ar)}">
        <div class="bpr-head">
            ${isCore
                ? `<span class="bpr-name">${escapeHtml(t.name_ar)}</span><span class="bpr-badge core">فئة أساسية</span>`
                : `<input type="text" class="bpr-name-input" value="${escapeHtml(t.name_ar)}" maxlength="100" ${disabled ? 'disabled' : ''}>`}
            ${disabled ? '<span class="bpr-badge off">معطّلة</span>' : ''}
            ${Number(t.price) === 0 ? '<span class="bpr-badge free">مجانية</span>' : ''}
        </div>
        <div class="bpr-price-wrap">
            <input type="number" class="bpr-price" value="${Number(t.price).toFixed(2)}" min="0" step="0.01" ${disabled ? 'disabled' : ''}>
            <span class="bpr-unit">${CURRENCY} / فرد — ضريبة ${Number(t.vat_rate || 0)}%</span>
        </div>
        ${!isCore ? `<div class="bpr-actions">
            ${disabled
                ? `<button type="button" class="bpr-btn" data-act="enable"><i class=ji data-i=refresh></i> تفعيل</button>`
                : `<button type="button" class="bpr-btn danger" data-act="disable"><i class=ji data-i=trash></i> تعطيل</button>`}
        </div>` : ''}
    </div>`;
}

function bindBuffetPriceRows() {
    $$('#buffet-price-rows .bpr-btn').forEach((btn) => btn.addEventListener('click', () => handleBuffetTierAction(btn)));
}

async function openBuffetPrices() {
    if (!isManagerRole() || !isOpenBuffetDepartment()) {return;}
    try {
        buffetConfig = await api('/api/pos/buffet/config');
        $('#buffet-price-rows').innerHTML = (buffetConfig.tiers || []).map(buffetPriceRowHtml).join('') || '<div class="pos-empty-grid">لا توجد فئات بعد</div>';
        $('#buffet-new-tier-name').value = '';
        $('#buffet-new-tier-price').value = '';
        $('#buffet-prices-error').textContent = '';
        bindBuffetPriceRows();
        showModal('buffet-prices-modal');
    } catch (err) { showToast(err.response?.message || err.message || 'تعذر تحميل أسعار البوفيه', 'error'); }
}

async function handleBuffetTierAction(btn) {
    const row = btn.closest('.buffet-price-row');
    const id = Number(row?.dataset.id);
    if (!id) {return;}
    if (btn.dataset.act === 'disable') {
        if (!confirm('تعطيل هذه الفئة؟ تبقى فواتيرها السابقة محفوظة ويمكن تفعيلها لاحقًا.')) {return;}
        showLoading('جارٍ تعطيل الفئة...');
        try {
            const res = await api(`/api/pos/buffet/config/tiers/${id}`, { method: 'DELETE' });
            buffetConfig = { ...buffetConfig, tiers: res.tiers };
            $('#buffet-price-rows').innerHTML = (buffetConfig.tiers || []).map(buffetPriceRowHtml).join('');
            bindBuffetPriceRows();
            products = (buffetConfig.tiers || []).map(normalizeProduct).filter((product) => product.is_active !== false);
            renderBuffetPeople(); renderCart();
            showToast('تم تعطيل الفئة — سجل مبيعاتها محفوظ', 'info');
        } catch (err) { showToast(err.response?.message || err.message || 'تعذر تعطيل الفئة', 'error'); }
        finally { hideLoading(); }
    } else if (btn.dataset.act === 'enable') {
        showLoading('جارٍ تفعيل الفئة...');
        try {
            const res = await api(`/api/pos/buffet/config/tiers/${id}`, { method: 'PUT', body: JSON.stringify({ is_active: true }) });
            buffetConfig = { ...buffetConfig, tiers: res.tiers };
            $('#buffet-price-rows').innerHTML = (buffetConfig.tiers || []).map(buffetPriceRowHtml).join('');
            bindBuffetPriceRows();
            products = (buffetConfig.tiers || []).map(normalizeProduct).filter((product) => product.is_active !== false);
            renderBuffetPeople(); renderCart();
            showToast('تم تفعيل الفئة', 'success');
        } catch (err) { showToast(err.response?.message || err.message || 'تعذر تفعيل الفئة', 'error'); }
        finally { hideLoading(); }
    }
}

async function saveBuffetPrices() {
    const errBox = $('#buffet-prices-error');
    errBox.textContent = '';
    const prices = {};
    let invalid = false;
    $$('#buffet-price-rows .buffet-price-row').forEach((row) => {
        const input = row.querySelector('.bpr-price');
        if (!input || input.disabled) {return;}
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 0) { invalid = true; input.classList.add('invalid'); return; }
        input.classList.remove('invalid');
        prices[row.dataset.key] = value;
    });
    if (invalid) { errBox.textContent = 'كل الأسعار يجب أن تكون أرقامًا موجبة أو صفرًا'; return; }
    if (!Object.keys(prices).length) { errBox.textContent = 'لا توجد أسعار لحفظها'; return; }

    // Renamed custom tiers are updated individually after the bulk price save
    const renames = [];
    $$('#buffet-price-rows .buffet-price-row[data-core="0"]').forEach((row) => {
        const nameInput = row.querySelector('.bpr-name-input');
        if (!nameInput || nameInput.disabled) {return;}
        const name = nameInput.value.trim();
        if (!name) { invalid = true; nameInput.classList.add('invalid'); return; }
        nameInput.classList.remove('invalid');
        if (name !== row.dataset.name) {renames.push({ id: Number(row.dataset.id), name });}
    });
    if (invalid) { errBox.textContent = 'اسم الفئة مطلوب'; return; }

    showLoading('جارٍ حفظ قائمة الأسعار...');
    try {
        await api('/api/pos/buffet/config/prices', { method: 'PUT', body: JSON.stringify({ prices }) });
        for (const rename of renames) {
            await api(`/api/pos/buffet/config/tiers/${rename.id}`, { method: 'PUT', body: JSON.stringify({ name_ar: rename.name }) });
        }
        buffetConfig = await api('/api/pos/buffet/config');
        products = (buffetConfig.tiers || []).map(normalizeProduct).filter((product) => product.is_active !== false);
        renderBuffetPeople(); renderCart(); hideModal('buffet-prices-modal');
        showToast('تم حفظ قائمة الأسعار — الفواتير الجديدة فقط تتأثر', 'success');
    } catch (err) {
        errBox.textContent = err.response?.message || err.message || 'تعذر حفظ الأسعار';
    } finally { hideLoading(); }
}

async function addBuffetTier() {
    const errBox = $('#buffet-prices-error');
    const name = $('#buffet-new-tier-name').value.trim();
    const price = Number($('#buffet-new-tier-price').value || 0);
    if (!name) { errBox.textContent = 'أدخل اسم الفئة الجديدة'; return; }
    if (!Number.isFinite(price) || price < 0) { errBox.textContent = 'السعر يجب أن يكون رقمًا موجبًا أو صفرًا'; return; }
    try {
        const res = await api('/api/pos/buffet/config/tiers', { method: 'POST', body: JSON.stringify({ name_ar: name, price }) });
        buffetConfig = { ...buffetConfig, tiers: res.tiers };
        $('#buffet-new-tier-name').value = '';
        $('#buffet-new-tier-price').value = '';
        errBox.textContent = '';
        $('#buffet-price-rows').innerHTML = (buffetConfig.tiers || []).map(buffetPriceRowHtml).join('');
        bindBuffetPriceRows();
        products = (buffetConfig.tiers || []).map(normalizeProduct).filter((product) => product.is_active !== false);
        renderBuffetPeople();
        showToast('تمت إضافة الفئة إلى قائمة الأسعار', 'success');
    } catch (err) {
        errBox.textContent = err.response?.message || err.message || 'تعذر إضافة الفئة';
    }
}

async function openBuffetInvoices() {
    if (!isOpenBuffetDepartment()) {return;}
    buffetInvTab = 'held';
    $$('.buffet-inv-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'held'));
    showModal('buffet-invoices-modal');
    await refreshBuffetInvoices();
}

async function refreshBuffetInvoices() {
    try { await loadHeldOrders(); } catch (err) { console.warn('Held orders reload failed:', err); }
    const badge = $('#buffet-held-count-badge');
    if (badge) {badge.textContent = String(heldOrders.length);}
    if (buffetInvTab === 'held') {renderBuffetHeldTab();}
    else {await renderBuffetIssuedTab();}
}

function renderBuffetHeldTab() {
    const body = $('#buffet-invoices-body');
    if (!heldOrders.length) {
        body.innerHTML = '<div class="buffet-inv-empty"><i class=ji data-i=clipboard-list></i> لا توجد فواتير محفوظة (معلقة) في هذه الوردية</div>';
        return;
    }
    body.innerHTML = heldOrders.map((order) => `
        <div class="buffet-inv-card">
            <div class="header">
                <span class="order-id">طلب #${String(order.id).slice(0, 8)}</span>
                <span class="order-time"><i class=ji data-i=alarm></i> ${new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div class="order-items">${escapeHtml(order.items_preview || 'بدون تفاصيل')}</div>
            <div class="order-total">${fmtMoney(order.total_amount)} ${CURRENCY}</div>
            <div class="held-order-actions">
                <button class="modal-btn primary modal-btn-block" onclick="buffetRecallHeld('${order.id}')">استرجاع للسلة</button>
                <button class="modal-btn danger modal-btn-block" onclick="buffetDeleteHeld('${order.id}')">حذف</button>
            </div>
        </div>
    `).join('');
}

async function renderBuffetIssuedTab() {
    const body = $('#buffet-invoices-body');
    body.innerHTML = '<div class="buffet-inv-empty">جارٍ تحميل فواتير اليوم…</div>';
    try {
        const res = await api(`/api/pos/buffet/invoices?date=${buffetToday()}&limit=100`);
        if (!res.data?.length) {
            body.innerHTML = '<div class="buffet-inv-empty"><i class=ji data-i=receipt></i> لا فواتير بوفيه صادرة اليوم بعد</div>';
            return;
        }
        body.innerHTML = `<table class="buffet-inv-table"><thead><tr>
                <th>#</th><th>الوقت</th><th>الأفراد</th><th>التفصيل</th><th>الإجمالي</th><th>الحالة</th><th>الكاشير</th>
            </tr></thead><tbody>
            ${res.data.map((inv) => {
                const coversParts = Object.values(inv.covers?.tiers || {}).map((t) => `${t.name}: ${fmtQty(t.covers)}`).join(' • ') || '—';
                const statusLabel = inv.status === 'cancelled'
                    ? '<span class="bpr-badge off">ملغاة</span>'
                    : inv.status === 'reported' ? '<span class="bpr-badge core">مُبلّغة</span>' : '<span class="bpr-badge ok">صادرة</span>';
                return `<tr class="${inv.status === 'cancelled' ? 'cancelled' : ''}">
                    <td>#${inv.invoice_counter}</td>
                    <td>${new Date(inv.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td><strong>${fmtQty(inv.covers?.covers_total || 0)}</strong></td>
                    <td class="covers-detail">${escapeHtml(coversParts)}</td>
                    <td>${fmtMoney(inv.total_amount)} ${CURRENCY}</td>
                    <td>${statusLabel}</td>
                    <td>${escapeHtml(inv.cashier_name || '—')}</td>
                </tr>`;
            }).join('')}</tbody></table>`;
    } catch (err) {
        body.innerHTML = `<div class="buffet-inv-empty">${escapeHtml(err.response?.message || err.message || 'فشل تحميل الفواتير')}</div>`;
    }
}

async function openBuffetReport() {
    if (!isOpenBuffetDepartment()) {return;}
    $('#buffet-report-date').value = buffetToday();
    showModal('buffet-report-modal');
    await loadBuffetReport();
}

async function loadBuffetReport() {
    const date = $('#buffet-report-date').value || buffetToday();
    const body = $('#buffet-report-body');
    body.innerHTML = '<div class="buffet-inv-empty">جارٍ توليد التقرير…</div>';
    try {
        const report = await api(`/api/pos/buffet/report?date=${date}`);
        lastBuffetReport = report;
        body.innerHTML = renderBuffetReportHtml(report);
    } catch (err) {
        lastBuffetReport = null;
        body.innerHTML = `<div class="buffet-inv-empty">${escapeHtml(err.response?.message || err.message || 'فشل توليد التقرير')}</div>`;
    }
}

function paymentMethodLabel(method) {
    return { cash: 'نقدي', card: 'بطاقة', wallet: 'محفظة', bank_transfer: 'تحويل بنكي' }[method] || method;
}

function renderBuffetReportHtml(r, { forPrint = false } = {}) {
    const cardsCls = forPrint ? 'cards' : 'buffet-report-cards';
    const cardCls = (extra) => forPrint ? `card ${extra || ''}` : `br-card ${extra || ''}`.trim();
    const colsCls = forPrint ? 'cols' : 'br-cols';
    const t = r.totals || {};
    const tiersRows = (r.tiers || []).map((tier) => `<tr><td>${escapeHtml(tier.name)}</td><td>${fmtQty(tier.covers)}</td><td>${fmtMoney(tier.revenue)}</td><td>${fmtMoney(tier.avg_price)}</td><td>${fmtQty(tier.invoices)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">لا مبيعات في هذا اليوم</td></tr>';
    const hourlyRows = (r.hourly || []).map((h) => `<tr><td>${String(h.hour).padStart(2, '0')}:00</td><td>${fmtQty(h.invoices)}</td><td>${fmtQty(h.covers)}</td><td>${fmtMoney(h.revenue)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">—</td></tr>';
    const payRows = (r.payments || []).map((p) => `<tr><td>${escapeHtml(paymentMethodLabel(p.method))}</td><td>${fmtQty(p.count)}</td><td>${fmtMoney(p.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>';
    const cashierRows = (r.cashiers || []).map((c) => `<tr><td>${escapeHtml(c.cashier)}</td><td>${fmtQty(c.invoices)}</td><td>${fmtMoney(c.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">—</td></tr>';
    return `
        <div class="${cardsCls}">
            <div class="${cardCls()}"><span>إجمالي الأفراد</span><strong>${fmtQty(t.covers_total || 0)}</strong></div>
            <div class="${cardCls('gold')}"><span>الإيراد المحصل (شامل الضريبة)</span><strong>${fmtMoney(t.revenue || 0)} ${CURRENCY}</strong></div>
            <div class="${cardCls('info')}"><span>ضريبة القيمة المضافة</span><strong>${fmtMoney(t.vat_total || 0)} ${CURRENCY}</strong></div>
            <div class="${cardCls()}"><span>صافي الإيراد</span><strong>${fmtMoney(t.net_revenue || 0)} ${CURRENCY}</strong></div>
            <div class="${cardCls()}"><span>الفواتير</span><strong>${fmtQty(t.invoices || 0)}</strong></div>
            <div class="${cardCls()}"><span>متوسط الفرد</span><strong>${fmtMoney(t.revenue_per_cover || 0)} ${CURRENCY}</strong></div>
            <div class="${cardCls('warn')}"><span>فواتير ملغاة</span><strong>${fmtQty(t.voided?.count || 0)} (${fmtMoney(t.voided?.amount || 0)})</strong></div>
            <div class="${cardCls('info')}"><span>معلقة بالكاشير</span><strong>${fmtQty(t.still_held?.count || 0)} (${fmtMoney(t.still_held?.amount || 0)})</strong></div>
        </div>
        <h4 class="br-sec">حسب الفئة</h4>
        <table class="buffet-inv-table"><thead><tr><th>الفئة</th><th>أفراد</th><th>الإيراد الصافي (قبل الضريبة)</th><th>متوسط الفرد</th><th>فواتير</th></tr></thead><tbody>${tiersRows}</tbody></table>
        <h4 class="br-sec">التوزيع الساعي</h4>
        <table class="buffet-inv-table"><thead><tr><th>الساعة</th><th>فواتير</th><th>أفراد</th><th>الإيراد</th></tr></thead><tbody>${hourlyRows}</tbody></table>
        <div class="${colsCls}">
            <div><h4 class="br-sec">طرق الدفع</h4><table class="buffet-inv-table"><thead><tr><th>الطريقة</th><th>عدد</th><th>المبلغ</th></tr></thead><tbody>${payRows}</tbody></table></div>
            <div><h4 class="br-sec">أداء الكاشيرين</h4><table class="buffet-inv-table"><thead><tr><th>الكاشير</th><th>فواتير</th><th>الإيراد</th></tr></thead><tbody>${cashierRows}</tbody></table></div>
        </div>`;
}

function printBuffetReport() {
    if (!lastBuffetReport) { showToast('لا يوجد تقرير للطباعة — اعرض التقرير أولًا', 'warning'); return; }
    const report = lastBuffetReport;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تقرير البوفيه ${escapeHtml(report.date)}</title><style>
        body{font-family:'Segoe UI',Tahoma,Arial,sans-serif;padding:18px;color:#1a1a1a}
        h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;color:#666;margin:0 0 14px;font-weight:normal}
        .cards{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}
        .card{border:1px solid #ddd;border-radius:8px;padding:8px 12px;min-width:130px}
        .card span{display:block;font-size:11px;color:#777}.card strong{font-size:15px}
        h4{margin:12px 0 6px;font-size:14px}
        table{width:100%;border-collapse:collapse;margin-bottom:10px}
        th,td{border:1px solid #e2e2e2;padding:5px 8px;font-size:12px;text-align:right}
        th{background:#f5f0e6}.empty{color:#999;text-align:center}
        .cols{display:flex;gap:16px}.cols>div{flex:1}
    </style></head><body>
        <h1>تقرير البوفيه المفتوح — ${escapeHtml(report.date)}</h1>
        <h2>مطاعم الشرفه العالمي — أُنشئ في ${new Date(report.generated_at).toLocaleString('ar-EG')}</h2>
        ${renderBuffetReportHtml(report, { forPrint: true })}
    </body></html>`);
    doc.close();
    frame.onload = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
        setTimeout(() => frame.remove(), 2000);
    };
}

window.buffetRecallHeld = async (id) => {
    await recallHeldOrder(id);
    if (buffetInvTab === 'held') {await refreshBuffetInvoices();}
};
window.buffetDeleteHeld = async (id) => {
    await deleteHeldOrder(id);
    if (buffetInvTab === 'held') {await refreshBuffetInvoices();}
};

function addToCart(productId) {
    const product = products.find((entry) => entry.id === productId);
    if (!product) {return;}

    const existing = cart.find((item) => item.product_id === productId);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({
            product_id: product.id,
            name: product.name_ar,
            barcode: product.barcode,
            unit_price: Number(product.price),
            quantity: 1,
            discount: 0,
            vat_rate: Number(product.vat_rate || 15),
        });
    }

    renderCart();
    showToast(`أضيف: ${product.name_ar}`, 'success');
}

function changeQty(index, delta) {
    if (!cart[index]) {return;}
    cart[index].quantity = Number(cart[index].quantity || 0) + delta;
    if (cart[index].quantity <= 0) {
        cart.splice(index, 1);
    }
    renderCart();
}

function removeFromCart(index) {
    cart.splice(index, 1);
    renderCart();
}

window.changeQty = changeQty;
window.removeFromCart = removeFromCart;

function clearCart() {
    if (!cart.length) {return;}
    if (!confirm('هل تريد تفريغ السلة؟')) {return;}
    cart = [];
    resetCartDiscount();
    clearPayments();
    renderCart();
    showToast('تم تفريغ السلة', 'info');
}

async function loadDepartments() {
    departments = await api('/api/pos/departments');
    const shiftSelect = $('#department-select');
    const catalogSelect = $('#catalog-department');

    shiftSelect.innerHTML = departments.map((dept) => `<option value="${dept.id}">${escapeHtml(dept.name_ar)}</option>`).join('');
    catalogSelect.innerHTML = `<option value="">كل الأقسام / عام</option>${departments.map((dept) => `<option value="${dept.id}">${escapeHtml(dept.name_ar)}</option>`).join('')}`;
}

function setActiveShiftUI(shift) {
    if (!shift) {return;}
    activeShift = shift;
    const deptId = Number(shift.department_id);
    const department = departments.find(entry => Number(entry.id) === deptId);
    if (department) {$('#department-select').value = String(deptId);}
    $('#resume-shift-btn')?.classList.remove('hidden');
    $('#new-shift-btn')?.classList.toggle('hidden', !isManagerRole());
    const info = $('#active-shift-info');
    if (info) {
        info.textContent = `وردية مفتوحة بالفعل في ${shift.dept_name || department?.name_ar || 'القسم المحدد'} — يمكنك المتابعة دون فتح وردية جديدة.`;
        info.classList.remove('hidden');
    }
}

async function loadActiveShift() {
    try {
        const shift = await api('/api/pos/shifts/active');
        setActiveShiftUI(shift);
        return shift;
    } catch (err) {
        if (err.status !== 404) {console.warn('Active shift lookup failed:', err);}
        activeShift = null;
        $('#resume-shift-btn')?.classList.add('hidden');
        $('#new-shift-btn')?.classList.add('hidden');
        $('#active-shift-info')?.classList.add('hidden');
        return null;
    }
}

async function resumeActiveShift() {
    const shift = activeShift || await loadActiveShift();
    if (!shift) {return;}
    currentSession = { ...shift, session_id: Number(shift.id) };
    currentDepartment = { id: Number(shift.department_id), name: shift.dept_name || departments.find(entry => Number(entry.id) === Number(shift.department_id))?.name_ar || '—' };
    $('#pos-cashier-name').textContent = currentUser.name;
    $('#pos-dept-name').textContent = currentDepartment.name;
    $('#pos-session-id').textContent = `وردية #${currentSession.session_id}`;
    const buffetModeResume = isOpenBuffetDepartment();
    $('#catalog-btn').classList.toggle('hidden', !isManagerRole());
    $('#day-close-btn').classList.toggle('hidden', !isManagerRole());
    $('#buffet-prices-btn').classList.toggle('hidden', !(isManagerRole() && buffetModeResume));
    $('#buffet-invoices-btn').classList.toggle('hidden', !buffetModeResume);
    $('#buffet-report-btn').classList.toggle('hidden', !buffetModeResume);
    resetCatalogForm();
    await refreshPosData({ silent: true });
    showScreen('pos-screen');
    renderCart();
    showToast(`تمت متابعة وردية ${currentDepartment.name}`, 'success');
}

async function loadProducts() {
    if (isOpenBuffetDepartment()) {
        buffetConfig = await api('/api/pos/buffet/config');
        products = (buffetConfig.tiers || []).map(normalizeProduct).filter((product) => product.is_active !== false);
        categories = ['all'];
        $('#buffet-party-row')?.classList.remove('hidden');
        renderBuffetPeople();
        renderCart();
        startBuffetLiveTimer();
        updateOverviewStats();
        return;
    }
    $('#buffet-party-row')?.classList.add('hidden');
    stopBuffetLiveTimer();
    const query = new URLSearchParams({ department_id: currentDepartment.id });
    const result = await api(`/api/pos/products?${query.toString()}`);
    products = result.map(normalizeProduct).filter((product) => product.is_active);
    categories = ['all', ...new Set(products.map((product) => product.category).filter(Boolean))];
    renderCategories();
    renderProducts($('#product-search').value);
    updateOverviewStats();
}

async function loadCatalogProducts() {
    if (!isManagerRole()) {return;}
    const query = new URLSearchParams({ include_inactive: 'true' });
    const result = await api(`/api/pos/products?${query.toString()}`);
    catalogProducts = result.map(normalizeProduct);
    renderCatalogProducts($('#catalog-search').value);
}

async function loadHeldOrders() {
    if (!currentSession?.session_id) {return;}
    const query = new URLSearchParams({ session_id: String(currentSession.session_id) });
    heldOrders = await api(`/api/pos/held-orders?${query.toString()}`);
    updateOverviewStats();
}

async function refreshPosData({ silent = false } = {}) {
    if (!currentDepartment || !currentSession) {return;}
    if (!silent) {showLoading('جارٍ تحديث بيانات الكاشير...');}
    try {
        await Promise.all([
            loadProducts(),
            loadHeldOrders(),
            isManagerRole() ? loadCatalogProducts() : Promise.resolve(),
        ]);
        showToast('تم تحديث البيانات من قاعدة البيانات', 'success');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل تحديث البيانات', 'error');
    } finally {
        if (!silent) {hideLoading();}
    }
}

function renderHeldOrders() {
    const list = $('#held-orders-list');
    if (!heldOrders.length) {
        list.innerHTML = `<div class="held-orders-empty">
            <div class="pos-empty-icon"><i class=ji data-i=clipboard-list></i></div>
            <div>لا توجد طلبات معلقة</div>
        </div>`;
        return;
    }

    list.innerHTML = heldOrders.map((order) => `
        <div class="held-order-card">
            <div class="header">
                <span class="order-id">طلب #${String(order.id).slice(0, 8)}</span>
                <span class="order-time"><i class=ji data-i=alarm></i> ${new Date(order.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div class="order-items">${escapeHtml(order.items_preview || 'بدون تفاصيل')}</div>
            <div class="order-total">${fmtMoney(order.total_amount)} ${CURRENCY}</div>
            <div class="held-order-actions">
                <button class="modal-btn primary modal-btn-block" onclick="recallHeldOrder('${order.id}')">استرجاع</button>
                <button class="modal-btn danger modal-btn-block" onclick="deleteHeldOrder('${order.id}')">حذف</button>
            </div>
        </div>
    `).join('');
}

async function holdCurrentOrder() {
    if (!cart.length) {return;}

    showLoading('جارٍ حفظ الطلب المعلق...');
    try {
        const payload = {
            session_id: currentSession.session_id,
            department_id: currentDepartment.id,
            items: cart.map((item) => ({
                product_id: item.product_id,
                quantity: Number(item.quantity),
                unit_price: Number(item.unit_price),
                discount: Number(item.discount || 0),
            })),
            cart_discount: cartDiscount.type ? { ...cartDiscount } : null,
        };

        await api('/api/pos/held-orders', {
            method: 'POST',
            body: JSON.stringify(payload),
        });

        cart = [];
        resetCartDiscount();
        clearPayments();
        renderCart();
        await loadHeldOrders();
        showToast('تم حفظ الطلب المعلق في قاعدة البيانات', 'success');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل تعليق الطلب', 'error');
    } finally {
        hideLoading();
    }
}

async function recallHeldOrder(id) {
    if (cart.length > 0 && !confirm('السلة الحالية غير فارغة. هل تريد استبدالها بالطلب المعلق؟')) {return;}

    showLoading('جارٍ استرجاع الطلب المعلق...');
    try {
        const result = await api(`/api/pos/held-orders/${id}/recall`, {
            method: 'POST',
            body: JSON.stringify({ session_id: currentSession.session_id }),
        });

        cart = result.items.map((item) => ({
            product_id: Number(item.product_id),
            name: item.name,
            barcode: item.barcode,
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price),
            discount: Number(item.discount || 0),
            vat_rate: Number(item.vat_rate || 15),
        }));
        // Restore the saved cart-level discount — the server round-trips it,
        // but recall used to wipe it, silently overcharging the customer
        cartDiscount = (result.cart_discount && result.cart_discount.type)
            ? { type: result.cart_discount.type, value: Number(result.cart_discount.value || 0) }
            : { type: null, value: 0 };
        clearPayments();
        renderCart();
        await loadHeldOrders();
        hideModal('held-orders-modal');
        showToast('تم استرجاع الطلب المعلق', 'success');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل استرجاع الطلب', 'error');
    } finally {
        hideLoading();
    }
}

async function deleteHeldOrder(id) {
    if (!confirm('حذف هذا الطلب المعلق؟')) {return;}
    showLoading('جارٍ حذف الطلب المعلق...');
    try {
        await api(`/api/pos/held-orders/${id}?session_id=${currentSession.session_id}`, {
            method: 'DELETE',
        });
        await loadHeldOrders();
        renderHeldOrders();
        showToast('تم حذف الطلب المعلق', 'info');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل حذف الطلب', 'error');
    } finally {
        hideLoading();
    }
}

window.recallHeldOrder = recallHeldOrder;
window.deleteHeldOrder = deleteHeldOrder;

function renderCatalogProducts(filter = '') {
    const tbody = $('#catalog-products-list');
    if (!tbody) {return;}

    const search = String(filter || '').trim().toLowerCase();
    const filtered = catalogProducts.filter((product) => {
        return !search
            || (product.name_ar || '').toLowerCase().includes(search)
            || (product.barcode || '').toLowerCase().includes(search)
            || (product.category || '').toLowerCase().includes(search);
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="pos-empty-cell">لا توجد أصناف</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((product) => `
        <tr data-id="${product.id}">
            <td>
                <div class="catalog-main-name">${escapeHtml(product.name_ar)}</div>
                <div class="catalog-subline">${escapeHtml(product.barcode || product.category || '—')}</div>
            </td>
            <td>${fmtMoney(product.price)}</td>
            <td>${fmtQty(product.stock_quantity)}</td>
            <td>${product.is_active ? '<span class="status-pill active">نشط</span>' : '<span class="status-pill inactive">معطل</span>'}</td>
            <td><button class="catalog-edit-btn" data-id="${product.id}">تعديل</button></td>
        </tr>
    `).join('');

    $$('.catalog-edit-btn').forEach((button) => {
        button.addEventListener('click', () => {
            const product = catalogProducts.find((entry) => entry.id === Number(button.dataset.id));
            if (product) {fillCatalogForm(product);}
        });
    });
}

function renderRecipeIngredients() {
    const container = $('#recipe-ingredients-list');
    if (!container) {return;}
    if (!recipeIngredients.length) {
        container.innerHTML = '<div class="ingredient-empty">لا توجد مكونات مرتبطة — أضف مكونات الطبق من المخزون.</div>';
        return;
    }
    container.innerHTML = recipeIngredients.map((item, index) => `
        <div class="recipe-ingredient-row" data-index="${index}">
            <div><div class="ingredient-name">${escapeHtml(item.inventory_name || item.name || 'مكون')}</div><div class="ingredient-meta">المتاح: ${fmtQty(item.available_qty || 0)} ${escapeHtml(item.inventory_unit || item.unit || '')}</div></div>
            <input type="number" class="recipe-qty" min="0.0001" step="0.0001" value="${Number(item.quantity_per_unit || 0)}" aria-label="كمية المكون">
            <span class="ingredient-meta">${escapeHtml(item.unit || item.inventory_unit || 'وحدة')}</span>
            <button type="button" class="recipe-remove-btn" onclick="removeRecipeIngredient(${index})" aria-label="حذف المكون"><i class=ji data-i=x></i></button>
        </div>
    `).join('');
    $$('.recipe-qty').forEach((input) => input.addEventListener('change', (event) => {
        const row = event.target.closest('.recipe-ingredient-row');
        const index = Number(row?.dataset.index);
        if (Number.isInteger(index) && recipeIngredients[index]) {recipeIngredients[index].quantity_per_unit = Number(event.target.value) || 0;}
    }));
}

function renderInventoryIngredientOptions() {
    const select = $('#recipe-inventory-select');
    if (!select) {return;}
    const selected = new Set(recipeIngredients.map(item => Number(item.inventory_id)));
    select.innerHTML = '<option value="">اختر مكوناً من المخزون</option>' + inventoryIngredients
        .filter(item => !selected.has(Number(item.id)))
        .map(item => `<option value="${item.id}">${escapeHtml(item.name)} — ${escapeHtml(item.category || '')} (${escapeHtml(item.unit || '')})</option>`)
        .join('');
}

function removeRecipeIngredient(index) {
    recipeIngredients.splice(index, 1);
    renderRecipeIngredients();
    renderInventoryIngredientOptions();
}
window.removeRecipeIngredient = removeRecipeIngredient;

async function loadInventoryIngredients() {
    if (!isManagerRole()) {return;}
    inventoryIngredients = await api('/api/pos/ingredients');
    renderInventoryIngredientOptions();
}

async function loadProductIngredients(productId) {
    recipeIngredients = await api(`/api/pos/products/${productId}/ingredients`);
    $('#recipe-editor')?.classList.remove('hidden');
    renderRecipeIngredients();
    renderInventoryIngredientOptions();
}

async function saveProductIngredients(productId) {
    if (!productId) {return;}
    const rows = $$('.recipe-ingredient-row');
    rows.forEach((row, index) => {
        if (recipeIngredients[index]) {recipeIngredients[index].quantity_per_unit = Number(row.querySelector('.recipe-qty')?.value || 0);}
    });
    const invalid = recipeIngredients.some(item => !Number(item.quantity_per_unit) || Number(item.quantity_per_unit) <= 0);
    if (invalid) {throw new Error('كل كميات مكونات الوصفة يجب أن تكون أكبر من صفر');}
    await api(`/api/pos/products/${productId}/ingredients`, {
        method: 'PUT',
        body: JSON.stringify({ ingredients: recipeIngredients.map(item => ({ inventory_id: Number(item.inventory_id), quantity_per_unit: Number(item.quantity_per_unit), unit: item.unit || item.inventory_unit || 'وحدة', waste_percent: Number(item.waste_percent || 0), notes: item.notes || null })) }),
    });
}

function renderProductImagePreview() {
    const preview = $('#catalog-image-preview');
    const removeButton = $('#catalog-image-remove');
    if (!preview) {return;}
    if (currentProductImageUrl) {
        preview.innerHTML = `<img src="${escapeHtml(currentProductImageUrl)}" alt="صورة الصنف الحالية">`;
        removeButton?.classList.remove('hidden');
    } else {
        preview.textContent = 'لا توجد صورة';
        removeButton?.classList.add('hidden');
    }
}

async function uploadCatalogImage() {
    const id = $('#catalog-product-id')?.value;
    const file = $('#catalog-image')?.files?.[0];
    if (!id) { $('#catalog-error').textContent = 'احفظ الصنف أولاً ثم ارفع الصورة'; return; }
    if (!file) { $('#catalog-error').textContent = 'اختر صورة للصنف أولاً'; return; }
    const form = new FormData();
    form.append('image', file);
    showLoading('جارٍ رفع صورة الصنف...');
    try {
        const res = await fetch(`/api/pos/products/${id}/image`, {
            method: 'POST',
            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(posAppKeyGet() ? { 'x-api-key': posAppKeyGet() } : {}) },
            body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {throw Object.assign(new Error(data.message || data.error || 'فشل رفع الصورة'), { response: data });}
        currentProductImageUrl = data.image_url;
        renderProductImagePreview();
        $('#catalog-image').value = '';
        await Promise.all([loadProducts(), loadCatalogProducts()]);
        showToast('تم رفع صورة الصنف وحفظها في قاعدة البيانات', 'success');
    } catch (err) {
        $('#catalog-error').textContent = err.response?.message || err.message || 'فشل رفع الصورة';
    } finally { hideLoading(); }
}

async function removeCatalogImage() {
    const id = $('#catalog-product-id')?.value;
    if (!id || !currentProductImageUrl || !confirm('حذف صورة هذا الصنف؟')) {return;}
    showLoading('جارٍ حذف صورة الصنف...');
    try {
        await api(`/api/pos/products/${id}/image`, { method: 'DELETE' });
        currentProductImageUrl = null;
        renderProductImagePreview();
        await Promise.all([loadProducts(), loadCatalogProducts()]);
        showToast('تم حذف صورة الصنف', 'info');
    } catch (err) {
        $('#catalog-error').textContent = err.response?.message || err.message || 'فشل حذف الصورة';
    } finally { hideLoading(); }
}

function resetCatalogForm() {
    currentProductImageUrl = null;
    $('#catalog-image') && ($('#catalog-image').value = '');
    renderProductImagePreview();
    recipeIngredients = [];
    $('#recipe-editor')?.classList.add('hidden');
    renderRecipeIngredients();
    renderInventoryIngredientOptions();
    $('#catalog-product-id').value = '';
    $('#catalog-name').value = '';
    $('#catalog-category').value = '';
    $('#catalog-barcode').value = '';
    $('#catalog-unit').value = 'قطعة';
    $('#catalog-price').value = '';
    $('#catalog-cost-price').value = '';
    $('#catalog-stock').value = '0';
    $('#catalog-min-stock').value = '0';
    $('#catalog-vat').value = '15';
    Array.from($('#catalog-department').options).forEach((option) => { option.selected = currentDepartment?.id ? Number(option.value) === Number(currentDepartment.id) : option.value === ''; });
    $('#catalog-active').checked = true;
    $('#catalog-error').textContent = '';
    $('#catalog-archive-btn').disabled = true;
}

function fillCatalogForm(product) {
    $('#catalog-product-id').value = String(product.id);
    $('#catalog-name').value = product.name_ar || '';
    $('#catalog-category').value = product.category || '';
    $('#catalog-barcode').value = product.barcode || '';
    $('#catalog-unit').value = product.unit || 'قطعة';
    $('#catalog-price').value = product.price;
    currentProductImageUrl = product.image_url || null;
    renderProductImagePreview();
    $('#catalog-cost-price').value = product.cost_price ?? '';
    $('#catalog-stock').value = product.stock_quantity ?? 0;
    $('#catalog-min-stock').value = product.min_stock_level ?? 0;
    loadProductIngredients(product.id).catch((error) => {
        $('#catalog-error').textContent = error.response?.message || error.message || 'فشل تحميل مكونات الوصفة';
    });
    $('#catalog-vat').value = product.vat_rate ?? 15;
    const productDepartments = Array.isArray(product.department_ids) && product.department_ids.length ? product.department_ids.map(Number) : (product.department_id ? [Number(product.department_id)] : []);
    Array.from($('#catalog-department').options).forEach((option) => { option.selected = option.value === '' ? productDepartments.length === 0 : productDepartments.includes(Number(option.value)); });
    $('#catalog-active').checked = Boolean(product.is_active);
    $('#catalog-error').textContent = '';
    $('#catalog-archive-btn').disabled = false;
}

function collectCatalogPayload() {
    return {
        name_ar: $('#catalog-name').value.trim(),
        category: $('#catalog-category').value.trim() || null,
        barcode: $('#catalog-barcode').value.trim() || null,
        unit: $('#catalog-unit').value.trim() || 'قطعة',
        price: parseFloat($('#catalog-price').value) || 0,
        cost_price: $('#catalog-cost-price').value === '' ? null : (parseFloat($('#catalog-cost-price').value) || 0),
        stock_quantity: parseFloat($('#catalog-stock').value) || 0,
        min_stock_level: parseFloat($('#catalog-min-stock').value) || 0,
        vat_rate: parseFloat($('#catalog-vat').value) || 15,
        department_ids: Array.from($('#catalog-department').selectedOptions).map((option) => Number(option.value)).filter((id) => Number.isInteger(id) && id > 0),
        department_id: Array.from($('#catalog-department').selectedOptions).map((option) => Number(option.value)).find((id) => Number.isInteger(id) && id > 0) ?? null,
        is_active: $('#catalog-active').checked,
    };
}

async function saveCatalogProduct(event) {
    event.preventDefault();
    $('#catalog-error').textContent = '';
    const id = $('#catalog-product-id').value;
    const payload = collectCatalogPayload();

    if (!payload.name_ar) {
        $('#catalog-error').textContent = 'اسم الصنف مطلوب';
        return;
    }

    showLoading(id ? 'جارٍ تحديث الصنف...' : 'جارٍ إضافة الصنف...');
    try {
        if (id) {
            await api(`/api/pos/products/${id}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
            await saveProductIngredients(id);
            showToast('تم تحديث الصنف والوصفة في قاعدة البيانات', 'success');
        } else {
            await api('/api/pos/products', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            showToast('تمت إضافة الصنف إلى منيو الكاشير', 'success');
        }

        await Promise.all([loadProducts(), loadCatalogProducts()]);
        resetCatalogForm();
    } catch (err) {
        $('#catalog-error').textContent = err.response?.message || err.message || 'فشل حفظ الصنف';
    } finally {
        hideLoading();
    }
}

async function archiveCatalogProduct() {
    const id = $('#catalog-product-id').value;
    if (!id) {return;}
    if (!confirm('تعطيل هذا الصنف من الكاشير؟')) {return;}

    showLoading('جارٍ تعطيل الصنف...');
    try {
        await api(`/api/pos/products/${id}`, {
            method: 'DELETE',
        });
        await Promise.all([loadProducts(), loadCatalogProducts()]);
        resetCatalogForm();
        showToast('تم تعطيل الصنف', 'info');
    } catch (err) {
        $('#catalog-error').textContent = err.response?.message || err.message || 'فشل تعطيل الصنف';
    } finally {
        hideLoading();
    }
}

function showReceipt(result) {
    // Buffet invoices: show a PERSONS summary (guest tiers) instead of the
    // plain totals-only block — mirrors the custom printed buffet receipt
    const buffet = result.buffet || null;
    const buffetHtml = buffet ? `
        <div class="r-buffet-banner"><i class=ji data-i=users></i> بوفيه مفتوح — الفوترة بعدد الأشخاص</div>
        ${result.party_name ? `<div class="row"><span>العائلة/المناسبة:</span><strong>${escapeHtml(result.party_name)}</strong></div>` : ''}
        <div class="r-persons">
            ${(buffet.tiers || []).map((t) => `
                <div class="r-person-row">
                    <span class="tname">${escapeHtml(t.name || '—')}</span>
                    <span class="tcount">${fmtQty(t.persons)} فرد</span>
                    <span class="tamount">${Number(t.unit_price) > 0 ? `${fmtMoney(t.amount)} ${CURRENCY}` : 'مجاناً'}</span>
                </div>`).join('') || '<div class="r-person-row"><span class="tname">—</span></div>'}
            <div class="r-person-total"><span>إجمالي عدد الأشخاص</span><strong>${fmtQty(buffet.persons_total)} فرد</strong></div>
        </div>` : '';
    $('#receipt-info').innerHTML = `
        ${buffetHtml}
        <div class="row"><span>رقم الفاتورة:</span><strong>#${result.invoice_counter}</strong></div>
        <div class="row"><span>UUID:</span><strong style="font-size:10px">${String(result.invoice_uuid).slice(0, 18)}…</strong></div>
        <div class="row"><span>الإجمالي:</span><strong>${fmtMoney(result.total_amount)} ${CURRENCY}</strong></div>
        <div class="row"><span>المدفوع:</span><strong>${fmtMoney(result.paid)} ${CURRENCY}</strong></div>
        <div class="row"><span>الباقي:</span><strong>${fmtMoney(result.change)} ${CURRENCY}</strong></div>
        <div class="row"><span>الطباعة:</span><strong>${result.print_job_id ? '<i class=ji data-i=check></i> في الطابور' : '—'}</strong></div>
        <div class="row"><span>ZATCA:</span><strong>${result.zatca_queued ? '<i class=ji data-i=check></i> في الطابور' : '—'}</strong></div>
        ${kotReceiptHtml(result)}
    `;
    if (result.qr_payload) {
        // qr_payload is base64 of the raw ZATCA TLV byte string — NOT a PNG.
        // Rendering it directly as an <img> produced a broken image; encode a
        // real scannable QR with the bundled qrcode lib (same as index.html).
        if (typeof QRCode !== 'undefined' && typeof QRCode.toDataURL === 'function') {
            QRCode.toDataURL(result.qr_payload, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
                .then((url) => { $('#receipt-qr').src = url; })
                .catch(() => {});
        } else {
            $('#receipt-qr').src = `data:image/png;base64,${result.qr_payload}`;
        }
    }
    showModal('receipt-modal');
}

// ─── Kitchen Order Tickets (KOT) ─────────────────────────────────────────
// The sale response lists the thermal tickets queued for each production
// department (no prices on kitchen tickets). One click opens the printable
// RTL ticket page for the kitchen tablet.
function kotReceiptHtml(result) {
    const jobs = Array.isArray(result.kot_jobs) ? result.kot_jobs : [];
    if (!result.kot_enabled) {return '<div class="row"><span>تذاكر المطبخ:</span><strong>موقوفة من الضبط</strong></div>';}
    if (!jobs.length) {return '<div class="row"><span>تذاكر المطبخ:</span><strong>— لا أصناف تجهيز</strong></div>';}
    const depts = [...new Set(jobs.map((j) => j.department_name))].join('، ');
    return `
        <div class="row"><span>تذاكر المطبخ:</span><strong><i class=ji data-i=check></i> ${jobs.length} — ${escapeHtml(depts)}</strong></div>
        <div class="row"><span></span><strong><a href="#" onclick="openKotHtml('${String(result.order_id)}');return false" style="color:#d4a843;text-decoration:underline">فتح تذاكر المطبخ للطباعة</a></strong></div>`;
}
async function openKotHtml(orderId) {
    try {
        const res = await fetch(`/api/pos/kot/orders/${orderId}/html`, {
            headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(posAppKeyGet() ? { 'x-api-key': posAppKeyGet() } : {}) },
        });
        if (!res.ok) {throw new Error('تعذر فتح تذاكر المطبخ');}
        const html = await res.text();
        const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
        (window.openInAppReport ? window.openInAppReport('إيصال', url) : window.open(url, '_blank'));
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
        showToast(e.message || 'تعذر فتح تذاكر المطبخ', 'error');
    }
}
window.openKotHtml = openKotHtml;

async function completeSale() {
    if (completeSale._busy) {return;}
    completeSale._busy = true;
    const btn = $('#complete-sale-btn');
    const btnHtml = btn ? btn.innerHTML : '';
    if (btn) {btn.disabled = true; btn.innerHTML = 'جارٍ إتمام البيع...';}
    $('#sale-error').textContent = '';
    const totals = calculateTotals();
    const items = totals.items.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.final_discount,
    }));
    const payments = [];

    const cash = parseAmount($('#pay-cash').value);
    const card = parseAmount($('#pay-card').value);
    const wallet = parseAmount($('#pay-wallet').value);
    const bank = parseAmount($('#pay-bank').value);
    if (cash > 0) {payments.push({ method: 'cash', amount: cash });}
    if (card > 0) {payments.push({ method: 'card', amount: card, reference: $('#pay-card-ref').value.trim() || null });}
    if (wallet > 0) {payments.push({ method: 'wallet', amount: wallet, reference: $('#pay-wallet-ref').value.trim() || null });}
    if (bank > 0) {payments.push({ method: 'bank_transfer', amount: bank, reference: $('#pay-bank-ref').value.trim() || null });}

    // حماية من الضعف accidental: تنبيه قبل إتمام دفعة زائدة
    const paidSum = cash + card + wallet + bank;
    if (paidSum - totals.total > 0.01) {
        const ok = confirm(`المدفوع (${fmtMoney(paidSum)} ${CURRENCY}) يزيد عن الإجمالي (${fmtMoney(totals.total)} ${CURRENCY}) — الباقي للعميل ${fmtMoney(paidSum - totals.total)}. متابعة؟`);
        if (!ok) {return;}
    }

    showLoading('جارٍ إتمام البيع...');
    try {
        // مفتاح ثابت لمحتوى السلة: الضغط المزدوج أو إعادة المحاولة بعد انقطاع
        // تُدمج في فاتورة واحدة عبر Idempotency في الخادم — لا فواتير مكررة أبدًا.
        const idemKey = `sale-${currentSession.session_id}-${posCartHash(totals, payments)}`;
        const result = await api('/api/sales/complete', {
            method: 'POST',
            idempotencyKey: idemKey,
            headers: {
                'X-Shift-Session-Id': String(currentSession.session_id),
            },
            body: JSON.stringify({
                department_id: currentDepartment.id,
                items,
                payments,
                printer_id: `pos-${currentDepartment.id}`,
                notes: isOpenBuffetDepartment() ? ($('#buffet-party-name')?.value.trim() || null) : null,
            }),
        });

        showReceipt(result);
        cart = [];
        if ($('#buffet-party-name')) {$('#buffet-party-name').value = '';}
        resetCartDiscount();
        clearPayments();
        renderCart();
        await refreshPosData({ silent: true });
        if (isOpenBuffetDepartment()) { loadBuffetLive().catch(() => {}); loadHeldOrders().catch(() => {}); }
        showToast('تم إتمام البيع وربطه بقاعدة البيانات بنجاح', 'success');
    } catch (err) {
        $('#sale-error').textContent = err.response?.message || err.message || 'فشل إتمام البيع';
        showToast('فشل إتمام البيع', 'error');
    } finally {
        hideLoading();
        completeSale._busy = false;
        if (btn) {btn.innerHTML = btnHtml;}
        renderCart();
    }
}
// بصمة محتوى السلة (djb2) — أي تغيير في الأصناف/الكميات/الدفع = مفتاح جديد.
function posCartHash(totals, payments) {
    const s = JSON.stringify([
        (totals.items || []).map((i) => [i.product_id, i.quantity, i.unit_price, i.final_discount]),
        (payments || []).map((p) => [p.method, p.amount, p.reference || '']),
        totals.total,
    ]);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;}
    return h.toString(36);
}

async function openShift({ newSession = false } = {}) {
    $('#shift-open-error').textContent = '';
    showLoading('جارٍ فتح الوردية...');
    try {
        const result = await api('/api/pos/shifts/open', {
            method: 'POST',
                body: JSON.stringify({
                department_id: parseInt($('#department-select').value, 10),
                opening_balance: parseFloat($('#opening-balance').value) || 0,
                new_session: newSession,
            }),
        });

        currentSession = result;
        activeShift = { id: Number(result.session_id), session_id: Number(result.session_id), department_id: Number($('#department-select').value), dept_name: $('#department-select').options[$('#department-select').selectedIndex]?.text || '—' };
        const selectedOption = $('#department-select').options[$('#department-select').selectedIndex];
        currentDepartment = {
            id: parseInt($('#department-select').value, 10),
            name: selectedOption?.text || '—',
        };

        $('#pos-cashier-name').textContent = currentUser.name;
        $('#pos-dept-name').textContent = currentDepartment.name;
        $('#pos-session-id').textContent = `وردية #${result.session_id}`;
        const buffetModeOpen = isOpenBuffetDepartment();
$('#catalog-btn').classList.toggle('hidden', !isManagerRole()); $('#day-close-btn').classList.toggle('hidden', !isManagerRole());
        $('#buffet-prices-btn').classList.toggle('hidden', !(isManagerRole() && buffetModeOpen));
        $('#buffet-invoices-btn').classList.toggle('hidden', !buffetModeOpen);
        $('#buffet-report-btn').classList.toggle('hidden', !buffetModeOpen);
        resetCatalogForm();

        await refreshPosData({ silent: true });
        showScreen('pos-screen');
        renderCart();
        showToast(`مرحبًا ${currentUser.name} — الوردية مفتوحة`, 'success');
    } catch (err) {
        if (err.response?.error === 'SHIFT_ALREADY_OPEN') {
            await loadActiveShift();
            $('#shift-open-error').textContent = 'لديك وردية مفتوحة بالفعل. استخدم زر متابعة الوردية الحالية.';
        } else {
            $('#shift-open-error').textContent = err.response?.message || err.message || 'فشل فتح الوردية';
        }
    } finally {
        hideLoading();
    }
}

async function closeShiftSummary() {
    if (!currentSession) {return;}
    showLoading('جارٍ تحميل ملخص الوردية...');
    try {
        const summary = await api(`/api/pos/shifts/${currentSession.session_id}/summary`);
        $('#close-shift-summary').innerHTML = `
            <div class="row"><span>المتوقع:</span><strong>${fmtMoney(summary.expected_cash)} ${CURRENCY}</strong></div>
            <div class="row"><span>مبيعات نقدية:</span><strong>${fmtMoney(summary.cash_in)} ${CURRENCY}</strong></div>
            <div class="row"><span>مبيعات بطاقة:</span><strong>${fmtMoney(summary.card_in)} ${CURRENCY}</strong></div>
            <div class="row"><span>مبيعات محفظة:</span><strong>${fmtMoney(summary.wallet_in)} ${CURRENCY}</strong></div>
            <div class="row"><span>عدد الفواتير:</span><strong>${summary.invoice_count}</strong></div>
        `;
        $('#actual-cash').value = summary.expected_cash;
        $('#close-notes').value = '';
        $('#confirm-close-shift').disabled = false;
        $('#cancel-close-shift').textContent = 'إلغاء';
        showModal('close-shift-modal');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل تحميل ملخص الوردية', 'error');
    } finally {
        hideLoading();
    }
}

async function confirmCloseShift() {
    showLoading('جارٍ إغلاق الوردية...');
    try {
        const result = await api(`/api/pos/shifts/${currentSession.session_id}/close`, {
            method: 'POST',
            body: JSON.stringify({
                actual_cash: parseFloat($('#actual-cash').value) || 0,
                notes: $('#close-notes').value.trim() || null,
            }),
        });

        const variance = Number(result.cash_variance);
        const varianceLabel = variance >= 0
            ? `<span class="variance-positive">+${fmtMoney(variance)} (زيادة)</span>`
            : `<span class="variance-negative">${fmtMoney(variance)} (عجز)</span>`;

        $('#close-shift-summary').innerHTML = `
            <div class="row"><span>الحالة:</span><strong class="c-green"><i class=ji data-i=check></i> مغلقة</strong></div>
            <div class="row"><span>المتوقع:</span><strong>${fmtMoney(result.expected_cash)} ${CURRENCY}</strong></div>
            <div class="row"><span>الفعلي:</span><strong>${fmtMoney(result.actual_cash)} ${CURRENCY}</strong></div>
            <div class="row"><span>الفرق:</span><strong>${varianceLabel}</strong></div>
        `;
        $('#confirm-close-shift').disabled = true;
        $('#cancel-close-shift').textContent = 'خروج';
        showToast(`تم إغلاق الوردية. الفرق: ${fmtMoney(variance)} ${CURRENCY}`, variance === 0 ? 'success' : 'warning');

        setTimeout(() => {
            currentSession = null;
            currentDepartment = null;
            products = [];
            heldOrders = [];
            cart = [];
            resetCartDiscount();
            clearPayments();
            hideModal('close-shift-modal');
            stopBuffetLiveTimer();
            buffetLive = null;
            showScreen('shift-open-screen');
        }, 2500);
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل إغلاق الوردية', 'error');
    } finally {
        hideLoading();
    }
}

let dayCloseData = null;
async function openDayClose() {
    if (!isManagerRole()) {return;}
    showLoading('جارٍ تحميل حالة اليوم...');
    try {
        const st = await api('/api/pos/day-close/status');
        dayCloseData = st;
        if (st.existing_z) {
            $('#day-close-body').innerHTML = `<div class="row"><span>الحالة:</span><strong class="c-green">مقفل ✓ (${escapeHtml(st.existing_z.z_number)})</strong></div>
            <div class="row"><span>صافي الفرق:</span><strong>${fmtMoney(st.existing_z.total_variance)} ${CURRENCY}</strong></div>`;
            $('#confirm-day-close').disabled = true;
        } else if (!st.open.length && !st.closed.length) {
            $('#day-close-body').innerHTML = '<div class="row"><span>لا توجد ورديات في هذا اليوم.</span></div>';
            $('#confirm-day-close').disabled = true;
        } else {
            // SECURITY: أسماء الكاشيرين والأقسام إدخال بشري — تُهرَّب قبل innerHTML
            const rows = st.open.map(s => `<div class="row"><span>وردية #${Number(s.id)} — ${escapeHtml(s.cashier_name || '')} (${escapeHtml(s.dept_name || '')})</span>
                <input type="number" id="dc-actual-${Number(s.id)}" min="0" step="0.01" placeholder="الجرد الفعلي" style="width:130px"></div>`).join('')
                + st.closed.map(s => `<div class="row"><span>وردية #${s.id} — مغلقة ✓ (فرق ${fmtMoney(s.cash_variance)})</span></div>`).join('')
                + (st.stale_open.length ? `<div class="row" style="color:var(--red)"><span>⚠ ${Number(st.stale_open.length)} وردية عالقة من أيام سابقة — تُقفل من صفحتها.</span></div>` : '');
            $('#day-close-body').innerHTML = `<div class="row"><span>التاريخ:</span><strong>${escapeHtml(st.date)}</strong></div>${rows}
            <label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" id="dc-manager-approve"> <span>اعتماد مدير للفروقات فوق العتبة (${Number(st.threshold)})</span></label>`;
            $('#confirm-day-close').disabled = false;
        }
        showModal('day-close-modal');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل تحميل حالة اليوم', 'error');
    } finally {
        hideLoading();
    }
}

async function confirmDayClose() {
    if (!dayCloseData || !isManagerRole()) {return;}
    const counts = {};
    for (const s of dayCloseData.open) {
        const v = parseFloat(document.getElementById(`dc-actual-${s.id}`)?.value);
        if (!Number.isFinite(v) || v < 0) { showToast(`أدخل الجرد الفعلي للوردية #${s.id}`, 'error'); return; }
        counts[String(s.id)] = v;
    }
    if (!confirm(`تنفيذ الإقفال اليومي ${dayCloseData.date}؟ سيُغلق اليوم برقم Z ويُرحّل الفرق للدفتر.`)) {return;}
    showLoading('جارٍ تنفيذ الإقفال اليومي...');
    try {
        const r = await api('/api/pos/day-close', {
            method: 'POST',
            body: JSON.stringify({ date: dayCloseData.date, counts, manager_approve: document.getElementById('dc-manager-approve')?.checked === true }),
        });
        $('#day-close-body').innerHTML = `
            <div class="row"><span>رقم الإقفال:</span><strong class="c-green">${r.z.z_number} ✓</strong></div>
            <div class="row"><span>المتوقع:</span><strong>${fmtMoney(r.z.total_expected)} ${CURRENCY}</strong></div>
            <div class="row"><span>الفعلي:</span><strong>${fmtMoney(r.z.total_actual)} ${CURRENCY}</strong></div>
            <div class="row"><span>صافي الفرق:</span><strong>${fmtMoney(r.z.total_variance)} ${CURRENCY}</strong></div>
            <div class="row"><span>الفواتير:</span><strong>${r.invoices}</strong></div>
            <div class="row"><span>القيد:</span><strong>${r.journal ? r.journal.entry_no : 'لا فرق — بلا قيد'}</strong></div>`;
        $('#confirm-day-close').disabled = true;
        showToast(`تم الإقفال ${r.z.z_number}`, 'success');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل الإقفال', 'error');
    } finally {
        hideLoading();
    }
}

$('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('#login-error').textContent = '';
    showLoading('جارٍ تسجيل الدخول...');
    try {
        let result = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({
                username: $('#username').value.trim(),
                password: $('#password').value.trim(),
            }),
        });

        if (result.password_change_required) {
            result = await completeRequiredPasswordChange(result, $('#password').value);
            showToast('تم تغيير كلمة المرور بنجاح.', 'success');
        }
        accessToken = result.access_token;
        if (result.app_key) {posAppKeySet(result.app_key);}
        if (result.refresh_token) {posRTset(result.refresh_token);}
        currentUser = result.user;
        $('#cashier-name').textContent = currentUser.name;
        await loadDepartments();
        await loadActiveShift();
        showScreen('shift-open-screen');
    } catch (err) {
        $('#login-error').textContent = err.response?.message || err.message || 'فشل تسجيل الدخول. تحقق من البيانات.';
    } finally {
        hideLoading();
    }
});

// ─── استعادة كلمة المرور الذاتية (رمز لمرة واحدة يصدره المدير) ──────────────
$('#forgot-link').addEventListener('click', (event) => {
    event.preventDefault();
    $('#fp-error').textContent = '';
    showModal('forgot-password-modal');
    setTimeout(() => $('#fp-username')?.focus(), 80);
});
$('#fp-cancel').addEventListener('click', () => hideModal('forgot-password-modal'));
$('#fp-submit').addEventListener('click', async () => {
    $('#fp-error').textContent = '';
    const username = $('#fp-username').value.trim();
    const code = $('#fp-code').value.trim();
    const newPassword = $('#fp-new').value;
    const confirmPassword = $('#fp-new2').value;
    if (!username || !code || !newPassword) { $('#fp-error').textContent = 'أكمل اسم المستخدم والرمز وكلمة المرور الجديدة.'; return; }
    if (!/^\d{6}$/.test(code)) { $('#fp-error').textContent = 'الرمز يتكون من 6 أرقام.'; return; }
    if (newPassword !== confirmPassword) { $('#fp-error').textContent = 'كلمتا المرور غير متطابقتين.'; return; }
    if (newPassword.length < 12 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        $('#fp-error').textContent = 'يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل وتحتوي حروفًا وأرقامًا.';
        return;
    }
    showLoading('جارٍ تغيير كلمة المرور...');
    try {
        const result = await api('/api/auth/forgot-password/reset', {
            method: 'POST',
            body: JSON.stringify({ username, code, new_password: newPassword }),
        });
        hideModal('forgot-password-modal');
        $('#forgot-password-modal').querySelectorAll('input').forEach((el) => (el.value = ''));
        showToast(result.message || 'تم تغيير كلمة المرور بنجاح — سجّل الدخول بكلمة المرور الجديدة.', 'success');
        showScreen('login-screen');
    } catch (err) {
        $('#fp-error').textContent = err.response?.message || err.message || 'تعذر تغيير كلمة المرور — تحقق من الرمز.';
    } finally {
        hideLoading();
    }
});

// ─── تغيير كلمة المرور الطوعي (للمسجلين — زر القفل في الشريط العلوي) ─────────
$('#change-password-btn').addEventListener('click', () => {
    $('#cp-error').textContent = '';
    showModal('change-password-modal');
    setTimeout(() => $('#cp-current')?.focus(), 80);
});
$('#cp-cancel').addEventListener('click', () => hideModal('change-password-modal'));
$('#cp-submit').addEventListener('click', async () => {
    $('#cp-error').textContent = '';
    const currentPassword = $('#cp-current').value;
    const newPassword = $('#cp-new').value;
    const confirmPassword = $('#cp-new2').value;
    if (!currentPassword || !newPassword) { $('#cp-error').textContent = 'أدخل كلمة المرور الحالية والجديدة.'; return; }
    if (newPassword !== confirmPassword) { $('#cp-error').textContent = 'كلمتا المرور غير متطابقتين.'; return; }
    if (newPassword.length < 12 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
        $('#cp-error').textContent = 'يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل وتحتوي حروفًا وأرقامًا.';
        return;
    }
    if (currentPassword === newPassword) { $('#cp-error').textContent = 'اختر كلمة مرور جديدة مختلفة عن الحالية.'; return; }
    showLoading('جارٍ تغيير كلمة المرور...');
    try {
        const result = await api('/api/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
        });
        accessToken = result.access_token;
        if (result.app_key) {posAppKeySet(result.app_key);}
        if (result.refresh_token) {posRTset(result.refresh_token);}
        hideModal('change-password-modal');
        $('#change-password-modal').querySelectorAll('input').forEach((el) => (el.value = ''));
        showToast('تم تغيير كلمة المرور بنجاح.', 'success');
    } catch (err) {
        $('#cp-error').textContent = err.response?.message || err.message || 'تعذر تغيير كلمة المرور.';
    } finally {
        hideLoading();
    }
});

$('#open-shift-btn').addEventListener('click', () => openShift());
$('#resume-shift-btn').addEventListener('click', resumeActiveShift);
$('#new-shift-btn').addEventListener('click', () => {
    if (!confirm('سيتم فتح جلسة جديدة للمدير مع بقاء الجلسة الحالية مفتوحة. هل تريد المتابعة؟')) {return;}
    openShift({ newSession: true });
});
$('#clear-cart-btn').addEventListener('click', clearCart);
$('#mobile-cart-toggle').addEventListener('click', toggleMobileCart);
$('#hold-order-btn').addEventListener('click', holdCurrentOrder);
$('#held-orders-btn').addEventListener('click', async () => {
    await loadHeldOrders();
    renderHeldOrders();
    showModal('held-orders-modal');
});
$('#close-held-orders-btn').addEventListener('click', () => hideModal('held-orders-modal'));
$('#orders-history-btn').addEventListener('click', async () => {
    if (window.POS_ORDERS) {await POS_ORDERS.show();}
});

$('#discount-btn').addEventListener('click', () => showModal('discount-modal'));
$$('.discount-option').forEach((button) => {
    button.addEventListener('click', () => {
        $$('.discount-option').forEach((entry) => entry.classList.remove('active'));
        button.classList.add('active');
        $('#custom-discount').value = '';
    });
});
$('#apply-discount-btn').addEventListener('click', () => {
    const active = $('.discount-option.active');
    const customValue = parseFloat($('#custom-discount').value);
    if (customValue > 0) {
        cartDiscount = { type: 'fixed', value: customValue };
    } else if (active) {
        cartDiscount = { type: 'percent', value: parseFloat(active.dataset.value) || 0 };
    } else {
        showToast('اختر نسبة خصم أو أدخل مبلغًا', 'warning');
        return;
    }
    hideModal('discount-modal');
    renderCart();
    showToast('تم تطبيق الخصم', 'success');
});
$('#remove-discount-btn').addEventListener('click', () => {
    resetCartDiscount();
    $$('.discount-option').forEach((entry) => entry.classList.remove('active'));
    $('#custom-discount').value = '';
    hideModal('discount-modal');
    renderCart();
    showToast('تم إزالة الخصم', 'info');
});
$('#cancel-discount-btn').addEventListener('click', () => hideModal('discount-modal'));

['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'].forEach((id) => {
    $('#' + id).addEventListener('input', updatePaymentTotal);
});
$$('.quick-cash-btn').forEach((button) => {
    button.addEventListener('click', () => {
        const total = calculateTotals().total;
        if (button.dataset.amount === 'exact') {
            $('#pay-cash').value = total.toFixed(2);
        } else {
            const current = parseAmount($('#pay-cash').value);
            $('#pay-cash').value = (current + parseAmount(button.dataset.amount)).toFixed(2);
        }
        updatePaymentTotal();
    });
});

// زر "الباقي" لكل طريقة دفع: يملأ المتبقي من الإجمالي بعد الطرق الأخرى
document.addEventListener('click', (event) => {
    const btn = event.target.closest?.('.pay-remaining-btn');
    if (!btn) {return;}
    const target = document.getElementById(btn.dataset.target);
    if (!target) {return;}
    const total = calculateTotals().total;
    const ids = ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'];
    const others = ids.filter((id) => id !== btn.dataset.target)
        .reduce((s, id) => s + parseAmount(document.getElementById(id)?.value), 0);
    target.value = Math.max(0, total - others).toFixed(2);
    updatePaymentTotal();
});

$('#complete-sale-btn').addEventListener('click', completeSale);
$('#new-sale-btn').addEventListener('click', () => hideModal('receipt-modal'));
$('#print-receipt-btn').addEventListener('click', () => {
    showToast('تم إرسال الإيصال إلى طابور الطباعة', 'info');
    hideModal('receipt-modal');
});

$('#close-shift-btn').addEventListener('click', closeShiftSummary); $('#day-close-btn').addEventListener('click', openDayClose); $('#cancel-day-close').addEventListener('click', () => hideModal('day-close-modal')); $('#confirm-day-close').addEventListener('click', confirmDayClose);
$('#cancel-close-shift').addEventListener('click', () => hideModal('close-shift-modal'));
$('#buffet-prices-btn').addEventListener('click', openBuffetPrices);
$('#save-buffet-prices').addEventListener('click', saveBuffetPrices);
$('#cancel-buffet-prices').addEventListener('click', () => hideModal('buffet-prices-modal'));
$('#buffet-add-tier-btn').addEventListener('click', addBuffetTier);
$('#buffet-invoices-btn').addEventListener('click', openBuffetInvoices);
$('#buffet-invoices-refresh').addEventListener('click', refreshBuffetInvoices);
$('#close-buffet-invoices').addEventListener('click', () => hideModal('buffet-invoices-modal'));
$$('.buffet-inv-tab').forEach((tab) => tab.addEventListener('click', async () => {
    buffetInvTab = tab.dataset.tab;
    $$('.buffet-inv-tab').forEach((entry) => entry.classList.toggle('active', entry === tab));
    await refreshBuffetInvoices();
}));
$('#buffet-report-btn').addEventListener('click', openBuffetReport);
$('#buffet-report-load').addEventListener('click', loadBuffetReport);
$('#buffet-report-print').addEventListener('click', printBuffetReport);
$('#close-buffet-report').addEventListener('click', () => hideModal('buffet-report-modal'));
$('#confirm-close-shift').addEventListener('click', confirmCloseShift);

$('#refresh-products-btn').addEventListener('click', () => refreshPosData());
$('#product-search').addEventListener('input', (event) => renderProducts(event.target.value));
$('#product-search').addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {return;}
    const term = event.target.value.trim();
    if (!term) {return;}
    const exact = products.find((product) => String(product.barcode || '').trim() === term);
    if (exact) {
        event.preventDefault();
        addToCart(exact.id);
        event.target.select();
    }
});

$('#catalog-btn').addEventListener('click', async () => {
    if (!isManagerRole()) {return;}
    showLoading('جارٍ تحميل كتالوج الأصناف...');
    try {
        await Promise.all([loadCatalogProducts(), loadInventoryIngredients()]);
        if (!$('#catalog-product-id').value) {resetCatalogForm();}
        showModal('catalog-modal');
    } catch (err) {
        showToast(err.response?.message || err.message || 'فشل تحميل الكتالوج', 'error');
    } finally {
        hideLoading();
    }
});
$('#catalog-search').addEventListener('input', (event) => renderCatalogProducts(event.target.value));
$('#catalog-refresh-btn').addEventListener('click', async () => {
    await Promise.all([loadCatalogProducts(), loadInventoryIngredients()]);
});
$('#recipe-add-btn').addEventListener('click', () => {
    const inventoryId = Number($('#recipe-inventory-select').value);
    const item = inventoryIngredients.find(entry => Number(entry.id) === inventoryId);
    const quantity = Number($('#recipe-ingredient-qty').value);
    if (!item || !quantity || quantity <= 0) {
        $('#catalog-error').textContent = 'اختر مكوناً وأدخل كمية صحيحة لكل طبق';
        return;
    }
    recipeIngredients.push({ inventory_id: item.id, inventory_name: item.name, inventory_unit: item.unit, unit: item.unit, quantity_per_unit: quantity, waste_percent: 0 });
    $('#recipe-ingredient-qty').value = '';
    $('#catalog-error').textContent = '';
    renderRecipeIngredients();
    renderInventoryIngredientOptions();
});
$('#catalog-new-btn').addEventListener('click', resetCatalogForm);
$('#catalog-form').addEventListener('submit', saveCatalogProduct);
$('#catalog-archive-btn').addEventListener('click', archiveCatalogProduct);
$('#catalog-reset-btn').addEventListener('click', resetCatalogForm);
$('#catalog-image-upload').addEventListener('click', uploadCatalogImage);
$('#catalog-image-remove').addEventListener('click', removeCatalogImage);
$('#catalog-close-btn').addEventListener('click', () => hideModal('catalog-modal'));

// ─── USB barcode scanner mode: keystrokes faster than any human typing ───
// يعمل من أي مكان في شاشة الكاشير عدا حقول الإدخال (لمنع التقاط المبالغ المدخلة).
// القارئ يكتب 4+ محارف بمتوسط أقل من 60ms ثم Enter — أي إدخال أبطأ يُتجاهل بأمان.
const _scanBuf = { text: '', last: 0, started: 0 };
function posBarcodeScan(event) {
    try {
        if ($('#pos-screen')?.classList.contains('hidden')) {_scanBuf.text = ''; return;}
        const ae = document.activeElement;
        const typingField = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.id !== 'product-search';
        if (event.key === 'Escape') {_scanBuf.text = ''; return;}
        if (typingField) {_scanBuf.text = ''; return;}
        if (document.querySelector('.modal:not(.hidden)')) {_scanBuf.text = ''; return;}
        if (event.key === 'Enter') {
            const code = _scanBuf.text;
            _scanBuf.text = '';
            if (code.length >= 4) {
                const avg = (performance.now() - _scanBuf.started) / code.length;
                if (avg < 60) {
                    event.preventDefault();
                    const exact = (typeof products !== 'undefined' ? products : []).find((p) => String(p.barcode || '').trim() === code.trim());
                    if (exact && typeof addToCart === 'function') {addToCart(exact.id); showToast(`تمت إضافة ${exact.name}`, 'success');}
                    else {showToast(`باركود غير مسجل: ${code}`, 'error');}
                }
            }
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = performance.now();
            if (now - _scanBuf.last > 90 || _scanBuf.text.length >= 64) {_scanBuf.text = ''; _scanBuf.started = now;}
            _scanBuf.last = now;
            _scanBuf.text += event.key;
        }
    } catch (_) {}
}

document.addEventListener('keydown', (event) => {
    posBarcodeScan(event);
    if (event.key === 'F1') {
        event.preventDefault();
        $('#product-search').focus();
    }
    if (event.key === 'F2' && !$('#complete-sale-btn').disabled) {
        event.preventDefault();
        $('#complete-sale-btn').click();
    }
    if (event.key === 'F3' && !$('#hold-order-btn').disabled) {
        event.preventDefault();
        $('#hold-order-btn').click();
    }
    if (event.key === 'F4' && !$('#clear-cart-btn').disabled) {
        event.preventDefault();
        $('#clear-cart-btn').click();
    }
    if (event.key === 'F9') {
        event.preventDefault();
        $('#close-shift-btn').click();
    }
    if (event.key === 'Escape') {
        $$('.modal').forEach((modal) => modal.classList.add('hidden'));
    }
});

showScreen('login-screen');
posPwaOfflineBar();
resetCatalogForm();
clearPayments();
renderCart();
// جلسة مفتوحة: استعادة صامتة إن وُجد رمز تحديث محفوظ
(async () => {
    try {
        if (posRTget() && !accessToken) {
            showLoading('جارٍ استعادة الجلسة...');
            try {
                if (await posRefreshSession()) {
                    $('#cashier-name').textContent = (currentUser && currentUser.name) || '';
                    await loadDepartments();
                    await loadActiveShift();
                    showScreen('shift-open-screen');
                }
            } finally { hideLoading(); }
        }
    } catch (_) { /* يبقى على شاشة الدخول */ }
})();

// ─── الاتصال اللحظي: تحديث الكاشير تلقائيًا بلا ريفريش ───
let posRtTimer = null;
let posRtBusy = false;
let posRtPending = false;
const POS_RT_ENTITIES = new Set(['posProducts', 'recipes', 'inventory', 'departments', 'posOrders', 'revenues']);
function posRtSetLive(online) {
    const el = document.getElementById('pos-live');
    if (!el) {return;}
    el.classList.toggle('offline', !online);
    const txt = document.getElementById('pos-live-txt');
    if (txt) {txt.textContent = online ? 'مباشر' : 'غير متصل';}
}
async function posRtRefresh() {
    if (posRtBusy) { posRtPending = true; return; }
    if (!currentDepartment || !currentSession) {return;}
    posRtBusy = true;
    try { await refreshPosData({ silent: true }); }
    catch (_) { /* صامت — المحاولة القادمة */ }
    finally {
        posRtBusy = false;
        if (posRtPending) { posRtPending = false; posRtRefresh(); }
    }
}
function posRtSchedule() {
    if (document.hidden) { posRtPending = true; return; }
    clearTimeout(posRtTimer);
    posRtTimer = setTimeout(posRtRefresh, 600);
}
function initPosRealtime() {
    if (typeof io === 'undefined') {return;}
    try {
        // Single socket per tab (TASK 6): reuse the main realtime socket when it
        // is already connected — a second connection doubles presence counts,
        // ping traffic, and breaks the chat once-guard via window._rtSocket.
        const shared = window._rtSocket;
        const useShared = shared && shared.connected;
        const ua = navigator.userAgent || '';
        const dev = /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows PC' : 'كاشير';
        const socket = useShared ? shared : io(window.location.origin, {
            query: { deviceName: `كاشير POS (${dev})` },
            auth: window._jwt ? { token: window._jwt } : {},
            transports: ['websocket', 'polling'],
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1500,
            reconnectionDelayMax: 30000,
            randomizationFactor: 0.5,
            timeout: 10000,
        });
        if (!useShared) {window._rtSocket = socket;}
        const markLive = () => posRtSetLive(true);
        if (useShared && socket.connected) {markLive();}
        else {socket.on('connect', markLive);}
        socket.on('disconnect', () => posRtSetLive(false));
        socket.on('reconnect_failed', () => posRtSetLive(false));
        socket.on('entity_changed', (data) => {
            if (data && data.entity && !POS_RT_ENTITIES.has(data.entity)) {return;}
            posRtSchedule();
        });
        socket.on('sale:completed', () => {
            posRtSchedule();
            try { if (window.POS_ORDERS && typeof window.POS_ORDERS.onRealtimeSale === 'function') {window.POS_ORDERS.onRealtimeSale();} } catch (_) {}
        });
        socket.on('state_updated', posRtSchedule);
        try { socket.on('domain_event', () => posRtSchedule()); } catch (_) {}
    } catch (_) { /* وضع عدم الاتصال — يعمل يدويًا */ }
}
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && posRtPending) { posRtPending = false; posRtSchedule(); }
});
initPosRealtime();
