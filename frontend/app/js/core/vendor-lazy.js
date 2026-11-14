/**
 * vendor-lazy.js — مكتبات البائع الثقيلة تُحمَّل بعد جاهزية الدخول لا قبله.
 *
 * لماذا: ثلاث وسوم <script async> كانت تُنزِّل xlsx (872KB) وhtml5-qrcode
 * (372KB) وChart (204KB) مع كل إقلاع — 383KB مضغوطة تزاحم رسم شاشة الدخول
 * ووحدات الميزات. لا يستخدمها إلا تصدير Excel والرسوم وفتح الكاميرا: كلها
 * أفعال بعد الدخول. القياس (5Mbps/40ms): الجسور جاهزة 1.998s ← 1.403s.
 *
 * العقد: window.ensureVendor(name) يُرجع وعدًا يُحل بعد تحميل المكتبة (أو
 * فورًا إن كانت محمَّلة). أي شاشة تحتاج مكتبة تنتظرها عبره بدل أن تنهار
 * بـ «XLSX غير معرَّف» إن سبق المستخدمُ التحميلَ الهادئ.
 */
(function () {
    'use strict';

    // الروابط تحمل ?v= صريحًا كي يلتقطها scripts/frontend-version.js --bump
    // مع بقية أصول الواجهة؛ الخادم يرسل JS بلا كاش فوري فلا تبقى نسخة قديمة.
    const SOURCES = {
        xlsx: '/app/vendor/xlsx.full.min.js?v=4.9.327',
        chart: '/app/vendor/chart.umd.min.js?v=4.9.327',
        qrcode: '/app/vendor/html5-qrcode.min.js?v=4.9.327',
    };
    const GLOBALS = { xlsx: 'XLSX', chart: 'Chart', qrcode: 'Html5Qrcode' };
    const pending = {};

    function ensure(name) {
        const globalName = GLOBALS[name];
        if (!globalName || !SOURCES[name]) {return Promise.reject(new Error('vendor غير معروف: ' + name));}
        if (window[globalName]) {return Promise.resolve(window[globalName]);}
        if (pending[name]) {return pending[name];}
        pending[name] = new Promise(function (resolve, reject) {
            const script = document.createElement('script');
            script.src = SOURCES[name];
            script.async = true;
            script.dataset.vendorLazy = name;
            script.onload = function () { resolve(window[GLOBALS[name]]); };
            script.onerror = function () {
                delete pending[name];
                script.remove();
                reject(new Error('تعذر تحميل مكتبة ' + name));
            };
            document.head.appendChild(script);
        });
        return pending[name];
    }

    window.ensureVendor = ensure;
    window.ensureXLSX = function () { return ensure('xlsx'); };
    window.ensureChart = function () { return ensure('chart'); };
    window.ensureHtml5Qrcode = function () { return ensure('qrcode'); };

    // تسخين هادئ خلف شاشة الدخول: Chart أولًا (لوحة التحكم تُرسم فور الدخول)،
    // ثم الكاميرا، ثم xlsx أخيرًا (أثقلها وأقلّها إلحاحًا). فشل التسخين لا
    // يُبلَّغ: ensure يعيد المحاولة عند الطلب الفعلي.
    function warm() {
        ensure('chart').catch(function () {});
        setTimeout(function () { ensure('qrcode').catch(function () {}); }, 1500);
        setTimeout(function () { ensure('xlsx').catch(function () {}); }, 3000);
    }
    // الحدث يُطلق على document بلا bubbling (main.js) — الاستماع على window
    // كان لا يسمعه أبدًا. ولو تأخرت الجسور أو فشلت، شبكةُ load تُسخِّن بدلًا منها.
    if (window.__karimBridgesReady) {
        setTimeout(warm, 0);
    } else {
        let warmed = false;
        const startWarm = function () {
            if (warmed) {return;}
            warmed = true;
            setTimeout(warm, 0);
        };
        document.addEventListener('karim:bridges-ready', startWarm, { once: true });
        window.addEventListener('load', function () { setTimeout(startWarm, 2000); }, { once: true });
    }
})();
