import { mountLoginScreen } from '/app/js/v2/screens/login.js?v=4.9.156';
import { mountPosEntryScreen } from '/app/js/v2/screens/pos-entry.js?v=4.9.156';
import { installApiFetchBridge } from '/app/js/v2/session.js?v=4.9.156';

const ALLOWED_ROLES = ['admin', 'manager', 'accountant', 'cashier'];
const app = document.getElementById('cashier-app');
const main = app.querySelector('[data-cashier-main]');
const notice = app.querySelector('[data-cashier-notice]');
const logoutButton = app.querySelector('[data-cashier-logout]');
const installButton = app.querySelector('[data-cashier-install]');
let mountedScreen = null;
let pendingInstall = null;

installApiFetchBridge();

function setNotice(message = '') {
    notice.textContent = message;
}

function clearMountedScreen() {
    if (mountedScreen) {
        mountedScreen.destroy();
        mountedScreen = null;
    }
}

function showLogin() {
    clearMountedScreen();
    logoutButton.hidden = true;
    setNotice('');
    mountedScreen = mountLoginScreen(main, {
        onSuccess: showCashier,
    });
}

function showCashier(session) {
    const role = String(session?.role || session?.user?.role || '');
    if (!ALLOWED_ROLES.includes(role)) {
        clearMountedScreen();
        logoutButton.hidden = false;
        main.innerHTML = '<section class="erp-card cashier-app-access"><div class="erp-card__body erp-stack"><h2 class="erp-card__title">هذا الحساب لا يملك صلاحية الكاشير</h2><p class="erp-text-sm erp-text-muted">سجّل الدخول بحساب كاشير أو حساب إداري مخوّل.</p><button class="erp-btn erp-btn--primary" type="button" data-cashier-back-login>العودة لتسجيل الدخول</button></div></section>';
        main.querySelector('[data-cashier-back-login]').addEventListener('click', showLogin, { once: true });
        return;
    }

    clearMountedScreen();
    setNotice('');
    logoutButton.hidden = false;
    main.replaceChildren();
    mountedScreen = mountPosEntryScreen(main, {
        role,
        userId: session?.user?.id ?? null,
        userName: String(session?.user?.name || session?.user?.username || ''),
        embeddedPos: true,
        featureFlags: { embeddedPos: true, salesEnabled: true },
        notify: setNotice,
        confirmFn: (message) => window.confirm(message),
    });
}

logoutButton.addEventListener('click', () => {
    clearMountedScreen();
    window._jwt = null;
    window._appKey = null;
    if (typeof window.KARIM_RTclear === 'function') {window.KARIM_RTclear();}
    showLogin();
    setNotice('تم تسجيل الخروج من هذا الجهاز.');
});

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pendingInstall = event;
    installButton.hidden = false;
});

installButton.addEventListener('click', async () => {
    if (!pendingInstall) {return;}
    installButton.disabled = true;
    try {
        await pendingInstall.prompt();
        await pendingInstall.userChoice;
    } catch (error) {
        console.warn('[Cashier PWA] install prompt unavailable:', error);
    } finally {
        pendingInstall = null;
        installButton.hidden = true;
        installButton.disabled = false;
    }
});

window.addEventListener('appinstalled', () => {
    pendingInstall = null;
    installButton.hidden = true;
});

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/app/cashier/sw.js', { scope: '/app/cashier/' })
        .catch((error) => console.error('[Cashier PWA] service worker registration failed:', error));
}

showLogin();
