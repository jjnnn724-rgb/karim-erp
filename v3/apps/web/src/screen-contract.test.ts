import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * حارس عقد الشاشات — نفس فلسفة `css-contract.test.ts`: لا نمنع التطور،
 * نمنع **التدهور**.
 *
 *  1. `PageHeader` إجباري: أي شاشة تعرض عنوان صفحة `<h1>` يجب أن تستخدمه،
 *     والاستثناءات محدودة ومعلنة صراحة (ترويسات مؤسسية بتصميمها الخاص).
 *  2. لا ترويسة صفحة مكررة: كتلة `<header>` بنفس أصناف الترويسة القديمة
 *     ممنوعة — من يضيف شاشة يمرّ من المكوّن الموحّد.
 *  3. الجدول: `DataTable` هو المسار، والأساس `screen-tables-baseline.json`
 *     يسجّل ما تبقّى من جداول خام. أي زيادة = فشل، وأي نظافة تُسجَّل.
 *     التضييق بعد التنظيف:
 *       SCREEN_TABLES_UPDATE=1 node node_modules/vitest/vitest.mjs run src/screen-contract.test.ts
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const SCREENS_DIR = join(SRC, 'screens');
const BASELINE_PATH = join(SRC, 'screen-tables-baseline.json');

const SCREEN_FILES = readdirSync(SCREENS_DIR)
    .filter((file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx') && !file.endsWith('.lazy.tsx'))
    .sort();

const SOURCE = new Map(SCREEN_FILES.map((file) => [file, readFileSync(join(SCREENS_DIR, file), 'utf8')]));

/** ترويسات مؤسسية بتصميمها الخاص — بديل PageHeader المعلن لكل شاشة. */
const BESPOKE_HEADERS: Readonly<Record<string, string>> = {
    'Mudad.tsx': 'mudad-hero',
    'FinancialCompliance.tsx': 'fc-header',
    'CashierKiosk.tsx': 'pos-kiosk__bar',
    'LegacySource.tsx': 'legacy-source__head',
};

/** أصناف الترويسة القديمة المكررة التي وُحّدت إلى PageHeader. */
const LEGACY_PAGE_HEADER =
    /<header className="(?:flex flex-wrap items-end justify-between gap-sm|flex flex-wrap items-end justify-between gap-md border-b border-hairline pb-md)">/;

interface TablesBaseline {
    readonly _generated?: string;
    readonly files: Readonly<Record<string, number>>;
}

const tableCounts = new Map<string, number>(
    SCREEN_FILES.map((file) => [`screens/${file}`, (SOURCE.get(file)?.match(/<table\b/g) ?? []).length]),
);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as TablesBaseline;

if (process.env.SCREEN_TABLES_UPDATE === '1') {
    const tightened: Record<string, number> = {};
    for (const [file, allowed] of Object.entries(baseline.files)) {
        const current = tableCounts.get(file) ?? 0;
        const next = Math.min(allowed, current);
        if (next > 0) tightened[file] = next;
    }
    writeFileSync(
        BASELINE_PATH,
        `${JSON.stringify({ _generated: new Date().toISOString(), files: tightened }, null, 4)}\n`,
    );
}

describe('عقد الشاشات — الترويسة الموحّدة', () => {
    it('كل شاشة فيها <h1> تستخدم PageHeader أو ترويسة مؤسسية معلنة', () => {
        const offenders: string[] = [];
        for (const [file, source] of SOURCE) {
            if (!source.includes('<h1')) continue;
            if (source.includes('PageHeader')) continue;
            const bespoke = BESPOKE_HEADERS[file];
            if (!bespoke) {
                offenders.push(`${file}: <h1> بلا PageHeader`);
                continue;
            }
            if (!source.includes(bespoke)) offenders.push(`${file}: الترويسة المعلنة ${bespoke} غير موجودة`);
        }
        expect(offenders).toEqual([]);
    });

    it('لا ترويسة صفحة مكررة بأصناف قديمة — PageHeader هو المصدر الوحيد', () => {
        const offenders = SCREEN_FILES.filter((file) => LEGACY_PAGE_HEADER.test(SOURCE.get(file) ?? ''));
        expect(offenders).toEqual([]);
    });

    it('الاستثناءات المؤسسية محدودة ومعلنة', () => {
        expect(Object.keys(BESPOKE_HEADERS).sort()).toEqual([
            'CashierKiosk.tsx',
            'FinancialCompliance.tsx',
            'LegacySource.tsx',
            'Mudad.tsx',
        ]);
    });
});

describe('عقد الشاشات — جدول واحد (DataTable)', () => {
    it('لا زيادة على أساس الجداول الخام في أي شاشة', () => {
        const offenders: string[] = [];
        for (const [file, count] of tableCounts) {
            const allowed = baseline.files[file] ?? 0;
            if (count > allowed) offenders.push(`${file}: ${count} جدول خام > الأساس ${allowed}`);
        }
        expect(offenders).toEqual([]);
    });

    it('الانخفاضات تُسجَّل — حدّث الأساس لتضييقه (SCREEN_TABLES_UPDATE=1)', () => {
        const notes: string[] = [];
        for (const [file, allowed] of Object.entries(baseline.files)) {
            if (!tableCounts.has(file)) notes.push(`ملف الأساس لم يعد موجودًا: ${file}`);
            else if ((tableCounts.get(file) ?? 0) < allowed) notes.push(`انخفض في ${file}`);
        }
        for (const note of notes) console.info(note);
        expect(notes.length).toBeGreaterThanOrEqual(0);
    });

    it('دليل الموظفين مُهاجر بالكامل إلى DataTable', () => {
        expect(tableCounts.get('screens/Employees.tsx')).toBe(0);
    });
});
