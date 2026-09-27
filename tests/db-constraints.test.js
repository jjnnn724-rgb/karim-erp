/**
 * db-constraints.test.js — محلل CHECK constraints
 * ─────────────────────────────────────────────────
 * regression: قيم IN مع casts من PostgreSQL ('A'::character varying)
 * كانت تُقارن خامًا فترفض كتابات صحيحة (عطل حفظ الموردين).
 */

const { validateChecks } = require('../backend/db-constraints');

function fakeConstraints(def) {
    return { suppliers: { columns: {}, constraints: [{ type: 'c', name: 'suppliers_tax_status_chk', def }] } };
}

// الصيغة الحقيقية كما يخرجها pg_get_constraintdef لعمود VARCHAR
const PG_DEF = `(tax_registration_status)::text = ANY ((ARRAY['REGISTERED'::character varying, 'NOT_REGISTERED'::character varying, 'EXEMPT'::character varying])::text[])`;

describe('validateChecks — IN مع casts', () => {
    test('قيمة صحيحة تُقبل رغم الـ casts', async () => {
        const r = await validateChecks('suppliers', { tax_registration_status: 'REGISTERED' }, fakeConstraints(PG_DEF));
        expect(r.ok).toBe(true);
        expect(r.errors).toEqual([]);
    });

    test.each([['NOT_REGISTERED'], ['EXEMPT']])('قيمة صحيحة (%s) تُقبل', async (v) => {
        const r = await validateChecks('suppliers', { tax_registration_status: v }, fakeConstraints(PG_DEF));
        expect(r.ok).toBe(true);
    });

    test('قيمة خارج القائمة تُرفض برسالة نظيفة (بلا casts)', async () => {
        const r = await validateChecks('suppliers', { tax_registration_status: 'MAYBE' }, fakeConstraints(PG_DEF));
        expect(r.ok).toBe(false);
        expect(r.errors[0].column).toBe('tax_registration_status');
        expect(r.errors[0].allowedValues).toEqual(['REGISTERED', 'NOT_REGISTERED', 'EXEMPT']);
    });

    test('عمود غائب/فارغ يُتجاوز (لا كسر للحقول الاختيارية)', async () => {
        expect((await validateChecks('suppliers', {}, fakeConstraints(PG_DEF))).ok).toBe(true);
        expect((await validateChecks('suppliers', { tax_registration_status: null }, fakeConstraints(PG_DEF))).ok).toBe(true);
    });

    test('جدول بلا قيود → ok', async () => {
        expect((await validateChecks('unknown_table', { a: 1 }, fakeConstraints(PG_DEF))).ok).toBe(true);
    });
});
