const fs = require('fs');
const path = require('path');
const vm = require('vm');
const XLSX = require('xlsx');

const APP = path.join(__dirname, '..', 'frontend', 'app');
const V2 = path.join(APP, 'js', 'v2');
const EXPORT = path.join(APP, 'js', 'v2', 'report-export.js');
const PRINT_CSS = path.join(APP, 'css', 'v2', 'erp-base.css');
const REPORT_EXPORT_SCREENS = [
    'attendance', 'cashier-monitor', 'cfo', 'employees', 'inventory-inquiry',
    'payroll', 'received-analyzer', 'sales-analyzer', 'wh-vs-pos',
];

function loadExport() {
    const source = fs.readFileSync(EXPORT, 'utf8')
        .replace(/^export\s+/gm, '')
        + '\n;globalThis.prepareReportWorkbook = prepareReportWorkbook;';
    const context = { Array, Date, Math, Number, Object, String, TypeError };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: EXPORT });
    return context.prepareReportWorkbook;
}

describe('V2 report presentation', () => {
    test('prepares workbook metadata and readable sheet layout without changing report values', () => {
        const prepare = loadExport();
        const sheet = {
            A1: { v: 'اسم الصنف' },
            B1: { v: 'الكمية' },
            A2: { v: 'أرز' },
            B2: { v: 12 },
            '!ref': 'A1:B2',
        };
        const workbook = { SheetNames: ['التقرير'], Sheets: { التقرير: sheet } };
        const XLSX = {
            utils: {
                decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }),
                encode_range: () => 'A1:B2',
                encode_cell: ({ r, c }) => `${String.fromCharCode(65 + c)}${r + 1}`,
            },
        };

        expect(prepare(XLSX, workbook, 'تقرير المخزون')).toBe(workbook);
        expect(workbook.Props.Title).toBe('تقرير المخزون');
        expect(workbook.Props.Author).toBe('مطاعم الشرفة العالمي');
        expect(sheet['!autofilter']).toEqual({ ref: 'A1:B2' });
        expect(sheet['!cols']).toEqual([{ wch: 12 }, { wch: 12 }]);
        expect(sheet['!rows'][0]).toEqual({ hpt: 26 });
        expect(sheet.A1.v).toBe('اسم الصنف');
        expect(sheet.B2.v).toBe(12);
    });

    test('writes a readable XLSX file with report filters and metadata intact', () => {
        const prepare = loadExport();
        const workbook = XLSX.utils.book_new();
        const sheet = XLSX.utils.aoa_to_sheet([['الصنف', 'الكمية'], ['أرز', 12]]);
        XLSX.utils.book_append_sheet(workbook, sheet, 'التقرير');

        prepare(XLSX, workbook, 'تقرير المخزون');
        const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        const reopened = XLSX.read(bytes, { type: 'buffer', cellStyles: true });
        const exportedSheet = reopened.Sheets['التقرير'];

        expect(reopened.Props.Title).toBe('تقرير المخزون');
        expect(reopened.Props.Author).toBe('مطاعم الشرفة العالمي');
        expect(exportedSheet['!autofilter'].ref).toBe('A1:B2');
        expect(exportedSheet['!cols'][0].wch).toBeGreaterThanOrEqual(12);
        expect(exportedSheet['!rows'][0].hpt).toBe(26);
        expect(exportedSheet.A1.v).toBe('الصنف');
        expect(exportedSheet.B2.v).toBe(12);
    });

    test('rejects invalid workbook inputs explicitly', () => {
        const prepare = loadExport();
        expect(() => prepare(null, {}, 'تقرير')).toThrow('XLSX utilities are required');
        expect(() => prepare({ utils: {} }, {}, 'تقرير')).toThrow('XLSX utilities are required');
        expect(() => prepare({
            utils: { decode_range() {}, encode_range() {}, encode_cell() {} },
        }, {}, 'تقرير'))
            .toThrow('a valid workbook is required');
    });

    test('provides consistent print layout for V2 screens and data tables', () => {
        const css = fs.readFileSync(PRINT_CSS, 'utf8');
        expect(css).toContain('@page { margin: 12mm 10mm; }');
        expect(css).toContain('.erp-shell__sidebar');
        expect(css).toContain('.erp-shell__content');
        expect(css).toContain('.erp-table__scroll');
        expect(css).toContain('display: table-header-group');
        expect(css).toContain('page-break-inside: avoid');
    });

    test('uses the shared workbook presentation for every existing report export', () => {
        for (const name of REPORT_EXPORT_SCREENS) {
            const source = fs.readFileSync(path.join(V2, 'screens', `${name}.js`), 'utf8');
            expect(source).toMatch(/import \{ prepareReportWorkbook \} from '\.\.\/report-export\.js\?v=\d+\.\d+\.\d+';/);
            expect(source).toContain('prepareReportWorkbook(window.XLSX, wb,');
        }
    });
});
