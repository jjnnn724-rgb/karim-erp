import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PrintActions } from '../components/PrintActions';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { useAuthState } from '../lib/auth';
import {
    activeUserOptions,
    auditActionLabel,
    auditTimestamp,
    catalogTotals,
    fetchPermissionBootstrap,
    fetchUserPermissions,
    groupCatalog,
    modeCounts,
    type PermissionMode,
    permissionModeLabel,
    permMode,
    searchPermissions,
} from '../lib/permissions';
import { PERMISSIONS_TEXT, permissionsWriteVisible, saveUserPermissions } from '../lib/permissions-write';
import { useWriteMutation, writeErrorMessage } from '../lib/write';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

/**
 * الصلاحيات — كاملة مثل V2:
 *  • عرض الكتالوج ووضع كل صلاحية لمستخدم مختار: منح فردي أو سحب أو وراثة الدور
 *  • الطرحة والكتابة بنفس البوابات: التعيين admin وحده في الخادم (backend/permission-routes.js)
 *  • الحفظ عبر PUT /api/permissions/users/:id (grants[] + denies[] + reason)
 *
 * دور admin يملك كل الصلاحيات ضمنيًا (`ADMIN_HAS_ALL` في الخادم) — الشاشة
 * تقول ذلك صراحةً بدل إيهام المستخدم بأن كل شيء «وراثة».
 */

const MODE_TONE: Record<PermissionMode, string> = {
    grant: 'text-success-text',
    deny: 'text-danger-text',
    inherit: 'text-muted',
};

function formatInt(value: number): string {
    return value.toLocaleString('en-US');
}

function Kpi({ label, english, value, hint }: { label: string; english: string; value: string; hint: string }) {
    return (
        <div className="rounded-lg border border-hairline bg-surface p-md shadow-card">
            <p className="text-label-md text-muted">
                {label}{' '}
                <span className="text-caption text-faint" dir="ltr" lang="en">
                    {english}
                </span>
            </p>
            <p className="erp-numeric mt-xs text-heading-lg text-ink" dir="ltr">
                {value}
            </p>
            <p className="mt-xxs text-caption text-muted">{hint}</p>
        </div>
    );
}

export function Permissions() {
    const auth = useAuthState();
    const canWrite = permissionsWriteVisible(auth.user?.role);
    const [selected, setSelected] = useState('');
    const [query, setQuery] = useState('');
    const [editingGrants, setEditingGrants] = useState<Set<string> | null>(null);
    const [editingDenies, setEditingDenies] = useState<Set<string> | null>(null);
    const [reason, setReason] = useState('');
    const [saveError, setSaveError] = useState('');

    const bootstrapQuery = useQuery({
        queryKey: ['permissions-bootstrap'],
        queryFn: ({ signal }) => fetchPermissionBootstrap(signal),
    });
    const targetQuery = useQuery({
        queryKey: ['permissions-user', selected],
        queryFn: ({ signal }) => fetchUserPermissions(selected, signal),
        enabled: selected !== '',
    });

    const catalog = bootstrapQuery.data?.catalog ?? [];
    const options = useMemo(() => activeUserOptions(bootstrapQuery.data?.users ?? []), [bootstrapQuery.data?.users]);
    const totals = useMemo(() => catalogTotals(catalog), [catalog]);

    const grants = useMemo(() => new Set(targetQuery.data?.grants ?? []), [targetQuery.data?.grants]);
    const denies = useMemo(() => new Set(targetQuery.data?.denies ?? []), [targetQuery.data?.denies]);

    const search = useMemo(() => searchPermissions(catalog, query), [catalog, query]);
    const groups = useMemo(() => groupCatalog(search.rows), [search.rows]);

    const target = targetQuery.data?.user ?? null;
    const selectedOption = options.find((option) => option.id === selected) ?? null;
    const targetName = target ? String(target.name || target.username || `#${target.id}`) : '';
    const targetRole = target ? String(target.role ?? '') : '';
    const targetIsAdmin = targetRole === 'admin';
    const audit = targetQuery.data?.audit ?? [];

    const effectiveGrants = editingGrants ?? grants;
    const effectiveDenies = editingDenies ?? denies;
    const modes = useMemo(() => modeCounts(catalog, effectiveGrants, effectiveDenies), [catalog, effectiveGrants, effectiveDenies]);
    const dirty = editingGrants !== null || editingDenies !== null;

    const saveMutation = useWriteMutation<{ grants: string[]; denies: string[]; reason: string }, void>({
        mutationFn: (payload) => saveUserPermissions(selected, payload),
        successTitle: () => PERMISSIONS_TEXT.saveSuccess,
        invalidate: [['permissions-user', selected]],
        silentError: true,
        onSuccess: () => {
            setEditingGrants(null);
            setEditingDenies(null);
            setReason('');
            setSaveError('');
        },
        onError: (cause) => {
            setSaveError(writeErrorMessage(cause, PERMISSIONS_TEXT.saveFailed));
        },
    });

    function startEditing() {
        setEditingGrants(new Set(grants));
        setEditingDenies(new Set(denies));
        setReason('');
        setSaveError('');
    }

    function cancelEditing() {
        setEditingGrants(null);
        setEditingDenies(null);
        setReason('');
        setSaveError('');
    }

    function cycleMode(key: string) {
        if (!editingGrants || !editingDenies) {
            return;
        }
        const nextGrants = new Set(editingGrants);
        const nextDenies = new Set(editingDenies);
        // grant → deny → inherit → grant (السحب يغلب المنح يغلب الوراثة)
        if (nextGrants.has(key) && !nextDenies.has(key)) {
            nextGrants.delete(key);
            nextDenies.add(key);
        } else if (nextDenies.has(key)) {
            nextDenies.delete(key);
        } else {
            nextGrants.add(key);
            nextDenies.delete(key);
        }
        setEditingGrants(nextGrants);
        setEditingDenies(nextDenies);
    }

    async function save() {
        if (!editingGrants || !editingDenies || saveMutation.isPending) {
            return;
        }
        setSaveError('');
        await saveMutation.mutateAsync({
            grants: [...editingGrants],
            denies: [...editingDenies],
            reason,
        });
    }

    function refetchAll() {
        void bootstrapQuery.refetch();
        if (selected) {
            void targetQuery.refetch();
        }
    }

    return (
        <div className="flex flex-col gap-lg">
            <header className="flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md">
                <div>
                    <h1 className="text-display-lg text-ink">
                        الصلاحيات{' '}
                        <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted" dir="ltr" lang="en">
                            Permissions
                        </span>
                    </h1>
                    <p className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                        منح فردية فوق الدور مع كتابة كاملة (admin فقط). السحب يغلب المنح، والمنح يغلب وراثة الدور، ودور admin يملك كل
                        الصلاحيات ضمنيًا.
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="الصلاحيات" />
                    <button
                        type="button"
                        onClick={refetchAll}
                        className="rounded-md border border-hairline-strong bg-surface px-md py-xs text-button-md text-ink hover:bg-surface-hover"
                    >
                        تحديث
                    </button>
                </div>
            </header>

            <div className="grid gap-sm sm:grid-cols-2 xl:grid-cols-4">
                <Kpi
                    label="الصلاحيات"
                    english="Catalog"
                    value={formatInt(totals.permissions)}
                    hint={`${formatInt(totals.groups)} مجموعة`}
                />
                <Kpi label="المجموعات" english="Groups" value={formatInt(totals.groups)} hint="بترتيب ورود الكتالوج" />
                <Kpi label="قوائم النظام" english="Menus" value={formatInt(totals.menus)} hint="قوائم فريدة تفتحها الصلاحيات" />
                <Kpi label="الكيانات" english="Entities" value={formatInt(totals.entities)} hint="قراءة وكتابة عبر الكتالوج كله" />
            </div>

            <Card className="p-sm">
                <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-perms-user">
                    المستخدم
                    <select
                        id="erp-perms-user"
                        value={selected}
                        onChange={(event) => {
                            setSelected(event.target.value);
                            setQuery('');
                        }}
                        className="h-10 w-full max-w-md rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        <option value="">— اختر المستخدم —</option>
                        {options.map((option) => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                                {option.admin ? ' — الكل' : ''}
                            </option>
                        ))}
                    </select>
                </label>
                <p className="mt-sm text-body-sm text-muted" role="status">
                    {options.length
                        ? `${formatInt(options.length)} حسابًا نشطًا للاختيار من ${formatInt(bootstrapQuery.data?.users.length ?? 0)}`
                        : 'لا حسابات نشطة'}
                </p>
            </Card>

            {bootstrapQuery.isPending ? (
                <Card>
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل كتالوج الصلاحيات" />
                        <TableSkeleton rows={4} columns={4} />
                    </div>
                </Card>
            ) : null}

            {bootstrapQuery.isError ? (
                <Card>
                    <StateError
                        message={bootstrapQuery.error instanceof Error ? bootstrapQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void bootstrapQuery.refetch();
                        }}
                    />
                </Card>
            ) : null}

            {bootstrapQuery.isSuccess && !selected ? (
                <Card>
                    <StateEmpty title="اختر مستخدمًا" hint="اختر حسابًا من القائمة أعلاه لعرض منحه الفردية وسحوبه وآخر سجل تدقيقه." />
                </Card>
            ) : null}

            {selected && targetQuery.isPending ? (
                <Card>
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل صلاحيات المستخدم" />
                        <TableSkeleton rows={3} columns={3} />
                    </div>
                </Card>
            ) : null}

            {selected && targetQuery.isError ? (
                <Card>
                    <StateError
                        message={targetQuery.error instanceof Error ? targetQuery.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void targetQuery.refetch();
                        }}
                    />
                </Card>
            ) : null}

            {selected && targetQuery.isSuccess ? (
                <>
                    <Card className="p-sm">
                        <div className="flex flex-wrap items-center gap-sm">
                            <p className="text-body-md text-ink">
                                <span className="text-muted">المستخدم: </span>
                                <b>{targetName || (selectedOption?.label ?? `#${selected}`)}</b>
                                <span className="text-muted"> — الدور: </span>
                                <b>{selectedOption?.roleLabel ?? '—'}</b>
                                {target && !target.active ? <span className="text-caption text-warning-text"> (موقوف)</span> : null}
                            </p>
                            <span className="erp-grow" />
                            <span className="text-body-sm text-success-text">{formatInt(modes.grant)} منح</span>
                            <span className="text-body-sm text-danger-text">{formatInt(modes.deny)} سحب</span>
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                {formatInt(modes.inherit)} وراثة
                            </span>
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                {formatInt(audit.length)} سطر تدقيق
                            </span>
                            {canWrite && !targetIsAdmin ? (
                                dirty ? (
                                    <>
                                        <Input
                                            label="سبب التغيير (اختياري)"
                                            name="reason"
                                            value={reason}
                                            onChange={(e) => setReason(e.target.value)}
                                            placeholder="يُوثَّق في سجل التدقيق"
                                        />
                                        <Button type="button" size="sm" onClick={() => void save()} loading={saveMutation.isPending}>
                                            حفظ الصلاحيات
                                        </Button>
                                        <Button type="button" size="sm" variant="secondary" onClick={cancelEditing}>
                                            {PERMISSIONS_TEXT.cancel}
                                        </Button>
                                    </>
                                ) : (
                                    <Button type="button" size="sm" variant="secondary" onClick={startEditing}>
                                        تعديل المنح
                                    </Button>
                                )
                            ) : null}
                        </div>
                        {saveError ? (
                            <p role="alert" className="mt-sm text-body-sm text-danger-text">
                                {saveError}
                            </p>
                        ) : null}
                        {targetIsAdmin ? (
                            <p className="mt-sm rounded-md border border-hairline-strong bg-surface-sunken px-sm py-xs text-body-sm text-ink">
                                دور admin يملك كل الصلاحيات ضمنيًا؛ لا حاجة لمنح فردي.
                            </p>
                        ) : null}
                        <label className="mt-sm flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-perms-q">
                            بحث في الصلاحيات
                            <input
                                id="erp-perms-q"
                                type="search"
                                value={query}
                                onChange={(event) => {
                                    setQuery(event.target.value);
                                }}
                                placeholder="اسم، مفتاح، مجموعة"
                                className="h-10 w-full rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:w-64"
                            />
                        </label>
                        {search.folded ? (
                            <p className="mt-sm text-body-sm text-muted">بعض النتائج جاءت بعد تطبيع الحروف العربية — البحث الذكي مطبَّق.</p>
                        ) : null}
                    </Card>

                    {groups.length === 0 ? (
                        <Card>
                            <StateEmpty title="لا صلاحيات تطابق البحث" hint="عدّل كلمة البحث أو امسحها لرؤية الكتالوج كاملًا." />
                        </Card>
                    ) : (
                        groups.map((group) => (
                            <Card key={group.name}>
                                <h2 className="border-b border-hairline px-sm py-xs text-heading-sm text-ink">
                                    {group.name}{' '}
                                    <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                        ({formatInt(group.items.length)})
                                    </span>
                                </h2>
                                <div className="grid gap-sm p-sm sm:grid-cols-2 xl:grid-cols-3">
                                    {group.items.map((item) => {
                                        const mode = permMode(item.key, effectiveGrants, effectiveDenies);
                                        return (
                                            <div
                                                key={item.key}
                                                className={`rounded-md border p-sm ${
                                                    mode === 'deny' ? 'border-danger-text' : 'border-hairline'
                                                }`}
                                            >
                                                <p className="text-body-md text-ink">{item.ar || item.key}</p>
                                                <p className="erp-numeric text-caption text-muted" dir="ltr">
                                                    {item.key}
                                                </p>
                                                <p className={`mt-xs text-body-sm ${MODE_TONE[mode]}`}>{permissionModeLabel(mode)}</p>
                                                {item.menus.length ? (
                                                    <p className="erp-numeric mt-xs text-caption text-faint" dir="ltr">
                                                        {item.menus.join(' · ')}
                                                    </p>
                                                ) : null}
                                                {dirty && canWrite && !targetIsAdmin ? (
                                                    <div className="mt-sm flex gap-xs">
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant={mode === 'grant' ? 'secondary' : 'danger'}
                                                            title="تبديل الوضع: منح ثم سحب ثم وراثة"
                                                            onClick={() => cycleMode(item.key)}
                                                        >
                                                            {mode === 'grant'
                                                                ? 'منح ✓ (اضغط لسحب)'
                                                                : mode === 'deny'
                                                                  ? 'سحب ✓ (اضغط لوراثة)'
                                                                  : 'وراثة (اضغط لمنح)'}
                                                        </Button>
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        ))
                    )}

                    <Card>
                        <h2 className="border-b border-hairline px-sm py-xs text-heading-sm text-ink">
                            سجل التدقيق{' '}
                            <span className="mt-xs max-w-3xl text-body-sm leading-relaxed text-muted">
                                (آخر {formatInt(audit.length)} سطر)
                            </span>
                        </h2>
                        {audit.length === 0 ? (
                            <p className="px-sm py-sm text-body-sm text-muted">لا سجل تدقيق لهذا المستخدم.</p>
                        ) : (
                            <TableScroll label="سجل تدقيق الصلاحيات">
                                <table className="w-full min-w-[680px] border-collapse text-body-md">
                                    <thead>
                                        <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                التاريخ
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الصلاحية
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                الإجراء
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                بواسطة
                                            </th>
                                            <th scope="col" className="px-sm py-xs text-start font-medium">
                                                السبب
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {audit.map((entry, index) => {
                                            const label = auditActionLabel(String(entry.action ?? ''));
                                            return (
                                                <tr
                                                    key={`${String(entry.created_at ?? '')}-${String(entry.perm_key ?? '')}-${String(index)}`}
                                                    className="border-b border-hairline hover:bg-surface-hover"
                                                >
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm text-muted" dir="ltr">
                                                        {auditTimestamp(String(entry.created_at ?? ''))}
                                                    </td>
                                                    <td className="erp-numeric px-sm py-xxs text-body-sm text-ink" dir="ltr">
                                                        {entry.perm_key || '—'}
                                                    </td>
                                                    <td
                                                        className={`px-sm py-xxs text-body-sm ${
                                                            label.tone === 'success'
                                                                ? 'text-success-text'
                                                                : label.tone === 'danger'
                                                                  ? 'text-danger-text'
                                                                  : 'text-muted'
                                                        }`}
                                                    >
                                                        {label.label}
                                                    </td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">{entry.acted_by || '—'}</td>
                                                    <td className="px-sm py-xxs text-body-sm text-muted">{entry.reason || '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </TableScroll>
                        )}
                    </Card>
                </>
            ) : null}
        </div>
    );
}
