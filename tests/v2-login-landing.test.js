/**
 * v2-login-landing.test.js — أول صفحة بعد الدخول ليست بطاقة انتظار أبدية
 * ═══════════════════════════════════════════════════════════════════════
 * الحادثة (2026-10-23): بعد الدخول من شاشة V2 بقيت لوحة التحكم على
 * «جارٍ قراءة أرقام اليوم…» إلى الأبد. السبب: onSessionReady نادى
 * renderScreen(back) وليس applyKey(back) عندما يكون التوجيه بالهاش مطفأً،
 * فبقي navStatus.current = 'login'، وحارس لوحة المتابعة الحية
 * (`if (navStatus.current !== 'dashboard') return;`) خرج قبل التركيب.
 *
 * العقد: كل انتقال بعد الدخول يمرّ بـ applyKey — وهو المكان الوحيد الذي
 * يزامن الحالة والتنقل والرسم (والهاش فقط عند تفعيل التوجيه).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PREVIEW = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'preview.js'), 'utf8');

function sessionReadyBody() {
    const start = PREVIEW.indexOf('function onSessionReady(info) {');
    const end = PREVIEW.indexOf('\nfunction doV2Logout()', start);
    return PREVIEW.slice(start, end);
}

describe('V2 first page after sign-in', () => {
    test('sign-in always routes through applyKey so navStatus leaves login', () => {
        const body = sessionReadyBody();
        expect(body).toContain('applyKey(back);');
        expect(body).not.toContain('else {renderScreen(back);}');
    });

    test('the live dashboard guard can only see the dashboard key', () => {
        const dashboard = PREVIEW.slice(
            PREVIEW.indexOf('if (isDashboard && isLive())'),
            PREVIEW.indexOf('if (isDashboard) {'),
        );
        expect(dashboard).toContain("if (navStatus.current !== 'dashboard') {return;}");
        // applyKey sets the key before renderScreen, so the guard passes.
        expect(PREVIEW).toContain('function applyKey(key) {');
        expect(PREVIEW).toContain('navStatus.current = key;');
    });

    test('the tab title follows the session, not only ?live=1', () => {
        const start = PREVIEW.indexOf('function updateModeTitle() {');
        // نهاية الدالة أول سطرٍ يُغلق على مستواه، لا أول نداء لها (applyKey
        // يناديها قبله في الملف).
        const body = PREVIEW.slice(start, PREVIEW.indexOf('\n}', start));
        expect(body).toContain("sessionState.status === 'ready'");
        expect(body.indexOf("sessionState.status === 'ready'")).toBeLessThan(body.indexOf("sessionState.status === 'pending'"));
        expect(body).not.toContain("if (!LIVE || sessionState.status === 'none')");
        expect(sessionReadyBody()).toContain('updateModeTitle();');
    });
});
