/**
 * login-surface.test.js — واجهة الدخول والهوية العلوية
 * ═══════════════════════════════════════════════════════════════════════
 * صفحة الدخول القديمة هي ما يراه المستخدم فعلًا (V2 بلا جلسة يوجّه إليها)،
 * لذلك أُعيد بناؤها بصريًا مع الحفاظ على كل معرّف وdata-karim-action يقود
 * السلوك. وشعار الترويسة صار الرمز المختصر النقي بدل القفل الكامل غير
 * المقروء في 46px، مع إخفاء زرّي الدرج على سطح المكتب بنفس نوعية المحدّد.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const INDEX = read('index.html');
const STYLES = read('css/styles.css');
const SHELL_CSS = read('css/v2/erp-shell.css');
const LAYOUT = read(path.join('js', 'v2', 'layout', 'app-layout.js'));

describe('صفحة الدخول', () => {
    test('لوحة هوية + بطاقة نموذج، وكل معرّفات السلوك باقية', () => {
        expect(INDEX).toContain('<div class="login-shell">');
        expect(INDEX).toContain('<aside class="login-aside">');
        expect(INDEX).toContain('class="login-brand"');
        for (const id of ['loginLogo', 'loginTitle', 'loginSub', 'loginVersion', 'lu', 'lp', 'lpEye', 'lerr', 'capsWarn', 'loginBtn', 'pwaInstallBtn']) {
            expect(INDEX).toContain(`id="${id}"`);
        }
        expect(INDEX).toContain('data-karim-action="toggleLoginPassword"');
        expect(INDEX).toContain('data-karim-action="showForgotPasswordModal"');
        expect(INDEX).toContain('data-karim-action="pwaInstall"');
    });

    test('الشعار داخل حدوده بلا قصّ (لا object-fit: cover)', () => {
        expect(STYLES).toMatch(/\.login-logo img,\.login-brand-logo\{[^}]*object-fit:contain/);
        expect(STYLES).not.toMatch(/\.login-brand-logo\{[^}]*object-fit:cover/);
        expect(STYLES).toContain('.login-shell{');
        expect(STYLES).toContain('grid-template-columns:minmax(0,1.06fr) minmax(0,.94fr)');
    });

    test('قاعدة الإيقاف المؤقت لم تُمسّ', () => {
        expect(STYLES).toContain('body.legacy-sunset-on #login{padding-top:calc(20px + var(--sunset-h))}');
    });
});

describe('ترويسة V2', () => {
    test('الرمز المختصر هو شعار الترويسة', () => {
        expect(LAYOUT).toContain('src="assets/al-shurfa-mark.png"');
        expect(fs.existsSync(path.join(APP, 'assets', 'al-shurfa-mark.png'))).toBe(true);
    });

    test('زرّا الدرج مخفيان على سطح المكتب بنفس نوعية .erp-v2 .erp-icon-btn', () => {
        expect(SHELL_CSS).toContain('.erp-v2 .erp-shell__drawer-open { display: none; }');
        expect(SHELL_CSS).toContain('.erp-v2 .erp-shell__drawer-close { display: none; }');
        const wide = SHELL_CSS.slice(SHELL_CSS.indexOf('@media (max-width: 1024px)'));
        expect(wide).toContain('.erp-v2 .erp-shell__drawer-open,');
        expect(wide).toContain('.erp-v2 .erp-shell__drawer-close { display: inline-flex; }');
    });
});
