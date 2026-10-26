/**
 * v2-kpi-grid.test.js — سجل المؤشرات الموحّد: قواسم الستّة لا صفّ يتيم
 * ═════════════════════════════════════════════════════════════════════════
 * 2026-10-26: شريط المؤشرات صار سجلًا مرقّمًا واحدًا لكل شاشات V2 — بيتُه
 * erp-components.css على `.erp-v2 .erp-kpis` (كانت قواعده متفرقة بين
 * erp-dashboard والهوية، ولهجتها بطاقات auto-fit متفاوتة الأعمدة).
 *
 * العطب المقيس تاريخيًا (قبل المرحلة ٣): `auto-fit` تختار أكبر عدد يتّسع
 * فتُنتج 5+1 و4+2 (صف يتيم)، و`1fr` العارية تمنع التتبّع من النزول تحت
 * min-content — باب التمرير الأفقي. قاعدة السجل الموحد: تتبّع `minmax(0,1fr)`
 * دائمًا، والأعمدة كلها قواسم للستّة:
 *   القاعدة : 3 أعمدة (سجل 3×N)
 *   ≥ 1680  : 6 أعمدة — الصف الواحد للوحات العريضة. 1440 يقيس 176px للخلية
 *             فيبقى 76px للاسم، والوسم الإنجليزي (109px) يُقصّ في منتصف
 *             الحرف؛ 3×2 يحفظ الاسم كاملًا حتى 1679.
 *   ≤ 640   : عمودان
 *   ≤ 380   : عمود واحد (فيض محتوى الخلية كان مقيسًا عند 340/320)
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const CSS_V2 = path.join(APP, 'css', 'v2');
const COMPONENTS = path.join(CSS_V2, 'erp-components.css');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** جسم كتلة `@media (feature: N px)` — بأقواسٍ متوازنة. */
function mediaBlock(css, feature, width) {
    const at = css.indexOf(`@media (${feature}: ${width}px)`);
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

const RAW = read(COMPONENTS);
/* البحث محصور في قسم السجل لا في الملف كله: الملف يستضيف مكوّنات أقدم لها
   كتل @media خاصة بها. */
const SECTION_AT = RAW.indexOf('سجل المؤشرات الموحّد');
if (SECTION_AT < 0) {throw new Error('قسم سجل المؤشرات غير موجود في erp-components.css');}
const CSS = strip(RAW.slice(SECTION_AT));
const BASE = CSS.slice(0, CSS.indexOf('@media'));
const M1680 = mediaBlock(CSS, 'min-width', 1680);
const M640 = mediaBlock(CSS, 'max-width', 640);
const M380 = mediaBlock(CSS, 'max-width', 380);

/** كل أعداد الأعمدة المعلنة للسجل في الملف. */
function declaredCounts() {
    const found = [];
    const scopes = [BASE, M1680, M640, M380].filter(Boolean);
    for (const scope of scopes) {
        const body = kpisRule(scope);
        if (!body) {continue;}
        for (const m of body.matchAll(/repeat\(\s*(\d+)/g)) {found.push(Number(m[1]));}
    }
    return found;
}

describe('سجل المؤشرات الموحّد — قواسم الستّة لا صفّ يتيم', () => {

    test('القاعدة: سجل ثلاثي الأعمدة بتتبّعٍ قابل للنزول (minmax(0, 1fr) لا 1fr)', () => {
        const body = kpisRule(BASE);
        expect(body).not.toBeNull();
        expect(body).toMatch(/display:\s*grid/);
        expect(body).toMatch(/grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
        expect(body).not.toMatch(/repeat\(3,\s*1fr\)/);
    });

    test('عدد الأعمدة لا يقسم الستّة إلا بما يقبل القسمة', () => {
        const counts = declaredCounts();
        expect(counts.length).toBeGreaterThan(0);
        expect(counts.filter((n) => 6 % n !== 0)).toEqual([]);
        // {6,3,2} معلنة بـ repeat()، وعمود ≤380 الواحد بلا repeat — له اختبار مستقل.
        expect(new Set(counts)).toEqual(new Set([6, 3, 2]));
    });

    test('≥1680px: ستة أعمدة — الصف الواحد للوحات العريضة', () => {
        const body = kpisRule(M1680 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/);
    });

    test('≤640px: عمودان بتتبّعٍ قابل للنزول', () => {
        const body = kpisRule(M640 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    });

    test('≤380px: عمود واحد يمنع فيض محتوى الخلية', () => {
        const body = kpisRule(M380 || '');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    });

    test('السجل نفسه لا يحمل تمريرًا أفقيًّا في أي عرض', () => {
        const offenders = [];
        for (const [name, scope] of [['base', BASE], ['1680', M1680], ['640', M640], ['380', M380]]) {
            const body = scope && kpisRule(scope);
            if (body && /overflow/i.test(body)) {offenders.push(name);}
        }
        expect({ offenders }).toEqual({ offenders: [] });
    });

    test('ترتيب نقاط التوقف: الواسع أولًا فالضيّق تصاعديًّا', () => {
        const i1680 = CSS.indexOf('@media (min-width: 1680px)');
        const i640 = CSS.indexOf('@media (max-width: 640px)');
        const i380 = CSS.indexOf('@media (max-width: 380px)');
        expect(i1680).toBeGreaterThan(-1);
        expect(i640).toBeGreaterThan(i1680);
        expect(i380).toBeGreaterThan(i640);
    });
});
