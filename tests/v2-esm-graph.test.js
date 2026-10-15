/**
 * v2-esm-graph.test.js — كل اسمٍ تستورده شاشة V2 يجب أن يكون مُصدَّرًا فعلًا
 * ═══════════════════════════════════════════════════════════════════════
 * لماذا يوجد هذا الاختبار أصلًا: V2 بلا حزمة (no bundler)، والمتصفح يرفض
 * تحميل الوحدة كلها عند أول اسم مفقود — فلا شاشة ولا شريط جانبي، وصمتٌ في
 * jest لأن اختبارات المصادر لا تُحمّل رسم الوحدات. كُسر رسم الإنتاج مرةٌ عند
 * ترقية شاشة 10: hr-dashboard-repo كان يستورد fetchLeaveRequests من
 * leaves-repo، والباب اختُصر إلى /hr/leave-workflow فسقط الاسم، وسقط معه
 * كل ما يستورد preview.js. هذا العقد هو ذلك الخطأ مكتوبًا كاختبار.
 *
 * ما يُثبَّت هنا فقط: اسم المستورد ↔ وجود التصدير في الملف المستورد.
 * لا أنماط كتابة ولا ترتيب استيرادات — تلك عقود الشاشات نفسها.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');

/** كل ملفات JS داخل شجرة V2 (الشاشات + الأبواب + العرض + المضيف). */
function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? walk(p) : (e.name.endsWith('.js') ? [p] : []);
    });
}

/** export function/const/let/class/async function + export { a, b as c } */
function exportsOf(file) {
    const src = fs.readFileSync(file, 'utf8');
    const names = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm)) {
        names.add(m[1]);
    }
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
        for (const part of m[1].split(',')) {
            const t = part.trim();
            if (!t) {continue;}
            const as = t.split(/\s+as\s+/);
            names.add((as[1] || as[0]).trim());
        }
    }
    if (/^export\s+default\b/m.test(src)) {names.add('default');}
    return names;
}

/** import { a, b as c } from '…' — بأسطر متعددة وبلا وسائط أخرى. */
function importsOf(src) {
    const out = [];
    const re = /import\s*\{([^}]*)\}\s*from\s*'([^']+)'/gs;
    for (const m of src.matchAll(re)) {
        const spec = m[2];
        if (spec.startsWith('.')) {
            for (const part of m[1].split(',')) {
                const t = part.trim();
                if (!t) {continue;}
                out.push({ name: t.split(/\s+as\s+/)[0].trim(), spec, fromImportList: true });
            }
        }
    }
    // الاستيراد على سطر واحد بأسماء مباشرة: import x from './y.js'
    for (const m of src.matchAll(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*'(\.[^']+)'/gm)) {
        out.push({ name: 'default', spec: m[2], fromImportList: false });
    }
    return out;
}

const cache = new Map();
const exportsCached = (file) => {
    if (!cache.has(file)) {cache.set(file, exportsOf(file));}
    return cache.get(file);
};

describe('رسم وحدات V2 — لا اسم مستورد بلا تصدير', () => {
    const files = walk(V2);

    test('الشجرة غير فارغة فعلًا (لا قياس على شجرة لا توجد)', () => {
        expect(files.length).toBeGreaterThan(20);
        expect(files.map((f) => path.basename(f))).toContain('preview.js');
    });

    test('كل مستورد نسبي يُحل إلى ملف موجود', () => {
        const missing = [];
        for (const f of files) {
            for (const imp of importsOf(fs.readFileSync(f, 'utf8'))) {
                const target = path.resolve(path.dirname(f), imp.spec.split('?')[0]);
                if (!fs.existsSync(target)) {
                    missing.push(`${path.relative(APP, f)} → ${imp.spec}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    test('كل اسمٍ تُورده شاشةٌ أو بابٌ مُصدَّرٌ في ملفه', () => {
        const broken = [];
        for (const f of files) {
            const src = fs.readFileSync(f, 'utf8');
            for (const imp of importsOf(src)) {
                const target = path.resolve(path.dirname(f), imp.spec.split('?')[0]);
                if (!fs.existsSync(target)) {continue;} // يُسمَّي في الاختبار السابق
                if (!exportsCached(target).has(imp.name)) {
                    broken.push(`${path.relative(APP, f)} يستورد ${imp.name} من ${path.relative(path.dirname(f), target)}`);
                }
            }
        }
        expect(broken).toEqual([]);
    });

    test('الأبواب لا تستورد شاشات — الاستيراد بابٌ إلى باب فقط', () => {
        const back = [];
        for (const f of walk(path.join(V2, 'data'))) {
            for (const imp of importsOf(fs.readFileSync(f, 'utf8'))) {
                if (/screens[\\/]/.test(imp.spec)) {
                    back.push(`${path.basename(f)} → ${imp.spec}`);
                }
            }
        }
        expect(back).toEqual([]);
    });

    test('المضيف يركّب كل شاشة مصدَّرة — لا شاشة ميتة في الشجرة', () => {
        const host = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        const mounted = [...host.matchAll(/from\s*'\.\/screens\/([\w-]+)\.js/g)].map((m) => m[1]);
        const present = fs.readdirSync(path.join(V2, 'screens')).map((f) => f.replace(/\.js$/, ''));
        for (const s of present) {
            expect(mounted).toContain(s);
        }
    });
});
