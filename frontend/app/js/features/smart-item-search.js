/* ═══════════════════════════════════════════════════════════════════════════
 * SMART-SEARCH-TRIAL v2 — بحث ذكي لأصناف فاتورة المشتريات (تجربة قابلة للحذف)
 * ────────────────────────────────────────────────────────────────────────────
 * الفكرة: في نافذة «فاتورة مشتريات جديدة» — اكتب أي حرف أو كلمة من اسم الصنف
 * → تظهر كل الأصناف المطابقة من المخزون فورًا (من كل الأسماء، بمطابقة متسامحة
 * تتجاهل الهمزات والتاء المربوطة وتدعم عدة كلمات: «دجاج كرتون») → كليك أو
 * ↑↓+Enter يختار الصنف → الوحدة وسعر الوحدة يُعبَّان تلقائيًا من المخزون.
 *
 * تولد مغلقة (عقد السلامة G4): زر «بحث ذكي ⚡» أعلى قائمة الأصناف في النافذة
 * يشغّلها، والحالة محفوظة في localStorage لكل جهاز.
 *
 * ⚠️ تجربة — كيفية الحذف الكامل (3 خطوات):
 *   1. احذف هذا الملف: frontend/app/js/features/smart-item-search.js
 *   2. احذف سطر السكريبت من frontend/app/index.html (ابحث عن SMART-SEARCH-TRIAL)
 *   3. احذف سطر precache من frontend/app/sw.js (ابحث عن SMART-SEARCH-TRIAL)
 * لا يوجد أي أثر آخر — صفر تعديلات على warehouse.js أو أي كود موجود.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    const FLAG = 'karim_smart_search_v1';
    const MAX_RESULTS = 30;

    /** تطبيع النص العربي للمطابقة المتسامحة */
    function normalizeAr(s) {
        return String(s || '').toLowerCase()
            .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
            .replace(/[أإآٱ]/g, 'ا')
            .replace(/ة/g, 'ه')
            .replace(/ى/g, 'ي')
            .replace(/ؤ/g, 'و')
            .replace(/ئ/g, 'ي')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * تقييم صنف ضد توكنات البحث — كل توكن يجب أن يطابق.
     * @returns {number} 0 = لا مطابقة
     */
    function scoreItem(item, tokens) {
        const name = normalizeAr(item.name);
        let score = 0;
        for (const t of tokens) {
            let s = 0;
            if (name === t) { s = 120; }
            else if (name.startsWith(t)) { s = 100; }
            else if (name.indexOf(' ' + t) !== -1) { s = 80; }
            else if (name.indexOf(t) !== -1) { s = 60; }
            if (!s) { return 0; }
            score += s;
        }
        return score;
    }

    /** ترتيب أصناف المخزون المطابقة — يقرأ STATE.inventory مباشرة */
    function rankItems(inventory, query) {
        const tokens = normalizeAr(query).split(' ').filter(Boolean);
        if (!tokens.length) { return []; }
        const source = Array.isArray(inventory) ? inventory
            : (typeof STATE !== 'undefined' && Array.isArray(STATE.inventory) ? STATE.inventory : []);
        return source
            .map((p) => ({ p, score: scoreItem(p, tokens) }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS)
            .map((x) => x.p);
    }

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function isOn() {
        try { return localStorage.getItem(FLAG) === '1'; } catch (_) { return false; }
    }
    function setOn(on) {
        try { localStorage.setItem(FLAG, on ? '1' : '0'); } catch (_) {}
    }

    const dropdown = null;
    let results = [];
    let highlight = -1;
    let highlightExplicit = false;
    let activeInput = null;

    function injectCss() {
        if (document.getElementById('smart-search-style')) {return;}
        const st = document.createElement('style');
        st.id = 'smart-search-style';
        st.textContent = [
            '#smart-search-chip { display:inline-flex; align-items:center; gap:5px; border:1px solid var(--border,#e5e7eb);',
            '  background:var(--bg3,#f3f4f6); color:var(--text2,#6b7280); border-radius:999px; padding:4px 12px;',
            '  font-size:12px; font-weight:700; cursor:pointer; user-select:none; font-family:inherit; transition:all .15s; }',
            '#smart-search-chip.on { background:#fff7ed; color:#c2410c; border-color:#fdba74; box-shadow:0 0 0 2px rgba(251,146,60,.15); }',
            '#smart-search-chip .dot { display:inline-block; width:7px; height:7px; border-radius:50%; background:#9ca3af; }',
            '#smart-search-chip.on .dot { background:#f97316; }',
            '.smart-search-dd { position:absolute; top:100%; right:0; left:0; z-index:9999; margin-top:3px;',
            '  background:var(--card,#fff); border:1px solid var(--border,#e5e7eb); border-radius:12px;',
            '  box-shadow:0 18px 50px rgba(0,0,0,.28); max-height:min(55vh,400px); overflow-y:auto; display:none; }',
            '.smart-search-dd .ss-head { padding:6px 14px; font-size:11px; color:#9ca3af; font-weight:700;',
            '  border-bottom:1px solid var(--border,#f3f4f6); display:flex; justify-content:space-between; gap:8px; }',
            '.smart-search-dd .ss-row { display:flex; align-items:center; gap:10px; padding:9px 14px; min-height:44px;',
            '  cursor:pointer; border-bottom:1px solid var(--border,#f3f4f6); }',
            '.smart-search-dd .ss-row:last-child { border-bottom:none; }',
            '.smart-search-dd .ss-row:hover, .smart-search-dd .ss-row.hl { background:#fff7ed; }',
            '.smart-search-dd .ss-row.hl { box-shadow:inset 3px 0 0 #f97316; }',
            '.smart-search-dd .ss-name { flex:1; font-size:13px; font-weight:600; color:var(--text,#111827);',
            '  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }',
            '.smart-search-dd .ss-name mark { background:#fde68a; color:inherit; border-radius:3px; padding:0 1px; }',
            '.smart-search-dd .ss-meta { font-size:10px; color:#9ca3af; background:var(--bg3,#f3f4f6);',
            '  border-radius:999px; padding:2px 8px; white-space:nowrap; }',
            '.smart-search-dd .ss-price { font-size:13px; font-weight:800; color:#b45309; white-space:nowrap; }',
            '.smart-search-dd .ss-stock { font-size:10px; font-weight:700; border-radius:6px; padding:2px 6px; white-space:nowrap; }',
            '.smart-search-dd .ss-stock.low { background:#fffbeb; color:#b45309; }',
            '.smart-search-dd .ss-stock.out { background:#fef2f2; color:#b91c1c; }',
            '.smart-search-dd .ss-empty { padding:18px; text-align:center; color:#9ca3af; font-size:13px; }'
        ].join('\n');
        document.head.appendChild(st);
    }

    function getInventory() {
        return (typeof STATE !== 'undefined' && Array.isArray(STATE.inventory)) ? STATE.inventory : [];
    }

    function fmt(n) {
        return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    /** يُستدعى بكشف الأحداث (delegation) — لا ربط لكل عنصر */
    function onInput(e) {
        if (!isOn() || !e.target || !/^item_name_\d+$/.test(e.target.id || '')) {return;}
        activeInput = e.target;
        // أوقف datalist الأصلي أثناء تشغيل التجربة حتى لا تظهر قائمتان
        if (e.target.hasAttribute('list')) { e.target.removeAttribute('list'); e.target.dataset.ssList = '1'; }
        update();
    }

    function onFocusin(e) {
        if (!isOn() || !e.target || !/^item_name_\d+$/.test(e.target.id || '')) {return;}
        activeInput = e.target;
        if (activeInput.value.trim()) { update(); }
    }

    function onKeydown(e) {
        if (!isOn() || !e.target || !/^item_name_\d+$/.test(e.target.id || '')) {return;}
        activeInput = e.target;
        if (!dropdown || dropdown.style.display !== 'block' || !results.length) {return;}
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlight = (highlight + 1) % results.length;
            highlightExplicit = true;
            paintHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlight = (highlight - 1 + results.length) % results.length;
            highlightExplicit = true;
            paintHighlight();
        } else if (e.key === 'Enter') {
            // Enter يختار فقط: السطر المحدد بالأسهم، أو مطابقة اسم تامة —
            // حتى لا يخطف الكتابة الحرة لأصناف غير موجودة في المخزون
            const exact = results.length === 1
                || (results[0] && normalizeAr(results[0].name) === normalizeAr(e.target.value));
            if (highlightExplicit && highlight >= 0) {
                e.preventDefault();
                pick(results[highlight]);
            } else if (exact) {
                e.preventDefault();
                pick(results[0]);
            }
        } else if (e.key === 'Escape') {
            hide();
        }
    }

    function update() {
        if (!isOn() || !activeInput || !document.body.contains(activeInput)) {return;}
        const q = activeInput.value.trim();
        if (!q) { hide(); return; }
        results = rankItems(getInventory(), q);
        highlight = -1;
        highlightExplicit = false;

        // ضع القائمة تحت الحقل النشط (الحاوي عليه position:relative جاهز)
        if (dropdown.parentElement !== activeInput.parentElement) {
            activeInput.parentElement.appendChild(dropdown);
        }

        const head = '<div class="ss-head"><span>' + (results.length
            ? 'أصناف المخزون المطابقة (' + results.length + (results.length >= MAX_RESULTS ? '+' : '') + ')'
            : 'لا توجد نتائج') + '</span><span>↑↓ · Enter · Esc</span></div>';

        if (!results.length) {
            dropdown.innerHTML = head + '<div class="ss-empty">لا يوجد صنف يطابق «' + esc(q) + '» — يمكن حفظه كاسم حر أو جرّب كلمة أقصر</div>';
            dropdown.style.display = 'block';
            return;
        }

        const marks = normalizeAr(q).split(' ').filter(Boolean);
        const body = results.map((p, i) => {
            let name = esc(p.name);
            for (const t of marks) {
                try {
                    const rx = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
                    name = name.replace(rx, '<mark>$1</mark>');
                } catch (_) {}
            }
            const qty = Number(p.qty);
            const low = qty <= Number(p.min_stock_level || 5);
            const stockTxt = isFinite(qty) ? 'المخزون: ' + fmt(qty) + ' ' + esc(p.unit || '') : '';
            return '<div class="ss-row' + (i === highlight ? ' hl' : '') + '" data-idx="' + i + '">'
                + '<span class="ss-name">' + name + '</span>'
                + (p.unit ? '<span class="ss-meta">' + esc(p.unit) + '</span>' : '')
                + (stockTxt ? '<span class="ss-stock ' + (low ? 'low' : '') + '">' + stockTxt + '</span>' : '')
                + '<span class="ss-price">' + fmt(p.avgCost) + '</span>'
                + '</div>';
        }).join('');

        dropdown.innerHTML = head + body;
        dropdown.style.display = 'block';
    }

    function paintHighlight() {
        if (!dropdown) {return;}
        dropdown.querySelectorAll('.ss-row').forEach((row, i) => {
            row.classList.toggle('hl', i === highlight);
            if (i === highlight) { row.scrollIntoView({ block: 'nearest' }); }
        });
    }

    function pick(p) {
        if (!p || !activeInput) {return;}
        const idx = (activeInput.id.match(/item_name_(\d+)/) || [])[1];
        if (idx === undefined) {return;}
        activeInput.value = p.name;
        // الدالة الموجودة تعبّي الوحدة والسعر تلقائيًا عند مطابقة الاسم تمامًا
        if (typeof updateInvoiceItem === 'function') { updateInvoiceItem(Number(idx), 'itemName', p.name); }
        hide();
        const qtyInput = document.getElementById('item_qty_' + idx);
        if (qtyInput) { qtyInput.focus(); qtyInput.select(); }
    }

    function hide() {
        if (dropdown) { dropdown.style.display = 'none'; }
        results = [];
        highlight = -1;
        highlightExplicit = false;
    }

    function buildChip() {
        const list = document.getElementById('invoiceItemsList');
        if (!list || document.getElementById('smart-search-chip')) {return;}
        const wrap = document.createElement('div');
        wrap.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px';
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'smart-search-chip';
        chip.innerHTML = 'بحث ذكي ⚡<span class="dot"></span>';
        chip.title = 'تجربة: اكتب أي حرف أو كلمة من اسم الصنف لتظهر كل المطابقين من المخزون — كليك للتشغيل/الإيقاف';
        chip.addEventListener('click', () => {
            setOn(!isOn());
            syncChip();
            if (!isOn()) { hide(); }
        });
        wrap.appendChild(chip);
        list.parentElement.insertBefore(wrap, list);
        syncChip();
    }

    function syncChip() {
        const chip = document.getElementById('smart-search-chip');
        if (chip) {
            chip.classList.toggle('on', isOn());
            chip.title = isOn()
                ? 'البحث الذكي مفعّل — اكتب في حقل الصنف لتظهر كل المطابقين من المخزون (كليك للإيقاف)'
                : 'تجربة: اكتب أي حرف أو كلمة من اسم الصنف لتظهر كل المطابقين — كليك للتشغيل';
        }
    }

    function init() {
        injectCss();
        // كشف الأحداث على مستوى المستند: يغطي الصفوف الجديدة دون إعادة ربط
        document.addEventListener('input', onInput, true);
        document.addEventListener('focusin', onFocusin, true);
        document.addEventListener('keydown', onKeydown, true);
        document.addEventListener('click', (e) => {
            if (dropdown && !dropdown.contains(e.target) && !(e.target && e.target.id === 'smart-search-chip')) { hide(); }
        });
        const obs = new MutationObserver(() => {
            if (document.getElementById('invoiceItemsList')) { buildChip(); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); }
        else { init(); }
    }

    // تصدير للاختبار الآلي (Node) — لا تأثير في المتصفح
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { normalizeAr, scoreItem, rankItems };
    }
})();
