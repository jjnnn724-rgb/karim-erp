/**
 * oracle-resilient.test.js — credential sets parsing (no network).
 */

describe('credentialSets — مجموعات الاعتماد الاحتياطية', () => {
    const KEY = '../backend/yarasoft/oracle-link';
    const OLD = { ...process.env };
    afterEach(() => {
        for (const k of Object.keys(process.env)) {
            if (k.startsWith('YARASOFT_ORACLE_') && !(k in OLD)) {delete process.env[k];}
        }
        Object.assign(process.env, OLD);
        jest.resetModules();
    });

    test('مجموعة واحدة افتراضيًا + الحالة لا تكشف أسرارًا', () => {
        process.env.YARASOFT_ORACLE_USER = 'u1';
        process.env.YARASOFT_ORACLE_PASSWORD = 'p1';
        delete process.env.YARASOFT_ORACLE_USER_2;
        const { credentialSets, credentialStatus } = require(KEY);
        const sets = credentialSets();
        expect(sets).toHaveLength(1);
        expect(sets[0]).toMatchObject({ index: 1, user: 'u1' });
        // الحالة العامة (تظهر في الفحص) أرقام فقط — بلا قيم سرية
        expect(JSON.stringify(credentialStatus())).not.toMatch(/p1/);
        expect(credentialStatus()).toMatchObject({ setsConfigured: 1, activeSet: 1 });
    });

    test('مجموعات _2/_3 الفارغة تُتجاهل', () => {
        process.env.YARASOFT_ORACLE_USER = 'u1';
        process.env.YARASOFT_ORACLE_PASSWORD = 'p1';
        process.env.YARASOFT_ORACLE_USER_2 = 'u2';
        process.env.YARASOFT_ORACLE_PASSWORD_2 = 'p2';
        process.env.YARASOFT_ORACLE_USER_3 = '';
        const { credentialSets } = require(KEY);
        expect(credentialSets()).toHaveLength(2);
    });
});
