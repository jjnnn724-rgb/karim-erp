import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { V3_SCREENS } from '../../../src/lib/screens';
import { hasLiveCreds, SKIP_NO_CREDS } from '../../support/harness';

/**
 * مسح وصول (axe) لكل شاشات التطبيق بجلسة محفوظة — نفس عقد الحزمة العامة:
 * صفر مخالفات critical/serious.
 *
 * القائمة مشتقة من `V3_SCREENS` (مصدر الحقيقة الذي تعلنه القشرة) إضافةً إلى
 * الرئيسية `/`. كل شاشة اختبارٌ مستقل ليستفيد من التوازي وليظهر اسمها عند
 * الفشل. الشاشة المعطّلة على الخادم (وسم `v3-screens`) يحوّل رابطها
 * المباشر إلى القديم قبل تحميل التطبيق ⇒ تُتخطّى صراحةً لا تُعد فشلًا.
 *
 * الدخول من جلسة `storageState` المحفوظة (live-auth) — بلا استهلاك محاولات
 * تسجيل الدخول المحدودة على الخادم.
 */

const ROUTES: readonly { readonly name: string; readonly path: string }[] = [
    { name: 'الرئيسية', path: '/v3/' },
    ...V3_SCREENS.map((screen) => ({ name: screen, path: `/v3/${screen}` })),
];

test.describe('مسح الوصول — الشاشات بجلسة محفوظة', () => {
    test.skip(!hasLiveCreds, SKIP_NO_CREDS);

    for (const route of ROUTES) {
        test(`لا مخالفات وصول حرجة/كبرى — ${route.name}`, async ({ page }) => {
            await page.goto(route.path, { waitUntil: 'domcontentloaded' });
            if (!page.url().includes('/v3/')) {
                // التحويل إلى القديم حدث على الخادم ⇒ الشاشة معطّلة هنا.
                test.skip(true, 'الشاشة معطّلة على هذا الخادم (وسم v3-screens)');
            }
            await expect(page.locator('.erp-shell')).toBeAttached({ timeout: 60_000 });
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
