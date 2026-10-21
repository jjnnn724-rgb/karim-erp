'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

describe('finance reconciliation write safeguards', () => {
    const script = path.resolve(__dirname, '..', 'scripts', 'finance-reconcile.js');

    function run(args) {
        return spawnSync(process.execPath, [script, ...args], {
            cwd: path.resolve(__dirname, '..'),
            env: {
                ...process.env,
                NODE_ENV: 'test',
                DB_HOST: '192.0.2.1',
                DB_PORT: '5432',
                DB_NAME: 'karim_erp_test',
                DB_PASSWORD: 'unused',
            },
            encoding: 'utf8',
            timeout: 5000,
        });
    }

    test('does not initialize a database connection without explicit --apply', () => {
        const result = run([]);
        expect(result.status).toBe(2);
        expect(`${result.stdout}${result.stderr}`).toContain('رفض التشغيل دون --apply');
        expect(`${result.stdout}${result.stderr}`).not.toContain('ECONN');
    });

    test('requires confirmation matching DB_NAME before loading the write workflow', () => {
        const result = run(['--apply']);
        expect(result.status).toBe(2);
        expect(`${result.stdout}${result.stderr}`).toContain('--confirm-write=karim_erp_test');
        expect(`${result.stdout}${result.stderr}`).not.toContain('ECONN');
    });

    test('rejects a confirmation for a different database', () => {
        const result = run(['--apply', '--confirm-write=karim_erp']);
        expect(result.status).toBe(2);
        expect(`${result.stdout}${result.stderr}`).toContain('رفض الكتابة');
        expect(`${result.stdout}${result.stderr}`).not.toContain('ECONN');
    });
});
