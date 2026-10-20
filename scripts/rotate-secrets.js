#!/usr/bin/env node
/**
 * rotate-secrets.js — تدوير أسرار التطبيق مع تراجع تلقائي مضمون
 * ══════════════════════════════════════════════════════════════════════════
 * ما يُدار: DB_PASSWORD + JWT_ACCESS_SECRET + JWT_REFRESH_SECRET + API_KEY
 * في .env (المصدر الوحيد للخدمة) + كلمة مرور دور قاعدة البيانات.
 *
 * لماذا أداة في المستودع: التدوير عملية متكررة، وكل يدوي فيها خطوات
 * يمكن أن تُنسى (نسخة التراجع، إعادة التشغيل، التحقق). هنا موثّقة
 * وقابلة للتكرار، مع تراجع تلقائي عند أي فشل.
 *
 * الضوابط:
 *   · نسخة تراجع محفوظة قبل أي تغيير (database/backups/secret-rollback/).
 *   · كلمة المرور الجديدة لا تُطبع ولا تُكتب في نص SQL (قيمة مُربَطة).
 *   · إعادة تشغيل الخدمة + فحص صحة + فحص ثلاثي للسر الجديد/القديم.
 *   · عند أي فشل → تراجع كامل (استعادة .env + إعادة كلمة مرور الدور +
 *     إعادة تشغيل) ثم خروج 1.
 *   · لا مساس ببيانات العمل، ولا migrations، ولا كلمات مرور المستخدمين.
 *
 * التشغيل:
 *   node scripts/rotate-secrets.js --confirm
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const ENV_FILE = path.join(REPO, '.env');
const SERVICE = process.env.KARIM_SERVICE_NAME || 'KarimERP-Server';
const HEALTH_URL = process.env.KARIM_HEALTH_URL || 'https://127.0.0.1:5000/api/health';
const PROBE_URL = process.env.KARIM_PROBE_URL || 'https://127.0.0.1:5000/api/pos/products';
const KEYS = ['DB_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'API_KEY'];

require(path.join(REPO, 'node_modules', 'dotenv')).config({ path: ENV_FILE, override: false });
const { Client } = require(path.join(REPO, 'node_modules', 'pg'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(...a) { console.log(...a); }

function readEnvFile() { return fs.readFileSync(ENV_FILE, 'utf8'); }
function envValue(text, key) {
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}
function setEnvValue(text, key, value) {
    const re = new RegExp(`^${key}=.*$`, 'm');
    if (re.test(text)) { return text.replace(re, `${key}=${value}`); }
    return `${text.replace(/\s*$/, '')}\n${key}=${value}\n`;
}
function randomSecret(len = 64) { return crypto.randomBytes(len).toString('base64url'); }

function httpsGet(url, headers = {}) {
    return new Promise((resolve) => {
        const req = https.get(url, { headers, rejectUnauthorized: false, timeout: 15000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        req.on('error', (e) => resolve({ status: 0, body: e.message }));
        req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    });
}

function restartService() {
    execFileSync('powershell.exe', ['-NoProfile', '-Command',
        `Restart-Service -Name '${SERVICE}' -Force; Start-Sleep -Seconds 2;`], { stdio: 'pipe' });
}

async function waitHealthy(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const r = await httpsGet(HEALTH_URL);
        if (r.status === 200) { return true; }
        await sleep(2000);
    }
    return false;
}

(async () => {
    if (!process.argv.includes('--confirm')) {
        log('تدوير الأسرار يحتاج --confirm (يغيّر .env ويعيد تشغيل الخدمة).');
        log('قبل التنفيذ: تأكد من وجود نسخة احتياطية حديثة — npm run backup');
        process.exit(2);
    }
    if (!fs.existsSync(ENV_FILE)) { log('لا يوجد .env — لا يمكن التدوير.'); process.exit(1); }

    const originalText = readEnvFile();
    const oldValues = Object.fromEntries(KEYS.map((k) => [k, envValue(originalText, k)]));
    const newValues = {
        DB_PASSWORD: randomSecret(40),
        JWT_ACCESS_SECRET: randomSecret(64),
        JWT_REFRESH_SECRET: randomSecret(64),
        API_KEY: randomSecret(32),
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rollbackDir = path.join(REPO, 'database', 'backups', 'secret-rollback');
    fs.mkdirSync(rollbackDir, { recursive: true });
    const rollbackFile = path.join(rollbackDir, `.env.${stamp}.bak`);
    fs.writeFileSync(rollbackFile, originalText, 'utf8');
    log(`↺ نسخة التراجع: ${path.relative(REPO, rollbackFile)}`);

    const client = new Client({
        host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
        user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'karim_erp',
    });
    const role = process.env.DB_USER || 'postgres';
    let roleChanged = false;
    let envChanged = false;
    try {
        await client.connect();

        // ١) كلمة مرور الدور — قيمة مُربَطة (set_config)، لا نص SQL
        await client.query('SELECT set_config($1, $2, false)', ['karim.newpw', newValues.DB_PASSWORD]);
        await client.query(`DO $$ BEGIN EXECUTE format('ALTER ROLE %I PASSWORD %L', '${role}', current_setting('karim.newpw')); END $$;`);
        roleChanged = true;
        log('✓ كلمة مرور دور القاعدة مُدوَّرة');

        // ٢) .env — كتابة ذرّية
        let text = originalText;
        for (const k of KEYS) { text = setEnvValue(text, k, newValues[k]); }
        const tmp = `${ENV_FILE}.tmp`;
        fs.writeFileSync(tmp, text, 'utf8');
        fs.renameSync(tmp, ENV_FILE);
        envChanged = true;
        log('✓ .env مُحدَّث (كتابة ذرّية)');

        // ٣) إعادة تشغيل الخدمة
        restartService();
        log('⟳ أُعيد تشغيل الخدمة…');
        if (!await waitHealthy()) { throw new Error('الخدمة لم تستجب على /api/health بعد التدوير'); }
        log('✓ /api/health = 200');

        // ٤) تحقّق ثلاثي: السر الجديد يعمل، والقديم مرفوض، والبوابة تمر
        const admin = (await client.query(
            "SELECT id, username, name, role, dept_code, branch_id, must_change_password FROM users WHERE role='admin' AND active=true ORDER BY id LIMIT 1")).rows[0];
        if (!admin) { throw new Error('لا يوجد حساب admin نشط للتحقق'); }
        const jwt = require(path.join(REPO, 'node_modules', 'jsonwebtoken'));
        const claims = {
            sub: String(admin.id), role: admin.role, name: admin.name,
            dept_code: admin.dept_code || null, branch_id: admin.branch_id ?? null,
            sid: null, pwd_change: Boolean(admin.must_change_password),
        };
        const newToken = jwt.sign(claims, newValues.JWT_ACCESS_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
        const oldToken = jwt.sign(claims, oldValues.JWT_ACCESS_SECRET, { expiresIn: '5m', algorithm: 'HS256' });
        const withNew = await httpsGet(PROBE_URL, { Authorization: `Bearer ${newToken}`, 'x-api-key': newValues.API_KEY });
        const withOld = await httpsGet(PROBE_URL, { Authorization: `Bearer ${oldToken}`, 'x-api-key': newValues.API_KEY });
        if (withNew.status !== 200) { throw new Error(`الرمز بالسر الجديد مرفوض (${withNew.status}) — التراجع لازم`); }
        if (withOld.status === 200) { throw new Error('السر القديم ما زال صالحاً — التدوير لم يُطبَّق'); }
        log(`✓ السر الجديد يعمل (${withNew.status}) · السر القديم مرفوض (${withOld.status})`);

        // ٥) اتصال القاعدة بالكلمة الجديدة
        const probe = new Client({
            host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
            user: role, password: newValues.DB_PASSWORD, database: process.env.DB_NAME || 'karim_erp',
        });
        await probe.connect();
        await probe.query('SELECT 1');
        await probe.end();
        log('✓ اتصال القاعدة بالكلمة الجديدة يعمل');

        log('\nRESULT: ROTATION_OK');
        log('ملاحظة: المستخدمون سيحتاجون تسجيل دخول جديد (تغيّر JWT_ACCESS_SECRET وAPI_KEY).');
    } catch (err) {
        log(`\n✗ فشل التدوير: ${err.message}`);
        if (envChanged) { fs.copyFileSync(rollbackFile, ENV_FILE); log('↺ .env مستعاد من نسخة التراجع'); }
        if (roleChanged) {
            try {
                await client.query('SELECT set_config($1, $2, false)', ['karim.newpw', oldValues.DB_PASSWORD]);
                await client.query(`DO $$ BEGIN EXECUTE format('ALTER ROLE %I PASSWORD %L', '${role}', current_setting('karim.newpw')); END $$;`);
                log('↺ كلمة مرور دور القاعدة مستعادة');
            } catch (e2) { log(`⚠ فشل استعادة كلمة مرور الدور: ${e2.message}`); }
        }
        try { restartService(); await waitHealthy(30000); } catch (_) {}
        process.exitCode = 1;
    } finally {
        try { await client.end(); } catch (_) {}
    }
})();
