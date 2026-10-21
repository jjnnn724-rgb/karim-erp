'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
    acquireMigrationLock,
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
