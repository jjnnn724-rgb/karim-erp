/**
 * cash-register.test.js — سجلّ الصرف + إذن الصرف
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   1) سجلّ الصرف يقرأ expenses ويربط كل حركة بإذنها (dispatches) عبر
 *      رقم الإذن المستخرَج من البيان — لا استعلامات جديدة على جداول.
 *   2) إذن الصرف يعرض سلسلة الاعتمادات (مُعِدّ · مستودع · مطبخ · استلام).
 *   3) «المبلغ كتابةً» بالعربية (الشرط المحاسبي الأول في الإذن).
 *   4) قراءةٌ فقط: لا INSERT/UPDATE/DELETE في وحدة السجل.
 *   5) الواجهة: شاشة مستقلة (تحميل كسول) + جدول + درج الإذن + طباعة.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const backend = fs.readFileSync(path.join(ROOT, 'backend', 'expense-register-routes.js'), 'utf8');
const screen = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'cash-register.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'css', 'v2', 'erp-cash.css'), 'utf8');
const preview = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'preview.js'), 'utf8');

describe('سجلّ الصرف + إذن الصرف', () => {
    test('السجل يقرأ expenses ويربط الإذن من رقمه في البيان', () => {
        expect(backend).toMatch(/FROM expenses e/);
        expect(backend).toMatch(/LEFT JOIN dispatches d/);
        expect(backend).toMatch(/substring\(e\.notes from 'طلب صرف #\(\[0-9\]\+\)'\)/);
    });

    test('إذن الصرف: الطلب باعتماداته وأصنافه وسلسلة وقائعه', () => {
        expect(backend).toMatch(/FROM dispatches WHERE id::text = \$1/);
        expect(backend).toMatch(/dispatch_workflow_events/);
        expect(backend).toMatch(/approvedItems/);
        expect(backend).toMatch(/chefApprovedBy/);
        expect(backend).toMatch(/kitchenReceivedBy/);
    });

    test('المبلغ كتابةً بالعربية (شرط الإذن المحاسبي)', () => {
        expect(backend).toMatch(/function amountInWords/);
        expect(backend).toMatch(/مليون/);
        expect(backend).toMatch(/ألف/);
        expect(backend).toMatch(/هللة/);
        expect(backend).toMatch(/فقط لا غير/);
    });

    test('قراءةٌ فقط: لا كتابة في وحدة السجل', () => {
        expect(backend).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM/i);
        expect(backend).not.toMatch(/pool\.query\(\s*`\s*(INSERT|UPDATE|DELETE)/i);
    });

    test('الواجهة: شاشة مستقلة + درج الإذن + طباعة', () => {
        expect(preview).toMatch(/await import\('\.\/screens\/cash-register\.js/);
        expect(screen).toMatch(/mountCashRegister/);
        expect(screen).toMatch(/data-cr-voucher/);
        expect(screen).toMatch(/طباعة الإذن/);
        expect(screen).not.toMatch(/on(?:click|submit)\s*=\s*["']/);
    });

    test('الطباعة عبر العارض برؤوس المصادقة — لا قفزة متصفح (ترجع 401)', () => {
        expect(screen).toMatch(/openInAppReport/);
        expect(screen).toMatch(/x-api-key/);
        expect(screen).toMatch(/Bearer \$\{window\._jwt\}/);
        // قفزة <a target="_blank"> إلى نقطة HTML المحمية تبقى بلا رأس مفتاح
        expect(screen).not.toMatch(/target="_blank"/);
        expect(screen).not.toMatch(/href="\/api\//);
    });

    test('النشر: التسمية والأدوار والإعدادات — dispatch «أذون الصرف» وcash-register «سجلّ الصرف»', () => {
        const i18n = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'core', 'i18n.js'), 'utf8');
        const config = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'core', 'config.js'), 'utf8');
        const settings = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'settings.js'), 'utf8');
        const briefing = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'briefing.js'), 'utf8');
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
        // (fetchReceiptHtml) والعرض بالعارض — كان href ي我怕 401.
        expect(briefing).toMatch(/openInAppReport/);
        expect(briefing).toMatch(/data-v2-print-receipt/);
        expect(briefing).not.toMatch(/receipt-html">طباعة الإيصال/);
        expect(briefing).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        const briefingRepo = fs.readFileSync(
            path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'data', 'briefing-repo.js'), 'utf8');
        expect(briefingRepo).toMatch(/export async function fetchReceiptHtml/);
        expect(briefingRepo).toMatch(/receipt-html/);
    });

    test('الطبقة برموز --erp-* فقط (تبع الوضع الليلي بلا إعادة رسم)', () => {
        const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-4\)/);
    });
});
