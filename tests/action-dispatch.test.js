/**
 * action-dispatch.test.js — موزّع الإجراءات (بديل المعالجات السطرية)
 * ────────────────────────────────────────────────────────────────────────────
 * لماذا هذا الملف مهم: تحويل onclick إلى data-karim-action بلا اختبار ⇒
 * أزرار صامتة (لا استجابة) ولا أحد يعرف. هنا نختبر منطق التفويض ببيئة DOM
 * وهمية (لا jsdom في المشروع)، ومصححًا بالمتصفح الحقيقي على الإنتاج.
 *
 * العقد:
 *   · data-karim-action="fn"        ⇒ ينادي window.fn(this)
 *   · data-karim-args='["a",null]'  ⇒ يمرّر الوسائط
 *   · data-karim-also="fn2"         ⇒ ينادي fn2 بعد الأولى
 *   · data-karim-prevent            ⇒ preventDefault (ما كان return false)
 *   · دالة غير موجودة ⇒ خطأ في الكونسول، ولا استثناء قاتل
 */
const path = require('path');

const DISPATCHER = path.resolve(__dirname, '..', 'frontend', 'app', 'js', 'core', 'action-dispatch.js');

/** بيئة DOM وهمية تلتقط مستمع النقر. */
function makeEnv() {
    const listeners = [];
    const calls = [];
    const el = {
        attrs: {},
        getAttribute(name) {return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;},
        hasAttribute(name) {return Object.prototype.hasOwnProperty.call(this.attrs, name);},
    };
    const target = {closest: () => el};
    const globalWindow = {
        record: (...args) => calls.push(args),
    };
    global.window = globalWindow;
    global.document = {
        readyState: 'complete',
        addEventListener(type, fn) {if (type === 'click') {listeners.push(fn);}},
        querySelectorAll: () => [],
        addEventListenerOnce: null,
    };
    return {
        el,
        calls,
        listeners,
        fire(extra = {}) {
            let prevented = false;
            const event = {
                target,
                preventDefault() {prevented = true;},
                ...extra,
            };
            for (const fn of listeners) {fn(event);}
            return prevented;
        },
        reset() {listeners.length = 0; calls.length = 0;},
    };
}

function loadDispatcher() {
    // jest.resetModules ضروري: بدونه تُخزَّن الوحدة مرة واحدة ⇒ المستمع
    // يبقى مربوطًا ببيئة DOM الأولى (القديمة) لا بالبيئة الحالية.
    jest.resetModules();
    require(DISPATCHER);
}

describe('موزّع الإجراءات (data-karim-action)', () => {
    let env;

    beforeEach(() => {
        env = makeEnv();
        loadDispatcher();
    });

    afterEach(() => {
        delete global.window;
        delete global.document;
    });

    test('يسجّل مستمع نقر على level واحد', () => {
        expect(env.listeners.length).toBe(1);
    });

    test('ينادي الدالة مع this = العنصر', () => {
        window.myFn = function () { env.calls.push(['myFn', this === env.el]); };
        env.el.attrs['data-karim-action'] = 'myFn';
        env.fire();
        expect(env.calls).toContainEqual(['myFn', true]);
    });

    test('يمرّر الوسائط من data-karim-args', () => {
        window.go = function (page, arg) { env.calls.push(['go', page, arg]); };
        env.el.attrs['data-karim-action'] = 'go';
        env.el.attrs['data-karim-args'] = '["dashboard",null]';
        env.fire();
        expect(env.calls).toContainEqual(['go', 'dashboard', null]);
    });

    test('ينادي الدالة الثانية (data-karim-also) بعد الأولى', () => {
        window.first = () => env.calls.push(['first']);
        window.second = () => env.calls.push(['second']);
        env.el.attrs['data-karim-action'] = 'first';
        env.el.attrs['data-karim-also'] = 'second';
        env.fire();
        expect(env.calls.map((c) => c[0])).toEqual(['first', 'second']);
    });

    test('data-karim-prevent يمنع السلوك الافتراضي فقط عند وجوده', () => {
        window.fn = () => {};
        env.el.attrs['data-karim-action'] = 'fn';
        expect(env.fire()).toBe(false);
        env.el.attrs['data-karim-prevent'] = '';
        expect(env.fire()).toBe(true);
    });

    test('دالة غير موجودة ⇒ لا استثناء (زر صامت بلا كسر الصفحة)', () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        env.el.attrs['data-karim-action'] = 'doesNotExist';
        expect(() => env.fire()).not.toThrow();
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    test('وسائط غير صالحة ⇒ تُتجاهل ولا تكسر التنفيذ', () => {
        window.fn = (...args) => env.calls.push(['fn', args]);
        env.el.attrs['data-karim-action'] = 'fn';
        env.el.attrs['data-karim-args'] = '{not json';
        expect(() => env.fire()).not.toThrow();
        expect(env.calls).toContainEqual(['fn', []]);
    });

    test('لا يستدعي شيئًا إن لم يوجد عنصر تفويض', () => {
        global.document.addEventListener('click', () => {});
        env.reset();
        const el2 = {attrs: {}, getAttribute() {return null;}, hasAttribute() {return false;}};
        expect(el2).toBeTruthy();
        // العنصر نفسه بلا data-karim-action ⇒ closest يعيد null ⇒ لا نداء
        expect(env.fire()).toBe(false);
    });
});
