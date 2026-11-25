import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createHrDepartment,
    deleteHrDepartment,
    fetchHrDepartments,
    fetchHrEmployees,
    hrDepartmentWriteEnabled,
    safeHrCode,
    updateHrDepartment,
    validateHrDepartmentForm,
    withEmployeeCounts,
} from './hr-departments';

afterEach(() => {
    vi.unstubAllGlobals();
});

function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('دليل أقسام الموارد البشرية — عقد البيانات والكتابة', () => {
    it('يمشي صفحات الدليل والموظفين على أبواب PostgreSQL القديمة', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
            String(input).includes('/api/hrDepartments')
                ? jsonResponse([{ id: 2, code: 'HRD-2', name: 'الموارد', manager: 'مدير' }])
                : jsonResponse([
                      { id: 8, department: 'HRD-2' },
                      { id: 9, department: 'HRD-2' },
                  ]),
        );
        vi.stubGlobal('fetch', fetchMock);
        const departments = await fetchHrDepartments();
        const employees = await fetchHrEmployees();
        expect(departments).toEqual([{ id: '2', code: 'HRD-2', name: 'الموارد', manager: 'مدير' }]);
        expect(withEmployeeCounts(departments, employees)).toMatchObject([{ employeeCount: 2 }]);
        expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
            '/api/hrDepartments?page=1&limit=1000&sort=id&order=desc',
            '/api/employees?page=1&limit=1000&sort=id&order=desc',
        ]);
    });

    it('يقفل الكتابة افتراضيًا، ويطابق أدوارها وعلم V2', () => {
        expect(hrDepartmentWriteEnabled('', null)).toBe(false);
        expect(hrDepartmentWriteEnabled('', '1')).toBe(true);
        expect(hrDepartmentWriteEnabled('?v2hrdeptwrite=0', '1')).toBe(false);
        expect(hrDepartmentWriteEnabled('?v2hrdeptwrite=1', null)).toBe(true);
        expect(['admin', 'manager', 'hr']).toEqual(['admin', 'manager', 'hr']);
    });

    it('ينشئ رمزًا لاتينيًا آمنًا ويحد الاسم ويمنع الاسم الفارغ', () => {
        expect(safeHrCode('food-1', 123456)).toBe('FOOD-1');
        expect(safeHrCode('قسم الموارد', 123456)).toBe(`HRD-${(123456).toString(36).toUpperCase().slice(-6)}`);
        expect(validateHrDepartmentForm({ name: '', code: '', manager: '' }, false).ok).toBe(false);
        expect(validateHrDepartmentForm({ name: 'قسم', code: '', manager: '' }, false, 123456)).toMatchObject({
            ok: true,
            payload: { code: safeHrCode('', 123456), manager: null },
        });
        expect(validateHrDepartmentForm({ name: 'x'.repeat(151), code: '', manager: '' }, false).ok).toBe(false);
        expect(validateHrDepartmentForm({ name: 'تعديل', code: 'LOCKED', manager: '' }, true)).toMatchObject({
            ok: true,
            payload: { manager: null },
        });
    });

    it('يحافظ على الحمولات المسموح بها في الإضافة والتعديل والحذف', async () => {
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({ ok: true }));
        vi.stubGlobal('fetch', fetchMock);
        const payload = { name: 'الحسابات', code: 'ACCT', manager: null };
        await createHrDepartment(payload);
        await updateHrDepartment('3/4', { name: 'مالية', manager: 'مدير' });
        await deleteHrDepartment('3/4');
        expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
            ['/api/hrDepartments', 'POST', JSON.stringify(payload)],
            ['/api/hrDepartments/3%2F4', 'PUT', JSON.stringify({ name: 'مالية', manager: 'مدير' })],
            ['/api/hrDepartments/3%2F4', 'DELETE', undefined],
        ]);
    });
});
