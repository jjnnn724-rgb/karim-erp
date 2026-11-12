'use strict';
/**
 * v3-accounting-read.test.js — مسارات القراءة الثلاثة لـV3 على قاعدة معزولة.
 * ────────────────────────────────────────────────────────────────────────────
 * `/api/v3/accounting/chart|journal|journal/:id` — عقد V3 النصي المعلن في
 * `v3/packages/shared/src/v3-read.ts`. دوال التحقق أدناه مرآة حرفية لذلك
 * العقد (strictObject: مفاتيح مضبوطة لا زيادة ولا نقصان)؛ التحقق النهائي
 * بالمخطط الحقيقي يجري في المتصفح الحي بعد النشر.
 *
 * التغطية: المصادقة والأدوار، تطبيع limit بصيغة القديم، شكل الصفوف، الإبطال
 * عبر `journal-void` (المسار المرخّص)، وحالة قاعدة بلا أعمدة 137 — وهي حالة
 * الإنتاج اليوم — عبر جدول مؤقت يحجب الاسم داخل جلسة واحدة فقط.
 *
 * صفوف الاختبار موسومة v3read_test وتُحذف في afterAll من بوابة
 * `coa.allow_hard_delete` المرخّصة (سياسة 136: لا حذف صلب لمرحّل بلا بوابة).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-only-v3read-access-secret-not-for-production-32chars';
process.env.JWT_REFRESH_SECRET = 'test-only-v3read-refresh-secret-not-for-production-32chars';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { sign } = require('jsonwebtoken');

const { pool } = require('../backend/shared-pool');
const { createV3AccountingReadRouter, READ_ROLES } = require('../backend/v3-accounting-read');
const { voidJournalById } = require('../backend/journal-void');

// ─── مرآة عقد v3-read.ts ─────────────────────────────────────────────────────
const MONEY_RE = /^-?\d{1,14}(?:\.\d{1,2})?$/;
const ID_RE = /^\d{1,19}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ENTRY_NO_RE = /^JE-\d{8}-\d{4,}$/;
const SOURCE_RE = /^[a-z][a-z0-9_]{0,49}$/;
const TYPES = ['asset', 'liability', 'equity', 'revenue', 'cogs', 'expense'];
const CHART_KEYS = ['code', 'is_active', 'is_postable', 'name_ar', 'name_en', 'parent_code', 'type'];
const LINE_KEYS = ['account_code', 'credit', 'debit', 'memo'];
const ENTRY_KEYS = [
    'approved_at', 'approved_by', 'branch_id', 'created_at', 'created_by', 'created_by_name',
    'date', 'entry_no', 'id', 'lines', 'memo', 'source_id', 'source_type', 'status',
    'void_reason', 'voided_at', 'voided_by', 'voided_by_name',
];

const keysOf = (row) => Object.keys(row).sort();
const nullable = (v, re) => v === null || (typeof v === 'string' && re.test(v));

function expectLine(line) {
    expect(keysOf(line)).toEqual(LINE_KEYS);
    expect(typeof line.account_code).toBe('string');
    expect(line.account_code.length).toBeGreaterThanOrEqual(1);
    expect(line.account_code.length).toBeLessThanOrEqual(20);
    expect(line.debit).toMatch(MONEY_RE);
    expect(line.credit).toMatch(MONEY_RE);
    expect(line.memo === null || typeof line.memo === 'string').toBe(true);
}

function expectEntry(row) {
    expect(keysOf(row)).toEqual(ENTRY_KEYS);
    expect(row.id).toMatch(ID_RE);
    expect(row.entry_no).toMatch(ENTRY_NO_RE);
    expect(row.date).toMatch(DATE_RE);
    expect(row.memo === null || typeof row.memo === 'string').toBe(true);
    expect(row.source_type).toMatch(SOURCE_RE);
    expect(row.source_id === null || typeof row.source_id === 'string').toBe(true);
    expect(['draft', 'posted', 'void']).toContain(row.status);
    expect(nullable(row.created_by, ID_RE)).toBe(true);
    expect(row.created_at).toMatch(ISO_RE);
    expect(nullable(row.approved_by, ID_RE)).toBe(true);
    expect(nullable(row.approved_at, ISO_RE)).toBe(true);
    expect(row.branch_id === null || (Number.isInteger(row.branch_id) && row.branch_id > 0)).toBe(true);
    expect(row.created_by_name === null || typeof row.created_by_name === 'string').toBe(true);
    expect(nullable(row.voided_at, ISO_RE)).toBe(true);
    expect(nullable(row.voided_by, ID_RE)).toBe(true);
    expect(row.voided_by_name === null || typeof row.voided_by_name === 'string').toBe(true);
    expect(row.void_reason === null || typeof row.void_reason === 'string').toBe(true);
    expect(Array.isArray(row.lines)).toBe(true);
    row.lines.forEach(expectLine);
}

function expectChartRow(row) {
    expect(keysOf(row)).toEqual(CHART_KEYS);
    expect(typeof row.code).toBe('string');
    expect(row.code.length).toBeGreaterThanOrEqual(1);
    expect(row.code.length).toBeLessThanOrEqual(20);
    expect(typeof row.name_ar).toBe('string');
    expect(row.name_ar.length).toBeGreaterThanOrEqual(1);
    expect(row.name_ar.length).toBeLessThanOrEqual(255);
    expect(row.name_en === null || (typeof row.name_en === 'string' && row.name_en.length <= 255)).toBe(true);
    expect(TYPES).toContain(row.type);
    expect(row.parent_code === null || (typeof row.parent_code === 'string' && row.parent_code.length >= 1 && row.parent_code.length <= 20)).toBe(true);
    expect(typeof row.is_postable).toBe('boolean');
    expect(typeof row.is_active).toBe('boolean');
}

// ─── أدوات HTTP (نمط integration-wps) ────────────────────────────────────────
function startServer(app) {
    return new Promise((resolve) => {const s = app.listen(0, '127.0.0.1', () => resolve(s));});
}

function request(server, method, urlPath, token) {
    return new Promise((resolve, reject) => {
        const { port } = server.address();
        const req = http.request({
            host: '127.0.0.1', port, path: urlPath, method,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch { /* نص خام */ }
                resolve({ status: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

const tokenFor = (role) => sign({ sub: '1', role, name: 'V3Read Test' },
    process.env.JWT_ACCESS_SECRET, { expiresIn: '1h', algorithm: 'HS256' });

// ─── المسارات على قاعدة الاختبار ─────────────────────────────────────────────
const TAG = 'v3read_test';
const ENTRY_A = 990000000000001;
const ENTRY_B = 990000000000002;
const LINE_IDS = [990000000000101, 990000000000102];

/** حذف موسوم عبر بوابة 136 المرخّصة — نمط teardown في journal-void. */
async function cleanupTagged() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL coa.allow_hard_delete = 'on'");
        await client.query('DELETE FROM journal_lines WHERE entry_id = ANY($1::bigint[])', [[ENTRY_A, ENTRY_B]]);
        await client.query('DELETE FROM journal_entries WHERE id = ANY($1::bigint[]) AND source_type = $2', [[ENTRY_A, ENTRY_B], TAG]);
        await client.query('DELETE FROM journal_ledger_audit WHERE entry_id = ANY($1::bigint[])', [[ENTRY_A, ENTRY_B]]);
        await client.query('COMMIT');
    } finally {
        client.release();
    }
}

describe('/api/v3/accounting — قراءة V3', () => {
    let server;
    let adminToken;

    beforeAll(async () => {
        jest.setTimeout(90000);
        // أعمدة 137 موجودة في قاعدة الاختبار؛ لو غابت تُطبَّق additions فقط.
        const col = await pool.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name='journal_entries' AND column_name='voided_at'");
        if (!col.rowCount) {
            await pool.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', '137_journal_void_audit.sql'), 'utf8'));
        }
        // أثر تشغيل سابق مقطوع يُزال أولًا — الحالة الابتدائية حتمية.
        await cleanupTagged();

        // 095 يفحص التوازن عند الالتزام: مسودة ← سطور ← ترحيل، في معاملة واحدة.
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO journal_entries (id, entry_no, date, memo, source_type, source_id, status, created_by, branch_id)
                 VALUES ($1, 'JE-19900102-9901', '1990-01-02', 'قيد اختبار v3', $3, 'v3read-test-1', 'draft', 1, 1),
                        ($2, 'JE-19900103-9902', '1990-01-03', 'بلا سطور', $3, 'v3read-test-2', 'draft', 1, 1)`,
                [ENTRY_A, ENTRY_B, TAG]);
            await client.query(
                `INSERT INTO journal_lines (id, entry_id, account_code, debit, credit, memo)
                 VALUES ($1, $3, '1000', '100.00', '0.00', 'مدين اختبار'),
                        ($2, $3, '1001', '0.00', '100.00', 'دائن اختبار')`,
                [LINE_IDS[0], LINE_IDS[1], ENTRY_A]);
            await client.query("UPDATE journal_entries SET status = 'posted' WHERE id = $1", [ENTRY_A]);
            await client.query('COMMIT');
        } finally {
            client.release();
        }

        adminToken = tokenFor('admin');
        const app = express();
        app.use(express.json());
        app.use('/api/v3/accounting', createV3AccountingReadRouter());
        server = await startServer(app);
    });

    afterAll(async () => {
        if (server) {await new Promise((resolve) => server.close(resolve));}
        await cleanupTagged();
        await pool.end().catch(() => {});
    });

    test('بلا token ⇒ 401 على المسارات الثلاثة', async () => {
        for (const p of ['/api/v3/accounting/chart', '/api/v3/accounting/journal', `/api/v3/accounting/journal/${ENTRY_A}`]) {
            const res = await request(server, 'GET', p);
            expect(res.status).toBe(401);
        }
    });

    test('دور خارج قائمة القراءة ⇒ 403', async () => {
        const res = await request(server, 'GET', '/api/v3/accounting/chart', tokenFor('cashier'));
        expect(res.status).toBe(403);
    });

    test('أدوار القراءة الأربعة كلها تمر', async () => {
        expect(READ_ROLES).toEqual(['admin', 'accountant', 'manager', 'auditor']);
        for (const role of READ_ROLES) {
            const res = await request(server, 'GET', '/api/v3/accounting/chart', tokenFor(role));
            expect(res.status).toBe(200);
        }
    });

    test('/chart — مصفوفة بعقد V3 الصارم مرتبة بالكود', async () => {
        const res = await request(server, 'GET', '/api/v3/accounting/chart', adminToken);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        res.body.forEach(expectChartRow);
        const codes = res.body.map((r) => r.code);
        expect(codes).toEqual([...codes].sort());
    });

    test('/journal — الافتراضي 50 صفًا بعقد V3، الأحدث أولًا', async () => {
        const res = await request(server, 'GET', '/api/v3/accounting/journal', adminToken);
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(50);
        res.body.forEach(expectEntry);
        for (let i = 1; i < res.body.length; i++) {
            const a = res.body[i - 1];
            const b = res.body[i];
            expect(a.date >= b.date).toBe(true);
            if (a.date === b.date) {expect(BigInt(a.id) >= BigInt(b.id)).toBe(true);}
        }
    });

    test('limit بصيغة القديم: 1→1، 0→50 (الصفر falsy)، abc→50، 9999→200، -5→1', async () => {
        const cases = [['1', 1], ['0', 50], ['abc', 50], ['9999', 200], ['-5', 1]];
        for (const [raw, expected] of cases) {
            const res = await request(server, 'GET', `/api/v3/accounting/journal?limit=${raw}`, adminToken);
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(expected);
        }
    });

    test('/journal/:id — نفس شكل صفوف القائمة، والسطور بترتيب id', async () => {
        const res = await request(server, 'GET', `/api/v3/accounting/journal/${ENTRY_A}`, adminToken);
        expect(res.status).toBe(200);
        expectEntry(res.body);
        expect(res.body.id).toBe(String(ENTRY_A));
        expect(res.body.created_by).toBe('1');
        expect(res.body.created_by_name).toBe('admin');
        expect(res.body.lines).toHaveLength(2);
        expect(res.body.lines[0].debit).toBe('100.00');
        expect(res.body.lines[1].credit).toBe('100.00');
    });

    test('/journal/:id — قيد بلا سطور يعيد lines فارغة', async () => {
        const res = await request(server, 'GET', `/api/v3/accounting/journal/${ENTRY_B}`, adminToken);
        expect(res.status).toBe(200);
        expectEntry(res.body);
        expect(res.body.lines).toEqual([]);
    });

    test('معرّف غير صالح ⇒ 422، ومعرّف غير موجود ⇒ 404', async () => {
        for (const bad of ['abc', '1.5', '-1', '12345678901234567890']) {
            const res = await request(server, 'GET', `/api/v3/accounting/journal/${bad}`, adminToken);
            expect(res.status).toBe(422);
            expect(res.body.error).toBe('LEDGER_ID_INVALID');
        }
        const missing = await request(server, 'GET', '/api/v3/accounting/journal/990000000000999', adminToken);
        expect(missing.status).toBe(404);
        expect(missing.body.error).toBe('LEDGER_ENTRY_NOT_FOUND');
    });

    test('لا كتابة هنا: POST ⇒ 404', async () => {
        const res = await request(server, 'POST', '/api/v3/accounting/journal', adminToken);
        expect(res.status).toBe(404);
    });

    test('الإبطال عبر journal-void يظهر في القراءة بحقول voided_*', async () => {
        const out = await voidJournalById(pool, {
            entryId: ENTRY_A, reason: 'اختبار قراءة v3', actorUserId: 1, actor: 'v3read-test',
        });
        expect(out.voided).toBe(true);
        const res = await request(server, 'GET', `/api/v3/accounting/journal/${ENTRY_A}`, adminToken);
        expect(res.status).toBe(200);
        expectEntry(res.body);
        expect(res.body.status).toBe('void');
        expect(res.body.voided_at).toMatch(ISO_RE);
        expect(res.body.voided_by).toBe('1');
        expect(res.body.voided_by_name).toBe('v3read-test');
        expect(res.body.void_reason).toBe('اختبار قراءة v3');
    });

    test('قاعدة بلا أعمدة 137 (حالة الإنتاج): الحقول الأربعة NULL بلا خطأ', async () => {
        const client = await pool.connect();
        let shadowServer;
        try {
            await client.query('BEGIN');
            await client.query('DROP TABLE IF EXISTS pg_temp.journal_entries');
            // جدول مؤقت يحجب public.journal_entries داخل هذه الجلسة فقط،
            // بلا أعمدة الإبطال — نسخة مصغرة من مخطط الإنتاج الحالي.
            await client.query(`
                CREATE TEMPORARY TABLE journal_entries ON COMMIT DROP AS
                SELECT id, entry_no, date, memo, source_type, source_id, status,
                       created_by, created_at, approved_by, approved_at, branch_id
                  FROM public.journal_entries
                 WHERE source_type = $1`, [TAG]);
            const app = express();
            app.use(express.json());
            app.use('/api/v3/accounting', createV3AccountingReadRouter(client));
            shadowServer = await startServer(app);

            const res = await request(shadowServer, 'GET', `/api/v3/accounting/journal/${ENTRY_A}`, adminToken);
            expect(res.status).toBe(200);
            expectEntry(res.body);
            expect(res.body.status).toBe('void');
            expect(res.body.voided_at).toBeNull();
            expect(res.body.voided_by).toBeNull();
            expect(res.body.voided_by_name).toBeNull();
            expect(res.body.void_reason).toBeNull();
            expect(res.body.lines).toHaveLength(2);

            const list = await request(shadowServer, 'GET', '/api/v3/accounting/journal', adminToken);
            expect(list.status).toBe(200);
            expect(list.body).toHaveLength(2);
            list.body.forEach(expectEntry);
        } finally {
            if (shadowServer) {await new Promise((resolve) => shadowServer.close(resolve));}
            await client.query('COMMIT').catch(() => {});
            client.release();
        }
    });
});