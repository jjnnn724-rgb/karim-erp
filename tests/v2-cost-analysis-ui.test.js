const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const SCREEN = fs.readFileSync(path.join(APP, 'js', 'v2', 'screens', 'cost-analysis.js'), 'utf8');
const STYLES = fs.readFileSync(path.join(APP, 'css', 'v2', 'erp-charts.css'), 'utf8');

describe('V2 cost-analysis layout', () => {
    test('date filters and actions have a separate, labeled toolbar', () => {
        expect(SCREEN).toContain('class="erp-v2-cost__filters" role="group" aria-label="فترة تحليل التكاليف"');
        expect(SCREEN).toContain('class="erp-v2-cost__date" for="v2cost-from"');
        expect(SCREEN).toContain('class="erp-v2-cost__date" for="v2cost-to"');
        expect(SCREEN).toContain('class="erp-v2-cost__actions"');
    });

    test('technical source notes are collapsed and monthly scope is clearly documented', () => {
        expect(SCREEN).toContain('<details class="erp-v2-cost__method">');
        expect(SCREEN).toContain('تفصيل التكاليف حسب القسم');
        expect(SCREEN).toContain('data-v2-summary role="status" aria-live="polite"');
        expect(SCREEN).toContain('قراءة وتجميع مباشر في الخادم من بداية الشهر الحالي حتى اليوم');
        expect(SCREEN).toContain('الحركات الأقدم لا تدخل في طلب الشاشة');
        expect(SCREEN).toContain("q('[data-v2-month]').disabled");
        expect(SCREEN).not.toContain('data-v2-all');
    });

    test('chart limits department labels while the register keeps all rows', () => {
        expect(SCREEN).toContain('.slice(0, 8)');
        expect(SCREEN).toContain('labels: chartRows.map((r) => r.name)');
        expect(SCREEN).toContain('الجدول يعرض الجميع');
        expect(SCREEN).toContain('table.setRows(rows)');
    });

    test('financial columns keep readable widths and the toolbar adapts to mobile', () => {
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost .erp-table__grid { min-width: 1120px; }');
        expect(STYLES).toContain('@media (max-width: 640px)');
        expect(STYLES).toContain('.erp-v2 .erp-v2-cost__filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }');
        expect(STYLES).toContain('@media print');
    });
});
