/**
 * V2 mode and app version fallback must not claim a mode or version
 * that differs from the code the page actually runs.
 *
 * 2026-10-21 — شريط الوضع فوق الصفحة أُزيل بطلب المالك («يتطلب تسجيل
 * الدخول» · «لن تظهر بيانات النظام الحية…» · «إعادة فتح الوضع الحي»).
 * الفرق بين المعاينة والحيّة لم يُلغَ: صار في عنوان التبويب، ورابط
 * «النظام الحالي» انتقل إلى مركز التحكّم (لكل الأدوار).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const html = fs.readFileSync(path.join(APP, 'v2.html'), 'utf8');
const preview = fs.readFileSync(path.join(APP, 'js', 'v2', 'preview.js'), 'utf8');
const extras = fs.readFileSync(path.join(APP, 'js', 'v2', 'layout', 'shell-extras.js'), 'utf8');
const index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(APP, 'js', 'core', 'config.js'), 'utf8');

describe('V2 mode and version indicators', () => {
    test('لا شريط وضع في أعلى الصفحة — الفرق يُقرأ من عنوان التبويب', () => {
        expect(html).not.toContain('id="v2ModeLabel"');
        expect(html).not.toContain('id="v2ModeDescription"');
        expect(html).not.toContain('id="v2LiveLink"');
        expect(html).not.toContain('erp-preview-banner');
        expect(preview).not.toContain('v2ModeLabel');
        expect(preview).not.toContain('v2LiveLink');
    });

    test('نصوص شريط الوضع المحذوف لا تعود (ولا منقولة إلى مكان آخر)', () => {
        expect(preview).not.toContain('يتطلب تسجيل الدخول');
        expect(preview).not.toContain('لن تظهر بيانات النظام الحية');
        expect(preview).not.toContain('إعادة فتح الوضع الحي');
        expect(html).not.toContain('يتطلب تسجيل الدخول');
    });

    test('الوضع في العنوان وحده: معاينة / تحقّق / حيّة', () => {
        expect(preview).toMatch(/function updateModeTitle\(\)/);
        expect(preview).toContain("mode = 'معاينة'");
        expect(preview).toContain("mode = 'التحقق من الجلسة'");
        expect(preview).toContain("mode = 'جلسة حية'");
        expect(preview).toMatch(/document\.title = \(screen \? `\$\{screen\} — ` : ''\) \+ `KARIM ERP — V2 \(\$\{mode\}\)`/);
        // اسم الشاشة يسبق الوضع: تبويبان على شاشتين لا يحملان عنوانًا واحدًا.
        expect(preview).toMatch(/titleKey = key;\s*\n\s*updateModeTitle\(\);/);
    });

    test('«النظام الحالي» انتقل إلى مركز التحكّم — لكل الأدوار لا للأدمن وحده', () => {
        expect(extras).toContain('index.html');
        expect(extras).toContain('النظام الحالي');
        expect(extras).toMatch(/legacySection/);
    });

    test('login fallback version matches the application version', () => {
        const appVersion = (config.match(/VERSION:\s*'([^']+)'/) || [])[1];
        const fallbackVersion = (index.match(/id="loginVersion"[^>]*>([^<]+)</) || [])[1];
        expect(appVersion).toBeTruthy();
        expect(fallbackVersion).toBe(appVersion);
    });
});
