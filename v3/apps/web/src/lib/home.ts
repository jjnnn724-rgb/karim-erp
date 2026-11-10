import { ApiError, fetchJson } from './api';
import { getAccessToken } from './auth';
import {
    briefingResponseSchema,
    parseNumericVal,
    posStatsResponseSchema,
    type BriefingResponse,
    type PosStatsResponse,
} from './briefing';
import { fetchAccountantSnapshot, fetchWarehouseSnapshot, type AccountantView, type WarehouseView } from './dashboards';
import { alertTone, buildExecutiveKpis, fetchExecutiveSummary, severityLabel, type ExecutiveSummary } from './executive';
import { formatCurrency, formatInt } from './format';
import { titleForPath } from './navigation';
import { buildPnlLines, type PnlResponse } from './pnl';
import { errorMessage, moneyOf, num, pctOf, textOf, type DisplayTone } from './reporting';

/**
 * بيانات الصفحة الرئيسية — **قراءة من العقود القائمة فقط** (خطة §3.2):
 * الموجز التنفيذي (`/api/executive/summary`)، موجز المدير
 * (`/api/manager/briefing` + `/api/pos/orders/stats/today`)، وقائمة الدخل
 * مع سجلَّي الإيراد/المصروف (`/api/finance/pnl` + `/api/revenues` +
 * `/api/expenses`). ولا باب جديد ولا حساب مالي في المتصفح.
 *
 * كل مصدرٍ يُجلب مستقلًا (`Promise.allSettled`) فلا يُسقط فشلٌ واحد الصفحة:
 * تُعرض المتاحة، ويُسمّى المفقود في `failures`. ودورٌ بلا صلاحية مصدرٍ
 * (admin-only مثلًا) يسقط إلى المصدر التالي، وأسوأ الأحوال: مؤشرات المخزون
 * من `/api/inventory` + الأذونات + طلبات الشراء — قراءات متاحة لكل الأدوار.
 */

/* ─── الأنواع ──────────────────────────────────────────────────────────── */

export type HomeTrendDirection = 'up' | 'down' | 'flat';

export interface HomeTrend {
    readonly direction: HomeTrendDirection;
    readonly label: string;
}

export interface HomeKpi {
    readonly id: string;
    readonly label: string;
    readonly english: string;
    readonly value: string;
    readonly hint: string;
    readonly tone: DisplayTone;
    readonly trend: HomeTrend | null;
}

export interface HomeChartPoint {
    readonly label: string;
    /** السلسلة الأولى (الإيراد). */
    readonly primary: number;
    /** السلسلة الثانية (التكلفة/المصروف) — صفر في رسوم الاتجاه الأحادي. */
    readonly secondary: number;
}

export interface HomeSeries {
    readonly title: string;
    readonly english: string;
    readonly points: readonly HomeChartPoint[];
}

export interface HomeDeptPoint {
    readonly name: string;
    readonly value: number;
}

export interface HomeActivityRow {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly amount: string;
    readonly date: string;
    readonly kind: 'revenue' | 'expense';
}

export interface HomeAlertRow {
    readonly id: string;
    readonly title: string;
    readonly detail: string;
    readonly severity: string;
    readonly tone: DisplayTone;
}

export interface HomeSnapshot {
    readonly kpis: readonly HomeKpi[];
    readonly revenueSeries: HomeSeries;
    readonly netSeries: HomeSeries;
    readonly depts: readonly HomeDeptPoint[];
    readonly deptsTitle: string;
    readonly activity: readonly HomeActivityRow[];
    readonly alerts: readonly HomeAlertRow[];
    readonly failures: readonly string[];
    /** اسم المصدر الأساسي المعروض — الصدق في الواجهة. */
    readonly basis: string;
}

/* ─── المصادر ──────────────────────────────────────────────────────────── */

async function fetchManagerBriefing(signal?: AbortSignal): Promise<BriefingResponse> {
    return fetchJson(briefingResponseSchema, '/api/manager/briefing', getAccessToken(), signal ? { signal } : {});
}

async function fetchPosTodayStats(signal?: AbortSignal): Promise<PosStatsResponse> {
    return fetchJson(posStatsResponseSchema, '/api/pos/orders/stats/today', getAccessToken(), signal ? { signal } : {});
}

function firstValue(...values: readonly unknown[]): unknown {
    for (const value of values) {
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }
    return 0;
}

/** خطأ صلاحية متوقّع (دور بلا حقّ المصدر) — ليس عطلًا يُعرض للمستخدم. */
function isExpectedDenial(reason: unknown): boolean {
    return reason instanceof ApiError && reason.isAuthProblem;
}

function trendOfSeries(values: readonly number[]): HomeTrend | null {
    if (values.length < 2) {
        return null;
    }
    const current = values[values.length - 1] ?? 0;
    const previous = values[values.length - 2] ?? 0;
    if (current > previous) {
        return { direction: 'up', label: 'أعلى من السابقة' };
    }
    if (current < previous) {
        return { direction: 'down', label: 'أدنى من السابقة' };
    }
    return { direction: 'flat', label: 'مستقر' };
}

function shortDay(value: unknown): string {
    const text = textOf(value);
    return text.length >= 10 ? text.slice(5, 10) : text;
}

/* ─── المؤشرات ─────────────────────────────────────────────────────────── */

function kpisFromExecutive(payload: ExecutiveSummary): HomeKpi[] {
    const rows = payload.series ?? [];
    const trends: Readonly<Record<string, HomeTrend | null>> = {
        revenue: trendOfSeries(rows.map((row) => num(row.revenue))),
        net: trendOfSeries(rows.map((row) => num(row.net))),
        margin: trendOfSeries(rows.map((row) => num(row.net))),
    };
    return buildExecutiveKpis(payload).map((kpi) => ({
        id: kpi.id,
        label: kpi.label,
        english: kpi.english,
        value: kpi.value,
        hint: kpi.hint,
        tone: kpi.tone,
        trend: trends[kpi.id] ?? null,
    }));
}

function kpisFromBriefing(
    briefing: BriefingResponse | null,
    posStats: PosStatsResponse | null,
): HomeKpi[] {
    if (!briefing && !posStats) {
        return [];
    }
    const totalSales = parseNumericVal(
        firstValue(briefing?.pos.total, briefing?.cashiersTotal.total, posStats?.total_sales),
    );
    const totalExpenses = parseNumericVal(firstValue(briefing?.expenses.total));
    const ordersCount =
        (posStats?.orders_count ?? 0) ||
        parseNumericVal(firstValue(briefing?.pos.count, briefing?.cashiersTotal.count));
    const averageTicket = parseNumericVal(firstValue(posStats?.avg_ticket));
    return [
        {
            id: 'sales',
            label: 'مبيعات اليوم',
            english: "Today's sales",
            value: formatCurrency(totalSales),
            hint: 'من موجز المدير وإحصاءات نقطة البيع',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'today-expenses',
            label: 'مصروفات اليوم',
            english: "Today's expenses",
            value: formatCurrency(totalExpenses),
            hint: 'من موجز المدير',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'orders',
            label: 'عدد الفواتير',
            english: 'Orders',
            value: formatInt(ordersCount),
            hint: 'فواتير وطلبات الكاشير',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'avg-ticket',
            label: 'متوسط الفاتورة',
            english: 'Average ticket',
            value: formatCurrency(averageTicket),
            hint: 'متوسط قيمة الفاتورة الواحدة',
            tone: 'neutral',
            trend: null,
        },
    ];
}

function kpisFromPnl(pnl: PnlResponse | null): HomeKpi[] {
    const statement = pnl?.statement;
    if (!statement) {
        return [];
    }
    const lines = buildPnlLines(statement);
    const byId = new Map(lines.map((line) => [line.id, line]));
    const result: HomeKpi[] = [];
    for (const [id, label, english] of [
        ['revenue', 'الإيراد', 'Revenue'],
        ['cogs', 'تكلفة البضاعة', 'COGS'],
        ['net', 'صافي الربح', 'Net profit'],
    ] as const) {
        const line = byId.get(id);
        if (line) {
            result.push({
                id: `pnl-${id}`,
                label,
                english,
                value: formatCurrency(line.value),
                hint: `${line.hint} — قائمة الدخل`,
                tone: line.tone,
                trend: null,
            });
        }
    }
    result.push({
        id: 'pnl-margin',
        label: 'الهامش',
        english: 'Margin',
        value: pctOf(statement.net_profit?.margin_pct),
        hint: 'نسبة صافي الربح من الإيراد — قائمة الدخل',
        tone: 'neutral',
        trend: null,
    });
    return result;
}

function kpisFromWarehouse(warehouse: WarehouseView): HomeKpi[] {
    return [
        {
            id: 'stock-total',
            label: 'أصناف المخزون',
            english: 'Stock items',
            value: formatInt(warehouse.total),
            hint: 'من قائمة المخزون',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'stock-low',
            label: 'أصناف تحت الحد',
            english: 'Low stock',
            value: formatInt(warehouse.low),
            hint: 'رصيدها ≥ 0 وتحت حد إعادة الطلب',
            tone: warehouse.low > 0 ? 'warning' : 'success',
            trend: null,
        },
        {
            id: 'stock-out',
            label: 'أصناف نافدة',
            english: 'Out of stock',
            value: formatInt(warehouse.out),
            hint: 'رصيدها صفر أو أقل',
            tone: warehouse.out > 0 ? 'danger' : 'success',
            trend: null,
        },
        {
            id: 'dispatch-queue',
            label: 'أذون صرف الشهر',
            english: 'Dispatches',
            value: formatInt(warehouse.queues.dispatches),
            hint: 'أذون الصرف في الفترة الحالية',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'purchase-queue',
            label: 'طلبات الشراء',
            english: 'Purchase requests',
            value: formatInt(warehouse.queues.purchases),
            hint: 'طلبات النواقص المسجلة',
            tone: 'neutral',
            trend: null,
        },
        {
            id: 'approval-queue',
            label: 'بانتظار الاعتماد',
            english: 'Pending approvals',
            value: formatInt(warehouse.queues.chef + warehouse.queues.warehouse + warehouse.queues.purchase),
            hint: 'أذون وطلبات لم تُعتمد بعد',
            tone: 'warning',
            trend: null,
        },
    ];
}

/* ─── الرسوم والنشاط والإنذارات ────────────────────────────────────────── */

function chartsFromExecutive(payload: ExecutiveSummary): {
    revenueSeries: HomeSeries;
    netSeries: HomeSeries;
    depts: HomeDeptPoint[];
    deptsTitle: string;
} {
    const rows = payload.series ?? [];
    return {
        revenueSeries: {
            title: 'الإيراد مقابل التكلفة',
            english: 'Revenue vs cost',
            points: rows.map((row) => ({
                label: shortDay(row.day),
                primary: num(row.revenue),
                secondary: num(row.cost),
            })),
        },
        netSeries: {
            title: 'اتجاه الصافي',
            english: 'Net trend',
            points: rows.map((row) => ({ label: shortDay(row.day), primary: num(row.net), secondary: 0 })),
        },
        depts: (payload.topDepts ?? []).map((row) => ({ name: textOf(row.name) || '—', value: num(row.total) })),
        deptsTitle: 'الإيراد حسب القسم',
    };
}

function chartsFromPnl(pnl: PnlResponse | null): {
    revenueSeries: HomeSeries;
    netSeries: HomeSeries;
    depts: HomeDeptPoint[];
    deptsTitle: string;
} {
    const rows = pnl?.statement?.daily_series ?? [];
    return {
        revenueSeries: {
            title: 'الإيراد مقابل التكلفة',
            english: 'Revenue vs cost',
            points: rows.map((row) => ({
                label: shortDay(row.date),
                primary: num(row.revenue),
                secondary: num(row.cogs),
            })),
        },
        netSeries: {
            title: 'اتجاه المصروف التشغيلي',
            english: 'Operating trend',
            points: rows.map((row) => ({ label: shortDay(row.date), primary: num(row.opex), secondary: 0 })),
        },
        depts:
            (pnl?.statement?.by_department ?? [])
                .filter((row) => num(row.revenue) !== 0)
                .map((row) => ({ name: textOf(row.name) || textOf(row.code) || '—', value: num(row.revenue) }))
                .slice(0, 8),
        deptsTitle: 'الإيراد حسب القسم',
    };
}

function chartsFromBriefing(briefing: BriefingResponse | null): {
    depts: HomeDeptPoint[];
} {
    const rows = briefing?.cashiers ?? [];
    return {
        depts: rows
            .map((row) => ({ name: textOf(row.department_name) || 'قسم', value: parseNumericVal(row.total) }))
            .filter((row) => row.value !== 0)
            .slice(0, 8),
    };
}

function activityFromAccountant(accountant: AccountantView): HomeActivityRow[] {
    const revenues: HomeActivityRow[] = accountant.latestRevenues.map((row) => ({
        id: `revenue-${textOf(row.id)}`,
        title: 'إيراد',
        detail: textOf(row.desc) || textOf(row.source) || 'قيد إيراد',
        amount: moneyOf(row.amount),
        date: textOf(row.date),
        kind: 'revenue',
    }));
    const expenses: HomeActivityRow[] = accountant.latestExpenses.map((row) => ({
        id: `expense-${textOf(row.id)}`,
        title: 'مصروف',
        detail: textOf(row.desc) || textOf(row.category) || 'قيد مصروف',
        amount: moneyOf(row.amount),
        date: textOf(row.date),
        kind: 'expense',
    }));
    return [...revenues, ...expenses]
        .sort((a, b) => {
            if (a.date !== b.date) {
                return a.date < b.date ? 1 : -1;
            }
            return a.id < b.id ? 1 : -1;
        })
        .slice(0, 6);
}

function alertsFromExecutive(payload: ExecutiveSummary | null): HomeAlertRow[] {
    const rows = payload?.alerts ?? [];
    return rows.slice(0, 4).map((alert, index) => {
        const severity = textOf(alert.severity);
        return {
            id: `exec-alert-${String(index)}`,
            title: textOf(alert.title) || 'تنبيه',
            detail: textOf(alert.detail) || textOf(alert.action?.label) || '—',
            severity: severityLabel(severity),
            tone: alertTone(severity),
        };
    });
}

function alertsFromBriefing(briefing: BriefingResponse | null, warehouse: WarehouseView | null): HomeAlertRow[] {
    const alerts: HomeAlertRow[] = [];
    const stockOut = briefing?.stockOut.length ?? warehouse?.out ?? 0;
    const stockLow = briefing?.stockLow.length ?? warehouse?.low ?? 0;
    if (stockOut > 0) {
        alerts.push({
            id: 'stock-out',
            title: 'نواقص مخزون',
            detail: `${formatInt(stockOut)} صنفًا نفد رصيده — راجع أذون الصرف وطلبات الشراء.`,
            severity: 'high',
            tone: 'danger',
        });
    }
    if (stockLow > 0) {
        alerts.push({
            id: 'stock-low',
            title: 'أصناف تحت الحد',
            detail: `${formatInt(stockLow)} صنفًا اقترب من حد إعادة الطلب.`,
            severity: 'medium',
            tone: 'warning',
        });
    }
    return alerts;
}

/* ─── التجميع ──────────────────────────────────────────────────────────── */

export interface HomeSources {
    readonly executive: ExecutiveSummary | null;
    readonly briefing: BriefingResponse | null;
    readonly posStats: PosStatsResponse | null;
    readonly accountant: AccountantView | null;
    readonly warehouse: WarehouseView | null;
}

export function buildHomeSnapshot(sources: HomeSources, failures: readonly string[]): HomeSnapshot {
    const { executive, briefing, posStats, accountant, warehouse } = sources;
    const execKpis = executive ? kpisFromExecutive(executive) : [];
    const pnlKpis = accountant?.pnl ? kpisFromPnl(accountant.pnl) : [];
    const briefingKpis = kpisFromBriefing(briefing, posStats);
    // مخزون ناقص الجلب لا يُعرض أصفارًا: صفرٌ يبدو بياناتٍ وهو عطل (قاعدة الشاشات).
    const warehouseOk = Boolean(warehouse && warehouse.failures.length === 0);
    const warehouseKpis = warehouseOk && warehouse ? kpisFromWarehouse(warehouse) : [];

    let kpis: HomeKpi[];
    let basis: string;
    if (execKpis.length > 0) {
        kpis = execKpis;
        basis = 'الموجز التنفيذي';
    } else if (pnlKpis.length > 0) {
        kpis = [...pnlKpis, ...briefingKpis].slice(0, 8);
        basis = 'قائمة الدخل وموجز المدير';
    } else if (briefingKpis.length > 0) {
        kpis = [...briefingKpis, ...warehouseKpis].slice(0, 8);
        basis = 'موجز المدير والمخزون';
    } else {
        kpis = warehouseKpis;
        basis = 'بيانات المخزون';
    }

    const fromExecutive = executive ? chartsFromExecutive(executive) : null;
    const fromPnl = accountant?.pnl ? chartsFromPnl(accountant.pnl) : null;
    const primaryCharts = fromExecutive ?? fromPnl;
    const briefingCharts = chartsFromBriefing(briefing);
    const depts = primaryCharts?.depts.length ? primaryCharts.depts : briefingCharts.depts;

    const activity = accountant ? activityFromAccountant(accountant) : [];
    const execAlerts = alertsFromExecutive(executive);
    const alerts = execAlerts.length > 0 ? execAlerts : alertsFromBriefing(briefing, warehouseOk ? warehouse : null);

    return {
        kpis,
        revenueSeries: primaryCharts?.revenueSeries ?? {
            title: 'الإيراد مقابل التكلفة',
            english: 'Revenue vs cost',
            points: [],
        },
        netSeries: primaryCharts?.netSeries ?? { title: 'اتجاه الصافي', english: 'Net trend', points: [] },
        depts,
        deptsTitle: fromExecutive?.deptsTitle ?? fromPnl?.deptsTitle ?? 'مبيعات الأقسام',
        activity,
        alerts,
        failures,
        basis,
    };
}

/**
 * أدوار كل مصدر إداري — مصدر واحد للحقيقة يطابق `requireRole` في الـbackend.
 * أي مصدر لا يملك المستخدم دوره لا يُطلَب أصلًا: لا 403 متوقَّع في الطرفية ولا ضجيج.
 */
const SOURCE_ROLES: Readonly<Record<'executive' | 'briefing' | 'accountant', readonly string[]>> = {
    // backend/executive*.js: requireRole('admin', 'owner')
    executive: ['admin', 'owner'],
    // backend/reports-routes.js: requireRole('admin', 'manager')
    briefing: ['admin', 'manager'],
    // server.js SENSITIVE_READ_ROLES: /api/revenues + /api/expenses + /api/finance/pnl
    accountant: ['admin', 'manager', 'accountant', 'auditor'],
};

function sourceAllowed(role: string, source: keyof typeof SOURCE_ROLES): boolean {
    return SOURCE_ROLES[source].includes(role);
}

export async function fetchHomeSnapshot(role: string, signal?: AbortSignal): Promise<HomeSnapshot> {
    const settled = await Promise.allSettled([
        sourceAllowed(role, 'executive') ? fetchExecutiveSummary(14, signal) : Promise.resolve(null),
        sourceAllowed(role, 'briefing') ? fetchManagerBriefing(signal) : Promise.resolve(null),
        fetchPosTodayStats(signal),
        sourceAllowed(role, 'accountant') ? fetchAccountantSnapshot(signal) : Promise.resolve(null),
    ]);
    const [executiveResult, briefingResult, posResult, accountantResult] = settled;

    if (settled.every((entry) => entry.status === 'rejected')) {
        const reason = settled[0]?.status === 'rejected' ? settled[0].reason : null;
        throw reason instanceof Error ? reason : new Error('تعذّر جلب بيانات الصفحة الرئيسية');
    }

    const failures: string[] = [];
    if (executiveResult.status === 'rejected' && !isExpectedDenial(executiveResult.reason)) {
        failures.push(`الموجز التنفيذي: ${errorMessage(executiveResult.reason)}`);
    }
    if (briefingResult.status === 'rejected' && !isExpectedDenial(briefingResult.reason)) {
        failures.push(`موجز المدير: ${errorMessage(briefingResult.reason)}`);
    }
    if (posResult.status === 'rejected' && !isExpectedDenial(posResult.reason)) {
        failures.push(`إحصاءات نقطة البيع: ${errorMessage(posResult.reason)}`);
    }
    const accountant = accountantResult.status === 'fulfilled' ? accountantResult.value : null;
    if (accountant) {
        failures.push(...accountant.failures);
    }

    const executive = executiveResult.status === 'fulfilled' ? executiveResult.value : null;
    const briefing = briefingResult.status === 'fulfilled' ? briefingResult.value : null;
    const posStats = posResult.status === 'fulfilled' ? posResult.value : null;

    // دورٌ لا يقرأ الموجز ولا قائمة الدخل ⇒ نكمل من قراءات المخزون المتاحة له.
    let warehouse: WarehouseView | null = null;
    if (!executive && !accountant?.pnl) {
        const warehouseSettled = await Promise.allSettled([fetchWarehouseSnapshot(signal, role)]);
        const entry = warehouseSettled[0];
        if (entry?.status === 'fulfilled') {
            warehouse = entry.value;
            failures.push(...entry.value.failures);
        } else if (entry && !isExpectedDenial(entry.reason)) {
            failures.push(`المخزون: ${errorMessage(entry.reason)}`);
        }
    }

    return buildHomeSnapshot({ executive, briefing, posStats, accountant, warehouse }, failures);
}

/* ─── الإجراءات السريعة حسب الدور ──────────────────────────────────────── */

export interface HomeQuickAction {
    readonly to: string;
    readonly label: string;
}

const ROLE_ACTIONS: Readonly<Record<string, readonly string[]>> = {
    owner: ['executive', 'briefing', 'cfo', 'reports', 'users', 'settings'],
    admin: ['executive', 'briefing', 'cfo', 'reports', 'users', 'settings'],
    manager: ['executive', 'briefing', 'reports', 'warehouse-dashboard', 'hr-dashboard', 'cashier-monitor'],
    accountant: ['cfo', 'pnl', 'monthly-comparison', 'cost-analysis', 'revenues', 'expenses'],
    auditor: ['briefing', 'reports', 'pnl', 'monthly-comparison', 'accounts', 'journal'],
    hr: ['hr-dashboard', 'employees', 'attendance', 'leaves', 'payroll', 'roster'],
    dept_head: ['dept-head-dashboard', 'dept-employees', 'dispatch', 'dept-transfers', 'cost-center', 'reports'],
    warehouse: ['warehouse', 'warehouse-dashboard', 'dispatch', 'wh-prs', 'inventory-inquiry', 'wh-moves'],
    kitchen: ['kitchen', 'recipes', 'menu-board', 'dispatch', 'wh-returns', 'weight'],
    // قوائم الكاشير في V2 لا تشمل المالية ولا التقارير — الإجراءات من قوائمه الفعلية فقط.
    cashier: ['pos-entry', 'attendance', 'leaves', 'employee-portal'],
    // الموظف لا يرى payroll/roster في V2؛ نبقي ما يُسمح به فعلًا.
    employee: ['employee-portal', 'attendance', 'leaves'],
    default: ['executive', 'reports', 'warehouse', 'employees', 'settings', 'briefing'],
};

/**
 * إجراءات سريعة حسب الدور، مع تصفية الشاشات المطفأة في القلب التدريجي،
 * وقوائم الدور المسموحة (`allowedMenus`: أساس الدور + المنح − الممنوعات).
 * `allowed = null` تعني «لا جلسة/لا دور» — عندها لا نفلتر بالقوائم.
 */
export function quickActionsForRole(
    role: string,
    enabled: ReadonlySet<string>,
    allowed?: readonly string[] | null,
): HomeQuickAction[] {
    const keys = ROLE_ACTIONS[role] ?? ROLE_ACTIONS.default ?? [];
    const allowedSet = allowed ? new Set(allowed) : null;
    return keys
        .filter((key) => enabled.has(key) && (!allowedSet || allowedSet.has(key)))
        .map((key) => ({ to: `/${key}`, label: titleForPath(`/${key}`) ?? key }));
}
