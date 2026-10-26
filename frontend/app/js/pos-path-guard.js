/**
 * pos-path-guard.js — حارس توحيد مسار واجهة POS (Phase 4.2)
 * ══════════════════════════════════════════════════════════════════════════
 * لماذا: توجد ثلاث واجهات POS متوازية (الشاشة القديمة /app/pos.html،
 * التطبيق المنفصل /app/cashier/، وPOS المدمج داخل V2). قبل اعتماد مسار
 * رسمي لا يُحذف شيء — لكن يمكن **توجيه** المستخدمين تدريجيًا.
 *
 * السياسة تُدار من الضبط (إعدادات النظام — migration 104):
 *   pos_legacy_mode   : off | banner | redirect   (الافتراضي off = لا تغيير)
 *   pos_official_path : مسار الواجهة الرسمية (مثال /app/cashier/)
 *
 * القواعد:
 *   · الافتراضي off ⇒ لا يتغيّر شيء إطلاقًا (سلوك اليوم).
 *   · redirect لا يحدث إلا إذا كان المسار الرسمي مضبوطًا فعلًا — وإلا تبقى
 *     الشاشة كما هي ولا يُحبس المستخدم (fail-open في الاتجاه الآمن).
 *   · المسار الرسمي يجب أن يكون داخليًا (يبدأ بـ/) — لا URL خارجي ولا
 *     تحويل مفتوح (//example).
 *   · القرار يُقرأ من الخادم (single source of truth) لا من localStorage.
 *
 * شكل الوحدة: UMD — تُحمَّل كسكربت عادي في المتصفح (window.PosPathGuard)
 * وتُستورَد كـCommonJS في الاختبارات، بلا أي أداة بناء.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {module.exports = api;}
    else {root.PosPathGuard = api;}
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MODES = Object.freeze(['off', 'banner', 'redirect']);

    /**
     * يطبّع السياسة القادمة من الخادم.
     * @param {object} raw
     * @returns {{mode: 'off'|'banner'|'redirect', path: string, label: string}}
     */
    function normalizePolicy(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        let mode = String(source.mode || '').trim().toLowerCase();
        if (MODES.indexOf(mode) === -1) {mode = 'off';}
        let path = String(source.path || '').trim();
        // مسار داخلي فقط: يبدأ بـ/ ولا protocols ولا // (لا تحويل مفتوح)
        if (path && (!path.startsWith('/') || path.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(path))) {
            path = '';
        }
        const label = String(source.label || '').trim().slice(0, 120);
        return { mode, path, label };
    }

    /**
     * القرار: ماذا نفعل الآن؟
     * @param {{mode: string, path: string}} policy
     * @returns {{action: 'none'|'redirect'|'banner', href: string}}
     */
    function decide(policy) {
        const p = normalizePolicy(policy);
        if (p.mode === 'off') {return { action: 'none', href: '' };}
        if (!p.path) {return { action: 'none', href: '' };}   // بلا مسار رسمي = لا تحبس المستخدم
        if (p.mode === 'redirect') {return { action: 'redirect', href: p.path };}
        return { action: 'banner', href: p.path };
    }

    /** يبني عنصر البانر (نصّ فقط — لا innerHTML، فلا مجال لحقن HTML). */
    function buildBanner(policy, options) {
        const opts = options || {};
        const decision = decide(policy);
        if (decision.action !== 'banner') {return null;}
        const bar = document.createElement('div');
        bar.id = 'posLegacyBanner';
        bar.setAttribute('role', 'status');
        bar.style.cssText = 'position:fixed;top:0;right:0;left:0;z-index:10000;background:#b45309;color:#fff;'
            + 'display:flex;gap:12px;align-items:center;justify-content:center;padding:8px 12px;font-size:13px;';
        const text = document.createElement('span');
        const label = normalizePolicy(policy).label
            || 'هذه الشاشة ستُوقف قريبًا — الرجاء استخدام واجهة الكاشير المعتمدة.';
        text.textContent = label;
        const link = document.createElement('a');
        link.href = decision.href;
        link.textContent = 'فتح الواجهة المعتمدة';
        link.style.cssText = 'color:#fff;font-weight:700;text-decoration:underline;';
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '✕';
        close.setAttribute('aria-label', 'إخفاء التنبيه');
        close.style.cssText = 'background:transparent;border:0;color:#fff;cursor:pointer;font-size:14px;';
        close.addEventListener('click', function () {
            bar.remove();
            try { sessionStorage.setItem('karim_pos_legacy_banner_dismissed', '1'); } catch (_) {}
            if (typeof opts.onDismiss === 'function') {opts.onDismiss();}
        });
        bar.appendChild(text);
        bar.appendChild(link);
        bar.appendChild(close);
        return bar;
    }

    /** يقرأ السياسة من الخادم (منشور بلا مصادقة — لا يحوي إلا الوضع والمسار). */
    async function fetchPolicy(endpoint) {
        const url = endpoint || '/api/pos/path-policy';
        try {
            const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
            if (!res.ok) {return { mode: 'off', path: '', label: '' };}
            const json = await res.json();
            return normalizePolicy(json && json.policy ? json.policy : json);
        } catch (_) {
            return { mode: 'off', path: '', label: '' };
        }
    }

    /**
     * نقطة الدخول: يُستدعى من صفحة POS القديمة.
     * @param {string} [endpoint]
     */
    async function applyPosPathPolicy(endpoint) {
        if (typeof window === 'undefined' || typeof document === 'undefined') {return { action: 'none', href: '' };}
        const policy = await fetchPolicy(endpoint);
        const decision = decide(policy);
        if (decision.action === 'redirect') {
            try { window.location.replace(decision.href); } catch (_) { window.location.href = decision.href; }
            return decision;
        }
        if (decision.action === 'banner') {
            let dismissed = false;
            try { dismissed = sessionStorage.getItem('karim_pos_legacy_banner_dismissed') === '1'; } catch (_) {}
            if (!dismissed && !document.getElementById('posLegacyBanner')) {
                const bar = buildBanner(policy);
                if (bar) {document.body.appendChild(bar);}
            }
        }
        return decision;
    }

    return { normalizePolicy, decide, buildBanner, fetchPolicy, applyPosPathPolicy, MODES };
}));
