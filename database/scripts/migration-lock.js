'use strict';

const { Client } = require('pg');

const MIGRATION_LOCK_KEYS = [0x4B455250, 0x4D494752]; // KERP/MIGR namespace
const isMigrationApplied = (file, appliedVersions) =>
    appliedVersions.includes(file) || appliedVersions.includes(file.replace(/\.sql$/i, ''));
const normalizeMigrationVersions = (appliedVersions, migrationFiles) =>
    migrationFiles.filter((file) => isMigrationApplied(file, appliedVersions));

async function acquireMigrationLock(database) {
    const client = new Client({
        user: database.user,
        host: database.host,
        database: database.name,
        password: database.password,
        port: Number(database.port),
        connectionTimeoutMillis: 10000,
        application_name: 'karim-erp-migration-runner',
    });
    let connectionError = null;
    client.on('error', (error) => {
        connectionError = error;
    });

    await client.connect();

    let result;
    try {
        result = await client.query(
            'SELECT pg_try_advisory_lock($1, $2) AS acquired',
            MIGRATION_LOCK_KEYS,
        );
    } catch (error) {
        try {
            await client.end();
        } catch (closeError) {
            error.closeError = closeError;
        }
        throw error;
    }

    if (!result.rows[0].acquired) {
        await client.end();
        throw new Error('Another migration runner already holds the database migration lock.');
    }

    let released = false;
    return {
        async assertHealthy() {
            if (connectionError) {
                throw new Error(`Migration lock connection failed: ${connectionError.message}`);
            }
            await client.query('SELECT 1');
            if (connectionError) {
                throw new Error(`Migration lock connection failed: ${connectionError.message}`);
            }
        },
        async ensureLedger() {
            await client.query(
                'CREATE TABLE IF NOT EXISTS public.schema_migrations (version VARCHAR(50) UNIQUE NOT NULL, applied_at TIMESTAMPTZ DEFAULT NOW())',
            );
        },
        async getAppliedMigrations() {
            const result = await client.query(
                'SELECT version FROM public.schema_migrations ORDER BY version',
            );
            return result.rows.map((row) => row.version);
        },
        /**
         * عدد جداول المستخدم في public — يميّز بين قاعدة فارغة جديدة
         * (يجب أن تُطبَّق كل الترحيلات) وقاعدة قائمة سلفًا (سبق تطبيق
         * ترحيلات قبل وجود جدول السجل ⇒ يسحق الـbackfill من ملف القفل).
         * ملاحظة: جدول schema_migrations نفسه لا يُحتسب — فـensureLedger
         * ينشئه قبل هذا الاستعلام، فلو حُسب لظُنّت كل قاعدة جديدة «قائمة».
         */
        async countUserTables() {
            const result = await client.query(
                `SELECT count(*)::int AS n FROM pg_class x
                   JOIN pg_namespace n ON n.oid = x.relnamespace
                  WHERE n.nspname = 'public' AND x.relkind = 'r'
                    AND x.relname <> 'schema_migrations'`,
            );
            return result.rows[0].n;
        },
        async recordAppliedMigrations(files) {
            if (!Array.isArray(files) || files.length === 0) {
                return;
            }
            await client.query(
                'INSERT INTO public.schema_migrations (version) SELECT UNNEST($1::VARCHAR[]) ON CONFLICT (version) DO NOTHING',
                [files],
            );
        },
        async release() {
            if (released) {
                return;
            }
            released = true;
            let releaseError = null;
            try {
                if (connectionError) {
                    throw new Error(`Migration lock connection failed: ${connectionError.message}`);
                }
                const unlock = await client.query(
                    'SELECT pg_advisory_unlock($1, $2) AS released',
                    MIGRATION_LOCK_KEYS,
                );
                if (!unlock.rows[0].released) {
                    throw new Error('Database migration lock was not held by its connection.');
                }
            } catch (error) {
                releaseError = error;
            }
            try {
                await client.end();
            } catch (error) {
                if (!releaseError) {
                    releaseError = error;
                }
            }
            if (releaseError) {
                throw releaseError;
            }
        },
    };
}

module.exports = {
    MIGRATION_LOCK_KEYS,
    acquireMigrationLock,
    isMigrationApplied,
    normalizeMigrationVersions,
};
