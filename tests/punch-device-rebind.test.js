/**
 * punch-device-rebind.test.js — الربط الذاتي للجهاز (L4 self-heal)
 * ────────────────────────────────────────────────────────────────────────────
 * إصلاح شكوى «الجهاز غير مسجل» (2026-10-04): أي جهاز جديد لحساب مربوط كان
 * يُرفض دائمًا بطلب التواصل مع HR بلا أي أداة فك ربط في النظام. الآن:
 *   • جهاز جديد + الربط التلقائي مفعّل → rebind (يُنفَّذ بعد نجاح كل الطبقات)
 *   • الربط التلقائي مطفأ إداريًا → الرفض القديم كما هو (PUNCH_DEVICE_MISMATCH)
 *   • بلا معرّف جهاز قابل للتخزين → skip لطبقة L4 فقط والبقية مفروضة
 * المنطق نقي بالكامل (resolveDeviceBindingAction) — كتابة قاعدة البيانات في المسار.
 */
'use strict';

const {
    resolveDeviceBindingAction,
    resolvePunchSettings,
} = require('../backend/punch-portal-logic');

const baseSettings = resolvePunchSettings([
    { key: 'punch_portal_enabled', value: 'true' },
    { key: 'punch_device_binding', value: 'true' },
]);

const rebindOff = resolvePunchSettings([
    { key: 'punch_device_binding', value: 'true' },
    { key: 'punch_device_auto_rebind', value: 'false' },
]);

describe('resolvePunchSettings — punch_device_auto_rebind', () => {
    test('الافتراضي مفعّل (true) عند غياب المفتاح — لا حبس أجهزة جديدة', () => {
        const s = resolvePunchSettings([]);
        expect(s.deviceAutoRebind).toBe(true);
    });
    test('يُقرأ من قاعدة البيانات عند توفره', () => {
        expect(resolvePunchSettings([{ key: 'punch_device_auto_rebind', value: 'false' }]).deviceAutoRebind).toBe(false);
        expect(resolvePunchSettings([{ key: 'punch_device_auto_rebind', value: 'true' }]).deviceAutoRebind).toBe(true);
    });
});

describe('resolveDeviceBindingAction — قرار ربط الجهاز', () => {
    test('جهاز جديد لحساب مربوط + تلقائي → rebind مع ذكر الجهاز القديم', () => {
        const r = resolveDeviceBindingAction(baseSettings, 'dev-new', 'dev-old');
        expect(r.action).toBe('rebind');
        expect(r.from).toBe('dev-old');
    });
    test('نفس الجهاز المربوط → none (يمر عبر evaluatePunch عاديًا)', () => {
        expect(resolveDeviceBindingAction(baseSettings, 'dev-a', 'dev-a').action).toBe('none');
    });
    test('لا جهاز مربوط بعد → none (الربط الأول يحدث في نقطة النجاح كالسابق)', () => {
        expect(resolveDeviceBindingAction(baseSettings, 'dev-a', null).action).toBe('none');
    });
    test('التلقائي مطفأ + جهاز مختلف → none (يرفض evaluatePunch كالسابق)', () => {
        expect(resolveDeviceBindingAction(rebindOff, 'dev-new', 'dev-old').action).toBe('none');
    });
    test('بلا معرّف جهاز (تخزين محجوب) + تلقائي → skip لطبقة L4 فقط', () => {
        expect(resolveDeviceBindingAction(baseSettings, null, 'dev-old').action).toBe('skip');
        expect(resolveDeviceBindingAction(baseSettings, null, null).action).toBe('skip');
    });
    test('بلا معرّف جهاز + تلقائي مطفأ → none (يرفض evaluatePunch REQUIRED)', () => {
        expect(resolveDeviceBindingAction(rebindOff, null, 'dev-old').action).toBe('none');
    });
    test('ربط الجهاز مطفأ إداريًا أصلًا → none دائمًا مهما كانت المدخلات', () => {
        const s = resolvePunchSettings([{ key: 'punch_device_binding', value: 'false' }]);
        expect(resolveDeviceBindingAction(s, 'dev-new', 'dev-old').action).toBe('none');
        expect(resolveDeviceBindingAction(s, null, null).action).toBe('none');
    });
    test('القرار لا يغير شيئًا عندما يكون الجهاز مطابقًا حتى مع تعطيل التلقائي', () => {
        expect(resolveDeviceBindingAction(rebindOff, 'dev-a', 'dev-a').action).toBe('none');
    });
});
