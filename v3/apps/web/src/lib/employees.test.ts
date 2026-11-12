import { describe, expect, it } from 'vitest';
import {
    arSearchKey,
    departmentCodeMap,
    deptCounts,
    employeeSchema,
    employeeStatus,
    employeeToRow,
    employeeTotals,
    hrDepartmentSchema,
    searchEmployees,
    statusCounts,
} from './employees';

const departments = departmentCodeMap([
    hrDepartmentSchema.parse({ id: '201', code: 'KITCHEN', name: 'المطبخ' }),
    hrDepartmentSchema.parse({ id: '202', code: 'SERVICE', name: 'الصالة' }),
]);

function row(raw: Record<string, unknown>) {
    return employeeToRow(employeeSchema.parse(raw), departments);
}

describe('دليل الموظفين — الصفّ والحالة', () => {
    it('يحلّ القسم بالكود ويعرض الكود الخام عند غياب الصلة', () => {
        const resolved = row({
            id: 1,
            employeeId: 'EMP-001',
            name: 'أحمد علي',
            department: 'KITCHEN',
            position: 'شيف',
            phone: '0500000001',
            status: 'active',
        });
        expect(resolved).toMatchObject({
            code: 'EMP-001',
            name: 'أحمد علي',
            dept: 'المطبخ',
            deptCode: 'KITCHEN',
            deptResolved: true,
            position: 'شيف',
            phone: '0500000001',
            statusLabel: 'نشط',
            statusKnown: true,
        });

        const orphan = row({ id: 2, employeeId: null, name: null, department: 'NOPE', status: null });
        expect(orphan.code).toBe('—');
        expect(orphan.name).toBe('#2');
        expect(orphan.dept).toBe('NOPE');
        expect(orphan.deptResolved).toBe(false);
        expect(orphan.position).toBe('—');
        expect(orphan.phone).toBe('—');
        expect(orphan.statusLabel).toBe('غير محدد');
        expect(orphan.statusKnown).toBe(true);
    });

    it('حالة مجهولة تُعرض بمفتاحها المخزَّن لا بتسمية مخترعة', () => {
        expect(employeeStatus('retired')).toEqual({ label: 'retired', known: false });
        expect(employeeStatus('suspended')).toEqual({ label: 'موقوف', known: true });
    });

    it('الراتب والإقامة والبصمة لا تدخل الصفّ', () => {
        const parsed = employeeToRow(
            employeeSchema.parse({
                id: 9,
                employeeId: 'EMP-009',
                name: 'سامي',
                salary: '9000.00',
                iqamaNumber: '1234567890',
                deviceUserId: '77',
            }),
            departments,
        );
        expect(Object.keys(parsed).sort()).toEqual(
            ['code', 'dept', 'deptCode', 'deptResolved', 'id', 'name', 'phone', 'position', 'status', 'statusKnown', 'statusLabel'].sort(),
        );
    });
});

describe('دليل الموظفين — البحث والمجاميع', () => {
    it('يطبّع الحروف العربية ويعلن أن النتيجة جاءت بالتطبيع', () => {
        expect(arSearchKey('أحـمَد')).toBe('احمد');
        const rows = [
            row({ id: 1, employeeId: 'EMP-001', name: 'أحمد علي', department: 'KITCHEN', status: 'active' }),
            row({ id: 2, employeeId: 'EMP-002', name: 'منى حسن', department: 'SERVICE', status: 'inactive' }),
        ];
        const hit = searchEmployees(rows, 'احمد');
        expect(hit.rows.map((item) => item.code)).toEqual(['EMP-001']);
        expect(hit.folded).toBe(true);
    });

    it('«007» و«7» كودٌ واحد، وكل كلمة يجب أن تلاقي موضعًا', () => {
        const rows = [
            row({ id: 1, employeeId: '7', name: 'أحمد علي', department: 'KITCHEN', position: 'شيف', status: 'active' }),
            row({
                id: 2,
                employeeId: 'EMP-002',
                name: 'منى حسن',
                department: 'SERVICE',
                position: 'ويتر',
                status: 'inactive',
            }),
        ];
        expect(searchEmployees(rows, '007').rows.map((item) => item.id)).toEqual(['1']);
        expect(searchEmployees(rows, 'أحمد ويتر').rows).toEqual([]);
        expect(searchEmployees(rows, 'منى ويتر').rows.map((item) => item.id)).toEqual(['2']);
    });

    it('يعدّ الحالات والأقسام بمفتاح الكود ويحصي بلا هاتف', () => {
        const rows = [
            row({ id: 1, employeeId: 'A', name: 'أ', department: 'KITCHEN', phone: '0500', status: 'active' }),
            row({ id: 2, employeeId: 'B', name: 'ب', department: 'KITCHEN', phone: '', status: 'active' }),
            row({ id: 3, employeeId: 'C', name: 'ج', department: 'SERVICE', phone: '', status: 'inactive' }),
            row({ id: 4, employeeId: 'D', name: 'د', department: 'GHOST', phone: '0500', status: '' }),
        ];
        expect(statusCounts(rows)).toEqual([
            { value: 'active', count: 2 },
            { value: '', count: 1 },
            { value: 'inactive', count: 1 },
        ]);
        const depts = deptCounts(rows);
        expect(depts.map((entry) => [entry.code, entry.count, entry.resolved])).toEqual([
            ['KITCHEN', 2, true],
            ['SERVICE', 1, true],
            ['GHOST', 1, false],
        ]);
        expect(employeeTotals(rows)).toEqual({
            total: 4,
            departments: 3,
            departmentsResolved: 2,
            noPhone: 2,
        });
    });
});
