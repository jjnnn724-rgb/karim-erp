/**
 * V2 mode banner and app version fallback must not claim a mode or version
 * that differs from the code the page actually runs.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const html = fs.readFileSync(path.join(APP, 'v2.html'), 'utf8');
const preview = fs.readFileSync(path.join(APP, 'js', 'v2', 'preview.js'), 'utf8');
const index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(APP, 'js', 'core', 'config.js'), 'utf8');

describe('V2 mode and version indicators', () => {
    test('V2 starts with a neutral notice until the session mode is resolved', () => {
        expect(html).toContain('id="v2ModeLabel"');
        expect(html).toContain('id="v2ModeDescription"');
        expect(html).not.toContain('<title>KARIM ERP — V2 (معاينة)</title>');
        expect(html).not.toContain('<span><em>بيانات تجريبية</em> — لا تحفظ تغييرات.</span>');
    });

    test('the notice distinguishes sample, pending, unauthenticated, and live states', () => {
        expect(preview).toMatch(/function updateModeBanner\(\)/);
        expect(preview).toContain("mode = 'معاينة'");
        expect(preview).toContain("mode = 'التحقق من الجلسة'");
        expect(preview).toContain("mode = 'يتطلب تسجيل الدخول'");
        expect(preview).toContain("mode = 'جلسة حية'");
        expect(preview).toMatch(/updateModeBanner\(\);\s*if \(s\)/);
    });

    test('login fallback version matches the application version', () => {
        const appVersion = (config.match(/VERSION:\s*'([^']+)'/) || [])[1];
        const fallbackVersion = (index.match(/id="loginVersion"[^>]*>([^<]+)</) || [])[1];
        expect(appVersion).toBeTruthy();
        expect(fallbackVersion).toBe(appVersion);
    });
});
