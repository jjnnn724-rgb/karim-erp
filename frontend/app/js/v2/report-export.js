/** Apply a consistent, non-destructive presentation to report workbooks. */
export function prepareReportWorkbook(XLSX, workbook, title) {
    if (!XLSX || !XLSX.utils || typeof XLSX.utils.decode_range !== 'function'
        || typeof XLSX.utils.encode_range !== 'function'
        || typeof XLSX.utils.encode_cell !== 'function') {
        throw new TypeError('prepareReportWorkbook: XLSX utilities are required');
    }
    if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) {
        throw new TypeError('prepareReportWorkbook: a valid workbook is required');
    }

    const reportTitle = String(title || 'تقرير').trim() || 'تقرير';
    const createdAt = new Date();
    workbook.Props = {
        ...(workbook.Props || {}),
        Title: reportTitle,
        Subject: 'تقرير صادر من نظام كريم ERP',
        Author: 'مطاعم الشرفة العالمي',
        Company: 'مطاعم الشرفة العالمي',
        CreatedDate: createdAt,
    };

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet || !sheet['!ref']) {continue;}

        const range = XLSX.utils.decode_range(sheet['!ref']);
        const widths = [];
        for (let column = range.s.c; column <= range.e.c; column += 1) {
            let longest = 0;
            const lastSampleRow = Math.min(range.e.r, range.s.r + 100);
            for (let row = range.s.r; row <= lastSampleRow; row += 1) {
                const address = XLSX.utils.encode_cell({ r: row, c: column });
                const cell = sheet[address];
                if (cell && cell.v != null) {
                    longest = Math.max(longest, Array.from(String(cell.v)).length);
                }
            }
            const existingWidth = sheet['!cols'] && sheet['!cols'][column - range.s.c]
                ? Number(sheet['!cols'][column - range.s.c].wch) || 0 : 0;
            widths.push({ wch: Math.max(existingWidth, Math.min(42, Math.max(12, longest + 2))) });
        }
        sheet['!cols'] = widths;

        if (range.e.r > range.s.r && !sheet['!autofilter']) {
            sheet['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
        }
        if (range.s.r < range.e.r) {
            const rowStyles = Array.isArray(sheet['!rows']) ? sheet['!rows'] : [];
            rowStyles[range.s.r] = { ...(rowStyles[range.s.r] || {}), hpt: 26 };
            sheet['!rows'] = rowStyles;
        }
    }

    return workbook;
}
