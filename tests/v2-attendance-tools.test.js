/**
 * v2-attendance-tools.test.js — عقد أدوات الحضور في V2
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: features/hr.js:319-565 (نواقص/معالجة/عذر/تصحيح/كشك/تصدير) +
 * أبواب attendance-repo (W2-3). يمتد عقد v2-attendance.test.js دون تعديله.
 * W2-3 (استكمال): ورديات (تحليل + اقتراح + تطبيق) + كشف شهري مجمع قابل
 * للطباعة + تدقيق صارم + كشك QR أصلي بلا scanner.js — وداخل نفس الحدود:
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

    test('النواقص والمعالجة والعذر والتصحيح والتصدير حاضرة', () => {
        const s = src();
        for (const k of ['data-v2-tool', 'data-v2-gaps', 'data-v2-gaps-q',
            'data-v2-resolve', 'data-v2-res-go', 'data-v2-exc-go', 'data-v2-cor-go',
            'buildAttendanceGaps', 'filterGaps', 'updateAttendance', 'createAttendance',
            'createApprovedLeave', 'buildExcusePayload', 'calcPunchTimes',
            'buildExportMatrix', 'exportFileName',
            'attToolsFor', 'openResolve', 'openExcuse', 'openCorrect', 'doExport']) {
            expect(s).toContain(k);
        }
        // زر التصدير موجود في ATT_TOOL_DEFS ⇒ لا بد أن تكون دالته معرَّفة في
        // الشاشة نفسها. غيابها كان يرمي «doExport is not defined» عند أول ضغطة.
        expect(s).toMatch(/async function doExport\(\)/);
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

    test('W2-3: الكشف الشهري والتدقيق الصارم حاضران؛ الورديات وQR أُزيلا بقرار المالك', () => {
        const s = src();
        for (const k of ['data-v2-mo-month', 'data-v2-mo-load',
            'data-v2-mo-print', 'data-v2-mo-body', 'data-v2-au-month', 'data-v2-au-load',
            'data-v2-au-body',
            'fetchStrictAudit', 'summarizeAudit', 'fetchMonthlyAttendance',
            'buildMonthlySheet', 'minutesToHM',
            'openMonthly', 'loadMonthly', 'openAudit', 'loadAudit', 'printNow']) {
            expect(s).toContain(k);
        }
        // قرار المالك 2026-11-05: مصدران فقط للبصمة (جهاز + كاميرا التطبيق)،
        // والدوام من بطاقة الموظف — فأُزيلت لوحة «الورديات من البصمة» وزر
        // «إلغاء الاستكمال». الحارس هنا يمنع عودتها صامتة، لا يمنع قرارًا جديدًا.
        for (const gone of ['data-v2-sh-', 'openShifts', 'submitShifts', 'revertInferred']) {
            expect(s).not.toContain(gone);
        }
    });

    test('لا كشك QR داخل الشاشة: المصدر جهاز البصمة أو كاميرا التطبيق فقط', () => {
        const s = src();
        expect(s).not.toContain('Html5Qrcode');
        expect(s).not.toContain('ensureHtml5Qrcode');
        expect(s).not.toContain('openScanner');
        const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/scanner\.js/);
    });

    test('لا عدسة كاميرا مفتوحة في الشاشة (أُزيل الكشك)', () => {
        const s = src();
        expect(s).not.toMatch(/function stopScan\(\)/);
        expect(s).not.toMatch(/stopScan\(\);/);
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
