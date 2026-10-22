/**
 * cash-register.test.js — سجلّ الصرف + إذن الصرف
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   1) سجلّ الصرف يقرأ expenses ويربط كل حركة بإذنها (dispatches) عبر
 *      رقم الإذن المستخرَج من البيان — لا استعلامات جديدة على جداول.
 *   2) الترقيم صادق: الخادم يُرجع عدد المطابق كلّه والصفحةَ الحالية،
 *      والواجهة تُبلِّغ ذلك العدد (setTotalRecords) بدل عدّ الصفوف المعروضة.
 *   3) كلُّ مشتقٍّ على الخادم: النسبة، المتوسطان، الفرق عن المماثل، العملة،
 *      والمبلغ كتابةً — لا حسابٌ في الواجهة ولا نصُّ عملةٍ فيها.
 *   4) إذن الصرف يعرض سلسلة الاعتمادات ووقائعها ودفتر حركاتها.
 *   5) قراءةٌ فقط: لا INSERT/UPDATE/DELETE في وحدة السجل.
 *   6) الباب الواحد: الشاشة لا تعرف الشبكة — المستودع هو مَن يحمل الرؤوس،
 *      والورقتان HTML تُعرضان بالعارض (قفزة المتصفح ترجع 401).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const backend = read('backend', 'expense-register-routes.js');
const screen = read('frontend', 'app', 'js', 'v2', 'screens', 'cash-register.js');
const repo = read('frontend', 'app', 'js', 'v2', 'data', 'expense-register-repo.js');
const css = read('frontend', 'app', 'css', 'v2', 'erp-cash.css');
const preview = read('frontend', 'app', 'js', 'v2', 'preview.js');

describe('سجلّ الصرف + إذن الصرف', () => {
    test('السجل يقرأ expenses ويربط الإذن من رقمه في البيان', () => {
        expect(backend).toMatch(/FROM expenses e/);
        expect(backend).toMatch(/LEFT JOIN dispatches d/);
        expect(backend).toMatch(/substring\(e\.notes from 'طلب صرف #\(\[0-9\]\+\)'\)/);
    });

    test('مرشّح القسم يذكر d."deptCode" — فكل استعلامٍ يحمله يصل الأذون', () => {
        // استعلامٌ يقحم المرشّح بلا وصل dispatches يسقط عند التشغيل بـ
        // missing FROM-clause entry for table "d" — وقعت فعلًا في توزيعَي
        // الأنواع والأصناف حين اختير قسم.
        expect(backend).not.toMatch(/FROM expenses e \$\{[fp]\.clause\}/);
    });

    test('الترقيم صادق: صفحة من الخادم وعددٌ كليٌّ من الخادم', () => {
        expect(backend).toMatch(/LIMIT \$\{limit\} OFFSET \$\{offset\}/);
        expect(backend).toMatch(/page: \{ limit, offset \}/);
        // الفرز على قائمة بيضاء، لا مفتاحٌ يصل إلى SQL
        expect(backend).toMatch(/const SORTS = \{/);
        expect(backend).toMatch(/SORTS\[String\(query\.sort/);
        expect(screen).toMatch(/mode: 'server'/);
        expect(screen).toMatch(/table\.setTotalRecords\(data\.totals\.count\)/);
        expect(repo).toMatch(/export async function fetchExpenseRegister/);
    });

    test('المشتقات على الخادم: نسبةٌ ومتوسطان وفرقٌ عن مماثلها', () => {
        expect(backend).toMatch(/share: total > 0/);
        expect(backend).toMatch(/avg_day:/);
        expect(backend).toMatch(/avg_row:/);
        expect(backend).toMatch(/prev_total/);
        // الفرق بلا أساسٍ صحيح يبقى_dash_ لا «∞٪» ولا «100٪»
        expect(backend).toMatch(/delta: prevTotal != null && prevTotal > 0/);
        expect(backend).toMatch(/series: series\.rows/);
        expect(backend).toMatch(/depts: depts\.rows/);
        // والعملة من الإعدادات، لا من نصٍّ مكتوب في الشاشة أو المستودع
        expect(backend).toMatch(/FROM settings WHERE id = 'main_settings'/);
        expect(screen).not.toMatch(/ر\.س|SAR/);
    });

    test('إذن الصرف: الطلب باعتماداته وأصنافه وسلسلة وقائعه', () => {
        expect(backend).toMatch(/FROM dispatches WHERE id::text = \$1/);
        expect(backend).toMatch(/dispatch_workflow_events/);
        expect(backend).toMatch(/approvedItems/);
        expect(backend).toMatch(/chefApprovedBy/);
        expect(backend).toMatch(/kitchenReceivedBy/);
        // دفتر الحركات المنفَّذة وبصمة السلسلة — لا يُكتفى برأس الطلب
        expect(backend).toMatch(/lastEventHash/);
        expect(screen).toMatch(/cashreg__ledger/);
        expect(screen).toMatch(/cashreg__stages/);
        expect(screen).toMatch(/cashreg__sigs/);
    });

    test('المبلغ كتابةً بالعربية (شرط الإذن المحاسبي)', () => {
        expect(backend).toMatch(/function amountInWords/);
        expect(backend).toMatch(/مليون/);
        expect(backend).toMatch(/ألف/);
        expect(backend).toMatch(/هللة/);
        expect(backend).toMatch(/فقط لا غير/);
        expect(screen).toMatch(/amountWords/);
    });

    test('قراءةٌ فقط: لا كتابة في وحدة السجل', () => {
        expect(backend).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
        expect(backend).not.toMatch(/pool\.query\(\s*`\s*(INSERT|UPDATE|DELETE)/i);
    });

    test('ورقتان HTML: الكشف وإذن الصرف، بنفس المرشّحات وبحدٍّ معلن', () => {
        expect(backend).toMatch(/router\.get\('\/html'/);
        expect(backend).toMatch(/router\.get\('\/voucher\/:id\/html'/);
        // الورقة تحمل ترويسة العلامة فلا يُكرّر العارضُ ترويسةً أخرى
        expect(backend).toMatch(/data-v2-print-brand/);
        expect(repo).toMatch(/export function fetchRegisterHtml/);
        expect(repo).toMatch(/export function fetchVoucherHtml/);
        expect(repo).toMatch(/encodeURIComponent\(String\(id\)\)/);
    });

    test('الواجهة: شاشة مستقلة + لوحة الإذن + طباعة', () => {
        expect(preview).toMatch(/await import\('\.\/screens\/cash-register\.js/);
        expect(screen).toMatch(/mountCashRegister/);
        expect(screen).toMatch(/data-cr-panel/);
        expect(screen).toMatch(/طباعة الإذن/);
        expect(screen).toMatch(/طباعة الكشف/);
        expect(screen).not.toMatch(/on(?:click|submit)\s*=\s*["']/);
        // حالةُ التحميل والفشل تُعرض، لا تُبتلع
        expect(screen).toMatch(/table\.setError/);
        expect(screen).toMatch(/class="cashreg__panelState/);
    });

    test('الباب الواحد: الشاشة لا تعرف الشبكة، والمستودع يحمل الرؤوس', () => {
        expect(screen).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen).toMatch(/from '\.\.\/data\/expense-register-repo\.js/);
        // كل مسارٍ إلى نقطةٍ باسمها الكامل تحت /api/expense-register:
        // apiFetch يُلصق «/api» فقط، فمسارٌ بلا البادئة يعود 404 صامتًا.
        const paths = [...repo.matchAll(/apiFetch\(\s*`([^`]+)`/g)].map((m) => m[1]);
        expect(paths.length).toBeGreaterThan(1);
        for (const p of paths) {expect(p.startsWith('/expense-register')).toBe(true);}
        // الطباعة عبر العارض برؤوس المصادقة — لا قفزة متصفح (ترجع 401)
        expect(repo).toMatch(/x-api-key/);
        expect(repo).toMatch(/Bearer \$\{window\._jwt\}/);
        expect(screen).toMatch(/openInAppReport/);
        // قفزة <a target="_blank"> إلى نقطة HTML المحمية تبقى بلا رأس مفتاح
        expect(screen).not.toMatch(/target="_blank"/);
        expect(screen).not.toMatch(/href="\/api\//);
    });

    test('مكوّنات النظام لا طبقةٌ خاصة: جدولٌ ورسومٌ ومؤشراتٌ مشتركة', () => {
        expect(screen).toMatch(/createDataTable/);
        expect(screen).toMatch(/statusBadge\('dispatch'/);
        expect(screen).toMatch(/barChart\(\{/);
        expect(screen).toMatch(/donutChart\(\{/);
        expect(screen).toMatch(/class="erp-kpis/);
        expect(screen).toMatch(/erp-dash-grid/);
        // الحالة المجهولة تُعرض كما هي (statusBadge يحمل data-unknown)
        expect(screen).not.toMatch(/status\s*===?\s*['"]/);
    });

    test('النشر: التسمية والأدوار والإعدادات — dispatch «أذون الصرف» وcash-register «سجلّ الصرف»', () => {
        const i18n = read('frontend', 'app', 'js', 'core', 'i18n.js');
        const config = read('frontend', 'app', 'js', 'core', 'config.js');
        const settings = read('frontend', 'app', 'js', 'v2', 'screens', 'settings.js');
        const briefing = read('frontend', 'app', 'js', 'v2', 'screens', 'briefing.js');
        // التسميات: بدون تعارض مع «سجل أذون الصرف» الحقيقي (dispatch)
        expect(i18n).toMatch(/dispatch:\s*\{\s*icon: 'clipboard-list',\s*ar: 'أذون الصرف'/);
        expect(i18n).toMatch(/'cash-register':\s*\{\s*icon: 'receipt',\s*ar: 'سجلّ الصرف'/);
        expect(i18n).toMatch(/'pg\.dispatch': 'أذون الصرف'/);
        expect(i18n).toMatch(/'pg\.cash-register': 'سجلّ الصرف'/);
        // المحاسب يرى السجل (الخادم يسمح له في permissions.js)
        expect(config).toMatch(/accountant:\s*\{[^}]*'cash-register'/);
        // إدارة الصفحات المخفية تعرف المفتاح
        expect(settings).toMatch(/NAV_KEYS = \['cfo', 'cash-register'/);
        // إيصال «الإيجاز اليومي» بنفس نمط العارض: الجلب من مستودع البيانات
        // (fetchReceiptHtml) والعرض بالعارض — كان href يقفز فيعود 401.
        expect(briefing).toMatch(/openInAppReport/);
        expect(briefing).toMatch(/data-v2-print-receipt/);
        expect(briefing).not.toMatch(/receipt-html">طباعة الإيصال/);
        expect(briefing).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        const briefingRepo = read('frontend', 'app', 'js', 'v2', 'data', 'briefing-repo.js');
        expect(briefingRepo).toMatch(/export async function fetchReceiptHtml/);
        expect(briefingRepo).toMatch(/receipt-html/);
    });

    test('الطبقة برموز --erp-* فقط (تبع الوضع الليلي بلا إعادة رسم)', () => {
        const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-4\)/);
        // اللوحة جانبيةٌ بقفل تمرير، وحالتُها لها بديلٌ مرسوم
        expect(css).toMatch(/body\.cashreg-open \{ overflow: hidden; \}/);
        expect(css).toMatch(/\.cashreg__panel\[hidden\]/);
        expect(css).toMatch(/@keyframes cashreg-shimmer/);
    });
});

describe('المبلغ كتابةً — قيم على الورقة لا صيغ في المصدر', () => {
    const { amountInWords } = require('../backend/expense-register-routes.js');

    test('لا تكرار لمجموعة الآحاد بعد كلمة العملة', () => {
        expect(amountInWords(17025)).toBe('سبعة عشر ألفًا وخمسة وعشرون ريالًا فقط لا غير');
        expect(amountInWords(46175)).toBe('ستة وأربعون ألفًا ومائة وخمسة وسبعون ريالًا فقط لا غير');
    });

    test('الألف والمليون: صيغة العدد، و«ألف ريال» بلا تنوين', () => {
        expect(amountInWords(1000.5)).toBe('ألف ريال وخمسون هللة فقط لا غير');
        expect(amountInWords(2000)).toBe('ألفان ريال فقط لا غير');
        expect(amountInWords(1234567.89)).toBe(
            'مليون ومائتان وأربعة وثلاثون ألفًا وخمسمائة وسبعة وستون ريالًا'
            + ' وتسعة وثمانون هللة فقط لا غير');
    });

    test('المفرد والمثنى والجمع للريال والهللة', () => {
        expect(amountInWords(0)).toBe('صفر ريال فقط لا غير');
        expect(amountInWords(1)).toBe('ريال واحد فقط لا غير');
        expect(amountInWords(2)).toBe('ريالان فقط لا غير');
        expect(amountInWords(3)).toBe('ثلاثة ريالات فقط لا غير');
        expect(amountInWords(11)).toBe('أحد عشر ريالًا فقط لا غير');
        expect(amountInWords(0.01)).toBe('صفر ريال وهللة واحدة فقط لا غير');
        expect(amountInWords(0.02)).toBe('صفر ريال وهللتان فقط لا غير');
        expect(amountInWords(0.05)).toBe('صفر ريال وخمسة هللات فقط لا غير');
    });

    test('الكسور: لا «مائة هللة»، ولا إسقاط لرقم', () => {
        expect(amountInWords(1.999)).toBe('ريالان فقط لا غير');
        expect(amountInWords(217.38)).toBe('مائتان وسبعة عشر ريالًا وثمانية وثلاثون هللة فقط لا غير');
        expect(amountInWords(-3500)).toBe('ثلاثة آلاف وخمسمائة ريال فقط لا غير');
    });
});

describe('سلسلة الاعتماد — وقتٌ يُقرأ لا ISO خام', () => {
    test('الشاشة تنسّق وقت الواقعة وتُبقي ما لا يُقرأ كما جاء', () => {
        expect(screen).toMatch(/function stageTime/);
        expect(screen).toMatch(/esc\(stageTime\(s\.at\)\)/);
        expect(screen).toMatch(/Number\.isNaN\(d\.getTime\(\)\)/);
        expect(screen).toMatch(/return String\(v\);/);
        // الخادم يطبع الطابع بالتوقيت المحلي نفسه: لا «17:41 UTC» في الورقة
        // مقابل «20:41» في الدرج لنفس الواقعة.
        expect(backend).toMatch(/slice\(0, 16\)\.replace\('T', ' '\)/);
        expect(backend).toMatch(/const stamp = \(v\) => \{/);
        expect(backend).not.toMatch(/stamp\(new Date\(\)\)\} UTC/);
    });
});
