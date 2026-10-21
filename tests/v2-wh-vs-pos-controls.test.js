/**
 * v2-wh-vs-pos-controls.test.js — أدوات شاشة مطابقة المخزن/الكاشيرية
 * ═══════════════════════════════════════════════════════════════════════
 * الشاشة كانت تعرض الأزرار بلا وظيفة: فترات مسبقة لا تُطبَّق، بحث صنف
 * لا يفلتر ولا يقترح، «تحديث تلقائي» بلا مؤقت. هنا يُثبَّت أن كل أداة
 * تعمل بنفس سلوك `features/wh-vs-pos.js`:
 *   ١) الفترات المسبقة تكتب التاريخين وتُعيد القراءة وتحدّد النشط.
 *   ٢) بحث الصنف: فلترة فورية بـ`arSearchIncludes` + اقتراحات مؤجّلة من
 *      `/item-suggest` (آخر كتابة تفوز).
 *   ٣) «المختلفة فقط» يفلتر `diff !== 0` ويظهر العدد «من الإجمالي».
 *   ٤) التحديث التلقائي كل 60 ثانية مع عدّاد، ويتوقف عند الإغلاق.
 *   ٥) التصدير يصدّر المعروض لا الكل.
 */
const fs = require('fs');
const path = require('path');

const SCREEN = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2', 'screens', 'wh-vs-pos.js');
const src = fs.readFileSync(SCREEN, 'utf8');

describe('الفترات المسبقة', () => {
    test('كل زر له معالجة فعلية تكتب التاريخين', () => {
        expect(src).toMatch(/data-v2-preset="today"/);
        expect(src).toMatch(/const preset = event\.target\.closest\('\[data-v2-preset\]'\)/);
        expect(src).toMatch(/function applyPreset\(key\)/);
        expect(src).toMatch(/today: \[todayIso\(0\), todayIso\(0\)\]/);
        expect(src).toMatch(/yesterday: \[todayIso\(-1\), todayIso\(-1\)\]/);
        expect(src).toMatch(/7: \[todayIso\(-6\), todayIso\(0\)\]/);
        expect(src).toMatch(/30: \[todayIso\(-29\), todayIso\(0\)\]/);
        expect(src).toMatch(/b\.classList\.toggle\('is-active', on\)/);
        expect(src).toMatch(/reload\(\);\n {4}\}/);
    });
});

describe('بحث الصنف والاقتراحات', () => {
    test('فلترة فورية بالتطبيع العربي', () => {
        expect(src).toMatch(/function visibleRows\(\)/);
        expect(src).toMatch(/arSearchIncludes\(r\.label, term\) \|\| arSearchIncludes\(r\.code, term\)/);
        expect(src).toMatch(/filterText = event\.target\.value;\n {8}paint\(\);/);
    });

    test('اقتراحات مؤجّلة 250ms وآخر كتابة تفوز', () => {
        expect(src).toMatch(/suggestTimer = setTimeout\(\(\) => suggestItems\(filterText\), 250\)/);
        expect(src).toMatch(/const seq = \+\+suggestSeq;/);
        expect(src).toMatch(/if \(seq !== suggestSeq \|\| !el\.isConnected\) \{return;\}/);
        expect(src).toMatch(/data-v2-suggest-item=/);
        expect(src).toMatch(/list\.slice\(0, 12\)/);
    });

    test('اختيار اقتراح يملأ الخانة ويفلتر فورًا', () => {
        expect(src).toMatch(/q\('#v2wv-item'\)\.value = name;\n {12}filterText = name;\n {12}hideSuggest\(\);\n {12}paint\(\);/);
    });
});

describe('«المختلفة فقط» والعدّاد', () => {
    test('يفلتر الفروق غير الصفرية', () => {
        expect(src).toMatch(/data-v2-diffonly/);
        expect(src).toMatch(/return rows\.filter\(\(r\) => \(!diffOnly \|\| r\.diff !== 0\)/);
        expect(src).toMatch(/diffOnly = !!event\.target\.checked; paint\(\);/);
    });

    test('العدّاد يقول «من الإجمالي» عند الفلترة', () => {
        expect(src).toMatch(/من \$\{formatInt\(rows\.length\)\}/);
    });
});

describe('التحديث التلقائي', () => {
    test('مؤقت 60 ثانية وعدّاد ظاهر', () => {
        expect(src).toMatch(/autoLeft = 60;/);
        expect(src).toMatch(/autoTimer = setInterval\(tick, 1000\)/);
        expect(src).toMatch(/\[data-v2-countdown\]/);
        expect(src).toMatch(/if \(event\.target\.checked\) \{startAuto\(\);\} else \{stopAuto\(\);\}/);
    });

    test('يتوقف عند التدمير أو خروج العنصر', () => {
        expect(src).toMatch(/if \(!el\.isConnected\) \{stopAuto\(\); return;\}/);
        expect(src).toMatch(/destroy\(\) \{\n {12}if \(suggestTimer\) \{clearTimeout\(suggestTimer\);\}\n {12}stopAuto\(\);/);
    });
});

describe('التصدير', () => {
    test('يصدّر الصفوف المعروضة بعد البحث/الفلتر', () => {
        expect(src).toMatch(/const exported = visibleRows\(\);\n {12}exported\.forEach/);
    });
});
