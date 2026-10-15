/**
 * v2-roster.test.js — عقد شاشة الدوام (W2-1) في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-employees.test.js: browser ESM files,
 * jest with testEnvironment:'node', so the repository runs inside a vm with
 * its one dependency (apiFetch) stubbed, and the screen is asserted as a
 * source contract.
 *
 * What is pinned here is the part nobody can eyeball in a browser:
 *   • the dead-import class: the screen this file replaces called
 *     createDataTable() at mount without importing it and died on first
 *     paint. The scan below walks every screen and refuses that class
 *     anywhere in V2, not just here.
 *   • dirty-only saves: the legacy chart pushed all seven days of every
 *     touched row and ate a 422 on locked past days mid-week. This door
 *     sends exactly the cells the user edited — and the screen shows the
 *     700-cell server cap before the wire, not after.
 *   • the approval key is computed from the server's own depts answer
 *     (legacy guessed it from the role), and the confirm sentence says
 *     before the click that a save deletes this week's stored approval.
 *   • the week is the server's: navigation steps whole weeks from the
 *     weekStart the server sent (weekOf), never from a client clock.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'roster-repo.js');
const PORTAL = path.join(V2, 'data', 'portal-repo.js');
const SCREEN = path.join(V2, 'screens', 'roster.js');
const SCREENS_DIR = path.join(V2, 'screens');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const MIGRATION = path.join(V2, 'MIGRATION.md');
const PREVIEW = path.join(V2, 'preview.js');

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

/** The repo's const bindings never land on the vm global by themselves. */
const REPO_CONSTS = [
    'ROSTER_ROLES', 'ROSTER_PRIVILEGED', 'ROSTER_APPROVERS', 'ROSTER_DAY_LABELS',
    'ROSTER_MAX_CELLS', 'canRosterWrite', 'canApproveRoster', 'canPickDept', 'cellKey',
];

function repoHarness(payload) {
    const calls = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push([p, opts]);
        return payload === undefined ? {} : payload;
    });
    const repo = loadEsm(REPO, { apiFetch, URLSearchParams }, REPO_CONSTS);
    return { calls, repo };
}

describe('V2 roster repository — the mirrors and the doors', () => {
    test('the authority lists are the server lists, character for character', () => {
        const { repo } = repoHarness();
        expect(repo.ROSTER_ROLES).toEqual(['admin', 'hr', 'manager', 'dept_head', 'kitchen', 'sous_chef', 'warehouse', 'accountant']);
        expect(repo.ROSTER_PRIVILEGED).toEqual(['admin', 'hr', 'manager']);
        expect(repo.ROSTER_APPROVERS).toEqual(['hr', 'admin']);
        expect(repo.ROSTER_DAY_LABELS).toEqual(['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة']);
        expect(repo.ROSTER_MAX_CELLS).toBe(700);
    });

    test('writing, signing and picking are three different questions', () => {
        const { repo } = repoHarness();
        expect(repo.canRosterWrite('dept_head')).toBe(true);
        expect(repo.canRosterWrite('viewer')).toBe(false);
        expect(repo.canApproveRoster('hr')).toBe(true);
        expect(repo.canApproveRoster('manager')).toBe(false);
        expect(repo.canPickDept('accountant')).toBe(true);
        expect(repo.canPickDept('admin')).toBe(true);
        expect(repo.canPickDept('dept_head')).toBe(false);
    });

    test('weekOf steps whole weeks from a server-sent start and refuses junk', () => {
        const { repo } = repoHarness();
        expect(repo.weekOf('2026-10-17', 0)).toBe('2026-10-17');
        expect(repo.weekOf('2026-10-17', 1)).toBe('2026-10-24');
        expect(repo.weekOf('2026-10-17', -1)).toBe('2026-10-10');
        expect(repo.weekOf('', 1)).toBe('');
        expect(repo.weekOf(null, 1)).toBe('');
        expect(repo.weekOf('garbage', 1)).toBe('');
    });

    test('no local-clock week math anywhere in the door', () => {
        const src = fs.readFileSync(REPO, 'utf8');
        expect(src).not.toMatch(/getDay\(|setDate\(/);
        expect(src).toMatch(/setUTCDate/);
    });

    test('the approval key is the server formula, fed the server depts', () => {
        const { repo } = repoHarness();
        expect(repo.rosterApprovalKey([])).toBe('*');
        expect(repo.rosterApprovalKey(undefined)).toBe('*');
        expect(repo.rosterApprovalKey(['', null])).toBe('*');
        expect(repo.rosterApprovalKey(['CAF', 'SERVICE'])).toBe('caf,service');
        expect(repo.rosterApprovalKey([' CAF '])).toBe('caf');
    });

    test('the approval row reads as exactly three states', () => {
        const { repo } = repoHarness();
        expect(repo.rosterApprovalState({})).toEqual({ key: 'none' });
        expect(repo.rosterApprovalState(null)).toEqual({ key: 'none' });
        expect(repo.rosterApprovalState({ requested_name: 'أحمد', requested_at: '2026-10-14T09:30:00.000Z' }))
            .toEqual({ key: 'pending', by: 'أحمد', at: '2026-10-14 09:30' });
        expect(repo.rosterApprovalState({ approved_name: 'هدى', approved_at: '2026-10-15T11:05:00Z' }))
            .toEqual({ key: 'approved', by: 'هدى', at: '2026-10-15 11:05' });
        expect(repo.rosterApprovalState({ requested_name: 'أ', approved_name: 'ب' }).key).toBe('approved');
    });

    test('cellEdit mirrors the save-time checks and normalizes what it lets through', () => {
        const { repo } = repoHarness();
        expect(repo.cellEdit('9:05', '10')).toEqual({ ok: true, shiftStart: '09:05', shiftHours: 10 });
        expect(repo.cellEdit('09:00', '24')).toEqual({ ok: true, shiftStart: '09:00', shiftHours: 24 });
        expect(repo.cellEdit('09:00', '7.5').shiftHours).toBe(7.5);
        expect(repo.cellEdit('', '9').code).toBe('ROSTER_BAD_TIME');
        expect(repo.cellEdit('9:5', '9').code).toBe('ROSTER_BAD_TIME');
        expect(repo.cellEdit('24:00', '9').code).toBe('ROSTER_BAD_TIME');
        expect(repo.cellEdit('09:60', '9').code).toBe('ROSTER_BAD_TIME');
        expect(repo.cellEdit('09:00', '0').code).toBe('ROSTER_BAD_HOURS');
        expect(repo.cellEdit('09:00', '0.5').code).toBe('ROSTER_BAD_HOURS');
        expect(repo.cellEdit('09:00', '25').code).toBe('ROSTER_BAD_HOURS');
        expect(repo.cellEdit('09:00', 'abc').code).toBe('ROSTER_BAD_HOURS');
    });

    test('dirtyToCells is the wire body: staged cells only, error flags stripped', () => {
        const { repo } = repoHarness();
        expect(repo.cellKey(5, '2026-10-17')).toBe('5|2026-10-17');
        const dirty = new Map([
            ['5|2026-10-17', { id: 5, date: '2026-10-17', shift_start: '09:00', shift_hours: 10, day_off: null, error: 'وقت غير صالح' }],
            ['7|2026-10-18', { id: 7, date: '2026-10-18', shift_start: '10:00', shift_hours: 8, day_off: 2 }],
        ]);
        const cells = repo.dirtyToCells(dirty);
        expect(cells).toEqual([
            { id: 5, date: '2026-10-17', shift_start: '09:00', shift_hours: 10, day_off: null },
            { id: 7, date: '2026-10-18', shift_start: '10:00', shift_hours: 8, day_off: 2 },
        ]);
        expect(Object.keys(cells[0]).sort()).toEqual(['date', 'day_off', 'id', 'shift_hours', 'shift_start']);
        expect(repo.dirtyToCells(null)).toEqual([]);
        expect(repo.dirtyToCells({})).toEqual([]);
    });

    test('the door list is closed: two reads without a method, three writes that POST', async () => {
        const { calls, repo } = repoHarness({ pending: [] });
        await repo.fetchRosterWeek('', undefined);
        await repo.fetchRosterPending('');
        await repo.saveRosterWeek({ weekStart: '2026-10-17', cells: [] });
        await repo.requestRosterApproval({ weekStart: '2026-10-17' });
        await repo.approveRoster({ deptKey: 'caf', weekStart: '2026-10-17' });
        expect(calls.map((c) => c[1] && c[1].method)).toEqual([undefined, undefined, 'POST', 'POST', 'POST']);
        expect(calls.map((c) => c[0])).toEqual([
            '/hr/dept-roster-week',
            '/hr/dept-roster-approval/pending',
            '/hr/dept-roster-week',
            '/hr/dept-roster-approval/request',
            '/hr/dept-roster-approval/approve',
        ]);
    });

    test('the read door asks exactly the week and dept it was given, skipping empties', async () => {
        const { calls, repo } = repoHarness({ ok: true });
        await repo.fetchRosterWeek('', undefined);
        expect(calls[0][0]).toBe('/hr/dept-roster-week');
        await repo.fetchRosterWeek('2026-10-17', 'CAF');
        expect(calls[1][0]).toBe('/hr/dept-roster-week?week=2026-10-17&dept=CAF');
        const bare = repoHarness(null);
        expect(await bare.repo.fetchRosterWeek('', undefined)).toEqual({});
    });

    test('the save door carries dept only when one was chosen', async () => {
        const { calls, repo } = repoHarness({ ok: true, updated: 2 });
        await repo.saveRosterWeek({ dept: 'CAF', weekStart: '2026-10-17', cells: [{ id: 1, date: '2026-10-17', shift_start: '09:00', shift_hours: 10, day_off: null }] });
        expect(calls[0][0]).toBe('/hr/dept-roster-week');
        expect(calls[0][1].method).toBe('POST');
        const body = JSON.parse(calls[0][1].body);
        expect(body.week_start).toBe('2026-10-17');
        expect(body.dept).toBe('CAF');
        expect(body.cells).toHaveLength(1);
        await repo.saveRosterWeek({ weekStart: '2026-10-17', cells: [] });
        expect('dept' in JSON.parse(calls[1][1].body)).toBe(false);
    });

    test('the approval doors send the server keys, not client labels', async () => {
        const { calls, repo } = repoHarness({ ok: true });
        await repo.requestRosterApproval({ dept: 'CAF', weekStart: '2026-10-17' });
        expect(calls[0][0]).toBe('/hr/dept-roster-approval/request');
        expect(calls[0][1].method).toBe('POST');
        expect(JSON.parse(calls[0][1].body)).toEqual({ dept: 'CAF', week_start: '2026-10-17' });
        await repo.approveRoster({ deptKey: 'caf', weekStart: '2026-10-17' });
        expect(calls[1][0]).toBe('/hr/dept-roster-approval/approve');
        expect(JSON.parse(calls[1][1].body)).toEqual({ dept_key: 'caf', week_start: '2026-10-17' });
    });

    test('pending answers with a list or with nothing — never null', async () => {
        const bare = repoHarness({ ok: true, pending: null });
        expect(await bare.repo.fetchRosterPending('2026-10-17')).toEqual([]);
        expect(bare.calls[0][0]).toBe('/hr/dept-roster-approval/pending?week=2026-10-17');
        const full = repoHarness({ pending: [{ dept_key: 'caf' }] });
        expect(await full.repo.fetchRosterPending('')).toHaveLength(1);
        expect(full.calls[0][0]).toBe('/hr/dept-roster-approval/pending');
    });

    test('the door moved: portal-repo kept no roster reads behind', () => {
        const portal = fs.readFileSync(PORTAL, 'utf8');
        expect(portal).not.toMatch(/fetchRosterWeek|flattenRosterGrid|isoWeekStart/);
        expect(fs.readFileSync(REPO, 'utf8')).toMatch(/export async function fetchRosterWeek/);
    });
});

describe('V2 roster screen (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener\('click'/);
        expect(screen()).toMatch(/addEventListener\('change'/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/roster-repo\.js\?v=/);
    });

    test('the dead-import class cannot return to any V2 screen', () => {
        const offenders = [];
        for (const f of fs.readdirSync(SCREENS_DIR).filter((x) => x.endsWith('.js'))) {
            const src = fs.readFileSync(path.join(SCREENS_DIR, f), 'utf8');
            if (/createDataTable\s*\(/.test(src)
                && !/import \{ createDataTable \} from '\.\.\/data-display\/data-table\.js\?v=/.test(src)) {
                offenders.push(f);
            }
        }
        expect(offenders).toEqual([]);
        expect(screen()).toMatch(/import \{ createDataTable \} from '\.\.\/data-display\/data-table\.js\?v=/);
        expect(screen().match(/= createDataTable\(/g)).toHaveLength(1);
    });

    test('a save sends the dirty cells only — the legacy seven-day push is not copied', () => {
        const s = screen();
        expect(s).toMatch(/const cells = dirtyToCells\(dirty\);/);
        expect(s).toMatch(/cells\.length > ROSTER_MAX_CELLS/);
        expect(s).toMatch(/weekStart: data\.weekStart/);
        expect(s).not.toMatch(/getUTCDay|getDay\(/);
    });

    test('the week is the server\'s: navigation steps from its answer, never from a clock', () => {
        const s = screen();
        expect(s).toMatch(/weekOf\(\(data && data\.weekStart\) \|\| weekSel, delta\)/);
        expect(s).toMatch(/weekOf\(data\.weekStart, -1\)/);
        expect(s).toMatch(/weekSel = delta === 0 \? '' : weekOf/);
    });

    test('the approval key comes from the server depts, and the signer is named', () => {
        const s = screen();
        expect(s).toMatch(/rosterApprovalKey\(d\.depts\)/);
        expect(s).toMatch(/canApproveRoster\(role\)/);
        expect(s).toMatch(/يُسجَّل باسمك/);
        expect(s).toMatch(/pendingCard\.hidden = false/);
    });

    test('the confirm says before the click that a save deletes this week\'s approval', () => {
        const s = screen();
        expect(s).toMatch(/سيُلغى/);
        expect(s).toMatch(/السلامة أولًا/);
    });

    test('copy-prev reads the stored rest day as it is, not as a weekday guess', () => {
        expect(screen()).toMatch(/off\.checked = c\.day_off != null;/);
    });

    test('every payload string reaching the DOM is escaped', () => {
        const s = screen();
        expect(s).toMatch(/esc\(row\.name \|\| \('#' \+ row\.id\)\)/);
        expect(s).toMatch(/esc\(row\.employeeId \|\| ''\)/);
        expect(s).toMatch(/esc\(c\.leaveType\)/);
        expect(s).toMatch(/esc\(day\.date \|\| ''\)/);
        expect(s).toMatch(/esc\(st\.by\)/);
        expect(s).toMatch(/esc\(r\.dept_key\)/);
        expect(s).toMatch(/esc\(r\.requested_name \|\| '—'\)/);
    });

    test('printing states its own limits and the button is the only print call', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        expect(s).toMatch(/data-v2-print-note/);
        expect(s).toMatch(/المطبوعة تعرض الأسبوع الظاهر/);
    });

    test('one click cannot stack two loads, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{queued = true; return;\}/);
        expect(s.split('el.isConnected').length - 1).toBeGreaterThanOrEqual(3);
        expect(s).toMatch(/destroy\(\) \{\s*logTable\.destroy\(\);\s*el\.remove\(\);\s*\}/);
    });

    test('the read errors keep the three named tiers and offer a retry', () => {
        const s = screen();
        expect(s).toMatch(/e\.message === 'UNAUTHORIZED'/);
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toMatch(/data-erp-retry/);
    });

    test('an unsaved edit guards week navigation, department change and reload', () => {
        const s = screen();
        expect(s).toMatch(/function confirmDiscard\(/);
        expect(s.split('confirmDiscard(').length - 1).toBeGreaterThanOrEqual(5);
    });

    test('no sample figures on the live screen', () => {
        expect(screen()).not.toMatch('بيانات نموذجية');
    });

    test('the base layer is scoped to the screen and the matrix', () => {
        expect(css()).toMatch(/\.erp-v2-roster \.erp-card__head \{ flex-wrap: wrap; \}/);
        expect(css()).toMatch(/\.erp-v2-roster \[data-v2-pending-card\]\[hidden\] \{ display: none; \}/);
        expect(css()).toMatch(/\.erp-ros-grid \{ min-inline-size: 880px; \}/);
        expect(css()).toMatch(/\.erp-ros-grid thead \.erp-th:first-child,/);
        expect(css()).toMatch(/z-index: calc\(var\(--erp-z-sticky\) \+ 1\)/);
        expect(css()).toMatch(/\.erp-ros-signs \{ display: none; \}/);
    });

    test('the roster slice adds no raw colours', () => {
        const c = css();
        const slice = c.slice(c.indexOf('شاشة الدوام'));
        expect(slice.length).toBeGreaterThan(0);
        expect(slice).not.toMatch(/#[0-9a-f]{3,6}\b/i);
        expect(slice).not.toMatch(/rgba?\(/);
    });

    test('the 640px block carries the roster compaction and the dirty-count exemption', () => {
        const c = css();
        const last640 = c.lastIndexOf('@media (max-width: 640px)');
        const block = c.slice(last640, c.indexOf('\n}', last640));
        expect(block).toMatch(/\.erp-v2-roster \.erp-dash-controls \.erp-btn > span \{ display: none; \}/);
        expect(block).toMatch(/span\[data-v2-dirty-count\] \{ display: inline; \}/);
        expect(block).toMatch(/min-block-size: var\(--erp-space-8\)/);
    });

    test('the print block puts the roster sheet on paper with its two signatures', () => {
        const c = css();
        const lastPrint = c.lastIndexOf('@media print');
        const block = c.slice(lastPrint, c.indexOf('\n}', lastPrint));
        expect(block).toMatch(/\.erp-v2-roster \.erp-dash-controls \{ display: none; \}/);
        expect(block).toMatch(/\.erp-v2-roster \.erp-ros-tools \{ display: none; \}/);
        expect(block).toMatch(/\.erp-v2-roster \[data-v2-signs\] \{/);
        expect(block).toMatch(/display: flex;/);
    });

    test('the host mounts and tears down the roster screen it already routed to', () => {
        const p = fs.readFileSync(PREVIEW, 'utf8');
        expect(p).toMatch(/import \{ mountRosterScreen \} from '\.\/screens\/roster\.js\?v=/);
        expect(p).toMatch(/rosterScreen\.destroy\(\)/);
        expect(p).toMatch(/if \(key === 'roster'\) \{/);
    });

    test('the migration table is one row per screen again, with the roster row', () => {
        const m = fs.readFileSync(MIGRATION, 'utf8');
        expect(m).toMatch(/^\| 23 \| الأقسام \| `departments` \|/m);
        expect(m).toMatch(/^\| 24 \| أقسام الموارد \| `hr-departments` \|/m);
        expect(m).toMatch(/^\| 25 \| مسيرات الرواتب \| `payroll` \|/m);
        expect(m).toMatch(/^\| 26 \| الدوام \| `roster` \| 1 \(قراءة\) \+ دورة الدوام الكاملة \(W2-1\)/m);
        expect(m).toMatch(/tests\/v2-roster\.test\.js/);
        expect(m).toMatch(/الدوامات \(W2-1/);
        expect(m).not.toMatch(/`n\| 2[0-9]/);
        expect(m).not.toMatch(/\r/);
        expect(m).not.toMatch(/\\/);
    });
});
