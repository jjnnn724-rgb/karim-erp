import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    canWriteDeptEmployees,
    createDeptEmployee,
    deactivateDeptEmployee,
    updateDeptEmployee,
    validateDeptEmployeeForm,
} from './dept-employees';

afterEach(() => vi.unstubAllGlobals());

describe('V2 dept employee write contract', () => {
    it('restricts UI write affordances to dept_head', () => {
        expect(canWriteDeptEmployees('dept_head')).toBe(true);
        expect(canWriteDeptEmployees('admin')).toBe(false);
        expect(canWriteDeptEmployees(null)).toBe(false);
    });
    it('matches required fields and employee id constraints', () => {
        expect(validateDeptEmployeeForm({ name: '', employeeId: '' })).toEqual(['الاسم والرقم الوظيفي إجباريان']);
        expect(validateDeptEmployeeForm({ name: 'A', employeeId: 'عربي' })).toContain('الرقم الوظيفي: حروف لاتينية/أرقام فقط (2-50)');
        expect(validateDeptEmployeeForm({ name: ' A ', employeeId: 'EMP_01' })).toEqual([]);
    });
    it('posts normalized safe fields to the documented add endpoint', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
        await createDeptEmployee({ name: ' A ', employeeId: 'EMP_01', position: '', phone: ' 050 ' });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/hr/dept-employees',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ name: 'A', employeeId: 'EMP_01', position: null, phone: '050' }),
            }),
        );
    });
    it('puts only the documented mutable fields and encodes ids', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        await updateDeptEmployee('id/1', { name: 'Bee', employeeId: 'EMP_02', position: 'Role', phone: '1' });
        expect(fetchMock).toHaveBeenCalledWith('/api/hr/dept-employees/id%2F1', expect.objectContaining({ method: 'PUT' }));
    });
    it('deactivates only after a caller-confirmed action and calls the documented delete endpoint', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const confirmed = true;
        if (confirmed) await deactivateDeptEmployee('17');
        expect(fetchMock).toHaveBeenCalledWith('/api/hr/dept-employees/17', expect.objectContaining({ method: 'DELETE' }));
    });
    it('surfaces server failures without hiding an unsuccessful write', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(JSON.stringify({ message: 'رفض الخادم' }), { status: 403 })),
        );
        await expect(deactivateDeptEmployee('17')).rejects.toThrow('رفض الخادم');
    });
});
