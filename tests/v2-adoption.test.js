/**
 * v2-adoption.test.js — اعتماد V2 كواجهة رسمية + تكافؤ القديم/الجديد
 * ══════════════════════════════════════════════════════════════════════
 * قرار المالك (2026-10-23): «قارن الجديدة بالقديمة، كل شيء انتقل، اعتمد
 * الواجهة الجديدة V2». هذا الملف يثبّت القرار بثلاثة شروط لا تُكسر:
 *
 *   1) لا قائمة في القديم بلا مسار في V2 — يُقارن حرفيًا:
 *      ALL_PERMISSIONS.menus في app.js ⟷ `key === '…'` في preview.js.
 *      لو أضاف أحدٌ قائمة قديمة جديدة ولم يبنِ لها شاشة V2، يسقط الاختبار.
 *   2) جذر /app/ يحوّل إلى V2، والقديمة تبقى على /app/index.html —
 *      اعتمادٌ ليس حبسًا: طريق الرجوع موجود في الطرفين.
 *   3) المالك يرى «بصمة الحضور» في V2 (شكواه الفعلية): مفتاح zkteco في
 *      قوائم دوره، ودور owner مقروء على الخادم (قراءة فقط، لا كتابة).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const appSrc = read('frontend', 'app', 'js', 'app.js');
const previewSrc = read('frontend', 'app', 'js', 'v2', 'preview.js');
const configSrc = read('frontend', 'app', 'js', 'core', 'config.js');
const serverSrc = read('backend', 'server.js');
const zkRoutes = read('backend', 'zkteco', 'routes.js');

/** مفاتيح قائمة القديم — الكتلة الحرفية ALL_PERMISSIONS.menus. */
function legacyMenus() {
    const block = appSrc.split('const ALL_PERMISSIONS = {')[1];
    if (!block) {throw new Error('ALL_PERMISSIONS غير موجودة في app.js');}
    return [...block.split('};')[0].matchAll(/^\s{4}'?([a-z0-9_-]+)'?\s*:/gim)].map((m) => m[1]);
}

/** مسارات V2 المعلنة في موزّع preview.js. */
function v2Routes() {
    return new Set([...previewSrc.matchAll(/key === '([a-z0-9_-]+)'/g)].map((m) => m[1]));
}

describe('اعتماد V2 — التكافؤ مع القديم', () => {
    test('كل قائمة في القديم لها مسار شاشة في V2 (صفر ناقص)', () => {
        const legacy = legacyMenus();
        expect(legacy.length).toBeGreaterThanOrEqual(40); // القائمة كاملة لا كتلة جزئية
        const routes = v2Routes();
        const missing = legacy.filter((k) => !routes.has(k));
        expect(missing).toEqual([]);
    });

    test('V2 تحمل شاشات أحدث من قائمة القديم (التطوير لم يتوقف)', () => {
        const routes = v2Routes();
        for (const key of ['cash-register', 'cashier-sales', 'monthly-comparison', 'yara-daily-locks', 'executive']) {
            expect(routes.has(key)).toBe(true);
        }
    });
});

describe('اعتماد V2 — بوابة الدخول والرجوع', () => {
    test('جذر /app/ يحوّل إلى V2', () => {
        expect(serverSrc).toMatch(/app\.get\(\['\/app', '\/app\/'\]/);
        expect(serverSrc).toMatch(/res\.redirect\(302, '\/app\/v2\.html\?live=1'\)/);
    });

    test('القديمة تبقى متاحة — طريق رجوع لا حبس', () => {
        // رابط «الرجوع للواجهة القديمة» داخل V2
        expect(previewSrc).toMatch(/window\.location\.assign\('index\.html'\)|href="index\.html"/);
        // ولا تحويل قسري على index.html نفسه
        expect(serverSrc).not.toMatch(/app\.get\(\['\/app\/index\.html'/);
    });
});

describe('المالك يرى بصمة الحضور في V2', () => {
    test('دور owner يحمل مفتاح zkteco في خريطة الأدوار', () => {
        expect(configSrc).toMatch(/owner:\s*\{[^}]*'zkteco'/);
    });

    test('الخادم يسمح للمالك بالقراءة فقط (لا كتابة)', () => {
        const readRoles = zkRoutes.match(/const READ_ROLES = \[([^\]]*)\]/)[1];
        const writeRoles = zkRoutes.match(/const WRITE_ROLES = \[([^\]]*)\]/)[1];
        expect(readRoles).toMatch(/'owner'/);
        expect(writeRoles).not.toMatch(/'owner'/);
    });
});
