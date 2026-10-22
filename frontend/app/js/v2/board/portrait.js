/**
 * V2 — Portrait board renderer · راسم لوحة المنيو للبورتريه (البند ٨)
 * ═══════════════════════════════════════════════════════════════════════════
 * No network here (boot.js owns that), no fixed canvas and no transform
 * scale. Two numbers drive everything and both are MEASURED from the live
 * screen, never assumed:
 *   1. band  — height/width → structural variant (see erp-board.css)
 *   2. capacity — how many items actually fit at readable size
 * The old board cut pages at a hardcoded 10 because 1080×1920 always gave
 * 5 rows × 2 columns. Here a 768×1024 panel can legitimately get 4×2 and a
 * 1080×2400 totem 8×2, and nothing is ever clipped or letterboxed: pages are
 * re-cut when the window changes, and a fit-verify pass catches any page that
 * still overflows.
 *
 * The buffet is the owner's exception (2026-10-16: «كله في صفحة واحدة»): one
 * fixed composition, never cut into pages — the fit-verify shrinks that page's
 * own type ramp (--bf-scale) instead of hiding a dish.
 *
 * Text is written with textContent only — menu names are operator input and
 * never parsed as HTML.
 */

import {
    PERIODS, PERIOD_NAMES, DWELL_CURRENT_MS,
    bilingual, buildPages, buildWeeklyPages, catEn, catTitleEn, cyclePlan, dominantIndex,
    isBuffetEnabled, buffetPage, BUFFET_SECTIONS, periodAtMinute, scheduleStarts, aspectBand, columnsForBand,
    capacityForBox, comfortRowHeight, rowsForBox, buffetPriceParts,
} from './board-data.js?v=4.9.194';

const ITEM_PROBE = 'صنف تجريبي للقياس';
const PROBE_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const MAX_FIT_PASSES = 8;
/** أرضية المقياس: تحتها يصير النص أصغر من مقروءية شاشة على بُعد أمتار. */
const MIN_BF_SCALE = 0.55;
/** هامش أمان للقياس التقريبي: ‎max(px,…)‎ في الـCSS ليس خطيًا تمامًا. */
const BF_FUDGE = 0.97;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {node.className = className;}
    if (text !== undefined && text !== null) {node.textContent = String(text);}
    return node;
}

/** Only same-origin or explicit image URLs reach an <img src>. */
function safeImage(value) {
    const s = String(value || '').trim();
    if (!s || s.startsWith('//')) { return null; }
    return /^(\/|https?:\/\/|data:image\/)/i.test(s) ? s : null;
}

export function mountPortraitBoard(refs, opts = {}) {
    const language0 = opts.language === 'en' ? 'en' : 'ar';
    let language = language0;
    let board = null;
    let pages = [];
    let buffet = [];
    let isBuffet = false;
    let index = 0;
    let period = null;
    let timer = null;
    let resizeTimer = null;
    let destroyed = false;

    const stage = refs.stage;
    const measurer = el('div', 'kb-page is-active kb-measure');
    /** طبقة قياس صفحة البوفيه: ملحقةٌ بالمسرح كي تُحلّ ‎cqmin‎ على ‎#board‎ فعلًا. */
    const bfProbe = el('div', 'kb-measure kb-bf-probe');

    function t(ar, en) { return language === 'en' ? en : ar; }

    /* ─── القياس ─────────────────────────────────────────────────────────── */
    function box() {
        const r = stage.getBoundingClientRect();
        return { width: r.width, height: r.height };
    }

    /** The physical screen the board fills — `#board` is fixed inset:0. */
    function viewport() {
        const r = refs.board.getBoundingClientRect();
        return { width: r.width || window.innerWidth, height: r.height || window.innerHeight };
    }

    /** لا بطاقة تُقصّ إلى شرريط: أرضية الراحة محسوبة من الشاشة نفسها. */
    function comfortRowH() {
        const v = viewport();
        return comfortRowHeight(Math.min(v.width, v.height));
    }

    /**
     * One probe card tells us the row height the stylesheet will actually use
     * at this screen size; rowsForBox turns that plus the free height into a
     * page capacity. Nothing about the canvas is assumed.
     *
     * The band is the shape of the whole screen, not of the stage slot: the
     * stage is a flex cell whose own ratio depends on chrome height, and
     * classing 1080×2400 as "wide" because its cell measured 1080×2100 would
     * silently downgrade the totem variant.
     *
     * The card is measured standalone at its real column width, never inside
     * a probe grid row: a grid row sized by content resolves the column to
     * its *min-content* contribution first, and with `overflow-wrap: anywhere`
     * that crushed the text column to 48px on a 2160-wide screen — the card
     * then "measured" ~1200px tall and capacity collapsed to one row. The
     * grid is still mounted, but only to read the gaps from CSS itself.
     */
    function measureCapacity() {
        const b = box();
        const band = aspectBand(viewport().width, viewport().height);
        const cols = columnsForBand(band, b.width);
        refs.board.dataset.ar = band;
        stage.appendChild(measurer);

        const grid = el('div', 'kb-grid');
        grid.style.setProperty('--cols', String(cols));
        measurer.appendChild(grid);
        const gcs = getComputedStyle(grid);
        const gap = parseFloat(gcs.rowGap) || 0;
        const colGap = parseFloat(gcs.columnGap) || gap;
        const cardW = Math.max(1, (b.width - colGap * (cols - 1)) / cols);
        measurer.removeChild(grid);

        const probe = itemNode({ primary: ITEM_PROBE, secondary: 'Probe row', price: 999, soldOut: false, image: PROBE_PIXEL }, 0);
        probe.style.width = `${cardW}px`;
        probe.style.flex = '0 0 auto';
        /* رأس الصفحة يستهلك من الارتفاع قبل الشبكة — يُقاس ولا يُقدَّر */
        const head = headerNode(ITEM_PROBE, 'PROBE', null, false);
        measurer.appendChild(head);
        measurer.appendChild(probe);
        const itemH = probe.getBoundingClientRect().height;
        const headH = head.getBoundingClientRect().height;
        const pageGap = parseFloat(getComputedStyle(measurer).rowGap) || 0;
        measurer.innerHTML = '';
        stage.removeChild(measurer);

        const free = { height: Math.max(0, b.height - headH - pageGap), itemHeight: Math.max(itemH, comfortRowH()), gap };
        const rows = rowsForBox(free);
        const key = `${Math.round(b.width)}x${Math.round(b.height)}:${band}`;
        if (key !== lastBoxKey) { lastBoxKey = key; fitCeiling = Infinity; fitPasses = 0; }
        const capacity = Math.max(2, Math.min(capacityForBox(free, cols), fitCeiling));
        return { band, cols, rows: Math.min(rows, Math.max(1, Math.ceil(capacity / cols))), capacity };
    }

    /**
     * صفحة البوفيه واحدة ثابتة التكوين (قرار المالك: «كله في صفحة واحدة»)،
     * فليس فيها سعة تُقطَع بل مقياسٌ يصغُر: الارتفاع الطبيعي للتكوين يُقاس
     * على العقدة *الملحقة* بالطبقة المخفية نسبةً إلى المسرح، والمقياس
     * المحلي ‎--bf-scale‎ يُضرب فيه. الخطأ الذي كان: القراءة من أصولٍ مبتورة
     * (صفحة لم تُدبَّس قطّ) فتعطي صفرًا فينهار كل شيء — هنا العقدة الملحقة
     * هي المقروءة، و‎cqmin‎ يُحلّ على ‎#board‎ لا على الطبقة.
     * التقدير تقريبي لأن ‎max(px,…)‎ ليس خطيًا؛ ‎verifyFit‎ يهذّبه على
     * المرئي فعليًا بعد الرسم (وبعد وصول الخطوط في إعادة القياس الثانية).
     */
    function fitBuffetScale(model) {
        stage.appendChild(bfProbe);
        bfProbe.innerHTML = '';
        const node = buffetNode(model, 1);
        bfProbe.appendChild(node);
        const available = box().height;
        const need = node.getBoundingClientRect().height;
        bfProbe.innerHTML = '';
        stage.removeChild(bfProbe);
        if (!(available > 0) || !(need > 0) || !Number.isFinite(need)) { return 1; }
        return Math.max(MIN_BF_SCALE, Math.min(1, (available / need) * BF_FUDGE));
    }

    /**
     * التحقق الأخير على المرئي فعليًا: التصنيفات تُنقص سعةً وتُعاد قصّتها،
     * والبوفيه يُنقص مقياسه المحلي — الحرس واحد: لا صنف خلف الحافة.
     */
    function verifyFit() {
        fitFrame = null;
        if (destroyed) { return; }
        const active = stage.querySelector('.kb-page.is-active');
        if (!active) { return; }
        refs.board.classList.add('kb-quiet');
        const over = active.scrollHeight - stage.clientHeight;
        refs.board.classList.remove('kb-quiet');
        if (over <= 1 || fitPasses >= MAX_FIT_PASSES) { return; }
        fitPasses += 1;
        if (isBuffet) {
            const next = Math.round(Math.max(MIN_BF_SCALE, bfScale * 0.9) * 1000) / 1000;
            if (next === bfScale) { return; }
            bfScale = next;
            Array.from(stage.querySelectorAll('.kb-bf')).forEach((node) => {
                node.style.setProperty('--bf-scale', String(bfScale));
            });
            fitFrame = requestAnimationFrame(verifyFit);
            return;
        }
        if (m_.capacity <= 2) { return; }
        fitCeiling = Math.max(2, m_.capacity - m_.cols);
        rebuild();
    }

    /** Does this rendered page fit without clipping? (fit-verify pass) */
    function fits(node) {
        stage.appendChild(measurer);
        measurer.innerHTML = '';
        measurer.appendChild(node);
        const over = measurer.scrollHeight > Math.ceil(measurer.clientHeight) + 1;
        measurer.innerHTML = '';
        stage.removeChild(measurer);
        return !over;
    }

    /* ─── بناء القطع ──────────────────────────────────────────────────────── */
    function itemNode(item, i) {
        const row = el('div', 'kb-item' + (item.soldOut ? ' is-sold' : ''));
        row.style.setProperty('--i', String(i));
        row.appendChild(el('span', 'kb-num', String(i + 1).padStart(2, '0')));
        const src = safeImage(item.image);
        if (src) {
            const img = el('img', 'kb-thumb');
            img.src = src;
            img.alt = '';
            img.loading = 'lazy';
            img.decoding = 'async';
            img.addEventListener('error', () => img.remove(), { once: true });
            row.appendChild(img);
        }
        const copy = el('div', 'kb-copy');
        copy.appendChild(el('span', 'kb-name', item.primary));
        if (item.secondary) {
            const second = el('span', 'kb-name2', item.secondary);
            second.lang = language === 'en' ? 'ar' : 'en';
            second.dir = language === 'en' ? 'rtl' : 'ltr';
            copy.appendChild(second);
        }
        if (item.soldOut) { copy.appendChild(el('span', 'kb-sold', t('نفدت الكمية', 'Sold out'))); }
        row.appendChild(copy);
        /* السعر حقيقي أو لا يُرسم: الـ API لا يعطي سعرًا لأصناف التصنيفات */
        if (item.price !== null && item.price !== undefined) {
            row.appendChild(el('span', 'kb-price', `${item.price.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${t('ر.س', 'SAR')}`));
        }
        return row;
    }

    function headerNode(title, latin, note, showRibbon) {
        const head = el('div', 'kb-cathead');
        head.appendChild(el('div', 'kb-cattitle', title));
        if (latin) { head.appendChild(el('div', 'kb-catlatin', latin)); }
        if (note) { head.appendChild(el('div', 'kb-catnote', note)); }
        head.appendChild(el('span', 'kb-ribbon' + (showRibbon ? '' : ' is-hidden'), t('يُقدم الآن', 'Now serving')));
        return head;
    }

    function categoryNode(page, m) {
        const node = el('div', 'kb-page');
        node.dataset.period = page.period || '';
        node.appendChild(headerNode(
            language === 'en' ? (page.title_en || catTitleEn(page.title)) : page.title,
            language === 'en' ? '' : catEn(page.title),
            page.note,
            page.period === period,
        ));
        const grid = el('div', 'kb-grid');
        grid.style.setProperty('--cols', String(m.cols));
        grid.style.setProperty('--rows', String(Math.ceil(page.items.length / m.cols)));
        page.items.forEach((item, i) => grid.appendChild(itemNode(item, i)));
        node.appendChild(grid);
        return node;
    }

    function panelHeadNode(title, meta) {
        const head = el('div', 'kb-panel-head');
        head.appendChild(el('b', 'kb-panel-title', title));
        head.appendChild(el('span', 'kb-panel-meta', String(meta).toUpperCase()));
        return head;
    }

    function rowNode(raw, i) {
        const names = bilingual(raw, language);
        const row = el('div', 'kb-row');
        row.style.setProperty('--i', String(i));
        row.appendChild(el('span', 'kb-num', String(i + 1).padStart(2, '0')));
        const copy = el('div', 'kb-copy');
        copy.appendChild(el('span', 'kb-name', names.primary));
        if (names.secondary) { copy.appendChild(el('span', 'kb-name2', names.secondary)); }
        if (raw.sold_out) { copy.appendChild(el('span', 'kb-sold', t('نفدت الكمية', 'Sold out'))); }
        row.appendChild(copy);
        return row;
    }

    /** سعر البوفيه تحت السلطات — مقروءٌ كبيرًا، ومخصومٌ من الارتفاع قبل القصّ. */
    function priceStripNode(settings) {
        const p = buffetPriceParts(settings);
        const strip = el('div', 'kb-price-strip');
        strip.appendChild(el('span', 'kb-price-label', t(p.label.ar, p.label.en)));
        const amount = el('span', 'kb-price-amount');
        amount.appendChild(el('b', 'kb-price-value', p.value));
        amount.appendChild(el('span', 'kb-price-currency', t(p.currency.ar, p.currency.en)));
        strip.appendChild(amount);
        strip.appendChild(el('span', 'kb-price-per', t(p.per.ar, p.per.en)));
        return strip;
    }

    function panelNode(part) {
        const panel = el('section', 'kb-panel kb-panel--' + part.key);
        panel.appendChild(panelHeadNode(t(part.ar, part.en), part.en));
        if (part.key === 'carving') {
            const carve = el('div', 'kb-carve');
            const names = bilingual(part.items[0], language);
            carve.appendChild(el('div', 'kb-name', names.primary));
            if (names.secondary) { carve.appendChild(el('div', 'kb-name2', names.secondary)); }
            panel.appendChild(carve);
            return panel;
        }
        const body = el('div', 'kb-panel-body');
        part.items.forEach((raw, i) => body.appendChild(rowNode(raw, i)));
        panel.appendChild(body);
        return panel;
    }

    /**
     * التكوين الكامل لصفحة البوفيه بترتيب المالك: الشوربتان وركن الشواء
     * صفًّا واحدًا ← الأطباق العشرة عمودان ← الجملتان الثابتتان ← شريط
     * السعر. لا شيء يُحذف حين ضاقت المساحة: ‎--bf-scale‎ وحده يصغُر.
     */
    function buffetNode(model, scale) {
        const node = el('div', 'kb-page kb-bf');
        node.style.setProperty('--bf-scale', String(scale));

        const head = el('div', 'kb-bfhead');
        head.appendChild(el('b', 'kb-bfhead-title', t('بوفيه مفتوح', 'OPEN BUFFET')));
        const per = PERIOD_NAMES[period];
        head.appendChild(el('span', 'kb-bfhead-period', per ? per[language === 'en' ? 'en' : 'ar'] : t('طوال اليوم', 'ALL DAY')));
        node.appendChild(head);

        if (model.top.length) {
            const cols = el('div', 'kb-bf-cols');
            cols.style.setProperty('--bf-cols', String(model.topCols));
            model.top.forEach((part) => cols.appendChild(panelNode(part)));
            node.appendChild(cols);
        }
        if (model.mains.length) {
            const panel = el('section', 'kb-panel kb-panel--mains');
            const title = BUFFET_SECTIONS.mains;
            panel.appendChild(panelHeadNode(t(title.ar, title.en), title.en));
            const grid = el('div', 'kb-grid kb-grid--bf');
            grid.style.setProperty('--cols', String(model.cols));
            grid.style.setProperty('--rows', String(model.rows));
            model.mains.forEach((raw, i) => grid.appendChild(rowNode(raw, i)));
            panel.appendChild(grid);
            node.appendChild(panel);
        }
        if (model.lines.length) {
            const lines = el('div', 'kb-bf-lines');
            lines.style.setProperty('--bf-lines', String(model.lines.length));
            model.lines.forEach((line) => lines.appendChild(el('div', 'kb-bf-line', t(line.ar, line.en))));
            node.appendChild(lines);
        }
        node.appendChild(priceStripNode((board && board.settings) || {}));
        return node;
    }

    let m_ = { band: 'classic', cols: 2, rows: 3, capacity: 10 };
    /** مقياس صفحة البوفيه المحلي — يبدأ ١ ويُصغَر بالقياس لا بالتقدير. */
    let bfScale = 1;

    /**
     * سقف Capacity مقاس من الصفحة *بعد* رسمها، لا من الدبوس قبله.
     * السبب: ‎font-display: swap‎ — القياس الأول يجري بالخط الاحتياطي، ثم
     * يصل Tajawal فيعيد Names التفافها ويطول الصنف بضع بكسلات. الدبوس
     * لا يرى هذا، فلا يُنهي التحقق إلا على المرئي فعليًا. يُصفَّر عند
     * تغيّر الصندوق (تغيير حجم الشاشة) وعند تحميل الخطوط.
     */
    let fitCeiling = Infinity;
    let fitPasses = 0;
    let lastBoxKey = '';
    let fitFrame = null;

    /* ─── إعادة البناء: قياس → تقطيع → تحقق ───────────────────────────────── */
    /**
     * البوفيه صفحة واحدة، فلا قصَّ ولا دورات: القياس فيها مقياسٌ لا سعة.
     * شريط الفترات والترويسة الكبيرة يُطفَآن معه (المالك: «البار الفوق
     * كبير») ليأخذ التكوين كاملًا ارتفاعَ المسرح.
     */
    function rebuild() {
        if (destroyed || !board) { return; }
        isBuffet = isBuffetEnabled(board.buffet_sections);
        if (isBuffet) { refs.board.dataset.bf = '1'; } else { delete refs.board.dataset.bf; }
        if (isBuffet) {
            const model = buffetPage(board.buffet_sections, period);
            refs.board.dataset.ar = aspectBand(viewport().width, viewport().height);
            bfScale = model ? fitBuffetScale(model) : 1;
            buffet = model ? [model] : [];
            pages = [];
            index = 0;
            paint();
            return;
        }
        m_ = measureCapacity();
        buffet = [];
        pages = refit();
        index = dominantIndex(pages, period);
        paint();
    }

    /** Capacity is a guess until CSS says otherwise — shrink it until page 1 fits. */
    function refit() {
        let capacity = m_.capacity;
        for (let pass = 0; pass < MAX_FIT_PASSES; pass++) {
            const candidate = rebuildPages(capacity);
            if (!candidate.length || fits(categoryNode(candidate[0], m_))) { return candidate; }
            capacity = Math.max(2, Math.floor(capacity * 0.75));
        }
        return rebuildPages(capacity);
    }

    function rebuildPages(capacity) {
        const weekly = buildWeeklyPages({
            weekly: board.weekly_today,
            capacity,
            period,
            dayName: new Date().toLocaleDateString(language === 'en' ? 'en-US' : 'ar-SA-u-ca-gregory-nu-latn', { weekday: 'long' }),
            language,
        });
        return [...weekly, ...buildPages({ categories: board.categories, settings: board.settings, capacity, language })];
    }

    /* ─── الرسم ───────────────────────────────────────────────────────────── */
    function paint() {
        if (destroyed) { return; }
        stage.innerHTML = '';
        refs.dots.innerHTML = '';
        const list = isBuffet ? buffet : pages;
        if (!list.length) {
            const empty = el('div', 'kb-empty');
            empty.appendChild(el('div', 'kb-empty-title', t('المنيو يُحدَّث الآن', 'Menu updating')));
            empty.appendChild(el('div', 'kb-empty-note', board
                ? t('لم تُضف أصناف بعد — نعود إليكم تباعًا', 'No items published yet')
                : t('تعذّر الاتصال بخادم المنيو — جارٍ إعادة المحاولة', 'Cannot reach the menu server — retrying')));
            stage.appendChild(empty);
            refs.count.textContent = '—';
            return;
        }
        const nodes = list.map((pg) => (isBuffet ? buffetNode(pg, bfScale) : categoryNode(pg, m_)));
        nodes.forEach((node) => stage.appendChild(node));
        if (list.length > 1) {
            list.forEach((pg, i) => {
                const dot = el('button', 'kb-dot');
                dot.type = 'button';
                dot.setAttribute('aria-label', String(i + 1));
                dot.addEventListener('click', () => show(i));
                refs.dots.appendChild(dot);
            });
        }
        show(index);
        if (fitFrame) { cancelAnimationFrame(fitFrame); }
        fitFrame = requestAnimationFrame(verifyFit);
    }

    function show(i) {
        const list = isBuffet ? buffet : pages;
        if (!list.length) { return; }
        index = ((i % list.length) + list.length) % list.length;
        Array.from(stage.children).forEach((node, n) => {
            if (node.classList.contains('kb-page')) { node.classList.toggle('is-active', n === index); }
        });
        const dwell = dwellFor();
        Array.from(refs.dots.children).forEach((dot, n) => {
            dot.classList.toggle('is-active', n === index);
            if (n === index) {
                dot.style.setProperty('--dwell', `${Math.round(dwell / 1000)}s`);
                dot.style.animation = 'none'; void dot.offsetWidth; dot.style.animation = '';
            }
        });
        refs.count.textContent = isBuffet
            ? t('بوفيه مفتوح', 'Open Buffet')
            : `${index + 1} / ${list.length}`;
        schedule();
    }

    /** المدة: صفحة الفترة الحالية أطول، وغير ذلك الافتراضي — نفس قاعدة القديم. */
    function dwellFor() {
        if (isBuffet) { return DWELL_CURRENT_MS; }
        return cyclePlan({ pages, period, index }).dwellMs;
    }

    function nextIndex() {
        if (isBuffet) { return buffet.length > 1 ? (index + 1) % buffet.length : null; }
        const plan = cyclePlan({ pages, period, index });
        return plan.next === null || plan.next === undefined ? null : plan.next;
    }

    function schedule() {
        if (timer) { clearTimeout(timer); timer = null; }
        const next = nextIndex();
        if (next === null) { return; }
        timer = setTimeout(() => show(next), dwellFor());
    }

    /* ─── الساعة والفترات والترويسة ───────────────────────────────────────── */
    function paintChrome() {
        const s = (board && board.settings) || {};
        refs.title.textContent = s.title || 'مطاعم الشرفه العالمي';
        refs.subtitle.textContent = s.subtitle || '';
        const starts = scheduleStarts(s);
        PERIODS.forEach((p) => {
            const chip = refs.periods.querySelector(`[data-period="${p}"]`);
            if (!chip) { return; }
            const name = chip.querySelector('.kb-chip-name');
            name.textContent = '';
            name.appendChild(document.createTextNode(PERIOD_NAMES[p][language === 'en' ? 'en' : 'ar']));
            const small = el('small', null, PERIOD_NAMES[p][language === 'en' ? 'ar' : 'en']);
            small.lang = language === 'en' ? 'ar' : 'en';
            small.dir = language === 'en' ? 'rtl' : 'ltr';
            name.appendChild(small);
            chip.querySelector('.kb-chip-hours').textContent = `${starts[p]} - ${starts[PERIODS[(PERIODS.indexOf(p) + 1) % 3]]}`;
            chip.classList.toggle('is-current', p === period);
        });
    }

    function tick(now) {
        const date = now || new Date();
        const locale = language === 'en' ? 'en-GB' : 'ar-SA-u-ca-gregory-nu-latn';
        refs.clockTime.textContent = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
        refs.clockDate.textContent = date.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const next = periodAtMinute(date.getHours() * 60 + date.getMinutes(), (board && board.settings) || {});
        if (next !== period) {
            period = next;
            paintChrome();
            rebuild();
        }
    }

    /* ─── البيانات ────────────────────────────────────────────────────────── */
    function setData(payload) {
        board = payload;
        period = periodAtMinute(new Date().getHours() * 60 + new Date().getMinutes(), payload.settings || {});
        resetFit();
        paintChrome();
        rebuild();
    }

    /** لا بيانات بعد والفشل مستمر: رسالة صريحة بدل تجميد شاشة التحميل. */
    function showError() {
        board = null;
        pages = [];
        buffet = [];
        isBuffet = false;
        index = 0;
        paint();
    }

    function setLanguage(next) {
        language = next === 'en' ? 'en' : 'ar';
        document.documentElement.lang = language;
        document.documentElement.dir = language === 'en' ? 'ltr' : 'rtl';
        resetFit();
        paintChrome();
        rebuild();
    }

    /** السعة المقاسة صالحة للنص الحالي فقط: تغيير يعني قياسًا جديدًا. */
    function resetFit() {
        fitCeiling = Infinity;
        fitPasses = 0;
        lastBoxKey = '';
        bfScale = 1;
    }

    function onResize() {
        if (resizeTimer) { clearTimeout(resizeTimer); }
        resizeTimer = setTimeout(() => { resizeTimer = null; resetFit(); rebuild(); }, 250);
    }
    window.addEventListener('resize', onResize);

    /* الخطوط تصل بعد القياس الأول (swap): إعادة قياس واحدة عند جهوزيتها. */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => {
            if (destroyed || !board) { return; }
            resetFit();
            rebuild();
        });
    }

    function destroy() {
        destroyed = true;
        window.removeEventListener('resize', onResize);
        if (timer) { clearTimeout(timer); }
        if (resizeTimer) { clearTimeout(resizeTimer); }
        if (fitFrame) { cancelAnimationFrame(fitFrame); fitFrame = null; }
        stage.innerHTML = '';
        refs.dots.innerHTML = '';
    }

    period = periodAtMinute(new Date().getHours() * 60 + new Date().getMinutes(), {});
    paintChrome();

    return {
        setData,
        setLanguage,
        showError,
        tick,
        destroy,
        get language() { return language; },
        get period() { return period; },
        get capacity() { return m_.capacity; },
        get pageCount() { return (isBuffet ? buffet.length : pages.length); },
        get isBuffet() { return isBuffet; },
    };
}
