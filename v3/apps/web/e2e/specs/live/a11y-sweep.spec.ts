import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { V3_SCREENS } from '../../../src/lib/screens';
import { hasLiveCreds, login, SKIP_NO_CREDS } from '../../support/harness';

/**
 * مسح وصول (axe) لكل شاشات التطبيق — نفس عقد الحزمة العامة:
 * صفر مخالفات critical/serious.
 *
 * القائمة مشتقة من `V3_SCREENS` (مصدر الحقيقة الذي تعلنه القشرة) إضافةً إلى
 * الرئيسية `/`. كل شاشة اختبارٌ مستقل ليستفيد من التوازي وليظهر اسمها عند
 * الفشل. الشاشة المعطّلة على الخادم (وسم `v3-screens`) يحوّل رابطها
 * المباشر إلى القديم قبل تحميل التطبيق ⇒ تُتخطّى صراحةً لا تُعد فشلًا.
 *
 * دخول مستقل لكل اختبار (نمط pos/session): جلسة storageState المشتركة كانت
 * تُبطل نفسها — مفتاح التطبيق في الذاكرة فقط، وأول اختبار يدوّر رمز التحديث
 * المشترك فتفشل بقية الاختبارات بكشف إعادة الاستخدام (سلوك أمني صحيح).
 * خادم التحقق يرفع RATE_LIMIT_AUTH_MAX لذلك فقط؛ الإنتاج يبقى 20/15د.
 */

const ROUTES: readonly { readonly name: string; readonly path: string }[] = [
    { name: 'الرئيسية', path: '/v3/' },
    ...V3_SCREENS.map((screen) => ({ name: screen, path: `/v3/${screen}` })),
];

test.describe('مسح الوصول — الشاشات بجلسة محفوظة', () => {
    test.skip(!hasLiveCreds, SKIP_NO_CREDS);
    test.use({ storageState: { cookies: [], origins: [] } });

    test.beforeEach(async ({ page }) => {
        await login(page);
    });

    for (const route of ROUTES) {
        test(`لا مخالفات وصول حرجة/كبرى — ${route.name}`, async ({ page }) => {
            await page.goto(route.path, { waitUntil: 'domcontentloaded' });
            if (!page.url().includes('/v3/')) {
                // التحويل إلى القديم حدث على الخادم ⇒ الشاشة معطّلة هنا.
                test.skip(true, 'الشاشة معطّلة على هذا الخادم (وسم v3-screens)');
            }
            // نقطة البيع شاشة ملء مستقلة بلا قشرة (body.pos-cashier-fullscreen).
            const root =
                route.name === 'pos-entry' ? page.locator('body.pos-cashier-fullscreen') : page.locator('.erp-shell');
            await expect(root).toBeAttached({ timeout: 60_000 });
            // نفس استقرار الحزمة الحية: مهلة قصيرة كي تستقر الشبكة قبل القياس.
            await page.waitForTimeout(1_500);

            const report = await new AxeBuilder({ page }).analyze();
            const blocking = report.violations.filter(
                (violation) => violation.impact === 'critical' || violation.impact === 'serious',
            );
            expect(
                blocking.map((violation) => `${violation.id}: ${violation.help}`),
                `مخالفات axe الحرجة/الكبرى — ${route.path}`,
            ).toEqual([]);
        });
    }
});
