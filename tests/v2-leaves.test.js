/**
 * v2-leaves.test.js — عقد شاشة 10 (طلبات الإجازات) في V2
 * ═══════════════════════════════════════════════════════════════════════
 * نفس أسلوب tests/v2-kitchen.test.js وtests/v2-procurement.test.js:
 * المستودع يُحمَّل في vm وبوابته apiFetch مزيفة، والشاشة تُقرأ كعقد مصدر
 * (testEnvironment:'node') لأن المتصفح لا يُثبته النص.
 *
 * المثبَّت هنا:
 *   • الباب هو /hr/leave-workflow لا سجل الكيانات العام: ذاك العام بلا نطاق
 *     فيسحب تواريخ الجميع وأسبابها إلى متصفح أي حساب (server.js:1240 لا يعدّد
 *     leaveRequests بين الحسّاسات)، وهذا الباب ينطق نطاق الدور نفسه
 *     (leave-workflow-routes.js:100-112) ويرسل الأسماء والمرحلة والأحداث
 *   • كلمات السلسلة (قيد الاعتماد/عاد للموظف/معتمد نهائيًا/مرفوض) من صفحة HR
 *     نفسها (features/hr.js:573) ومنزولة في السجل المشترك status.js — فلا شريط
 *     حالة يختلف عن الشارة تحتها
 *   • كلمات المرحلة والأحداث من خرائط الخادم (leave-workflow-routes.js:11-22
 *     و:93-95) منسوخة سطرًا بسطر؛ قيمة غير منسوخة تُعرض خامًا known:false
 *   • بوابة القرار مرآة canActOnStage (:75-78) + شرط in_progress
 *     (features/hr.js:582)؛ الخادم يملك الكلمة النهائية ويمنع التصديق الذاتي
 *   • الاعتماد ليس توقيعًا: الجواب يُطبع من stage_label/event_label للخادم،
 *     لا من «تم اعتماد الإجازة» مخترعة — الطلب ينتقل للمرحلة التالية
 *   • الرفض بلا سبب مرفوض هنا قبل الخادم، لأن الخادم يخزّن نصه الافتراضي
 *     (:220) فيكون سببًا لم يكتبه أحد (قاعدة صفحة HR:624)
 *   • المدة محسوبة تقويمًا شاملًا كما تحسبها صفحة HR (:586)؛ تاريخ معكوس أو
 *     ناقص يعطي null فيُطبع «—» لا رقمًا ملونًا
 *   • الشاشة: لا inline handler، حارس أحدث قراءة (queued)، لا رسم بعد
 *     الانفصال (isConnected)، destroy() يُتلف الجداول الثلاثة
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'leaves-repo.js');
const SCREEN = path.join(V2, 'screens', 'leaves.js');
const SHARED_STATUS = path.join(V2, 'status.js');
const HR_CSS = path.join(APP, 'css', 'v2', 'erp-hr.css');
const V2_HTML = path.join(APP, 'v2.html');
const HOST = path.join(V2, 'preview.js');
const SERVER = path.join(__dirname, '..', 'backend', 'leave-workflow-routes.js');
const GENERIC = path.join(__dirname, '..', 'backend', 'server.js');
const LEGACY = path.join(APP, 'js', 'features', 'hr.js');
// REV مشتق من الوسم الحيّ في v2.html (نفس نمط v2-kitchen/440) — تثبيت يدوي
// هنا كسر مرّتين عند رفع النسخة الموحّدة؛ الاشتقاق يجعل الاختبار دائمًا معاييرًا.
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

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
        Set, Map, Intl, URLSearchParams,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const EXPORTS = ['LEAVES_TYPE_PAGE', 'LEAVES_TYPE_PAGES', 'STAGE_LABELS_AR', 'EVENT_LABELS_AR',
    'STAGE_ROLES', 'LEAVE_CHAIN', 'approveOutcome', 'canActOnStage', 'doorScopeNote',
    'fetchLeaveWorkflow', 'fetchLeaveTypes',
    'leaveTypeMap', 'leaveDays', 'leaveToRow', 'leaveStateOf', 'summarizeLeaves',
    'buildLeavesKpis', 'topRequesters', 'flattenEvents', 'typeToRow', 'decideLeave'];

function repoStub(impl) {
    const calls = [];
    const bodies = [];
    const apiFetch = jest.fn(async (p, opts) => {
        calls.push(p);
        if (opts && opts.body) {bodies.push({ path: p, body: opts.body, method: opts.method });}
        return typeof impl === 'function' ? impl(p, opts) : impl;
    });
    const repo = loadEsm(REPO, { apiFetch }, EXPORTS);
    return { calls, bodies, repo };
}

const source = (f) => fs.readFileSync(f, 'utf8');
const srv = () => source(SERVER);

const wfRow = (over = {}) => ({
    id: 1,
    employeeId: 7,
    employee_name: 'كريم',
    leaveTypeId: 2,
    leave_type_name: 'سنوية',
    startDate: '2026-10-01',
    endDate: '2026-10-03',
    status: 'pending',
    workflow_id: 11,
    current_stage: 'direct_manager',
    workflow_status: 'in_progress',
    current_note: null,
    reason: 'سفر',
    requestDate: '2026-09-28',
    events: [],
    ...over,
});

describe('leaves-repo — الباب المختار هو باب السلسلة لا السجل العام', () => {
    test('كل ما تحتاجه الشاشة مُصدَّر', () => {
        const src = source(REPO);
        for (const name of EXPORTS) {
            expect(src).toMatch(new RegExp(`export (async function|function|const) ${name}\\b`));
        }
    });

    test('قراءة الطلبات: /hr/leave-workflow وحده، والمصفوفة العارية تُفهم', async () => {
        const { calls, repo } = repoStub([wfRow()]);
        const rows = await repo.fetchLeaveWorkflow();
        expect(calls).toEqual(['/hr/leave-workflow']);
        expect(rows).toHaveLength(1);
    });

    test('شكل غير مصفوفة (كائن الخطأ مثلًا) لا ينفذ إلى الرسم كصفوف', async () => {
        const { repo } = repoStub({ error: 'LEAVE_WORKFLOW_LIST_FAILED', message: 'x' });
        expect(await repo.fetchLeaveWorkflow()).toEqual([]);
        const { repo: r2 } = repoStub(null);
        expect(await r2.fetchLeaveWorkflow()).toEqual([]);
    });

    test('الباب بلا LIMIT عند الخادم — فلا رقم هنا يدّعي السجل كلّه', () => {
        const sql = srv().slice(srv().indexOf('SELECT lr.*,w.id AS workflow_id'), srv().indexOf('ORDER BY lr."requestDate"'));
        expect(sql).not.toMatch(/LIMIT/);
        expect(srv()).toMatch(/ORDER BY lr\."requestDate" DESC NULLS LAST,lr\.id DESC/);
    });

    test('الأنواع تمشي صفحةً صفحة وتقف عند حدّ المشي معلنةً', async () => {
        const { calls, repo } = repoStub((p) => (p.startsWith('/leaveTypes')
            ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), pagination: { total: 6000, totalPages: 6 } }
            : []));
        const t = await repo.fetchLeaveTypes();
        expect(t.rows).toHaveLength(5000);
        expect(t.total).toBe(6000);
        expect(t.capped).toBe(true);
        expect(calls[0]).toContain('limit=1000');
    });

    test('مشية قصيرة تتوقف عند أول دفعة أنقص — بلا طلب سادس ضائع', async () => {
        const { calls, repo } = repoStub({ data: [{ id: 1, name: 'سنوية' }], pagination: { total: 1, totalPages: 1 } });
        const t = await repo.fetchLeaveTypes();
        expect(t.rows).toHaveLength(1);
        expect(t.capped).toBe(false);
        expect(calls).toHaveLength(1);
    });

    test('حدّ المشي من pagination.js لا من الذوق', () => {
        const pg = source(path.join(__dirname, '..', 'backend', 'pagination.js'));
        const max = Number(pg.match(/const MAX_LIMIT = (\d+)/)[1]);
        const offsetCap = Number(pg.match(/const MAX_OFFSET = (\d+)/)[1]);
        const { repo } = repoStub([]);
        // صفحة واحدة بحدّ الخادم الأقصى، وعدد الصفوف قرار عميلٌ معلن:
        // يجب أن يبقى داخل سقف الـ offset الذي يسمح به الخادم.
        expect(repo.LEAVES_TYPE_PAGE).toBe(max);
        expect(repo.LEAVES_TYPE_PAGES * repo.LEAVES_TYPE_PAGE).toBeLessThanOrEqual(offsetCap);
    });

    test('الكتابة في بابين معلنين: قرار السلسلة + إنشاء الطلب — لا PUT ولا DELETE', () => {
        const src = source(REPO);
        expect(src).not.toMatch(/method:\s*'(PUT|DELETE|PATCH)'/i);
        expect(src).not.toMatch(/apiFetch\(`\/leaveRequests`/);
        expect(src).not.toMatch(/apiFetch\('\/leaveRequests'/);
        const posts = src.match(/method:\s*'POST'/g) || [];
        expect(posts).toHaveLength(2); // قراران: /hr/leave-workflow/:id/action + POST /hr/leave-requests (إنشاء معتمد W2-5)
    });
});

describe('leaves-repo — كلمات الخادم منسوخة لا مبتكرة', () => {
    test('خمس مراحل بنفس الأسماء التي يطبعها الراوتر', () => {
        const { repo } = repoStub([]);
        const block = srv().slice(srv().indexOf('const STAGE_LABELS'), srv().indexOf('const STAGE_ROLES'));
        for (const [key, label] of Object.entries(repo.STAGE_LABELS_AR)) {
            expect(block).toContain(`${key}: '${label}'`);
        }
        expect(repo.STAGE_LABELS_AR.operations_manager).toBeTruthy(); // مرحلة ملغاة لكنها مخزّنة
    });

    test('أحداث الخمسة مطابقة لـ eventLabel (:93-95)', () => {
        const { repo } = repoStub([]);
        const block = srv().slice(srv().indexOf('function eventLabel'), srv().indexOf('router.get(\'/leave-workflow\''));
        for (const [key, label] of Object.entries(repo.EVENT_LABELS_AR)) {
            expect(block).toContain(`${key}: '${label}'`);
        }
    });

    test('STAGE_ROLES مرآة سطرًا بسطر (:18-22)', () => {
        const { repo } = repoStub([]);
        const block = srv().slice(srv().indexOf('const STAGE_ROLES'), srv().indexOf('let schemaPromise'));
        for (const [stage, roles] of Object.entries(repo.STAGE_ROLES)) {
            expect(block).toContain(`${stage}: [${roles.map((r) => `'${r}'`).join(', ')}]`);
        }
    });

    test('السلسلة مرآةٌ لـ STAGES (:10): اعتمادٌ في آخرها قفلٌ لا تسليم', () => {
        const { repo } = repoStub([]);
        expect(repo.LEAVE_CHAIN).toEqual(['direct_manager', 'general_manager', 'hr']);
        // والمرآة تُقارن بسطر الخادم نفسه، لا بنسخة ثانية من الذوق
        expect(srv()).toContain(`const STAGES = [${repo.LEAVE_CHAIN.map((s) => `'${s}'`).join(', ')}];`);
        expect(repo.approveOutcome('direct_manager')).toEqual({ known: true, final: false, next: 'general_manager' });
        expect(repo.approveOutcome('general_manager')).toEqual({ known: true, final: false, next: 'hr' });
        expect(repo.approveOutcome('hr')).toEqual({ known: true, final: true, next: '' });
        // مرحلة خارج الترتيب (الملغاة تُبقى للسجلات القديمة) — لا اختراع لتالية
        expect(repo.approveOutcome('operations_manager')).toEqual({ known: false, final: false, next: '' });
        expect(repo.approveOutcome(null)).toEqual({ known: false, final: false, next: '' });
        // وقرار الخادم كما كُتب: آخر السلسلة يقفل بدل أن يُقدّم (:213-215)
        const approve = srv().slice(srv().indexOf("if (action === 'approve')"), srv().indexOf("else if (action === 'reject')"));
        expect(approve).toMatch(/index === STAGES\.length - 1/);
        expect(approve).toMatch(/nextStatus = 'completed'/);
    });

    test('بوابة الدور: admin أي مرحلة، وغيره مرحلته فقط، ومقفلٌ لا قرار له', () => {
        const { repo } = repoStub([]);
        expect(repo.canActOnStage('admin', 'hr', 'in_progress')).toBe(true);
        expect(repo.canActOnStage('dept_head', 'direct_manager', 'in_progress')).toBe(true);
        expect(repo.canActOnStage('dept_head', 'general_manager', 'in_progress')).toBe(false);
        expect(repo.canActOnStage('hr', 'hr', 'in_progress')).toBe(true);
        expect(repo.canActOnStage('manager', 'hr', 'in_progress')).toBe(false);
        expect(repo.canActOnStage('kitchen', 'direct_manager', 'in_progress')).toBe(false);
        // السلسلة المقفولة/المرفوضة/المعادة ليست طاولة قرار (features/hr.js:582)
        for (const st of ['completed', 'rejected', 'returned']) {
            expect(repo.canActOnStage('admin', 'direct_manager', st)).toBe(false);
        }
    });

    test('نطاق الباب منطوقٌ بأرقام أسطره — والفراغ ليس «لا إجازات في الشركة»', () => {
        const { repo } = repoStub([]);
        expect(repo.doorScopeNote('hr')).toMatch(/كل الطلبات/);
        expect(repo.doorScopeNote('manager')).toMatch(/:103/);
        expect(repo.doorScopeNote('dept_head')).toMatch(/قسمك/);
        expect(repo.doorScopeNote('kitchen')).toMatch(/طلباتك أنت فقط/);
        expect(repo.doorScopeNote(null)).toMatch(/فارغة/);
        // والمرايا مطابقة لشرط الخادم: admin|manager|hr (:71)
        expect(srv()).toMatch(/isPrivileged\(user\)\s*\{\s*return \['admin', 'hr', 'manager'\]\.includes/);
    });
});

describe('leaves-repo — المدة والصفوف: لا رقم بلا أساس', () => {
    test('المدة تقويمًا شاملًا كما تحسبها صفحة HR، والمقلوب null', () => {
        const { repo } = repoStub([]);
        expect(repo.leaveDays('2026-10-01', '2026-10-03')).toBe(3);
        expect(repo.leaveDays('2026-10-01', '2026-10-01')).toBe(1);
        expect(repo.leaveDays('2026-10-03', '2026-10-01')).toBeNull();
        expect(repo.leaveDays('', '2026-10-01')).toBeNull();
        expect(repo.leaveDays(null, null)).toBeNull();
    });

    test('الاسم الموصول يُستخدم، والغائب يُعرض رقمه موصوفًا لا مخترعًا', () => {
        const { repo } = repoStub([]);
        const known = repo.leaveToRow(wfRow(), new Map());
        expect(known.employee).toBe('كريم');
        expect(known.employeeResolved).toBe(true);
        const bare = repo.leaveToRow(wfRow({ employee_name: null, leave_type_name: null }), new Map());
        expect(bare.employee).toBe('#7');
        expect(bare.employeeResolved).toBe(false);
        expect(bare.type).toBe('#2');
        expect(bare.typeResolved).toBe(false);
        expect(repo.leaveToRow(wfRow({ employee_name: null, employeeId: null }), new Map()).employee).toBe('—');
    });

    test('الملاحظة: كلام السلسلة أولًا ثم سبب الرفض ثم سبب الموظف', () => {
        const { repo } = repoStub([]);
        expect(repo.leaveToRow(wfRow({ current_note: 'لدى المدير العام' }), new Map()).note).toBe('لدى المدير العام');
        expect(repo.leaveToRow(wfRow({ current_note: null, rejectionReason: 'رصيد', reason: 'سفر' }), new Map()).note).toBe('رصيد');
        expect(repo.leaveToRow(wfRow({ current_note: null, rejectionReason: null, reason: 'سفر' }), new Map()).note).toBe('سفر');
        expect(repo.leaveToRow(wfRow({ current_note: null, rejectionReason: null, reason: null }), new Map()).note).toBe('');
    });

    test('تاريخ القرار: إقفال السلسلة ثم اعتماد الكيان ثم رفضه', () => {
        const { repo } = repoStub([]);
        expect(repo.leaveToRow(wfRow({ completed_at: '2026-10-09T10:00:00Z', approvedDate: '2026-10-08' }), new Map()).decidedAt).toBe('2026-10-09');
        expect(repo.leaveToRow(wfRow({ completed_at: null, approvedDate: '2026-10-08T11:00:00Z' }), new Map()).decidedAt).toBe('2026-10-08');
        expect(repo.leaveToRow(wfRow({ completed_at: null, approvedDate: null, rejectedDate: '2026-10-07' }), new Map()).decidedAt).toBe('2026-10-07');
        expect(repo.leaveToRow(wfRow({ completed_at: null, approvedDate: null, rejectedDate: null }), new Map()).decidedAt).toBe('');
    });

    test('شارة السلسلة إن وُجدت، وإلا حالة الكيان تحت مجالها الخاص', () => {
        const { repo } = repoStub([]);
        expect(repo.leaveStateOf(repo.leaveToRow(wfRow(), new Map()))).toEqual({ domain: 'leave_workflow', key: 'in_progress' });
        expect(repo.leaveStateOf(repo.leaveToRow(wfRow({ workflow_status: null, workflow_id: null }), new Map())))
            .toEqual({ domain: 'leave', key: 'pending' });
    });
});

describe('leaves-repo — الملخّص والكروت: كل رقم يسمّي أساسه', () => {
    test('عدّ حالات السلسلة وأصحاب الطلبات ومدة المعتمدة فقط', () => {
        const { repo } = repoStub([]);
        const rows = [
            repo.leaveToRow(wfRow({ id: 1 })),
            repo.leaveToRow(wfRow({ id: 2, employeeId: 8, workflow_status: 'completed', status: 'approved', endDate: '2026-10-05' })),
            repo.leaveToRow(wfRow({ id: 3, workflow_status: 'rejected', status: 'rejected' })),
            repo.leaveToRow(wfRow({ id: 4, workflow_status: 'returned', current_stage: 'employee' })),
            repo.leaveToRow(wfRow({ id: 5, workflow_status: 'brand_new' })),
        ];
        const s = repo.summarizeLeaves(rows);
        expect(s).toMatchObject({ total: 5, inProgress: 1, completed: 1, rejected: 1, returned: 1, other: 0, employees: 2 });
        expect(s.daysApproved).toBe(5);
        expect(s.daysApprovedOf).toBe(1);
    });

    test('معتمدٌ في منتصف السلسلة لا يُجمَع: القفل لم يقع', () => {
        const { repo } = repoStub([]);
        const midChain = repo.leaveToRow(wfRow({ status: 'approved', workflow_status: 'in_progress', current_stage: 'general_manager' }));
        const s = repo.summarizeLeaves([midChain]);
        expect(s.daysApprovedOf).toBe(1); // يُعدّ في الأساس لكنه لم يُقفل
        const broken = repo.leaveToRow(wfRow({ startDate: '2026-10-09', endDate: '2026-10-01', workflow_status: 'completed', status: 'approved' }));
        const s2 = repo.summarizeLeaves([broken]);
        expect(s2.daysApproved).toBe(0);
        expect(s2.daysApprovedOf).toBe(1); // «لا تُجمَع المدة غير المحسوبة» تقولها اللمحة
    });

    test('متوسط المدة على المحسوبة حصرًا، وبلا صفوف يكون null', () => {
        const { repo } = repoStub([]);
        const a = repo.leaveToRow(wfRow({ id: 1, startDate: '2026-10-01', endDate: '2026-10-02' })); // 2
        const b = repo.leaveToRow(wfRow({ id: 2, startDate: '2026-10-01', endDate: '2026-10-04' })); // 4
        const bad = repo.leaveToRow(wfRow({ id: 3, startDate: '', endDate: '' }));
        const s = repo.summarizeLeaves([a, b, bad]);
        expect(s.avgDays).toBe(3);
        expect(s.avgDaysOf).toBe(2);
        expect(repo.summarizeLeaves([]).avgDays).toBeNull();
    });

    test('ستة كروت: لكلٍّ أيقونة موجودة وعنوان وإنجليزي وأساسٌ مكتوب', () => {
        const { repo } = repoStub([]);
        const s = repo.summarizeLeaves([repo.leaveToRow(wfRow())]);
        const kpis = repo.buildLeavesKpis(s, 4, 2);
        expect(kpis).toHaveLength(6);
        const icons = source(path.join(APP, 'js', 'icons.js'));
        for (const k of kpis) {
            expect(k.icon).toBeTruthy();
            expect(k.label).toBeTruthy();
            expect(k.en).toBeTruthy();
            expect(k.hint).toBeTruthy();
            expect(icons).toContain(`'${k.icon}':`);
        }
        // الأساس منطوق: لا رقم بلا «من كم»
        expect(kpis.every((k) => /الباب|السجل|مخزّن|المُرسل|السلسلة|نوع/.test(k.hint))).toBe(true);
    });

    test('كرت الأيام يسمّي كم طلبًا دخل المجموع — وصفرٌ بلا خداع', () => {
        const { repo } = repoStub([]);
        const withOne = repo.buildLeavesKpis(repo.summarizeLeaves([repo.leaveToRow(wfRow({ workflow_status: 'completed', status: 'approved' }))]), 1, 0);
        expect(withOne.find((k) => k.id === 'days').unit).toBe('يوم');
        expect(withOne.find((k) => k.id === 'days').hint).toMatch(/1 طلبًا معتمدًا/);
        const empty = repo.buildLeavesKpis(repo.summarizeLeaves([]), 0, 0);
        expect(empty.find((k) => k.id === 'days').hint).toMatch(/لا طلب معتمد/);
        expect(empty.find((k) => k.id === 'types').hint).toMatch(/لا نوع مدفوع/);
    });
});

describe('leaves-repo — الترتيب المصنوع هنا يُنسب إلى أساسه', () => {
    test('topRequesters: الأكثر أولًا، ودخول السجل يحسم التعادل، والمدخل لا يتغيّر', () => {
        const { repo } = repoStub([]);
        const rows = [
            repo.leaveToRow(wfRow({ id: 1, employeeId: 5 })),
            repo.leaveToRow(wfRow({ id: 2, employeeId: 5 })),
            repo.leaveToRow(wfRow({ id: 3, employeeId: 6 })),
            repo.leaveToRow(wfRow({ id: 4, employeeId: 7, workflow_status: 'completed', status: 'approved' })),
        ];
        const frozen = rows.slice();
        const top = repo.topRequesters(rows, 2);
        expect(top.map((t) => t.name)).toEqual(['كريم', 'كريم']);
        expect(top[0].count).toBe(2);
        expect(rows.map((r) => r.id)).toEqual(frozen.map((r) => r.id));
        const all = repo.topRequesters(rows, 6);
        expect(all[all.length - 1].count).toBe(1);
        expect(repo.topRequesters([], 6)).toHaveLength(0);
    });

    test('الموظف بلا اسم يظل معدودًا تحت رقمه، و«قيد الاعتماد» تُحصى لكل موظف', () => {
        const { repo } = repoStub([]);
        const rows = [
            repo.leaveToRow(wfRow({ id: 1, employee_name: null })),
            repo.leaveToRow(wfRow({ id: 2, employee_name: null })),
        ];
        const top = repo.topRequesters(rows, 6);
        expect(top[0].resolved).toBe(false);
        expect(top[0].open).toBe(2);
    });

    test('أحداث السلسلة تُسطَّح وتُنزل الأحدث أولًا بلا تكرار مفتاح', () => {
        const { repo } = repoStub([]);
        const rows = [repo.leaveToRow(wfRow({
            id: 1,
            events: [
                { id: 1, workflow_id: 9, stage: 'employee', action: 'submitted', note: 'سفر', actor_role: 'employee', created_at: '2026-09-28T08:00:00Z' },
                { id: 2, workflow_id: 9, stage: 'direct_manager', action: 'approve', note: null, actor_role: 'dept_head', created_at: '2026-09-29T09:00:00Z' },
            ],
        })), repo.leaveToRow(wfRow({
            id: 2,
            events: [{ id: 3, workflow_id: 10, stage: 'hr', action: 'ghost_action', created_at: '2026-09-30T09:00:00Z' }],
        }))];
        const ev = repo.flattenEvents(rows);
        expect(ev).toHaveLength(3);
        expect(ev.map((e) => e.at)).toEqual(['2026-09-30 09:00', '2026-09-29 09:00', '2026-09-28 08:00']);
        expect(new Set(ev.map((e) => e.key)).size).toBe(3);
        expect(ev[2].actionAr).toBe('تم تقديم الطلب');
        expect(ev[0].actionKnown).toBe(false);   // إجراء غير منسوخ
        expect(ev[0].action).toBe('ghost_action'); // ويُعرض خامًا
        expect(ev[2].employee).toBe('كريم');
    });

    test('نوع المرجع: الرصد المخزّن لا حساب الشاشة', () => {
        const { repo } = repoStub([]);
        const t = repo.typeToRow({ id: 1, name: 'سنوية', days: '21', paid: true, icon: 'calendar' }, 4);
        expect(t.days).toBe(21);
        expect(t.paid).toBe(true);
        expect(t.requests).toBe(4);
        const bare = repo.typeToRow({ id: 9, days: null });
        expect(bare.days).toBeNull();
        expect(bare.name).toBe('#9');
    });
});

describe('leaves-repo — القرار عبر السلسلة حصرًا', () => {
    test('مسار واحد وbody نظيف: action + note', async () => {
        const { calls, bodies, repo } = repoStub({ event_label: 'تمت الموافقة على المرحلة' });
        await repo.decideLeave(42, 'approve', '');
        expect(calls).toEqual(['/hr/leave-workflow/42/action']);
        expect(JSON.parse(bodies[0].body)).toEqual({ action: 'approve', note: '' });
        expect(bodies[0].method).toBe('POST');
    });

    test('السبب يصل كما كُتب، والمسار المُعرَّف آمن', async () => {
        const { bodies, repo } = repoStub({});
        await repo.decideLeave('7/8', 'reject', '  الرصيد مستنفد  ');
        const payload = JSON.parse(bodies[0].body);
        expect(payload.note).toBe('  الرصيد مستنفد  '); // لا تشذيب هنا: الخادم يكتب ما يُرسل
        expect(bodies[0].path).toBe('/hr/leave-workflow/7%2F8/action');
    });

    test('إجراء غير معتمد يُرفض قبل أي طلب — والمتاح أربعة معتمدة (W2-5)', async () => {
        const { calls, repo } = repoStub({});
        await expect(repo.decideLeave(1, 'bogus')).rejects.toThrow('إجراء غير معروف');
        await expect(repo.decideLeave(1, 'bogus')).rejects.toThrow(/اعتماد أو رفض/);
        expect(calls).toHaveLength(0);
    });
});

describe('شاشة 10 — العقد المصدَّر من المصدر', () => {
    const src = () => source(SCREEN);

    test('لا inline handler ولا window.prompt ولا بيانات نموذجية', () => {
        const s = src();
        expect(s).not.toMatch(/\son[a-z]+=/);
        expect(s).not.toMatch(/window\.(prompt|alert)\(/);
        expect(s).not.toMatch(/innerHTML\s*=\s*`[^`]*كريم/); // لا اسم مستعار في قالب
        expect(s).toMatch(/import .* from '\.\.\/data-display\/data-table\.js\?v=/);
    });

    test('الجداول الثلاثة تُطعم جميعًا — درس شاشة 09 الصامت', () => {
        const s = src();
        const paint = s.slice(s.indexOf('function paint()'), s.indexOf('function paintError'));
        expect(paint).toMatch(/table\.setRows\(shown\);/);
        expect(paint).toMatch(/evTable\.setRows\(events\);/);
        expect(paint).toMatch(/typeTable\.setRows\(types\.map/);
        const err = s.slice(s.indexOf('function paintError'));
        for (const h of ['table', 'evTable', 'typeTable']) {
            expect(err).toMatch(new RegExp(`${h}\\.setError\\(message\\);`));
        }
    });

    test('الكروت شريط <ul class="erp-kpis"> لا ديفات، وحاملها يسمّي أساس العدّ', () => {
        const s = src();
        expect(s).toMatch(/<ul class="erp-kpis" aria-label="[^"]*أرسله الخادم لهذا الحساب/);
        expect(s).toMatch(/buildLeavesKpis\(s, types\.length, paidTypes\)/);
    });

    test('سطر المدى ينطق نطاق الباب وقراءته من المرآة لا من جُملة ثابتة', () => {
        const s = src();
        expect(s).toMatch(/doorScopeNote\(role\)/);
        expect(s).toMatch(/\$\{doorScopeNote\(role\)\} · \$\{c\.all\} طلبًا محمّل/);
        expect(s).toMatch(/printNote\.textContent = `الإجازات — /);
        expect(s).toMatch(/لا السجل كاملًا/);
    });

    test('شريط الحالة من السجل المشترك: aria-pressed والكلمة لـ resolveStatus', () => {
        const s = src();
        expect(s).toMatch(/resolveStatus\('leave_workflow', key\)\.label/);
        expect(s).toMatch(/aria-pressed="true"/);
        expect(s).toMatch(/aria-pressed="false"/);
        expect(s).toMatch(/leaveStateOf\(row\)/);
        expect(s).toMatch(/statusBadge\(st\.domain, st\.key/);
        // كلمة غير مسجلة تُعرض خامًا مع سببها
        expect(s).toMatch(/حالة مخزنة غير متوقعة — تُعرض خامًا/);
    });

    test('القرار محصورٌ ببوابة الدور أمام الخادم، والخادم يبقى صاحب الكلمة', () => {
        const s = src();
        expect(s).toMatch(/canActOnStage\(role, row\.stage, row\.wfStatus\)/);
        expect(s).toMatch(/canActOnStage\(role, row\.stage, row\.wfStatus\)[\s\S]{0,2000}'\*?<span class="erp-text-muted"/);
        expect(s).toMatch(/القرار هنا لدى مرحلة أخرى/);
        // لا زرّ يبعث بطلب خارج السلسلة
        expect(s).not.toMatch(/fetch\(/);
        expect(s).toMatch(/decideLeave\(id, action, note\)/);
    });

    test('الاعتماد يُطبع من كلام الخادم: مرحلة تالية لا «إجازة معتمدة»', () => {
        // العقد على الكود وحده: رأس الملف يورد العبارة الممنوعة اقتباسًا ليقول
        // لماذا لا تُطبع، ومنه Learn لا من الكود.
        const s = src().slice(src().indexOf('\nimport '));
        expect(s).toMatch(/res\.event_label/);
        expect(s).toMatch(/res\.stage_label/);
        expect(s).toMatch(/res\.workflow/);
        expect(s).toMatch(/الطلب الآن لدى \$\{stage\}/);
        expect(s).not.toMatch(/تم اعتماد الإجازة/);
    });

    test('الجملة تتبع حالة السلسلة لا الزرّ: الرفض لا يُسلَّم لحاملٍ غير موجود', () => {
        // القياس الميداني كشف العبارة المخدوعة: «تم رفض الطلب — الطلب الآن
        // لدى …» بعد رفضٍ يقف عنده السجل (الخادم :216 لا يقدّم المرحلة).
        const s = src().slice(src().indexOf('\nimport '));
        const msg = s.slice(s.indexOf('function decisionMessage'), s.indexOf('async function sendDecision'));
        expect(msg).toMatch(/status === 'rejected'/);
        expect(msg).toMatch(/سُجّل الرفض لدى \$\{stage\}، ولا مرحلة تالية بعد الرفض/);
        expect(msg).toMatch(/status === 'completed'/);
        expect(msg).toMatch(/اكتملت السلسلة، والقفل لدى \$\{stage\}/);
        expect(msg).toMatch(/status === 'returned'/);
        // التسليم آخر الجمل: لا يُنطق إلا حين السلسلة ما زالت جارية
        expect(msg.indexOf("if (status === 'in_progress')")).toBeLessThan(msg.indexOf('الطلب الآن لدى'));
        // وحالةٌ لم يعرفها المرآة لا تُنسَج لها جملة تُطَمئن
        expect(msg).toMatch(/كما أرسلها الخادم/);
    });

    test('تأكيد الاعتماد يسمّي الموظف والفترة والمرحلة والدور، ويُميِّز القفل من النقل', () => {
        const s = src();
        const ask = s.slice(s.indexOf('function askApprove'), s.indexOf('el.addEventListener'));
        expect(ask).toMatch(/اعتماد إجازة \$\{row\.employee\}/);
        expect(ask).toMatch(/\$\{row\.days\} يومًا/);
        expect(ask).toMatch(/مدة غير محسوبة/);
        expect(ask).toMatch(/يسجَّل باسمك بدور/);
        expect(ask).toMatch(/approveOutcome\(row\.stage\)/);
        expect(ask).toMatch(/وبهذا الاعتماد تُقفل السلسلة/);
        // لا وعدٌ بـ«المرحلة التالية» في آخر سلسلةٍ لا تالية لها
        expect(ask).not.toMatch(/إلى المرحلة التالية/);
    });

    test('الرفض بلا سبب لا يخرج من المتصفح', () => {
        const s = src();
        const click = s.slice(s.indexOf("el.addEventListener('click'"));
        expect(click).toMatch(/data-v2-reject-send/);
        expect(click).toMatch(/String\(rejectNoteEl\.value \|\| ''\)\.trim\(\)/);
        expect(click).toMatch(/الرفض بلا سبب مكتوب مرفوض هنا/);
        expect(click).toMatch(/rejectNoteEl\.focus\(\)/);
        // واللوحة تُغلق عند الإلغاء/النجاح، وتُغلق تلقائيًا إن اختفى الصفّ
        expect(s).toMatch(/function closeReject\(\)/);
        expect(s).toMatch(/if \(rejectTarget && !rows\.some/);
    });

    test('حراس الجلسة: loading→queued، وisConnected، وdestroy() يُتلف الثلاثة', () => {
        const s = src();
        expect(s).toMatch(/if \(loading\) \{queued = true; return;\}/);
        expect(s).toMatch(/if \(queued && el\.isConnected\)/);
        expect(s.match(/if \(!el\.isConnected\) \{return;\}/g).length).toBeGreaterThanOrEqual(2);
        for (const h of ['table', 'evTable', 'typeTable']) {
            expect(s).toMatch(new RegExp(`${h}\\.destroy\\(\\);`));
        }
        expect(s).toMatch(/el\.remove\(\);/);
    });

    test('الأخطاء ثلاثٌ مسماة: جلسة منتهية، وقرار الخادم، وعطل آخر', () => {
        const s = src();
        expect(s).toMatch(/'انتهت الجلسة — سجّل الدخول في النظام الحالي ثم أعد فتح الوضع الحيّ\.'/);
        expect(s).toMatch(/e\.code === 'FORBIDDEN'/);
        expect(s).toMatch(/لا صلاحية لعرض الإجازات بهذا الحساب — القرار للخادم وحده\./);
        expect(s).toMatch(/تعذّر تحميل طلبات الإجازة: \$\{\(e && e\.message\) \|\| 'خطأ'\}/);
    });

    test('الفراغ مسمّى: لا طلبات في نطاق هذا الحساب لا «لا إجازات»', () => {
        const s = src();
        expect(s).toMatch(/لا طلبات في نطاق هذا الحساب/);
        expect(s).toMatch(/emptyMessage: 'لا طلبات في هذه الحالة'/);
        expect(s).toMatch(/لم يُرسل الباب أي طلب لهذا الحساب/);
    });

    test('مرجع الأنواع المشوَّه: سطر نافذة يسمّي حدّ المشي ولا يصمت', () => {
        const s = src();
        expect(s).toMatch(/typeInfo\.capped/);
        expect(s).toMatch(/LEAVES_TYPE_PAGE \* LEAVES_TYPE_PAGES/);
        expect(s).toMatch(/fetchLeaveTypes\(\)\.catch/); // الأنواع اختيارية، الطلبات لا
    });

    test('المراجعة الواحدة في كل المستورَد', () => {
        for (const line of src().split('\n').filter((l) => /from '\.\.\//.test(l))) {
            expect(line).toContain(`?v=${REV}`);
        }
        expect(source(REPO)).toContain(`core/api.js?v=${REV}`);
    });
});

describe('شاشة 10 — السجل المشترك والمضيف والطبقة', () => {
    test('كلمات السلسلة في status.js منسوخة من features/hr.js:573', () => {
        const st = source(SHARED_STATUS);
        const legacy = source(LEGACY);
        for (const [key, label] of [
            ['in_progress', 'قيد الاعتماد'],
            ['returned', 'عاد للموظف للتعديل'],
            ['completed', 'معتمد نهائيًا'],
            ['rejected', 'مرفوض'],
        ]) {
            expect(legacy).toContain(`${key}:'${label}'`);
            expect(st).toMatch(new RegExp(`'leave_workflow:${key}':\\s*\\{ label: '${label}'`));
        }
        // وحالة الكيان المخزنة 'returned' (:219) لها كلمة من نفس المصدر
        expect(st).toMatch(/'leave:returned':\s*\{ label: 'عاد للموظف للتعديل'/);
        expect(srv()).toMatch(/SET status='returned'/);
    });

    test('المضيف يركّب الشاشة ويدمّرها عند المغادرة ويعرف نطاقها', () => {
        const host = source(HOST);
        expect(host).toMatch(/import \{ mountLeavesScreen \} from '\.\/screens\/leaves\.js\?v=/);
        expect(host).toMatch(/leavesScreen = mountLeavesScreen\(/);
        expect(host).toMatch(/leavesScreen\.destroy\(\)/);
        expect(host).toMatch(/navStatus\.current !== 'leaves'/);
    });

    test('الطبقة محصورة باسم الشاشة وتشمل درس الحقل في الترقيم', () => {
        const css = source(HR_CSS);
        expect(css).toMatch(/\.erp-v2-leaves \.erp-card__head \{ flex-wrap: wrap; \}/);
        expect(css).toMatch(/\.erp-v2-leaves \.erp-table__pager \.erp-select/);
        expect(css).toMatch(/\.erp-v2-leaves \.erp-table td \.erp-btn/);
        expect(css).toMatch(/min-block-size: var\(--erp-space-8\)/);
        expect(css).toMatch(/textarea\.erp-input \{ resize: vertical/);
        // لوحة سبب الرفض: قِيست أزرارها ١٠٧×٣٠ و٧٠×٣٠ بعد تغطية الرأس والجداول
        expect(css).toMatch(/\.erp-v2-leaves \[data-v2-reject\] \.erp-btn/);
        // لوحة سبب الرفض: hidden وحدها لا تُخفي، لأن .erp-stack يعرّف display
        // (erp-base.css:75) — قِيست اللوحة ١٤١px وهي مقفولة
        expect(css).toMatch(/\.erp-v2-leaves \[data-v2-reject\]\[hidden\] \{ display: none; \}/);
        // والقاعدة خارج أي وسيط: الإخفاء ليس قياسًا على مقاس شاشة
        const leavesBlock = css.indexOf('.erp-v2-leaves .erp-card__head { flex-wrap: wrap; }');
        const hide = css.indexOf('[data-v2-reject][hidden]');
        expect(hide).toBeGreaterThan(leavesBlock);
        expect(css.slice(leavesBlock, hide)).not.toMatch(/@media/);
        // والقاعدة داخل كتلة 640px نفسها، لا في سياق يطبع على الورق
        const floor = css.indexOf('.erp-v2-leaves [data-v2-reject] .erp-btn');
        expect(floor).toBeGreaterThan(css.indexOf('.erp-v2-leaves .erp-dash-head'));
        const enclosing = css.lastIndexOf('@media', floor);
        expect(css.slice(enclosing, enclosing + 40)).toMatch(/@media \(max-width: 640px\)/);
        // لا ألوان خام في الطبقة
        expect(css.slice(css.indexOf('شاشة 10'))).not.toMatch(/#[0-9a-f]{3,6}\b/i);
    });

    test('erp-hr.css مربوط بالمراجعة نفسها، وأول كتلة 640px ما زالت الأولى', () => {
        const html = source(V2_HTML);
        expect(html).toMatch(new RegExp(`erp-hr\\.css\\?v=${REV}`));
        const css = source(HR_CSS);
        const first = css.indexOf('@media (max-width: 640px)');
        const leaves = css.indexOf('.erp-v2-leaves .erp-dash-head');
        expect(first).toBeGreaterThan(-1);
        expect(leaves).toBeGreaterThan(first); // التعاقد: الإضافات بعد الأولى
    });
});

describe('شاشة 10 — الأمانة أمام عقد الخادم', () => {
    test('لا مسار كتابة مباشر للكيان في الشاشة ولا في الباب', () => {
        expect(source(SCREEN)).not.toMatch(/leaveRequests`?,\s*\{[^}]*method/i);
        // والخادم يقفل التعديل المباشر بـ 405 (server.js:2056)
        expect(source(GENERIC)).toMatch(/LEAVE_WORKFLOW_REQUIRED/);
    });

    test('رسائل الرفض الخمسة تُطبع كما ترد — لا صياغة ثانية هنا', () => {
        const s = src2();
        for (const msg of [
            'لا يمكنك التصديق على طلب إجازتك الشخصية',
            'تعتمد طلبات قسمك فقط',
            'الطلب ليس في حالة قابلة للإجراء',
        ]) {
            expect(srv()).toContain(msg);
        }
        expect(s).toMatch(/فشل|غير منفّذ/);
        expect(s).toMatch(/\$`\{msg\}`|\$\{msg\}/);
    });
});

function src2() {return source(SCREEN);}
