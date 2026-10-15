/**
 * v2-pos-entry.test.js — عقد مدخل الكاشير في V2
 * ═══════════════════════════════════════════════════════════════════════
 * النطاق معلن: POS تطبيق مستقل لا يُعاد بناؤه (zero-surprise) — المدخل
 * بنفس أدوار رابط الشريط القديم (auth-navigation.js:302) + حالة الوردية.
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
    test('نفس أدوار رابط الشريط القديم', () => {
        expect(read(LEGACY)).toContain('/app/pos.html');
        const s = read(SCREEN);
        expect(s).toContain('/app/pos.html');
        expect(s).toContain("['admin', 'accountant', 'cashier']");
    });

    test('حالة الوردية من نفس الباب + زر الإغلاق المركزي إحالة للمالية', () => {
        const s = read(SCREEN);
        expect(s).toContain('fetchOpenShifts');
        expect(s).toContain('الإغلاق المركزي من لوحة المدير المالي');
        expect(s).toContain('لا ورديات مفتوحة — كل الكاشيرية مغلقة ✓');
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
