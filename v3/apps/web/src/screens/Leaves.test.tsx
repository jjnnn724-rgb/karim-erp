import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    flattenEvents,
    leaveDays,
    leaveToRow,
    leaveWorkflowRowSchema,
    searchLeaveRequests,
    summarizeLeaves,
    topRequesters,
} from '../lib/leaves';
import { ToastProvider } from '../ui/Toast';
import { Leaves } from './Leaves';

/**
 * شاشة الإجازات تقرأ `/api/hr/leave-workflow` و`/api/leaveTypes` — المدة
 * محسوبةٌ شاملةً يوم البداية، والحالة المخزَّنة تُعرض كما أرسلها الخادم،
 * والمجلّات تُحسب على السجل المُرسل وحده.
 */

const workflow = [
    leaveWorkflowRowSchema.parse({
        id: 101,
        employeeId: 7,
        leaveTypeId: 1,
        startDate: '2026-11-01',
        endDate: '2026-11-03',
        status: 'approved',
        reason: 'إجازة سنوية',
        requestDate: '2026-11-01',
        approvedDate: '2026-11-05',
        workflow_id: 900,
        current_stage: 'hr',
        workflow_status: 'completed',
        current_note: 'تمت الموافقة على المرحلة',
        employee_name: 'أحمد علي',
        leave_type_name: 'سنوية',
        events: [
            {
                id: 1,
                workflow_id: 900,
                stage: 'employee',
                action: 'submitted',
                note: 'أُرسل الطلب',
                actor_role: 'employee',
                created_at: '2026-11-01T08:00:00',
            },
        ],
    }),
    leaveWorkflowRowSchema.parse({
        id: 102,
        employeeId: 8,
        leaveTypeId: 2,
        startDate: '2026-11-10',
        endDate: '2026-11-05',
        status: 'pending',
        requestDate: '2026-11-02',
        workflow_id: 901,
        current_stage: 'direct_manager',
        workflow_status: 'in_progress',
        employee_name: 'سارة حسن',
        leave_type_name: 'سنوية',
        events: [],
    }),
    leaveWorkflowRowSchema.parse({
        id: 103,
        employeeId: 9,
        leaveTypeId: 1,
        startDate: '2026-11-12',
        endDate: '2026-11-12',
        status: 'pending',
        requestDate: '2026-11-03',
        workflow_id: 902,
        current_stage: 'weird_stage',
        workflow_status: 'weird_status',
        employee_name: 'محمد',
        events: [],
    }),
];

const types = [
    { id: 1, name: 'سنوية', days: 21, icon: 'calendar', paid: true },
    { id: 2, name: 'مرضية', days: null, icon: '', paid: false },
];

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function stubFetch(options: { rows?: unknown[]; typeRows?: unknown[]; failWorkflow?: boolean } = {}): string[] {
    const urls: string[] = [];
    const rows = options.rows ?? workflow;
    const typeRows = options.typeRows ?? types;
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
            const href = String(url);
            urls.push(href);
            if (href.includes('/api/hr/leave-workflow')) {
                if (options.failWorkflow) {
                    return json({ error: 'LEAVE_WORKFLOW_LIST_FAILED', message: 'تعذر جلب طلبات الإجازة' }, 500);
                }
                return json(rows);
            }
            return json({
                data: typeRows,
                pagination: { page: 1, limit: 1000, total: typeRows.length, totalPages: 1 },
            });
        }),
    );
    return urls;
}

function renderScreen() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <ToastProvider>
                <Leaves />
            </ToastProvider>
        </QueryClientProvider>,
    );
}

function requestRows(): HTMLElement[] {
    const region = screen.getByRole('region', { name: 'سجل طلبات الإجازة' });
    return within(region).getAllByRole('row').slice(1) as HTMLElement[];
}

/** نصّ بطاقة المؤشر بالبطاقة كاملة (رقمها وتلميحها). */
function kpiCard(english: string): string {
    const band = within(screen.getByRole('list', { name: /مؤشرات الإجازات/ })).getByText(english);
    return band.closest('li')?.textContent ?? '';
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('الإجازات', () => {
    it('يعرض مؤشرات السلسلة على السجل المُرسل والمدة الشاملة', async () => {
        stubFetch();
        renderScreen();
        expect((await screen.findAllByText('أحمد علي')).length).toBeGreaterThan(0);

        expect(kpiCard('In Chain')).toContain('1');
        expect(kpiCard('Approved')).toContain('1');
        expect(kpiCard('Rejected')).toContain('0');
        expect(kpiCard('Approved Days')).toContain('3');
        expect(kpiCard('Leave Types')).toContain('2');

        const rows = requestRows();
        expect(rows).toHaveLength(3);
        // 2026-11-01 → 2026-11-03 شاملةً = 3 أيام.
        expect(rows[0]?.textContent).toContain('3');
        // النطاق المعكوس لا مدة له ⇒ «—» ولا رقم مخترع.
        expect(rows[1]?.textContent).toContain('—');
    });

    it('يطلب البابَين الصحيحين بنفس معاملات القديم', async () => {
        const urls = stubFetch();
        renderScreen();
        await screen.findAllByText('أحمد علي');
        expect(urls.some((url) => url.includes('/api/hr/leave-workflow'))).toBe(true);
        expect(urls.some((url) => url.includes('/api/leaveTypes?page=1&limit=1000&sort=id&order=asc'))).toBe(true);
    });

    it('يرشّح بالحالة ويعلن العدد', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('أحمد علي');

        fireEvent.click(screen.getByRole('button', { name: /^قيد الاعتماد/ }));
        await waitFor(() => {
            expect(requestRows()).toHaveLength(1);
        });
        expect(requestRows()[0]?.textContent).toContain('سارة حسن');

        fireEvent.click(screen.getByRole('button', { name: 'مسح المرشّحات' }));
        await waitFor(() => {
            expect(requestRows()).toHaveLength(3);
        });
    });

    it('يبحث بتطبيع الحروف العربية ويعلن التطبيع', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('أحمد علي');

        fireEvent.change(screen.getByLabelText('بحث'), { target: { value: 'احمد' } });
        await waitFor(() => {
            expect(requestRows()).toHaveLength(1);
        });
        expect(requestRows()[0]?.textContent).toContain('أحمد علي');
        expect(screen.getByText('بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.')).toBeTruthy();
    });

    it('يعرض الحالة والمرحلة المخزَّنتين غير المعروفتين خامًا', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('محمد');

        const row = requestRows()[2];
        expect(row?.textContent).toContain('weird_status');
        expect(row?.textContent).toContain('weird_stage');
    });

    it('يعرض سجل الاعتماد وأنواع الإجازات', async () => {
        stubFetch();
        renderScreen();
        await screen.findAllByText('أحمد علي');

        const events = within(screen.getByRole('region', { name: 'سجل أحداث الاعتماد' })).getAllByRole('row');
        expect(events.length).toBeGreaterThan(1);
        expect(events[1]?.textContent).toContain('تم تقديم الطلب');

        const typeTable = within(screen.getByRole('region', { name: 'سجل أنواع الإجازات' })).getAllByRole('row');
        expect(typeTable[1]?.textContent).toContain('سنوية');
        expect(typeTable[1]?.textContent).toContain('نعم');
    });

    it('سجل فارغ ⇒ حالة فارغة لا جدول كاذب', async () => {
        stubFetch({ rows: [] });
        renderScreen();
        expect(await screen.findByText('لا طلبات في هذا النطاق')).toBeTruthy();
    });

    it('يعرض خطأ الجلب مع إعادة المحاولة', async () => {
        stubFetch({ failWorkflow: true });
        renderScreen();
        await waitFor(() => {
            expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
        });
        expect(screen.getByText('تعذّر جلب البيانات')).toBeTruthy();
        expect(screen.getByText('تعذر جلب طلبات الإجازة')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'إعادة المحاولة' })).toBeTruthy();
    });
});

describe('حساب الإجازات', () => {
    it('المدة شاملةً يوم البداية، والنطاق المعكوس بلا مدة', () => {
        expect(leaveDays('2026-11-01', '2026-11-03')).toBe(3);
        expect(leaveDays('2026-11-01', '2026-11-01')).toBe(1);
        expect(leaveDays('2026-11-10', '2026-11-05')).toBeNull();
        expect(leaveDays('', '2026-11-05')).toBeNull();
    });

    it('مجموع الأيام المعتمدة يعدّ الإقرارات المغلقة وحدها', () => {
        const rows = workflow.map((raw) => leaveToRow(raw));
        const summary = summarizeLeaves(rows);
        expect(summary.total).toBe(3);
        expect(summary.inProgress).toBe(1);
        expect(summary.completed).toBe(1);
        expect(summary.rejected).toBe(0);
        expect(summary.returned).toBe(0);
        expect(summary.daysApprovedOf).toBe(1);
        expect(summary.daysApproved).toBe(3);
        expect(summary.employees).toBe(3);
    });

    it('ترتيب «أكثر الموظفين طلبًا» محسوبٌ هنا، وأحداث السلسلة الأحدث أولًا', () => {
        const rows = workflow.map((raw) => leaveToRow(raw));
        const top = topRequesters(rows, 6);
        expect(top).toHaveLength(3);
        expect(top[0]?.count).toBe(1);

        const events = flattenEvents(rows);
        expect(events).toHaveLength(1);
        expect(events[0]?.actionAr).toBe('تم تقديم الطلب');
        expect(events[0]?.at).toBe('2026-11-01 08:00');
    });

    it('البحث يطابق خامًا أولًا ثم بالمُطبَّع', () => {
        const rows = workflow.map((raw) => leaveToRow(raw));
        expect(searchLeaveRequests(rows, 'سنوية').hits).toBe(2);
        const folded = searchLeaveRequests(rows, 'احمد');
        expect(folded.hits).toBe(1);
        expect(folded.folded).toBe(true);
    });
});
