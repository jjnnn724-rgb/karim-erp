/**
 * v2-pos-entry.test.js — عقد مدخل الكاشير في V2
 * ═══════════════════════════════════════════════════════════════════════
 * النطاق معلن: POS تطبيق مستقل لا يُعاد بناؤه (zero-surprise) — المدخل
 * بنفس أدوار رابط الشريط القديم (auth-navigation.js:302) + حالة الوردية،
 * وفتحه رابط noopener حقيقي كرابط القديم لا نافذة منبثقة بسكربت.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'pos-entry.js');
const HOST = path.join(V2, 'preview.js');
const LEGACY = path.join(APP, 'js', 'features', 'auth-navigation.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('مدخل الكاشير — العقد', () => {
    test('نفس أدوار رابط الشريط القديم، وفتحه رابط noopener لا نافذة منبثقة', () => {
        expect(read(LEGACY)).toContain('/app/pos.html');
        const s = read(SCREEN);
        expect(s).toContain('href="/app/pos.html"');
        expect(s).toContain('target="_blank"');
        expect(s).toContain('rel="noopener"');
        expect(s).toContain("['admin', 'accountant', 'cashier']");
        expect(s).not.toContain('window.open');
    });

    test('حالة الوردية من نفس الباب + زر الإغلاق المركزي إحالة للمالية', () => {
        const s = read(SCREEN);
        expect(s).toContain('fetchOpenShifts');
        expect(s).toContain('الإغلاق المركزي من لوحة المدير المالي');
        expect(s).toContain('لا ورديات مفتوحة');
        expect(s).toContain('كل الكاشيرية مغلقة');
    });

    test('«يوم سابق» شارة tokens — بلا لون خام ولا إيموجي', () => {
        const s = read(SCREEN);
        expect(s).toContain('data-tone="warning">يوم سابق');
        expect(s).not.toMatch(/style="background/);
        expect(s).not.toMatch(/[⚠✓]/);
    });

    test('الجدول مسمّى: caption مخفي بصريًّا و7 أعمدة scope', () => {
        const s = read(SCREEN);
        expect(s).toContain('<caption class="erp-sr-only">الورديات المفتوحة</caption>');
        expect(s.match(/scope="col"/g) || []).toHaveLength(7);
    });

    test('الفشل صريح: جلسة/صلاحية/عام + إعادة محاولة وحالة انشغال', () => {
        const s = read(SCREEN);
        expect(s).toContain("e.message === 'UNAUTHORIZED'");
        expect(s).toContain("e.code === 'FORBIDDEN'");
        expect(s).toContain('data-erp-retry');
        expect(s).toContain("closest('[data-erp-retry]')");
        expect(s).toContain("box.setAttribute('aria-busy', 'true')");
        expect(s).toContain("box.removeAttribute('aria-busy')");
    });

    test('بلا شبكة مباشرة ولا معالج سطري', () => {
        const s = read(SCREEN).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s).toMatch(/from '\.\.\/data\/cfo-repo\.js\?v=/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('المضيف يربط المفتاح مع تفكيك', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountPosEntryScreen \} from '\.\/screens\/pos-entry\.js\?v=/);
        expect(h).toMatch(/key: 'pos', title: 'الكاشير', mount: mountPosEntryScreen/);
        expect(h).toMatch(/if \(key === 'pos'\)/);
        expect(h).toMatch(/function teardownPosEntryScreen\(\)/);
    });
});
