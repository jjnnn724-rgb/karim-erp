/**
 * asset-version.test.js — سياسة الكاش المبنية على الإصدار (2026-10-29)
 * ══════════════════════════════════════════════════════════════════════════
 * القرار: JS/CSS يُخزَّن immutable فقط إذا كان `?v=` مساويًا لإصدار
 * scripts/frontend-version.json — وهو رقم تفرضه بوابتان (frontend-version
 * وv2-revision) فلا يتغيّر ملف بلا رفع الرقم. أي رقم آخر يبقى no-cache.
 * هذا الاختبار يقفل التعريف، ويقفل أن السيرفر يستخدمه في الفرعين.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE = require(path.join(ROOT, 'backend', 'asset-version.js'));

function tmpJson(value) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'asset-version-')), 'state.json');
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
    return file;
}

describe('backend/asset-version — تعريف «الإصدار الحالي»', () => {
    test('الملف الحقيقي: رقم بصيغة نقاط يتساوي مع نسخة الإدارة', () => {
        const state = JSON.parse(fs.readFileSync(MODULE.STATE_FILE, 'utf8'));
        expect(MODULE.CURRENT).toMatch(/^\d+(\.\d+)+$/);
        expect(MODULE.CURRENT).toBe(String(state.version));
    });

    test('رقمٌ مطابق في الرابط → معروف كإصدار حالي', () => {
        expect(MODULE.isCurrentAssetVersion(`/app/js/v2/preview.js?v=${MODULE.CURRENT}`)).toBe(true);
        expect(MODULE.isCurrentAssetVersion(`/app/css/v2/erp-ops.css?v=${MODULE.CURRENT}&x=1`)).toBe(true);
        expect(MODULE.isCurrentAssetVersion(`/app/js/a.js?x=1&v=${MODULE.CURRENT}`)).toBe(true);
    });

    test('رقمٌ مختلف أو غائب أو مشوّه → ليس الإصدار الحالي (no-cache)', () => {
        expect(MODULE.isCurrentAssetVersion('/app/js/a.js?v=0.0.1')).toBe(false);
        expect(MODULE.isCurrentAssetVersion('/app/js/a.js')).toBe(false);
        expect(MODULE.isCurrentAssetVersion(`/app/js/a.js?v=${MODULE.CURRENT}0`)).toBe(false);
        expect(MODULE.isCurrentAssetVersion(`/app/js/a.js?v=${MODULE.CURRENT}-beta`)).toBe(false);
        expect(MODULE.isCurrentAssetVersion('')).toBe(false);
        expect(MODULE.isCurrentAssetVersion(null)).toBe(false);
        expect(MODULE.isCurrentAssetVersion(`/app/js/a.js?v=${MODULE.CURRENT}`, '')).toBe(false);
    });

    test('`?v=nocache` لا يُطابق إصدارًا حقيقيًا ولو شابه نصًّا', () => {
        expect(MODULE.assetVersion('/app/js/a.js?v=nocache')).toBe('nocache');
        expect(MODULE.isCurrentAssetVersion('/app/js/a.js?v=nocache')).toBe(false);
    });

    test('ملف تالف أو غائب أو رقم غير رقمي → "" بلا استثناء', () => {
        expect(MODULE.loadFrontendVersion(tmpJson('{oops'))).toBe('');
        expect(MODULE.loadFrontendVersion(path.join(os.tmpdir(), 'no-such-asset-version.json'))).toBe('');
        expect(MODULE.loadFrontendVersion(tmpJson({ version: '' }))).toBe('');
        expect(MODULE.loadFrontendVersion(tmpJson({ version: 'v4.9.1' }))).toBe('');
        expect(MODULE.loadFrontendVersion(tmpJson({ version: ' 4.9.186 ' }))).toBe('4.9.186');
    });
});

describe('backend/server.js — السياسة موصولة بالفرعين فعليًا', () => {
    const src = () => fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');
    const body = () => {
        const s = src();
        const start = s.indexOf('function setStaticCacheHeaders');
        const end = s.indexOf('\napp.use', start);
        return s.slice(start, end === -1 ? undefined : end);
    };

    test('يستورد التعريف من asset-version', () => {
        expect(src()).toMatch(/const \{ isCurrentAssetVersion \} = require\('\.\/asset-version'\);/);
    });

    test('CSS: الإصدار الحالي immutable، وما عداه no-cache', () => {
        const b = body();
        const css = b.slice(b.indexOf("} else if (['.css'].includes(ext)) {"), b.indexOf("} else if (['.js', '.mjs'].includes(ext)) {"));
        expect(css).toContain('versionedCurrent');
        expect(css).toContain('public, max-age=31536000, immutable');
        expect(css).toContain('NO_CACHE');
    });

    test('JS: vendor يبقى immutable دائمًا، والتطبيق يعتمد الإصدار الحالي', () => {
        const b = body();
        const js = b.slice(b.indexOf("} else if (['.js', '.mjs'].includes(ext)) {"), b.indexOf("} else if (['.json'].includes(ext)) {"));
        expect(js.length).toBeGreaterThan(200);
        expect(js).toContain('isVendorLib');
        expect(js).toContain('versionedCurrent');
        expect(js).toContain('NO_CACHE');
    });

    test('HTML يبقى بلا تخزين أبدًا — النسخة الجديدة لا تُحجب', () => {
        const b = body();
        const html = b.slice(b.indexOf("} else if (['.html', '.htm'].includes(ext)) {"));
        expect(html).toContain('NO_CACHE');
    });
});
