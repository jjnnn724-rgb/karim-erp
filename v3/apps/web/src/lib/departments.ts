import { addMoney, fromCents, roundHalfUp, toCents } from '@karim/shared';
import type { Department, ExpenseRow, RevenueRow } from './finance';

/**
 * صفوف سجل الأقسام — تجميع محلي فوق صفوف الشهر المحمّلة، بلا أي كتابة.
 *
 * «إيراد القسم» هنا **صفوف القسم نفسه** (deptId = code) لا مجاميع الأبناء:
 * الجدول يعرض كل قسم في سطر، وجمع الأبناء داخل الأب يعدّ المال مرتين عند
 * قراءة العمود. مجاميع الأبناء تبقى في شاشة شجرة الأقسام القديمة.
 *
 * أقسام المرآة `ys_*` يولّدها تكامل يارا سوفت لحمل إيراد الكاشير، وليست
 * أقسامًا تشغيلية (departments.js:76-86) — تُطوى من العرض افتراضيًا،
 * وصفوفها تبقى في القاعدة كما هي.
 */

export interface DepartmentRow {
    code: string;
    name: string;
    parentCode: string;
    parentName: string;
    icon: string;
    color: string;
    revenue: string;
    expense: string;
    net: string;
    costRatio: number | null;
    rowCount: number;
}

const MIRROR_RE = /^ys_/i;

export function isMirrorDepartment(code: string): boolean {
    return MIRROR_RE.test(code);
}

function sumByDepartment(rows: readonly { deptId?: string | null | undefined; amount: string }[]): Map<string, string> {
    const totals = new Map<string, string>();
    for (const row of rows) {
        const code = String(row.deptId ?? '');
        if (!code) {
            continue;
        }
        totals.set(code, addMoney(totals.get(code) ?? '0.00', roundHalfUp(row.amount, 2)));
    }
    return totals;
}

function countByDepartment(rows: readonly { deptId?: string | null | undefined }[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const row of rows) {
        const code = String(row.deptId ?? '');
        if (code) {
            counts.set(code, (counts.get(code) ?? 0) + 1);
        }
    }
    return counts;
}

export function buildDepartmentRows(
    departments: readonly Department[],
    revenues: readonly RevenueRow[],
    expenses: readonly ExpenseRow[],
): DepartmentRow[] {
    const revenueByCode = sumByDepartment(revenues);
    const expenseByCode = sumByDepartment(expenses);
    const revenueCounts = countByDepartment(revenues);
    const expenseCounts = countByDepartment(expenses);
    const nameByCode = new Map(departments.map((dept) => [dept.code, dept.name]));

    return departments.map((dept) => {
        const revenue = revenueByCode.get(dept.code) ?? '0.00';
        const expense = expenseByCode.get(dept.code) ?? '0.00';
        const net = fromCents(toCents(revenue) - toCents(expense));
        const revenueCents = toCents(revenue);
        const parentCode = String(dept.parent_code ?? '');
        return {
            code: dept.code,
            name: dept.name,
            parentCode,
            parentName: parentCode ? (nameByCode.get(parentCode) ?? parentCode) : '',
            icon: String(dept.icon ?? ''),
            color: String(dept.color ?? ''),
            revenue,
            expense,
            net,
            costRatio: revenueCents > 0n ? (Number(expense) / Number(revenue)) * 100 : null,
            rowCount: (revenueCounts.get(dept.code) ?? 0) + (expenseCounts.get(dept.code) ?? 0),
        };
    });
}

/**
 * مجاميع الشاشة كما يحسبها القديم حرفيًا (`departments.js:889-890`):
 * مجموع **كل** صفوف الشهر، بما فيها صفوف أقسام المرآة وغير المسندة — وليس
 * مجموع صفوف الجدول. الجدول يطوي المرآة عرضًا، والمؤشرات لا تُخفي مالًا.
 */
export function monthTotals(
    revenues: readonly RevenueRow[],
    expenses: readonly ExpenseRow[],
): { revenue: string; expense: string; net: string } {
    const revenue = revenues.reduce((sum, row) => addMoney(sum, roundHalfUp(row.amount, 2)), '0.00');
    const expense = expenses.reduce((sum, row) => addMoney(sum, roundHalfUp(row.amount, 2)), '0.00');
    return { revenue, expense, net: fromCents(toCents(revenue) - toCents(expense)) };
}

export function compareDepartmentRows(a: DepartmentRow, b: DepartmentRow, key: DepartmentSortKey): number {
    if (key === 'code') {
        return a.code.localeCompare(b.code, 'ar', { numeric: true });
    }
    if (key === 'name') {
        return a.name.localeCompare(b.name, 'ar');
    }
    const left = toCents(key === 'net' ? a.net : key === 'expense' ? a.expense : a.revenue);
    const right = toCents(key === 'net' ? b.net : key === 'expense' ? b.expense : b.revenue);
    return left === right ? 0 : left > right ? 1 : -1;
}

export type DepartmentSortKey = 'code' | 'name' | 'revenue' | 'expense' | 'net';
