import type { V3ChartAccount } from '@karim/shared';
import { fetchChart } from './queries';

export type AccountChartTypeFilter = 'all' | V3ChartAccount['type'];

export interface AccountChartFilters {
    search: string;
    type: AccountChartTypeFilter;
    level: number | null;
}

export interface AccountChartPageRequest extends AccountChartFilters {
    page: number;
    pageSize: number;
}

export interface AccountChartNode {
    account: V3ChartAccount;
    children: AccountChartNode[];
    depth: number;
}

export interface AccountChartPage {
    items: AccountChartNode[];
    page: number;
    pageSize: number;
    total: number;
    matchedAccounts: number;
    rowCount: number;
    availableLevels: number[];
}

export type AccountChartPageService = (request: AccountChartPageRequest, signal?: AbortSignal) => Promise<AccountChartPage>;

function buildAccountTree(accounts: readonly V3ChartAccount[]): AccountChartNode[] {
    const nodes = new Map<string, AccountChartNode>();
    const parentCodes = new Map<string, string>();

    for (const account of accounts) {
        nodes.set(account.code, { account, children: [], depth: 0 });
    }

    for (const account of accounts) {
        const parentCode = account.parent_code;
        if (parentCode && parentCode !== account.code && nodes.has(parentCode)) {
            parentCodes.set(account.code, parentCode);
        }
    }

    for (const code of nodes.keys()) {
        const path = new Set<string>();
        let current = code;
        while (parentCodes.has(current)) {
            if (path.has(current)) {
                parentCodes.delete(current);
                break;
            }
            path.add(current);
            const parentCode = parentCodes.get(current);
            if (!parentCode) {
                break;
            }
            if (path.has(parentCode)) {
                parentCodes.delete(current);
                break;
            }
            current = parentCode;
        }
    }

    const roots: AccountChartNode[] = [];
    for (const account of accounts) {
        const node = nodes.get(account.code);
        if (!node) {
            continue;
        }
        const parentCode = parentCodes.get(account.code);
        const parent = parentCode ? nodes.get(parentCode) : undefined;
        if (parent) {
            parent.children.push(node);
        } else {
            roots.push(node);
        }
    }

    const assignDepth = (node: AccountChartNode, depth: number): void => {
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

function matchesFilters(node: AccountChartNode, filters: AccountChartFilters): boolean {
    const search = filters.search.trim().toLocaleLowerCase();
    const matchesSearch =
        search === '' ||
        node.account.code.toLocaleLowerCase().includes(search) ||
        node.account.name_ar.toLocaleLowerCase().includes(search) ||
        (node.account.name_en?.toLocaleLowerCase().includes(search) ?? false);
    const matchesType = filters.type === 'all' || node.account.type === filters.type;
    const matchesLevel = filters.level === null || node.depth + 1 === filters.level;
    return matchesSearch && matchesType && matchesLevel;
}

function filterNode(node: AccountChartNode, filters: AccountChartFilters): AccountChartNode | null {
    const children = node.children.map((child) => filterNode(child, filters)).filter((child): child is AccountChartNode => child !== null);
    if (!matchesFilters(node, filters) && children.length === 0) {
        return null;
    }
    return { ...node, children };
}

function countNodes(nodes: readonly AccountChartNode[]): number {
    return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}

function countMatches(nodes: readonly AccountChartNode[], filters: AccountChartFilters): number {
    return nodes.reduce((count, node) => count + (matchesFilters(node, filters) ? 1 : 0) + countMatches(node.children, filters), 0);
}

export function paginateAccountChartMock(accounts: readonly V3ChartAccount[], request: AccountChartPageRequest): AccountChartPage {
    if (!Number.isInteger(request.page) || request.page < 1) {
        throw new RangeError('Account chart page must be a positive integer.');
    }
    if (!Number.isInteger(request.pageSize) || request.pageSize < 1) {
        throw new RangeError('Account chart page size must be a positive integer.');
    }

    const roots = buildAccountTree(accounts);
    const filters: AccountChartFilters = {
        search: request.search,
        type: request.type,
        level: request.level,
    };
    const filteredRoots = roots.map((root) => filterNode(root, filters)).filter((root): root is AccountChartNode => root !== null);
    const start = (request.page - 1) * request.pageSize;
    const availableLevels = new Set<number>();
    const collectLevels = (nodes: readonly AccountChartNode[]) => {
        for (const node of nodes) {
            availableLevels.add(node.depth + 1);
            collectLevels(node.children);
        }
    };
    collectLevels(roots);

    return {
        items: filteredRoots.slice(start, start + request.pageSize),
        page: request.page,
        pageSize: request.pageSize,
        total: filteredRoots.length,
        matchedAccounts: countMatches(roots, filters),
        rowCount: countNodes(filteredRoots),
        availableLevels: [...availableLevels].sort((left, right) => left - right),
    };
}

/**
 * MOCK: the current chart endpoint returns the full real account list and has
 * no pagination/filter parameters. This adapter mirrors the future page-service
 * contract in memory; it never creates or substitutes account records.
 */
export const mockAccountChartPageService: AccountChartPageService = async (request, signal) =>
    paginateAccountChartMock(await fetchChart(signal), request);

export function countAccountChartNodes(nodes: readonly AccountChartNode[]): number {
    return countNodes(nodes);
}
