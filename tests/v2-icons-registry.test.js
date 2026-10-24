/**
 * v2-icons-registry.test.js — كل data-i في الشاشات له أيقونة مسجّلة
 * ═══════════════════════════════════════════════════════════════════════
 * سبب الاختبار: المُهيّئ في icons.js يرسم `P[name] || P['circle-help']`
 * عند اسم غير مسجّل — أي «؟» صامتة بدل الأيقونة. تسعة أسماء كانت مستخدمة
 * في V2 بلا تسجيل (columns, chevrons-*, pen-line, tv, x-circle…) فظهرت
 * علامات استفهام في أزرار حقيقية. الاختبار يمنع تكرار الانجراف: أي اسم
 * يُكتب في data-i ولا يوجد في السجل يُسقط البوابة.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const ICONS = path.join(APP, 'js', 'icons.js');

function registry() {
    const src = fs.readFileSync(ICONS, 'utf8');
    return new Set([...src.matchAll(/^\s*'([a-z0-9-]+)':\s*'</gm)].map((m) => m[1]));
}

function files(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { out.push(...files(p)); }
        else if (/\.(js|html)$/.test(entry.name)) { out.push(p); }
    }
    return out;
}

function usages() {
    const found = new Map();
    for (const file of files(APP)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(/data-i=["'`]([a-z0-9-]+)["'`]/g)) {
            if (!found.has(m[1])) { found.set(m[1], new Set()); }
            found.get(m[1]).add(path.relative(APP, file));
        }
    }
    return found;
}

/** أسماء تُركّب وقت التشغيل داخل قوالب — لا يراها المسح الحرفي. */
const DYNAMIC = ['arrow-up', 'arrow-down', 'arrow-up-down'];

test('كل أيقونة مكتوبة حرفيًا في data-i موجودة في السجل', () => {
    const reg = registry();
    const missing = [...usages().keys()].filter((k) => !reg.has(k)).sort();
    expect(missing).toEqual([]);
});

test('أيقونات الجداول الديناميكية (ترتيب الأعمدة) موجودة في السجل', () => {
    const reg = registry();
    expect(DYNAMIC.filter((k) => !reg.has(k))).toEqual([]);
});

test('سجل الأيقونات لا يعيد أسماء مكررة (آخر تعريف يطمس الأول بصمت)', () => {
    const src = fs.readFileSync(ICONS, 'utf8');
    const names = [...src.matchAll(/^\s*'([a-z0-9-]+)':\s*'/gm)].map((m) => m[1]);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(dupes)]).toEqual([]);
});
