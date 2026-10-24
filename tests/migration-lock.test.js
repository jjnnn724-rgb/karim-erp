'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
// الحارس يقرأ DB_HOST/DB_PASSWORD من بيئة العملية؛ عند تشغيل هذه المجموعة
// منفردةً لا وحدة أخرى تحمّل .env فيفشل الحارس بلا سبب حقيقي.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');
const {
    acquireMigrationLock,
    compareMigrationLedger,
    isMigrationApplied,
    MIGRATION_LOCK_KEYS,
    normalizeMigrationVersions,
} = require('../database/scripts/migration-lock');

describe('database migration concurrency lock', () => {
    test.each([
        ['003_cashier_module.sql', ['003_cashier_module.sql'], true],
        ['003_cashier_module.sql', ['003_cashier_module'], true],
        ['003_cashier_module.sql', ['004_other_migration'], false],
    ])('matches migration filename %s against ledger values %j', (file, versions, expected) => {
        expect(isMigrationApplied(file, versions)).toBe(expected);
    });

    test('normalizes legacy migration versions without the SQL extension', () => {
        expect(normalizeMigrationVersions(
            ['003_cashier_module', 'unknown_migration'],
            ['003_cashier_module.sql', '004_other_migration.sql'],
        )).toEqual(['003_cashier_module.sql']);
    });

    test('compares migration files with the ledger and reports unmatched versions', () => {
        expect(compareMigrationLedger(
            ['003_cashier_module.sql', '004_other_migration.sql'],
            ['003_cashier_module', 'removed_migration.sql'],
        )).toEqual({
            applied: ['003_cashier_module.sql'],
            pending: ['004_other_migration.sql'],
            unknownApplied: ['removed_migration.sql'],
        });
    });

    test('rejects malformed migration status inputs', () => {
        expect(() => compareMigrationLedger(['003_valid.sql', null], [])).toThrow(TypeError);
        expect(() => compareMigrationLedger([], ['003_valid.sql', 4])).toThrow(TypeError);
    });

    test('reads an existing migration ledger using SELECT statements only', async () => {
        const client = {
            connect: jest.fn().mockResolvedValue(),
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ relation: 'schema_migrations' }] })
                .mockResolvedValueOnce({ rows: [{ version: '003_cashier_module.sql' }] })
                .mockResolvedValueOnce({ rows: [] }),
            end: jest.fn().mockResolvedValue(),
        };
        let readMigrationLedger;
        jest.doMock('pg', () => ({ Client: jest.fn(() => client) }));
        try {
            jest.isolateModules(() => {
                ({ readMigrationLedger } = require('../database/scripts/migration-lock'));
            });
            await expect(readMigrationLedger({
                name: 'karim_erp_test',
                host: '127.0.0.1',
                port: '5432',
                user: 'test',
                password: '',
            })).resolves.toEqual(['003_cashier_module.sql']);
            expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
                'BEGIN READ ONLY',
                "SELECT to_regclass('public.schema_migrations') AS relation",
                'SELECT version FROM public.schema_migrations ORDER BY version',
                'ROLLBACK',
            ]);
            expect(client.end).toHaveBeenCalledTimes(1);
        } finally {
            jest.dontMock('pg');
        }
    });

    test('reports an absent ledger without creating it', async () => {
        const client = {
            connect: jest.fn().mockResolvedValue(),
            query: jest.fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ relation: null }] })
                .mockResolvedValueOnce({ rows: [] }),
            end: jest.fn().mockResolvedValue(),
        };
        let readMigrationLedger;
        jest.doMock('pg', () => ({ Client: jest.fn(() => client) }));
        try {
            jest.isolateModules(() => {
                ({ readMigrationLedger } = require('../database/scripts/migration-lock'));
            });
            await expect(readMigrationLedger({
                name: 'karim_erp_test',
                host: '127.0.0.1',
                port: '5432',
                user: 'test',
                password: '',
            })).resolves.toBeNull();
            expect(client.query.mock.calls.map(([sql]) => sql)).toEqual([
                'BEGIN READ ONLY',
                "SELECT to_regclass('public.schema_migrations') AS relation",
                'ROLLBACK',
            ]);
            expect(client.end).toHaveBeenCalledTimes(1);
        } finally {
            jest.dontMock('pg');
        }
    });

    function assertSandboxEnvironment() {
        if (process.env.NODE_ENV === 'production'
            || process.env.KARIM_TEST_DB_ISOLATED !== '1'
            || process.env.DB_NAME !== 'karim_erp_test'
            || process.env.KARIM_TEST_DB_NAME !== 'karim_erp_test'
            || !['127.0.0.1', 'localhost', '::1'].includes(String(process.env.DB_HOST).toLowerCase())) {
            throw new Error('Migration-lock integration test requires the isolated loopback Sandbox.');
        }
    }

    test('refuses a second runner while another session owns the database lock', async () => {
        assertSandboxEnvironment();

        const client = new Client({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectionTimeoutMillis: 10000,
        });
        await client.connect();
        await client.query('SELECT pg_advisory_lock($1, $2)', MIGRATION_LOCK_KEYS);
        try {
            const runnerPath = path.resolve(__dirname, '..', 'database', 'scripts', 'run-migration.js');
            const result = spawnSync(process.execPath, [
                runnerPath,
                '__migration_lock_test_missing__.sql',
            ], {
                cwd: path.resolve(__dirname, '..'),
                env: process.env,
                encoding: 'utf8',
                timeout: 15000,
            });

            expect(result.error).toBeUndefined();
            expect(result.status).toBe(1);
            expect(`${result.stdout}${result.stderr}`).toContain('Another migration runner already holds');
            expect(`${result.stdout}${result.stderr}`).not.toContain('تطبيق:');
        } finally {
            await client.query('SELECT pg_advisory_unlock($1, $2)', MIGRATION_LOCK_KEYS);
            await client.end();
        }
    });

    test('does not record a transactional migration whose SQL fails', async () => {
        assertSandboxEnvironment();
        const projectRoot = path.resolve(__dirname, '..');
        const version = `__migration_failure_test_${process.pid}_${Date.now()}.sql`;
        const table = `__migration_failure_test_${process.pid}_${Date.now()}`;
        const migrationPath = path.join(projectRoot, 'database', 'migrations', version);
        fs.writeFileSync(migrationPath, [
            'BEGIN;',
            `CREATE TABLE public."${table}" (id INTEGER);`,
            'SELECT * FROM public.__migration_failure_test_missing_relation__;',
            'COMMIT;',
        ].join('\n'), 'utf8');

        const client = new Client({
            host: process.env.DB_HOST,
            port: Number(process.env.DB_PORT),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectionTimeoutMillis: 10000,
        });

        try {
            const result = spawnSync(process.execPath, [
                path.join(projectRoot, 'database', 'scripts', 'run-migration.js'),
                version,
            ], {
                cwd: projectRoot,
                env: process.env,
                encoding: 'utf8',
                timeout: 15000,
            });
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(1);

            await client.connect();
            const ledger = await client.query(
                'SELECT 1 FROM public.schema_migrations WHERE version = $1',
                [version],
            );
            const createdTable = await client.query(
                'SELECT to_regclass($1) AS relation',
                [`public.${table}`],
            );
            expect(ledger.rowCount).toBe(0);
            expect(createdTable.rows[0].relation).toBeNull();
        } finally {
            await client.end();
            fs.rmSync(migrationPath, { force: true });
        }
    });

    test('releases the database lock when the runner finishes', async () => {
        assertSandboxEnvironment();
        const database = {
            name: process.env.DB_NAME,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        };
        const lock = await acquireMigrationLock(database);
        const verificationVersion = `__migration_lock_test_${process.pid}_${Date.now()}`;
        const cleanupClient = new Client({
            host: database.host,
            port: Number(database.port),
            database: database.name,
            user: database.user,
            password: database.password,
            connectionTimeoutMillis: 10000,
        });
        await cleanupClient.connect();
        try {
            await lock.ensureLedger();
            await lock.assertHealthy();
            await lock.recordAppliedMigrations([verificationVersion]);
            expect(await lock.getAppliedMigrations()).toContain(verificationVersion);
        } finally {
            await cleanupClient.query('DELETE FROM public.schema_migrations WHERE version = $1', [verificationVersion]);
            await cleanupClient.end();
            await lock.release();
        }

        const nextLock = await acquireMigrationLock(database);
        try {
            await nextLock.assertHealthy();
        } finally {
            await nextLock.release();
        }
    });
});
