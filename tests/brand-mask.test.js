/**
 * brand-mask.test.js — اسم المطعم هو الظاهر، واسم مصدر الكاشير لا يُعرض في الواجهة.
 * المصدر يبقى مقروءًا كما هو (المعرّفات والمسارات والجداول)؛ الإخفاء طبقة عرض فقط.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const BRAND = 'مطاعم الشرفه العالمي';
const AUTO_MARKER = '[AUTO:YARASOFT]';

const read = (p) => fs.readFileSync(p, 'utf8');
const readApp = (rel) => read(path.join(APP, ...rel.split('/')));

function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full, out); }
        else if (/\.(js|html)$/.test(entry.name)) { out.push(full); }
    }
    return out;
}

// تعليقات المصدر تشرح التكامل ولا تظهر للمستخدم — تُستبعد من الفحص.
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('إخفاء اسم مصدر الكاشير من الواجهة', () => {
    test('لا اسم ظاهر للمصدر في أي ملف واجهة (نصوص فقط، بلا تعليقات)', () => {
        const hits = [];
        for (const file of walk(APP)) {
            const relative = path.relative(APP, file);
            stripComments(read(file)).split(/\r?\n/).forEach((line, index) => {
                // «خيارات/اختيارات» تحتوي «يارا» حرفيًا — تُستثنى بالحرف التالي.
                if (/\u064a\u0627\u0631\u0627(?!\u062a)/.test(line)) {
                    hits.push(`${relative}:${index + 1}`);
                }
                for (const literal of line.match(/'[^']*'|"[^"]*"|`[^`]*`/g) || []) {
                    if (literal === `'${AUTO_MARKER}'`) { continue; }
                    if (/Yarasoft|YaraSoft|YARASOFT/.test(literal)) {
                        hits.push(`${relative}:${index + 1} ${literal.slice(0, 80)}`);
                    }
                }
            });
        }
        expect(hits).toEqual([]);
    });

    test('المطبوعات والتقارير تحمل اسم المطعم، لا اسم المصدر', () => {
        const v2Branding = readApp('js/v2/print-branding.js');
        expect(v2Branding).toContain(`'${BRAND}'`);
        expect(v2Branding).toContain('window.STATE.settings');
        expect(v2Branding).toContain('name.textContent = title');

        for (const rel of ['js/features/reports.js', 'js/features/yarasoft.js', 'js/features/inventory-inquiry.js']) {
            expect(readApp(rel)).toContain(BRAND);
        }
        expect(readApp('js/features/reports.js')).toContain("STATE.settings?.name || 'مطاعم الشرفه العالمي'");
    });

    test('ملاحظات الاستيراد الآلي تُعرض عربية ولا تظهر بصيغتها الخام', () => {
        const v2 = readApp('js/v2/screens/revenues.js');
        expect(v2).toContain('noteText');
        expect(v2).toContain('مبيعات الكاشير');
        expect(v2).toContain(`startsWith('${AUTO_MARKER}')`);

        const legacy = readApp('js/features/reports.js');
        expect(legacy).toContain('formatRevenueNote');
        expect(legacy).toContain('isCashierDb');
        expect(legacy).toContain('مبيعات الكاشير');
    });

    test('رسائل حالة تكامل قاعدة الكاشير لا تحمل اسم المصدر', () => {
        const backend = path.join(__dirname, '..', 'backend');
        const routes = stripComments(read(path.join(backend, 'yarasoft', 'routes.js')));
        const statusLine = routes.split(/\r?\n/).find((line) => line.includes('YARASOFT_STATUS_FAILED'));
        expect(statusLine).toBeTruthy();
        const message = (statusLine.match(/message:\s*'([^']*)'/) || [])[1] || '';
        expect(message).toContain('قاعدة الكاشير');
        expect(message).not.toMatch(/Yarasoft/i);

        const config = stripComments(read(path.join(backend, 'yarasoft', 'config.js')));
        expect(config).not.toContain("'Yarasoft POS'");
        expect(config).not.toContain('(Yarasoft)');
    });
});
