/**
 * V2 — طبقة تفاعل الرسوم · تلميحٌ ومؤشّرُ لوحةِ مفاتيح
 * ═══════════════════════════════════════════════════════════════════════
 * charts.js يرسم؛ هذه الطبقة تُحسّس. تُركَّب مرّةً واحدة على جذر القشرة
 * وتعمل بالتفويض (delegation)، فتبقى عاملةً بعد كل تبديلِ شاشةٍ بلا إعادة
 * تركيب. وهي لا تعرف شيئًا عن بنية الشاشة: تقرأ فقط ما تكتبه charts.js على
 * كل علامة — data-v2-chart-mark / -label / -series / -value / -note.
 *
 * ثلاثة سلوكات:
 *   ١) المؤشّر (فأرةٌ أو لمس): بطاقةٌ تقول «التسمية — السلسلة: القيمة»،
 *      ومعها ملاحظةُ العلامة إن كانت («٥٩ فاتورة»).
 *   ٢) لوحة المفاتيح: الأسهم يمينًا/يسارًا بين محاور الرسم (الزمن أو
 *      الفئة)، وفوق/تحت بين السلاسل داخل المحور نفسه، وHome/End لطرفيه.
 *      الأسهمُ تتبع اتجاهَ الصفحة: في RTL يقدّمُ السهمُ الأيسرُ النقلةَ
 *      التالية. كل نقلةٌ تُنادى صوتيًّا عبر منطقةٍ واحدة aria-live.
 *   ٣) بؤرةٌ مرئية على العلامة النشطة، وخطُّ توجيهيٌّ على الخطِّ البياني.
 *
 * CONTRACT
 *   لا شبكة ولا تخزين ولا تعديلٍ في بنية الشاشة: قراءةٌ من data-* فقط،
 *   وكتابةٌ على سمة data-v2-chart-active داخل الرسم. وحين يلمس المؤشّر
 *   علامةً تُزال <title> منها — تلميحُ المتصفّح الأصلي بجوار تلميحنا
 *   تلميحان، والواحدُ يكفي. لا يُفقد شيءٌ من المعنى: اسمُ الرسم كلّه
 *   على <svg role="img" aria-label>، وهو ما تقرؤه قارئاتُ الشاشة.
 *
 * MOUNT
 *   على `shell.root` (وهو عنصر .erp-v2) لا على #erp-v2-root — فالتوكنات
 *   تُحلّ داخل نطاق .erp-v2، وبدونه لا يُحَلّ اسمٌ ولا يُرسم شيء.
 */

const MARK = '[data-v2-chart-mark]';
const ACTIVE = 'data-v2-chart-active';
const HOLDER = '.erp-chart__plot, .erp-chart__donut-wrap';
const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
const SVG_NS = 'http://www.w3.org/2000/svg';

const mounted = new WeakSet();

const closest = (target, selector) => {
    if (!target || typeof target.closest !== 'function') {return null;}
    return target.closest(selector);
};

/**
 * تُركّب طبقة التفاعل على جذر القشرة.
 * @param {HTMLElement} root عنصر .erp-v2 الذي يحوي الشاشات
 * @returns {{destroy:()=>void}}
 */
export function mountChartInteraction(root) {
    if (!root || typeof root.addEventListener !== 'function') {return {destroy() {}};}
    if (mounted.has(root)) {return {destroy() {}};}
    mounted.add(root);

    /* ── The tooltip card ───────────────────────────────────────────── */
    const tip = document.createElement('div');
    tip.className = 'erp-chart-tip';
    tip.setAttribute('aria-hidden', 'true');
    tip.innerHTML = '<span class="erp-chart-tip__label"></span><span class="erp-chart-tip__value"></span><span class="erp-chart-tip__note"></span>';
    root.appendChild(tip);
    const tipLabel = tip.querySelector('.erp-chart-tip__label');
    const tipValue = tip.querySelector('.erp-chart-tip__value');
    const tipNote = tip.querySelector('.erp-chart-tip__note');

    /* One live region for every chart: the spoken value travels here, so
       the tooltip itself can stay silent and decorative. */
    const live = document.createElement('div');
    live.className = 'erp-sr-only';
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);

    let active = null;
    let cursor = null;
    let guideLine = null;

    function clearActive() {
        if (active) {active.removeAttribute(ACTIVE);}
        active = null;
    }

    function removeGuide() {
        if (guideLine) {guideLine.remove();}
        guideLine = null;
    }

    /** محاورُ الرسم: كلُّ محورٍ مجموعةُ علاماتٍ تحمل التسمية نفسها،
        بالترتيبِ الذي ظهرت به أول مرة (سلاسلُ الأعمدة تُجمَّع هكذا). */
    function groupsOf(holder) {
        const map = new Map();
        for (const mark of holder.querySelectorAll(MARK)) {
            const key = mark.dataset.v2ChartLabel || '';
            if (!map.has(key)) {map.set(key, []);}
            map.get(key).push(mark);
        }
        return [...map.values()];
    }

    function place(mark) {
        const r = mark.getBoundingClientRect();
        if (!r.width && !r.height) {return;}
        const box = tip.getBoundingClientRect();
        let left = r.left + (r.width / 2) - (box.width / 2);
        let top = r.top - box.height - 10;
        if (top < 8) {top = r.bottom + 10;}
        left = Math.max(8, Math.min(left, window.innerWidth - box.width - 8));
        top = Math.max(8, Math.min(top, window.innerHeight - box.height - 8));
        tip.style.left = `${Math.round(left)}px`;
        tip.style.top = `${Math.round(top)}px`;
    }

    function show(mark) {
        tipLabel.textContent = mark.dataset.v2ChartLabel || '';
        tipValue.textContent = mark.dataset.v2ChartValue || '';
        const note = mark.dataset.v2ChartNote || '';
        tipNote.textContent = note;
        tipNote.hidden = !note;
        tip.classList.add('is-open');
        place(mark);
        /* تلميحُ المتصفّح الأصلي يُزال عند أول لمسٍ — تلميحان معًا أضجيج. */
        const native = mark.querySelector('title');
        if (native) {native.remove();}
    }

    function hide() {
        tip.classList.remove('is-open');
    }

    function setActive(mark) {
        if (active === mark) {return;}
        clearActive();
        active = mark;
        mark.setAttribute(ACTIVE, '1');
    }

    /** خطُّ التوجيه على الخطِّ البياني: عمودٌ رأسيٌّ عند النقطة النشطة. */
    function guide(mark) {
        const svg = mark && mark.ownerSVGElement;
        if (!svg || mark.dataset.v2ChartMark !== 'line') {removeGuide(); return;}
        if (!guideLine || guideLine.parentNode !== svg) {
            removeGuide();
            guideLine = document.createElementNS(SVG_NS, 'line');
            guideLine.setAttribute('class', 'erp-chart__cursor');
            svg.appendChild(guideLine);
        }
        let box;
        try {box = mark.getBBox();} catch {return;}
        const vb = svg.viewBox && svg.viewBox.baseVal;
        const x = (box.x + (box.width / 2)).toFixed(2);
        guideLine.setAttribute('x1', x);
        guideLine.setAttribute('x2', x);
        guideLine.setAttribute('y1', vb ? String(vb.y) : '0');
        guideLine.setAttribute('y2', vb ? String(vb.y + vb.height) : '240');
    }

    function activate(announce) {
        if (!cursor) {return;}
        const group = cursor.groups[cursor.gi];
        if (!group || !group.length) {return;}
        const mark = group[Math.min(cursor.si, group.length - 1)];
        if (!mark) {return;}
        setActive(mark);
        show(mark);
        guide(mark);
        if (!announce) {return;}
        const label = mark.dataset.v2ChartLabel || '';
        const series = mark.dataset.v2ChartSeries || '';
        const value = mark.dataset.v2ChartValue || '';
        const note = mark.dataset.v2ChartNote || '';
        live.textContent = (series && series !== label)
            ? `${label} — ${series}: ${value}${note ? `، ${note}` : ''}`
            : `${label}: ${value}${note ? `، ${note}` : ''}`;
    }

    /* ── Pointer ────────────────────────────────────────────────────── */
    function onOver(event) {
        const mark = closest(event.target, MARK);
        if (!mark) {return;}
        setActive(mark);
        show(mark);
    }

    function onOut(event) {
        const mark = closest(event.target, MARK);
        if (!mark) {return;}
        const next = event.relatedTarget;
        if (next && typeof next.closest === 'function' && mark.contains(next)) {return;}
        hide();
        clearActive();
    }

    /* ── Keyboard ───────────────────────────────────────────────────── */
    /** الأسهمُ تتبع اتجاهَ الصفحة: في صفحةٍ عربيةٍ (rtl) يقدّمُ السهمُ
     *  الأيسرُ النقلةَ التالية — تمامًا كما يقول السهم — وينتقل المؤشّر
     *  بصريًّا إلى اليسارِ لأن محورَ الفئاتِ يسيرُ من اليمين لليسار. */
    function rtlPage() {
        try {return getComputedStyle(root).direction === 'rtl';} catch {return true;}
    }

    function onFocusIn(event) {
        const holder = closest(event.target, HOLDER);
        if (!holder) {return;}
        const groups = groupsOf(holder);
        if (!groups.length) {return;}
        cursor = {holder, groups, gi: 0, si: 0};
        activate(true);
    }

    function onFocusOut(event) {
        const holder = closest(event.target, HOLDER);
        if (!holder) {return;}
        const next = event.relatedTarget;
        if (next && typeof next.closest === 'function' && holder.contains(next)) {return;}
        cursor = null;
        hide();
        clearActive();
        removeGuide();
    }

    function onKeyDown(event) {
        if (!NAV_KEYS.includes(event.key)) {return;}
        const holder = closest(event.target, HOLDER);
        if (!holder) {return;}
        const groups = groupsOf(holder);
        if (!groups.length) {return;}
        event.preventDefault();
        if (!cursor || cursor.holder !== holder) {
            cursor = {holder, groups, gi: 0, si: 0};
        } else {
            cursor.groups = groups;
        }
        const last = cursor.groups.length - 1;
        const rtl = rtlPage();
        if (event.key === 'ArrowRight') {cursor.gi = Math.min(last, cursor.gi + (rtl ? -1 : 1));}
        else if (event.key === 'ArrowLeft') {cursor.gi = Math.max(0, cursor.gi + (rtl ? 1 : -1));}
        else if (event.key === 'ArrowDown') {
            const group = cursor.groups[cursor.gi] || [];
            cursor.si = Math.min(group.length - 1, cursor.si + 1);
        } else if (event.key === 'ArrowUp') {
            cursor.si = Math.max(0, cursor.si - 1);
        } else if (event.key === 'Home') {cursor.gi = 0; cursor.si = 0;}
        else if (event.key === 'End') {cursor.gi = last; cursor.si = 0;}
        activate(true);
    }

    /* The tooltip is fixed to the viewport, so a scroll would leave it
       pointing at empty paper. */
    function onScroll() {hide();}

    root.addEventListener('pointerover', onOver);
    root.addEventListener('pointerout', onOut);
    root.addEventListener('focusin', onFocusIn);
    root.addEventListener('focusout', onFocusOut);
    root.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);

    return {
        destroy() {
            root.removeEventListener('pointerover', onOver);
            root.removeEventListener('pointerout', onOut);
            root.removeEventListener('focusin', onFocusIn);
            root.removeEventListener('focusout', onFocusOut);
            root.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('scroll', onScroll, true);
            window.removeEventListener('resize', onScroll);
            tip.remove();
            live.remove();
            mounted.delete(root);
        },
    };
}
