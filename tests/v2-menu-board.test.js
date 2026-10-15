/**
 * v2-menu-board.test.js — عقد شاشة المنيو (تضمين)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: page-router.js:123-130 (iframe لمنيو الإدارة) — تطبيقات المنيو
 * نفسها خارج النطاق (عقدها الخاص: stage ثابت + fitStage).
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'menu-board.js');
const HOST = path.join(V2, 'preview.js');
const LEGACY = path.join(APP, 'js', 'features', 'page-router.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('شاشات المنيو — التضمين', () => {
    test('نفس الصفحة المضمّنة في القديم', () => {
        expect(read(LEGACY)).toContain('/app/menu-admin.html');
        const s = read(SCREEN);
        expect(s).toContain('/app/menu-admin.html');
        expect(s).toContain('/app/menu-board.html');
    });

    test('بلا شبكة ولا معالج سطري', () => {
        const s = read(SCREEN).replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('المضيف يربط المفتاح مع تفكيك', () => {
        const h = read(HOST);
        expect(h).toMatch(/import \{ mountMenuBoardScreen \} from '\.\/screens\/menu-board\.js\?v=/);
        expect(h).toMatch(/function teardownMenuBoardScreen\(\)/);
        expect(h).toMatch(/if \(key === 'menu-board'\)/);
    });
});
