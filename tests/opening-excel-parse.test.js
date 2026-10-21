// ────────────────────────────────────────────────────────────────────────────
// opening-excel-parse.test.js — بلاغ المالك 2026-10-05
// «مش عارف أرفع شيت اكسيل» — شيت العميل أعمدته:
// اسم الصنف | الوحدة | كمية فعلية | سعر الشراء — والمدقق القديم كان يدور على
// «الكمية» فقط فرفض الملف. المحلل الجديد: يفهم «كمية فعلية» وأي تنويعات،
// يجرب أول 3 صفوف كصف عناوين، ورسالة الخطأ تطبع أعمدة الملف الفعلية.
// ────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'warehouse.js'), 'utf8')
    .replace(/export\s*\{[^}]*\};?/, '');

function build() {
    const factory = new Function('window', 'esc', 'fN', 'fC', 't', 'today',
        SRC + '\nreturn { parseOpeningSheetRows, openingHeaderKey, isOpeningMeatRow };');
    return factory({ whSelected: new Set(), whCatFilter: 'all' }, String, String, String, (k) => k,
        () => new Date().toISOString().split('T')[0]);
}

describe('رفع شيت Excel للرصيد الافتتاحي — يتطابق مع ملف المالك', () => {
    test('أعمدة المالك حرفيًا: اسم الصنف | الوحدة | كمية فعلية | سعر الشراء', () => {
        const m = build();
        const data = [
            ['اسم الصنف', 'الوحدة', 'كمية فعلية', 'سعر الشراء'],
            ['دجاج بلدي', 'كجم', 50, 30],
            ['طماطم', 'كجم', 10, 4],
        ];
        const r = m.parseOpeningSheetRows(data);
        expect(r.headerRow).toBe(0);
        expect(r.errors).toHaveLength(0);
        expect(r.rows).toHaveLength(2);
        expect(r.rows[0]).toMatchObject({ name: 'دجاج بلدي', qty: 50, unit: 'كجم', price: 30 });
    });

    test('صف عنوان فوق الجدول («رصيد مخزون بداية النظام الجديد 2027») لا يكسر التعرف', () => {
        const m = build();
        const data = [
            ['رصيد مخزون بداية النظام الجديد 2027'],
            ['اسم الصنف', 'الوحدة', 'كمية فعلية', 'سعر الشراء'],
            ['أرز', 'شكارة', 20, 3.5],
        ];
        const r = m.parseOpeningSheetRows(data);
        expect(r.headerRow).toBe(1);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]).toMatchObject({ name: 'أرز', qty: 20, price: 3.5 });
    });

    test('تنويعات الكتابة: همزات/تاء مربوطة/مسافات تُطبع تلقائيًا', () => {
        const m = build();
        const r = m.parseOpeningSheetRows([
            ['اسم الصنف', 'الوحدة', 'الكمية الفعليه', 'سعر الشراء'],
            ['سكر', 'شكارة', 7, 25],
        ]);
        expect(r.headerRow).toBe(0);
        expect(r.rows[0].qty).toBe(7);
    });

    test('ملف بأعمدة غير معروفة → رسالة الخطأ تطبع الأعمدة الفعلية للملف', () => {
        const m = build();
        const r = m.parseOpeningSheetRows([
            ['البيان', 'المبلغ'],
            ['أرز', 100],
        ]);
        expect(r.headerRow).toBe(-1);
        expect(r.errors[0].message).toContain('البيان');
        expect(r.errors[0].message).toContain('المبلغ');
    });

    test('صفوف بيانات خاطئة تُسجل كأخطاء بسيوفها — والصالحة تمر', () => {
        const m = build();
        const r = m.parseOpeningSheetRows([
            ['اسم الصنف', 'الوحدة', 'كمية فعلية', 'سعر الشراء', 'الكراتين'],
            ['بلا كمية', 'كجم', '', 5, ''],
            ['صفر كمية', 'كجم', 0, 5, ''],
            ['دجاج بلدي', 'كجم', 50, 30, 4],
            ['طماطم', 'كجم', 10, 4, 99], // كراتين لغير اللحوم → خطأ
        ]);
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0].name).toBe('دجاج بلدي');
        expect(r.rows[0].boxes).toBe(4);
        expect(r.errors).toHaveLength(3);
        expect(r.errors.map(e => e.line).sort((a, b) => a - b)).toEqual([2, 3, 5]);
    });

    test('نموذج التحميل نفسه يستخدم «كمية فعلية» — مطابقة لملف المالك', () => {
        build();
        // فحص مصدر: قالب التحميل يعتمد نفس أسماء الأعمدة التي يدعمها المحلل
        expect(SRC).toContain("['اسم الصنف','الوحدة','كمية فعلية','سعر الشراء'");
    });
});
