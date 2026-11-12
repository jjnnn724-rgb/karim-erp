import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E لـ V3 — طبقتان:
 *
 *  · **عامة** (`specs/public`): تعمل بلا API ولا جلسة على `dist` المبني عبر
 *    خادم ثابت. هي بوابة CI الدائمة: اتجاه، تجاوب، بوابة دخول، وصول.
 *  · **حية** (`specs/live`): تعمل على خادم فيه API حقيقي (افتراضيًا خادم
 *    التحقق 5200، لا الإنتاج) ببيانات اعتماد من متغيرات البيئة
 *    `V3_E2E_USER` / `V3_E2E_PASS`. بلا اعتماد تُتخطّى صراحةً.
 *
 * القياسات لا تُسنَد إلى أرقام ثابتة في البيانات: تُقاس الشروط (عرض نافذة،
 * ذيل داخل الشاشة، تمرير يعمل) كي لا تكسر تغيّرُ السجلات الحقيقية الاختبار.
 */

const PUBLIC_URL = `http://127.0.0.1:${process.env.V3_E2E_PORT ?? 5320}`;
const LIVE_URL = process.env.V3_E2E_URL ?? 'http://127.0.0.1:5200';
/** جلسة واحدة تحفظها `support/auth.setup.ts` بدل دخولٍ من كل اختبار. */
const AUTH_FILE = fileURLToPath(new URL('./.auth/live.json', import.meta.url));

export default defineConfig({
    testDir: './specs',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    ...(process.env.CI ? { workers: 2 } : {}),
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: {
        locale: 'ar-EG',
        timezoneId: 'Africa/Cairo',
        ignoreHTTPSErrors: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'public-desktop',
            testDir: './specs/public',
            use: {
                ...devices['Desktop Chrome'],
                baseURL: PUBLIC_URL,
                viewport: { width: 1366, height: 768 },
            },
        },
        {
            name: 'public-mobile',
            testDir: './specs/public',
            use: {
                ...devices['Pixel 7'],
                baseURL: PUBLIC_URL,
                viewport: { width: 390, height: 844 },
            },
        },
        {
            name: 'live-auth',
            testDir: './support',
            testMatch: /auth\.setup\.ts/,
            use: { ...devices['Desktop Chrome'], baseURL: LIVE_URL },
        },
        {
            name: 'live-desktop',
            testDir: './specs/live',
            dependencies: ['live-auth'],
            use: {
                ...devices['Desktop Chrome'],
                baseURL: LIVE_URL,
                viewport: { width: 1440, height: 900 },
                storageState: AUTH_FILE,
            },
        },
        {
            name: 'live-mobile',
            testDir: './specs/live',
            dependencies: ['live-auth'],
            use: {
                ...devices['Pixel 7'],
                baseURL: LIVE_URL,
                viewport: { width: 390, height: 844 },
                storageState: AUTH_FILE,
            },
        },
    ],
    webServer: {
        // cwd لهذا الأمر هو مجلد الإعداد (`e2e/`)، لا جذر الحزمة.
        command: 'node scripts/static-server.mjs',
        url: `${PUBLIC_URL}/v3/`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
    },
});
