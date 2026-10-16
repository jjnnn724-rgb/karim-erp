/**
 * v2-employees.test.js — عقد شاشة 02 «الموظفون» في V2
 * ═══════════════════════════════════════════════════════════════════════
 * Same loading strategy as tests/v2-attendance.test.js: browser ESM files,
 * jest with testEnvironment:'node', so the repository runs inside a vm with
 * its one dependency (apiFetch) stubbed, and the screen is asserted as a
 * source contract.
 *
 * What is pinned here is the part nobody can eyeball in a browser:
 *   • the allowlist — a raw API row carries salary, iqama number, qr tokens
 *     and fingerprint data; employeeToRow must hand the screen six fields
 *     and nothing else, ever
 *   • a chip is arithmetic on the rows: a status that is new in the database
 *     gets its own chip instead of hiding inside the total, and the repo
 *     never invents a status label — the screen passes status.js in
 *   • department groups are keyed by the STORED code, so two codes that
 *     happen to share a name cannot silently merge into one bigger bar
 *   • filters only offer values the roster contains, and '—' (the option the
 *     screen shows for an empty field) really matches those rows
 *   • a repaint never rebuilds the <select> options an open dropdown is
 *     using, no inline handlers (CSP nonce), payload strings escaped, and one
 *     click cannot stack two loads
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'employees-repo.js');
const SCREEN = path.join(V2, 'screens', 'employees.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
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
        Set, Map, Intl,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

function repoHarness(payload, collect = []) {
    const calls = [];
    const apiFetch = jest.fn(async (p) => {
        calls.push(p);
        return payload || { data: [], pagination: { totalPages: 1 } };
    });
    return { calls, repo: loadEsm(REPO, { apiFetch }, collect) };
}

/** The six fields the roster is allowed to show, plus the join flags. */
const ALLOWED_KEYS = ['id', 'code', 'name', 'nameResolved', 'dept', 'deptCode', 'deptResolved', 'position', 'phone', 'status'];

function roster(repo) {
    const depts = repo.departmentMap([
        { code: 'KIT', name: 'المطبخ' },
        { code: 'HALL', name: 'الصالة' },
        { code: 'ZZZ', name: 'قسم ملغى' },
    ]);
    return [
        { id: 1, employeeId: 'E1', name: 'محمود سيد', department: 'KIT', position: 'شيف', phone: '0500000001', status: 'active' },
        { id: 2, employeeId: 'E2', name: 'أحمد حسن', department: 'KIT', position: '', phone: '', status: 'active' },
        { id: 3, employeeId: 'E3', name: 'ياسر إبراهيم', department: 'HALL', position: 'كاشير', phone: '0500000003', status: 'suspended' },
        { id: 4, employeeId: 'E4', name: 'طارق نور', department: 'HALL', position: 'نادل', phone: '0500000004', status: 'probation' },
        { id: 5, employeeId: 'E5', name: 'عمرو فؤاد', department: 'ZZZ', position: 'سائق', phone: '0500000005', status: '' },
        { id: 6, employeeId: 'E6', name: '', department: '', position: 'مخزني', phone: '0500000006', status: 'active' },
    ].map((e) => repo.employeeToRow(e, depts));
}

describe('V2 employees repository — the allowlist and the arithmetic', () => {
    test('a raw API row leaves the repository with only the allowed fields', () => {
        const { repo } = repoHarness();
        const sensitive = {
            id: 9, employeeId: 'E9', name: 'كريم', department: 'KIT', position: 'مدير',
            phone: '0500000009', status: 'active',
            salary: 9000, iqamaNumber: '1234567890', nationalId: '12345678901234',
            password: 'hashed', qrToken: 'tok', fingerprintTemplate: 'base64…', bankAccount: '123',
        };
        const row = repo.employeeToRow(sensitive, repo.departmentMap([]));
        expect(Object.keys(row).sort()).toEqual([...ALLOWED_KEYS].sort());
        const json = JSON.stringify(row).toLowerCase();
        for (const secret of ['9000', '1234567890', 'hashed', 'tok', 'base64', 'salary', 'iqama', 'fingerprint']) {
            expect(json).not.toMatch(secret);
        }
    });

    test('a department is a join: an unknown code stays the code, an empty one stays empty', () => {
        const { repo } = repoHarness();
        const depts = repo.departmentMap([{ code: 'KIT', name: 'المطبخ' }]);
        const known = repo.employeeToRow({ id: 1, name: 'أ', department: 'KIT' }, depts);
        expect(known.dept).toBe('المطبخ');
        expect(known.deptResolved).toBe(true);
        const bare = repo.employeeToRow({ id: 2, name: 'ب', department: 'Q9' }, depts);
        expect(bare.dept).toBe('Q9');
        expect(bare.deptCode).toBe('Q9');
        expect(bare.deptResolved).toBe(false);
        const none = repo.employeeToRow({ id: 3, name: 'ج' }, depts);
        expect(none.dept).toBe('—');
        expect(none.deptCode).toBe('');
        const noName = repo.employeeToRow({ id: 42, department: 'KIT' }, depts);
        expect(noName.name).toBe('#42');
        expect(noName.nameResolved).toBe(false);
    });

    test('status groups keep the stored string, including the empty one', () => {
        const { repo } = repoHarness();
        const counts = repo.statusCounts(roster(repo));
        expect(counts.map((c) => c.value)).toEqual(['active', '', 'probation', 'suspended']);
        expect(counts.find((c) => c.value === 'active').count).toBe(3);
        expect(counts.find((c) => c.value === '').count).toBe(1);
        expect(JSON.stringify(counts)).not.toMatch('NaN');
    });

    test('departments group by code, so two codes with one name stay two rows', () => {
        const { repo } = repoHarness();
        const depts = repo.departmentMap([{ code: 'A1', name: 'الصالة' }, { code: 'A2', name: 'الصالة' }]);
        const rows = [
            repo.employeeToRow({ id: 1, name: 'أ', department: 'A1', status: 'active' }, depts),
            repo.employeeToRow({ id: 2, name: 'ب', department: 'A2', status: 'active' }, depts),
        ];
        const out = repo.deptCounts(rows);
        expect(out).toHaveLength(2);
        expect(out.every((d) => d.count === 1)).toBe(true);
    });

    test('the department spread counts every row exactly once and labels the code cases', () => {
        const { repo } = repoHarness();
        const out = repo.deptCounts(roster(repo));
        expect(out.reduce((s, d) => s + d.count, 0)).toBe(6);
        expect(out[0].count).toBe(2);
        expect(out.find((d) => d.code === 'ZZZ').resolved).toBe(true);
        expect(out.find((d) => d.code === '').resolved).toBe(false);
        expect(out.find((d) => d.code === '').label).toBe('—');
    });

    test('a share needs a real base: an empty roster is a stated dash, not 0% of nothing', () => {
        const { repo } = repoHarness();
        const empty = repo.rosterPill(0, 0, 'نشط');
        expect(empty.text).toBe('—');
        expect(empty.on).toBe(false);
        expect(empty.aria).toMatch('لا موظفين');
        const some = repo.rosterPill(3, 8, 'نشط');
        expect(some.text).toBe('37.5%');
        expect(some.aria).toMatch('3 من 8 موظفًا');
    });

    test('chips are arithmetic: one per status the rows actually contain', () => {
        const { repo } = repoHarness();
        const labelOf = (v) => ({ label: `LBL:${v}`, tone: 'neutral', icon: 'circle-help' });
        const chips = repo.buildEmployeeKpis(roster(repo), { labelOf, scope: 'الدليل كله' });
        const ids = chips.map((c) => c.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('status:active');
        // 'probation' is not in the status table — it still gets a chip.
        expect(ids).toContain('status:probation');
        expect(chips.find((c) => c.id === 'status:probation').label).toBe('LBL:probation');
        expect(chips.find((c) => c.id === 'total').value).toBe('6');
        expect(JSON.stringify(chips)).not.toMatch('NaN');
        expect(chips.every((c) => c.pill && c.pill.text && c.hint && c.pill.aria)).toBe(true);
    });

    test('the repository never labels a status by itself — the screen injects status.js', () => {
        const src = fs.readFileSync(REPO, 'utf8');
        // The sheet block is the one sanctioned exception (W2-2): its template
        // sample rows and the legacy import-parity check carry the words
        // verbatim from features/employees.js. The DISPLAY path (rows, chips,
        // filters) may never hold a second copy of a label.
        const [displaySrc, sheetSrc] = src.split('/* ── Sheet import/export');
        expect(displaySrc.length).toBeGreaterThan(0);
        expect(sheetSrc).toBeDefined();
        expect(displaySrc).not.toMatch(/'نشط'|'موقوف'|'غير نشط'/);
        const { repo } = repoHarness();
        const chips = repo.buildEmployeeKpis(roster(repo));
        expect(chips.find((c) => c.id === 'status:active').label).toBe('active');
    });

    test('the departments chip says which join worked and names the biggest group', () => {
        const { repo } = repoHarness();
        const chips = repo.buildEmployeeKpis(roster(repo));
        const depts = chips.find((c) => c.id === 'depts');
        expect(depts.value).toBe('4');
        expect(depts.unit).toBe('قسمًا');
        expect(depts.pill.text).toBe('2');
        expect(depts.pill.aria).toMatch('2 من 6 موظفًا');
        expect(depts.hint).toMatch('من /api/hrDepartments');
        const empty = repo.buildEmployeeKpis([]);
        expect(empty.find((c) => c.id === 'depts').pill.text).toBe('—');
    });

    test('the missing-phone chip counts the dash the row builder writes', () => {
        const { repo } = repoHarness();
        const chips = repo.buildEmployeeKpis(roster(repo));
        const noPhone = chips.find((c) => c.id === 'no-phone');
        expect(noPhone.value).toBe('1');
        expect(noPhone.tone).toBe('warning');
        expect(chips.find((c) => c.id === 'total').value).toBe('6');
    });

    test('an empty roster yields zeros and stated dashes, never NaN', () => {
        const { repo } = repoHarness();
        const chips = repo.buildEmployeeKpis([]);
        expect(chips.find((c) => c.id === 'total').value).toBe('0');
        expect(JSON.stringify(chips)).not.toMatch('NaN');
        expect(chips.every((c) => c.pill.text)).toBe(true);
        expect(repo.deptCounts([])).toEqual([]);
        expect(repo.statusCounts([])).toEqual([]);
    });

    test('filters only turn on for a real value, and "—" matches the empty field', () => {
        const { repo } = repoHarness();
        const rows = roster(repo);
        expect(repo.applyEmployeeFilters(rows, { dept: 'all', status: 'all' })).toHaveLength(6);
        expect(repo.applyEmployeeFilters(rows, {})).toHaveLength(6);
        expect(repo.applyEmployeeFilters(rows, { dept: 'KIT' })).toHaveLength(2);
        expect(repo.applyEmployeeFilters(rows, { status: 'probation' })).toHaveLength(1);
        expect(repo.applyEmployeeFilters(rows, { dept: 'KIT', status: 'active' })).toHaveLength(2);
        expect(repo.applyEmployeeFilters(rows, { dept: '—' })).toHaveLength(1);
        expect(repo.applyEmployeeFilters(rows, { status: '—' })).toHaveLength(1);
        expect(repo.applyEmployeeFilters(rows, { dept: 'NOPE' })).toHaveLength(0);
    });

    test('the doors are bounded reads, never writes', async () => {
        const full = { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { totalPages: 9 } };
        const { calls, repo } = repoHarness(full);
        await repo.fetchEmployees();
        await repo.fetchDepartments();
        expect(calls[0]).toMatch('/employees?');
        expect(calls[5]).toMatch('/hrDepartments?');
        expect(calls.every((c) => c.includes('limit=1000'))).toBe(true);
        expect(calls.length).toBe(10);          // 5 pages per list, hard stop
        expect(calls.some((c) => /POST|PUT|DELETE/.test(c))).toBe(false);
        const empty = repoHarness({ data: [], pagination: { totalPages: 0 } });
        await empty.repo.fetchEmployees();
        expect(empty.calls).toHaveLength(1);    // an empty page stops the walk
    });

    test('formatInt groups with Latin digits — the table below uses the same', () => {
        const { repo } = repoHarness();
        expect(repo.formatInt(1234)).toBe('1,234');
        expect(repo.formatInt(null)).toBe('0');
        expect(repo.formatInt(7.6)).toBe('8');
    });
});

describe('V2 employees screen + layer (source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const css = () => fs.readFileSync(HR_CSS, 'utf8');

    test('no inline handlers — the CSP nonce makes them inert', () => {
        expect(screen()).not.toMatch(/on(?:click|input|change|submit|error)\s*=\s*["']/);
        expect(screen()).toMatch(/addEventListener\('click'/);
        expect(screen()).toMatch(/addEventListener\('change'/);
    });

    test('the screen owns no network layer: everything goes through the repository', () => {
        expect(screen()).not.toMatch(/apiFetch|core\/api\.js|fetch\(/);
        expect(screen()).toMatch(/from '\.\.\/data\/employees-repo\.js\?v=/);
    });

    test('only allowlisted columns reach the table', () => {
        const keys = [...screen().matchAll(/\bkey: '([a-zA-Z]+)'/g)].map((m) => m[1]);
        // 'actions' is buttons-only (W2-2) — it carries no data field at all.
        expect(new Set(keys)).toEqual(new Set(['code', 'name', 'dept', 'position', 'phone', 'status', 'actions']));
        expect(screen()).not.toMatch(/\bkey: '(salary|iqama|nationalId|password|qr|fingerprint)'/i);
    });

    test('every payload string reaching the DOM is escaped', () => {
        const s = screen();
        expect(s).toMatch(/esc\(row\.name\)/);
        expect(s).toMatch(/esc\(row\.dept\)/);
        expect(s).toMatch(/esc\(row\.position\)/);
        expect(s).toMatch(/esc\(row\.phone\)/);
        expect(s).toMatch(/esc\(k\.label\)/);
        expect(s).toMatch(/esc\(k\.pill\.aria\)/);
        expect(s).toMatch(/title="\$\{esc\(title\)\}"/);   // the bar tooltip escapes its sentence
        expect(s).toMatch(/esc\(label\)/);                 // option text and bar name
    });

    test('labels come from the status authority, never re-typed per screen', () => {
        const s = screen();
        expect(s).toMatch(/import \{[^}]*resolveStatus[^}]*\} from '\.\.\/status\.js\?v=/);
        expect(s).toMatch(/const statusOf = \(v\) => resolveStatus\('employees', v\)/);
        expect(s).toMatch(/labelOf: statusOf/);
        expect(s).toMatch(/statusBadge\('employees', row\.status\)/);
    });

    test('filter options are derived from the roster, not hard-coded', () => {
        const s = screen();
        expect(s).toMatch(/deptCounts\(allRows\)/);
        expect(s).toMatch(/for \(const r of allRows\)/);
        expect(s).not.toMatch(/<option value="active"/);
        expect(s).not.toMatch(/<option value="KIT"/);
    });

    test('a repaint never rebuilds the options a dropdown is open on', () => {
        const s = screen();
        const paint = s.match(/function paint\(\) \{[\s\S]*?\n {4}\}\n/);
        expect(paint).not.toBeNull();
        expect(paint[0]).not.toMatch(/option value="all"/);
        expect(s.match(/filterOptions\(\);/g)).toHaveLength(1);
        expect(s).toMatch(/function filterOptions\(\)/);
    });

    test('a filtered view renames its own scope instead of posing as the roster', () => {
        const s = screen();
        expect(s).toMatch(/النتيجة المصفّاة/);
        expect(s).toMatch(/محسوبة على/);
        expect(s).toMatch(/data-v2-filter-note/);
        expect(s).toMatch(/clearBtn\.hidden = !on/);
    });

    test('the scope line counts what is on screen, and an untouched filter stays silent', () => {
        const s = screen();
        expect(s).toMatch(/\$\{formatInt\(rows\.length\)\} من \$\{formatInt\(allRows\.length\)\} موظفًا/);
        expect(s).toMatch(/sel\.value !== 'all'/);
        expect(s).toMatch(/function activeFilters\(\)/);
    });

    test('an unresolved code or a missing name is shown as what it is', () => {
        const s = screen();
        expect(s).toMatch(/row\.deptResolved/);
        expect(s).toMatch(/كود القسم كما هو في السجل/);
        expect(s).toMatch(/row\.nameResolved/);
        expect(s).toMatch(/لا اسم مخزّن/);
        expect(s).toMatch(/data-v2-dept-note/);
    });

    test('printing states its own limits and the button is the only print call', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        expect(s).toMatch(/data-v2-print-note/);
        expect(s).toMatch(/المطبوعة تعرض الصفحة الحالية/);
    });

    test('one click cannot stack two loads, and a detached screen stops writing', () => {
        const s = screen();
        expect(s).toMatch(/if \(loading\) \{return;\}/);
        expect(s.split('el.isConnected').length - 1).toBeGreaterThanOrEqual(2);
        expect(s).toMatch(/destroy\(\) \{\s*clearTimeout\(searchTimer\);\s*table\.destroy\(\);/);
    });

    test('no sample figures on the live screen', () => {
        expect(screen()).not.toMatch('بيانات نموذجية');
    });

    test('the HR layer adds no new colours and no raw channels', () => {
        expect(css()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
        expect(css()).not.toMatch(/rgba?\(/);
    });

    test('an unresolved department code really renders muted (utility beats the component)', () => {
        expect(css()).toMatch(/\.erp-v2 \.erp-top__name\.erp-text-muted \{ color: var\(--erp-text-muted\); \}/);
        expect(screen()).toMatch(/erp-top__name\$\{known \? '' : ' erp-text-muted'\}/);
    });

    test('the phone header compacts instead of eating the screen', () => {
        const block = css().match(/@media \(max-width: 640px\) \{[\s\S]*?\n\}/);
        expect(block).not.toBeNull();
        // The compaction rules are one grouped selector per screen, so the
        // assertion is the selector list, not one line of the stylesheet.
        expect(block[0]).toMatch(/\.erp-v2-employees \.erp-dash-controls \.erp-btn > span[,\s][^}]*\{ display: none; \}/);
        expect(block[0]).toMatch(/min-block-size: 40px/);
        expect(block[0]).toMatch(/order: 1/);
        expect(block[0]).toMatch(/\.erp-v2-attendance/);
    });

    test('the page loads the HR layer, versioned (Cloudflare caches CSS for 4h)', () => {
        const page = fs.readFileSync(V2_HTML, 'utf8');
        expect(page).toMatch(/css\/v2\/erp-hr\.css\?v=[0-9]+(\.[0-9]+)*/);
    });

    test('the host still tears the screen down on navigation', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        expect(p).toMatch(/employeesScreen\.destroy\(\)/);
        expect(p).toMatch(/mountEmployeesScreen\(/);
    });
});

describe('V2 employees repository — the write doors (W2-2)', () => {
    /** Records {p, init} so method + JSON body are assertable. */
    function writeHarness() {
        const calls = [];
        const apiFetch = jest.fn(async (p, init) => { calls.push({ p, init }); return {}; });
        return { calls, repo: loadEsm(REPO, { apiFetch }) };
    }

    test('the five doors hit exactly the paths the server contract names', async () => {
        const { calls, repo } = writeHarness();
        await repo.createEmployee({ name: 'أحمد' });
        await repo.updateEmployee(5, { name: 'ب' });
        await repo.deleteEmployee(5);
        await repo.fetchEmployeeCard(5);
        await repo.regenerateEmployeeQr(5);
        expect(calls).toHaveLength(5);
        expect(calls[0].p).toBe('/employees');
        expect(calls[0].init.method).toBe('POST');
        expect(JSON.parse(calls[0].init.body)).toEqual({ name: 'أحمد' });
        expect(calls[1].p).toBe('/employees/5');
        expect(calls[1].init.method).toBe('PUT');
        expect(JSON.parse(calls[1].init.body)).toEqual({ name: 'ب' });
        expect(calls[2].p).toBe('/employees/5');
        expect(calls[2].init.method).toBe('DELETE');
        expect(calls[3].p).toBe('/hr/employees/5/card');
        expect(calls[4].p).toBe('/hr/employees/5/qr/regenerate');
        expect(calls[4].init.method).toBe('POST');
    });

    test('validateEmployeeForm mirrors the server checks and their words', () => {
        const { repo } = repoHarness();
        const msg = (form, opts) => repo.validateEmployeeForm(form, opts).map((e) => e.message);
        const fields = (form, opts) => repo.validateEmployeeForm(form, opts).map((e) => e.field);
        // one sentence covers both missing fields, exactly like the server
        expect(msg({}, {})).toEqual(['أدخل الاسم والرقم الوظيفي', 'أدخل الاسم والرقم الوظيفي']);
        expect(fields({}, {})).toEqual(['name', 'employeeId']);
        expect(msg({ name: 'أحمد' }, {})).toEqual(['أدخل الاسم والرقم الوظيفي']);
        expect(fields({ name: 'أحمد' }, {})).toEqual(['employeeId']);
        expect(msg({ name: 'أحمد' }, { editing: true })).toEqual([]);
        expect(msg({ name: 'أحمد', employeeId: 'E1' }, { existingIds: ['E1'] }))
            .toEqual(['الرقم الوظيفي موجود بالفعل']);
        expect(msg({ name: 'أ', employeeId: 'E9', shift_start: '9am' }, {}))
            .toEqual(['بداية الوردية بصيغة HH:MM (مثال 22:00)']);
        expect(msg({ name: 'أ', employeeId: 'E9', shift_start: '25:00' }, {}))
            .toEqual(['بداية الوردية ساعة غير صالحة']);
        expect(msg({ name: 'أ', employeeId: 'E9', shift_karim: '0' }, {}))
            .toEqual(['ساعات الوردية بين 1 و 24']);
        expect(msg({ name: 'أ', employeeId: 'E9', shift_karim: 'abc' }, {}))
            .toEqual(['ساعات الوردية بين 1 و 24']);
        expect(msg({ name: 'أ', employeeId: 'E9', salary: '-1' }, {}))
            .toEqual(['الراتب غير صحيح']);
        expect(msg({ name: 'أ', employeeId: 'E9', day_off: '7' }, {}))
            .toEqual(['يوم الراحة بين 0 و 6']);
        expect(msg({ name: 'أ', employeeId: 'E9', department: 'NOPE' }, { deptCodes: ['KIT'] }))
            .toEqual(['القسم الوظيفي غير موجود، اختر قسمًا من أقسام الموارد البشرية']);
        expect(msg({ name: 'أ'.repeat(256), employeeId: 'E9' }, {}))
            .toEqual(['الحقل "name" أطول من المسموح (الحد الأقصى 255 حرفًا)']);
        expect(repo.validateEmployeeForm(
            { name: 'أحمد', employeeId: 'E9', shift_start: '22:00', shift_karim: '8', salary: '4500', day_off: '5', department: 'KIT' },
            { deptCodes: ['KIT'] },
        )).toEqual([]);
    });

    test('buildEmployeePayload: create omits blanks, edit sends clears as null, shift pair always rides', () => {
        const { repo } = repoHarness();
        const create = repo.buildEmployeePayload({ name: 'أحمد', employeeId: 'E9' }, { role: 'admin' });
        expect(create.name).toBe('أحمد');
        expect(create.employeeId).toBe('E9');
        expect(create.shift_start).toBe('');
        expect(create.shift_karim).toBe('');
        expect(Object.keys(create).sort()).toEqual(['employeeId', 'name', 'shift_karim', 'shift_start']);

        const edit = repo.buildEmployeePayload(
            { name: 'أحمد', phone: '', salary: '', department: '', day_off: '' },
            { role: 'hr', editing: true },
        );
        expect(edit.phone).toBeNull();
        expect(edit.salary).toBeNull();
        expect(edit.department).toBeNull();
        expect(edit.day_off).toBeNull();
        expect(edit).not.toHaveProperty('employeeId');   // create-only column

        const nums = repo.buildEmployeePayload(
            { name: 'أ', employeeId: 'E1', salary: '4500', day_off: '3', shift_karim: '8.5' },
            {},
        );
        expect(nums.salary).toBe(4500);
        expect(nums.day_off).toBe(3);
        expect(nums.shift_karim).toBe(8.5);

        const photoOk = repo.buildEmployeePayload(
            { name: 'أ', employeeId: 'E1', photo: 'data:image/png;base64,iVBOR' }, {});
        expect(photoOk.photo).toBe('data:image/png;base64,iVBOR');
        const photoBad = repo.buildEmployeePayload(
            { name: 'أ', employeeId: 'E2', photo: 'http://evil/x.png' }, {});
        expect(photoBad).not.toHaveProperty('photo');

        const admin = repo.buildEmployeePayload(
            { name: 'أ', employeeId: 'E3', auto_checkout: true, auto_lock: false }, { role: 'admin' });
        expect(admin.auto_checkout).toBe(true);
        expect(admin.auto_lock).toBe(false);
        const cashier = repo.buildEmployeePayload(
            { name: 'أ', employeeId: 'E4', auto_checkout: true, auto_lock: true }, { role: 'cashier' });
        expect(cashier).not.toHaveProperty('auto_checkout');   // server drops them silently — never sent
        expect(cashier).not.toHaveProperty('auto_lock');
    });
});

describe('V2 employees repository — sheet import/export parity (W2-2)', () => {
    test('the template is the legacy twelve columns verbatim, with its two samples', () => {
        const { repo } = repoHarness(null, ['EMP_SHEET_COLS']);
        expect(repo.EMP_SHEET_COLS).toEqual([
            'الرقم الوظيفي', 'الاسم', 'القسم', 'المنصب', 'الهاتف', 'البريد',
            'تاريخ الالتحاق', 'الراتب', 'الحالة',
            'انتهاء الإقامة', 'انتهاء الشهادة الصحية', 'انتهاء التثقيف الصحي',
        ]);
        const t = repo.sheetTemplateRows();
        expect(t).toHaveLength(3);
        expect(t[0]).toEqual(repo.EMP_SHEET_COLS);
        expect(t[1][0]).toBe('EMP-201');
        expect(t[2][0]).toBe('EMP-202');
    });

    test('sheetNormDate accepts the legacy formats and names everything else INVALID', () => {
        const { repo } = repoHarness();
        expect(repo.sheetNormDate(45292)).toBe('2024-01-01');          // Excel serial
        expect(repo.sheetNormDate('2024-1-5')).toBe('2024-01-05');     // YYYY-M-D
        expect(repo.sheetNormDate('2024/1/5')).toBe('2024-01-05');     // slashes too
        expect(repo.sheetNormDate('5-1-2024')).toBe('2024-01-05');     // D-M-YYYY
        expect(repo.sheetNormDate('خربطة')).toBe('INVALID');
        expect(repo.sheetNormDate(100)).toBe('INVALID');               // number outside serial range
        expect(repo.sheetNormDate('')).toBe('');
        expect(repo.sheetNormDate(null)).toBe('');
        expect(repo.sheetNormDate(undefined)).toBe('');
    });

    test('normArSheet is the legacy normalizer verbatim', () => {
        const { repo } = repoHarness();
        expect(repo.normArSheet('الإنتاج')).toBe('الانتاج');
        expect(repo.normArSheet('شركة')).toBe('شركه');
        expect(repo.normArSheet('AbC')).toBe('abc');
    });

    test('buildSheetImport: legacy preflight — skip-existing is not an error, unknown dept warns', () => {
        const { repo } = repoHarness();
        const model = repo.buildSheetImport([
            ['', ''],                                                    // fully blank: skipped
            ['E1', 'أحمد', 'المطبخ', 'شيف', '050', 'a@x', '2024-01-15', 4500, 'نشط', '2025-01-01', '', ''],
            ['E2', 'سارة', 'المطبخ', '', '', '', '5-1-2024', 3000, 'غير نشط', '', '', ''],
            ['E2', 'مكرر داخل الملف', '', '', '', '', '', 0, 'نشط', '', '', ''],
            ['', 'بلا رقم وظيفي', '', '', '', '', '', 0, '', '', '', ''],
            ['E3', 'تاريخ سيئ', '', '', '', '', 'خربطة', 0, '', '', '', ''],
            ['E4', 'راتب سالب', '', '', '', '', '', -5, '', '', '', ''],
            ['E5', 'بكود قسم', 'HALL', '', '', '', '', 0, '', '', '', ''],
            ['E6', 'قسم مجهول', 'قسم ليس له كود', '', '', '', '', 0, 'غير معروف', '', '', ''],
        ], {
            existingIds: ['E1'],
            departments: [{ code: 'KIT', name: 'المطبخ' }, { code: 'HALL', name: 'الصالة' }],
            statusByLabel: new Map([['نشط', 'active'], ['غير نشط', 'inactive']]),
        });
        expect(model.counts).toEqual({ total: 8, ok: 3, dup: 1, bad: 4 });
        const byId = (id) => model.rows.find((r) => r.id === id);
        expect(byId('E1').err).toBe('موجود مسبقًا — سيُتخطى');
        expect(byId('E1').deptCode).toBe('');                          // err rows never resolve dept
        expect(model.rows.filter((r) => r.id === 'E2')[1].err).toBe('رقم مكرر داخل الملف');
        const sara = model.rows.filter((r) => r.id === 'E2')[0];
        expect(sara.err).toBe('');
        expect(sara.deptCode).toBe('KIT');                             // by normalized NAME
        expect(sara.status).toBe('inactive');                          // via the status.js label map
        expect(sara.join).toBe('2024-01-05');
        expect(model.rows.find((r) => r.name === 'بلا رقم وظيفي').err)
            .toBe('الاسم والرقم الوظيفي مطلوبان');
        expect(byId('E3').err).toBe('صيغة تاريخ غير صحيحة (YYYY-MM-DD)');
        expect(byId('E4').err).toBe('الراتب غير صحيح');
        expect(byId('E5').deptCode).toBe('HALL');                      // by direct code
        expect(byId('E5').status).toBe('active');                      // blank cell defaults to «نشط»
        const unknown = byId('E6');
        expect(unknown.err).toBe('');
        expect(unknown.warn).toBe('قسم غير معروف — سيُترك فارغًا');
        expect(unknown.deptCode).toBe('');
        expect(unknown.status).toBe('inactive');                       // legacy «غير» fallback
    });

    test('sheetRowToPayload fills the legacy create fields and defaults join to today', () => {
        const { repo } = repoHarness();
        const p = repo.sheetRowToPayload(
            { id: 'E9', name: 'نور', pos: 'كاشير', phone: '055', email: 'n@x',
              join: '', sal: 2000, status: 'active', deptCode: 'KIT',
              iq: '2026-01-01', hc: '', he: '' },
            '2026-10-15',
        );
        expect(p).toEqual({
            name: 'نور', employeeId: 'E9', position: 'كاشير', phone: '055',
            email: 'n@x', joinDate: '2026-10-15', salary: 2000, status: 'active',
            department: 'KIT', iqamaExpiry: '2026-01-01',
        });
    });

    test('exportSheetRows: salary column only when the server sent it; dept joins by name; label map is a required door', () => {
        const { repo } = repoHarness(null, ['EMP_SHEET_COLS']);
        const rows = [
            { id: '1', code: 'E1', name: 'أحمد', nameResolved: true, position: 'شيف', phone: '050', status: 'active' },
            { id: '2', code: '—', name: '#2', nameResolved: false, position: '—', phone: '—', status: 'suspended' },
        ];
        const rawById = new Map([
            ['1', { department: 'KIT', email: 'a@x', joinDate: '2024-01-15', salary: 4500, iqamaExpiry: '2026-01-01' }],
            ['2', { department: 'Q9', email: '', joinDate: '' }],
        ]);
        const deptByCode = new Map([['KIT', { code: 'KIT', name: 'المطبخ' }]]);
        const label = (v) => `LBL:${v}`;
        const m = repo.exportSheetRows(rows, rawById, deptByCode, { statusLabelOf: label });
        expect(m).toHaveLength(3);
        expect(m[0]).toEqual(repo.EMP_SHEET_COLS);                     // salary column present
        expect(m[1]).toEqual(['E1', 'أحمد', 'المطبخ', 'شيف', '050', 'a@x', '2024-01-15', 4500, 'LBL:active', '2026-01-01', '', '']);
        expect(m[2]).toEqual(['', '', 'Q9', '', '', '', '', 0, 'LBL:suspended', '', '', '']);

        const rawNoSalary = new Map([
            ['1', { department: 'KIT', email: 'a@x', joinDate: '2024-01-15' }],
        ]);
        const m2 = repo.exportSheetRows([rows[0]], rawNoSalary, deptByCode, { statusLabelOf: label });
        expect(m2[0]).not.toContain('الراتب');                          // masked roles keep an honest sheet
        expect(m2[0]).toHaveLength(repo.EMP_SHEET_COLS.length - 1);
        // statusLabelOf is a required door — the repo may never fall back to a label copy
        expect(() => repo.exportSheetRows(rows, rawById, deptByCode, {})).toThrow();
    });
});

describe('V2 employees screen — the write cycle (W2-2 source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');

    test('add/import buttons exist only for the server write roles; export is for every viewer', () => {
        const s = screen();
        const tools = s.match(/function toolsSeg\(\) \{[\s\S]*?\n {4}\}/)[0];
        expect(tools).toMatch(/canWrite \?/);
        expect(tools).toMatch(/data-v2-new="add"/);
        expect(tools).toMatch(/data-v2-new="import"/);
        expect(tools).toMatch(/data-v2-export/);
        expect(s).toMatch(/const canWrite = empWriteVisible\(role\)/);
        // the wiring re-checks the same roles the server's 403 rests on
        expect(s).toMatch(/if \(kind === 'add' && canWrite\)/);
        expect(s).toMatch(/if \(kind === 'import' && canWrite\)/);
    });

    test('كشف is for every reader; edit/delete ride behind the write roles', () => {
        const s = screen();
        const ra = s.match(/function rowActions\(row\) \{[\s\S]*?\n {4}\}/)[0];
        expect(ra).toMatch(/data-v2-act="file"/);
        expect(ra).toMatch(/canWrite \? `<button[^]*data-v2-act="edit"/);
        expect(ra).toMatch(/canWrite \? `<button[^]*data-v2-act="delete"/);
        expect(s).toMatch(/if \(kind === 'edit' && canWrite\)/);
        expect(s).toMatch(/if \(kind === 'delete' && canWrite\)/);
    });

    test('every irreversible act asks first, with the legacy sentence', () => {
        const s = screen();
        expect(s).toMatch(/confirmFn\('حذف هذا الموظف؟'\)/);
        expect(s).toMatch(/confirmFn\(`استيراد \$\{toSend\.length\} موظف جديد؟`\)/);
        expect(s).toMatch(/confirmFn\('تجديد بطاقة QR؟ سيصبح الرمز القديم غير صالح\.'\)/);
        expect(s).toMatch(/const confirmFn = typeof ctx\.confirmFn === 'function'[\s\S]*?Promise\.resolve\(window\.confirm\(message\)\)/);
    });

    test('one print call serves both the sheet and the QR card', () => {
        const s = screen();
        expect((s.match(/window\.print\(\)/g) || []).length).toBe(1);
        // الشارة تُلبَس من طبّاعٍ واحد مشترك، وتمسح أختها قبلها: نقرُ زرّين
        // لا يركّب ورقتين فوق بعضهما.
        const mode = s.match(/function printMode\(cls\) \{[\s\S]*?\n {4}\}/)[0];
        expect(mode).toMatch(/PRINT_MODES\.forEach\(\(c\) => document\.body\.classList\.remove\(c\)\)/);
        expect(mode).toMatch(/document\.body\.classList\.add\(cls\)/);
        expect(mode).toMatch(/afterprint/);
        expect(mode).toMatch(/setTimeout\(cleanup, 3000\)/);
        expect(mode).toMatch(/printNow\(\)/);
        const pq = s.match(/function printQrCard\(\) \{[\s\S]*?\n {4}\}/)[0];
        expect(pq).toMatch(/printMode\('erp-v2-print-card'\)/);
    });

    test('the panel is born outside both cards, so it shows in cards view too', () => {
        const s = screen();
        expect(s.lastIndexOf('<div data-v2-panel hidden>')).toBeGreaterThan(s.lastIndexOf('</section>'));
        expect(s).toMatch(/function setPanel\(html\)/);
        expect(s).toMatch(/panelEl\.hidden = false/);
        expect(s).toMatch(/panelEl\.hidden = true/);
        // in-flight fills are invalidated by panel generation, and a detached
        // screen never writes into a host that left the DOM
        expect(s).toMatch(/seq !== panelSeq \|\| panelKind !== 'file'/);
        expect(s).toMatch(/panelKind !== 'import'/);
    });

    test('every new payload string reaching the DOM is escaped', () => {
        const s = screen();
        for (const pin of [
            /data-id="\$\{esc\(String\(row\.id\)\)\}"/,
            /esc\(x\.id \|\| '—'\)/,
            /esc\(x\.name \|\| '—'\)/,
            /esc\(x\.err\)/,
            /esc\(x\.warn\)/,
            /esc\(qrUrl\)/,
            /esc\(payload\.cardId \|\| ''\)/,
            /esc\(s\.from \|\| ''\)/,
            /esc\(s\.to \|\| ''\)/,
            /esc\(r\.start\)/,
            /esc\(r\.end\)/,
            /esc\(r\.type\)/,
            /src="\$\{esc\(dataUrl\)\}"/,
            /src="\$\{esc\(photo\)\}"/,
            /esc\(ex\.deviceUserId\)/,
            /esc\(EMP_SHEET_COLS\.join\('، '\)\)/,
            /esc\(icon\)/,
            /esc\(title\)/,
            /esc\(submitLabel\)/,
            /esc\(err\)/,
        ]) {
            expect(s).toMatch(pin);
        }
    });

    test('a busy screen refuses to stack a second write, and says what finished', () => {
        const s = screen();
        // five write paths guard on busy: form save, delete, QR regen, import run, export
        expect(s.split('if (busy').length - 1).toBeGreaterThanOrEqual(5);
        expect(s).toMatch(/'جارٍ تنفيذ عملية — انتظر النتيجة'/);
        expect(s).toMatch(/'تمت إضافة الموظف'/);
        expect(s).toMatch(/'تم حفظ التعديلات'/);
        expect(s).toMatch(/'تم الحذف'/);
        expect(s).toMatch(/`تم: \$\{added\} جديد/);
        expect(s).toMatch(/'تم تجديد بطاقة QR — الرمز القديم لم يعد صالحًا'/);
    });

    test('import previews before it commits, and an existing id is skipped, never edited', () => {
        const s = screen();
        expect(s).toMatch(/function openImportPanel\(\)/);
        expect(s).toMatch(/existingIds: employeeIdSet\(\)/);
        expect(s).toMatch(/statusByLabel: statusLabelMap\(\)/);
        expect(s).toMatch(/function statusLabelMap\(\)/);
        expect(s).toMatch(/runBtn\.disabled = c\.ok === 0/);
        expect(s).toMatch(/for \(const x of toSend\) \{[\s\S]*?if \(existingIds\.has\(x\.id\)\) \{skipped \+= 1; continue;\}/);
        expect(s).toMatch(/createEmployee\(sheetRowToPayload\(x, todayIso\(\)\)\)/);
        expect(s).toMatch(/XLSX\.read\(buf, \{ type: 'array' \}\)/);
        expect(s).toMatch(/accept="\.xlsx,\.xls,\.csv"/);
        expect(s).toMatch(/data-v2-import-run disabled/);
    });

    test('export and template reuse the legacy sheet shape — no fingerprint, no card id', () => {
        const s = screen();
        expect(s).toMatch(/statusLabelOf: \(v\) => statusOf\(v\)\.label/);
        expect(s).toMatch(/writeFile\(wb, `employees_\$\{todayIso\(\)\}\.xlsx`\)/);
        expect(s).toMatch(/writeFile\(wb, 'نموذج_استيراد_الموظفين\.xlsx'\)/);
        expect((s.match(/book_append_sheet\(wb, ws, 'الموظفون'\)/g) || []).length).toBe(2);
        expect(s).toMatch(/wch: 20/);
        expect(s).not.toMatch(/digitalFingerprint|qrToken|fingerprintTemplate/);
        expect(s).toMatch(/لا يحمل البصمة الرقمية ولا رقم البطاقة/);   // declared narrowing, said in the UI
    });

    test('the photo is scaled to the legacy 300px card size before it is ever sent', () => {
        const s = screen();
        expect(s).toMatch(/const max = 300/);
        expect(s).toMatch(/toDataURL\('image\/jpeg', 0\.85\)/);
        expect(s).toMatch(/تُصغَّر إلى 300px كالبطاقة القديمة — تُرفع مع الحفظ\./);
    });

    test('the view toggle is a browser preference, never a server field', () => {
        const s = screen();
        expect(s).toMatch(/const VIEW_KEY = 'erp\.v2\.employees\.view'/);
        expect(s).toMatch(/localStorage\.setItem\(VIEW_KEY/);
    });

    test('the W2-2 CSS layer: panel, the measured spacing fix, mobile targets, paper', () => {
        const css = fs.readFileSync(HR_CSS, 'utf8');
        // sibling cards measured flush (0px) with the real CSS — the fix is one margin rule
        expect(css).toMatch(/\.erp-v2-employees \.erp-card \+ \.erp-card,/);
        expect(css).toMatch(/\.erp-v2-employees \.erp-card \+ \[data-v2-panel\] \{ margin-block-start: var\(--erp-space-4\); \}/);
        expect(css).toMatch(/\.erp-v2-employees \.erp-emp-panel \{/);
        // the mobile block — bounded by content, because the roster owns the last blocks
        const i = css.indexOf('.erp-v2-employees [data-v2-act]');
        expect(i).toBeGreaterThan(-1);
        const enc = css.lastIndexOf('@media', i);
        expect(css.slice(enc, enc + 40)).toMatch(/@media \(max-width: 640px\)/);
        const blk = css.slice(enc, css.indexOf('\n}', i));
        expect(blk).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(blk).toMatch(/grid-template-columns: 1fr/);
        // the print block hides row actions + the column-filter row, and the QR paper mode
        const j = css.indexOf('.erp-v2-employees .erp-table th[data-col="actions"]');
        const encP = css.lastIndexOf('@media', j);
        expect(css.slice(encP, encP + 20)).toMatch(/@media print/);
        const blkP = css.slice(encP, css.indexOf('\n}', j));
        expect(blkP).toMatch(/\.erp-td--actions/);
        expect(blkP).toMatch(/\.erp-tr-filter \{ display: none; \}/);
        expect(blkP).toMatch(/body\.erp-v2-print-card/);
        expect(blkP).toMatch(/\[data-v2-file-qr\] > :not\(\.erp-emp-qr-card\)/);
    });

    test('the host passes confirmFn to the employees mount', () => {
        const p = fs.readFileSync(path.join(V2, 'preview.js'), 'utf8');
        const at = p.indexOf('mountEmployeesScreen(');
        expect(at).toBeGreaterThan(-1);
        const mount = p.slice(at, p.indexOf('});', at));
        expect(mount).toMatch(/confirmFn: \(message\) => window\.confirm\(message\)/);
        expect(p).toMatch(/employeesScreen\.destroy\(\)/);
    });

    test('the migration table row 02 names the W2-2 cycle and its gates', () => {
        const m = fs.readFileSync(path.join(V2, 'MIGRATION.md'), 'utf8');
        expect(m).toMatch(/^\| 02 \| الموظفون \| `employees` \| 1 \(قراءة\) \+ دورة الكتابة الكاملة \(W2-2\)/m);
        expect(m).toMatch(/الموظفون \(W2-2/);                       // the gates section entry
        expect(m).not.toMatch(/مؤجل بتصميم[^\n]*تعديل\s*\n?\s*الموظفين/);  // no longer deferred
        expect(m).toMatch(/tests\/v2-employees\.test\.js/);
    });
});

/* ═══ W2-6 — البحث في الموظفين ══════════════════════════════════════════
 * الطلب: «عايز البحث في الموظفين… دقيق». الدليل كله محمَّل في الذاكرة،
 * فالبحث بابٌ محليٌّ بلا شبكة — والذكورُ فيه ثلاثُ خصائص لا يراها أحد في
 * الاختبار اليدوي: التطبيع، معادلةُ الأرقام الصفرية، ودرجاتُ الأولوية.
 * ═══════════════════════════════════════════════════════════════════════ */
describe('V2 employees search door (W2-6)', () => {
    function searchRepo() {
        return repoHarness(null, ['searchEmployees', 'cardExtrasMap', 'employeeToRow', 'departmentMap']).repo;
    }

    /** roster() minus the fixture's quirks: codes and fingerprints a real
     *  ZKTeco file would carry. */
    function book(repo) {
        const raw = [
            { id: 1, employeeId: 'E1', name: 'محمود سيد', department: 'KIT', position: 'شيف', phone: '01001234567', status: 'active', deviceUserId: '1001' },
            { id: 2, employeeId: '007', name: 'أحمد حسن', department: 'KIT', position: 'كاشير', phone: '', status: 'active', deviceUserId: '7' },
            { id: 3, employeeId: 'E3', name: 'ياسر إبراهيم', department: 'HALL', position: 'نادل', phone: '0112223334', status: 'suspended', deviceUserId: '' },
            { id: 4, employeeId: 'E4', name: 'كريم الله', department: 'HALL', position: 'شيف', phone: '01099998888', status: 'active', deviceUserId: '4004' },
        ];
        const depts = repo.departmentMap([{ code: 'KIT', name: 'المطبخ' }, { code: 'HALL', name: 'الصالة' }]);
        return {
            rows: raw.map((e) => repo.employeeToRow(e, depts)),
            extras: repo.cardExtrasMap(raw),
        };
    }

    const ids = (res) => res.rows.map((r) => r.id);

    test('an empty query is a passthrough, not a re-sort: same array, matched:false', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        for (const q of ['', '   ', null, undefined]) {
            const res = repo.searchEmployees(rows, q, extras);
            expect(res.matched).toBe(false);
            expect(res.rows).toBe(rows);       // لا فرز، لا نسخة
            expect(res.hits).toBe(rows.length);
        }
    });

    test('التطبيع يجيب المكتوب بخطأ المطبعي — والمطابقُ الحرفيُّ لا يُخفى', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        const folded = repo.searchEmployees(rows, 'احمد', extras);   // بدون همزة
        expect(ids(folded)).toEqual([2]);
        expect(folded.folded).toBe(true);      // الشاشة تقولها، لا تبتلعها
        const literal = repo.searchEmployees(rows, 'أحمد', extras);
        expect(ids(literal)).toEqual([2]);
        expect(literal.folded).toBe(false);
    });

    test('«007» و«7» رقمٌ واحد — مطابقةٌ تامّة بدرجة 3 على الكود والبصمة', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        const byCode = repo.searchEmployees(rows, '007', extras);
        expect(ids(byCode)).toEqual([2]);
        expect(byCode.exact).toBe(1);
        expect(byCode.folded).toBe(false);
        // نفس الرقم بصمةً: 7 هو كودٌ (007) وبصمة (7) في السطر نفسه
        expect(repo.searchEmployees(rows, '7', extras).exact).toBe(1);
    });

    test('التليفون يُمسك من أرقامه وحدها، مع فواصل أو بلا الدولة', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        expect(ids(repo.searchEmployees(rows, '1234567', extras))).toEqual([1]);
        expect(ids(repo.searchEmployees(rows, '9999 8888', extras))).toEqual([4]);
    });

    test('الأولوية: الاسم قبل القسم والمسمى، والمرتب مستقرٌّ داخل الدرجة', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        const res = repo.searchEmployees(rows, 'شيف', extras);
        // E1 و E4 مسمّاهما «شيف» (درجة 1)، ولا اسمٍ فيه «شيف» — فلا درجة 2
        expect(res.rows.every((r) => r.position === 'شيف')).toBe(true);
        expect(ids(res)).toEqual([1, 4]);     // ترتيب الدليل محفوظ
        expect(res.exact).toBe(0);
    });

    test('كلمتان = شرطٌ واحد (AND): «كريم شيف» لا تجيب من فيه إحداهما', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        const both = repo.searchEmployees(rows, 'كريم شيف', extras);
        expect(ids(both)).toEqual([4]);
        const none = repo.searchEmployees(rows, 'كريم نادل', extras);
        expect(none.hits).toBe(0);
        expect(none.rows).toEqual([]);
        expect(none.folded).toBe(false);
    });

    test('رقم البصمة حقْلُ بحثٍ حقيقية لأنه يُعرض على البطاقة', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        expect(ids(repo.searchEmployees(rows, '1001', extras))).toEqual([1]);
        expect(repo.searchEmployees(rows, '4004', extras).exact).toBe(1);
    });

    test('القسم بحقوله المعروضة: الاسم المحلول يُبحث، والكود الذي لم يُحلّ كذلك', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        expect(ids(repo.searchEmployees(rows, 'الصالة', extras))).toEqual([3, 4]);
        expect(ids(repo.searchEmployees(rows, 'المطبخ', extras))).toEqual([1, 2]);
        // الكود المخزَّن ليس حقلاً معروضًا حين ينجح الحلّ — والصندوق يبحث فيما
        // تراه الشاشة فقط (لهذا «HALL» لا يجيب هنا، ويطابق حين يفشل الحلّ).
        expect(repo.searchEmployees(rows, 'HALL', extras).hits).toBe(0);
        const unresolved = [repo.employeeToRow({ id: 9, employeeId: 'E9', name: 'رجب', department: 'HALL' }, repo.departmentMap([]))];
        expect(ids(repo.searchEmployees(unresolved, 'HALL'))).toEqual([9]);
    });

    test('بلا extras لا ينكشف: الاسم والكود والمسمى تعمل وحدها', () => {
        const repo = searchRepo();
        const { rows } = book(repo);
        const res = repo.searchEmployees(rows, 'ياسر');
        expect(ids(res)).toEqual([3]);
        expect(() => repo.searchEmployees(rows, 'بلا', new Map())).not.toThrow();
    });

    test('حقول لا تُقرأ سرية: الراتب وتوكن QR والبصمة الخام ليست في الحقول', () => {
        const repo = searchRepo();
        const raw = [{ id: 1, employeeId: 'E1', name: 'كريم', salary: 9000, qrToken: 'tok', fingerprintTemplate: 'Zm9v', deviceUserId: '1001' }];
        const rows = raw.map((e) => repo.employeeToRow(e, repo.departmentMap([])));
        const extras = repo.cardExtrasMap(raw);
        for (const q of ['9000', 'tok', 'Zm9v']) {
            expect(repo.searchEmployees(rows, q, extras).hits).toBe(0);
        }
    });

    test('the door never mutates the roster it was handed', () => {
        const repo = searchRepo();
        const { rows, extras } = book(repo);
        const before = rows.map((r) => r.id).join(',');
        repo.searchEmployees(rows, 'ك', extras);
        expect(rows.map((r) => r.id).join(',')).toBe(before);
        expect(rows).toHaveLength(4);
    });
});

describe('V2 employees screen — the search box (W2-6 source contract)', () => {
    const screen = () => fs.readFileSync(SCREEN, 'utf8');
    const table = () => fs.readFileSync(path.join(V2, 'data-display', 'data-table.js'), 'utf8');

    test('the folding lives in the door, not in the screen', () => {
        const s = screen();
        expect(s).not.toMatch(/arSearchKey|normalizeAr|\\u064B/);
        expect(s).toMatch(/searchEmployees\(allRows, searchQuery, extrasById\)/);
    });

    test('search runs before dept/status, so KPIs and the cards follow it', () => {
        const body = screen().slice(screen().indexOf('function paint()'));
        const paint = body.slice(0, body.indexOf('\n    }'));
        expect(paint.indexOf('searchEmployees')).toBeLessThan(paint.indexOf('applyEmployeeFilters'));
        expect(paint).toMatch(/applyEmployeeFilters\(searched\.rows, f\)/);
    });

    test('a search is a named filter: it shows in the scope line and arms «مسح»', () => {
        const s = screen();
        expect(s).toContain('...(term ? [`بحث: ${term}`] : [])');
        expect(s).toMatch(/clearBtn\.hidden = !on;/);
    });

    test('one search box per screen: the table primitive keeps its own for others', () => {
        expect(screen()).toMatch(/search: false,/);
        const t = table();
        expect(t).toMatch(/search: true,/);                     // default unchanged
        expect(t).toMatch(/opts\.search === false \? '' : /);   // opt-out is markup-level
        expect(t).toMatch(/if \(el\.search\)/);                 // and every use is guarded
    });

    test('the box is labelled, described by the live hint, and typed as search', () => {
        const s = screen();
        expect(s).toMatch(/<label class="erp-text-sm erp-text-muted" for="v2emp-q">بحث<\/label>/);
        expect(s).toMatch(/id="v2emp-q" data-v2-q[\s\S]{0,160}aria-describedby="v2emp-qhint"/);
        expect(s).toMatch(/id="v2emp-qhint" data-v2-qhint role="status" aria-live="polite"/);
        expect(s).toMatch(/spellcheck="false"/);
    });

    test('debounced, and the timer dies with the screen', () => {
        const s = screen();
        expect(s).toMatch(/matches\('\[data-v2-q\]'\)[\s\S]{0,120}setTimeout\(\(\) => \{[\s\S]{0,120}\}, 160\);/);
        expect(s).toMatch(/destroy\(\) \{\s*clearTimeout\(searchTimer\);/);
    });

    test('Enter opens the single hit; zero hits says so; Escape clears', () => {
        const s = screen();
        expect(s).toMatch(/if \(event\.key === 'Enter'\)[\s\S]{0,700}if \(rows\.length === 1\) \{openFilePanel\(rows\[0\]\);\}/);
        expect(s).toContain('لا نتيجة لـ«${term}»');
        expect(s).toMatch(/if \(event\.key === 'Escape'\)[\s\S]{0,300}box\.value = '';/);
    });

    test('the hint never hides a folded result, and an untouched box stays silent', () => {
        const s = screen();
        expect(s).toMatch(/if \(!res\.matched\) \{return '';\}/);
        expect(s).toMatch(/بعض النتائج بعد تطبيع الحروف/);
        expect(s).toMatch(/qHint\.textContent = searchNote\(searched\);/);
    });

    test('«/» stays with the command palette — no competing shortcut', () => {
        expect(screen()).not.toMatch(/event\.key === '\/'/);
        expect(fs.readFileSync(path.join(APP, 'js', 'ui', 'enhancement.js'), 'utf8'))
            .toMatch(/if\(e\.key === '\/' && !e\.ctrlKey\)\{/);
    });
});
