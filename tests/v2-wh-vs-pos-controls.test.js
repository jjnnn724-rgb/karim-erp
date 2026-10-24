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
 *   ٦) بطاقات الملخص السبع والتنبيهات وأكبر 10 فروقات والطباعة كما في القديم.
 *   ٧) نطاق «هذا الشهر» افتراضيًا، وختم المزامنة، والوسم الحي.
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
        expect(src).toMatch(/reload\(\);[\s\S]{0,160}\}/);
    });
});

describe('بحث الصنف والاقتراحات', () => {
    test('فلترة فورية بالتطبيع العربي', () => {
        expect(src).toMatch(/function visibleRows\(\)/);
        expect(src).toMatch(/arSearchIncludes\(r\.label, term\) \|\| arSearchIncludes\(r\.code, term\)/);
        expect(src).toMatch(/filterText = event\.target\.value;[\s\S]{0,200}paint\(\);/);
    });

    test('اقتراحات مؤجّلة 250ms وآخر كتابة تفوز', () => {
        expect(src).toMatch(/suggestTimer = setTimeout\(\(\) => suggestItems\(filterText\), 250\)/);
        expect(src).toMatch(/const seq = \+\+suggestSeq;/);
        expect(src).toMatch(/if \(seq !== suggestSeq \|\| !el\.isConnected\) \{return;\}/);
        expect(src).toMatch(/data-v2-suggest-item=/);
        expect(src).toMatch(/list\.slice\(0, 12\)/);
    });

    test('اختيار اقتراح يملأ الخانة ويفلتر فورًا', () => {
        expect(src).toMatch(/q\('#v2wv-item'\)\.value = name;[\s\S]{0,240}filterText = name;[\s\S]{0,240}hideSuggest\(\);[\s\S]{0,240}paint\(\);/);
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
        expect(src).toMatch(/destroy\(\) \{[\s\S]{0,240}if \(suggestTimer\) \{clearTimeout\(suggestTimer\);\}[\s\S]{0,240}stopAuto\(\);/);
    });
});

describe('التصدير', () => {
    test('يصدّر الصفوف المعروضة بعد البحث/الفلتر', () => {
        expect(src).toMatch(/const exported = visibleRows\(\);[\s\S]{0,240}exported\.forEach/);
    });
});

describe('مطابقة القديم — العنوان والمؤشرات والتنبيهات', () => {
    test('العنوان نفسه «مقارنة الصرف والمبيعات — تحليل ذكي»', () => {
        expect(src).toContain('مقارنة الصرف والمبيعات <span class="erp-eyebrow">— تحليل ذكي</span>');
    });

    test('البطاقات السبع بأسماء القديم ومصدرها ملخص الخادم', () => {
        for (const label of ['إجمالي الأصناف', '✓ متطابقة', 'المبيعات أكثر', 'المصروف أكثر',
            'مباع فقط', 'مصروف فقط', 'إجمالي المبيعات']) {
            expect(src).toContain(`label: '${label}'`);
        }
        for (const key of ['total_items', 'matched', 'sold_more', 'issued_more',
            'pos_only', 'wh_only', 'total_pos_gross']) {
            expect(src).toContain(`${key}: Number(data.summary.${key}) || 0`);
        }
        // غياب الملخص من الخادم لا يُفرغ البطاقات — تُحسب من الصفوف
        expect(src).toContain(': summarizeRows(rows);');
    });

    test('تنبيهات الفروقات: أعلى 5 مبيعًا وأعلى 3 صرفًا بحد 10', () => {
        expect(src).toContain("rows.filter((r) => r.status === 'sold_more' && Math.abs(r.diff) >= 10).slice(0, 5)");
        expect(src).toContain("rows.filter((r) => r.status === 'issued_more' && Math.abs(r.diff) >= 10).slice(0, 3)");
        expect(src).toContain('aria-label="تنبيهات الفروقات"');
    });

    test('أكبر 10 فروقات من غير المتطابق فقط', () => {
        expect(src).toContain("rows.filter((r) => r.status !== 'match').slice(0, 10)");
        expect(src).toContain('أكبر 10 فروقات');
    });
});

describe('النطاق الافتراضي والوسم الحي والطباعة', () => {
    test('هذا الشهر افتراضيًا، وهذا الأسبوع شريحة عاملة', () => {
        expect(src).toContain('template(monthStartIso(), todayIso(0))');
        expect(src).toContain('data-v2-preset="month" class="is-active"');
        expect(src).toContain('month: [monthStartIso(), todayIso(0)]');
        expect(src).toContain('week: [weekStartIso(), todayIso(0)]');
        expect(src).toContain("b.setAttribute('aria-pressed', on ? 'true' : 'false')");
    });

    test('ختم آخر تحديث ووسم المزامنة يتبعان الاستجابة', () => {
        expect(src).toContain("stampRefresh(!!data.liveSynced, data.lastSyncAt || '')");
        expect(src).toContain('data-v2-stamp');
        expect(src).toContain('آخر مزامنة للمرآة:');
    });

    test('تقرير الطباعة داخل التطبيق بهوية المطاعم', () => {
        expect(src).toContain("openInAppReport('تقرير مقارنة الصرف والمبيعات')");
        expect(src).toContain('مطاعم الشرفه العالمي');
        expect(src).toContain("if (event.target.closest('[data-v2-print]')) {printReport(); return;}");
        expect(src).toContain("import { openInAppReport } from '../report-viewer.js?v=");
    });
});
