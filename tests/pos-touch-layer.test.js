/**
 * pos-touch-layer.test.js — طبقة اللمس في شاشة الكاشير
 * ══════════════════════════════════════════════════════════════════════
 * جهاز الكاشير شاشة لمس قبل أن يكون حاسوبًا، وما يُثبَّت هنا:
 *   1) الصفحة تحمّل طبقة اللمس (CSS + JS) بإصدار كاش مطابق.
 *   2) أهداف اللمس الأساسية ≥ 44px عند مؤشر خشن، وtouch-action خالٍ من
 *      اللمس المزدوج المزعج.
 *   3) لوحة الأرقام اللمسية تُكتب على الحقول الأربعة نفسها وتُطلق حدث
 *      input القائم — لا نسخة ثانية من منطق حساب المدفوع.
 *   4) نافذة الفاتورة: إطار هو نفسه ما يُطبع، وزر طباعة حقيقي، وزر إغلاق.
 *   5) زر الدرج موجود في الترويسة ويستدعي المسار الصحيح.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const posHtml = read('frontend', 'app', 'pos.html');
const posJs = read('frontend', 'app', 'js', 'pos.js');
const touchCss = read('frontend', 'app', 'css', 'pos-touch.css');
const touchJs = read('frontend', 'app', 'js', 'pos-touch.js');

const version = JSON.parse(read('scripts', 'frontend-version.json')).version;

describe('طبقة اللمس — التحميل والإصدار', () => {
    test('pos.html يحمّل pos-touch.css وpos-touch.js بنفس إصدار الواجهة', () => {
        expect(posHtml).toContain(`css/pos-touch.css?v=${version}`);
        expect(posHtml).toContain(`js/pos-touch.js?v=${version}`);
    });

    test('الملفان موجودان وغير فارغين', () => {
        expect(touchCss.length).toBeGreaterThan(1000);
        expect(touchJs.length).toBeGreaterThan(1000);
    });
});

describe('طبقة اللمس — أحجام وأفعال اللمس', () => {
    test('المؤشر الخشن يكبّر أهداف اللمس إلى 44px على الأقل', () => {
        expect(touchCss).toMatch(/@media\s*\(pointer:\s*coarse\)/);
        expect(touchCss).toMatch(/min-height:\s*(4[4-9]|[5-9]\d)px|height:\s*(4[4-9]|[5-9]\d)px/);
        expect(touchCss).toMatch(/\.pay-channel input/);
        expect(touchCss).toMatch(/\.btn-complete/);
    });

    test('لا تأخير 300ms ولا قائمة سياق على شاشة اللمس', () => {
        expect(touchCss).toMatch(/touch-action:\s*manipulation/);
        expect(touchCss).toMatch(/-webkit-tap-highlight-color/);
        expect(touchJs).toMatch(/contextmenu/);
    });

    test('حالة الضغط مرئية وردّ فعل اللمس بلا hover عالق', () => {
        expect(touchCss).toMatch(/:active/);
        expect(touchCss).toMatch(/@media\s*\(hover:\s*none\)/);
    });

    test('لوحة الأرقام لا تظهر في الطباعة', () => {
        expect(touchCss).toMatch(/@media print[\s\S]*?\.pay-keypad\s*\{\s*display:\s*none/);
    });
});

describe('لوحة الأرقام اللمسية — نفس منطق الدفع', () => {
    test('الحقول الأربعة نفسها التي يقرأها حساب المدفوع', () => {
        for (const id of ['pay-cash', 'pay-card', 'pay-wallet', 'pay-bank']) {
            expect(posHtml).toContain(`id="${id}"`);
            expect(touchJs).toContain(`'${id}'`);
        }
    });

    test('«تم» يكتب القيمة ويُطلق حدث input القائم', () => {
        expect(touchJs).toMatch(/dispatchEvent\(new Event\('input',\s*\{\s*bubbles:\s*true\s*\}\)\)/);
    });

    test('لا تُفعّل إلا على مؤشر خشن، ولا تفتح لوحة النظام', () => {
        expect(touchJs).toMatch(/\(pointer:\s*coarse\)/);
        expect(touchJs).toMatch(/inputmode',\s*'none'/);
    });

    test('منزلتان عشريتان فقط وفاصلة واحدة', () => {
        expect(touchJs).toMatch(/decimalsOf\(next\)\s*>\s*2/);
        expect(touchJs).toContain("buffer.indexOf('.')");
    });
});

describe('نافذة الفاتورة — نفس الورقة التي تُطبع', () => {
    test('إطار الفاتورة موجود مع بديل نصي عند تعذر التحميل', () => {
        expect(posHtml).toContain('id="receipt-frame"');
        expect(posHtml).toContain('id="receipt-fallback"');
        expect(posJs).toMatch(/\/receipt-html/);
    });

    test('زر الطباعة يطبع محتوى الإطار أو يفتح صفحة الطلب', () => {
        expect(posHtml).toContain('id="print-receipt-btn"');
        expect(posJs).toMatch(/contentWindow\s*&&\s*.*\.print\(\)|contentWindow\.print\(\)/);
        expect(posJs).toMatch(/printReceipt\(/);
    });

    test('زر إغلاق صريح للنافذة', () => {
        expect(posHtml).toContain('id="close-receipt-btn"');
        expect(posJs).toMatch(/close-receipt-btn.*hideModal\('receipt-modal'\)/s);
    });
});

describe('زر الدرج في الترويسة', () => {
    test('الزر موجود ومربوط بمسار فتح الدرج', () => {
        expect(posHtml).toContain('id="drawer-btn"');
        expect(posJs).toMatch(/\/api\/pos\/drawer\/open/);
    });
});
