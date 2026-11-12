import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TableScroll } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    ackCustody,
    addBankStatement,
    autoMatchBank,
    CFO_OPS_TEXT,
    createAsset,
    createBudget,
    deleteBudget,
    disposeAsset,
    fetchAssets,
    fetchBankRec,
    fetchBudgets,
    fetchCustody,
    isValidDate,
    postPayroll,
    runAlerts,
    runDepreciation,
    type StatementPayload,
    validateAsset,
    validateBudget,
    validateStatement,
} from '../lib/cfo-ops';
import { canWriteCfo, todayIso } from '../lib/cfo-write';
import { intOf, moneyOf, textOf } from '../lib/reporting';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Input } from '../ui/Input';
import { useConfirm } from './ConfirmProvider';

/**
 * مركز العمليات المالية — يتمّم أبواب CFO التي كانت في V2:
 * البنك (كشف + مطابقة تلقائية)، الأصول (إضافة/استبعاد/إهلاك)، ترحيل الرواتب،
 * الموازنات (إضافة/حذف)، العهد (إقرار الاستلام)، وتشغيل التنبيهات.
 *
 * كل عملية تُنفَّذ على الخادم بعقد V2 نفسه، والتحقق هنا استباقي فقط.
 * الصلاحية الظاهرة `admin|accountant`؛ إقرار العهدة يظهر لمن هي له فقط.
 */

type OpsTab = 'bank' | 'assets' | 'payroll' | 'budgets' | 'custody' | 'alerts';

const TABS: { key: OpsTab; label: string }[] = [
    { key: 'bank', label: CFO_OPS_TEXT.bank },
    { key: 'assets', label: CFO_OPS_TEXT.assets },
    { key: 'payroll', label: CFO_OPS_TEXT.payroll },
    { key: 'budgets', label: CFO_OPS_TEXT.budgets },
    { key: 'custody', label: CFO_OPS_TEXT.custody },
    { key: 'alerts', label: CFO_OPS_TEXT.alerts },
];

const TH = 'border-b border-hairline bg-surface-sunken px-sm py-xs text-start text-label-md font-medium text-ink-secondary';
const TD = 'border-b border-hairline px-sm py-xxs text-ink';

function stateLine(pending: boolean, error: unknown, empty: string, hasData: boolean) {
    if (pending) {
        return (
            <p className="text-body-sm text-muted" role="status">
                جارٍ التحميل…
            </p>
        );
    }
    if (error) {
        return (
            <p role="alert" className="text-body-sm text-danger-text">
                {writeErrorMessage(error, CFO_OPS_TEXT.loadFailed)}
            </p>
        );
    }
    if (!hasData) {
        return <p className="text-body-sm text-muted">{empty}</p>;
    }
    return null;
}

export function CfoOpsPanel({ from, to }: { from: string; to: string }) {
    const auth = useAuthState();
    const confirm = useConfirm();
    const writable = canWriteCfo(auth.user?.role);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState<OpsTab>('bank');
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    // البنك
    const [account, setAccount] = useState('1010');
    const [bankFrom, setBankFrom] = useState(from);
    const [bankTo, setBankTo] = useState(to);
    const [stmtDate, setStmtDate] = useState(todayIso());
    const [stmtDesc, setStmtDesc] = useState('');
    const [stmtAmount, setStmtAmount] = useState('');

    // الأصول
    const [assetName, setAssetName] = useState('');
    const [assetCost, setAssetCost] = useState('');
    const [assetLife, setAssetLife] = useState('60');
    const [assetSalvage, setAssetSalvage] = useState('0');
    const [assetDate, setAssetDate] = useState('');
    const [depMonth, setDepMonth] = useState(from.slice(0, 7));

    // الرواتب
    const [payMonth, setPayMonth] = useState(from.slice(0, 7));

    // الموازنات
    const [budgetPeriod, setBudgetPeriod] = useState(from.slice(0, 7));
    const [budgetLabel, setBudgetLabel] = useState('');
    const [budgetAccount, setBudgetAccount] = useState('');
    const [budgetAmount, setBudgetAmount] = useState('');

    // العهد
    const [custodyDate, setCustodyDate] = useState(todayIso());

    const bankQuery = useQuery({
        queryKey: ['cfo-bank-rec', account, bankFrom, bankTo],
        queryFn: ({ signal }) => fetchBankRec(account, bankFrom, bankTo, signal),
        enabled: open && tab === 'bank',
    });
    const assetsQuery = useQuery({
        queryKey: ['cfo-assets'],
        queryFn: ({ signal }) => fetchAssets(signal),
        enabled: open && tab === 'assets',
    });
    const budgetsQuery = useQuery({
        queryKey: ['cfo-budgets', budgetPeriod],
        queryFn: ({ signal }) => fetchBudgets(budgetPeriod, signal),
        enabled: open && tab === 'budgets',
    });
    const custodyQuery = useQuery({
        queryKey: ['cfo-custody', custodyDate],
        queryFn: ({ signal }) => fetchCustody(custodyDate, signal),
        enabled: open && tab === 'custody',
    });

    const statementMutation = useWriteMutation<StatementPayload, number>({
        mutationFn: addBankStatement,
        successTitle: CFO_OPS_TEXT.statementAdded,
        invalidate: [['cfo'], ['cfo-bank-rec']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: (inserted) => {
            setStmtDesc('');
            setStmtAmount('');
            setNotice(inserted > 0 ? CFO_OPS_TEXT.statementAdded : 'الحركة موجودة مسبقًا في الكشف');
        },
    });

    const autoMatchMutation = useWriteMutation<string, { matched: number; scanned: number }>({
        mutationFn: autoMatchBank,
        successTitle: 'تمت المطابقة التلقائية',
        invalidate: [['cfo'], ['cfo-bank-rec']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: (data) => setNotice(`${CFO_OPS_TEXT.matched(data.matched)} من ${intOf(data.scanned)}`),
    });

    const assetMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const validated = validateAsset(assetName, assetCost, assetLife, assetSalvage);
            if (!validated.ok) {
                throw new Error(validated.error);
            }
            if (assetDate && !isValidDate(assetDate)) {
                throw new Error('تاريخ الشراء غير صالح');
            }
            await createAsset(validated.payload, assetDate);
        },
        successTitle: CFO_OPS_TEXT.assetAdded,
        invalidate: [['cfo'], ['cfo-assets']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: () => {
            setAssetName('');
            setAssetCost('');
            setAssetSalvage('0');
        },
    });

    const disposeMutation = useWriteMutation<{ id: string; name: string }, void>({
        mutationFn: async ({ id }) => {
            await disposeAsset(id);
        },
        successTitle: CFO_OPS_TEXT.disposed,
        invalidate: [['cfo'], ['cfo-assets']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
    });

    const depreciationMutation = useWriteMutation<string, { posted: number; total: number }>({
        mutationFn: runDepreciation,
        successTitle: 'تم تشغيل الإهلاك',
        invalidate: [['cfo'], ['cfo-assets']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: (data) => setNotice(CFO_OPS_TEXT.depreciationDone(data.posted, data.total)),
    });

    const payrollMutation = useWriteMutation<string, { count: number; total: number }>({
        mutationFn: postPayroll,
        successTitle: 'تم ترحيل الرواتب',
        invalidate: [['cfo']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: (data) => setNotice(CFO_OPS_TEXT.payrollDone(data.count, data.total)),
    });

    const budgetMutation = useWriteMutation<void, void>({
        mutationFn: async () => {
            const validated = validateBudget(budgetPeriod, budgetLabel, budgetAccount, budgetAmount);
            if (!validated.ok) {
                throw new Error(validated.error);
            }
            await createBudget(validated.payload);
        },
        successTitle: CFO_OPS_TEXT.budgetAdded,
        invalidate: [['cfo'], ['cfo-budgets']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: () => {
            setBudgetLabel('');
            setBudgetAccount('');
            setBudgetAmount('');
        },
    });

    const removeBudgetMutation = useWriteMutation<string, void>({
        mutationFn: deleteBudget,
        successTitle: CFO_OPS_TEXT.budgetDeleted,
        invalidate: [['cfo'], ['cfo-budgets']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
    });

    const ackMutation = useWriteMutation<string, void>({
        mutationFn: ackCustody,
        successTitle: CFO_OPS_TEXT.acked,
        invalidate: [['cfo-custody']],
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
    });

    const alertsMutation = useWriteMutation<void, string[]>({
        mutationFn: runAlerts,
        successTitle: 'تم تشغيل التنبيهات',
        silentError: true,
        onError: (cause) => setError(writeErrorMessage(cause, CFO_OPS_TEXT.failed)),
        onSuccess: (sent) => setNotice(CFO_OPS_TEXT.alertsDone(sent.length)),
    });

    if (!writable) {
        return null;
    }

    function clearFeedback(): void {
        setError('');
        setNotice('');
    }

    async function handleAutoMatch(): Promise<void> {
        clearFeedback();
        if (!(await confirm(`مطابقة كشف الحساب ${account} تلقائيًا؟`))) {
            return;
        }
        autoMatchMutation.mutate(account);
    }

    async function handleDispose(id: string, name: string): Promise<void> {
        clearFeedback();
        if (!(await confirm(CFO_OPS_TEXT.disposeConfirm(name)))) {
            return;
        }
        disposeMutation.mutate({ id, name });
    }

    async function handleDepreciation(): Promise<void> {
        clearFeedback();
        if (!(await confirm(CFO_OPS_TEXT.depreciationConfirm(depMonth)))) {
            return;
        }
        depreciationMutation.mutate(depMonth);
    }

    async function handlePayroll(): Promise<void> {
        clearFeedback();
        if (!(await confirm(CFO_OPS_TEXT.payrollConfirm(payMonth)))) {
            return;
        }
        payrollMutation.mutate(payMonth);
    }

    async function handleDeleteBudget(id: string, label: string): Promise<void> {
        clearFeedback();
        if (!(await confirm(CFO_OPS_TEXT.deleteBudgetConfirm(label)))) {
            return;
        }
        removeBudgetMutation.mutate(id);
    }

    const bank = bankQuery.data;
    const unmatched = bank?.unmatched ?? [];
    const assets = assetsQuery.data ?? [];
    const budgets = budgetsQuery.data ?? [];
    const custody = custodyQuery.data;
    const mine = String(auth.user?.id ?? '');

    return (
        <>
            <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(true)}>
                {CFO_OPS_TEXT.title}
            </Button>

            <Dialog
                open={open}
                onOpenChange={setOpen}
                title={CFO_OPS_TEXT.title}
                description={CFO_OPS_TEXT.hint}
                size="lg"
                footer={
                    <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
                        {CFO_OPS_TEXT.close}
                    </Button>
                }
            >
                <div className="flex flex-col gap-sm">
                    <div className="flex flex-wrap gap-xs" role="tablist" aria-label="عمليات المدير المالي">
                        {TABS.map((item) => (
                            <button
                                key={item.key}
                                type="button"
                                role="tab"
                                aria-selected={tab === item.key}
                                onClick={() => {
                                    clearFeedback();
                                    setTab(item.key);
                                }}
                                className={`shrink-0 whitespace-nowrap rounded-md border px-sm py-xs text-button-md ${
                                    tab === item.key
                                        ? 'border-primary bg-primary text-on-primary'
                                        : 'border-hairline-strong bg-surface text-ink hover:bg-surface-hover'
                                }`}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>

                    {notice ? (
                        <p role="status" className="text-body-sm text-success-text">
                            {notice}
                        </p>
                    ) : null}
                    {error ? (
                        <p role="alert" className="text-body-sm text-danger-text">
                            {error}
                        </p>
                    ) : null}

                    {tab === 'bank' ? (
                        <section className="flex flex-col gap-sm">
                            <div className="grid gap-sm sm:grid-cols-3">
                                <Input label={CFO_OPS_TEXT.account} value={account} onChange={(event) => setAccount(event.target.value)} />
                                <Input
                                    label={CFO_OPS_TEXT.from}
                                    type="date"
                                    value={bankFrom}
                                    onChange={(event) => setBankFrom(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.to}
                                    type="date"
                                    value={bankTo}
                                    onChange={(event) => setBankTo(event.target.value)}
                                />
                            </div>

                            {stateLine(bankQuery.isPending, bankQuery.error, 'لا حركة بنكية في المدى.', Boolean(bank))}

                            {bank ? (
                                <>
                                    <dl className="grid gap-sm rounded-md border border-hairline bg-surface-sunken p-sm text-body-sm sm:grid-cols-3">
                                        <div>
                                            <dt className="text-muted">{CFO_OPS_TEXT.book}</dt>
                                            <dd className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(bank.book)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">{CFO_OPS_TEXT.statement}</dt>
                                            <dd className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(bank.statement)}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-muted">{CFO_OPS_TEXT.diff}</dt>
                                            <dd className="erp-numeric text-ink" dir="ltr">
                                                {moneyOf(bank.diff)}
                                            </dd>
                                        </div>
                                    </dl>
                                    <p className="text-body-sm text-muted">
                                        {CFO_OPS_TEXT.unmatched}: {intOf(unmatched.length)}
                                    </p>
                                </>
                            ) : null}

                            <div className="grid items-end gap-sm sm:grid-cols-4">
                                <Input
                                    label={CFO_OPS_TEXT.statementDate}
                                    type="date"
                                    value={stmtDate}
                                    onChange={(event) => setStmtDate(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.statementDesc}
                                    value={stmtDesc}
                                    maxLength={255}
                                    onChange={(event) => setStmtDesc(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.statementAmount}
                                    inputMode="decimal"
                                    value={stmtAmount}
                                    onChange={(event) => setStmtAmount(event.target.value)}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={statementMutation.isPending}
                                    onClick={() => {
                                        clearFeedback();
                                        const validated = validateStatement(stmtDate, stmtDesc, stmtAmount, account);
                                        if (!validated.ok) {
                                            setError(validated.error);
                                            return;
                                        }
                                        statementMutation.mutate(validated.payload);
                                    }}
                                >
                                    {CFO_OPS_TEXT.addStatement}
                                </Button>
                            </div>

                            <div>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={autoMatchMutation.isPending}
                                    onClick={() => void handleAutoMatch()}
                                >
                                    {CFO_OPS_TEXT.autoMatch}
                                </Button>
                            </div>

                            {unmatched.length ? (
                                <TableScroll label="حركات كشف غير مطابقة">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead>
                                            <tr>
                                                <th scope="col" className={TH}>
                                                    التاريخ
                                                </th>
                                                <th scope="col" className={TH}>
                                                    الوصف
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    المبلغ
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {unmatched.slice(0, 8).map((row) => (
                                                <tr key={row.id}>
                                                    <td className={`${TD} erp-numeric`} dir="ltr">
                                                        {textOf(row.stmt_date).slice(0, 10) || '—'}
                                                    </td>
                                                    <td className={TD}>{textOf(row.description) || '—'}</td>
                                                    <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                        {moneyOf(row.amount)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            ) : null}
                        </section>
                    ) : null}

                    {tab === 'assets' ? (
                        <section className="flex flex-col gap-sm">
                            <div className="grid items-end gap-sm sm:grid-cols-3">
                                <Input
                                    label={CFO_OPS_TEXT.assetName}
                                    value={assetName}
                                    maxLength={255}
                                    onChange={(event) => setAssetName(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.assetCost}
                                    inputMode="decimal"
                                    value={assetCost}
                                    onChange={(event) => setAssetCost(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.assetLife}
                                    inputMode="numeric"
                                    value={assetLife}
                                    onChange={(event) => setAssetLife(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.assetSalvage}
                                    inputMode="decimal"
                                    value={assetSalvage}
                                    onChange={(event) => setAssetSalvage(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.purchaseDate}
                                    type="date"
                                    value={assetDate}
                                    onChange={(event) => setAssetDate(event.target.value)}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={assetMutation.isPending}
                                    onClick={() => {
                                        clearFeedback();
                                        assetMutation.mutate();
                                    }}
                                >
                                    {CFO_OPS_TEXT.addAsset}
                                </Button>
                            </div>

                            <div className="flex flex-wrap items-end gap-sm border-t border-hairline pt-sm">
                                <Input
                                    label={CFO_OPS_TEXT.depreciationMonth}
                                    type="month"
                                    value={depMonth}
                                    onChange={(event) => setDepMonth(event.target.value)}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    disabled={depreciationMutation.isPending}
                                    onClick={() => void handleDepreciation()}
                                >
                                    {CFO_OPS_TEXT.runDepreciation}
                                </Button>
                            </div>

                            {stateLine(assetsQuery.isPending, assetsQuery.error, 'لا أصول مسجلة.', assets.length > 0)}

                            {assets.length ? (
                                <TableScroll label="جدول الأصول الثابتة">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead>
                                            <tr>
                                                <th scope="col" className={TH}>
                                                    الأصل
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    التكلفة
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    شهري
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    المتبقي
                                                </th>
                                                <th scope="col" className={TH}>
                                                    الحالة
                                                </th>
                                                <th scope="col" className={TH} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {assets.map((asset) => (
                                                <tr key={asset.id}>
                                                    <td className={TD}>{textOf(asset.name) || '—'}</td>
                                                    <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                        {moneyOf(asset.cost)}
                                                    </td>
                                                    <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                        {moneyOf(asset.monthly)}
                                                    </td>
                                                    <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                        {moneyOf(asset.remaining)}
                                                    </td>
                                                    <td className={TD}>{textOf(asset.status) === 'disposed' ? 'مستبعد' : 'نشط'}</td>
                                                    <td className={TD}>
                                                        {textOf(asset.status) !== 'disposed' ? (
                                                            <Button
                                                                type="button"
                                                                size="sm"
                                                                variant="danger"
                                                                disabled={disposeMutation.isPending}
                                                                onClick={() => void handleDispose(asset.id, textOf(asset.name) || '—')}
                                                            >
                                                                {CFO_OPS_TEXT.dispose}
                                                            </Button>
                                                        ) : null}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            ) : null}
                        </section>
                    ) : null}

                    {tab === 'payroll' ? (
                        <section className="flex flex-col gap-sm">
                            <p className="text-body-sm text-muted">
                                يقرأ الخادم صافي رواتب الشهر من مسير الرواتب ويرحّل قيدًا واحدًا (مصروف/مستحق). التشغيل الثاني لنفس الشهر يعيد
                                409 بلا ازدواج.
                            </p>
                            <div className="flex flex-wrap items-end gap-sm">
                                <Input
                                    label={CFO_OPS_TEXT.payrollMonth}
                                    type="month"
                                    value={payMonth}
                                    onChange={(event) => setPayMonth(event.target.value)}
                                />
                                <Button type="button" size="sm" disabled={payrollMutation.isPending} onClick={() => void handlePayroll()}>
                                    {CFO_OPS_TEXT.postPayroll}
                                </Button>
                            </div>
                        </section>
                    ) : null}

                    {tab === 'budgets' ? (
                        <section className="flex flex-col gap-sm">
                            <Input
                                label={CFO_OPS_TEXT.budgetPeriod}
                                type="month"
                                value={budgetPeriod}
                                onChange={(event) => setBudgetPeriod(event.target.value)}
                            />

                            <div className="grid items-end gap-sm sm:grid-cols-4">
                                <Input
                                    label={CFO_OPS_TEXT.budgetLabel}
                                    value={budgetLabel}
                                    maxLength={150}
                                    onChange={(event) => setBudgetLabel(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.budgetAccount}
                                    value={budgetAccount}
                                    onChange={(event) => setBudgetAccount(event.target.value)}
                                />
                                <Input
                                    label={CFO_OPS_TEXT.budgetAmount}
                                    inputMode="decimal"
                                    value={budgetAmount}
                                    onChange={(event) => setBudgetAmount(event.target.value)}
                                />
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={budgetMutation.isPending}
                                    onClick={() => {
                                        clearFeedback();
                                        budgetMutation.mutate();
                                    }}
                                >
                                    {CFO_OPS_TEXT.addBudget}
                                </Button>
                            </div>

                            {stateLine(budgetsQuery.isPending, budgetsQuery.error, 'لا موازنات لهذا الشهر.', budgets.length > 0)}

                            {budgets.length ? (
                                <TableScroll label="جدول الموازنات">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead>
                                            <tr>
                                                <th scope="col" className={TH}>
                                                    البيان
                                                </th>
                                                <th scope="col" className={TH}>
                                                    الحساب
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    المبلغ
                                                </th>
                                                <th scope="col" className={TH} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {budgets.map((budget) => (
                                                <tr key={budget.id}>
                                                    <td className={TD}>{textOf(budget.label) || '—'}</td>
                                                    <td className={TD} dir="ltr">
                                                        {textOf(budget.account_code) || '—'}
                                                    </td>
                                                    <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                        {moneyOf(budget.amount)}
                                                    </td>
                                                    <td className={TD}>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="danger"
                                                            disabled={removeBudgetMutation.isPending}
                                                            onClick={() =>
                                                                void handleDeleteBudget(
                                                                    budget.id,
                                                                    textOf(budget.label) || textOf(budget.account_code) || budget.id,
                                                                )
                                                            }
                                                        >
                                                            {CFO_OPS_TEXT.deleteBudget}
                                                        </Button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            ) : null}
                        </section>
                    ) : null}

                    {tab === 'custody' ? (
                        <section className="flex flex-col gap-sm">
                            <Input
                                label={CFO_OPS_TEXT.custodyDate}
                                type="date"
                                value={custodyDate}
                                onChange={(event) => setCustodyDate(event.target.value)}
                            />
                            <p className="text-body-sm text-muted">
                                {CFO_OPS_TEXT.custodyPending}: {intOf(custody?.myPending)}
                            </p>

                            {stateLine(custodyQuery.isPending, custodyQuery.error, CFO_OPS_TEXT.noCustody, Boolean(custody?.rows?.length))}

                            {custody?.rows?.length ? (
                                <TableScroll label="جدول العهد النقدية">
                                    <table className="w-full border-collapse text-body-sm">
                                        <thead>
                                            <tr>
                                                <th scope="col" className={TH}>
                                                    من
                                                </th>
                                                <th scope="col" className={TH}>
                                                    إلى
                                                </th>
                                                <th scope="col" className={`${TH} text-end`}>
                                                    المبلغ
                                                </th>
                                                <th scope="col" className={TH}>
                                                    الإقرار
                                                </th>
                                                <th scope="col" className={TH} />
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {custody.rows.map((row) => {
                                                const isMine = !row.ack_at && String(row.to_cashier ?? '') === mine;
                                                return (
                                                    <tr key={row.id}>
                                                        <td className={TD}>{textOf(row.from_name) || '—'}</td>
                                                        <td className={TD}>{textOf(row.to_name) || '—'}</td>
                                                        <td className={`${TD} erp-numeric text-end`} dir="ltr">
                                                            {moneyOf(row.amount)}
                                                        </td>
                                                        <td className={TD}>{row.ack_at ? 'مُقرّ' : 'معلّق'}</td>
                                                        <td className={TD}>
                                                            {isMine ? (
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    disabled={ackMutation.isPending}
                                                                    onClick={() => {
                                                                        clearFeedback();
                                                                        ackMutation.mutate(row.id);
                                                                    }}
                                                                >
                                                                    {CFO_OPS_TEXT.ack}
                                                                </Button>
                                                            ) : null}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </TableScroll>
                            ) : null}
                        </section>
                    ) : null}

                    {tab === 'alerts' ? (
                        <section className="flex flex-col gap-sm">
                            <p className="text-body-sm text-muted">
                                يفحص الخادم تجاوز الموازنات والذمم المتأخرة ويرسل ما لم يُرسل مسبقًا فقط (منع التكرار بمفتاح يومي/شهري).
                            </p>
                            <div>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={alertsMutation.isPending}
                                    onClick={() => {
                                        clearFeedback();
                                        alertsMutation.mutate();
                                    }}
                                >
                                    {CFO_OPS_TEXT.runAlerts}
                                </Button>
                            </div>
                            {alertsMutation.data?.length ? (
                                <ul className="list-disc ps-md text-body-sm text-ink">
                                    {alertsMutation.data.map((key) => (
                                        <li key={key} dir="ltr">
                                            {key}
                                        </li>
                                    ))}
                                </ul>
                            ) : null}
                        </section>
                    ) : null}
                </div>
            </Dialog>
        </>
    );
}
