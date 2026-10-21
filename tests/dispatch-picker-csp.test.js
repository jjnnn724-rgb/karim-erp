const fs = require('fs');
const path = require('path');

const KITCHEN = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'kitchen.js'), 'utf8');

function between(source, start, end) {
    const startAt = source.indexOf(start);
    expect(startAt).toBeGreaterThan(-1);
    const endAt = source.indexOf(end, startAt + start.length);
    expect(endAt).toBeGreaterThan(startAt);
    return source.slice(startAt, endAt);
}

describe('اختيار صنف طلب الصرف في الواجهة القديمة', () => {
    test('نتيجة الصنف تستخدم التفويض على mousedown بدل المعالج المضمّن المحجوب بـ CSP', () => {
        const filter = between(KITCHEN, 'function dispFilterItems(input)', 'function dispHideList(input)');

        expect(filter).toContain('data-karim-action="dispPickItem"');
        expect(filter).toContain('data-karim-event="mousedown"');
        expect(filter).toContain('data-karim-pass="element"');
        expect(filter).not.toMatch(/\bonmousedown\s*=/i);
    });

    test('اختيار الصنف يحدّث صف الطلب فقط ولا ينفّذ صرفًا أو تغييرًا للمخزون', () => {
        const picker = between(KITCHEN, 'function dispPickItem(el)', 'function dispUomChanged(select)');

        expect(picker).toContain('row.querySelector(\'.dispatch-item-name\').value=el.dataset.name||\'\'');
        expect(picker).toContain('updateDispSummary()');
        expect(picker).not.toMatch(/\b(?:apiFetch|persistCreate|persistUpdate|submitDispatchRequest)\s*\(/);
    });
});
