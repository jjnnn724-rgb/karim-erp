import { expect, test } from '@playwright/test';
import { hasCashierCreds, LIVE, login, SKIP_NO_CASHIER, watchConsole } from '../../support/harness';

/**
 * الكاشير — المسار الذهبي للبيع. يفتح وردية (كتابة على قاعدة التحقق)،
 * لذلك لا يعمل إلا بتأكيد صريح `V3_E2E_ALLOW_WRITES=1` وعلى خادم تحقق،
 * لا على الإنتاج.
 */

const ALLOW_WRITES = process.env.V3_E2E_ALLOW_WRITES === '1';

test.describe('الكاشير — POS', () => {
    test.skip(!hasCashierCreds, SKIP_NO_CASHIER);
    test.skip(!ALLOW_WRITES, 'يفتح وردية ويكتب طلبًا — يُفعَّل بـV3_E2E_ALLOW_WRITES=1 على قاعدة تحقق فقط');
    test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'لوحة الجوال فقط');
    // حساب الكاشير مختلف عن جلسة الإدارة المحفوظة.
    test.use({ storageState: { cookies: [], origins: [] } });

    test('الجوال: فتح وردية، إضافة صنف، وزر الإتمام في الشاشة', async ({ page }) => {
        const watch = watchConsole(page);
        await login(page, LIVE.cashierUser, LIVE.cashierPass);
        await page.goto('/v3/pos-entry', { waitUntil: 'domcontentloaded' });

        const add = page.getByRole('button', { name: /^إضافة .* إلى السلة$/ }).first();
        const openShift = page.getByRole('button', { name: 'فتح الوردية' });
        if (await openShift.isVisible().catch(() => false)) {
            const dept = page.getByRole('combobox', { name: 'القسم' });
            await expect(dept).toBeEnabled({ timeout: 30_000 });
            await dept.click();
            // Radix يركّب القائمة بحركة؛ النقر قبل استقرار موضعها يُغلقها بلا اختيار.
            await expect(page.getByRole('listbox')).toBeVisible();
            await page.waitForTimeout(350);
            const option = page.getByRole('option').first();
            const label = (await option.textContent())?.trim() ?? '';
            await option.click();
            await expect(dept).toContainText(label);
            await expect(openShift).toBeEnabled();
            await openShift.click();

            // فشل فتح الوردية (يوم مقفل، قسم غير مسموح) يظهر تنبيهًا صريحًا.
            await expect
                .poll(
                    async () =>
                        (await page
                            .getByRole('alert')
                            .isVisible()
                            .catch(() => false))
                            ? 'error'
                            : (await add.isEnabled().catch(() => false))
                              ? 'ready'
                              : 'pending',
                    { timeout: 45_000 },
                )
                .not.toBe('pending');
            const alert = page.getByRole('alert');
            if (await alert.isVisible().catch(() => false)) {
                throw new Error(`تعذّر فتح الوردية: ${(await alert.textContent())?.trim() ?? ''}`);
            }
        }

        await expect(add).toBeEnabled({ timeout: 45_000 });

        const cartPane = page.locator('.pos-entry__side');
        const cart = cartPane.locator('.pos-cart');
        const catalogTab = page.getByRole('tab', { name: 'الأصناف' });
        const cartTab = page.getByRole('tab', { name: /^السلة/ });

        // مسودة سلة محفوظة من تشغيل سابق (أو وردية قائمة) تُربك العدّ — نبدأ فارغين.
        await cartTab.click();
        await expect(cart).toBeVisible();
        const clear = cart.getByRole('button', { name: 'تفريغ السلة' });
        if (await clear.isEnabled().catch(() => false)) {
            await clear.click();
        }
        await expect(cart.locator('.pos-cart__line')).toHaveCount(0);
        await catalogTab.click();

        const itemName = (await add.getAttribute('aria-label'))?.replace(/^إضافة\s+/, '').replace(/\s+إلى السلة$/, '') ?? '';
        await add.click();
        await expect(cart.locator('.pos-cart__line')).toHaveCount(1, {
            timeout: 15_000,
        });

        await cartTab.click();
        await expect(cart).toBeVisible();
        if (itemName) {
            await expect(cart.locator('.pos-cart__line').first()).toContainText(itemName);
        }

        const complete = cart.getByRole('button', { name: 'إتمام البيع' });
        await expect(complete).toBeVisible();
        const box = await complete.boundingBox();
        const viewport = page.viewportSize();
        expect(box, 'زر الإتمام له صندوق').not.toBeNull();
        if (box && viewport) {
            expect(box.y, 'زر الإتمام أعلى الشاشة').toBeGreaterThanOrEqual(0);
            expect(box.y + box.height, 'زر الإتمام داخل الشاشة').toBeLessThanOrEqual(viewport.height);
        }

        expect(watch.errors).toEqual([]);
        watch.stop();
    });
});
