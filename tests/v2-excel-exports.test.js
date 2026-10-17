/**
 * v2-excel-exports.test.js — تصدير Excel في التحليلات الثلاثة
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/wh-vs-pos.js:297 · features/sales-analyzer.js:366 ·
 * features/received-analyzer.js:545 — نفس الأعمدة وأسماء الملفات، والمكتبة
 * (892 KB) لا تُحمَّل إلا عند أول نقر. القديم نفسه لا يُمس.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const V2 = path.join(ROOT, 'frontend', 'app', 'js', 'v2');
const LEGACY = path.join(ROOT, 'frontend', 'app', 'js', 'features');
const read = (p) => fs.readFileSync(p, 'utf8');
const screen = (name) => read(path.join(V2, 'screens', `${name}.js`));
const legacy = (name) => read(path.join(LEGACY, `${name}.js`));
const NAMES = ['wh-vs-pos', 'sales-analyzer', 'received-analyzer'];

/** جسم دالة التصدير وحدها — أقرب `}` بمحاذاة 4 مسافات بعد تعريفها. */
function exportBody(src, fn = 'exportExcel') {
    const start = src.indexOf(`async function ${fn}()`);
    expect(start).toBeGreaterThan(-1);
    const end = src.indexOf('\n    }', start);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end);
}

describe('تصدير Excel — زر وتحميل عند الطلب', () => {
    for (const name of NAMES) {
        test(`${name}: زر واحد، معالج نقر واحد، وctx.notify للنتيجة`, () => {
            const s = screen(name);
            expect((s.match(/data-v2-excel>/g) || []).length).toBe(1);
            expect(s).toContain("event.target.closest('[data-v2-excel]')");
            expect((s.match(/exportExcel\(\);/g) || []).length).toBe(1);
            expect(s).toMatch(/const notify = typeof ctx\.notify === 'function'/);
            expect(s).toMatch(/import \{ ensureXlsx \} from '\.\.\/vendor\.js\?v=\d+\.\d+\.\d+';/);
        });

        test(`${name}: المكتبة لا تُطلب قبل النقر — ensureXlsx داخل التصدير وحده`, () => {
            const s = screen(name);
            const body = exportBody(s);
            expect((s.match(/await ensureXlsx\(\)/g) || []).length).toBe(1);
            expect(body).toContain('await ensureXlsx()');
            expect(s.indexOf('await ensureXlsx()')).toBeGreaterThan(s.indexOf('async function exportExcel()'));
            // كل استخدامات XLSX بعد بداية دالة التصدير — لا تحميل في القالب
            expect(s.indexOf('window.XLSX')).toBeGreaterThan(s.indexOf('async function exportExcel()'));
            expect(body).toContain('if (exporting) {return;}');
            expect(body).toContain('مكتبة Excel غير محمّلة — حدّث الصفحة');
            expect(s).not.toMatch(/\balert\s*\(/);
        });
    }
});

describe('wh-vs-pos — أعمدة القديم حرفياً', () => {
    const s = screen('wh-vs-pos');
    const body = exportBody(s);

    test('أعمدة التصدير الأحد عشر كما في features/wh-vs-pos.js:299', () => {
        const headers = ['الصنف', 'مصروف من المخزن', 'مبيع بالكاشيرية', 'الفرق', 'النسبة %',
            'قيمة المبيع الصافي', 'قيمة المبيع الإجمالي', 'عدد الأذونات', 'عدد الفواتير', 'القسم', 'الحالة'];
        const old = legacy('wh-vs-pos');
        for (const h of headers) {
            expect(body).toContain(`'${h}'`);
            expect(old).toContain(`'${h}'`);
        }
        expect(body).toContain("window.XLSX.utils.book_append_sheet(wb, ws, 'المقارنة')");
    });

    test('أسماء الحالات واسم الملف كما في القديم', () => {
        expect(s).toMatch(/match: 'متطابق', sold_more: 'المبيع أكثر', issued_more: 'المصروف أكثر'/);
        expect(s).toContain("pos_only: 'مباع فقط', wh_only: 'مصروف فقط'");
        expect(body).toContain('STATUS_AR[r.status] || r.status');
        expect(body).toContain('window.XLSX.writeFile(wb, `wh-vs-pos_${f.from}_${f.to}.xlsx`)');
        expect(legacy('wh-vs-pos')).toContain('wh-vs-pos_${WV.from}_${WV.to}.xlsx');
    });

    test('حقول الخادم التي يحتاجها التصدير محفوظة في الصف', () => {
        for (const key of ['status', 'pos_net', 'pos_gross', 'wh_docs', 'pos_invoices', 'dept']) {
            expect(s).toMatch(new RegExp(`${key}: `));
        }
        expect(s).toContain('r.pct == null ? \'\' : r.pct');
    });
});

describe('sales-analyzer — تصدير التبويب النشط', () => {
    const s = screen('sales-analyzer');
    const body = exportBody(s);
    const old = legacy('sales-analyzer');

    test('تبويب الأوردرات: أعمدة القديم الأربعة عشر واسم orders_', () => {
        const headers = ['الفاتورة', 'الكاشير', 'التاريخ', 'الوقت', 'الوردية', 'الصافي', 'الإجمالي',
            'الخصم', 'الضريبة', 'مدفوع', 'نقدًا', 'شبكة', 'الأصناف', 'المنطقة'];
        for (const h of headers) {
            expect(body).toContain(`'${h}'`);
            expect(old).toContain(`'${h}'`);
        }
        expect(body).toContain("window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(data), 'الأوردرات')");
        expect(body).toContain('orders_${f.from}_${f.to}.xlsx');
        expect(old).toContain('orders_${SA.from}_${SA.to}.xlsx');
    });

    test('تبويب التحليل: عنوان التجميع + الأعمدة الستة واسم item-sales_', () => {
        expect(body).toContain("const grpLabel = { item: 'الصنف', cashier: 'الكاشير', day: 'اليوم' }[f.group];");
        for (const h of ['فواتير', 'الكمية', 'الصافي', 'الضريبة', 'الإجمالي']) {
            expect(body).toContain(`'${h}'`);
        }
        expect(body).toContain("'تحليل المبيعات'");
        expect(body).toContain('item-sales_${f.from}_${f.to}.xlsx');
        expect(old).toContain('item-sales_${SA.from}_${SA.to}.xlsx');
    });

    test('الاختيار بالتبويب الحالي لا بتبويب ثابت', () => {
        expect(body).toContain("if (tab === 'orders')");
        expect((body.match(/window\.XLSX\.writeFile/g) || []).length).toBe(2);
    });
});

describe('received-analyzer — ثلاث أوراق بلا فقد', () => {
    const s = screen('received-analyzer');
    const body = exportBody(s);
    const old = legacy('received-analyzer');

    test('أوراق المصروفات والأذونات والأصناف بأسماء القديم', () => {
        for (const sheet of ['المصروفات', 'أذونات الصرف', 'الأصناف المستلمة']) {
            expect(body).toContain(`'${sheet}'`);
            expect(old).toContain(`'${sheet}'`);
        }
        expect((body.match(/book_append_sheet/g) || []).length).toBe(3);
        expect(body).toContain('received_${f.from}_${f.to}.xlsx');
    });

    test('أعمدة الاستهلاك + خريطة الحالة كما في features/received-analyzer.js:549', () => {
        for (const h of ['الصنف', 'وارد بالفترة', 'مصروف بالفترة', 'الرصيد الكلي',
            'متوسط يومي', 'الحالة', 'أول حركة', 'آخر حركة']) {
            expect(body).toContain(`'${h}'`);
            expect(old).toContain(`'${h}'`);
        }
        expect(s).toMatch(/negative: 'سالب', depleted: 'صفر', low: 'منخفض', ok: 'سليم'/);
        expect(body).toContain('OUTFLOW_ALERT_AR[r.alert] || r.alert');
    });

    test('أعمدة الأذونات والأصناف — بما فيها المعتمد والفرق المخزَّنان', () => {
        for (const h of ['الإذن', 'القسم', 'التاريخ', 'وقت الاستلام', 'المستلم', 'أصناف', 'إجمالي الكمية', 'ملاحظات']) {
            expect(body).toContain(`'${h}'`);
            expect(old).toContain(`'${h}'`);
        }
        for (const h of ['أذونات', 'كمية مستلمة', 'كمية معتمدة', 'الفرق']) {
            expect(body).toContain(`'${h}'`);
            expect(old).toContain(`'${h}'`);
        }
        expect(s).toContain('approved_qty: Number(r.approved_qty) || 0');
        expect(s).toContain('variance_qty: Number(r.variance_qty) || 0');
        expect(s).toContain('outflowRows = outflow && Array.isArray(outflow.rows) ? outflow.rows : [];');
        expect((s.match(/outflowRows = \[\];/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('عنوان التجميع يتبع الاختيار الحالي', () => {
        expect(body).toContain("const grpLabel = { item: 'الصنف', dept: 'القسم', day: 'اليوم' }[group];");
        expect(body).toContain('r.label, r.dispatches, r.qty, r.approved_qty, r.variance_qty');
    });
});

describe('القديم لا يُمس', () => {
    test('دوال التصدير القديمة ما زالت على حالها', () => {
        expect(legacy('wh-vs-pos')).toContain('function wvExportExcel()');
        expect(legacy('sales-analyzer')).toContain('function saExportExcel()');
        expect(legacy('received-analyzer')).toContain('function raExportExcel()');
        expect(legacy('sales-analyzer')).toContain("if (typeof XLSX === 'undefined')");
        expect(legacy('received-analyzer')).toContain("if (typeof XLSX === 'undefined')");
        expect(legacy('wh-vs-pos')).toContain("if (typeof XLSX === 'undefined')");
    });
});
