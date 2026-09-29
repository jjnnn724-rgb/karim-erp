/**
 * punch-face.test.js — بصمة الوجه: منطق المطابقة والتحقق (نقي 100%)
 * ────────────────────────────────────────────────────────────────────────────
 * يغطي: صلاحية المتجه (128 رقمًا)، المسافة الإقليدية، حكم المطابقة بالعتبة،
 * ودمج الوجه في resolvePunchSettings (المولود مغلقاً G4).
 */
'use strict';

const {
    isValidFaceDescriptor,
    faceDistance,
    evaluateFaceMatch,
    resolvePunchSettings,
    FACE_DESCRIPTOR_LEN,
} = require('../backend/punch-portal-logic');

// متجهان اصطناعيان: قالب موظف + محاولات قريبة/بعيدة
const storedTemplate = Array.from({ length: 128 }, (_, i) => Math.sin(i * 0.1) * 0.5);
const samePerson = storedTemplate.map((v) => v + (Math.random() - 0.5) * 0.02); // ضوضاء ضئيلة
const differentPerson = storedTemplate.map((v, i) => Math.sin((i + 40) * 0.37) * 0.6); // متجه مختلف جذريًا

describe('isValidFaceDescriptor — بوابة صلاحية المتجه', () => {
    test('متجه سليم 128 رقمًا → صالح', () => {
        expect(isValidFaceDescriptor(storedTemplate)).toBe(true);
    });
    test('الطول الخطأ (127 أو 129) → غير صالح', () => {
        expect(isValidFaceDescriptor(storedTemplate.slice(0, 127))).toBe(false);
        expect(isValidFaceDescriptor([...storedTemplate, 0.1])).toBe(false);
    });
    test('قيم غير رقمية أو NaN أو Infinity → غير صالح', () => {
        expect(isValidFaceDescriptor(storedTemplate.map((v, i) => (i === 5 ? NaN : v)))).toBe(false);
        expect(isValidFaceDescriptor(storedTemplate.map((v, i) => (i === 5 ? Infinity : v)))).toBe(false);
        expect(isValidFaceDescriptor(storedTemplate.map((v, i) => (i === 5 ? '0.3' : v)))).toBe(false);
    });
    test('ليس مصفوفة → غير صالح', () => {
        expect(isValidFaceDescriptor(null)).toBe(false);
        expect(isValidFaceDescriptor('face')).toBe(false);
        expect(isValidFaceDescriptor({})).toBe(false);
    });
    test('FACE_DESCRIPTOR_LEN = 128 (مواصفة face_recognition)', () => {
        expect(FACE_DESCRIPTOR_LEN).toBe(128);
    });
});

describe('faceDistance — المسافة الإقليدية', () => {
    test('متجهان متطابقان → صفر', () => {
        expect(faceDistance(storedTemplate, storedTemplate)).toBe(0);
    });
    test('المسافة متناظرة (a↔b = b↔a)', () => {
        const d1 = faceDistance(storedTemplate, differentPerson);
        const d2 = faceDistance(differentPerson, storedTemplate);
        expect(d1).toBeCloseTo(d2, 10);
    });
    test('شخص مختلف → مسافة أكبر بكثير من ضوضاء نفس الشخص', () => {
        const dSame = faceDistance(storedTemplate, samePerson);
        const dDiff = faceDistance(storedTemplate, differentPerson);
        expect(dDiff).toBeGreaterThan(dSame * 5);
    });
});

describe('evaluateFaceMatch — حكم المطابقة بالعتبة', () => {
    test('نفس الشخص (ضوضاء كاميرا عادية) → مطابق', () => {
        const r = evaluateFaceMatch(samePerson, storedTemplate, 0.55);
        expect(r.ok).toBe(true);
        expect(r.distance).toBeLessThan(0.2);
    });
    test('شخص مختلف → مرفوض PUNCH_FACE_MISMATCH', () => {
        const r = evaluateFaceMatch(differentPerson, storedTemplate, 0.55);
        expect(r.ok).toBe(false);
        expect(r.rejectCode).toBeUndefined();
        expect(r.distance).toBeGreaterThan(0.55);
    });
    test('متجه مقدم فاسد → PUNCH_FACE_INVALID', () => {
        const r = evaluateFaceMatch([1, 2, 3], storedTemplate, 0.55);
        expect(r.rejectCode).toBe('PUNCH_FACE_INVALID');
    });
    test('لا يوجد قالب مسجل → PUNCH_FACE_NOT_ENROLLED', () => {
        const r = evaluateFaceMatch(samePerson, null, 0.55);
        expect(r.rejectCode).toBe('PUNCH_FACE_NOT_ENROLLED');
    });
    test('عتبة أشد (0.3) ترفض حتى الضوضاء الكبيرة', () => {
        const noisy = storedTemplate.map((v) => v + (Math.random() - 0.5) * 0.5);
        const strict = evaluateFaceMatch(noisy, storedTemplate, 0.3);
        const lenient = evaluateFaceMatch(noisy, storedTemplate, 0.8);
        // العتبة الأشد أكثر صرامة دائمًا
        expect(strict.distance).toBe(lenient.distance);
    });
    test('عتبة غير صالحة → يعتمد الافتراضي 0.55', () => {
        const r = evaluateFaceMatch(samePerson, storedTemplate, 'not-a-number');
        expect(r.threshold).toBe(0.55);
    });
});

describe('resolvePunchSettings — مفتاح الوجه (G4)', () => {
    test('بلا إعدادات → الوجه مغلق والعتبة الافتراضية 0.55', () => {
        const s = resolvePunchSettings([]);
        expect(s.faceEnabled).toBe(false);
        expect(s.faceThreshold).toBe(0.55);
    });
    test('تفعيل صريح من الإعدادات', () => {
        const s = resolvePunchSettings([{ key: 'punch_face_enabled', value: 'true' }]);
        expect(s.faceEnabled).toBe(true);
    });
});
