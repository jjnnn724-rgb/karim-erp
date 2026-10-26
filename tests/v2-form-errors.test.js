/**
 * v2-form-errors.test.js — أخطاء النماذج مرتبطة بحقولها
 * ═══════════════════════════════════════════════════════════════════════
 * الصندوق `role="alert"` يُعلن الرسالة، لكن بلا `aria-describedby` لا يعرف
 * قارئ الشاشة أيّ حقلٍ خاطئ، وبلا نقل التركيز يبقى مستخدم الكيبورد على زر
 * الحفظ. الاختبار يحرس العقد والربط في الشاشات الأربع.
 */
const fs = require('fs');
const path = require('path');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const HELPER = path.join(V2, 'form-errors.js');
const SCREENS = ['branches', 'expenses', 'revenues', 'procurement']
    .map((name) => ({name, file: path.join(V2, 'screens', `${name}.js`)}));

const read = (p) => fs.readFileSync(p, 'utf8');

describe('مساعد أخطاء النماذج', () => {
    const src = read(HELPER);

    test('يربط الحقل الخاطئ بالصندوق ويحفظ الربط السابق', () => {
        expect(src).toContain("input.setAttribute('aria-invalid', 'true');");
        expect(src).toMatch(/const kept = ids\.filter\(\(id\) => id !== box\.id\);/);
        expect(src).toContain("input.removeAttribute('aria-invalid');");
        expect(src).toMatch(/if \(!ids\.includes\(box\.id\)\) \{input\.setAttribute\('aria-describedby', \[\.\.\.ids, box\.id\]\.join\(' '\)\);\}/);
    });

    test('ينقل التركيز إلى أول حقل خاطئ بلا قفزة صفحة', () => {
        expect(src).toContain('firstBad.focus({preventScroll: true})');
        expect(src).toContain("firstBad.scrollIntoView({block: 'nearest'})");
        expect(src).toMatch(/if \(firstBad\) \{/);
    });

    test('رسالة الخادم العامة (بلا حقل) تُعلن ولا تسحب التركيز', () => {
        // مجموعة الحقول الخاطئة تُصفّى من الفراغ، فلا يدخلها خطأ عام.
        expect(src).toContain('new Set(errors.map((e) => e.field).filter(Boolean))');
    });
});

describe.each(SCREENS)('شاشة $name', ({file}) => {
    const src = read(file);

    test('تستعمل المساعد بدل نسخة محلية', () => {
        expect(src).toMatch(/import \{ paintFormErrors \} from '\.\.\/form-errors\.js\?v=/);
        expect(src).toMatch(/function showFormErrors\(errors\) \{\s*paintFormErrors\(/);
        expect(src).not.toMatch(/errors\.some\(\(e\) => e\.field === key\)/);
    });

    test('صندوق الخطأ معرّف كي يصل إليه aria-describedby', () => {
        expect(src).toMatch(/<div class="erp-error" id="v2[a-z]+-form-error" data-v2-form-error role="alert"><\/div>/);
    });
});

describe('تسميات الحقول في النماذج', () => {
    test('الإعدادات تربط تسمياتها الشقيقة تلقائيًّا عند كل رسم', () => {
        const src = read(path.join(V2, 'screens', 'settings.js'));
        expect(src).toMatch(/import \{ bindAdjacentLabels \} from '\.\.\/form-errors\.js\?v=/);
        expect(src).toContain('bindAdjacentLabels(node)');
        expect(src).toContain('new MutationObserver(');
        expect(src).toContain('bindAdjacentLabels(el);');
        expect(src).toContain('labelObserver.disconnect();');
        const helper = read(HELPER);
        expect(helper).toContain('export function bindAdjacentLabels(root)');
        expect(helper).toContain("root.querySelectorAll('label:not([for])')");
        expect(helper).toContain('label.htmlFor = control.id');
        expect(helper).toContain("if (label.querySelector('input, select, textarea')) {return;}");
    });

    test('أدوات الحضور: كل حقل معرّف وتسميته تشير إليه', () => {
        const src = read(path.join(V2, 'screens', 'attendance.js'));
        for (const id of ['res-type', 'res-in', 'res-out', 'res-with', 'res-reason',
            'exc-emp', 'exc-date', 'exc-reason', 'cor-in', 'cor-out', 'cor-reason', 'sh-month']) {
            expect(src).toContain(`for="v2att-${id}"`);
            expect(src).toContain(`id="v2att-${id}"`);
        }
    });

    test('تقرير الكاشيرية: مرشّحا الكاشير والعرض مسمّيان', () => {
        const src = read(path.join(V2, 'screens', 'reports.js'));
        expect(src).toContain('for="v2rep-y-cashier"');
        expect(src).toContain('id="v2rep-y-cashier"');
        expect(src).toContain('for="v2rep-y-view"');
        expect(src).toContain('id="v2rep-y-view"');
    });

    test('قيد اليومية اليدوي: خلايا الجدول لها أسماء صف ومدين/دائن', () => {
        const src = read(path.join(V2, 'screens', 'cfo.js'));
        expect(src).toContain('aria-label="حساب السطر ${i + 1}"');
        expect(src).toContain('aria-label="مدين — السطر ${i + 1}"');
        expect(src).toContain('aria-label="دائن — السطر ${i + 1}"');
        expect(src).toContain('for="v2cfo-jl-date"');
        expect(src).toContain('for="v2cfo-jl-memo"');
    });

    test('نموذج إضافة حركة على القسم مسمّى كاملًا', () => {
        const src = read(path.join(V2, 'screens', 'departments.js'));
        for (const id of ['m-label', 'm-amount', 'm-date', 'm-category', 'm-notes', 'dfrom', 'dto']) {
            expect(src).toContain(`for="v2dept-${id}"`);
            expect(src).toContain(`id="v2dept-${id}"`);
        }
    });

    test('لوحة المستخدم مربوطة الحقول: الاسم، الدخول، المرور، الدور، الموظف، الحالة', () => {
        const src = read(path.join(V2, 'screens', 'users.js'));
        for (const id of ['name', 'username', 'password', 'role', 'employee', 'active']) {
            expect(src).toContain(`for="v2u-${id}"`);
            expect(src).toContain(`id="v2u-${id}"`);
        }
        expect(src).toContain('role="group" aria-labelledby="v2u-dept-label"');
    });
});
