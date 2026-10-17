/**
 * v2-departments-write.test.js — عقد كتابة الأقسام (P1-3)
 * ═══════════════════════════════════════════════════════════════════════
 * المثبَّت: الحمولات تطابق legacy حرفًا (بدون id/حقول نظامية)، وكود HR
 * العربي/الفارغ يُستبدل بكود لاتيني آمن (مفتاح ربط الموظفين)، والحذف
 * الكارثي (departments → CASCADE) يمرّ بتأكيدين، وكل كتابة وراء الدور+العلم.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const V2 = path.join(__dirname, '..', 'frontend', 'app', 'js', 'v2');
const REPO = path.join(V2, 'data', 'departments-write-repo.js');
const read = (p) => fs.readFileSync(p, 'utf8');

function loadRepo() {
    const src = read(REPO)
        .replace(/^import .*$/gm, '')
        .replace(/^export\s+/gm, '');
    const calls = [];
    const apiFetch = (url, opts) => {
        calls.push({ url, opts: opts || {} });
        return Promise.resolve({ ok: true });
    };
    const ctx = { console, apiFetch };
    vm.createContext(ctx);
    vm.runInContext(src, ctx, { filename: REPO });
    return { ctx, calls };
}

describe('منطق الكتابة — departments-write-repo', () => {
    const { ctx, calls } = loadRepo();

    test('كود HR: لاتيني يبقى، والعربي/الفارغ يُولَّد بأمان وثبات', () => {
        expect(ctx.safeHrCode(' hrd-01 ')).toBe('HRD-01');
        expect(ctx.safeHrCode('مطبخ')).toMatch(/^HRD-[0-9A-Z]{1,6}$/);
        const stamp = 1730000000000;
        expect(ctx.safeHrCode('', stamp)).toBe('HRD-' + stamp.toString(36).toUpperCase().slice(-6));
        expect(ctx.safeHrCode('مطبخ', stamp)).toBe(ctx.safeHrCode('', stamp));
    });

    test('قسم: الاسم والكود مطلوبان، والكود 3 أحرف كحد أقصى', () => {
        expect(ctx.validateDepartmentForm({ name: 'مطبخ' }, null).ok).toBe(false);
        expect(ctx.validateDepartmentForm({ name: 'مطبخ', code: 'ABCD' }, null).ok).toBe(false);
        const v = ctx.validateDepartmentForm({ name: ' مطبخ ', code: 'ktc', icon: 'chef-hat', color: '#123456', parent_code: 'FIN' }, null);
        expect(v.ok).toBe(true);
        expect(Object.keys(v.payload).sort()).toEqual(['code', 'color', 'icon', 'name', 'parent_code']);
        expect(v.payload).toEqual({ code: 'KTC', name: 'مطبخ', icon: 'chef-hat', color: '#123456', parent_code: 'FIN' });
    });

    test('تعديل قسم: لا كود ولا لون في الحمولة (كما legacy)', () => {
        const v = ctx.validateDepartmentForm({ name: 'مطبخ', icon: '', parent_code: '' }, { id: 4, code: 'KTC' });
        expect(v.ok).toBe(true);
        expect(v.payload).toEqual({ name: 'مطبخ', icon: 'building', parent_code: null });
    });

    test('قسم HR: إنشاء يولّد الكود، وتعديل لا يغيّر الكود', () => {
        const created = ctx.validateHrDepartmentForm({ name: ' مخبز ', code: 'مخبز', manager: ' أحمد ' }, null);
        expect(created.ok).toBe(true);
        expect(created.payload.name).toBe('مخبز');
        expect(created.payload.code).toMatch(/^HRD-[0-9A-Z]{1,6}$/);
        expect(created.payload.manager).toBe('أحمد');

        const updated = ctx.validateHrDepartmentForm({ name: 'مخبز', manager: '' }, { id: 9, code: 'HRD-ABC123' });
        expect(updated.payload).toEqual({ name: 'مخبز', manager: null });
        expect(updated.payload.code).toBeUndefined();
    });

    test('المسارات والأفعال: الباب العام القائم دون خلق باب جديد', () => {
        calls.length = 0;
        ctx.createDepartment({ code: 'KTC', name: 'مطبخ' });
        ctx.updateDepartment(7, { name: 'مطبخ' });
        ctx.deleteDepartment(7);
        ctx.createHrDepartment({ code: 'HRD-1', name: 'مخبز' });
        ctx.updateHrDepartment(9, { name: 'مخبز' });
        ctx.deleteHrDepartment(9);
        expect(calls.map((c) => `${c.opts.method} ${c.url}`)).toEqual([
            'POST /departments', 'PUT /departments/7', 'DELETE /departments/7',
            'POST /hrDepartments', 'PUT /hrDepartments/9', 'DELETE /hrDepartments/9',
        ]);
        expect(calls[0].opts.body).toBe(JSON.stringify({ code: 'KTC', name: 'مطبخ' }));
    });
});

describe('الشاشات — الدور والعلم والحذف الآمن', () => {
    test('الأقسام: الزر والإجراءات وراء الدور+العلم، والحذف بتأكيدين', () => {
        const s = read(path.join(V2, 'screens', 'departments.js'));
        expect(s).toMatch(/canWrite\(ctx\.role, DEPARTMENT_WRITE_ROLES\) && departmentWriteEnabled\(\)/);
        expect(s).toMatch(/data-v2-dept-add/);
        expect(s).toMatch(/data-v2-dept-edit=/);
        expect(s).toMatch(/data-v2-dept-del=/);
        expect(s).toMatch(/confirmFn\(/);
        expect(s).toMatch(/للتأكيد النهائي، اكتب: حذف/);
        expect(s).toMatch(/typed !== 'حذف'/);
        expect(s).not.toMatch(/from '\.\.\/\.\.\/core\/api\.js/);
    });

    test('أقسام HR: الكتابة وراء العلم، والقراءة تبقى عندما يكون مغلقًا', () => {
        const s = read(path.join(V2, 'screens', 'hr-departments.js'));
        expect(s).toMatch(/canWrite\(ctx\.role, HR_DEPARTMENT_WRITE_ROLES\) && hrDepartmentWriteEnabled\(\)/);
        expect(s).toMatch(/data-v2-hrd-add/);
        expect(s).toMatch(/data-v2-hrd-edit=/);
        expect(s).toMatch(/data-v2-hrd-del=/);
        expect(s).toMatch(/confirmFn\(/);
        expect(s).not.toMatch(/from '\.\.\/\.\.\/core\/api\.js/);
    });

    test('لا استيراد مباشر لـapiFetch خارج طبقة data', () => {
        const repo = read(REPO);
        expect(repo).toMatch(/import \{ apiFetch \} from '\.\.\/\.\.\/core\/api\.js\?v=/);
        expect(repo).not.toMatch(/fetch\(/);
    });
});
