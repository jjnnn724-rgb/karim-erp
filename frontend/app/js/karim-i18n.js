/**
 * karim-i18n.js — طبقة لغة/عملة مشتركة لكل واجهات Karim ERP (بدون تبعيات).
 * الاستخدام:
 *   <script src="js/karim-i18n.js"></script>
 *   KarimI18n.ready.then(cfg => KarimI18n.money(75))            // "75.00 ر.س"
 *   KarimI18n.t('save')                                          // حسب اللغة الحالية
 *   KarimI18n.setLang('en')                                      // يبدّل ويعيد رسم كل [data-i18n]
 * المصدر: GET /api/i18n/config (عام) + localStorage للغة المختارة محليًا.
 */
(function (global) {
    'use strict';

    const DICT = {
        ar: {
            save: 'حفظ', delete: 'حذف', confirm: 'تأكيد', cancel: 'إلغاء',
            loading: 'جارٍ التحميل…', search: 'بحث', add: 'إضافة', edit: 'تعديل',
            close: 'إغلاق', yes: 'نعم', no: 'لا', error_generic: 'حدث خطأ — حاول مرة أخرى',
            login: 'تسجيل الدخول', logout: 'خروج', today: 'اليوم', branch: 'الفرع',
        },
        en: {
            save: 'Save', delete: 'Delete', confirm: 'Confirm', cancel: 'Cancel',
            loading: 'Loading…', search: 'Search', add: 'Add', edit: 'Edit',
            close: 'Close', yes: 'Yes', no: 'No', error_generic: 'Something went wrong — try again',
            login: 'Login', logout: 'Logout', today: 'Today', branch: 'Branch',
        },
    };

    // رموز العملات للعرض العربي الفخم؛ Intl يتولاها تلقائيًا للبقية
    const SYMBOLS = { SAR: 'ر.س', EGP: 'ج.م', AED: 'د.إ', USD: '$', EUR: '€', GBP: '£', TRY: '₺' };

    const state = {
        lang: (function () { try { return localStorage.getItem('karim_lang') || 'ar'; } catch (_) { return 'ar'; } })(),
        currency: null,
        taxRate: 0.15,
        branches: [],
    };

    const CONFIG_URL = '/api/i18n/config';

    const ready = fetch(CONFIG_URL, { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (cfg) {
            if (cfg && typeof cfg === 'object') {
                state.currency = cfg.currency || 'SAR';
                state.taxRate = typeof cfg.tax_rate === 'number' ? cfg.tax_rate : state.taxRate;
                state.branches = Array.isArray(cfg.branches) ? cfg.branches : [];
                if (!localStorage.getItem('karim_lang') && cfg.lang) {state.lang = cfg.lang;}
            }
            if (!state.currency) {state.currency = 'SAR';}
            applyDom();
            return cfg || {};
        })
        .catch(function () {
            // الشبكة سقطت؟ الافتراضيات السعودية تعمل — الواجهة لا تسقط أبدًا
            if (!state.currency) {state.currency = 'SAR';}
            return {};
        });

    function t(key, vars) {
        const table = DICT[state.lang] || DICT.ar;
        let out = table[key] != null ? table[key] : (DICT.ar[key] != null ? DICT.ar[key] : key);
        if (vars) {Object.keys(vars).forEach(function (k) {out = out.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);});}
        return out;
    }

    function money(amount, opts) {
        opts = opts || {};
        let value = Number(amount);
        if (!isFinite(value)) {value = 0;}
        const currency = (opts.currency || state.currency || 'SAR').toUpperCase();
        try {
            const locale = state.lang === 'en' ? 'en-US' : 'ar-SA-u-nu-latn';
            const fmt = new Intl.NumberFormat(locale, {
                style: 'currency', currency: currency,
                minimumFractionDigits: opts.decimals != null ? opts.decimals : 2,
                maximumFractionDigits: opts.decimals != null ? opts.decimals : 2,
            });
            const s = fmt.format(value);
            // رمز مخصص للعملات الخليجية/المصرية إن دفعته الواجهة
            if (opts.customSymbol && SYMBOLS[currency] && state.lang !== 'en') {
                return String(value.toFixed(opts.decimals != null ? opts.decimals : 2)).replace(/\.?0+$/, function (m) {return m; }) + ' ' + SYMBOLS[currency];
            }
            return s;
        } catch (_) {
            return value.toFixed(2) + ' ' + (SYMBOLS[currency] || currency);
        }
    }

    function withTax(amount) {
        return money(amount) + ' ' + (state.lang === 'en' ? 'incl. tax' : 'شامل الضريبة');
    }

    function setLang(lang) {
        state.lang = (lang === 'en') ? 'en' : 'ar';
        try { localStorage.setItem('karim_lang', state.lang); } catch (_) {}
        document.documentElement.setAttribute('dir', state.lang === 'en' ? 'ltr' : 'rtl');
        applyDom();
        document.dispatchEvent(new CustomEvent('karim-lang-changed', { detail: { lang: state.lang } }));
    }

    function applyDom() {
        if (typeof document === 'undefined') {return;}
        const els = document.querySelectorAll('[data-i18n]');
        for (let i = 0; i < els.length; i++) {
            els[i].textContent = t(els[i].getAttribute('data-i18n'));
        }
        const ph = document.querySelectorAll('[data-i18n-placeholder]');
        for (let j = 0; j < ph.length; j++) {
            ph[j].setAttribute('placeholder', t(ph[j].getAttribute('data-i18n-placeholder')));
        }
    }

    global.KarimI18n = {
        ready: ready,
        t: t,
        money: money,
        withTax: withTax,
        setLang: setLang,
        get lang() { return state.lang; },
        get currency() { return state.currency; },
        get taxRate() { return state.taxRate; },
        get branches() { return state.branches; },
    };
})(window);
