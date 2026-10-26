/**
 * v2-command-palette.test.js — حراسة عقد البحث السريع (Ctrl+K).
 * الحوار معلن aria-modal، فلا يجوز أن يخرج Tab إلى صفحة خلفه، ولا أن يتحرّك
 * الاختيار بالأسهم إلى صفٍّ خارج الجزء المرئي من القائمة.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(
    path.join(ROOT, 'frontend', 'app', 'js', 'v2', 'screens', 'dashboard.js'),
    'utf8'
);

const slice = (startNeedle, endNeedle) => {
    const start = SRC.indexOf(startNeedle);
    expect(start).toBeGreaterThan(-1);
    const end = SRC.indexOf(endNeedle, start);
    expect(end).toBeGreaterThan(start);
    return SRC.slice(start, end);
};

describe('V2 command palette a11y contract', () => {
    test('الحوار معلن: role=dialog مع aria-modal واسم، والمربع combobox مربوط بالقائمة', () => {
        expect(SRC).toMatch(/role="dialog" aria-modal="true" aria-label="[^"]+"/);
        expect(SRC).toMatch(/class="erp-pal__input"[^>]*role="combobox"[^>]*aria-expanded="true"/);
        expect(SRC).toMatch(/aria-controls="erp-pal-list"/);
        expect(SRC).toMatch(/id="erp-pal-list" role="listbox"/);
        expect(SRC).toMatch(/<li role="option" id="erp-pal-opt-\$\{i\}" aria-selected=/);
    });

    test('الاختيار يُعلن عبر aria-activedescendant', () => {
        expect(SRC).toContain("input?.setAttribute('aria-activedescendant', `erp-pal-opt-${active}`);");
    });

    test('Tab لا يخرج من الحوار المعلن aria-modal', () => {
        const keyHandler = slice('function onDocKey(e) {', '\n    function open() {');
        expect(keyHandler).toMatch(/if \(e\.key === 'Tab'\) \{e\.preventDefault\(\); input\.focus\(\); return;\}/);
        // Escape يبقى أول فرعٍ: الخروج متاح قبل أي اعتراضٍ آخر.
        const esc = keyHandler.indexOf("e.key === 'Escape'");
        const tab = keyHandler.indexOf("e.key === 'Tab'");
        expect(esc).toBeGreaterThan(-1);
        expect(tab).toBeGreaterThan(esc);
    });

    test('السهم إلى صفٍّ خارج النظر يُمرَّر إلى العرض', () => {
        const paint = slice('function paint() {', 'function applyFilter() {');
        const descendant = paint.indexOf("setAttribute('aria-activedescendant'");
        const follow = paint.indexOf('scrollIntoView({ block: \'nearest\' })');
        expect(descendant).toBeGreaterThan(-1);
        expect(follow).toBeGreaterThan(descendant);
        expect(paint).toMatch(/list\.querySelector\(`#erp-pal-opt-\$\{active\}`\)\?\.scrollIntoView/);
    });
});
