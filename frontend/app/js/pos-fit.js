/* ═══════════════════════════════════════════════════════════════════
   KARIM ERP — pos-fit.js · «شاشة واحدة بلا تمرير»
   ─────────────────────────────────────────────────────────────────
   لا يعيد هذا الملف رسم أي شيء: يلفّ renderProducts/renderCart في pos.js
   ويضيف طبقة ترقيم صفحات (pager) بحيث لا يخرج أي صنف أو سطر سلة عن
   المساحة المتاحة — فلا يظهر شريط تمرير في أي مكان.

   العقد:
   • لا يغيّر أي id أو بنية DOM يقرأها pos.js.
   • يُخفى الزائد عبر class واحد: .pos-page-off (CSS: display:none).
   • كل الأصناف تبقى في DOM (باركود/بحث/اختبار المخزون تعمل كما هي).
   • يتوقف تلقائيًا في وضع البوفيه (بطاقات قليلة + بطاقة عنوان).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const grid = document.getElementById('products-grid');
    const cartList = document.getElementById('cart-items');
    if (!grid) { return; }

    const el = (id) => document.getElementById(id);
    const pager = el('pos-pager');
    const pagerRange = el('pos-pager-range');
    const pagerPage = el('pos-pager-page');
    const pagerPrev = el('pos-page-prev');
    const pagerNext = el('pos-page-next');
    const cartPager = el('cart-pager');
    const cartPagerPage = el('cart-pager-page');
    const cartPagerPrev = el('cart-page-prev');
    const cartPagerNext = el('cart-page-next');

    const state = {
        productPage: 0,
        cartPage: 0,
        productPer: 0,
        cartPer: 0,
        cartRowH: 34,
        lastCartLen: 0,
        rows: 0,
        cols: 1,
    };

    let scheduled = false;
    let flipTimer = null;

    const num = (value, fallback) => {
        const n = parseFloat(value);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    };

    // ── قياس سعة شبكة الأصناف من الهندسة الفعلية ──
    function measureGrid() {
        if (!grid.clientHeight) { return null; }
        const cs = getComputedStyle(grid);
        const gap = num(cs.rowGap, 8);
        const minRow = num(getComputedStyle(document.documentElement).getPropertyValue('--posfit-min-row'), 92);
        const rows = Math.max(1, Math.floor((grid.clientHeight + gap) / (minRow + gap)));
        const cols = (cs.gridTemplateColumns || '')
            .split(' ')
            .filter((track) => track && track !== 'none').length || 1;
        state.rows = rows;
        state.cols = cols;
        grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        return { rows, cols, per: rows * cols };
    }

    function flashFlip() {
        grid.classList.add('pos-page-flip');
        if (flipTimer) { clearTimeout(flipTimer); }
        flipTimer = setTimeout(() => grid.classList.remove('pos-page-flip'), 220);
    }

    // ── ترقيم الأصناف ──
    function applyProducts(animate) {
        const cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
        const buffet = grid.querySelector('.buffet-mode-header');

        if (buffet) {
            grid.classList.add('is-free');
            grid.style.gridTemplateRows = '';
            cards.forEach((card) => card.classList.remove('pos-page-off'));
            if (pager) { pager.classList.add('hidden'); }
            return;
        }
        grid.classList.remove('is-free');

        if (!cards.length) {
            if (pager) { pager.classList.add('hidden'); }
            return;
        }

        // الشريط يبقى ظاهرًا دائمًا مع بطاقات (معلومة «1–40 من 40») — نظهره
        // قبل القياس كي لا يقتطع ظهوره صفًا من السعة الفعلية.
        if (pager) { pager.classList.remove('hidden'); }
        const measured = measureGrid();
        if (!measured) { return; }

        const per = measured.per;
        const pages = Math.max(1, Math.ceil(cards.length / per));
        state.productPage = Math.min(Math.max(0, state.productPage), pages - 1);
        const start = state.productPage * per;
        const end = Math.min(cards.length, start + per);

        cards.forEach((card, index) => {
            card.classList.toggle('pos-page-off', index < start || index >= end);
        });

        if (pagerRange) {
            pagerRange.textContent = `${start + 1}–${end} من ${cards.length} صنف`;
        }
        if (pagerPage) {
            pagerPage.textContent = `صفحة ${state.productPage + 1} من ${pages}`;
        }
        if (pagerPrev) { pagerPrev.disabled = state.productPage <= 0; }
        if (pagerNext) { pagerNext.disabled = state.productPage >= pages - 1; }
        if (animate && pages > 1) { flashFlip(); }
    }

    // ── ترقيم السلة ──
    function cartCapacity() {
        if (!cartList || !cartList.clientHeight) { return 0; }
        return Math.max(1, Math.floor(cartList.clientHeight / state.cartRowH));
    }

    function applyCart(animate) {
        if (!cartList) { return; }
        const items = Array.prototype.slice.call(cartList.querySelectorAll('.cart-item'));
        if (!items.length) {
            if (cartPager) { cartPager.classList.add('hidden'); }
            state.cartPage = 0;
            return;
        }

        const measured = items[0].getBoundingClientRect().height;
        if (measured > 0) { state.cartRowH = measured; }

        // تمريرة أولى: بلا شريط صفحات (أكبر سعة) — ثم نقرر هل نحتاجه.
        if (cartPager) { cartPager.classList.add('hidden'); }
        let per = cartCapacity();
        if (!per) { return; }

        const pages = Math.max(1, Math.ceil(items.length / per));
        if (pages > 1 && cartPager) {
            cartPager.classList.remove('hidden');
            per = cartCapacity() || per;
        }

        const finalPages = Math.max(1, Math.ceil(items.length / per));
        state.cartPage = Math.min(Math.max(0, state.cartPage), finalPages - 1);
        // الصفحة الأخيرة تُملأ من النهاية: لا فراغ أسفل السلة مع بقاء أحدث صنف ظاهرًا.
        let start = state.cartPage * per;
        if (state.cartPage === finalPages - 1 && items.length >= per) {
            start = items.length - per;
        }
        const end = Math.min(items.length, start + per);

        items.forEach((item, index) => {
            item.classList.toggle('pos-page-off', index < start || index >= end);
        });

        if (cartPagerPage) { cartPagerPage.textContent = `صفحة ${state.cartPage + 1} من ${finalPages}`; }
        if (cartPagerPrev) { cartPagerPrev.disabled = state.cartPage <= 0; }
        if (cartPagerNext) { cartPagerNext.disabled = state.cartPage >= finalPages - 1; }
        if (animate && finalPages > 1) { flashFlip(); }
    }

    function applyAll(animate) {
        applyProducts(animate);
        applyCart(animate);
    }

    function schedule(animate) {
        if (scheduled) { return; }
        scheduled = true;
        // setTimeout لا rAF: يعمل أيضًا في تبويب/إطار غير مرئي (اختبارات آلية،
        // شاشة ثانية) بلا تعليق التنفيذ — والتكلفة سطر واحد لكل تغيير.
        setTimeout(() => {
            scheduled = false;
            applyAll(animate);
        }, 16);
    }

    // ── حقول المبالغ نصية (inputmode=decimal) لعرض أرقام لاتينية دائمًا:
    //    Chrome يعرض أرقام input[type=number] بالأرقام الهندية في مستند عربي.
    ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank'].forEach((id) => {
        const field = el(id);
        if (!field) { return; }
        field.addEventListener('beforeinput', (event) => {
            if (event.data && /[^\d.,٠-٩]/.test(event.data)) { event.preventDefault(); }
        });
        field.addEventListener('input', () => {
            const cleaned = field.value.replace(/[^\d.,٠-٩]/g, '');
            if (cleaned === field.value) { return; }
            field.value = cleaned;
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });

    // ── ربط الأزرار ──
    if (pagerPrev) {
        pagerPrev.addEventListener('click', () => {
            if (state.productPage > 0) { state.productPage -= 1; applyProducts(true); }
        });
    }
    if (pagerNext) {
        pagerNext.addEventListener('click', () => {
            state.productPage += 1;
            applyProducts(true);
        });
    }
    if (cartPagerPrev) {
        cartPagerPrev.addEventListener('click', () => {
            if (state.cartPage > 0) { state.cartPage -= 1; applyCart(true); }
        });
    }
    if (cartPagerNext) {
        cartPagerNext.addEventListener('click', () => {
            state.cartPage += 1;
            applyCart(true);
        });
    }

    // ── لفّ دوال pos.js (نفس الربط العام — تُستدعى داخليًا أيضًا) ──
    const originalRenderProducts = window.renderProducts;
    if (typeof originalRenderProducts === 'function') {
        window.renderProducts = function () {
            state.productPage = 0;
            const result = originalRenderProducts.apply(this, arguments);
            schedule(false);
            return result;
        };
    }

    const originalRenderCart = window.renderCart;
    if (typeof originalRenderCart === 'function') {
        window.renderCart = function () {
            const result = originalRenderCart.apply(this, arguments);
            const len = Number(cart.length) || 0;
            if (state.lastCartLen > 0 && len > state.lastCartLen) {
                // صنف جديد: أظهر صفحته بدل إبقاء المستخدم في صفحة قديمة
                state.cartPage = Number.MAX_SAFE_INTEGER;
                applyCart(false);
            } else {
                schedule(false);
            }
            state.lastCartLen = len;
            return result;
        };
    }

    const originalShowScreen = window.showScreen;
    if (typeof originalShowScreen === 'function') {
        window.showScreen = function (id) {
            const result = originalShowScreen.apply(this, arguments);
            if (id === 'pos-screen') { schedule(false); }
            return result;
        };
    }

    // ── إعادة الحساب عند أي تغيّر في الهندسة أو المحتوى ──
    if (typeof ResizeObserver === 'function') {
        const observer = new ResizeObserver(() => schedule(false));
        observer.observe(grid);
        if (cartList) { observer.observe(cartList); }
        const section = document.querySelector('.products-section');
        if (section) { observer.observe(section); }
    }

    if (typeof MutationObserver === 'function') {
        // البوفيه يعيد بناء الشبكة مباشرة — نعيد التطبيق عندها.
        new MutationObserver(() => schedule(false)).observe(grid, { childList: true });
    }

    window.addEventListener('resize', () => schedule(false), { passive: true });
    window.addEventListener('orientationchange', () => schedule(false), { passive: true });
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => schedule(false)).catch(() => {});
    }

    applyAll(false);
    // أول ظهور للشاشة يأتي بعد جلب البيانات — نلتقطه بأمان.
    setTimeout(() => schedule(false), 60);
    setTimeout(() => schedule(false), 400);
})();
