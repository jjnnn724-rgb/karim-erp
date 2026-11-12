/**
 * cashier-sales.test.js — مبيعات الكاشير (لوحة + فواتير + أصناف + ملف صنف + فاتورة)
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   1) مصدرُ الصدق واحد: ys_mirror_orders (مرآة CC_BILLS3 + CC_BILL_ENTER3).
 *      لا pos_orders ولا جدولٌ محليّ في الاستعلامات — الشاشة تدّعي أنها
 *      «من الكاشيرية 100٪»، فيُطلَب من الخادم أن يصدُق في ذلك.
 *   2) دلالةُ المال ثابتة: net هو المحصَّل فعلًا (شاملًا الضريبة) ⇒ collected،
 *      وtotal هو مجموع السطور قبل الضريبة ⇒ ex_vat. عكسُهما يقلّب الكشف.
 *   3) رداءةُ البيانات تُعرض ولا تُنعَّم: بلا سطور، بلا طابع ساعة، الفارق،
 *      دفعٌ لا يغطّي إجماليه، فرقُ مجاميع الدفع — تُحسب عند الخادم وتُطبع.
 *   4) الترقيم صادق: صفحةٌ من الخادم وعددُ المطابق كلّه من الخادم.
 *   5) لا حساب في الواجهة: النسبُ والمجاميعُ والمتوسطاتُ والفروقُ كلها الخادم.
 *   6) لوحةُ الفاتورة والورقةُ المطبوعة يقرآن نفسَ الصف من نفس الاستعلام
 *      (loadSlip) — فلا تختلف مطبوعةٌ عن معروضة.
 *   7) قراءةٌ فقط: لا INSERT/UPDATE/DELETE في الوحدة.
 *   8) الباب الواحد: الشاشة لا تعرف الشبكة؛ المستودع وحده يحمل المسارات.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const backend = read('backend', 'cashier-sales-routes.js');
const screen = read('frontend', 'app', 'js', 'v2', 'screens', 'cashier-sales.js');
const repo = read('frontend', 'app', 'js', 'v2', 'data', 'cashier-sales-repo.js');
const css = read('frontend', 'app', 'css', 'v2', 'erp-sales.css');
const preview = read('frontend', 'app', 'js', 'v2', 'preview.js');
const html = read('frontend', 'app', 'v2.html');

describe('مبيعات الكاشير — مصدر الصدق', () => {
    test('المرآة وحدها: لا جدول مبيعات محليّ في الاستعلامات', () => {
        expect(backend).toMatch(/FROM ys_mirror_orders o/);
        expect(backend).not.toMatch(/FROM pos_orders|JOIN pos_orders/);
        // السطورُ مصفوفةُ jsonb داخل السند لا جدول أسطر: والتوسيعُ مصدرُ الكميات
        expect(backend).toMatch(/jsonb_array_elements/);
        expect(backend).toMatch(/l->>'code'/);
        expect(backend).toMatch(/l->>'qty'/);
        // الحارسُ على jsonb_typeof يُبقي الاستعلام حيًّا لو خرج سطرٌ عن الشكل
        expect(backend).toMatch(/jsonb_typeof\(o\.lines\) = 'array'/);
    });

    test('اسم الكاشيرية من خريطة الإيرادات، والمجهولُ يُسمَّى لا يُحذف', () => {
        expect(backend).toMatch(/FROM yarasoft_revenue_map/);
        expect(backend).toMatch(/src_table = 'CC' AND active = true/);
        expect(backend).toMatch(/غير مُسند/);
    });

    test('دلالة المال: net محصَّلٌ شامل، وtotal صافٍ قبل الضريبة', () => {
        expect(backend).toMatch(/SUM\(o\.net\),0\)::float\s+AS collected/);
        expect(backend).toMatch(/SUM\(o\.total\),0\)::float\s+AS ex_vat/);
        expect(backend).toMatch(/o\.net::float AS collected/);
        expect(backend).toMatch(/o\.total::float AS ex_vat/);
    });

    test('التاريخ يُقرأ بـ to_char من SQL — لا toISOString على عمود DATE', () => {
        expect(backend).toMatch(/const DAY = \(col\) => `to_char\(\$\{col\},'YYYY-MM-DD'\)`/);
        // لا موضعَ يُجرح فيه تاريخُ المرآة بتحويلٍ محليّ
        expect(backend).not.toMatch(/doc_date[^`]*toISOString/);
    });
});

describe('مبيعات الكاشير — الرداءة تُعرض ولا تُنعَّم', () => {
    test('الخادم يعدّ المخالفات ويُرسل أرقامها — والتصنيف الأرشيفي بلا مبلغ', () => {
        expect(backend).toMatch(/AS no_lines/);
        expect(backend).toMatch(/ABS\(o\.net - \(o\.total \+ o\.vat\)\) > 0\.005/);
        expect(backend).toMatch(/AS drift_docs/);
        expect(backend).toMatch(/legacy_docs: Number\(t\.drift_docs\)/);
        expect(backend).toMatch(/legacy_adjustment: \(Number\(t\.drift_docs\) \|\| 0\) > 0/);
        expect(backend).toMatch(/line_vat: round2\(t\.line_vat\)/);
        expect(backend).toMatch(/AS pay_unreconciled/);
        expect(backend).toMatch(/unaccounted: round2\(collected - methods/);
    });

    test('الشاشة تُظهر كل مخالفة غير صفرية، لا تُصلحها في العرض', () => {
        for (const k of ['no_lines', 'pay_unreconciled', 'unaccounted']) {
            expect(screen).toMatch(new RegExp(`Number\\(?t\\.${k}\\)?`));
            expect(screen).toMatch(k === 'unaccounted'
                ? /Math\.abs\(Number\(t\.unaccounted\)/ : new RegExp(`t[.]${k}`));
        }
        // الأرشيف يُصنَّف عدديًّا فقط؛ لا مبلغ فرق ولا تسوية تُعرض أو تُحسب.
        expect(screen).toMatch(/t\.legacy_docs \?\? t\.drift_docs/);
        expect(screen).not.toMatch(/drift_amount|drift_large|drift_within_rounding/);
        expect(screen).not.toMatch(/t\.drift_docs\s*[-+]|t\.collected\s*[-+*/]\s*2/);
    });

    test('خانة الأرشيف في اللوحة: عددٌ بلا مبلغ ولا معادلة تسوية', () => {
        expect(screen).toMatch(/label: 'سجلات مؤرشفة'/);
        expect(screen).toMatch(/value: count\(t\.legacy_docs \?\? t\.drift_docs\)/);
        expect(screen).not.toMatch(/label: 'فارق التسوية'/);
        expect(screen).not.toMatch(/value: money\(t\.drift_amount/);
        expect(screen).not.toMatch(/count\(t\.drift_large_docs\)/);
    });

    test('لا بند «فرق/تسوية» في أي عرض أو طباعة — السجل القديم يُوسم أرشيفيًّا', () => {
        // الخادم يحتفظ بالحقول للتوافق فقط، والتقارير تقرأ ضريبة السطور.
        expect(backend).toMatch(/drift_large_docs/);
        expect(backend).toMatch(/line_vat/);
        expect(backend).toMatch(/SUM\(\(e->>'vat'\)::numeric\)/);
        // ولا سطر «تسوية» في الإيصال ولا عبارة «فرق» تُطبع.
        expect(backend).not.toMatch(/تسوية \(فرق المحصَّل/);
        expect(backend).toMatch(/سجل مؤرشف من النظام السابق/);
        expect(screen).not.toMatch(/s\.drift_within_rounding|r\.drift_within_rounding/);
        expect(screen).not.toMatch(/تعديلُ سعر|تعديلِ سعر|خصمٌ في الكاشيرية|خصمٌ عند البيع/);
        expect(backend).not.toMatch(/تعديلُ سعر|خصمٌ عند البيع/);
    });

    test('تغطيةُ الاعتماد الزكوي تُقاس وتُعلن، فلا تبدو الفواتيرُ مرفوضة', () => {
        expect(backend).toMatch(/async function loadZatcaCoverage/);
        expect(backend).toMatch(/ZATCA coverage unavailable/);
        expect(backend).toMatch(/zatca: zatcaCov/);
        expect(repo).toMatch(/zatca: data\.zatca \|\| null/);
        expect(screen).toMatch(/لا اعتمادٍ زكويًّا يغطّي الفترة/);
    });

    test('isvalid نصٌّ («True»/«False») لا منطقِيّ: يُقرأ نصًّا لا حقيقةً', () => {
        // «False» صحيحٌ في JS، فمرورُه كما هو يطبع «مُعتمدة» على سندٍ مرفوض
        expect(backend).toMatch(/row\.isvalid = \/\^\(true\|1\|y\|t\)\$\/i\.test\(String\(row\.isvalid/);
        expect(backend).toMatch(/zatca\.isvalid === true/);
    });

    test('الصنف ذو الاسمين لا يُدمج صامتًا: الرمزُ هو الوحدة', () => {
        expect(backend).toMatch(/COUNT\(DISTINCT[^)]*name[^)]*\)/i);
        expect(screen).toMatch(/csales__amb/);
    });
});

describe('مبيعات الكاشير — الترقيم والمشتقات', () => {
    test('صفحةٌ من الخادم وعددُ المطابق كلّه من الخادم', () => {
        expect(backend).toMatch(/LIMIT \$\{limit\} OFFSET \$\{offset\}/);
        expect(backend).toMatch(/page: \{ limit, offset \}/);
        // الفرزُ على قائمة بيضاء، فلا مفتاحُ فرزٍ يصل إلى SQL
        expect(backend).toMatch(/const ORDER_SORTS = \{/);
        expect(backend).toMatch(/const ITEM_SORTS = \{/);
        expect(backend).toMatch(/pickSort\(ORDER_SORTS/);
        expect(backend).toMatch(/pickSort\(ITEM_SORTS/);
        expect(screen).toMatch(/mode: 'server'/g);
        expect(screen).toMatch(/ordersTable\.setTotalRecords\(data\.totals\.count\)/);
        expect(screen).toMatch(/itemsTable\.setTotalRecords\(data\.totals\.count\)/);
    });

    test('المشتقات عند الخادم: نسبةٌ ومتوسطاتٌ ومقارنةٌ بفترة مماثلة', () => {
        expect(backend).toMatch(/const shareOf = \(v, total\) =>/);
        expect(backend).toMatch(/avg_invoice/);
        expect(backend).toMatch(/avg_day/);
        expect(backend).toMatch(/avg_items/);
        expect(backend).toMatch(/async function prevCollected/);
        // والعملةُ من الإعدادات، لا نصٌّ في الشاشة أو المستودع
        expect(backend).toMatch(/FROM settings WHERE id = 'main_settings'/);
        expect(screen).not.toMatch(/ر\.س|SAR/);
    });

    test('المرشّحاتُ تُبنى في موضعٍ واحد فتتطابق اللوحةُ والصفحةُ والكشف', () => {
        expect(backend).toMatch(/function buildWhere\(f\)/);
        expect(backend).toMatch(/function readQuery\(query\)/);
        expect(backend).toMatch('const dayRe = /^\\d{4}-\\d{2}-\\d{2}$/;');
    });
});

describe('مبيعات الكاشير — ملف الصنف والفاتورة', () => {
    test('ملفُ صنف: كميّته وكل فواتيره بسطورها منه', () => {
        expect(backend).toMatch(/router\.get\('\/item\/:code'/);
        expect(backend).toMatch(/const CODE_RE = \/\^\[\\w -\]\{1,24\}\$\/;/);
        expect(backend).toMatch(/async function loadItem/);
        expect(screen).toMatch(/paintItem/);
        expect(screen).toMatch(/fetchItem\(/);
    });

    test('الفاتورةُ على الشاشة: JSONٌ بنفس السطور والأربعة أعمدة الدفع', () => {
        expect(backend).toMatch(/router\.get\('\/invoice\/:docNo'/);
        expect(backend).toMatch(/const docNoRe = \/\^\[\\w-\]\{1,24\}\$\/;/);
        expect(backend).toMatch(/INVALID_DOC_NO/);
        expect(backend).toMatch(/NOT_FOUND/);
        expect(backend).toMatch(/due: round2\(round2\(slip\.collected\) - payed\)/);
        // أعمدةُ الدفع الأربعة تُرسَل بأسمائها العربية، لا تُبنى في الواجهة
        expect(backend).toMatch(/\{ key: 'cash', label: 'نقد'/);
        expect(backend).toMatch(/\{ key: 'network', label: 'شبكة'/);
        expect(backend).toMatch(/\{ key: 'mobile', label: 'جوال'/);
        expect(backend).toMatch(/\{ key: 'credit', label: 'آجل'/);
    });

    test('سطرٌ واحد للوحة والطبع: loadSlip تُقرأ من الاثنين', () => {
        const calls = [...backend.matchAll(/findAfterLive\(req, loadSlip, docNo\)/g)].length;
        expect(calls).toBe(2);
        expect(backend).toMatch(/async function loadSlip\(docNo\)/);
        expect(backend).toMatch(/router\.get\('\/invoice\/:docNo\/html'/);
    });

    test('الاعتماد الزكويّ يُقرأ بحذرٍ ولا يُدارى فشله', () => {
        expect(backend).toMatch(/FROM ora_e_invoices WHERE doc_no = \$1/);
        expect(backend).toMatch(/ZATCA row unavailable/);
        expect(screen).toMatch(/csales__zatca/);
    });
});

describe('مبيعات الكاشير — القراءة فقط', () => {
    test('لا كتابة في الوحدة', () => {
        expect(backend).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
        expect(backend).not.toMatch(/pool\.query\(\s*`\s*(INSERT|UPDATE|DELETE)/i);
    });

    test('كلُّ بابٍ مقفلٌ بالدور والمفتاح', () => {
        expect(backend).toMatch(/const READ_ROLES = \['admin', 'manager', 'accountant', 'cashier'\]/);
        const guards = [...backend.matchAll(/router\.get\([^,]+,\s*jwtAuth,\s*requireRole\(\.\.\.READ_ROLES\),\s*generalLimiter/g)].length;
        const routes = [...backend.matchAll(/router\.get\(/g)].length;
        expect(routes).toBeGreaterThan(5);
        expect(guards).toBe(routes);
    });
});

describe('مبيعات الكاشير — الباب الواحد والطباعة', () => {
    test('الشاشة لا تعرف الشبكة؛ المستودع وحده يحمل المسارات', () => {
        expect(screen).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen).toMatch(/from '\.\.\/data\/cashier-sales-repo\.js/);
        // كلُّ apiFetch يبدأ بمسارٍ كامل تحت /api: بلا البادئة يعود 404 صامتًا
        const paths = [...repo.matchAll(/apiFetch\(\s*`([^`]+)`/g)].map((m) => m[1]);
        expect(paths.length).toBeGreaterThan(3);
        for (const p of paths) {expect(p.startsWith('/cashier-sales/')).toBe(true);}
    });

    test('الورقتان HTML برؤوس المصادقة عبر العارض — لا قفزة متصفح', () => {
        expect(repo).toMatch(/Bearer \$\{window\._jwt\}/);
        expect(repo).toMatch(/x-api-key/);
        expect(repo).toMatch(/export function fetchInvoiceHtml/);
        expect(repo).toMatch(/export function fetchSheetHtml/);
        expect(repo).toMatch(/encodeURIComponent\(String\(docNo\)\)/);
        expect(screen).toMatch(/openInAppReport/);
        expect(screen).not.toMatch(/target="_blank"/);
        expect(screen).not.toMatch(/href="\/api\//);
    });

    test('ثلاثُ أوراقٍ للكشف بنفس المرشّحات: فواتيرٌ وأصنافٌ وصنفٌ واحد', () => {
        expect(backend).toMatch(/router\.get\('\/html'/);
        expect(backend).toMatch(/view === 'items'/);
        expect(backend).toMatch(/view === 'item'/);
        expect(backend).toMatch(/data-v2-print-brand/);
    });
});

/* ══ الورقةُ المطبوعة ═══════════════════════════════════════════════════
   الطباعةُ عقدٌ مستقل: ما يراه العميلُ على الورق لا على الشاشة. هذه
   الاختبارات تُثبَّت العلاتُ الثلاث التي كانت تُفسد الطباعة — تاريخٌ
   يُطبع معكوسًا، وإيصالٌ حراريٌّ يتشقَّق سطرُ إجماليه، وورقةٌ A4 بخطٍّ
   غيرِ خطِّ التطبيق لأن المستندَ المفردَ لا يرث شيئًا من الواجهة. */
describe('مبيعات الكاشير — الورقة المطبوعة', () => {
    test('التاريخُ داخل جملةٍ عربية يُعزل ثنائيًّا: لا فترةَ معكوسة على الورق', () => {
        expect(backend).toMatch('const ltr = (v) =>');
        // العزلةُ في الطبقتين معًا: كشفُ A4 والإيصالُ الحراريّ
        expect(backend).toMatch('.ltr { direction:ltr; unicode-bidi:isolate');
        expect(backend).toMatch('من ${f.from ? ltr(f.from)');
        expect(backend).toMatch('طُبع ${ltr(stamp(new Date()))}');
        expect(backend).toMatch('المرآة تبدأ من ${ltr(t.first_day');
        expect(backend).toMatch('آخر مزامنة ${ltr(stamp(t.synced_at))}');
    });

    test('ورقةُ A4 تحمل خطَّ الواجهة: مستندٌ مفردٌ بلا إرثٍ من التطبيق', () => {
        expect(backend).toMatch('const PRINT_FACES');
        expect(backend).toMatch('url(/app/fonts/v2/ibmplexsansarabic-normal-');
        expect(backend).toMatch("${PRINT_FACES}");
        expect(backend).toMatch('font-family: "IBM Plex Sans Arabic", Tahoma, Arial, sans-serif;');
        // الإيصالُ الحراريُّ لا يقوى على خطٍّ مُحمَّل: وجهُ نظامٍ واضح
        expect(backend).toMatch('body { font-family: Tahoma, "Segoe UI", Arial, sans-serif;');
    });

    test('الإيصالُ الحراريّ: ورقةٌ بمقاسها وأسطوانِ أرقامٍ مصفوفة', () => {
        expect(backend).toMatch('@page { size: 80mm 200mm; margin: 3mm 4mm 4mm; }');
        expect(backend).toMatch('.rcpt { width:100%; max-width:72mm;');
        expect(backend).toMatch('<th class="q">كمية × سعر</th><th class="v">الإجمالي</th>');
        // الإجماليُّ والعملتُها سطرٌ واحد: انفصالُهما كان يُسقط «ر.س» وحدها
        expect(backend).toMatch('<tr class="big"><td class="l">الإجمالي شامل الضريبة</td><td class="v">');
        expect(backend).toMatch('table.tot td.v { text-align:left; direction:ltr; unicode-bidi:isolate; white-space:nowrap;');
        expect(backend).toMatch('.hd img { width:17mm; height:17mm; object-fit:contain; }');
    });

    test('الإيصالُ نسخةُ عميل: لا سطرَ انضباطٍ ولا بند تسوية', () => {
        /* لا فارق تقريب يُطبع ولا بند تسوية — السجل القديم يُوسم أرشيفيًّا
           بلا مبلغ، والأرقام تُعرض كما وردت. */
        expect(backend).toMatch('const legacy = Math.abs(round2((slip.collected || 0)');
        expect(backend).toMatch('سجل مؤرشف من النظام السابق');
        expect(backend).not.toMatch('const driftLarge');
        expect(backend).not.toMatch('تسوية (فرق المحصَّل');
        expect(backend).not.toMatch('ملاحظة محاسبية:');
    });

    test('ترويسةُ الكشفِ فاتحةٌ للطابعة: حبرٌ داكنٌ على ورقٍ أبيض', () => {
        expect(backend).not.toMatch('linear-gradient(135deg,#0f172a');
        expect(backend).toMatch('.brand img { width:56px; height:56px; object-fit:contain; }');
        expect(backend).toMatch('border-bottom:2px solid #8fbfa9; }');
        expect(backend).toMatch('table.t th { background:#f3f5f3;');
    });

    test('الورقةُ لا تُبتر: ترويسةٌ ومؤشراتٌ لا تتشقَّق بين صفحتين', () => {
        expect(backend).toMatch('@page { size: A4; margin: 12mm 11mm 14mm; }');
        expect(backend).toMatch('.brand, .doc, .grid, .note, h3.sec { break-inside:avoid; page-break-inside:avoid; }');
        expect(backend).toMatch('table.t thead { display:table-header-group; }');
    });

    test('خلاصةُ المؤشرات: لا تكرارَ للفترة، ولا عملةٍ تُفصل عن رقمها', () => {
        // الفترةُ تُطبع في ترويسة العلامة مرةً واحدة
        expect(backend).not.toMatch("['الفترة', period");
        expect(backend).toMatch('const moneyLtr = (v, cur) =>');
        expect(backend).toMatch('moneyLtr(t.collected, brand.currency)');
        expect(backend).toMatch('moneyLtr(d.agg.ex_vat, brand.currency)');
        // وكلُّ خليةٍ تُبنى HTMLًا جاهزًا — لا قيمةَ خامًا تصل إلى الورقة
        expect(backend).toMatch('const cell = (k, v) =>');
        expect(backend).toMatch('.map(([k, v]) => cell(k, v))');
    });
});

describe('مبيعات الكاشير — الواجهة', () => {
    test('مكوّناتُ النظام لا طبقةً خاصة', () => {
        expect(screen).toMatch(/createDataTable/);
        expect(screen).toMatch(/lineChart\(\{/);
        expect(screen).toMatch(/barChart\(\{/);
        expect(screen).toMatch(/donutChart\(\{/);
        expect(screen).toMatch(/class="erp-kpis/);
        expect(screen).toMatch(/erp-dash-grid/);
        expect(screen).toMatch(/mountCashierSales/);
    });

    test('لا معالجات inline (CSP script-src-attr none)', () => {
        expect(screen).not.toMatch(/on(?:click|submit|input|change)\s*=\s*["']/);
        expect(screen).toMatch(/addEventListener\('click'/);
    });

    test('اللوحاتُ مكدّسةٌ والرسمُ القديم يُهمل', () => {
        expect(screen).toMatch(/const stack = \[\]/);
        expect(screen).toMatch(/stack\.push\(\{ kind: 'invoice'/);
        expect(screen).toMatch(/stack\.push\(\{ kind: 'item'/);
        expect(screen).toMatch(/const seq = \+\+paintSeq/);
        expect(screen).toMatch(/if \(seq !== paintSeq\) \{return;\}/);
        expect(screen).toMatch(/stack\.length = 0/);
    });

    test('الحالةُ تُعرض ولا تُبتلع: تحميلٌ وفشلٌ وفراغ', () => {
        expect(screen).toMatch(/ordersTable\.setError|itemsTable\.setError/);
        expect(screen).toMatch(/class="csales__panelState/);
        expect(screen).toMatch(/csales__empty|emptyMessage/);
    });

    test('التنظيف: مؤقّتٌ وجداولٌ وقفلُ جسم — ولا مستمع إغلاق كيبورد', () => {
        expect(screen).toMatch(/\bdestroy\(\) \{/);
        expect(screen).not.toMatch(/document\.removeEventListener\('keydown', onKey\)/);
        expect(screen).toMatch(/ordersTable\.destroy\(\)/);
        expect(screen).toMatch(/document\.body\.classList\.remove\('csales-open'\)/);
    });
});

describe('مبيعات الكاشير — الطبقة والنشر', () => {
    test('الطبقة برموز --erp-* فقط (تبعُ الوضع الليلي بلا إعادة رسم)', () => {
        /* الطبقةُ الأساسية برموز؛ استعلامات الوسائط (نقاط الكسر وأهداف اللمس)
           تقبل px بطبيعتها، فلا تُحسب على أنها خروجٌ عن الرموز. */
        const base = css.replace(/\/\*[\s\S]*?\*\//g, '').split('@media')[0];
        expect(base).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(base).not.toMatch(/rgba?\(/);
        expect(base).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(base).toMatch(/var\(--erp-space-/);
    });

    test('فخُّ hidden: اللوحاتُ داخل erp-stack فلها قاعدةٌ تُلغيها', () => {
        // .erp-v2 .erp-stack { display:flex } يتجاوز قاعدة المتصفح
        expect(css).toMatch(/\.erp-v2 \.csales__view\[hidden\] \{ display: none; \}/);
        expect(css).toMatch(/\.csales__panel\[hidden\]/);
        expect(css).toMatch(/body\.csales-open \{ overflow: hidden; \}/);
        expect(css).toMatch(/@keyframes csales-shimmer/);
        expect(screen).toMatch(/class="csales__view/);
    });

    test('الطبقة تُحمَّل في الصفحة والشاشةُ تُحمَّل كسولًا', () => {
        expect(html).toMatch(/css\/v2\/erp-sales\.css\?v=\d+\.\d+\.\d+/);
        expect(preview).toMatch(/await import\('\.\/screens\/cashier-sales\.js/);
        expect(preview).toMatch(/mod\.mountCashierSales/);
        expect(preview).toMatch(/teardownCashierSalesScreen\(\);\n\s*teardownWarehouseScreen/);
    });

    test('النشر: مفتاحٌ واحد في كل أبواب التنقّل والأذونات', () => {
        const nav = read('frontend', 'app', 'js', 'features', 'auth-navigation.js');
        const model = read('frontend', 'app', 'js', 'v2', 'layout', 'nav-model.js');
        const config = read('frontend', 'app', 'js', 'core', 'config.js');
        const i18n = read('frontend', 'app', 'js', 'core', 'i18n.js');
        const settings = read('frontend', 'app', 'js', 'v2', 'screens', 'settings.js');
        const perms = read('backend', 'permissions.js');
        expect(nav).toMatch(/'cash-register',\s*'cashier-sales'/);
        expect(model).toMatch(/'cash-register',\s*'cashier-sales'/);
        expect(perms).toMatch(/'cash-register',\s*'cashier-sales'/);
        expect(config).toMatch(/accountant:\s*\{[^}]*'cashier-sales'/);
        expect(i18n).toMatch(/'cashier-sales':\s*\{\s*icon: 'coins',\s*ar: 'مبيعات الكاشير'/);
        expect(i18n).toMatch(/'pg\.cashier-sales': 'مبيعات الكاشير'/);
        expect(settings).toMatch(/'cfo', 'cash-register', 'cashier-sales'/);
    });
});
