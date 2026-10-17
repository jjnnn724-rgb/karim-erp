/**
 * v2-kpi-grid.test.js — شريط مؤشرات اللوحة: ستّ بطاقات على قواسم الستّة (المرحلة ٣)
 * ═════════════════════════════════════════════════════════════════════════
 * العطب المقيس على الصفحة الحيّة (قبل هذا الإصلاح، الوضعان):
 *   `auto-fit` وحدها كانت تختار أكبر عدد أعمدة يتّسع، فتُنتج أعدادًا لا تقسم
 *   الستّة: **5+1** عند 1024–1420 (بطاقة يتيمة وحدها في صفٍّ ثانٍ) و**4+2** عند
 *   900 — والبطاقات مضغوطة على أرضيتها (172px) بينما السادسة تحت الصفّ.
 *   و`1fr` في القاعدة (لا `minmax(0, 1fr)`) تمنع التتبّع من النزول تحت عرض
 *   min-content لمحتواه — وهو باب التمرير الأفقي.
 *
 * وقاعدة الإصلاح: الستّة لا تقبل إلا قاسمًا لها — 6 · 3 · 2 · 1.
 *   ≥ 1440 : ستّة في صفّ واحد (`auto-fit` الحرّة تبقى، والمقاس يقول إن الستّة
 *            تتّسع في صفّ حتى منفذ 1425px في وضع الراحة الأوسع)
 *   641–1439 : 3+3
 *   381–640  : 2+2+2 (سلوك ≤640 القائم، لم يُمَسّ)
 *   ≤ 380    : بطاقة في كل صفّ (فيض محتوى البطاقة كان 2px كثيفًا و16px مريحًا
 *            عند 340/320)
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const DASH = path.join(CSS_V2, 'erp-dashboard.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** جسم كتلة `@media (max-width: N px)` — بأقواسٍ متوازنة. */
function mediaBlock(css, maxWidth) {
    const at = css.indexOf(`@media (max-width: ${maxWidth}px)`);
    if (at < 0) {return null;}
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') {depth++;}
        else if (css[i] === '}') {depth--; if (depth === 0) {return css.slice(open + 1, i);}}
    }
    return null;
}

/** جسم قاعدة `.erp-kpis` داخل نصّ (أول قاعدة فقط). */
function kpisRule(text) {
    const at = text.search(/\.erp-v2 \.erp-kpis\s*\{/);
    if (at < 0) {return null;}
    const open = text.indexOf('{', at);
    const close = text.indexOf('}', open);
    return text.slice(open + 1, close);
}

const CSS = strip(read(DASH));
const BASE = CSS.slice(0, CSS.indexOf('@media'));
const M1439 = mediaBlock(CSS, 1439);
const M640 = mediaBlock(CSS, 640);
const M380 = mediaBlock(CSS, 380);

/** كل أعداد الأعمدة المعلنة لشريط المؤشرات في الملف. */
function declaredCounts() {
    const found = [];
    const scopes = [BASE, M1439, M640, M380].filter(Boolean);
    for (const scope of scopes) {
        const body = kpisRule(scope);
        if (!body) {continue;}
        for (const m of body.matchAll(/repeat\(\s*(\d+)/g)) {found.push(Number(m[1]));}
    }
    return found;
}

describe('V2 شبكة المؤشرات — قواسم الستّة لا صفّ يتيم (المرحلة ٣)', () => {

    test('القاعدة: شبكة مرنة بحدٍّ أدنى لعرض البطاقة', () => {
        const body = kpisRule(BASE);
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*grid/);
        expect(body).toMatch(/grid-template-columns:\s*repeat\(auto-fit, minmax\(172px,\s*1fr\)\)/);
    });

    test('عدد الأعمدة لا يقسم الستّة إلا بما يقبل القسمة', () => {
        const counts = declaredCounts();
        expect(counts.length).toBeGreaterThan(0);
        expect(counts.filter((n) => 6 % n !== 0)).toEqual([]);
        expect(new Set(counts)).toEqual(new Set([3, 2]));
    });

    test('≤1439px: ثلاثة أعمدة بتتبّعٍ قابل للنزول (minmax(0, 1fr) لا 1fr)', () => {
        const body = kpisRule(M1439 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
        expect(body).not.toMatch(/repeat\(3,\s*1fr\)/);
    });

    test('≤640px: عمودان — سلوكٌ قائم قبل هذا العمل، محروسٌ من الانزلاق', () => {
        const body = kpisRule(M640 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*repeat\(2,\s*1fr\)/);
    });

    test('≤380px: عمود واحد يمنع فيض محتوى البطاقة', () => {
        const body = kpisRule(M380 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    test('الشريط نفسه لا يحمل تمريرًا أفقيًّا في أي عرض', () => {
        const offenders = [];
        for (const [name, scope] of [['base', BASE], ['1439', M1439], ['640', M640], ['380', M380]]) {
            const body = scope && kpisRule(scope);
            if (body && /overflow/i.test(body)) {offenders.push(name);}
        }
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('ترتيب نقاط التوقف تصاعديٌّ في الملف فلا يسبق الواسعَ الضيّق', () => {
        const i1439 = CSS.indexOf('@media (max-width: 1439px)');
        const i640 = CSS.indexOf('@media (max-width: 640px)');
        const i380 = CSS.indexOf('@media (max-width: 380px)');
        expect(i1439).toBeGreaterThan(-1);
        expect(i640).toBeGreaterThan(i1439);
        expect(i380).toBeGreaterThan(i640);
    });
});
