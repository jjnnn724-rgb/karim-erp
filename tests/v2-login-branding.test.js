const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const LOGIN = path.join(APP, 'js', 'v2', 'screens', 'login.js');
const AUTH_CSS = path.join(APP, 'css', 'v2', 'erp-auth.css');

describe('V2 login branding', () => {
    test('shows the restaurant logo centered above the sign-in title', () => {
        const template = fs.readFileSync(LOGIN, 'utf8');
        expect(template).toMatch(/class="erp-login-brand">[\s\S]*?<img class="erp-login-logo" src="assets\/al-shurfa-logo\.png" alt="مطاعم الشرفة العالمي">[\s\S]*?<h1 class="erp-login-title"/);
        expect(fs.existsSync(path.join(APP, 'assets', 'al-shurfa-logo.png'))).toBe(true);
    });

    test('keeps the logo contained within a balanced responsive size', () => {
        const css = fs.readFileSync(AUTH_CSS, 'utf8');
        expect(css).toMatch(/\.erp-v2 \.erp-login-logo\s*\{[^}]*inline-size:\s*min\(100%,\s*144px\)[^}]*block-size:\s*112px[^}]*object-fit:\s*contain[^}]*object-position:\s*center/s);
        expect(css).not.toContain('.erp-login-mark');
    });
});
