/**
 * ai-assistant-readonly.test.js — المساعد لا يكتب في القاعدة إطلاقًا
 * ══════════════════════════════════════════════════════════════════════
 * قاعدة المالك (2026-10-22): «لا تقرب المخزن — مجرود وشغال، وأي تغيير في
 * الأصناف يكون مشكلة». فوحدة المساعد (المدير المالي + التشخيص + المعرفة)
 * تُقرأ فقط: لا INSERT ولا UPDATE ولا DELETE ولا DDL.
 *
 * الفحص على **نصوص الاستعلامات نفسها** (لا على الملف كلّه) — حتى لا تلتقط
 * الكلمةُ «UPDATE» اسمَ دالةٍ في جافاسكربت ولا يُظلم مجمّعٌ من المشروع
 * يكتب عمدًا.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'backend', 'ai-assistant');

/** نصوص استعلامات pool.query داخل مصدر معيّن. */
function sqlOf(src) {
    const out = [];
    const re = /pool\.query\(\s*(`[\s\S]*?`|'[^']*'|"[^"]*")/g;
    let m;
    while ((m = re.exec(src)) !== null) { out.push(m[1].replace(/^[`'"]([\s\S]*)[`'"]$/, '$1')); }
    return out;
}

describe('المساعد — قراءة فقط', () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js'));

    test('وحداتُ المساعد موجودة', () => {
        expect(files).toContain('assistant.js');
        expect(files).toContain('routes.js');
        expect(files).toContain('cfo.js');
    });

    test('كل استعلام في وحدات المساعد قراءة (SELECT/WITH) فقط', () => {
        let checked = 0;
        for (const f of files) {
            const src = fs.readFileSync(path.join(DIR, f), 'utf8');
            for (const q of sqlOf(src)) {
                checked += 1;
                if (!/^\s*(SELECT|WITH)\b/i.test(q)) {
                    throw new Error(`${f}: استعلام ليس قراءة → ${q.slice(0, 70)}`);
                }
                if (/\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|TRUNCATE|DROP\s|ALTER\s+TABLE)\b/i.test(q)) {
                    throw new Error(`${f}: استعلام كتابة → ${q.slice(0, 70)}`);
                }
            }
        }
        if (checked <= 2) {throw new Error('لم يُفحص أي استعلام');}
    });

    test('المدير المالي لا يستدعي إلا مجمّعات قراءة النظام', () => {
        const src = fs.readFileSync(path.join(DIR, 'cfo.js'), 'utf8');
        expect(src).toMatch(/require\('\.\.\/daily-report-service'\)/);
        expect(src).toMatch(/require\('\.\.\/manager-briefing'\)/);
        expect(src).toMatch(/require\('\.\.\/riyadh-date'\)/);
        // ممنوع: أي مسار كتابة أو دالة تغيّر حالة
        expect(src).not.toMatch(/postJournal|postSaleToLedger|postPurchaseToLedger|completeSale|updateInventory|setInventory/i);
    });

    test('بوابة المساعد: POST واحد (السؤال) ولا شيء غيره', () => {
        const src = fs.readFileSync(path.join(DIR, 'routes.js'), 'utf8');
        const posts = [...src.matchAll(/router\.post\('([^']+)'/g)].map((m) => m[1]);
        expect(posts).toEqual(['/ask']);
        const puts = [...src.matchAll(/router\.(put|delete|patch)\(/g)];
        expect(puts).toEqual([]);
    });
});
