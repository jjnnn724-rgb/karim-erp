import type { V3ChartAccount } from '@karim/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronIcon } from '../components/icons';
import { Card, StateEmpty, StateError, StateLoading, TableScroll, TableSkeleton } from '../components/TableState';
import { PrintActions } from '../components/PrintActions';
import { accountTypeLabel } from '../lib/format';
import { fetchChart } from '../lib/queries';
import { queryKeys } from '../lib/queryKeys';

/**
 * شجرة الحسابات — قراءة فقط (`/api/v3/accounting/chart`).
 *
 * الشجرة مبنية من `parent_code` لا من ترتيب النتيجة: حسابٌ بلا أبٍ موجودٍ في
 * القائمة يُعرض جذرًا (لا يختفي شيء)، والعمق يُحسب بالعدّ.
 */

interface TreeNode {
    account: V3ChartAccount;
    children: TreeNode[];
    depth: number;
}

function buildTree(accounts: readonly V3ChartAccount[]): TreeNode[] {
    const nodes = new Map<string, TreeNode>();
    for (const account of accounts) {
        nodes.set(account.code, { account, children: [], depth: 0 });
    }
    const roots: TreeNode[] = [];
    for (const account of accounts) {
        const node = nodes.get(account.code);
        if (!node) {
            continue;
        }
        const parentCode = account.parent_code;
        const parent = parentCode ? nodes.get(parentCode) : undefined;
        if (parent && parent.account.code !== account.code) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }
    const assignDepth = (node: TreeNode, depth: number): void => {
        node.depth = depth;
        for (const child of node.children) {
            assignDepth(child, depth + 1);
        }
    };
    for (const root of roots) {
        assignDepth(root, 0);
    }
    return roots;
}

/**
 * يسرد الصفوف المرئية.
 *
 * أثناء البحث تُفتح كل المستويات: الشجرة المُصفَّاة فيها الطريق إلى المطابقة
 * فقط، فإخفاؤه خلف عقد الطيّ يُخفي المطابقة نفسها.
 */
function flatten(
    nodes: readonly TreeNode[],
    expanded: ReadonlySet<string>,
    expandAll: boolean,
    out: TreeNode[] = [],
): TreeNode[] {
    for (const node of nodes) {
        out.push(node);
        if (node.children.length > 0 && (expandAll || expanded.has(node.account.code))) {
            flatten(node.children, expanded, expandAll, out);
        }
    }
    return out;
}

/** يبقى المرشّح مع أسلافه: الطريق إلى المطابقة يبقى مرئيًا. */
function keepMatching(node: TreeNode, needle: string): TreeNode | null {
    const children = node.children
        .map((child) => keepMatching(child, needle))
        .filter((child): child is TreeNode => child !== null);
    const selfMatch = node.account.code.toLowerCase().includes(needle) || node.account.name_ar.includes(needle);
    if (!selfMatch && children.length === 0) {
        return null;
    }
    return { account: node.account, children, depth: node.depth };
}

export function AccountsTree() {
    const [search, setSearch] = useState('');
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const initialized = useRef(false);

    const query = useQuery({
        queryKey: queryKeys.chart,
        queryFn: ({ signal }) => fetchChart(signal),
    });

    const accounts = useMemo(() => query.data ?? [], [query.data]);
    const tree = useMemo(() => buildTree(accounts), [accounts]);

    useEffect(() => {
        if (initialized.current || accounts.length === 0) {
            return;
        }
        initialized.current = true;
        // الجذور مفتوحة افتراضيًا: البنية تظهر دون نقر.
        const rootsWithChildren = tree.filter((node) => node.children.length > 0).map((node) => node.account.code);
        setExpanded(new Set(rootsWithChildren));
    }, [accounts.length, tree]);

    const needle = search.trim();
    const visibleTree = useMemo(() => {
        if (!needle) {
            return tree;
        }
        const lower = needle.toLowerCase();
        return tree.map((node) => keepMatching(node, lower)).filter((node): node is TreeNode => node !== null);
    }, [needle, tree]);

    const visible = useMemo(() => flatten(visibleTree, expanded, needle !== ''), [expanded, needle, visibleTree]);
    const activeCount = accounts.filter((account) => account.is_active).length;

    function toggle(code: string) {
        setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(code)) {
                next.delete(code);
            } else {
                next.add(code);
            }
            return next;
        });
    }

    return (
        <div className="flex flex-col gap-md">
            <header className="flex flex-wrap items-end justify-between gap-sm">
                <div>
                    <h1 className="text-display-lg text-ink">شجرة الحسابات</h1>
                    <p className="text-body-sm text-muted">
                        {accounts.length > 0
                            ? `${String(accounts.length)} حسابًا · ${String(activeCount)} نشطًا`
                            : 'لا توجد حسابات معروضة'}
                    </p>
                </div>
                <div className="flex items-center gap-xs" data-erp-print-hide>
                    <PrintActions title="شجرة الحسابات" />
                    <label className="flex flex-col gap-xxs text-label-md text-ink-secondary" htmlFor="erp-v3-chart-search">
                        بحث
                        <input
                            id="erp-v3-chart-search"
                            type="search"
                            value={search}
                            placeholder="رمز الحساب أو اسمه"
                            onChange={(event) => {
                                setSearch(event.target.value);
                            }}
                            className="h-9 w-56 rounded-md border border-hairline-strong bg-surface px-sm text-body-md text-ink"
                        />
                    </label>
                </div>
            </header>

            <Card>
                {query.isPending ? (
                    <div aria-busy="true">
                        <StateLoading label="جارٍ تحميل شجرة الحسابات" />
                        <TableSkeleton rows={6} columns={4} />
                    </div>
                ) : null}

                {query.isError ? (
                    <StateError
                        message={query.error instanceof Error ? query.error.message : 'خطأ غير معروف'}
                        onRetry={() => {
                            void query.refetch();
                        }}
                    />
                ) : null}

                {query.isSuccess && accounts.length === 0 ? (
                    <StateEmpty
                        title="لا توجد حسابات"
                        hint="لم تُستورد الحسابات بعد."
                    />
                ) : null}

                {query.isSuccess && accounts.length > 0 && visible.length === 0 ? (
                    <StateEmpty title="لا نتائج" hint="لا حساب يطابق البحث — جرّب رمزًا آخر أو امسح البحث." />
                ) : null}

                {query.isSuccess && visible.length > 0 ? (
                    <TableScroll label="جدول شجرة الحسابات">
                        <table className="w-full border-collapse text-body-md">
                            <thead>
                                <tr className="bg-surface-sunken text-label-md text-ink-secondary">
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الحساب
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        الاسم
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        النوع
                                    </th>
                                    <th scope="col" className="px-sm py-xs text-start font-medium">
                                        قابل للترحيل
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((node) => {
                                    const hasChildren = node.children.length > 0;
                                    const isOpen = expanded.has(node.account.code);
                                    return (
                                        <tr
                                            key={node.account.code}
                                            className="border-b border-hairline last:border-b-0 hover:bg-surface-hover"
                                        >
                                            <td className="px-sm py-xxs">
                                                <span
                                                    className="flex items-center gap-xxs"
                                                    style={{ paddingInlineStart: `${String(node.depth * 18)}px` }}
                                                >
                                                    {hasChildren ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                toggle(node.account.code);
                                                            }}
                                                            aria-expanded={isOpen}
                                                            aria-label={`${isOpen ? 'طيّ' : 'فتح'} حساب ${node.account.code}`}
                                                            className="grid size-5 place-items-center rounded-sm text-muted hover:bg-surface-sunken hover:text-ink"
                                                        >
                                                            <ChevronIcon
                                                                className={`size-4 ${isOpen ? '' : 'rotate-90'}`}
                                                            />
                                                        </button>
                                                    ) : (
                                                        <span aria-hidden="true" className="inline-block w-5" />
                                                    )}
                                                    <span className="erp-numeric text-body-md text-ink">
                                                        {node.account.code}
                                                    </span>
                                                    {node.account.is_active ? null : (
                                                        <span className="rounded-full border border-neutral px-xs py-xxs text-caption text-neutral-text">
                                                            غير نشط
                                                        </span>
                                                    )}
                                                </span>
                                            </td>
                                            <td className="px-sm py-xxs text-ink">{node.account.name_ar}</td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {accountTypeLabel(node.account.type)}
                                            </td>
                                            <td className="px-sm py-xxs text-body-sm text-muted">
                                                {node.account.is_postable ? 'نعم' : 'لا'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </TableScroll>
                ) : null}
            </Card>
        </div>
    );
}
