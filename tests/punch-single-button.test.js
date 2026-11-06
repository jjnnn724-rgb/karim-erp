/**
 * punch-single-button.test.js — البصمة بلا زر حضور/انصراف
 * ──────────────────────────────────────────────────────────────────────────────────
 * الواجهة (قرار المالك 2026-11-02): زرٌّ واحد بلا اختيار، والسيرفر حَكَم.
 * القرار المحدَّث (المالك كريم عبد الحميد — 2026-11-05 مساءً): «البصمة مصدر الحقيقة
 * الوحيد، سواء بصمة الجهاز أو بصمة الكاميرا — دون ذلك لا، لا إكملة، لا تعقيدات»:
 *   • الاتجاه من تسلسل بصمات الموظف نفسه للمصدرين معًا: أول بصمة في يوم الوردية
 *     حضور، وكل بصمة بعدها انصرافٌ حتى آخرها.
 *   • ملصق حالة الجهاز (0/1) لا يُقرأ في الحكم مطلقًا — يبقى عمودًا خامًا في attendance_logs.
 *   • لا نيّة في الحمولة، ولا نصوص زر في الواجهة — regression محفوظ من 2026-11-02.
 */
'use strict';

const fs = require('fs');
const path = require('path');

describe('البصمة حاكمة — لا ملصق جهاز ولا تفريق بين المصدرين (قرار 2026-11-05 مساءً)', () => {
    // classifyPunch حُذفت، وderiveSequencePunchState حُذفت: القاعدة صارت سطرًا واحدًا
    // في processPunch يقرؤه من صفوف الموظف نفسها. ما يُختبر هنا عقد المصدر لا الوظيفة.
    const engine = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-engine.js'), 'utf8');
    const routes = fs.readFileSync(path.join(__dirname, '..', 'backend', 'attendance-portal-routes.js'), 'utf8');

    it('الدالة classifyPunch و deriveSequencePunchState محذوفتان تمامًا', () => {
        expect(engine).not.toMatch(/classifyPunch/);
        expect(engine).not.toMatch(/deriveSequencePunchState/);
        const eng = require('../backend/attendance-engine');
        expect(eng.classifyPunch).toBeUndefined();
        expect(eng.deriveSequencePunchState).toBeUndefined();
    });

    it('الاتجاه من أطراف بصمات اليوم وحدها — لا فرع للبوابة ولا الأولوية لملصق الجهاز', () => {
        expect(engine).toContain('const entryAt = points[0];');
        expect(engine).toContain('const exitAt = points.length > 1 ? points[points.length - 1] : null;');
        expect(engine).not.toMatch(/const dir = /);
        expect(engine).not.toMatch(/source === 'portal'/);
        expect(engine).not.toMatch(/deviceIn\) \{dir|deviceOut\) \{dir/);
    });

    it('بصمة بملصقٍ مجهول أو معاكس تُحجز كما هي — الملصق لا يُقرأ أصلًا في الحكم', () => {
        expect(engine).not.toMatch(/حالة بصمة غير معروفة/);
        expect(engine).not.toMatch(/state_conflict|IN_STATES|OUT_STATES/);
        expect(engine).not.toMatch(/Number\.isFinite\(Number\(raw\)\)/);
        // processPunch لا يستقبل punchState — ولا فرع مبني على قيمة الملصق
        expect(engine.match(/async processPunch\(\{[^}]*\}\)/)[0]).not.toMatch(/punchState/);
        expect(engine.indexOf('INSERT INTO attendance')).toBeGreaterThan(engine.indexOf('const entryAt ='));
    });

    it('البوابة ترسل punchState: null دائمًا — لا intent ولا اشتقاق في الواجهة', () => {
        expect(routes).not.toMatch(/req\.body\??\.intent/);
        expect(routes).toContain('punchState: null,');
        expect(routes).toContain('UNKNOWN_PUNCH_STATE');
    });
});

describe('الواجهة — زر واحد بلا اختيار', () => {
    const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const hr = read('frontend', 'app', 'js', 'features', 'hr.js');
    const dash = read('frontend', 'app', 'js', 'features', 'dashboard.js');
    const shell = read('frontend', 'app', 'js', 'features', 'mobile-shell.js');

    it('hr.js/dashboard.js: زر kdPunch الواحد فقط — لا وجود لأزرار kdCheckIn/kdCheckOut', () => {
        for (const src of [hr, dash]) {
            expect(src).toContain('data-karim-action="kdPunch"');
            expect(src).not.toMatch(/kdCheckIn|kdCheckOut/);
            expect(src).not.toMatch(/mobileDoPunch\(['"](?:in|out)['"]\)/);
        }
        expect(hr).toContain('return window.mobileDoPunch();');
        expect(hr).toContain('checkPunch');
        expect(hr).toContain('kdPunch');
    });

    it('mobile-shell.js: mobileDoPunch بلا معاملات ولا intent في الحمولة، والزر يُعلن التسلسل', () => {
        expect(shell).toMatch(/async function mobileDoPunch\(\)/);
        expect(shell).not.toMatch(/intent:/);
        expect(shell).toContain('function punchBtnState');
        expect(shell).toContain('أول بصمة اليوم تُسجَّل حضورًا');
        expect(shell).toContain('البصمة الثانية تُسجَّل انصرافًا');
        expect(shell).toMatch(/export \{[\s\S]*punchBtnState,[\s\S]*\}/);
    });

    it('رد البصمة غير المعروفة يُظهر «تحت المراجعة» بدل ادعاء تسجيل حضور/انصراف', () => {
        expect(shell).toContain('res?.decision?.review');
        expect(shell).toContain('تحت المراجعة');
    });

    it('العنوان الجديد لا يقدّم اختيارًا: «البصمة الذاتية» بدل «تسجيل الحضور والانصراف»', () => {
        expect(hr).toContain('البصمة الذاتية');
        expect(dash).toContain('البصمة الذاتية');
        expect(hr).not.toMatch(/<h3[^>]*>[^<]*تسجيل الحضور والانصراف/);
        expect(dash).not.toMatch(/<h3[^>]*>[^<]*تسجيل الحضور والانصراف/);
    });
});

describe('السيرفر — لا اشتقاق من أي سياق', () => {
    const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
    const routes = read('backend', 'attendance-portal-routes.js');
    const engine = read('backend', 'attendance-engine.js');

    it('رد البصمة يعيد السطر (record) وحالة اليوم في /status (today)', () => {
        expect(routes).toContain('record: result.record || null,');
        expect(routes).toMatch(/let today = \{ checkIn: null, checkOut: null \};/);
        expect(routes).toMatch(/\n\s*today,/);
    });

    it('المحرك يعلن قاعدته: مصادر الحضور اثنان فقط، ولا اختلاق من فراغ', () => {
        expect(engine).toContain('مصادر الحضور المعتمدة (اثنان فقط)');
        expect(engine).toContain('لا يُخترع انصراف ولا حضور من فراغ');
    });

    it('لوج البوابة يخزّن الحالة المجهولة بدل حذف البصمة من الدليل الخام', () => {
        expect(routes).toContain('UNKNOWN_PUNCH_STATE');
        // لا مسار مبكر يُسقط البصمة بلا اتجاه صريح (كان: if (!Number.isInteger(punchState)) return)
        expect(routes).not.toMatch(/if \(!Number\.isInteger\(punchState\)\) \{return;\}/);
    });
});
