/**
 * totp.test.js — TOTP/HOTP (RFC 4226/6238) — بلا قاعدة بيانات
 * ────────────────────────────────────────────────────────────────────────────
 * متجهات الاختبار من RFC 4226 (HOTP) وRFC 6238 (TOTP) نفسها، لا من تنفيذنا،
 * حتى يكشف الاختبار خطأً في الخوارزمية لا مجرد انسجامها مع نفسها.
 */

const { describe, it, expect } = require('@jest/globals');
const totp = require('../backend/totp');

const RFC_SECRET = totp.base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('HOTP — RFC 4226 Appendix D', () => {
    const expected = ['755224', '287082', '359152', '969429', '338314',
        '254676', '287922', '162583', '399871', '520489'];

    it.each(expected.map((code, counter) => [counter, code]))(
        'counter %i → %s',
        (counter, code) => {
            expect(totp.hotp(RFC_SECRET, counter)).toBe(code);
        }
    );

    it('يقبل مفتاحًا خامًا (Buffer) كما يقبل Base32', () => {
        const raw = Buffer.from('12345678901234567890', 'ascii');
        expect(totp.hotp(raw, 1)).toBe('287082');
    });
});

describe('TOTP — RFC 6238 Appendix B (SHA-1)', () => {
    const vectors = [
        [59, '94287082'],
        [1111111109, '07081804'],
        [1111111111, '14050471'],
        [1234567890, '89005924'],
        [2000000000, '69279037'],
        [20000000000, '65353130'],
    ];

    it.each(vectors)('T=%i → %s (8 digits)', (seconds, code) => {
        expect(totp.totp(RFC_SECRET, { at: seconds * 1000, digits: 8 })).toBe(code);
    });

    it('يقصّر إلى 6 أرقام للاستخدام الفعلي', () => {
        expect(totp.totp(RFC_SECRET, { at: 59_000 })).toBe('287082');
    });
});

describe('Base32', () => {
    it('ترميز/فك ترميز دون فقدان', () => {
        for (const size of [1, 5, 10, 20, 32]) {
            const buf = require('crypto').randomBytes(size);
            const round = totp.base32Decode(totp.base32Encode(buf));
            expect(round.equals(buf)).toBe(true);
        }
    });

    it('يرفض محارف خارج الأبجدية', () => {
        expect(() => totp.base32Decode('ABC1')).toThrow('INVALID_BASE32');
    });

    it('يتساهل مع المسافات والشرطات وحالة الأحرف', () => {
        const plain = totp.base32Encode(Buffer.from('hello world'));
        const spaced = plain.toLowerCase().replace(/(.{4})/g, '$1-');
        expect(totp.base32Decode(spaced).toString()).toBe('hello world');
    });
});

describe('verify — النافذة الزمنية ومنع إعادة الاستعمال', () => {
    const at = 1_700_000_000_000;
    const code = totp.totp(RFC_SECRET, { at });
    const step = Math.floor(at / 1000 / 30);

    it('يقبل الرمز الصحيح في نفس الخطوة', () => {
        expect(totp.verify(RFC_SECRET, code, { at })).toEqual({ ok: true, step });
    });

    it('يقبل خطوة سابقة/تالية داخل النافذة ±1', () => {
        const prev = totp.totp(RFC_SECRET, { at: at - 30_000 });
        const next = totp.totp(RFC_SECRET, { at: at + 30_000 });
        expect(totp.verify(RFC_SECRET, prev, { at })).toEqual({ ok: true, step: step - 1 });
        expect(totp.verify(RFC_SECRET, next, { at })).toEqual({ ok: true, step: step + 1 });
    });

    it('يرفض خطوة خارج النافذة', () => {
        const far = totp.totp(RFC_SECRET, { at: at + 120_000 });
        expect(totp.verify(RFC_SECRET, far, { at })).toEqual({ ok: false, reason: 'MISMATCH' });
    });

    it('يرفض الصيغة غير الرقمية أو الطول الخاطئ قبل أي HMAC', () => {
        expect(totp.verify(RFC_SECRET, '12ab56', { at }).reason).toBe('FORMAT');
        expect(totp.verify(RFC_SECRET, '12345', { at }).reason).toBe('FORMAT');
        expect(totp.verify(RFC_SECRET, '', { at }).reason).toBe('FORMAT');
    });

    it('يرفض إعادة استعمال خطوة مستهلكة (minStep)', () => {
        expect(totp.verify(RFC_SECRET, code, { at, minStep: step })).toEqual({ ok: false, reason: 'REPLAY' });
    });

    it('يرفض أي خطوة ≤ minStep ويمرر ما فوقها فقط', () => {
        const prev = totp.totp(RFC_SECRET, { at: at - 30_000 });
        // السجل عند step فقط — الخطوة السابقة لم تُستهلك بعد
        expect(totp.verify(RFC_SECRET, prev, { at, minStep: step })).toEqual({ ok: false, reason: 'REPLAY' });
        expect(totp.verify(RFC_SECRET, prev, { at, minStep: step - 2 })).toEqual({ ok: true, step: step - 1 });
    });
});

describe('otpauth URI', () => {
    it('يحمل السر والجهة والحساب والمعاملات القياسية', () => {
        const uri = totp.otpauthURI({ secret: RFC_SECRET, account: 'owner', issuer: 'Karim ERP' });
        expect(uri.startsWith('otpauth://totp/')).toBe(true);
        expect(uri).toContain(`secret=${RFC_SECRET}`);
        expect(uri).toContain('issuer=Karim+ERP');
        expect(uri).toContain('algorithm=SHA1');
        expect(uri).toContain('digits=6');
        expect(uri).toContain('period=30');
    });
});

describe('رموز الاسترداد', () => {
    it('ينشئ 8 رموز فريدة بصيغة XXXXX-XXXXX', () => {
        const codes = totp.generateRecoveryCodes(8);
        expect(codes).toHaveLength(8);
        expect(new Set(codes).size).toBe(8);
        for (const code of codes) {
            expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
        }
    });

    it('يطبّع المدخلات (حالة الأحرف والفواصل)', () => {
        expect(totp.normalizeRecoveryCode(' ab2cd-efg34 ')).toBe('AB2CDEFG34');
        expect(totp.normalizeRecoveryCode('ab2cd efg34')).toBe('AB2CDEFG34');
    });

    it('الهاش ثابت لنفس المستخدم والرمز، ومختلف بين مستخدمين', () => {
        const h1 = totp.hashRecoveryCode('ABCDE-FGHJK', 7);
        const h2 = totp.hashRecoveryCode('abcde fghjk', 7);
        const other = totp.hashRecoveryCode('ABCDE-FGHJK', 8);
        expect(h1).toBe(h2);
        expect(h1).not.toBe(other);
        expect(h1).toMatch(/^[0-9a-f]{64}$/);
    });
});
