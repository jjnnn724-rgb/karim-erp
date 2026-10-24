/**
 * v2-bulk-import.test.js — عقد الاستيراد الجماعي (26د)
 * ═══════════════════════════════════════════════════════════════════════
 * المرجع: frontend/app/js/features/bulk-import.js (586 سطرًا) للسلوك،
 *   backend/server.js:1677-1695 (POST /users) و:1802-1829 (POST /employees)
 *   و:1132-1143 (رئيس القسم يحتاج dept_code)،
 *   backend/cashier-module/jwt-middleware.js:87 (قوة كلمة المرور).
 *
 * المثبَّت: الأسماء الخالصة (تطبيع/صيغ/بصمات/تصدير)، وباب الشبكة الوحيد
 * (المستخدم ثم الموظف، وتراجع أفضل-جهد)، وبوابة العلم+الدور في الشاشتين.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const PURE = path.join(V2, 'bulk-import.js');
const REPO = path.join(V2, 'data', 'bulk-import-repo.js');
const WIZARD = path.join(V2, 'bulk-import-wizard.js');
const CSS = path.join(APP, 'css', 'v2', 'erp-bulk-import.css');
const V2_HTML = path.join(APP, 'v2.html');
const REV = (fs.readFileSync(V2_HTML, 'utf8').match(/js\/v2\/preview\.js\?v=([0-9.]+)/) || [])[1];

const read = (p) => fs.readFileSync(p, 'utf8');

function loadEsm(file, injections = {}, collect = []) {
    const stripped = read(file)
        .replace(/^import\s+[\s\S]*?\s+from\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^import\s+'[^']*';?[^\S\r\n]*$/gm, '')
        .replace(/^export\s+/gm, '');
    const src = collect.length
        ? `${stripped}\n;Object.assign(globalThis, {${collect.join(', ')}});`
        : stripped;
    const context = {
        console, JSON, String, Number, Boolean, Array, Object, RegExp, Error,
        Date, Math, Promise, Set, Map, Intl, encodeURIComponent,
        ...injections,
    };
    vm.createContext(context);
    vm.runInContext(src, context, { filename: file });
    return context;
}

describe('bulk-import — الحساب الخالص', () => {
    const ctx = loadEsm(PURE, {}, ['BULK_PASSWORD_LENGTH', 'BULK_DEFAULT_ROLE']);

    test('تطبيع الأسماء العربية إلى لاتيني كما القديم', () => {
        expect(ctx.transliterateName('أحمد علي')).toBe('ahmd aly');
        expect(ctx.transliterateName('  Ahmed   Ali  ')).toBe('ahmed   ali');
        expect(ctx.transliterateName('مُحَمَّد!')).toBe('mhmd');
        expect(ctx.transliterateName('')).toBe('');
    });

    test('قراءة الأسماء من النص ومن الملف', () => {
        expect(ctx.parseBulkNames('أحمد\n\nمحمد\nب')).toEqual(['أحمد', 'محمد']);
        expect(ctx.parseBulkNames('أحمد\tمحمد')).toEqual(['أحمد محمد']);
        expect(ctx.parseBulkFileText('أحمد,محمد;علي\nخالد')).toEqual(['أحمد', 'محمد', 'علي', 'خالد']);
    });

    test('كلمة المرور 12 خانة: حرفان + 10 أرقام (شرط الخادم)', () => {
        for (let i = 0; i < 100; i += 1) {
            const password = ctx.generateBulkPassword();
            expect(password).toHaveLength(ctx.BULK_PASSWORD_LENGTH);
            expect(password).toMatch(/^[a-z]{2}\d{10}$/);
            expect(password).toMatch(/[a-z]/);
            expect(password).toMatch(/\d/);
        }
        const seq = [0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99];
        let at = 0;
        expect(ctx.generateBulkPassword(() => seq[at++])).toBe('zz9999999999');
    });

    test('صيغ اسم المستخدم الأربعة + البادئة + لاحقة التعارض + سقف 30', () => {
        const used = new Set();
        expect(ctx.generateUsername('Ahmed Ali', 0, 'first_num', '', used)).toBe('ahmed1');
        expect(ctx.generateUsername('Ahmed Ali', 1, 'full_dot', '', used)).toBe('ahmed.ali');
        expect(ctx.generateUsername('Ahmed Ali', 2, 'initials_num', '', used)).toBe('a003');
        expect(ctx.generateUsername('Ahmed Ali', 11, 'emp_num', 'gv_', used)).toBe('gv_emp012');
        expect(ctx.generateUsername('Ahmed Ali', 0, 'first_num', '', used)).toBe('ahmed12');
        const long = ctx.generateUsername('A'.repeat(60), 0, 'first_num', '', new Set());
        expect(long.length).toBeLessThanOrEqual(30);
    });

    test('صور رقم البصمة تمنع تعارض 7 مع 007', () => {
        expect(ctx.fingerprintForms('7')).toEqual(['7', '007']);
        expect(ctx.fingerprintForms('007')).toEqual(['007', '7']);
        expect(ctx.fingerprintForms('')).toEqual([]);
        const used = ctx.usedFingerprintSet([
            { deviceUserId: '7' }, { employeeId: '007' }, { employeeId: 'abc' }, { deviceUserId: '' },
        ]);
        expect(used.has('7')).toBe(true);
        expect(used.has('007')).toBe(true);
        expect(used.has('abc')).toBe(false);
        expect(ctx.allocateFingerprints(1, 3, new Set(['2']))).toEqual(['1', '3', '4']);
    });

    test('الصفوف: الحقول الستة، dept_code لرئيس القسم فقط، وتخطي المستخدم', () => {
        const rows = ctx.buildBulkRows(['أحمد علي', 'منى حسن'], {
            format: 'first_num',
            role: 'dept_head',
            deptCode: 'D1',
            fpStart: 5,
            usedUsernames: new Set(['ahmed1']),
            usedFingerprints: new Set(['5']),
            passwordFactory: () => 'ab123456',
        });
        expect(rows.map((r) => r.username)).toEqual(['ahmd1', 'mna2']);
        expect(rows.map((r) => r.fp)).toEqual(['6', '7']);
        expect(rows.every((r) => r.role === 'dept_head' && r.dept_code === 'D1')).toBe(true);
        expect(rows.every((r) => r.password === 'ab123456')).toBe(true);
        const employeeRows = ctx.buildBulkRows(['Sara'], { role: 'employee', deptCode: 'D1' });
        expect(employeeRows[0].dept_code).toBe('');
        expect(ctx.BULK_DEFAULT_ROLE).toBe('employee');
    });

    test('الإحصاءات والنسخ وCSV وJSON وExcel', () => {
        const rows = [
            { name: 'Ahmad', username: 'ahmed1', password: 'ab123456', role: 'employee', fp: '6' },
            { name: 'Mona', username: 'mona2', password: 'cd654321', role: 'employee', fp: '7' },
        ];
        const roleNames = { employee: 'موظف', admin: 'مدير' };
        expect(ctx.bulkPreviewStats(rows)).toEqual({
            total: 2, roles: 1, passwordLength: 12, uniqueUsernames: 2,
        });
        expect(ctx.bulkToCopyText(rows)).toBe('1. Ahmad | ahmed1 | ab123456\n2. Mona | mona2 | cd654321');
        const csv = ctx.bulkToCsv([{ ...rows[0], name: 'A "B"' }], roleNames);
        expect(csv.split('\n')[0]).toBe('#,الاسم,اسم المستخدم,كلمة المرور,رقم البصمة,الدور');
        expect(csv).toContain('"A ""B"""');
        expect(csv).toContain('"موظف"');
        expect(ctx.bulkToJson(rows, roleNames)[0]).toEqual({
            index: 1, name: 'Ahmad', username: 'ahmed1', password: 'ab123456',
            fingerprintId: '6', role: 'employee', roleName: 'موظف',
        });
        const aoa = ctx.bulkToExcelAoa(rows, roleNames);
        expect(aoa[0]).toHaveLength(6);
        expect(aoa[1][5]).toBe('موظف');
    });

    test('طباعة الجدول والقصاصات: تهريب HTML لا تنفيذ', () => {
        const rows = [{
            name: '<script>alert(1)</script>', username: 'x"y', password: 'ab123456',
            role: 'employee', fp: '9',
        }];
        const table = ctx.bulkPrintTableHtml({ rows, roleNames: { employee: 'موظف' }, orgName: 'شركة', logoUrl: '/x.ico', createdAt: 'الآن' });
        expect(table).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(table).not.toContain('<script>alert(1)</script>');
        expect(table).toContain('x&quot;y');
        const slips = ctx.bulkPrintSlipsHtml({ rows, roleNames: { employee: 'موظف' }, orgName: 'شركة', logoUrl: '/x.ico', createdAt: 'الآن' });
        expect(slips).toContain('بيانات الدخول الخاصة بك');
        expect(slips).toContain('&lt;script&gt;');
    });
});

describe('bulk-import-repo — باب الشبكة الوحيد', () => {
    function makeRepo(overrides = {}) {
        const calls = [];
        const api = {
            fetchUsers: async () => [{ username: 'ahmed1' }, { username: '' }, null],
            fetchEmployees: async () => [{ id: 1, deviceUserId: '7' }],
            fetchDepartments: async () => [{ code: 'D1' }],
            createUser: async (payload) => { calls.push(['createUser', payload]); return { id: 42 }; },
            createEmployee: async (payload) => { calls.push(['createEmployee', payload]); return { id: 7 }; },
            deleteUser: async (id) => { calls.push(['deleteUser', id]); return {}; },
        };
        for (const [name, fn] of Object.entries(overrides)) {
            api[name] = async (...args) => { calls.push([name, ...args]); return fn(...args); };
        }
        const ctx = loadEsm(REPO, api, ['BULK_IMPORT_WRITE_ROLES', 'loadBulkImportContext', 'bulkUserPayload', 'bulkEmployeePayload', 'createBulkAccount']);
        return { ctx, calls };
    }

    test('الأدوار: الأدمن وحده (الخادم يمنع غيره من تعيين role)', () => {
        const { ctx } = makeRepo();
        expect(ctx.BULK_IMPORT_WRITE_ROLES).toEqual(['admin']);
    });

    test('السياق: أسماء مستخدمين بلا فراغات + موظفون + أقسام', async () => {
        const { ctx } = makeRepo();
        await expect(ctx.loadBulkImportContext()).resolves.toEqual({
            usernames: ['ahmed1'],
            employees: [{ id: 1, deviceUserId: '7' }],
            departments: [{ code: 'D1' }],
        });
    });

    test('حمولة المستخدم: الحقول الستة وdept_code لرئيس القسم فقط', () => {
        const { ctx } = makeRepo();
        const employeePayload = ctx.bulkUserPayload({ username: ' a1 ', password: 'ab123456', role: 'employee', name: ' أحمد ', dept_code: 'D1' });
        expect(employeePayload).toEqual({ username: 'a1', password: 'ab123456', role: 'employee', name: 'أحمد', active: true });
        const headPayload = ctx.bulkUserPayload({ username: 'h1', password: 'ab123456', role: 'dept_head', name: 'رئيس', dept_code: 'D1' });
        expect(headPayload.dept_code).toBe('D1');
    });

    test('حمولة الموظف: حقول القديم حرفيًّا والرقم الوظيفي = البصمة', () => {
        const { ctx } = makeRepo();
        expect(ctx.bulkEmployeePayload({ name: 'أحمد', fp: '6' }, {
            department: 'D1', position: 'موظف', joinDate: '2026-10-17', userId: 42,
        })).toEqual({
            name: 'أحمد', employeeId: '6', deviceUserId: '6', department: 'D1',
            position: 'موظف', phone: '', email: '', joinDate: '2026-10-17',
            salary: 0, status: 'active', userId: 42, iqamaExpiry: null,
            healthCertExpiry: null, healthEduExpiry: null, photo: null,
            digitalFingerprint: null, cardId: null,
        });
    });

    test('حساب ثم موظف مرتبط، والتراجع يحذف الحساب عند فشل الموظف', async () => {
        const ok = makeRepo();
        const saved = await ok.ctx.createBulkAccount(
            { name: 'أحمد', username: 'a1', password: 'ab123456', role: 'employee' },
            { department: 'D1', position: 'موظف', joinDate: '2026-10-17' },
        );
        expect(saved.user.id).toBe(42);
        expect(ok.calls.map((c) => c[0])).toEqual(['createUser', 'createEmployee']);
        expect(ok.calls[1][1].userId).toBe(42);

        const failing = makeRepo({ createEmployee: async () => { throw new Error('EMPLOYEE_FAIL'); } });
        await expect(failing.ctx.createBulkAccount(
            { name: 'أحمد', username: 'a1', password: 'ab123456', role: 'employee' },
            { department: 'D1' },
        )).rejects.toThrow('EMPLOYEE_FAIL');
        expect(failing.calls.map((c) => c[0])).toEqual(['createUser', 'createEmployee', 'deleteUser']);
        expect(failing.calls[2][1]).toBe(42);

        const userFails = makeRepo({ createUser: async () => { throw new Error('USER_FAIL'); } });
        await expect(userFails.ctx.createBulkAccount(
            { name: 'أحمد', username: 'a1', password: 'ab123456', role: 'employee' }, {},
        )).rejects.toThrow('USER_FAIL');
        expect(userFails.calls.map((c) => c[0])).toEqual(['createUser']);
    });
});

describe('bulk-import-wizard — عقد المعالج', () => {
    const src = read(WIZARD);

    test('لا شبكة داخل المعالج — كل نداء عبر الباب', () => {
        expect(src).toMatch(/from '\.\/data\/bulk-import-repo\.js\?v=/);
        expect(src).toContain('loadBulkImportContext');
        expect(src).toContain('createBulkAccount');
        expect(src).not.toMatch(/\bfetch\s*\(/);
        expect(src).not.toMatch(/apiFetch/);
    });

    test('نفس خطوات القديم ونصوصه: 3 خطوات + النتيجة والتنبيه', () => {
        expect(src).toContain('إدخال الأسماء');
        expect(src).toContain('الإعدادات');
        expect(src).toContain('المراجعة والتصدير');
        expect(src).toContain('سيتم إضافة ${state.rows.length} من المستخدمين إلى النظام. هل تريد المتابعة؟');
        expect(src).toContain('احفظ نسخة من بيانات الدخول الآن');
        expect(src).toContain('تحميل Excel');
        expect(src).toContain('تحميل CSV');
        expect(src).toContain('نسخ كل الباسوردات');
        expect(src).toContain('طباعة جدول');
        expect(src).toContain('طباعة قصاصات');
        expect(src).toContain('أدخل أسماء الموظفين أولاً');
        expect(src).toContain('لم يتم العثور على أسماء صالحة');
    });

    test('بلا معالجات inline، والنتيجة تُغلق عبر onDone لا onCancel', () => {
        expect(src).not.toMatch(/\son(click|change|input|drop)\s*=/i);
        expect(src).toMatch(/if \(state\.step === 4\) \{finish\(\); return;\}/);
        expect(src).toMatch(/showHeader !== false/);
        expect(src).toMatch(/resultTitle\(result\)/);
    });

    test('وسم section يُغلق قبل الترويسة، وصندوق الملاحظة موجود دائمًا', () => {
        // الفحص الحي كشف غياب '>': المتصفح ابتلع <header> كسمات، فاختفت
        // ترويسة المعالج وزر إغلاقها من الشجرة رغم ظهور النص.
        expect(src).toMatch(/<section class="erp-bulk__shell"\$\{showHeader \?/);
        expect(src).toMatch(/aria-label="استيراد موظفين جماعي"'\}>/);
        // رسالة «أدخل أسماء الموظفين أولاً» تصل قبل أي paint: العنصر يجب أن
        // يكون مرسومًا مخفيًا ليستقبل flash بدل أن يضيع في الشاشة الأم.
        expect(src).toContain("${message ? '' : ' hidden'}");
        expect(src).not.toMatch(/if \(!state\.note\.message\) \{return '';\}/);
    });

    test('الملف المصدر يحمل إصدار الصفحة نفسه في كل استيراد', () => {
        for (const file of [WIZARD, REPO]) {
            const versions = [...read(file).matchAll(/\?v=([0-9.]+)/g)].map((m) => m[1]);
            expect(versions.length).toBeGreaterThan(0);
            expect(new Set(versions)).toEqual(new Set([REV]));
        }
    });
});

describe('طبقة CSS وعقد v2.html', () => {
    test('ملف CSS محصور ومحايد tokens-only', () => {
        const css = read(CSS);
        expect(css).toMatch(/^\.erp-v2 \.erp-bulk/m);
        expect(css).toContain('.erp-v2 .erp-bulk [hidden] { display: none !important; }');
        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/\bz-index\s*:/);
        expect(css).not.toMatch(/^\.erp-v2 \.erp-(btn|card|input|select)\b/m);
        expect(css).toContain('@media (max-width: 640px)');
    });

    test('v2.html يحمل الملف بالإصدار الحالي', () => {
        expect(read(V2_HTML)).toContain(`css/v2/erp-bulk-import.css?v=${REV}`);
    });
});
