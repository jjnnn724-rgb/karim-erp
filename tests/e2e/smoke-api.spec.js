/**
 * tests/e2e/smoke-api.spec.js — فحوص دخنة (Smoke) للـ API عبر requests مباشرة.
 * يتطلب خادم Karim-ERP يعمل على E2E_BASE_URL (افتراضيًا https://localhost:5001).
 */
const { test, expect } = require('@playwright/test');

test.describe('Karim-ERP API smoke', () => {

    test('/api/server/info يعرّف عن نفسه', async ({ request }) => {
        const res = await request.get('/api/server/info');
        expect(res.ok()).toBeTruthy();
        const info = await res.json();
        expect(info.app).toBe('karim-erp');
        expect(typeof info.version).toBe('string');
        expect(info.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    test('/api/menu-board/public عام بلا JWT ويردّ بيانات المنيو', async ({ request }) => {
        const res = await request.get('/api/menu-board/public');
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body).toBeTruthy();
    });

    test('/api/health لا يسقط أبدًا (قد يردّ 200 أو 503 حسب الفحوصات)', async ({ request }) => {
        const res = await request.get('/api/health');
        expect([200, 503]).toContain(res.status());
    });

    test('/api/i18n/config عام ويردّ اللغة والعملة الافتراضيتين', async ({ request }) => {
        const res = await request.get('/api/i18n/config');
        expect(res.status()).toBe(200);
        const cfg = await res.json();
        expect(cfg.ok).toBe(true);
        expect(['ar', 'en']).toContain(cfg.lang);
        expect(cfg.currency).toMatch(/^[A-Z]{3}$/);
        expect(Array.isArray(cfg.branches)).toBeTruthy();
    });

});
