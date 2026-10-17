/**
 * V2 — Shell extras · الجرس واللمبات واللغة والأزرار السريعة (W5)
 * ═══════════════════════════════════════════════════════════════════════
 * Mirrors the legacy shell chrome (index.html:55/76-101/187/208 + app.js
 * bell/FAB + auth-navigation toggleLang/password): notification bell for
 * admin (same doors), server/DB lamps from /health, AR/EN direction switch
 * on the same localStorage key (karim-i18n.js:32 — V2 screens stay Arabic-
 * first, the switch is shell-level), quick buttons (POS/menu/dispatch per
 * role), FAB with the same 4 role-gated actions, change-password dialog
 * with the same field names, offline bar on online/offline events.
 * Everything is additive: no legacy file is touched.
 */

import {
    NOTIF_ADMIN_ROLES, fetchNotifications, markNotificationsRead,
    markAllNotificationsRead, clearNotifications, fetchHealth, changePassword,
} from '../data/shell-repo.js?v=4.9.154';

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const HEALTH_MS = 60_000;
const NOTIF_MS = 60_000;

const FAB_ACTIONS = [
    { id: 'dashboard', label: 'لوحة التحكم', icon: 'chart', roles: ['admin', 'manager', 'hr', 'accountant', 'dept_head'] },
    { id: 'dispatch', label: 'طلب صرف', icon: 'package', roles: ['admin', 'manager', 'kitchen', 'sous_chef', 'dept_head', 'warehouse'] },
    { id: 'revenues', label: 'إضافة إيراد', icon: 'banknote', roles: ['admin', 'manager', 'accountant'] },
    { id: 'expenses', label: 'إضافة مصروف', icon: 'wallet', roles: ['admin', 'manager', 'accountant'] },
];

function currentLang() {
    try {return localStorage.getItem('karim_lang') || 'ar';}
    catch {return 'ar';}
}

/**
 * @param {{mountBoundary:(name:string, node:Node)=>void, navigate:(key:string)=>void, onToast?: (m:string)=>void}} shell
 * @param {{getRole:()=>string|null, getUserName:()=>string, isLive:()=>boolean}} [ctx]
 * @returns {{destroy:()=>void, refresh:()=>void}}
 */
export function mountShellExtras(shell, ctx = {}) {
    const getRole = typeof ctx.getRole === 'function' ? ctx.getRole : () => null;
    const toast = typeof ctx.onToast === 'function' ? ctx.onToast : (m) => console.info('[V2 shell]', m);
    /* Fixture mode (v2.html without ?live=1) must issue no request at all —
       contract line 77. Every network-backed extra (bell, health lamps and
       their timers) reads this door; the sign-in flips isLive() and the host
       calls refresh() again, so the same mount becomes live without remount. */
    const live = typeof ctx.isLive === 'function' ? ctx.isLive : () => false;

    const disposers = [];
    const on = (target, ev, fn) => {
        target.addEventListener(ev, fn);
        disposers.push(() => target.removeEventListener(ev, fn));
    };

    /* ── Language switch (same key as legacy) ─────────────────────────── */
    const langBtn = document.createElement('button');
    langBtn.type = 'button';
    langBtn.className = 'erp-btn erp-btn--sm';
    const paintLang = () => {
        const lang = currentLang();
        langBtn.innerHTML = `<i class="ji" data-i="globe" aria-hidden="true"></i><span>${lang === 'ar' ? 'EN' : 'عربي'}</span>`;
        langBtn.setAttribute('aria-label', lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية');
    };
    paintLang();
    on(langBtn, 'click', () => {
        const next = currentLang() === 'ar' ? 'en' : 'ar';
        try {localStorage.setItem('karim_lang', next);} catch { /* private mode */ }
        document.documentElement.lang = next;
        document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
        try {document.dispatchEvent(new CustomEvent('karim-lang-changed', { detail: { lang: next } }));} catch { /* noop */ }
        paintLang();
        toast(next === 'ar' ? 'الواجهة عربية (شاشات V2 عربية أولًا)' : 'Shell is English-ready (V2 screens stay Arabic-first)');
    });

    /* ── Health lamps ─────────────────────────────────────────────────── */
    const lamps = document.createElement('span');
    lamps.className = 'erp-shell__lamps';
    lamps.setAttribute('role', 'status');
    lamps.setAttribute('aria-label', 'حالة الخادم وقاعدة البيانات');
    const dot = (ok, label) => `<span class="erp-lamp" data-ok="${ok === true ? '1' : (ok === false ? '0' : 'x')}" title="${esc(label)}" aria-label="${esc(label)}"></span>`;
    async function paintHealth() {
        if (!live()) {return;}
        try {
            const h = await fetchHealth();
            lamps.innerHTML = `${dot(true, 'الخادم يعمل')}${dot(h.db, h.db === true ? 'قاعدة البيانات متصلة' : (h.db === false ? 'قاعدة البيانات لا تستجيب' : 'حالة القاعدة غير معلنة'))}`
                + `<span class="erp-text-sm erp-text-muted">${esc(h.status || '')}</span>`;
        } catch {
            lamps.innerHTML = `${dot(false, 'الخادم لا يستجيب')}${dot(null, 'غير معروف')}`;
        }
    }
    const healthTimer = setInterval(() => {
        if (!live() || document.hidden) {return;}
        paintHealth();
    }, HEALTH_MS);
    disposers.push(() => clearInterval(healthTimer));

    /* ── Notifications bell (admin only, like legacy) ─────────────────── */
    const bellWrap = document.createElement('span');
    bellWrap.className = 'erp-shell__bell';
    let notifTimer = null;
    let notifOpen = false;

    function bellHtml(unread) {
        return `<button type="button" class="erp-icon-btn" data-v2-bell aria-label="الإشعارات${unread ? ` (${unread} جديد)` : ''}">`
            + `<i class="ji" data-i="bell" aria-hidden="true"></i>`
            + (unread ? `<span class="erp-badge" data-tone="danger" data-v2-unread>${unread > 99 ? '99+' : unread}</span>` : '')
            + `</button><div data-v2-notif-panel hidden></div>`;
    }

    async function paintBell() {
        const isAdmin = NOTIF_ADMIN_ROLES.includes(String(getRole() || ''));
        if (!live() || !isAdmin) {bellWrap.innerHTML = ''; return;}
        let unread = 0;
        try {
            const n = await fetchNotifications();
            unread = n.unread;
        } catch { /* badge stays silent on failure */ }
        const wasOpen = notifOpen;
        bellWrap.innerHTML = bellHtml(unread);
        if (wasOpen) {openNotifPanel();}
    }

    async function openNotifPanel() {
        const panel = bellWrap.querySelector('[data-v2-notif-panel]');
        if (!panel) {return;}
        notifOpen = true;
        panel.hidden = false;
        panel.innerHTML = '<p class="erp-text-sm erp-text-muted">جارٍ التحميل…</p>';
        try {
            const n = await fetchNotifications();
            const items = n.list.map((x) => {
                const linked = x.link ? ` <span class="erp-text-sm erp-text-muted">← ${esc(x.link)}</span>` : '';
                return `<div class="erp-notif${x.read ? '' : ' erp-notif--unread'}" data-v2-notif="${esc(String(x.id))}" role="button" tabindex="0" title="فتح">`
                    + `<div><b>${esc(x.title)}</b>${x.read ? '' : ' <span class="erp-badge" data-tone="info">جديد</span>'}</div>`
                    + `<div class="erp-text-sm erp-text-muted">${esc(x.message || '')}${linked}</div></div>`;
            }).join('') || '<p class="erp-text-sm erp-text-muted">لا توجد إشعارات</p>';
            panel.innerHTML = `<div class="erp-notif-head"><b>الإشعارات${n.unread ? ` (${n.unread} جديد)` : ''}</b>`
                + `<span class="erp-grow"></span>`
                + `<button type="button" class="erp-btn erp-btn--sm" data-v2-notif-readall>تعليم الكل كمقروء</button>`
                + `<button type="button" class="erp-btn erp-btn--sm erp-btn--danger" data-v2-notif-clear>مسح الكل</button></div>`
                + `<div class="erp-notif-list">${items}</div>`;
            panel.scrollIntoView({ block: 'nearest' });
        } catch (e) {
            panel.innerHTML = `<p class="erp-text-sm erp-text-muted">${esc((e && e.message) || 'تعذر التحميل')}</p>`;
        }
    }

    function closeNotifPanel() {
        notifOpen = false;
        const panel = bellWrap.querySelector('[data-v2-notif-panel]');
        if (panel) {panel.hidden = true; panel.innerHTML = '';}
    }

    bellWrap.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-bell]')) {
            if (notifOpen) {closeNotifPanel();}
            else {await openNotifPanel();}
            return;
        }
        if (event.target.closest('[data-v2-notif-readall]')) {
            try {
                await markAllNotificationsRead();
                toast('تم تعليم كل الإشعارات كمقروءة');
                await paintBell();
                closeNotifPanel();
            } catch (e) {toast((e && e.message) || 'تعذر التعليم');}
            return;
        }
        if (event.target.closest('[data-v2-notif-clear]')) {
            try {
                await clearNotifications();
                toast('تم مسح جميع إشعاراتك');
                await paintBell();
                closeNotifPanel();
            } catch (e) {toast((e && e.message) || 'تعذر المسح');}
            return;
        }
        const item = event.target.closest('[data-v2-notif]');
        if (item) {
            const id = item.dataset.v2Notif;
            try {await markNotificationsRead([id]);} catch { /* badge refresh covers */ }
            closeNotifPanel();
            await paintBell();
        }
    });

    function startNotifPoll() {
        if (notifTimer) {clearInterval(notifTimer); notifTimer = null;}
        if (!live()) {return;}
        notifTimer = setInterval(() => {
            if (document.hidden || notifOpen) {return;}
            paintBell();
        }, NOTIF_MS);
    }
    disposers.push(() => { if (notifTimer) {clearInterval(notifTimer);} });

    /* ── Quick buttons: POS / menu boards / dispatch ──────────────────── */
    const quick = document.createElement('span');
    quick.className = 'erp-shell__quick';
    function paintQuick() {
        const role = String(getRole() || '');
        const posRoles = ['admin', 'accountant', 'cashier'];
        const disRoles = ['admin', 'manager', 'kitchen', 'sous_chef', 'dept_head', 'warehouse'];
        quick.innerHTML = ''
            + (posRoles.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="pos"><i class="ji" data-i="receipt" aria-hidden="true"></i><span>الكاشير</span></button>` : '')
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="menu-board"><i class="ji" data-i="eye" aria-hidden="true"></i><span>شاشات المنيو</span></button>`
            + (disRoles.includes(role) ? `<button type="button" class="erp-btn erp-btn--sm" data-v2-quick="dispatch"><i class="ji" data-i="package" aria-hidden="true"></i><span>طلب صرف</span></button>` : '');
    }
    quick.addEventListener('click', (event) => {
        const b = event.target.closest('[data-v2-quick]');
        if (!b) {return;}
        const k = b.dataset.v2Quick;
        if (k === 'pos') {window.open('/app/pos.html', '_blank'); return;}
        shell.navigate(k);
    });

    /* ── FAB: the same 4 role-gated actions ───────────────────────────── */
    const fabHost = document.createElement('div');
    fabHost.className = 'erp-fab-host';
    let fabOpen = false;
    function paintFab() {
        const role = String(getRole() || '');
        const items = FAB_ACTIONS.filter((a) => a.roles.includes(role));
        if (!items.length) {fabHost.innerHTML = ''; return;}
        fabHost.innerHTML = `<button type="button" class="erp-fab" data-v2-fab aria-label="إجراءات سريعة" aria-expanded="${fabOpen}">+</button>`
            + `<div class="erp-fab-menu" data-v2-fab-menu${fabOpen ? '' : ' hidden'}>`
            + items.map((a) => `<button type="button" class="erp-fab-action" data-v2-fab-go="${a.id}"><i class="ji" data-i="${a.icon}" aria-hidden="true"></i><span>${esc(a.label)}</span></button>`).join('')
            + `</div>`;
    }
    fabHost.addEventListener('click', (event) => {
        if (event.target.closest('[data-v2-fab]')) {
            fabOpen = !fabOpen;
            paintFab();
            return;
        }
        const go = event.target.closest('[data-v2-fab-go]');
        if (go) {
            fabOpen = false;
            paintFab();
            shell.navigate(go.dataset.v2FabGo);
        }
    });

    /* ── Change password ──────────────────────────────────────────────── */
    const pwBtn = document.createElement('button');
    pwBtn.type = 'button';
    pwBtn.className = 'erp-btn erp-btn--sm';
    pwBtn.innerHTML = '<i class="ji" data-i="key" aria-hidden="true"></i><span>تغيير كلمة المرور</span>';
    pwBtn.setAttribute('aria-label', 'تغيير كلمة المرور');
    /* `.erp-v2 .erp-pop` only matches through an ancestor carrying .erp-v2, and
       this host is appended to document.body — outside #erp-v2-root. Without the
       class the rule is dead and the panel paints as unstyled HTML at the bottom
       of the document (same scope defect, same remedy as toast.js:108 and
       overlay.js:114). .erp-v2 paints --erp-background, but the host stays
       zero-height here: its only child is position:fixed. */
    const pwPanelHost = document.createElement('div');
    pwPanelHost.className = 'erp-v2';
    on(pwBtn, 'click', () => {
        if (pwPanelHost.isConnected) {pwPanelHost.remove(); return;}
        pwPanelHost.innerHTML = `<div class="erp-pop"><h4>تغيير كلمة المرور</h4>`
            + `<label class="erp-text-sm erp-text-muted">الحالية<input class="erp-input" type="password" data-v2-pw="cur" autocomplete="current-password"></label>`
            + `<label class="erp-text-sm erp-text-muted">الجديدة (8+ حرف ورقم)<input class="erp-input" type="password" data-v2-pw="next" autocomplete="new-password"></label>`
            + `<div class="erp-text-sm" style="color:var(--erp-danger-text)" data-v2-pw-err role="alert"></div>`
            + `<div class="erp-dash-controls"><button type="button" class="erp-btn erp-btn--primary erp-btn--sm" data-v2-pw-go>حفظ</button>`
            + `<button type="button" class="erp-btn erp-btn--sm" data-v2-pw-x>إلغاء</button></div></div>`;
        document.body.appendChild(pwPanelHost);
    });
    pwPanelHost.addEventListener('click', async (event) => {
        if (event.target.closest('[data-v2-pw-x]')) {pwPanelHost.remove(); return;}
        if (!event.target.closest('[data-v2-pw-go]')) {return;}
        const cur = pwPanelHost.querySelector('[data-v2-pw="cur"]')?.value || '';
        const next = pwPanelHost.querySelector('[data-v2-pw="next"]')?.value || '';
        const err = pwPanelHost.querySelector('[data-v2-pw-err]');
        if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) {
            if (err) {err.textContent = 'الجديدة ضعيفة: 8 حروف على الأقل مع حرف ورقم';}
            return;
        }
        try {
            await changePassword({ current_password: cur, new_password: next });
            pwPanelHost.remove();
            toast('تم تغيير كلمة المرور');
        } catch (e) {
            if (err) {err.textContent = (e && e.message) || 'تعذر التغيير';}
        }
    });
    disposers.push(() => pwPanelHost.remove());

    /* ── Offline bar ──────────────────────────────────────────────────── */
    const offBar = document.createElement('div');
    offBar.className = 'erp-offline-bar';
    offBar.setAttribute('role', 'status');
    offBar.hidden = navigator.onLine !== false;
    offBar.innerHTML = '<span>لا يوجد اتصال — التغييرات المحفوظة محليًا ستُرسل عند عودة الشبكة</span>';
    const goOff = () => {offBar.hidden = false;};
    const goOn = () => {offBar.hidden = true; toast('عاد الاتصال');};
    on(window, 'offline', goOff);
    on(window, 'online', goOn);
    document.body.appendChild(offBar);
    disposers.push(() => offBar.remove());

    /* ── Mount + refresh ──────────────────────────────────────────────── */
    try {shell.mountBoundary('notifications', bellWrap);} catch { /* host decides */ }
    try {
        const actions = shell.root && shell.root.querySelector('.erp-shell__actions');
        const themeSlot = shell.root && shell.root.querySelector('[data-erp-theme-slot]');
        if (actions) {
            const cluster = document.createElement('span');
            cluster.className = 'erp-shell__extras';
            cluster.append(lamps, langBtn, quick, pwBtn);
            actions.insertBefore(cluster, themeSlot || null);
            disposers.push(() => cluster.remove());
        }
    } catch { /* header layout is the shell's own */ }
    document.body.appendChild(fabHost);

    function refresh() {
        paintLang();
        paintQuick();
        paintFab();
        if (!live()) {
            bellWrap.innerHTML = '';
            lamps.innerHTML = '';
            startNotifPoll();
            return;
        }
        paintBell();
        paintHealth();
        startNotifPoll();
    }
    refresh();

    return {
        refresh,
        destroy() {
            disposers.forEach((fn) => { try {fn();} catch { /* detached */ } });
            try {bellWrap.remove();} catch { /* noop */ }
            try {fabHost.remove();} catch { /* noop */ }
        },
    };
}
