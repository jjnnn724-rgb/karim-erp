import { describe, expect, it } from 'vitest';
import { employeeSchema } from './employees';
import { employeeByUserMap, roleCounts, roleLabel, searchUsers, type UserRow, userSchema, userToRow, userTotals } from './users';

const employees = [
    employeeSchema.parse({ id: 501, userId: '1', employeeId: 'EMP-001', name: 'مدير النظام' }),
    employeeSchema.parse({ id: 502, userId: 2, employeeId: 'EMP-002', name: 'منى حسن' }),
];
const byUser = employeeByUserMap(employees);

function row(raw: Record<string, unknown>): UserRow {
    return userToRow(userSchema.parse(raw), byUser);
}

describe('دليل المستخدمين — الصفّ والدور', () => {
    it('يربط الموظف بـ userId ويعرض الدور والحالة وآخر دخول', () => {
        const linked = row({
            id: 1,
            username: 'admin',
            name: 'مدير النظام',
            role: 'admin',
            dept_code: null,
            active: true,
            last_login_at: '2026-11-06T18:48:25.164Z',
        });
        expect(linked).toMatchObject({
            username: 'admin',
            name: 'مدير النظام',
            roleLabel: 'مدير النظام',
            roleKnown: true,
            deptCode: '',
            active: true,
            statusLabel: 'نشط',
            employeeName: 'مدير النظام',
            employeeCode: 'EMP-001',
            linked: true,
            lastLogin: '2026-11-06',
        });

        const orphan = row({
            id: 99,
            username: 'emp-009',
            name: null,
            role: null,
            dept_code: 'KITCHEN',
            active: '0',
            last_login_at: null,
        });
        expect(orphan.name).toBe('emp-009');
        expect(orphan.roleLabel).toBe('بلا دور');
        expect(orphan.active).toBe(false);
        expect(orphan.statusLabel).toBe('موقوف');
        expect(orphan.linked).toBe(false);
        expect(orphan.employeeName).toBe('');
        expect(orphan.lastLogin).toBe('');
    });

    it('دور مجهول يُعرض بمفتاحه المخزَّن لا بتسمية مخترعة', () => {
        expect(roleLabel('auditor')).toEqual({ label: 'مراجع', known: true });
        expect(roleLabel('superuser')).toEqual({ label: 'superuser', known: false });
        expect(roleLabel('')).toEqual({ label: 'بلا دور', known: true });
    });

    it('كلمة المرور والخزنة والبريد والهاتف والفرع لا تدخل الصفّ', () => {
        const parsed = row({
            id: 7,
            username: 'keeper',
            name: 'أمين المخازن',
            role: 'warehouse',
            password: 'hashed-secret',
            password_vault: 'vault-secret',
            email: 'keeper@example.com',
            phone: '0500000007',
            branch_id: 3,
            must_change_password: true,
        });
        expect(Object.keys(parsed).sort()).toEqual(
            [
                'active',
                'deptCode',
                'employeeCode',
                'employeeName',
                'id',
                'lastLogin',
                'linked',
                'name',
                'role',
                'roleKnown',
                'roleLabel',
                'statusLabel',
                'username',
            ].sort(),
        );
    });
});

describe('دليل المستخدمين — البحث والمجاميع', () => {
    it('اسم المستخدم مطابقة تامة، والاسم العربي بالتطبيع، وكل كلمة تلاقي موضعًا', () => {
        const rows = [
            row({ id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: true }),
            row({ id: 2, username: 'head_salads', name: 'أحـمَد صالح', role: 'dept_head', dept_code: 'salads' }),
            row({
                id: 3,
                username: 'keeper',
                name: 'أمين المخازن',
                role: 'warehouse',
                active: false,
                last_login_at: '2026-01-02T00:00:00Z',
            }),
        ];
        const exact = searchUsers(rows, 'admin');
        expect(exact.rows.map((item) => item.id)).toEqual(['1']);
        expect(exact.exact).toBe(1);

        const folded = searchUsers(rows, 'احمد');
        expect(folded.rows.map((item) => item.id)).toEqual(['2']);
        expect(folded.folded).toBe(true);

        expect(searchUsers(rows, 'أحمد salads').rows.map((item) => item.id)).toEqual(['2']);
        expect(searchUsers(rows, 'أحمد warehouse').rows).toEqual([]);
    });

    it('يعدّ الأدوار والحالات والروابط ويحصي رؤساء بلا قسم', () => {
        const rows = [
            row({ id: 1, username: 'a', name: 'أ', role: 'admin', active: true, last_login_at: '2026-01-01' }),
            row({ id: 2, username: 'b', name: 'ب', role: 'admin', active: true }),
            row({ id: 3, username: 'c', name: 'ج', role: 'dept_head', dept_code: '', active: false }),
        ];
        expect(roleCounts(rows)).toEqual([
            { value: 'admin', label: 'مدير النظام', known: true, count: 2 },
            { value: 'dept_head', label: 'رئيس قسم', known: true, count: 1 },
        ]);
        expect(userTotals(rows)).toEqual({
            total: 3,
            active: 2,
            inactive: 1,
            linked: 2,
            unlinked: 1,
            roles: 2,
            headWithoutDept: 1,
            neverLoggedIn: 2,
        });
    });
});
