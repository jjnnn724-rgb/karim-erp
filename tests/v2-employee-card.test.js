/**
 * v2-employee-card.test.js — عقد بطاقة الموظف في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-employees.test.js: the repository runs
 * inside a vm with its one dependency (apiFetch) stubbed, and the screen is
 * asserted as a source contract.
 *
 * What is pinned here is the part that used to live only inside a painter
 * (features/smart-card.js:134-318) and could therefore drift unseen:
 *   • the KPI arithmetic reads the SERVER summary — it never re-derives
 *     lateness from checkIn strings, which is the bug the legacy file itself
 *     documents at :152-153
 *   • zero working days is a stated dash, never «100% of nothing»
 *   • the badge thresholds are the legacy four, in the legacy order
 *   • the estimated deduction is the legacy equation, and it refuses to
 *     divide by zero the way smart-card.js:198 did
 *   • one print call serves three paper modes — the roster, the QR card and
 *     the whole employee card
 *   • (W2-5) the day/range sheet takes each row's state from the server's own
 *     `lateMinutes`/`needsReview` fields — the legacy sheet compared against
 *     `employee.shift_hours`, a field the endpoint never sends, and printed
 *     «إجمالي الساعات» from `summary.totalHours`, which it never sends either
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'employee-card-repo.js');
const ATT_REPO = path.join(V2, 'data', 'attendance-repo.js');
const EMPLOYEES_REPO = path.join(V2, 'data', 'employees-repo.js');
const SCREEN = path.join(V2, 'screens', 'employees.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');

const COLLECT = [
    'CARD_BADGES', 'fetchEmployeeSchedule', 'scheduleNotice',
    'cardKpis', 'cardPayroll', 'systemQrText', 'humanQrText',
    'MAX_RANGE_DAYS', 'rangeDays', 'rangeReportRows', 'fetchLuxCardHtml',
];

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        Set, Map, Intl,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoHarness(payload) {
    const calls = [];
    const apiFetch = jest.fn(async (p) => {
        calls.push(p);
        return payload || {};
    });
    return { calls, repo: loadEsm(REPO, { apiFetch, isWeeklyOff: weeklyOffAuthority() }, COLLECT) };
}

/**
 * بطاقة الكشف تسأل attendance-repo عن يوم الراحة، والاختبار يحمّلها من بابها
 * الحقيقي لا من نسخة تُكتب هنا فتنفصل عن الأصل يومًا.
 */
function weeklyOffAuthority() {
    const ctx = loadEsm(ATT_REPO, { apiFetch: async () => ({}) }, ['isWeeklyOff']);
    return ctx.isWeeklyOff;
}

/** The luxury door is a raw fetch (the response is an HTML page, not JSON). */
function luxHarness(res) {
    const calls = [];
    const fetchStub = jest.fn(async (url, opts) => {
        calls.push({ url, opts });
        return {
            ok: res.ok,
            status: res.status,
            text: async () => res.body || '',
            clone: () => ({ json: async () => res.json || {} }),
        };
    });
    const repo = loadEsm(REPO, {
        fetch: fetchStub,
        API_BASE: 'https://erp.local/api',
        window: { _jwt: 'T', _appKey: 'K' },
    }, COLLECT);
    return { calls, repo };
}

describe('V2 employee card repository (بطاقة الموظف)', () => {
    test('the schedule door hits the server path and refuses a non-id', async () => {
        const { calls, repo } = repoHarness({ ok: true, scheduled: [] });
        await repo.fetchEmployeeSchedule(84);
        expect(calls).toEqual(['/hr/shift-schedule/84']);
        await expect(repo.fetchEmployeeSchedule('abc')).rejects.toThrow('معرف الموظف غير صحيح');
        await expect(repo.fetchEmployeeSchedule(-1)).rejects.toThrow('معرف الموظف غير صحيح');
        expect(calls).toHaveLength(1);          // a rejected id never reaches the network
    });

    test('a scheduled shift is the FIRST future row, and the rest are just a count', () => {
        const { repo } = repoHarness();
        const n = repo.scheduleNotice({
            scheduled: [
                { effective_from: '2026-11-01T00:00:00.000Z', shift_start: '16:00:00', shift_karim: '12' },
                { effective_from: '2026-12-01', shift_start: '08:00', shift_karim: 10 },
            ],
        });
        expect(n).toEqual({ effectiveFrom: '2026-11-01', start: '16:00', hours: '12', extra: 1 });
        expect(repo.scheduleNotice({ scheduled: [] })).toBeNull();
        expect(repo.scheduleNotice({})).toBeNull();
        expect(repo.scheduleNotice(null)).toBeNull();
        expect(repo.scheduleNotice({ scheduled: 'nope' })).toBeNull();   // a shape that is not a list is silence
    });

    test('the KPIs are the server summary, and zero days is a dash not a percentage', () => {
        const { repo } = repoHarness();
        const k = repo.cardKpis({
            daysPresent: 20, completeDays: 18, lateDays: 3, reviewDays: 1,
            totalLateHours: 2.5, totalLateMinutes: 150,
        });
        expect(k.workDays).toBe(20);
        expect(k.lateDays).toBe(3);
        expect(k.rate).toBe(85);                        // (20-3)/20
        expect(k.lateHours).toBe(2.5);
        expect(k.lateMinutes).toBe(150);
        expect(k.badge).toBe('ممتاز');
        expect(k.badgeTone).toBe('info');               // 85 is the legacy second tier

        const empty = repo.cardKpis({});
        expect(empty.workDays).toBe(0);
        expect(empty.rate).toBeNull();
        expect(empty.badge).toBeNull();
        expect(empty.badgeTone).toBe('neutral');
        expect(empty.lateHours).toBe(0);
    });

    test('the four badge tiers keep the legacy thresholds and their order', () => {
        const { repo } = repoHarness();
        const at = (lateDays) => repo.cardKpis({ daysPresent: 100, lateDays });
        expect(at(0)).toMatchObject({ rate: 100, badge: 'ممتاز', badgeTone: 'success' });
        expect(at(5)).toMatchObject({ rate: 95, badge: 'ممتاز', badgeTone: 'success' });
        expect(at(6)).toMatchObject({ rate: 94, badge: 'ممتاز', badgeTone: 'info' });
        expect(at(15)).toMatchObject({ rate: 85, badge: 'ممتاز', badgeTone: 'info' });
        expect(at(16)).toMatchObject({ rate: 84, badge: 'جيد', badgeTone: 'warning' });
        expect(at(30)).toMatchObject({ rate: 70, badge: 'جيد', badgeTone: 'warning' });
        expect(at(31)).toMatchObject({ badge: 'يحتاج تحسين', badgeTone: 'danger' });
        expect(repo.CARD_BADGES.map((b) => b.label)).toEqual(['ممتاز', 'ممتاز', 'جيد', 'يحتاج تحسين']);
    });

    test('the estimated deduction is the legacy equation — and it never divides by zero', () => {
        const { repo } = repoHarness();
        const p = repo.cardPayroll({ salary: 4000, lateMinutes: 150, workDays: 20 });
        expect(p.basic).toBe(4000);
        expect(p.deductionHours).toBe(3);                       // round(150/60)
        expect(p.deduction).toBe(60);                           // 3 * 4000/(20*10)
        expect(p.net).toBe(3940);
        expect(p.estimated).toBe(true);

        // smart-card.js:198 divided by (0 * 10) and printed a net of 0 — a
        // salary nobody lost. No attendance, no estimate.
        expect(repo.cardPayroll({ salary: 4000, lateMinutes: 150, workDays: 0 })).toBeNull();
        expect(repo.cardPayroll({ salary: null, lateMinutes: 10, workDays: 20 })).toBeNull();
        expect(repo.cardPayroll({})).toBeNull();

        // an over-deduction is stated at zero, never at a negative salary
        const capped = repo.cardPayroll({ salary: 100, lateMinutes: 6000, workDays: 1 });
        expect(capped.net).toBe(0);
        // no lateness at all is a zero deduction, not a missing field
        expect(repo.cardPayroll({ salary: 3000, lateMinutes: 0, workDays: 20 }))
            .toMatchObject({ deductionHours: 0, deduction: 0, net: 3000 });
    });

    test('the system QR carries the server payload verbatim, never a rebuilt one', () => {
        const { repo } = repoHarness();
        const payload = { cardId: 'C-1', token: 'abc', qrVersion: 2 };
        expect(repo.systemQrText({ qrPayload: payload })).toBe(JSON.stringify(payload));
        expect(repo.systemQrText({})).toBe('');
        expect(repo.systemQrText(null)).toBe('');
    });

    test('the human QR is seven labelled lines, and an absent field stays a stated dash', () => {
        const { repo } = repoHarness();
        const text = repo.humanQrText({
            employeeName: 'أحمد', employeeCode: 'EMP-1', deptName: 'المطبخ',
            position: 'طاهٍ', deviceUserId: '42', cardId: 'C-9', company: 'مطعم كريم',
        });
        const lines = text.split('\n');
        expect(lines).toHaveLength(7);
        expect(lines[0]).toBe('مطعم كريم — بطاقة موظف');
        expect(lines[1]).toBe('الاسم: أحمد');
        expect(lines[6]).toBe('رقم البطاقة: C-9');

        const bare = repo.humanQrText({ employeeName: 'بلا قسم' });
        expect(bare.split('\n')[0]).toBe('بطاقة موظف');                 // no company, no dangling dash
        expect(bare).toContain('القسم: —');
        expect(bare.split('\n')).toHaveLength(7);
    });

    test('rangeDays is inclusive on both ends, capped at the legacy 62, and silent on a bad shape', () => {
        const { repo } = repoHarness();
        expect(repo.MAX_RANGE_DAYS).toBe(62);
        expect(repo.rangeDays('2026-10-01', '2026-10-05'))
            .toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05']);
        expect(repo.rangeDays('2026-02-27', '2026-03-02'))            // month wrap
            .toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
        expect(repo.rangeDays('2026-10-05', '2026-10-01')).toEqual([]);   // reversed is empty, not a backwards walk
        expect(repo.rangeDays('', '2026-10-01')).toEqual([]);
        expect(repo.rangeDays('2026-1-1', '2026-10-01')).toEqual([]);     // not ISO
        expect(repo.rangeDays('2026-01-01', '2026-12-31')).toHaveLength(62);
    });

    test('a range row takes its state from the server fields, and an empty day is still a row', () => {
        const { repo } = repoHarness();
        const model = repo.rangeReportRows({
            employee: { id: 7, name: 'أحمد' },
            summary: {
                from: '2026-10-01', to: '2026-10-06',
                daysPresent: 5, completeDays: 3, lateDays: 1, reviewDays: 1,
                reviewMinutes: 45, totalKarim: 21.5, totalLateMinutes: 90, totalLateHours: 1.5,
            },
            records: [
                { date: '2026-10-01', checkIn: '09:00', checkOut: '17:00', workMinutes: 480, lateMinutes: 0 },
                { date: '2026-10-02', checkIn: '09:30', checkOut: '17:00', workMinutes: 450, lateMinutes: 30 },
                { date: '2026-10-03', checkIn: '09:00', checkOut: '09:00', workMinutes: 0, lateMinutes: 0, needsReview: true },
                { date: '2026-10-04', checkIn: '', checkOut: '', workMinutes: 0, lateMinutes: 0 },
                { date: '2026-10-05', checkIn: '09:00', checkOut: '', workMinutes: 0, lateMinutes: 0 },
            ],
        });
        expect(model.rows.map((r) => [r.date, r.state])).toEqual([
            ['2026-10-01', 'in-time'],
            ['2026-10-02', 'late'],
            ['2026-10-03', 'review'],
            ['2026-10-04', 'no-in'],
            ['2026-10-05', 'no-out'],
            ['2026-10-06', 'absent'],                                   // no record is a stated absence
        ]);
        expect(model.rows[1].lateMinutes).toBe(30);
        expect(model.rows[1].minutes).toBe(450);
        expect(model.summary.onTimeDays).toBe(1);                       // only 10-01 is complete and unpinned
        expect(model.summary.totalKarim).toBe(21.5);                    // the field the endpoint DOES send
        expect(model.summary.totalLateMinutes).toBe(90);                // the server's own figure, not a re-sum
        expect(model.summary.lateDays).toBe(1);
        expect(model.truncated).toBe(false);
        expect(model.employee.name).toBe('أحمد');

        const empty = repo.rangeReportRows({});
        expect(empty.rows).toEqual([]);
        expect(empty.employee).toBeNull();
        expect(empty.summary.totalKarim).toBe(0);
        expect(empty.summary.onTimeDays).toBe(0);
    });

    test('the range arithmetic never invents a shift — the legacy read two fields that are never sent', () => {
        const src = fs.readFileSync(REPO, 'utf8');
        const body = src.slice(
            src.indexOf('export function rangeReportRows'),
            src.indexOf('export async function fetchLuxCardHtml'),
        );
        expect(body).not.toMatch(/shift_karim|shift_hours/);            // no shift comparison at all
        expect(body).toMatch(/needsReview/);                            // the server's own flag
        expect(body).toMatch(/lateMinutes/);                            // the server's own figure
        expect(body).toMatch(/summary\.totalKarim/);                    // :241 — not the never-sent totalHours
        expect(body).not.toMatch(/totalHours/);
    });

    test('يوم راحةٍ مجدول لا يُطبع «لم يحضر» — العلامة من باب الحضور لا من نسخة هنا', () => {
        const { repo } = repoHarness();
        // 2026-10-01 خميس، فكل جمعة في هذا الشهر يوم 2 و9 و16 و23 و30 —
        // وday_off المخزّن 5 = الجمعة (WEEKDAY_AR في attendance-repo).
        const model = repo.rangeReportRows({
            employee: { id: 7, name: 'أحمد', day_off: 5 },
            summary: { from: '2026-10-02', to: '2026-10-09' },
            records: [
                { date: '2026-10-03', checkIn: '09:00', checkOut: '17:00', workMinutes: 480, lateMinutes: 0 },
                { date: '2026-10-05', checkIn: '', checkOut: '', workMinutes: 0, lateMinutes: 0 },
                { date: '2026-10-09', checkIn: '09:20', checkOut: '17:00', workMinutes: 460, lateMinutes: 20 },
            ],
        });
        expect(model.rows.map((r) => [r.date, r.state])).toEqual([
            ['2026-10-02', 'day-off'],       // جمعةٌ بلا بصمة: راحةٌ مجدولة
            ['2026-10-03', 'in-time'],
            ['2026-10-04', 'absent'],        // سبتٌ غير مجدول ولا سجل: غيابٌ يُقال بصراحة
            ['2026-10-05', 'no-in'],         // monday: صفٌّ بلا دخول، لا راحة
            ['2026-10-06', 'absent'],
            ['2026-10-07', 'absent'],
            ['2026-10-08', 'absent'],
            ['2026-10-09', 'late'],          // بُصم في راحته: الحضور حقيقةٌ أحدث من الجدول
        ]);
        expect(model.rows.filter((r) => r.state === 'day-off')).toHaveLength(1);
        // بلا employee في الردّ (مدىً خالٍ — hr-routes.js:242) لا تُدَّعى راحة:
        const blind = repo.rangeReportRows({ summary: { from: '2026-10-02', to: '2026-10-02' } });
        expect(blind.rows.map((r) => r.state)).toEqual(['absent']);
        // واللوحة تسمّي الحالة الجديدة من نفس القاموس، وتسقط إلى «يحتاج مراجعة»
        // لا إلى «لم يحضر» إن انفصل يومًا مفتاحٌ عن قاموسه.
        const s = fs.readFileSync(SCREEN, 'utf8');
        expect(s).toMatch(/'day-off': \{ label: 'راحة أسبوعية', tone: 'neutral' \}/);
        expect(s).toMatch(/ATT_STATE\[r\.state\] \|\| ATT_STATE\.review/);
        expect(s).toMatch(/راحة أسبوعية مجدولة: \$\{formatInt\(offDays\)\} يومًا/);
    });

    test('the luxury door fetches the generated HTML with its own headers, never through apiFetch', async () => {
        const ok = luxHarness({ ok: true, status: 200, body: '<html>البطاقة</html>' });
        await expect(ok.repo.fetchLuxCardHtml(84)).resolves.toBe('<html>البطاقة</html>');
        expect(ok.calls[0].url).toBe('https://erp.local/api/hr/employees/84/lux-card');
        expect(ok.calls[0].opts.headers).toEqual({ Authorization: 'Bearer T', 'x-api-key': 'K' });

        const refused = luxHarness({ ok: false, status: 422, json: { message: 'الموظف بلا رقم بصمة' } });
        await expect(refused.repo.fetchLuxCardHtml('9')).rejects.toThrow('الموظف بلا رقم بصمة');

        // a non-JSON error page still names the status instead of going silent
        const broke = luxHarness({ ok: false, status: 500, body: '<html>error</html>' });
        await expect(broke.repo.fetchLuxCardHtml(9)).rejects.toThrow('تعذر توليد البطاقة (500)');

        const { repo } = luxHarness({ ok: true, status: 200 });
        await expect(repo.fetchLuxCardHtml('abc')).rejects.toThrow('معرف الموظف غير صحيح');
    });
});

describe('V2 employees screen — the card the كشف now paints', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('the screen reads the card layer through one versioned door', () => {
        const s = screen();
        expect(s).toMatch(/from '\.\.\/data\/employee-card-repo\.js\?v=[0-9]+(\.[0-9]+)*'/);
        for (const name of ['fetchEmployeeSchedule', 'scheduleNotice', 'cardKpis', 'cardPayroll', 'systemQrText', 'humanQrText']) {
            expect(s).toMatch(new RegExp(`\\b${name}\\b`));
        }
        // the screen owns no URL of its own
        expect(s).not.toMatch(/fetch\(/);
        expect(s).not.toMatch(/\/hr\//);
    });

    test('the card has a badge slot, a KPI slot and a schedule slot, all born with the panel', () => {
        const s = screen();
        const at = s.indexOf('function openFilePanel(row)');
        expect(at).toBeGreaterThan(-1);
        const panel = s.slice(at, s.indexOf('async function fillAttendance', at));
        expect(panel).toMatch(/<span data-v2-file-badge><\/span>/);
        expect(panel).toMatch(/<div class="erp-person__meta" data-v2-file-sched><\/div>/);
        expect(panel).toMatch(/<div data-v2-file-kpis><\/div>/);
        expect(panel).toMatch(/data-v2-print="card"/);
    });

    test('the badge tone comes from the fixed vocabulary, and the rate is a native progress bar', () => {
        const s = screen();
        expect(s).toMatch(/data-tone="\$\{k\.badgeTone\}"/);
        expect(s).toMatch(/<progress class="erp-emp-rate" max="100" value="\$\{esc\(String\(k\.rate\)\)\}"/);
        expect(s).not.toMatch(/style="[^"]*width:/);          // no width smuggled in a style channel
    });

    test('zero attendance days says so instead of painting a rate', () => {
        const s = screen();
        expect(s).toMatch(/if \(k\.workDays <= 0\)/);
        expect(s).toMatch(/لا أيام حضور مسجّلة هذا الشهر — لا نسبة تُحسب ولا خصم يُقدَّر\./);
    });

    test('البطاقة لا تطبع «0.00» لراتبٍ غير مسجّل — خريطة الزوائد تحفظ الغياب', () => {
        // العمود يجوز أن يكون NULL في القاعدة، و Number(null) هو 0: بطاقةٌ
        // تعرض راتبًا صفرًا ثم تُقدّر خصمًا فوقه تقول رقمًا لم يكن.
        const ctx = loadEsm(EMPLOYEES_REPO, { apiFetch: jest.fn(async () => ({})) }, ['cardExtrasMap']);
        const map = ctx.cardExtrasMap([
            { id: 1, salary: null },
            { id: 2 },
            { id: 3, salary: '' },
            { id: 4, salary: '6000' },
            { id: 5, salary: 0 },
        ]);
        expect(map.get('1').salary).toBe(null);
        expect(map.get('2').salary).toBe(null);
        expect(map.get('3').salary).toBe(null);
        expect(map.get('4').salary).toBe(6000);
        expect(map.get('5').salary).toBe(0);                    // صفرٌ مسجّل يبقى صفرًا، لا غيابًا
        // بقية الزوائد لا تتغير: الحارس يشتغل على الراتب وحده
        expect(map.get('1')).toEqual(expect.objectContaining({ deviceUserId: '', shift_karim: 0 }));
        const { repo } = repoHarness();
        expect(repo.cardPayroll({ salary: null, lateMinutes: 155, workDays: 11 })).toBe(null);
        const s = screen();
        expect(s).toMatch(/const hasSalary = ex\.salary !== null && ex\.salary !== undefined;/);
        // سطر الكشف واحدٌ وخلف الحارس (تسمية نموذج التعديل شيءٌ آخر)
        const at = s.indexOf('function openFilePanel(row)');
        const panel = s.slice(at, s.indexOf('async function fillAttendance', at));
        expect(panel.match(/الراتب الأساسي/g)).toHaveLength(1);
        expect(panel).toMatch(/hasSalary \? `<div class="erp-emp-fact"><i class="ji" data-i="banknote"/);
    });

    test('the schedule fill is silent when the server has nothing scheduled', () => {
        const s = screen();
        expect(s).toMatch(/async function fillSchedule\(row, seq\)/);
        expect(s).toMatch(/const n = scheduleNotice\(res\);\n\s*if \(!n\) \{return;\}/);
        expect(s).toMatch(/catch \(_\) \{return;\}/);         // a failed read is no badge, not an error card
    });

    test('قيمةٌ غائبة في السطر المجدول تحذف وقتها وساعتها — لا «()س» ولا «: »', () => {
        const { repo } = repoHarness();
        // Number(null) هو 0: بلا هذا الحرس تُطبع «(0س)» لمعلومةٍ لم تُكتب
        const blank = repo.scheduleNotice({ scheduled: [{ effective_from: '2026-11-01', shift_start: null, shift_karim: null }] });
        expect(blank).toEqual({ effectiveFrom: '2026-11-01', start: '', hours: '', extra: 0 });
        expect(repo.scheduleNotice({ scheduled: [{ effective_from: '2026-11-01', shift_start: '16:00', shift_karim: 0 }] }).hours).toBe('');
        expect(repo.scheduleNotice({ scheduled: [{ effective_from: '2026-11-01', shift_start: '16:00', shift_karim: '12' }] }).hours).toBe('12');
        const s = screen();
        expect(s).toMatch(/const time = n\.start \? `: <span class="erp-num" dir="ltr">\$\{esc\(n\.start\)\}<\/span>` : '';/);
        expect(s).toMatch(/const hours = n\.hours \? ` \(\$\{esc\(n\.hours\)\}س\)` : '';/);
        expect(s).toMatch(/\$\{esc\(n\.effectiveFrom\)\}<\/span>\$\{time\}\$\{hours\}\$\{extra\}/);
    });

    test('the payroll figure is stated as estimated and points at the payroll screen', () => {
        const s = screen();
        expect(s).toMatch(/cardPayroll\(\{ salary: ex\.salary, lateMinutes: k\.lateMinutes, workDays: k\.workDays \}\)/);
        expect(s).toMatch(/صافي تقديري/);
        expect(s).toMatch(/تقديري — الخصم المعتمد يُحتسب في كشف الرواتب\./);
    });

    test('one print call serves every paper mode — and only ONE mode rides it', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        const mode = s.match(/function printMode\(cls\) \{[\s\S]*?\n {4}\}/)[0];
        expect(mode).toMatch(/PRINT_MODES\.forEach\(\(c\) => document\.body\.classList\.remove\(c\)\)/);
        expect(mode).toMatch(/document\.body\.classList\.add\(cls\)/);
        expect(mode).toMatch(/window\.addEventListener\('afterprint', cleanup, \{ once: true \}\)/);
        expect(mode).toMatch(/setTimeout\(cleanup, 3000\)/);
        expect(mode).toMatch(/printNow\(\)/);
        // ثلاث ورقاتٌ محجوزة بأسمائها، ولا واحدة تلمس window.print مباشرةً
        for (const [fn, cls] of [['printQrCard', 'erp-v2-print-card'],
            ['printEmpCard', 'erp-v2-print-empcard'], ['printAttRange', 'erp-v2-print-dayrange']]) {
            expect(s).toMatch(new RegExp(`function ${fn}\\(\\) \\{\\n\\s+printMode\\('${cls}'\\);\\n\\s+\\}`));
        }
        expect(s).toMatch(/if \(printBtn\.getAttribute\('data-v2-print'\) === 'card'\) \{printEmpCard\(\); return;\}/);
    });

    test('both QR codes exist and each save writes its own file', () => {
        const s = screen();
        expect(s).toMatch(/systemQrText\(card\)/);
        expect(s).toMatch(/humanQrText\(\{/);
        expect(s).toMatch(/data-v2-qr="save-human"/);
        expect(s).toMatch(/panelData\.humanQrUrl = humanUrl/);
        expect(s).toMatch(/employee-\$\{kind === 'save' \? 'qr' : 'data'\}/);
    });

    test('the card-CSS layer is tokens only, and the whole-card paper mode hides the roster', () => {
        const c = css();
        expect(c).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(c).not.toMatch(/rgba?\(/);
        expect(c).toMatch(/\.erp-v2-employees \.erp-emp-rate \{/);
        expect(c).toMatch(/\.erp-v2-employees \.erp-emp-sched \{/);
        expect(c).toMatch(/\.erp-v2-employees \.erp-emp-qr__pair \{/);
        expect(c).toMatch(/body\.erp-v2-print-empcard \.erp-v2-employees \.erp-card \{ display: none !important; \}/);
    });

    test('the day/range sheet is born with the panel, and its print button waits for a report', () => {
        const s = screen();
        const at = s.indexOf('function openFilePanel(row)');
        const panel = s.slice(at, s.indexOf('async function fillAttendance', at));
        expect(panel).toMatch(/\$\{attRangeBlock\(\)\}/);
        const block = s.match(/function attRangeBlock\(\) \{[\s\S]*?\n\}/)[0];
        expect(block).toMatch(/data-v2-att-from/);
        expect(block).toMatch(/data-v2-att-to/);
        expect(block).toMatch(/data-v2-att="day"/);
        expect(block).toMatch(/data-v2-att="range"/);
        expect(block).toMatch(/data-v2-att="print" disabled/);      // nothing to print until a report lands
        expect(block).toMatch(/erp-no-print/);                      // the controls never reach the paper
        expect(s).toMatch(/const attBtn = event\.target\.closest\('\[data-v2-att\]'\)/);
        expect(s).toMatch(/if \(kind === 'print'\) \{printAttRange\(\); return;\}/);
        expect(s).toMatch(/if \(to < from\) \{notify\('تاريخ النهاية يسبق تاريخ البداية'\); return;\}/);
        expect(s).toMatch(/btn\.disabled = !on;/);
    });

    test("the range sheet's own paper class is the one the CSS dresses", () => {
        const s = screen();
        // النداء الوحيد والوساطة مثبَّتان أعلى؛ هنا الورقة نفسها: اسم الشارة
        // الذي تضيفه اللوحة هو الاسم الذي تُلبسه stylesheet.
        const pr = s.match(/function printAttRange\(\) \{[\s\S]*?\n {4}\}/)[0];
        expect(pr).toMatch(/printMode\('erp-v2-print-dayrange'\)/);
        expect(s).toMatch(/if \(kind === 'print'\) \{printAttRange\(\); return;\}/);
        expect(css()).toMatch(/body\.erp-v2-print-dayrange/);
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
    });

    test('the luxury card is a server page shown in the in-app viewer, drawn only where the server admits', () => {
        const s = screen();
        expect((s.match(/window\.open\(/g) || []).length).toBe(0);   // popups are blocked in the Android WebView
        const lx = s.match(/async function printLux\(\) \{[\s\S]*?\n {4}\}/)[0];
        expect(lx).toMatch(/openInAppReport\('بطاقة الموظف'\)/);    // opened before the request, inside the click
        expect(lx).toMatch(/fetchLuxCardHtml\(panelRow\.id\)/);
        expect(lx).toMatch(/win\.document\.write\(html\)/);
        expect(lx).toMatch(/win\.close\(\)/);
        expect(lx).not.toMatch(/اسمح بالنوافذ المنبثقة/);
        // ADMIN_ROLES (hr-routes.js:15) is exactly empWriteVisible — no button
        // is painted for a role the server would answer 403 to.
        expect(s).toMatch(/\$\{canWrite \? `<button type="button" class="erp-btn erp-btn--sm erp-btn--ghost" data-v2-lux>/);
        expect(s).not.toMatch(/fetch\(/);
    });

    test('the row states are a fixed vocabulary, and the sheet never re-derives lateness', () => {
        const s = screen();
        expect(s).toMatch(/const ATT_STATE = \{/);
        const table = s.match(/const ATT_STATE = \{[\s\S]*?\n\};/)[0].replace(/'/g, '');
        for (const key of ['absent', 'review', 'no-in', 'no-out', 'late', 'in-time']) {
            expect(table).toContain(`${key}: { label: `);
        }
        expect(s).toMatch(/host\.innerHTML = attRangeHtml\(rangeReportRows\(res\)\)/);
        expect(s).toMatch(/minutesToHM\(r\.lateMinutes\)/);
        expect(s).toMatch(/weekdayAr\(r\.date\)/);
    });

    test('the day/range paper mode hides the roster and lifts the scroll cap — tokens only', () => {
        const c = css();
        expect(c).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(c).not.toMatch(/rgba?\(/);
        expect(c).toMatch(/\.erp-v2-employees \.erp-emp-att \{/);
        expect(c).toMatch(/body\.erp-v2-print-dayrange \.erp-v2-employees \.erp-emp-panel__body > :not\(\[data-v2-file-range\]\) \{ display: none !important; \}/);
        expect(c).toMatch(/body\.erp-v2-print-dayrange \.erp-v2-employees \.erp-emp-att__scroll \{\s*max-block-size: none;/);
    });
});
