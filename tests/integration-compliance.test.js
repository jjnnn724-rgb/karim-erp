/**
 * integration-compliance.test.js — GATE 03: طبقة التكامل الحكومي
 * ────────────────────────────────────────────────────────────────────────────
 * (أ) دوال نقية: بوابة التحقق، مفتاح الإعادة، maker-checker، الأشكال العامة.
 * (ب) مسارات /api/integration على قاعدة karim_erp_test بعد تطبيق هجرة 145
 *     (تُطبَّق هنا مرة واحدة، وهي idempotent بحكم تصميمها).
 *
 * الصفوف المكتوبة هنا لا تُحذف: integration_events append-only بمشغّل يرفض
 * الحذف عمدًا (ADR-010)، وكل صف موسوم بـ gate03- ليُعرف مصدره.
 *
 * Run:
 *   NODE_ENV=test DB_NAME=karim_erp_test KARIM_TEST_DB_NAME=karim_erp_test \
 *   KARIM_TEST_DB_ISOLATED=1 npx jest tests/integration-compliance.test.js --runInBand --forceExit
 */

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-only-gate03-access-secret-not-for-production-32ch';
process.env.JWT_REFRESH_SECRET = 'test-only-gate03-refresh-secret-not-for-production-32ch';
process.env.VAULT_KEY = 'gate03-integration-test-vault-key-32chars!!';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { sign } = require('jsonwebtoken');

const { pool } = require('../backend/shared-pool');
const {
    canEnableProvider, retryIdempotencyKey, isSelfReview, clampLimit,
    publicProvider, publicOutboxRow, publicEventRow, KEY_NAME_RE,
} = require('../backend/integration/lib');
const { sodConflict, SOD_CONFLICTS } = require('../backend/permissions');
const router = require('../backend/integration/routes');

const RUN = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ─── (أ) وحدات نقية ─────────────────────────────────────────────────────────

describe('lib — بوابات التصنيف والإعادة', () => {
    test('التفعيل ممنوع إلا بتحقق موثّق', () => {
        expect(canEnableProvider({ verification: 'VERIFIED' })).toBe(true);
        expect(canEnableProvider({ verification: 'INFERRED' })).toBe(false);
        expect(canEnableProvider({ verification: 'UNVERIFIED' })).toBe(false);
        expect(canEnableProvider({ verification: 'BLOCKED' })).toBe(false);
        expect(canEnableProvider(null)).toBe(false);
    });

    test('مفتاح الإعادة ≤200 وحتمي وفريد حتى مع أساس طويل', () => {
        expect(retryIdempotencyKey('abc', 1)).toBe('abc:retry:1');
        const long = 'x'.repeat(240);
        const k1 = retryIdempotencyKey(long, 1);
        const k2 = retryIdempotencyKey(long, 2);
        expect(k1.length).toBeLessThanOrEqual(200);
        expect(k2.length).toBeLessThanOrEqual(200);
        expect(k1).not.toBe(k2);
        expect(k1.endsWith(':retry:1')).toBe(true);
        expect(retryIdempotencyKey(long, 1)).toBe(k1);
    });

    test('maker-checker: المدير لا يُحجب، والمنشئ يُحجب', () => {
        const row = { created_by: 7 };
        expect(isSelfReview({ id: 7, role: 'admin' }, row)).toBe(false);
        expect(isSelfReview({ id: 7, role: 'manager' }, row)).toBe(true);
        expect(isSelfReview({ id: 8, role: 'manager' }, row)).toBe(false);
        expect(isSelfReview({ id: 7, role: 'manager' }, { created_by: null })).toBe(false);
    });

    test('حدود القراءة وأسماء المفاتيح', () => {
        expect(clampLimit(undefined)).toBe(50);
        expect(clampLimit('0')).toBe(50);
        expect(clampLimit('999', 50, 200)).toBe(200);
        expect(clampLimit('12')).toBe(12);
        expect(KEY_NAME_RE.test('client_secret')).toBe(true);
        expect(KEY_NAME_RE.test('Client-Secret')).toBe(false);
        expect(KEY_NAME_RE.test('a')).toBe(false);
    });

    test('الأشكال العامة لا تحمل حمولة ولا اعتمادًا ولا نص خطأ', () => {
        const out = publicOutboxRow({ id: 1, payload: { secret: 'x' }, payload_sha256: sha256('a'),
            provider_code: 'zatca', event_type: 'e', aggregate_type: 'a', aggregate_id: '1',
            status: 'pending', attempts: 0, max_attempts: 8 });
        expect(out).not.toHaveProperty('payload');
        expect(JSON.stringify(out)).not.toContain('secret');

        const ev = publicEventRow({ id: 1, error_message: 'raw', response_excerpt: 'raw',
            provider_code: 'zatca', direction: 'outbound', outcome: 'success' });
        expect(ev).not.toHaveProperty('error_message');
        expect(ev).not.toHaveProperty('response_excerpt');

        const pv = publicProvider({ code: 'zatca', verification: 'VERIFIED', is_enabled: 1 });
        expect(pv.is_enabled).toBe(true);
        expect(pv).not.toHaveProperty('evidence_url');
    });

    test('فصل المهام: كل زوج متعارض مرفوض', () => {
        expect(SOD_CONFLICTS).toHaveLength(3);
        expect(sodConflict(['compliance.configure', 'compliance.submit']))
            .toEqual(['compliance.configure', 'compliance.submit']);
        expect(sodConflict(['compliance.submit', 'compliance.review'])).toBeTruthy();
        expect(sodConflict(['compliance.view', 'compliance.submit'])).toBeNull();
        expect(sodConflict([])).toBeNull();
    });

    test('مسارات الصلاحيات تفرض بند SoD قبل الكتابة', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'backend', 'permission-routes.js'), 'utf8');
        expect(src).toMatch(/sodConflict\(effective\)/);
        expect(src).toContain("'SOD_CONFLICT'");
        expect(src).toContain('409');
    });
});

// ─── (ب) المسارات على قاعدة الاختبار ───────────────────────────────────────

function startServer(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, () => resolve(server));
    });
}

function request(server, method, path, body, token) {
    return new Promise((resolve, reject) => {
        const addr = server.address();
        const req = http.request({
            host: '127.0.0.1',
            port: addr.port,
            path,
            method,
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch { /* نص خام */ }
                resolve({ status: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (body !== undefined) {req.write(JSON.stringify(body));}
        req.end();
    });
}

describe('/api/integration — المسارات', () => {
    let server;
    let adminToken;
    let nonAdmin = null;

    async function seedOutbox({ status = 'dead_letter', createdBy = null } = {}) {
        const tag = `${RUN}.${crypto.randomBytes(4).toString('hex')}`;
        const payload = { probe: tag };
        const r = await pool.query(
            `INSERT INTO integration_outbox
                (provider_code, event_type, aggregate_type, aggregate_id, idempotency_key,
                 payload, payload_sha256, status, attempts, max_attempts, last_error_code, created_by)
             VALUES ('gosi', 'gate03.probe', 'compliance_probe', $1, $2, $3::jsonb, $4,
                     $5, 3, 3, 'TEST_ERROR', $6)
             RETURNING id, idempotency_key`,
            [tag, `gate03-${tag}`, JSON.stringify(payload), sha256(JSON.stringify(payload)),
                status, createdBy]);
        return r.rows[0];
    }

    beforeAll(async () => {
        jest.setTimeout(60000);
        const exists = await pool.query("SELECT to_regclass('public.integration_providers') AS t");
        if (!exists.rows[0].t) {
            const sql = fs.readFileSync(
                path.join(__dirname, '..', 'database', 'migrations', '145_integration_infra.sql'), 'utf8');
            await pool.query(sql);
        }
        adminToken = sign({ sub: '1', role: 'admin', name: 'Gate03 Admin' },
            process.env.JWT_ACCESS_SECRET, { expiresIn: '1h', algorithm: 'HS256' });

        const pick = await pool.query(
            "SELECT id FROM users WHERE role <> 'admin' ORDER BY id LIMIT 1");
        nonAdmin = pick.rows[0]?.id ?? null;

        const app = express();
        app.use(express.json());
        app.use('/api/integration', router);
        server = await startServer(app);
    });

    afterAll(async () => {
        if (server) {await new Promise((resolve) => server.close(resolve));}
        if (nonAdmin) {
            await pool.query(
                "DELETE FROM user_permissions WHERE user_id = $1 AND perm_key = 'compliance.review' AND granted_by = 'gate03-test'",
                [nonAdmin]).catch(() => {});
        }
        await pool.query("DELETE FROM integration_credentials WHERE key_name LIKE 'gate03test%'").catch(() => {});
        await pool.end().catch(() => {});
    });

    test('بلا توكن → 401', async () => {
        const res = await request(server, 'GET', '/api/integration/health');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('UNAUTHORIZED');
    });

    test('health: تصنيف المزوّدين + عدّادات + no-store', async () => {
        const res = await request(server, 'GET', '/api/integration/health', undefined, adminToken);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        const codes = res.body.providers.map((p) => p.code);
        expect(codes).toEqual(expect.arrayContaining(['zatca', 'mudad', 'gosi', 'qiwa']));
        expect(res.body.providers.find((p) => p.code === 'mudad').verification).toBe('BLOCKED');
        expect(res.body.outbox.by_status).toHaveProperty('pending');
        expect(typeof res.body.outbox.oldest_pending_age_seconds).toBe('number');
        expect(res.body.generated_at).toBeTruthy();
        for (const p of res.body.providers) {expect(p).not.toHaveProperty('evidence_url');}
    });

    test('تفعيل مزوّد غير موثّق → 409 وبقاء الحالة', async () => {
        const res = await request(server, 'PUT', '/api/integration/providers/mudad/settings',
            { enabled: true }, adminToken);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('PROVIDER_NOT_VERIFIED');
        const db = await pool.query("SELECT is_enabled FROM integration_providers WHERE code = 'mudad'");
        expect(db.rows[0].is_enabled).toBe(false);
    });

    test('تعطيل مزوّد مسجّل → 200، ومزوّد مجهول → 404، ومدخل غير منطقي → 422', async () => {
        const off = await request(server, 'PUT', '/api/integration/providers/zatca/settings',
            { enabled: false }, adminToken);
        expect(off.status).toBe(200);
        expect(off.body.provider.is_enabled).toBe(false);

        const unknown = await request(server, 'PUT', '/api/integration/providers/nope/settings',
            { enabled: false }, adminToken);
        expect(unknown.status).toBe(404);

        const bad = await request(server, 'PUT', '/api/integration/providers/zatca/settings',
            { enabled: 'yes' }, adminToken);
        expect(bad.status).toBe(422);
    });

    test('الاعتماد: 503 بلا VAULT_KEY، ثم 201 بلا أي تسريب', async () => {
        const saved = process.env.VAULT_KEY;
        process.env.VAULT_KEY = '';
        const unavailable = await request(server, 'PUT',
            '/api/integration/credentials/gosi/gate03test.vault', { value: 'secret-value-123' }, adminToken);
        expect(unavailable.status).toBe(503);
        expect(unavailable.body.error).toBe('CREDENTIAL_VAULT_UNAVAILABLE');
        process.env.VAULT_KEY = saved;

        const ok = await request(server, 'PUT',
            '/api/integration/credentials/gosi/gate03test.vault', { value: 'secret-value-123' }, adminToken);
        expect(ok.status).toBe(201);
        expect(JSON.stringify(ok.body)).not.toContain('secret-value-123');
        expect(ok.body).not.toHaveProperty('ciphertext');

        const row = await pool.query(
            "SELECT ciphertext FROM integration_credentials WHERE key_name = 'gate03test.vault' AND revoked_at IS NULL");
        expect(row.rows).toHaveLength(1);
        expect(row.rows[0].ciphertext.startsWith('v1:')).toBe(true);
        expect(row.rows[0].ciphertext).not.toContain('secret-value-123');

        const rotate = await request(server, 'PUT',
            '/api/integration/credentials/gosi/gate03test.vault', { value: 'another-secret-456' }, adminToken);
        expect(rotate.status).toBe(201);
        expect(rotate.body.rotated).toBe(true);
    });

    test('outbox: لا payload في الرد، وتصفية حالة مجهولة → 422', async () => {
        await seedOutbox({ status: 'pending' });
        const res = await request(server, 'GET', '/api/integration/outbox?status=pending', undefined, adminToken);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.rows)).toBe(true);
        for (const r of res.body.rows) {
            expect(r).not.toHaveProperty('payload');
            expect(r.status).toBe('pending');
        }
        const bad = await request(server, 'GET', '/api/integration/outbox?status=bogus', undefined, adminToken);
        expect(bad.status).toBe(422);
    });

    test('إعادة صف ميت → صف جديد pending بمفتاح :retry: وحدث تدقيق', async () => {
        const src = await seedOutbox({ status: 'dead_letter' });
        const res = await request(server, 'POST', `/api/integration/outbox/${src.id}/retry`, undefined, adminToken);
        expect(res.status).toBe(201);
        expect(res.body.idempotency_key).toBe(`${src.idempotency_key}:retry:1`);

        const created = await pool.query(
            'SELECT status, attempts, payload_sha256 FROM integration_outbox WHERE id = $1', [res.body.id]);
        expect(created.rows[0].status).toBe('pending');
        expect(created.rows[0].attempts).toBe(0);
        const source = await pool.query(
            'SELECT payload_sha256 FROM integration_outbox WHERE id = $1', [src.id]);
        expect(created.rows[0].payload_sha256).toBe(source.rows[0].payload_sha256);

        const events = await request(server, 'GET',
            `/api/integration/events?outbox_id=${res.body.id}`, undefined, adminToken);
        expect(events.status).toBe(200);
        expect(events.body.rows[0].metadata.action).toBe('outbox.retry');
        expect(events.body.rows[0]).not.toHaveProperty('error_message');

        const again = await request(server, 'POST', `/api/integration/outbox/${src.id}/retry`, undefined, adminToken);
        expect(again.status).toBe(201);
        expect(again.body.idempotency_key).toBe(`${src.idempotency_key}:retry:2`);
    });

    test('إعادة صف غير قابل → 409؛ صف مجهول → 404', async () => {
        const pending = await seedOutbox({ status: 'pending' });
        const res = await request(server, 'POST', `/api/integration/outbox/${pending.id}/retry`, undefined, adminToken);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('OUTBOX_NOT_RETRYABLE');

        const missing = await request(server, 'POST', '/api/integration/outbox/999999999/retry', undefined, adminToken);
        expect(missing.status).toBe(404);
    });

    test('مراجعة: abandon يلغي الصف بسبب مطلوب، وretry ينشئ بديلًا', async () => {
        const a = await seedOutbox({ status: 'dead_letter' });
        const noReason = await request(server, 'POST', `/api/integration/outbox/${a.id}/review`,
            { decision: 'abandon', reason: 'x' }, adminToken);
        expect(noReason.status).toBe(422);

        const abandoned = await request(server, 'POST', `/api/integration/outbox/${a.id}/review`,
            { decision: 'abandon', reason: 'خطأ دائم مؤكد' }, adminToken);
        expect(abandoned.status).toBe(200);
        expect(abandoned.body.status).toBe('cancelled');
        const db = await pool.query('SELECT status FROM integration_outbox WHERE id = $1', [a.id]);
        expect(db.rows[0].status).toBe('cancelled');

        const b = await seedOutbox({ status: 'dead_letter' });
        const retried = await request(server, 'POST', `/api/integration/outbox/${b.id}/review`,
            { decision: 'retry', reason: 'سبب عابر تحقق' }, adminToken);
        expect(retried.status).toBe(201);
        expect(retried.body.idempotency_key).toContain(':retry:');
    });

    test('maker-checker: منشئ الصف لا يعتمد صفّه', async () => {
        if (!nonAdmin) {
            console.warn('[gate03] no non-admin user in test DB — self-review path skipped');
            return;
        }
        await pool.query(
            `INSERT INTO user_permissions (user_id, perm_key, granted_by)
             VALUES ($1, 'compliance.review', 'gate03-test')
             ON CONFLICT (user_id, perm_key) DO NOTHING`, [nonAdmin]);
        const { invalidateUser } = require('../backend/permissions');
        invalidateUser(nonAdmin);

        const reviewerToken = sign({ sub: String(nonAdmin), role: 'manager', name: 'Gate03 Reviewer' },
            process.env.JWT_ACCESS_SECRET, { expiresIn: '1h', algorithm: 'HS256' });
        const own = await seedOutbox({ status: 'dead_letter', createdBy: nonAdmin });
        const res = await request(server, 'POST', `/api/integration/outbox/${own.id}/review`,
            { decision: 'abandon', reason: 'محاولة اعتماد ذاتي' }, reviewerToken);
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('SELF_REVIEW_FORBIDDEN');
    });
});
