/**
 * tests/e2e/v2-shell.spec.js — قشرة V2 تُقلع بلا خطأ واحد
 * ══════════════════════════════════════════════════════════════════════
 * لماذا: عقد Jest تقرأ المصدر، وE2E تقرأ السلوك — وقشرة V2 Réunion
 * (وحدة ESM) لا يُكتشف خطأ إقلاعها إلا في متصفح حقيقي. يوم 2026-10-21
 * رمت preview.js استثناءً (نطاق زمني ميت: ‎aiAssistant‎ مستعمل قبل إعلانه)
 * ⇒ قُتلت كل الشاشة والقوائم في الفراغ، وCI لم يرَ ذلك لأن E2E لم يفتح
 * صفحة V2 أصلًا. فصار هذا الاختبار الحارس: أي خطأ JS في إقلاع القشرة
 * يوقف البناء.
 *
 * القاعدة: صفر أخطاء JS. استثناء واحد: مخالفات CSP من سكربت Cloudflare
 * الخارجي (ليست من كودنا).
 */
const { test, expect } = require('@playwright/test');

const EXTERNAL = /Content Security Policy|cloudflareinsights|Refused to (execute|load)/i;

test.describe('V2 shell boots clean', () => {
    test('صفحة V2: القشرة تُرسَم ولا خطأ JS واحد', async ({ page }) => {
        const errors = [];
        page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message ? e.message : e)));
        page.on('console', (m) => { if (m.type() === 'error') { errors.push('console: ' + m.text()); } });

        const res = await page.goto('/app/v2.html', { waitUntil: 'domcontentloaded' });
        expect(res, 'صفحة V2 لم تُفتح').toBeTruthy();
        expect(res.ok(), 'صفحة V2 لم تردّ 200').toBeTruthy();

        // القشرة مرسومة فعلًا (وليس html فارغًا بعد موت السكربت)
        await expect(page.locator('.erp-shell__header')).toBeVisible({ timeout: 25_000 });
        await expect(page.locator('#erp-v2-root')).toBeVisible({ timeout: 25_000 });

        // شريط الوضع اختفى من أعلى الصفحة (طلب المالك 2026-10-21)
        await expect(page.locator('.erp-preview-banner')).toHaveCount(0);

        const ours = errors.filter((t) => !EXTERNAL.test(t));
        expect(ours, 'أخطاء JS في صفحة V2:\n' + ours.join('\n')).toEqual([]);
    });
});
