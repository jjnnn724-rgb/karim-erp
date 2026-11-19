import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as setup } from '@playwright/test';
import { hasLiveCreds, login } from './harness';

/**
 * جلسة واحدة للحزمة الحية كلها.
 *
 * بوابة الخادم تحدّ الدخول إلى 20 محاولة كل 15 دقيقة لكل (IP + حساب)
 * (`rate-limiter.js`)، فدخولٌ من كل اختبار يستهلك الحد ويُفشل تشغيلات
 * متتابعة. هنا دخول واحد يُحفظ `storageState` (رمز التحديث في
 * localStorage بنفس مفتاح القديم)، وكل اختبار يستأنف منه. الخادم لا يُبطل
 * رمز التحديث عند التجديد (مُتحقَّق منه: نفس الرمز يعيد التجديد مرتين)،
 * فالعمال المتوازون آمنون.
 */

export const AUTH_FILE = fileURLToPath(new URL('../.auth/live.json', import.meta.url));

setup('حفظ جلسة حية', async ({ page, context }) => {
    mkdirSync(dirname(AUTH_FILE), { recursive: true });
    if (!hasLiveCreds) {
        // حالة فارغة كي تُقلع المشاريع التابعة ثم تُتخطّى اختباراتها صراحةً.
        writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }));
        return;
    }

    await login(page);
    await context.storageState({ path: AUTH_FILE });
});
