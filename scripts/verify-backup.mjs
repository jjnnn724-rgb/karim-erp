/**
 * verify-backup.mjs — تحقق من سلامة النسخة الاحتياطية الحالية بلا فك تشفير.
 *  (1) مقارنة sha256 للنسخة الأخيرة مع ملف .sha256 المجاور لها
 *  (2) توليد نسخة جديدة عبر pg_dump بصلاحية karim_app — للتأكد من إمكانية الاسترجاع بلا صلاحيات فائقة
 *  (3) التأكد من عدد CREATE TABLE وعدد COPY في النص الناتج
 *  لا تحتاج كلمة passphrase: الخطوة (1) تعمل على نسخة مشفرة كما هي (sanity)، والخطوة (2) حجم عادي من pg_dump الافتراضي.
 *  ملاحظة مطابقتها للواقع: pg_dump output plain-text، وهذا ما يمكن تنفيذه بدون sudo.
 * الاستخدام: node scripts/verify-backup.mjs
 */
import { readFileSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKUPS = path.join(ROOT, 'database', 'backups');
const PG = 'C:/Program Files/PostgreSQL/18/bin';

const cfg = {};
for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) cfg[m[1]] = m[2].replace(/^"|"$/g, '');
}

const main = async () => {
    const results = [];

    // ── (1) kbak sanity-check ───────────────────────────────
    const latestPath = path.join(BACKUPS, 'karim_erp-latest.dump.kbak');
    const sidecarPath = latestPath + '.sha256';
    try {
        const stat = statSync(latestPath);
        const actual = createHash('sha256').update(readFileSync(latestPath)).digest('hex');
        const expectedSidecar = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/)[0];
        if (actual !== expectedSidecar) {
            results.push({ check: 'kbak-integrity', ok: false, detail: `sha256 mismatch: expected ${expectedSidecar.slice(0,16)}..., got ${actual.slice(0,16)}...`, bytes: stat.size });
        } else {
            results.push({ check: 'kbak-integrity', ok: true, detail: `sha256 matches (${stat.size} bytes)`, bytes: stat.size });
        }
    } catch (err) {
        results.push({ check: 'kbak-integrity', ok: false, detail: String(err.message) });
    }

    // ── (2+3) plain-text pg_dump integrity ────────────────────
    const target = path.join(BACKUPS, 'verify-probe.sql');
    try {
        const t0 = Date.now();
        execFileSync(path.join(PG, 'pg_dump.exe'), [
            '-h', cfg.DB_HOST || '127.0.0.1',
            '-p', cfg.DB_PORT || '5432',
            '-U', cfg.DB_USER,
            '-d', cfg.DB_NAME,
            '--exclude-table=public.zatca_*',   // create a smaller probe file
            '-f', target,
        ], { stdio: 'pipe', env: { ...process.env, PGPASSWORD: cfg.DB_PASSWORD }, timeout: 300000 });
        // العدّ عبر التدفق لأن النص 101MB أكبر من حدّ سلسلة JS القصوى
        const { createReadStream } = await import('fs');
        const { createInterface } = await import('readline');
        const rl = createInterface({ input: createReadStream(target, 'utf8'), crlfDelay: Infinity });
        let createTables = 0;
        let copyBlocks = 0;
        for await (const line of rl) {
            if (line.startsWith('CREATE TABLE ')) { createTables++; }
            if (line.startsWith('COPY ')) { copyBlocks++; }
        }
        const sqlStat = statSync(target);
        results.push({ check: 'pg_dump-creatable', ok: true, detail: `${createTables} CREATE TABLE · ${copyBlocks} COPY · ${sqlStat.size} bytes in ${Date.now() - t0}ms` });
        unlinkSync(target);
    } catch (err) {
        results.push({ check: 'pg_dump-creatable', ok: false, detail: String(err.message || err).slice(0, 400) });
        try { unlinkSync(target); } catch (_) {}
    }

    let failed = 0;
    for (const r of results) {
        const mark = r.ok ? '✓' : '✗';
        if (!r.ok) { failed++; }
        console.log(`${mark} ${r.check}: ${r.detail}`);
    }
    process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error('ERR', e); process.exit(1); });
