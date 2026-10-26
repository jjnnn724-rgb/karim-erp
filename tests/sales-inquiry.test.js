/**
 * sales-inquiry.test.js — عقد شاشة «استعلام المبيعات» (V2)
 * ═══════════════════════════════════════════════════════════════════════
 * الشاشة وعدُ المالك: «كل المبيعات، وكل صنف بكميته وفواتيره بكامل تفاصيلها،
 * وأقدر أطبع الفواتير»، بأرقام حقيقية من الكاشيرية. هذا الملف يثبّت الوعد
 * عند الأطراف الأربعة:
 *
 *   ١) الخادم: باب /item-invoices يقرأ مرآة yara فقط (ys_mirror_orders عبر
 *      jsonb_array_elements) — لا pos_orders ولا جدول أصناف وهمي، والإجماليات
 *      قبل LIMIT كي لا تتغير الأرقام بالترقيم، وسقف 93 يومًا، وno-store.
 *   ٢) المسار: الجلب عبر المستودع فقط (fetchItemInvoices) لا fetch مباشر في
 *      الشاشة، والطباعة عبر HTML الإيصال + عارض التطبيق (لأن نقطة الإيصال
 *      محمية برؤوس المصادقة)، ودور المالك/سو شيف يقرأ ويطبع لا يكتب.
 *   ٣) الواجهة: تربيط كامل (MENU_STRINGS + pg + config + nav-model +
 *      auth-navigation + preview) والمدى الافتراضي أول الشهر.
 *   ٤) الذوق: CSS برموز --erp-* فقط، بلا hex ولا px/rem/em ولا معالج inline.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const server = read('backend', 'yarasoft', 'yara-reports.js');
const receiptRoute = read('backend', 'cashier-module', 'pos-orders-history.js');
const repo = read('frontend', 'app', 'js', 'v2', 'data', 'yara-reports-repo.js');
const screen = read('frontend', 'app', 'js', 'v2', 'screens', 'sales-inquiry.js');
const css = read('frontend', 'app', 'css', 'v2', 'erp-sales-inquiry.css');
const v2html = read('frontend', 'app', 'v2.html');
const config = read('frontend', 'app', 'js', 'core', 'config.js');
const i18n = read('frontend', 'app', 'js', 'core', 'i18n.js');
const navModel = read('frontend', 'app', 'js', 'v2', 'layout', 'nav-model.js');
const authNav = read('frontend', 'app', 'js', 'features', 'auth-navigation.js');
const preview = read('frontend', 'app', 'js', 'v2', 'preview.js');
const settings = read('frontend', 'app', 'js', 'v2', 'screens', 'settings.js');

/** جسم الباب وحده — كي لا تتحقق الشروط على بقية العائلة. */
function door() {
    const start = server.indexOf("router.get('/item-invoices'");
    expect(start).toBeGreaterThan(-1);
    const end = server.indexOf("router.get('/received-items'", start);
    expect(end).toBeGreaterThan(start);
    return server.slice(start, end);
}

describe('الخادم — باب item-invoices', () => {
    test('أدوار القراءة الثلاثة نفسها (sous_chef/admin/owner) — لا دور كتابة', () => {
        expect(door()).toMatch(/requireRole\('sous_chef', 'admin', 'owner'\)/);
        expect(door()).not.toMatch(/requireRole\([^)]*'hr'/);
    });

    test('يقرأ مرآة المبيعات فقط — jsonb لا pos_orders ولا جدول أصناف', () => {
        const d = door();
        expect(d).toMatch(/FROM ys_mirror_orders o, jsonb_array_elements\(o\.lines\) e/);
        expect(d).toMatch(/GROUP BY o\.doc_no/);
        expect(d).not.toMatch(/pos_orders/);
        expect(d).not.toMatch(/INSERT|UPDATE|DELETE/);
    });

    test('الإجماليات تُحسب قبل LIMIT — الترقيم لا يغيّر الأرقام', () => {
        const d = door();
        const totalsSql = d.slice(d.indexOf('const totals = (await pool.query('), d.indexOf('params.push(limit'));
        expect(totalsSql).toMatch(/COUNT\(DISTINCT o\.doc_no\)/);
        expect(totalsSql).not.toMatch(/LIMIT/);
    });

    test('سقف 93 يومًا + no-store + تطبيع البحث العربي', () => {
        const d = door();
        expect(d).toMatch(/spanDays > 93/);
        expect(d).toMatch(/RANGE_TOO_WIDE/);
        expect(d).toMatch(/Cache-Control', 'no-store'/);
        expect(d).toMatch(/replace\(\/\^ال\/, ''\)/);
        expect(d).toMatch(/ILIKE/);
    });

    test('الفواتير تحمل كمية الصنف وسعره وإجماليه — لا مجرد رقم فاتورة', () => {
        const d = door();
        for (const col of ['item_qty', 'item_net', 'item_price', 'item_discount', 'item_vat', 'cashier_no']) {
            expect(d).toContain(col);
        }
        expect(d).toMatch(/LIMIT \$\$\{params\.length - 1\} OFFSET \$\$\{params\.length\}/);
    });

    test('باب item-sales صرّح بكود واسم الصنف (وإلا فقد node-pg الاسمين)', () => {
        const start = server.indexOf("router.get('/item-sales'");
        const end = server.indexOf("router.get('/orders'", start);
        const body = server.slice(start, end);
        expect(body).toMatch(/e->>'code' AS item_code/);
        expect(body).toMatch(/e->>'name' AS item_name/);
    });
});

describe('الطباعة — إيصال المرآة عبر عارض التطبيق', () => {
    test('نقطة الإيصال تقبل المالك وسو شيف (قراءة/طباعة) ولا تمنحهم كتابة', () => {
        const m = receiptRoute.match(/router\.get\('\/ys\/:docNo\/receipt-html', jwtAuth, requireRole\(([^)]*)\)/);
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/'owner'/);
        expect(m[1]).toMatch(/'sous_chef'/);
        expect(m[1]).toMatch(/'admin'/);
    });

    test('المستودع يجلب الإيصال بـ fetch خام وبرؤوس المصادقة (لا رابط target=_blank)', () => {
        const fn = repo.slice(repo.indexOf('export async function fetchReceiptHtml'));
        expect(fn).toMatch(/window\._jwt/);
        expect(fn).toMatch(/Authorization/);
        expect(fn).toMatch(/x-api-key/);
        expect(fn).toMatch(/receipt-html/);
    });

    test('الشاشة تكتب HTML الإيصال في العارض وتترك الطباعة لشريطه', () => {
        expect(screen).toMatch(/openInAppReport/);
        expect(screen).toMatch(/w\.document\.write\(html\)/);
        expect(screen).not.toMatch(/target="_blank"/);
        expect(screen).not.toMatch(/window\.open\(/);
    });
});

describe('المستودع والشاشة — قراءة فقط عبر المستودع', () => {
    test('fetchItemInvoices يعرف الباب والوسائط الستة', () => {
        expect(repo).toMatch(/export async function fetchItemInvoices\(/);
        expect(repo).toMatch(/\/yara-reports\/item-invoices/);
        for (const k of ['from', 'to', 'item', 'cashier', 'limit', 'offset']) {
            expect(repo).toContain(k);
        }
    });

    test('الشاشة لا تجلب مباشرة ولا تكتب شيئًا', () => {
        expect(screen).toMatch(/fetchItemInvoices/);
        expect(screen).toMatch(/fetchItemSales/);
        expect(screen).not.toMatch(/^\s*(await\s+)?fetch\(/m);
        expect(screen).not.toMatch(/apiFetch/);
        expect(screen).not.toMatch(/method:\s*'POST'/);
    });

    test('المدى الافتراضي أول الشهر الحالي، والسقف من المستودع', () => {
        expect(screen).toMatch(/function monthStart\(\)/);
        expect(screen).toMatch(/from: monthStart\(\), to: isoDay\(new Date\(\)\)/);
        expect(screen).toMatch(/YARA_MAX_SPAN_DAYS/);
        expect(screen).toMatch(/rangeError\(/);
    });

    test('نقر الصنف يفتح فواتيره، ونقر الفاتورة يفتح تفاصيلها', () => {
        expect(screen).toMatch(/data-v2-item-open/);
        expect(screen).toMatch(/data-v2-detail=/);
        expect(screen).toMatch(/fetchOrderDetail/);
        expect(screen).toMatch(/document\.write/);
    });

    test('الفواتير تُجلب بكود الصنف عند توفره — صنفان باسم واحد لا يختلطان', () => {
        expect(screen).toMatch(/state\.selectedKey = state\.selectedCode \|\| state\.selected/);
        expect(screen).toMatch(/item: state\.selectedKey \|\| state\.selected/);
        expect(screen).toMatch(/data-v2-item-code=/);
    });
});

describe('التربيط — الشاشة تصل للشريط الجانبي', () => {
    test('MENU_STRINGS + مفاتيح pg بالعربي والإنجليزي', () => {
        expect(i18n).toMatch(/'sales-inquiry':\s*\{ icon: '[a-z-]+', ar: 'استعلام المبيعات'/);
        expect(i18n).toMatch(/'pg\.sales-inquiry': 'استعلام المبيعات'/);
        expect(i18n).toMatch(/'pg\.sales-inquiry': 'Sales Inquiry'/);
    });

    test('الأدوار: admin وsous_chef وowner', () => {
        for (const role of ['admin', 'sous_chef', 'owner']) {
            const line = config.split('\n').find((l) => l.startsWith(`${role}:`));
            expect(line).toBeTruthy();
            expect(line).toContain(`'sales-inquiry'`);
        }
    });

    test('مجموعة تنقّل finance في الطبقتين + إدارة الصفحات في settings', () => {
        expect(navModel).toMatch(/'finance'[^\n]*'sales-inquiry'/);
        expect(authNav).toMatch(/'finance'[^\n]*'sales-inquiry'/);
        expect(settings).toContain(`'sales-inquiry'`);
    });

    test('preview: تحميل + مسار + تفكيك', () => {
        expect(preview).toMatch(/mountSalesInquiryScreen/);
        expect(preview).toMatch(/key === 'sales-inquiry'/);
        expect(preview).toMatch(/teardownSalesInquiryScreen/);
    });

    test('v2.html يحمل ملف الأنماط', () => {
        expect(v2html).toMatch(/css\/v2\/erp-sales-inquiry\.css/);
    });
});

describe('الذوق — رموز التصميم فقط', () => {
    test('لا ألوان خامة ولا مقاييس px/rem/em', () => {
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/\b\d+(\.\d+)?(px|rem|em)\b/);
    });

    test('يستهلك رموز --erp-* ويحترم الطباعة والحركة المخففة', () => {
        expect(css).toMatch(/var\(--erp-/);
        expect(css).toMatch(/@media print/);
        expect(css).toMatch(/prefers-reduced-motion/);
    });

    test('الشاشة بلا معالجات inline وبلا مكتبات ثقيلة', () => {
        expect(screen).not.toMatch(/\son[a-z]+=/);
        expect(screen).not.toMatch(/import .* from 'https?:/);
    });
});

/* ── الطباعة الكاملة + تصحيح فارق الهلالات ───────────────────────────────
   طلب المالك (2026-10-23): «عايز طباعة في استعلامات البيع … الفواتير في
   فارق هلالات المفروض يكون الصافي + الضريبة». هذه الكتلة تثبّت أن الطباعة
   ورقة A4 من الخادم بنفس فلترة الشاشة، وأن الإيصال لم يعد يقلب معنى
   net/total، وأن الفرق الجُملي يُطبع صراحةً بدل كتمانه. */
const cashierSalesRoutes = read('backend', 'cashier-sales-routes.js');

/** جسم باب الطباعة وحده. */
function sheetDoor() {
    const start = server.indexOf("router.get('/item-sales/print'");
    expect(start).toBeGreaterThan(-1);
    const end = server.indexOf("router.get('/orders'", start);
    expect(end).toBeGreaterThan(start);
    return server.slice(start, end);
}

describe('طباعة الاستعلام — ورقة A4 من الخادم', () => {
    test('باب /item-sales/print بأدوار القراءة الثلاثة وقراءة المرآة فقط', () => {
        const d = sheetDoor();
        expect(d).toMatch(/requireRole\('sous_chef', 'admin', 'owner'\)/);
        expect(d).toMatch(/FROM ys_mirror_orders o, jsonb_array_elements\(o\.lines\) e/);
        expect(d).not.toMatch(/pos_orders/);
        expect(d).not.toMatch(/INSERT|UPDATE|DELETE/);
    });

    test('نفس سقف العائلة وno-store ونفس تطبيع البحث العربي', () => {
        const d = sheetDoor();
        expect(d).toMatch(/spanDays > 93/);
        expect(d).toMatch(/RANGE_TOO_WIDE/);
        expect(d).toMatch(/Cache-Control', 'no-store'/);
        expect(d).toMatch(/replace\(\/\^ال\/, ''\)/);
        expect(d).toMatch(/GROUP BY 1, 2/);
    });

    test('هوية العلامة من settings بلا اسم برنامج الكاشيرية', () => {
        const d = sheetDoor();
        expect(server).toMatch(/FROM settings WHERE id = 'main_settings'/);
        expect(d).toMatch(/loadSheetBrand\(\)/);
        expect(server).toMatch(/logoB64/);
        expect(d).toMatch(/data-v2-print-brand/);
        expect(d).not.toMatch(/YaraSoft|يارا/);
    });

    test('الإجماليات قبل LIMIT، ورأس السند مقابل السطور يُعرضان معًا', () => {
        const d = sheetDoor();
        expect(d).toMatch(/COUNT\(DISTINCT o\.doc_no\)/);
        expect(d).toMatch(/SUM\(o\.net\)/);
        expect(d).toMatch(/خصم \/ تسوية كسور/);
        expect(d).toMatch(/فرق السطور عن رأس السند/);
    });

    test('ورقة الصنف تطبع فواتيره بكميته وسعره ومحصَّل كل فاتورة', () => {
        const d = sheetDoor();
        for (const col of ['item_qty', 'item_ex_vat', 'item_vat', 'item_price', 'o.net']) {
            expect(d).toContain(col);
        }
        expect(d).toMatch(/فواتير الصنف/);
    });

    test('المستودع يجلب الورقة برؤوس المصادقة لا برابط مباشر', () => {
        const fn = repo.slice(repo.indexOf('export async function fetchItemSalesSheetHtml'));
        expect(fn).toMatch(/item-sales\/print/);
        expect(fn).toMatch(/window\._jwt/);
        expect(fn).toMatch(/Authorization/);
        expect(fn).toMatch(/x-api-key/);
        expect(fn).toMatch(/res\.text\(\)/);
    });

    test('الشاشة: زر طباعة الاستعلام يمر بالعارض لا بتبويب جديد', () => {
        expect(screen).toMatch(/data-v2-print-sheet/);
        expect(screen).toMatch(/fetchItemSalesSheetHtml/);
        expect(screen).toMatch(/\[data-v2-print-sheet\]/);
        expect(screen).toMatch(/openInAppReport/);
        expect(screen).not.toMatch(/target="_blank"/);
    });
});

describe('فارق الهلالات — التسميات والمعادلة', () => {
    test('إيصال المرآة: قبل الضريبة = total، والإجمالي المحصَّل = net', () => {
        const block = receiptRoute.slice(receiptRoute.indexOf('const exVat = Number(slip.total'));
        expect(block).toMatch(/قبل الضريبة<\/span><span>\$\{num\(exVat\)\}/);
        expect(block).toMatch(/الإجمالي المحصَّل<\/span><span>\$\{num\(collected\)\}/);
        expect(block).not.toMatch(/قبل الضريبة<\/span><span>\$\{num\(slip\.net\)\}/);
    });

    test('الإيصال يطبع خصم/تسوية صريحًا كي تنطبق المعادلة', () => {
        const block = receiptRoute.slice(receiptRoute.indexOf('const exVat = Number(slip.total'));
        expect(block).toMatch(/const adj = Math\.round\(\(exVat \+ vatAmt - collected\)/);
        expect(block).toMatch(/خصم \/ تسوية/);
    });

    test('إيصال مبيعات الكاشير يعرض سطر التسوية أيضًا', () => {
        expect(cashierSalesRoutes).toMatch(/تسوية \(فرق المحصَّل عن صافٍ \+ ضريبة\)/);
        expect(cashierSalesRoutes).toMatch(/الإجمالي قبل الضريبة/);
    });

    test('بطاقة تفاصيل الفاتورة في الشاشة تعرض قبل الضريبة والمحصَّل والتسوية', () => {
        expect(screen).toMatch(/قبل الضريبة<\/span><span class="erp-emp-stat__v">\$\{money\(o\.total\)\}/);
        expect(screen).toMatch(/الإجمالي المحصَّل<\/span><span class="erp-emp-stat__v">\$\{money\(o\.net\)\}/);
        expect(screen).toMatch(/خصم \/ تسوية كسور/);
        expect(screen).toMatch(/المحصَّل \+ التسوية = قبل الضريبة \+ الضريبة/);
    });

    test('عناوين الجداول لا تسمّي قبل الضريبة «صافيًا»', () => {
        expect(screen).toMatch(/header: 'قبل الضريبة'/);
        expect(screen).toMatch(/header: 'المحصَّل للفاتورة'/);
        expect(screen).not.toMatch(/header: 'الصافي'/);
        expect(screen).not.toMatch(/صافي الفاتورة/);
    });
});
