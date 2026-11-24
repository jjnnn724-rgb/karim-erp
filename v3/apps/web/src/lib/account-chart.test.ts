import { describe, expect, it } from 'vitest';
import { chartCaptureBody } from '../test-fixtures/captures';
import { countAccountChartNodes, paginateAccountChartMock } from './account-chart';

function flattenCodes(nodes: ReturnType<typeof paginateAccountChartMock>['items']): string[] {
    return nodes.flatMap((node) => [node.account.code, ...flattenCodes(node.children)]);
}

const request = {
    page: 1,
    pageSize: 4,
    search: '',
    type: 'all' as const,
    level: null,
};

describe('account chart page service contract', () => {
    it('paginates the real captured chart without losing or duplicating accounts', () => {
        const firstPage = paginateAccountChartMock(chartCaptureBody, request);
        const pageCount = Math.ceil(firstPage.total / request.pageSize);
        const pages = Array.from({ length: pageCount }, (_, index) =>
            paginateAccountChartMock(chartCaptureBody, { ...request, page: index + 1 }),
        );
        const codes = pages.flatMap((page) => flattenCodes(page.items));

        expect(firstPage.matchedAccounts).toBe(chartCaptureBody.length);
        expect(firstPage.rowCount).toBe(chartCaptureBody.length);
        expect(pageCount).toBeGreaterThan(1);
        expect(countAccountChartNodes(pages.flatMap((page) => page.items))).toBe(chartCaptureBody.length);
        expect(new Set(codes).size).toBe(chartCaptureBody.length);
        expect(codes.sort()).toEqual(chartCaptureBody.map((account) => account.code).sort());
    });

    it('preserves ancestor paths for matching accounts and counts only direct matches', () => {
        const result = paginateAccountChartMock(chartCaptureBody, { ...request, search: 'صندوق' });
        const codes = flattenCodes(result.items);

        expect(result.total).toBe(1);
        expect(result.matchedAccounts).toBeGreaterThan(0);
        expect(result.rowCount).toBeGreaterThanOrEqual(result.matchedAccounts);
        expect(codes).toContain('1');
        expect(codes).toContain('11');
        expect(codes).toContain('111');
        expect(codes).toContain('1000');
    });

    it('combines account type and hierarchy-level filters using actual account fields', () => {
        const result = paginateAccountChartMock(chartCaptureBody, {
            ...request,
            pageSize: chartCaptureBody.length,
            type: 'asset',
            level: 2,
        });
        const levelTwo = result.items.flatMap((root) => [root, ...root.children]).filter((node) => node.depth === 1);

        expect(result.matchedAccounts).toBeGreaterThan(0);
        expect(levelTwo.length).toBe(result.matchedAccounts);
        expect(levelTwo.every((node) => node.account.type === 'asset')).toBe(true);
    });

    it('rejects invalid page inputs explicitly', () => {
        expect(() => paginateAccountChartMock(chartCaptureBody, { ...request, page: 0 })).toThrow(RangeError);
        expect(() => paginateAccountChartMock(chartCaptureBody, { ...request, pageSize: 0 })).toThrow(RangeError);
    });
});
