/**
 * شارة «V3 · معاينة» داخل V2 — تُحقن من الخادم في صفحة V2 (بلا لمس لمصدرها،
 * انظر الوسيط في backend/server.js). هدفها إعلان الانتقال القادم لا تغيير
 * عمل: زر واحد يفتح صفحة الإعلان /v3-preview، ويختفي تلقائيًا بعد يوم القلب
 * (`meta[name="v3-rollout"]` يصبح primary) لأن V3 يصير هو المدخل نفسه.
 */
(function () {
    'use strict';

    var meta = document.querySelector('meta[name="v3-rollout"]');
    if (!meta || meta.getAttribute('content') !== 'preview') {
        return;
    }

    var pill = null;

    function build() {
        var link = document.createElement('a');
        link.className = 'erp-v3-flag erp-no-print';
        link.href = '/v3-preview';
        link.target = '_blank';
        link.rel = 'noopener';
        link.title = 'الإصدار الثالث — معاينة كاملة قبل الانتقال في 16 نوفمبر';
        link.innerHTML =
            '<span class="erp-v3-flag__dot" aria-hidden="true"></span>' +
            '<span class="erp-v3-flag__label">V3 · معاينة</span>';
        return link;
    }

    function place(actions) {
        if (!actions || !actions.isConnected) {
            return false;
        }
        if (actions.querySelector('.erp-v3-flag')) {
            return true;
        }
        var anchor = actions.querySelector('[data-erp-more-toggle]');
        var node = build();
        if (anchor) {
            actions.insertBefore(node, anchor);
        } else {
            actions.appendChild(node);
        }
        pill = node;
        return true;
    }

    function tryPlace() {
        if (place(document.querySelector('.erp-shell__actions'))) {
            return true;
        }
        // الهاتف يستخدم نفس القشرة، لكن بعض الأدوار تُبنى شاشتها لاحقًا.
        return place(document.querySelector('.erp-shell__header'));
    }

    if (tryPlace()) {
        return;
    }

    // القشرة تُركَّب بعد الدخول، فلا يوجد عنصر جاهز الآن — ننتظره لا نستقصيه.
    var observer = new MutationObserver(function () {
        if (tryPlace()) {
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // سقف زمني: صفحة دخول بلا قشرة لا تترك مراقبًا يعمل إلى الأبد.
    setTimeout(function () {
        observer.disconnect();
    }, 120000);
})();
