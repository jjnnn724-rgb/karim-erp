/**
 * v2-confirm.test.js — حوار التأكيد الموحَّد (js/v2/confirm.js)
 * ═══════════════════════════════════════════════════════════════════════
 * WHY: كان المضيف يجيب كل شاشات V2 بـ`window.confirm` — نافذة نظام تشغيل
 * تُوقف المُصيّر، لا تعرف نظام التصميم، ولا تفرّق بين حذفٍ وتشغيل خدمة.
 * الشاشات كانت تنتظر `confirmFn` أصلًا، فصار الحوار طبقةَ مضيفٍ واحدة.
 *
 * ما يُثبّت هنا: (١) منطق العلم والنبرة والنصّ، (٢) سلوك الإغلاق على DOM
 * وهمي (تأكيد/إلغاء/Escape/نقر الخلفية/نداء متراكب)، (٣) عقد المصدر،
 * (٤) ربط المضيف، (٥) ورقة أنماطٍ بلا hex.
 * الشكل المرئي يُثبَت في المتصفح، لا هنا.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'frontend', 'app');
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');
/** مصدر بلا تعليقات — العقود تقيس الكود لا النثر. */
const code = (p) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

/* ── DOM وهمي: الحدّ الأدنى الذي يلمسه confirm.js فعلًا ─────────────── */
function makeNode(tag, sinks) {
    const node = {
        tagName: tag,
        className: '',
        textContent: '',
        type: '',
        id: '',
        dataset: Object.create(null),
        attrs: Object.create(null),
        listeners: Object.create(null),
        children: [],
        parentNode: null,
        open: false,
        setAttribute(k, v) { this.attrs[k] = String(v); },
        getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
        append(...kids) { kids.forEach((k) => this.appendChild(k)); },
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
        addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
        fire(type, event = {}) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
        click() { this.fire('click', { target: this }); },
        focus() { this.focused = true; },
        showModal() { this.open = true; },
        close() { this.open = false; },
    };
    Object.defineProperty(node, 'innerHTML', {
        get() { return ''; },
        set(v) {
            sinks.push({ tag, value: String(v) });
            throw new Error(`innerHTML used on <${tag}>: ${v}`);
        },
    });
    return node;
}

/** يحمّل الوحدة بلا import/export، ويعيد الأدوات + آخر حوارٍ أُنشئ. */
function loadModule() {
    const sinks = [];
    const body = makeNode('body', sinks);
    const created = [];
    const document = {
        body,
        createElement(tag) {
            const node = makeNode(tag, sinks);
            created.push(node);
            return node;
        },
    };
    const src = read('js/v2/confirm.js')
        .split('\n')
        .filter((line) => !/^\s*import\b/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const context = {
        console, String, Number, Boolean, Array, Object, RegExp, Error, Promise, Set, Map,
        decodeURIComponent,
        document,
        window: { document, confirm: () => true },
    };
    vm.createContext(context);
    vm.runInContext(
        `${src}\n;Object.assign(globalThis, { confirmEnabled, inferTone, clampText, createConfirm });`,
        context,
        { filename: 'confirm.js' },
    );
    return { context, sinks, body, created };
}

/** يجد الأزرار داخل الحوار المُنشأ (زوج الإجراءات: [تأكيد، إلغاء]). */
function actionsOf(created) {
    const dialog = created.find((n) => n.tagName === 'dialog');
    const box = dialog.children[0];
    const actions = box.children.find((n) => n.className === 'erp-confirm__actions');
    return { dialog, ok: actions.children[0], cancel: actions.children[1], box };
}

describe('حوار التأكيد — منطق نقي', () => {
    let mod;
    beforeAll(() => { mod = loadModule().context; });

    test('العلم مفعَّل افتراضيًا، و=0/off/false يطفئه', () => {
        expect(mod.confirmEnabled('', '')).toBe(true);
        expect(mod.confirmEnabled('?live=1', null)).toBe(true);
        expect(mod.confirmEnabled('?v2confirm=0', '')).toBe(false);
        expect(mod.confirmEnabled('?v2confirm=off', '1')).toBe(false);
        expect(mod.confirmEnabled('?v2confirm=false', '1')).toBe(false);
    });

    test('?v2confirm=1 يتغلّب على قيمةٍ مخزَّنةٍ مطفأة', () => {
        expect(mod.confirmEnabled('?v2confirm=1', '0')).toBe(true);
    });

    test('النبرة تُقرأ من فعلٍ لا رجعة فيه', () => {
        expect(mod.inferTone('حذف هذا الموظف؟')).toBe('danger');
        expect(mod.inferTone('مسح كل شيء')).toBe('danger');
        expect(mod.inferTone('استعادة النسخة؟')).toBe('danger');
        expect(mod.inferTone('تشغيل خدمة السيرفر الآن؟')).toBe('warning');
        expect(mod.inferTone('ترحيل الإهلاك الشهري؟')).toBe('warning');
    });

    test('النصّ يُقصّ ولا يُفسَّر', () => {
        expect(mod.clampText('abc')).toBe('abc');
        expect(mod.clampText('x'.repeat(500)).length).toBe(400);
        expect(mod.clampText(null)).toBe('');
    });
});

describe('حوار التأكيد — سلوك الإغلاق', () => {
    test('التأكيد يعيد true، والإلغاء يعيد false', async () => {
        const { context, created } = loadModule();
        const confirm = context.createConfirm(context.window);

        const first = confirm('حذف هذا الصنف؟');
        let { dialog, ok } = actionsOf(created);
        expect(dialog.open).toBe(true);
        expect(dialog.dataset.tone).toBe('danger');
        ok.click();
        await expect(first).resolves.toBe(true);
        expect(dialog.open).toBe(false);

        const second = confirm('تشغيل الخدمة؟');
        ({ dialog, ok } = actionsOf(created));
        const cancel = actionsOf(created).cancel;
        expect(dialog.dataset.tone).toBe('warning');
        cancel.click();
        await expect(second).resolves.toBe(false);
        expect(ok.className).toContain('primary');
    });

    test('Escape ونقر الخلفية يُغلقان بالرفض', async () => {
        const { context, created } = loadModule();
        const confirm = context.createConfirm(context.window);

        const p1 = confirm('حذف؟');
        const { dialog } = actionsOf(created);
        let prevented = false;
        dialog.fire('cancel', { preventDefault: () => { prevented = true; } });
        expect(prevented).toBe(true);
        await expect(p1).resolves.toBe(false);

        const p2 = confirm('حذف؟');
        const { dialog: d2 } = actionsOf(created);
        d2.fire('click', { target: d2 });
        await expect(p2).resolves.toBe(false);
    });

    test('نداءٌ متراكب لا يترك وعدًا معلّقًا: الأول يُرفض', async () => {
        const { context, created } = loadModule();
        const confirm = context.createConfirm(context.window);
        const first = confirm('حذف الأول؟');
        const second = confirm('حذف الثاني؟');
        await expect(first).resolves.toBe(false);
        actionsOf(created).ok.click();
        await expect(second).resolves.toBe(true);
    });

    test('واجهة بلا dialog تعود إلى window.confirm', async () => {
        const { context } = loadModule();
        context.window.confirm = () => true;
        const confirm = context.createConfirm(context.window);
        const realCreate = context.document.createElement;
        context.document.createElement = (tag) => {
            const node = makeNode(tag, []);
            if (tag === 'dialog') { node.showModal = undefined; }
            return node;
        };
        await expect(confirm('نص')).resolves.toBe(true);
        context.document.createElement = realCreate;
    });
});

describe('حوار التأكيد — عقد المصدر', () => {
    const src = code('js/v2/confirm.js');

    test('لا innerHTML — النصّ يصل عبر textContent', () => {
        expect(src).not.toMatch(/innerHTML/);
        expect(src).toMatch(/textContent/);
    });

    test('حوارٌ أصلي: dialog + showModal + alertdialog + وصفٌ مرتبط', () => {
        expect(src).toMatch(/createElement\('dialog'\)/);
        expect(src).toMatch(/showModal\(\)/);
        expect(src).toMatch(/role', 'alertdialog'/);
        expect(src).toMatch(/aria-labelledby/);
        expect(src).toMatch(/aria-describedby/);
    });

    test('الإلغاء هو التركيز الأول', () => {
        expect(src).toMatch(/cancelBtn\.focus\(\)/);
    });
});

describe('حوار التأكيد — ربط المضيف والورقة', () => {
    const preview = read('js/v2/preview.js');

    test('preview يستورد الحوار ويمرّر دالةً واحدة لكل الشاشات', () => {
        expect(preview).toMatch(/import \{ confirmEnabled, createConfirm \} from '\.\/confirm\.js\?v=/);
        expect(preview).toMatch(/confirmFn: confirmAction,/);
        expect(preview).toMatch(/\? createConfirm\(window\)/);
    });

    test('لا شاشة تستقبل window.confirm من المضيف', () => {
        expect((preview.match(/confirmFn: \(message\) => window\.confirm/g) || [])).toHaveLength(0);
    });

    test('v2.html يحمّل الورقة', () => {
        expect(read('v2.html')).toMatch(/css\/v2\/erp-confirm\.css\?v=/);
    });

    test('الورقة بلا hex وبلا خطٍّ أو ظلٍّ جديد', () => {
        const css = read('css/v2/erp-confirm.css');
        expect((css.match(/#[0-9a-fA-F]{3,8}\b/g) || [])).toHaveLength(0);
        expect(css).toMatch(/font-family: var\(--erp-font-sans\)/);
        expect(css).toMatch(/box-shadow: var\(--erp-shadow-xl\)/);
    });
});
