import { type BankRec, fetchBankRec } from './bank-rec';
import { fetchWpsReadiness, readinessPercent, type WpsReadinessResponse } from './mudad';
import { fetchPayrollSheet, type PayrollSheet, type PayrollSheetSummary, sheetRow, sheetSummary } from './payroll';
import { fetchVatReturn, type VatReturn } from './vat-return';

/**
 * مركز القيادة الموحّد — يقرأ من مصادر النظام الحقيقية ولا يحاكي شيئًا:
 *
 *  • الضريبة  ← `GET /api/accounting/vat-return` (نفس شاشة الإقرار)
 *  • الرواتب  ← `GET /api/payroll-sheet` عبر `fetchPayrollSheet`
 *  • مدد/قوى  ← `GET /api/integration/wps/readiness`
 *  • البنك    ← `GET /api/accounting/bank-rec`
 *
 * كل مؤشّر مشتقّ من البيانات المتاحة فقط: غياب مصدر يُعلن «غير متاح» ولا
 * يُخمَّن صفرًا. لا تُرسل هذه الوحدة أي كتابة — الكتابة في شاشاتها.
 */

export interface CommandCenterData {
    vat: VatReturn | null;
    payroll: PayrollSheet | null;
    payrollSummary: PayrollSheetSummary | null;
    wps: WpsReadinessResponse | null;
    bank: BankRec | null;
    from: string;
    to: string;
}

export interface ComplianceScore {
    tax: number | null;
    payroll: number | null;
    bank: number | null;
    overall: number | null;
    tone: 'ok' | 'warn' | 'danger';
}

export interface CommandRisk {
    level: 'high' | 'med' | 'low';
    text: string;
}

export interface CommandKpis {
    payrollLiability: string | null;
    payrollEmployees: number | null;
    taxNet: number | null;
    bankMovement: number | null;
    bankUnmatched: number | null;
}

const round = (value: number): number => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const abs = (value: number): number => Math.abs(round(value));

/**
 * درجة الالتزام — أوزان ثابتة (ضريبة 40% · رواتب 35% · بنك 25%).
 * كل مصدر يغيب يُستبعد من المتوسط وتُعاد توزيع الأوزان على الموجود.
 */
export function complianceScore(data: CommandCenterData): ComplianceScore {
    const tax = data.vat?.filing_readiness ? Math.max(0, 100 - data.vat.filing_readiness.blockers.length * 20) : null;
    const payroll = data.wps ? readinessPercent(data.wps.summary) : null;
    const bank =
        data.bank === null
            ? null
            : Math.max(0, 100 - Math.min(100, data.bank.unmatched.length * 10 + (abs(data.bank.diff) > 0.01 ? 25 : 0)));

    const parts: Array<[number, number]> = [];
    if (tax !== null) parts.push([tax, 0.4]);
    if (payroll !== null) parts.push([payroll, 0.35]);
    if (bank !== null) parts.push([bank, 0.25]);
    const weight = parts.reduce((sum, [, ratio]) => sum + ratio, 0);
    const overall = weight > 0 ? Math.round(parts.reduce((sum, [score, ratio]) => sum + score * ratio, 0) / weight) : null;

    return {
        tax,
        payroll,
        bank,
        overall,
        tone: overall === null ? 'danger' : overall >= 90 ? 'ok' : overall >= 80 ? 'warn' : 'danger',
    };
}

/**
 * التنبؤ بالمخاطر — كل تنبيه مربوط بحقلٍ من الخادم لا بافتراض:
 * موانع الإقرار، موانع مدد، فرق البنك وحركاته غير المطابقة، المستندات
 * غير المرحّلة، والإلغاءات بلا تاريخ إلغاء، والإيرادات القديمة بلا فاتورة.
 */
export function commandRisks(data: CommandCenterData): CommandRisk[] {
    const risks: CommandRisk[] = [];

    for (const blocker of data.vat?.filing_readiness?.blockers ?? []) {
        risks.push({ level: 'high', text: blocker.message });
    }
    for (const blocker of data.wps?.blockers ?? []) {
        risks.push({ level: 'high', text: blocker });
    }

    const missingSupplierVat = Number(data.vat?.purchases_crosscheck?.missing_supplier_vat_count ?? 0);
    if (missingSupplierVat > 0) {
        risks.push({
            level: 'high',
            text: `${String(missingSupplierVat)} فواتير شراء بلا رقم ضريبي صحيح — لن تُخصم ضريبتها حتى استكماله.`,
        });
    }

    const missingTaxRate = Number(data.vat?.purchases_crosscheck?.missing_tax_rate_count ?? 0);
    if (missingTaxRate > 0) {
        risks.push({ level: 'high', text: `${String(missingTaxRate)} فواتير بلا معدل ضريبة — المدخلات غير قابلة للخصم قبل استكمالها.` });
    }

    if (data.bank && abs(data.bank.diff) > 0.01) {
        risks.push({
            level: 'med',
            text: `فرق مطابقة البنك ${String(data.bank.diff)} بين كشف البنك والدفتر في الفترة — راجع الحركات غير المطابقة.`,
        });
    }
    if (data.bank && data.bank.unmatched.length > 0) {
        risks.push({
            level: 'med',
            text: `${String(data.bank.unmatched.length)} حركات بنك غير مطابقة في الفترة — شغّل المطابقة الآلية أو طابق يدويًّا.`,
        });
    }

    const unpostedSales = Number(data.vat?.sales_source_counts?.unposted_sales ?? 0);
    const unpostedVoids = Number(data.vat?.sales_source_counts?.unposted_voids ?? 0);
    if (unpostedSales + unpostedVoids > 0) {
        risks.push({
            level: 'med',
            text: `${String(unpostedSales + unpostedVoids)} مستندات مبيعات/إلغاء غير مرحّلة — لا تدخل الإقرار قبل ترحيلها.`,
        });
    }
    const unpostedPurchases = Number(data.vat?.purchases_crosscheck?.unposted_count ?? 0);
    if (unpostedPurchases > 0) {
        risks.push({
            level: 'med',
            text: `${String(unpostedPurchases)} فواتير شراء غير مرحّلة — لا تظهر ضريبة مدخلاتها قبل الترحيل.`,
        });
    }
    const cancelledWithoutVoidDate = Number(data.vat?.cancelled_without_void_date ?? 0);
    if (cancelledWithoutVoidDate > 0) {
        risks.push({
            level: 'med',
            text: `${String(cancelledWithoutVoidDate)} إلغاءات بلا تاريخ إلغاء — لا يمكن إثبات عكس ضريبتها.`,
        });
    }
    const legacyRevenue = Number(data.vat?.legacy_revenue_crosscheck?.count ?? 0);
    if (legacyRevenue > 0) {
        risks.push({
            level: 'med',
            text: `${String(legacyRevenue)} إيرادات قديمة بلا فاتورة مرتبطة — تحتاج مطابقة خارج النظام.`,
        });
    }

    return risks;
}

/** مؤشرات القيادة — المبالغ من الخادم كما هي، وغياب المصدر يبقى «—». */
export function commandKpis(data: CommandCenterData): CommandKpis {
    return {
        payrollLiability: data.payrollSummary ? data.payrollSummary.total : null,
        payrollEmployees: data.payroll ? data.payroll.employees.length : null,
        taxNet: data.vat ? (data.vat.net_payable > 0 ? data.vat.net_payable : data.vat.carry_forward_credit) : null,
        bankMovement: data.bank ? data.bank.book : null,
        bankUnmatched: data.bank ? data.bank.unmatched.length : null,
    };
}

export interface CommandCenterQueries {
    vat: { from: string; to: string };
    month: string;
    bank: { from: string; to: string };
}

/**
 * جلب كل المصادر بالتوازي — أي مصدر يفشل يبقى `null` وتعرض الشاشة
 * «غير متاح» بدل أن تسقط اللوحة كلّها.
 */
export async function fetchCommandCenter(queries: CommandCenterQueries, signal?: AbortSignal): Promise<CommandCenterData> {
    const [vat, payroll, wps, bank] = await Promise.allSettled([
        fetchVatReturn(queries.vat.from, queries.vat.to, signal),
        fetchPayrollSheet(queries.month, signal),
        fetchWpsReadiness(queries.month, signal),
        fetchBankRec(queries.bank.from, queries.bank.to, '', signal),
    ]);

    const payrollValue = payroll.status === 'fulfilled' ? payroll.value : null;
    const payrollSummary =
        payrollValue === null
            ? null
            : sheetSummary(
                  payrollValue.employees.map((employee) =>
                      sheetRow(employee, new Map(), payrollValue.monthDays.get(String(employee.id)) ?? 0),
                  ),
              );

    return {
        vat: vat.status === 'fulfilled' ? vat.value : null,
        payroll: payrollValue,
        payrollSummary,
        wps: wps.status === 'fulfilled' ? wps.value : null,
        bank: bank.status === 'fulfilled' ? bank.value : null,
        from: queries.vat.from,
        to: queries.vat.to,
    };
}
