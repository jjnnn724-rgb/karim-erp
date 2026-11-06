// ────────────────────────────────────────────────────────────────────────────
// attendance-lock-int4.test.js — بلاغ المالك 2026-11-05: «بصمة أحمد صلاح
// النهاردة لم تظهر دخول»
// المحرك المبسّط مرّر employeeId خامًا إلى pg_advisory_xact_lock($1,$2)،
// وهاتان الوسيطتان int4. معرّفات سبعة موظفين (17908800…) تتجاوز 2^31،
// فارتفعت 22003 value out of range ⇒ ROLLBACK ⇒ البصمة تضيع ولا أثر في السجل
// (لأن pino يترك الوسيط النصي الثاني). المزامنة كل 10 ث كرّرت ذلك خمس مرات.
// ────────────────────────────────────────────────────────────────────────────
'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');
const { engine, instantToWall } = require('../backend/attendance-engine');

const ENGINE = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');
const BIG_ID = 1790880082825271; // نفسشكل معرّفات الإنتاج المتضررة (أحمد صلاح)

afterAll(async () => {
    await pool.query('DELETE FROM attendance WHERE "employeeId" = $1', [BIG_ID]).catch(() => {});
    await pool.query('DELETE FROM attendance_decisions WHERE "employeeId" = $1', [BIG_ID]).catch(() => {});
    await pool.query('DELETE FROM employees WHERE id = $1', [BIG_ID]).catch(() => {});
    await pool.end();
});

describe('قفل البصمة لا يسقط أمام معرّف bigint', () => {
    test('المحرك يقفل بمفتاح مُهاشًا (int-آمن) لا بمعرّف خام', () => {
        expect(ENGINE).toContain('pg_advisory_xact_lock(hashtext($1::text))');
        expect(ENGINE).not.toMatch(/pg_advisory_xact_lock\(\$1, \$2\)/);
        expect(ENGINE).not.toMatch(/pg_advisory_xact_lock\(\s*employeeId/);
    });

    test('لا backend يمرّر معرّفات خامًا إلى القفل الاستشاري', () => {
        const dir = path.join(__dirname, '..', 'backend');
        const hits = [];
        const walk = (d) => {
            for (const f of fs.readdirSync(d, { withFileTypes: true })) {
                if (f.name === 'node_modules') {continue;}
                const p = path.join(d, f.name);
                if (f.isDirectory()) {walk(p);}
                else if (f.name.endsWith('.js')) {
                    const t = fs.readFileSync(p, 'utf8');
                    for (const m of t.matchAll(/pg_advisory_(?:xact_)?lock\(([^)]*)\)/g)) {
                        const args = m[1];
                        if (/\$\d/.test(args) && !/hashtext/.test(args)) {hits.push(`${path.basename(p)}: ${args}`);}
                    }
                }
            }
        };
        walk(dir);
        expect(hits).toEqual([]);
    });

    test('فشل الكتابة يُسجَّل بسببه لا بصمته فقط (pino يبتلع الوسيط الثاني)', () => {
        const at = ENGINE.indexOf("logger.error(`[AttendanceEngine] processPunch failed:");
        expect(at).toBeGreaterThan(-1);
        const block = ENGINE.slice(at, at + 420);
        expect(block).toContain('code=${error && error.code ? error.code');
        expect(block).toContain('${error && error.message ? error.message');
        expect(block).toContain('employee=${employeeId}');
    });

    test('القفل بصيغته الجديدة يعمل على معرّف 1790880082825271 فعليًا', async () => {
        const r = await pool.query(
            'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text)) AS ok',
            [String(BIG_ID), '2026-11-05']);
        expect(r.rowCount).toBe(1); // void يُنفَّذ بلا 22003
    });

    test('وبصيغته القديمة كان يفشل بنفس المعرّف — هذا نص الداء', async () => {
        let err = null;
        try { await pool.query('SELECT pg_advisory_xact_lock($1, $2)', [BIG_ID, 20261105]); }
        catch (e) { err = e; }
        expect(err).not.toBeNull();
        expect(err.code).toBe('22003');
        expect(err.message).toMatch(/out of range for type integer/);
    });

    test('بصمة موظف bigint تُكتب فعلًا: لا تُبتلع ولا تُلغى معاملتها', async () => {
        await pool.query(
            `INSERT INTO employees (id, name, "employeeId", shift_start, shift_karim, status)
             VALUES ($1, 'Probe — قفل bigint', 'PROBE-BIGID', '17:00', 12, 'active')
             ON CONFLICT (id) DO NOTHING`, [BIG_ID]);
        const instant = new Date('2026-11-05T14:00:00.000Z'); // 17:00 بتوقيت مكة
        const res = await engine.processPunch({
            employeeId: BIG_ID, punchState: null, instant, wall: instantToWall(instant), source: 'portal',
        });
        expect(res.error).toBeUndefined();
        expect(res.action).toBe('check_in');
        const { rows } = await pool.query(
            `SELECT "checkIn", date FROM attendance WHERE "employeeId" = $1 AND date = '2026-11-05'`, [BIG_ID]);
        expect(rows.length).toBe(1);
        expect(rows[0].checkIn).toBe('17:00');
    });
});
