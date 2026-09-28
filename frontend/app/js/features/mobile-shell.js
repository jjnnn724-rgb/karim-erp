/**
 * features/mobile-shell.js — هيكل الجوال: شريط تنقل سفلي + بطاقة البصمة الذاتية
 * ────────────────────────────────────────────────────────────────────────────
 * المواصفة: docs/SPEC-employee-pwa-attendance-geofence-v1.md (FR-M1..M6, S4–S6)
 * الخطة: docs/PLAN-safe-rollout-playbook-v1.md
 *
 * Bridge policy: bridged by main.js (BRIDGE-029) — مثل بقية الوحدات.
 *
 * قواعد السلامة:
 *   • التفعيل مشروط: (شاشة ≤ 900px) + دور ضمن أدوار الموظفين + MOBILE_UI_V2 ≠ false
 *   • المكتب (شاشة كبيرة) لا يتأثر إطلاقًا — body.mobile-shell-on لا يُضاف
 *   • زر البصمة يظهر فقط عندما يرجع السيرفر enabled=true من status endpoint
 *     (نفس المفتاح المركزي PUNCH_PORTAL_ENABLED — قرار إداري بنقرة)
 *   • الجيولوكيشن يُقرأ لحظة الضغط فقط — لا تتبع خلفي (خصوصية §5.5)
 */

const MOBILE_SHELL_ROLES = ['employee', 'cashier', 'kitchen', 'warehouse', 'dept_head'];
const MOBILE_BP = '(max-width: 900px)';

let _punchStatus = null;       // كاش حالة البوابة من السيرفر
let _punchBusy = false;        // قفل منع النقر المزدوج أثناء الطلب
let _navRendered = false;

// ─── أدوات ───────────────────────────────────────────────────────────────────

function shellActive() {
    const role = window.STATE?.currentUser?.role;
    if (!role || !MOBILE_SHELL_ROLES.includes(role)) {return false;}
    if (window.MOBILE_UI_V2 === false) {return false;} // مفتاح الواجهة (من السيرفر)
    return window.matchMedia(MOBILE_BP).matches;
}

/** معرّف جهاز مستقر (L4 ربط الجهاز) — يولد مرة واحدة ويُحفظ محليًا */
function mobileDeviceId() {
    let id = null;
    try { id = localStorage.getItem('punch_device_id'); } catch (_) {}
    if (!id) {
        id = (window.crypto?.randomUUID
            ? window.crypto.randomUUID()
            : 'dev-' + Date.now() + '-' + Math.floor(Math.random() * 1e9));
        try { localStorage.setItem('punch_device_id', id); } catch (_) {}
    }
    return id;
}

// ─── شريط التنقل السفلي (FR-M1) ──────────────────────────────────────────────

/** مرشّحات الشريط: تُفلتر حسب قوائم الدور المسموحة (نفس صلاحيات go()) */
function mobileNavItems() {
    const role = window.STATE?.currentUser?.role;
    const menus = window.ROLES?.[role]?.menus || [];
    const items = [];
    const home = menus.includes('employee-portal') ? 'employee-portal' : menus[0];
    if (home) {items.push({ page: home, label: 'الرئيسية', icon: 'home', key: 'home' });}
    if (menus.includes('employee-portal')) {
        items.push({ page: 'employee-portal', label: 'بصمتي', icon: 'clock', key: 'punch', punch: true });
    }
    for (const cand of [['payroll', 'رواتبي', 'wallet'], ['leaves', 'طلبي', 'calendar'], ['dashboard', 'لوحتي', 'chart']]) {
        if (menus.includes(cand[0]) && cand[0] !== home) {
            items.push({ page: cand[0], label: cand[1], icon: cand[2], key: cand[0] });
        }
        if (items.length >= 4) {break;}
    }
    items.push({ page: '__more', label: 'المزيد', icon: 'menu', key: '__more' });
    return items;
}

function renderMobileNav() {
    if (!shellActive()) {
        document.body.classList.remove('mobile-shell-on');
        const nav = document.getElementById('mobileNav');
        if (nav) {nav.remove();}
        _navRendered = false;
        return;
    }
    document.body.classList.add('mobile-shell-on');
    let nav = document.getElementById('mobileNav');
    if (!nav) {
        nav = document.createElement('nav');
        nav.id = 'mobileNav';
        nav.className = 'mobile-nav';
        document.body.appendChild(nav);
    }
    const current = window.STATE?.page;
    let activeUsed = false;
    nav.innerHTML = mobileNavItems().map((it) => {
        // عنصر نشط واحد فقط — الصفحات المتعددة العناصر (بوابة/بصمتي) تُبرز أولها
        const active = it.page === current && !activeUsed ? (activeUsed = true, ' active') : '';
        return `<button type="button" class="mnav-item${active}" data-mpage="${it.page}" data-mkey="${it.key}"
                    aria-label="${it.label}"><i class="ji" data-i="${it.icon}"></i><span>${it.label}</span></button>`;
    }).join('');
    nav.querySelectorAll('.mnav-item').forEach((b) => {
        b.addEventListener('click', () => mobileNavClick(b));
    });
    _navRendered = true;
}

function mobileNavClick(el) {
    const page = el.dataset.mpage;
    if (page === '__more') {
        if (typeof window.toggleSidebar === 'function') {window.toggleSidebar();}
        return;
    }
    if (typeof window.go === 'function') {window.go(page, el);}
    if (el.dataset.mkey === 'punch') {
        setTimeout(() => {
            const card = document.getElementById('punchCard');
            if (card) {card.scrollIntoView({ behavior: 'smooth', block: 'start' });}
        }, 250);
    }
}

// ─── بطاقة البصمة الذاتية (S5) ───────────────────────────────────────────────

async function refreshPunchStatus() {
    try {
        const s = await window.apiFetch('/attendance/portal/status');
        _punchStatus = s || {};
        if (typeof s.mobileV2 === 'boolean') {window.MOBILE_UI_V2 = s.mobileV2;}
    } catch (_) {
        _punchStatus = _punchStatus || { enabled: false, hasEmployeeProfile: false };
    }
    return _punchStatus;
}

function punchCardHTML() {
    const s = _punchStatus || {};
    const enabled = Boolean(s.enabled) && Boolean(s.hasEmployeeProfile);
    const chip = enabled
        ? '<span class="punch-status-chip enabled">● البصمة الذاتية مفعّلة</span>'
        : '<span class="punch-status-chip disabled">● البصمة الذاتية غير متاحة حاليًا</span>';
    const btn = enabled
        ? `<button type="button" id="punchBtn" class="punch-btn">
             <i class="ji" data-i="clock"></i> تسجيل البصمة الآن
           </button>
           <div class="punch-meta">سيُثبّت وقت بصمتك من ساعة السيرفر — يلزم السماح بالموقع</div>
           <div id="punchResult" class="punch-result"></div>`
        : `<button type="button" id="punchBtn" class="punch-btn punch-btn-off" disabled>
             البصمة الذاتية غير مفعّلة بعد
           </button>
           <div class="punch-meta">${s.hasEmployeeProfile === false
               ? 'لم يتم ربط حسابك بملف موظف — تواصل مع الموارد البشرية'
               : 'سيُعلن عن تفعيلها من الإدارة'}</div>`;
    return `<div class="punch-card" id="punchCard">${chip}${btn}</div>`;
}

/** يُحقن بعد اكتمال رندر صفحة البوابة (يغلف window.renderPage) */
function injectPunchCard() {
    if (!shellActive() || window.STATE?.page !== 'employee-portal') {return;}
    const content = document.getElementById('content');
    if (!content || document.getElementById('punchCard')) {return;}
    content.insertAdjacentHTML('afterbegin', punchCardHTML());
    const btn = document.getElementById('punchBtn');
    if (btn && !btn.disabled) {btn.addEventListener('click', mobileDoPunch);}
}

async function mobileDoPunch(intent) {
    if (_punchBusy) {return;}
    const btn = document.getElementById('punchBtn');
    const resultBox = document.getElementById('punchResult');
    const setResult = (cls, text) => {
        if (!resultBox) {return;}
        resultBox.className = `punch-result ${cls}`;
        resultBox.textContent = text;
    };

    // FR-M6: لا وعد نجاح كاذب — فحص الاتصال أولًا
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        setResult('err', 'لا يوجد اتصال بالشبكة — اتصل بشبكة المطعم وأعد المحاولة');
        return;
    }
    // لو عطّلت الإدارة الجيوفانس فلا يُشترط الموقع (L1 الشبكة تبقى إلزامية بالسيرفر)
    const geofenceOn = _punchStatus ? Boolean(_punchStatus.geofence) : true;
    if (!navigator.geolocation && geofenceOn) {
        setResult('err', 'جهازك لا يدعم تحديد الموقع — البصمة الذاتية تتطلب الموقع');
        return;
    }

    _punchBusy = true;
    if (btn) {btn.disabled = true; btn.textContent = 'جارٍ تحديد موقعك…';}

    const finish = () => {
        _punchBusy = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="ji" data-i="clock"></i> تسجيل البصمة الآن';
        }
    };

    const sendPunch = async (locPayload) => {
        try {
            const payload = {
                deviceId: mobileDeviceId(),
                intent: intent || null, // نيّة الزر (in/out) — المحرك الذكي يقرر
                location: locPayload,
            };
            const res = await window.apiFetch('/attendance/portal/punch', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            const action = res?.action === 'check_in' ? '✅ تم تسجيل الحضور'
                : res?.action === 'check_out' ? '✅ تم تسجيل الانصراف'
                    : '✅ تم تسجيل البصمة';
            try {
                // مزامنة STATE المحلي من سجل السيرفر (نفس ما كان يفعله المسار القديم)
                if (res?.record && typeof window.upsertStateEntity === 'function') {
                    window.upsertStateEntity('attendance', res.record);
                }
                if (typeof window.renderPage === 'function' && window.STATE?.page) {
                    window.renderPage();
                }
            } catch (_) {}
            setResult('ok', action);
            if (window.toast) {window.toast(action, 'ok');}
        } catch (e) {
            // رسائل الرفض من السيرفر عربية وجاهزة (PUNCH_OUT_OF_RANGE…)
            setResult('err', '✋ ' + (e.message || 'تم رفض البصمة'));
            if (window.toast) {window.toast(e.message || 'تم رفض البصمة', 'error');}
        } finally {
            finish();
        }
    };

    const geolocationError = (err) => {
        finish();
        const msgs = {
            1: 'مُنِع الوصول للموقع — اسمح بتحديد الموقع من إعدادات المتصفح',
            2: 'تعذر تحديد موقعك — تأكد من تشغيل خدمة الموقع وانتظر إشارة جيدة',
            3: 'انتهت مهلة تحديد الموقع — حاول من مكان مفتوح',
        };
        setResult('err', msgs[err?.code] || 'تعذر تحديد الموقع');
        if (window.toast) {window.toast(msgs[err?.code] || 'تعذر تحديد الموقع', 'error');}
    };

    if (!geofenceOn) {
        await sendPunch(null); // الجيوفانس معطل إداريًا — L1 الشبكة يحمي السيرفر
        return;
    }
    navigator.geolocation.getCurrentPosition(async (pos) => {
        const fixAgeS = Math.max(0, Math.round((Date.now() - (pos.timestamp || Date.now())) / 1000));
        await sendPunch({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            fixAgeS,
            mocked: false,
        });
    }, geolocationError, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 });
}

// ─── التركيب والتهيئة (S4) ───────────────────────────────────────────────────

function mobileShellRefresh() {
    // تُستدعى بعد كل رندر صفحة — تضبط ظهور الشريط وحالة العنصر النشط
    renderMobileNav();
    injectPunchCard();
}

function initMobileShell() {
    // اللف حول go(): مزامنة حالة عنصر الشريط النشط بعد كل تنقل
    if (typeof window.go === 'function' && !window.go.__mobileWrapped) {
        const origGo = window.go;
        window.go = function (page, el) {
            const r = origGo.apply(this, arguments);
            try {renderMobileNav();} catch (_) {}
            return r;
        };
        window.go.__mobileWrapped = true;
    }
    // اللف حول renderPage(): حقن بطاقة البصمة بعد رندر صفحة البوابة
    if (typeof window.renderPage === 'function' && !window.renderPage.__mobileWrapped) {
        const origRenderPage = window.renderPage;
        window.renderPage = async function () {
            const r = await origRenderPage.apply(this, arguments);
            try {mobileShellRefresh();} catch (_) {}
            return r;
        };
        window.renderPage.__mobileWrapped = true;
    } else {
        // لو لم يوجد renderPage بعد (ترتيب التحميل) — مراقبة #content مباشرة
        const content = document.getElementById('content');
        if (content && !window.__mobileContentObserver) {
            window.__mobileContentObserver = new MutationObserver(() => {
                try {mobileShellRefresh();} catch (_) {}
            });
            window.__mobileContentObserver.observe(content, { childList: true });
        }
    }
    // لافتة عدم الاتصال (FR-M6)
    window.addEventListener('offline', () => document.body.classList.add('mobile-offline'));
    window.addEventListener('online', () => document.body.classList.remove('mobile-offline'));
    if (typeof navigator.onLine === 'boolean' && !navigator.onLine) {
        document.body.classList.add('mobile-offline');
    }
    // لافتة ثابتة في DOM (تصير مرئية بالـ CSS عند انقطاع الاتصال)
    if (!document.getElementById('mobileOfflineBar')) {
        const bar = document.createElement('div');
        bar.id = 'mobileOfflineBar';
        bar.className = 'mobile-offline-bar';
        bar.textContent = 'لا يوجد اتصال بالشبكة — البصمة والتحديثات لن تعمل';
        document.body.prepend(bar);
    }
    // دخول سريع لحالة البوابة (يحدّث MOBILE_UI_V2 إن أرسلها السيرفر)
    if (window.STATE?.currentUser?.id) {refreshPunchStatus();}
    mobileShellRefresh();
}

// التهيئة بعد اكتمال الجسور (bridges) — DOMC ينتظر اكتمال main.js TLA
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileShell);
} else {
    setTimeout(initMobileShell, 0);
}

export {
    initMobileShell,
    mobileShellRefresh,
    mobileDoPunch,
    mobileDeviceId,
    renderMobileNav,
    refreshPunchStatus,
};
