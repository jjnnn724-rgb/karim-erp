'use strict';
/**
 * tests/v3-rollout.test.js — دقة القلب المجدول إلى V3
 * ══════════════════════════════════════════════════════════════════════════
 * الموعد في `frontend/v3/rollout.json` لا في الكود، فالتعديل لا يحتاج إعادة
 * تشغيل. هنا نثبت أن السلوك عند حدّ الموعد نفسه صحيح (قبله V2، وعنده V3)،
 * وأن التجاوز اليدوي يعمل في الاتجاهين، وأن القلب لا يحدث بلا بُنية على القرص.
 *
 * الاختبار يقرأ الموعد من الملف نفسه بدل تثبيته: تغيير الموعد لا يكسر الاختبار،
 * وتغيير صيغته (بلا إزاحة زمنية) يُفشله عمدًا.
 */
const fs = require('fs');
const path = require('path');
const rollout = require('../backend/rollout');

const CONFIG_FILE = path.join(__dirname, '..', 'frontend', 'v3', 'rollout.json');
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
const SWITCH_AT = String(config.switchAt ?? '');
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;

describe('V3 — القلب المجدول', () => {
    const original = process.env.V3_PRIMARY;

    beforeEach(() => {
        delete process.env.V3_PRIMARY;
    });

    afterEach(() => {
        if (original === undefined) {
            delete process.env.V3_PRIMARY;
        } else {
            process.env.V3_PRIMARY = original;
        }
    });

    test('الموعد ISO بإزاحة صريحة ويُقرأ إلى نفس اللحظة', () => {
        expect(SWITCH_AT).toMatch(ISO_WITH_OFFSET);
        expect(rollout.switchAt()).toBe(Date.parse(SWITCH_AT));
    });

    test('قبل الموعد V2، وفي الموعد نفسه V3', () => {
        const at = Date.parse(SWITCH_AT);
        expect(rollout.v3Primary(at - 1)).toBe(false);
        expect(rollout.v3Primary(at)).toBe(true);
        expect(rollout.v3Primary(at + 60_000)).toBe(true);
    });

    test('V3_PRIMARY=1 يسبق الموعد، وV3_PRIMARY=0 يعطّل القلب بعده', () => {
        const at = Date.parse(SWITCH_AT);
        process.env.V3_PRIMARY = '1';
        expect(rollout.v3Primary(at - 60_000)).toBe(true);
        process.env.V3_PRIMARY = '0';
        expect(rollout.v3Primary(at + 60_000)).toBe(false);
    });

    test('بُنية V3 موجودة على القرص الآن', () => {
        expect(rollout.v3Ready()).toBe(true);
    });

    test('المدخل لا يتحول قبل الموعد ولا بلا بُنية', () => {
        const at = Date.parse(SWITCH_AT);
        expect(rollout.v3Entry(at - 1)).toBe(false);
        expect(rollout.v3Entry(at)).toBe(rollout.v3Ready());
    });
});
