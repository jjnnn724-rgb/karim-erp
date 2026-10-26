'use strict';

/**
 * حراس كتابة تسوية الدفتر مع يارسوفت (scripts/ledger-yara-parity.js).
 * سبب الاختبار (2026-10-24): السكربت يُلغي قيودًا مرحَّلة بقرار المالك، فأي
 * تشغيل بلا تأييد أو بأي قاعدة أخرى يجب أن يتوقف قبل لمس الخادم، ولا يجوز أبدًا
 * أن يكتب في جداول يارسوفت المقروءة (revenues/expenses).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ledger-yara-parity.js');

function run(args) {
    return spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            DB_HOST: '192.0.2.1',
            DB_PORT: '5432',
            DB_NAME: 'karim_erp_test',
            KARIM_TEST_DB_NAME: 'karim_erp_test',
            DB_PASSWORD: 'unused',
        },
        encoding: 'utf8',
        timeout: 20000,
    });
}

function out(result) {return `${result.stdout}${result.stderr}`;}

/** تقرير في قاعدة مؤقتة ليُقرأ وقت الاختبار فقط. */
function writeReport(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'karim-parity-'));
    const file = path.join(dir, 'report.json');
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
}

describe('ledger-yara-parity — حراس الكتابة', () => {
    test('--apply وحده يرفض ويطلب التأييد باسم القاعدة', () => {
        const r = run(['--apply']);
        expect(r.status).toBe(2);
        expect(out(r)).toContain('رفض الكتابة');
        expect(out(r)).toContain('--confirm-write=karim_erp_test');
        expect(out(r)).not.toMatch(/ECONN|ETIMEDOUT|EPONH|password authentication/);
    });

    test('تأييد بقاعدة مختلفة مرفوض — لا يُفتح اتصال', () => {
        const r = run(['--apply', '--confirm-write=karim_erp']);
        expect(r.status).toBe(2);
        expect(out(r)).toContain('رفض الكتابة');
        expect(out(r)).not.toMatch(/ECONN|ETIMEDOUT|EPONH|password authentication/);
    });

    test('الرجوع يرفض تقرير معاينة لم يكتب شيئًا', () => {
        const file = writeReport({ mode: 'dry_run', started_at: '2026-10-24T00:00:00.000Z', actions: { voided: [] } });
        const r = run([`--rollback=${file}`, '--confirm-write=karim_erp_test']);
        expect(r.status).toBe(1);
        expect(out(r)).toContain('هذا التقرير معاينة');
        expect(out(r)).not.toMatch(/ECONN|ETIMEDOUT|EPONH/);
    });

    test('الرجوع يطلب التأييد قبل أي كتابة', () => {
        const file = writeReport({
            mode: 'apply', started_at: '2026-10-24T00:00:00.000Z',
            actions: { voided: [{ id: '1' }], created_entries: ['ora:CC:1'] },
        });
        const r = run([`--rollback=${file}`]);
        expect(r.status).toBe(1);
        expect(out(r)).toContain('الرجوع يكتب في القاعدة');
        expect(out(r)).not.toMatch(/ECONN|ETIMEDOUT|EPONH/);
    });
});

describe('ledger-yara-parity — المرآة للقراءة فقط', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');

    test('لا INSERT ولا UPDATE ولا DELETE على جداول يارسوفت', () => {
        expect(source).not.toMatch(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(revenues|expenses|ora_e_invoices)\b/i);
    });

    test('كل كتابة في journal_entries وحدها', () => {
        const writes = [...source.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z_"]+)/gi)].map((m) => m[0]);
        expect(writes.length).toBeGreaterThan(0);
        for (const w of writes) {expect(w).toMatch(/journal_entries/i);}
    });

    test('الإلغاء لا يمسّ إلا قيود إيراد يارسوفت المرحَّلة', () => {
        expect(source).toMatch(/SET status = 'void'[\s\S]{0,240}e\.status = 'posted' AND e\.source_type = \$2/);
        expect(source).toMatch(/source_type = \$1 AND e\.status = 'posted'/);
    });

    test('مبالغ القيود تُقرأ من journal_lines لا من عملة وهمية', () => {
        expect(source).toContain("l.account_code = '4000'");
        expect(source).not.toMatch(/je\.amount|e\.amount/);
    });

    test('التقرير يُكتب في database/backups ولا يكتب في القاعدة وقت المعاينة', () => {
        expect(source).toMatch(/ledger-yara-parity-\$\{started/);
        expect(fs.existsSync(path.join(ROOT, 'database', 'backups'))).toBe(true);
    });
});
