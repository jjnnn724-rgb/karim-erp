const fs = require('fs');
const path = require('path');

const FINANCE = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'js', 'features', 'finance.js'), 'utf8');

function between(source, start, end) {
    const startAt = source.indexOf(start);
    expect(startAt).toBeGreaterThan(-1);
    const endAt = source.indexOf(end, startAt + start.length);
    expect(endAt).toBeGreaterThan(startAt);
    return source.slice(startAt, endAt);
}

describe('فترة تحليل التكلفة', () => {
    test('يظل اختيار التاريخين ممكنًا قبل تطبيق الفترة وإعادة رسم التقرير', () => {
        const screen = between(FINANCE, 'function renderCostAnalysis()', '// ============================================\n// P&L');
        const fromInput = screen.slice(screen.indexOf('id="costAnalysisFromInput"'), screen.indexOf('</div>', screen.indexOf('id="costAnalysisFromInput"')));
        const toInput = screen.slice(screen.indexOf('id="costAnalysisToInput"'), screen.indexOf('</div>', screen.indexOf('id="costAnalysisToInput"')));

        expect(fromInput).not.toContain('data-karim-event="change"');
        expect(toInput).not.toContain('data-karim-event="change"');
        expect(screen).toContain('data-karim-action="applyCostAnalysisPeriod"');
        expect(screen).toContain('data-karim-action="resetCostAnalysisPeriod"');
    });

    test('يطبّق النطاق المكتمل، ويرفض ترتيب تاريخ غير صحيح، ويعيد كل الفترة', () => {
        const apply = between(FINANCE, 'function applyCostAnalysisPeriod()', 'function renderCostAnalysis()');
        const reset = between(FINANCE, 'function resetCostAnalysisPeriod()', 'function renderCostAnalysis()');

        expect(apply).toContain("document.getElementById('costAnalysisFromInput')?.value");
        expect(apply).toContain("document.getElementById('costAnalysisToInput')?.value");
        expect(apply).toContain('if(from&&to&&from>to)');
        expect(apply).toContain('window.costAnalysisFrom=from');
        expect(apply).toContain('window.costAnalysisTo=to');
        expect(apply).toContain('renderPage()');
        expect(reset).toContain("window.costAnalysisFrom=''");
        expect(reset).toContain("window.costAnalysisTo=''");
        expect(reset).toContain('renderPage()');
    });
});
