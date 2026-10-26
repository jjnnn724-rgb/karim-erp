/**
 * The cost-analysis A4 sheet is the printed face of the V2 screen. It must
 * carry the restaurant identity, the same totals the screen shows, and no
 * POS vendor name — the sheet is customer-facing.
 */
const {
    renderCostAnalysisPrintHtml,
} = require('../backend/finance-routes.js');

const PAYLOAD = {
    rows: [
        {
            code: 'kitchen', name: 'المطبخ', rev: 1000, materials: 200,
            countAdj: 10, operating: 90, exp: 300, profit: 700,
            costRatio: 30, total: 300, rowCount: 12,
        },
        {
            code: 'store', name: 'المخزن', rev: 100, materials: 200,
            countAdj: 0, operating: 0, exp: 200, profit: -100,
            costRatio: 200, total: 200, rowCount: 3,
        },
    ],
    totals: { rev: 1000, mat: 200, cnt: 10, ops: 90, exp: 300, avgCost: 30 },
    categories: [{ label: 'رواتب', value: 90 }, { label: 'كهرباء', value: 210 }],
    period: { from: '2026-10-01', to: '2026-10-23' },
};

const OPTS = {
    restaurantName: 'مطاعم الشرفه العالمي',
    logo: 'data:image/png;base64,AAAA',
    currency: 'SAR',
    generatedAt: '2026-10-23 10:00',
    generatedBy: 'admin',
};

describe('renderCostAnalysisPrintHtml — A4 identity', () => {
    test('brand header, logo and period lead the sheet', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('data-v2-print-brand');
        expect(html).toContain('<img src="data:image/png;base64,AAAA"');
        expect(html).toContain('مطاعم الشرفه العالمي');
        expect(html).toContain('2026-10-01');
        expect(html).toContain('2026-10-23');
        expect(html).toContain('@page { size: A4;');
    });

    test('eight KPI cells and the three cost buckets are rendered', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        const cells = html.match(/<div class="cell">/g) || [];
        expect(cells).toHaveLength(8);
        expect(html).toContain('صرف المخزون (صافي المرتجعات)');
        expect(html).toContain('فروق الجرد');
        expect(html).toContain('مصروفات تشغيلية');
        expect(html).toContain('صافي الربح');
        expect(html).toContain('1,000.00');
        expect(html).toContain('700.00');
    });

    test('every department and category appears with totals and verdict', () => {
        const html = renderCostAnalysisPrintHtml(PAYLOAD, OPTS);
        expect(html).toContain('المطبخ');
        expect(html).toContain('المخزن');
        expect(html).toContain('رواتب');
        expect(html).toContain('كهرباء');
        expect(html).toContain('tfoot');
        expect(html).toContain('مربح');
        expect(html).toContain('خاسر');
        expect(html).toContain('أُنشئ 2026-10-23 10:00 · admin');
    });

    test('escapes stored text and never names the POS vendor', () => {
        const html = renderCostAnalysisPrintHtml({
            ...PAYLOAD,
            rows: [{ ...PAYLOAD.rows[0], name: '<script>alert(1)</script>' }],
        }, OPTS);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html.toLowerCase()).not.toContain('yara');
        expect(html).not.toContain('يارا');
    });
});
