/**
 * ai-assistant-local.test.js — المساعد المحلي وأدواته وصلاحياته
 * ══════════════════════════════════════════════════════════════════════
 * ما يُثبَّت هنا (قاعدة المالك: «مساعد محلي بلا مفاتيح API، بصلاحياتي،
 * يع.helper في السستم كامل، ويضبط المصروفات والإيرادات — ولا يقرب المخزن»):
 *   1) العميل المحلي يتكلم مع 127.0.0.1 فقط (لا يخرج شيء من الجهاز).
 *   2) أدوات القراءة فقط ما لم تكن مسوّدة؛ والكتابة = مسوّدة لا تنفيذ.
 *   3) أدوات الكتابة محصورة في expenses/revenues — لا أصناف ولا وصفات
 *      ولا أرصدة ولا حذف (المخزن خط أحمر).
 *   4) تنفيذ المسوّدة يمرّ من بوابة النظام نفسها بصلاحية المالك.
 *   5) الواجهة: شارة «محلي»، ولوحة مسوّدات بزريّ تطبيق/رفض، بلا inline.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'backend', 'ai-assistant');
const localLlm = fs.readFileSync(path.join(DIR, 'local-llm.js'), 'utf8');
const tools = fs.readFileSync(path.join(DIR, 'tools.js'), 'utf8');
const assistant = fs.readFileSync(path.join(DIR, 'assistant.js'), 'utf8');
const routes = fs.readFileSync(path.join(DIR, 'routes.js'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'ai-assistant.js'), 'utf8');

describe('المساعد المحلي — بلا مفاتيح، وبصلاحيات المالك', () => {
    test('العميل المحلي يتكلم مع الجهاز وحده', () => {
        expect(localLlm).toMatch(/127\.0\.0\.1:11434|LOCAL_LLM_URL/);
        expect(localLlm).toMatch(/http/);
        expect(localLlm).not.toMatch(/generativelanguage|api\.openai|api\.anthropic/);
    });

    test('النموذج المحلي: مسار «تحليل أعمق» منفصل — لا في المسار السريع', () => {
        // المسار السريع = الحقائق فورًا (بلا نموذج) ⇒ لا انتظار ولا استهلكة.
        expect(assistant).toMatch(/localLlm\.available\(\)/);
        expect(assistant).toMatch(/deepAnswer|deep:/);
        // والتحليل العميق: النموذج مع الأدوات
        expect(assistant).toMatch(/tools\.TOOL_DEFS/);
        expect(routes).toMatch(/assistant\.deep\(/);
    });

    test('الأدوات: قراءة عامة + كود + مسوّدات', () => {
        for (const tool of ['list_tables', 'read_table', 'search_table', 'search_code', 'draft_expense', 'draft_revenue']) {
            expect(tools).toContain(`name: '${tool}'`);
        }
    });

    test('الكتابة محصورة في expenses/revenues — لا مخزن ولا وصفات ولا حذف', () => {
        const writable = tools.match(/const WRITABLE = new Set\(\[([^\]]+)\]\)/);
        expect(writable).toBeTruthy();
        expect(writable[1]).toContain('expenses');
        expect(writable[1]).toContain('revenues');
        expect(tools).not.toMatch(/'inventory'|'inventory_items'|'pos_product_ingredients'/);
        expect(tools).not.toMatch(/DELETE\s+FROM|DROP\s+TABLE|TRUNCATE/i);
    });

    test('تنفيذ المسوّدة يمرّ من بوابة النظام بصلاحية المالك (لا تجاوز)', () => {
        expect(tools).toMatch(/callSelf\(/);
        expect(tools).toMatch(/ctx && ctx\.token/);
        expect(tools).toMatch(/'x-api-key'/);
        // والعكس: الأدوات نفسها لا تكتب
        const writeCalls = [...tools.matchAll(/pool\.query\(\s*(`[\s\S]*?`|'[^']*')/g)]
            .map((m) => m[1].replace(/^[`'"]([\s\S]*)[`'"]$/, '$1'));
        const offenders = writeCalls.filter((q) => !/^\s*(SELECT|WITH)\b/i.test(q));
        if (offenders.length) {
            throw new Error('استعلام كتابة في الأدوات: ' + offenders.map((q) => q.slice(0, 90).replace(/\s+/g, ' ')).join(' || '));
        }
    });

    test('المسوّدات: تُنشأ ولا تُنفَّذ إلا بموافقة (draft ثم apply)', () => {
        expect(tools).toMatch(/status: 'pending'/);
        expect(tools).toMatch(/DRAFT_ALREADY_/);
        expect(tools).toMatch(/async function applyDraft\(/);
        expect(routes).toMatch(/router\.post\('\/drafts\/:id\/apply'/);
        expect(routes).toMatch(/router\.post\('\/drafts\/:id\/reject'/);
    });

    test('الواجهة: شارة «محلي» + لوحة مسوّدات بزريّ تطبيق/رفض، بلا inline', () => {
        expect(ui).toMatch(/محلي · /);
        expect(ui).toMatch(/data-erp-ai-drafts/);
        expect(ui).toMatch(/data-draft-apply/);
        expect(ui).toMatch(/data-draft-reject/);
        expect(ui).not.toMatch(/on(?:click|submit)\s*=\s*["']/);
    });

    test('الحقائق فورية، والتحليلُ العميق اختيارٌ للمالك (لا انتظارٌ مفروض)', () => {
        // /ask ⇒ الحقائق من النظام (فورية) + علم «canDeep» يمرّ إلى الواجهة
        expect(routes).toMatch(/canDeep/);
        // /ask/deep ⇒ النموذج المحلي (أبطأ) — مسار منفصل لا ضمن /ask
        expect(routes).toMatch(/router\.post\('\/ask\/deep'/);
        expect(ui).toMatch(/تحليل أعمق/);
        expect(ui).toMatch(/\/ai-assistant\/ask\/deep/);
    });

    test('الواجهة: الطلب يذهب إلى /ai-assistant (لا خدمة خارجية)', () => {
        expect(ui).toMatch(/apiFetch\('\/ai-assistant\/ask'/);
        expect(ui).toMatch(/apiFetch\('\/ai-assistant\/drafts'/);
        expect(ui).not.toMatch(/https?:\/\/(?!\$\{)/);
    });
});
