/**
 * tests/e2e/menu-board.spec.js — شاشة المنيو العامة (التوتيم) في متصفح حقيقي.
 * تتوافق مع DOM نسخة v5.16 ثنائية اللغة (logo + زر تبديل اللغة).
 */
const { test, expect } = require('@playwright/test');

test.describe('شاشة عرض المنيو (Totem)', () => {

    test.beforeEach(async ({ page }) => {
        await page.goto('/menu');
        // المسرح نفسه — أثبت أن HTML+CSS حُمّلا فعلًا
        await expect(page.locator('#stage')).toBeVisible();
    });

    test('هوية العلامة: اسم الشرفه وشعارها وزر اللغة', async ({ page }) => {
        await expect(page.locator('.status-brand')).toContainText('AL-SHORFA AL ALAMI');
        const logo = page.locator('.brand-logo img');
        await expect(logo).toHaveCount(1);
        await expect(logo).toBeVisible();
        await expect(page.locator('#languageToggle')).toBeVisible();
    });

    test('كبسولات الفترات الثلاث بحالتها الفعلية', async ({ page }) => {
        await expect(page.locator('.period-strip .period')).toHaveCount(3);
        await expect(page.locator('.period[data-period="lunch"]')).toBeVisible();
        await expect(page.locator('#hoursBreakfast')).toContainText(':');
    });

    test('الساعة وشريط الاتصال والحالة الحيّة', async ({ page }) => {
        await expect(page.locator('#clockTime')).toBeVisible();
        const conn = page.locator('#connState');
        await expect(conn).toBeVisible();
        expect(await conn.getAttribute('class')).toMatch(/live|off/);
    });

    test('شريط التذييل المتحرك (بوفيه مفتوح/الأسعار شاملة الضريبة)', async ({ page }) => {
        await expect(page.locator('#footerText')).toBeVisible();
        await expect(page.locator('.ticker-marquee')).toBeVisible();
        await expect(page.locator('#footerTextClone')).toHaveCount(1);
        // .arcade زخرفي بلا ارتفاع فعلي عند تصغير المسرح — وجوده في DOM يكفي
        await expect(page.locator('.arcade')).toHaveCount(1);
    });

    test('منطقة الصفحات جاهزة للتعبئة من API', async ({ page }) => {
        await expect(page.locator('#pageHost')).toBeVisible();
        // نقاط الصفحات فارغة قبل وصول البيانات — نكتفي بوجود الحاوية
        await expect(page.locator('#pageDots')).toHaveCount(1);
    });

});
