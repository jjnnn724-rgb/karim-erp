// ────────────────────────────────────────────────────────────────────────────
// boot-performance.test.js — عقد سرعة الإقلاع (2026-10-28)
// كان الإقلاع يسلسل 31 استيرادًا (~1.5MB) وينزّل xlsx/Chart/الكاميرا (383KB
// مضغوطة) قبل أن يصبح زر الدخول حيًّا، وشعار الدخول ico بحجم 115KB ليُعرض
// 46px. هذه الاختبارات تقفل المكاسب الثلاثة كي لا يعود أحدها صامتًا:
//   1) الوحدات تُجلب دفعةً واحدة (modulepreload) وتُقيَّم من قائمة واحدة.
//   2) مكتبات البائع لا تُحمَّل في الإقلاع، وكل مستخدم لها ينتظر ensure*.
//   3) شاشة الدخول تستخدم webp صغيرًا لا .ico.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const APP_DIR = path.join(__dirname, '..', 'frontend', 'app');
const read = p => fs.readFileSync(path.join(APP_DIR, p), 'utf8');
const exists = p => fs.existsSync(path.join(APP_DIR, p));

const INDEX = read('index.html');
const MAIN = read('js/main.js');
const LAZY = read('js/core/vendor-lazy.js');
const VENDORS = ['xlsx.full.min.js', 'chart.umd.min.js', 'html5-qrcode.min.js'];

describe('سرعة الإقلاع — الوحدات', () => {
    test('كل وحدات الميزات تُجلب مسبقًا دفعةً واحدة ثم تُقيَّم بالترتيب', () => {
        expect(MAIN).toContain('const FEATURE_MODULES = [');
        expect(MAIN).toContain("link.rel = 'modulepreload'");
        expect(MAIN).toContain('for (const [spec, tag] of FEATURE_MODULES)');
        const entries = [...MAIN.matchAll(/\['\.\/[^']+\.js\?v=[\d.]+', 'BRIDGE-[^']+'\]/g)];
        expect(entries.length).toBeGreaterThanOrEqual(30);
        // الجلب المسبق يسبق أول استيراد ديناميكي — وإلا عاد التسلسل
        expect(MAIN.indexOf('modulepreload')).toBeLessThan(MAIN.indexOf('await import('));
    });

    test('لا يوجد استيراد تسلسلي متبقٍّ في المستوى الأعلى', () => {
        // السطر العلوي كان يستورد الوحدة ثم ينتظرها قبل بدء التالية؛
        // الاستيراد الوحيد المسموح في المستوى الأعلى هو حلقة القائمة.
        expect(MAIN).not.toMatch(/^await (?:safeBridge\(|import\()/m);
        expect(MAIN.match(/^await /gm) || []).toHaveLength(0);
    });
});

describe('سرعة الإقلاع — مكتبات البائع', () => {
    test('index.html لا يحمّل xlsx/Chart/الكاميرا في الإقلاع', () => {
        for (const name of VENDORS) {
            expect(INDEX).not.toMatch(new RegExp(`<script[^>]+vendor/${name.replace(/\./g, '\\.')}`));
        }
    });

    test('vendor-lazy قبل main.js ويعرّف بوابات الانتظار الأربع', () => {
        expect(INDEX).toMatch(/<script src="js\/core\/vendor-lazy\.js\?v=[\d.]+" defer><\/script>/);
        expect(INDEX.indexOf('vendor-lazy.js')).toBeLessThan(INDEX.indexOf('js/main.js?v='));
        for (const fn of ['window.ensureVendor = ensure', 'window.ensureXLSX =', 'window.ensureChart =', 'window.ensureHtml5Qrcode =']) {
            expect(LAZY).toContain(fn);
        }
        // الحدث يُطلق على document بلا bubbling — الاستماع على window لا يسمعه
        expect(LAZY).toContain("document.addEventListener('karim:bridges-ready'");
        for (const name of VENDORS) {
            expect(LAZY).toContain(`/app/vendor/${name}?v=`);
        }
    });

    test('كل ملف يستخدم XLSX ينتظر ensureXLSX قبل الاستخدام', () => {
        const dir = path.join(APP_DIR, 'js', 'features');
        const users = fs.readdirSync(dir)
            .filter(f => f.endsWith('.js'))
            .filter(f => /\bXLSX\./.test(fs.readFileSync(path.join(dir, f), 'utf8')));
        expect(users.length).toBeGreaterThan(0);
        for (const f of users) {
            const src = fs.readFileSync(path.join(dir, f), 'utf8');
            const firstUse = src.search(/\bXLSX\./);
            const guard = src.indexOf('ensureXLSX()');
            expect({ file: f, guardedBeforeUse: guard !== -1 && guard < firstUse }).toEqual({ file: f, guardedBeforeUse: true });
        }
    });

    test('الرسوم تنتظر Chart، والكاميرا تنتظر Html5Qrcode', () => {
        expect(read('js/features/dashboard.js')).toContain('await window.ensureChart()');
        expect(read('js/features/finance.js')).toContain('await window.ensureChart()');
        expect(read('js/features/hr.js')).toContain('await window.ensureChart()');
        expect(read('js/scanner.js')).toContain('await window.ensureHtml5Qrcode()');
    });
});

describe('سرعة الإقلاع — شعار الدخول', () => {
    test('الشعار webp صغير بدل ico ثقيل، ونفسه في CONFIG بعد الدخول', () => {
        expect(INDEX).toContain('assets/karim-logo-128.webp');
        expect(INDEX).not.toContain('assets/karim-logo.ico');
        expect(exists('assets/karim-logo-128.webp')).toBe(true);
        expect(fs.statSync(path.join(APP_DIR, 'assets/karim-logo-128.webp')).size).toBeLessThan(12 * 1024);
        expect(read('js/core/config.js')).toContain("LOGO_PATH: '/app/assets/karim-logo-128.webp'");
        expect(read('pos.html')).toContain('assets/karim-logo-128.webp');
    });
});
