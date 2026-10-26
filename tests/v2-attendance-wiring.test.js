/**
 * v2-attendance-wiring.test.js — عقد توصيل أدوات الحضور (P0-4)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: data/attendance-repo.js (الدوال الثلاث) + screens/attendance.js.
 * البند P0-4 يقول: الدوال سليمة ومكتوبة، والشاشة لا تستورد أيًا منها.
 * هذا العقد يقيس الطرفين معًا:
 *   أ) دالة العقد نفسها صحيحة (وحدة): attWriteVisible · validatePunchForm ·
 *      buildTodayExceptions — فلا نبني على دالةٍ معطوبة.
 *   ب) الشاشة تستوردها فعلًا وتستدعيها في المواضع الصحيحة (عقد مصدري)،
 *      مع الحفاظ على ثوابت الشاشة: بلا `fetch(` مباشر، بلا معالجات inline،
 *      و`attToolsFor`/`canResolve` باقيتان.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const REPO = path.join(V2, 'data', 'attendance-repo.js');
const SCREEN = path.join(V2, 'screens', 'attendance.js');

const read = (p) => fs.readFileSync(p, 'utf8');
/** مصدر بلا تعليقات — للعقود التي تقيس الكود لا النثر. */
const code = (p) => read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .split('\n')
        .filter((line) => !/^\s*import\b|^\s*from\s*'[^']*';?\s*$/.test(line))
        .join('\n')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, encodeURIComponent, decodeURIComponent,
        TextDecoder, Uint8Array, Intl,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

const REPO_EXPORTS = ['attWriteVisible', 'ATT_WRITE_ROLES', 'validatePunchForm',
    'validateReason', 'buildTodayExceptions', 'EXCEPTION_TYPES_AR', 'EXCEPTION_TONES',
    'workedHoursText', 'todayIso'];

function repoHarness() {
    const apiFetch = jest.fn(async () => ({ data: [], total: 0 }));
    return loadEsm(REPO, { apiFetch }, REPO_EXPORTS);
}

describe('أ. دالة العقد: attWriteVisible', () => {
    test('الأدوار الثلاثة التي يقبلها الخادم كتابةً فقط', () => {
        const r = repoHarness();
        expect(r.ATT_WRITE_ROLES).toEqual(['admin', 'manager', 'hr']);
        for (const role of ['admin', 'manager', 'hr']) {
            expect(r.attWriteVisible(role)).toBe(true);
        }
        for (const role of ['dept_head', 'accountant', 'cashier', 'employee', '', null, undefined]) {
            expect(r.attWriteVisible(role)).toBe(false);
        }
    });
});

describe('ب. دالة العقد: validatePunchForm', () => {
    test('رسائل الشاشة الحالية نفسها وبالترتيب نفسه', () => {
        const r = repoHarness();
        expect(r.validatePunchForm({}))
            .toEqual({ ok: false, message: 'أدخل بصمة واحدة على الأقل' });
        expect(r.validatePunchForm({ checkIn: '9:5', reason: 'x' }))
            .toEqual({ ok: false, message: 'صيغة الوقت HH:MM' });
        expect(r.validatePunchForm({ checkIn: '09:05' }))
            .toEqual({ ok: false, message: 'اكتب السبب' });
        expect(r.validatePunchForm({ checkIn: '09:05', reason: 'نسي' , reasonLabel: 'اكتب سبب التصحيح'}))
            .toEqual({ ok: true, checkIn: '09:05', checkOut: '', reason: 'نسي' });
    });

    test('الترتيب: الحضور قبل الصيغة قبل السبب (لا رسالة تخفي أخرى)', () => {
        const r = repoHarness();
        // بصمة ناقصة الصيغة + بلا سبب ⇒ رسالة الصيغة هي الأولى
        expect(r.validatePunchForm({ checkIn: '25:99' }).message).toBe('صيغة الوقت HH:MM');
        // خروج صحيح + بلا سبب ⇒ رسالة السبب
        expect(r.validatePunchForm({ checkOut: '17:00' }).message).toBe('اكتب السبب');
    });

    test('يُشذّب الطرفين ويقبل الانصراف وحده', () => {
        const r = repoHarness();
        const out = r.validatePunchForm({ checkOut: ' 17:30 ', reason: '  عذر  ' });
        expect(out).toEqual({ ok: true, checkIn: '', checkOut: '17:30', reason: 'عذر' });
    });
});

describe('ج. دالة العقد: buildTodayExceptions', () => {
    const TODAY = '2026-10-16';
    const employees = [
        { id: 1, name: 'أ', status: 'active', department: 'KIT' },
        { id: 2, name: 'ب', status: 'active', department: 'OPS' },
        { id: 3, name: 'ج', status: 'inactive', department: 'OPS' },
    ];

    test('full: الغياب يُشتق من دليل الموظفين النشطين، وغير النشط لا يظهر', () => {
        const r = repoHarness();
        const data = r.buildTodayExceptions({
            records: [], employees, leaves: [], todayStr: TODAY, full: true,
        });
        expect(data.date).toBe(TODAY);
        expect(data.rows).toHaveLength(2);                 // الموظفون النشطون فقط
        expect(data.rows.every((x) => x.type === 'absent')).toBe(true);
        expect(data.open).toBe(2);
        expect(data.excused).toBe(0);
        expect(data.rows[0].label).toBe(r.EXCEPTION_TYPES_AR.absent);
        expect(data.rows[0].tone).toBe('danger');
    });

    test('التصنيف: ناقص/تأخير/انصراف مبكر بنصوص التفصيل نفسها', () => {
        const r = repoHarness();
        const recs = [
            { employeeId: 1, date: TODAY, checkIn: '09:00', checkOut: '' },            // ناقص
            { employeeId: 2, date: TODAY, checkIn: '10:12', checkOut: '18:00', late: true }, // متأخر
        ];
        const data = r.buildTodayExceptions({
            records: recs, employees, leaves: [], todayStr: TODAY, full: false,
        });
        const byType = Object.fromEntries(data.rows.map((x) => [String(x.emp.id), x]));
        expect(byType['1'].type).toBe('missing');
        expect(byType['1'].detail).toBe('حضور 09:00 بلا انصراف');
        expect(byType['2'].type).toBe('late');
        expect(byType['2'].tone).toBe('warning');
    });

    test('الانصراف بلا حضور ناقص، وساعاته «—» لا رقمًا مُختلقًا', () => {
        const r = repoHarness();
        const data = r.buildTodayExceptions({
            records: [{ employeeId: 1, date: TODAY, checkIn: '', checkOut: '17:00' }],
            employees, leaves: [], todayStr: TODAY, full: false,
        });
        expect(data.rows[0].type).toBe('missing');
        expect(data.rows[0].detail).toBe('انصراف 17:00 بلا حضور');
        expect(data.rows[0].hours).toBe('—');
    });

    test('«حتى الآن» مشروطةٌ بالساعة: تمرّرها الشاشة فيُحسب، وتغيب فيصفر', () => {
        const r = repoHarness();
        const rec = { employeeId: 1, date: TODAY, checkIn: '09:00', checkOut: '' };
        const hoursAt = (nowMinutes) => r.buildTodayExceptions({
            records: [rec], employees, leaves: [], todayStr: TODAY, full: false, nowMinutes,
        }).rows[0].hours;
        expect(hoursAt(13 * 60)).toBe('4.00');            // 09:00 → 13:00
        expect(hoursAt(null)).toBe('0.00');               // بلا ساعة: لا «حتى الآن»
        // قاعدة hr.js نفسها: اليوم الماضي ببصمة واحدة بلا نهاية ⇒ صفر
        expect(r.workedHoursText({ date: '2026-10-15', checkIn: '09:00', checkOut: '' },
            { todayStr: TODAY, nowMinutes: 600 })).toBe('0.00');
    });

    test('الساعة قبل البصمة «—» لا رقم مُختلَق، ووردية منتصف الليل تبقى صحيحة', () => {
        const r = repoHarness();
        const early = r.buildTodayExceptions({
            records: [{ employeeId: 1, date: TODAY, checkIn: '08:05', checkOut: '' }],
            employees, leaves: [], todayStr: TODAY, full: false, nowMinutes: 5 * 60 + 5,
        }).rows[0].hours;
        expect(early).toBe('—');                          // لا 21.00 ساعةً لا وجود لها
        // ورديةٌ تعبر منتصف الليل بـبصمتَيها: الطرفان حقيقيان فالجمع +24 باقٍ
        expect(r.workedHoursText({ date: TODAY, checkIn: '22:00', checkOut: '06:00' }, { todayStr: TODAY }))
            .toBe('8.00');
    });

    test('العذر المعتمد ينقل الاستثناء من «مفتوح» إلى «معذور»', () => {
        const r = repoHarness();
        const leaves = [{ status: 'approved', employeeId: 2, startDate: TODAY, endDate: TODAY }];
        const before = r.buildTodayExceptions({ employees, leaves: [], todayStr: TODAY, full: true });
        const after = r.buildTodayExceptions({ employees, leaves, todayStr: TODAY, full: true });
        expect(before.open).toBe(2);
        expect(after.open).toBe(1);
        expect(after.excused).toBe(1);
        expect(after.rows.find((x) => String(x.emp.id) === '2').excused).toBe(true);
    });

    test('full:false لا يختلق غيابًا: يُصنّف السجلات المحمّلة وحدها', () => {
        const r = repoHarness();
        const data = r.buildTodayExceptions({
            records: [{ employeeId: 2, date: TODAY, checkIn: '09:00', checkOut: '17:30', early_leave: true }],
            employees, leaves: [], todayStr: TODAY, full: false,
        });
        expect(data.rows).toHaveLength(1);                 // لا صفوف غياب
        expect(data.rows[0].type).toBe('early');
    });

    test('تاريخ بلا قيمة صحيحة ينزل إلى اليوم الحقيقي (لا NaN)', () => {
        const r = repoHarness();
        const data = r.buildTodayExceptions({ employees: [], todayStr: 'not-a-date', full: true });
        expect(data.date).toBe(r.todayIso());
        expect(data.rows).toHaveLength(0);
    });
});

describe('د. الشاشة توصّل الدوال الثلاث فعلًا', () => {
    test('تستورد attWriteVisible وvalidatePunchForm وbuildTodayExceptions', () => {
        const src = read(SCREEN);
        expect(src).toMatch(/from '\.\.\/data\/attendance-repo\.js\?v=/);
        expect(src).toMatch(/attWriteVisible/);
        expect(src).toMatch(/validatePunchForm/);
        expect(src).toMatch(/buildTodayExceptions/);
    });

    test('canWrite مشتقة من attWriteVisible مع canResolve (لا سلطة ثانية)', () => {
        const src = code(SCREEN);
        expect(src).toMatch(/const canWrite = canResolve && attWriteVisible\(ctx\.role\);/);
        // الأزرار الكتابية الثلاثة تُحكم بـcanWrite لا بـcanResolve مباشرة
        expect((src.match(/canWrite \?/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    test('validatePunchForm يحكم مساري التعبئة والتصحيح', () => {
        const src = code(SCREEN);
        expect((src.match(/validatePunchForm\(\{/g) || []).length).toBe(2);
        expect(src).toMatch(/reasonLabel: 'اكتب سبب التصحيح'/);
        // الحقول المقروءة بعد التحقق من ناتج الدالة لا من DOM مباشرة
        expect(src).toMatch(/const ci = punch\.checkIn;/);
        expect(src).toMatch(/const co = punch\.checkOut;/);
    });

    test('submitExcuse يرفض عذرًا بلا سبب عبر validateReason', () => {
        const src = code(SCREEN);
        expect(src).toMatch(/validateReason\(reason, 'اكتب سبب العذر'\)/);
        expect(src).toMatch(/reason: check\.reason/);
    });

    test('صندوق اليوم مركّب من buildTodayExceptions ويُحكم بcanWrite', () => {
        const src = code(SCREEN);
        expect(src).toMatch(/data-v2-today/);
        expect(src).toMatch(/buildTodayExceptions\(\{/);
        expect(src).toMatch(/host\.innerHTML = todayBlock\(data, \{ withAction: canWrite, deptByCode \}\);/);
        // الأعذار تُطلب مرة واحدة ثم يُعاد الرسم
        expect(src).toMatch(/ensureLeaves\(\)\.then\(\(\) => \{/);
        // «حتى الآن» في عمود الساعات: الشاشة هي مَن يمرّر الساعة، لا الدالة
        expect(src).toMatch(/nowMinutes: now\.getHours\(\) \* 60 \+ now\.getMinutes\(\)/);
    });

    test('لا يُرسم الصندوق إذا كان اليوم خارج الفترة المحمّلة', () => {
        const src = code(SCREEN);
        expect(src).toMatch(/if \(today < from \|\| today > to\) \{/);
        expect(src).toMatch(/استثناءات اليوم خارج الفترة المختارة/);
    });

    test('زر «معالجة» في صندوق اليوم يعيد استخدام نفس مأخذ المعالجة', () => {
        const src = code(SCREEN);
        const block = src.slice(src.indexOf('function todayBlock'));
        expect(block).toMatch(/data-v2-resolve=/);
        expect(block).toMatch(/r\.excused \? '' :/);
    });
});

describe('هـ. ثوابت الشاشة لم تُكسر', () => {
    test('لا fetch مباشر ولا apiFetch ولا معالجات inline', () => {
        const src = read(SCREEN);
        expect(src).not.toMatch(/\bapiFetch\b/);
        expect(src).not.toMatch(/[^a-zA-Z]fetch\(/);
        expect(src.match(/\son[a-z]+\s*=\s*["']/g) || []).toHaveLength(0);
    });

    test('attToolsFor/canResolve باقيتان، ونداء الطباعة واحد، وصفر ألوان خامة', () => {
        const src = read(SCREEN);
        expect(src).toMatch(/attToolsFor\(ctx\.role\)/);
        expect(src).toMatch(/canResolve/);
        expect((src.match(/window\.print\(/g) || []).length).toBe(1);
        expect(src).not.toMatch(/rgba?\(/);
    });

    test('الاستيرادات كلها بأسماء مصدَّرة فعلًا (رسم ESM سليم)', () => {
        const repo = read(REPO);
        for (const name of ['attWriteVisible', 'validatePunchForm', 'buildTodayExceptions', 'validateReason']) {
            expect(repo).toMatch(new RegExp(`export (?:async )?function ${name}\\b`));
        }
    });
});
