import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(HERE, '../../../../../../docs/TRANSFORMATION/evidence/ui');

/** B2.4/B2.5 — فحص بصري عبر Playwright على dist الثابت (بلا API ولا جلسة). */
test.describe('G10 visual verification', () => {
    for (const [name, width, height] of [
        ['360', 360, 740],
        ['768', 768, 1024],
        ['1024', 1024, 768],
    ] as const) {
        test(`RTL + LTR @${name}px + keyboard`, async ({ page }) => {
            await page.setViewportSize({ width, height });
            await page.goto('/v3/', { waitUntil: 'domcontentloaded' });
            const user = page.locator('#erp-v3-username');
            await expect(user).toBeVisible({ timeout: 30_000 });
            await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

            await page.screenshot({ path: path.join(SHOTS, `login-rtl-${name}.png`), fullPage: true });

            await page.evaluate(() => {
                document.documentElement.dir = 'ltr';
                document.documentElement.lang = 'en';
            });
            await page.screenshot({ path: path.join(SHOTS, `login-ltr-${name}.png`), fullPage: true });

            await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
            await page.keyboard.press('Tab');
            const focused = await page.evaluate(() => ({
                tag: document.activeElement?.tagName,
                id: document.activeElement?.id,
            }));
            expect(['INPUT', 'BUTTON'].includes(String(focused.tag))).toBeTruthy();

            const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            expect(overflow).toBeLessThanOrEqual(2);
        });
    }
});
