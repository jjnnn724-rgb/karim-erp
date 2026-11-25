import { expect, test } from '@playwright/test';
import { enter, hasLiveCreds, horizontalOverflow, login, SKIP_NO_CREDS, watchConsole } from '../../support/harness';

/**
 * الدخول والقشرة على الخادم الحي.
 *
 * اختبار دخول واحد فقط يمرّ على النموذج الحقيقي (سياسة الخادم: 10 محاولات
 * كل 15 دقيقة)، والباقي يستأنف من جلسة `storageState` المحفوظة.
 */

test.describe('الدخول الحي', () => {
    test.skip(!hasLiveCreds, SKIP_NO_CREDS);
    test.use({ storageState: { cookies: [], origins: [] } });

    test('النموذج الحقيقي يوصل إلى القشرة بلا أخطاء', async ({ page }) => {
        const watch = watchConsole(page);
        await login(page);

        await expect(page.locator('.erp-shell')).toBeVisible();
        await expect(page.locator('#erp-v3-username')).toHaveCount(0);
        expect(await horizontalOverflow(page), 'فائض أفقي').toBe(0);
        expect(watch.errors).toEqual([]);
        watch.stop();
    });
});

test.describe('القشرة — جلسة محفوظة', () => {
    test.skip(!hasLiveCreds, SKIP_NO_CREDS);

    test('تستقر بلا أخطاء كونسول ولا فائض أفقي', async ({ page }) => {
        const watch = watchConsole(page);
        await enter(page, '/v3/');

        await expect(page.locator('.erp-shell')).toBeVisible();
        await expect(page.locator('main')).toBeVisible();
        expect(await horizontalOverflow(page), 'فائض أفقي').toBe(0);
        expect(watch.errors).toEqual([]);
        watch.stop();
    });

    test('التنقل بين شاشتين لا يُسقط القشرة', async ({ page }) => {
        const watch = watchConsole(page);
        await enter(page, '/v3/employees');
        await expect(page.getByRole('heading', { name: /الموظف/ }).first()).toBeVisible({ timeout: 45_000 });

        await enter(page, '/v3/dispatch');
        await expect(page.locator('.erp-shell')).toBeVisible();
        await expect(page.getByRole('button', { name: 'طلب صرف جديد' }).first()).toBeVisible({ timeout: 45_000 });

        expect(watch.errors).toEqual([]);
        watch.stop();
    });
});
