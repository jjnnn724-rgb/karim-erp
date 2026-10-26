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

    test('النواقص والمعالجة والعذر والتصحيح والكشك والتصدير حاضرة', () => {
        const s = src();
        for (const k of ['data-v2-tool', 'data-v2-gaps', 'data-v2-gaps-q',
            'data-v2-resolve', 'data-v2-res-go', 'data-v2-exc-go', 'data-v2-cor-go',
            'buildAttendanceGaps', 'filterGaps', 'updateAttendance', 'createAttendance',
            'createApprovedLeave', 'buildExcusePayload', 'calcPunchTimes',
            'parseScanPayload', 'scanAttendance', 'scanResultText',
            'buildExportMatrix', 'exportFileName', 'revertInferred',
            'attToolsFor', 'openResolve', 'openExcuse', 'openCorrect', 'doScan', 'doExport']) {
            expect(s).toContain(k);
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

    test('W2-3: الورديات والكشف الشهري والتدقيق الصارم حاضرة بأبوابها', () => {
        const s = src();
        for (const k of ['data-v2-sh-month', 'data-v2-sh-text', 'data-v2-sh-suggest',
            'data-v2-sh-go', 'data-v2-sh-result', 'data-v2-mo-month', 'data-v2-mo-load',
            'data-v2-mo-print', 'data-v2-mo-body', 'data-v2-au-month', 'data-v2-au-load',
            'data-v2-au-body', 'validateShiftsText', 'suggestShiftLines',
            'withSuggestedLines', 'formatShiftsResult', 'fetchShiftsAnalysis', 'applyShifts',
            'fetchStrictAudit', 'summarizeAudit', 'fetchMonthlyAttendance',
            'buildMonthlySheet', 'minutesToHM', 'openShifts', 'submitShifts',
            'openMonthly', 'loadMonthly', 'openAudit', 'loadAudit', 'printNow']) {
            expect(s).toContain(k);
        }
    });

    test('الكشك V2-native: Html5Qrcode من vendor — لا scanner.js ولا بقايا openScanner', () => {
        const s = src();
        expect(s).toContain('ensureHtml5Qrcode');
        expect(s).toMatch(/new window\.Html5Qrcode\('v2att-scan'/);
        expect(s).not.toContain('openScanner');
        const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toMatch(/scanner\.js/);
    });

    test('الكاميرا تخص اللوحة: الفتح والإغلاق واستقبال المسحة والهدم يوقفون العدسة', () => {
        const s = src();
        expect(s).toMatch(/function stopScan\(\)/);
        expect((s.match(/stopScan\(\);/g) || []).length).toBeGreaterThanOrEqual(8);
        expect(s).toMatch(/destroy\(\)\s*\{\s*stopScan\(\);/);
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
        const at = host.indexOf('attendanceScreen = mountAttendanceScreen(');
        expect(at).toBeGreaterThan(-1);
        const mount = host.slice(at, at + 800);
        expect(mount).toMatch(/userId: u\.id != null \? u\.id : \(u\.sub != null \? Number\(u\.sub\) : null\)/);
        expect(mount).toMatch(/userName: String\(u\.name \|\| u\.username \|\| ''\)/);
        expect(mount).toMatch(/confirmFn: \(message\) => window\.confirm\(message\)/);
    });
});
