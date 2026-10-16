/**
 * v2-scan.test.js — عقد مسح الباركود (البند ٩، موجة ١: ربطٌ ثم دخول)
 *═════════════════════════════════════════════════════════════════════════
 * الشاشة الجديدة لا تُلغي شيئًا: js/pos.js وfeatures/warehouse.js لم يُلْمسا،
 * ولا خادم ولا سكيمًا أُضيف. لذلك يثبَّت هنا أربعة أشياء فقط:
 *   ١) المفتاح مطفأٌ افتراضيًا — `?v2scan` يغلب المخزَّن، وغيابهما صمت.
 *   ٢) النموذج خالص (لا DOM ولا شبكة)، فيُحمَّل بـ new Function بعد تجريد
 *      import/export، مع دميتين لبابَتَي apiFetch وfetchInventory.
 *   ٣) كل كتابةٍ تمرّ ببابٍ واحد مسمّى، بعمودٍ واحد، وبحدّ الخادم.
 *   ٤) التوصيل: مسارٌ فرعي في routing.js ومُوزِّع في preview.js وورقةُ
 *      أنماطٍ مقيّدة بجذر الشاشة — بلا أصنافٍ ميتة ولا متغيّراتٍ مخترعة.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const read = (p) => fs.readFileSync(p, 'utf8');
const REPO_SRC = read(path.join(APP, 'js', 'v2', 'data', 'scan-repo.js'));
const SCREEN_SRC = read(path.join(APP, 'js', 'v2', 'screens', 'goods-scan.js'));
const CSS_SRC = read(path.join(APP, 'css', 'v2', 'erp-scan.css'));
const TOKENS_SRC = read(path.join(APP, 'css', 'v2', 'erp-tokens.css'));
const HOST_SRC = read(path.join(APP, 'js', 'v2', 'preview.js'));
const ROUTING_SRC = read(path.join(APP, 'js', 'v2', 'routing.js'));
const HTML_SRC = read(path.join(APP, 'v2.html'));

/** تجريد الوحدات ثم تمرير الأبواب كدمى: المعرّفات الحرّة تصير وسائط الدالة. */
function loadRepo(apiFetch, fetchInventory) {
    const body = REPO_SRC.replace(/^import[^;]*;/gm, '').replace(/^export\s+/gm, '');
    const names = [...REPO_SRC.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
    const calls = [];
    const fetchStub = async (url, opts) => {calls.push({ kind: 'fetch', url, opts }); return apiFetch(url, opts);};
    const invStub = async (opts) => {calls.push({ kind: 'inventory', opts }); return fetchInventory(opts);};
    const api = new Function('apiFetch', 'fetchInventory', `${body}\nreturn {${names.join(',')}};`)(fetchStub, invStub);
    return { api, calls };
}

const r = loadRepo(async () => ({ ok: true }), async () => ({ rows: [], total: 0, truncated: false })).api;

const NUL = String.fromCharCode(0);
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const TAB = String.fromCharCode(9);

/** صفوف السجل كما يوردها الخادم (warehouse-routes.js:1780-1782) — خامّ لا مُحوَّلة. */
const ITEM = (id, name, extra = {}) => ({
    id, name, category: 'عام', unit: 'قطعة', qty: 10, avgCost: 5, minQty: 2,
    weight: null, barcode: '', shelfId: null, mainQty: 10, ...extra,
});

describe('1. المفتاح: مطفأٌ حتى يقرره المالك', () => {
    test('غياب العنوان والمخزن = إطفاء، والمصدر موثّق', () => {
        expect(r.scanEnabledModel('', null)).toEqual({ enabled: false, source: 'default' });
        expect(r.scanEnabledModel('', '')).toEqual({ enabled: false, source: 'default' });
        expect(r.scanEnabled('', null)).toBe(false);
    });

    test.each([['1', true], ['true', true], ['on', true], ['0', false], ['off', false], ['maybe', false]])(
        'العنوان v2scan=%s → %s', (value, expected) => {
            expect(r.scanEnabledModel(`live=1&v2scan=${value}#goods-scan`, null))
                .toEqual({ enabled: expected, source: 'query' });
        });

    test('العنوان يغلب المخزَّن، والإطفاء الصريح يعمل', () => {
        expect(r.scanEnabledModel('?v2scan=0', '1').enabled).toBe(false);
        expect(r.scanEnabledModel('?x=1', '1')).toEqual({ enabled: true, source: 'stored' });
        expect(r.scanEnabledModel('?x=1', '0').enabled).toBe(false);
    });

    test('مفتاحٌ آخر في العنوان لا يفتحها (v2scan لا v2board)', () => {
        expect(r.scanEnabled('?v2board=1', null)).toBe(false);
    });

    test('الشاشة: لا شبكة قبل المفتاح — الإطفاء يسبق الرسم الحيّ', () => {
        const offAt = SCREEN_SRC.indexOf('if (!model.enabled)');
        const liveAt = SCREEN_SRC.indexOf("host.insertAdjacentHTML('beforeend', template())");
        expect(offAt).toBeGreaterThan(-1);
        expect(liveAt).toBeGreaterThan(offAt);
        expect(SCREEN_SRC).toMatch(/scanEnabledModel\(window\.location\.search, window\.localStorage\.getItem\('karim_v2_scan'\)\)/);
    });
});

describe('2. التطبيع والعائلات: الكود كما هو، والرسالة وحدها تتفرّع', () => {
    test('محارف التحكم والأطراف تذهب؛ الحالة والمسافة الداخلية تبقيان', () => {
        expect(r.normalizeCode(`${NUL}A1${CR}${LF}${TAB} B2${NUL}`)).toBe('A1 B2');
        expect(r.normalizeCode('  5901234123457  ')).toBe('5901234123457');
        expect(r.normalizeCode(null)).toBe('');
        expect(r.normalizeCode(undefined)).toBe('');
        expect(r.normalizeCode(12345)).toBe('12345');
    });

    test.each([
        ['', 'empty'], ['  ', 'empty'], ['4006381333931', 'ean13'], ['96385074', 'ean8'],
        ['042100005264', 'upc-a'], ['00012345600012', 'gtin14'], ['123456', 'itf'],
        ['1234567890', 'itf'], ['12345', 'numeric-other'], ['ABC-123', 'alphanumeric'],
    ])('عائلة %s → %s', (code, family) => {
        expect(r.codeFamily(code)).toBe(family);
    });

    test('حدّ الخادم لا يُتجاوَز: BARCODE_MAX = 100 (VARCHAR(100) + schema-registry:348)', () => {
        expect(r.BARCODE_MAX).toBe(100);
    });
});

describe('3. رقم تحقق GS1: يحذّر ولا يرفض حقًّا مشروعًا', () => {
    test.each([
        ['400638133393', 1], ['9638507', 4], ['04210000526', 4], ['0001234560001', 2],
    ])('حسابُ الوزن من اليمين (3 ثم 1): %s → %i', (body, expected) => {
        expect(r.gtinCheckDigit(body)).toBe(expected);
    });

    test.each(['4006381333931', '96385074', '042100005264', '00012345600012'])(
        'GTIN صحيح %s', (code) => {
            expect(r.validateGtin(code)).toMatchObject({ ok: true, checked: true, family: r.codeFamily(code) });
        });

    test('آخر خانة مكسورة ⇒ ok:false مع المتوقّع في الرسالة', () => {
        const v = r.validateGtin('4006381333932');
        expect(v).toMatchObject({ ok: false, checked: true, expected: 1 });
        expect(v.reason).toContain('1');
    });

    test.each(['KAR-001', '12345', '123456', '7'])('لا فحص على %s (كودٌ داخلي مشروع) — لا رفض', (code) => {
        const v = r.validateGtin(code);
        expect(v.ok).toBe(true);
        expect(v.checked).toBe(false);
    });

    test('المسح الأولي يجري قبل العائلة والفحص', () => {
        expect(r.validateGtin(` 4006381333931${CR}`)).toMatchObject({ ok: true, checked: true });
    });
});

describe('4. حلّ المسح: مطابقةٌ تامّة لا «أقرب نتيجة»', () => {
    const rows = [ITEM(1, 'أرز', { barcode: '4006381333931' }), ITEM(2, 'سكر'), ITEM(3, 'ملح', { barcode: '96385074' })];

    test('فرعٌ واحد ⇒ unique، وبلا كود ⇒ none، وبلا مسح ⇒ empty', () => {
        expect(r.resolveScan(rows, '4006381333931').state).toBe('unique');
        expect(r.resolveScan(rows, '5901234123457').state).toBe('none');
        expect(r.resolveScan(rows, '').state).toBe('empty');
        expect(r.resolveScan(rows, '   ').code).toBe('');
    });

    test('صنفان بنفس الكود ⇒ ambiguous (لا قيد UNIQUE في القاعدة)', () => {
        const dup = [...rows, ITEM(4, 'أرز مكرر', { barcode: '4006381333931' })];
        const res = r.resolveScan(dup, '4006381333931');
        expect(res.state).toBe('ambiguous');
        expect(res.items.map((i) => i.id)).toEqual([1, 4]);
    });

    test('لا مطابقة جزئية ولا مطابقة اسم', () => {
        expect(r.exactBarcodeMatches(rows, '4006381')).toEqual([]);
        expect(r.exactBarcodeMatches(rows, '4006381333931 ')).toHaveLength(1);
        expect(r.exactBarcodeMatches(rows, 'أرز')).toEqual([]);
        expect(r.exactBarcodeMatches([null, undefined, ITEM(9, 'x')], '')).toEqual([]);
    });

    test('الحامرون: باستثناء الصنف نفسه', () => {
        const dup = [ITEM(1, 'أ', { barcode: 'X1' }), ITEM(2, 'ب', { barcode: 'X1' })];
        expect(r.barcodeHolders(dup, 'X1')).toHaveLength(2);
        expect(r.barcodeHolders(dup, 'X1', 1).map((x) => x.id)).toEqual([2]);
        expect(r.barcodeHolders(dup, 'X1', '1')).toHaveLength(1);
        expect(r.barcodeHolders(dup, '')).toEqual([]);
    });
});

describe('5. قرار الربط: ستة احتمالاتٍ تُغطّى بها القاعدة كلها', () => {
    const base = [ITEM(1, 'أرز', { barcode: '4006381333931' }), ITEM(2, 'سكر'), ITEM(3, 'ملح', { barcode: '96385074' })];

    test('ready — صنفٌ بلا كود وكودٌ سليم ولا حامل آخر', () => {
        expect(r.assignDecision(base, '042100005264', 2)).toMatchObject({ state: 'ready', code: '042100005264' });
    });

    test('empty — لا كود', () => {
        expect(r.assignDecision(base, '  ', 2).state).toBe('empty');
    });

    test('taken — الكود مربوط بغيره، والرفض يسبق أي تأكيد', () => {
        const d = r.assignDecision(base, '4006381333931', 2);
        expect(d.state).toBe('taken');
        expect(d.holders.map((h) => h.id)).toEqual([1]);
        expect(d.message).toContain('أرز');
    });

    test('taken يسبق suspect — لا يُطلب تأكيدٌ لربطٍ مرفوض أصلًا', () => {
        const rows = [ITEM(1, 'أرز', { barcode: '4006381333932' }), ITEM(2, 'سكر')];
        expect(r.assignDecision(rows, '4006381333932', 2).state).toBe('taken');
    });

    test('invalid — صنفٌ ليس في نتيجة الخادم', () => {
        expect(r.assignDecision(base, '042100005264', 999).state).toBe('invalid');
    });

    test('suspect — رقم تحققٍ مكسور: تأكيدٌ صريح لا صمت', () => {
        const d = r.assignDecision(base, '4006381333932', 2);
        expect(d).toMatchObject({ state: 'suspect', validation: { ok: false, expected: 1 } });
    });

    test('duplicate — للصنف كودٌ آخر: استبدالٌ معلن', () => {
        const withCode = [ITEM(2, 'سكر', { barcode: '11111111' })];
        const d = r.assignDecision(withCode, '042100005264', 2);
        expect(d.state).toBe('duplicate');
        expect(d.message).toContain('11111111');
    });

    test('إعادة ربط الصنف بكوده نفسه ⇒ ready لا duplicate', () => {
        expect(r.assignDecision(base, '4006381333931', 1).state).toBe('ready');
    });

    test('الأرقام والنصوص في id تُحلّان إلى شيءٍ واحد', () => {
        expect(r.assignDecision(base, '4006381333931', '1').state).toBe('ready');
    });
});

describe('6. التغطية: الأرقام التي تُنهي الحملة', () => {
    test('مربوط/بلا كود/نسبة/متكرّر/مكسور التحقق', () => {
        const rows = [
            ITEM(1, 'أ', { barcode: '4006381333931' }),
            ITEM(2, 'ب', { barcode: '4006381333931' }),
            ITEM(3, 'ج', { barcode: '4006381333932' }),
            ITEM(4, 'د'),
            ITEM(5, 'هـ', { barcode: '   ' }),
        ];
        const cov = r.coverage(rows);
        expect(cov).toMatchObject({ total: 5, assigned: 3, unassigned: 2, pct: 60, distinct: 2, suspect: 1 });
        expect(cov.duplicates).toEqual([{ code: '4006381333931', count: 2 }]);
    });

    test('الفراغ لا قسمة على صفر', () => {
        expect(r.coverage([])).toMatchObject({ total: 0, assigned: 0, pct: 0, distinct: 0, suspect: 0 });
        expect(r.coverage(null).total).toBe(0);
    });

    test('قائمة العمل: بلا كود فقط، بحدّ محترم', () => {
        const rows = [ITEM(1, 'أ', { barcode: 'X' }), ITEM(2, 'ب'), ITEM(3, 'ج'), ITEM(4, 'د')];
        expect(r.unassignedRows(rows).map((x) => x.id)).toEqual([2, 3, 4]);
        expect(r.unassignedRows(rows, 1).map((x) => x.id)).toEqual([2]);
        expect(r.unassignedRows(rows, 0).length).toBe(3);
    });
});

describe('7. جلسة الوارد: التكرار عددٌ لا صنفٌ جديد، والسعر لا يضيع', () => {
    test('bumpLine يدمج نفس المفتاح ويزيد العدّ والكمية معًا', () => {
        let lines = [];
        lines = r.bumpLine(lines, '7');
        lines = r.bumpLine(lines, '7');
        lines = r.bumpLine(lines, '8', 5);
        expect(lines).toEqual([
            { key: '7', count: 2, qty: 2 },
            { key: '8', count: 5, qty: 5 },
        ]);
    });

    test('bumpLine لا يُبدِّل مصفوفة المُنادي، ويرفض الصفر والسالب', () => {
        const before = [{ key: '7', count: 1, qty: 1 }];
        const after = r.bumpLine(before, '9');
        expect(before).toHaveLength(1);
        expect(after).toHaveLength(2);
        expect(r.bumpLine([], '7', 0)).toEqual([{ key: '7', count: 1, qty: 1 }]);
        expect(r.bumpLine([], '7', -3)).toEqual([{ key: '7', count: 1, qty: 1 }]);
    });

    test('setLineQty: الكسور مشروعة (كيلو/لتر) والسالبة تُبقي القيمة القديمة', () => {
        const lines = [{ key: '7', count: 3, qty: 3 }];
        expect(r.setLineQty(lines, '7', '2.5')[0].qty).toBe(2.5);
        expect(r.setLineQty(lines, '7', '-1')[0].qty).toBe(3);
        expect(r.setLineQty(lines, '7', '')[0].qty).toBe(3);
        expect(r.setLineQty(lines, '99', '5')).toEqual(lines);
    });

    test('setLinePrice: الفراغ والسالب = null («اتركه لمتوسط التكلفة»)، والصلاحية رقم', () => {
        const lines = [{ key: '7', count: 1, qty: 1 }, { key: '8', count: 1, qty: 1 }];
        expect(r.setLinePrice(lines, '7', '12.50')[0].price).toBe(12.5);
        expect(r.setLinePrice(lines, '7', '')[0].price).toBeNull();
        expect(r.setLinePrice(lines, '7', '-2')[0].price).toBeNull();
        expect(r.setLinePrice(lines, '7', 'abc')[0].price).toBeNull();
        expect(r.setLinePrice(lines, '7', '9')[1]).toEqual({ key: '8', count: 1, qty: 1 });
    });

    test('dropLine و sessionTotals (كميةٌ مدوّرة إلى ثلاث خانات)', () => {
        let lines = r.bumpLine([], '7', 2);
        lines = r.bumpLine(lines, '8', 1.5);
        expect(r.dropLine(lines, '7')).toEqual([{ key: '8', count: 1.5, qty: 1.5 }]);
        expect(r.sessionTotals(r.bumpLine(r.bumpLine([], '7'), '7'))).toEqual({ lines: 1, scans: 2, qty: 2 });
        expect(r.sessionTotals([{ key: 'a', count: 1, qty: 0.3335 }])).toEqual({ lines: 1, scans: 1, qty: 0.334 });
        expect(r.sessionTotals([])).toEqual({ lines: 0, scans: 0, qty: 0 });
        expect(r.sessionTotals(null).lines).toBe(0);
    });
});

describe('8. الأبواب: بابٌ واحد لكل كتابة، بعمودٍ واحد', () => {
    test('lookupByCode: بلا كود ⇒ صفر شبكة، ومع كود ⇒ بحثٌ واحد ومطابقةٌ تامّة', async () => {
        const rows = [ITEM(1, 'أ', { barcode: '4006381333931' }), ITEM(2, 'ب', { barcode: '4006381333931x' })];
        const net = loadRepo(async () => ({}), async () => ({ rows, total: 2, truncated: false }));
        expect((await net.api.lookupByCode('')).matches).toEqual([]);
        expect(net.calls).toHaveLength(0);
        const res = await net.api.lookupByCode(' 4006381333931 ');
        expect(net.calls[0].opts).toEqual({ q: '4006381333931', maxPages: 10 });
        expect(res.matches.map((m) => m.id)).toEqual([1]);
        expect(res.code).toBe('4006381333931');
    });

    test('loadCampaign و searchItems: نفس الباب بوسائط الخادم لا بابٌ ثانٍ', async () => {
        const net = loadRepo(async () => ({}), async () => ({ rows: Array.from({ length: 5 }, (_, i) => ITEM(i, `ص${i}`)), total: 5, truncated: false }));
        const camp = await net.api.loadCampaign(3);
        expect(camp.rows).toHaveLength(3);
        expect(camp.total).toBe(5);
        expect(net.calls[0].opts).toEqual({ q: '', maxPages: 10 });
        expect(await net.api.searchItems('')).toEqual([]);
        expect(await net.api.searchItems('دجاج')).toHaveLength(5);
        expect(net.calls[1].opts).toEqual({ q: 'دجاج', maxPages: 2 });
        await net.api.searchItems(`س${'ط'.repeat(200)}`);
        expect(net.calls[2].opts.q).toHaveLength(100);
    });

    test('assignItemBarcode: PUTّ عمودٍ واحد على id مُرمَّز، بحدّ 100', async () => {
        const net = loadRepo(async (url, opts) => ({ url, opts }), async () => ({ rows: [], total: 0 }));
        const long = `كود${'ط'.repeat(150)}`;
        await net.api.assignItemBarcode('7/1', ` ${NUL}${long} `);
        const call = net.calls[0];
        expect(call.url).toBe('/inventory/7%2F1');
        expect(call.opts.method).toBe('PUT');
        expect(JSON.parse(call.opts.body)).toEqual({ barcode: long.slice(0, 100) });
        expect(JSON.parse(call.opts.body).barcode).toHaveLength(100);
        expect(Object.keys(JSON.parse(call.opts.body))).toEqual(['barcode']);
    });

    test('assignItemBarcode لا يربط بكودٍ فارغ، وclearItemBarcode يرسل فراغًا صريحًا', async () => {
        const net = loadRepo(async (url, opts) => ({ url, opts }), async () => ({ rows: [], total: 0 }));
        await expect(net.api.assignItemBarcode(7, '   ')).rejects.toThrow('كودٍ فارغ');
        await net.api.clearItemBarcode(7);
        expect(JSON.parse(net.calls[net.calls.length - 1].opts.body)).toEqual({ barcode: '' });
    });

    test('الوارد لا يلمس inventory.qty: بابٌ واحد للربط وبابُ القديم للوارد', () => {
        // كل apiFetch في النموذج = PUTّ barcode وحده؛ لا /direct ولا /force ولا حرق كمية.
        expect(REPO_SRC.match(/apiFetch\(/g)).toHaveLength(2);
        expect(REPO_SRC.match(/JSON\.stringify\(\{\s*barcode:/g)).toHaveLength(2);
        expect(REPO_SRC).not.toMatch(/\/(direct|force|bulk-receipt|merge)\b/);
        expect(SCREEN_SRC).toMatch(/receiveInventoryItem\(raw\.id, receiptPayload\(raw, l\.qty, l\.price/);
    });
});

describe('9. عقود المصدر والتوصيل', () => {
    test('النموذج خالص: لا document ولا window ولا localStorage في scan-repo.js', () => {
        const code = REPO_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
        expect(code).not.toMatch(/\bdocument\./);
        expect(code).not.toMatch(/\bwindow\./);
        expect(code).not.toMatch(/localStorage/);
    });

    test('الشاشة لا شبكة فيها مباشرة: الكتابة كلها عبر الأبواب المسماة', () => {
        expect(SCREEN_SRC).not.toMatch(/\bapiFetch\s*\(/);
        expect(SCREEN_SRC).not.toMatch(/[^.\w]fetch\s*\(/);
        expect(SCREEN_SRC).not.toMatch(/method:\s*'(PUT|POST|DELETE)'/i);
        for (const door of ['assignItemBarcode', 'receiveInventoryItem', 'receiptPayload', 'lookupByCode', 'loadCampaign', 'searchItems']) {
            expect(SCREEN_SRC).toContain(door);
        }
    });

    test('بلا معالِجاتٍ داخل HTML، وبلا alert/prompt/window.confirm', () => {
        expect(SCREEN_SRC).not.toMatch(/\son(click|change|input|keydown|submit)\s*=\s*"/);
        expect(SCREEN_SRC).not.toMatch(/\bwindow\.(alert|confirm|prompt)\s*\(/);
        expect(SCREEN_SRC).toMatch(/confirmFn\s*\(/);
    });

    test('عتبات قارئ USB منقولة عن pos.js حرفيًا (4 · 64 · 60ms · 90ms)', () => {
        expect(SCREEN_SRC).toMatch(/const WEDGE = \{ minLen: 4, maxLen: 64, avgMs: 60, gapMs: 90 \};/);
    });

    test('التوصيل: استيراد + مُوزِّع + teardown + مسار فرعي + ورقة أنماط', () => {
        expect(HOST_SRC).toMatch(/import \{ mountGoodsScanScreen \} from '\.\/screens\/goods-scan\.js\?v=4\.9\.134';/);
        expect(HOST_SRC).toMatch(/if \(key === 'goods-scan'\) \{\n\s*renderGoodsScanScreen\(\);/);
        expect(HOST_SRC).toMatch(/function renderGoodsScanScreen\(\) \{\n\s*renderLiveRegisterScreen\(\{ key: 'goods-scan'/);
        expect(HOST_SRC).toMatch(/teardownGoodsScanScreen\(\);/);
        // زر «تحديث» في الهيكل يمرّر refresh للشاشة المركّبة — بدونه يبقى
        // عدّاد التغطية يقرأ من صفوفٍ قديمة بعد أي ربط.
        expect(HOST_SRC).toMatch(/reportsScreen \|\| goodsScanScreen/);
        expect(ROUTING_SRC).toMatch(/'goods-scan',/);
        expect(HTML_SRC).toMatch(/<link rel="stylesheet" href="css\/v2\/erp-scan\.css\?v=4\.9\.134">/);
    });

    test('CSS: كل متغيّرٍ مُعرَّف، وكلّ قاعدةٍ مقيّدة بجذر الشاشة', () => {
        const defined = new Set([...TOKENS_SRC.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
        const used = [...CSS_SRC.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
        expect([...new Set(used)].filter((v) => !defined.has(v))).toEqual([]);
        const selectors = CSS_SRC.replace(/\/\*[\s\S]*?\*\//g, '')
            .split('{').map((s) => s.split('}').pop().trim()).filter((s) => s && !s.startsWith('@'));
        expect(selectors.length).toBeGreaterThan(10);
        expect(selectors.filter((s) => /\[data-v2-|\.gs-/.test(s)).every((s) => s.startsWith('.erp-v2-scan'))).toBe(true);
    });

    test('CSS: لا حركة ولا !important خارج الطباعة — قرار السرعة', () => {
        expect(CSS_SRC).not.toMatch(/(^|\s)(transition|animation):/m);
        expect(CSS_SRC.split('@media print')[0]).not.toContain('!important');
    });
});


