/**
 * audit-action-enum.test.js — قيم سجل التدقيق مقابل نوع pos_audit_action
 * ═══════════════════════════════════════════════════════════════════════════
 * الدافع (2026-10-26): العمود action من نوع ENUM مسموحه فيه 10 قيم، بينما
 * الكود يكتب 17 قيمة مختلفة. كل كتابة خارج القائمة تفشل بخطأ
 * «invalid input value for enum pos_audit_action»، والخطأ مبلوع بـ .catch في
 * كل موضع — فتسقط أحداث المصادقة الثنائية وإبطال الجلسات وWebAuthn بصمت
 * داخل سلسلة hash سليمة. هذا الاختبار يمنع تكرار الصنف نفسه: أي قيمة
 * جديدة في الكود بلا ترحيل مقابلها تُوقف البناء.
 *
 * الاختبار سلوكي: يكتب صفوفًا حقيقية في سجل التدقيق على قاعدة الاختبار
 * (append-only بسلسلة hash) ويطالب بأن تُقبل كلها.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../backend/shared-pool');
const { writeAuditLog } = require('../backend/cashier-module/audit-middleware');

const BACKEND = path.join(__dirname, '..', 'backend');
const ACTION_LITERAL = /action:\s*'([A-Z][A-Z_]*)'/g;

function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {return jsFiles(file);}
        return entry.name.endsWith('.js') ? [file] : [];
    });
}

/** كل قيمة action حرفية في الكود — مربعة بمكانها. */
function collectActionLiterals() {
    const found = new Map();
    for (const file of jsFiles(BACKEND)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(ACTION_LITERAL)) {
            const value = match[1];
            if (!found.has(value)) {found.set(value, []);}
            found.get(value).push(path.relative(path.join(__dirname, '..'), file));
        }
    }
    return found;
}

describe('قيم سجل التدقيق: الكود والنوع لا يفترقان', () => {
    let enumValues = [];
    const literals = collectActionLiterals();

    beforeAll(async () => {
        const r = await pool.query(
            `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'pos_audit_action'::regtype ORDER BY enumsortorder`
        );
        enumValues = r.rows.map((row) => row.enumlabel);
    });

    afterAll(async () => {
        await pool.end();
    });

    test('الكود يستخدم قيمًا فعلًا (وإلا فالحارس بلا معنى)', () => {
        expect(literals.size).toBeGreaterThan(10);
    });

    test('كل قيمة action في الكود موجودة في نوع pos_audit_action', () => {
        const missing = [...literals.entries()]
            .filter(([value]) => !enumValues.includes(value))
            .map(([value, files]) => `${value} (${files.join(', ')})`);
        expect(missing).toEqual([]);
    });

    test('كل قيمة action تُكتب فعليًا في سجل التدقيق بلا رفض من النوع', async () => {
        const tag = `enum-probe-${Date.now()}`;
        const rejected = [];
        for (const value of literals.keys()) {
            try {
                await writeAuditLog({
                    action: value,
                    tableName: 'pos_audit_logs',
                    rowPk: tag,
                    reason: 'اختبار تطابق قيم التدقيق مع نوع ENUM',
                    metadata: { probe: tag, action: value },
                    actor: { userName: 'jest', role: 'bg_worker' },
                });
            } catch (e) {
                rejected.push(`${value}: ${e.message}`);
            }
        }
        expect(rejected).toEqual([]);
    });

    test('القيم التي استخدمها الكود كلها مختومة بسلسلة hash', async () => {
        const r = await pool.query(
            `SELECT COUNT(*)::int AS n, COUNT(entry_hash)::int AS sealed
               FROM pos_audit_logs WHERE reason = 'اختبار تطابق قيم التدقيق مع نوع ENUM'`
        );
        expect(r.rows[0].n).toBeGreaterThan(0);
        expect(r.rows[0].sealed).toBe(r.rows[0].n);
    });
});
