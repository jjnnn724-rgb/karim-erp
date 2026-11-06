/**
 * backup-sanitize.test.js — تعقيم نسخة pg_dump
 * ═══════════════════════════════════════════════════════════════════════
 * النسخة الاحتياطية هي آخر خطٍّ دفاع، ومعالجتها تعمل على Buffer لا string
 * لأن حجم النسخة يتجاوز سقف V8 للسلاسل. الكسر السابق (`line.startsWith is
 * not a function`) لم يُلتقط لأن الدالة كانت مدفونة داخل backup.js بلا
 * تصدير: النسخة تُكتب كاملة ثم يفشل التعقيم، فيخرج السكربت بالرمز 1 وتُسجَّل
 * النسخة الليلية فاشلة رغم سلامتها. هذه الاختبارات تحرس الدالة نفسها.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    stripVersionSpecificStatements, startsWithBuffer, TRANSACTION_TIMEOUT_LINE,
} = require('../database/scripts/sanitize-sql');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-sql-')); });
afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* لا شيء */ } });

const write = (name, content) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content, 'utf8');
    return p;
};

describe('تعقيم نسخة pg_dump', () => {
    test('يحذف أسطر SET transaction_timeout ويحفظ الباقي كما هو', () => {
        const src = [
            '-- header',
            'SET transaction_timeout = 0;',
            'SET statement_timeout = 0;',
            '-- تعليق عربي: نسخة احتياطية',
            'INSERT INTO t VALUES (\'قيمة\');',
            'SET transaction_timeout = 0;',
            '',
        ].join('\n');
        const p = write('dump.sql', src);
        const out = stripVersionSpecificStatements(p);
        expect(out).toEqual({ stripped: 2, changed: true });
        expect(fs.readFileSync(p, 'utf8')).toBe([
            '-- header',
            'SET statement_timeout = 0;',
            '-- تعليق عربي: نسخة احتياطية',
            'INSERT INTO t VALUES (\'قيمة\');',
            '',
        ].join('\n'));
        expect(fs.existsSync(`${p}.sanitize.tmp`)).toBe(false);
    });

    test('لا يمسّ الملف حين لا يوجد ما يُحذف', () => {
        const src = '-- header\nSET statement_timeout = 0;\n';
        const p = write('clean.sql', src);
        const before = fs.statSync(p).mtimeMs;
        expect(stripVersionSpecificStatements(p)).toEqual({ stripped: 0, changed: false });
        expect(fs.readFileSync(p, 'utf8')).toBe(src);
        expect(fs.statSync(p).mtimeMs).toBe(before);
        expect(fs.existsSync(`${p}.sanitize.tmp`)).toBe(false);
    });

    test('سطر يقع على حدّ المقطع لا يُفلت ولا يُقصّ', () => {
        // المقطع 64 بايت: السطر يبدأ قبل الحدّ وينتهي بعده.
        const prefix = `${'x'.repeat(60)}\n`;
        const src = `${prefix}SET transaction_timeout = 0;\nSET statement_timeout = 0;\nذيل`;
        const p = write('boundary.sql', src);
        const out = stripVersionSpecificStatements(p, { chunkSize: 64 });
        expect(out.stripped).toBe(1);
        expect(fs.readFileSync(p, 'utf8')).toBe(`${prefix}SET statement_timeout = 0;\nذيل`);
    });

    test('ذيل بلا سطر جديد في النهاية يُحفظ', () => {
        const src = 'SET transaction_timeout = 0;\nآخر سطر بلا سطر جديد';
        const p = write('tail.sql', src);
        expect(stripVersionSpecificStatements(p).stripped).toBe(1);
        expect(fs.readFileSync(p, 'utf8')).toBe('آخر سطر بلا سطر جديد');
    });

    test('مقارنة البادئة على البايتات لا على السلاسل', () => {
        expect(startsWithBuffer(Buffer.from('SET transaction_timeout = 0;'), TRANSACTION_TIMEOUT_LINE)).toBe(true);
        expect(startsWithBuffer(Buffer.from('SET statement_timeout'), TRANSACTION_TIMEOUT_LINE)).toBe(false);
        expect(startsWithBuffer(Buffer.from('SET'), TRANSACTION_TIMEOUT_LINE)).toBe(false);
        expect(startsWithBuffer(Buffer.alloc(0), TRANSACTION_TIMEOUT_LINE)).toBe(false);
    });

    test('backup.js يستخدم الوحدة المشتركة ولا يعيد تعريف الدالة', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'database', 'scripts', 'backup.js'), 'utf8');
        expect(src).toContain("require('./sanitize-sql')");
        expect(src).not.toMatch(/function stripVersionSpecificStatements/);
        expect(src).not.toMatch(/\.startsWith\(TRANSACTION_TIMEOUT_LINE\)/);
    });
});
