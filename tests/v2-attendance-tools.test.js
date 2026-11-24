/**
 * v2-attendance-tools.test.js — عقد أدوات الحضور في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/hr.js:319-565 (نواقص/معالجة/عذر/تصحيح/كشك/تصدير) +
 * أبواب attendance-repo (W2-3). يمتد عقد v2-attendance.test.js دون تعديله.
 * W2-3 (استكمال): كشف شهري مجمع قابل للطباعة + تدقيق صارم + سجل تعديلات.
 * قرار المالك 2026-11-05: أدوات الكشك/الإرجاع/الورديات أُزيلت من الشاشة —
 * العقود هنا تثبّت الإزالة (لا تعود صامتةً) وتبقي ما بقي داخل نفس الحدود:
 * نداء طباعة واحد، بلا شبكة مباشرة، بلا ألوان خام في الشاشة.
 */
const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const SCREEN = path.join(V2, 'screens', 'attendance.js');

const read = (p) => fs.readFileSync(p, 'utf8');

describe('الحضور — أدوات الكتابة في الشاشة', () => {
    const src = () => read(SCREEN);

    test('النواقص والمعالجة والعذر والتصحيح والتصدير حاضرة — والكشك/الإرجاع مُزالان بقرار', () => {
        const s = src();
        for (const k of ['data-v2-tool', 'data-v2-gaps', 'data-v2-gaps-q',
            'data-v2-resolve', 'data-v2-res-go', 'data-v2-exc-go', 'data-v2-cor-go',
            'buildAttendanceGaps', 'filterGaps', 'updateAttendance', 'createAttendance',
            'createApprovedLeave', 'buildExcusePayload', 'calcPunchTimes',
            'buildExportMatrix', 'exportFileName',
            'attToolsFor', 'openResolve', 'openExcuse', 'openCorrect', 'doExport']) {
            expect(s).toContain(k);
        }
        // قرار المالك 2026-11-05 (رأس الشاشة): لا كشك ولا إرجاع استنتاج —
        // نثبّت الغياب لئلا تعود الأدوات من باب خلفي.
        for (const k of ['parseScanPayload', 'scanAttendance', 'scanResultText',
            'doScan', 'revertInferred']) {
            expect(s).not.toContain(k);
        }
    });

    test('الأدوار تحسم الظهور — والخادم يحسم التنفيذ', () => {
        const s = src();
        expect(s).toMatch(/attToolsFor\(ctx\.role\)/);
        expect(s).toMatch(/canResolve/);
    });

    test('بلا شبكة مباشرة ولا معالج سطري في الإضافة', () => {
        const s = src().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(s).not.toMatch(/\bapiFetch\b/);
        expect(s).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(s.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
        expect(s).not.toMatch(/\bprompt\(/);
    });

    test('سجل تعديلات الحضور: بابٌ واحد يقرأ الأثر الكامل قبل/بعد', () => {
        const s = src();
        for (const k of ['data-v2-tr-from', 'data-v2-tr-to', 'data-v2-tr-action',
            'data-v2-tr-load', 'data-v2-tr-body', 'fetchAttendanceAudit',
            'auditEditRows', 'openTrail', 'loadTrail']) {
            expect(s).toContain(k);
        }
        // لوحة القراءة لا تكتب: لا بوابة تعديل من داخلها
        expect(s).not.toMatch(/data-v2-tr-(save|delete|write)/);
    });

    test('W2-3: الكشف الشهري والتدقيق الصارم حاضرين بأبوابهما — والورديات مُزالة بقرار', () => {
        const s = src();
        for (const k of ['data-v2-mo-month', 'data-v2-mo-load',
            'data-v2-mo-print', 'data-v2-mo-body', 'data-v2-au-month', 'data-v2-au-load',
            'data-v2-au-body',
            'fetchStrictAudit', 'summarizeAudit', 'fetchMonthlyAttendance',
            'buildMonthlySheet', 'minutesToHM',
            'openMonthly', 'loadMonthly', 'openAudit', 'loadAudit', 'printNow']) {
            expect(s).toContain(k);
        }
        // أبواب الورديات (تحليل/اقتراح/تطبيق) أُزيلت بقرار المالك 2026-11-05؛
        // ومساعدَا shiftStartFor/fetchWorkStartHour باقيان لحساب ملء/تصحيح فقط.
        expect(s).not.toMatch(/data-v2-sh-/);
        for (const k of ['validateShiftsText', 'suggestShiftLines', 'withSuggestedLines',
            'formatShiftsResult', 'fetchShiftsAnalysis', 'applyShifts', 'openShifts', 'submitShifts']) {
            expect(s).not.toContain(k);
        }
        expect(s).toContain('shiftStartFor');
    });

    test('لا كاميرا في شاشة الحضور: الكشك أُزيل — لا Html5Qrcode ولا scanner.js ولا openScanner', () => {
        const s = src();
        // الكشك انتقل إلى شاشة مسح المخزن (goods-scan.js)؛ شاشة الحضور لا
        // تفتح عدسةً أصلًا، فلا يبقى فيها مكتبةٌ ولا بقايا ماسح قديم.
        expect(s).not.toContain('ensureHtml5Qrcode');
        expect(s).not.toContain('Html5Qrcode');
        expect(s).not.toContain('getUserMedia');
        expect(s).not.toContain('openScanner');
        const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/scanner\.js/);
    });

    test('الهدم ينظّف: الجدول يُهدم والجذر يُزال — ولا عدسة تُترك مفتوحة', () => {
        const s = src();
        expect(s).toMatch(/destroy\(\)\s*\{\s*table\.destroy\(\);\s*el\.remove\(\);/);
        expect(s).not.toContain('stopScan');
    });

    test('نداء طباعة واحد: الكشف يلبس الصنف قبل النداء وينزعه بعده', () => {
        const s = src();
        expect((s.match(/window\.print\(/g) || []).length).toBe(1);
        expect(s).toContain('erp-v2-print-monthly');
        expect(s).toContain("addEventListener('afterprint'");
        expect(s).toContain("removeEventListener('afterprint'");
    });

    test('بلا ألوان خام في الشاشة — والنغمة عبر الصنف والرموز', () => {
        const s = src();
        expect(s).not.toMatch(/rgba?\(/);
        expect(s).toContain('erp-tr--danger');
    });

    test('المضيف يمرر هوية الحساب وconfirmFn لشاشة الحضور', () => {
        const host = read(path.join(V2, 'preview.js'));
        const at = host.indexOf("attendanceScreen = (await mountLazy('attendance'");
        expect(at).toBeGreaterThan(-1);
        const mount = host.slice(at, at + 800);
        expect(mount).toMatch(/userId: u\.id != null \? u\.id : \(u\.sub != null \? Number\(u\.sub\) : null\)/);
        expect(mount).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\)/);
        expect(mount).toMatch(/confirmFn: confirmAction/);
    });
});
