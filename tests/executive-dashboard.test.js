/**
 * executive-dashboard.test.js — موجز المدير: طلب واحد، أرقام حقيقية، بلا بطء
 * ══════════════════════════════════════════════════════════════════════
 * شرط المالك: لوحةٌ موجزة، كلّها تفاصيل، أنيميشن ورسوم عالمية، **بلا
 * تأثيرٍ على سرعة الواجهة** ولا على UI النظام القائم.
 *
 * ما يُثبَّت:
 *   1) طلبٌ واحد لكل اللوحة (لا waterfall ولا N+1).
 *   2) قراءةٌ فقط: لا INSERT/UPDATE/DELETE في مسار الموجز.
 *   3) الوحدة تُحمَّل كسولًا (import ديناميكي) ⇒ لا وزن على الإقلاع.
 *   4) رسوم SVG من مكتبة المشروع (بلا مكتبة خارجية).
 *   5) الأنيميشن CSS فقط (لا JS ⇒ لا إعادة رسم).
 *   6) كل رقم يحمل زرّ إجراء ⇒ «كيف أوصل لأفضل شي» مضمونة.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(ROOT, 'backend', 'executive-routes.js'), 'utf8');
const screen = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'executive.js'), 'utf8');
const preview = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'preview.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'css', 'v2', 'erp-executive.css'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

describe('موجز المدير — العقد', () => {
    test('الطلب واحد والأرقام من دفتر القيود', () => {
        const calls = [...screen.matchAll(/apiFetch\('([^']+)'/g)].map((m) => m[1]);
        expect(calls).toEqual(['/executive/summary']);
        expect(route).toMatch(/journal_entries/);
        expect(route).toMatch(/journal_lines/);
        expect(route).toMatch(/chart_of_accounts/);
    });

    test('قراءةٌ فقط — لا كتابة في مسار الموجز', () => {
        const queries = [...route.matchAll(/pool\.query\(\s*(`[\s\S]*?`|'[^']*')/g)]
            .map((m) => m[1].replace(/^[`'"]/g, ''));
        if (queries.length <= 3) {throw new Error('استعلامات قليلة — تحقّق من المسار');}
        const writers = queries.filter((q) => !/^\s*(SELECT|WITH)\b/i.test(q));
        if (writers.length) {throw new Error('استعلام كتابة: ' + writers.map((q) => q.slice(0, 70)).join(' || '));}
        expect(route).not.toMatch(/INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM/i);
    });

    test('الأدمن فقط (بيانات الإدارة كاملة)', () => {
        expect(route).toMatch(/requireRole\('admin'\)/);
        expect(route).toMatch(/jwtAuth/);
        expect(server).toMatch(/app\.use\('\/api\/executive', executiveRouter\)/);
    });

    test('التحميل كسول — لا وزن على إقلاع الصفحة', () => {
        expect(preview).toMatch(/await import\('\.\/screens\/executive\.js/);
        // لا استيراد ساكن للشاشة (وإلا دخلت حزمة الإقلاع)
        expect(preview).not.toMatch(/^import .*screens\/executive\.js/m);
    });

    test('رسوم SVG من مكتبة المشروع — بلا مكتبة خارجية', () => {
        expect(screen).toMatch(/from '\.\.\/charts\.js/);
        expect(screen).toMatch(/barChart\(/);
        expect(screen).toMatch(/lineChart\(/);
        expect(screen).toMatch(/donutChart\(/);
        expect(screen).not.toMatch(/chart\.js|cdn\.|unpkg|jsdelivr/i);
    });

    test('الأنيميشن CSS فقط (لا JS يعيد الرسم)', () => {
        expect(css).toMatch(/animation: erp-screen-in/);
        expect(css).toMatch(/prefers-reduced-motion/);
        expect(screen).not.toMatch(/setInterval|requestAnimationFrame/);
    });

    test('كل رقم إنذارٍ يحمل زرّ إجراء (الوصول لأفضل خطوة)', () => {
        expect(route).toMatch(/action: \{ label: '[^']+', screen: '[^']+' \}/);
        expect(screen).toMatch(/data-exec-go/);
        expect(screen).toMatch(/navigate\(b\.dataset\.execGo\)/);
    });

    test('طبقة اللوحة برموز --erp-* فقط (تتبع الوضع الليلي)', () => {
        const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-4\)/);
    });
});
