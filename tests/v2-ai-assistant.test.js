/**
 * v2-ai-assistant.test.js — عقد مساعد V2 (الواجهة)
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا:
 *   • الأوضاع الثلاثة موجودة ومسمّاة بالعربية (معرفة/تشخيص/كود).
 *   • لا معالجات inline (CSP): كل حدث addEventListener.
 *   • الردّ يُكتب نصًّا (textContent) — لا HTML من النموذج يُنفَّذ.
 *   • البوابة على الخادم (session + admin) — والواجهة تخفي الزرّ لغير الأدمن.
 *   • جسد الطلب مُقصود: سقف 800 حرف، ووضع معروف، وثلاثة ملفات كحدّ أقصى.
 *   • طبقة CSS برموز --erp-* فقط (بلا hex ولا px خام).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const FILE = path.join(V2, 'ai-assistant.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-ai.css');
const src = fs.readFileSync(FILE, 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

/* تحميل الوحدة في vm (كما تفعل عقود V2 الأخرى) */
function loadModule() {
    const stripped = src.split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s+'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = { console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise, Set, Map };
    vm.createContext(context);
    vm.runInContext(stripped + '\n;Object.assign(globalThis, { parsePaths, buildRequest, MODES });', context, { filename: FILE });
    return context;
}

describe('مساعد V2 — العقد', () => {
    test('الوحدة تُحمَّل وتصدّر أدواتها', () => {
        const m = loadModule();
        expect(typeof m.parsePaths).toBe('function');
        expect(typeof m.buildRequest).toBe('function');
        expect(Array.isArray(m.MODES)).toBe(true);
    });

    test('الأوضاع: معرفة/تشخيص/المحاسبة/كود', () => {
        const m = loadModule();
        expect(m.MODES.map((x) => x.id)).toEqual(['knowledge', 'diagnose', 'cfo', 'code']);
        expect(m.MODES.map((x) => x.label)).toEqual(['معرفة', 'تشخيص', 'المحاسبة', 'كود']);
        for (const mode of m.MODES) {expect(mode.label).toMatch(/[؀-ۿ]/);}
    });

    test('وضع «المحاسبة» موجود: مراجعة المدير المالي للأرقام', () => {
        const m = loadModule();
        expect(m.MODES.map((x) => x.id)).toContain('cfo');
        expect(m.MODES.find((x) => x.id === 'cfo').label).toBe('المحاسبة');
    });

    test('لا معالجات inline — CSP makes them inert', () => {
        expect(src).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(src).toMatch(/addEventListener\('click'/);
        expect(src).toMatch(/addEventListener\('submit'/);
    });

    test('الردّ نصّ لا HTML — لا innerHTML لردّ النموذج', () => {
        expect(src).not.toMatch(/innerHTML\s*=\s*[^;]*(r|data)\.text/);
        expect(src).toMatch(/pending\.textContent = clean\(/);
        expect(src).toMatch(/line\.textContent = text;/);
    });

    test('البوابة على الخادم: الأدمن فقط، والسقف في الخادم', () => {
        expect(src).toMatch(/role === 'admin'/);
        expect(src).toMatch(/\/ai-assistant\/ask/);
        expect(src).toMatch(/\/ai-assistant\/status/);
    });

    test('جسد الطلب مقصوص: 800 حرف، وضع معروف، و3 ملفات كحدّ أقصى', () => {
        const m = loadModule();
        const body = m.buildRequest({ question: 'س'.repeat(2000), mode: 'code', screen: 'kitchen', paths: 'a.js b.js c.js d.js e.js' });
        expect(body.question.length).toBe(800);
        expect(body.mode).toBe('code');
        expect(body.screen).toBe('kitchen');
        expect(body.paths.length).toBe(3);
        expect(m.buildRequest({ question: 'سؤال', mode: 'hack' }).mode).toBe('knowledge');
        expect(m.buildRequest({ question: 'سؤال' }).paths).toBeUndefined();
    });

    test('وضع قواعدي: حين لا نموذج، تُعرض الحقائق (لا شاشة عاطلة)', () => {
        expect(src).toMatch(/fallback/);
        expect(src).toMatch(/erp-ai__msg--fallback/);
        expect(src).toMatch(/وضع قواعدي/);
    });

    test('الواجهة عربية أولًا: الاتجاه من tokens لا من يمين/يسار خام', () => {
        expect(css).not.toMatch(/(^|[\s;{])(left|right)\s*:/m);
        expect(css).toMatch(/inset-inline-start|justify-content: flex-start/);
    });

    test('طبقة المساعد برموز --erp-* فقط (بلا hex ولا px خام)', () => {
        const body = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
        expect(body).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(body).not.toMatch(/rgba?\(/);
        expect(body).not.toMatch(/\b\d+(px|rem|em)\b/);
        expect(body).toMatch(/var\(--erp-space-4\)/);
    });

    test('اللوحة تُبنى على body (فلا تعلقها تبدّلات الشاشات)', () => {
        expect(src).toMatch(/layer\.appendChild\(backdrop\)/);
        expect(src).toMatch(/document\.body/);
    });

    test('المساعد مركّب في مركز التحكم (مركز الـheader) لا في الصفحة', () => {
        expect(src).toMatch(/data-erp-more/);
        expect(src).toMatch(/data-erp-ai-section/);
    });
});
