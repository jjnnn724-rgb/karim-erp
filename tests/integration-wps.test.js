/**
 * integration-wps.test.js — GATE 06: مدد (WPS) والتأمينات وقوى
 * ────────────────────────────────────────────────────────────────────────────
 * (أ) دوال نقية: IBAN/mod-97، التقييم، الكشف، النسب.
 * (ب) مسارات /api/integration/wps|gosi|qiwa على karim_erp_test بعد 145 و147.
 *
 * لا نداء خارجي في أي اختبار: كل شيء محلي وقاعدة الاختبار المعزولة.
 * الصفوف المكتوبة موسومة gate06- وتُحذف في afterAll (عدا سجل التدقيق
 * append-only المقصود).
 */

process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-only-gate06-access-secret-not-for-production-32chars';
process.env.JWT_REFRESH_SECRET = 'test-only-gate06-refresh-secret-not-for-production-32chars';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const { sign } = require('jsonwebtoken');

const { pool } = require('../backend/shared-pool');
const wps = require('../backend/integration/wps');
const router = require('../backend/integration/wps-routes');

const sha256 = s => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const VALID_IBAN = 'SA4420000001234567891234';
const VALID_IBAN_2 = 'SA0380000000608010167519';
const MONTH = '2099-01';

describe('wps — تحقق IBAN السعودي', () => {
  test('يقبل IBAN صحيحًا ويتجاهل المسافات والشرطات', () => {
    expect(wps.isValidSaudIban(VALID_IBAN)).toBe(true);
    expect(wps.isValidSaudIban('SA44 2000 0001 2345 6789 1234')).toBe(true);
    expect(wps.isValidSaudIban('sa4420000001234567891234')).toBe(true);
    expect(wps.normalizeIban('sa44-2000-0001')).toBe('SA4420000001');
  });

  test('يرفض مجموع تحقق خاطئًا أو بادئة غير سعودية', () => {
    expect(wps.isValidSaudIban('SA4420000001234567891235')).toBe(false);
    expect(wps.isValidSaudIban('AE070331234567890123456')).toBe(false);
    expect(wps.isValidSaudIban('SA123')).toBe(false);
    expect(wps.isValidSaudIban(null)).toBe(false);
  });

  test('القناع يخفي الوسط ولا يكشف IBAN كاملًا', () => {
    const masked = wps.maskIban(VALID_IBAN);
    expect(masked).toContain('SA44');
    expect(masked).toContain('1234');
    expect(masked).not.toContain('00000012345');
    expect(wps.maskIban(null)).toBeNull();
  });

  test('الهوية: 10 أرقام تبدأ بـ1 أو 2', () => {
    expect(wps.isValidIdNumber('1234567890')).toBe(true);
    expect(wps.isValidIdNumber('2345678901')).toBe(true);
    expect(wps.isValidIdNumber('3234567890')).toBe(false);
    expect(wps.isValidIdNumber('123456789')).toBe(false);
  });

  test('حجب رقم الهوية افتراضيًا', () => {
    expect(wps.maskIdNumber('1234567890')).toBe('******7890');
    expect(wps.maskIdNumber('1234')).toBe('****');
    expect(wps.maskIdNumber(null)).toBeNull();
  });
});

describe('wps — الجاهزية والكشف', () => {
  const employees = [
    { id: 1, name: 'أ', iqama: '1234567890', salary: 5000, iban: VALID_IBAN, nationality: 'SA' },
    { id: 2, name: 'ب', iqama: null, salary: 0, iban: null, nationality: null },
  ];
  const payroll = new Map([
    ['1', { basic: 5000, allowances: 0, deductions: 0, net: 5000 }],
    ['2', { basic: 0, allowances: 0, deductions: 0, net: 0 }],
  ]);

  test('يعدّ النواقص ويمنع الكشف', () => {
    const r = wps.evaluateWpsReadiness({
      employees,
      payrollById: payroll,
      month: '2026-10',
      posted: false,
      employerId: null,
    });
    expect(r.summary.employees).toBe(2);
    expect(r.summary.ready).toBe(1);
    expect(r.summary.missing_iban).toBe(1);
    expect(r.summary.missing_id).toBe(1);
    expect(r.summary.missing_salary).toBe(1);
    expect(r.summary.unknown_nationality).toBe(1);
    expect(r.blockers).toEqual(
      expect.arrayContaining([
        'EMPLOYER_ID_MISSING',
        'PAYROLL_MONTH_NOT_POSTED',
        'EMPLOYEES_MISSING_ID',
        'EMPLOYEES_MISSING_IBAN',
      ])
    );
    expect(r.export_ready).toBe(false);
    expect(JSON.stringify(r.rows)).not.toContain(VALID_IBAN);
    expect(JSON.stringify(r.rows)).not.toContain('1234567890');
    expect(r.rows[0].id_number_masked).toBe('******7890');
  });

  test('جاهز فقط عند اكتمال كل شيء', () => {
    const perfect = [{ id: 1, name: 'أ', iqama: '1234567890', salary: 5000, iban: VALID_IBAN, nationality: 'SA' }];
    const lines = new Map([['1', { basic: 5000, allowances: 0, deductions: 0, net: 5000 }]]);
    const r = wps.evaluateWpsReadiness({
      employees: perfect,
      payrollById: lines,
      month: '2026-10',
      posted: true,
      employerId: '1010000000',
    });
    expect(r.export_ready).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  test('الكشف: BOM + ترويسة + منع حقن الصيغ + بصمة مطابقة', () => {
    const { csv, sha256: hash } = wps.buildWpsCsv({
      month: MONTH,
      employerId: '1010000000',
      rows: [
        {
          id_number: '1234567890',
          name: '=HYPERLINK("x")',
          nationality: 'SA',
          iban: VALID_IBAN,
          basic: 5000,
          allowances: 100,
          deductions: 50,
          net: 5050,
        },
      ],
    });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('رقم الهوية/الإقامة');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('5050.00');
    expect(hash).toBe(sha256(csv));
    expect(hash).toHaveLength(64);
  });
});

describe('wps — نسب التأمينات', () => {
  test('المجموعات صريحة وغير موثّقة ولا افتراض تلقائي', () => {
    expect(wps.resolveRateSet(undefined)).toBeNull();
    expect(wps.resolveRateSet('bogus')).toBeNull();
    expect(wps.rateSetList().length).toBeGreaterThanOrEqual(2);
    for (const set of wps.rateSetList()) {
      expect(set.verified).toBe(false);
    }
  });

  test('حساب عرض: سعودي/وافد/مجهول', () => {
    const set = wps.resolveRateSet('legacy_before_2024_07');
    expect(wps.gosiAmounts(5000, 'saudi', set)).toEqual({
      employee: 487.5,
      employer: 587.5,
      total: 1075,
      employee_bp: 975,
      employer_bp: 1175,
    });
    expect(wps.gosiAmounts(5000, 'expat', set)).toEqual({
      employee: 0,
      employer: 100,
      total: 100,
      employee_bp: 0,
      employer_bp: 200,
    });
    expect(wps.gosiAmounts(5000, 'unknown', set)).toBeNull();
    expect(wps.gosiAmounts(-1, 'saudi', set)).toBeNull();
  });

  test('التصنيف من الجنسية بلا تخمين', () => {
    expect(wps.nationalityCategory('SA')).toBe('saudi');
    expect(wps.nationalityCategory('sa')).toBe('saudi');
    expect(wps.nationalityCategory('EG')).toBe('expat');
    expect(wps.nationalityCategory(null)).toBe('unknown');
    expect(wps.nationalityCategory('S')).toBe('unknown');
  });

  test('المتطلبات تحمل الحظر الصريح لمدد', () => {
    const blocked = wps.WPS_REQUIREMENTS.filter(r => r.status === 'BLOCKED').map(r => r.id);
    expect(blocked).toEqual(expect.arrayContaining(['mudad_registration', 'upload_automation']));
  });
});

// ─── المسارات على قاعدة الاختبار ───────────────────────────────────────────

function startServer(app) {
  return new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
}

function request(server, method, path, body, token) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      res => {
        let data = '';
        res.on('data', c => {
          data += c;
        });
        res.on('end', () => {
          let parsed = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            /* نص خام */
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('/api/integration — WPS/GOSI/QIWA', () => {
  const EMP_A = 990000001;
  const EMP_B = 990000002;
  let server;
  let adminToken;
  let cashierToken;
  let originalCrn;
  let crnTouched = false;

  beforeAll(async () => {
    jest.setTimeout(90000);
    for (const [file, table] of [
      ['145_integration_infra.sql', 'integration_providers'],
      ['147_employee_wps_bank.sql', 'employees'],
    ]) {
      if (table === 'employees') {
        const col = await pool.query(
          "SELECT 1 FROM information_schema.columns WHERE table_name='employees' AND column_name='iban'"
        );
        if (!col.rowCount) {
          await pool.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', file), 'utf8'));
        }
      } else {
        const exists = await pool.query(`SELECT to_regclass('public.${table}') AS t`);
        if (!exists.rows[0].t) {
          await pool.query(fs.readFileSync(path.join(__dirname, '..', 'database', 'migrations', file), 'utf8'));
        }
      }
    }
    originalCrn = (await pool.query('SELECT crn FROM zatca_settings WHERE id = 1')).rows[0]?.crn ?? null;

    await pool.query(
      `INSERT INTO employees (id, name, "employeeId", salary, status, "iqamaNumber", iban, nationality, gosi_number)
             VALUES ($1, 'gate06-alpha', 'gate06-alpha', 5000, 'active', '1234567890', NULL, NULL, NULL),
                    ($2, 'gate06-beta', 'gate06-beta', 0, 'active', NULL, NULL, NULL, NULL)
             ON CONFLICT (id) DO NOTHING`,
      [EMP_A, EMP_B]
    );

    adminToken = sign({ sub: '1', role: 'admin', name: 'Gate06 Admin' }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '1h',
      algorithm: 'HS256',
    });
    cashierToken = sign({ sub: '999', role: 'cashier', name: 'Gate06 Cashier' }, process.env.JWT_ACCESS_SECRET, {
      expiresIn: '1h',
      algorithm: 'HS256',
    });

    const app = express();
    app.use(express.json());
    app.use('/api/integration', router);
    server = await startServer(app);
  });

  afterAll(async () => {
    if (server) {
      await new Promise(resolve => server.close(resolve));
    }
    await pool.query('DELETE FROM payroll WHERE "employeeId" = ANY($1::bigint[])', [[EMP_A, EMP_B]]).catch(() => {});
    await pool.query('DELETE FROM payroll_runs WHERE month = $1', [MONTH]).catch(() => {});
    await pool.query('DELETE FROM employees WHERE id = ANY($1::bigint[])', [[EMP_A, EMP_B]]).catch(() => {});
    if (crnTouched) {
      await pool.query('UPDATE zatca_settings SET crn = $1 WHERE id = 1', [originalCrn]).catch(() => {});
    }
    await pool.end().catch(() => {});
  });

  test('يتطلب مصادقة', async () => {
    const res = await request(server, 'GET', '/api/integration/wps/requirements');
    expect(res.status).toBe(401);
  });

  test('دور بلا صلاحية امتثال يُرفض 403', async () => {
    const res = await request(server, 'GET', '/api/integration/wps/readiness', undefined, cashierToken);
    expect(res.status).toBe(403);
  });

  test('المتطلبات تعرض حظر مدد ونواقص البيانات الفعلية', async () => {
    const res = await request(server, 'GET', `/api/integration/wps/requirements?month=${MONTH}`, undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.provider).toMatchObject({ code: 'mudad', verification: 'BLOCKED', direct_integration: false });
    const byId = Object.fromEntries(res.body.requirements.map(r => [r.id, r]));
    expect(byId.upload_automation.status).toBe('BLOCKED');
    expect(byId.employee_iban.status).toBe('TODO');
    expect(byId.employee_iban.detail).toMatch(/من/);
  });

  test('الجاهزية لا تسرّب IBAN كاملًا', async () => {
    const res = await request(server, 'GET', `/api/integration/wps/readiness?month=${MONTH}`, undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.export_ready).toBe(false);
    expect(res.body.blockers).toEqual(expect.arrayContaining(['PAYROLL_MONTH_NOT_POSTED', 'EMPLOYER_ID_MISSING']));
    expect(JSON.stringify(res.body)).not.toContain(VALID_IBAN);
    expect(JSON.stringify(res.body)).not.toContain('1234567890');
    const rowA = res.body.employees.find(e => e.employee_id === EMP_A);
    expect(rowA.id_number_masked).toBe('******7890');
    expect(rowA).not.toHaveProperty('id_number');
    expect(rowA.iban_masked).toBeNull();
    expect(rowA.issues).toContain('IBAN_MISSING');
  });

  test('كتابة بيانات مصرفية: تحقق ثم قناع', async () => {
    const bad = await request(
      server,
      'PUT',
      `/api/integration/wps/employees/${EMP_A}/bank`,
      { iban: 'SA000' },
      adminToken
    );
    expect(bad.status).toBe(422);
    expect(bad.body.error).toBe('INVALID_IBAN');

    const badNat = await request(
      server,
      'PUT',
      `/api/integration/wps/employees/${EMP_A}/bank`,
      { nationality: 'Saudi' },
      adminToken
    );
    expect(badNat.status).toBe(422);

    const ok = await request(
      server,
      'PUT',
      `/api/integration/wps/employees/${EMP_A}/bank`,
      { iban: 'sa44 2000 0001 2345 6789 1234', nationality: 'sa', gosiNumber: '1234567890' },
      adminToken
    );
    expect(ok.status).toBe(200);
    expect(ok.body.iban_masked).toBe(wps.maskIban(VALID_IBAN));
    expect(JSON.stringify(ok.body)).not.toContain(VALID_IBAN);

    const db = await pool.query('SELECT iban, nationality FROM employees WHERE id = $1', [EMP_A]);
    expect(db.rows[0]).toEqual({ iban: VALID_IBAN, nationality: 'SA' });
  });

  test('الكشف مرفوض قبل إقفال المسير', async () => {
    const res = await request(server, 'POST', '/api/integration/wps/export', { month: MONTH }, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('WPS_NOT_READY');
    expect(res.body.blockers).toContain('PAYROLL_MONTH_NOT_POSTED');
  });

  test('نسب التأمينات تُطلب صراحة', async () => {
    const noSet = await request(server, 'GET', `/api/integration/gosi/preview?month=${MONTH}`, undefined, adminToken);
    expect(noSet.status).toBe(422);
    expect(noSet.body.error).toBe('RATE_SET_REQUIRED');
    expect(Array.isArray(noSet.body.available)).toBe(true);

    const rates = await request(server, 'GET', '/api/integration/gosi/rates', undefined, adminToken);
    expect(rates.status).toBe(200);
    expect(rates.body.verified).toBe(false);
    expect(rates.body.rates.every(r => r.verified === false)).toBe(true);
  });

  test('عرض التأمينات تقديري بلا قيد ولا كشف IBAN', async () => {
    const res = await request(
      server,
      'GET',
      `/api/integration/gosi/preview?month=${MONTH}&rate_set=legacy_before_2024_07`,
      undefined,
      adminToken
    );
    expect(res.status).toBe(200);
    expect(res.body.estimate).toBe(true);
    expect(res.body.basis).toBe('employee_salary_estimate');
    const line = res.body.lines.find(l => l.employee_id === EMP_A);
    expect(line).toMatchObject({ category: 'saudi', wage: 5000, employee: 487.5, employer: 587.5 });
    expect(res.body.unclassified.some(u => u.employee_id === EMP_B && u.reason === 'NATIONALITY_UNKNOWN')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(VALID_IBAN);
  });

  test('قوى: فحص محلي فقط', async () => {
    const res = await request(server, 'GET', '/api/integration/qiwa/readiness', undefined, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.provider).toMatchObject({ code: 'qiwa', verification: 'UNVERIFIED', direct_integration: false });
    expect(Array.isArray(res.body.checks)).toBe(true);
    expect(res.body.note).toContain('لا ربط API');
  });

  test('المسار الكامل: إقفال مسير + بيانات مكتملة → كشف ببصمة', async () => {
    await pool.query(
      `UPDATE employees SET iban = $2, nationality = 'SA', "iqamaNumber" = '2345678901', salary = 4000
              WHERE id = $1`,
      [EMP_B, VALID_IBAN_2]
    );
    await pool.query('UPDATE zatca_settings SET crn = $1 WHERE id = 1', ['GATE06CRN']);
    crnTouched = true;
    await pool.query(
      `INSERT INTO payroll_runs (month, status, employee_count) VALUES ($1, 'posted', 2)
             ON CONFLICT (month) DO UPDATE SET status = 'posted'`,
      [MONTH]
    );
    await pool.query(
      `INSERT INTO payroll (id, "employeeId", month, year, "basicSalary", allowances, deductions, "netSalary", status)
             VALUES (990000101, $1, $3, 2099, 5000, 0, 0, 5000, 'posted'),
                    (990000102, $2, $3, 2099, 4000, 0, 0, 4000, 'posted')`,
      [EMP_A, EMP_B, MONTH]
    );

    const res = await request(server, 'POST', '/api/integration/wps/export', { month: MONTH }, adminToken);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.rows).toBeGreaterThanOrEqual(2);
    expect(res.body.sha256).toHaveLength(64);
    expect(res.body.sha256).toBe(sha256(res.body.csv));
    expect(res.body.csv.charCodeAt(0)).toBe(0xfeff);
    expect(res.body.note).toContain('ليس ملف SIF');
    expect(res.body.audited).toBe(true);
  });
});
