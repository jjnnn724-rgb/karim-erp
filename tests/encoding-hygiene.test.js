'use strict';
/**
 * encoding-hygiene.test.js — لا محارف شرق آسيوية ولا NUL في نصّنا العربي
 * ════════════════════════════════════════════════════════════════════════
 * الاكتشاف (2026-11-02): كتابةٌ فقدت الترميز في جلسةٍ سابقة تركت حروفًا
 * صينية وأزواج محارف الاستبدال وسط التعليقات والرسائل العربية — في منتصف
 * الأفعال العربية («تكتمل … مبيعات»، «قراءة الأصناف»، «يرفض الأرقام») —
 * والأخطر بايتَي NUL داخل وسائط زر `zatcaToggle`: `JSON.parse`
 * يرمي، فيُستدعى `zatcaToggle(undefined)` ويرسل `enabled: undefined`
 * إلى /api/zatca/toggle بديلًا من «إيقاف الربط/تفعيله» المقصود.
 *
 * القرار: النظافة الترميزية تُقاس على بايتات الملف لا على ما تطمئن له
 * الطرفية — PowerShell يعرض العربية «» وهي سليمة، فتكذيبُ العيب من
 * الشاشة أخطر من العيب نفسه. محرف «＋» (U+FF0B) مستثنًى: مستخدمٌ عن قصد
 * في وسوم المنيو العربية.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCANNED = ['backend', 'frontend/app', 'scripts', 'tests', 'docs'];
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'dist', 'coverage', 'var', 'tmp', 'backups', 'data']);
const EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.md']);

/**
 * مواضع U+FFFD المعروفة والمقصودة — كلُّها كودٌ يتعامل مع المحرف لا نصٌّ
 * محطَّم. أيُ زيادةٍ هنا يجب أن تكون قرارًا صريحًا لا حادثًا عابرًا.
 *   · zkteco/protocol.js   : يجرّد محارف الاستبدال من أسماء تقطعها الجهاز.
 *   · yarasoft/oracle-link.js: تعليقٌ يصف كيف يظهر العربي بلا ترميز AR8MSWIN1256.
 */
const FFFD_ALLOWED = {
    'backend/zkteco/protocol.js': 2,
    'backend/yarasoft/oracle-link.js': 4,
};

/* المتون شرق الآسيوية وترقيمها، بلا U+FF0B («＋» مقصودٌ في الواجهة). */
const CJK_CLASS = '\\u3000-\\u303F\\u3040-\\u30FF\\u3300-\\u33FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF\\uFE10-\\uFE4F\\uFF01-\\uFF0A\\uFF0C-\\uFF5E\\uFF61-\\uFF9F';
const CJK_RE = () => new RegExp(`[${CJK_CLASS}]`, 'g');
const FFFD_RE = () => new RegExp('\\uFFFD', 'g');

function collect(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) {continue;}
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {out.push(...collect(p));} else if (EXTENSIONS.has(path.extname(e.name))) {out.push(p);}
    }
    return out;
}

function rel(p) {
    return path.relative(ROOT, p).split(path.sep).join('/');
}

const corpus = SCANNED.flatMap((d) => collect(path.join(ROOT, d)));

describe('نظافة الترميز — الكود العربي بلا متون شرق آسيوية ولا NUL', () => {
    test('الفحص يغطي جسدًا حقيقيًا من الملفات (لا قائمةً فارغة خضراء)', () => {
        expect(corpus.length).toBeGreaterThan(800);
    });

    test('لا بايت NUL في أي ملفٍ مُخدَّم', () => {
        const bad = corpus.filter((p) => fs.readFileSync(p).includes(0)).map(rel);
        expect(bad).toEqual([]);
    });

    test('لا متون شرق آسيوية في التعليقات والرسائل', () => {
        const bad = [];
        for (const p of corpus) {
            const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
            lines.forEach((line, i) => {
                const hits = line.match(CJK_RE());
                if (hits) {bad.push(`${rel(p)}:${i + 1} ${hits.join('')}`);}
            });
        }
        expect(bad).toEqual([]);
    });

    test('محارف الاستبدال محصورةٌ في المواضع المبرَّرة وبعددِها', () => {
        const found = {};
        for (const p of corpus) {
            const n = (fs.readFileSync(p, 'utf8').match(FFFD_RE()) || []).length;
            if (n) {found[rel(p)] = n;}
        }
        expect(found).toEqual(FFFD_ALLOWED);
    });
});

describe('وسائط زر ZATCA — كانت NULّين فأصبحت تعبيرًا يُرمَّز', () => {
    const src = () => fs.readFileSync(path.join(ROOT, 'frontend/app/js/features/settings-users.js'), 'utf8');

    test('الوسم يحمل تعبير القالب لا قيمةً خام', () => {
        const hit = /data-karim-action="zatcaToggle" data-karim-args="([^"]*)"/.exec(src());
        expect(hit).not.toBeNull();
        expect(hit[1]).toBe('[${!c.enabled}]');
    });

    test('بعد ترميز القالب تصبح الوسائط JSON صالحًا يقرأه الموزّع', () => {
        const hit = /data-karim-action="zatcaToggle" data-karim-args="([^"]*)"/.exec(src());
        // parseArgs في action-dispatch يعمل JSON.parse على النص بعد ترميز القالب:
        // ربطٌ مفعّل ⇒ الوسيط false (إيقاف)، وربطٌ موقوف ⇒ true (تفعيل).
        for (const rendered of ['true', 'false']) {
            expect(JSON.parse(hit[1].replace('${!c.enabled}', rendered))).toEqual([rendered === 'true']);
        }
    });
});
