import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { horizontalOverflow, watchConsole } from '../../support/harness';

/**
 * الحزمة العامة — ما يجب أن يصحّ بلا API ولا جلسة:
 * الاتجاه، النموذج، التجاوب الأفقي، حالة الخطأ، والوصول.
 */

test.describe('بوابة الدخول — بلا جلسة', () => {
    test('تعرض النموذج بالعربية واتجاه RTL دون أخطاء كونسول', async ({ page }) => {
        const watch = watchConsole(page);
        await page.goto('/v3/', { waitUntil: 'domcontentloaded' });

        const username = page.locator('#erp-v3-username');
        await expect(username).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
        await expect(page.locator('label[for="erp-v3-username"]')).toHaveText('اسم المستخدم');
        await expect(page.locator('label[for="erp-v3-password"]')).toHaveText('كلمة المرور');
        await expect(page.getByRole('button', { name: 'دخول' })).toBeVisible();
        await expect(page.locator('.erp-login')).toBeVisible();

        expect(await horizontalOverflow(page), 'فائض أفقي على حساب الجذر').toBe(0);
        expect(watch.errors).toEqual([]);
        watch.stop();
    });

    test('البيانات الخاطئة تُظهر تنبيهًا عربيًا وتبقى على بوابة الدخول', async ({ page }) => {
        await page.goto('/v3/', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#erp-v3-username')).toBeVisible({
            timeout: 30_000,
        });

        await page.locator('#erp-v3-username').fill('e2e_no_such_user');
        await page.locator('#erp-v3-password').fill('e2e_no_such_password');
        await page.locator('form button[type="submit"]').click();

        const alert = page.getByRole('alert');
        await expect(alert).toBeVisible({ timeout: 20_000 });
        await expect(alert).toContainText('تأكد من بياناتك');
        await expect(page.locator('.erp-login')).toBeVisible();
        await expect(page.locator('.erp-shell')).toHaveCount(0);
    });

    test('لا مخالفات وصول حرجة أو كبرى على بوابة الدخول — الوضعان', async ({ page }) => {
        // الاثنان يُقاسان: الهوية تبدّل البدائيات في `.dark`، فقد يمرّ الفاتح ويفشل الداكن.
        for (const theme of ['light', 'dark'] as const) {
            await page.addInitScript((value) => {
                // نفس مفتاح `src/ui/theme.ts` — الوضع يُحفظ قبل أول رسم فتجنّب الوميض.
                window.localStorage.setItem('karim_theme_v1', value);
            }, theme);
            await page.goto('/v3/', { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#erp-v3-username')).toBeVisible({
                timeout: 30_000,
            });

            const isDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
            expect(isDark, `الوضع المطلوب: ${theme}`).toBe(theme === 'dark');

            const report = await new AxeBuilder({ page }).analyze();
            const blocking = report.violations.filter((violation) => violation.impact === 'critical' || violation.impact === 'serious');
            expect(
                blocking.map((violation) => `${violation.id}: ${violation.help}`),
                `مخالفات axe الحرجة/الكبرى (${theme})`,
            ).toEqual([]);
        }
    });
});
