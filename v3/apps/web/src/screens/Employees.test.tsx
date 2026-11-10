import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../ui/Toast';
import { Employees } from './Employees';

/**
 * دليل الموظفين يقرأ `/api/employees` و`/api/hrDepartments`، يحلّ اسم
 * القسم بالكود، ويبحث بتطبيع الحروف العربية — ولا يعرض راتبًا ولا إقامة
 * ولا بصمة في أي خلية أو عنوان.
 */

const employees = [
    {
        id: 1,
        employeeId: 'EMP-001',
        name: 'أحمد علي',
        department: 'KITCHEN',
        position: 'شيف',
        phone: '0500000001',
        status: 'active',
        salary: '9000.00',
        iqamaNumber: '1234567890',
        deviceUserId: '77',
    },
    {
        id: 2,
        employeeId: 'EMP-002',
        name: 'منى حسن',
        department: 'SERVICE',
        position: '',
        phone: '',
        status: 'inactive',
    },
    {
        id: 3,
        employeeId: 'EMP-003',
        name: 'سامي فؤاد',
        department: 'GHOST',
        position: 'عامل',
        phone: '0500000003',
        status: 'suspended',
    },
];

const departments = [
    { id: 201, code: 'KITCHEN', name: 'المطبخ' },
    { id: 202, code: 'SERVICE', name: 'الصالة' },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(fail: 'employees' | null = null): string[] {
    const urls: string[] = [];
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const target = String(url);
            urls.push(target);
            if (target.includes('/api/employees')) {
                if (fail === 'employees') {
                    return json({ error: 'FAILED', message: 'تعذّر جلب الموظفين' }, 500);
                }
                return json({ data: employees, pagination: { totalPages: 1 } });
            }
            if (target.includes('/api/hrDepartments')) {
                return json({ data: departments, pagination: { totalPages: 1 } });
            }
            return json({ error: 'NOT_FOUND', message: 'مسار غير معروف' }, 404);
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Employees />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function bodyRows(): HTMLElement[] {
    return screen.getAllByRole('row').slice(1) as HTMLElement[];
}

afterEach(() => {
    vi.unstubAllGlobals();
    try {
        localStorage.removeItem('erp-employees-view');
    } catch {
        /* وضع خاص */
    }
});

function switchToTable() {
    fireEvent.click(screen.getByRole('button', { name: 'جدول' }));
}

describe('دليل الموظفين', () => {
    it('يعرض الدليل ويحلّ أسماء الأقسام ويعلن الكود غير المعروف', async () => {
        stubFetch();
        renderScreen();
        expect(await screen.findByText('أحمد علي')).toBeTruthy();
        expect(screen.getByText('منى حسن')).toBeTruthy();
        expect(screen.getAllByText('المطبخ').length).toBeGreaterThan(0);
        expect(screen.getAllByText('الصالة').length).toBeGreaterThan(0);
        expect(screen.getAllByText('GHOST').length).toBeGreaterThan(0);
        expect(screen.getAllByText('نشط').length).toBeGreaterThan(0);
        expect(screen.getAllByText('غير نشط').length).toBeGreaterThan(0);
        expect(screen.getAllByText('موقوف').length).toBeGreaterThan(0);
        expect(screen.getByText('3 موظفًا معروضًا من 3')).toBeTruthy();
    });

    it('لا يعرض الراتب ولا رقم الإقامة في أي خلية أو بطاقة — البصمة تظهر في البطاقة فقط', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('أحمد علي');
        expect(screen.queryByText('9000.00')).toBeNull();
        expect(screen.queryByText('1234567890')).toBeNull();
        // عرض البطاقات (افتراضي): شريحة البصمة تظهر كما في القديم، بلا راتب.
        expect(screen.getByText('بصمة 77')).toBeTruthy();
    });

    it('البطاقات افتراضية والمبدّل يتحول للجدول', async () => {
        stubFetch();
        renderScreen();
        // عرض البطاقات: مفتاح مبدّل موضحه غير مضغوط، والبطاقة ظاهرة.
        expect(await screen.findByText('بصمة 77')).toBeTruthy();
        expect(screen.getByRole('list', { name: 'بطاقات الموظفين' })).toBeTruthy();
        // التحول للجدول.
        switchToTable();
        await waitFor(() => {
            expect(screen.getByRole('columnheader', { name: 'الكود' })).toBeTruthy();
        });
        expect(screen.queryByRole('list', { name: 'بطاقات الموظفين' })).toBeNull();
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع ويمسح المرشّحات', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('أحمد علي');
        switchToTable();

        const search = screen.getByLabelText('بحث');
        fireEvent.change(search, { target: { value: 'احمد' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(3);
        });
    });

    it('يرشّح بالقسم والحالة، وبلا نتائج يعرض حالة فارغة', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('أحمد علي');
        switchToTable();

        fireEvent.change(screen.getByLabelText('القسم'), { target: { value: 'KITCHEN' } });
        await waitFor(() => {
            expect(bodyRows()).toHaveLength(1);
        });

        fireEvent.change(screen.getByLabelText('الحالة'), { target: { value: 'inactive' } });
        await waitFor(() => {
            expect(screen.getByText('لا موظفين يطابقون المرشّحات')).toBeTruthy();
            expect(screen.queryByText('أحمد علي')).toBeNull();
        });
    });

    it('يرتّب بالكود تصاعديًا ثم تنازليًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findByText('أحمد علي');
        switchToTable();

        fireEvent.click(screen.getByRole('button', { name: 'الكود' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('EMP-001');
        });
        fireEvent.click(screen.getByRole('button', { name: 'الكود' }));
        await waitFor(() => {
            expect(bodyRows()[0]?.textContent).toContain('EMP-003');
        });
    });

    it('يطلب الصفحات بحدّ 1000 وترتيب id تصاعدي من الخادم', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findByText('أحمد علي');
        const employeeCall = urls.find((url) => url.includes('/api/employees'));
        const departmentCall = urls.find((url) => url.includes('/api/hrDepartments'));
        expect(employeeCall).toContain('page=1');
        expect(employeeCall).toContain('limit=1000');
        expect(employeeCall).toContain('sort=id');
        expect(employeeCall).toContain('order=asc');
        expect(departmentCall).toContain('limit=1000');
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch('employees');
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});
