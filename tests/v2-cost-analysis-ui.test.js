const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const SCREEN = fs.readFileSync(path.join(APP, 'js', 'v2', 'screens', 'cost-analysis.js'), 'utf8');
const REPO = fs.readFileSync(path.join(APP, 'js', 'v2', 'data', 'finance-repo.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(APP, 'css', 'v2', 'erp-charts.css'), 'utf8');
const BACKEND = fs.readFileSync(path.join(__dirname, '..', 'backend', 'finance-routes.js'), 'utf8');

describe('V2 cost-analysis layout', () => {
    test('date filters and actions have a separate, labeled toolbar', () => {
        expect(SCREEN).toContain('class="erp-v2-cost__filters" role="group" aria-label="فترة تحليل التكاليف"');
        expect(SCREEN).toContain('class="erp-v2-cost__date" for="v2cost-from"');
        expect(SCREEN).toContain('class="erp-v2-cost__date" for="v2cost-to"');
        expect(SCREEN).toContain('class="erp-v2-cost__actions"');
    });

    test('the screen states no method or guidance text', () => {
        expect(SCREEN).not.toContain('<details');
        expect(SCREEN).not.toContain('erp-v2-cost__method');
        expect(SCREEN).not.toContain('عن طريقة احتساب التقرير');
        expect(SCREEN).not.toContain('قراءة وتجميع مباشر');
    });

    test('four hero figures lead, followed by four secondary KPIs', () => {
        expect(SCREEN).toContain('class="erp-v2-cost__hero" data-v2-hero');
        expect(SCREEN).toContain("statCard({ label: 'إجمالي الإيرادات'");
        expect(SCREEN).toContain("statCard({ label: 'إجمالي التكاليف'");
        expect(SCREEN).toContain("statCard({ label: 'صافي الربح'");
        expect(SCREEN).toContain("statCard({ label: 'نسبة التكلفة'");
        expect(SCREEN).toContain('class="erp-kpis erp-v2-cost__kpis" data-v2-kpis');
    });

    test('cost composition and top-department ranking are explicit panels', () => {
        expect(SCREEN).toContain('data-v2-mix');
        expect(SCREEN).toContain('data-v2-rank');
        expect(SCREEN).toContain("'صرف المخزون', value: num(t.mat)");
        expect(SCREEN).toContain("'فروق الجرد', value: num(t.cnt)");
        expect(SCREEN).toContain("'مصروفات تشغيلية', value: num(t.ops)");
        expect(SCREEN).toContain('.slice(0, 5)');
        expect(SCREEN).toContain('% من التكلفة');
        expect(SCREEN).toContain('% من الإيراد');
    });

    test('register keeps all rows and adds profit, margin, movements and verdict', () => {
        expect(SCREEN).toContain("key: 'profit', header: 'صافي الربح'");
        expect(SCREEN).toContain("key: 'margin', header: 'هامش الربح'");
        expect(SCREEN).toContain("key: 'rowCount', header: 'الحركات'");
        expect(SCREEN).toContain("key: 'status', header: 'التقييم'");
        expect(SCREEN).toContain('table.setRows(rows)');
        expect(SCREEN).toContain('labels: chartRows.map((r) => r.name)');
    });

    test('printing fetches the server A4 sheet with credentials, never window.print', () => {
        expect(SCREEN).not.toContain('window.print()');
        expect(SCREEN).toContain('fetchCostAnalysisPrintHtml(');
        expect(SCREEN).toContain("openInAppReport('تحليل التكاليف')");
        expect(SCREEN).toContain('viewer.document.write(html)');
        expect(REPO).toContain('export function fetchCostAnalysisPrintHtml(from, to)');
        expect(REPO).toContain('/finance/cost-analysis/print');
        expect(REPO).toContain("headers.Authorization = `Bearer ${window._jwt}`");
        expect(BACKEND).toContain("router.get('/cost-analysis/print'");
        expect(BACKEND).toContain('renderCostAnalysisPrintHtml');
        expect(BACKEND).toContain('data-v2-print-brand');
    });

    test('financial columns keep readable widths and the layout adapts to mobile', () => {
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost .erp-table__grid { min-width: 1380px; }');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__hero');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__split');
        expect(STYLES).toContain('@media (max-width: 900px)');
        expect(STYLES).toContain('@media (max-width: 640px)');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
        expect(STYLES).toContain('@media print');
    });

    test('the period band, metric rail and ranking bars are one system', () => {
        expect(SCREEN).toContain('data-v2-range');
        expect(SCREEN).toContain('data-v2-hero-grid');
        expect(SCREEN).toContain('data-v2-register-total');
        expect(SCREEN).toContain('class="erp-v2-cost__rank-bar"');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__hero-grid {');
        expect(STYLES).toContain('var(--erp-sidebar-bg)');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__rank-bar > span');
    });
});
