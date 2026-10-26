/**
 * playwright.config.js — اختبارات E2E حقيقية (متصفح Chromium).
 * منفصلة تمامًا عن Jest: ملفات tests/e2e/*.spec.js لا يلتقطها Jest.
 *
 * الاستخدام:
 *   npm run test:e2e                 # ضد سيرفر يعمل بالفعل على E2E_BASE_URL
 *   E2E_BASE_URL=http://192.168.1.5:5001 npm run test:e2e
 *   npm run test:e2e:headed          # شاهد المتصفح بعينك
 *
 * ملاحظة: السيرفر لا يُشغَّل تلقائيًا لأن الإقلاع يتطلب PostgreSQL و.env
 * كاملين — شغّل الخادم أولاً ثم نفّذ الاختبارات (reuseExistingServer).
 */
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'https://localhost:5001';

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // شهادة محلية ذاتية التوقيع (mkcert/LAN) — تجاهل أخطاء HTTPS إلزامي هنا.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    locale: 'ar-EG',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
