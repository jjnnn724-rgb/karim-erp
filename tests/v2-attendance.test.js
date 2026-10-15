/**
 * v2-attendance.test.js — عقد شاشة 01 «الحضور والانصراف» في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-briefing.test.js: these are browser ESM
 * files and jest runs with testEnvironment:'node', so the repository is
 * loaded into a vm with its single dependency (apiFetch) stubbed, and the
 * screen is asserted as a source contract.
 *
 * What is pinned here is exactly the part a manager cannot eyeball:
 *   • a share needs a real denominator: zero rows give a stated dash, not
 *     "0.0%" of nothing and not NaN
 *   • the average worked time counts ONLY rows that have both punches, and
 *     the row it excludes is still visible in «بصمة ناقصة» — one incomplete
 *     record is never allowed to vanish from one number and appear in another
 *   • bars group by the STORED date string, so the chart and the table under
 *     it can never disagree about which day a row belongs to
 *   • period segments are computed backward from real dates, never from a
 *     hard-coded "last 7 days" that drifts across a month boundary
 *   • filters only ever offer values the loaded rows contain; a filtered
 *     view says its own scope instead of reading like the whole period
 *   • the screen owns no network layer, has no inline handlers (CSP nonce),
 *     escapes payload strings, and cannot stack two loads
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { TextDecoder } = require('util');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'attendance-repo.js');
const SCREEN = path.join(V2, 'screens', 'attendance.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const TOKENS = path.join(APP, 'css', 'v2', 'erp-tokens.css');
const V2_HTML = path.join(APP, 'v2.html');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = fs.readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    // `export const X` becomes a lexical binding that never lands on the vm's
    // global object, so the harness publishes the named bindings itself.
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error, Date, Math, Promise,
        Set, Map, encodeURIComponent, decodeURIComponent, TextDecoder, Uint8Array, Intl,
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
        return payload || { data: [], total: 0 };
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }, ['PERIODS', 'ATTENDANCE_STATE_AR']) };
}

/** A day's worth of raw server rows, deliberately mixed. */
function rawRows() {
    return [
        { id: 1, employeeId: '7', date: '2026-10-13', checkIn: '09:00', checkOut: '17:00', late: false, early_leave: false, on_leave: false, source: 'zk' },
        { id: 2, employeeId: '8', date: '2026-10-13', checkIn: '10:12', checkOut: '18:00', late: true, source: 'zk' },
        { id: 3, employeeId: '9', date: '2026-10-13', checkIn: '09:05', checkOut: '13:00', early_leave: true, source: 'manual' },
        { id: 4, employeeId: '10', date: '2026-10-12', checkIn: '09:00', checkOut: '', source: 'zk' },
        { id: 5, employeeId: '11', date: '2026-10-12', checkIn: '', checkOut: '', on_leave: true, source: 'hr' },
        { id: 6, employeeId: '12', date: '2026-10-11', checkIn: '', checkOut: '', source: 'zk' },
    ];
}

function mappedRows(repo) {
    const empById = repo.employeeMap
        ? repo.employeeMap([])
        : new Map();
    return rawRows().map((r) => repo.attendanceToRow(r, empById));
}

describe('V2 attendance repository — honesty of the derived numbers', () => {
    test('a share needs a real base: zero rows is a stated dash, never 0.0%', () => {
        const { repo } = repoHarness();
        const empty = repo.sharePill(0, 0, 'حاضر');
        expect(empty.text).toBe('—');
        expect(empty.on).toBe(false);
        expect(empty.aria).toMatch('لا سجلات');
        const some = repo.sharePill(3, 8, 'متأخر');
        expect(some.text).toBe('37.5%');
        expect(some.aria).toMatch('3 من 8');
    });

    test('an empty payload yields zeros, never NaN', () => {
        const { repo } = repoHarness();
        const kpis = repo.buildAttendanceKpis([]);
        expect(JSON.stringify(kpis)).not.toMatch('NaN');
        expect(kpis.every((k) => k.pill && k.pill.text && k.hint)).toBe(true);
        expect(kpis.find((k) => k.id === 'total').value).toBe('0');
    });

    test('six chips, unique ids, and every count is arithmetic on the rows', () => {
        const { repo } = repoHarness();
        const rows = mappedRows(repo);
        const kpis = repo.buildAttendanceKpis(rows);
        expect(kpis).toHaveLength(6);
        expect(new Set(kpis.map((k) => k.id)).size).toBe(6);
        const by = Object.fromEntries(kpis.map((k) => [k.id, k]));
        expect(by.total.value).toBe('6');
        expect(by.late.value).toBe('1');
        expect(by.early.value).toBe('1');
        expect(by.missing.value).toBe('1');   // the 09:00-with-no-out row
        expect(by.present.value).toBe('1');
        // leave + none live in the legend, not in the chips
        const legend = repo.buildAttendanceLegend(rows);
        expect(legend.map((l) => l.count)).toEqual([1, 1]);
    });

    test('the average uses completed rows only, and names its own base', () => {
        const { repo } = repoHarness();
        const rows = mappedRows(repo);
        const avg = repo.averageWorked(rows);
        // only ids 1,2,3 have both punches: 480 + 468 + 235 minutes = 1183/3
        expect(avg.base).toBe(3);
        expect(avg.minutes).toBe(Math.round((480 + 468 + 235) / 3));
        expect(avg.text).toBe('6:34');
        expect(avg.hint).toMatch('3');
        expect(repo.averageWorked([{ minutes: null }]).text).toBe('—');
        expect(repo.averageWorked([]).hint).toMatch('لا سجل');
        const kpi = repo.buildAttendanceKpis(rows).find((k) => k.id === 'avg');
        expect(kpi.pill.aria).toMatch('3');
        expect(kpi.unit).toBe('س:د');
    });

    test('bars group by the stored date and label it from that same string', () => {
        const { repo } = repoHarness();
        const bars = repo.buildPunchBars(mappedRows(repo));
        expect(bars.map((b) => b.date)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
        expect(bars[2]).toMatchObject({ label: '13/10', records: 3, inCount: 3, outCount: 3, late: 1 });
        expect(bars[1]).toMatchObject({ date: '2026-10-12', records: 2, inCount: 1, outCount: 0 });
        expect(bars[0].label).toBe('11/10');
        expect(repo.buildPunchBars([])).toEqual([]);
        // a garbage date is dropped rather than drawn as a mystery column
        expect(repo.buildPunchBars([{ date: 'garbage', in: '09:00', out: '—', state: 'missing' }])).toEqual([]);
    });

    test('bars keep the tail of a long range, oldest first, and say nothing false', () => {
        const { repo } = repoHarness();
        const rows = Array.from({ length: 40 }, (_, i) => ({
            date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
            in: '09:00', out: '17:00', state: 'present', minutes: 480, employeeId: '1',
        }));
        const bars = repo.buildPunchBars(rows, { maxDays: 14 });
        expect(bars).toHaveLength(14);
        expect(bars[0].date < bars[13].date).toBe(true);
        expect(repo.buildPunchBars(rows, { maxDays: 0 })).toHaveLength(28);
    });

    test('filters only offer what loaded, and unresolved departments stay visible under "all"', () => {
        const { repo } = repoHarness();
        const rows = [
            { dept: 'المطبخ', state: 'present' }, { dept: 'الصالة', state: 'late' },
            { dept: '—', state: 'none' },
        ];
        const depts = repo.distinctValues(rows, 'dept');
        expect(depts).toHaveLength(2);                 // '—' is not a department
        expect(new Set(depts)).toEqual(new Set(['الصالة', 'المطبخ']));
        expect(depts).toEqual([...depts].sort((a, b) => a.localeCompare(b, 'ar')));
        expect(repo.applyAttendanceFilters(rows, { dept: 'all', state: 'all' })).toHaveLength(3);
        expect(repo.applyAttendanceFilters(rows, {})).toHaveLength(3);
        expect(repo.applyAttendanceFilters(rows, { dept: 'المطبخ' })).toHaveLength(1);
        expect(repo.applyAttendanceFilters(rows, { state: 'late' })).toHaveLength(1);
        expect(repo.applyAttendanceFilters(rows, { dept: 'المطبخ', state: 'late' })).toHaveLength(0);
        expect(repo.countDistinct([{ employeeId: '1' }, { employeeId: '1' }, { employeeId: '2' }], 'employeeId')).toBe(2);
    });

    test('a department name is a join; an unknown code stays the code it has', () => {
        const { repo } = repoHarness();
        const emps = new Map([
            ['7', { id: '7', name: 'محمود', department: 'KIT' }],
            ['8', { id: '8', name: 'أحمد', department: 'ZZZ' }],
        ]);
        const depts = new Map([['KIT', { code: 'KIT', name: 'المطبخ' }]]);
        const known = repo.attendanceToRow(
            { id: 1, employeeId: '7', date: '2026-10-13', checkIn: '09:00', checkOut: '17:00' }, emps, depts);
        expect(known).toMatchObject({ employee: 'محمود', dept: 'المطبخ', deptCode: 'KIT', deptResolved: true });
        const unknown = repo.attendanceToRow(
            { id: 2, employeeId: '8', date: '2026-10-13', checkIn: '09:00' }, emps, new Map());
        expect(unknown).toMatchObject({ dept: 'ZZZ', deptResolved: false }); // never renamed into a guess
        const orphan = repo.attendanceToRow({ id: 3, employeeId: '99', date: '2026-10-13' });
        expect(orphan.employee).toBe('#99');
        expect(orphan.dept).toBe('—');
    });

    test('period segments are computed backward from real dates, not hard-coded', () => {
        const { repo } = repoHarness();
        expect(repo.periodRange('today', '2026-10-13')).toEqual({ from: '2026-10-13', to: '2026-10-13' });
        expect(repo.periodRange('week', '2026-10-13')).toEqual({ from: '2026-10-07', to: '2026-10-13' });
        // crossing a month boundary is the whole point of doing the math
        expect(repo.periodRange('week', '2026-03-02')).toEqual({ from: '2026-02-24', to: '2026-03-02' });
        // 30 calendar days ending 2026-03-01 starts on 2026-01-31, inclusive
        expect(repo.periodRange('month', '2026-03-01').from).toBe('2026-01-31');
        expect(repo.periodRange('nope', '2026-03-01')).toBeNull();
        expect(repo.PERIODS.week.seg).toBeTruthy();
    });

    test('spanDays counts calendar days inclusively and refuses garbage', () => {
        const { repo } = repoHarness();
        expect(repo.spanDays('2026-10-13', '2026-10-13')).toBe(1);
        expect(repo.spanDays('2026-02-24', '2026-03-02')).toBe(7);
        expect(repo.spanDays('2026-10-13', '2026-10-07')).toBe(0);
        expect(repo.spanDays('x', '2026-10-07')).toBe(0);
    });

    test('the door is a read with validated dates, never a write', async () => {
        const { calls, repo } = repoHarness();
        await repo.fetchAttendanceRange({ from: '2026-10-07', to: '2026-10-13' });
        expect(calls[0]).toMatch('/attendance/range?from=2026-10-07&to=2026-10-13&limit=');
        await expect(repo.fetchAttendanceRange({ from: '', to: '2026-10-13' })).rejects.toThrow('حدّد');
        await expect(repo.fetchAttendanceRange({ from: '2026-10-13', to: '2026-10-07' })).rejects.toThrow('تاريخ البداية بعد');
        const limited = repoHarness();
        await limited.repo.fetchAttendanceRange({ from: '2026-10-07', to: '2026-10-13', limit: 999999 });
        expect(limited.calls[0]).toMatch('limit=50000'); // the ceiling is real
    });

    test('formatInt groups with Latin digits — the table below uses the same', () => {
        const { repo } = repoHarness();
        expect(repo.formatInt(1234)).toBe('1,234');
        expect(repo.formatInt(null)).toBe('0');
        expect(repo.formatInt(7.6)).toBe('8');
    });
});

describe('V2 attendance screen + layer (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener\('click'/);
        expect(screen()).toMatch(/addEventListener\('change'/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/attendance-repo\.js\?v=/);
    });

    test('every payload string reaching the DOM is escaped', () => {
        const s = screen();
        expect(s).toMatch(/esc\(row\.employee\)/);
        expect(s).toMatch(/esc\(k\.label\)/);
        expect(s).toMatch(/esc\(k\.pill\.aria\)/);
        expect(s).toMatch(/esc\(b\.label\)/);
        expect(s).toMatch(/title="\$\{esc\(`/);   // the bar's tooltip escapes its whole sentence
        expect(s).toMatch(/esc\(l\.label\)/);
    });

    test('an unresolved employee id is shown as what it is, never as a guessed name', () => {
        const s = screen();
        expect(s).toMatch(/row\.nameResolved/);
        expect(s).toMatch(/لم تُحلّ هوية هذا الرقم/);
    });

    test('a filtered view renames its own scope instead of posing as the period', () => {
        const s = screen();
        expect(s).toMatch(/النتيجة المصفّاة/);
        expect(s).toMatch(/محسوبة على/);
        expect(s).toMatch(/data-v2-filter-note/);
    });

    test('the date inputs are never re-rendered, so a repaint cannot steal focus', () => {
        const s = screen();
        expect(s).toMatch(/function paintSeg\(activeKind\) \{\s*q\('\[data-v2-periodseg\]'\)\.innerHTML = segBlock\(activeKind\);/);
        expect(s).toMatch(/id="v2att-from"/);
    });

    test('printing states its own limits and the button is the only print call', () => {
        const s = screen();
        expect(s).toMatch(/window\.print\(\)/);
        expect(s).toMatch(/data-v2-print-note/);
        expect(s).toMatch(/المطبوعة تعرض الصفحة الحالية/);
    });

    test('one click cannot stack two loads, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{return;\}/);
        expect(s.split('el.isConnected').length - 1).toBeGreaterThanOrEqual(2);
    });

    test('no sample figures on the live screen', () => {
        expect(screen()).not.toMatch('بيانات نموذجية');
    });

    test('the HR layer adds no new colours and no raw channels', () => {
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(css()).not.toMatch(/rgba?\(/);
    });

    test('the HR layer only uses tokens the design system defines', () => {
        const tokens = fs.readFileSync(TOKENS, 'utf8');
        const defined = new Set([...tokens.matchAll(/(--erp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
        for (const f of [HR_CSS]) {
            for (const m of fs.readFileSync(f, 'utf8').matchAll(/var\((--erp-[a-z0-9-]+)/g)) {
                expect(defined.has(m[1]) || css().includes(`${m[1]}:`)).toBe(true);
            }
        }
        expect(css()).toMatch(/--erp-space-2/);
    });

    test('the print line is invisible on screen and appears only on paper', () => {
        expect(css()).toMatch(/\.erp-v2 \.erp-print-note \{ display: none; \}/);
        expect(css()).toMatch(/@media print/);
        expect(css()).toMatch(/\.erp-table__pager \{ display: none !important; \}/);
    });

    test('the page loads the HR layer, versioned (Cloudflare caches CSS for 4h)', () => {
        const page = fs.readFileSync(V2_HTML, 'utf8');
        expect(page).toMatch(/css\/v2\/erp-hr\.css\?v=[0-9]+(\.[0-9]+)*/);
    });

    test('the host still tears the screen down on navigation', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect(p).toMatch(/attendanceScreen\.destroy\(\)/);
        expect(p).toMatch(/mountAttendanceScreen\(/);
        expect(p).toMatch(/noSessionState/);
    });
});
