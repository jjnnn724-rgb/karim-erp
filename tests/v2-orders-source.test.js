/**
 * v2-orders-source.test.js — «أحدث الفواتير» تقرأ المصدر الحقيقي
 * ══════════════════════════════════════════════════════════════════════
 * الدرس (2026-10-21): البورتليت في لوحة التحكم قال «لا فواتير صادرة
 * اليوم» — والسبب أنّه كان يقرأ `pos_orders` (جدول نقاط البيع المحلية)
 * وهو **فارغ عندنا** لأن البيع من YaraSoft؛ ومصدرُ المبيعات الحقيقي هو
 * مرآة `ys_mirror_orders`. وثانيًا: التقويم كان `CURRENT_DATE` (UTC)
 * لا يوم العمل بالرياض.
 *
 * ما يُثبَّت هنا:
 *   1) إحصاء اليوم وقائمة الفواتير يقرآن ys_mirror_orders.
 *   2) التقويم: يوم الرياض (riyadhToday) لا CURRENT_DATE.
 *   3) «كل الفواتير» مسارٌ مستقل بتفاصيل السند.
 *   4) الواجهة: زرّ «كل الفواتير» + لوحة التفاصيل.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const backend = fs.readFileSync(path.join(ROOT, 'backend', 'cashier-module', 'pos-orders-history.js'), 'utf8');
const repo = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'data', 'briefing-repo.js'), 'utf8');
const screen = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'briefing.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'css', 'v2', 'erp-briefing.css'), 'utf8');

describe('مصدر الفواتير — مرآة YaraSoft لا pos_orders', () => {
    test('إحصاء اليوم يقرأ ys_mirror_orders', () => {
        const stats = backend.slice(backend.indexOf("router.get('/stats/today'"), backend.indexOf("router.get('/list'"));
        expect(stats).toMatch(/FROM ys_mirror_orders/);
        expect(stats).not.toMatch(/FROM pos_orders\b/);
    });

    test('التقويم: يوم الرياض لا CURRENT_DATE', () => {
        const stats = backend.slice(backend.indexOf("router.get('/stats/today'"), backend.indexOf("router.get('/list'"));
        expect(stats).toMatch(/riyadhToday\(\)/);
        // التعليقات تُذكر CURRENT_DATE لشرح سبب تجنّبه ⇒ نفحص SQL وحده
        const sql = stats.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(sql).not.toMatch(/CURRENT_DATE/);
    });

    test('قائمة كل الفواتير: مسار مستقل بتفاصيل السند', () => {
        expect(backend).toMatch(/router\.get\('\/list'/);
        const list = backend.slice(backend.indexOf("router.get('/list'"));
        expect(list).toMatch(/doc_no AS invoice_counter/);
        expect(list).toMatch(/net AS net_amount/);
        expect(list).toMatch(/vat AS vat_amount/);
        expect(list).toMatch(/discount AS discount_amount/);
        expect(list).toMatch(/payed AS paid_amount/);
        expect(list).toMatch(/pay_cash AS cash/);
    });

    test('الواجهة: بنية السند الجديد + زرّ «كل الفواتير» + لوحة التفاصيل', () => {
        expect(repo).toMatch(/doc_time/);
        expect(repo).toMatch(/net: n\(o\.net_amount\)/);
        expect(screen).toMatch(/data-v2-all-orders/);
        expect(screen).toMatch(/openAllOrders/);
        expect(screen).toMatch(/erp-allorders__table/);
        expect(css).toMatch(/\.erp-allorders/);
    });
    test('ربط القسم صحيح: external_ref بصيغة ora:CC:<السند>', () => {
        expect(backend).toMatch(/r\.external_ref = 'ora:CC:' \|\| po\.doc_no/);
        expect(backend).toMatch(/AS dept_name/);
        expect(repo).toMatch(/dept_name/);
    });

    test('تفصيل السند: مسار YaraSoft + إيصال للطباعة', () => {
        expect(backend).toMatch(/router\.get\('\/ys\/:docNo'/);
        expect(backend).toMatch(/router\.get\('\/ys\/:docNo\/receipt-html'/);
        expect(backend).toMatch(/po\.lines/);
        expect(backend).toMatch(/items/);
        expect(backend).toMatch(/ora_e_invoices/);
        // المستودع يطلب التفاصيل، والشاشة تعرضها
        expect(repo).toMatch(/export async function fetchOrderDetail/);
        expect(screen).toMatch(/fetchOrderDetail\(/);
        expect(screen).toMatch(/طباعة الإيصال/);
        expect(screen).toMatch(/data-order/);
    });
});
